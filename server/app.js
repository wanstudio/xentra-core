const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Database (Native or Portable)
const db = require('./database/db');

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

  // P1 SECURITY HARDENING: Validate ZIP archive contents against path traversal, symlinks, extreme compression, and zip bombs
  try {
    const pyValidateScript = `
import zipfile, stat, sys
zip_path = sys.argv[1]
max_files = 5000
max_uncompressed_bytes = 250 * 1024 * 1024 # 250 MB ceiling

try:
    with zipfile.ZipFile(zip_path, 'r') as zf:
        infolist = zf.infolist()
        if len(infolist) > max_files:
            print(f'ARCHIVE_TOO_LARGE: Too many entries ({len(infolist)} > {max_files})')
            sys.exit(2)
        
        total_uncompressed = 0
        for info in infolist:
            total_uncompressed += info.file_size
            if total_uncompressed > max_uncompressed_bytes:
                print(f'ARCHIVE_TOO_LARGE: Decompressed size exceeded limit ({total_uncompressed} > {max_uncompressed_bytes} bytes)')
                sys.exit(2)
            
            # P1 SECURITY: Inspect Unix file attributes for symlinks (S_IFLNK = 0o120000)
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode):
                print(f'SYMLINK_REJECTED: Symlink entry prohibited: {info.filename}')
                sys.exit(3)
            
            fn = info.filename
            if '..' in fn or fn.startswith('/') or fn.startswith('\\\\'):
                print(f'TRAVERSAL_REJECTED: Path traversal prohibited: {fn}')
                sys.exit(4)
    print('VALID')
    sys.exit(0)
except Exception as e:
    print('INVALID_ZIP: ' + str(e))
    sys.exit(1)
`;
    const checkResult = execSync(`python3 -c ${JSON.stringify(pyValidateScript)} ${JSON.stringify(zipPath)}`, { stdio: 'pipe' }).toString().trim();
    if (!checkResult.includes('VALID')) {
      try { fs.unlinkSync(zipPath); } catch (_) {}
      return res.status(400).json({
        success: false,
        error: 'ARCHIVE_VALIDATION_FAILED',
        message: 'Validasi paket ZIP gagal: ' + checkResult
      });
    }
  } catch (inspectErr) {
    try { fs.unlinkSync(zipPath); } catch (_) {}
    const output = inspectErr.stdout ? inspectErr.stdout.toString().trim() : inspectErr.message;
    return res.status(400).json({
      success: false,
      error: 'MALICIOUS_OR_INVALID_ARCHIVE',
      message: 'Paket ZIP ditolak: ' + output
    });
  }

  for (const dest of candidates) {
    try {
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      execSync('unzip -o ' + JSON.stringify(zipPath) + ' -d ' + JSON.stringify(dest), { stdio: 'pipe' });

      // Auto-sync customer-pwa static files to dev root if dest is dev.mybangjo.com
      const pwaStaticDir = path.join(dest, 'apps', 'customer-pwa');
      if (fs.existsSync(pwaStaticDir) && (dest.includes('dev.mybangjo.com') || dest.includes('public_html'))) {
        try {
          execSync('cp -r ' + JSON.stringify(path.join(pwaStaticDir, '*')) + ' ' + JSON.stringify(dest) + ' 2>/dev/null || true', { shell: '/bin/bash' });
        } catch (_) {}
      }

      // Ensure permanent, safe .htaccess on dev.mybangjo.com
      if (dest.includes('dev.mybangjo.com')) {
        const htaccessPath = path.join(dest, '.htaccess');
        const cleanHtaccess = [
          '<IfModule mod_rewrite.c>',
          '    RewriteEngine On',
          '    RewriteBase /',
          '    RewriteCond %{REQUEST_FILENAME} -f [OR]',
          '    RewriteCond %{REQUEST_FILENAME} -d',
          '    RewriteRule ^ - [L]',
          '    RewriteRule ^manifest\\.json$ assets/pwa/manifest.json [L]',
          '    RewriteRule ^service-worker\\.js$ assets/pwa/service-worker.js [L]',
          '    RewriteRule ^sw\\.js$ assets/pwa/service-worker.js [L]',
          '    RewriteCond %{REQUEST_URI} !^/api/',
          '    RewriteRule ^ index.html [L]',
          '</IfModule>',
          '<IfModule mod_headers.c>',
          '    <FilesMatch "manifest\\.json$">',
          '        Header set Content-Type "application/manifest+json; charset=utf-8"',
          '    </FilesMatch>',
          '    <FilesMatch "(service-worker|sw)\\.js$">',
          '        Header set Content-Type "application/javascript; charset=utf-8"',
          '        Header set Service-Worker-Allowed "/"',
          '    </FilesMatch>',
          '</IfModule>',
          '# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION BEGIN',
          'PassengerAppRoot "/home/mybangjo/xentra-core"',
          'PassengerBaseURI "/"',
          'PassengerNodejs "' + (process.env.PASSENGER_NODEJS || '/home/mybangjo/nodevenv/xentra-core/22/bin/node') + '"',
          'PassengerAppType node',
          'PassengerStartupFile app.js',
          'PassengerAppLogFile "/home/mybangjo/xentra-core/passenger.log"',
          '# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION END',
          '# DO NOT REMOVE OR MODIFY. CLOUDLINUX ENV VARS CONFIGURATION BEGIN',
          '<IfModule Litespeed>',
          'SetEnv NODE_OPTIONS --max-old-space-size=1024',
          'SetEnv SKIP_SYNC 1',
          '</IfModule>',
          '# DO NOT REMOVE OR MODIFY. CLOUDLINUX ENV VARS CONFIGURATION END'
        ].join('\n');
        try {
          fs.writeFileSync(htaccessPath, cleanHtaccess, 'utf8');
        } catch (_) {}
      }

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

// REST API with Tenant Resolution (Support both /api/v1 and /api)
app.use(['/api/v1', '/api'], tenantResolver, apiRoutes);

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
  let isDbReady = false;
  try {
    const testRow = db.prepare('SELECT 1 as alive').get();
    if (testRow && testRow.alive === 1) {
      isDbReady = true;
    }
  } catch (err) {
    console.error('[Health Check DB Error]:', err.message);
  }

  res.status(isDbReady ? 200 : 503).json({
    status: isDbReady ? 'ok' : 'degraded',
    system: 'Xentra Core Standalone Engine',
    version: '2.2.7',
    persistence: isDbReady ? 'ready' : 'unavailable',
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
        system: 'Xentra Core Standalone Engine v2.2.7',
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

    // Authoritative Periodic Payment Reconciliation Worker (NEW-01 & NEW-03):
    // Resolves unknown / reconciliation_pending payment outcomes against Midtrans API
    const PaymentGatewayService = require('../domains/payment/services/PaymentGatewayService');
    const interval = setInterval(async () => {
      try {
        const reconResults = await PaymentGatewayService.reconcilePendingPayments();
        if (reconResults && reconResults.length > 0) {
          console.log(`[Payment Reconciliation Worker] Processed ${reconResults.length} pending transactions.`);
        }
      } catch (workerErr) {
        console.error('[Payment Reconciliation Worker Error]:', workerErr.message);
      }
    }, 60000);
    if (interval.unref) interval.unref();
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
