const express = require('express');
const router  = express.Router();

/**
 * POST /api/auth/validate
 *
 * Validates that the required credential fields are present and
 * stores them in the server-side session for script execution.
 * Credentials are NEVER written to disk.
 *
 * Body: { apicIp, username, password, nodeIds }
 */
router.post('/validate', (req, res) => {
  const { apicIp, username, password, nodeIds } = req.body;

  // ── Field presence check ────────────────────────────────
  if (!apicIp || !username || !password) {
    return res.status(400).json({
      success: false,
      error: 'apicIp, username, and password are all required.'
    });
  }

  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'nodeIds must be a non-empty array.'
    });
  }

  // ── Basic IP/hostname format check ──────────────────────
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!ipRegex.test(apicIp)) {
    return res.status(400).json({
      success: false,
      error: `"${apicIp}" does not appear to be a valid IP or hostname.`
    });
  }

  // ── Node ID validation ──────────────────────────────────
  const invalidNodes = nodeIds.filter(id => isNaN(Number(id)));
  if (invalidNodes.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Invalid node IDs: ${invalidNodes.join(', ')}`
    });
  }

  // ── Store in session (server-side, never written to disk) ──
  req.session.apicCredentials = {
    apicIp,
    username,
    password,   // held only in memory for session lifetime
    nodeIds
  };

  res.json({
    success:  true,
    message:  'Session credentials stored.',
    nodeCount: nodeIds.length
  });
});

/**
 * GET /api/auth/session
 * Returns sanitized session info (no password) for UI display.
 */
router.get('/session', (req, res) => {
  const creds = req.session.apicCredentials;
  if (!creds) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    apicIp:        creds.apicIp,
    username:      creds.username,
    nodeIds:       creds.nodeIds
  });
});

/**
 * POST /api/auth/logout
 * Destroys the current session and clears credentials from memory.
 */
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Failed to destroy session.' });
    }
    res.json({ success: true, message: 'Session cleared.' });
  });
});

module.exports = router;