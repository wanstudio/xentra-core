const db = require('../database/db');

async function tenantResolver(req, res, next) {
  try {
    if (db && db.readyPromise) {
      await db.readyPromise;
    }

    const host = req.headers.host || '';
    const cleanHost = host.split(':')[0].toLowerCase();
    const brandParam = req.query.brand || req.headers['x-brand-slug'] || '';

    let brand = null;

    if (db && typeof db.prepare === 'function') {
      try {
        // 1. Match by exact custom domain
        if (cleanHost) {
          brand = db.prepare('SELECT * FROM brands WHERE custom_domain = ?').get(cleanHost);
        }

        // 2. Match by brand slug parameter / header
        if (!brand && brandParam) {
          brand = db.prepare('SELECT * FROM brands WHERE slug = ? OR id = ?').get(brandParam, brandParam);
        }

        // 3. Match the authoritative Bangjo domain only (strict equality, NO substring matching)
        if (!brand && cleanHost === 'app.mybangjo.com') {
          brand = db.prepare("SELECT * FROM brands WHERE slug = 'bangjo' LIMIT 1").get();
        }

        // 4. Localhost / Test Environment Isolation Fallback ONLY (Never in production for unknown hosts)
        const isLocalOrTest = !cleanHost ||
          cleanHost === 'localhost' ||
          cleanHost === '127.0.0.1' ||
          cleanHost === '::1' ||
          process.env.NODE_ENV === 'test';

        if (!brand && isLocalOrTest) {
          brand = db.prepare('SELECT * FROM brands ORDER BY created_at ASC LIMIT 1').get();
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

    // STRICT MULTI-TENANT SECURITY BOUNDARY: Fail-Closed if tenant is unknown
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
