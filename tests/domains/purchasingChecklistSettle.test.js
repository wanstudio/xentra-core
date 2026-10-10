'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('crypto');

const db = require('../../server/database/db');
const registerBranchOpsRoutes = require('../../server/routes/admin-branch-operations');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.brand_id = req.headers['x-brand-id'] || null;
    next();
  });
  const router = express.Router();
  const requireAuth = (allowedRoles) => (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    }
    const token = auth.slice(7);
    const session = global.TokenSessionStore ? global.TokenSessionStore.getSession(token) : null;
    if (!session) {
      return res.status(401).json({ success: false, error: 'INVALID_TOKEN' });
    }
    const user = session.user || session;
    if (allowedRoles && allowedRoles.length && !allowedRoles.includes(user.role)) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    }
    req.user = user;
    next();
  };

  registerBranchOpsRoutes(router, { db, requireAuth });
  app.use(router);
  return app;
}

test.describe('Purchasing / Belanja Pasar Operational Workflow', () => {
  const orgId = 'org_test_purchasing';
  const brandId = 'brand_test_purchasing';
  const branchId = 'branch_test_purchasing';
  const locationId = 'loc_test_purchasing';
  let materialId1 = null;
  let materialId2 = null;
  const uomKgId = 'uom_kg_purchasing';

  let server;
  let baseUrl;
  let purchasingToken;
  let managerToken;

  test.before(async () => {
    await db.readyPromise;

    // Ensure TokenSessionStore exists
    require('../../server/routes/api'); // loads TokenSessionStore into global

    // 1. Seed org, brand, branch, stock location
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)`).run(orgId, 'Org Purchasing', 'org-purchasing');
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)`).run(brandId, orgId, 'Brand Purchasing', 'brand-purchasing');
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, 0, 0)`).run(branchId, brandId, 'Cabang Pasar', 'cabang-pasar', 'Pasar Tradisional No 1');
    db.prepare(`INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, 'LOC-PURCH', 'Gudang Cabang', 'BRANCH', 1)`).run(locationId, orgId, branchId);

    // 2. Create Materials via MaterialService
    const MaterialService = require('../../domains/material/services/MaterialService');
    const mat1 = MaterialService.createMaterial({
      organizationId: orgId,
      materialCode: 'MAT-CABAI',
      name: 'Cabai Rawit Merah',
      baseUomId: 'uom_kg',
      status: 'ACTIVE'
    });
    const mat2 = MaterialService.createMaterial({
      organizationId: orgId,
      materialCode: 'MAT-BAWANG',
      name: 'Bawang Merah',
      baseUomId: 'uom_kg',
      status: 'ACTIVE'
    });
    materialId1 = mat1.id;
    materialId2 = mat2.id;

    // 3. Seed reorder policies: Cabai min 5 kg, target 15 kg; Bawang min 10 kg, target 20 kg
    db.prepare(`INSERT OR REPLACE INTO inventory_reorder_policies (stock_location_id, identity_type, identity_id, minimum_quantity, target_quantity) VALUES (?, 'MATERIAL', ?, 5, 15)`).run(locationId, materialId1);
    db.prepare(`INSERT OR REPLACE INTO inventory_reorder_policies (stock_location_id, identity_type, identity_id, minimum_quantity, target_quantity) VALUES (?, 'MATERIAL', ?, 10, 20)`).run(locationId, materialId2);

    // 4. Seed initial stock balance: Cabai has 2 kg (LOW! last cost 40,000/kg), Bawang has 15 kg (NORMAL, last cost 30,000/kg)
    db.prepare(`INSERT OR REPLACE INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version, created_at, updated_at) VALUES (?, ?, 2, 80000, 40000, 'AVAILABLE', 1, ?, ?)`).run(locationId, materialId1, new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT OR REPLACE INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version, created_at, updated_at) VALUES (?, ?, 15, 450000, 30000, 'AVAILABLE', 1, ?, ?)`).run(locationId, materialId2, new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT OR REPLACE INTO material_stock_movements (id, stock_location_id, material_id, movement_type, quantity_base, previous_quantity, current_quantity, unit_cost, total_cost, cost_basis_type, source_type, source_reference, posting_mutation_id, currency_code, valuation_version, posting_timestamp, created_at) VALUES ('mov_bawang_init', ?, ?, 'OPENING_STOCK', 15, 0, 15, 30000, 450000, 'OPENING_ACTUAL', 'OPENING_BALANCE', 'INIT-BAWANG-01', 'pm_init_bawang_01', 'IDR', 1, datetime('now', '-1 day'), datetime('now', '-1 day'))`).run(locationId, materialId2);

    // 5. Create user and session for purchasing staff and branch manager
    db.prepare(`INSERT OR IGNORE INTO users (id, brand_id, branch_id, username, role, full_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, 'hash', ?)`).run(
      'user_purchasing_1', brandId, branchId, 'budi_belanja', 'purchasing', 'Budi Petugas Belanja', new Date().toISOString()
    );
    db.prepare(`INSERT OR IGNORE INTO users (id, brand_id, branch_id, username, role, full_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, 'hash', ?)`).run(
      'user_manager_1', brandId, branchId, 'manager_andi', 'branch_manager', 'Andi Branch Manager', new Date().toISOString()
    );

    const purchasingUser = {
      id: 'user_purchasing_1',
      username: 'budi_belanja',
      role: 'purchasing',
      brand_id: brandId,
      branch_id: branchId,
      full_name: 'Budi Petugas Belanja'
    };
    const session = global.TokenSessionStore.createSession(purchasingUser, brandId);
    purchasingToken = session.token;

    const managerUser = {
      id: 'user_manager_1',
      username: 'manager_andi',
      role: 'branch_manager',
      brand_id: brandId,
      branch_id: branchId,
      full_name: 'Andi Branch Manager'
    };
    const mgrSession = global.TokenSessionStore.createSession(managerUser, brandId);
    managerToken = mgrSession.token;

    server = buildApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  });

  test.after(() => {
    if (server) server.close();
  });

  test('1. GET /admin/branches/:id/purchasing/checklist returns low stock items with suggested qty and estimated budget', async () => {
    const res = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/checklist`, {
      headers: {
        'Authorization': `Bearer ${purchasingToken}`,
        'X-Brand-Id': brandId
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.branch_id, branchId);
    assert.ok(Array.isArray(body.items));

    // Cabai Rawit (current 2 <= min 5) -> is_low: true, suggested_qty: 15 - 2 = 13 kg
    const cabai = body.items.find(i => i.material_id === materialId1);
    assert.ok(cabai);
    assert.equal(cabai.is_low, true);
    assert.equal(cabai.suggested_qty, 13);
    assert.equal(cabai.last_unit_cost, 40000);
    assert.equal(cabai.estimated_subtotal, 13 * 40000); // 520,000

    // Bawang Merah (current 15 > min 10) -> is_low: false
    const bawang = body.items.find(i => i.material_id === materialId2);
    assert.ok(bawang);
    assert.equal(bawang.is_low, false);
    assert.equal(bawang.suggested_qty, 0);

    // Total estimated budget matches cabai
    assert.equal(body.total_estimated_budget, 520000);
  });

  test('2. POST /admin/branches/:id/purchasing/settle receives cash advance, updates stock, updates average cost, and returns change due', async () => {
    // Staff buys 10 kg of Cabai at new market price 45,000/kg (total 450,000)
    // Cash advance from owner/kasir: Rp 500,000
    // Expected change due: Rp 50,000
    const payload = {
      cash_advance: 500000,
      notes: 'Belanja Cabai di Pasar Pagi',
      items: [
        {
          material_id: materialId1,
          quantity: 10,
          unit_price: 45000
        }
      ]
    };

    const res = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/settle`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${purchasingToken}`,
        'X-Brand-Id': brandId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.cash_advance, 500000);
    assert.equal(body.total_real_expenditure, 450000);
    assert.equal(body.change_due, 50000);
    assert.equal(body.items_recorded, 1);
    assert.ok(body.posting_id);

    // Verify stock balance in DB:
    // Previous: 2 kg @ 40,000 = 80,000
    // Added: 10 kg @ 45,000 = 450,000
    // New total qty: 12 kg
    // New total carrying value: 530,000
    // New moving avg cost: 530,000 / 12 = 44,167
    const balance = db.prepare(`SELECT * FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?`).get(locationId, materialId1);
    assert.equal(balance.quantity_base, 12);
    assert.equal(balance.carrying_value, 530000);
    assert.ok(Math.abs(balance.moving_average_unit_cost - (530000 / 12)) < 0.001);

    // Verify ledger movement
    const movement = db.prepare(`SELECT * FROM material_stock_movements WHERE source_reference = ? AND material_id = ?`).get(body.posting_id, materialId1);
    assert.ok(movement);
    assert.equal(movement.movement_type, 'PURCHASE_RECEIPT');
    assert.equal(movement.quantity_base, 10);
    assert.equal(movement.previous_quantity, 2);
    assert.equal(movement.current_quantity, 12);
    assert.equal(movement.unit_cost, 45000);
    assert.equal(movement.total_cost, 450000);
  });

  test('3. Scoped access prevents purchasing staff from accessing other branches', async () => {
    const res = await fetch(`${baseUrl}/admin/branches/other_branch_id/purchasing/checklist`, {
      headers: {
        'Authorization': `Bearer ${purchasingToken}`,
        'X-Brand-Id': brandId
      }
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'FORBIDDEN_BRANCH_SCOPE');
  });

  test('4. GET /admin/branches/:id/purchasing/history returns grouped history sessions from last 7 days', async () => {
    const res = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/history`, {
      headers: {
        'Authorization': `Bearer ${purchasingToken}`,
        'X-Brand-Id': brandId
      }
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.sessions));
    assert.ok(body.sessions.length >= 1);
    assert.equal(body.sessions[0].total_spend, 450000);
    assert.equal(body.sessions[0].items[0].material_id, materialId1);
    assert.equal(body.sessions[0].items[0].unit_price, 45000);
  });

  test('5. GET orders and POST receive allow purchasing staff to confirm Goods Receipt for own branch PO', async () => {
    const { ProcurementService } = require('../../domains/procurement');
    const sup = ProcurementService.createSupplier({
      organizationId: orgId,
      supplierCode: 'SUP-TEST-GR',
      name: 'Supplier GR Test',
      status: 'ACTIVE'
    });
    const supMat = ProcurementService.createSupplierMaterial({
      supplierId: sup.id,
      materialId: materialId2
    });
    const pack = ProcurementService.createSupplierMaterialPack({
      supplierMaterialId: supMat.id,
      name: 'Pack Bawang 5kg',
      contentQuantityBase: 5,
      contentUomId: 'uom_kg',
      unitPrice: 150000,
      currencyCode: 'IDR',
      minimumOrderQuantity: 1
    });

    const po = ProcurementService.createPurchaseOrder({
      organizationId: orgId,
      supplierId: sup.id,
      destinationStockLocationId: locationId,
      lines: [{
        supplier_material_id: supMat.id,
        supplier_pack_id: pack.id,
        ordered_purchase_quantity: 2
      }],
      createdBy: 'owner'
    });

    ProcurementService.approvePurchaseOrder({ purchaseOrderId: po.id });
    ProcurementService.orderPurchaseOrder({ purchaseOrderId: po.id });

    // Purchasing staff fetch orders
    const getRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/orders`, {
      headers: {
        'Authorization': `Bearer ${purchasingToken}`,
        'X-Brand-Id': brandId
      }
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.success, true);
    const targetPo = getBody.orders.find(o => o.id === po.id);
    assert.ok(targetPo);
    assert.equal(targetPo.lines.length, 1);

    // Purchasing staff receive goods
    const polId = targetPo.lines[0].purchase_order_line_id;
    const receiveRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/orders/${po.id}/receive`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${purchasingToken}`,
        'X-Brand-Id': brandId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lines: [{
          purchase_order_line_id: polId,
          accepted_purchase_quantity: 2,
          rejected_purchase_quantity: 0
        }]
      })
    });

    assert.equal(receiveRes.status, 200);
    const receiveBody = await receiveRes.json();
    assert.equal(receiveBody.success, true);
    assert.ok(receiveBody.goods_receipt);

    // Verify stock is updated in location
    const balance = db.prepare('SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?').get(locationId, materialId2);
    // Initial 15 kg + (2 packs * 5 kg = 10 kg) = 25 kg
    assert.equal(Number(balance.quantity_base), 25);
  });

  test('6. Branch Manager Purchasing Mandate Lifecycle: Create, Edit, Archive, and Delete', async () => {
    // 1. Manager creates a mandate
    const createRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/mandates`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${managerToken}`,
        'X-Brand-Id': brandId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cash_advance: 200000,
        notes: 'Belanja Sayur dan Bumbu Segar',
        items: [
          { material_id: materialId1, target_quantity: 4, estimated_unit_price: 40000 },
          { material_id: materialId2, target_quantity: 3, estimated_unit_price: 30000 }
        ]
      })
    });

    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.equal(createBody.success, true);
    assert.ok(createBody.mandate.id);
    assert.equal(createBody.mandate.status, 'RELEASED');
    assert.equal(createBody.mandate.total_planned_budget, 250000); // 4*40k + 3*30k = 160k + 90k = 250k
    const mandateId = createBody.mandate.id;

    // 2. Fetch mandates list (accessible by purchasing staff and manager)
    const listRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/mandates`, {
      headers: {
        'Authorization': `Bearer ${purchasingToken}`,
        'X-Brand-Id': brandId
      }
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.success, true);
    const foundMandate = listBody.mandates.find(m => m.id === mandateId);
    assert.ok(foundMandate);
    assert.equal(foundMandate.items.length, 2);

    // 3. Manager edits mandate: adjust cash_advance and quantities
    const editRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/mandates/${mandateId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${managerToken}`,
        'X-Brand-Id': brandId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cash_advance: 220000,
        notes: 'Updated: Belanja Tambahan Cabai',
        items: [
          { material_id: materialId1, target_quantity: 5, estimated_unit_price: 40000 }
        ]
      })
    });
    assert.equal(editRes.status, 200);
    const editBody = await editRes.json();
    assert.equal(editBody.success, true);

    const updatedMandate = db.prepare('SELECT * FROM purchasing_mandates WHERE id = ?').get(mandateId);
    assert.equal(updatedMandate.cash_advance, 220000);
    assert.equal(updatedMandate.total_planned_budget, 200000); // 5 * 40k = 200k

    // 4. Archive mandate
    const archiveRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/mandates/${mandateId}/archive`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${managerToken}`,
        'X-Brand-Id': brandId
      }
    });
    assert.equal(archiveRes.status, 200);
    const archivedMandate = db.prepare('SELECT status FROM purchasing_mandates WHERE id = ?').get(mandateId);
    assert.equal(archivedMandate.status, 'ARCHIVED');

    // 5. Delete mandate
    const deleteRes = await fetch(`${baseUrl}/admin/branches/${branchId}/purchasing/mandates/${mandateId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${managerToken}`,
        'X-Brand-Id': brandId
      }
    });
    assert.equal(deleteRes.status, 200);
    const deletedMandate = db.prepare('SELECT id FROM purchasing_mandates WHERE id = ?').get(mandateId);
    assert.equal(deletedMandate, undefined);
    const deletedItems = db.prepare('SELECT id FROM purchasing_mandate_items WHERE mandate_id = ?').all(mandateId);
    assert.equal(deletedItems.length, 0);
  });
});

