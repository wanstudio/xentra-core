const { BrandRepository } = require('../../core/data/repositories');

const brandRepository = new BrandRepository();

async function tenantResolver(req, res, next) {
  try {
    await brandRepository.ready();

    // Public platform routes & Control Plane endpoints originate before a tenant/brand exists
    // or operate at the platform level without tenant resolution.
    const publicPaths = [
      '/auth/register',
      '/api/v1/auth/register',
      '/auth/google',
      '/api/v1/auth/google',
      '/auth/google-onboard',
      '/api/v1/auth/google-onboard',
      '/verify-email',
      '/api/v1/auth/verify-email',
      '/auth/verify-email',
      '/api/v1/auth/resend-verification',
      '/auth/broker',
      '/onboarding/check-domain',
      '/api/v1/onboarding/check-domain',
      '/onboarding/claim',
      '/api/v1/onboarding/claim'
    ];
    if (publicPaths.includes(req.path) || req.path.startsWith('/platform') || req.path.startsWith('/api/v1/platform') || req.path.startsWith('/onboarding') || req.path.startsWith('/api/v1/onboarding')) {
      return next();
    }

    const host = req.headers.host || '';
    const cleanHost = host.split(':')[0].trim().toLowerCase();

    // xentra.cloud is the SaaS Control Plane surface (no tenant resolution needed for control-plane requests)
    if (cleanHost === 'xentra.cloud') {
      // Check if an explicit tenant brand context was provided via headers or query (e.g. customer-pwa on xentra.cloud)
      const explicitSlug = req.headers['x-brand-slug'] || (req.query && req.query.brand_slug);
      const explicitBrandId = req.headers['x-brand-id'] || (req.query && req.query.brand_id);

      if (explicitSlug) {
        const brandBySlug = brandRepository.findBySlug(String(explicitSlug).trim());
        if (brandBySlug) {
          req.brand = brandBySlug;
          req.brand_id = brandBySlug.id;
          req.organization_id = brandBySlug.organization_id;
          return next();
        }
      }

      if (explicitBrandId) {
        const brandById = brandRepository.findById(String(explicitBrandId).trim());
        if (brandById) {
          req.brand = brandById;
          req.brand_id = brandById.id;
          req.organization_id = brandById.organization_id;
          return next();
        }
      }

      // If a registered client domain executes handoff exchange against xentra.cloud control-plane, resolve brand from Origin
      if ((req.path === '/auth/handoff/exchange' || req.path === '/api/v1/auth/handoff/exchange') && req.headers.origin) {
        try {
          const originHost = new URL(req.headers.origin).hostname.toLowerCase().trim();
          const originBrand = brandRepository.findByCustomDomain(originHost);
          if (originBrand) {
            req.brand = originBrand;
            req.brand_id = originBrand.id;
            req.organization_id = originBrand.organization_id;
            return next();
          }
        } catch (_) {}
      }
      return next();
    }

    let brand = null;

    try {
      // Production tenant resolution is authoritative: exact host → registered custom domain.
      // Client-specific hostnames must never be hardcoded in application code.
      if (cleanHost) {
        brand = brandRepository.findByCustomDomain(cleanHost);
      }

      // Localhost fallback exists only to keep isolated local developer execution practical.
      // It must never become a production tenant-selection mechanism or allow unknown domains to bypass resolution.
      const isLocal = !cleanHost ||
        cleanHost === 'localhost' ||
        cleanHost === '127.0.0.1' ||
        cleanHost === '::1';

      if (!brand && isLocal) {
        brand = brandRepository.findFirstForLocalDevelopment();
      }
    } catch (dbErr) {
      console.error('[TenantResolver DB lookup failure]:', dbErr.message);
      return res.status(503).json({
        success: false,
        error: 'DATABASE_UNAVAILABLE',
        message: 'Layanan database tidak tersedia saat menyelesaikan tenant.'
      });
    }

    // STRICT MULTI-TENANT SECURITY BOUNDARY: Fail closed if the host is not registered.
    if (!brand) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'Brand/Tenant tidak ditemukan untuk host yang diberikan.'
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
