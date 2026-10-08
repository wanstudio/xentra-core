/**
 * XENTRA CORE — ADMIN BRANCH OPERATIONS
 *
 * Branch-scoped inventory operations.
 * Catalog adoption/product lifecycle, including the quarantined legacy Branch Product
 * compatibility routes, remains exclusively in admin-branch-catalog.js.
 */
'use strict';

module.exports = function registerAdminBranchOperationsRoutes(router, deps) {
  const { db, requireAuth, InventoryStockService } = deps;
  const InventoryRepository = require('../../core/data/repositories/InventoryRepository');
  const InventoryAdjustmentService = require('../../domains/inventory/services/InventoryAdjustmentService');
  const inventoryRepository = new InventoryRepository();
  const INVENTORY_ADJUSTMENT_BAD_REQUEST = new Set([
    'INVALID_MOVEMENT_TYPE',
    'INVALID_QUANTITY',
    'MUTATION_ID_REQUIRED',
    'INBOUND_COST_UNRESOLVED',
    'CURRENCY_BASIS_UNRESOLVED',
    'PRODUCT_REQUIRED',
    'BRANCH_REQUIRED',
    'POSTING_TIMESTAMP_REQUIRED'
  ]);
  const INVENTORY_ADJUSTMENT_CONFLICT = new Set([
    'INSUFFICIENT_STOCK',
    'MUTATION_ID_REUSED',
    'VALUATION_STATE_INVALID',
    'BACKDATED_VALUATION_REJECTED',
    'COST_UNAVAILABLE'
  ]);




router.get('/admin/branches/:id/inventory', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const rows = inventoryRepository.findBranchProductInventoryView({
      branchId: req.params.id,
      brandId: req.brand_id
    });

    res.json({ success: true, branch_id: req.params.id, inventory: rows || [] });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/inventory]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C2 Branch inventory mutation (operational adjustment)
// body: { movement_type: 'audit_adjustment'|'waste_spoilage', quantity: <signed int>, mutation_id?, notes? }
router.patch('/admin/branches/:id/inventory/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    // Branch Manager may only mutate their OWN branch.
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    // Branch ownership (tenant-scoped)
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const movement_type = req.body && req.body.movement_type;
    const rawQuantity = req.body && req.body.quantity;
    const mutation_id = (req.body && req.body.mutation_id) ? String(req.body.mutation_id).trim() : null;
    const notes = (req.body && req.body.notes) ? String(req.body.notes) : '';

    // Only operational adjustments are exposed; purchase_in / sale_deduction stay owned by
    // their respective flows (PO receipt / order settlement).
    const MANUAL_MOVEMENT_TYPES = ['audit_adjustment', 'waste_spoilage'];
    if (!MANUAL_MOVEMENT_TYPES.includes(movement_type)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_MOVEMENT_TYPE',
        message: 'Jenis mutasi manual hanya mendukung audit_adjustment atau waste_spoilage. Penerimaan PO dan pemotongan pesanan dikelola oleh alurnya masing-masing.'
      });
    }

    // C2.9 Quantity validation (finite integer; never silently coerced)
    const quantity = Number(rawQuantity);
    if (rawQuantity === null || rawQuantity === undefined || rawQuantity === '' ||
        !Number.isFinite(Number(rawQuantity)) || !Number.isInteger(quantity) || quantity === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'Quantity harus berupa bilangan bulat bukan-nol (mis. +5 atau -3).'
      });
    }
    if (movement_type === 'waste_spoilage' && quantity > 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'waste_spoilage hanya menerima pengurangan stok (quantity negatif).'
      });
    }

    // Forward inventory boundary:
    // - SKU Product -> canonical Product Stock when the branch Stock Location + balance exist.
    // - Unmigrated branch/product state remains an explicit legacy compatibility path.
    // - Branch Menu adoption is not the authority for physical Product Stock.
    const product = db.prepare(`
      SELECT id, brand_id, sku
      FROM products
      WHERE id = ? AND brand_id = ?
    `).get(req.params.productId, req.brand_id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produk tidak ditemukan pada brand ini.' });
    }

    const canonicalStock = product.sku != null && String(product.sku).trim() !== '';
    if (!canonicalStock) {
      const assignment = db.prepare(`
        SELECT bp.branch_id
        FROM branch_products bp
        JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
        WHERE bp.branch_id = ? AND bp.product_id = ?
      `).get(req.brand_id, req.params.id, req.params.productId);
      if (!assignment) {
        return res.status(404).json({ success: false, error: 'Produk tidak dialokasikan ke cabang ini.' });
      }
    }

    try {
      const canonicalAdjustment = InventoryAdjustmentService.postProductAdjustment({
        branchId: req.params.id,
        productId: req.params.productId,
        movementType: movement_type,
        quantity,
        mutationId: mutation_id,
        unitCost: req.body && req.body.unit_cost,
        currencyCode: req.body && req.body.currency_code,
        actorId: req.user.userId || req.user.id || req.user.username || 'system',
        notes,
        postingTimestamp: new Date().toISOString()
      });

      if (canonicalAdjustment.status === 'AVAILABLE') {
        return res.json({
          success: true,
          movement: canonicalAdjustment,
          stock: canonicalAdjustment.current_stock,
          stock_source: 'canonical'
        });
      }

      if (canonicalAdjustment.status !== 'LEGACY_COMPATIBILITY_REQUIRED') {
        throw new Error('INVENTORY_ADJUSTMENT_FAILED');
      }

      // Migration seam: only unmigrated branches/products continue through the
      // existing operational inventory ledger. Canonical Product Stock never
      // falls back after a canonical mutation has been selected.
      const movement = InventoryStockService.recordMovement({
        branch_id: req.params.id,
        product_id: req.params.productId,
        movement_type,
        quantity,
        mutation_id,
        reference_id: null,
        actor_id: req.user.userId || req.user.id || req.user.username || 'system',
        actor_role: req.user.role || 'system',
        notes
      });

      const stock = InventoryStockService.getStock(req.params.id, req.params.productId);
      return res.json({
        success: true,
        movement,
        stock,
        stock_source: 'legacy'
      });
    }
  } catch (err) {
    const code = String(err && (err.code || err.message) || 'INVENTORY_ADJUSTMENT_FAILED');
    console.error('[API Error PATCH /admin/branches/:id/inventory/:productId]:', err);
    if (INVENTORY_ADJUSTMENT_BAD_REQUEST.has(code)) {
      return res.status(400).json({ success: false, error: code });
    }
    if (INVENTORY_ADJUSTMENT_CONFLICT.has(code)) {
      return res.status(409).json({ success: false, error: code });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});


};
