/**
 * XENTRA CORE — ADMIN BRANCH CATALOG ROUTES
 *
 * Branch product adoption, availability, pricing overrides and branch-category
 * assignment/reorder APIs. Master catalog CRUD remains in admin-catalog.js.
 */
module.exports = function registerAdminBranchCatalogRoutes(router, deps) {
  const {
    db,
    crypto,
    requireAuth,
    CatalogService,
    PricingPolicyModel,
    XentraConnectorClient,
    InventoryStockService
  } = deps;

router.get('/admin/branches/:id/products', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const assignments = db.prepare(`
      SELECT bp.branch_id, bp.product_id, bp.price, bp.stock, bp.is_available, bp.low_stock_threshold,
             p.name AS product_name, p.is_active AS is_master_active,
             c.name AS category_name
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.params.id);

    res.json({ success: true, branch_id: req.params.id, assignments: assignments || [] });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/products]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Branch orders — enforces branch scope for branch_manager (mirrors products route)
router.get('/admin/branches/:id/orders', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_ACCESS',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id, timezone FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    // Reservation schedule is stored in branch-local time. Resolve "now" in the
    // branch timezone so the API can protect upcoming reservations from being
    // pushed out of the default page by newer historical orders.
    let branchLocalNow;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: branch.timezone || 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date()).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});
      branchLocalNow = parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second;
    } catch (_) {
      branchLocalNow = new Date().toISOString().slice(0, 19);
    }

    const statusFilter = req.query.status;
    let query = `
      SELECT o.*, b.name as branch_name 
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.brand_id = ? AND o.branch_id = ?
    `;
    // Keep the same operational precedence as the Merchant App:
    // pending → upcoming confirmed reservation → everything else.
    // This is a visibility safeguard at the API boundary; the client may still
    // apply its own presentation sort without changing server business state.
    const params = [req.brand_id, req.params.id];

    if (statusFilter && statusFilter !== 'all') {
      query += ' AND o.status = ?';
      params.push(statusFilter);
    }

    // ORDER BY placeholders come after the optional status filter placeholder.
    params.push(branchLocalNow, branchLocalNow);

    query += `
      ORDER BY
        CASE
          WHEN o.status = 'pending' THEN 0
          WHEN o.order_type = 'reservation'
               AND o.status = 'confirmed'
               AND o.scheduled_slot_start IS NOT NULL
               AND o.scheduled_slot_start >= ? THEN 1
          ELSE 2
        END ASC,
        CASE
          WHEN o.order_type = 'reservation'
               AND o.status = 'confirmed'
               AND o.scheduled_slot_start IS NOT NULL
               AND o.scheduled_slot_start >= ? THEN o.scheduled_slot_start
          ELSE NULL
        END ASC,
        o.created_at DESC
    `;

    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 200) : 100;
    query += ` LIMIT ${limit}`;

    if (req.query.offset) {
      query += ` OFFSET ${parseInt(req.query.offset, 10)}`;
    }

    const orders = db.prepare(query).all(...params);

    const enriched = orders.map(ord => ({
      ...ord,
      acceptance_deadline_at: ord.acceptance_deadline_at || AcceptanceTimeoutService.computeAcceptanceDeadlineAt(ord),
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
      delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id),
      payment: db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(ord.id)
    }));

    res.json({ success: true, branch_id: req.params.id, orders: enriched });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/orders]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


router.post('/admin/branches/:id/products', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const productId = String((req.body && req.body.product_id) || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, error: 'product_id wajib diisi.' });
    }

    // Branch ownership (tenant-scoped)
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    // C1.3 Brand consistency: the product master must belong to the SAME brand as the branch.
    // (A product of another brand is not found here → cross-brand assignment is impossible.)
    const product = db.prepare('SELECT id, brand_id, price, is_active FROM products WHERE id = ? AND brand_id = ?').get(productId, req.brand_id);
    if (!product) {
      return res.status(400).json({
        success: false,
        error: 'PRODUCT_BRAND_MISMATCH',
        message: 'Produk tidak ditemukan atau bukan milik brand ini; produk hanya dapat dialokasikan ke cabang brand yang sama.'
      });
    }
    if (product.is_active === 0) {
      return res.status(400).json({
        success: false,
        error: 'PRODUCT_INACTIVE',
        message: 'Produk master sedang nonaktif dan tidak dapat dialokasikan ke cabang.'
      });
    }

    // C1.4 Assignment != Inventory: the assignment row is created WITHOUT fabricating stock.
    // stock stays NULL until the Inventory domain records actual branch stock.
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock)
      VALUES (?, ?, ?, NULL)
    `).run(req.params.id, productId, product.price != null ? product.price : null);
    const alreadyAssigned = !stmt || stmt.changes === 0;

    const assignment = db.prepare(`
      SELECT branch_id, product_id, price, stock, is_available, low_stock_threshold
      FROM branch_products WHERE branch_id = ? AND product_id = ?
    `).get(req.params.id, productId);

    res.status(alreadyAssigned ? 200 : 201).json({
      success: true,
      already_assigned: alreadyAssigned,
      assignment
    });
  } catch (err) {
    if (String(err && err.message).includes('CROSS_BRAND_ASSIGNMENT_REJECTED')) {
      return res.status(400).json({
        success: false,
        error: 'CROSS_BRAND_ASSIGNMENT_REJECTED',
        message: 'Produk dan cabang harus berasal dari brand yang sama.'
      });
    }
    console.error('[API Error POST /admin/branches/:id/products]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1 Toggle operational availability (is_available) of an assigned product.
// Branch Manager limited to own branch; Owner/Brand anywhere in their brand.
router.patch('/admin/branches/:id/products/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    // Strict 0|1 validation of the availability flag.
    const rawAvail = req.body && req.body.is_available;
    let nextAvailability = null;
    if (rawAvail !== undefined && rawAvail !== null) {
      if (rawAvail === true) nextAvailability = 1;
      else if (rawAvail === false) nextAvailability = 0;
      else {
        const n = Number(rawAvail);
        if (n !== 0 && n !== 1) {
          return res.status(400).json({ success: false, error: 'Nilai is_available tidak valid. Gunakan 0 atau 1.' });
        }
        nextAvailability = n;
      }
    } else if (rawAvail === null) {
      return res.status(400).json({ success: false, error: 'Nilai is_available tidak valid. Gunakan 0 atau 1.' });
    }
    if (nextAvailability === null) {
      return res.status(400).json({ success: false, error: 'Nilai is_available wajib diisi (0 atau 1).' });
    }

    // Branch Manager may only toggle their OWN branch.
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    // Branch ownership + assignment existence with brand-consistent product.
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }
    const assignment = db.prepare(`
      SELECT bp.branch_id, bp.product_id, bp.is_available, p.name AS product_name
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.brand_id, req.params.id, req.params.productId);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Produk tidak dialokasikan ke cabang ini.'
      });
    }

    const previousValue = assignment.is_available;
    const stmt = db.prepare(`
      UPDATE branch_products SET is_available = ?, updated_at = datetime('now')
      WHERE branch_id = ? AND product_id = ?
    `).run(nextAvailability, req.params.id, req.params.productId);
    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Alokasi produk tidak ditemukan.' });
    }

    // B1/C1 operational audit trail (append-only).
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product.update', 'is_available', ?, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify(previousValue),
      JSON.stringify(nextAvailability),
      req.user.userId || req.user.id || req.user.username || 'system',
      req.user.role || 'system'
    );

    res.json({
      success: true,
      assignment: {
        branch_id: req.params.id,
        product_id: req.params.productId,
        product_name: assignment.product_name,
        is_available: nextAvailability
      }
    });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/products/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.5 Comprehensive Branch Catalog View (Adopted & Available Master Products)
router.get('/admin/branches/:id/catalog', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id, name, slug, address_text, is_active FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const branchCategories = db.prepare(`
      SELECT bc.id, bc.brand_id, bc.branch_id, bc.name, bc.slug, bc.image_url, bc.sort_order,
        (SELECT COUNT(*) FROM branch_product_categories bpc WHERE bpc.branch_category_id = bc.id) AS product_count
      FROM branch_categories bc
      WHERE bc.branch_id = ? AND bc.brand_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.brand_id);

    const adoptedProducts = db.prepare(`
      SELECT 
        bp.product_id,
        COALESCE(bp.name_override, p.name) as name,
        COALESCE(bp.description_override, p.description) as description,
        COALESCE(bp.image_override, p.image_url) as image_url,
        bp.name_override,
        bp.description_override,
        bp.image_override,
        p.name as master_name,
        p.description as master_description,
        p.image_url as master_image_url,
        bp.branch_category_id,
        bc.name as branch_category_name,
        bp.price,
        p.price as master_price,
        p.pricing_mode,
        p.min_price,
        p.max_price,
        bp.stock,
        bp.is_available
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.brand_id, req.params.id);

    // M:N category memberships per product
    let productCategoryRows = [];
    try {
      productCategoryRows = db.prepare(`
        SELECT bpc.product_id, bpc.branch_category_id, bc.name as category_name, bc.slug as category_slug
        FROM branch_product_categories bpc
        JOIN branch_categories bc ON bc.id = bpc.branch_category_id
        WHERE bpc.branch_id = ?
        ORDER BY bc.sort_order ASC, bc.name ASC
      `).all(req.params.id);
    } catch (_) {}

    const productCategoriesMap = {};
    for (const r of productCategoryRows) {
      if (!productCategoriesMap[r.product_id]) productCategoriesMap[r.product_id] = [];
      productCategoriesMap[r.product_id].push({
        id: r.branch_category_id,
        name: r.category_name,
        slug: r.category_slug
      });
    }

    const enrichedAdopted = adoptedProducts.map(p => {
      const cats = productCategoriesMap[p.product_id] || [];
      const catIds = cats.map(c => c.id);
      if (catIds.length === 0 && p.branch_category_id) {
        catIds.push(p.branch_category_id);
        if (p.branch_category_name) {
          cats.push({ id: p.branch_category_id, name: p.branch_category_name, slug: '' });
        }
      }
      return {
        ...p,
        category_ids: catIds,
        categories: cats,
        branch_category_id: catIds[0] || p.branch_category_id || null,
        branch_category_name: cats.map(c => c.name).join(', ') || p.branch_category_name || null
      };
    });

    const adoptedIds = adoptedProducts.map(ap => ap.product_id);
    const placeholders = adoptedIds.length > 0 ? adoptedIds.map(() => '?').join(',') : null;
    const masterQuery = placeholders
      ? `SELECT id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price
         FROM products WHERE brand_id = ? AND (is_active = 1 OR is_active IS NULL) AND id NOT IN (${placeholders}) ORDER BY sort_order ASC, name ASC`
      : `SELECT id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price
         FROM products WHERE brand_id = ? AND (is_active = 1 OR is_active IS NULL) ORDER BY sort_order ASC, name ASC`;
    const masterParams = placeholders ? [req.brand_id, ...adoptedIds] : [req.brand_id];
    const availableMasterProducts = db.prepare(masterQuery).all(...masterParams);

    res.json({
      success: true,
      branch,
      categories: branchCategories,
      adopted_products: enrichedAdopted,
      available_master_products: availableMasterProducts
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/catalog]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.6 Adopt / Add Product to Branch Catalog with Pricing Policy enforcement
router.post('/admin/branches/:id/adopt', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const productId = String((req.body && req.body.product_id) || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, error: 'product_id wajib diisi.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const product = db.prepare(`
      SELECT id, brand_id, category_id, name, description, image_url, price, pricing_mode, min_price, max_price, is_active
      FROM products WHERE id = ? AND brand_id = ?
    `).get(productId, req.brand_id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produk master tidak ditemukan pada brand ini.' });
    }
    if (product.is_active === 0) {
      return res.status(400).json({ success: false, error: 'Produk master sedang nonaktif dan tidak dapat diadopsi.' });
    }

    // Resolve price according to locked PricingPolicyModel:
    // If pricing_mode is 'lock', branch CANNOT override price (enforces master price)
    const mode = (product.pricing_mode || 'lock').toLowerCase();
    const rawPriceInput = mode === 'lock'
      ? null
      : (req.body.price !== undefined && req.body.price !== null && req.body.price !== '' ? Number(req.body.price) : null);

    let resolved;
    try {
      resolved = PricingPolicyModel.resolvePrice(
        {
          price: product.price,
          pricing_mode: product.pricing_mode || 'lock',
          min_price: product.min_price,
          max_price: product.max_price
        },
        rawPriceInput
      );
    } catch (pricingErr) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_BRANCH_PRICE',
        message: pricingErr.message
      });
    }

    // Branch Category handling: supports category_ids (array) or branch_category_id (scalar)
    let targetCategoryIds = [];
    if (Array.isArray(req.body.category_ids) && req.body.category_ids.length > 0) {
      for (const rawId of req.body.category_ids) {
        const idStr = String(rawId).trim();
        const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ?').get(idStr, req.params.id);
        if (validCat && !targetCategoryIds.includes(idStr)) targetCategoryIds.push(idStr);
      }
    } else if (req.body.branch_category_id) {
      const idStr = String(req.body.branch_category_id).trim();
      const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ?').get(idStr, req.params.id);
      if (validCat) targetCategoryIds.push(idStr);
    }

    // If no branch category specified, resolve or auto-create branch category from master category name
    if (targetCategoryIds.length === 0) {
      const masterCat = product.category_id ? db.prepare('SELECT name, slug FROM categories WHERE id = ?').get(product.category_id) : null;
      const catName = masterCat?.name || 'Menu Utama';
      const catSlug = masterCat?.slug || 'menu-utama';

      let existingBranchCat = db.prepare('SELECT id FROM branch_categories WHERE branch_id = ? AND name = ?').get(req.params.id, catName);
      if (!existingBranchCat) {
        const newBcId = 'bc_' + crypto.randomUUID();
        db.prepare(`
          INSERT INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
          VALUES (?, ?, ?, ?, ?, 99)
        `).run(newBcId, req.brand_id, req.params.id, catName, catSlug);
        targetCategoryIds.push(newBcId);
      } else {
        targetCategoryIds.push(existingBranchCat.id);
      }
    }

    const primaryBranchCategoryId = targetCategoryIds[0] || null;

    // Insert or adopt branch_products (override columns start NULL = inherit master).
    db.prepare(`
      INSERT INTO branch_products (
        branch_id, product_id, branch_category_id, price, is_available, stock
      ) VALUES (?, ?, ?, ?, 1, 100)
      ON CONFLICT(branch_id, product_id) DO UPDATE SET
        branch_category_id = excluded.branch_category_id,
        price = excluded.price,
        is_available = 1,
        updated_at = datetime('now')
    `).run(
      req.params.id,
      product.id,
      primaryBranchCategoryId,
      resolved.effective_price
    );

    // M:N category junction
    for (const catId of targetCategoryIds) {
      db.prepare(`
        INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id)
        VALUES (?, ?, ?)
      `).run(req.params.id, product.id, catId);
    }

    // Audit trail
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product.adopt', 'product_id', NULL, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      product.id,
      JSON.stringify({ product_id: product.id, price: resolved.effective_price, branch_category_id: primaryBranchCategoryId, category_ids: targetCategoryIds }),
      actorId,
      actorRole
    );

    res.status(201).json({
      success: true,
      message: 'Produk berhasil diadopsi ke katalog cabang.',
      adopted: {
        branch_id: req.params.id,
        product_id: product.id,
        price: resolved.effective_price,
        branch_category_id: primaryBranchCategoryId,
        category_ids: targetCategoryIds
      }
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/adopt]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.7 Remove (Un-adopt) Product from Branch Catalog
router.delete('/admin/branches/:id/products/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    db.prepare('DELETE FROM branch_product_categories WHERE branch_id = ? AND product_id = ?').run(req.params.id, req.params.productId);
    const stmt = db.prepare('DELETE FROM branch_products WHERE branch_id = ? AND product_id = ?').run(req.params.id, req.params.productId);
    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });
    }

    // Audit log
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product.remove', 'product_id', ?, NULL, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify({ product_id: req.params.productId }),
      actorId,
      actorRole
    );

    res.json({
      success: true,
      message: 'Produk berhasil dihapus dari katalog cabang.'
    });
  } catch (err) {
    console.error('[API Error DELETE /admin/branches/:id/products/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.9 Sync Branch Catalog to Connector — pushes branch catalog data from Core DB to the
// enterprise connector's client DB. Idempotent, safe to run repeatedly.
router.post('/admin/branches/:id/sync-catalog', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const branchId = req.params.id;
    const brandId = req.brand_id;

    const branch = db.prepare('SELECT id, brand_id, name FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    let connectorClient;
    try {
      connectorClient = new XentraConnectorClient();
    } catch (_e) {
      return res.status(503).json({ success: false, error: 'Connector not configured' });
    }

    const branchCategories = db.prepare(
      'SELECT id, brand_id, branch_id, name, image_url, sort_order FROM branch_categories WHERE branch_id = ?'
    ).all(branchId);

    const branchProducts = db.prepare(
      'SELECT branch_id, product_id, branch_category_id, name_override, description_override, image_override, price, stock, is_available, low_stock_threshold, created_at FROM branch_products WHERE branch_id = ?'
    ).all(branchId);

    if (branchProducts.length === 0) {
      return res.status(400).json({ success: false, error: 'Branch has no products to sync' });
    }

    const productIds = branchProducts.map((bp) => bp.product_id);
    const placeholders = productIds.map(() => '?').join(',');
    const masterProducts = db.prepare(
      `SELECT id, brand_id, name, slug, description, image_url, category_id FROM products WHERE brand_id = ? AND id IN (${placeholders})`
    ).all(brandId, ...productIds);

    if (masterProducts.length !== branchProducts.length) {
      return res.status(409).json({ success: false, error: 'Branch catalog contains products outside this brand' });
    }

    const mutationId = `catalog_sync_${branchId}_${Date.now()}`;

    const result = await connectorClient.syncBranchCatalog({
      mutation_id: mutationId,
      brand_id: brandId,
      branch_id: branchId,
      categories: branchCategories.map((c) => ({
        id: c.id,
        name: c.name,
        image_url: c.image_url || null,
        sort_order: c.sort_order || 0,
      })),
      products: masterProducts.map((p) => {
        const bp = branchProducts.find((b) => b.product_id === p.id);
        return {
          id: p.id,
          name: p.name,
          slug: p.slug || '',
          description: p.description || '',
          image_url: p.image_url || null,
          category_id: p.category_id || null,
          branch_category_id: bp.branch_category_id || null,
          name_override: bp.name_override || null,
          description_override: bp.description_override || null,
          image_override: bp.image_override || null,
          price: bp.price,
          stock: bp.stock,
          is_available: Boolean(bp.is_available),
          low_stock_threshold: bp.low_stock_threshold,
          created_at: bp.created_at || new Date().toISOString(),
        };
      }),
    });

    res.json({
      success: true,
      branch_id: branchId,
      categories_synced: result.result.categories_upserted,
      products_synced: result.result.products_upserted,
      branch_products_synced: result.result.branch_products_upserted,
      replay: Boolean(result.replay),
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/sync-catalog]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.8-OVR Branch Product Override — set or clear per-field content overrides
// plus pricing policy (price) and category assignment (branch_category_id).
// NULL body field = clear override (branch falls back to live Master Product value).
// Non-null body field = branch override wins at query time via COALESCE in CatalogService.
router.patch('/admin/branches/:id/products/:productId/override', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const bp = db.prepare(`
      SELECT bp.branch_id, bp.branch_category_id, bp.price,
             p.price as master_price, p.pricing_mode, p.min_price, p.max_price
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.brand_id, req.params.id, req.params.productId);
    if (!bp) {
      return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });
    }

    // Only fields explicitly present in the request body are updated.
    // Pass null to clear an override; omit the key entirely to leave it untouched.
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      updates.name_override = req.body.name != null ? String(req.body.name).trim() || null : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
      updates.description_override = req.body.description != null ? String(req.body.description).trim() || null : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'image_url')) {
      updates.image_override = req.body.image_url != null ? String(req.body.image_url).trim() || null : null;
    }

    // price — enforced by the same locked PricingPolicyModel used at adopt time:
    //   lock  → branch CANNOT change price (custom price rejected, master wins)
    //   range → branch price must sit inside [min_price, max_price]
    if (Object.prototype.hasOwnProperty.call(req.body, 'price')) {
      const rawPrice = req.body.price;
      const mode = (bp.pricing_mode || 'lock').toLowerCase();

      const branchPrice = (rawPrice === null || rawPrice === '' || rawPrice === undefined)
        ? bp.master_price
        : Number(rawPrice);
      if (!Number.isFinite(branchPrice) || branchPrice < 0) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH_PRICE', message: 'Harga cabang harus berupa angka positif.' });
      }
      if (mode === 'lock' && branchPrice !== bp.master_price) {
        return res.status(403).json({
          success: false,
          error: 'PRICE_LOCKED',
          message: 'Harga cabang dikunci owner. Tidak dapat diubah oleh cabang.'
        });
      }
      try {
        const resolved = PricingPolicyModel.resolvePrice(
          {
            price: bp.master_price,
            pricing_mode: mode,
            min_price: bp.min_price,
            max_price: bp.max_price
          },
          branchPrice
        );
        updates.price = resolved.effective_price;
      } catch (pricingErr) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH_PRICE', message: pricingErr.message });
      }
    }

    // Category assignment handling:
    // Supports category_ids (array for M:N) or branch_category_id (scalar for backward compatibility).
    let hasCategoryUpdate = false;
    let targetOverrideCatIds = null;
    if (Array.isArray(req.body.category_ids)) {
      hasCategoryUpdate = true;
      targetOverrideCatIds = [];
      for (const rawId of req.body.category_ids) {
        const catId = String(rawId).trim();
        const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
          .get(catId, req.params.id, req.brand_id);
        if (!validCat) {
          return res.status(400).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Kategori cabang tidak valid untuk cabang ini.'
          });
        }
        if (!targetOverrideCatIds.includes(catId)) targetOverrideCatIds.push(catId);
      }
      updates.branch_category_id = targetOverrideCatIds.length > 0 ? targetOverrideCatIds[0] : null;
    } else if (Object.prototype.hasOwnProperty.call(req.body, 'branch_category_id')) {
      hasCategoryUpdate = true;
      const rawCat = req.body.branch_category_id;
      if (rawCat === null || rawCat === '' || rawCat === undefined) {
        updates.branch_category_id = null;
        targetOverrideCatIds = [];
      } else {
        const catId = String(rawCat).trim();
        const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
          .get(catId, req.params.id, req.brand_id);
        if (!validCat) {
          return res.status(400).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Kategori cabang tidak valid untuk cabang ini.'
          });
        }
        updates.branch_category_id = catId;
        targetOverrideCatIds = [catId];
      }
    }

    if (Object.keys(updates).length === 0 && !hasCategoryUpdate) {
      return res.status(400).json({ success: false, error: 'Tidak ada field override yang disediakan (name, description, image_url, price, branch_category_id, category_ids).' });
    }

    if (Object.keys(updates).length > 0) {
      const setParts = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), req.params.id, req.params.productId];
      db.prepare(`UPDATE branch_products SET ${setParts}, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?`).run(...values);
    }

    if (hasCategoryUpdate && targetOverrideCatIds !== null) {
      db.prepare('DELETE FROM branch_product_categories WHERE branch_id = ? AND product_id = ?')
        .run(req.params.id, req.params.productId);
      for (const catId of targetOverrideCatIds) {
        db.prepare(`
          INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id)
          VALUES (?, ?, ?)
        `).run(req.params.id, req.params.productId, catId);
      }
    }

    // Read back the resolved state for the response
    const resolved = db.prepare(`
      SELECT
        COALESCE(bp.name_override, p.name) as name,
        COALESCE(bp.description_override, p.description) as description,
        COALESCE(bp.image_override, p.image_url) as image_url,
        bp.name_override, bp.description_override, bp.image_override,
        p.name as master_name, p.description as master_description, p.image_url as master_image_url,
        bp.price, p.price as master_price, p.pricing_mode, p.min_price, p.max_price,
        bp.branch_category_id, bc.name as branch_category_name,
        bp.is_available, bp.stock
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.params.id, req.params.productId);

    // Attach M:N category memberships
    const prodCats = db.prepare(`
      SELECT bc.id, bc.name, bc.slug
      FROM branch_product_categories bpc
      JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bpc.branch_id = ? AND bpc.product_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.params.productId);

    if (resolved) {
      resolved.categories = prodCats;
      resolved.category_ids = prodCats.map(c => c.id);
      if (prodCats.length > 0) {
        resolved.branch_category_name = prodCats.map(c => c.name).join(', ');
      }
    }

    res.json({
      success: true,
      message: 'Override produk berhasil disimpan.',
      override: resolved
    });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/products/:productId/override]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.8 Create Branch-owned Category
router.post('/admin/branches/:id/categories', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const name = String((req.body && req.body.name) || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Nama kategori cabang wajib diisi.' });
    }
    if (name.length > 40) {
      return res.status(400).json({ success: false, error: 'Nama kategori maksimal 40 karakter.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const bcId = 'bc_' + crypto.randomUUID();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const sortOrder = req.body.sort_order ? Number(req.body.sort_order) : 99;

    db.prepare(`
      INSERT INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(bcId, req.brand_id, req.params.id, name, slug, sortOrder);

    res.status(201).json({
      success: true,
      category: { id: bcId, name, slug, sort_order: sortOrder }
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/categories]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rename a branch category
router.patch('/admin/branches/:id/categories/:catId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi.' });
    if (name.length > 40) {
      return res.status(400).json({ success: false, error: 'Nama kategori maksimal 40 karakter.' });
    }

    const cat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    try {
      db.prepare("UPDATE branch_categories SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?")
        .run(name, slug, req.params.catId);
    } catch (e) {
      if (String(e).includes('no such column')) {
        db.prepare("UPDATE branch_categories SET name = ?, slug = ? WHERE id = ?")
          .run(name, slug, req.params.catId);
      } else {
        throw e;
      }
    }

    res.json({ success: true, category: { id: req.params.catId, name, slug } });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/categories/:catId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a branch category (products in it remain, just lose category assignment)
router.delete('/admin/branches/:id/categories/:catId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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

    // Unassign products, delete the category, then re-pack the remaining categories'
    // sort_order into a contiguous 1..N sequence — all inside one atomic transaction
    // so Home never observes a gap (e.g. 1, 4, 7) or a half-applied delete.
    const remaining = db.prepare(
      'SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ? AND id != ? ORDER BY sort_order ASC, name ASC'
    ).all(req.params.id, req.brand_id, req.params.catId);

    const updateSort = db.prepare('UPDATE branch_categories SET sort_order = ? WHERE id = ?');

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('DELETE FROM branch_product_categories WHERE branch_category_id = ? AND branch_id = ?')
        .run(req.params.catId, req.params.id);
      db.prepare(`
        UPDATE branch_products
        SET branch_category_id = (
          SELECT branch_category_id FROM branch_product_categories
          WHERE branch_product_categories.branch_id = branch_products.branch_id
            AND branch_product_categories.product_id = branch_products.product_id
          LIMIT 1
        )
        WHERE branch_category_id = ? AND branch_id = ?
      `).run(req.params.catId, req.params.id);
      db.prepare('DELETE FROM branch_categories WHERE id = ?').run(req.params.catId);
      remaining.forEach((c, idx) => updateSort.run(idx + 1, c.id));
      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API Error DELETE /admin/branches/:id/categories/:catId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reorder branch categories — accepts ordered array of category IDs, updates sort_order atomically
router.put('/admin/branches/:id/categories/reorder', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const { order } = req.body; // array of category IDs in desired display order
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, error: 'Payload "order" harus berupa array ID kategori.' });
    }

    // Reject duplicate IDs in the payload — a duplicate would make ordering ambiguous
    // and would silently clobber another category's sort_order.
    const uniqueIds = new Set(order.map(String));
    if (uniqueIds.size !== order.length) {
      return res.status(400).json({ success: false, error: 'Payload "order" mengandung ID kategori duplikat.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    // AUTHORITATIVE VALIDATION: every ID in the payload must actually belong to THIS
    // branch (and brand). Reject the whole request up front — never let one branch's
    // reorder touch another branch's categories, and never trust client-sent order
    // for IDs we haven't verified ownership of.
    const owned = db.prepare('SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ?')
      .all(req.params.id, req.brand_id);
    const ownedIds = new Set(owned.map((c) => String(c.id)));
    const invalidIds = order.filter((catId) => !ownedIds.has(String(catId)));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'FORBIDDEN_BRANCH_SCOPE',
        message: 'Sebagian ID kategori tidak valid atau bukan milik cabang ini.'
      });
    }

    // Categories that exist for this branch but were NOT included in the payload keep
    // their relative order and are placed deterministically after the reordered set,
    // so no category is ever left with an undefined/garbage sort_order.
    const orderedIdStrings = order.map(String);
    const untouched = owned
      .map((c) => String(c.id))
      .filter((id) => !uniqueIds.has(id));
    const finalOrder = [...orderedIdStrings, ...untouched];

    // Update every category's sort_order inside a single atomic transaction — if
    // anything throws mid-way, the whole transaction rolls back and the previous
    // ordering stays fully intact.
    const updateSort = db.prepare('UPDATE branch_categories SET sort_order = ? WHERE id = ? AND branch_id = ? AND brand_id = ?');

    db.exec('BEGIN IMMEDIATE;');
    try {
      finalOrder.forEach((catId, idx) => {
        updateSort.run(idx + 1, catId, req.params.id, req.brand_id);
      });
      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API Error PUT /admin/branches/:id/categories/reorder]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// M:N BRANCH PRODUCT ↔ CATEGORY MEMBERSHIP (PHASE 3)
// Reconciled endpoints allowing multiple category assignments per product
// =========================================================================

// Retrieve all categories assigned to a branch product
router.get('/admin/branches/:id/products/:productId/categories', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.' });
      }
    }
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });

    const bp = db.prepare('SELECT product_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
    if (!bp) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });

    const categories = db.prepare(`
      SELECT bc.id, bc.brand_id, bc.branch_id, bc.name, bc.slug, bc.image_url, bc.sort_order
      FROM branch_product_categories bpc
      JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bpc.branch_id = ? AND bpc.product_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.params.productId);

    res.json({
      success: true,
      branch_id: req.params.id,
      product_id: req.params.productId,
      categories: categories || []
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/products/:productId/categories]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Assign product to a branch category (supports single category_id or category_ids array)
router.post('/admin/branches/:id/products/:productId/categories', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.' });
      }
    }
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });

    const bp = db.prepare('SELECT product_id, branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
    if (!bp) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });

    const rawCatId = (req.body && (req.body.branch_category_id || req.body.category_id)) || '';
    const catId = String(rawCatId).trim();
    if (!catId) {
      return res.status(400).json({ success: false, error: 'category_id wajib diisi.' });
    }

    const cat = db.prepare('SELECT id, name FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(catId, req.params.id, req.brand_id);
    if (!cat) {
      return res.status(400).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Kategori cabang tidak valid atau bukan milik cabang ini.' });
    }

    const prevCats = db.prepare('SELECT branch_category_id FROM branch_product_categories WHERE branch_id = ? AND product_id = ?')
      .all(req.params.id, req.params.productId).map(r => r.branch_category_id);

    db.prepare(`
      INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id)
      VALUES (?, ?, ?)
    `).run(req.params.id, req.params.productId, catId);

    // Sync legacy primary column if not already populated
    if (!bp.branch_category_id) {
      db.prepare('UPDATE branch_products SET branch_category_id = ?, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?')
        .run(catId, req.params.id, req.params.productId);
    }

    const newCats = db.prepare(`
      SELECT bc.id, bc.name, bc.slug
      FROM branch_product_categories bpc
      JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bpc.branch_id = ? AND bpc.product_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.params.productId);

    // Audit trail
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product_category.assign', 'branch_category_id', ?, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify(prevCats),
      JSON.stringify(newCats.map(c => c.id)),
      actorId,
      actorRole
    );

    res.status(201).json({
      success: true,
      message: 'Kategori cabang berhasil ditambahkan ke produk.',
      branch_id: req.params.id,
      product_id: req.params.productId,
      assigned_category_id: catId,
      category_ids: newCats.map(c => c.id),
      categories: newCats
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/products/:productId/categories]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Remove product from a branch category
router.delete('/admin/branches/:id/products/:productId/categories/:catId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.' });
      }
    }
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });

    const prevCats = db.prepare('SELECT branch_category_id FROM branch_product_categories WHERE branch_id = ? AND product_id = ?')
      .all(req.params.id, req.params.productId).map(r => r.branch_category_id);

    const delStmt = db.prepare('DELETE FROM branch_product_categories WHERE branch_id = ? AND product_id = ? AND branch_category_id = ?')
      .run(req.params.id, req.params.productId, req.params.catId);

    if (!delStmt || delStmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Keanggotaan kategori produk tidak ditemukan.' });
    }

    const remainingCats = db.prepare(`
      SELECT bc.id, bc.name, bc.slug
      FROM branch_product_categories bpc
      JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bpc.branch_id = ? AND bpc.product_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.params.productId);

    // Sync legacy primary column
    const nextPrimaryCat = remainingCats.length > 0 ? remainingCats[0].id : null;
    db.prepare('UPDATE branch_products SET branch_category_id = ?, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?')
      .run(nextPrimaryCat, req.params.id, req.params.productId);

    // Audit trail
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product_category.remove', 'branch_category_id', ?, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify(prevCats),
      JSON.stringify(remainingCats.map(c => c.id)),
      actorId,
      actorRole
    );

    res.json({
      success: true,
      message: 'Keanggotaan kategori berhasil dihapus dari produk.',
      branch_id: req.params.id,
      product_id: req.params.productId,
      removed_category_id: req.params.catId,
      category_ids: remainingCats.map(c => c.id),
      categories: remainingCats
    });
  } catch (err) {
    console.error('[API Error DELETE /admin/branches/:id/products/:productId/categories/:catId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Retrieve all products belonging to a branch category
router.get('/admin/branches/:id/categories/:catId/products', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.' });
      }
    }
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });

    const cat = db.prepare('SELECT id, name, slug, image_url, sort_order FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    const products = db.prepare(`
      SELECT
        bp.product_id,
        COALESCE(bp.name_override, p.name) as name,
        COALESCE(bp.description_override, p.description) as description,
        COALESCE(bp.image_override, p.image_url) as image_url,
        bp.price,
        p.price as master_price,
        p.pricing_mode,
        bp.stock,
        bp.is_available
      FROM branch_product_categories bpc
      JOIN branch_products bp ON bp.branch_id = bpc.branch_id AND bp.product_id = bpc.product_id
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bpc.branch_id = ? AND bpc.branch_category_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.brand_id, req.params.id, req.params.catId);

    res.json({
      success: true,
      branch_id: req.params.id,
      category: cat,
      products: products || []
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/categories/:catId/products]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


/* =========================================================================
   C2 — BRANCH INVENTORY BOUNDARY
   Physical stock is owned and mutated at the Branch boundary. Mutations go
   through InventoryStockService (atomic guarded UPDATE + immutable
   inventory_movements ledger). Only operational adjustments are exposed
   here: audit_adjustment (+/-) and waste_spoilage (-). Stock intake via
   purchase_in belongs to the Purchase Order flow and sale_deduction belongs
   to order settlement — neither is exposed as a manual operation.
   ========================================================================= */

// C2 Branch inventory list (read-only; branch-scoped for Branch Manager)

};
