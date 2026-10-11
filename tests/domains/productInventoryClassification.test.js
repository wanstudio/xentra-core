'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DataAccess = require('../../core/data/DataAccess');
const { ComposedProductService } = require('../../domains/catalog');
const ComposedMenuRepository = require('../../domains/catalog/repositories/ComposedMenuRepository');

test('Product Inventory Classification Contract: Cooked (Recipe) vs Direct (Resale)', async () => {
  const brandId = 'brand_bangjo';
  const repo = new ComposedMenuRepository(DataAccess);

  const suffix = Date.now().toString(36);
  const skuCooked = 'NGS-' + suffix;
  const skuDirect = 'AQUA-' + suffix;

  let cookedProduct = null;
  let directProduct = null;

  try {
    // 1. Create a Cooked Item (Recipe-based)
    cookedProduct = ComposedProductService.createProduct({
      brandId,
      name: 'Nasi Goreng Spesial Test ' + suffix,
      sku: skuCooked,
      costPrice: 12000,
      inventoryType: 'COOKED',
      description: 'Nasi goreng racikan dapur'
    });

    assert.ok(cookedProduct);
    assert.equal(cookedProduct.inventory_type, 'COOKED');

    // 2. Create a Direct Item (Retail Resale without recipe, like Aqua)
    directProduct = ComposedProductService.createProduct({
      brandId,
      name: 'Air Mineral Aqua 600ml Test ' + suffix,
      sku: skuDirect,
      costPrice: 3000,
      inventoryType: 'DIRECT',
      description: 'Barang dagang langsung tanpa resep'
    });

    assert.ok(directProduct);
    assert.equal(directProduct.inventory_type, 'DIRECT');

    // 3. Verify retrieval via findProduct
    const foundDirect = repo.findProduct({ brandId, productId: directProduct.id });
    assert.ok(foundDirect);
    assert.equal(foundDirect.inventory_type, 'DIRECT');

    // 4. Verify updateProduct can modify inventory_type
    const updatedDirect = ComposedProductService.updateProduct({
      brandId,
      productId: directProduct.id,
      inventoryType: 'COOKED'
    });
    assert.equal(updatedDirect.inventory_type, 'COOKED');

    // Switch it back to DIRECT
    const revertedDirect = ComposedProductService.updateProduct({
      brandId,
      productId: directProduct.id,
      inventoryType: 'DIRECT'
    });
    assert.equal(revertedDirect.inventory_type, 'DIRECT');

    // 5. Verify listProducts includes inventory_type
    const products = repo.listProducts({ brandId, activeOnly: true });
    const directInList = products.find(p => p.id === directProduct.id);
    const cookedInList = products.find(p => p.id === cookedProduct.id);

    assert.ok(directInList);
    assert.equal(directInList.inventory_type, 'DIRECT');
    assert.ok(cookedInList);
    assert.equal(cookedInList.inventory_type, 'COOKED');
  } finally {
    if (cookedProduct && cookedProduct.id) {
      DataAccess.execute("DELETE FROM branch_product_inventory WHERE product_id = ?", [cookedProduct.id]);
      DataAccess.execute("DELETE FROM product_sku_history WHERE product_id = ?", [cookedProduct.id]);
      DataAccess.execute("DELETE FROM products WHERE id = ?", [cookedProduct.id]);
    }
    if (directProduct && directProduct.id) {
      DataAccess.execute("DELETE FROM branch_product_inventory WHERE product_id = ?", [directProduct.id]);
      DataAccess.execute("DELETE FROM product_sku_history WHERE product_id = ?", [directProduct.id]);
      DataAccess.execute("DELETE FROM products WHERE id = ?", [directProduct.id]);
    }
  }
});
