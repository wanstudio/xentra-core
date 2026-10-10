const db = require('../server/database/db.js');

function seedPurchasingDemo() {
  const branchId = 'branch_1789606246242_08knv';
  const orgId = 'org_xentra_holding';

  // 1. Ensure stock location
  let loc = db.prepare('SELECT id FROM stock_locations WHERE branch_id = ?').get(branchId);
  if (!loc) {
    const locId = 'sl_bangjo_pringsewu';
    db.prepare(`
      INSERT INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active)
      VALUES (?, ?, ?, 'LOC-PRINGSEWU', 'Gudang Utama Pringsewu', 'BRANCH', 1)
    `).run(locId, orgId, branchId);
    loc = { id: locId };
    console.log('[Seed] Created stock location:', locId);
  } else {
    console.log('[Seed] Found existing stock location:', loc.id);
  }

  // 2. Ensure raw materials
  const mats = [
    { id: 'mat_ayam_fresh', code: 'AYM-01', name: 'Daging Ayam Fillet', uom: 'uom_kg', min: 10, target: 25, price: 38000, cur: 4 },
    { id: 'mat_cabai_rawit', code: 'CBR-01', name: 'Cabai Rawit Merah', uom: 'uom_kg', min: 3, target: 8, price: 65000, cur: 1 },
    { id: 'mat_bawang_merah', code: 'BWM-01', name: 'Bawang Merah Brebes', uom: 'uom_kg', min: 5, target: 12, price: 32000, cur: 2 }
  ];

  for (const m of mats) {
    db.prepare(`
      INSERT OR IGNORE INTO materials (id, organization_id, material_code, name, base_uom_id, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `).run(m.id, orgId, m.code, m.name, m.uom);

    db.prepare(`
      INSERT OR REPLACE INTO inventory_reorder_policies (
        stock_location_id, identity_type, identity_id,
        minimum_quantity, target_quantity
      ) VALUES (?, 'MATERIAL', ?, ?, ?)
    `).run(loc.id, m.id, m.min, m.target);

    db.prepare(`
      INSERT OR REPLACE INTO material_stock_balances (
        stock_location_id, material_id, quantity_base, carrying_value,
        moving_average_unit_cost, cost_availability_status, valuation_version
      ) VALUES (?, ?, ?, ?, ?, 'AVAILABLE', 1)
    `).run(loc.id, m.id, m.cur, m.cur * m.price, m.price);
  }
  console.log('[Seed] Materials & stock policies ready.');

  // 3. Create 1 demo mandate for Pasar
  const mandateId = 'pm_demo_pasar_01';
  db.prepare('DELETE FROM purchasing_mandate_items WHERE mandate_id = ?').run(mandateId);
  db.prepare('DELETE FROM purchasing_mandates WHERE id = ?').run(mandateId);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO purchasing_mandates (
      id, mandate_number, branch_id, cash_advance, total_planned_budget,
      status, notes, created_by, created_at, updated_at, is_deleted
    ) VALUES (?, 'BLJ-882190', ?, 150000, 141000, 'RELEASED', 'Mandat belanja bumbu dan ayam pagi', 'usr_747961ecffd5c9dcd350f218', ?, ?, 0)
  `).run(mandateId, branchId, now, now);

  db.prepare(`
    INSERT INTO purchasing_mandate_items (
      id, mandate_id, material_id, target_quantity, estimated_unit_price, is_purchased
    ) VALUES
    ('pmi_demo_1', ?, 'mat_ayam_fresh', 2, 38000, 0),
    ('pmi_demo_2', ?, 'mat_cabai_rawit', 1, 65000, 0)
  `).run(mandateId, mandateId);
  console.log('[Seed] Pasar mandate seeded:', mandateId);

  // 4. Create 1 demo supplier, packs, and 1 active PO
  const supplierId = 'sup_unggas_barokah';
  db.prepare(`
    INSERT OR IGNORE INTO suppliers (id, organization_id, supplier_code, name, status)
    VALUES (?, ?, 'SUP-BRK-01', 'PT Barokah Unggas Jaya', 'ACTIVE')
  `).run(supplierId, orgId);

  const smId = 'sm_ayam_barokah';
  db.prepare(`
    INSERT OR IGNORE INTO supplier_materials (id, supplier_id, material_id, supplier_item_code, is_active)
    VALUES (?, ?, 'mat_ayam_fresh', 'UB-AYM-FILLET', 1)
  `).run(smId, supplierId);

  const packId = 'smp_ayam_karton_10kg';
  db.prepare(`
    INSERT OR IGNORE INTO supplier_material_packs (
      id, supplier_material_id, name, purchase_uom_id, content_quantity,
      content_uom_id, minimum_order_quantity, unit_price, currency_code, is_active
    ) VALUES (?, ?, 'Karton Segel 10 Kg', 'uom_pcs', 10, 'uom_kg', 1, 350000, 'IDR', 1)
  `).run(packId, smId);

  const poId = 'po_demo_supplier_01';
  db.prepare('DELETE FROM purchase_order_lines WHERE purchase_order_id = ?').run(poId);
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(poId);

  db.prepare(`
    INSERT INTO purchase_orders (
      id, po_number, organization_id, supplier_id, destination_stock_location_id,
      status, required_at, ordered_at, created_by, created_at, updated_at
    ) VALUES (?, 'PO-261010-0001', ?, ?, ?, 'ORDERED', ?, ?, 'usr_747961ecffd5c9dcd350f218', ?, ?)
  `).run(poId, orgId, supplierId, loc.id, now, now, now, now);

  db.prepare(`
    INSERT INTO purchase_order_lines (
      id, purchase_order_id, supplier_material_id, ordered_purchase_quantity,
      purchase_uom_id, supplier_pack_id, resolved_base_quantity, unit_price,
      currency_code, base_quantity_per_purchase_unit, received_base_quantity
    ) VALUES
    ('pol_demo_01', ?, ?, 2, NULL, ?, 20, 350000, 'IDR', 10, 0)
  `).run(poId, smId, packId);
  console.log('[Seed] PO supplier seeded:', poId);
}

if (require.main === module) {
  seedPurchasingDemo();
}

module.exports = { seedPurchasingDemo };
