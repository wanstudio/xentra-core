'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { auditAndMigrateLegacyCustomerIdentity } = require('../scripts/migrate-legacy-customers');

function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE brands (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      brand_id TEXT NOT NULL,
      display_name TEXT,
      email TEXT,
      phone TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE customer_addresses (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      customer_id TEXT,
      customer_phone TEXT NOT NULL,
      label TEXT DEFAULT 'Rumah',
      address TEXT NOT NULL,
      detail TEXT,
      note TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      is_primary INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      customer_id TEXT,
      customer_phone TEXT,
      total_amount REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO organizations (id, name) VALUES ('org_1', 'Org One'), ('org_2', 'Org Two');
    INSERT INTO brands (id, organization_id, name) VALUES ('brand_1a', 'org_1', 'Brand 1A'), ('brand_2a', 'org_2', 'Brand 2A');
  `);
  return db;
}

test('auditAndMigrate: empty customers returns orphan for all legacy phone orders', () => {
  const db = setupTestDb();
  db.exec(`
    INSERT INTO orders (id, brand_id, customer_phone, total_amount)
    VALUES ('ord_1', 'brand_1a', '081234567890', 50000);
  `);

  const res = auditAndMigrateLegacyCustomerIdentity(db, { dryRun: true });
  assert.equal(res.audit.ordersLegacyWithPhone, 1);
  assert.equal(res.classification.orphan, 1);
  assert.equal(res.classification.migratable, 0);
  assert.equal(res.classification.migrated, 0);
});

test('auditAndMigrate: single unambiguous match in same org is migrated when dryRun: false', () => {
  const db = setupTestDb();
  db.exec(`
    INSERT INTO customers (id, organization_id, brand_id, display_name, phone)
    VALUES ('cust_1', 'org_1', 'brand_1a', 'Customer One', '081234567890');

    INSERT INTO orders (id, brand_id, customer_phone, total_amount)
    VALUES ('ord_1', 'brand_1a', '081234567890', 50000);
  `);

  const res = auditAndMigrateLegacyCustomerIdentity(db, { dryRun: false });
  assert.equal(res.classification.migratable, 1);
  assert.equal(res.classification.migrated, 1);

  const updatedOrder = db.prepare('SELECT customer_id, customer_phone FROM orders WHERE id = ?').get('ord_1');
  assert.equal(updatedOrder.customer_id, 'cust_1');
  assert.equal(updatedOrder.customer_phone, '081234567890'); // Preserved
});

test('auditAndMigrate: blocks cross-organization migration and marks ambiguous', () => {
  const db = setupTestDb();
  db.exec(`
    -- Customer belongs to org_2
    INSERT INTO customers (id, organization_id, brand_id, display_name, phone)
    VALUES ('cust_2', 'org_2', 'brand_2a', 'Customer Two', '081234567890');

    -- Order belongs to brand_1a (which is in org_1)
    INSERT INTO orders (id, brand_id, customer_phone, total_amount)
    VALUES ('ord_1', 'brand_1a', '081234567890', 50000);
  `);

  const res = auditAndMigrateLegacyCustomerIdentity(db, { dryRun: false });
  assert.equal(res.classification.crossOrgViolationsBlocked, 1);
  assert.equal(res.classification.migrated, 0);

  const order = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get('ord_1');
  assert.equal(order.customer_id, null);
});

test('auditAndMigrate: ambiguous match with multiple customers is not migrated', () => {
  const db = setupTestDb();
  db.exec(`
    INSERT INTO customers (id, organization_id, brand_id, display_name, phone)
    VALUES 
      ('cust_1a', 'org_1', 'brand_1a', 'Customer 1A', '081234567890'),
      ('cust_1b', 'org_1', 'brand_1a', 'Customer 1B', '081234567890');

    INSERT INTO orders (id, brand_id, customer_phone, total_amount)
    VALUES ('ord_1', 'brand_1a', '081234567890', 50000);
  `);

  const res = auditAndMigrateLegacyCustomerIdentity(db, { dryRun: false });
  assert.equal(res.classification.ambiguous, 1);
  assert.equal(res.classification.migrated, 0);

  const order = db.prepare('SELECT customer_id FROM orders WHERE id = ?').get('ord_1');
  assert.equal(order.customer_id, null);
});
