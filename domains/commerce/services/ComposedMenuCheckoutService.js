'use strict';

const ComposedMenuRepository = require('../../catalog/repositories/ComposedMenuRepository');
const ComposedMenuResolver = require('../../catalog/services/ComposedMenuResolver');
const InventoryRepository = require('../../core/data/repositories/InventoryRepository');

const repository = new ComposedMenuRepository();
const inventoryRepository = new InventoryRepository();

function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    ...item,
    menu_id: item && item.menu_id != null ? String(item.menu_id).trim() : ''
  }));
}

function assertQuantity(value) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('INVALID_MENU_QUANTITY');
  }
  return quantity;
}

function parseExpectedPrice(item) {
  if (item.expected_price === undefined || item.expected_price === null || item.expected_price === '') return null;
  const value = Number(item.expected_price);
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_EXPECTED_PRICE');
  return value;
}

function parseModifiers(item) {
  if (item.options === undefined && item.modifiers === undefined && item.modifiers_snapshot === undefined) return null;
  const raw = item.options !== undefined ? item.options : item.modifiers !== undefined ? item.modifiers : item.modifiers_snapshot;
  if (raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return null;
  throw new Error('CANONICAL_MENU_OPTIONS_NOT_MODELED');
}

function resolveMenu({ brandId, branchId, menuId }) {
  const menu = ComposedMenuResolver.resolveBranchMenu({
    brandId,
    branchId,
    menuIds: [menuId],
    includeUnavailable: true
  })[0];

  if (!menu) {
    throw new Error('MENU_NOT_FOUND_OR_NOT_ADOPTED');
  }

  return menu;
}

function buildRequirements(menus) {
  const requirements = new Map();

  for (const entry of menus) {
    for (const component of entry.menu.components || []) {
      const quantity = Number(component.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error('MENU_COMPOSITION_INVALID');
      }

      const required = entry.quantity * quantity;
      const key = String(component.product_id);

      if (!requirements.has(key)) {
        requirements.set(key, {
          product_id: component.product_id,
          product_name: component.product_name,
          sku: component.sku || null,
          required_quantity: 0,
          menu_line_ids: []
        });
      }

      const target = requirements.get(key);
      target.required_quantity += required;
      target.menu_line_ids.push(entry.menu_id);
    }
  }

  return Array.from(requirements.values()).map(item => ({
    ...item,
    menu_line_ids: Array.from(new Set(item.menu_line_ids))
  }));
}

function getInventoryRequirements({ branchId, requirements }) {
  if (!requirements.length) return new Map();

  const productIds = requirements.map(item => item.product_id);
  const rows = inventoryRepository.findProductStockStatesByBranch({
    branchId,
    productIds
  });
  const inventoryMap = new Map(rows.map(row => [String(row.product_id), row]));

  return new Map(requirements.map(item => {
    const row = inventoryMap.get(String(item.product_id));
    const stockManaged = Boolean(item.sku);
    const currentStock = stockManaged ? Number(row ? row.stock : 0) : null;
    return [
      String(item.product_id),
      {
        ...item,
        stock_managed: stockManaged,
        current_stock: currentStock,
        low_stock_threshold: stockManaged
          ? Number(row && row.low_stock_threshold != null ? row.low_stock_threshold : 5)
          : null,
        stock_source: stockManaged ? (row ? row.stock_source : 'UNRECORDED') : 'NOT_STOCK_MANAGED'
      }
    ];
  }));
}

function verifyComposedCheckout({ brandId, branchId, items }) {
  if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
  if (!branchId) throw new Error('BRANCH_CONTEXT_REQUIRED');

  const normalizedItems = normalizeItems(items);
  if (!normalizedItems.length) {
    return {
      is_valid: false,
      status: 'EMPTY_CART',
      verified_items: [],
      price_diffs: [],
      errors: ['Keranjang pesanan kosong.']
    };
  }

  const canonicalCount = normalizedItems.filter(item => item.menu_id).length;
  if (canonicalCount !== normalizedItems.length) {
    return {
      is_valid: false,
      status: 'MIXED_MENU_MODELS',
      verified_items: [],
      price_diffs: [],
      errors: ['Checkout canonical Menu tidak boleh dicampur dengan item Product legacy.']
    };
  }

  const resolved = [];
  const priceDiffs = [];
  const errors = [];

  for (const item of normalizedItems) {
    try {
      const quantity = assertQuantity(item.quantity);
      parseModifiers(item);
      const menu = resolveMenu({ brandId, branchId, menuId: item.menu_id });
      const expectedPrice = parseExpectedPrice(item);

      if (!menu.is_available) {
        errors.push('MENU_UNAVAILABLE:' + item.menu_id);
        continue;
      }

      const unitPrice = Number(menu.price);
      const lineTotal = unitPrice * quantity;
      if (expectedPrice !== null && expectedPrice !== unitPrice && expectedPrice !== lineTotal) {
        priceDiffs.push({
          menu_id: item.menu_id,
          expected_price: expectedPrice,
          actual_price: unitPrice
        });
      }

      resolved.push({
        item,
        menu_id: item.menu_id,
        menu,
        quantity,
        expected_price: expectedPrice,
        subtotal: Number(menu.price) * quantity
      });
    } catch (err) {
      errors.push(err.message || 'MENU_VERIFICATION_FAILED');
    }
  }

  if (errors.length || priceDiffs.length) {
    return {
      is_valid: false,
      status: priceDiffs.length ? 'PRICE_CHANGED' : 'MENU_UNAVAILABLE',
      verified_items: [],
      price_diffs: priceDiffs,
      errors
    };
  }

  const requirements = buildRequirements(resolved);
  const inventoryMap = getInventoryRequirements({ branchId, requirements });
  const inventoryErrors = [];

  for (const requirement of inventoryMap.values()) {
    if (!requirement.stock_managed) continue;

    if (requirement.current_stock < requirement.required_quantity) {
      inventoryErrors.push(
        'OUT_OF_STOCK:' + requirement.product_id +
        ':available=' + requirement.current_stock +
        ':required=' + requirement.required_quantity
      );
    }
  }

  if (inventoryErrors.length) {
    return {
      is_valid: false,
      status: 'OUT_OF_STOCK',
      verified_items: [],
      price_diffs: [],
      errors: inventoryErrors
    };
  }

  const verifiedItems = resolved.map(entry => {
    const componentSnapshot = (entry.menu.components || []).map(component => ({
      product_id: component.product_id,
      product_name: component.product_name,
      sku: component.sku || null,
      quantity: Number(component.quantity),
      description: component.description || ''
    }));

    return {
      menu_id: entry.menu.menu_id,
      product_id: componentSnapshot[0] ? componentSnapshot[0].product_id : null,
      name: entry.menu.title,
      unit_price: Number(entry.menu.price),
      quantity: entry.quantity,
      subtotal: Number(entry.menu.price) * entry.quantity,
      note: itemNote(entry),
      notes: itemNote(entry),
      modifiers_snapshot: null,
      options: [],
      menu_snapshot: {
        menu_id: entry.menu.menu_id,
        menu_type: entry.menu.menu_type,
        title: entry.menu.title,
        subtitle: entry.menu.subtitle,
        price: Number(entry.menu.price),
        selling_price: Number(entry.menu.selling_price !== undefined ? entry.menu.selling_price : entry.menu.price),
        category: entry.menu.category,
        sub_category: entry.menu.sub_category,
        rasa: entry.menu.rasa,
        level: entry.menu.level,
        status: entry.menu.status
      },
      component_snapshot: componentSnapshot,
      inventory_components: componentSnapshot.map(component => {
        const requirement = inventoryMap.get(String(component.product_id));
        return {
          ...component,
          requested_quantity: entry.quantity * Number(component.quantity),
          current_stock: requirement && requirement.current_stock != null ? requirement.current_stock : null,
          low_stock_threshold: requirement && requirement.low_stock_threshold != null ? requirement.low_stock_threshold : null,
          stock_managed: Boolean(component.sku)
        };
      }),
      branch_low_stock_threshold: componentSnapshot.length === 1 && inventoryMap.get(String(componentSnapshot[0].product_id))
        ? inventoryMap.get(String(componentSnapshot[0].product_id)).low_stock_threshold
        : null,
      current_stock: componentSnapshot.length === 1 && inventoryMap.get(String(componentSnapshot[0].product_id))
        ? inventoryMap.get(String(componentSnapshot[0].product_id)).current_stock
        : null
    };
  });

  return {
    is_valid: true,
    status: 'VERIFIED',
    verified_items: verifiedItems,
    price_diffs: [],
    errors: [],
    inventory_requirements: Array.from(inventoryMap.values())
  };
}

function itemNote(entry) {
  return entry && entry.item && (entry.item.note || entry.item.notes)
    ? String(entry.item.note || entry.item.notes)
    : '';
}

module.exports = {
  verifyComposedCheckout,
  resolveMenu,
  buildRequirements
};
