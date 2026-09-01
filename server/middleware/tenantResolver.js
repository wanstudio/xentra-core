const db = require('../database/db');

function tenantResolver(req, res, next) {
  try {
    const host = req.headers.host || '';
    const cleanHost = host.split(':')[0].toLowerCase();
    const brandParam = req.query.brand || req.headers['x-brand-slug'] || '';

    let brand = null;

    if (db && typeof db.prepare === 'function') {
      try {
        // 1. Match by custom domain
        if (cleanHost) {
          brand = db.prepare('SELECT * FROM brands WHERE custom_domain = ?').get(cleanHost);
        }

        // 2. Match by brand slug parameter / header
        if (!brand && brandParam) {
          brand = db.prepare('SELECT * FROM brands WHERE slug = ?').get(brandParam);
        }

        // 3. Match known host variations (dev.mybangjo.com, app.mybangjo.com, *.bangjo.*)
        if (!brand && cleanHost.includes('bangjo')) {
          brand = db.prepare("SELECT * FROM brands WHERE slug = 'bangjo' OR custom_domain LIKE '%bangjo%' LIMIT 1").get();
        }

        // 4. Localhost, loopback, private IP, staging, or default fallback
        const isLocalOrDev = !cleanHost ||
          cleanHost === 'localhost' ||
          cleanHost === '127.0.0.1' ||
          cleanHost === '::1' ||
          cleanHost.startsWith('192.168.') ||
          cleanHost.startsWith('10.') ||
          cleanHost.startsWith('172.') ||
          process.env.NODE_ENV !== 'production';

        if (!brand && isLocalOrDev) {
          brand = db.prepare('SELECT * FROM brands ORDER BY created_at ASC LIMIT 1').get();
        }

        // 5. Ultimate single-tenant resilience fallback
        if (!brand) {
          brand = db.prepare('SELECT * FROM brands WHERE slug = ?').get(process.env.DEFAULT_BRAND_SLUG || 'bangjo') ||
                  db.prepare('SELECT * FROM brands ORDER BY created_at ASC LIMIT 1').get();
        }
      } catch (dbErr) {
        console.error('[TenantResolver DB lookup failure]:', dbErr.message);
        return res.status(503).json({
          success: false,
          error: 'DATABASE_UNAVAILABLE',
          message: 'Layanan database tidak tersedia saat menyelesaikan tenant.'
        });
      }
    }

    // STRICT MULTI-TENANT SECURITY BOUNDARY: Fail-Fast only if database has zero brands
    if (!brand) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'Brand/Tenant tidak ditemukan untuk host atau parameter yang diberikan.'
      });
    }

    req.brand = brand;
    req.brand_id = brand.id;
    req.organization_id = brand.organization_id;

    next();
  } catch (err) {
    console.error('[TenantResolver Error]:', err);
    return res.status(500).json({
      success: false,
      error: 'TENANT_RESOLUTION_ERROR',
      message: 'Gagal menyelesaikan tenant.'
    });
  }
}

module.exports = tenantResolver;
