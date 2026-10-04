'use strict';

const {
  ComposedProductService,
  ComposedMenuService,
  ComposedMenuResolver
} = require('../../domains/catalog');

function statusForError(message) {
  switch (message) {
    case 'MENU_ALREADY_EXISTS':
    case 'TITLE_ALREADY_EXISTS':
    case 'TITLE_IN_USE':
    case 'RASA_ALREADY_EXISTS':
    case 'RASA_IN_USE':
    case 'PRODUCT_SKU_ALREADY_EXISTS':
    case 'PRODUCT_SKU_REMOVAL_BLOCKED_STOCK':
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

  router.get('/admin/composed/products', requireAuth(ownerRoles), (req, res) => {
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
  });

  router.get('/admin/composed/products/:id', requireAuth(ownerRoles), (req, res) => {
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
  });

  router.post('/admin/composed/products', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const product = productService.createProduct({
        brandId: req.brand_id,
        name: body.name,
        sku: body.sku,
        description: body.description,
        imageUrl: body.image_url,
        image: body.image,
        isActive: body.is_active,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });
      res.status(201).json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_CREATE_FAILED');
    }
  });

  router.put('/admin/composed/products/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const product = productService.updateProduct({
        brandId: req.brand_id,
        productId: req.params.id,
        name: body.name,
        sku: body.sku,
        description: body.description,
        imageUrl: body.image_url,
        image: body.image,
        isActive: body.is_active,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_UPDATE_FAILED');
    }
  });

  router.patch('/admin/composed/products/:id/status', requireAuth(ownerRoles), (req, res) => {
    try {
      const product = productService.updateProduct({
        brandId: req.brand_id,
        productId: req.params.id,
        isActive: req.body && req.body.is_active,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_STATUS_UPDATE_FAILED');
    }
  });

  router.get('/admin/menus', requireAuth(ownerRoles), (req, res) => {
    try {
      const status = req.query && req.query.status ? String(req.query.status).trim().toUpperCase() : null;
      const menus = service.listMenus({
        brandId: req.brand_id,
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

  router.post('/admin/menus', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.createMenu({
        brandId: req.brand_id,
        categoryId: body.category_id,
        titleId: body.title_id,
        rasaId: body.rasa_id,
        levelId: null,
        spiceLevel: body.spice_level,
      spiceEnabled: body.spice_enabled === true,
        sellingPrice: body.selling_price,
        status: body.status,
        components: body.components
      });
      res.status(201).json({ success: true, menu });
    } catch (err) { sendError(res, err, 'COMPOSED_MENU_CREATE_FAILED'); }
  });

  router.put('/admin/menus/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.updateMenu({
        brandId: req.brand_id, menuId: req.params.id,
        categoryId: body.category_id, titleId: body.title_id, rasaId: body.rasa_id,
        levelId: null, spiceLevel: body.spice_level, sellingPrice: body.selling_price, status: body.status,
        components: body.components
      });
      res.json({ success: true, menu });
    } catch (err) { sendError(res, err, 'COMPOSED_MENU_UPDATE_FAILED'); }
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

  router.get('/admin/titles', requireAuth(ownerRoles), (req, res) => {
    try {
      const activeOnly = req.query && (req.query.active_only === '1' || req.query.active_only === 'true');
      res.json({ success: true, titles: service.listTitles({ brandId: req.brand_id, activeOnly }) });
    } catch (err) { sendError(res, err, 'TITLE_LIST_FAILED'); }
  });

  router.post('/admin/titles', requireAuth(ownerRoles), (req, res) => {
    try {
      const body=req.body||{};
      const title=service.createTitle({brandId:req.brand_id,name:body.name,slug:body.slug,sortOrder:body.sort_order});
      res.status(201).json({success:true,title});
    } catch(err){sendError(res,err,'TITLE_CREATE_FAILED');}
  });

  router.put('/admin/titles/:id', requireAuth(ownerRoles), (req,res)=>{
    try{
      const body=req.body||{};
      const title=service.updateTitle({brandId:req.brand_id,titleId:req.params.id,name:body.name,slug:body.slug,sortOrder:body.sort_order,isActive:body.is_active});
      res.json({success:true,title});
    }catch(err){sendError(res,err,'TITLE_UPDATE_FAILED');}
  });

  router.delete('/admin/titles/:id', requireAuth(ownerRoles), (req,res)=>{
    try{res.json({success:true,...service.deleteTitle({brandId:req.brand_id,titleId:req.params.id})});}
    catch(err){sendError(res,err,'TITLE_DELETE_FAILED');}
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
