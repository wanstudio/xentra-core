'use strict';

const ensuredDbs = new WeakSet();

function ensureProcurementDocumentSchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      supplier_code TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (organization_id, supplier_code),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_suppliers_org_status
      ON suppliers(organization_id, status, supplier_code);

    CREATE TABLE IF NOT EXISTS supplier_materials (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      supplier_item_code TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (supplier_id, material_id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_supplier_materials_material
      ON supplier_materials(material_id, supplier_id, is_active);

    CREATE TABLE IF NOT EXISTS supplier_material_packs (
      id TEXT PRIMARY KEY,
      supplier_material_id TEXT NOT NULL,
      name TEXT NOT NULL,
      purchase_uom_id TEXT,
      content_quantity_base REAL NOT NULL
        CHECK (content_quantity_base > 0),
      content_uom_id TEXT NOT NULL,
      minimum_order_quantity REAL NOT NULL DEFAULT 1
        CHECK (minimum_order_quantity > 0),
      unit_price REAL NOT NULL
        CHECK (unit_price >= 0),
      currency_code TEXT NOT NULL
        CHECK (currency_code GLOB '[A-Z][A-Z][A-Z]'),
      effective_from TEXT,
      effective_to TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_material_id) REFERENCES supplier_materials(id) ON DELETE RESTRICT,
      FOREIGN KEY (purchase_uom_id) REFERENCES uoms(id) ON DELETE RESTRICT,
      FOREIGN KEY (content_uom_id) REFERENCES uoms(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_supplier_material_packs_active
      ON supplier_material_packs(supplier_material_id, is_active, effective_from);

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      destination_stock_location_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
      required_at TEXT,
      created_by TEXT,
      approved_by TEXT,
      approved_at TEXT,
      ordered_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      FOREIGN KEY (destination_stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_purchase_orders_org_status
      ON purchase_orders(organization_id, status, created_at);

    CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL,
      supplier_material_id TEXT NOT NULL,
      ordered_purchase_quantity REAL NOT NULL
        CHECK (ordered_purchase_quantity > 0),
      purchase_uom_id TEXT,
      supplier_pack_id TEXT,
      resolved_base_quantity REAL NOT NULL
        CHECK (resolved_base_quantity > 0),
      unit_price REAL NOT NULL
        CHECK (unit_price >= 0),
      currency_code TEXT NOT NULL
        CHECK (currency_code GLOB '[A-Z][A-Z][A-Z]'),
      base_quantity_per_purchase_unit REAL NOT NULL
        CHECK (base_quantity_per_purchase_unit > 0),
      received_base_quantity REAL NOT NULL DEFAULT 0
        CHECK (received_base_quantity >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (
        (purchase_uom_id IS NOT NULL AND supplier_pack_id IS NULL)
        OR
        (purchase_uom_id IS NULL AND supplier_pack_id IS NOT NULL)
      ),
      CHECK (received_base_quantity <= resolved_base_quantity + 0.000001),
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (supplier_material_id) REFERENCES supplier_materials(id) ON DELETE RESTRICT,
      FOREIGN KEY (purchase_uom_id) REFERENCES uoms(id) ON DELETE RESTRICT,
      FOREIGN KEY (supplier_pack_id) REFERENCES supplier_material_packs(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_po
      ON purchase_order_lines(purchase_order_id);

    CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_supplier_material
      ON purchase_order_lines(supplier_material_id);

    CREATE TABLE IF NOT EXISTS goods_receipts (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL,
      destination_stock_location_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
      goods_receipt_posting_id TEXT UNIQUE,
      received_by TEXT,
      received_at TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
      FOREIGN KEY (destination_stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_goods_receipts_po_status
      ON goods_receipts(purchase_order_id, status, created_at);

    CREATE TABLE IF NOT EXISTS goods_receipt_lines (
      id TEXT PRIMARY KEY,
      goods_receipt_id TEXT NOT NULL,
      purchase_order_line_id TEXT NOT NULL,
      accepted_purchase_quantity REAL NOT NULL
        CHECK (accepted_purchase_quantity > 0),
      rejected_purchase_quantity REAL NOT NULL DEFAULT 0
        CHECK (rejected_purchase_quantity >= 0),
      accepted_base_quantity REAL NOT NULL
        CHECK (accepted_base_quantity > 0),
      purchase_uom_id TEXT,
      supplier_pack_id TEXT,
      conversion_factor_snapshot REAL NOT NULL
        CHECK (conversion_factor_snapshot > 0),
      resolved_unit_cost REAL NOT NULL
        CHECK (resolved_unit_cost >= 0),
      accepted_total_cost REAL NOT NULL
        CHECK (accepted_total_cost >= 0),
      agreed_unit_price REAL NOT NULL
        CHECK (agreed_unit_price >= 0),
      currency_code TEXT NOT NULL
        CHECK (currency_code GLOB '[A-Z][A-Z][A-Z]'),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id) ON DELETE CASCADE,
      FOREIGN KEY (purchase_order_line_id) REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
      FOREIGN KEY (purchase_uom_id) REFERENCES uoms(id) ON DELETE RESTRICT,
      FOREIGN KEY (supplier_pack_id) REFERENCES supplier_material_packs(id) ON DELETE RESTRICT,
      CHECK (
        (purchase_uom_id IS NOT NULL AND supplier_pack_id IS NULL)
        OR
        (purchase_uom_id IS NULL AND supplier_pack_id IS NOT NULL)
      ),
      CHECK (abs(accepted_total_cost - (accepted_base_quantity * resolved_unit_cost)) <= 0.000001)
    );

    CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_receipt
      ON goods_receipt_lines(goods_receipt_id);

    CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_po_line
      ON goods_receipt_lines(purchase_order_line_id);

    CREATE TRIGGER IF NOT EXISTS trg_supplier_material_org_scope
    BEFORE INSERT ON supplier_materials
    FOR EACH ROW
    WHEN
      (SELECT organization_id FROM suppliers WHERE id = NEW.supplier_id) IS NULL
      OR
      (SELECT organization_id FROM suppliers WHERE id = NEW.supplier_id) <>
      (SELECT organization_id FROM materials WHERE id = NEW.material_id)
    BEGIN
      SELECT RAISE(ABORT, 'SUPPLIER_MATERIAL_ORG_SCOPE_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_supplier_material_pack_uom_scope
    BEFORE INSERT ON supplier_material_packs
    FOR EACH ROW
    WHEN
      (NEW.purchase_uom_id IS NOT NULL AND
       (SELECT is_active FROM uoms WHERE id = NEW.purchase_uom_id) <> 1)
      OR
      (SELECT is_active FROM uoms WHERE id = NEW.content_uom_id) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'SUPPLIER_MATERIAL_PACK_UOM_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_purchase_order_org_scope
    BEFORE INSERT ON purchase_orders
    FOR EACH ROW
    WHEN
      (SELECT organization_id FROM suppliers WHERE id = NEW.supplier_id) IS NULL
      OR
      (SELECT organization_id FROM suppliers WHERE id = NEW.supplier_id) <> NEW.organization_id
      OR
      (SELECT organization_id FROM stock_locations WHERE id = NEW.destination_stock_location_id) <> NEW.organization_id
      OR
      (SELECT is_active FROM stock_locations WHERE id = NEW.destination_stock_location_id) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'PURCHASE_ORDER_SCOPE_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_purchase_order_line_reference_scope
    BEFORE INSERT ON purchase_order_lines
    FOR EACH ROW
    WHEN
      (SELECT id FROM supplier_materials WHERE id = NEW.supplier_material_id) IS NULL
      OR
      (SELECT s.organization_id
         FROM supplier_materials sm
         JOIN suppliers s ON s.id = sm.supplier_id
        WHERE sm.id = NEW.supplier_material_id) <>
      (SELECT organization_id FROM purchase_orders WHERE id = NEW.purchase_order_id)
    BEGIN
      SELECT RAISE(ABORT, 'PURCHASE_ORDER_LINE_SCOPE_INVALID');
    END;
  `);

  ensuredDbs.add(db);
}

module.exports = { ensureProcurementDocumentSchema };
