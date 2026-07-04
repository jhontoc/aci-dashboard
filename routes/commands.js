'use strict';

const express = require('express');
const { spawn } = require('child_process');
const path    = require('path');
const router  = express.Router();

// ── Map command keys to Python script paths ──────────────────
const SCRIPT_MAP = {
  show_version:          path.join(__dirname, '../scripts/aci_show_version.py'),
  show_interface_status: path.join(__dirname, '../scripts/aci_show_interface_status.py')
};

// ────────────────────────────────────────────────────────────
//  POST /api/commands/run
//  Spawns Python scripts and streams output via SSE
// ────────────────────────────────────────────────────────────
router.post('/run', (req, res) => {
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

  // ── SSE Headers ───────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable Nginx buffering if proxied
  res.flushHeaders();

  // Helper — write one SSE event line
  function send(data) {
    const payload = typeof data === 'object' ? JSON.stringify(data) : data;
    res.write(`data: ${payload}\n\n`);
  }

  send({ status: 'started', commands, nodeCount: nodeIds.length });

  // ── Spawn one script per selected command ─────────────────
  const tasks = commands.map(cmd => new Promise((resolve) => {
    const scriptPath = SCRIPT_MAP[cmd];

    send({ status: 'spawning', command: cmd, script: path.basename(scriptPath) });

    const proc = spawn('python3', [
      scriptPath,
      '--apic',  apicIp,
      '--user',  username,
      '--pass',  password,
      '--nodes', nodeIds.join(',')
    ]);

    let stderrBuffer = '';

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        send(line.trim());
      });
    });

    proc.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    proc.on('close', (code) => {
      if (stderrBuffer.trim()) {
        send({ status: 'stderr', command: cmd, message: stderrBuffer.trim() });
      }
      send({ status: code === 0 ? 'command_done' : 'command_error', command: cmd, code });
      resolve({ cmd, code });
    });

    proc.on('error', (err) => {
      send({ status: 'spawn_error', command: cmd, message: err.message });
      resolve({ cmd, code: -1 });
    });
  }));

  // ── Wait for all and finalize ─────────────────────────────
  Promise.all(tasks).then((results) => {
    const allOk = results.every(r => r.code === 0);
    send({ status: allOk ? 'all_complete' : 'completed_with_errors', results });
    // SSE termination sentinel
    res.write('data: [ALL_COMPLETE]\n\n');
    res.end();
  });

  // ── Handle client disconnect ──────────────────────────────
  req.on('close', () => {
    console.log('[commands] Client disconnected — stream closed.');
  });
});

// ────────────────────────────────────────────────────────────
//  GET /api/commands/list
//  Returns available commands and their descriptions
// ────────────────────────────────────────────────────────────
router.get('/list', (_req, res) => {
  res.json([
    {
      key:         'show_version',
      label:       'show version',
      description: 'Firmware version, model, serial number, and uptime per node.',
      apicClass:   'topology/node/sys'
    },
    {
      key:         'show_interface_status',
      label:       'show interface status',
      description: 'Physical interface states, speed, media type, and operational status.',
      apicClass:   'l1PhysIf'
    }
  ]);
});

module.exports = router;