'use strict';

var express = require('express');
var fs      = require('fs');
var path    = require('path');
var router  = express.Router();

var SNAPSHOT_DIR = path.join(__dirname, '../data/snapshots');

// ────────────────────────────────────────────────────────────
//  Helper — safe snapshot file read
//  Returns parsed JSON or throws with a clear message
// ────────────────────────────────────────────────────────────
function readSnapshot(filename) {
  // Prevent path traversal attacks
  if (filename.includes('..') || filename.includes('/')) {
    throw new Error('Invalid filename: ' + filename);
  }

  var filePath = path.join(SNAPSHOT_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error('Snapshot not found: ' + filename);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (parseErr) {
    throw new Error('Failed to parse snapshot "' + filename + '": ' + parseErr.message);
  }
}

// ────────────────────────────────────────────────────────────
//  Helper — flatten nested object to dot-notation key-value
//
//  Node.js 10 compatible — no ?? or ?. operators used.
//
//  Example:
//    { a: { b: 1 }, c: [1,2] }
//    → { "a.b": "1", "c": "[1,2]" }
// ────────────────────────────────────────────────────────────
function flatten(obj, prefix) {
  prefix = prefix || '';
  var result  = {};
  var entries = Object.entries(obj || {});

  for (var i = 0; i < entries.length; i++) {
    var key     = entries[i][0];
    var val     = entries[i][1];
    var fullKey = prefix ? prefix + '.' + key : key;

    if (
      val !== null &&
      val !== undefined &&
      typeof val === 'object' &&
      !Array.isArray(val)
    ) {
      // Recurse into nested object
      var nested     = flatten(val, fullKey);
      var nestedKeys = Object.keys(nested);
      for (var j = 0; j < nestedKeys.length; j++) {
        result[nestedKeys[j]] = nested[nestedKeys[j]];
      }
    } else {
      // Node.js 10 fix — explicit null/undefined check instead of ??
      var safeVal = (val !== null && val !== undefined) ? val : '';
      result[fullKey] = Array.isArray(val)
        ? JSON.stringify(val)
        : String(safeVal);
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────
//  Helper — build diff map between two flattened objects
//
//  Returns:
//  {
//    diff: {
//      "key.path": {
//        status: "changed" | "added" | "removed" | "match",
//        left:   <value or null>,
//        right:  <value or null>
//      }
//    },
//    stats: { changed, added, removed, matching }
//  }
// ────────────────────────────────────────────────────────────
function buildDiff(leftFlat, rightFlat) {
  // Merge all keys from both sides
  var allKeysMap = {};
  var leftKeys   = Object.keys(leftFlat);
  var rightKeys  = Object.keys(rightFlat);

  for (var li = 0; li < leftKeys.length; li++) {
    allKeysMap[leftKeys[li]] = true;
  }
  for (var ri = 0; ri < rightKeys.length; ri++) {
    allKeysMap[rightKeys[ri]] = true;
  }

  var allKeys = Object.keys(allKeysMap);
  var diff    = {};
  var stats   = { changed: 0, added: 0, removed: 0, matching: 0 };

  for (var i = 0; i < allKeys.length; i++) {
    var key = allKeys[i];
    var lv  = leftFlat[key];
    var rv  = rightFlat[key];

    if (lv === undefined) {
      diff[key] = { status: 'added',   left: null, right: rv };
      stats.added++;
    } else if (rv === undefined) {
      diff[key] = { status: 'removed', left: lv,   right: null };
      stats.removed++;
    } else if (lv !== rv) {
      diff[key] = { status: 'changed', left: lv,   right: rv };
      stats.changed++;
    } else {
      diff[key] = { status: 'match',   left: lv,   right: rv };
      stats.matching++;
    }
  }

  return { diff: diff, stats: stats };
}

// ────────────────────────────────────────────────────────────
//  Helper — diff a single command's data for one node
//
//  Handles both:
//    Unified format:  nodeData = { show_version: {...}, show_interface_status: {...} }
//    Legacy format:   nodeData = { nodeId, state, version, ... }  (flat)
// ────────────────────────────────────────────────────────────
function diffCommandForNode(cmdKey, leftNodeData, rightNodeData) {
  // Extract command-specific data if using unified snapshot format
  var leftData  = null;
  var rightData = null;

  if (leftNodeData !== null && leftNodeData !== undefined) {
    leftData = (leftNodeData[cmdKey] !== undefined && leftNodeData[cmdKey] !== null)
      ? leftNodeData[cmdKey]
      : leftNodeData;
  }

  if (rightNodeData !== null && rightNodeData !== undefined) {
    rightData = (rightNodeData[cmdKey] !== undefined && rightNodeData[cmdKey] !== null)
      ? rightNodeData[cmdKey]
      : rightNodeData;
  }

  var leftFlat  = leftData  ? flatten(leftData)  : {};
  var rightFlat = rightData ? flatten(rightData)  : {};

  return buildDiff(leftFlat, rightFlat);
}

// ────────────────────────────────────────────────────────────
//  POST /api/compare
//
//  Compare two snapshot files for a specific node.
//  Supports multi-command unified snapshots.
//
//  Request body:
//  {
//    leftFile:  "snapshot_...json",
//    rightFile: "snapshot_...json",
//    nodeId:    "101",
//    command:   "show_version"   // optional — if omitted, diffs all commands
//  }
//
//  Response:
//  {
//    nodeId:    "101",
//    leftFile:  "...",
//    rightFile: "...",
//    commands:  ["show_version", "show_interface_status"],
//    results: {
//      show_version: {
//        stats: { changed, added, removed, matching },
//        diff:  { "key": { status, left, right } }
//      },
//      ...
//    },
//    totals: { changed, added, removed, matching }
//  }
// ────────────────────────────────────────────────────────────
router.post('/', function (req, res) {
  var leftFile  = req.body.leftFile;
  var rightFile = req.body.rightFile;
  var nodeId    = req.body.nodeId;
  var cmdFilter = req.body.command || null;   // optional single command filter

  // ── Validation ────────────────────────────────────────────
  if (!leftFile || !rightFile || !nodeId) {
    return res.status(400).json({
      error: 'leftFile, rightFile, and nodeId are all required.'
    });
  }

  // ── Read both snapshots ───────────────────────────────────
  var leftSnap  = null;
  var rightSnap = null;

  try {
    leftSnap  = readSnapshot(leftFile);
  } catch (err) {
    return res.status(err.message.includes('not found') ? 404 : 400).json({
      error: err.message
    });
  }

  try {
    rightSnap = readSnapshot(rightFile);
  } catch (err) {
    return res.status(err.message.includes('not found') ? 404 : 400).json({
      error: err.message
    });
  }

  // ── Extract node data from both snapshots ─────────────────
  var leftNodeData  = (leftSnap.nodes  && leftSnap.nodes[nodeId])
    ? leftSnap.nodes[nodeId]
    : null;

  var rightNodeData = (rightSnap.nodes && rightSnap.nodes[nodeId])
    ? rightSnap.nodes[nodeId]
    : null;

  if (!leftNodeData && !rightNodeData) {
    return res.status(404).json({
      error: 'Node "' + nodeId + '" not found in either snapshot.'
    });
  }

  // ── Resolve command list ──────────────────────────────────
  //    Priority: cmdFilter > leftSnap.commands > rightSnap.commands > keys
  var allCommands = [];

  if (cmdFilter) {
    allCommands = [cmdFilter];
  } else if (leftSnap.commands && leftSnap.commands.length > 0) {
    allCommands = leftSnap.commands;
  } else if (rightSnap.commands && rightSnap.commands.length > 0) {
    allCommands = rightSnap.commands;
  } else if (leftSnap.command) {
    allCommands = [leftSnap.command];
  } else if (rightSnap.command) {
    allCommands = [rightSnap.command];
  } else {
    // Fallback — use keys of node data as command identifiers
    var keyMap = {};
    if (leftNodeData) {
      var lk = Object.keys(leftNodeData);
      for (var i = 0; i < lk.length; i++) keyMap[lk[i]] = true;
    }
    if (rightNodeData) {
      var rk = Object.keys(rightNodeData);
      for (var j = 0; j < rk.length; j++) keyMap[rk[j]] = true;
    }
    allCommands = Object.keys(keyMap);
  }

  // ── Run diff per command ──────────────────────────────────
  var results = {};
  var totals  = { changed: 0, added: 0, removed: 0, matching: 0 };

  for (var ci = 0; ci < allCommands.length; ci++) {
    var cmd    = allCommands[ci];
    var result = diffCommandForNode(cmd, leftNodeData, rightNodeData);

    results[cmd] = {
      stats: result.stats,
      diff:  result.diff
    };

    totals.changed  += result.stats.changed;
    totals.added    += result.stats.added;
    totals.removed  += result.stats.removed;
    totals.matching += result.stats.matching;
  }

  // ── Send response ─────────────────────────────────────────
  res.json({
    nodeId:    nodeId,
    leftFile:  leftFile,
    rightFile: rightFile,
    leftTs:    leftSnap.timestamp  || null,
    rightTs:   rightSnap.timestamp || null,
    commands:  allCommands,
    results:   results,
    totals:    totals
  });
});

// ────────────────────────────────────────────────────────────
//  GET /api/compare/nodes/:filename
//
//  Returns the list of node IDs present in a snapshot,
//  along with its command list and timestamp.
//  Used by the frontend to populate the node nav bar.
//
//  Response:
//  {
//    filename:  "snapshot_...json",
//    nodes:     ["101", "102", "103"],
//    commands:  ["show_version", "show_interface_status"],
//    timestamp: "2024-01-15T10:30:00.000Z"
//  }
// ────────────────────────────────────────────────────────────
router.get('/nodes/:filename', function (req, res) {
  var snap = null;

  try {
    snap = readSnapshot(req.params.filename);
  } catch (err) {
    return res.status(err.message.includes('not found') ? 404 : 400).json({
      error: err.message
    });
  }

  var nodes = Object.keys(snap.nodes || {});

  // Resolve command list from snapshot metadata
  var commands = [];
  if (snap.commands && snap.commands.length > 0) {
    commands = snap.commands;
  } else if (snap.command) {
    commands = [snap.command];
  }

  res.json({
    filename:  req.params.filename,
    nodes:     nodes,
    commands:  commands,
    timestamp: snap.timestamp || null,
    apic:      snap.apic      || null
  });
});

// ────────────────────────────────────────────────────────────
//  GET /api/compare/summary/:filename
//
//  Returns a lightweight summary of all nodes and all
//  commands in a snapshot — no diff data, just structure.
//  Useful for the Load Snapshot modal preview.
//
//  Response:
//  {
//    filename:  "...",
//    timestamp: "...",
//    commands:  ["show_version"],
//    nodeCount: 3,
//    nodes: {
//      "101": ["show_version", "show_interface_status"],
//      "102": ["show_version", "show_interface_status"]
//    }
//  }
// ────────────────────────────────────────────────────────────
router.get('/summary/:filename', function (req, res) {
  var snap = null;

  try {
    snap = readSnapshot(req.params.filename);
  } catch (err) {
    return res.status(err.message.includes('not found') ? 404 : 400).json({
      error: err.message
    });
  }

  var nodeIds     = Object.keys(snap.nodes || {});
  var nodeSummary = {};

  for (var i = 0; i < nodeIds.length; i++) {
    var nid      = nodeIds[i];
    var nodeData = snap.nodes[nid];
    nodeSummary[nid] = nodeData ? Object.keys(nodeData) : [];
  }

  // Resolve command list
  var commands = [];
  if (snap.commands && snap.commands.length > 0) {
    commands = snap.commands;
  } else if (snap.command) {
    commands = [snap.command];
  }

  res.json({
    filename:  req.params.filename,
    timestamp: snap.timestamp || null,
    apic:      snap.apic      || null,
    commands:  commands,
    nodeCount: nodeIds.length,
    nodes:     nodeSummary
  });
});

// ────────────────────────────────────────────────────────────
//  GET /api/compare/diff-stats/:filename
//
//  Returns diff statistics for every node in a snapshot
//  compared against itself — used to validate snapshot
//  integrity and confirm data was collected correctly.
//
//  Response:
//  {
//    filename: "...",
//    nodes: {
//      "101": { keyCount: 42, commands: ["show_version"] },
//      "102": { keyCount: 38, commands: ["show_version"] }
//    }
//  }
// ────────────────────────────────────────────────────────────
router.get('/diff-stats/:filename', function (req, res) {
  var snap = null;

  try {
    snap = readSnapshot(req.params.filename);
  } catch (err) {
    return res.status(err.message.includes('not found') ? 404 : 400).json({
      error: err.message
    });
  }

  var nodeIds    = Object.keys(snap.nodes || {});
  var nodeCounts = {};

  for (var i = 0; i < nodeIds.length; i++) {
    var nid      = nodeIds[i];
    var nodeData = snap.nodes[nid] || {};
    var cmdKeys  = Object.keys(nodeData);
    var keyCount = 0;

    for (var ci = 0; ci < cmdKeys.length; ci++) {
      var cmdData  = nodeData[cmdKeys[ci]];
      var flatData = flatten(cmdData || {});
      keyCount    += Object.keys(flatData).length;
    }

    nodeCounts[nid] = {
      keyCount: keyCount,
      commands: cmdKeys
    };
  }

  res.json({
    filename: req.params.filename,
    nodes:    nodeCounts
  });
});

module.exports = router;