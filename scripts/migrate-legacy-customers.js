'use strict';

/**
 * Audit and Migration Utility for Legacy Customer Identity.
 *
 * Scans `orders` and `customer_addresses` where customer_id IS NULL but customer_phone IS NOT NULL.
 * Looks for an unambiguous canonical customer in `customers` matching the same organization.
 * Invariants:
 * - customer_id = canonical customer identity (organization-scoped)
 * - customer_phone = operational fulfillment snapshot, NOT identity
 * - Never migrate across different organizations
 * - Never guess if phone matches multiple customers or if organization cannot be resolved
 * - Preserves customer_phone in orders and addresses
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function auditAndMigrateLegacyCustomerIdentity(db, options = { dryRun: true }) {
  const result = {
    dryRun: options.dryRun !== false,
    audit: {
      customersTotal: 0,
      customerAddressesTotal: 0,
      customerAddressesWithoutCustomerId: 0,
      ordersTotal: 0,
      ordersWithCustomerId: 0,
      ordersWithoutCustomerId: 0,
      ordersLegacyWithPhone: 0,
      ordersWithoutPhone: 0
    },
    classification: {
      migratable: 0,
      ambiguous: 0,
      orphan: 0,
      alreadyCanonical: 0,
      migrated: 0,
      failed: 0,
      crossOrgViolationsBlocked: 0
    },
    details: {
      ambiguousRecords: [],
      orphanRecords: [],
      migratableRecords: []
    }
  };

  // 1. Audit totals
  result.audit.customersTotal = db.prepare('SELECT count(*) as c FROM customers').get().c;
  result.audit.customerAddressesTotal = db.prepare('SELECT count(*) as c FROM customer_addresses').get().c;
  result.audit.customerAddressesWithoutCustomerId = db.prepare(
    'SELECT count(*) as c FROM customer_addresses WHERE customer_id IS NULL'
  ).get().c;

  result.audit.ordersTotal = db.prepare('SELECT count(*) as c FROM orders').get().c;
  result.audit.ordersWithCustomerId = db.prepare(
    'SELECT count(*) as c FROM orders WHERE customer_id IS NOT NULL'
  ).get().c;
  result.audit.ordersWithoutCustomerId = db.prepare(
    'SELECT count(*) as c FROM orders WHERE customer_id IS NULL'
  ).get().c;
  result.audit.ordersLegacyWithPhone = db.prepare(
    "SELECT count(*) as c FROM orders WHERE customer_id IS NULL AND customer_phone IS NOT NULL AND trim(customer_phone) != ''"
  ).get().c;
  result.audit.ordersWithoutPhone = db.prepare(
    "SELECT count(*) as c FROM orders WHERE customer_id IS NULL AND (customer_phone IS NULL OR trim(customer_phone) = '')"
  ).get().c;

  result.classification.alreadyCanonical = result.audit.ordersWithCustomerId;

  // 2. Fetch all legacy orders with phone
  const legacyOrders = db.prepare(`
    SELECT o.id, o.brand_id, o.customer_phone, b.organization_id as brand_organization_id
    FROM orders o
    LEFT JOIN brands b ON b.id = o.brand_id
    WHERE o.customer_id IS NULL 
      AND o.customer_phone IS NOT NULL 
      AND trim(o.customer_phone) != ''
  `).all();

  // Prepared statements for lookup
  const findCustomerByPhoneStmt = db.prepare(`
    SELECT id, organization_id, phone, display_name, email
    FROM customers
    WHERE phone = ?
  `);

  const updateOrderCustomerIdStmt = options.dryRun ? null : db.prepare(`
    UPDATE orders SET customer_id = ? WHERE id = ?
  `);

  // Classify each record
  for (const order of legacyOrders) {
    const rawPhone = String(order.customer_phone || '').trim();
    if (!rawPhone) {
      continue;
    }

    const matchedCustomers = findCustomerByPhoneStmt.all(rawPhone);

    if (matchedCustomers.length === 0) {
      result.classification.orphan++;
      continue;
    }

    if (matchedCustomers.length > 1) {
      result.classification.ambiguous++;
      result.details.ambiguousRecords.push({
        orderId: order.id,
        phone: rawPhone,
        matchedCount: matchedCustomers.length
      });
      continue;
    }

    const candidate = matchedCustomers[0];

    // Organization validation
    if (!order.brand_organization_id || candidate.organization_id !== order.brand_organization_id) {
      result.classification.crossOrgViolationsBlocked++;
      result.classification.ambiguous++;
      result.details.ambiguousRecords.push({
        orderId: order.id,
        phone: rawPhone,
        reason: 'organization_mismatch',
        brandOrgId: order.brand_organization_id,
        customerOrgId: candidate.organization_id
      });
      continue;
    }

    // Single unambiguous match in the same organization
    result.classification.migratable++;
    if (!options.dryRun && updateOrderCustomerIdStmt) {
      try {
        updateOrderCustomerIdStmt.run(candidate.id, order.id);
        result.classification.migrated++;
      } catch (err) {
        result.classification.failed++;
      }
    }
  }

  // 3. Evaluate customer_addresses if any exist without customer_id
  const legacyAddresses = db.prepare(`
    SELECT ca.id, ca.customer_id, ca.customer_phone, b.organization_id as brand_organization_id
    FROM customer_addresses ca
    LEFT JOIN brands b ON b.id = ca.brand_id
    WHERE ca.customer_id IS NULL 
      AND ca.customer_phone IS NOT NULL 
      AND trim(ca.customer_phone) != ''
  `).all();

  for (const addr of legacyAddresses) {
    const phone = String(addr.customer_phone || '').trim();
    if (!phone) {
      result.classification.orphan++;
      continue;
    }
    const matched = findCustomerByPhoneStmt.all(phone);
    if (matched.length === 0) {
      result.classification.orphan++;
    } else if (matched.length > 1) {
      result.classification.ambiguous++;
    } else {
      const candidate = matched[0];
      if (!addr.brand_organization_id || candidate.organization_id !== addr.brand_organization_id) {
        result.classification.crossOrgViolationsBlocked++;
        result.classification.ambiguous++;
        continue;
      }
      result.classification.migratable++;
      if (!options.dryRun) {
        try {
          db.prepare('UPDATE customer_addresses SET customer_id = ? WHERE id = ?').run(candidate.id, addr.id);
          result.classification.migrated++;
        } catch (e) {
          result.classification.failed++;
        }
      }
    }
  }

  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../server/database/xentra.db');

  console.log(`[CustomerMigration] Target DB: ${dbPath}`);
  console.log(`[CustomerMigration] Mode: ${dryRun ? 'DRY-RUN (audit only)' : 'APPLY (live migration)'}`);

  const db = new DatabaseSync(dbPath, { readOnly: dryRun });
  try {
    const result = auditAndMigrateLegacyCustomerIdentity(db, { dryRun });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

module.exports = {
  auditAndMigrateLegacyCustomerIdentity
};
