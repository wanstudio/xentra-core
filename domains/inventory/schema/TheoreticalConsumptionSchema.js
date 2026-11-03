'use strict';

const ensuredDbs = new WeakSet();

function ensureTheoreticalConsumptionSchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS order_recipe_consumptions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      order_number TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      recipe_id TEXT NOT NULL,
      recipe_version_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      material_name TEXT NOT NULL,
      consumed_base_qty REAL NOT NULL,
      base_uom_id TEXT NOT NULL,
      base_uom_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_order_recipe_consumptions_order
      ON order_recipe_consumptions(order_id);

    CREATE INDEX IF NOT EXISTS idx_order_recipe_consumptions_material
      ON order_recipe_consumptions(material_id, branch_id);

    CREATE INDEX IF NOT EXISTS idx_order_recipe_consumptions_branch_created
      ON order_recipe_consumptions(branch_id, created_at);
  `);

  ensuredDbs.add(db);
}

module.exports = { ensureTheoreticalConsumptionSchema };
