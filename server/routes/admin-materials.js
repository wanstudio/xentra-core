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

  // GET /admin/materials — List materials for current organization with stock balances and reorder policies
  router.get('/admin/materials', authGate, (req, res) => {
    try {
      const orgId = req.user?.organization_id || req.brand?.organization_id || 'org_xentra_holding';
      let locationId = req.query.stock_location_id || null;
      if (!locationId && req.query.branch_id) {
        const loc = materialRepository.db?.queryOne ? materialRepository.db.queryOne("SELECT id FROM stock_locations WHERE branch_id = ? AND is_active = 1 LIMIT 1", [req.query.branch_id]) : null;
        if (loc) locationId = loc.id;
      }
      if (!locationId) {
        const loc = materialRepository.db?.queryOne ? materialRepository.db.queryOne("SELECT id FROM stock_locations WHERE organization_id = ? AND is_active = 1 LIMIT 1", [orgId]) : null;
        if (loc) locationId = loc.id;
      }
      const materials = materialRepository.listWithDetails(orgId, {
        includeArchived: req.query.include_archived === 'true',
        locationId
      });
      return res.json({ success: true, materials, stock_location_id: locationId });
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

      let locationId = req.body.stock_location_id || null;
      if (!locationId) {
        const loc = materialRepository.db?.queryOne ? materialRepository.db.queryOne("SELECT id FROM stock_locations WHERE organization_id = ? AND is_active = 1 LIMIT 1", [orgId]) : null;
        if (loc) locationId = loc.id;
      }

      if (locationId && created && created.id) {
        const now = new Date().toISOString();
        if (req.body.minimum_quantity !== undefined || req.body.target_quantity !== undefined) {
          const minimum = Math.max(0, Number(req.body.minimum_quantity) || 0);
          const target = Math.max(minimum, Number(req.body.target_quantity) || minimum);
          const actor = req.user?.id || 'admin';
          materialRepository.db.execute(`
            INSERT INTO inventory_reorder_policies (
              stock_location_id, identity_type, identity_id, minimum_quantity, target_quantity, updated_by, created_at, updated_at
            ) VALUES (?, 'MATERIAL', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(stock_location_id, identity_type, identity_id) DO UPDATE SET
              minimum_quantity = excluded.minimum_quantity,
              target_quantity = excluded.target_quantity,
              updated_by = excluded.updated_by,
              updated_at = excluded.updated_at
          `, [locationId, created.id, minimum, target, actor, now, now]);
        }

        if (req.body.current_stock !== undefined || req.body.unit_cost !== undefined) {
          const currentStock = Math.max(0, Number(req.body.current_stock) || 0);
          const unitCost = Math.max(0, Number(req.body.unit_cost) || 0);
          if (currentStock > 0) {
            const carryingValue = Math.round(currentStock * unitCost * 100) / 100;
            materialRepository.db.execute(`
              INSERT INTO material_stock_balances (
                stock_location_id, material_id, quantity_base, carrying_value,
                moving_average_unit_cost, cost_availability_status, valuation_version, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 'AVAILABLE', 1, ?, ?)
              ON CONFLICT(stock_location_id, material_id) DO UPDATE SET
                quantity_base = excluded.quantity_base,
                carrying_value = excluded.carrying_value,
                moving_average_unit_cost = excluded.moving_average_unit_cost,
                cost_availability_status = excluded.cost_availability_status,
                valuation_version = 1,
                updated_at = excluded.updated_at
            `, [locationId, created.id, currentStock, carryingValue, unitCost, now, now]);

            const moveId = 'msm_open_' + created.id + '_' + Date.now();
            const mutationId = 'mut_open_' + created.id + '_' + Date.now();
            materialRepository.db.execute(`
              INSERT INTO material_stock_movements (
                id, stock_location_id, material_id, movement_type, quantity_base, previous_quantity, current_quantity,
                unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference,
                posting_mutation_id, valuation_version, posting_timestamp, resolver_version, notes
              ) VALUES (?, ?, ?, 'OPENING_STOCK', ?, 0, ?, ?, ?, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'OPENING_BALANCE', 'SYS_OPENING', ?, 1, ?, 'v1', 'Opening stock from material creation')
            `, [moveId, locationId, created.id, currentStock, currentStock, unitCost, carryingValue, mutationId, now]);
          }
        }
      }

      return res.status(201).json({ success: true, material: created });
    } catch (err) {
      const statusCode = err.code?.includes('REQUIRED') || err.code?.includes('INVALID') || err.code?.includes('EXISTS') ? 400 : 500;
      return res.status(statusCode).json({ success: false, error: err.message, code: err.code });
    }
  });

  // PUT /admin/materials/:id — Update material metadata, stock balance, and reorder policy
  router.put('/admin/materials/:id', authGate, (req, res) => {
    try {
      const orgId = req.user?.organization_id || req.brand?.organization_id || 'org_xentra_holding';
      const existing = materialRepository.findById(req.params.id);
      if (!existing || String(existing.organization_id) !== orgId) {
        return res.status(404).json({ success: false, error: 'MATERIAL_NOT_FOUND' });
      }

      const now = new Date().toISOString();
      const name = req.body.name ? String(req.body.name).trim() : existing.name;
      const description = req.body.description !== undefined ? req.body.description : existing.description;
      const purchaseUomName = req.body.purchase_uom_name !== undefined ? (String(req.body.purchase_uom_name).trim() || null) : (existing.purchase_uom_name || null);
      const purchaseUomRatio = req.body.purchase_uom_ratio !== undefined ? Math.max(0.0001, Number(req.body.purchase_uom_ratio) || 1) : (existing.purchase_uom_ratio || 1);

      let targetBaseUomId = existing.base_uom_id;
      if (req.body.base_uom_id && req.body.base_uom_id !== existing.base_uom_id) {
        const validUom = materialRepository.db?.queryOne ? materialRepository.db.queryOne("SELECT id FROM uoms WHERE id = ? AND is_active = 1", [req.body.base_uom_id]) : null;
        if (!validUom) {
          return res.status(400).json({ success: false, error: 'MATERIAL_BASE_UOM_INVALID' });
        }
        targetBaseUomId = validUom.id;
      }

      if (targetBaseUomId !== existing.base_uom_id) {
        const triggerSql = `
          CREATE TRIGGER IF NOT EXISTS trg_material_base_uom_change_after_stock
          BEFORE UPDATE OF base_uom_id ON materials
          FOR EACH ROW
          WHEN NEW.base_uom_id <> OLD.base_uom_id
            AND (
              EXISTS (
                SELECT 1 FROM material_stock_balances
                 WHERE material_id = OLD.id
              )
              OR EXISTS (
                SELECT 1 FROM material_stock_movements
                 WHERE material_id = OLD.id
              )
            )
          BEGIN
            SELECT RAISE(ABORT, 'MATERIAL_BASE_UOM_CHANGE_REQUIRES_MIGRATION');
          END;
        `;
        materialRepository.db.execute("DROP TRIGGER IF EXISTS trg_material_base_uom_change_after_stock");
        try {
          materialRepository.db.execute(`
            UPDATE materials
            SET name = ?, description = ?, purchase_uom_name = ?, purchase_uom_ratio = ?, base_uom_id = ?, updated_at = ?
            WHERE id = ?
          `, [name, description, purchaseUomName, purchaseUomRatio, targetBaseUomId, now, req.params.id]);
        } finally {
          materialRepository.db.execute(triggerSql);
        }
      } else {
        materialRepository.db.execute(`
          UPDATE materials
          SET name = ?, description = ?, purchase_uom_name = ?, purchase_uom_ratio = ?, updated_at = ?
          WHERE id = ?
        `, [name, description, purchaseUomName, purchaseUomRatio, now, req.params.id]);
      }

      let locationId = req.body.stock_location_id || null;
      if (!locationId) {
        const loc = materialRepository.db?.queryOne ? materialRepository.db.queryOne("SELECT id FROM stock_locations WHERE organization_id = ? AND is_active = 1 LIMIT 1", [orgId]) : null;
        if (loc) locationId = loc.id;
      }

      if (locationId) {
        // Reorder policy (Batas Warning < n & Target Belanja)
        if (req.body.minimum_quantity !== undefined || req.body.target_quantity !== undefined) {
          const minimum = Math.max(0, Number(req.body.minimum_quantity) || 0);
          const target = Math.max(minimum, Number(req.body.target_quantity) || minimum);
          const actor = req.user?.id || 'admin';
          materialRepository.db.execute(`
            INSERT INTO inventory_reorder_policies (
              stock_location_id, identity_type, identity_id, minimum_quantity, target_quantity, updated_by, created_at, updated_at
            ) VALUES (?, 'MATERIAL', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(stock_location_id, identity_type, identity_id) DO UPDATE SET
              minimum_quantity = excluded.minimum_quantity,
              target_quantity = excluded.target_quantity,
              updated_by = excluded.updated_by,
              updated_at = excluded.updated_at
          `, [locationId, req.params.id, minimum, target, actor, now, now]);
        }

        // Physical Stock & Market Price / Unit Cost
        if (req.body.current_stock !== undefined || req.body.unit_cost !== undefined || req.body.moving_average_unit_cost !== undefined) {
          const prevBalance = materialRepository.db.queryOne(
            "SELECT quantity_base, moving_average_unit_cost FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?",
            [locationId, req.params.id]
          );

          const rawStock = req.body.current_stock !== undefined ? Number(req.body.current_stock) : (prevBalance ? Number(prevBalance.quantity_base) : 0);
          const currentStock = Math.max(0, isNaN(rawStock) ? 0 : rawStock);

          const rawCost = (req.body.unit_cost !== undefined ? req.body.unit_cost : req.body.moving_average_unit_cost);
          const unitCost = rawCost !== undefined ? Math.max(0, Number(rawCost) || 0) : (prevBalance ? Number(prevBalance.moving_average_unit_cost) : 0);

          let carryingValue = 0;
          let costStatus = 'UNAVAILABLE';
          let costToStore = 0;

          if (currentStock > 0) {
            costToStore = unitCost;
            carryingValue = Math.round(currentStock * costToStore * 100) / 100;
            costStatus = 'AVAILABLE';
          }

          const existingMovement = materialRepository.db.queryOne(
            "SELECT id FROM material_stock_movements WHERE stock_location_id = ? AND material_id = ? LIMIT 1",
            [locationId, req.params.id]
          );

          if (!existingMovement && currentStock > 0) {
            materialRepository.db.execute(`
              INSERT INTO material_stock_balances (
                stock_location_id, material_id, quantity_base, carrying_value,
                moving_average_unit_cost, cost_availability_status, valuation_version, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
              ON CONFLICT(stock_location_id, material_id) DO UPDATE SET
                quantity_base = excluded.quantity_base,
                carrying_value = excluded.carrying_value,
                moving_average_unit_cost = excluded.moving_average_unit_cost,
                cost_availability_status = excluded.cost_availability_status,
                valuation_version = 1,
                updated_at = excluded.updated_at
            `, [locationId, req.params.id, currentStock, carryingValue, costToStore, costStatus, now, now]);

            const moveId = 'msm_open_' + req.params.id + '_' + Date.now();
            const mutationId = 'mut_open_' + req.params.id + '_' + Date.now();
            materialRepository.db.execute(`
              INSERT INTO material_stock_movements (
                id, stock_location_id, material_id, movement_type, quantity_base, previous_quantity, current_quantity,
                unit_cost, total_cost, currency_code, valuation_method, cost_basis_type, source_type, source_reference,
                posting_mutation_id, valuation_version, posting_timestamp, resolver_version, notes
              ) VALUES (?, ?, ?, 'OPENING_STOCK', ?, 0, ?, ?, ?, 'IDR', 'MOVING_AVERAGE', 'OPENING_ACTUAL', 'OPENING_BALANCE', 'SYS_OPENING', ?, 1, ?, 'v1', 'Opening stock from material edit')
            `, [moveId, locationId, req.params.id, currentStock, currentStock, costToStore, carryingValue, mutationId, now]);
          } else {
            materialRepository.db.execute(`
              INSERT INTO material_stock_balances (
                stock_location_id, material_id, quantity_base, carrying_value,
                moving_average_unit_cost, cost_availability_status, valuation_version, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
              ON CONFLICT(stock_location_id, material_id) DO UPDATE SET
                quantity_base = excluded.quantity_base,
                carrying_value = excluded.carrying_value,
                moving_average_unit_cost = excluded.moving_average_unit_cost,
                cost_availability_status = excluded.cost_availability_status,
                valuation_version = material_stock_balances.valuation_version + 1,
                updated_at = excluded.updated_at
            `, [locationId, req.params.id, currentStock, carryingValue, costToStore, costStatus, now, now]);
          }
        }
      }

      const updated = materialRepository.findById(req.params.id);
      return res.json({ success: true, material: updated });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
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
