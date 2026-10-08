'use strict';

const ComposedMenuRepository = require('../repositories/ComposedMenuRepository');

const repository = new ComposedMenuRepository();

function ensureSchema() {
  repository.ensureSchema();
}

function groupRows(rows, key) {
  const map = new Map();
  for (const row of rows || []) {
    const id = String(row[key]);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

function normalizeLevel(menu) {
  if (!menu.level_id) return null;
  const n = Number(menu.level_sort_order);
  return {
    id: menu.level_id,
    name: menu.level_name,
    slug: menu.level_slug,
    value: Number.isFinite(n) && n >= 1 ? Math.min(4, Math.floor(n)) : null
  };
}

function isOriginalRasa(name) {
  return String(name || '').trim().toLowerCase() === 'original';
}

function resolveCustomerTitle(menu) {
  const title = String(menu.title_name || '').trim();
  const rasa = String(menu.rasa_name || '').trim();
  if (!title) return null;
  if (!rasa || isOriginalRasa(rasa)) return title;
  return title + ' ' + rasa;
}

function resolveMenuBase(menu, branchState = null) {
  const level = normalizeLevel(menu);
  const rasaIsOriginal = isOriginalRasa(menu.rasa_name);
  const displayNameOverride = branchState && branchState.display_name_override
    ? String(branchState.display_name_override).trim()
    : null;

  const canonicalTitle = resolveCustomerTitle(menu);

  return {
    id: menu.id,
    menu_id: menu.id,
    title: canonicalTitle ? (displayNameOverride || canonicalTitle) : null,
    subtitle: menu.rasa_name && !rasaIsOriginal ? menu.rasa_name : null,
    price: Number(menu.selling_price),
    category: menu.category_id
      ? { id: menu.category_id, name: menu.category_name, slug: menu.category_slug }
      : null,
    title_master: menu.title_id
      ? { id: menu.title_id, name: menu.title_name, slug: menu.title_slug }
      : null,
    rasa: menu.rasa_id
      ? { id: menu.rasa_id, name: menu.rasa_name, slug: menu.rasa_slug }
      : null,
    level: level,
    status: menu.status,
    ...(branchState ? {
      display_name_override: displayNameOverride
    } : {})
  };
}

function calculateInventory(menuItems, inventoryRows, checkStock = true) {
  const inventoryMap = new Map(
    (inventoryRows || []).map(row => [String(row.product_id), row])
  );

  let allStockManagedComponents = true;
  let stockManagedComponentCount = 0;
  let packageCapacity = Infinity;
  let blocking = null;
  const normalizedItems = Array.isArray(menuItems) ? menuItems : [];

  if (normalizedItems.length === 0) {
    blocking = 'MENU_COMPOSITION_INVALID';
  }

  const totalUnits = normalizedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (normalizedItems.some(item => Number(item.quantity) <= 0)) {
    blocking = blocking || 'MENU_COMPOSITION_INVALID';
  }

  const items = normalizedItems.map(item => {
    const sku = item.sku == null ? null : String(item.sku).trim() || null;
    const stockManaged = !!sku;
    const inv = inventoryMap.get(String(item.product_id));
    const stockQty = stockManaged ? Number(inv ? inv.stock_qty : 0) : null;
    const quantity = Number(item.quantity);
    const capacity = stockManaged
      ? (checkStock ? Math.max(0, Math.floor(stockQty / quantity)) : null)
      : null;

    if (item.product_is_active === 0) {
      // Product lifecycle invalidity is distinct from temporary stock depletion.
      // It must win so the customer receives the repair-required reason rather
      // than a misleading OUT_OF_STOCK result.
      blocking = blocking || 'COMPONENT_UNAVAILABLE';
    }

    if (stockManaged) {
      stockManagedComponentCount += 1;
      packageCapacity = Math.min(packageCapacity, capacity);
      if (checkStock && capacity <= 0 && !blocking) blocking = 'OUT_OF_STOCK';
    } else {
      allStockManagedComponents = false;
    }

    return {
      product_id: item.product_id,
      product_name: item.product_name,
      sku,
      quantity,
      stock_managed: stockManaged,
      branch_stock: stockQty,
      package_capacity: capacity
    };
  });

  const stockAvailability = !checkStock || stockManagedComponentCount === 0
    ? true
    : packageCapacity > 0;

  return {
    components: items,
    stock_managed: allStockManagedComponents,
    available_quantity: stockManagedComponentCount === 0 ? null : packageCapacity,
    stock_available: stockAvailability,
    blocking_reason: blocking
  };
}

class ComposedMenuResolver {
  static resolveMenu({
    brandId, menuId
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const menu = repository.findMenu({ brandId, menuId });
    if (!menu) throw new Error('MENU_NOT_FOUND');

    const items = repository.listMenuItems({ brandId, menuIds: [menuId] });
    const base = resolveMenuBase(menu);
    if (!base.title) throw new Error('MENU_TITLE_UNAVAILABLE');

    return {
      ...base,
      components: items.map(item => ({
        product_id: item.product_id,
        product_name: item.product_name,
        product_slug: item.product_slug || null,
        sku: item.sku || null,
        quantity: Number(item.quantity),
        description: item.product_description || '',
        image_url: item.product_image_url || item.product_image || '',
        media_id: item.product_media_id || null,
        product_is_active: item.product_is_active !== 0
      }))
    };
  }

  static resolveMasterMenu({ brandId, menuIds = null }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');

    const menus = Array.isArray(menuIds)
      ? menuIds.map(String).filter(Boolean).map(id => repository.findMenu({ brandId, menuId: id })).filter(Boolean)
      : repository.listMenus({ brandId, status: 'ACTIVE' });

    if (!menus.length) return [];

    const normalizedIds = menus.map(menu => menu.id);
    const items = repository.listMenuItems({ brandId, menuIds: normalizedIds });
    const itemMap = groupRows(items, 'menu_id');

    return menus.map(menu => {
      const base = resolveMenuBase(menu);
      const menuItems = itemMap.get(String(menu.id)) || [];
      const inventoryState = calculateInventory(menuItems, [], false);
      const identityBlocking = base.title ? null : 'MENU_TITLE_UNAVAILABLE';
      const available = identityBlocking == null && inventoryState.blocking_reason == null && String(menu.status).toUpperCase() === 'ACTIVE';
      return {
        ...base,
        is_available: available,
        availability: available,
        blocking_reason: identityBlocking || inventoryState.blocking_reason,
        components: menuItems.map(item => ({
          product_id: item.product_id,
          product_name: item.product_name,
          product_slug: item.product_slug || null,
          sku: item.sku || null,
          quantity: Number(item.quantity),
          description: item.product_description || '',
          image_url: item.product_image_url || item.product_image || '',
          media_id: item.product_media_id || null,
          product_is_active: item.product_is_active !== 0
        }))
      };
    });
  }

  static resolveBranchMenu({
    brandId, branchId, menuIds = null, includeUnavailable = false
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (!branchId) throw new Error('BRANCH_CONTEXT_REQUIRED');

    const menus = Array.isArray(menuIds)
      ? menuIds.map(String).filter(Boolean).map(id => repository.findMenu({ brandId, menuId: id })).filter(Boolean)
      : repository.listMenus({ brandId, status: 'ACTIVE' });

    if (!menus.length) return [];

    const normalizedIds = menus.map(menu => menu.id);
    const items = repository.listMenuItems({ brandId, menuIds: normalizedIds });
    const itemMap = groupRows(items, 'menu_id');

    const branchMenus = normalizedIds
      .map(menuId => repository.findBranchMenu({ brandId, branchId, menuId }))
      .filter(Boolean);
    const branchMap = new Map(branchMenus.map(row => [String(row.menu_id), row]));
    const productIds = items.map(item => item.product_id);
    const inventory = repository.getInventory({ branchId, productIds });
    const memberships = repository.listBranchMenuCategoryMemberships({ brandId, branchId });
    const membershipMap = groupRows(memberships, 'menu_id');

    return menus.map(menu => {
      const branchState = branchMap.get(String(menu.id));
      if (!branchState) return null;

      const base = resolveMenuBase(menu, branchState);
      const price = branchState.price_override == null
        ? base.price
        : Number(branchState.price_override);

      const inventoryState = calculateInventory(itemMap.get(String(menu.id)) || [], inventory);

      const menuStatusValid = String(menu.status).toUpperCase() === 'ACTIVE';
      const categoryMemberships = membershipMap.get(String(menu.id)) || [];
      const activeBranchCategories = categoryMemberships.filter(row => row.branch_category_is_active !== 0);
      let blockingReason = null;
      if (!base.title) blockingReason = 'MENU_TITLE_UNAVAILABLE';
      else if (!branchState.is_available) blockingReason = 'BRANCH_MENU_UNAVAILABLE';
      else if (!menuStatusValid) blockingReason = 'MENU_INACTIVE';
      else if (categoryMemberships.length > 0 && activeBranchCategories.length === 0) blockingReason = 'BRANCH_CATEGORY_UNAVAILABLE';
      else if (inventoryState.blocking_reason) blockingReason = inventoryState.blocking_reason;

      const available = blockingReason == null;

      const result = {
        ...base,
        price,
        is_available: available,
        availability: available,
        blocking_reason: blockingReason,
        branch: {
          id: branchId
        },
        branch_categories: activeBranchCategories.map(row => ({
          id: row.branch_category_id,
          name: row.branch_category_name,
          slug: row.branch_category_slug
        })),
        components: (itemMap.get(String(menu.id)) || []).map(item => ({
          product_id: item.product_id,
          product_name: item.product_name,
          product_slug: item.product_slug || null,
          sku: item.sku || null,
          quantity: Number(item.quantity),
          description: item.product_description || '',
          image_url: item.product_image_url || item.product_image || '',
          media_id: item.product_media_id || null,
          product_is_active: item.product_is_active !== 0
        })),
        inventory: inventoryState
      };

      return includeUnavailable || available ? result : null;
    }).filter(Boolean);
  }

  static searchBranchMenu({
    brandId, branchId, query
  }) {
    ensureSchema();
    const needle = String(query == null ? '' : query).trim().toLocaleLowerCase();
    if (!needle) return this.resolveBranchMenu({ brandId, branchId });

    const menus = this.resolveBranchMenu({
      brandId,
      branchId,
      includeUnavailable: false
    });

    return menus.filter(menu => {
      const title = String(menu.title || '').toLocaleLowerCase();
      const subtitle = String(menu.subtitle || '').toLocaleLowerCase();
      return title.includes(needle) || subtitle.includes(needle);
    });
  }
}

module.exports = ComposedMenuResolver;