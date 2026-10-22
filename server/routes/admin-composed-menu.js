'use strict';

const {
  ComposedProductService,
  ComposedMenuService,
  ComposedMenuResolver
} = require('../../domains/catalog');

function statusForError(message) {
  switch (message) {
    case 'MENU_SATUAN_ALREADY_EXISTS':
    case 'SUB_CATEGORY_ALREADY_EXISTS':
    case 'RASA_ALREADY_EXISTS':
    case 'PRODUCT_SKU_ALREADY_EXISTS':
    case 'PRODUCT_SKU_REMOVAL_BLOCKED_STOCK':
    case 'MENU_TYPE_MISMATCH':
    case 'RASA_ORIGINAL_PROTECTED':
      return 409;
    case 'MENU_NOT_FOUND':
    case 'MASTER_PRODUCT_NOT_FOUND':
    case 'CATEGORY_NOT_FOUND':
    case 'SUB_CATEGORY_NOT_FOUND':
    case 'RASA_NOT_FOUND':
    case 'LEVEL_NOT_FOUND':
    case 'BRANCH_NOT_FOUND':
    case 'BRANCH_CATEGORY_NOT_FOUND':
    case 'BRANCH_MENU_NOT_FOUND':
      return 404;
    case 'BRAND_CONTEXT_REQUIRED':
    case 'BRANCH_CONTEXT_REQUIRED':
      return 400;
    default:
      return 400;
  }
}

function sendError(res, err, fallback) {
  const message = err && err.message ? err.message : fallback;
  return res.status(statusForError(message)).json({
    success: false,
    error: message
  });
}

function registerAdminComposedMenuRoutes(router, deps = {}) {
  const requireAuth = deps.requireAuth;
  const productService = deps.productService || ComposedProductService;
  const service = deps.service || ComposedMenuService;
  const resolver = deps.resolver || ComposedMenuResolver;
  const ownerRoles = ['owner', 'brand_manager'];
  const menuAdoptionRoles = ['owner', 'brand_manager', 'branch_manager'];

  const handleProductList = (req, res) => {
    try {
      const activeOnly = !(req.query && (req.query.active_only === '0' || req.query.active_only === 'false'));
      const query = req.query && req.query.q != null ? req.query.q : null;
      res.json({
        success: true,
        products: productService.listProducts({
          brandId: req.brand_id,
          activeOnly,
          query
        })
      });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_LIST_FAILED');
    }
  };

  const handleProductRead = (req, res) => {
    try {
      const product = productService.findProduct
        ? productService.findProduct({ brandId: req.brand_id, productId: req.params.id })
        : null;

      if (!product) {
        return res.status(404).json({ success: false, error: 'MASTER_PRODUCT_NOT_FOUND' });
      }

      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_READ_FAILED');
    }
  };

  const handleProductCreate = (req, res) => {
    try {
      const body = req.body || {};
      const product = productService.createProduct({
        brandId: req.brand_id,
        name: body.name,
        sku: body.sku,
        costPrice: body.cost_price !== undefined ? body.cost_price : body.costPrice,
        inventoryType: body.inventory_type !== undefined ? body.inventory_type : body.inventoryType,
        description: body.description,
        imageUrl: body.image_url !== undefined ? body.image_url : body.imageUrl,
        image: body.image,
        isActive: body.is_active !== undefined ? body.is_active : (body.isActive !== undefined ? body.isActive : true),
        optionsConfig: body.options_config !== undefined ? body.options_config : body.optionsConfig,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });
      res.status(201).json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_CREATE_FAILED');
    }
  };

  const handleProductUpdate = (req, res) => {
    try {
      const body = req.body || {};
      const product = productService.updateProduct({
        brandId: req.brand_id,
        productId: req.params.id,
        name: body.name,
        sku: body.sku,
        costPrice: body.cost_price !== undefined ? body.cost_price : body.costPrice,
        inventoryType: body.inventory_type !== undefined ? body.inventory_type : body.inventoryType,
        description: body.description,
        imageUrl: body.image_url !== undefined ? body.image_url : body.imageUrl,
        image: body.image,
        isActive: body.is_active !== undefined ? body.is_active : body.isActive,
        optionsConfig: body.options_config !== undefined ? body.options_config : body.optionsConfig,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_UPDATE_FAILED');
    }
  };

  const handleProductStatusUpdate = (req, res) => {
    try {
      const isActive = req.body && (req.body.is_active !== undefined ? req.body.is_active : req.body.isActive);
      const product = productService.updateProduct({
        brandId: req.brand_id,
        productId: req.params.id,
        isActive: isActive,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_STATUS_UPDATE_FAILED');
    }
  };

  ['/admin/composed/products', '/admin/items'].forEach(routePath => {
    router.get(routePath, requireAuth(ownerRoles), handleProductList);
    router.post(routePath, requireAuth(ownerRoles), handleProductCreate);
  });

  ['/admin/composed/products/:id', '/admin/items/:id'].forEach(routePath => {
    router.get(routePath, requireAuth(ownerRoles), handleProductRead);
    router.put(routePath, requireAuth(ownerRoles), handleProductUpdate);
  });

  ['/admin/composed/products/:id/status', '/admin/items/:id/status'].forEach(routePath => {
    router.patch(routePath, requireAuth(ownerRoles), handleProductStatusUpdate);
  });

  const handleMenuList = (req, res) => {
    try {
      const menuType = req.query && req.query.menu_type ? String(req.query.menu_type).trim().toUpperCase() : null;
      const status = req.query && req.query.status ? String(req.query.status).trim().toUpperCase() : null;
      const menus = service.listMenus({
        brandId: req.brand_id,
        menuType,
        status
      });
      res.json({ success: true, menus });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_LIST_FAILED');
    }
  };

  const handleMenuRead = (req, res) => {
    try {
      const menu = resolver.resolveMenu({
        brandId: req.brand_id,
        menuId: req.params.id
      });
      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_READ_FAILED');
    }
  };

  // Canonical Menu endpoints (Contract v4 §3, §14):
  // POST /admin/menus - Create canonical Menu (Category, Judul, Rasa, Harga, Modal, Items)
  const handleMenuCreate = (req, res) => {
    try {
      const body = req.body || {};
      let titleId = body.title_id || body.titleId;
      const rawTitleName = (body.title_name || body.titleName || body.package_name || body.packageName || body.name || body.title || '').trim();
      if (!titleId && rawTitleName) {
        const resolvedTitle = service.createMenuTitle({ brandId: req.brand_id, name: rawTitleName });
        if (resolvedTitle) titleId = resolvedTitle.id;
      }

      const items = Array.isArray(body.items) ? body.items : (
        Array.isArray(body.components) ? body.components : (
          (body.product_id || body.productId) ? [{ product_id: body.product_id || body.productId, quantity: 1 }] : []
        )
      );

      const sellingPrice = body.selling_price !== undefined ? body.selling_price : (
        body.sellingPrice !== undefined ? body.sellingPrice : (
          body.price !== undefined ? body.price : (
            body.min_price !== undefined ? body.min_price : (
              body.minPrice !== undefined ? body.minPrice : 0
            )
          )
        )
      );

      const costPrice = body.cost_price !== undefined ? body.cost_price : (
        body.costPrice !== undefined ? body.costPrice : (
          body.cost !== undefined ? body.cost : 0
        )
      );

      const status = body.status || (
        body.is_active !== undefined ? (body.is_active ? 'ACTIVE' : 'DRAFT') : (
          body.isActive !== undefined ? (body.isActive ? 'ACTIVE' : 'DRAFT') : undefined
        )
      );

      const menu = service.createMenu({
        brandId: req.brand_id,
        packageName: body.package_name !== undefined ? body.package_name : (body.packageName !== undefined ? body.packageName : (body.title_name || body.titleName || rawTitleName || undefined)),
        categoryId: body.category_id || body.categoryId,
        titleId: titleId,
        rasaId: body.rasa_id !== undefined ? body.rasa_id : (body.rasaId !== undefined ? body.rasaId : null),
        description: body.description,
        spiceEnabled: body.spice_enabled !== undefined ? body.spice_enabled : (body.spiceEnabled !== undefined ? body.spiceEnabled : false),
        spiceLevel: body.spice_level !== undefined ? body.spice_level : (body.spiceLevel !== undefined ? body.spiceLevel : null),
        sellingPrice: sellingPrice,
        costPrice: costPrice,
        items,
        status: status
      });
      res.status(201).json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_CREATE_FAILED');
    }
  };

  // PUT /admin/menus/:id - Update canonical Menu
  const handleMenuUpdate = (req, res) => {
    try {
      const body = req.body || {};
      let titleId = body.title_id || body.titleId;
      const rawTitleName = (body.title_name || body.titleName || body.package_name || body.packageName || body.name || body.title || '').trim();
      if (!titleId && rawTitleName) {
        const resolvedTitle = service.createMenuTitle({ brandId: req.brand_id, name: rawTitleName });
        if (resolvedTitle) titleId = resolvedTitle.id;
      }

      const items = Array.isArray(body.items) ? body.items : (
        Array.isArray(body.components) ? body.components : (
          (body.product_id || body.productId) ? [{ product_id: body.product_id || body.productId, quantity: 1 }] : undefined
        )
      );

      const sellingPrice = body.selling_price !== undefined ? body.selling_price : (
        body.sellingPrice !== undefined ? body.sellingPrice : (
          body.price !== undefined ? body.price : (
            body.min_price !== undefined ? body.min_price : (
              body.minPrice !== undefined ? body.minPrice : undefined
            )
          )
        )
      );

      const costPrice = body.cost_price !== undefined ? body.cost_price : (
        body.costPrice !== undefined ? body.costPrice : (
          body.cost !== undefined ? body.cost : undefined
        )
      );

      const status = body.status || (
        body.is_active !== undefined ? (body.is_active ? 'ACTIVE' : 'DRAFT') : (
          body.isActive !== undefined ? (body.isActive ? 'ACTIVE' : 'DRAFT') : undefined
        )
      );

      const menu = service.updateMenu({
        brandId: req.brand_id,
        menuId: req.params.id,
        packageName: body.package_name !== undefined ? body.package_name : (body.packageName !== undefined ? body.packageName : (body.title_name || body.titleName || (rawTitleName ? rawTitleName : undefined))),
        categoryId: body.category_id || body.categoryId,
        titleId: titleId,
        rasaId: body.rasa_id !== undefined ? body.rasa_id : (body.rasaId !== undefined ? body.rasaId : undefined),
        description: body.description,
        spiceEnabled: body.spice_enabled !== undefined ? body.spice_enabled : (body.spiceEnabled !== undefined ? body.spiceEnabled : undefined),
        spiceLevel: body.spice_level !== undefined ? body.spice_level : (body.spiceLevel !== undefined ? body.spiceLevel : undefined),
        sellingPrice: sellingPrice,
        costPrice: costPrice,
        items,
        status: status
      });
      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_UPDATE_FAILED');
    }
  };

  const handleMenuStatusUpdate = (req, res) => {
    try {
      const menu = service.setMenuStatus({
        brandId: req.brand_id,
        menuId: req.params.id,
        status: req.body && req.body.status
      });
      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_STATUS_UPDATE_FAILED');
    }
  };

  const handleMenuDelete = (req, res) => {
    try {
      const result = service.deleteMenu({
        brandId: req.brand_id,
        menuId: req.params.id
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_DELETE_FAILED');
    }
  };

  const handleMenuReorder = (req, res) => {
    try {
      const order = req.body && req.body.order;
      const categoryId = req.body && (req.body.category_id || req.body.categoryId) || null;
      const menus = service.reorderMenus({
        brandId: req.brand_id,
        categoryId,
        order
      });
      res.json({
        success: true,
        message: 'Urutan menu berhasil disimpan.',
        menus
      });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_REORDER_FAILED');
    }
  };

  ['/admin/menus', '/admin/master-menus', '/admin/composed/menus'].forEach(routePath => {
    router.get(routePath, requireAuth(ownerRoles), handleMenuList);
    router.post(routePath, requireAuth(ownerRoles), handleMenuCreate);
  });

  ['/admin/menus/reorder', '/admin/master-menus/reorder', '/admin/composed/menus/reorder'].forEach(routePath => {
    router.put(routePath, requireAuth(ownerRoles), handleMenuReorder);
  });

  ['/admin/menus/:id', '/admin/master-menus/:id', '/admin/composed/menus/:id'].forEach(routePath => {
    router.get(routePath, requireAuth(ownerRoles), handleMenuRead);
    router.put(routePath, requireAuth(ownerRoles), handleMenuUpdate);
    router.delete(routePath, requireAuth(ownerRoles), handleMenuDelete);
  });

  ['/admin/menus/:id/status', '/admin/master-menus/:id/status', '/admin/composed/menus/:id/status'].forEach(routePath => {
    router.patch(routePath, requireAuth(ownerRoles), handleMenuStatusUpdate);
  });

  router.post('/admin/menus/single', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.createSingleMenu({
        brandId: req.brand_id,
        productId: body.product_id,
        subCategoryId: body.sub_category_id,
        rasaId: body.rasa_id,
        levelId: body.level_id,
        sellingPrice: body.selling_price,
        costPrice: body.cost_price,
        status: body.status
      });
      res.status(201).json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_SINGLE_MENU_CREATE_FAILED');
    }
  });

  router.put('/admin/menus/:id/single', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.updateSingleMenu({
        brandId: req.brand_id,
        menuId: req.params.id,
        productId: body.product_id,
        subCategoryId: body.sub_category_id,
        rasaId: body.rasa_id,
        levelId: body.level_id,
        sellingPrice: body.selling_price,
        costPrice: body.cost_price,
        status: body.status
      });
      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_SINGLE_MENU_UPDATE_FAILED');
    }
  });

  router.post('/admin/menus/package', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.createPackageMenu({
        brandId: req.brand_id,
        packageName: body.package_name,
        sellingPrice: body.selling_price,
        costPrice: body.cost_price,
        subCategoryId: body.sub_category_id,
        rasaId: body.rasa_id,
        levelId: body.level_id,
        components: body.components,
        status: body.status
      });
      res.status(201).json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PACKAGE_MENU_CREATE_FAILED');
    }
  });

  router.put('/admin/menus/:id/package', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.updatePackageMenu({
        brandId: req.brand_id,
        menuId: req.params.id,
        packageName: body.package_name,
        sellingPrice: body.selling_price,
        costPrice: body.cost_price,
        subCategoryId: body.sub_category_id,
        rasaId: body.rasa_id,
        levelId: body.level_id,
        components: body.components,
        status: body.status
      });
      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PACKAGE_MENU_UPDATE_FAILED');
    }
  });



  router.post('/admin/menus/:id/adopt', requireAuth(menuAdoptionRoles), (req, res) => {
    try {
      const body = req.body || {};
      const branchId = body.branch_id;
      if (!branchId) return res.status(400).json({ success: false, error: 'BRANCH_CONTEXT_REQUIRED' });

      if (req.user && req.user.role === 'branch_manager') {
        const assignedBranchId = req.user.branchId || req.user.branch_id;
        if (assignedBranchId && String(assignedBranchId) !== String(branchId)) {
          return res.status(403).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
          });
        }
      }

      const result = service.adoptMenuToBranch({
        brandId: req.brand_id,
        branchId,
        menuId: req.params.id,
        isAvailable: body.is_available === undefined ? true : body.is_available,
        priceOverride: body.price_override,
        branchCategoryIds: body.branch_category_ids
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_ADOPTION_FAILED');
    }
  });

  router.patch('/admin/menus/:id/availability', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
    try {
      const branchId = req.body && req.body.branch_id;
      if (!branchId) return res.status(400).json({ success: false, error: 'BRANCH_CONTEXT_REQUIRED' });

      if (req.user && req.user.role === 'branch_manager') {
        const assignedBranchId = req.user.branchId || req.user.branch_id;
        if (assignedBranchId && assignedBranchId !== branchId) {
          return res.status(403).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
          });
        }
      }

      const raw = req.body && req.body.is_available;
      if (raw !== true && raw !== false && Number(raw) !== 0 && Number(raw) !== 1) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_AVAILABILITY',
          message: 'is_available harus berupa true/false atau 0/1.'
        });
      }

      const branch = deps.db
        ? deps.db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branchId, req.brand_id)
        : null;
      if (!branch) return res.status(404).json({ success: false, error: 'BRANCH_NOT_FOUND' });

      const branchMenu = service.setBranchMenuAvailability({
        brandId: req.brand_id,
        branchId,
        menuId: req.params.id,
        isAvailable: raw === true || Number(raw) === 1
      });

      res.json({ success: true, branch_menu: branchMenu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_BRANCH_MENU_AVAILABILITY_UPDATE_FAILED');
    }
  });

  router.get('/admin/sub-categories', requireAuth(ownerRoles), (req, res) => {
    try {
      const categoryId = req.query && req.query.category_id ? req.query.category_id : null;
      const activeOnly = req.query && (req.query.active_only === '1' || req.query.active_only === 'true');
      res.json({
        success: true,
        sub_categories: service.listSubCategories({
          brandId: req.brand_id,
          categoryId,
          activeOnly
        })
      });
    } catch (err) {
      sendError(res, err, 'SUB_CATEGORY_LIST_FAILED');
    }
  });

  router.put('/admin/sub-categories/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const result = service.updateSubCategory({
        brandId: req.brand_id,
        subCategoryId: req.params.id,
        name: body.name,
        categoryId: body.category_id,
        slug: body.slug,
        isActive: body.is_active
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'SUB_CATEGORY_UPDATE_FAILED');
    }
  });

  router.delete('/admin/sub-categories/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const result = service.deleteSubCategory({
        brandId: req.brand_id,
        subCategoryId: req.params.id
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'SUB_CATEGORY_DELETE_FAILED');
    }
  });

  router.post('/admin/sub-categories', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const subCategory = service.createSubCategory({
        brandId: req.brand_id,
        categoryId: body.category_id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order
      });
      res.status(201).json({ success: true, sub_category: subCategory });
    } catch (err) {
      sendError(res, err, 'SUB_CATEGORY_CREATE_FAILED');
    }
  });

  router.get('/admin/rasas', requireAuth(ownerRoles), (req, res) => {
    try {
      const activeOnly = req.query && (req.query.active_only === '1' || req.query.active_only === 'true');
      res.json({
        success: true,
        rasas: service.listRasas({
          brandId: req.brand_id,
          activeOnly
        })
      });
    } catch (err) {
      sendError(res, err, 'RASA_LIST_FAILED');
    }
  });

  router.put('/admin/rasas/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const result = service.updateRasa({
        brandId: req.brand_id,
        rasaId: req.params.id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order,
        isActive: body.is_active
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'RASA_UPDATE_FAILED');
    }
  });

  router.delete('/admin/rasas/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const result = service.deleteRasa({
        brandId: req.brand_id,
        rasaId: req.params.id
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'RASA_DELETE_FAILED');
    }
  });

  // ── Judul (menu_titles) — master judul customer ────────────────────────────
  // Contract v1: Sub Category dipensiunkan; Judul menggantikannya sebagai judul customer.
  // Pola endpoint sengaja sama dengan /admin/rasas supaya editor Menu dan tab
  // Master Category memakai satu pola yang sudah ada.

  router.get('/admin/menu-titles', requireAuth(ownerRoles), (req, res) => {
    try {
      const activeOnly = req.query && (req.query.active_only === '1' || req.query.active_only === 'true');
      res.json({
        success: true,
        titles: service.listMenuTitles({ brandId: req.brand_id, activeOnly })
      });
    } catch (err) {
      sendError(res, err, 'TITLE_LIST_FAILED');
    }
  });

  router.post('/admin/menu-titles', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const title = service.createMenuTitle({
        brandId: req.brand_id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order
      });
      res.status(201).json({ success: true, title });
    } catch (err) {
      sendError(res, err, 'TITLE_CREATE_FAILED');
    }
  });

  router.put('/admin/menu-titles/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const title = service.updateMenuTitle({
        brandId: req.brand_id,
        titleId: req.params.id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order,
        isActive: body.is_active
      });
      res.json({ success: true, title });
    } catch (err) {
      sendError(res, err, 'TITLE_UPDATE_FAILED');
    }
  });

  router.delete('/admin/menu-titles/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const result = service.deleteMenuTitle({
        brandId: req.brand_id,
        titleId: req.params.id
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'TITLE_DELETE_FAILED');
    }
  });

  router.post('/admin/rasas', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const rasa = service.createRasa({
        brandId: req.brand_id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order
      });
      res.status(201).json({ success: true, rasa });
    } catch (err) {
      sendError(res, err, 'RASA_CREATE_FAILED');
    }
  });

  router.put('/admin/products/:id/sku', requireAuth(ownerRoles), (req, res) => {
    try {
      const product = service.setProductSku({
        brandId: req.brand_id,
        productId: req.params.id,
        sku: req.body && req.body.sku,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'PRODUCT_SKU_UPDATE_FAILED');
    }
  });

  router.get('/catalog/branch-menu', (req, res) => {
    try {
      const branchId = req.query && req.query.branch_id;
      const includeUnavailable = req.query && (req.query.include_unavailable === '1' || req.query.include_unavailable === 'true');
      const menus = resolver.resolveBranchMenu({
        brandId: req.brand_id,
        branchId,
        includeUnavailable
      });
      res.json({ success: true, menus });
    } catch (err) {
      sendError(res, err, 'COMPOSED_BRANCH_MENU_READ_FAILED');
    }
  });

  router.get('/catalog/branch-menu/search', (req, res) => {
    try {
      const branchId = req.query && req.query.branch_id;
      const query = req.query && req.query.q;
      const menus = resolver.searchBranchMenu({
        brandId: req.brand_id,
        branchId,
        query
      });
      res.json({ success: true, menus });
    } catch (err) {
      sendError(res, err, 'COMPOSED_BRANCH_MENU_SEARCH_FAILED');
    }
  });
}

module.exports = registerAdminComposedMenuRoutes;
