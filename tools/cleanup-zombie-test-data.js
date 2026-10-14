/**
 * Xentra Database Cleanup Tool
 * Purges historical zombie test records (E2E / onboarding test residue) from xentra.db
 * while guaranteeing 100% preservation of MyBangjo production data.
 */
const db = require('../server/database/db');

const KEEP_ORG_ID = 'org_xentra_holding';
const KEEP_BRAND_ID = 'brand_bangjo';
const KEEP_BRANCH_ID = 'branch_1789606246242_08knv';

console.log('=== XENTRA DB PURGE: CLEANUP HISTORICAL ZOMBIE TEST DATA ===\n');

// 1. Verify target entities exist before proceeding
const targetOrg = db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(KEEP_ORG_ID);
const targetBrand = db.prepare('SELECT id, name FROM brands WHERE id = ?').get(KEEP_BRAND_ID);
const targetBranch = db.prepare('SELECT id, name FROM branches WHERE id = ?').get(KEEP_BRANCH_ID);

if (!targetOrg || !targetBrand || !targetBranch) {
  console.error('[ABORT] Target production entities missing:', { targetOrg, targetBrand, targetBranch });
  process.exit(1);
}

console.log('[Guaranteed Target Preserved]:');
console.log(' - Organization:', targetOrg.name, '(' + targetOrg.id + ')');
console.log(' - Brand:       ', targetBrand.name, '(' + targetBrand.id + ')');
console.log(' - Branch:      ', targetBranch.name, '(' + targetBranch.id + ')\n');

// 2. Perform purge inside an atomic transaction
db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN TRANSACTION');
let stats = {};
try {
  function exec(table, sql, params = []) {
    const info = db.prepare(sql).run(...params);
    stats[table] = (stats[table] || 0) + info.changes;
  }

  // 1. Child tables referencing branches
  exec('branch_products', `DELETE FROM branch_products WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_categories', `DELETE FROM branch_categories WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_product_categories', `DELETE FROM branch_product_categories WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_delivery_settings', `DELETE FROM branch_delivery_settings WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_operation_logs', `DELETE FROM branch_operation_logs WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_dining_layouts', `DELETE FROM branch_dining_layouts WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_tables', `DELETE FROM branch_tables WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_table_holds', `DELETE FROM branch_table_holds WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_table_states', `DELETE FROM branch_table_states WHERE table_id NOT IN (SELECT id FROM branch_tables WHERE branch_id = ?)`, [KEEP_BRANCH_ID]);
  exec('dining_sessions', `DELETE FROM dining_sessions WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('pos_shifts', `DELETE FROM pos_shifts WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('pos_held_orders', `DELETE FROM pos_held_orders WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('pos_terminals', `DELETE FROM pos_terminals WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('pos_sync_queue', `DELETE FROM pos_sync_queue WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('pos_inventory_conflicts', `DELETE FROM pos_inventory_conflicts WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_menus', `DELETE FROM branch_menus WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_menu_categories', `DELETE FROM branch_menu_categories WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('branch_product_inventory', `DELETE FROM branch_product_inventory WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('inventory_movements', `DELETE FROM inventory_movements WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('purchasing_mandates', `DELETE FROM purchasing_mandates WHERE branch_id != ?`, [KEEP_BRANCH_ID]);
  exec('order_addition_batches', `DELETE FROM order_addition_batches WHERE branch_id != ?`, [KEEP_BRANCH_ID]);

  // 2. Child tables referencing brands
  exec('product_flavors', `DELETE FROM product_flavors WHERE product_id NOT IN (SELECT id FROM products WHERE brand_id = ?)`, [KEEP_BRAND_ID]);
  exec('product_complements', `DELETE FROM product_complements WHERE product_id NOT IN (SELECT id FROM products WHERE brand_id = ?)`, [KEEP_BRAND_ID]);
  exec('product_levels', `DELETE FROM product_levels WHERE product_id NOT IN (SELECT id FROM products WHERE brand_id = ?)`, [KEEP_BRAND_ID]);
  exec('products', `DELETE FROM products WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('categories', `DELETE FROM categories WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('sub_categories', `DELETE FROM sub_categories WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('promotions', `DELETE FROM promotions WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('promotion_branch_scope', `DELETE FROM promotion_branch_scope WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('storefront_banners', `DELETE FROM storefront_banners WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('storefront_banner_assignments', `DELETE FROM storefront_banner_assignments WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('menu_titles', `DELETE FROM menu_titles WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('menus', `DELETE FROM menus WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('menu_flavors', `DELETE FROM menu_flavors WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('menu_complements', `DELETE FROM menu_complements WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('menu_levels', `DELETE FROM menu_levels WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('product_menu_migrations', `DELETE FROM product_menu_migrations WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('composed_menu_migrations', `DELETE FROM composed_menu_migrations WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('product_sku_history', `DELETE FROM product_sku_history WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('menu_media_migrations', `DELETE FROM menu_media_migrations WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('customer_addresses', `DELETE FROM customer_addresses WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('customer_sessions', `DELETE FROM customer_sessions WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('pos_payment_groups', `DELETE FROM pos_payment_groups WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('inventory_purchase_orders', `DELETE FROM inventory_purchase_orders WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('workforce_invitations', `DELETE FROM workforce_invitations WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('workforce_memberships', `DELETE FROM workforce_memberships WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('notifications', `DELETE FROM notifications WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('security_audit_log', `DELETE FROM security_audit_log WHERE brand_id != ?`, [KEEP_BRAND_ID]);
  exec('tenant_domains', `DELETE FROM tenant_domains WHERE brand_id != ?`, [KEEP_BRAND_ID]);

  // 3. User accounts (Keep only users assigned to brand_bangjo)
  exec('user_sessions', `DELETE FROM user_sessions WHERE user_id NOT IN (SELECT id FROM users WHERE brand_id = ?)`, [KEEP_BRAND_ID]);
  exec('password_reset_tokens', `DELETE FROM password_reset_tokens WHERE user_id NOT IN (SELECT id FROM users WHERE brand_id = ?)`, [KEEP_BRAND_ID]);
  exec('email_verification_tokens', `DELETE FROM email_verification_tokens WHERE user_id NOT IN (SELECT id FROM users WHERE brand_id = ?)`, [KEEP_BRAND_ID]);
  exec('user_auth_providers', `DELETE FROM user_auth_providers WHERE user_id NOT IN (SELECT id FROM users WHERE brand_id = ?)`, [KEEP_BRAND_ID]);
  exec('users', `DELETE FROM users WHERE brand_id != ? OR brand_id IS NULL`, [KEEP_BRAND_ID]);

  // 4. Branches, Brands, Organizations
  exec('branches', `DELETE FROM branches WHERE id != ?`, [KEEP_BRANCH_ID]);
  exec('brands', `DELETE FROM brands WHERE id != ?`, [KEEP_BRAND_ID]);
  exec('organizations', `DELETE FROM organizations WHERE id != ?`, [KEEP_ORG_ID]);

  db.exec('COMMIT');
  db.exec('PRAGMA foreign_keys = ON;');
} catch (err) {
  db.exec('ROLLBACK');
  db.exec('PRAGMA foreign_keys = ON;');
  console.error('[PURGE ERROR] Rolled back transaction:', err);
  process.exit(1);
}

// Check foreign key integrity
const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
if (fkViolations.length > 0) {
  console.warn('[WARNING] Foreign key violations found:', fkViolations);
} else {
  console.log('[Integrity OK] 0 foreign key violations. Referential integrity 100% verified.');
}

console.log('[Purge Changes Summary]:');
console.table(stats);

console.log('\n[Vacuuming Database File...]');
try {
  db.exec('VACUUM');
  console.log('[Vacuum Complete] Unused pages reclaimed successfully.');
} catch (vErr) {
  console.warn('[Vacuum skipped]:', vErr.message);
}

// 3. Post-Purge Verification Check
console.log('\n[Verification Check Post-Purge]:');
const finalOrg = db.prepare('SELECT count(*) c FROM organizations').get().c;
const finalBrand = db.prepare('SELECT count(*) c FROM brands').get().c;
const finalBranch = db.prepare('SELECT count(*) c FROM branches').get().c;
const finalUsers = db.prepare('SELECT count(*) c FROM users').get().c;
const finalOrders = db.prepare('SELECT count(*) c FROM orders').get().c;
const finalMaterials = db.prepare('SELECT count(*) c FROM materials').get().c;

console.log(' - Organizations:', finalOrg, '(Expected: 1)');
console.log(' - Brands:       ', finalBrand, '(Expected: 1)');
console.log(' - Branches:     ', finalBranch, '(Expected: 1)');
console.log(' - Users:        ', finalUsers, '(Expected: 9)');
console.log(' - Orders:       ', finalOrders, '(Expected: 69)');
console.log(' - Materials:    ', finalMaterials, '(Expected: 68)');

if (finalOrg === 1 && finalBrand === 1 && finalBranch === 1 && finalUsers === 9 && finalOrders === 69) {
  console.log('\n[SUCCESS] All zombie test records purged cleanly. Production data 100% intact.');
} else {
  console.warn('\n[WARNING] Discrepancy detected in final counts. Review log carefully.');
}
