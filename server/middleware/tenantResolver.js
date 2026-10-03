const { BrandRepository, TenantDomainRepository } = require('../../core/data/repositories');
const TenantDomainResolver = require('../../core/identity/TenantDomainResolver');

const brandRepository = new BrandRepository();
const domainRepository = new TenantDomainRepository();
const tenantDomainResolver = new TenantDomainResolver({
  domainRepository,
  brandRepository
});

async function tenantResolver(req, res, next) {
  try {
    await tenantDomainResolver.ready();

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
      '/webhooks/doku',
      '/api/v1/webhooks/doku',
      '/api/webhooks/doku',
      '/webhooks/midtrans',
      '/api/v1/webhooks/midtrans',
      '/api/webhooks/midtrans',
      '/onboarding/claim',
      '/api/v1/onboarding/claim'
    ];
    if (publicPaths.includes(req.path) || req.path.startsWith('/platform') || req.path.startsWith('/api/v1/platform') || req.path.startsWith('/onboarding') || req.path.startsWith('/api/v1/onboarding')) {
      return next();
    }

    const host = req.headers.host || '';
    const cleanHost = host.split(':')[0].trim().toLowerCase();

    // xentra.cloud and biz.xentra.cloud are Xentra SaaS surfaces (Control Plane + Business Portal).
    // Tenant/brand context is derived from the authenticated session in requireAuth, not the domain.
    if (cleanHost === 'xentra.cloud' || cleanHost === 'biz.xentra.cloud') {
      // Check if an explicit tenant brand context was provided via headers or query (e.g. customer-pwa on xentra.cloud)
      const explicitSlug = req.headers['x-brand-slug'] || (req.query && req.query.brand_slug);
      const explicitBrandId = req.headers['x-brand-id'] || (req.query && req.query.brand_id);

      if (explicitSlug) {
        const brandBySlug = brandRepository.findBySlug(String(explicitSlug).trim());
        if (brandBySlug) {
          req.brand = brandBySlug;
          req.brand_id = brandBySlug.id;
          req.organization_id = brandBySlug.organization_id;
          req.surface_type = 'customer';
          return next();
        }
      }

      if (explicitBrandId) {
        const brandById = brandRepository.findById(String(explicitBrandId).trim());
        if (brandById) {
          req.brand = brandById;
          req.brand_id = brandById.id;
          req.organization_id = brandById.organization_id;
          req.surface_type = 'customer';
          return next();
        }
      }

      // If a registered client domain executes handoff exchange against xentra.cloud control-plane, resolve brand from Origin
      if ((req.path === '/auth/handoff/exchange' || req.path === '/api/v1/auth/handoff/exchange') && req.headers.origin) {
        try {
          const originHost = new URL(req.headers.origin).hostname.toLowerCase().trim();
          const originContext = await tenantDomainResolver.resolve(originHost);
          if (originContext) {
            req.brand = originContext.brand;
            req.brand_id = originContext.brand_id;
            req.organization_id = originContext.organization_id;
            req.surface_type = originContext.surface_type;
            req.domain_record = originContext.domain_record;
            return next();
          }
        } catch (_) {}
      }
      return next();
    }

    let resolved = null;

    try {
      // Production tenant resolution is authoritative: exact host → registered custom domain in persistent registry.
      // Client-specific hostnames must never be hardcoded in application code.
      if (cleanHost) {
        resolved = await tenantDomainResolver.resolve(cleanHost);
      }

      // Localhost fallback exists only to keep isolated local developer execution practical.
      // It must never become a production tenant-selection mechanism or allow unknown domains to bypass resolution.
      const isLocal = !cleanHost ||
        cleanHost === 'localhost' ||
        cleanHost === '127.0.0.1' ||
        cleanHost === '::1';

      if (!resolved && isLocal) {
        const localBrand = brandRepository.findFirstForLocalDevelopment();
        if (localBrand) {
          resolved = {
            organization_id: localBrand.organization_id,
            brand_id: localBrand.id,
            surface_type: 'customer',
            hostname: 'localhost',
            is_primary: true,
            domain_record: null,
            brand: localBrand
          };
        }
      }
    } catch (dbErr) {
      console.error('[TenantResolver DB lookup failure]:', dbErr.message);
      return res.status(503).json({
        success: false,
        error: 'DATABASE_UNAVAILABLE',
        message: 'Layanan database tidak tersedia saat menyelesaikan tenant.'
      });
    }

    // STRICT MULTI-TENANT SECURITY BOUNDARY: Fail closed if the host is not registered or resolved.
    if (!resolved || !resolved.brand) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'Brand/Tenant tidak ditemukan untuk host yang diberikan.'
      });
    }

    req.brand = resolved.brand;
    req.brand_id = resolved.brand_id;
    req.organization_id = resolved.organization_id;
    req.surface_type = resolved.surface_type;
    req.domain_record = resolved.domain_record;

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
