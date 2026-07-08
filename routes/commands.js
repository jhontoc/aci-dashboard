'use strict';

const express  = require('express');
const { spawn } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const router   = express.Router();

const SNAPSHOT_DIR = path.join(__dirname, '../data/snapshots');

// ── Script map ───────────────────────────────────────────────
const SCRIPT_MAP = {
  show_version:          path.join(__dirname, '../scripts/aci_show_version.py'),
  show_interface_status: path.join(__dirname, '../scripts/aci_show_interface_status.py')
};

// ────────────────────────────────────────────────────────────
//  Helper — run one Python script, collect full stdout
//  Returns: { stdoutBuf, stderrBuf, code }
// ────────────────────────────────────────────────────────────
function runScript(
  scriptPath,
  apicIp,
  username,
  password,
  nodeIds,
  apiPort   = '443',
  proxyYaml = null
) {
  return new Promise((resolve, reject) => {

    // ── Build argument list ─────────────────────────────────
    const args = [
      scriptPath,
      '--apic',  apicIp,
      '--user',  username,
      '--pass',  password,
      '--nodes', nodeIds.join(','),
      '--port',  apiPort
    ];

    // Only append --proxy when a path was provided
    if (proxyYaml) {
      args.push('--proxy', proxyYaml);
    }

    const proc = spawn('python3', args);

    let stdoutBuf = '';
    let stderrBuf = '';

    proc.stdout.on('data', chunk => { stdoutBuf += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });

    proc.on('close', code => {
      resolve({ stdoutBuf, stderrBuf, code });
    });

    proc.on('error', err => reject(err));
  });
}

// ────────────────────────────────────────────────────────────
//  POST /api/commands/run
//
//  Expected request body:
//  {
//    apicIp:    "10.0.0.1",
//    username:  "admin",
//    password:  "****",
//    nodeIds:   ["101", "102"],
//    commands:  ["show_version", "show_interface_status"],
//    apiPort:   "443",               // optional — default "443"
//    proxyYaml: "/app/config/..."    // optional — null = direct
//  }
//
//  Streams progress via Server-Sent Events (SSE).
//  Saves ONE unified snapshot file containing all
//  selected commands for all nodes.
// ────────────────────────────────────────────────────────────
router.post('/run', async (req, res) => {
  const {
    apicIp,
    username,
    password,
    nodeIds,
    commands,
    apiPort   = '443',
    proxyYaml = null
  } = req.body;

  // ── Input validation ──────────────────────────────────────
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

  const invalidCmds = commands.filter(c => !SCRIPT_MAP[c]);
  if (invalidCmds.length > 0) {
    return res.status(400).json({
      error: `Unknown commands: ${invalidCmds.join(', ')}`
    });
  }

  // Validate proxyYaml path exists inside container if provided
  if (proxyYaml && !fs.existsSync(proxyYaml)) {
    return res.status(400).json({
      error: `Proxy YAML file not found at path: ${proxyYaml}`
    });
  }

  // ── SSE headers ───────────────────────────────────────────
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable Nginx buffering
  res.flushHeaders();

  // ── SSE send helper ───────────────────────────────────────
  function send(data) {
    const payload = typeof data === 'object'
      ? JSON.stringify(data)
      : String(data);
    res.write(`data: ${payload}\n\n`);
  }

  // ── Log proxy info to stream if configured ────────────────
  send({
    status:     'started',
    commands,
    nodeCount:  nodeIds.length,
    apiPort,
    proxy:      proxyYaml
      ? `YAML: ${proxyYaml}`
      : 'None (direct connection)'
  });

  // ── Unified snapshot — built across all commands ──────────
  const now      = new Date();
  const snapshot = {
    timestamp: now.toISOString(),
    commands,                         // all selected command keys
    apic:      apicIp,
    apiPort,
    proxy:     proxyYaml || null,
    nodes:     {}                     // { nodeId: { cmdKey: data } }
  };

  // Pre-populate every node key so structure is consistent
  // even if a command fails for a specific node
  nodeIds.forEach(id => {
    snapshot.nodes[id] = {};
  });

  // ── Run each selected command sequentially ────────────────
  for (const cmd of commands) {

    send({
      status:  'spawning',
      command: cmd,
      script:  path.basename(SCRIPT_MAP[cmd])
    });

    try {
      const { stdoutBuf, stderrBuf, code } = await runScript(
        SCRIPT_MAP[cmd],
        apicIp,
        username,
        password,
        nodeIds,
        apiPort,
        proxyYaml
      );

      // ── Forward stderr lines to SSE stream ───────────────
      if (stderrBuf.trim()) {
        stderrBuf
          .split('\n')
          .filter(Boolean)
          .forEach(line => {
            send({ status: 'stderr', command: cmd, message: line.trim() });
          });
      }

      // ── Parse stdout — one JSON line at a time ────────────
      const lines = stdoutBuf.split('\n').filter(Boolean);

      for (const line of lines) {
        const trimmed = line.trim();

        // Forward every line to the SSE stream for terminal display
        send(trimmed);

        // Try to parse as JSON to extract node data
        try {
          const parsed = JSON.parse(trimmed);

          // Line shape from Python scripts:
          // { "node": "101", "data": { ...commandData } }
          if (parsed.node && parsed.data) {

            // Merge into unified snapshot under correct node + cmd key
            snapshot.nodes[parsed.node][cmd] = parsed.data;

          }
        } catch {
          // Non-JSON progress lines (e.g. [AUTH] messages) — already
          // forwarded to SSE above, nothing else needed here
        }
      }

      // ── Report command completion ─────────────────────────
      send({
        status:  code === 0 ? 'command_done' : 'command_error',
        command: cmd,
        code
      });

    } catch (spawnErr) {
      // Script failed to spawn entirely (e.g. python3 not found)
      send({
        status:  'spawn_error',
        command: cmd,
        message: spawnErr.message
      });
    }
  }

  // ── Save unified snapshot to disk ────────────────────────
  try {
    // Ensure snapshot directory exists
    if (!fs.existsSync(SNAPSHOT_DIR)) {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }

    // Build filename — timestamp + all command keys
    const ts      = now.toISOString()
      .replace(/:/g, '_')   // colons not valid in filenames
      .replace(/\./g, '_'); // replace dot in milliseconds

    const cmdSlug  = commands.join('__');
    const filename = `snapshot_${ts}__${cmdSlug}.json`;
    const outPath  = path.join(SNAPSHOT_DIR, filename);

    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

    send({
      status:         'snapshot_saved',
      snapshot_saved: filename,
      path:           outPath,
      commands,
      nodeCount:      nodeIds.length
    });

    // SSE termination sentinel — frontend listens for this
    res.write('data: [ALL_COMPLETE]\n\n');

  } catch (saveErr) {
    send({
      status:  'save_error',
      message: `Failed to save snapshot: ${saveErr.message}`
    });
    res.write('data: [ALL_COMPLETE]\n\n');
  }

  res.end();

  // ── Handle early client disconnect ────────────────────────
  req.on('close', () => {
    console.log('[commands] Client disconnected — SSE stream closed.');
  });
});

// ────────────────────────────────────────────────────────────
//  GET /api/commands/list
//  Returns available commands and their metadata
// ────────────────────────────────────────────────────────────
router.get('/list', (_req, res) => {
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