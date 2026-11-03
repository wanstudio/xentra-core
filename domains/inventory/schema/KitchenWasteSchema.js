'use strict';

const ensuredDbs = new WeakSet();

function ensureKitchenWasteSchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS kitchen_waste_logs (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK (item_type IN ('MATERIAL', 'PRODUCT')),
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      uom_code TEXT,
      reason_code TEXT NOT NULL CHECK (reason_code IN ('BURNT_COOKING_ERROR', 'SPOILED_EXPIRED', 'DROPPED_CONTAMINATED', 'CUSTOMER_COMPLAINT_RECOOK', 'OTHER')),
      reason_notes TEXT,
      cost_amount REAL DEFAULT 0,
      reported_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_kitchen_waste_logs_branch_created
      ON kitchen_waste_logs(branch_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_kitchen_waste_logs_item
      ON kitchen_waste_logs(item_type, item_id);
  `);

  ensuredDbs.add(db);
}

module.exports = { ensureKitchenWasteSchema };
