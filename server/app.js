const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Database (Native or Portable)
require('./database/db');

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
app.use('/pwa', express.static(path.join(__dirname, '../apps/customer-pwa')));
app.use('/kitchen', express.static(path.join(__dirname, '../apps/kitchen-display')));

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'Xentra Core Standalone Engine',
    version: '2.0.0',
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

// Fallback Customer PWA entry
app.get('*', (req, res) => {
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

module.exports = app;
