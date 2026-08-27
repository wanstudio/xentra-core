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

        // 2. Try match by brand slug parameter (for local/testing/subdomain)
        if (!brand && brandParam) {
          brand = db.prepare('SELECT * FROM brands WHERE slug = ?').get(brandParam);
        }

        // 3. Default fallback to first active brand (e.g. Bangjo)
        if (!brand) {
          brand = db.prepare('SELECT * FROM brands ORDER BY created_at ASC LIMIT 1').get();
        }
      } catch (dbErr) {
        console.warn('[TenantResolver DB lookup warn]:', dbErr.message);
      }
    }

    if (!brand) {
      brand = {
        id: 'brand_bangjo_master',
        organization_id: 'org_xentra_holding',
        name: 'Bangjo Resto',
        slug: 'bangjo',
        logo_url: 'https://app.mybangjo.com/wp-content/plugins/xentra-mvp/assets/icons/logo_bangjo.png',
        primary_color: '#b6ff00'
      };
    }

    req.brand = brand;
    req.brand_id = brand.id;
    req.organization_id = brand.organization_id;

    next();
  } catch (err) {
    console.error('[TenantResolver Error]:', err);
    req.brand = {
      id: 'brand_bangjo_master',
      organization_id: 'org_xentra_holding',
      name: 'Bangjo Resto',
      slug: 'bangjo',
      logo_url: 'https://app.mybangjo.com/wp-content/plugins/xentra-mvp/assets/icons/logo_bangjo.png',
      primary_color: '#b6ff00'
    };
    req.brand_id = req.brand.id;
    req.organization_id = req.brand.organization_id;
    next();
  }
}

module.exports = tenantResolver;
