'use strict';

const {
  ComposedMenuService,
  ComposedMenuResolver
} = require('../../domains/catalog');

function statusForError(message) {
  switch (message) {
    case 'MENU_SATUAN_ALREADY_EXISTS':
    case 'SUB_CATEGORY_ALREADY_EXISTS':
    case 'RASA_ALREADY_EXISTS':
    case 'PRODUCT_SKU_ALREADY_EXISTS':
      return 409;
    case 'MENU_NOT_FOUND':
    case 'MASTER_PRODUCT_NOT_FOUND':
    case 'CATEGORY_NOT_FOUND':
    case 'SUB_CATEGORY_NOT_FOUND':
    case 'RASA_NOT_FOUND':
    case 'LEVEL_NOT_FOUND':
    case 'BRANCH_NOT_FOUND':
    case 'BRANCH_CATEGORY_NOT_FOUND':
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
  const service = deps.service || ComposedMenuService;
  const resolver = deps.resolver || ComposedMenuResolver;
  const ownerRoles = ['owner', 'brand_manager'];

  router.get('/admin/menus', requireAuth(ownerRoles), (req, res) => {
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
  });

  router.get('/admin/menus/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const menu = resolver.resolveMenu({
        brandId: req.brand_id,
        menuId: req.params.id
      });
      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_READ_FAILED');
    }
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
        status: body.status
      });
      res.status(201).json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_SINGLE_MENU_CREATE_FAILED');
    }
  });

  router.post('/admin/menus/package', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.createPackageMenu({
        brandId: req.brand_id,
        packageName: body.package_name,
        sellingPrice: body.selling_price,
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

  router.patch('/admin/menus/:id/status', requireAuth(ownerRoles), (req, res) => {
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
  });

  router.post('/admin/menus/:id/adopt', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const result = service.adoptMenuToBranch({
        brandId: req.brand_id,
        branchId: body.branch_id,
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
        sku: req.body && req.body.sku
      });
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'PRODUCT_SKU_UPDATE_FAILED');
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
