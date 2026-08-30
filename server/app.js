const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Database (Native or Portable)
require('./database/db');

// Auto-sync real WooCommerce catalog from app.mybangjo.com (skip during tests)
if (process.env.NODE_ENV !== 'test' && !process.env.DB_PATH) {
  try {
    const syncCatalog = require('./database/syncWoo');
    syncCatalog()
      .then(() => console.log('[Catalog Sync] Auto-synced real WooCommerce categories & products.'))
      .catch((e) => console.warn('[Catalog Sync]', e.message));
  } catch (e) {}
}

const tenantResolver = require('./middleware/tenantResolver');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Standard Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'Xentra Core Standalone Engine',
    version: '2.2.1',
    timestamp: new Date().toISOString()
  });
});

// Debug / Diagnostic Info
app.get('/debug', (req, res) => {
  res.json({
    node_version: process.version,
    env: process.env.NODE_ENV,
    cwd: process.cwd(),
    uptime: process.uptime()
  });
});

// REST API with Tenant Resolution
app.use('/api/v1', tenantResolver, apiRoutes);

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
        system: 'Xentra Core Engine v2.0',
        message: 'Customer PWA is initializing. API is ready at /api/v1'
      });
    }
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error',
    stack: err.stack
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
