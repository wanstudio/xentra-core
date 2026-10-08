'use strict';

/**
 * Cost-bearing Inventory target schema.
 *
 * Domain owner: Inventory.
 * This is an additive migration seam. It does not reinterpret or replace
 * legacy branch_products / inventory_movements data.
 */
const ensuredDbs = new WeakSet();

function ensureCostBearingInventorySchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_locations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      branch_id TEXT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      location_type TEXT NOT NULL
        CHECK (location_type IN ('BRANCH', 'CENTRAL_WAREHOUSE', 'CENTRAL_KITCHEN', 'OTHER')),
      is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (organization_id, code),
      CHECK (location_type <> 'BRANCH' OR branch_id IS NOT NULL),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stock_locations_org_active
      ON stock_locations(organization_id, is_active, location_type);

    CREATE INDEX IF NOT EXISTS idx_stock_locations_branch_active
      ON stock_locations(branch_id, is_active);

    CREATE TABLE IF NOT EXISTS material_stock_balances (
      stock_location_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      quantity_base REAL NOT NULL DEFAULT 0
        CHECK (quantity_base >= 0),
      carrying_value REAL NOT NULL DEFAULT 0
        CHECK (carrying_value >= 0),
      moving_average_unit_cost REAL NOT NULL DEFAULT 0
        CHECK (moving_average_unit_cost >= 0),
      valuation_version INTEGER NOT NULL DEFAULT 0
        CHECK (valuation_version >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (stock_location_id, material_id),
      CHECK (
        quantity_base = 0
        AND carrying_value = 0
        AND moving_average_unit_cost = 0
        OR
        quantity_base > 0
        AND abs(carrying_value - (quantity_base * moving_average_unit_cost)) <= 0.000001
      ),
      FOREIGN KEY (stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_material_stock_balances_material
      ON material_stock_balances(material_id, stock_location_id);

    CREATE TABLE IF NOT EXISTS product_stock_balances (
      stock_location_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0
        CHECK (quantity >= 0),
      carrying_value REAL NOT NULL DEFAULT 0
        CHECK (carrying_value >= 0),
      moving_average_unit_cost REAL NOT NULL DEFAULT 0
        CHECK (moving_average_unit_cost >= 0),
      valuation_version INTEGER NOT NULL DEFAULT 0
        CHECK (valuation_version >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (stock_location_id, product_id),
      CHECK (
        quantity = 0
        AND carrying_value = 0
        AND moving_average_unit_cost = 0
        OR
        quantity > 0
        AND abs(carrying_value - (quantity * moving_average_unit_cost)) <= 0.000001
      ),
      FOREIGN KEY (stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_product_stock_balances_product
      ON product_stock_balances(product_id, stock_location_id);

    CREATE TRIGGER IF NOT EXISTS trg_product_stock_balance_org_scope_insert
    BEFORE INSERT ON product_stock_balances
    FOR EACH ROW
    WHEN
      (SELECT organization_id
         FROM brands
        WHERE id = (SELECT brand_id FROM products WHERE id = NEW.product_id)) IS NULL
      OR
      (SELECT organization_id
         FROM stock_locations
        WHERE id = NEW.stock_location_id) <>
      (SELECT organization_id
         FROM brands
        WHERE id = (SELECT brand_id FROM products WHERE id = NEW.product_id))
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCT_STOCK_LOCATION_ORG_SCOPE_MISMATCH');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_product_stock_balance_org_scope_update
    BEFORE UPDATE OF stock_location_id, product_id ON product_stock_balances
    FOR EACH ROW
    WHEN
      (SELECT organization_id
         FROM brands
        WHERE id = (SELECT brand_id FROM products WHERE id = NEW.product_id)) IS NULL
      OR
      (SELECT organization_id
         FROM stock_locations
        WHERE id = NEW.stock_location_id) <>
      (SELECT organization_id
         FROM brands
        WHERE id = (SELECT brand_id FROM products WHERE id = NEW.product_id))
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCT_STOCK_LOCATION_ORG_SCOPE_MISMATCH');
    END;

    CREATE TABLE IF NOT EXISTS material_stock_movements (
      id TEXT PRIMARY KEY,
      stock_location_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      movement_type TEXT NOT NULL
        CHECK (movement_type IN (
          'PURCHASE_RECEIPT',
          'TRANSFER_IN',
          'TRANSFER_OUT',
          'PRODUCTION_ISSUE',
          'OPENING_STOCK',
          'ADJUSTMENT_IN',
          'ADJUSTMENT_OUT',
          'WASTE'
        )),
      quantity_base REAL NOT NULL
        CHECK (quantity_base <> 0),
      previous_quantity REAL NOT NULL
        CHECK (previous_quantity >= 0),
      current_quantity REAL NOT NULL
        CHECK (current_quantity >= 0),
      unit_cost REAL NOT NULL
        CHECK (unit_cost >= 0),
      total_cost REAL NOT NULL,
      valuation_method TEXT NOT NULL DEFAULT 'MOVING_AVERAGE'
        CHECK (valuation_method = 'MOVING_AVERAGE'),
      cost_basis_type TEXT NOT NULL
        CHECK (cost_basis_type IN (
          'PURCHASE_RECEIPT',
          'PRODUCTION_OUTPUT',
          'TRANSFER_CARRIED',
          'OPENING_ACTUAL',
          'OPENING_ESTIMATE',
          'COUNT_CORRECTION',
          'CURRENT_MOVING_AVERAGE'
        )),
      source_type TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      source_movement_id TEXT,
      posting_mutation_id TEXT NOT NULL UNIQUE,
      valuation_version INTEGER NOT NULL
        CHECK (valuation_version >= 1),
      posting_timestamp TEXT NOT NULL,
      actor_id TEXT,
      resolver_version TEXT NOT NULL DEFAULT 'v1',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (abs(total_cost - (quantity_base * unit_cost)) <= 0.000001),
      CHECK (
        (quantity_base > 0 AND total_cost >= 0)
        OR
        (quantity_base < 0 AND total_cost <= 0)
      ),
      CHECK (
        (movement_type IN ('PURCHASE_RECEIPT', 'TRANSFER_IN', 'OPENING_STOCK', 'ADJUSTMENT_IN')
          AND quantity_base > 0)
        OR
        (movement_type IN ('TRANSFER_OUT', 'PRODUCTION_ISSUE', 'ADJUSTMENT_OUT', 'WASTE')
          AND quantity_base < 0)
      ),
      CHECK (
        (movement_type = 'TRANSFER_IN' AND cost_basis_type = 'TRANSFER_CARRIED')
        OR
        (movement_type <> 'TRANSFER_IN')
      ),
      CHECK (
        (movement_type = 'PURCHASE_RECEIPT' AND cost_basis_type = 'PURCHASE_RECEIPT')
        OR
        (movement_type <> 'PURCHASE_RECEIPT')
      ),
      FOREIGN KEY (stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
      FOREIGN KEY (source_movement_id) REFERENCES material_stock_movements(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_material_stock_movements_key_posting
      ON material_stock_movements(stock_location_id, material_id, posting_timestamp, valuation_version);

    CREATE INDEX IF NOT EXISTS idx_material_stock_movements_source
      ON material_stock_movements(source_type, source_reference);

    CREATE INDEX IF NOT EXISTS idx_material_stock_movements_source_movement
      ON material_stock_movements(source_movement_id);

    CREATE TRIGGER IF NOT EXISTS trg_material_stock_movement_transfer_source
    BEFORE INSERT ON material_stock_movements
    FOR EACH ROW
    WHEN NEW.movement_type = 'TRANSFER_IN'
    BEGIN
      SELECT CASE
        WHEN NEW.source_movement_id IS NULL
          OR (SELECT movement_type
                FROM material_stock_movements
               WHERE id = NEW.source_movement_id) <> 'TRANSFER_OUT'
          OR (SELECT material_id
                FROM material_stock_movements
               WHERE id = NEW.source_movement_id) <> NEW.material_id
          OR NEW.source_movement_id = NEW.id
        THEN RAISE(ABORT, 'TRANSFER_SOURCE_MOVEMENT_INVALID')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_material_stock_movement_balance_match
    AFTER INSERT ON material_stock_movements
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1
            FROM material_stock_balances b
           WHERE b.stock_location_id = NEW.stock_location_id
             AND b.material_id = NEW.material_id
             AND b.quantity_base = NEW.current_quantity
             AND b.valuation_version = NEW.valuation_version
        )
        THEN RAISE(ABORT, 'MATERIAL_MOVEMENT_BALANCE_VERSION_MISMATCH')
      END;

      SELECT CASE
        WHEN abs(NEW.current_quantity - (NEW.previous_quantity + NEW.quantity_base)) > 0.000001
        THEN RAISE(ABORT, 'MATERIAL_MOVEMENT_QUANTITY_MISMATCH')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_material_stock_movement_immutable_update
    BEFORE UPDATE ON material_stock_movements
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'POSTED_STOCK_MOVEMENT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_material_stock_movement_immutable_delete
    BEFORE DELETE ON material_stock_movements
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'POSTED_STOCK_MOVEMENT_IMMUTABLE');
    END;

    CREATE TABLE IF NOT EXISTS product_stock_movements (
      id TEXT PRIMARY KEY,
      stock_location_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      movement_type TEXT NOT NULL
        CHECK (movement_type IN (
          'PRODUCTION_OUTPUT',
          'TRANSFER_IN',
          'TRANSFER_OUT',
          'SALE',
          'OPENING_STOCK',
          'ADJUSTMENT_IN',
          'ADJUSTMENT_OUT',
          'WASTE'
        )),
      quantity REAL NOT NULL
        CHECK (quantity <> 0),
      previous_quantity REAL NOT NULL
        CHECK (previous_quantity >= 0),
      current_quantity REAL NOT NULL
        CHECK (current_quantity >= 0),
      unit_cost REAL NOT NULL
        CHECK (unit_cost >= 0),
      total_cost REAL NOT NULL,
      valuation_method TEXT NOT NULL DEFAULT 'MOVING_AVERAGE'
        CHECK (valuation_method = 'MOVING_AVERAGE'),
      cost_basis_type TEXT NOT NULL
        CHECK (cost_basis_type IN (
          'PURCHASE_RECEIPT',
          'PRODUCTION_OUTPUT',
          'TRANSFER_CARRIED',
          'OPENING_ACTUAL',
          'OPENING_ESTIMATE',
          'COUNT_CORRECTION',
          'CURRENT_MOVING_AVERAGE'
        )),
      source_type TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      source_movement_id TEXT,
      posting_mutation_id TEXT NOT NULL UNIQUE,
      valuation_version INTEGER NOT NULL
        CHECK (valuation_version >= 1),
      posting_timestamp TEXT NOT NULL,
      actor_id TEXT,
      resolver_version TEXT NOT NULL DEFAULT 'v1',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (abs(total_cost - (quantity * unit_cost)) <= 0.000001),
      CHECK (
        (quantity > 0 AND total_cost >= 0)
        OR
        (quantity < 0 AND total_cost <= 0)
      ),
      CHECK (
        (movement_type IN ('PRODUCTION_OUTPUT', 'TRANSFER_IN', 'OPENING_STOCK', 'ADJUSTMENT_IN')
          AND quantity > 0)
        OR
        (movement_type IN ('TRANSFER_OUT', 'SALE', 'ADJUSTMENT_OUT', 'WASTE')
          AND quantity < 0)
      ),
      CHECK (
        (movement_type = 'PRODUCTION_OUTPUT' AND cost_basis_type = 'PRODUCTION_OUTPUT')
        OR
        (movement_type <> 'PRODUCTION_OUTPUT')
      ),
      CHECK (
        (movement_type = 'TRANSFER_IN' AND cost_basis_type = 'TRANSFER_CARRIED')
        OR
        (movement_type <> 'TRANSFER_IN')
      ),
      FOREIGN KEY (stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
      FOREIGN KEY (source_movement_id) REFERENCES product_stock_movements(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_product_stock_movements_key_posting
      ON product_stock_movements(stock_location_id, product_id, posting_timestamp, valuation_version);

    CREATE INDEX IF NOT EXISTS idx_product_stock_movements_source
      ON product_stock_movements(source_type, source_reference);

    CREATE INDEX IF NOT EXISTS idx_product_stock_movements_source_movement
      ON product_stock_movements(source_movement_id);

    CREATE TRIGGER IF NOT EXISTS trg_product_stock_movement_transfer_source
    BEFORE INSERT ON product_stock_movements
    FOR EACH ROW
    WHEN NEW.movement_type = 'TRANSFER_IN'
    BEGIN
      SELECT CASE
        WHEN NEW.source_movement_id IS NULL
          OR (SELECT movement_type
                FROM product_stock_movements
               WHERE id = NEW.source_movement_id) <> 'TRANSFER_OUT'
          OR (SELECT product_id
                FROM product_stock_movements
               WHERE id = NEW.source_movement_id) <> NEW.product_id
          OR NEW.source_movement_id = NEW.id
        THEN RAISE(ABORT, 'TRANSFER_SOURCE_MOVEMENT_INVALID')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_product_stock_movement_balance_match
    AFTER INSERT ON product_stock_movements
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1
            FROM product_stock_balances b
           WHERE b.stock_location_id = NEW.stock_location_id
             AND b.product_id = NEW.product_id
             AND b.quantity = NEW.current_quantity
             AND b.valuation_version = NEW.valuation_version
        )
        THEN RAISE(ABORT, 'PRODUCT_MOVEMENT_BALANCE_VERSION_MISMATCH')
      END;

      SELECT CASE
        WHEN abs(NEW.current_quantity - (NEW.previous_quantity + NEW.quantity)) > 0.000001
        THEN RAISE(ABORT, 'PRODUCT_MOVEMENT_QUANTITY_MISMATCH')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_product_stock_movement_immutable_update
    BEFORE UPDATE ON product_stock_movements
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'POSTED_STOCK_MOVEMENT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_product_stock_movement_immutable_delete
    BEFORE DELETE ON product_stock_movements
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'POSTED_STOCK_MOVEMENT_IMMUTABLE');
    END;
  `);

  ensuredDbs.add(db);
}

module.exports = {
  ensureCostBearingInventorySchema
};
