'use strict';

const MasterMenuCompositionService = require('../../domains/catalog/services/MasterMenuCompositionService');

function errorStatus(message) {
  if (!message) return 400;
  if (message === 'MASTER_PRODUCT_NOT_FOUND' || message === 'MENU_COMPONENT_NOT_FOUND') return 404;
  if (message === 'MENU_COMPONENT_ALREADY_EXISTS') return 409;
  if (message === 'MENU_COMPONENT_IN_USE') return 409;
  return 400;
}

function registerAdminMenuCompositionRoutes(router, deps = {}) {
  const requireAuth = deps.requireAuth;
  const service = deps.service || MasterMenuCompositionService;
  const roles = ['owner', 'brand_manager'];

  router.get('/admin/menu/components/:type', requireAuth(roles), (req, res) => {
    try {
      const type = service.validateType(req.params.type);
      const activeOnly = req.query && (req.query.active_only === '1' || req.query.active_only === 'true');
      const components = service.listComponents({
        brandId: req.brand_id,
        type,
        activeOnly
      });
      res.json({ success: true, type, components });
    } catch (err) {
      res.status(errorStatus(err && err.message)).json({
        success: false,
        error: err && err.message ? err.message : 'MASTER_MENU_COMPONENT_READ_FAILED'
      });
    }
  });

  router.post('/admin/menu/components/:type', requireAuth(roles), (req, res) => {
    try {
      const type = service.validateType(req.params.type);
      const component = service.createComponent({
        brandId: req.brand_id,
        type,
        name: req.body && req.body.name,
        slug: req.body && req.body.slug,
        sortOrder: req.body && req.body.sort_order
      });
      res.status(201).json({ success: true, type, component });
    } catch (err) {
      res.status(errorStatus(err && err.message)).json({
        success: false,
        error: err && err.message ? err.message : 'MASTER_MENU_COMPONENT_CREATE_FAILED'
      });
    }
  });

  router.put('/admin/menu/components/:type/:id', requireAuth(roles), (req, res) => {
    try {
      const type = service.validateType(req.params.type);
      const component = service.updateComponent({
        brandId: req.brand_id,
        type,
        componentId: req.params.id,
        name: req.body && req.body.name,
        slug: req.body && req.body.slug,
        sortOrder: req.body && req.body.sort_order,
        isActive: req.body && req.body.is_active
      });
      res.json({ success: true, type, component });
    } catch (err) {
      res.status(errorStatus(err && err.message)).json({
        success: false,
        error: err && err.message ? err.message : 'MASTER_MENU_COMPONENT_UPDATE_FAILED'
      });
    }
  });

  router.patch('/admin/menu/components/:type/:id/toggle', requireAuth(roles), (req, res) => {
    try {
      const type = service.validateType(req.params.type);
      const component = service.toggleComponent({
        brandId: req.brand_id,
        type,
        componentId: req.params.id
      });
      res.json({ success: true, type, component });
    } catch (err) {
      res.status(errorStatus(err && err.message)).json({
        success: false,
        error: err && err.message ? err.message : 'MASTER_MENU_COMPONENT_TOGGLE_FAILED'
      });
    }
  });

  router.get('/admin/products/:id/composition', requireAuth(roles), (req, res) => {
    try {
      const composition = service.getComposition({
        brandId: req.brand_id,
        productId: req.params.id
      });
      res.json({ success: true, composition });
    } catch (err) {
      res.status(errorStatus(err && err.message)).json({
        success: false,
        error: err && err.message ? err.message : 'MASTER_MENU_COMPOSITION_READ_FAILED'
      });
    }
  });

  router.put('/admin/products/:id/composition', requireAuth(roles), (req, res) => {
    try {
      const composition = service.saveComposition({
        brandId: req.brand_id,
        productId: req.params.id,
        categoryId: req.body && req.body.category_id,
        flavorId: req.body && req.body.flavor_id,
        complementIds: req.body && req.body.complement_ids,
        levelId: req.body && req.body.level_id
      });
      res.json({ success: true, composition });
    } catch (err) {
      res.status(errorStatus(err && err.message)).json({
        success: false,
        error: err && err.message ? err.message : 'MASTER_MENU_COMPOSITION_SAVE_FAILED'
      });
    }
  });
}

module.exports = registerAdminMenuCompositionRoutes;
