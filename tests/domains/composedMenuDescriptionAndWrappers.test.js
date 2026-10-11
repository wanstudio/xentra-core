'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DataAccess = require('../../core/data/DataAccess');
const {
  ComposedMenuService,
  ComposedMenuResolver,
  ComposedProductService
} = require('../../domains/catalog');
const ComposedMenuRepository = require('../../domains/catalog/repositories/ComposedMenuRepository');

test('Menu Description Auto-Composition and Package/SubCat Service Contracts', async () => {
  const brandId = 'brand_bangjo';
  const repo = new ComposedMenuRepository(DataAccess);

  // Setup test products
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const p1 = ComposedProductService.createProduct({
    brandId,
    name: 'Ayam Tulang Lunak ' + suffix,
    sku: 'AYM-' + suffix,
    costPrice: 15000,
    inventoryType: 'COOKED'
  });
  const p2 = ComposedProductService.createProduct({
    brandId,
    name: 'Nasi Putih ' + suffix,
    sku: 'NASI-' + suffix,
    costPrice: 3000,
    inventoryType: 'COOKED'
  });
  const p3 = ComposedProductService.createProduct({
    brandId,
    name: 'Tempe Mendoan ' + suffix,
    sku: 'TMP-' + suffix,
    costPrice: 2000,
    inventoryType: 'COOKED'
  });

  let cat = repo.db.queryOne('SELECT id FROM categories WHERE brand_id = ? AND is_active = 1 LIMIT 1', [brandId]);
  if (!cat) {
    const catId = 'cat_' + suffix;
    repo.db.execute("INSERT INTO categories (id, brand_id, name, slug, is_active) VALUES (?, ?, ?, ?, 1)", [catId, brandId, 'Cat ' + suffix, 'cat-' + suffix]);
    cat = { id: catId, isTest: true };
  }
  assert.ok(cat, 'Active category should exist for test brand');

  const title1 = ComposedMenuService.createMenuTitle({
    brandId,
    name: 'Paket Hemat ' + suffix
  });
  assert.ok(title1);

  let createdMenu = null;
  let subCat = null;

  try {
    // 1. Auto-compose description when description parameter is omitted
    createdMenu = ComposedMenuService.createMenu({
      brandId,
      categoryId: cat.id,
      titleId: title1.id,
      sellingPrice: 25000,
      costPrice: 20000,
      status: 'DRAFT',
      items: [
        { productId: p1.id, quantity: 1 },
        { productId: p2.id, quantity: 1 },
        { productId: p3.id, quantity: 2 }
      ]
    });

    assert.ok(createdMenu);
    assert.equal(createdMenu.id.startsWith('menu_'), true);
    // Auto composed: "Ayam Tulang Lunak ... + Nasi Putih ... + 2x Tempe Mendoan ..."
    const expectedAutoDesc = `${p1.name} + ${p2.name} + 2x ${p3.name}`;
    assert.equal(createdMenu.description, expectedAutoDesc, 'Description should be auto-composed from items');

    // 2. ComposedMenuResolver resolves the menu including description
    const resolved = ComposedMenuResolver.resolveMenu({
      brandId,
      menuId: createdMenu.id
    });
    assert.ok(resolved);
    assert.equal(resolved.description, expectedAutoDesc, 'Resolver should expose description field');

    // 3. Explicitly update description
    const customDesc = 'Paket lezat komplit ayam, nasi, dan tempe';
    const updatedMenu = ComposedMenuService.updateMenu({
      brandId,
      menuId: createdMenu.id,
      description: customDesc
    });
    assert.equal(updatedMenu.description, customDesc, 'Custom description should be persisted');

    // 4. Test updatePackageMenu backward-compatible wrapper
    const pkgUpdated = ComposedMenuService.updatePackageMenu({
      brandId,
      menuId: createdMenu.id,
      packageName: 'Paket Super Hemat ' + suffix,
      sellingPrice: 28000,
      components: [
        { productId: p1.id, quantity: 2 },
        { productId: p2.id, quantity: 1 }
      ]
    });
    assert.ok(pkgUpdated);
    assert.equal(pkgUpdated.selling_price, 28000);

    // 5. Test Sub-Category endpoints / service methods
    subCat = ComposedMenuService.createSubCategory({
      brandId,
      categoryId: cat.id,
      name: 'Sub Kategori Uji ' + suffix,
      sortOrder: 1
    });
    assert.ok(subCat);
    assert.equal(subCat.name, 'Sub Kategori Uji ' + suffix);

    const listSub = ComposedMenuService.listSubCategories({
      brandId,
      categoryId: cat.id
    });
    assert.ok(Array.isArray(listSub));
    assert.ok(listSub.some(s => s.id === subCat.id));

    const updatedSub = ComposedMenuService.updateSubCategory({
      brandId,
      subCategoryId: subCat.id,
      name: 'Sub Kategori Edit ' + suffix
    });
    assert.equal(updatedSub.name, 'Sub Kategori Edit ' + suffix);

    const delSub = ComposedMenuService.deleteSubCategory({
      brandId,
      subCategoryId: subCat.id
    });
    assert.equal(delSub.status, 'ARCHIVED');

  } finally {
    // Cleanup
    if (createdMenu) {
      try { ComposedMenuService.deleteMenu({ brandId, menuId: createdMenu.id }); } catch (_) {}
    }
    if (title1) {
      try { ComposedMenuService.deleteMenuTitle({ brandId, titleId: title1.id }); } catch (_) {}
    }
    if (subCat) {
      try { repo.db.execute('DELETE FROM sub_categories WHERE id = ?', [subCat.id]); } catch (_) {}
    }
    if (cat && cat.isTest) {
      try { repo.db.execute('DELETE FROM categories WHERE id = ?', [cat.id]); } catch (_) {}
    }
    [p1, p2, p3].forEach(p => {
      try { repo.db.execute('DELETE FROM branch_product_inventory WHERE product_id = ?', [p.id]); } catch (_) {}
      try { repo.db.execute('DELETE FROM product_sku_history WHERE product_id = ?', [p.id]); } catch (_) {}
      try { repo.db.execute('DELETE FROM products WHERE id = ?', [p.id]); } catch (_) {}
    });
  }
});
