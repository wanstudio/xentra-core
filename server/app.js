const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Database (Native or Portable)
const db = require('./database/db');

// Auto-sync real WooCommerce catalog from app.mybangjo.com (skip during tests)
if (process.env.NODE_ENV !== 'test' && !process.env.DB_PATH && !process.env.SKIP_SYNC) {
  try {
    const syncCatalog = require('./database/syncWoo');
    syncCatalog()
      .then(() => console.log('[Catalog Sync] Auto-synced real WooCommerce categories & products.'))
      .catch((e) => console.warn('[Catalog Sync]', e.message));
  } catch (e) {}
}

const tenantResolver = require('./middleware/tenantResolver');
const apiRoutes = require('./routes/api');
const fs = require('fs');
const { execSync } = require('child_process');

// ---- Deploy receiver for dev.mybangjo.com (shell unzip only, no WASM/multer) ----
const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN;
function checkDeployToken(req) {
  // P1 SECURITY HARDENING: Token MUST ONLY be accepted via HTTP Header (Reject Query String & Body tokens)
  const h = (req.headers['x-deploy-token'] || '').trim();
  return Boolean(DEPLOY_TOKEN && h && h === DEPLOY_TOKEN);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Standard Middlewares: CORS with strict explicit origin checks (No wildcard endsWith)
const allowedOrigins = [
  'https://app.mybangjo.com',
  'https://dev.mybangjo.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow non-browser / internal server requests (null origin like curl, mobile app webview or SSR)
    if (!origin) return callback(null, true);
    
    // P1 HARDENING: Check against strictly allowed explicit origins only
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow local development ports if non-production
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // P1 HARDENING: Strictly reject all other origins
    return callback(new Error('CORS policy: Origin not allowed.'));
  },
  credentials: true
}));

// ---- Deploy endpoint HANYA untuk dev.mybangjo.com (jangan dipakai untuk app) ----
function handleDeploy(req, res) {
  if (!checkDeployToken(req)) {
    return res.status(403).json({ success: false, message: 'Unauthorized: Invalid or missing deploy token header.' });
  }

  // Reject deploy endpoint on production if explicitly flagged
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_REMOTE_DEPLOY) {
    return res.status(403).json({ success: false, message: 'Remote code deployment endpoint is disabled in production.' });
  }

  const target = (req.query.target || 'core');
  // locate zip: raw body
  let zipPath = null;
  if (req.body && Buffer.isBuffer(req.body) && req.body.length > 4) {
    zipPath = '/tmp/xentra-raw-' + Date.now() + '.zip';
    try { fs.writeFileSync(zipPath, req.body); } catch(e){ return res.status(500).json({success:false, message:e.message}); }
  }
  if (!zipPath || !fs.existsSync(zipPath)) {
    return res.status(400).json({ success: false, message: 'No package file received.' });
  }
  const candidates = [];
  const projectRoot = path.join(__dirname, '..');
  candidates.push(projectRoot);
  // mirror only to explicit known project path
  for (const p of ['/home/mybangjo/xentra-core', '/home/mybangjo/dev.mybangjo.com']) {
    if (p !== projectRoot && fs.existsSync(p)) candidates.push(p);
  }
  let extracted = [];
  let errors = [];

  // P1 SECURITY HARDENING: Validate ZIP archive contents against path traversal, symlinks, and zip bombs
  try {
    const listOutput = execSync('unzip -Z -1 ' + JSON.stringify(zipPath), { stdio: 'pipe' }).toString();
    const files = listOutput.split('\n').map(f => f.trim()).filter(Boolean);

    // Limit maximum files to prevent decompression resource exhaustion (ZIP Bomb)
    if (files.length > 5000) {
      try { fs.unlinkSync(zipPath); } catch (_) {}
      return res.status(400).json({
        success: false,
        error: 'ARCHIVE_TOO_LARGE',
        message: 'Archive berisi terlalu banyak file (>5000 entries).'
      });
    }

    for (const f of files) {
      // Reject directory traversal (../ or ..\), leading slash / absolute paths, or invalid control characters
      if (f.includes('..') || f.startsWith('/') || f.startsWith('\\')) {
        try { fs.unlinkSync(zipPath); } catch (_) {}
        return res.status(400).json({
          success: false,
          error: 'MALICIOUS_ARCHIVE_REJECTED',
          message: `File path tidak aman ditemukan dalam archive: "${f}" (Path traversal prohibited).`
        });
      }
    }
  } catch (inspectErr) {
    try { fs.unlinkSync(zipPath); } catch (_) {}
    return res.status(400).json({
      success: false,
      error: 'INVALID_ARCHIVE',
      message: 'Gagal memvalidasi isi file ZIP: ' + inspectErr.message
    });
  }

  for (const dest of candidates) {
    try {
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      execSync('unzip -o ' + JSON.stringify(zipPath) + ' -d ' + JSON.stringify(dest), { stdio: 'pipe' });
      try { fs.mkdirSync(path.join(dest, 'tmp'), { recursive: true }); fs.writeFileSync(path.join(dest, 'tmp', 'restart.txt'), String(Date.now())); } catch {}
      extracted.push(dest);
    } catch (e) {
      errors.push(dest + ': ' + e.message);
    }
  }
  try { fs.unlinkSync(zipPath); } catch {}
  if (extracted.length === 0) return res.status(500).json({ success:false, message:'Extract failed', errors });
  return res.json({ success:true, mode:'package_extracted', target, extracted, errors: errors.length?errors:undefined, timestamp:new Date().toISOString(), message:'Xentra Core deployed to dev.' });
}
// Deploy uses raw body only (deploy-core.sh --data-binary)
app.post(['/wp-json/xentra/v1/deploy', '/api/v1/deploy', '/wp-json/xentra/v1/deploy-raw', '/api/v1/deploy-raw'], express.raw({ type: '*/*', limit: '50mb' }), handleDeploy);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// REST API with Tenant Resolution
app.use('/api/v1', tenantResolver, apiRoutes);

// Serve Public Static Assets
app.use('/assets', express.static(path.join(__dirname, '../apps/customer-pwa/assets')));
app.use('/pwa', express.static(path.join(__dirname, '../apps/customer-pwa/assets/pwa')));

// PWA Manifest & Service Worker Routes with correct headers
app.get(['/manifest.json', '/pwa/manifest.json'], (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/customer-pwa/assets/pwa/manifest.json'));
});

app.get(['/service-worker.js', '/sw.js', '/pwa/service-worker.js'], (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/customer-pwa/assets/pwa/service-worker.js'));
});

// Merchant Dashboard Assets & Routes
app.use('/dashboard/assets', express.static(path.join(__dirname, '../apps/merchant-dashboard/assets')));
app.get(['/dashboard/login', '/dashboard/login/'], (req, res) => {
  res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/login.html'));
});
app.get(/^\/dashboard(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/index.html'));
});

// Health Check with Persistence & DB Readiness Verification
app.get('/health', (req, res) => {
  let dbStatus = 'unhealthy';
  try {
    const testRow = db.prepare('SELECT 1 as alive').get();
    if (testRow && testRow.alive === 1) {
      dbStatus = 'ready';
    }
  } catch (err) {
    dbStatus = 'disconnected: ' + err.message;
  }

  const isHealthy = dbStatus === 'ready';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    system: 'Xentra Core Standalone Engine',
    version: '2.2.5',
    persistence: dbStatus,
    timestamp: new Date().toISOString()
  });
});

// Debug / Diagnostic Info (Restricted to non-production only)
app.get('/debug', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  res.json({
    node_version: process.version,
    env: process.env.NODE_ENV,
    cwd: process.cwd(),
    uptime: process.uptime()
  });
});

// Customer PWA Routes
app.get(['/checkout', '/checkout/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/customer-pwa/checkout.html'));
});
app.get(['/order-received', '/order-received/:id', '/order-received/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/customer-pwa/order-received.html'));
});

// Fallback Customer PWA entry
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const pwaIndex = path.join(__dirname, '../apps/customer-pwa/index.html');
  res.sendFile(pwaIndex, (err) => {
    if (err) {
      res.json({
        system: 'Xentra Core Standalone Engine v2.2.5',
        message: 'Customer PWA is initializing. API is ready at /api/v1'
      });
    }
  });
});

// Global Error Handler (P1: NEVER expose stack trace in production response)
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err);
  const isDev = process.env.NODE_ENV === 'development';
  res.status(500).json({
    success: false,
    error: isDev ? (err.message || 'Internal Server Error') : 'Internal Server Error',
    request_id: `req_${Date.now().toString(36)}`
  });
});

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`[Xentra Core] Standalone SaaS Engine running on http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Xentra Core] Port ${PORT} is currently active.`);
    } else {
      console.error('[Xentra Core Server Error]:', err);
    }
  });
}

module.exports = app;
