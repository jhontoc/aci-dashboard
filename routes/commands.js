'use strict';

var express  = require('express');
var spawn    = require('child_process').spawn;
var path     = require('path');
var fs       = require('fs');
var router   = express.Router();

var SNAPSHOT_DIR = path.join(__dirname, '../data/snapshots');

// ── Script map ───────────────────────────────────────────────
var SCRIPT_MAP = {
  show_version:          path.join(__dirname, '../scripts/aci_show_version.py'),
  show_interface_status: path.join(__dirname, '../scripts/aci_show_interface_status.py')
};

// ────────────────────────────────────────────────────────────
//  sanitiseProxy
// ────────────────────────────────────────────────────────────
function sanitiseProxy(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string')           return null;
  var trimmed = val.trim();
  if (trimmed === '' || trimmed === 'null') return null;
  return trimmed;
}

// ────────────────────────────────────────────────────────────
//  Helper — sanitise APIC IP for use in filename
//  Replaces dots and special chars with hyphens
//  e.g. "169.25.204.52" → "169-25-204-52"
// ────────────────────────────────────────────────────────────
function sanitiseIpForFilename(ip) {
  if (!ip) return 'unknown';
  return String(ip)
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '-')   // replace dots, colons etc
    .replace(/-+/g, '-')              // collapse multiple dashes
    .replace(/^-|-$/g, '');           // trim leading/trailing dashes
}

// ────────────────────────────────────────────────────────────
//  runScript — spawn one Python script, collect stdout/stderr
// ────────────────────────────────────────────────────────────
function runScript(
  scriptPath,
  apicIp,
  username,
  password,
  nodeIds,
  apiPort,
  proxyYaml
) {
  return new Promise(function (resolve, reject) {

    var args = [
      scriptPath,
      '--apic',  apicIp,
      '--user',  username,
      '--pass',  password,
      '--nodes', nodeIds.join(','),
      '--port',  apiPort || '443'
    ];

    if (proxyYaml) {
      args.push('--proxy', proxyYaml);
    }

    var proc      = spawn('python3', args);
    var stdoutBuf = '';
    var stderrBuf = '';

    proc.stdout.on('data', function (chunk) {
      stdoutBuf += chunk.toString();
    });
    proc.stderr.on('data', function (chunk) {
      stderrBuf += chunk.toString();
    });

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
  var proxyYaml = sanitiseProxy(req.body.proxyYaml);

  // ── Detailed validation ───────────────────────────────────
  var validationErrors = [];

  if (!apicIp || typeof apicIp !== 'string' || apicIp.trim() === '') {
    validationErrors.push('apicIp is missing or empty.');
  }
  if (!username || typeof username !== 'string' || username.trim() === '') {
    validationErrors.push('username is missing or empty.');
  }
  if (!password || typeof password !== 'string' || password.trim() === '') {
    validationErrors.push('password is missing or empty.');
  }
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    validationErrors.push(
      'nodeIds must be a non-empty array. Got: ' + JSON.stringify(nodeIds)
    );
  }
  if (!Array.isArray(commands) || commands.length === 0) {
    validationErrors.push('commands must be a non-empty array.');
  }

  if (validationErrors.length > 0) {
    return res.status(400).json({
      error:   'Validation failed',
      details: validationErrors
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

  if (proxyYaml !== null && !fs.existsSync(proxyYaml)) {
    return res.status(400).json({
      error: 'Proxy YAML file not found: ' + proxyYaml
    });
  }

  // ── SSE headers ───────────────────────────────────────────
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function send(data) {
    var payload = typeof data === 'object'
      ? JSON.stringify(data)
      : String(data);
    res.write('data: ' + payload + '\n\n');
  }

  send({
    status:    'started',
    commands:  commands,
    nodeCount: nodeIds.length,
    apiPort:   apiPort,
    proxy:     proxyYaml
      ? 'Via proxy YAML: ' + proxyYaml
      : 'Direct connection (no proxy)'
  });

  // ── Unified snapshot ──────────────────────────────────────
  var now      = new Date();
  var snapshot = {
    timestamp: now.toISOString(),
    commands:  commands,
    apic:      apicIp,
    apiPort:   apiPort,
    proxy:     proxyYaml,
    nodes:     {}
  };

  // Pre-populate node keys from requested IDs
  nodeIds.forEach(function (id) {
    snapshot.nodes[id] = {};
  });

  // ── Run commands sequentially ─────────────────────────────
  var cmdIndex = 0;

  function runNext() {
    if (cmdIndex >= commands.length) {
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
      proxyYaml
    )
    .then(function (result) {
      var stdoutBuf = result.stdoutBuf;
      var stderrBuf = result.stderrBuf;
      var code      = result.code;

      if (stderrBuf.trim()) {
        var stderrLines = stderrBuf.split('\n').filter(Boolean);
        for (var si = 0; si < stderrLines.length; si++) {
          send({
            status:  'stderr',
            command: cmd,
            message: stderrLines[si].trim()
          });
        }
      }

      var lines = stdoutBuf.split('\n').filter(Boolean);

      for (var li = 0; li < lines.length; li++) {
        var trimmed = lines[li].trim();
        send(trimmed);

        try {
          var parsed = JSON.parse(trimmed);

          if (parsed.node && parsed.data) {
            // Create node key if it does not exist
            if (!snapshot.nodes[parsed.node]) {
              snapshot.nodes[parsed.node] = {};
              send({
                status:  'node_key_created',
                node:    parsed.node,
                message: 'Node ' + parsed.node + ' added to snapshot'
              });
            }

            snapshot.nodes[parsed.node][cmd] = parsed.data;

            send({
              status:  'node_collected',
              command: cmd,
              node:    parsed.node
            });
          }
        } catch (e) {
          // Non-JSON progress line
        }
      }

      send({
        status:  code === 0 ? 'command_done' : 'command_error',
        command: cmd,
        code:    code
      });

      runNext();
    })
    .catch(function (spawnErr) {
      send({
        status:  'spawn_error',
        command: cmd,
        message: spawnErr.message
      });
      runNext();
    });
  }

  // ── Save unified snapshot ─────────────────────────────────
  function saveSnapshot() {

    // Remove empty pre-populated node keys
    var nodeKeys = Object.keys(snapshot.nodes);
    for (var ni = 0; ni < nodeKeys.length; ni++) {
      var nk = nodeKeys[ni];
      if (Object.keys(snapshot.nodes[nk]).length === 0) {
        send({
          status:  'node_skipped',
          node:    nk,
          message: 'Node ' + nk + ' returned no data — removed'
        });
        delete snapshot.nodes[nk];
      }
    }

    var collectedNodes = Object.keys(snapshot.nodes);

    if (collectedNodes.length === 0) {
      send({
        status:  'save_error',
        message: 'No node data collected — snapshot not saved.'
      });
      res.write('data: [ALL_COMPLETE]\n\n');
      res.end();
      return;
    }

    // ── Store collected node IDs in snapshot for display ──
    snapshot.collectedNodes = collectedNodes;

    try {
      if (!fs.existsSync(SNAPSHOT_DIR)) {
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      }

      // ── Build filename ────────────────────────────────────
      // Format: snapshot_{timestamp}_{apic-ip}.json
      // Example: snapshot_2026-07-09T04_04_19_553Z_169-25-204-52.json
      var ts        = now.toISOString()
        .replace(/:/g, '_')
        .replace(/\./g, '_');

      var apicSlug  = sanitiseIpForFilename(apicIp);
      var filename  = 'snapshot_' + ts + '_' + apicSlug + '.json';
      var outPath   = path.join(SNAPSHOT_DIR, filename);

      fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

      send({
        status:          'snapshot_saved',
        snapshot_saved:  filename,
        path:            outPath,
        commands:        commands,
        collectedNodes:  collectedNodes,
        nodeCount:       collectedNodes.length,
        proxy:           proxyYaml ? proxyYaml : 'none'
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

  runNext();

  req.on('close', function () {
    console.log('[commands] Client disconnected.');
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