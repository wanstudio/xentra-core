/**
 * XENTRA CORE — MEDIA UPLOAD ROUTES
 *
 * Legacy/canonical image upload adapters for master products and branch
 * catalog entities. Validation and persistence behaviour are unchanged.
 */

module.exports = function registerMediaUploadRoutes(router, deps) {
  const {
    db,
    path,
    fs,
    crypto,
    ImageValidator,
    requireAuth
  } = deps;

  // Upload / replace a branch category's image.
// Persisted to disk under /assets/uploads/categories and verified strictly via ImageValidator.
const CATEGORY_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/categories');
const PRODUCT_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/products');
const BRANCH_PRODUCT_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/branch-products');

router.post('/admin/branches/:id/categories/:catId/image', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const cat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    const { image_base64, mime_type } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'Gambar kategori wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'category'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
    }

    fs.mkdirSync(CATEGORY_IMAGE_DIR, { recursive: true });
    const fileName = `${req.params.catId}-${Date.now()}.${validation.info.ext}`;
    fs.writeFileSync(path.join(CATEGORY_IMAGE_DIR, fileName), validation.buffer);

    const imageUrl = `/assets/uploads/categories/${fileName}`;
    try {
      db.prepare("UPDATE branch_categories SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
        .run(imageUrl, req.params.catId);
    } catch (e) {
      if (String(e).includes('no such column')) {
        db.prepare("UPDATE branch_categories SET image_url = ? WHERE id = ?")
          .run(imageUrl, req.params.catId);
      } else {
        throw e;
      }
    }

    res.json({ success: true, category: { id: req.params.catId, image_url: imageUrl } });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/categories/:catId/image]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload / replace a master product (menu item) image.
router.post('/admin/products/:productId/image', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND brand_id = ?')
      .get(req.params.productId, req.brand_id);
    if (!product) return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan.' });

    const { image_base64, mime_type } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'Gambar menu wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'product'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
    }

    fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });
    const fileName = `${req.params.productId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${validation.info.ext}`;
    fs.writeFileSync(path.join(PRODUCT_IMAGE_DIR, fileName), validation.buffer);

    const imageUrl = `/assets/uploads/products/${fileName}`;
    db.prepare("UPDATE products SET image_url = ?, image = ?, updated_at = datetime('now') WHERE id = ?")
      .run(imageUrl, imageUrl, req.params.productId);

    res.json({ success: true, product: { id: req.params.productId, image_url: imageUrl, image: imageUrl } });
  } catch (err) {
    console.error('[API Error POST /admin/products/:productId/image]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload / replace an adopted (branch) product's own photo override.
router.post('/admin/branches/:id/products/:productId/image', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    const bp = db.prepare('SELECT branch_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
    if (!bp) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });

    const { image_base64, mime_type } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'Gambar menu wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'product'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
    }

    fs.mkdirSync(BRANCH_PRODUCT_IMAGE_DIR, { recursive: true });
    const fileName = `${req.params.id}-${req.params.productId}-${Date.now()}.${validation.info.ext}`;
    fs.writeFileSync(path.join(BRANCH_PRODUCT_IMAGE_DIR, fileName), validation.buffer);

    const imageUrl = `/assets/uploads/branch-products/${fileName}`;
    db.prepare("UPDATE branch_products SET image_override = ?, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?")
      .run(imageUrl, req.params.id, req.params.productId);

    res.json({ success: true, product: { branch_id: req.params.id, product_id: req.params.productId, image_url: imageUrl, image_override: imageUrl } });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/products/:productId/image]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


};
