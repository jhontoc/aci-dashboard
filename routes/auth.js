'use strict';

var express = require('express');
var router  = express.Router();
var path    = require('path');
var spawn   = require('child_process').spawn;
var fs      = require('fs');

// ────────────────────────────────────────────────────────────
//  In-memory refresh store
//  { sessionId: { timer, apicIp, username, password,
//                 proxyYaml, apiPort, started } }
//
//  NOTE: password is kept in memory only for the duration
//  of the session to support the background refresh loop.
//  It is never written to disk.
// ────────────────────────────────────────────────────────────
var refreshStore = {};

// ────────────────────────────────────────────────────────────
//  Helper — sanitise proxy value
//  null, undefined, "", "null" → null
//  "/app/config/file.yaml"     → "/app/config/file.yaml"
// ────────────────────────────────────────────────────────────
function sanitiseProxy(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string')           return null;
  var trimmed = val.trim();
  if (trimmed === '' || trimmed === 'null') return null;
  return trimmed;
}

// ────────────────────────────────────────────────────────────
//  Helper — generate a simple session ID
// ────────────────────────────────────────────────────────────
function makeSessionId() {
  return 'sess_' + Date.now() + '_' +
    Math.random().toString(36).slice(2, 8);
}

// ────────────────────────────────────────────────────────────
//  Helper — run aci_auth_Proxy.py and return a promise
//
//  Resolves { success: true }  when [SUCCESS] appears in stdout
//  Rejects  with Error(message) on failure
// ────────────────────────────────────────────────────────────
function runApicAuth(apicIp, username, password, proxyYaml, apiPort) {
  return new Promise(function (resolve, reject) {

    var scriptPath = path.join(
      __dirname, '../scripts/utils/aci_auth_Proxy.py'
    );

    // Verify script exists before spawning
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(
        'Auth script not found: ' + scriptPath
      ));
    }

    var args = [
      scriptPath,
      '--host', apicIp,
      '--port', apiPort || '443',
      '--user', username,
      '--pwd',  password
    ];

    if (proxyYaml) {
      // Validate proxy file exists before passing to script
      if (!fs.existsSync(proxyYaml)) {
        return reject(new Error(
          'Proxy YAML file not found: ' + proxyYaml
        ));
      }
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
      console.log(
        '[auth] aci_auth_Proxy.py exited code:', code,
        '| stdout length:', stdoutBuf.length
      );

      if (code === 0 && stdoutBuf.indexOf('[SUCCESS]') !== -1) {
        resolve({ success: true, output: stdoutBuf });
      } else {
        // Extract the most meaningful error line from output
        var errLines = (stderrBuf + '\n' + stdoutBuf)
          .split('\n')
          .map(function (l) { return l.trim(); })
          .filter(function (l) {
            return l.length > 0 &&
                   l.indexOf('[INFO]') === -1 &&
                   l.indexOf('====') === -1;
          });

        var errMsg = errLines.length > 0
          ? errLines[errLines.length - 1]
          : 'Authentication failed (exit code ' + code + ')';

        reject(new Error(errMsg));
      }
    });

    proc.on('error', function (err) {
      reject(new Error('Failed to spawn auth script: ' + err.message));
    });
  });
}

// ────────────────────────────────────────────────────────────
//  Helper — run a silent refresh (best-effort, no reject)
//  Called every 50 seconds by the background timer
// ────────────────────────────────────────────────────────────
function runRefresh(sessionId, entry) {
  runApicAuth(
    entry.apicIp,
    entry.username,
    entry.password,
    entry.proxyYaml,
    entry.apiPort
  )
  .then(function () {
    console.log(
      '[auth] Token refreshed OK — session:', sessionId,
      '| APIC:', entry.apicIp
    );
  })
  .catch(function (err) {
    console.warn(
      '[auth] Token refresh failed — session:', sessionId,
      '| reason:', err.message
    );
  });
}

// ────────────────────────────────────────────────────────────
//  Helper — stop and remove a refresh timer
// ────────────────────────────────────────────────────────────
function stopRefresh(sessionId) {
  if (refreshStore[sessionId]) {
    clearInterval(refreshStore[sessionId].timer);
    delete refreshStore[sessionId];
    console.log('[auth] Refresh timer stopped — session:', sessionId);
  }
}

// ────────────────────────────────────────────────────────────
//  POST /api/auth/connect
//
//  1. Validates credentials against APIC via aci_auth_Proxy.py
//  2. On success starts a 50-second background refresh loop
//  3. Stores credentials in server-side session (memory only)
//
//  Request body:
//  {
//    apicIp:    "169.25.204.52",
//    username:  "admin",
//    password:  "otp-password",
//    proxyYaml: "/app/config/proxy_filename.yaml" | null,
//    apiPort:   "443"   (optional)
//  }
//
//  Response:
//  { success: true,  sessionId: "sess_..." }
//  { success: false, error: "..." }
// ────────────────────────────────────────────────────────────
router.post('/connect', function (req, res) {
  var apicIp    = req.body.apicIp;
  var username  = req.body.username;
  var password  = req.body.password;
  var apiPort   = req.body.apiPort || '443';
  var proxyYaml = sanitiseProxy(req.body.proxyYaml);

  // ── Field validation ──────────────────────────────────────
  if (!apicIp || typeof apicIp !== 'string' || apicIp.trim() === '') {
    return res.status(400).json({
      success: false,
      error:   'apicIp is required.'
    });
  }

  if (!username || typeof username !== 'string' || username.trim() === '') {
    return res.status(400).json({
      success: false,
      error:   'username is required.'
    });
  }

  if (!password || typeof password !== 'string' || password.trim() === '') {
    return res.status(400).json({
      success: false,
      error:   'password is required.'
    });
  }

  console.log(
    '[auth] Connect attempt — APIC:', apicIp,
    '| user:', username,
    '| proxy:', proxyYaml || 'none'
  );

  // ── Authenticate with APIC ────────────────────────────────
  runApicAuth(apicIp, username, password, proxyYaml, apiPort)
    .then(function () {

      // ── Build session ID ────────────────────────────────
      var sessionId = req.sessionID
        ? req.sessionID
        : makeSessionId();

      // ── Stop any existing refresh for this session ──────
      stopRefresh(sessionId);

      // ── Start background refresh timer ──────────────────
      // RSA OTP rotates every 60s — refresh every 50s to
      // ensure the token never expires mid-operation
      var entry = {
        apicIp:    apicIp,
        username:  username,
        password:  password,   // kept in memory, never on disk
        proxyYaml: proxyYaml,
        apiPort:   apiPort,
        started:   new Date().toISOString()
      };

      var timer = setInterval(function () {
        runRefresh(sessionId, entry);
      }, 50000);   // 50 seconds

      entry.timer = timer;
      refreshStore[sessionId] = entry;

      // ── Store sanitised info in server-side session ─────
      req.session.apicCredentials = {
        apicIp:    apicIp,
        username:  username,
        apiPort:   apiPort,
        proxyYaml: proxyYaml,
        sessionId: sessionId
      };

      console.log(
        '[auth] Connected — session:', sessionId,
        '| APIC:', apicIp,
        '| refresh: every 50s'
      );

      res.json({
        success:   true,
        message:   'Authentication successful.',
        sessionId: sessionId
      });
    })
    .catch(function (err) {
      console.warn('[auth] Connect failed:', err.message);
      res.json({
        success: false,
        error:   err.message
      });
    });
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/disconnect
//
//  Stops the background refresh timer and destroys the session.
//  Called when user clicks Disconnect on the compare page.
// ────────────────────────────────────────────────────────────
router.post('/disconnect', function (req, res) {
  var creds     = req.session.apicCredentials;
  var sessionId = creds ? creds.sessionId : null;

  if (sessionId) {
    stopRefresh(sessionId);
  }

  req.session.destroy(function (err) {
    if (err) {
      console.error('[auth] Session destroy error:', err.message);
      return res.status(500).json({
        success: false,
        error:   'Failed to destroy session.'
      });
    }

    console.log('[auth] Disconnected — session:', sessionId);
    res.json({
      success: true,
      message: 'Disconnected successfully.'
    });
  });
});

// ────────────────────────────────────────────────────────────
//  GET /api/auth/session
//
//  Returns current session info — no password exposed.
//  Used by frontend to check if still authenticated.
// ────────────────────────────────────────────────────────────
router.get('/session', function (req, res) {
  var creds = req.session.apicCredentials;

  if (!creds) {
    return res.status(401).json({ authenticated: false });
  }

  // Check if refresh timer is still running
  var refreshActive = creds.sessionId
    ? !!refreshStore[creds.sessionId]
    : false;

  res.json({
    authenticated: true,
    apicIp:        creds.apicIp,
    username:      creds.username,
    apiPort:       creds.apiPort,
    proxyYaml:     creds.proxyYaml,
    sessionId:     creds.sessionId,
    refreshActive: refreshActive
  });
});

// ────────────────────────────────────────────────────────────
//  GET /api/auth/refresh-status
//
//  Returns status of all active refresh timers.
//  Useful for debugging.
// ────────────────────────────────────────────────────────────
router.get('/refresh-status', function (req, res) {
  var sessions = Object.keys(refreshStore).map(function (id) {
    var entry = refreshStore[id];
    return {
      sessionId: id,
      apicIp:    entry.apicIp,
      username:  entry.username,
      started:   entry.started
    };
  });

  res.json({
    activeRefreshSessions: sessions.length,
    sessions:              sessions
  });
});

// ────────────────────────────────────────────────────────────
//  POST /api/auth/logout  (legacy — kept for compatibility)
// ────────────────────────────────────────────────────────────
router.post('/logout', function (req, res) {
  var creds     = req.session.apicCredentials;
  var sessionId = creds ? creds.sessionId : null;

  if (sessionId) stopRefresh(sessionId);

  req.session.destroy(function (err) {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true, message: 'Logged out.' });
  });
});

module.exports = router;