'use strict';

const crypto = require('crypto');
const ComposedMenuRepository = require('../repositories/ComposedMenuRepository');

const repository = new ComposedMenuRepository();

function makeId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '');
}

function normalizeName(value, code) {
  const name = String(value == null ? '' : value).trim();
  if (!name) throw new Error(code || 'NAME_REQUIRED');
  if (name.length > 255) throw new Error('NAME_TOO_LONG');
  return name;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizePrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) throw new Error('MENU_PRICE_INVALID');
  return price;
}

function normalizeStatus(value) {
  const status = String(value || 'DRAFT').trim().toUpperCase();
  if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) {
    throw new Error('MENU_STATUS_INVALID');
  }
  return status;
}

function normalizeSku(value) {
  if (value === undefined || value === null) return null;
  const sku = String(value).trim();
  return sku ? sku : null;
}

function ensureSchema() {
  repository.ensureSchema();
}

function normalizeLevelId(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}

function normalizeRasaId(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}

function normalizeProductComponents(value) {
  if (!Array.isArray(value)) throw new Error('MENU_PACKAGE_COMPONENTS_REQUIRED');

  const components = value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error('MENU_PACKAGE_COMPONENT_INVALID');
    }

    const productId = String(item.product_id ?? item.productId ?? '').trim();
    if (!productId) throw new Error('MENU_PACKAGE_PRODUCT_REQUIRED');

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('MENU_PACKAGE_COMPONENT_QUANTITY_INVALID');
    }

    return { productId, quantity, inputIndex: index };
  });

  const seen = new Set();
  for (const component of components) {
    if (seen.has(component.productId)) {
      throw new Error('MENU_PACKAGE_DUPLICATE_PRODUCT');
    }
    seen.add(component.productId);
  }

  const totalUnits = components.reduce((sum, item) => sum + item.quantity, 0);
  if (totalUnits < 2) throw new Error('MENU_PACKAGE_MIN_TWO_UNITS');

  return components;
}

class ComposedMenuService {
  static setProductSku({
    brandId, productId, sku, actorId = null, actorRole = null
  }) {
    ensureSchema();
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const product = repository.findProductSku({ brandId, productId });
    if (!product) throw new Error('MASTER_PRODUCT_NOT_FOUND');

    const previousSku = product.sku == null ? null : String(product.sku).trim() || null;
    const normalized = normalizeSku(sku);

    // Removing stock identity is a governed operation. It is not allowed while any
    // active branch still has positive stock in either the new inventory table or
    // the legacy compatibility stock column.
    if (previousSku && !normalized) {
      const positiveStock = repository.db.queryOne(
        "SELECT 1 AS found FROM branches b " +
        "LEFT JOIN branch_product_inventory bpi ON bpi.branch_id = b.id AND bpi.product_id = ? " +
        "LEFT JOIN branch_products bp ON bp.branch_id = b.id AND bp.product_id = ? " +
        "WHERE b.brand_id = ? AND b.is_active = 1 " +
        "AND (COALESCE(bpi.stock_qty, 0) > 0 OR COALESCE(bp.stock, 0) > 0) LIMIT 1",
        [productId, productId, brandId]
      );
      if (positiveStock) throw new Error('PRODUCT_SKU_REMOVAL_BLOCKED_STOCK');
    }

    if (previousSku === normalized) return repository.findProductSku({ brandId, productId });

    repository.begin();
    try {
      repository.updateProductSku({
        brandId,
        productId,
        sku: normalized
      });
      repository.db.execute(
        "INSERT INTO product_sku_history (id, brand_id, product_id, previous_sku, new_sku, actor_id, actor_role) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [makeId('skuhist'), brandId, productId, previousSku, normalized, actorId, actorRole]
      );
      repository.commit();
    } catch (err) {
      try { repository.rollback(); } catch (_) {}
      if (/UNIQUE constraint failed/i.test(String(err && err.message))) {
        if (/idx_products_brand_sku_normalized/i.test(String(err && err.message))) {
          throw new Error('PRODUCT_SKU_ALREADY_EXISTS');
        }
      }
      if (/PRODUCT_SKU_EMPTY/i.test(String(err && err.message))) {
        throw new Error('PRODUCT_SKU_EMPTY');
      }
      throw err;
    }

    return repository.findProductSku({ brandId, productId });
  }

  static listTitles({ brandId, activeOnly = false }) { ensureSchema(); return repository.listTitles({ brandId, activeOnly }); }
  static createTitle({ brandId, name, slug = null, sortOrder = 0 }) {
    ensureSchema(); const normalized=normalizeName(name,'TITLE_REQUIRED');
    if(repository.findTitleByName({brandId,name:normalized})) throw new Error('TITLE_ALREADY_EXISTS');
    const id=makeId('title'); repository.createTitle({id,brandId,name:normalized,slug:slug||slugify(normalized),sortOrder});
    return repository.findTitle({brandId,titleId:id});
  }
  static updateTitle({ brandId,titleId,name,slug,sortOrder,isActive }) {
    ensureSchema(); const current=repository.findTitle({brandId,titleId}); if(!current) throw new Error('TITLE_NOT_FOUND');
    const fields=[]; const params=[];
    if(name!==undefined){const n=normalizeName(name,'TITLE_REQUIRED');const d=repository.findTitleByName({brandId,name:n});if(d&&String(d.id)!==String(titleId))throw new Error('TITLE_ALREADY_EXISTS');fields.push('name=?');params.push(n);}
    if(slug!==undefined||name!==undefined){fields.push('slug=?');params.push(slugify(slug||name||current.name));}
    if(sortOrder!==undefined){fields.push('sort_order=?');params.push(Number(sortOrder)||0);}
    if(isActive!==undefined){fields.push('is_active=?');params.push(isActive?1:0);}
    if(fields.length){params.push(titleId,brandId);repository.db.execute("UPDATE menu_titles SET "+fields.join(', ')+", updated_at=datetime('now') WHERE id=? AND brand_id=?",params);}
    return repository.findTitle({brandId,titleId});
  }
  static deleteTitle({brandId,titleId}) {
    ensureSchema(); if(!repository.findTitle({brandId,titleId}))throw new Error('TITLE_NOT_FOUND');
    if(repository.db.queryOne("SELECT id FROM menus WHERE brand_id=? AND title_id=? LIMIT 1",[brandId,titleId]))throw new Error('TITLE_IN_USE');
    repository.db.execute("UPDATE menu_titles SET is_active=0, updated_at=datetime('now') WHERE id=? AND brand_id=?",[titleId,brandId]); return {id:titleId,is_active:0};
  }
  static listRasas({brandId,activeOnly=false}){ensureSchema();return repository.listRasas({brandId,activeOnly});}
  static createRasa({brandId,name,slug=null,sortOrder=0}){ensureSchema();const n=normalizeName(name,'RASA_NAME_REQUIRED');if(repository.findRasaByName({brandId,name:n}))throw new Error('RASA_ALREADY_EXISTS');const id=makeId('rasa');repository.createRasa({id,brandId,name:n,slug:slug||slugify(n),sortOrder});return repository.findRasa({brandId,rasaId:id});}
  static updateRasa({brandId,rasaId,name,slug,sortOrder,isActive}){ensureSchema();const cur=repository.findRasa({brandId,rasaId});if(!cur)throw new Error('RASA_NOT_FOUND');const f=[];const p=[];if(name!==undefined){const n=normalizeName(name,'RASA_NAME_REQUIRED');const d=repository.findRasaByName({brandId,name:n});if(d&&String(d.id)!==String(rasaId))throw new Error('RASA_ALREADY_EXISTS');f.push('name=?');p.push(n);}if(slug!==undefined||name!==undefined){f.push('slug=?');p.push(slugify(slug||name||cur.name));}if(sortOrder!==undefined){f.push('sort_order=?');p.push(Number(sortOrder)||0);}if(isActive!==undefined){f.push('is_active=?');p.push(isActive?1:0);}if(f.length){p.push(rasaId,brandId);repository.db.execute("UPDATE menu_flavors SET "+f.join(', ')+", updated_at=datetime('now') WHERE id=? AND brand_id=?",p);}return repository.findRasa({brandId,rasaId});}
  static deleteRasa({brandId,rasaId}){ensureSchema();if(!repository.findRasa({brandId,rasaId}))throw new Error('RASA_NOT_FOUND');if(repository.db.queryOne("SELECT id FROM menus WHERE brand_id=? AND rasa_id=? LIMIT 1",[brandId,rasaId]))throw new Error('RASA_IN_USE');repository.db.execute("UPDATE menu_flavors SET is_active=0,updated_at=datetime('now') WHERE id=? AND brand_id=?",[rasaId,brandId]);return{id:rasaId,is_active:0};}
  static createMenu({brandId,categoryId,titleId,rasaId=null,levelId=null,sellingPrice,status='DRAFT',components=[]}){ensureSchema();if(!repository.findCategory({brandId,categoryId}))throw new Error('CATEGORY_NOT_FOUND');if(!repository.findTitle({brandId,titleId}))throw new Error('TITLE_NOT_FOUND');const r=normalizeRasaId(rasaId);if(r&&!repository.findRasa({brandId,rasaId:r}))throw new Error('RASA_NOT_FOUND');const l=normalizeLevelId(levelId);if(l&&!repository.findLevel({brandId,levelId:l}))throw new Error('LEVEL_NOT_FOUND');if(repository.findMenuByIdentity({brandId,categoryId,titleId,rasaId:r}))throw new Error('MENU_ALREADY_EXISTS');const items=normalizeProductComponents(components);if(!items.length)throw new Error('MENU_PRODUCT_REQUIRED');const id=makeId('menu');const rasaRow=r?repository.findRasa({brandId,rasaId:r}):null; const displayName=title.name+(rasaRow&&String(rasaRow.name).toLowerCase()!=='original'?' '+rasaRow.name:''); repository.createMenu({id,brandId,categoryId,titleId,rasaId:r,levelId:l,sellingPrice:normalizePrice(sellingPrice),status:normalizeStatus(status),displayName});repository.replaceMenuItems({menuId:id,items});return repository.findMenu({brandId,menuId:id});}
  static updateMenu({brandId,menuId,categoryId,titleId,rasaId,levelId,sellingPrice,status,components}){ensureSchema();const cur=repository.findMenu({brandId,menuId});if(!cur)throw new Error('MENU_NOT_FOUND');const c=categoryId===undefined?cur.category_id:categoryId;const t=titleId===undefined?cur.title_id:titleId;const r=rasaId===undefined?cur.rasa_id:normalizeRasaId(rasaId);const l=levelId===undefined?cur.level_id:normalizeLevelId(levelId);if(!repository.findCategory({brandId,categoryId:c}))throw new Error('CATEGORY_NOT_FOUND');if(!repository.findTitle({brandId,titleId:t}))throw new Error('TITLE_NOT_FOUND');if(r&&!repository.findRasa({brandId,rasaId:r}))throw new Error('RASA_NOT_FOUND');if(l&&!repository.findLevel({brandId,levelId:l}))throw new Error('LEVEL_NOT_FOUND');const d=repository.findMenuByIdentity({brandId,categoryId:c,titleId:t,rasaId:r});if(d&&String(d.id)!==String(menuId))throw new Error('MENU_ALREADY_EXISTS');repository.updateMenu({brandId,menuId,fields:{category_id:c,title_id:t,rasa_id:r,level_id:l,selling_price:sellingPrice===undefined?cur.selling_price:normalizePrice(sellingPrice),status:status===undefined?cur.status:normalizeStatus(status)}});if(components!==undefined)repository.replaceMenuItems({menuId,items:normalizeProductComponents(components)});return repository.findMenu({brandId,menuId});}
  static setMenuStatus({brandId,menuId,status}){return this.updateMenu({brandId,menuId,status});}
  static listMenus({brandId,status=null}){ensureSchema();return repository.listMenus({brandId,status});}
  static adoptMenuToBranch({brandId,branchId,menuId,isAvailable=true,priceOverride=null,branchCategoryIds=[]}){ensureSchema();if(!repository.findMenu({brandId,menuId}))throw new Error('MENU_NOT_FOUND');repository.upsertBranchMenu({brandId,branchId,menuId,isAvailable,priceOverride});if(branchCategoryIds)repository.replaceBranchMenuCategories({brandId,branchId,menuId,branchCategoryIds});return{menu:repository.findMenu({brandId,menuId}),branch_menu:repository.findBranchMenu({brandId,branchId,menuId}),branch_categories:repository.listBranchMenuCategoryMemberships({brandId,branchId,menuId})};}
  static setBranchMenuDisplayName({brandId,branchId,menuId,displayNameOverride}){ensureSchema();return repository.setBranchMenuDisplayName({brandId,branchId,menuId,displayNameOverride});}
  static removeMenuFromBranch({brandId,branchId,menuId}){ensureSchema();return repository.removeBranchMenu({brandId,branchId,menuId});}
  static setBranchMenuAvailability({brandId,branchId,menuId,isAvailable}){ensureSchema();return repository.setBranchMenuAvailability({brandId,branchId,menuId,isAvailable});}

}

module.exports = ComposedMenuService;
