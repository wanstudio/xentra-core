const db = require('../database/db');

function tenantResolver(req, res, next) {
  try {
    const host = req.headers.host || '';
    const brandParam = req.query.brand || req.headers['x-brand-slug'] || '';

    let brand = null;

    if (db && typeof db.prepare === 'function') {
      try {
        // 1. Try match by custom domain
        if (host) {
          const cleanHost = host.split(':')[0].toLowerCase();
          brand = db.prepare('SELECT * FROM brands WHERE custom_domain = ?').get(cleanHost);
        }

        // 2. Try match by brand slug parameter (for local/testing/subdomain/header)
        if (!brand && brandParam) {
          brand = db.prepare('SELECT * FROM brands WHERE slug = ?').get(brandParam);
        }

        // 3. For public/local testing without brand slug, check if single brand in development
        if (!brand && (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development')) {
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

    // STRICT MULTI-TENANT SECURITY BOUNDARY: Fail-Fast if tenant cannot be resolved
    if (!brand) {
      // In test/dev environment, provide fallback only if explicitly permitted
      if (process.env.NODE_ENV === 'test') {
        brand = {
          id: 'brand_test_default',
          organization_id: 'org_test_default',
          name: 'Test Brand',
          slug: 'test-default'
        };
      } else {
        return res.status(404).json({
          success: false,
          error: 'TENANT_NOT_FOUND',
          message: 'Brand/Tenant tidak ditemukan untuk host atau parameter yang diberikan.'
        });
      }
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

