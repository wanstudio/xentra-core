'use strict';

const ensuredDbs = new WeakSet();

function ensureCostOfSalesSchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_of_sales_snapshots (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK (source_type IN ('ORDER', 'ADDITIONAL_ORDER')),
      source_reference TEXT NOT NULL,
      order_id TEXT,
      total_cost REAL NOT NULL CHECK (total_cost >= 0),
      currency_code TEXT NOT NULL CHECK (currency_code GLOB '[A-Z][A-Z][A-Z]'),
      cost_availability_status TEXT NOT NULL
        CHECK (cost_availability_status = 'AVAILABLE'),
      snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK (snapshot_version = 1),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (source_type, source_reference)
    );

    CREATE INDEX IF NOT EXISTS idx_cost_of_sales_order
      ON cost_of_sales_snapshots(order_id, created_at);

    CREATE TABLE IF NOT EXISTS cost_of_sales_snapshot_lines (
      id TEXT PRIMARY KEY,
      cost_of_sales_snapshot_id TEXT NOT NULL,
      source_item_reference TEXT,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
      total_cost REAL NOT NULL CHECK (total_cost >= 0),
      currency_code TEXT NOT NULL CHECK (currency_code GLOB '[A-Z][A-Z][A-Z]'),
      inventory_movement_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (cost_of_sales_snapshot_id) REFERENCES cost_of_sales_snapshots(id) ON DELETE RESTRICT,
      FOREIGN KEY (inventory_movement_id) REFERENCES product_stock_movements(id) ON DELETE RESTRICT,
      CHECK (abs(total_cost - (quantity * unit_cost)) <= 0.000001)
    );

    CREATE INDEX IF NOT EXISTS idx_cost_of_sales_snapshot_lines_snapshot
      ON cost_of_sales_snapshot_lines(cost_of_sales_snapshot_id);

    CREATE TRIGGER IF NOT EXISTS trg_cost_of_sales_snapshot_immutable
    BEFORE UPDATE OR DELETE ON cost_of_sales_snapshots
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'COST_OF_SALES_SNAPSHOT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_cost_of_sales_snapshot_line_immutable
    BEFORE UPDATE OR DELETE ON cost_of_sales_snapshot_lines
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'COST_OF_SALES_SNAPSHOT_LINE_IMMUTABLE');
    END;
  `);

  ensuredDbs.add(db);
}

module.exports = { ensureCostOfSalesSchema };
