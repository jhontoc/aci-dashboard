'use strict';

var express      = require('express');
var spawn        = require('child_process').spawn;
var path         = require('path');
var fs           = require('fs');
var router       = express.Router();

var SNAPSHOT_DIR = path.join(__dirname, '../data/snapshots');

// ── Script map ───────────────────────────────────────────────
var SCRIPT_MAP = {
  show_version:          path.join(__dirname, '../scripts/aci_show_version.py'),
  show_interface_status: path.join(__dirname, '../scripts/aci_show_interface_status.py')
};

// ────────────────────────────────────────────────────────────
//  sanitiseProxy — normalise all empty / null proxy values
//
//  Handles every form the frontend might send:
//    null, undefined, "", "null", "  " → returns null
//    "/app/config/proxy.yaml"          → returns the string
// ────────────────────────────────────────────────────────────
function sanitiseProxy(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string')           return null;

  var trimmed = val.trim();
  if (trimmed === '' || trimmed === 'null') return null;

  return trimmed;
}

// ────────────────────────────────────────────────────────────
//  runScript — spawn one Python script, collect stdout/stderr
//
//  proxyYaml must already be sanitised (null or valid path)
//  before this function is called.
// ────────────────────────────────────────────────────────────
function runScript(scriptPath, apicIp, username, password, nodeIds, apiPort, proxyYaml) {
  return new Promise(function (resolve, reject) {

    // ── Build argument list ─────────────────────────────────
    var args = [
      scriptPath,
      '--apic',  apicIp,
      '--user',  username,
      '--pass',  password,
      '--nodes', nodeIds.join(','),
      '--port',  apiPort || '443'
    ];

    // Only append --proxy when a valid path is provided
    // proxyYaml is guaranteed null or a non-empty string here
    if (proxyYaml) {
      args.push('--proxy', proxyYaml);
    }

    var proc      = spawn('python3', args);
    var stdoutBuf = '';
    var stderrBuf = '';

    proc.stdout.on('data', function (chunk) { stdoutBuf += chunk.toString(); });
    proc.stderr.on('data', function (chunk) { stderrBuf += chunk.toString(); });

    proc.on('close', function (code) {
      resolve({ stdoutBuf: stdoutBuf, stderrBuf: stderrBuf, code: code });
    });

    proc.on('error', function (err) { reject(err); });
  });
}

// ────────────────────────────────────────────────────────────
//  POST /api/commands/run
// ────────────────────────────────────────────────────────────
router.post('/run', function (req, res) {
  var apicIp   = req.body.apicIp;
  var username = req.body.username;
  var password = req.body.password;
  var nodeIds  = req.body.nodeIds;
  var commands = req.body.commands;
  var apiPort  = req.body.apiPort || '443';

  // ── Sanitise proxy value — the key fix ───────────────────
  // Regardless of what the frontend sends (null, "", "null", path)
  // this resolves to either null or a valid path string
  var proxyYaml = sanitiseProxy(req.body.proxyYaml);

  // ── Validation ────────────────────────────────────────────
  if (!apicIp || !username || !password) {
    return res.status(400).json({
      error: 'apicIp, username, and password are required.'
    });
  }

  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    return res.status(400).json({
      error: 'nodeIds must be a non-empty array.'
    });
  }

  if (!Array.isArray(commands) || commands.length === 0) {
    return res.status(400).json({
      error: 'commands must be a non-empty array.'
    });
  }

  var invalidCmds = commands.filter(function (c) {
    return !SCRIPT_MAP[c];
  });
  if (invalidCmds.length > 0) {
    return res.status(400).json({
      error: 'Unknown commands: ' + invalidCmds.join(', ')
    });
  }

  // ── Proxy path validation — only when a path was given ───
  // If proxyYaml is null we skip this check entirely
  // Direct connection is assumed when proxyYaml is null
  if (proxyYaml !== null && !fs.existsSync(proxyYaml)) {
    return res.status(400).json({
      error: 'Proxy YAML file not found at path: ' + proxyYaml
    });
  }

  // ── SSE headers ───────────────────────────────────────────
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // ── SSE send helper ───────────────────────────────────────
  function send(data) {
    var payload = typeof data === 'object'
      ? JSON.stringify(data)
      : String(data);
    res.write('data: ' + payload + '\n\n');
  }

  // ── Log connection mode to stream ─────────────────────────
  send({
    status:    'started',
    commands:  commands,
    nodeCount: nodeIds.length,
    apiPort:   apiPort,
    proxy:     proxyYaml
      ? 'Via proxy YAML: ' + proxyYaml
      : 'Direct connection (no proxy)'    // ← clear confirmation
  });

  // ── Unified snapshot structure ────────────────────────────
  var now      = new Date();
  var snapshot = {
    timestamp: now.toISOString(),
    commands:  commands,
    apic:      apicIp,
    apiPort:   apiPort,
    proxy:     proxyYaml,    // null stored in snapshot when no proxy
    nodes:     {}
  };

  nodeIds.forEach(function (id) {
    snapshot.nodes[id] = {};
  });

  // ── Run each command sequentially ─────────────────────────
  var cmdIndex = 0;

  function runNext() {
    if (cmdIndex >= commands.length) {
      // All commands done — save snapshot
      saveSnapshot();
      return;
    }

    var cmd = commands[cmdIndex];
    cmdIndex++;

    send({
      status:  'spawning',
      command: cmd,
      script:  path.basename(SCRIPT_MAP[cmd]),
      proxy:   proxyYaml ? proxyYaml : 'none'
    });

    runScript(
      SCRIPT_MAP[cmd],
      apicIp,
      username,
      password,
      nodeIds,
      apiPort,
      proxyYaml       // null → no --proxy arg appended in runScript()
    )
    .then(function (result) {
      var stdoutBuf = result.stdoutBuf;
      var stderrBuf = result.stderrBuf;
      var code      = result.code;

      // Forward stderr to stream
      if (stderrBuf.trim()) {
        var stderrLines = stderrBuf.split('\n').filter(Boolean);
        for (var si = 0; si < stderrLines.length; si++) {
          send({ status: 'stderr', command: cmd, message: stderrLines[si].trim() });
        }
      }

      // Parse stdout lines
      var lines = stdoutBuf.split('\n').filter(Boolean);
      for (var li = 0; li < lines.length; li++) {
        var trimmed = lines[li].trim();
        send(trimmed);  // forward raw to SSE terminal

        try {
          var parsed = JSON.parse(trimmed);
          // Merge node data into unified snapshot
          if (parsed.node && parsed.data) {
            snapshot.nodes[parsed.node][cmd] = parsed.data;
          }
        } catch (e) {
          // Non-JSON progress line — already forwarded above
        }
      }

      send({
        status:  code === 0 ? 'command_done' : 'command_error',
        command: cmd,
        code:    code
      });

      // Run next command
      runNext();
    })
    .catch(function (spawnErr) {
      send({
        status:  'spawn_error',
        command: cmd,
        message: spawnErr.message
      });
      // Continue to next command even on spawn error
      runNext();
    });
  }

  // ── Save unified snapshot ─────────────────────────────────
  function saveSnapshot() {
    try {
      if (!fs.existsSync(SNAPSHOT_DIR)) {
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      }

      var ts       = now.toISOString()
        .replace(/:/g, '_')
        .replace(/\./g, '_');
      var cmdSlug  = commands.join('__');
      var filename = 'snapshot_' + ts + '__' + cmdSlug + '.json';
      var outPath  = path.join(SNAPSHOT_DIR, filename);

      fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

      send({
        status:         'snapshot_saved',
        snapshot_saved: filename,
        path:           outPath,
        commands:       commands,
        nodeCount:      nodeIds.length,
        proxy:          proxyYaml ? proxyYaml : 'none'
      });

    } catch (saveErr) {
      send({
        status:  'save_error',
        message: 'Failed to save snapshot: ' + saveErr.message
      });
    }

    res.write('data: [ALL_COMPLETE]\n\n');
    res.end();
  }

  // ── Start execution ───────────────────────────────────────
  runNext();

  // ── Handle client disconnect ──────────────────────────────
  req.on('close', function () {
    console.log('[commands] Client disconnected — SSE stream closed.');
  });
});

// ────────────────────────────────────────────────────────────
//  GET /api/commands/list
// ────────────────────────────────────────────────────────────
router.get('/list', function (_req, res) {
  res.json([
    {
      key:         'show_version',
      label:       'show version',
      description: 'Firmware version, model, serial number, and uptime per node.',
      apicClass:   'topSystem',
      script:      'aci_show_version.py'
    },
    {
      key:         'show_interface_status',
      label:       'show interface status',
      description: 'Physical interface states, speed, media type per node.',
      apicClass:   'l1PhysIf',
      script:      'aci_show_interface_status.py'
    }
  ]);
});

module.exports = router;