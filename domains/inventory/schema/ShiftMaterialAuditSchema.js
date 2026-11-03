'use strict';

const ensuredDbs = new WeakSet();

function ensureShiftMaterialAuditSchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS shift_material_audits (
      id TEXT PRIMARY KEY,
      shift_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      stock_location_id TEXT,
      material_id TEXT NOT NULL,
      material_code TEXT,
      material_name TEXT NOT NULL,
      base_uom_code TEXT,
      starting_qty REAL NOT NULL DEFAULT 0,
      consumed_qty REAL NOT NULL DEFAULT 0,
      expected_qty REAL NOT NULL DEFAULT 0,
      actual_qty REAL NOT NULL,
      variance_qty REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'BALANCED'
        CHECK (status IN ('BALANCED', 'SURPLUS', 'DEFICIT')),
      audited_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_shift_material_audits_shift
      ON shift_material_audits(shift_id);

    CREATE INDEX IF NOT EXISTS idx_shift_material_audits_branch_created
      ON shift_material_audits(branch_id, created_at);
  `);

  ensuredDbs.add(db);
}

module.exports = { ensureShiftMaterialAuditSchema };
