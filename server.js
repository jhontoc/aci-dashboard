'use strict';

const express        = require('express');
const session        = require('express-session');
const cors           = require('cors');
const path           = require('path');
const fs             = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Ensure snapshot directory exists on startup ─────────────
const SNAPSHOT_DIR = path.join(__dirname, 'data', 'snapshots');
if (!fs.existsSync(SNAPSHOT_DIR)) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  console.log(`[INIT] Created snapshot directory: ${SNAPSHOT_DIR}`);
}

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session ──────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'aci-dashboard-secret-key',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   false,          // set true if serving over HTTPS
    httpOnly: true,
    maxAge:   1000 * 60 * 60  // 1 hour
  }
}));

// ── Static files ─────────────────────────────────────────────
// Serves: public/index.html, public/selector.html,
//         public/compare.html, public/components/*.js
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ───────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/commands',  require('./routes/commands'));
app.use('/api/snapshots', require('./routes/snapshots'));
app.use('/api/compare',   require('./routes/compare'));

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
    node:      process.version
  });
});

// ── SPA fallback — serve index.html for unknown GET routes ───
app.get('*', (req, res) => {
  const htmlFiles = ['index.html', 'selector.html', 'compare.html'];
  const requested = path.basename(req.path);

  if (htmlFiles.includes(requested)) {
    res.sendFile(path.join(__dirname, 'public', requested));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ── Global error handler ─────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.stack || err.message);
  res.status(500).json({
    error:   'Internal server error',
    message: err.message
  });
});

// ── Start server ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('─────────────────────────────────────────');
  console.log(`  ACI Dashboard running on port ${PORT}`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Snapshots: ${SNAPSHOT_DIR}`);
  console.log(`  Node.js:   ${process.version}`);
  console.log('─────────────────────────────────────────');
});

module.exports = app;