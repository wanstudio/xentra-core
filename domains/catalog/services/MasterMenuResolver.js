'use strict';

const { MasterMenuCompositionRepository } = require('../repositories/MasterMenuCompositionRepository');
const ProductOptionsModel = require('../models/ProductOptionsModel');

const repository = new MasterMenuCompositionRepository();

function asUniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean)));
}

function indexRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row.product_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function normalizeImage(product) {
  return product.image_url || product.image || '';
}

function resolveLevelIndicatorLevel(level) {
  if (!level) return null;

  var sortOrder = Number(level.sort_order);
  if (Number.isFinite(sortOrder) && sortOrder >= 1) {
    return Math.min(4, Math.floor(sortOrder));
  }

  // Backward compatibility for historical default Level rows that predate
  // sort_order population. The customer still receives a structured number;
  // the legacy name itself is never rendered.
  var match = String(level.name || '').match(/^\s*(\d+)/);
  if (match) return Math.min(4, Math.max(1, Number(match[1])));

  return null;
}

function resolveProductView({ product, flavor, complements, level, branchState = null, categories = [] }) {
  if (!product.category_id || !product.category_name || product.category_is_active === 0) return null;

  // Inactive Master components cannot be selected for new compositions, but
  // existing Product relations continue to resolve their historical display
  // value until the Owner explicitly changes that Product composition.
  const activeFlavor = flavor || null;
  const activeLevel = level || null;
  const activeComplements = complements || [];
  const branchAvailable = branchState ? branchState.is_available !== 0 : true;

  return {
    product_id: product.id,
    id: product.id,
    title: product.category_name,
    subtitle: activeFlavor ? activeFlavor.name : null,
    detail: activeComplements.map(c => c.name),
    indicator: activeLevel ? activeLevel.name : null,
    // Structured intensity value for Customer presentation. The legacy
    // indicator string remains in the DTO for compatibility with old consumers.
    indicator_level: resolveLevelIndicatorLevel(activeLevel),
    image: normalizeImage(product),
    image_url: normalizeImage(product),
    media_id: product.media_id || null,
    price: Number(product.price),
    master_price: Number(product.price),
    regular_price: product.regular_price != null ? Number(product.regular_price) : Number(product.price),
    sale_price: Number(product.price),
    pricing_mode: product.pricing_mode || 'lock',
    is_active: product.is_active !== 0,
    is_available: branchAvailable,
    stock_estimate: branchState && branchState.stock != null ? Number(branchState.stock) : null,
    low_stock_threshold: branchState && branchState.low_stock_threshold != null ? Number(branchState.low_stock_threshold) : null,
    availability: branchAvailable,
    categories: categories.map(c => ({ id: c.branch_category_id, name: c.name, slug: c.slug })),
    options: ProductOptionsModel.normalizeConfig(product.options_config),
    master: {
      name: product.name,
      slug: product.slug,
      description: product.description || '',
      category_id: product.category_id
    }
  };
}

class MasterMenuResolver {
  static resolveMasterMenu({ brandId }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const products = repository.listMasterProducts({ brandId, activeOnly: true });
    const resolved = this._composeProducts({ brandId, products });
    const orderedProducts = products.map(product => resolved.get(String(product.id)) || null).filter(Boolean);
    const categories = [];
    const seen = new Set();
    for (const product of orderedProducts) {
      const id = String(product.master.category_id);
      if (seen.has(id)) continue;
      seen.add(id);
      categories.push({
        id: id,
        name: product.title,
        slug: String(product.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        products: []
      });
    }
    const byCategory = new Map(categories.map(category => [String(category.id), category]));
    for (const product of orderedProducts) {
      const category = byCategory.get(String(product.master.category_id));
      if (category) category.products.push(product);
    }
    return { categories, products: orderedProducts };
  }

  static resolveMasterProducts({ brandId, productIds = [] }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const ids = asUniqueStrings(productIds);
    if (!ids.length) return [];
    const products = repository.findMasterProducts({ brandId, productIds: ids, activeOnly: true });
    const resolved = this._composeProducts({ brandId, products });
    return ids.map(id => resolved.get(String(id)) || null).filter(Boolean);
  }

  static resolveBranchMenu({ brandId, branchId, productIds = null, includeInactiveCategories = false }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (!branchId) throw new Error('BRANCH_CONTEXT_REQUIRED');

    const adopted = Array.isArray(productIds)
      ? asUniqueStrings(productIds)
      : this._listAdoptedProductIds(brandId, branchId);

    // Customer resolution only offers active Branch Categories. Management surfaces (Merchant
    // App Menu) ask for all of them so they can list the inactive ones in their own tab.
    const categories = repository.listBranchCategoriesForMenu({
      brandId,
      branchId,
      activeOnly: !includeInactiveCategories
    });

    if (!adopted.length) {
      return { categories, products: [] };
    }

    const productRows = repository.findMasterProducts({ brandId, productIds: adopted, activeOnly: true });
    const states = repository.findBranchProductStates({ brandId, branchId, productIds: adopted });
    const membershipRows = repository.findBranchProductCategoryMemberships({ branchId, productIds: adopted });
    const stateMap = new Map(states.map(row => [String(row.product_id), row]));

    // A deactivated Branch Category stops being offered, and so do the products grouped only
    // under inactive categories. A product with no Branch Category at all is not deactivated —
    // it is simply uncategorised — so it stays. Only the customer path drops products; the
    // management surfaces keep seeing everything.
    const isActiveMembership = row => !(row.is_active === 0 || row.is_active === false);
    const categorisedIds = new Set(membershipRows.map(row => String(row.product_id)));
    const activeCategorisedIds = new Set(membershipRows.filter(isActiveMembership).map(row => String(row.product_id)));
    const categoryMap = indexRows(membershipRows.filter(isActiveMembership));
    const resolved = this._composeProducts({ brandId, products: productRows, branchStates: stateMap, categoryMap });

    const productList = adopted.map(id => resolved.get(String(id)) || null).filter(Boolean).filter(item => stateMap.has(String(item.product_id))).filter(item => {
      if (includeInactiveCategories) return true;
      const id = String(item.product_id);
      if (!categorisedIds.has(id)) return true;
      return activeCategorisedIds.has(id);
    });
    return { categories, products: productList };
  }

  static _listAdoptedProductIds(brandId, branchId) {
    const rows = repository.db.queryMany(
      'SELECT bp.product_id FROM branch_products bp JOIN branches b ON b.id = bp.branch_id AND b.brand_id = ? WHERE bp.branch_id = ? ORDER BY bp.product_id ASC',
      [brandId, branchId]
    );
    return rows.map(row => row.product_id);
  }

  static _composeProducts({ brandId, products, branchStates = new Map(), categoryMap = new Map() }) {
    const productIds = products.map(p => p.id);
    if (!productIds.length) return new Map();
    const flavors = indexRows(repository.findProductFlavors({ brandId, productIds }));
    const complements = indexRows(repository.findProductComplements({ brandId, productIds }));
    const levels = indexRows(repository.findProductLevels({ brandId, productIds }));

    const map = new Map();
    for (const product of products) {
      const id = String(product.id);
      const view = resolveProductView({
        product,
        flavor: (flavors.get(id) || [])[0] || null,
        complements: complements.get(id) || [],
        level: (levels.get(id) || [])[0] || null,
        branchState: branchStates.get(id) || null,
        categories: categoryMap.get(id) || []
      });
      if (view) map.set(id, view);
    }
    return map;
  }
}

module.exports = MasterMenuResolver;
