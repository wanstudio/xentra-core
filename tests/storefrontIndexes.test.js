'use strict';

/**
 * P1.3 — Storefront index + migration safety.
 *
 * EXPLAIN QUERY PLAN showed the initial-Home storefront reads as full table
 * scans, so P1.3 adds four non-unique indexes. These tests pin:
 *  1. they exist on a freshly initialized database,
 *  2. the critical Home queries actually use them (no SCAN),
 *  3. re-running schema init (restart / legacy DB) recreates them if missing
 *     and never loses data.
 */

const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db');

// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('./helpers/demoFixtures.js')();
const INDEXES = [
  'idx_categories_brand',
  'idx_products_brand',
  'idx_branch_categories_branch',
  'idx_branches_brand'
];

function indexNames() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
}

function planFor(sql, params) {
  return db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...(params || [])).map((p) => p.detail).join(' | ');
}

test('P1.3 — storefront indexes exist on a fresh database', () => {
  const names = indexNames();
  for (const idx of INDEXES) {
    assert.ok(names.includes(idx), `missing index ${idx}`);
  }
});

test('P1.3 — critical initial-Home queries use an index (no full table scan)', () => {
  const cases = [
    ['categories by brand', "SELECT id FROM categories WHERE brand_id = ? AND (is_active = 1 OR is_active IS NULL)", ['brand_bangjo'], 'idx_categories_brand'],
    ['products by brand', "SELECT p.id FROM products p WHERE p.brand_id = ? AND p.is_active = 1", ['brand_bangjo'], 'idx_products_brand'],
    ['branch_categories by branch', "SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ?", ['branch_bangjo_barat', 'brand_bangjo'], 'idx_branch_categories_branch'],
    ['branches by brand', "SELECT b.id FROM branches b WHERE b.brand_id = ? AND b.is_active = 1", ['brand_bangjo'], 'idx_branches_brand']
  ];

  for (const [label, sql, params, idx] of cases) {
    const plan = planFor(sql, params);
    assert.ok(plan.includes(idx), `${label} must use ${idx} — plan: ${plan}`);
    assert.ok(!/^SCAN /.test(plan), `${label} must not full-scan — plan: ${plan}`);
  }
});

test('P1.3 — re-running schema init (restart / legacy migration) recreates missing indexes without data loss', () => {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_p13','P13 Org','p13-org')").run();
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES ('brand_p13','org_p13','P13 Brand','p13-brand','p13.test')").run();
  const brandsBefore = db.prepare('SELECT COUNT(*) AS c FROM brands').get().c;

  // Simulate a database created before the P1.3 indexes existed.
  for (const idx of INDEXES) db.exec('DROP INDEX IF EXISTS ' + idx);
  assert.strictEqual(INDEXES.filter((i) => indexNames().includes(i)).length, 0, 'indexes dropped (legacy DB simulation)');

  // Equivalent to a restart / migration on an existing database.
  db.initSchema(db);

  const recreated = INDEXES.filter((i) => indexNames().includes(i));
  assert.strictEqual(recreated.length, INDEXES.length, 'indexes must be recreated on an existing DB: ' + recreated.join(', '));
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM brands').get().c, brandsBefore, 'index migration must not lose data');

  const plan = planFor("SELECT id FROM categories WHERE brand_id = ? AND (is_active = 1 OR is_active IS NULL)", ['brand_bangjo']);
  assert.ok(plan.includes('idx_categories_brand'), 'migrated index must actually be usable — plan: ' + plan);
});
