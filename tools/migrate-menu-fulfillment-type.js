'use strict';

const DataAccess = require('../core/data/DataAccess');

const BY_STOCK_IDS = new Set([
  'prod_1789464953953', // Sambal Lombok Ijo
  'prod_1789464929957', // Sambal Geprek
  'prod_1789464976642', // Sambal Terasi
  'prd_97fdbca7891f4c3d8469e2a63c965eb0', // Ayam Kampung Asli
  'prd_ayam_negri_goreng', // Ayam Negri
  'prd_ayam_porsi_kecil', // Ayam Porsi Kecil
  'prd_27cd8b114c734f798b9d780dfa40f3d7', // Ayam Tulang Lunak
  'prod_1789465084504', // Nasi Putih
  'prd_kremesan', // Kremesan
  'prd_b5b95706974f40acbb6c5ba0d90983d2' // Lalapan
]);

const RETAIL_IDS = new Set([
  'prod_1789465790053' // Air Mineral Botol
]);

function runMigration() {
  console.log('=== Migrating Menu Fulfillment Types ===');

  // 1. Ensure column exists
  try {
    DataAccess.execute("ALTER TABLE products ADD COLUMN fulfillment_type TEXT DEFAULT 'BY_STOCK';");
    console.log('[Schema] Column fulfillment_type added to products.');
  } catch (err) {
    if (/duplicate column name/i.test(err.message || '')) {
      console.log('[Schema] Column fulfillment_type already exists.');
    } else {
      console.warn('[Schema] Column check warning:', err.message);
    }
  }

  // 2. Fetch all products
  const products = DataAccess.queryMany('SELECT id, name, category_id, sku, inventory_type FROM products WHERE brand_id = ?', ['brand_bangjo']);
  console.log(`[Data] Found ${products.length} products in brand_bangjo.`);

  let stockCount = 0;
  let orderCount = 0;
  let retailCount = 0;

  for (const p of products) {
    let fulfillmentType = 'BY_STOCK';

    if (RETAIL_IDS.has(p.id)) {
      fulfillmentType = 'RETAIL';
      retailCount++;
    } else if (BY_STOCK_IDS.has(p.id)) {
      fulfillmentType = 'BY_STOCK';
      stockCount++;
    } else {
      fulfillmentType = 'BY_ORDER';
      orderCount++;
    }

    DataAccess.execute(
      'UPDATE products SET fulfillment_type = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [fulfillmentType, p.id]
    );

    console.log(`  -> [${fulfillmentType}] ${p.name} (${p.id})`);
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`BY_STOCK (Batch Pre-cooked): ${stockCount} menu`);
  console.log(`BY_ORDER (Made to Order / Dadakan): ${orderCount} menu`);
  console.log(`RETAIL (Barang Jadi): ${retailCount} menu`);
}

runMigration();
