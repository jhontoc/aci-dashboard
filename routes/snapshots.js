'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { exec } = require('child_process');
const multer   = require('multer');
const router   = express.Router();

const SNAPSHOT_DIR = path.join(__dirname, '../data/snapshots');
const UPLOAD_DIR   = path.join(__dirname, '../data/uploads');

// ── Ensure directories exist ─────────────────────────────────
[SNAPSHOT_DIR, UPLOAD_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Multer — accept only .tar files ─────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `upload_${Date.now()}_${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },   // 100 MB max
  fileFilter: (_req, file, cb) => {
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
//  GET /api/snapshots
//  Returns a list of all snapshot metadata (filename + summary)
// ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const files = fs
      .readdirSync(SNAPSHOT_DIR)
      .filter(f => f.endsWith('.json'))
      .map(filename => {
        const filePath = path.join(SNAPSHOT_DIR, filename);
        const stat     = fs.statSync(filePath);

        // Read just enough to extract metadata without loading full node data
        let meta = { command: 'unknown', timestamp: '', nodeCount: 0 };
        try {
          const raw  = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          meta.command   = raw.command   || 'unknown';
          meta.timestamp = raw.timestamp || '';
          meta.nodeCount = Object.keys(raw.nodes || {}).length;
        } catch { /* skip malformed files */ }

        return {
          filename,
          command:   meta.command,
          timestamp: meta.timestamp,
          nodeCount: meta.nodeCount,
          sizeBytes: stat.size,
          created:   stat.birthtime
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created)); // newest first

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: `Failed to list snapshots: ${err.message}` });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/snapshots/:filename
//  Load and return the full content of a single snapshot
// ────────────────────────────────────────────────────────────
router.get('/:filename', (req, res) => {
  const filename = req.params.filename;

  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  const filePath = path.join(SNAPSHOT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `Snapshot "${filename}" not found.` });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Failed to read snapshot: ${err.message}` });
  }
});

// ────────────────────────────────────────────────────────────
//  DELETE /api/snapshots/:filename
//  Remove a snapshot from disk
// ────────────────────────────────────────────────────────────
router.delete('/:filename', (req, res) => {
  const filename = req.params.filename;

  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  const filePath = path.join(SNAPSHOT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `Snapshot "${filename}" not found.` });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ success: true, deleted: filename });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete snapshot: ${err.message}` });
  }
});

// ────────────────────────────────────────────────────────────
//  POST /api/snapshots/export
//  Bundle one or more snapshots into a downloadable .tar file
// ────────────────────────────────────────────────────────────
router.post('/export', (req, res) => {
  const { files } = req.body;

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'Provide a non-empty "files" array.' });
  }

  // Validate each filename
  const invalid = files.filter(f => f.includes('..') || f.includes('/'));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Invalid filenames: ${invalid.join(', ')}` });
  }

  const missing = files.filter(f => !fs.existsSync(path.join(SNAPSHOT_DIR, f)));
  if (missing.length > 0) {
    return res.status(404).json({ error: `Files not found: ${missing.join(', ')}` });
  }

  const tarName = `aci_snapshots_${Date.now()}.tar`;
  const tarPath = path.join(UPLOAD_DIR, tarName);
  const fileList = files.map(f => `"${f}"`).join(' ');

  const cmd = `tar -cf "${tarPath}" -C "${SNAPSHOT_DIR}" ${fileList}`;

  exec(cmd, (err) => {
    if (err) {
      return res.status(500).json({ error: `tar creation failed: ${err.message}` });
    }

    res.download(tarPath, tarName, (downloadErr) => {
      // Clean up the temp tar after sending
      try { fs.unlinkSync(tarPath); } catch { /* ignore cleanup errors */ }
      if (downloadErr) {
        console.error('[EXPORT] Download error:', downloadErr.message);
      }
    });
  });
});

// ────────────────────────────────────────────────────────────
//  POST /api/snapshots/import
//  Accept a .tar upload and extract JSON snapshots into store
// ────────────────────────────────────────────────────────────
router.post('/import', upload.single('snapshotFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Field name must be "snapshotFile".' });
  }

  const uploadedPath = req.file.path;
  const cmd          = `tar -xf "${uploadedPath}" -C "${SNAPSHOT_DIR}"`;

  exec(cmd, (err) => {
    // Always clean up the uploaded tar
    try { fs.unlinkSync(uploadedPath); } catch { /* ignore */ }

    if (err) {
      return res.status(500).json({ error: `tar extraction failed: ${err.message}` });
    }

    // Return the list of newly available snapshots
    const snapshots = fs
      .readdirSync(SNAPSHOT_DIR)
      .filter(f => f.endsWith('.json'));

    res.json({
      success:   true,
      message:   'Snapshots imported successfully.',
      snapshots
    });
  });
});

// ────────────────────────────────────────────────────────────
//  Multer error handler
// ────────────────────────────────────────────────────────────
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError || err.message) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;