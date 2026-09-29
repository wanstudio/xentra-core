'use strict';

/**
 * Master Menu legacy reconciliation helper.
 *
 * Default: DRY RUN (read-only).
 * Apply deterministic Branch Category M:N repairs with:
 *   node scripts/reconcile-master-menu-legacy.js --apply
 *
 * This script deliberately does NOT:
 * - infer Master components from arbitrary legacy free text;
 * - rewrite divergent Branch prices;
 * - delete legacy columns;
 * - backfill historical order_items.menu_snapshot.
 *
 * Those actions require separate explicit decisions/verification.
 */

const db = require('../server/database/db');
const apply = process.argv.includes('--apply');

function rows(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function count(sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return Number(row && row.count) || 0;
}

function discoverBranchCategoryRepairs() {
  return rows(
    'SELECT bp.branch_id, bp.product_id, bp.branch_category_id, bc.name AS branch_category_name ' +
    'FROM branch_products bp ' +
    'JOIN branch_categories bc ON bc.id = bp.branch_category_id AND bc.branch_id = bp.branch_id ' +
    'LEFT JOIN branch_product_categories bpc ON bpc.branch_id = bp.branch_id AND bpc.product_id = bp.product_id AND bpc.branch_category_id = bp.branch_category_id ' +
    'WHERE bp.branch_category_id IS NOT NULL AND bpc.product_id IS NULL ' +
    'ORDER BY bp.branch_id, bp.product_id, bp.branch_category_id'
  );
}

function discoverInvalidScalarCategories() {
  return rows(
    'SELECT bp.branch_id, bp.product_id, bp.branch_category_id ' +
    'FROM branch_products bp ' +
    'LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id AND bc.branch_id = bp.branch_id ' +
    'WHERE bp.branch_category_id IS NOT NULL AND bc.id IS NULL ' +
    'ORDER BY bp.branch_id, bp.product_id'
  );
}

function discoverPriceDivergence() {
  return rows(
    'SELECT bp.branch_id, bp.product_id, bp.price AS branch_price, p.price AS master_price, p.pricing_mode ' +
    'FROM branch_products bp JOIN products p ON p.id = bp.product_id ' +
    'WHERE bp.price IS NOT NULL AND p.price IS NOT NULL AND bp.price != p.price ' +
    'ORDER BY bp.branch_id, bp.product_id'
  );
}

function runApply(categoryRepairs) {
  const applied = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const repair of categoryRepairs) {
      db.prepare('INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id) VALUES (?, ?, ?)')
        .run(repair.branch_id, repair.product_id, repair.branch_category_id);
      applied.push(repair);
    }
    db.exec('COMMIT');
    return applied;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

const categoryRepairs = discoverBranchCategoryRepairs();
const invalidScalarCategories = discoverInvalidScalarCategories();
const priceDivergence = discoverPriceDivergence();

let appliedCategoryRepairs = [];
if (apply && categoryRepairs.length > 0) {
  appliedCategoryRepairs = runApply(categoryRepairs);
}

const remainingRepairs = discoverBranchCategoryRepairs();

const report = {
  mode: apply ? 'apply' : 'dry-run',
  generated_at: new Date().toISOString(),
  branch_category_reconciliation: {
    candidate_repairs: categoryRepairs.length,
    applied_repairs: appliedCategoryRepairs.length,
    remaining_repairs: remainingRepairs.length,
    invalid_scalar_category_rows: invalidScalarCategories.length
  },
  legacy_data: {
    name_overrides: count("SELECT COUNT(*) count FROM branch_products WHERE name_override IS NOT NULL AND trim(name_override) <> ''"),
    description_overrides: count("SELECT COUNT(*) count FROM branch_products WHERE description_override IS NOT NULL AND trim(description_override) <> ''"),
    image_overrides: count("SELECT COUNT(*) count FROM branch_products WHERE image_override IS NOT NULL AND trim(image_override) <> ''"),
    branch_price_divergence: priceDivergence.length
  },
  price_divergence: priceDivergence,
  invalid_scalar_categories: invalidScalarCategories,
  category_repairs: categoryRepairs,
  applied_category_repairs: appliedCategoryRepairs,
  policy: {
    inferred_master_components: false,
    rewrote_branch_prices: false,
    deleted_legacy_columns: false,
    backfilled_historical_menu_snapshots: false
  }
};

console.log(JSON.stringify(report, null, 2));
