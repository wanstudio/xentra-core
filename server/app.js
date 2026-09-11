const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Core Data Access Boundary (concrete persistence stays behind this facade)
const DataAccess = require('../core/data/DataAccess');

const tenantResolver = require('./middleware/tenantResolver');
const apiRoutes = require('./routes/api');
const app = express();
const PORT = process.env.PORT || 3000;

// Standard Middlewares: CORS with strict explicit origin checks (No wildcard endsWith).
// Client-domain origins are deployment-managed configuration, not application
// source exceptions. Same-origin requests do not require CORS permission.
const configuredAllowedOrigins = String(process.env.XENTRA_CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [
  'https://xentra.cloud',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  ...configuredAllowedOrigins,
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

// 6mb JSON limit: base64-encoded category/menu image uploads (see POST
// /admin/branches/:id/categories/:catId/image) are ~33% larger than the raw
// file, and raw files are capped at 3MB — 6mb gives comfortable headroom
// without opening the door to arbitrarily large payloads.
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true }));

// REST API with Tenant Resolution (Support both /api/v1 and /api)
app.use(['/api/v1', '/api'], tenantResolver, apiRoutes);

// Xentra Cloud Platform: Public Email Verification Route
app.get(['/verify-email', '/verify-email/'], (req, res, next) => {
  // Delegate directly to the api router verification handler
  req.url = '/verify-email' + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
  apiRoutes(req, res, next);
});

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
    const testRow = DataAccess.queryOne('SELECT 1 as alive');
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
  // Wait for database to be fully ready (sql.js async init on Node 20) before accepting requests
  const startServer = () => {
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

    // R6 ACCEPTANCE TIMEOUT WORKER (platform policy — 3 minutes, server
    // authoritative, atomic + idempotent via OrderStateMachine). Browser
    // timers never determine Order state. Sweeps every 15 seconds.
    const AcceptanceTimeoutService = require('./services/AcceptanceTimeoutService');
    const timeoutWorker = setInterval(() => {
      try {
        const sweepResult = AcceptanceTimeoutService.checkAndApplyTimeouts();
        if (sweepResult.timed_out > 0) {
          console.log(`[Acceptance Timeout Worker] ${sweepResult.timed_out} order(s) timed out (${sweepResult.processed} scanned).`);
        }
      } catch (workerErr) {
        console.error('[Acceptance Timeout Worker Error]:', workerErr.message);
      }
    }, 15000);
    if (timeoutWorker.unref) timeoutWorker.unref();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Xentra Core] Port ${PORT} is currently active.`);
    } else {
      console.error('[Xentra Core Server Error]:', err);
    }
  });
  };

  // Wait for DB migration to complete before starting server (fixes sql.js race condition)
  if (DataAccess.readyPromise) {
    DataAccess.readyPromise.then(() => {
      console.log('[Xentra Core] Database ready. Starting server...');
      startServer();
    }).catch(err => {
      console.error('[Xentra Core] Database init failed:', err.message);
      startServer(); // Start anyway — some routes may still work
    });
  } else {
    startServer();
  }
}

module.exports = app;
