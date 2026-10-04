'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
const INLINE = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/owner-master-menu-inline.js'), 'utf8');

test('Owner Master Menu exposes inline dependency creation without leaving the editor', () => {
  assert.ok(HTML.includes('/merchant-dashboard/assets/js/owner-master-menu-inline.js'));
  assert.ok(INLINE.includes("'/admin/composed/products'"));
  assert.ok(INLINE.includes("'/admin/categories'"));
  assert.ok(INLINE.includes("'/admin/sub-categories'"));
  assert.ok(INLINE.includes("'/admin/rasas'"));
  assert.ok(INLINE.includes('createProductInline'));
  assert.ok(INLINE.includes('createCategoryInline'));
  assert.ok(INLINE.includes('createSubCategoryInline'));
  assert.ok(INLINE.includes('createRasaInline'));
  assert.ok(INLINE.includes('Simpan & Pilih Product'));
  assert.ok(INLINE.includes('Simpan & Pilih Kategori'));
  assert.ok(INLINE.includes('Simpan & Pilih Sub Category'));
  assert.ok(INLINE.includes('Simpan & Pilih Rasa'));
});

test('Inline creation keeps canonical domain boundaries', () => {
  assert.ok(INLINE.includes('name: result.name'));
  assert.ok(INLINE.includes('sku: result.sku || null'));
  assert.ok(!INLINE.includes('selling_price'));
  assert.ok(!INLINE.includes('price:'));
  assert.ok(!INLINE.includes('category_id: result.category'));
  assert.ok(INLINE.includes('category_id: categoryId'));
});

test('Package Product quick-create does not depend on dashboard private state', () => {
  assert.ok(INLINE.includes('syncCreatedProductOptions'));
  assert.ok(INLINE.includes('createdProducts.push(product)'));
  assert.ok(INLINE.includes('data-cm-product'));
  assert.ok(!INLINE.includes("document.getElementById('btn-cm-add-component').click()"));
});


test('Inline creation has contextual mobile UX and dependency guardrails', () => {
  assert.ok(INLINE.includes('x-master-inline-sheet'));
  assert.ok(INLINE.includes('x-master-inline-link'));
  assert.ok(INLINE.includes('x-master-inline-created'));
  assert.ok(INLINE.includes('refreshSubCategoryDependencyState'));
  assert.ok(INLINE.includes('action.disabled = disabled'));
  assert.ok(INLINE.includes('Pilih Kategori terlebih dahulu'));
  assert.ok(INLINE.includes('Product adalah identitas dasar'));\n});
