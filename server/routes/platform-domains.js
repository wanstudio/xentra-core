'use strict';

/**
 * Platform Domain Management Routes (Control Plane)
 *
 * Locked architecture contract:
 * - Resource: /api/v1/platform/domains
 * - Authority: PLATFORM_ADMIN / PLATFORM_OWNER (Xentra Workforce)
 * - Permissions: domain:read, domain:create, domain:verify, domain:update, domain:disable, domain:delete
 */

const { TenantDomainRepository, BrandRepository } = require('../../core/data/repositories');
const { DomainVerificationService, DomainProvisioningService } = require('../../core/domain-management');
const { PermissionModel } = require('../../core/identity');

module.exports = function registerPlatformDomainRoutes(router, deps) {
  const {
    db,
    requirePlatformAuth
  } = deps;

  const domainRepo = new TenantDomainRepository();
  const brandRepo = new BrandRepository();
  const verificationService = new DomainVerificationService({ domainRepository: domainRepo });
  const provisioningService = new DomainProvisioningService({ domainRepository: domainRepo });

  // Helper permission guard: checks if platform session has specified permission
  function requireDomainPerm(permission) {
    return (req, res, next) => {
      const userRole = req.platformUser?.role;
      if (!PermissionModel.hasPermission(userRole, permission)) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: `Kewenangan "${permission}" ditolak untuk role "${userRole}".`
        });
      }
      next();
    };
  }

  /**
   * 1. GET /api/v1/platform/domains
   * List all domains with optional filters
   */
  router.get(
    ['/platform/domains', '/api/v1/platform/domains'],
    requirePlatformAuth(),
    requireDomainPerm('domain:read'),
    async (req, res) => {
      try {
        const { brand_id, organization_id, status, surface_type } = req.query || {};
        const domains = domainRepo.findAll({
          brand_id: brand_id ? String(brand_id).trim() : undefined,
          organization_id: organization_id ? String(organization_id).trim() : undefined,
          status: status ? String(status).trim() : undefined,
          surface_type: surface_type ? String(surface_type).trim() : undefined
        });

        res.json({
          success: true,
          count: domains.length,
          domains
        });
      } catch (err) {
        console.error('[PlatformDomains:list Error]:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * 2. POST /api/v1/platform/domains
   * Register a new client domain
   */
  router.post(
    ['/platform/domains', '/api/v1/platform/domains'],
    requirePlatformAuth(),
    requireDomainPerm('domain:create'),
    async (req, res) => {
      try {
        const { hostname, organization_id, brand_id, surface_type, is_primary } = req.body || {};

        if (!hostname || typeof hostname !== 'string' || !hostname.trim()) {
          return res.status(400).json({
            success: false,
            error: 'VALIDATION_ERROR',
            message: 'Hostname wajib diisi.'
          });
        }

        const cleanHost = hostname.trim().toLowerCase();

        // Validate hostname format
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanHost)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_HOSTNAME',
            message: 'Format hostname tidak valid.'
          });
        }

        if (!organization_id || !brand_id) {
          return res.status(400).json({
            success: false,
            error: 'VALIDATION_ERROR',
            message: 'organization_id dan brand_id wajib diisi.'
          });
        }

        // Verify that target brand belongs to the target organization
        const brand = brandRepo.findById(brand_id);
        if (!brand) {
          return res.status(404).json({
            success: false,
            error: 'BRAND_NOT_FOUND',
            message: `Brand "${brand_id}" tidak ditemukan.`
          });
        }
        if (brand.organization_id !== organization_id) {
          return res.status(400).json({
            success: false,
            error: 'TENANT_MISMATCH',
            message: 'Brand tidak berada di bawah organization_id yang diberikan.'
          });
        }

        // Check duplicate hostname in registry
        const existing = domainRepo.findByHostname(cleanHost);
        if (existing) {
          return res.status(409).json({
            success: false,
            error: 'DOMAIN_ALREADY_EXISTS',
            message: `Hostname "${cleanHost}" sudah terdaftar pada tenant lain.`
          });
        }

        const verificationToken = verificationService.generateVerificationToken(cleanHost);

        const created = domainRepo.create({
          hostname: cleanHost,
          organization_id,
          brand_id,
          surface_type: surface_type || 'customer',
          is_primary: is_primary ? 1 : 0,
          verification_status: 'pending',
          verification_method: 'dns_txt',
          verification_token: verificationToken,
          provisioning_status: 'unprovisioned',
          tls_status: 'pending',
          status: 'active'
        });

        const instructions = verificationService.getVerificationInstructions(created);

        res.status(201).json({
          success: true,
          message: `Domain "${cleanHost}" berhasil didaftarkan.`,
          domain: created,
          verification: instructions
        });
      } catch (err) {
        console.error('[PlatformDomains:create Error]:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * 3. GET /api/v1/platform/domains/:id
   * Get single domain details
   */
  router.get(
    ['/platform/domains/:id', '/api/v1/platform/domains/:id'],
    requirePlatformAuth(),
    requireDomainPerm('domain:read'),
    async (req, res) => {
      try {
        const domain = domainRepo.findById(req.params.id);
        if (!domain) {
          return res.status(404).json({
            success: false,
            error: 'NOT_FOUND',
            message: 'Domain tidak ditemukan.'
          });
        }

        const instructions = verificationService.getVerificationInstructions(domain);

        res.json({
          success: true,
          domain,
          verification: instructions
        });
      } catch (err) {
        console.error('[PlatformDomains:get Error]:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * 4. PATCH /api/v1/platform/domains/:id
   * Update mutable attributes (surface_type, is_primary)
   */
  router.patch(
    ['/platform/domains/:id', '/api/v1/platform/domains/:id'],
    requirePlatformAuth(),
    requireDomainPerm('domain:update'),
    async (req, res) => {
      try {
        const domain = domainRepo.findById(req.params.id);
        if (!domain) {
          return res.status(404).json({
            success: false,
            error: 'NOT_FOUND',
            message: 'Domain tidak ditemukan.'
          });
        }

        const { surface_type, is_primary } = req.body || {};
        const updates = {};
        if (surface_type !== undefined) updates.surface_type = surface_type;
        if (is_primary !== undefined) updates.is_primary = is_primary;

        const updated = domainRepo.update(domain.id, updates);

        res.json({
          success: true,
          message: 'Domain berhasil diperbarui.',
          domain: updated
        });
      } catch (err) {
        console.error('[PlatformDomains:patch Error]:', err);
        res.status(400).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * 5. POST /api/v1/platform/domains/:id/verify
   * Trigger DNS TXT verification check
   */
  router.post(
    ['/platform/domains/:id/verify', '/api/v1/platform/domains/:id/verify'],
    requirePlatformAuth(),
    requireDomainPerm('domain:verify'),
    async (req, res) => {
      try {
        const domain = domainRepo.findById(req.params.id);
        if (!domain) {
          return res.status(404).json({
            success: false,
            error: 'NOT_FOUND',
            message: 'Domain tidak ditemukan.'
          });
        }

        const verifyResult = await verificationService.verifyDomain(domain.id);

        if (verifyResult.success) {
          // If DNS verified, automatically trigger background provisioning if unprovisioned
          if (verifyResult.record.provisioning_status === 'unprovisioned') {
            await provisioningService.provisionDomain(domain.id);
          }
        }

        const latest = domainRepo.findById(domain.id);

        res.json({
          success: verifyResult.success,
          status: latest.verification_status,
          message: verifyResult.message,
          domain: latest
        });
      } catch (err) {
        console.error('[PlatformDomains:verify Error]:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * 6. POST /api/v1/platform/domains/:id/activate
   */
  router.post(
    ['/platform/domains/:id/activate', '/api/v1/platform/domains/:id/activate'],
    requirePlatformAuth(),
    requireDomainPerm('domain:update'),
    async (req, res) => {
      try {
        const domain = domainRepo.findById(req.params.id);
        if (!domain) {
          return res.status(404).json({
            success: false,
            error: 'NOT_FOUND',
            message: 'Domain tidak ditemukan.'
          });
        }

        const updated = domainRepo.update(domain.id, { status: 'active' });
        res.json({
          success: true,
          message: `Domain "${domain.hostname}" telah diaktifkan.`,
          domain: updated
        });
      } catch (err) {
        console.error('[PlatformDomains:activate Error]:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * 7. POST /api/v1/platform/domains/:id/disable
   */
  router.post(
    ['/platform/domains/:id/disable', '/api/v1/platform/domains/:id/disable'],
    requirePlatformAuth(),
    requireDomainPerm('domain:disable'),
    async (req, res) => {
      try {
        const domain = domainRepo.findById(req.params.id);
        if (!domain) {
          return res.status(404).json({
            success: false,
            error: 'NOT_FOUND',
            message: 'Domain tidak ditemukan.'
          });
        }

        const updated = domainRepo.update(domain.id, { status: 'disabled' });
        res.json({
          success: true,
          message: `Domain "${domain.hostname}" telah dinonaktifkan.`,
          domain: updated
        });
      } catch (err) {
        console.error('[PlatformDomains:disable Error]:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  /**
   * 8. DELETE /api/v1/platform/domains/:id
   */
  router.delete(
    ['/platform/domains/:id', '/api/v1/platform/domains/:id'],
    requirePlatformAuth(),
    requireDomainPerm('domain:delete'),
    async (req, res) => {
      try {
        const domain = domainRepo.findById(req.params.id);
        if (!domain) {
          return res.status(404).json({
            success: false,
            error: 'NOT_FOUND',
            message: 'Domain tidak ditemukan.'
          });
        }

        // Deprovision before deletion
        try {
          await provisioningService.deprovisionDomain(domain.id);
        } catch (_) {}

        domainRepo.delete(domain.id);

        res.json({
          success: true,
          message: `Domain "${domain.hostname}" berhasil dihapus.`
        });
      } catch (err) {
        console.error('[PlatformDomains:delete Error]:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );
};
