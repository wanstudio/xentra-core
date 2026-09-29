'use strict';

// Read-only migration readiness audit for Master Menu Composition.
// Usage: node scripts/audit-master-menu-readiness.js

const db = require('../server/database/db');

function count(sql, params) {
  const row = db.prepare(sql).get(...(params || []));
  return Number(row && row.count) || 0;
}

function rows(sql, params) {
  return db.prepare(sql).all(...(params || []));
}

const report = {
  master_products: {
    total: count('SELECT COUNT(*) count FROM products'),
    active: count('SELECT COUNT(*) count FROM products WHERE is_active = 1 OR is_active IS NULL'),
    missing_master_category: count('SELECT COUNT(*) count FROM products p LEFT JOIN categories c ON c.id = p.category_id AND c.brand_id = p.brand_id WHERE (p.is_active = 1 OR p.is_active IS NULL) AND (p.category_id IS NULL OR c.id IS NULL OR c.is_active = 0)')
  },
  composition: {
    products_with_flavor: count('SELECT COUNT(DISTINCT product_id) count FROM product_flavors'),
    products_with_complements: count('SELECT COUNT(DISTINCT product_id) count FROM product_complements'),
    products_with_level: count('SELECT COUNT(DISTINCT product_id) count FROM product_levels'),
    orphan_flavor_relations: count('SELECT COUNT(*) count FROM product_flavors pf LEFT JOIN products p ON p.id = pf.product_id LEFT JOIN menu_flavors mf ON mf.id = pf.flavor_id WHERE p.id IS NULL OR mf.id IS NULL OR p.brand_id != mf.brand_id'),
    orphan_complement_relations: count('SELECT COUNT(*) count FROM product_complements pc LEFT JOIN products p ON p.id = pc.product_id LEFT JOIN menu_complements mc ON mc.id = pc.complement_id WHERE p.id IS NULL OR mc.id IS NULL OR p.brand_id != mc.brand_id'),
    orphan_level_relations: count('SELECT COUNT(*) count FROM product_levels pl LEFT JOIN products p ON p.id = pl.product_id LEFT JOIN menu_levels ml ON ml.id = pl.level_id WHERE p.id IS NULL OR ml.id IS NULL OR p.brand_id != ml.brand_id')
  },
  branch_adoption: {
    total_adoptions: count('SELECT COUNT(*) count FROM branch_products'),
    legacy_name_overrides: count("SELECT COUNT(*) count FROM branch_products WHERE name_override IS NOT NULL AND trim(name_override) <> ''"),
    legacy_description_overrides: count("SELECT COUNT(*) count FROM branch_products WHERE description_override IS NOT NULL AND trim(description_override) <> ''"),
    legacy_image_overrides: count("SELECT COUNT(*) count FROM branch_products WHERE image_override IS NOT NULL AND trim(image_override) <> ''"),
    legacy_branch_prices: count('SELECT COUNT(*) count FROM branch_products WHERE price IS NOT NULL'),
    legacy_scalar_category_memberships: count('SELECT COUNT(*) count FROM branch_products WHERE branch_category_id IS NOT NULL'),
    canonical_category_memberships: count('SELECT COUNT(*) count FROM branch_product_categories')
  },
  integrity: {
    bpc_without_branch_product: count('SELECT COUNT(*) count FROM branch_product_categories bpc LEFT JOIN branch_products bp ON bp.branch_id = bpc.branch_id AND bp.product_id = bpc.product_id WHERE bp.product_id IS NULL'),
    bpc_cross_branch_category: count('SELECT COUNT(*) count FROM branch_product_categories bpc LEFT JOIN branch_categories bc ON bc.id = bpc.branch_category_id WHERE bc.id IS NULL OR bc.branch_id != bpc.branch_id'),
    adopted_products_without_canonical_category: count('SELECT COUNT(*) count FROM branch_products bp LEFT JOIN branch_product_categories bpc ON bpc.branch_id = bp.branch_id AND bpc.product_id = bp.product_id GROUP BY bp.branch_id, bp.product_id HAVING COUNT(bpc.branch_category_id) = 0')
  }
};

report.branch_price_divergence = rows('SELECT bp.branch_id, bp.product_id, bp.price AS branch_price, p.price AS master_price, p.pricing_mode FROM branch_products bp JOIN products p ON p.id = bp.product_id WHERE bp.price IS NOT NULL AND p.price IS NOT NULL AND bp.price != p.price ORDER BY bp.branch_id, bp.product_id');

report.active_products_missing_resolver = rows('SELECT p.id, p.brand_id, p.name, p.category_id FROM products p LEFT JOIN categories c ON c.id = p.category_id AND c.brand_id = p.brand_id WHERE (p.is_active = 1 OR p.is_active IS NULL) AND (p.category_id IS NULL OR c.id IS NULL OR c.is_active = 0) ORDER BY p.brand_id, p.sort_order, p.name');

const warnings = [];
if (report.master_products.missing_master_category > 0) warnings.push('Active Master Products missing a valid active Master Category.');
if (report.composition.orphan_flavor_relations || report.composition.orphan_complement_relations || report.composition.orphan_level_relations) warnings.push('Cross-brand/orphan Master Menu composition relations found.');
if (report.integrity.bpc_without_branch_product || report.integrity.bpc_cross_branch_category) warnings.push('Branch Category membership integrity problems found.');
if (report.integrity.adopted_products_without_canonical_category) warnings.push('Adopted Branch Products without canonical Branch Category membership.');
if (report.branch_adoption.legacy_name_overrides || report.branch_adoption.legacy_description_overrides || report.branch_adoption.legacy_image_overrides) warnings.push('Legacy Branch content overrides still contain data and require reconciliation.');
if (report.branch_price_divergence.length) warnings.push('Branch prices differ from Master prices and require explicit pricing migration reconciliation.');

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  report,
  warnings,
  ready_for_public_switch: warnings.length === 0
}, null, 2));
