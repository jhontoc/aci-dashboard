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
//  Helper — run one python script, collect full stdout JSON
//  Returns: { [nodeId]: { ...commandData } }
// ────────────────────────────────────────────────────────────
function runScript(scriptPath, apicIp, username, password, nodeIds) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [
      scriptPath,
      '--apic',  apicIp,
      '--user',  username,
      '--pass',  password,
      '--nodes', nodeIds.join(',')
    ]);

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
//  Streams progress via SSE, saves ONE unified snapshot
// ────────────────────────────────────────────────────────────
router.post('/run', async (req, res) => {
  const { apicIp, username, password, nodeIds, commands } = req.body;

  // ── Validation ────────────────────────────────────────────
  if (!apicIp || !username || !password) {
    return res.status(400).json({ error: 'apicIp, username, and password are required.' });
  }
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    return res.status(400).json({ error: 'nodeIds must be a non-empty array.' });
  }
  if (!Array.isArray(commands) || commands.length === 0) {
    return res.status(400).json({ error: 'commands must be a non-empty array.' });
  }

  const invalidCmds = commands.filter(c => !SCRIPT_MAP[c]);
  if (invalidCmds.length > 0) {
    return res.status(400).json({ error: `Unknown commands: ${invalidCmds.join(', ')}` });
  }

  // ── SSE setup ─────────────────────────────────────────────
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function send(data) {
    const payload = typeof data === 'object' ? JSON.stringify(data) : data;
    res.write(`data: ${payload}\n\n`);
  }

  // ── Unified snapshot structure ────────────────────────────
  const now      = new Date();
  const snapshot = {
    timestamp: now.toISOString(),
    commands,                     // all selected commands
    apic: apicIp,
    nodes: {}                     // { [nodeId]: { [command]: data } }
  };

  // Pre-populate node keys
  nodeIds.forEach(id => { snapshot.nodes[id] = {}; });

  send({ status: 'started', commands, nodeCount: nodeIds.length });

  // ── Run each command script sequentially ──────────────────
  for (const cmd of commands) {
    send({ status: 'spawning', command: cmd });

    try {
      const { stdoutBuf, stderrBuf, code } = await runScript(
        SCRIPT_MAP[cmd], apicIp, username, password, nodeIds
      );

      if (stderrBuf.trim()) {
        send({ status: 'stderr', command: cmd, message: stderrBuf.trim() });
      }

      // Parse each stdout line as JSON and merge into snapshot
      const lines = stdoutBuf.split('\n').filter(Boolean);
      for (const line of lines) {
        send(line.trim()); // stream raw progress to UI

        try {
          const parsed = JSON.parse(line.trim());

          // Individual node collection result
          if (parsed.node && parsed.data) {
            snapshot.nodes[parsed.node][cmd] = parsed.data;
          }
        } catch { /* progress lines that aren't JSON */ }
      }

      send({ status: code === 0 ? 'command_done' : 'command_error', command: cmd, code });

    } catch (err) {
      send({ status: 'spawn_error', command: cmd, message: err.message });
    }
  }

  // ── Save unified snapshot to disk ─────────────────────────
  try {
    if (!fs.existsSync(SNAPSHOT_DIR)) {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }

    const ts       = now.toISOString().replace(/[:.]/g, '_').replace('Z', 'Z');
    const cmdSlug  = commands.join('_');
    const filename = `snapshot_${ts}__${cmdSlug}.json`;
    const outPath  = path.join(SNAPSHOT_DIR, filename);

    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

    send({ status: 'snapshot_saved', snapshot_saved: filename });
    send('[ALL_COMPLETE]');

  } catch (err) {
    send({ status: 'save_error', message: err.message });
  }

  res.end();

  req.on('close', () => {
    console.log('[commands] Client disconnected.');
  });
});

// ────────────────────────────────────────────────────────────
//  GET /api/commands/list
// ────────────────────────────────────────────────────────────
router.get('/list', (_req, res) => {
  res.json([
    {
      key:         'show_version',
      label:       'show version',
      description: 'Firmware version, model, serial number, uptime per node.',
      apicClass:   'topology/node/sys'
    },
    {
      key:         'show_interface_status',
      label:       'show interface status',
      description: 'Physical interface states, speed, media type per node.',
      apicClass:   'l1PhysIf'
    }
  ]);
});

module.exports = router;