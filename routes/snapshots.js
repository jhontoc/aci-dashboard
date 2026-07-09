'use strict';

var express  = require('express');
var fs       = require('fs');
var path     = require('path');
var exec     = require('child_process').exec;
var multer   = require('multer');
var router   = express.Router();

var SNAPSHOT_DIR = path.join(__dirname, '../data/snapshots');
var UPLOAD_DIR   = path.join(__dirname, '../data/uploads');

// ── Ensure directories exist ─────────────────────────────────
[SNAPSHOT_DIR, UPLOAD_DIR].forEach(function (dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Multer — accept only .tar files ──────────────────────────
var storage = multer.diskStorage({
  destination: function (_req, _file, cb) { cb(null, UPLOAD_DIR); },
  filename:    function (_req, file, cb) {
    var safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, 'upload_' + Date.now() + '_' + safe);
  }
});

var upload = multer({
  storage: storage,
  limits:  { fileSize: 100 * 1024 * 1024 },
  fileFilter: function (_req, file, cb) {
    if (
      file.mimetype === 'application/x-tar' ||
      file.originalname.endsWith('.tar')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .tar files are accepted for import.'));
    }
  }
});

// ────────────────────────────────────────────────────────────
//  Helper — resolve commands from a raw snapshot object
//
//  Handles all possible shapes:
//    { commands: ["show_version", "show_interface_status"] }  ← unified
//    { command:  "show_version" }                             ← legacy
//    filename: snapshot_...Z__show_version.json               ← old naming
// ────────────────────────────────────────────────────────────
function resolveCommands(raw, filename) {
  // Priority 1 — plural array (current unified format)
  if (Array.isArray(raw.commands) && raw.commands.length > 0) {
    return raw.commands;
  }

  // Priority 2 — singular string (legacy format)
  if (raw.command && typeof raw.command === 'string') {
    return [raw.command];
  }

  // Priority 3 — parse from filename
  // Old format: snapshot_2026-07-08T17_49_34_068Z__show_version.json
  // New format: snapshot_2026-07-08T17_49_34_068Z.json (no command in name)
  if (filename) {
    var base  = filename.replace('.json', '');
    var parts = base.split('__');
    if (parts.length > 1) {
      // Remove the first element (snapshot_timestamp)
      parts.shift();
      // Filter out empty strings
      var cmds = parts.filter(function (p) { return p.trim() !== ''; });
      if (cmds.length > 0) return cmds;
    }
  }

  // Priority 4 — infer from node data keys
  // If nodes: { "131": { "show_version": {...} } }
  var nodeKeys = Object.keys(raw.nodes || {});
  if (nodeKeys.length > 0) {
    var firstNode = raw.nodes[nodeKeys[0]];
    if (firstNode && typeof firstNode === 'object') {
      var dataKeys = Object.keys(firstNode);
      // Check if keys look like command names
      var knownCmds = ['show_version', 'show_interface_status'];
      var found = dataKeys.filter(function (k) {
        return knownCmds.indexOf(k) !== -1;
      });
      if (found.length > 0) return found;
    }
  }

  return [];
}

// ────────────────────────────────────────────────────────────
//  GET /api/snapshots
//  Returns array of snapshot metadata objects — newest first
// ────────────────────────────────────────────────────────────
router.get('/', function (req, res) {
  try {
    var files = fs
      .readdirSync(SNAPSHOT_DIR)
      .filter(function (f) { return f.endsWith('.json'); })
      .map(function (filename) {
        var filePath = path.join(SNAPSHOT_DIR, filename);
        var stat     = fs.statSync(filePath);

        var commands  = [];
        var timestamp = '';
        var nodeCount = 0;

        try {
          var raw  = JSON.parse(fs.readFileSync(filePath, 'utf8'));

          // ── Resolve commands using all fallback strategies ──
          commands  = resolveCommands(raw, filename);
          timestamp = raw.timestamp || '';
          nodeCount = Object.keys(raw.nodes || {}).length;

        } catch (parseErr) {
          // Malformed JSON — skip silently
          console.warn('[snapshots] Could not parse:', filename, parseErr.message);
        }

        return {
          filename:  filename,
          commands:  commands,      // always an array
          timestamp: timestamp,
          nodeCount: nodeCount,
          sizeBytes: stat.size,
          created:   stat.birthtime.toISOString()
        };
      })
      .sort(function (a, b) {
        return new Date(b.created) - new Date(a.created);
      });

    res.json(files);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to list snapshots: ' + err.message
    });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/snapshots/:filename
//  Load and return the full content of one snapshot
// ────────────────────────────────────────────────────────────
router.get('/:filename', function (req, res) {
  var filename = req.params.filename;

  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  var filePath = path.join(SNAPSHOT_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'Snapshot "' + filename + '" not found.'
    });
  }

  try {
    var raw  = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // ── Normalise commands field before returning ───────────
    // Ensures compare.html always gets a commands array
    // regardless of the snapshot format on disk
    if (!Array.isArray(raw.commands) || raw.commands.length === 0) {
      raw.commands = resolveCommands(raw, filename);
    }

    res.json(raw);

  } catch (err) {
    res.status(500).json({
      error: 'Failed to read snapshot: ' + err.message
    });
  }
});

// ────────────────────────────────────────────────────────────
//  DELETE /api/snapshots/:filename
// ────────────────────────────────────────────────────────────
router.delete('/:filename', function (req, res) {
  var filename = req.params.filename;

  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  var filePath = path.join(SNAPSHOT_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'Snapshot "' + filename + '" not found.'
    });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, deleted: filename });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to delete snapshot: ' + err.message
    });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/snapshots/export
//  Bundle selected snapshots into a downloadable .tar file
// ────────────────────────────────────────────────────────────
router.post('/export', function (req, res) {
  var files = req.body.files;

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      error: 'Provide a non-empty "files" array.'
    });
  }

  // Validate filenames
  var invalid = files.filter(function (f) {
    return f.includes('..') || f.includes('/');
  });
  if (invalid.length > 0) {
    return res.status(400).json({
      error: 'Invalid filenames: ' + invalid.join(', ')
    });
  }

  var missing = files.filter(function (f) {
    return !fs.existsSync(path.join(SNAPSHOT_DIR, f));
  });
  if (missing.length > 0) {
    return res.status(404).json({
      error: 'Files not found: ' + missing.join(', ')
    });
  }

  var tarName  = 'aci_snapshots_' + Date.now() + '.tar';
  var tarPath  = path.join(UPLOAD_DIR, tarName);
  var fileList = files.map(function (f) {
    return '"' + f + '"';
  }).join(' ');

  var cmd = 'tar -cf "' + tarPath + '" -C "' + SNAPSHOT_DIR + '" ' + fileList;

  exec(cmd, function (err) {
    if (err) {
      return res.status(500).json({
        error: 'tar creation failed: ' + err.message
      });
    }

    res.download(tarPath, tarName, function (downloadErr) {
      try { fs.unlinkSync(tarPath); } catch (e) { /* ignore */ }
      if (downloadErr) {
        console.error('[snapshots] Download error:', downloadErr.message);
      }
    });
  });
});

// ────────────────────────────────────────────────────────────
//  POST /api/snapshots/import
//  Extract an uploaded .tar into the snapshot store
// ────────────────────────────────────────────────────────────
router.post('/import', upload.single('snapshotFile'), function (req, res) {
  if (!req.file) {
    return res.status(400).json({
      error: 'No file uploaded. Field name must be "snapshotFile".'
    });
  }

  var uploadedPath = req.file.path;
  var cmd          = 'tar -xf "' + uploadedPath + '" -C "' + SNAPSHOT_DIR + '"';

  exec(cmd, function (err) {
    try { fs.unlinkSync(uploadedPath); } catch (e) { /* ignore */ }

    if (err) {
      return res.status(500).json({
        error: 'tar extraction failed: ' + err.message
      });
    }

    var snapshots = fs
      .readdirSync(SNAPSHOT_DIR)
      .filter(function (f) { return f.endsWith('.json'); });

    res.json({
      success:   true,
      message:   'Snapshots imported successfully.',
      snapshots: snapshots
    });
  });
});

// ── Multer error handler ──────────────────────────────────────
router.use(function (err, _req, res, _next) {
  if (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;