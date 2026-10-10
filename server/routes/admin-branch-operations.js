/**
 * XENTRA CORE — ADMIN BRANCH OPERATIONS
 *
 * Branch-scoped inventory operations.
 * Catalog adoption/product lifecycle, including the quarantined legacy Branch Product
 * compatibility routes, remains exclusively in admin-branch-catalog.js.
 */
'use strict';

const crypto = require('crypto');

module.exports = function registerAdminBranchOperationsRoutes(router, deps) {
  const { db, requireAuth, InventoryStockService } = deps;


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

    const rows = db.prepare(`
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        CASE
          WHEN p.sku IS NOT NULL AND trim(p.sku) <> ''
            THEN COALESCE(bpi.stock_qty, 0)
          ELSE COALESCE(bp.stock, 0)
        END AS stock,
        CASE
          WHEN p.sku IS NOT NULL AND trim(p.sku) <> ''
            THEN COALESCE(bpi.low_stock_threshold, 5)
          ELSE COALESCE(bp.low_stock_threshold, 5)
        END AS low_stock_threshold,
        CASE
          WHEN p.sku IS NOT NULL AND trim(p.sku) <> '' THEN 'canonical'
          WHEN bp.product_id IS NOT NULL THEN 'legacy'
          ELSE 'none'
        END AS stock_source,
        CASE
          WHEN p.sku IS NOT NULL AND trim(p.sku) <> '' THEN NULL
          ELSE bp.is_available
        END AS is_available
      FROM products p
      LEFT JOIN branch_product_inventory bpi
        ON bpi.branch_id = ? AND bpi.product_id = p.id
      LEFT JOIN branch_products bp
        ON bp.branch_id = ? AND bp.product_id = p.id
      WHERE p.brand_id = ?
        AND (
          (p.sku IS NOT NULL AND trim(p.sku) <> '')
          OR bp.product_id IS NOT NULL
        )
      ORDER BY p.name ASC, p.id ASC
    `).all(req.params.id, req.params.id, req.brand_id);

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
    // - SKU Product -> canonical branch_product_inventory; no Branch Menu adoption is required
    //   for stock to exist.
    // - Product without SKU -> legacy branch_products compatibility path.
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
      res.json({
        success: true,
        movement,
        stock,
        stock_source: canonicalStock ? 'canonical' : 'legacy'
      });
    } catch (stockErr) {
      const msg = String(stockErr && stockErr.message || '');
      if (msg.includes('Stok tidak boleh negatif')) {
        return res.status(409).json({ success: false, error: 'INSUFFICIENT_STOCK', message: stockErr.message });
      }
      if (msg.includes('tidak terdaftar di cabang')) {
        return res.status(404).json({ success: false, error: 'Produk tidak dialokasikan ke cabang ini.' });
      }
      console.error('[API Error PATCH /admin/branches/:id/inventory/:productId]:', stockErr);
      res.status(500).json({ success: false, error: stockErr.message });
    }
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/inventory/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /admin/branches/:id/inventory/recipes
// Lists active recipes applicable to the branch's products, including real-time material stock availability.
router.get('/admin/branches/:id/inventory/recipes', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id, br.organization_id FROM branches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const location = db.prepare("SELECT id FROM stock_locations WHERE branch_id = ? AND is_active = 1 LIMIT 1").get(req.params.id);
    const locationId = location ? location.id : null;

    const recipes = db.prepare(`
      SELECT
        r.id AS recipe_id,
        r.name AS recipe_name,
        pi.id AS production_item_id,
        pi.output_product_id,
        p.name AS output_product_name,
        p.sku AS output_product_sku,
        rv.id AS recipe_version_id,
        rv.version_number,
        rv.planned_yield_quantity,
        rv.yield_uom_id,
        yu.name AS yield_uom_name
      FROM recipes r
      JOIN production_items pi ON pi.id = r.production_item_id
      JOIN products p ON p.id = pi.output_product_id AND p.brand_id = ?
      JOIN recipe_versions rv ON rv.recipe_id = r.id AND rv.status = 'PUBLISHED'
      JOIN uoms yu ON yu.id = rv.yield_uom_id
      WHERE r.status = 'ACTIVE' AND pi.status = 'ACTIVE'
      ORDER BY p.name ASC, rv.version_number DESC
    `).all(req.brand_id);

    // Attach recipe components and current material balances at branch stock location
    const result = recipes.map(recipe => {
      const components = db.prepare(`
        SELECT
          rc.material_id,
          m.material_code,
          m.name AS material_name,
          rc.planned_quantity,
          rc.planned_uom_id,
          u.name AS planned_uom_name,
          COALESCE(msb.quantity_base, 0) AS branch_material_stock,
          COALESCE(msb.cost_availability_status, 'UNAVAILABLE') AS cost_status
        FROM recipe_components rc
        JOIN materials m ON m.id = rc.material_id
        JOIN uoms u ON u.id = rc.planned_uom_id
        LEFT JOIN material_stock_balances msb
          ON msb.material_id = rc.material_id AND msb.stock_location_id = ?
        WHERE rc.recipe_version_id = ?
        ORDER BY rc.sort_order ASC, m.name ASC
      `).all(locationId, recipe.recipe_version_id);

      return {
        ...recipe,
        stock_location_id: locationId,
        components
      };
    });

    res.json({ success: true, branch_id: req.params.id, stock_location_id: locationId, recipes: result });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/inventory/recipes]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/branches/:id/inventory/prepare
// Records completed cooking preparation batch: consumes raw materials & adds portions to product inventory.
router.post('/admin/branches/:id/inventory/prepare', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
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

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id, br.organization_id FROM branches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const productId = req.body && req.body.product_id;
    const portions = Number(req.body && req.body.portions);
    const notes = (req.body && req.body.notes) ? String(req.body.notes).trim() : '';

    if (!productId) {
      return res.status(400).json({ success: false, error: 'PRODUCT_REQUIRED', message: 'Product ID wajib disertakan.' });
    }
    if (!Number.isFinite(portions) || portions <= 0) {
      return res.status(400).json({ success: false, error: 'INVALID_PORTIONS', message: 'Jumlah porsi masak harus bilangan positif (> 0).' });
    }

    // Resolve branch stock location
    const location = db.prepare("SELECT id FROM stock_locations WHERE branch_id = ? AND is_active = 1 LIMIT 1").get(req.params.id);
    if (!location) {
      return res.status(400).json({ success: false, error: 'STOCK_LOCATION_NOT_FOUND', message: 'Lokasi gudang persediaan cabang belum aktif.' });
    }

    // Resolve recipe for this product
    const recipe = db.prepare(`
      SELECT
        r.id AS recipe_id,
        r.name AS recipe_name,
        pi.id AS production_item_id,
        pi.output_product_id,
        rv.id AS recipe_version_id,
        rv.planned_yield_quantity,
        rv.yield_uom_id
      FROM recipes r
      JOIN production_items pi ON pi.id = r.production_item_id
      JOIN recipe_versions rv ON rv.recipe_id = r.id AND rv.status = 'PUBLISHED'
      WHERE pi.output_product_id = ? AND r.status = 'ACTIVE' AND pi.status = 'ACTIVE'
      ORDER BY rv.version_number DESC
      LIMIT 1
    `).get(productId);

    if (!recipe) {
      return res.status(404).json({ success: false, error: 'RECIPE_NOT_FOUND', message: 'Resep masakan aktif untuk produk ini tidak ditemukan.' });
    }

    const components = db.prepare(`
      SELECT rc.material_id, rc.planned_quantity, rc.planned_uom_id, m.name AS material_name,
             COALESCE(msb.quantity_base, 0) AS current_stock
      FROM recipe_components rc
      JOIN materials m ON m.id = rc.material_id
      LEFT JOIN material_stock_balances msb ON msb.material_id = rc.material_id AND msb.stock_location_id = ?
      WHERE rc.recipe_version_id = ?
    `).all(location.id, recipe.recipe_version_id);

    if (!components.length) {
      return res.status(400).json({ success: false, error: 'RECIPE_COMPONENTS_EMPTY', message: 'Komponen bahan baku resep kosong.' });
    }

    // Check material sufficiency
    const yieldQty = Number(recipe.planned_yield_quantity) || 1;
    const factor = portions / yieldQty;
    const requiredMaterials = [];

    for (const comp of components) {
      const needed = Number(comp.planned_quantity) * factor;
      const currentStock = Number(comp.current_stock);
      if (currentStock < needed) {
        return res.status(400).json({
          success: false,
          error: 'INSUFFICIENT_MATERIAL_STOCK',
          message: `Stok bahan baku "${comp.material_name}" tidak mencukupi (dibutuhkan: ${needed.toFixed(2)}, tersedia: ${currentStock.toFixed(2)}).`,
          material_id: comp.material_id,
          needed,
          available: currentStock
        });
      }
      requiredMaterials.push({
        material_id: comp.material_id,
        source_uom_id: comp.planned_uom_id,
        actual_quantity: needed
      });
    }

    // Execute atomic consumption & output portion increase
    const { ProductionService } = require('../../domains/production');
    const ProductionRepository = require('../../core/data/repositories/ProductionRepository');
    const InventoryRepository = require('../../core/data/repositories/InventoryRepository');
    const productionRepo = new ProductionRepository();
    const inventoryRepo = new InventoryRepository();

    const postingId = 'prep_' + crypto.randomBytes(8).toString('hex');

    // 1. Production batch execution
    const batch = ProductionService.createProductionBatch({
      outputProductId: productId,
      productionStockLocationId: location.id,
      inputStockLocationId: location.id,
      outputStockLocationId: location.id,
      plannedOutputQuantity: portions,
      createdBy: req.user.id || req.user.userId || null,
      repository: productionRepo
    });

    ProductionService.planProductionBatch({ productionBatchId: batch.id, repository: productionRepo });
    ProductionService.startProductionBatch({ productionBatchId: batch.id, startedBy: req.user.id || req.user.userId || null, repository: productionRepo });

    const completion = ProductionService.completeProductionBatch({
      productionBatchId: batch.id,
      productionPostingId: postingId,
      actualOutputQuantity: portions,
      actualConsumptions: requiredMaterials,
      currency: 'IDR',
      completedBy: req.user.id || req.user.userId || null,
      repository: productionRepo,
      inventory: inventoryRepo
    });

    // 2. Add portion to Branch Product Inventory
    const addMovement = InventoryStockService.recordMovement({
      branch_id: req.params.id,
      product_id: productId,
      movement_type: 'audit_adjustment',
      quantity: portions,
      mutation_id: postingId,
      reference_id: batch.id,
      actor_id: req.user.userId || req.user.id || 'system',
      actor_role: req.user.role || 'system',
      notes: notes ? `[Catat Masak ${portions} Porsi] ${notes}` : `Catat Masak ${portions} Porsi dari Resep`
    });

    const newStock = InventoryStockService.getStock(req.params.id, productId);

    res.json({
      success: true,
      batch_id: batch.id,
      posting_id: postingId,
      portions_prepared: portions,
      product_id: productId,
      current_stock: newStock,
      movement: addMovement,
      completion
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/inventory/prepare]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /admin/branches/:id/purchasing/checklist
// Returns low-stock raw materials for shopping checklist + estimated budget based on last unit cost.
router.get('/admin/branches/:id/purchasing/checklist', requireAuth(['owner', 'brand_manager', 'branch_manager', 'purchasing']), (req, res) => {
  try {
    if (['branch_manager', 'purchasing'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Akses hanya diizinkan untuk cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id, br.organization_id FROM branches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const location = db.prepare("SELECT id FROM stock_locations WHERE branch_id = ? AND is_active = 1 LIMIT 1").get(req.params.id);
    const locationId = location ? location.id : null;

    // Get all active materials and their stock balances at this branch location
    const rows = db.prepare(`
      SELECT
        m.id AS material_id,
        m.material_code,
        m.name AS material_name,
        m.base_uom_id,
        u.name AS base_uom_name,
        u.code AS base_uom_code,
        COALESCE(msb.quantity_base, 0) AS current_stock,
        COALESCE(msb.moving_average_unit_cost, 0) AS last_unit_cost,
        COALESCE(rp.minimum_quantity, 5) AS minimum_quantity,
        COALESCE(rp.target_quantity, 15) AS target_quantity
      FROM materials m
      JOIN uoms u ON u.id = m.base_uom_id
      LEFT JOIN material_stock_balances msb
        ON msb.material_id = m.id AND msb.stock_location_id = ?
      LEFT JOIN inventory_reorder_policies rp
        ON rp.identity_id = m.id AND rp.stock_location_id = ? AND rp.identity_type = 'MATERIAL'
      WHERE m.organization_id = ? AND m.status = 'ACTIVE'
      ORDER BY m.name ASC
    `).all(locationId, locationId, branch.organization_id);

    let totalEstimatedBudget = 0;
    const items = rows.map(item => {
      const current = Number(item.current_stock);
      const min = Number(item.minimum_quantity);
      const target = Number(item.target_quantity);
      const isLow = current <= min;
      const suggestedQty = isLow ? Math.max(1, target - current) : 0;
      const lastCost = Number(item.last_unit_cost);
      const estimatedSubtotal = suggestedQty * lastCost;

      if (isLow) {
        totalEstimatedBudget += estimatedSubtotal;
      }

      return {
        ...item,
        is_low: isLow,
        suggested_qty: suggestedQty,
        estimated_subtotal: estimatedSubtotal
      };
    });

    res.json({
      success: true,
      branch_id: req.params.id,
      branch_name: branch.name,
      stock_location_id: locationId,
      total_estimated_budget: Math.round(totalEstimatedBudget),
      items
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/purchasing/checklist]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/branches/:id/purchasing/settle
// Submits real shopping expenditures: records goods receipt/opening in stock ledger, updates cost, logs cash balance.
router.post('/admin/branches/:id/purchasing/settle', requireAuth(['owner', 'brand_manager', 'branch_manager', 'purchasing']), (req, res) => {
  try {
    if (['branch_manager', 'purchasing'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Akses hanya diizinkan untuk cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id, br.organization_id FROM branches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const location = db.prepare("SELECT id FROM stock_locations WHERE branch_id = ? AND is_active = 1 LIMIT 1").get(req.params.id);
    if (!location) {
      return res.status(400).json({ success: false, error: 'STOCK_LOCATION_NOT_FOUND', message: 'Lokasi gudang persediaan cabang belum aktif.' });
    }

    const cashAdvance = Number(req.body && req.body.cash_advance || 0); // Uang kasbon dari owner/kasir
    const items = req.body && req.body.items;
    const notes = (req.body && req.body.notes) ? String(req.body.notes).trim() : '';

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'ITEMS_REQUIRED', message: 'Minimal harus ada satu item belanjaan.' });
    }

    let totalRealExpenditure = 0;
    const parsedLines = [];

    for (const line of items) {
      const materialId = line.material_id;
      const qty = Number(line.quantity);
      const actualUnitPrice = Number(line.unit_price);

      if (!materialId || qty <= 0 || actualUnitPrice < 0) {
        return res.status(400).json({ success: false, error: 'INVALID_LINE', message: 'Jumlah dan harga per item harus valid.' });
      }

      const lineTotal = Math.round(qty * actualUnitPrice);
      totalRealExpenditure += lineTotal;
      parsedLines.push({
        material_id: materialId,
        quantity: qty,
        unit_price: actualUnitPrice,
        total_price: lineTotal
      });
    }

    const changeDue = Math.round(cashAdvance - totalRealExpenditure);
    const postingId = 'shop_' + crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    const actorId = req.user.id || req.user.userId || 'system';

    // Atomic execution into database
    db.exec('BEGIN TRANSACTION;');
    try {
      for (const line of parsedLines) {
        // Find existing material balance
        const balance = db.prepare(`
          SELECT quantity_base, carrying_value, moving_average_unit_cost, valuation_version
          FROM material_stock_balances
          WHERE stock_location_id = ? AND material_id = ?
        `).get(location.id, line.material_id);

        let prevQty = balance ? Number(balance.quantity_base) : 0;
        let prevVal = balance ? Number(balance.carrying_value) : 0;
        let newQty = prevQty + line.quantity;
        let newVal = prevVal + line.total_price;
        let newAvgCost = newQty > 0 ? (newVal / newQty) : line.unit_price;

        const maxMovVer = db.prepare(`
          SELECT MAX(valuation_version) AS max_v
          FROM material_stock_movements
          WHERE stock_location_id = ? AND material_id = ?
        `).get(location.id, line.material_id);
        let newVer = ((maxMovVer && maxMovVer.max_v != null) ? Number(maxMovVer.max_v) : 0) + 1;

        if (balance) {
          db.prepare(`
            UPDATE material_stock_balances
            SET quantity_base = ?, carrying_value = ?, moving_average_unit_cost = ?,
                cost_availability_status = 'AVAILABLE', valuation_version = ?, updated_at = ?
            WHERE stock_location_id = ? AND material_id = ?
          `).run(newQty, newVal, newAvgCost, newVer, now, location.id, line.material_id);
        } else {
          db.prepare(`
            INSERT INTO material_stock_balances (
              stock_location_id, material_id, quantity_base, carrying_value,
              moving_average_unit_cost, cost_availability_status, valuation_version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'AVAILABLE', 1, ?, ?)
          `).run(location.id, line.material_id, newQty, newVal, newAvgCost, now, now);
        }

        // Ledger entry in material_stock_movements (posting_mutation_id must be globally unique per movement)
        const movId = 'mov_' + crypto.randomBytes(8).toString('hex');
        const movMutationId = postingId + '_' + line.material_id;
        db.prepare(`
          INSERT INTO material_stock_movements (
            id, stock_location_id, material_id, movement_type, quantity_base,
            previous_quantity, current_quantity, unit_cost, total_cost, currency_code,
            valuation_method, cost_basis_type, source_type, source_reference,
            posting_mutation_id, valuation_version, posting_timestamp, actor_id, resolver_version
          ) VALUES (?, ?, ?, 'PURCHASE_RECEIPT', ?, ?, ?, ?, ?, 'IDR', 'MOVING_AVERAGE', 'PURCHASE_RECEIPT', 'PURCHASING_CHECKLIST', ?, ?, ?, ?, ?, 'v1')
        `).run(
          movId, location.id, line.material_id, line.quantity, prevQty, newQty,
          line.unit_price, line.total_price, postingId, movMutationId, newVer, now, actorId
        );
      }
      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    res.json({
      success: true,
      posting_id: postingId,
      branch_id: req.params.id,
      cash_advance: cashAdvance,
      total_real_expenditure: totalRealExpenditure,
      change_due: changeDue,
      items_recorded: parsedLines.length,
      notes: notes || 'Belanja Pasar'
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/purchasing/settle]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /admin/branches/:id/purchasing/history
// Returns purchasing receipt history for the last 7 days with price comparisons
router.get('/admin/branches/:id/purchasing/history', requireAuth(['owner', 'brand_manager', 'branch_manager', 'purchasing']), (req, res) => {
  try {
    if (['branch_manager', 'purchasing'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Akses hanya diizinkan untuk cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id FROM branches b WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const location = db.prepare("SELECT id FROM stock_locations WHERE branch_id = ? AND is_active = 1 LIMIT 1").get(req.params.id);
    if (!location) {
      return res.json({ success: true, history: [] });
    }

    // Fetch movements from the last 7 days
    const rows = db.prepare(`
      SELECT
        sm.id,
        sm.source_reference,
        sm.posting_mutation_id,
        sm.material_id,
        m.name AS material_name,
        u.code AS base_uom_code,
        u.name AS base_uom_name,
        sm.quantity_base AS quantity,
        sm.unit_cost,
        sm.total_cost,
        sm.posting_timestamp,
        sm.actor_id,
        usr.full_name AS actor_name
      FROM material_stock_movements sm
      JOIN materials m ON m.id = sm.material_id
      LEFT JOIN uoms u ON u.id = m.base_uom_id
      LEFT JOIN users usr ON usr.id = sm.actor_id
      WHERE sm.stock_location_id = ?
        AND sm.movement_type = 'PURCHASE_RECEIPT'
        AND sm.posting_timestamp >= datetime('now', '-7 days')
      ORDER BY sm.posting_timestamp DESC
    `).all(location.id);

    // Group items by session (source_reference atau posting_mutation_id) for clean session grouping
    const sessionMap = new Map();
    for (const r of rows) {
      const pId = r.source_reference || r.posting_mutation_id || r.id;
      if (!sessionMap.has(pId)) {
        sessionMap.set(pId, {
          posting_id: pId,
          timestamp: r.posting_timestamp,
          actor_name: r.actor_name || 'Petugas Belanja',
          total_spend: 0,
          items: []
        });
      }
      const session = sessionMap.get(pId);
      session.total_spend += Number(r.total_cost || 0);
      session.items.push({
        material_id: r.material_id,
        material_name: r.material_name,
        uom: r.base_uom_code || r.base_uom_name || 'Unit',
        quantity: Number(r.quantity || 0),
        unit_price: Number(r.unit_cost || 0),
        total_price: Number(r.total_cost || 0)
      });
    }

    res.json({
      success: true,
      branch_id: req.params.id,
      sessions: Array.from(sessionMap.values())
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/purchasing/history]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /admin/branches/:id/purchasing/orders
// Returns active POs destined for this branch (ORDERED, PARTIALLY_RECEIVED, APPROVED)
router.get('/admin/branches/:id/purchasing/orders', requireAuth(['owner', 'brand_manager', 'branch_manager', 'purchasing']), (req, res) => {
  try {
    if (['branch_manager', 'purchasing'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Akses hanya diizinkan untuk cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id FROM branches b WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    const location = db.prepare("SELECT id FROM stock_locations WHERE branch_id = ? AND is_active = 1 LIMIT 1").get(req.params.id);
    if (!location) return res.json({ success: true, orders: [] });

    const orders = db.prepare(`
      SELECT 
        po.id,
        po.supplier_id,
        s.name AS supplier_name,
        po.destination_stock_location_id,
        sl.name AS destination_name,
        po.status,
        po.required_at,
        po.ordered_at,
        po.created_at,
        COUNT(pol.id) AS total_items,
        COALESCE(SUM(pol.ordered_purchase_quantity * pol.unit_price), 0) AS total_amount
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN stock_locations sl ON sl.id = po.destination_stock_location_id
      LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
      WHERE po.destination_stock_location_id = ?
        AND po.status IN ('APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED')
      GROUP BY po.id
      ORDER BY po.created_at DESC
    `).all(location.id);

    // Fetch lines for each order
    for (const order of orders) {
      order.lines = db.prepare(`
        SELECT 
          pol.id AS purchase_order_line_id,
          pol.supplier_material_id,
          m.id AS material_id,
          m.name AS material_name,
          m.material_code,
          u.name AS base_uom_name,
          u.code AS base_uom_code,
          smp.name AS supplier_pack_name,
          pol.ordered_purchase_quantity,
          pol.resolved_base_quantity,
          pol.received_base_quantity,
          pol.base_quantity_per_purchase_unit,
          pol.unit_price
        FROM purchase_order_lines pol
        JOIN supplier_materials sm ON sm.id = pol.supplier_material_id
        JOIN materials m ON m.id = sm.material_id
        JOIN uoms u ON u.id = m.base_uom_id
        LEFT JOIN supplier_material_packs smp ON smp.id = pol.supplier_pack_id
        WHERE pol.purchase_order_id = ?
      `).all(order.id);
    }

    res.json({ success: true, branch_id: req.params.id, orders });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/purchasing/orders]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/branches/:id/purchasing/orders/:poId/receive
// Confirm goods receipt from supplier for a PO delivered to this branch
router.post('/admin/branches/:id/purchasing/orders/:poId/receive', requireAuth(['owner', 'brand_manager', 'branch_manager', 'purchasing']), (req, res) => {
  try {
    if (['branch_manager', 'purchasing'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Akses hanya diizinkan untuk cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id FROM branches b WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    const location = db.prepare("SELECT id FROM stock_locations WHERE branch_id = ? AND is_active = 1 LIMIT 1").get(req.params.id);
    if (!location) return res.status(400).json({ success: false, error: 'Lokasi persediaan cabang belum disiapkan.' });

    const { ProcurementService } = require('../../domains/procurement');
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND destination_stock_location_id = ?').get(req.params.poId, location.id);
    if (!po) return res.status(404).json({ success: false, error: 'PURCHASE_ORDER_NOT_FOUND', message: 'PO tidak ditemukan untuk cabang ini.' });

    const lines = req.body && req.body.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, error: 'LINES_REQUIRED', message: 'Rincian barang yang diterima wajib diisi.' });
    }

    const postingId = 'grp_' + crypto.randomBytes(8).toString('hex');
    const receipt = ProcurementService.postGoodsReceipt({
      purchaseOrderId: po.id,
      goodsReceiptPostingId: postingId,
      receivedBy: req.user.id || null,
      receivedAt: new Date().toISOString(),
      lines: lines.map(line => ({
        purchase_order_line_id: line.purchase_order_line_id,
        accepted_purchase_quantity: Number(line.accepted_purchase_quantity || 0),
        rejected_purchase_quantity: Number(line.rejected_purchase_quantity || 0),
        rejection_reason: line.rejection_reason || null
      }))
    });

    res.json({
      success: true,
      goods_receipt: receipt,
      message: 'Penerimaan barang dari supplier berhasil dikonfirmasi dan saldo persediaan telah diperbarui.'
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/purchasing/orders/:poId/receive]:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

};
