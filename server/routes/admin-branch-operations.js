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
        p.category_id,
        COALESCE(p.fulfillment_type, 'BY_STOCK') AS fulfillment_type,
        CASE
          WHEN COALESCE(p.fulfillment_type, 'BY_STOCK') = 'BY_ORDER' THEN NULL
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
          WHEN COALESCE(p.fulfillment_type, 'BY_STOCK') = 'BY_ORDER' THEN 'by_order'
          WHEN p.sku IS NOT NULL AND trim(p.sku) <> '' THEN 'canonical'
          WHEN bp.product_id IS NOT NULL THEN 'legacy'
          ELSE 'none'
        END AS stock_source,
        CASE
          WHEN COALESCE(p.fulfillment_type, 'BY_STOCK') = 'BY_ORDER' THEN COALESCE(bp.is_available, 1)
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

    // C2.9 Quantity & Threshold validation
    const hasThreshold = req.body.low_stock_threshold !== undefined && req.body.low_stock_threshold !== null && req.body.low_stock_threshold !== '';
    const rawQuantityNum = Number(rawQuantity);
    const hasQuantity = rawQuantity !== null && rawQuantity !== undefined && rawQuantity !== '' &&
      Number.isFinite(rawQuantityNum) && Number.isInteger(rawQuantityNum) && rawQuantityNum !== 0;

    if (!hasThreshold && !hasQuantity) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'Quantity harus berupa bilangan bulat bukan-nol (mis. +5 atau -3) atau tentukan low_stock_threshold.'
      });
    }
    if (hasQuantity && movement_type === 'waste_spoilage' && rawQuantityNum > 0) {
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
      if (hasThreshold) {
        const threshold = Math.max(0, parseInt(req.body.low_stock_threshold, 10) || 0);
        if (canonicalStock) {
          db.prepare(`
            INSERT INTO branch_product_inventory (branch_id, product_id, stock_qty, low_stock_threshold)
            VALUES (?, ?, 0, ?)
            ON CONFLICT(branch_id, product_id) DO UPDATE SET
              low_stock_threshold = excluded.low_stock_threshold,
              updated_at = datetime('now')
          `).run(req.params.id, req.params.productId, threshold);
        } else {
          db.prepare(`
            UPDATE branch_products
            SET low_stock_threshold = ?, updated_at = datetime('now')
            WHERE branch_id = ? AND product_id = ?
          `).run(threshold, req.params.id, req.params.productId);
        }
      }

      let movement = null;
      if (hasQuantity) {
        movement = InventoryStockService.recordMovement({
          branch_id: req.params.id,
          product_id: req.params.productId,
          movement_type,
          quantity: rawQuantityNum,
          mutation_id,
          reference_id: null,
          actor_id: req.user.userId || req.user.id || req.user.username || 'system',
          actor_role: req.user.role || 'system',
          notes
        });
      }

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
          u.code AS planned_uom_code,
          bu.code AS base_uom_code,
          COALESCE(msb.quantity_base, 0) AS branch_material_stock_base,
          ROUND(COALESCE(msb.quantity_base, 0) * bu.conversion_factor / u.conversion_factor, 4) AS branch_material_stock,
          COALESCE(msb.cost_availability_status, 'UNAVAILABLE') AS cost_status
        FROM recipe_components rc
        JOIN materials m ON m.id = rc.material_id
        JOIN uoms u ON u.id = rc.planned_uom_id
        JOIN uoms bu ON bu.id = m.base_uom_id
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
             u.conversion_factor AS planned_cf, bu.conversion_factor AS base_cf,
             u.name AS planned_uom_name, bu.name AS base_uom_name,
             u.quantity_precision AS planned_precision, u.allows_fraction AS planned_allows_fraction,
             COALESCE(msb.quantity_base, 0) AS current_stock
      FROM recipe_components rc
      JOIN materials m ON m.id = rc.material_id
      JOIN uoms u ON u.id = rc.planned_uom_id
      JOIN uoms bu ON bu.id = m.base_uom_id
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
      const precision = Math.min(6, Math.max(0, Number(comp.planned_precision != null ? comp.planned_precision : 6)));
      const rawNeeded = Number(comp.planned_quantity) * factor;
      let neededInPlanned;
      if (Number(comp.planned_allows_fraction) !== 1) {
        neededInPlanned = Math.ceil(rawNeeded);
      } else {
        const factorMultiplier = 10 ** precision;
        neededInPlanned = Math.round((rawNeeded + Number.EPSILON) * factorMultiplier) / factorMultiplier;
      }
      const neededInBase = Math.round((neededInPlanned * Number(comp.planned_cf) / Number(comp.base_cf) + Number.EPSILON) * 1e6) / 1e6;
      const currentStock = Number(comp.current_stock);
      if (currentStock + 1e-9 < neededInBase) {
        return res.status(400).json({
          success: false,
          error: 'INSUFFICIENT_MATERIAL_STOCK',
          message: `Stok bahan baku "${comp.material_name}" tidak mencukupi (dibutuhkan: ${neededInPlanned.toFixed(2)} ${comp.planned_uom_name}, tersedia: ${(currentStock * Number(comp.base_cf) / Number(comp.planned_cf)).toFixed(2)} ${comp.planned_uom_name}).`,
          material_id: comp.material_id,
          needed: neededInPlanned,
          available: currentStock * Number(comp.base_cf) / Number(comp.planned_cf)
        });
      }
      requiredMaterials.push({
        material_id: comp.material_id,
        source_uom_id: comp.planned_uom_id,
        actual_quantity: neededInPlanned
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

// POST /admin/branches/:id/inventory/notify-shortage
// Notifies owner and system about material shortage encountered during kitchen preparation
// and sets / bumps target reorder policy so materials immediately appear in owner replenishment recommendations
router.post('/admin/branches/:id/inventory/notify-shortage', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
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

    const { product_id, product_name, portions = 1, short_materials = [] } = req.body;
    if (!Array.isArray(short_materials) || short_materials.length === 0) {
      return res.status(400).json({ success: false, error: 'Daftar bahan yang kurang (short_materials) wajib diisi.' });
    }

    const now = new Date().toISOString();
    const actor = req.user.id || req.user.userId || 'kitchen';

    // 1. Ensure inventory_reorder_policies for each short material has a target_quantity > current_stock
    // so it immediately appears in ReplenishmentService suggestions and checklist
    if (locationId) {
      const upsertPolicy = db.prepare(`
        INSERT INTO inventory_reorder_policies (
          stock_location_id, identity_type, identity_id, minimum_quantity, target_quantity, updated_by, created_at, updated_at
        ) VALUES (?, 'MATERIAL', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(stock_location_id, identity_type, identity_id) DO UPDATE SET
          minimum_quantity = CASE WHEN excluded.minimum_quantity > inventory_reorder_policies.minimum_quantity THEN excluded.minimum_quantity ELSE inventory_reorder_policies.minimum_quantity END,
          target_quantity = CASE WHEN excluded.target_quantity > inventory_reorder_policies.target_quantity THEN excluded.target_quantity ELSE inventory_reorder_policies.target_quantity END,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `);

      for (const sm of short_materials) {
        if (!sm.material_id) continue;
        const curBal = db.prepare('SELECT quantity_base FROM material_stock_balances WHERE material_id = ? AND stock_location_id = ?').get(sm.material_id, locationId);
        const currentStock = curBal ? Number(curBal.quantity_base || 0) : 0;
        const neededQty = Number(sm.needed_quantity || 1);
        const minReq = Math.max(1, neededQty);
        const targetReq = Math.max(currentStock + neededQty, minReq * 2, 5);

        upsertPolicy.run(locationId, sm.material_id, minReq, targetReq, actor, now, now);
      }
    }

    // 2. Create authoritative notification targeted to Owner
    const { NotificationService } = require('../../core');
    const notifService = new NotificationService(db);

    const materialsSummary = short_materials.map(m => `- ${m.material_name}: butuh ${m.needed_quantity} ${m.uom_name || ''} (sisa: ${m.available_quantity} ${m.uom_name || ''})`).join('\n');
    const menuTitle = product_name ? `menu "${product_name}" (${portions} porsi)` : `${portions} porsi menu`;

    const notifResult = notifService.createNotification({
      brand_id: req.brand_id,
      branch_id: req.params.id,
      source_type: 'system',
      source_actor_id: actor,
      title: `⚠️ Bahan Baku Kurang di Dapur Cabang ${branch.name}`,
      body: `Dapur gagal memasak ${menuTitle} karena bahan baku tidak mencukupi:\n${materialsSummary}\n\nItem telah otomatis dimasukkan ke Rekomendasi Belanja Owner.`,
      priority: 'high',
      target_role: 'owner',
      target_scope: 'organization',
      action_url: '/merchant-dashboard/#stock?tab=replenishment'
    });

    res.json({
      success: true,
      message: 'Peringatan kekurangan bahan berhasil dikirim ke Owner dan dimasukkan ke Rekomendasi Belanja.',
      notification_id: notifResult.id,
      recipient_count: notifResult.recipient_count,
      short_materials_count: short_materials.length
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/inventory/notify-shortage]:', err);
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

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id, b.daily_petty_cash_limit, br.organization_id FROM branches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
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

    const directProductRows = db.prepare(`
      SELECT
        p.id AS material_id,
        COALESCE(p.sku, p.id) AS material_code,
        p.name AS material_name,
        COALESCE(p.product_stock_uom_id, 'pcs') AS base_uom_id,
        COALESCE(u.name, 'Pcs') AS base_uom_name,
        COALESCE(u.code, 'pcs') AS base_uom_code,
        COALESCE(bpi.stock_qty, 0) AS current_stock,
        COALESCE(p.cost_price, 0) AS last_unit_cost,
        COALESCE(rp.minimum_quantity, bpi.low_stock_threshold, 5) AS minimum_quantity,
        COALESCE(rp.target_quantity, 15) AS target_quantity,
        1 AS is_direct_product
      FROM products p
      LEFT JOIN branch_product_inventory bpi
        ON bpi.product_id = p.id AND bpi.branch_id = ?
      LEFT JOIN inventory_reorder_policies rp
        ON rp.identity_id = p.id AND rp.stock_location_id = ? AND rp.identity_type = 'PRODUCT'
      LEFT JOIN uoms u
        ON u.id = p.product_stock_uom_id
      WHERE p.brand_id = ? AND p.is_active = 1
        AND (
          p.inventory_type = 'DIRECT'
          OR p.id NOT IN (
            SELECT pi.output_product_id
            FROM production_items pi
            JOIN recipes r ON r.production_item_id = pi.id AND r.status = 'ACTIVE'
          )
        )
      ORDER BY p.name ASC
    `).all(branch.id, locationId, branch.brand_id);

    const recipeUsages = db.prepare(`
      SELECT
        rc.material_id,
        MAX((rc.planned_quantity * COALESCE(rc_u.conversion_factor, 1.0) / COALESCE(m_u.conversion_factor, 1.0)) / COALESCE(NULLIF(rv.planned_yield_quantity, 0), 1)) AS max_unit_usage
      FROM recipe_components rc
      JOIN recipe_versions rv ON rv.id = rc.recipe_version_id AND rv.status = 'PUBLISHED'
      JOIN recipes r ON r.id = rv.recipe_id AND r.status = 'ACTIVE'
      LEFT JOIN uoms rc_u ON rc_u.id = rc.planned_uom_id
      JOIN materials m ON m.id = rc.material_id
      LEFT JOIN uoms m_u ON m_u.id = m.base_uom_id
      GROUP BY rc.material_id
    `).all();

    const recipeUsageMap = new Map();
    for (const u of recipeUsages) {
      recipeUsageMap.set(String(u.material_id), Number(u.max_unit_usage || 0));
    }

    let totalEstimatedBudget = 0;
    const materialItems = rows.map(item => {
      const current = Number(item.current_stock);
      const min = Number(item.minimum_quantity);
      const target = Number(item.target_quantity);
      const worstUnitUsage = recipeUsageMap.get(String(item.material_id)) || 0;
      const effectiveThreshold = Math.max(min, worstUnitUsage * 2);
      const isLow = current <= effectiveThreshold || current <= 0;
      const effectiveTarget = target > 0 ? target : Math.max(effectiveThreshold * 2, 1);
      const suggestedQty = isLow ? Math.max(1, Math.round(effectiveTarget - current)) : 0;
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

    const directItems = directProductRows.map(item => {
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

    const items = [...materialItems, ...directItems];

    res.json({
      success: true,
      branch_id: req.params.id,
      branch_name: branch.name,
      daily_petty_cash_limit: branch.daily_petty_cash_limit != null ? Number(branch.daily_petty_cash_limit) : 500000,
      stock_location_id: locationId,
      total_estimated_budget: Math.round(totalEstimatedBudget),
      items
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/purchasing/checklist]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /admin/branches/:id/purchasing/mandates
// Lists purchasing mandates for this branch with their items
router.get('/admin/branches/:id/purchasing/mandates', requireAuth(['owner', 'brand_manager', 'branch_manager', 'purchasing']), (req, res) => {
  try {
    if (['branch_manager', 'purchasing'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id FROM branches b WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    const statusFilter = req.query && req.query.status ? String(req.query.status).toUpperCase() : null;
    let query = `
      SELECT pm.*, u.full_name AS creator_name
      FROM purchasing_mandates pm
      LEFT JOIN users u ON u.id = pm.created_by
      WHERE pm.branch_id = ? AND pm.is_deleted = 0
    `;
    const params = [req.params.id];
    if (statusFilter) {
      query += ' AND pm.status = ?';
      params.push(statusFilter);
    }
    query += ' ORDER BY pm.created_at DESC';

    const mandates = db.prepare(query).all(...params);
    for (const m of mandates) {
      m.items = db.prepare(`
        SELECT pmi.*, m.name AS material_name, m.material_code, u.code AS base_uom_code, u.name AS base_uom_name,
               COALESCE(msb.moving_average_unit_cost, 0) AS last_moving_avg_cost
        FROM purchasing_mandate_items pmi
        JOIN materials m ON m.id = pmi.material_id
        JOIN uoms u ON u.id = m.base_uom_id
        LEFT JOIN stock_locations sl ON sl.branch_id = ? AND sl.is_active = 1
        LEFT JOIN material_stock_balances msb ON msb.material_id = m.id AND msb.stock_location_id = sl.id
        WHERE pmi.mandate_id = ?
        ORDER BY m.name ASC
      `).all(req.params.id, m.id);
    }

    res.json({ success: true, branch_id: req.params.id, mandates });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/purchasing/mandates]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/branches/:id/purchasing/mandates
// Creates / releases a new official purchasing mandate from Branch Manager
router.post('/admin/branches/:id/purchasing/mandates', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id FROM branches b WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    const cashAdvance = Number(req.body && req.body.cash_advance || 0);
    const notes = (req.body && req.body.notes) ? String(req.body.notes).trim() : '';
    const items = req.body && req.body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'ITEMS_REQUIRED', message: 'Daftar barang mandat belanja tidak boleh kosong.' });
    }

    const mandateId = 'pm_' + crypto.randomBytes(8).toString('hex');
    const today = new Date().toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
    const todayCountRow = db.prepare(
      "SELECT COUNT(*) AS count FROM purchasing_mandates WHERE branch_id = ? AND date(created_at) = date('now')"
    ).get(req.params.id);
    const dailySeq = ((todayCountRow && todayCountRow.count) || 0) + 1;
    const mandateNum = 'BLP-' + today + '-' + String(dailySeq).padStart(4, '0');
    const now = new Date().toISOString();
    const userId = req.user.id || req.user.userId || 'system';

    let totalPlanned = 0;
    const parsedItems = [];
    for (const itm of items) {
      const matId = itm.material_id;
      const targetQty = Number(itm.target_quantity || itm.quantity || 0);
      const estPrice = Number(itm.estimated_unit_price || itm.unit_price || 0);
      if (!matId || targetQty <= 0) continue;
      totalPlanned += Math.round(targetQty * estPrice);
      parsedItems.push({
        id: 'pmi_' + crypto.randomBytes(8).toString('hex'),
        mandate_id: mandateId,
        material_id: matId,
        target_quantity: targetQty,
        estimated_unit_price: estPrice
      });
    }

    if (!parsedItems.length) {
      return res.status(400).json({ success: false, error: 'INVALID_ITEMS', message: 'Tidak ada item dengan jumlah valid.' });
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO purchasing_mandates (
          id, mandate_number, branch_id, cash_advance, total_planned_budget,
          status, notes, created_by, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, 'RELEASED', ?, ?, ?, ?, 0)
      `).run(mandateId, mandateNum, req.params.id, cashAdvance, totalPlanned, notes, userId, now, now);

      const insertItem = db.prepare(`
        INSERT INTO purchasing_mandate_items (
          id, mandate_id, material_id, target_quantity, estimated_unit_price, is_purchased
        ) VALUES (?, ?, ?, ?, ?, 0)
      `);
      for (const pi of parsedItems) {
        insertItem.run(pi.id, pi.mandate_id, pi.material_id, pi.target_quantity, pi.estimated_unit_price);
      }
      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }

    res.status(201).json({
      success: true,
      mandate: {
        id: mandateId,
        mandate_number: mandateNum,
        branch_id: req.params.id,
        cash_advance: cashAdvance,
        total_planned_budget: totalPlanned,
        status: 'RELEASED',
        items_count: parsedItems.length
      }
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/purchasing/mandates]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /admin/branches/:id/purchasing/mandates/:mandateId
// Edit an existing mandate (e.g. adjust cash advance, notes, or items if not yet completed)
router.put('/admin/branches/:id/purchasing/mandates/:mandateId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const mandate = db.prepare('SELECT * FROM purchasing_mandates WHERE id = ? AND branch_id = ? AND is_deleted = 0').get(req.params.mandateId, req.params.id);
    if (!mandate) return res.status(404).json({ success: false, error: 'MANDATE_NOT_FOUND' });
    if (mandate.status === 'COMPLETED') {
      return res.status(400).json({ success: false, error: 'MANDATE_ALREADY_COMPLETED', message: 'Mandat belanja yang sudah selesai tidak dapat diedit.' });
    }

    const cashAdvance = req.body && req.body.cash_advance !== undefined ? Number(req.body.cash_advance) : mandate.cash_advance;
    const notes = req.body && req.body.notes !== undefined ? String(req.body.notes).trim() : mandate.notes;
    const items = req.body && req.body.items;
    const now = new Date().toISOString();

    db.exec('BEGIN TRANSACTION;');
    try {
      let totalPlanned = mandate.total_planned_budget;
      if (Array.isArray(items)) {
        db.prepare('DELETE FROM purchasing_mandate_items WHERE mandate_id = ?').run(mandate.id);
        totalPlanned = 0;
        const insertItem = db.prepare(`
          INSERT INTO purchasing_mandate_items (
            id, mandate_id, material_id, target_quantity, estimated_unit_price, is_purchased
          ) VALUES (?, ?, ?, ?, ?, 0)
        `);
        for (const itm of items) {
          const matId = itm.material_id;
          const targetQty = Number(itm.target_quantity || itm.quantity || 0);
          const estPrice = Number(itm.estimated_unit_price || itm.unit_price || 0);
          if (!matId || targetQty <= 0) continue;
          totalPlanned += Math.round(targetQty * estPrice);
          insertItem.run('pmi_' + crypto.randomBytes(8).toString('hex'), mandate.id, matId, targetQty, estPrice);
        }
      }

      db.prepare(`
        UPDATE purchasing_mandates
        SET cash_advance = ?, total_planned_budget = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(cashAdvance, totalPlanned, notes, now, mandate.id);
      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }

    res.json({ success: true, message: 'Mandat belanja berhasil diperbarui.' });
  } catch (err) {
    console.error('[API Error PUT /admin/branches/:id/purchasing/mandates/:mandateId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /admin/branches/:id/purchasing/mandates/:mandateId/archive
// Archives a mandate
router.patch('/admin/branches/:id/purchasing/mandates/:mandateId/archive', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const mandate = db.prepare('SELECT id, status FROM purchasing_mandates WHERE id = ? AND branch_id = ? AND is_deleted = 0').get(req.params.mandateId, req.params.id);
    if (!mandate) return res.status(404).json({ success: false, error: 'MANDATE_NOT_FOUND' });

    const now = new Date().toISOString();
    db.prepare("UPDATE purchasing_mandates SET status = 'ARCHIVED', updated_at = ? WHERE id = ?").run(now, mandate.id);
    res.json({ success: true, message: 'Mandat belanja berhasil diarsipkan.' });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/purchasing/mandates/:mandateId/archive]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /admin/branches/:id/purchasing/mandates/:mandateId
// Hard deletes or soft deletes a mandate
router.delete('/admin/branches/:id/purchasing/mandates/:mandateId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const mandate = db.prepare('SELECT id, status FROM purchasing_mandates WHERE id = ? AND branch_id = ?').get(req.params.mandateId, req.params.id);
    if (!mandate) return res.status(404).json({ success: false, error: 'MANDATE_NOT_FOUND' });

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('DELETE FROM purchasing_mandate_items WHERE mandate_id = ?').run(mandate.id);
      db.prepare('DELETE FROM purchasing_mandates WHERE id = ?').run(mandate.id);
      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }

    res.json({ success: true, message: 'Mandat belanja berhasil dihapus secara permanen.' });
  } catch (err) {
    console.error('[API Error DELETE /admin/branches/:id/purchasing/mandates/:mandateId]:', err);
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

    const branch = db.prepare('SELECT b.id, b.name, b.brand_id, b.daily_petty_cash_limit, br.organization_id FROM branches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
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
    const receiptPhotoUrl = (req.body && req.body.receipt_photo_url) ? String(req.body.receipt_photo_url).trim() : null;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'ITEMS_REQUIRED', message: 'Minimal harus ada satu item belanjaan.' });
    }

    let totalRealExpenditure = 0;
    const parsedLines = [];

    for (const line of items) {
      let materialId = line.material_id;
      const qty = Number(line.quantity);
      const actualUnitPrice = Number(line.unit_price);

      if (!materialId || qty <= 0 || actualUnitPrice < 0) {
        return res.status(400).json({ success: false, error: 'INVALID_LINE', message: 'Jumlah dan harga per item harus valid.' });
      }

      // Resolve ad-hoc material if not existing in materials
      let existingMat = db.prepare('SELECT id FROM materials WHERE id = ?').get(materialId);
      if (!existingMat) {
        const matName = String(line.name || line.material_name || '').trim();
        if (matName) {
          const matchByName = db.prepare('SELECT id FROM materials WHERE organization_id = ? AND lower(trim(name)) = lower(?)').get(branch.organization_id, matName);
          if (matchByName) {
            materialId = matchByName.id;
          } else {
            const newMatId = 'mat_' + crypto.randomBytes(6).toString('hex');
            const matCode = 'MAT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
            const uomId = line.base_uom_id || 'uom_pcs';
            db.prepare(`
              INSERT INTO materials (id, organization_id, material_code, name, base_uom_id, status)
              VALUES (?, ?, ?, ?, ?, 'ACTIVE')
            `).run(newMatId, branch.organization_id, matCode, matName, uomId);
            materialId = newMatId;
          }
        }
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

    // P1 GOVERNANCE: Check against branch daily petty cash limit
    const isOwnerOrBM = ['owner', 'brand_manager'].includes(req.user.role);
    const branchPettyCashLimit = branch.daily_petty_cash_limit != null ? Number(branch.daily_petty_cash_limit) : 500000;
    if (!isOwnerOrBM && totalRealExpenditure > branchPettyCashLimit) {
      return res.status(400).json({
        success: false,
        error: 'EXCEEDS_PETTY_CASH_LIMIT',
        message: `Total belanja (Rp ${totalRealExpenditure.toLocaleString('id-ID')}) melebihi kasbon harian cabang (Rp ${branchPettyCashLimit.toLocaleString('id-ID')}). Silakan pangkas kuantitas belanjaan atau ajukan kenaikan kasbon ke Owner.`,
        daily_petty_cash_limit: branchPettyCashLimit,
        total_real_expenditure: totalRealExpenditure
      });
    }

    const changeDue = Math.round(cashAdvance - totalRealExpenditure);
    const today = new Date().toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
    const todaySettleRow = db.prepare(
      "SELECT COUNT(DISTINCT source_reference) AS count FROM material_stock_movements WHERE stock_location_id = ? AND source_type = 'PURCHASING_CHECKLIST' AND date(posting_timestamp) = date('now')"
    ).get(location.id);
    const dailySeq = ((todaySettleRow && todaySettleRow.count) || 0) + 1;
    const settleCode = 'STL-' + today + '-' + String(dailySeq).padStart(4, '0');
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
        const movementNotes = receiptPhotoUrl ? JSON.stringify({ notes: notes || 'Belanja Pasar', receipt_photo_url: receiptPhotoUrl }) : (notes || 'Belanja Pasar');
        db.prepare(`
          INSERT INTO material_stock_movements (
            id, stock_location_id, material_id, movement_type, quantity_base,
            previous_quantity, current_quantity, unit_cost, total_cost, currency_code,
            valuation_method, cost_basis_type, source_type, source_reference,
            posting_mutation_id, valuation_version, posting_timestamp, actor_id, resolver_version, notes
          ) VALUES (?, ?, ?, 'PURCHASE_RECEIPT', ?, ?, ?, ?, ?, 'IDR', 'MOVING_AVERAGE', 'PURCHASE_RECEIPT', 'PURCHASING_CHECKLIST', ?, ?, ?, ?, ?, 'v1', ?)
        `).run(
          movId, location.id, line.material_id, line.quantity, prevQty, newQty,
          line.unit_price, line.total_price, postingId, movMutationId, newVer, now, actorId, movementNotes
        );
      }

      // If tied to an official mandate, update mandate status and record items
      const mandateId = req.body && req.body.mandate_id ? String(req.body.mandate_id) : null;
      if (mandateId) {
        const updateMandateItem = db.prepare(`
          UPDATE purchasing_mandate_items
          SET is_purchased = 1, purchased_quantity = ?, actual_unit_price = ?
          WHERE mandate_id = ? AND material_id = ?
        `);
        for (const line of parsedLines) {
          updateMandateItem.run(line.quantity, line.unit_price, mandateId, line.material_id);
        }

        // Check if there are still unpurchased items in this mandate
        const unpurchasedRow = db.prepare(`
          SELECT COUNT(*) AS count FROM purchasing_mandate_items
          WHERE mandate_id = ? AND (is_purchased = 0 OR is_purchased IS NULL)
        `).get(mandateId);

        const isFullyDone = !unpurchasedRow || unpurchasedRow.count === 0;
        const newStatus = isFullyDone ? 'COMPLETED' : 'RELEASED';

        db.prepare(`
          UPDATE purchasing_mandates
          SET status = ?, completed_by = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND branch_id = ?
        `).run(newStatus, isFullyDone ? actorId : null, isFullyDone ? now : null, now, mandateId, req.params.id);
      }

      // INTEGRASI LACI KAS KASIR (POS Cash Drawer Movements):
      // Jika ada shift kasir yang sedang aktif di cabang ini, catat kasbon keluar & sisa kembalian masuk
      try {
        const activeShift = db.prepare("SELECT id FROM pos_shifts WHERE branch_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1").get(req.params.id);
        if (activeShift) {
          const movOutId = 'csh_out_' + crypto.randomBytes(6).toString('hex');
          db.prepare(`
            INSERT INTO pos_cash_movements (id, shift_id, type, amount, reason, created_at)
            VALUES (?, ?, 'out', ?, ?, ?)
          `).run(movOutId, activeShift.id, totalRealExpenditure, 'Kasbon Belanja Pasar (' + settleCode + ')', now);

          if (changeDue > 0 && cashAdvance > totalRealExpenditure) {
            const movInId = 'csh_in_' + crypto.randomBytes(6).toString('hex');
            db.prepare(`
              INSERT INTO pos_cash_movements (id, shift_id, type, amount, reason, created_at)
              VALUES (?, ?, 'in', ?, ?, ?)
            `).run(movInId, activeShift.id, changeDue, 'Sisa Kembalian Belanja Pasar (' + settleCode + ')', now);
          }
        }
      } catch (cashErr) {
        console.warn('[Purchasing] Cash movement log notice (shift may not be active):', cashErr.message);
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    res.json({
      success: true,
      posting_id: postingId,
      settle_number: settleCode,
      branch_id: req.params.id,
      cash_advance: cashAdvance,
      total_real_expenditure: totalRealExpenditure,
      change_due: changeDue,
      items_recorded: parsedLines.length,
      notes: notes || 'Belanja Pasar',
      receipt_photo_url: receiptPhotoUrl
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/purchasing/settle]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/branches/:id/purchasing/request-advance
// Staff requests Owner to raise the daily petty cash limit when total shopping exceeds limit
router.post('/admin/branches/:id/purchasing/request-advance', requireAuth(['owner', 'brand_manager', 'branch_manager', 'purchasing']), (req, res) => {
  try {
    const branch = db.prepare('SELECT b.id, b.name, b.brand_id, b.daily_petty_cash_limit FROM branches b WHERE b.id = ? AND b.brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const requestedAmount = Number(req.body && req.body.requested_amount || 0);
    const currentLimit = Number(branch.daily_petty_cash_limit || 500000);
    const reason = (req.body && req.body.reason) ? String(req.body.reason).trim() : 'Kebutuhan belanja harian pasar melebihi kasbon harian.';

    if (requestedAmount <= 0) {
      return res.status(400).json({ success: false, error: 'INVALID_AMOUNT', message: 'Nominal pengajuan kasbon harus lebih dari 0.' });
    }

    const notifId = 'notif_' + crypto.randomBytes(8).toString('hex');
    const title = 'Pengajuan Kenaikan Kasbon Harian: ' + branch.name;
    const formattedReq = 'Rp ' + requestedAmount.toLocaleString('id-ID');
    const formattedCur = 'Rp ' + currentLimit.toLocaleString('id-ID');
    const body = `Cabang ${branch.name} mengajukan kenaikan kasbon menjadi ${formattedReq} (Kasbon saat ini: ${formattedCur}). Alasan: ${reason}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO notifications (id, brand_id, branch_id, source_type, source_actor_id, title, body, priority, target_role, related_entity_type, related_entity_id, action_url, created_at)
      VALUES (?, ?, ?, 'CASH_ADVANCE_REQUEST', ?, ?, ?, 'high', 'owner', 'branch', ?, ?, ?)
    `).run(
      notifId,
      req.brand_id,
      req.params.id,
      req.user ? (req.user.id || req.user.userId || 'staff') : 'staff',
      title,
      body,
      req.params.id,
      '#branches/' + req.params.id + '/edit?suggested_advance=' + requestedAmount,
      now
    );

    // Resolve owner recipients for the notification
    const owners = db.prepare("SELECT id FROM users WHERE role = 'owner' AND (status != 'deleted' OR status IS NULL)").all();
    if (owners && owners.length > 0) {
      const insertRecipient = db.prepare(`
        INSERT OR IGNORE INTO notification_recipients (id, notification_id, user_id, read_at, created_at)
        VALUES (?, ?, ?, NULL, ?)
      `);
      for (const ow of owners) {
        insertRecipient.run('rcp_' + crypto.randomBytes(6).toString('hex'), notifId, ow.id, now);
      }
    }

    res.json({
      success: true,
      message: 'Pengajuan kenaikan kasbon harian berhasil dikirim ke Owner.',
      notification_id: notifId,
      branch_id: req.params.id,
      current_limit: currentLimit,
      requested_amount: requestedAmount
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/purchasing/request-advance]:', err);
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

    let dateFilterClause = "AND sm.posting_timestamp >= datetime('now', '-30 days')";
    const queryParams = [location.id];

    if (req.query.start_date && req.query.end_date) {
      dateFilterClause = "AND date(sm.posting_timestamp, '+7 hours') >= date(?) AND date(sm.posting_timestamp, '+7 hours') <= date(?)";
      queryParams.push(req.query.start_date, req.query.end_date);
    } else if (req.query.start_date) {
      dateFilterClause = "AND date(sm.posting_timestamp, '+7 hours') >= date(?)";
      queryParams.push(req.query.start_date);
    } else if (req.query.end_date) {
      dateFilterClause = "AND date(sm.posting_timestamp, '+7 hours') <= date(?)";
      queryParams.push(req.query.end_date);
    }

    // Fetch movements with optional date filtering
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
        sm.notes,
        usr.full_name AS actor_name
      FROM material_stock_movements sm
      JOIN materials m ON m.id = sm.material_id
      LEFT JOIN uoms u ON u.id = m.base_uom_id
      LEFT JOIN users usr ON usr.id = sm.actor_id
      WHERE sm.stock_location_id = ?
        AND sm.movement_type = 'PURCHASE_RECEIPT'
        ${dateFilterClause}
      ORDER BY sm.posting_timestamp DESC
    `).all(...queryParams);

    // Group items by session (source_reference atau posting_mutation_id) for clean session grouping
    const sessionMap = new Map();
    for (const r of rows) {
      const pId = r.source_reference || r.posting_mutation_id || r.id;
      let receiptPhoto = null;
      if (r.notes) {
        try {
          const parsed = JSON.parse(r.notes);
          if (parsed && parsed.receipt_photo_url) receiptPhoto = parsed.receipt_photo_url;
        } catch (_) {}
      }
      if (!sessionMap.has(pId)) {
        sessionMap.set(pId, {
          posting_id: pId,
          timestamp: r.posting_timestamp,
          actor_name: r.actor_name || 'Petugas Belanja',
          total_spend: 0,
          receipt_photo_url: receiptPhoto,
          items: []
        });
      }
      const session = sessionMap.get(pId);
      if (!session.receipt_photo_url && receiptPhoto) {
        session.receipt_photo_url = receiptPhoto;
      }
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
        po.po_number,
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
          u.allows_fraction,
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

// GET /admin/branches/:id/purchasing/suppliers
// Provides branch purchasing staff with official supplier contact book (Phone, WA, address, terms)
router.get('/admin/branches/:id/purchasing/suppliers', requireAuth(['owner', 'brand_manager', 'branch_manager', 'purchasing']), (req, res) => {
  try {
    if (['branch_manager', 'purchasing'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const orgRow = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(req.brand_id);
    const orgId = orgRow ? orgRow.organization_id : null;
    if (!orgId) return res.status(400).json({ success: false, error: 'ORG_NOT_FOUND' });

    const suppliers = db.prepare(`
      SELECT 
        s.id, s.supplier_code, s.name, s.category, s.contact_person, s.phone, s.address,
        s.payment_terms, s.bank_name, s.bank_account_number, s.bank_account_name, s.notes,
        (SELECT COUNT(*) FROM supplier_materials sm WHERE sm.supplier_id = s.id AND sm.is_active = 1) AS items_supplied_count
      FROM suppliers s
      WHERE s.organization_id = ? AND s.status = 'ACTIVE'
      ORDER BY s.name ASC
    `).all(orgId);

    res.json({ success: true, branch_id: req.params.id, suppliers });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/purchasing/suppliers]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

};
