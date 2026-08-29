/**
 * Sync Real WooCommerce Catalog from app.mybangjo.com into Xentra Core SQLite DB
 */
const axios = require('axios');
const db = require('./db');

async function syncCatalog() {
  console.log('==> Mengambil kategori & produk live dari app.mybangjo.com...');

  const catRes = await axios.get('https://app.mybangjo.com/wp-json/wc/store/v1/products/categories?per_page=100');
  const prodRes = await axios.get('https://app.mybangjo.com/wp-json/wc/store/v1/products?per_page=100');

  const brand = db.prepare("SELECT * FROM brands LIMIT 1").get();
  const brandId = brand ? brand.id : 'brand_bangjo';

  console.log('Using Brand ID:', brandId);

  // 1. Ensure product_categories table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_categories (
      product_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (product_id, category_id)
    );
  `);

  // 2. Prepare categories
  const categories = catRes.data.map((c, idx) => ({
    id: Number(c.id),
    brand_id: brandId,
    name: c.name,
    slug: c.slug,
    image: c.images?.[0]?.src || c.image?.src || c.image || 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png',
    sort_order: idx + 1
  }));

  // 3. Clear existing relations
  db.prepare('DELETE FROM product_categories').run();
  db.prepare('DELETE FROM products WHERE brand_id = ?').run(brandId);
  db.prepare('DELETE FROM categories WHERE brand_id = ?').run(brandId);

  // 4. Insert categories
  for (const cat of categories) {
    db.prepare(`
      INSERT OR REPLACE INTO categories (id, brand_id, name, slug, image, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(cat.id, cat.brand_id, cat.name, cat.slug, cat.image, cat.sort_order);
  }

  // 5. Insert products & relations
  const productCategories = [];

  for (let idx = 0; idx < prodRes.data.length; idx++) {
    const p = prodRes.data[idx];
    let rawPrice = p.prices?.price ? Number(p.prices.price) : Number(p.price || 0);
    let price = rawPrice >= 100000 ? rawPrice / 100 : rawPrice;

    let rawReg = p.prices?.regular_price ? Number(p.prices.regular_price) : (p.regular_price ? Number(p.regular_price) : price);
    let regPrice = rawReg >= 100000 ? rawReg / 100 : rawReg;
    if (regPrice < price) regPrice = price;

    const img = p.images?.[0]?.src || p.images?.[0]?.thumbnail || '';
    const desc = (p.description || p.short_description || '').replace(/<[^>]*>?/gm, '').trim();

    const primaryCatId = p.categories && p.categories[0] ? Number(p.categories[0].id) : categories[0].id;

    db.prepare(`
      INSERT OR REPLACE INTO products (id, brand_id, category_id, name, price, regular_price, description, image_url, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, brandId, primaryCatId, p.name, price, regPrice, desc, img, 1, idx + 1);

    if (p.categories && p.categories.length > 0) {
      for (const cat of p.categories) {
        db.prepare(`
          INSERT OR IGNORE INTO product_categories (product_id, category_id)
          VALUES (?, ?)
        `).run(p.id, Number(cat.id));
      }
    } else {
      // Auto-assign based on keyword
      let targetCat = 20; // Paket Ayam
      const nameLow = p.name.toLowerCase();
      if (nameLow.includes('mie')) targetCat = 26;
      else if (nameLow.includes('es ') || nameLow.includes('kopi') || nameLow.includes('mineral') || nameLow.includes('teh')) targetCat = 22;
      else if (nameLow.includes('udang')) targetCat = 21;
      else if (nameLow.includes('pisang')) targetCat = 20;

      db.prepare(`
        INSERT OR IGNORE INTO product_categories (product_id, category_id)
        VALUES (?, ?)
      `).run(p.id, targetCat);
    }
  }

  console.log(`✅ Sukses menyimpan ${categories.length} kategori dan ${prodRes.data.length} produk ke database!`);

  // Verify per-category counts
  categories.forEach(c => {
    const prods = db.prepare(`
      SELECT p.id, p.name, p.price, p.image_url 
      FROM products p 
      JOIN product_categories pc ON pc.product_id = p.id 
      WHERE pc.category_id = ?
    `).all(c.id);
    console.log(`  - Kategori [${c.name}] (ID: ${c.id}, slug: ${c.slug}): ${prods.length} produk`);
  });
}

if (require.main === module) {
  syncCatalog().catch(err => {
    console.error('Sync error:', err);
    process.exit(1);
  });
}

module.exports = syncCatalog;
