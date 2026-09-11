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
      '/auth/resend-verification'
    ];
    if (publicPaths.includes(req.path) || req.path.startsWith('/platform') || req.path.startsWith('/api/v1/platform')) {
      return next();
    }

    const host = req.headers.host || '';
    const cleanHost = host.split(':')[0].toLowerCase();

    // xentra.cloud is the SaaS Control Plane surface (no tenant resolution needed for control-plane requests)
    if (cleanHost === 'xentra.cloud') {
      return next();
    }

    let brand = null;

    try {
      // Production tenant resolution is authoritative: exact host → registered custom domain.
      // Client-specific hostnames must never be hardcoded in application code.
      if (cleanHost) {
        brand = brandRepository.findByCustomDomain(cleanHost);
      }

      // Localhost/test fallback exists only to keep isolated development/test execution practical.
      // It must never become a production tenant-selection mechanism.
      const isLocalOrTest = !cleanHost ||
        cleanHost === 'localhost' ||
        cleanHost === '127.0.0.1' ||
        cleanHost === '::1' ||
        process.env.NODE_ENV === 'test';

      if (!brand && isLocalOrTest) {
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
