'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHEET_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/AddCategoryBottomSheet.jsx');
const MENU_EDITOR_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/MenuEditor.jsx');
const CATEGORIES_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/CategoriesPage.jsx');
const BUNDLE_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

test('Owner Mobile Add Category Popup Modal Design & Integration', async (t) => {
  const code = fs.readFileSync(SHEET_PATH, 'utf8');
  const menuEditorCode = fs.readFileSync(MENU_EDITOR_PATH, 'utf8');
  const categoriesPageCode = fs.readFileSync(CATEGORIES_PAGE_PATH, 'utf8');
  const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8');

  await t.test('1. Centered popup modal rendered via Portal to document.body', () => {
    assert.ok(code.includes('createPortal('), 'Must render via createPortal');
    assert.ok(code.includes('document.body'), 'Must mount to document.body');
    assert.ok(code.includes('items-center justify-center'), 'Must be vertically + horizontally centered');
    assert.ok(code.includes('max-w-[353px]'), 'Card must be max 353px wide');
    assert.ok(code.includes("borderRadius: '16px'"), 'Card radius must be 16px');
    assert.ok(code.includes("padding: '18px 17px'"), 'Card padding must be 18/17');
    assert.ok(code.includes('0px 2px 10px rgba(0, 0, 0, 0.20)'), 'Card shadow must match Figma');
    assert.ok(!code.includes('rounded-t-[20px]'), 'Must no longer be a bottom sheet');
  });

  await t.test('2. Conforms 1:1 to Figma tokens', () => {
    assert.ok(code.includes('Tambah kategori'));
    assert.ok(code.includes('Plus Jakarta Sans'));
    assert.ok(code.includes('Nama kategori'));
    assert.ok(code.includes('#FA3E3E'));
    assert.ok(code.includes("minHeight: '123px'"), 'Card 1 must be 123px');
    assert.ok(code.includes('Cth. Makanan Berat'));
    assert.ok(code.includes('#CBD5E1'));
    assert.ok(code.includes('maxLength') && code.includes('150'));
    assert.ok(code.includes('Aktifkan kategori'));
    assert.ok(code.includes('Kategori menu yang aktif akan terlihat'));
    assert.ok(code.includes('#00A637'));
    assert.ok(code.includes('Buat kategori'));
    assert.ok(code.includes('#F2F2F2') && code.includes('#979797'));
    assert.ok(code.includes("height: '48px'"));
  });

  await t.test('3. Back & lifecycle handling (popstate, hashchange, escape) bound once via ref', () => {
    assert.ok(code.includes('onCloseRef.current = onClose'));
    assert.ok(!code.includes('[isOpen, onClose]'));
    for (const ev of ['popstate', 'hashchange', 'keydown']) {
      assert.ok(code.includes(`removeEventListener('${ev}'`), `Must remove ${ev} listener`);
    }
    assert.ok(code.includes('Escape'));
  });

  await t.test('4. Enter/exit animation keeps modal mounted until exit completes', () => {
    assert.ok(code.includes('setTimeout(() => setMounted(false), DURATION)'));
    assert.ok(code.includes("scale(0.96)"), 'Card must scale in');
  });

  await t.test('5. Soft keyboard keeps modal inside visible viewport', () => {
    assert.ok(code.includes('visualViewport'));
    assert.ok(code.includes("removeEventListener('resize'"));
    assert.ok(code.includes('keyboardInset + 16'));
    assert.ok(code.includes('overflowY'));
  });

  await t.test('6. Toggle uses canonical green/red toggle svg asset identical to CategoryEditorPage', () => {
    assert.ok(code.includes('/owner/assets/icons/green-toggle.svg'), 'Must use green-toggle.svg');
    assert.ok(code.includes('/owner/assets/icons/red-toggle.svg'), 'Must use red-toggle.svg');
    assert.ok(code.includes('w-[45px] h-[31px]'), 'Must match 45x31 asset dimension');
  });

  await t.test('7. MenuEditor integrates and auto-selects new category without duplicate cache', () => {
    assert.ok(menuEditorCode.includes('<AddCategoryBottomSheet'));
    assert.ok(menuEditorCode.includes('isAddCategoryOpen'));
    assert.ok(!menuEditorCode.includes("prompt('Masukkan nama kategori baru:')"));
    const start = menuEditorCode.indexOf('const handleCategoryCreated');
    const block = menuEditorCode.slice(start, menuEditorCode.indexOf('// 3. Save Menu', start));
    assert.ok(block.includes('setCategoryId(String(newCategory.id))'));
    assert.ok(block.includes('setFallbackCategoryName'));
    assert.ok(block.includes('cached.some('));
  });

  await t.test('8. CategoriesPage maintains full page navigation and MenuEditor [+] button opens modal', () => {
    assert.ok(categoriesPageCode.includes('catalog/categories/new'), 'CategoriesPage must navigate to full page');
    assert.ok(!categoriesPageCode.includes('<AddCategoryBottomSheet'), 'CategoriesPage must not hijack with popup');
    assert.ok(menuEditorCode.includes('modern-btn-quick-add-category'), 'MenuEditor must have quick add category button');
  });

  await t.test('9. Production bundle contains compiled modal', () => {
    assert.ok(bundleCode.includes('Tambah kategori'));
    assert.ok(bundleCode.includes('Cth. Makanan Berat'));
    assert.ok(bundleCode.includes('Buat kategori'));
    assert.ok(bundleCode.includes('add-category-modal-title'));
  });
});
