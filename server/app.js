const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

function isTestExecution() {
  if (process.env.NODE_ENV === 'test') return true;
  if (process.env.npm_lifecycle_event === 'test') return true;
  if (Array.isArray(process.execArgv) && process.execArgv.some(a => typeof a === 'string' && a.startsWith('--test'))) return true;
  if (Array.isArray(process.argv) && process.argv.slice(1).some(a => typeof a === 'string' && (a === '--test' || a.startsWith('--test-') || a.endsWith('.test.js') || a.endsWith('.spec.js')))) return true;
  if (Array.isArray(process.moduleLoadList) && process.moduleLoadList.some(m => m.includes('test_runner') || m === 'NativeModule test')) return true;
  return false;
}

if (isTestExecution()) {
  process.env.NODE_ENV = 'test';
} else if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

// Initialize Core Data Access Boundary (concrete persistence stays behind this facade)
const DataAccess = require('../core/data/DataAccess');

const tenantResolver = require('./middleware/tenantResolver');
const apiRoutes = require('./routes/api');
const app = express();

/**
 * Kompresi respons teks.
 *
 * Tanpa ini, berkas teks dikirim apa adanya: dashboard.js 455 KB dan dashboard.css
 * 183 KB — sekitar 656 KB untuk lima aset utama, setiap kali halaman dimuat. Dengan
 * gzip turun menjadi sekitar 129 KB (-81%), dan brotli sekitar -85%.
 *
 * Memakai zlib bawaan Node, jadi tidak menambah dependensi. Hanya respons teks yang
 * dikompresi; berkas yang sudah terkompresi (gambar, woff2) tidak diuntungkan sama
 * sekali dan hanya membuang CPU.
 */
const zlib = require('zlib');
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/i;
const MIN_COMPRESS_BYTES = 1024;

app.use(function compressionMiddleware(req, res, next) {
  const accept = String(req.headers['accept-encoding'] || '');
  const useBrotli = /\bbr\b/.test(accept);
  const useGzip = /\bgzip\b/.test(accept);
  if (!useBrotli && !useGzip) return next();

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  let chunks = [];
  let passthrough = false;

  function shouldCompress() {
    if (passthrough) return false;
    if (res.statusCode === 204 || res.statusCode === 304) return false;
    if (res.getHeader('Content-Encoding')) return false;
    const type = String(res.getHeader('Content-Type') || '');
    // SSE harus lewat apa adanya: menahannya berarti mematikan pembaruan realtime.
    if (/^text\/event-stream/i.test(type)) return false;
    if (!COMPRESSIBLE.test(type)) return false;
    const length = Number(res.getHeader('Content-Length') || 0);
    return !(length > 0 && length < MIN_COMPRESS_BYTES);
  }

  function flush(chunk, encoding) {
    const body = chunk ? Buffer.concat(chunks.concat([Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)])) : Buffer.concat(chunks);
    chunks = [];
    if (body.length < MIN_COMPRESS_BYTES) {
      res.removeHeader('Content-Length');
      return originalEnd(body);
    }
    const compress = useBrotli ? zlib.brotliCompressSync : zlib.gzipSync;
    const out = compress(body);
    res.setHeader('Content-Encoding', useBrotli ? 'br' : 'gzip');
    res.removeHeader('Content-Length');
    res.setHeader('Vary', 'Accept-Encoding');
    return originalEnd(out);
  }

  res.write = function (chunk, encoding, callback) {
    if (shouldCompress()) {
      // Buffer sampai selesai, lalu kompresi sekali. Ukuran berkasnya kecil (ratusan KB)
      // sehingga tidak perlu kompresi bertahap.
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      if (typeof encoding === 'function') encoding();
      else if (typeof callback === 'function') callback();
      return true;
    }
    return originalWrite(chunk, encoding, callback);
  };

  res.end = function (chunk, encoding, callback) {
    if (shouldCompress()) return flush(chunk, encoding);
    return originalEnd(chunk, encoding, callback);
  };

  // Respons yang beralih ke streaming/menulis sendiri dilewatkan apa adanya.
  res.on('finish', function () { passthrough = true; });

  next();
});
const PORT = process.env.PORT || 3000;

const { BrandRepository } = require('../core/data/repositories');
const { PWA_THEME } = require('./config/pwa-theme');
const brandRepository = new BrandRepository();

// Standard Middlewares: CORS with strict explicit and dynamic registered origin checks.
// Client-domain origins are dynamically verified against the authoritative Domain Registry / BrandRepository.
// No wildcard CORS and no hardcoded client domains in application code.
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
  origin: async function (origin, callback) {
    // Allow non-browser / internal server requests (null origin like curl, mobile app webview or SSR)
    if (!origin) return callback(null, true);
    
    // Check against strictly allowed explicit origins (control plane, local dev, env configured)
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow local development ports if non-production
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // Dynamic registered client domain verification (No hardcoded domains, No wildcard CORS)
    try {
      const parsedUrl = new URL(origin);
      const protocol = parsedUrl.protocol.toLowerCase();
      const isProduction = process.env.NODE_ENV === 'production';

      // Enforce protocol boundaries: HTTPS strictly required in production; http/https in dev/test
      if (isProduction && protocol !== 'https:') {
        return callback(new Error('CORS policy: Origin not allowed.'));
      }
      if (!isProduction && protocol !== 'https:' && protocol !== 'http:') {
        return callback(new Error('CORS policy: Origin not allowed.'));
      }

      const rawHostname = parsedUrl.hostname.toLowerCase().trim();
      if (!rawHostname) {
        return callback(new Error('CORS policy: Origin not allowed.'));
      }

      // Reject localhost, loopback, or internal destinations in production
      const isLoopbackOrLocal = rawHostname === 'localhost' ||
        rawHostname === '127.0.0.1' ||
        rawHostname === '::1' ||
        rawHostname.endsWith('.local') ||
        rawHostname.endsWith('.internal');

      if (isProduction && isLoopbackOrLocal) {
        return callback(new Error('CORS policy: Origin not allowed.'));
      }

      // Authoritative check against registered client domains via BrandRepository / Domain Registry
      await brandRepository.ready();
      const brand = brandRepository.findByCustomDomain(rawHostname);
      if (brand) {
        return callback(null, true);
      }
    } catch (_) {
      // Malformed URL or resolution error fails closed
    }

    // P1 HARDENING: Strictly reject all other origins
    return callback(new Error('CORS policy: Origin not allowed.'));
  },
  credentials: true
}));

// 30mb JSON limit: accommodates up to 20MB raw binary media uploads (M0 locked policy)
// encoded in base64 (~33% expansion = ~26.7MB), with safe headroom.
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// REST API with Tenant Resolution (Support both /api/v1 and /api)
app.use(['/api/v1', '/api'], tenantResolver, apiRoutes);

// Public Payment Gateway Webhooks (Support direct /webhooks/* root paths)
app.post(['/webhooks/doku', '/webhooks/midtrans'], (req, res, next) => {
  apiRoutes(req, res, next);
});

// Xentra Cloud Platform: Public Email Verification Route
app.get(['/verify-email', '/verify-email/'], (req, res, next) => {
  // Delegate directly to the api router verification handler
  req.url = '/verify-email' + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
  apiRoutes(req, res, next);
});

// Xentra Cloud Platform: Public Workforce Invitation Validation Capability Route
app.get(['/invitations/validate/:token', '/invitations/validate/:token/'], (req, res, next) => {
  req.url = `/invitations/validate/${req.params.token}`;
  apiRoutes(req, res, next);
});

// Xentra Cloud Platform: Public Workforce Invitation Acceptance Route UI
app.get(['/invite/:token', '/invite/:token/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/invite.html'));
});

function getRequestSubdomainType(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].trim().toLowerCase();
  if (host.startsWith('m.') || host.startsWith('merchant.')) return 'managerial';
  if (host.startsWith('owner.') || host.startsWith('dashboard.') || host === 'biz.xentra.cloud') return 'owner';
  if (host.startsWith('pos.') || host.startsWith('kasir.')) return 'pos';
  if (host.startsWith('customer.')) return 'customer';
  return null;
}

function getBaseTenantDomain(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].trim().toLowerCase();
  const match = host.match(/^(?:m|merchant|owner|dashboard|pos|kasir|admin|app|customer)\.(.+)$/);
  return match ? match[1] : host;
}

const PWA_THEME_SCRIPT = '(function(){var color=' + JSON.stringify(PWA_THEME.surfaceColor) + ';' +
  'var meta=document.querySelector(\'meta[name="theme-color"]:not([media])\');' +
  'if(!meta){meta=document.createElement(\'meta\');meta.setAttribute(\'name\',\'theme-color\');document.head.appendChild(meta);}' +
  'meta.setAttribute(\'content\',color);' +
  '[\'(prefers-color-scheme: light)\',\'(prefers-color-scheme: dark)\'].forEach(function(media){' +
  'var m=document.querySelector(\'meta[name="theme-color"][media="\' + media + \'"]\');' +
  'if(!m){m=document.createElement(\'meta\');m.setAttribute(\'name\',\'theme-color\');m.setAttribute(\'media\',media);document.head.appendChild(m);}' +
  'm.setAttribute(\'content\',color);' +
  '});' +
  'var cs=document.querySelector(\'meta[name="color-scheme"]\');' +
  'if(!cs){cs=document.createElement(\'meta\');cs.setAttribute(\'name\',\'color-scheme\');document.head.appendChild(cs);}' +
  'cs.setAttribute(\'content\',\'light\');' +
  'try{document.documentElement.style.colorScheme=\'light\';}catch(_){}' +
  '})();';

app.get('/pwa-theme.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.send(PWA_THEME_SCRIPT);
});

// PWA Manifest & Service Worker Routes — MUST come before express.static
// so Cloudflare always sees the explicit no-store headers, not express.static defaults.

/**
 * Resolve brand from request host for manifest icon override.
 * Returns brand row or null. Never throws.
 */
async function resolveBrandForManifest(req) {
  try {
    await brandRepository.ready();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].trim().toLowerCase();
    if (!host) return null;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocal) {
      return brandRepository.findFirstForLocalDevelopment() || null;
    }
    return brandRepository.findByCustomDomain(host) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Build a minimal icons array for a PWA manifest.
 * If iconUrl is provided, both 192 and 512 entries point to it.
 * Otherwise the default src values from the manifest file are used.
 */
function applyCanonicalPwaTheme(data) {
  data.theme_color = PWA_THEME.surfaceColor;
  data.background_color = PWA_THEME.surfaceColor;
  return data;
}

function buildPwaIcons(iconUrl, default192, default512) {
  const src192 = iconUrl || default192;
  const src512 = iconUrl || default512;
  return [
    { src: src192, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: src192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: src512, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: src512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ];
}

app.get(['/manifest.json', '/pwa/manifest.json'], async (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  const subType = getRequestSubdomainType(req);
  if (subType === 'managerial' || subType === 'owner') {
    const manifestPath = path.join(__dirname, '../apps/merchant-app/manifest.json');
    try {
      const data = applyCanonicalPwaTheme(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      data.id = '/';
      data.scope = '/';
      // managerial (m. subdomain) → open merchant surface by default.
      // Explicit owner/dashboard surfaces open the canonical Owner route (/owner/).
      const isOwnerSurface = req.query.surface === 'owner' || (req.headers.referer && req.headers.referer.includes('/owner'));
      const isDashboardSurface = req.query.surface === 'dashboard' || (req.headers.referer && req.headers.referer.includes('/dashboard'));
      const isOwner = subType === 'owner' || isOwnerSurface || isDashboardSurface;
      data.start_url = isOwner ? '/owner/' : '/merchant/';
      data.id = isOwner ? '/owner' : '/';
      const brand = await resolveBrandForManifest(req);
      const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();

      // biz.xentra.cloud is the Xentra Business Portal: platform-branded by default.
      // Tenant branding is applied only when a tenant/brand context is actually resolvable.
      if (host === 'biz.xentra.cloud') {
        data.name = 'Xentra Business Portal';
        data.short_name = 'Xentra Business';
        data.description = 'Portal Bisnis Xentra untuk Owner & Merchant';
      } else if (brand && brand.name) {
        data.name = brand.merchant_pwa_name || (isDashboard ? brand.name : brand.name + ' Merchant');
        data.short_name = (brand.merchant_pwa_name || brand.name).substring(0, 12);
      }

      const iconOverride = brand ? (brand.merchant_pwa_icon_url || brand.logo_url || null) : null;
      data.icons = buildPwaIcons(iconOverride, '/merchant-app/assets/icons/icon-192.png', '/merchant-app/assets/icons/icon-512.png');
      return res.json(data);
    } catch (_) {
      return res.sendFile(manifestPath);
    }
  }
  if (subType === 'pos') {
    const manifestPath = path.join(__dirname, '../apps/pos-app/manifest.json');
    try {
      const data = applyCanonicalPwaTheme(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      data.id = '/';
      data.start_url = '/';
      data.scope = '/';
      const brand = await resolveBrandForManifest(req);
      if (brand && brand.name) {
        data.name = brand.pos_pwa_name || brand.name;
        data.short_name = (brand.pos_pwa_name || brand.name).substring(0, 12);
      }
      const iconOverride = brand ? (brand.pos_pwa_icon_url || brand.logo_url || null) : null;
      data.icons = buildPwaIcons(iconOverride, '/pos/assets/icons/icon-192.png', '/pos/assets/icons/icon-512.png');
      return res.json(data);
    } catch (_) {
      return res.sendFile(manifestPath);
    }
  }

  try {
    const data = applyCanonicalPwaTheme(JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/customer-pwa/assets/pwa/manifest.json'), 'utf8')));
    return res.json(data);
  } catch (_) {
    return res.sendFile(path.join(__dirname, '../apps/customer-pwa/assets/pwa/manifest.json'));
  }
});

app.get(['/service-worker.js', '/sw.js', '/pwa/service-worker.js'], (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const subType = getRequestSubdomainType(req);
  if (subType === 'managerial' || subType === 'owner') {
    return res.sendFile(path.join(__dirname, '../apps/merchant-app/sw.js'));
  }
  if (subType === 'pos') {
    return res.sendFile(path.join(__dirname, '../apps/pos-app/sw.js'));
  }

  res.sendFile(path.join(__dirname, '../apps/customer-pwa/assets/pwa/service-worker.js'));
});

// Merchant PWA Manifest & Service Worker Routes — explicitly served before express.static / HTML catch-alls
app.get(['/merchant-app/manifest.json', '/merchant/manifest.json'], async (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  const fwdHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
  const isDedicatedSubdomain = fwdHost.startsWith('m.') || fwdHost.startsWith('merchant.');

  const manifestPath = path.join(__dirname, '../apps/merchant-app/manifest.json');
  if (isDedicatedSubdomain) {
    try {
      const data = applyCanonicalPwaTheme(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      data.id = '/';
      data.start_url = '/merchant/';
      data.scope = '/';
      const brand = await resolveBrandForManifest(req);
      if (brand && brand.name) {
        data.name = brand.merchant_pwa_name || (brand.name + ' Merchant');
        data.short_name = (brand.merchant_pwa_name || brand.name).substring(0, 12);
      }
      const iconOverride = brand ? (brand.merchant_pwa_icon_url || brand.logo_url || null) : null;
      data.icons = buildPwaIcons(iconOverride, '/merchant-app/assets/icons/icon-192.png', '/merchant-app/assets/icons/icon-512.png');
      return res.json(data);
    } catch (_) {}
  }
  try {
    const data = applyCanonicalPwaTheme(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    return res.json(data);
  } catch (_) {
    return res.sendFile(manifestPath);
  }
});

app.get(['/merchant-app/sw.js', '/merchant-app/service-worker.js', '/merchant/sw.js', '/merchant/service-worker.js'], (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '../apps/merchant-app/sw.js'));
});

// POS PWA Manifest & Service Worker Routes
app.get(['/pos/manifest.json', '/pos-app/manifest.json'], async (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  const fwdHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
  const isDedicatedSubdomain = fwdHost.startsWith('pos.') || fwdHost.startsWith('kasir.');

  const manifestPath = path.join(__dirname, '../apps/pos-app/manifest.json');
  if (isDedicatedSubdomain) {
    try {
      const data = applyCanonicalPwaTheme(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      data.id = '/';
      data.start_url = '/';
      data.scope = '/';
      const brand = await resolveBrandForManifest(req);
      if (brand && brand.name) {
        data.name = brand.pos_pwa_name || brand.name;
        data.short_name = (brand.pos_pwa_name || brand.name).substring(0, 12);
      }
      const iconOverride = brand ? (brand.pos_pwa_icon_url || brand.logo_url || null) : null;
      data.icons = buildPwaIcons(iconOverride, '/pos/assets/icons/icon-192.png', '/pos/assets/icons/icon-512.png');
      return res.json(data);
    } catch (_) {}
  }
  try {
    const data = applyCanonicalPwaTheme(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    return res.json(data);
  } catch (_) {
    return res.sendFile(manifestPath);
  }
});

app.get(['/pos/sw.js', '/pos-app/sw.js', '/pos/service-worker.js', '/pos-app/service-worker.js'], (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '../apps/pos-app/sw.js'));
});

// Serve Public Static Assets — setHeaders ensures Cloudflare does not cache JS/CSS
// (express.static default is 'public, max-age=0' which Cloudflare treats as cacheable)
const _noCacheHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};
app.use('/assets', express.static(path.join(__dirname, '../apps/customer-pwa/assets'), {
  setHeaders: _noCacheHeaders,
}));
app.use('/pwa', express.static(path.join(__dirname, '../apps/customer-pwa/assets/pwa'), {
  setHeaders: _noCacheHeaders,
}));

// Merchant Dashboard Assets
app.use('/dashboard/assets', express.static(path.join(__dirname, '../apps/merchant-dashboard/assets'), {
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));
app.use('/merchant-dashboard/assets', express.static(path.join(__dirname, '../apps/merchant-dashboard/assets'), {
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Shared Merchant Frontend Infrastructure (merchant-shared/)
// Serves apps/merchant-shared/ at /merchant-shared for all dashboard surfaces.
app.use('/merchant-shared', express.static(path.join(__dirname, '../apps/merchant-shared'), {
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Xentra Cloud SaaS Public Entry Points
// These routes serve SaaS pages only when the request host is xentra.cloud (or localhost in dev).
// On tenant domains (e.g. app.mybangjo.com) these paths fall through to the customer PWA fallback.
function isSaaSHost(req) {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  return host === 'xentra.cloud' || host === 'biz.xentra.cloud' || host === 'localhost' || host === '127.0.0.1';
}

app.get(['/', '/landing', '/landing/'], async (req, res, next) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();

  if (host === 'biz.xentra.cloud') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/business-entry.html'));
  }

  if (isSaaSHost(req)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/landing.html'));
  }

  const subType = getRequestSubdomainType(req);
  if (subType === 'managerial') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/managerial-entry.html'));
  }
  if (subType === 'owner') {
    if (process.env.NODE_ENV !== 'test') {
      const base = getBaseTenantDomain(req);
      if (base) {
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        return res.redirect(302, `${proto}://m.${base}/dashboard/`);
      }
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/index.html'));
  }
  if (subType === 'pos') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(__dirname, '../apps/pos-app/index.html'));
  }

  return next();
});
app.get(['/signin', '/signin/'], (req, res, next) => {
  if (!isSaaSHost(req)) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/signin.html'));
});
app.get(['/signup', '/signup/'], (req, res, next) => {
  if (!isSaaSHost(req)) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/signup.html'));
});
app.get(['/auth/broker', '/auth/broker/'], (req, res, next) => {
  if (!isSaaSHost(req)) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/auth-broker.html'));
});

app.get(['/onboarding', '/onboarding/*', '/onboarding/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/onboarding.html'));
});
// Unified login — the single entry point for every role.
app.get(['/login', '/login/'], async (req, res) => {
  if (!isSaaSHost(req)) {
    const cleanHost = (req.headers.host || '').split(':')[0].trim().toLowerCase();
    await brandRepository.ready();
    const brand = brandRepository.findByCustomDomain(cleanHost);
    if (!brand) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'Brand/Tenant tidak ditemukan untuk host yang diberikan.'
      });
    }

    const subType = getRequestSubdomainType(req);
    if (subType === 'owner' && process.env.NODE_ENV !== 'test') {
      const base = getBaseTenantDomain(req);
      if (base) {
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        return res.redirect(302, `${proto}://m.${base}/login${qs}`);
      }
    }
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/login.html'));
});

// Legacy login entry point. Kept only so existing links and bookmarks keep
// working; it no longer serves its own login surface, it forwards to /login.
app.get(['/dashboard/login', '/dashboard/login/'], (req, res) => {
  const qs = req.originalUrl.indexOf('?') !== -1 ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, '/login' + qs);
});

app.get([/^\/dashboard(\/.*)?$/, /^\/owner(\/.*)?$/], async (req, res) => {
  if (!isSaaSHost(req)) {
    const cleanHost = (req.headers.host || '').split(':')[0].trim().toLowerCase();
    await brandRepository.ready();
    const brand = brandRepository.findByCustomDomain(cleanHost);
    if (!brand) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'Brand/Tenant tidak ditemukan untuk host yang diberikan.'
      });
    }

    const subType = getRequestSubdomainType(req);
    // If on owner.*, redirect to m.* managerial domain
    if (subType === 'owner') {
      if (process.env.NODE_ENV !== 'test') {
        const base = getBaseTenantDomain(req);
        if (base) {
          const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
          return res.redirect(302, `${proto}://m.${base}/dashboard/`);
        }
      }
    }
    // If on customer (app.) or pos, redirect to managerial m.* domain
    if (process.env.NODE_ENV !== 'test') {
      const base = getBaseTenantDomain(req);
      if (subType === 'pos' || subType === 'customer' || cleanHost.startsWith('app.')) {
        if (base && base !== cleanHost) {
          const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
          return res.redirect(302, `${proto}://m.${base}/dashboard/`);
        }
      }
    }
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/index.html'));
});

// Merchant App Assets (standalone Branch Manager operating surface)
app.use(['/merchant-app/assets', '/merchant/assets'], express.static(path.join(__dirname, '../apps/merchant-app/assets'), {
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Merchant App entry point. Additive: /dashboard routing is unchanged and the
// Branch Manager surface is served here for role-appropriate deep links.
app.get([/^\/merchant-app(\/.*)?$/, /^\/merchant(\/.*)?$/], async (req, res) => {
  if (!isSaaSHost(req)) {
    const cleanHost = (req.headers.host || '').split(':')[0].trim().toLowerCase();
    await brandRepository.ready();
    const brand = brandRepository.findByCustomDomain(cleanHost);
    if (!brand) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'Brand/Tenant tidak ditemukan untuk host yang diberikan.'
      });
    }

    const subType = getRequestSubdomainType(req);
    // If on customer (app.) or pos, redirect to managerial m.* domain
    if (process.env.NODE_ENV !== 'test') {
      const base = getBaseTenantDomain(req);
      if (subType === 'pos' || subType === 'customer' || cleanHost.startsWith('app.')) {
        if (base && base !== cleanHost) {
          const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
          return res.redirect(302, `${proto}://m.${base}/merchant/`);
        }
      }
    }
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/merchant-app/index.html'));
});


// POS App Assets (standalone cashier execution surface)
app.use('/pos/assets', express.static(path.join(__dirname, '../apps/pos-app/assets'), {
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// POS App entry point. Cashier is routed here by the unified auth landing resolver.
app.get([/^\/pos(\/.*)?$/, /^\/pos-app(\/.*)?$/], async (req, res) => {
  if (!isSaaSHost(req)) {
    const cleanHost = (req.headers.host || '').split(':')[0].trim().toLowerCase();
    await brandRepository.ready();
    const brand = brandRepository.findByCustomDomain(cleanHost);
    if (!brand) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'Brand/Tenant tidak ditemukan untuk host yang diberikan.'
      });
    }

    const subType = getRequestSubdomainType(req);
    if (subType === 'pos') {
      return res.redirect(301, '/');
    }
    if (process.env.NODE_ENV !== 'test') {
      const base = getBaseTenantDomain(req);
      if (base && base !== cleanHost) {
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        return res.redirect(302, `${proto}://pos.${base}/`);
      }
    }
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../apps/pos-app/index.html'));
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

// Fallback: SaaS Control Plane redirects to public landing page; Subdomains serve their respective app; Tenant domains serve customer PWA
app.get('*', (req, res) => {
  const host = req.headers.host || '';
  const cleanHost = host.split(':')[0].trim().toLowerCase();

  // On xentra.cloud SaaS control plane, send unmatched paths to the public landing page
  if (cleanHost === 'xentra.cloud') {
    return res.redirect(302, '/');
  }

  const subType = getRequestSubdomainType(req);
  if (subType === 'managerial') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/managerial-entry.html'));
  }
  if (subType === 'owner') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(__dirname, '../apps/merchant-dashboard/index.html'));
  }
  if (subType === 'pos') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(__dirname, '../apps/pos-app/index.html'));
  }

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
      console.error('[Xentra Core Fatal] Database initialization failed:', err.message);
      if (process.env.NODE_ENV === 'production') {
        console.error('[Xentra Core Fatal] Refusing to start HTTP server without authoritative persistent database in production.');
        process.exit(1);
      }
      startServer(); // Start anyway in non-production environments
    });
  } else {
    startServer();
  }
}

module.exports = app;
