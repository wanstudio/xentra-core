/**
 * XENTRA CORE — ADMIN MASTER CATALOG ROUTES
 *
 * Owner/Brand Manager category and master-product CRUD. Branch adoption and
 * branch catalog operations remain in the branch-scoped route area.
 */
module.exports = function registerAdminCatalogRoutes(router, deps) {
  const { db, requireAuth } = deps;

router.get('/admin/categories', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories WHERE brand_id = ? ORDER BY sort_order ASC').all(req.brand_id);
    res.json({ success: true, categories: categories || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/admin/categories', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, image } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi.' });

    const id = 'cat_' + Date.now();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    db.prepare(`
      INSERT INTO categories (id, brand_id, name, slug, sort_order)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE brand_id = ?))
    `).run(id, req.brand_id, name, slug, req.brand_id);

    res.status(201).json({
      success: true,
      category: { id, name, slug, image: image || '/assets/icons/delivery.png' }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/categories/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, image, sort_order, is_active } = req.body;
    let normIsActive = null;
    if (is_active !== undefined && is_active !== null) {
      if (is_active === true || is_active === 1 || is_active === '1' || is_active === 'true') {
        normIsActive = 1;
      } else if (is_active === false || is_active === 0 || is_active === '0' || is_active === 'false') {
        normIsActive = 0;
      }
    }
    db.prepare(`
      UPDATE categories 
      SET name = COALESCE(?, name),
          sort_order = COALESCE(?, sort_order),
          is_active = COALESCE(?, is_active)
      WHERE id = ? AND brand_id = ?
    `).run(
      name !== undefined ? name : null,
      sort_order !== undefined ? sort_order : null,
      normIsActive !== null ? normIsActive : null,
      req.params.id,
      req.brand_id
    );

    res.json({ success: true, message: 'Kategori berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/admin/categories/:id/toggle', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const stmt = db.prepare(`
      UPDATE categories 
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
      WHERE id = ? AND brand_id = ?
    `).run(req.params.id, req.brand_id);

    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan atau tidak berubah.' });
    }

    res.json({ success: true, message: 'Status ketersediaan kategori berhasil diubah.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/categories/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const existing = db.prepare('SELECT id, name FROM categories WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan.' });
    }

    // Category assignment protection: check if products are assigned
    const assignedCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE category_id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (assignedCount && assignedCount.count > 0) {
      return res.status(400).json({
        success: false,
        error: `Kategori "${existing.name}" tidak dapat dihapus karena masih digunakan oleh ${assignedCount.count} produk. Pindahkan atau hapus produk terlebih dahulu.`
      });
    }

    db.prepare('DELETE FROM categories WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);
    res.json({ success: true, message: 'Kategori berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Admin Products CRUD
router.get('/admin/products', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products WHERE brand_id = ? ORDER BY sort_order ASC').all(req.brand_id);
    res.json({ success: true, products: products || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/admin/products/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produk tidak ditemukan.' });
    }

    // Include branch adoption status across all active branches for this brand
    const branchAdoptions = db.prepare(`
      SELECT 
        b.id AS branch_id,
        b.name AS branch_name,
        b.address_text AS branch_address,
        b.is_active AS is_branch_active,
        bp.product_id,
        bp.price AS branch_price,
        bp.stock AS branch_stock,
        bp.is_available AS branch_is_available,
        bp.branch_category_id,
        bc.name AS branch_category_name,
        CASE WHEN bp.product_id IS NOT NULL THEN 1 ELSE 0 END AS is_adopted
      FROM branches b
      LEFT JOIN branch_products bp ON bp.branch_id = b.id AND bp.product_id = ?
      LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id
      WHERE b.brand_id = ? AND (b.is_archived = 0 OR b.is_archived IS NULL)
      ORDER BY b.name ASC
    `).all(req.params.id, req.brand_id);

    res.json({ success: true, product, branch_adoptions: branchAdoptions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/admin/products', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, category_id, price, regular_price, description, image, pricing_mode, min_price, max_price } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, error: 'Nama dan harga menu wajib diisi.' });

    // P1 TENANT CATEGORY INTEGRITY GUARD (FINDING 02)
    if (category_id) {
      const validCategory = db.prepare('SELECT id FROM categories WHERE id = ? AND brand_id = ?').get(category_id, req.brand_id);
      if (!validCategory) {
        return res.status(400).json({
          success: false,
          error: 'Kategori produk tidak ditemukan atau bukan milik brand ini.'
        });
      }
    }

    const id = 'prod_' + Date.now();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    db.prepare(`
      INSERT INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, pricing_mode, min_price, max_price, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products WHERE brand_id = ?))
    `).run(
      id,
      req.brand_id,
      category_id !== undefined ? category_id : null,
      name,
      slug,
      description !== undefined ? description : '',
      Number(price),
      regular_price ? Number(regular_price) : Number(price),
      pricing_mode || 'lock',
      min_price !== undefined ? Number(min_price) : null,
      max_price !== undefined ? Number(max_price) : null,
      req.brand_id
    );

    res.status(201).json({
      success: true,
      product: {
        id,
        name,
        category_id,
        price: Number(price),
        regular_price: regular_price ? Number(regular_price) : Number(price),
        description,
        image: image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400',
        is_active: 1
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/products/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, category_id, price, regular_price, description, image, is_active, pricing_mode, min_price, max_price } = req.body;

    // P1 TENANT CATEGORY INTEGRITY GUARD (FINDING 02)
    if (category_id !== undefined && category_id !== null) {
      const validCategory = db.prepare('SELECT id FROM categories WHERE id = ? AND brand_id = ?').get(category_id, req.brand_id);
      if (!validCategory) {
        return res.status(400).json({
          success: false,
          error: 'Kategori produk tidak ditemukan atau bukan milik brand ini.'
        });
      }
    }

    let normIsActive = null;
    if (is_active !== undefined && is_active !== null) {
      if (is_active === true || is_active === 1 || is_active === '1' || is_active === 'true') {
        normIsActive = 1;
      } else if (is_active === false || is_active === 0 || is_active === '0' || is_active === 'false') {
        normIsActive = 0;
      }
    }

    const stmt = db.prepare(`
      UPDATE products 
      SET name = COALESCE(?, name),
          category_id = COALESCE(?, category_id),
          price = COALESCE(?, price),
          regular_price = COALESCE(?, regular_price),
          pricing_mode = COALESCE(?, pricing_mode),
          min_price = COALESCE(?, min_price),
          max_price = COALESCE(?, max_price),
          description = COALESCE(?, description),
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
      WHERE id = ? AND brand_id = ?
    `).run(
      name !== undefined ? name : null,
      category_id !== undefined ? category_id : null,
      price !== undefined ? price : null,
      regular_price !== undefined ? regular_price : null,
      pricing_mode !== undefined ? pricing_mode : null,
      min_price !== undefined ? min_price : null,
      max_price !== undefined ? max_price : null,
      description !== undefined ? description : null,
      normIsActive !== null ? normIsActive : null,
      req.params.id,
      req.brand_id
    );

    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan atau tidak berubah.' });
    }

    res.json({ success: true, message: 'Menu produk berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/admin/products/:id/options', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const product = db.prepare('SELECT id, name, options_config FROM products WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!product) return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan.' });
    const ProductOptionsModel = require('../../domains/catalog/models/ProductOptionsModel');
    res.json({ success: true, product_id: product.id, product_name: product.name, options_config: ProductOptionsModel.normalizeConfig(product.options_config) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/products/:id/options', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const product = db.prepare('SELECT id, name FROM products WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!product) return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan.' });

    const ProductOptionsModel = require('../../domains/catalog/models/ProductOptionsModel');
    const config = ProductOptionsModel.validateConfig(req.body && req.body.options_config);
    const stmt = db.prepare(`
      UPDATE products
      SET options_config = ?, updated_at = datetime('now')
      WHERE id = ? AND brand_id = ?
    `).run(JSON.stringify(config), product.id, req.brand_id);

    if (!stmt || stmt.changes === 0) {
      return res.status(400).json({ success: false, error: 'Konfigurasi option tidak berubah.' });
    }

    res.json({ success: true, product_id: product.id, product_name: product.name, options_config: config });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.patch('/admin/products/:id/toggle', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const stmt = db.prepare(`
      UPDATE products 
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
          updated_at = datetime('now')
      WHERE id = ? AND brand_id = ?
    `).run(req.params.id, req.brand_id);

    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan atau tidak berubah.' });
    }

    res.json({ success: true, message: 'Status ketersediaan menu berhasil diubah.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/products/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM products WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);
    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan.' });
    }
    res.json({ success: true, message: 'Menu berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


};
