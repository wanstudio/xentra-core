'use strict';

const MaterialService = require('../../domains/material/services/MaterialService');
const { MaterialRepository, UomRepository } = require('../../core/data/repositories');

const materialRepository = new MaterialRepository();
const uomRepository = new UomRepository();

function registerAdminMaterialRoutes(router, deps = {}) {
  const requireAuth = typeof deps.requireAuth === 'function' ? deps.requireAuth : () => (req, res, next) => next();
  const authGate = requireAuth(['owner', 'brand_manager']);

  // GET /admin/uoms — List all active UOMs for recipe/material configuration
  router.get('/admin/uoms', authGate, (req, res) => {
    try {
      const uoms = uomRepository.listActive();
      return res.json({ success: true, uoms });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /admin/materials — List materials for current organization
  router.get('/admin/materials', authGate, (req, res) => {
    try {
      const orgId = req.user?.organization_id || req.brand?.organization_id || 'org_xentra_holding';
      const materials = materialRepository.listByOrganization(orgId, {
        includeArchived: req.query.include_archived === 'true'
      });
      return res.json({ success: true, materials });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /admin/materials — Create a new canonical Material
  router.post('/admin/materials', authGate, (req, res) => {
    try {
      const orgId = req.user?.organization_id || req.brand?.organization_id || 'org_xentra_holding';
      const { material_code, name, description, base_uom_id, status } = req.body || {};

      const created = MaterialService.createMaterial({
        organizationId: orgId,
        materialCode: material_code,
        name,
        description,
        baseUomId: base_uom_id,
        status: status || 'ACTIVE',
        repository: materialRepository,
        uomRepo: uomRepository
      });

      return res.status(201).json({ success: true, material: created });
    } catch (err) {
      const statusCode = err.code?.includes('REQUIRED') || err.code?.includes('INVALID') || err.code?.includes('EXISTS') ? 400 : 500;
      return res.status(statusCode).json({ success: false, error: err.message, code: err.code });
    }
  });

  // PUT /admin/materials/:id/archive — Archive a material
  router.put('/admin/materials/:id/archive', authGate, (req, res) => {
    try {
      const updated = MaterialService.archiveMaterial({
        materialId: req.params.id,
        repository: materialRepository
      });
      return res.json({ success: true, material: updated });
    } catch (err) {
      const statusCode = err.code?.includes('NOT_FOUND') ? 404 : 400;
      return res.status(statusCode).json({ success: false, error: err.message, code: err.code });
    }
  });

  // PUT /admin/materials/:id/status — Update material status (ACTIVE, DRAFT, ARCHIVED)
  router.put('/admin/materials/:id/status', authGate, (req, res) => {
    try {
      const { status } = req.body || {};
      const targetStatus = String(status || '').toUpperCase();
      if (!['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(targetStatus)) {
        return res.status(400).json({ success: false, error: 'Status must be ACTIVE, DRAFT, or ARCHIVED' });
      }
      const now = new Date().toISOString();
      materialRepository.updateStatus({ id: req.params.id, status: targetStatus, updatedAt: now });
      const updated = materialRepository.findById(req.params.id);
      return res.json({ success: true, material: updated });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = registerAdminMaterialRoutes;
