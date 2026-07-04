const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const SNAPSHOT_DIR = path.join(__dirname, '../data/snapshots');

/**
 * Recursively flatten a nested object to dot-notation key-value pairs.
 */
function flatten(obj, prefix = '') {
  const result = {};
  for (const [key, val] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flatten(val, fullKey));
    } else {
      result[fullKey] = Array.isArray(val) ? JSON.stringify(val) : String(val ?? '');
    }
  }
  return result;
}

/**
 * Build a diff map between two flattened objects.
 */
function buildDiff(leftFlat, rightFlat) {
  const allKeys = new Set([
    ...Object.keys(leftFlat),
    ...Object.keys(rightFlat)
  ]);
  const diff = {};

  for (const key of allKeys) {
    const lv = leftFlat[key];
    const rv = rightFlat[key];

    if      (lv === undefined) diff[key] = { status: 'added',   left: null, right: rv };
    else if (rv === undefined) diff[key] = { status: 'removed',  left: lv,  right: null };
    else if (lv !== rv)        diff[key] = { status: 'changed',  left: lv,  right: rv };
    else                       diff[key] = { status: 'match',    left: lv,  right: rv };
  }
  return diff;
}

/**
 * POST /api/compare
 * Body: { leftFile, rightFile, nodeId }
 * Returns: diff object + statistics
 */
router.post('/', (req, res) => {
  const { leftFile, rightFile, nodeId } = req.body;

  if (!leftFile || !rightFile || !nodeId) {
    return res.status(400).json({ error: 'leftFile, rightFile, and nodeId are required.' });
  }

  const leftPath  = path.join(SNAPSHOT_DIR, leftFile);
  const rightPath = path.join(SNAPSHOT_DIR, rightFile);

  if (!fs.existsSync(leftPath)) {
    return res.status(404).json({ error: `Snapshot not found: ${leftFile}` });
  }
  if (!fs.existsSync(rightPath)) {
    return res.status(404).json({ error: `Snapshot not found: ${rightFile}` });
  }

  let leftSnap, rightSnap;
  try {
    leftSnap  = JSON.parse(fs.readFileSync(leftPath,  'utf8'));
    rightSnap = JSON.parse(fs.readFileSync(rightPath, 'utf8'));
  } catch (err) {
    return res.status(500).json({ error: `Failed to parse snapshots: ${err.message}` });
  }

  const leftNodeData  = leftSnap.nodes?.[nodeId]  ?? {};
  const rightNodeData = rightSnap.nodes?.[nodeId] ?? {};

  const leftFlat  = flatten(leftNodeData);
  const rightFlat = flatten(rightNodeData);
  const diff      = buildDiff(leftFlat, rightFlat);

  // Compute statistics
  const stats = { changed: 0, added: 0, removed: 0, matching: 0 };
  for (const entry of Object.values(diff)) {
    stats[entry.status === 'match' ? 'matching' : entry.status]++;
  }

  res.json({
    nodeId,
    leftFile,
    rightFile,
    stats,
    diff
  });
});

/**
 * GET /api/compare/nodes/:filename
 * Returns list of node IDs present in a snapshot file.
 */
router.get('/nodes/:filename', (req, res) => {
  const filePath = path.join(SNAPSHOT_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Snapshot not found.' });
  }
  const snap  = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const nodes = Object.keys(snap.nodes || {});
  res.json({ nodes, command: snap.command, timestamp: snap.timestamp });
});

module.exports = router;