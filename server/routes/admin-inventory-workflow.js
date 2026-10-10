'use strict';

const crypto = require('crypto');
const InventoryRepository = require('../../core/data/repositories/InventoryRepository');
const MaterialRepository = require('../../core/data/repositories/MaterialRepository');
const UomRepository = require('../../core/data/repositories/UomRepository');
const ProcurementRepository = require('../../core/data/repositories/ProcurementRepository');
const ProductionRepository = require('../../core/data/repositories/ProductionRepository');
const { ProcurementService, ReplenishmentService } = require('../../domains/procurement');
const { ProductionService } = require('../../domains/production');

const inventoryRepository = new InventoryRepository();
const materialRepository = new MaterialRepository();
const uomRepository = new UomRepository();
const procurementRepository = new ProcurementRepository();
const productionRepository = new ProductionRepository();

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}
function required(value, code) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw fail(code);
  return v;
}
function positive(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw fail(code);
  return n;
}
function nonNegative(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw fail(code);
  return n;
}
function makeId(prefix) {
  return prefix + crypto.randomBytes(8).toString('hex');
}
function respondError(res, error) {
  const code = error && (error.code || error.message) || 'INVENTORY_WORKFLOW_FAILED';
  const status = error && error.status || (/(NOT_FOUND|INVALID|REQUIRED|EXISTS|MISMATCH|INSUFFICIENT|UNRESOLVED|AMBIGUOUS|SCOPE|STATUS|QUANTITY|ALREADY|MISSING|DUPLICATE|CATEGORY|CURRENCY|COST|LOCATION|RECIPE|SUPPLIER|MATERIAL|PRODUCT|PURCHASE_ORDER|GOODS_RECEIPT|PRODUCTION|UOM|STOCK)/i.test(code) ? 400 : 500);
  return res.status(status).json({ success: false, error: code, code, batch_id: error && error.batchId ? error.batchId : null });
}
function organizationId(req) {
  const value = (req.user && req.user.organization_id) || (req.brand && req.brand.organization_id) || null;
  if (!value) throw fail('ORGANIZATION_REQUIRED', 403);
  return String(value);
}
function getBranch(db, branchId, orgId) {
  return db.queryOne('SELECT b.id, b.name, b.brand_id, br.organization_id FROM branches b JOIN brands br ON br.id = b.brand_id WHERE b.id = ? AND br.organization_id = ?', [branchId, orgId]);
}
function getLocation(db, locationId, orgId) {
  const location = db.queryOne('SELECT id, organization_id, branch_id, code, name, location_type, is_active FROM stock_locations WHERE id = ?', [locationId]);
  if (!location || String(location.organization_id) !== String(orgId) || Number(location.is_active) !== 1) throw fail('STOCK_LOCATION_INVALID', 404);
  return location;
}
function listContext(req, db) {
  const orgId = organizationId(req);
  const branches = db.queryMany('SELECT b.id, b.name, b.brand_id, br.organization_id FROM branches b JOIN brands br ON br.id = b.brand_id WHERE br.organization_id = ? ORDER BY b.name', [orgId]);
  const locations = db.queryMany('SELECT sl.id, sl.organization_id, sl.branch_id, sl.code, sl.name, sl.location_type, b.name AS branch_name FROM stock_locations sl LEFT JOIN branches b ON b.id = sl.branch_id WHERE sl.organization_id = ? AND sl.is_active = 1 ORDER BY sl.name', [orgId]);
  const uoms = uomRepository.listActive();
  const materials = materialRepository.listByOrganization(orgId);
  const materialBalances = db.queryMany("SELECT msb.stock_location_id, sl.name AS stock_location_name, sl.branch_id, msb.material_id, m.material_code, m.name AS material_name, m.base_uom_id, u.name AS base_uom_name, u.code AS base_uom_code, msb.quantity_base AS quantity, msb.carrying_value, msb.moving_average_unit_cost, msb.cost_availability_status, COALESCE(rp.minimum_quantity, 0) AS minimum_quantity, COALESCE(rp.target_quantity, 0) AS target_quantity FROM material_stock_balances msb JOIN stock_locations sl ON sl.id = msb.stock_location_id JOIN materials m ON m.id = msb.material_id JOIN uoms u ON u.id = m.base_uom_id LEFT JOIN inventory_reorder_policies rp ON rp.stock_location_id = msb.stock_location_id AND rp.identity_type = 'MATERIAL' AND rp.identity_id = msb.material_id WHERE sl.organization_id = ? ORDER BY sl.name, m.name", [orgId]);
  const reorderPolicies = db.queryMany("SELECT rp.stock_location_id, sl.branch_id, rp.identity_type, rp.identity_id, rp.minimum_quantity, rp.target_quantity, rp.updated_at FROM inventory_reorder_policies rp JOIN stock_locations sl ON sl.id = rp.stock_location_id WHERE sl.organization_id = ? ORDER BY sl.name, rp.identity_type, rp.identity_id", [orgId]);
  const products = db.queryMany("SELECT p.id, p.name, p.sku, p.brand_id, br.organization_id, p.product_stock_uom_id, u.name AS stock_uom_name, u.code AS stock_uom_code FROM products p JOIN brands br ON br.id = p.brand_id LEFT JOIN uoms u ON u.id = p.product_stock_uom_id WHERE br.organization_id = ? AND p.is_active = 1 AND p.sku IS NOT NULL AND trim(p.sku) <> '' ORDER BY p.name", [orgId]);
  const productBalances = db.queryMany("SELECT psb.stock_location_id, sl.name AS stock_location_name, sl.branch_id, psb.product_id, p.name AS product_name, p.sku, psb.quantity, psb.carrying_value, psb.moving_average_unit_cost, psb.cost_availability_status, COALESCE(rp.minimum_quantity, bpi.low_stock_threshold, 0) AS minimum_quantity, COALESCE(rp.target_quantity, bpi.low_stock_threshold, 0) AS target_quantity FROM product_stock_balances psb JOIN stock_locations sl ON sl.id = psb.stock_location_id JOIN products p ON p.id = psb.product_id LEFT JOIN inventory_reorder_policies rp ON rp.stock_location_id = psb.stock_location_id AND rp.identity_type = 'PRODUCT' AND rp.identity_id = psb.product_id LEFT JOIN branch_product_inventory bpi ON bpi.branch_id = sl.branch_id AND bpi.product_id = psb.product_id WHERE sl.organization_id = ? ORDER BY sl.name, p.name", [orgId]);
  const suppliers = db.queryMany("SELECT id, organization_id, supplier_code, name, status FROM suppliers WHERE organization_id = ? AND status <> 'ARCHIVED' ORDER BY name", [orgId]);
  const supplierItems = db.queryMany("SELECT sm.id AS supplier_material_id, sm.supplier_id, s.name AS supplier_name, sm.material_id, m.material_code, m.name AS material_name, m.base_uom_id, u.name AS base_uom_name, sm.supplier_item_code, sm.is_active FROM supplier_materials sm JOIN suppliers s ON s.id = sm.supplier_id JOIN materials m ON m.id = sm.material_id JOIN uoms u ON u.id = m.base_uom_id WHERE s.organization_id = ? AND s.status <> 'ARCHIVED' AND sm.is_active = 1 ORDER BY s.name, m.name", [orgId]);
  const supplierPacks = db.queryMany("SELECT smp.id, smp.supplier_material_id, sm.supplier_id, s.name AS supplier_name, sm.material_id, m.name AS material_name, smp.name, smp.content_quantity, smp.content_uom_id, cu.name AS content_uom_name, smp.minimum_order_quantity, smp.unit_price, smp.currency_code, smp.is_active FROM supplier_material_packs smp JOIN supplier_materials sm ON sm.id = smp.supplier_material_id JOIN suppliers s ON s.id = sm.supplier_id JOIN materials m ON m.id = sm.material_id JOIN uoms cu ON cu.id = smp.content_uom_id WHERE s.organization_id = ? AND s.status <> 'ARCHIVED' AND sm.is_active = 1 AND smp.is_active = 1 ORDER BY s.name, m.name, smp.name", [orgId]);
  const purchaseOrders = db.queryMany("SELECT po.id, po.supplier_id, s.name AS supplier_name, po.destination_stock_location_id, sl.name AS destination_name, po.status, po.required_at, po.created_at, po.ordered_at, COUNT(pol.id) AS line_count, COALESCE(SUM(pol.ordered_purchase_quantity * pol.unit_price), 0) AS ordered_value FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN stock_locations sl ON sl.id = po.destination_stock_location_id LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id WHERE po.organization_id = ? GROUP BY po.id ORDER BY po.created_at DESC LIMIT 30", [orgId]);
  const purchaseOrderLines = db.queryMany("SELECT pol.*, sm.material_id, m.name AS material_name, m.base_uom_id, base_uom.name AS base_uom_name, smp.name AS supplier_pack_name, smp.content_quantity, smp.content_uom_id, cu.name AS purchase_uom_name FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id JOIN supplier_materials sm ON sm.id = pol.supplier_material_id JOIN materials m ON m.id = sm.material_id JOIN uoms base_uom ON base_uom.id = m.base_uom_id LEFT JOIN supplier_material_packs smp ON smp.id = pol.supplier_pack_id LEFT JOIN uoms cu ON cu.id = pol.purchase_uom_id WHERE po.organization_id = ? ORDER BY po.created_at DESC, pol.id", [orgId]);
  const recipes = db.queryMany("SELECT pi.id AS production_item_id, pi.output_product_id, pi.production_item_code, pi.name AS production_item_name, pi.status AS production_item_status, r.id AS recipe_id, r.name AS recipe_name, r.status AS recipe_status, rv.id AS recipe_version_id, rv.version_number, rv.status AS recipe_version_status, rv.planned_yield_quantity, rv.yield_uom_id, yu.name AS yield_uom_name, p.name AS output_product_name, p.sku AS output_product_sku, p.price AS selling_price, pil.stock_location_id FROM production_items pi JOIN products p ON p.id = pi.output_product_id JOIN brands br ON br.id = p.brand_id AND br.organization_id = pi.organization_id JOIN recipes r ON r.production_item_id = pi.id JOIN recipe_versions rv ON rv.recipe_id = r.id JOIN uoms yu ON yu.id = rv.yield_uom_id JOIN production_item_locations pil ON pil.production_item_id = pi.id AND pil.is_active = 1 WHERE pi.organization_id = ? AND pi.status = 'ACTIVE' AND r.status = 'ACTIVE' ORDER BY pi.name, rv.version_number DESC", [orgId]);
  recipes.forEach(function (recipe) {
    recipe.components = db.queryMany("SELECT rc.material_id, m.material_code, m.name AS material_name, rc.planned_quantity, rc.planned_uom_id, u.name AS planned_uom_name, m.base_uom_id, bu.name AS base_uom_name, COALESCE(msb.moving_average_unit_cost, 0) AS unit_cost FROM recipe_components rc JOIN materials m ON m.id = rc.material_id JOIN uoms u ON u.id = rc.planned_uom_id JOIN uoms bu ON bu.id = m.base_uom_id LEFT JOIN (SELECT material_id, AVG(moving_average_unit_cost) AS moving_average_unit_cost FROM material_stock_balances WHERE moving_average_unit_cost > 0 GROUP BY material_id) msb ON msb.material_id = rc.material_id WHERE rc.recipe_version_id = ? ORDER BY rc.sort_order, m.name", [recipe.recipe_version_id]);
    let totalCost = 0;
    recipe.components.forEach(function (comp) {
      totalCost += Number(comp.planned_quantity || 0) * Number(comp.unit_cost || 0);
    });
    const yieldQty = Number(recipe.planned_yield_quantity) || 1;
    recipe.total_batch_cost = Math.round(totalCost);
    recipe.cost_per_unit = Math.round(yieldQty > 0 ? totalCost / yieldQty : totalCost);
  });
  const batches = db.queryMany("SELECT pb.id, pb.status, pb.recipe_version_id, pb.production_item_id, pi.output_product_id, pb.production_stock_location_id, pb.input_stock_location_id, pb.output_stock_location_id, pb.planned_output_quantity, pb.actual_output_quantity, pb.production_posting_id, pb.created_at, pb.started_at, pb.completed_at, pi.name AS production_item_name, p.name AS output_product_name, p.sku, rv.version_number, rv.planned_yield_quantity, rv.yield_uom_id, pcs.actual_material_cost, pcs.production_output_unit_cost, pcs.currency_code FROM production_batches pb JOIN production_items pi ON pi.id = pb.production_item_id JOIN products p ON p.id = pi.output_product_id JOIN recipe_versions rv ON rv.id = pb.recipe_version_id LEFT JOIN production_cost_snapshots pcs ON pcs.production_batch_id = pb.id WHERE pb.organization_id = ? ORDER BY pb.created_at DESC LIMIT 20", [orgId]);
  return { organization_id: orgId, branches, locations, uoms, materials, material_balances: materialBalances, reorder_policies: reorderPolicies, products, product_balances: productBalances, suppliers, supplier_materials: supplierItems, supplier_packs: supplierPacks, purchase_orders: purchaseOrders, purchase_order_lines: purchaseOrderLines, recipes, batches };
}

function registerAdminInventoryWorkflowRoutes(router, deps = {}) {
  const requireAuth = typeof deps.requireAuth === 'function' ? deps.requireAuth : () => (req, res, next) => next();
  const authGate = requireAuth(['owner', 'brand_manager']);
  const db = deps.db && typeof deps.db.queryMany === 'function' ? deps.db : inventoryRepository.db;

  router.get('/admin/inventory-workflow/context', authGate, (req, res) => {
    try { return res.json({ success: true, data: listContext(req, db) }); }
    catch (error) { return respondError(res, error); }
  });

  router.get('/admin/inventory-workflow/replenishment-suggestions', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const stockLocationId = req.query && req.query.stock_location_id || null;
      const branchId = req.query && req.query.branch_id || null;
      const result = ReplenishmentService.calculateReplenishment({
        organizationId: orgId,
        stockLocationId,
        branchId,
        dbInstance: db
      });
      return res.json({ success: true, data: result });
    } catch (error) { return respondError(res, error); }
  });

  router.post('/admin/inventory-workflow/locations/branch', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const branchId = required(req.body && req.body.branch_id, 'BRANCH_REQUIRED');
      const branch = getBranch(db, branchId, orgId);
      if (!branch) throw fail('BRANCH_NOT_FOUND', 404);
      const existing = db.queryMany("SELECT id, organization_id, branch_id, code, name, location_type, is_active FROM stock_locations WHERE organization_id = ? AND branch_id = ? AND location_type = 'BRANCH' ORDER BY is_active DESC, id", [orgId, branchId]);
      const active = existing.filter(function (item) { return Number(item.is_active) === 1; });
      if (active.length > 1) throw fail('BRANCH_STOCK_LOCATION_AMBIGUOUS', 409);
      if (active.length === 1) return res.json({ success: true, location: active[0], idempotent: true });
      const now = new Date().toISOString();
      if (existing.length) {
        db.execute("UPDATE stock_locations SET is_active = 1, updated_at = ? WHERE id = ? AND organization_id = ?", [now, existing[0].id, orgId]);
        return res.json({ success: true, location: Object.assign({}, existing[0], { is_active: 1, updated_at: now }), reactivated: true });
      }
      const location = { id: makeId('sl_'), organization_id: orgId, branch_id: branchId, code: 'BRANCH-' + branchId, name: branch.name + ' — Persediaan', location_type: 'BRANCH', is_active: 1, created_at: now, updated_at: now };
      db.execute("INSERT INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'BRANCH', 1, ?, ?)", [location.id, orgId, branchId, location.code, location.name, now, now]);
      return res.status(201).json({ success: true, location: location });
    } catch (error) { return respondError(res, error); }
  });

  router.put('/admin/inventory-workflow/reorder-policy', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const locationId = required(req.body && req.body.stock_location_id, 'STOCK_LOCATION_REQUIRED');
      const identityType = required(req.body && req.body.identity_type, 'STOCK_IDENTITY_TYPE_REQUIRED').toUpperCase();
      const identityId = required(req.body && req.body.identity_id, 'STOCK_IDENTITY_REQUIRED');
      const minimum = nonNegative(req.body.minimum_quantity, 'REORDER_MINIMUM_INVALID');
      const target = nonNegative(req.body.target_quantity, 'REORDER_TARGET_INVALID');
      if (!['MATERIAL', 'PRODUCT'].includes(identityType)) throw fail('STOCK_IDENTITY_TYPE_INVALID');
      if (target < minimum) throw fail('REORDER_TARGET_BELOW_MINIMUM');
      getLocation(db, locationId, orgId);
      if (identityType === 'MATERIAL') {
        const material = materialRepository.findById(identityId);
        if (!material || String(material.organization_id) !== orgId || material.status === 'ARCHIVED') throw fail('MATERIAL_NOT_FOUND', 404);
      } else {
        const product = inventoryRepository.findProductForValuation(identityId);
        if (!product || Number(product.is_active) !== 1 || String(product.organization_id) !== orgId || !String(product.sku || '').trim()) throw fail('PRODUCT_NOT_FOUND', 404);
      }
      const actor = req.user && req.user.id || null;
      const now = new Date().toISOString();
      db.execute("INSERT INTO inventory_reorder_policies (stock_location_id, identity_type, identity_id, minimum_quantity, target_quantity, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(stock_location_id, identity_type, identity_id) DO UPDATE SET minimum_quantity = excluded.minimum_quantity, target_quantity = excluded.target_quantity, updated_by = excluded.updated_by, updated_at = excluded.updated_at", [locationId, identityType, identityId, minimum, target, actor, now, now]);
      return res.json({ success: true, stock_location_id: locationId, identity_type: identityType, identity_id: identityId, minimum_quantity: minimum, target_quantity: target });
    } catch (error) { return respondError(res, error); }
  });

  router.post('/admin/inventory-workflow/suppliers', authGate, (req, res) => {
    try {
      const supplier = ProcurementService.createSupplier({
        organizationId: organizationId(req),
        supplierCode: required(req.body && req.body.supplier_code, 'SUPPLIER_CODE_REQUIRED').toUpperCase(),
        name: required(req.body && req.body.name, 'SUPPLIER_NAME_REQUIRED'),
        status: 'ACTIVE',
        repository: procurementRepository
      });
      return res.status(201).json({ success: true, supplier: supplier });
    } catch (error) { return respondError(res, error); }
  });

  router.post('/admin/inventory-workflow/supplier-materials', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const supplierId = required(req.body && req.body.supplier_id, 'SUPPLIER_REQUIRED');
      const materialId = required(req.body && req.body.material_id, 'MATERIAL_REQUIRED');
      const supplier = procurementRepository.findSupplier(supplierId);
      const material = materialRepository.findById(materialId);
      if (!supplier || String(supplier.organization_id) !== orgId) throw fail('SUPPLIER_NOT_FOUND', 404);
      if (!material || String(material.organization_id) !== orgId || material.status === 'ARCHIVED') throw fail('MATERIAL_NOT_FOUND', 404);
      const supplierMaterial = ProcurementService.createSupplierMaterial({
        supplierId: supplierId,
        materialId: materialId,
        supplierItemCode: req.body && req.body.supplier_item_code || null,
        repository: procurementRepository
      });
      return res.status(201).json({ success: true, supplier_material: supplierMaterial });
    } catch (error) { return respondError(res, error); }
  });

  router.post('/admin/inventory-workflow/supplier-packs', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const supplierMaterialId = required(req.body && req.body.supplier_material_id, 'SUPPLIER_MATERIAL_REQUIRED');
      const supplierMaterial = procurementRepository.findSupplierMaterial(supplierMaterialId);
      if (!supplierMaterial || String(supplierMaterial.organization_id) !== orgId || Number(supplierMaterial.is_active) !== 1) throw fail('SUPPLIER_MATERIAL_NOT_FOUND', 404);
      const supplierPack = ProcurementService.createSupplierMaterialPack({
        supplierMaterialId: supplierMaterialId,
        name: required(req.body && req.body.name, 'SUPPLIER_PACK_NAME_REQUIRED'),
        contentQuantityBase: positive(req.body && req.body.content_quantity, 'SUPPLIER_PACK_CONTENT_INVALID'),
        contentUomId: required(req.body && req.body.content_uom_id, 'SUPPLIER_PACK_UOM_REQUIRED'),
        unitPrice: nonNegative(req.body && req.body.unit_price, 'PURCHASE_PRICE_INVALID'),
        currencyCode: req.body && req.body.currency_code || 'IDR',
        minimumOrderQuantity: positive(req.body && req.body.minimum_order_quantity || 1, 'SUPPLIER_PACK_MINIMUM_INVALID'),
        repository: procurementRepository
      });
      return res.status(201).json({ success: true, supplier_pack: supplierPack });
    } catch (error) { return respondError(res, error); }
  });

  router.post('/admin/inventory-workflow/purchase-orders', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const location = getLocation(db, required(req.body && req.body.destination_stock_location_id, 'STOCK_LOCATION_REQUIRED'), orgId);
      const supplierId = required(req.body && req.body.supplier_id, 'SUPPLIER_REQUIRED');
      const inputLines = req.body && req.body.lines;
      if (!Array.isArray(inputLines) || inputLines.length === 0) throw fail('PURCHASE_ORDER_LINES_REQUIRED');
      const po = ProcurementService.createPurchaseOrder({
        organizationId: orgId, supplierId, destinationStockLocationId: location.id,
        createdBy: req.user && req.user.id || null, requiredAt: req.body.required_at || null,
        lines: inputLines.map(function (line) {
          return {
            supplier_material_id: required(line.supplier_material_id, 'SUPPLIER_MATERIAL_REQUIRED'),
            supplier_pack_id: required(line.supplier_pack_id, 'SUPPLIER_PACK_REQUIRED'),
            purchase_uom_id: null,
            ordered_purchase_quantity: positive(line.ordered_purchase_quantity, 'INVALID_QUANTITY'),
            unit_price: nonNegative(line.unit_price, 'PURCHASE_PRICE_INVALID'),
            currency_code: line.currency_code || 'IDR'
          };
        }),
        repository: procurementRepository
      });
      return res.status(201).json({ success: true, purchase_order: po, lines: procurementRepository.findPurchaseOrderLines(po.id) });
    } catch (error) { return respondError(res, error); }
  });

  router.post('/admin/inventory-workflow/purchase-orders/:id/order', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const po = procurementRepository.findPurchaseOrder(req.params.id);
      if (!po || String(po.organization_id) !== orgId) throw fail('PURCHASE_ORDER_NOT_FOUND', 404);
      let next = po;
      if (next.status === 'DRAFT') next = ProcurementService.approvePurchaseOrder({ purchaseOrderId: po.id, repository: procurementRepository });
      if (next.status === 'APPROVED') next = ProcurementService.orderPurchaseOrder({ purchaseOrderId: po.id, repository: procurementRepository });
      if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(next.status)) throw fail('PURCHASE_ORDER_STATUS_INVALID');
      return res.json({ success: true, purchase_order: next });
    } catch (error) { return respondError(res, error); }
  });

  router.post('/admin/inventory-workflow/purchase-orders/:id/receive', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const po = procurementRepository.findPurchaseOrder(req.params.id);
      if (!po || String(po.organization_id) !== orgId) throw fail('PURCHASE_ORDER_NOT_FOUND', 404);
      const lines = req.body && req.body.lines;
      const receipt = ProcurementService.postGoodsReceipt({
        purchaseOrderId: po.id,
        goodsReceiptPostingId: required(req.body && req.body.goods_receipt_posting_id, 'GOODS_RECEIPT_POSTING_ID_REQUIRED'),
        receivedBy: req.user && req.user.id || null,
        receivedAt: new Date().toISOString(),
        lines: Array.isArray(lines) ? lines.map(function (line) {
          return {
            purchase_order_line_id: required(line.purchase_order_line_id, 'PURCHASE_ORDER_LINE_NOT_FOUND'),
            accepted_purchase_quantity: positive(line.accepted_purchase_quantity, 'INVALID_QUANTITY'),
            rejected_purchase_quantity: nonNegative(line.rejected_purchase_quantity || 0, 'INVALID_QUANTITY')
          };
        }) : [],
        repository: procurementRepository
      });
      return res.json({ success: true, goods_receipt: receipt });
    } catch (error) { return respondError(res, error); }
  });

  router.post('/admin/inventory-workflow/recipes', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const location = getLocation(db, required(req.body && req.body.stock_location_id, 'STOCK_LOCATION_REQUIRED'), orgId);
      const outputProductId = required(req.body && req.body.output_product_id, 'OUTPUT_PRODUCT_REQUIRED');
      const product = inventoryRepository.findProductForValuation(outputProductId);
      if (!product || Number(product.is_active) !== 1 || String(product.organization_id) !== orgId || !String(product.sku || '').trim()) throw fail('PRODUCT_NOT_FOUND', 404);
      const components = req.body && req.body.components;
      if (!Array.isArray(components) || components.length === 0) throw fail('RECIPE_COMPONENTS_REQUIRED');
      const existingRoute = productionRepository.findProductionItemByProductAndLocation(outputProductId, location.id);
      if (existingRoute.length) throw fail('PRODUCTION_ROUTE_ALREADY_EXISTS');
      const outputUomRow = db.queryOne('SELECT product_stock_uom_id FROM products WHERE id = ?', [outputProductId]);
      const outputUom = outputUomRow && outputUomRow.product_stock_uom_id ? uomRepository.findById(outputUomRow.product_stock_uom_id) : null;
      const yieldUomId = required(req.body && req.body.yield_uom_id, 'YIELD_UOM_REQUIRED');
      const yieldUom = uomRepository.findById(yieldUomId);
      if (!outputUom || Number(outputUom.is_active) !== 1) throw fail('PRODUCT_STOCK_UOM_UNRESOLVED');
      if (!yieldUom || Number(yieldUom.is_active) !== 1 || String(yieldUom.category_id) !== String(outputUom.category_id)) throw fail('YIELD_UOM_CATEGORY_MISMATCH');
      const seenMaterials = new Set();
      components.forEach(function (line) {
        const materialId = required(line.material_id, 'MATERIAL_REQUIRED');
        if (seenMaterials.has(materialId)) throw fail('RECIPE_COMPONENT_DUPLICATE');
        seenMaterials.add(materialId);
        const material = materialRepository.findById(materialId);
        const plannedUom = uomRepository.findById(required(line.planned_uom_id, 'RECIPE_COMPONENT_UOM_REQUIRED'));
        const baseUom = material && uomRepository.findById(material.base_uom_id);
        if (!material || material.status !== 'ACTIVE' || String(material.organization_id) !== orgId) throw fail('MATERIAL_NOT_FOUND');
        if (!plannedUom || Number(plannedUom.is_active) !== 1 || !baseUom || String(plannedUom.category_id) !== String(baseUom.category_id)) throw fail('RECIPE_COMPONENT_UOM_CATEGORY_MISMATCH');
        positive(line.planned_quantity, 'INVALID_RECIPE_COMPONENT_QUANTITY');
      });
      const plannedYieldQuantity = positive(req.body.planned_yield_quantity, 'INVALID_YIELD_QUANTITY');
      const code = String(req.body.production_item_code || ('PRD-' + String(product.sku).replace(/[^A-Z0-9_-]/gi, '').toUpperCase() + '-' + Date.now().toString(36))).slice(0, 80);
      const recipeName = required(req.body && req.body.name, 'PRODUCTION_ITEM_NAME_REQUIRED');
      const existingRoutes = productionRepository.findProductionItemByProductAndLocation(outputProductId, location.id);
      if (existingRoutes.length > 1) throw fail('PRODUCTION_ROUTE_AMBIGUOUS');
      let item;
      let recipe;
      if (existingRoutes.length === 1) {
        item = productionRepository.findProductionItem(existingRoutes[0].id);
        if (!item || String(item.organization_id) !== orgId) throw fail('PRODUCTION_ITEM_NOT_FOUND', 404);
        recipe = productionRepository.findRecipeByProductionItemId(item.id);
        if (!recipe) {
          recipe = ProductionService.createRecipe({ productionItemId: item.id, name: recipeName, repository: productionRepository });
          ProductionService.activateRecipe({ recipeId: recipe.id, repository: productionRepository });
        }
      } else {
        item = ProductionService.createProductionItem({ organizationId: orgId, outputProductId: outputProductId, productionItemCode: code, name: recipeName, repository: productionRepository });
        ProductionService.activateProductionItem({ productionItemId: item.id, repository: productionRepository });
        ProductionService.addProductionLocation({ productionItemId: item.id, stockLocationId: location.id, repository: productionRepository });
        recipe = ProductionService.createRecipe({ productionItemId: item.id, name: recipeName, repository: productionRepository });
        ProductionService.activateRecipe({ recipeId: recipe.id, repository: productionRepository });
      }
      const version = ProductionService.createRecipeVersion({
        recipeId: recipe.id,
        plannedYieldQuantity: plannedYieldQuantity,
        yieldUomId: yieldUomId,
        components: components.map(function (line, index) {
          return {
            material_id: required(line.material_id, 'MATERIAL_REQUIRED'),
            planned_quantity: positive(line.planned_quantity, 'INVALID_RECIPE_COMPONENT_QUANTITY'),
            planned_uom_id: required(line.planned_uom_id, 'RECIPE_COMPONENT_UOM_REQUIRED'),
            sort_order: index
          };
        }),
        repository: productionRepository
      });
      const published = ProductionService.publishRecipeVersion({ recipeVersionId: version.recipe_version.id, repository: productionRepository });
      return res.status(201).json({ success: true, production_item: item, recipe: recipe, recipe_version: published, components: version.components, stock_location_id: location.id });
    } catch (error) { return respondError(res, error); }
  });

  router.post('/admin/inventory-workflow/production-batches', authGate, (req, res) => {
    let batch = null;
    try {
      const orgId = organizationId(req);
      const location = getLocation(db, required(req.body && req.body.stock_location_id, 'STOCK_LOCATION_REQUIRED'), orgId);
      const outputProductId = required(req.body && req.body.output_product_id, 'OUTPUT_PRODUCT_REQUIRED');
      const plannedOutput = positive(req.body && req.body.planned_output_quantity, 'INVALID_OUTPUT_QUANTITY');
      const actualOutput = positive(req.body && req.body.actual_output_quantity, 'INVALID_OUTPUT_QUANTITY');
      const actualConsumptions = req.body && req.body.actual_consumptions;
      const postingId = required(req.body && req.body.production_posting_id, 'PRODUCTION_POSTING_ID_REQUIRED');
      if (!Array.isArray(actualConsumptions) || actualConsumptions.length === 0) throw fail('ACTUAL_CONSUMPTION_REQUIRED');

      const requestedBatchId = req.body && req.body.production_batch_id ? required(req.body.production_batch_id, 'PRODUCTION_BATCH_NOT_FOUND') : null;
      if (requestedBatchId) {
        batch = productionRepository.findProductionBatch(requestedBatchId);
        if (!batch || String(batch.organization_id) !== orgId) throw fail('PRODUCTION_BATCH_NOT_FOUND', 404);
        const batchItem = productionRepository.findProductionItem(batch.production_item_id);
        if (
          !batchItem ||
          String(batchItem.output_product_id) !== String(outputProductId) ||
          String(batch.production_stock_location_id) !== String(location.id) ||
          Math.abs(Number(batch.planned_output_quantity) - plannedOutput) > 0.000001
        ) throw fail('PRODUCTION_BATCH_CONTEXT_MISMATCH');
        if (!['DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED'].includes(batch.status)) throw fail('PRODUCTION_BATCH_STATUS_INVALID');
      } else {
        batch = ProductionService.createProductionBatch({
          outputProductId: outputProductId,
          productionStockLocationId: location.id,
          inputStockLocationId: location.id,
          outputStockLocationId: location.id,
          plannedOutputQuantity: plannedOutput,
          createdBy: req.user && req.user.id || null,
          repository: productionRepository
        });
      }

      if (batch.status === 'DRAFT') {
        ProductionService.planProductionBatch({ productionBatchId: batch.id, repository: productionRepository });
        batch = productionRepository.findProductionBatch(batch.id);
      }
      if (batch.status === 'PLANNED') {
        ProductionService.startProductionBatch({ productionBatchId: batch.id, startedBy: req.user && req.user.id || null, repository: productionRepository });
        batch = productionRepository.findProductionBatch(batch.id);
      }
      const result = ProductionService.completeProductionBatch({
        productionBatchId: batch.id,
        productionPostingId: postingId,
        actualOutputQuantity: actualOutput,
        actualConsumptions: actualConsumptions.map(function (line) {
          return { material_id: required(line.material_id, 'MATERIAL_REQUIRED'), source_uom_id: required(line.source_uom_id, 'SOURCE_UOM_REQUIRED'), actual_quantity: positive(line.actual_quantity, 'INVALID_CONSUMPTION_QUANTITY') };
        }),
        currency: req.body && req.body.currency_code || 'IDR',
        completedBy: req.user && req.user.id || null,
        repository: productionRepository,
        inventory: inventoryRepository
      });
      return res.status(200).json({ success: true, production_batch: productionRepository.findProductionBatch(batch.id), posting: result, batch_id: batch.id });
    } catch (error) {
      if (batch && batch.id) error.batchId = batch.id;
      return respondError(res, error);
    }
  });

  router.get('/admin/inventory-workflow/production-batches/:id', authGate, (req, res) => {
    try {
      const orgId = organizationId(req);
      const batch = productionRepository.findProductionBatch(req.params.id);
      if (!batch || String(batch.organization_id) !== orgId) throw fail('PRODUCTION_BATCH_NOT_FOUND', 404);
      return res.json({ success: true, production_batch: batch, consumptions: productionRepository.findProductionBatchConsumptions(batch.id), cost_snapshot: productionRepository.findProductionCostSnapshot(batch.id) });
    } catch (error) { return respondError(res, error); }
  });
}

module.exports = registerAdminInventoryWorkflowRoutes;
