'use strict';

/**
 * Canonical Promotion Reward Resolver.
 *
 * Reward ownership is commercial: a promotion targets a Menu. Inventory
 * fulfillment remains Product/SKU based through the Menu component snapshot.
 *
 * Legacy promotion rows may still carry target_product_id. That path is kept
 * strictly for compatibility and is never used as the canonical Menu identity.
 */
const PromotionRepository = require('../../../core/data/repositories/PromotionRepository');
const CatalogRepository = require('../../../core/data/repositories/CatalogRepository');
const ComposedMenuResolver = require('../../catalog/services/ComposedMenuResolver');

const promotionRepository = new PromotionRepository();
const catalogRepository = new CatalogRepository();

function canonicalComponentSnapshot(components) {
  return (Array.isArray(components) ? components : []).map(component => ({
    product_id: component.product_id,
    product_name: component.product_name || component.product_id,
    sku: component.sku || null,
    quantity: Number(component.quantity),
    description: component.description || '',
    image_url: component.image_url || '',
    media_id: component.media_id || null
  }));
}

function assertCanonicalMenu(menu) {
  if (!menu) throw new Error('REWARD_MENU_NOT_FOUND');
  if (String(menu.status || '').toUpperCase() !== 'ACTIVE') {
    throw new Error('REWARD_MENU_INACTIVE');
  }
  const components = Array.isArray(menu.components) ? menu.components : [];
  if (!components.length) throw new Error('REWARD_MENU_COMPOSITION_INVALID');
  if (components.some(component => component.product_is_active === false || component.product_is_active === 0)) {
    throw new Error('REWARD_MENU_COMPONENT_UNAVAILABLE');
  }
  if (menu.menu_type === 'SINGLE' && (
    components.length !== 1 || Number(components[0].quantity) !== 1
  )) {
    throw new Error('REWARD_MENU_COMPOSITION_INVALID');
  }
  if (menu.menu_type === 'PACKAGE') {
    const totalUnits = components.reduce((sum, component) => sum + Number(component.quantity || 0), 0);
    if (totalUnits < 2) throw new Error('REWARD_MENU_COMPOSITION_INVALID');
  }
}

class PromotionRewardResolver {
  static resolveConfiguredReward({ brandId, reward = {}, branchId = null }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const targetMenuId = reward.target_menu_id || reward.menu_id || null;
    if (targetMenuId) {
      return this.resolveMenuTarget({
        brandId,
        branchId,
        menuId: String(targetMenuId)
      });
    }

    const targetProductId = reward.target_product_id || reward.product_id || null;
    if (targetProductId) {
      return this.resolveLegacyProductTarget({
        brandId,
        branchId,
        productId: String(targetProductId)
      });
    }

    throw new Error('REWARD_TARGET_NOT_CONFIGURED');
  }

  static resolveMenuTarget({ brandId, branchId = null, menuId }) {
    let menu;

    if (branchId) {
      menu = (ComposedMenuResolver.resolveBranchMenu({
        brandId,
        branchId,
        menuIds: [menuId],
        includeUnavailable: true
      }) || [])[0] || null;

      if (!menu) throw new Error('BRANCH_MENU_NOT_ADOPTED');
      if (!menu.is_available) {
        const reason = String(menu.blocking_reason || 'BRANCH_MENU_UNAVAILABLE');
        if (reason === 'OUT_OF_STOCK') throw new Error('REWARD_OUT_OF_STOCK');
        if (reason === 'COMPONENT_UNAVAILABLE') throw new Error('REWARD_MENU_COMPONENT_UNAVAILABLE');
        if (reason === 'MENU_INACTIVE') throw new Error('REWARD_MENU_INACTIVE');
        if (reason === 'BRANCH_CATEGORY_UNAVAILABLE') throw new Error('REWARD_BRANCH_CATEGORY_UNAVAILABLE');
        if (reason === 'BRANCH_MENU_UNAVAILABLE') throw new Error('BRANCH_MENU_UNAVAILABLE');
        throw new Error(reason);
      }
    } else {
      menu = ComposedMenuResolver.resolveMenu({
        brandId,
        menuId
      });
    }

    assertCanonicalMenu(menu);

    const components = canonicalComponentSnapshot(menu.components);
    const primaryComponent = components[0] || null;

    return {
      source: 'menu',
      menu_id: menu.menu_id || menu.id,
      menu_type: menu.menu_type,
      product_id: menu.menu_type === 'SINGLE' && primaryComponent ? primaryComponent.product_id : null,
      name: menu.title || 'Hadiah Promo',
      image_url: menu.image_url || (primaryComponent && primaryComponent.image_url) || '',
      regular_price: Number(menu.price || 0),
      menu_snapshot: {
        schema_version: 'xentra-menu-reward-v1',
        captured_at: new Date().toISOString(),
        menu_id: menu.menu_id || menu.id,
        menu_type: menu.menu_type,
        title: menu.title || '',
        subtitle: menu.subtitle || null,
        price: Number(menu.price || 0),
        category: menu.category || null,
        sub_category: menu.sub_category || null,
        rasa: menu.rasa || null,
        level: menu.level || null
      },
      component_snapshot: components,
      inventory: menu.inventory || null
    };
  }

  static resolveLegacyProductTarget({ brandId, branchId, productId }) {
    const product = promotionRepository.findRewardCatalogProduct({
      productId,
      brandId
    });
    if (!product) throw new Error('REWARD_PRODUCT_NOT_FOUND');

    if (!branchId) {
      return {
        source: 'legacy_product',
        menu_id: null,
        menu_type: null,
        product_id: String(productId),
        name: product.name || 'Hadiah Promo',
        image_url: product.image_url || '',
        regular_price: Number(product.regular_price || product.price || 0),
        menu_snapshot: null,
        component_snapshot: null,
        inventory: null
      };
    }

    const branchProduct = catalogRepository.findRewardProduct(branchId, productId);
    if (!branchProduct) throw new Error('BRANCH_REWARD_PRODUCT_NOT_AVAILABLE');
    if (branchProduct.is_available === 0) throw new Error('BRANCH_REWARD_PRODUCT_UNAVAILABLE');

    const stock = branchProduct.stock == null ? null : Number(branchProduct.stock);
    if (stock !== null && stock < 1) throw new Error('REWARD_OUT_OF_STOCK');

    return {
      source: 'legacy_product',
      menu_id: null,
      menu_type: null,
      product_id: String(productId),
      name: branchProduct.name || product.name || 'Hadiah Promo',
      image_url: branchProduct.image_url || product.image_url || '',
      regular_price: Number(branchProduct.regular_price || branchProduct.price || product.regular_price || product.price || 0),
      menu_snapshot: null,
      component_snapshot: null,
      inventory: { stock_qty: stock }
    };
  }
}

module.exports = PromotionRewardResolver;
