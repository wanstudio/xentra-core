const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MATERIAL_EDITOR_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/MaterialEditorPage.jsx');
const MATERIALS_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/MaterialsPage.jsx');
const MAIN_JSX_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/main.jsx');
const BUNDLE_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');
const OWNER_APP_SHELL_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/shell/OwnerAppShell.tsx');
const DASHBOARD_JS_PATH = path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js');

test('Material Editor Page ("Tambah bahan") Suite - 1:1 Figma Spec', async (t) => {
  const editorSrc = fs.readFileSync(MATERIAL_EDITOR_PAGE_PATH, 'utf8');
  const materialsSrc = fs.readFileSync(MATERIALS_PAGE_PATH, 'utf8');
  const mainSrc = fs.readFileSync(MAIN_JSX_PATH, 'utf8');
  const bundleSrc = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const shellSrc = fs.readFileSync(OWNER_APP_SHELL_PATH, 'utf8');
  const dashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, 'utf8');

  await t.test('1. MaterialEditorPage.jsx defines 1:1 Figma Header & Title', () => {
    assert.ok(editorSrc.includes('Tambah bahan'), 'Header must display "Tambah bahan"');
    assert.ok(editorSrc.includes("fontSize: '18px'"), 'Header title font size must be 18px');
    assert.ok(editorSrc.includes('#0F172A'), 'Header title color must be #0F172A');
    assert.ok(editorSrc.includes('aria-label="Kembali"'), 'Must have canonical back button');
    assert.ok(editorSrc.includes('ci_arrow-left-sm.svg'), 'Must use canonical back icon');
  });

  await t.test('2. MaterialEditorPage.jsx defines Card 1 "Nama bahan *" matching Figma spec', () => {
    assert.ok(editorSrc.includes('Nama bahan'), 'Card 1 must have label "Nama bahan"');
    assert.ok(editorSrc.includes('text-red-500') || editorSrc.includes('#EF4444'), 'Must have red asterisk for required field');
    assert.ok(editorSrc.includes('Cth. bawang merah'), 'Placeholder must be "Cth. bawang merah"');
    assert.ok(editorSrc.includes('name.length}/150'), 'Character counter must show length/150');
    assert.ok(editorSrc.includes("height: '48px'"), 'Input height must be 48px');
    assert.ok(editorSrc.includes("borderRadius: '16px'") || editorSrc.includes('rounded-2xl'), 'Input radius must be 16px/rounded-2xl');
  });

  await t.test('3. MaterialEditorPage.jsx defines Card 2 "Harga & satuan *" with Price Input & Inline Dropdown Popover', () => {
    assert.ok(editorSrc.includes('Harga &amp; satuan') || editorSrc.includes('Harga & satuan'), 'Card 2 must have label "Harga & satuan"');
    assert.ok(editorSrc.includes('Harga (Rp)'), 'Card 2 must have input with placeholder "Harga (Rp)"');
    assert.ok(editorSrc.includes('Pilih satuan dasar'), 'Placeholder must be "Pilih satuan dasar"');
    assert.ok(editorSrc.includes('isDropdownOpen'), 'Must support inline UOM dropdown state');
    assert.ok(editorSrc.includes('uom-dropdown-menu'), 'Must render uom-dropdown-menu');
    assert.ok(editorSrc.includes('outline-violet-50') || editorSrc.includes('#F5F3FF'), 'Must match Figma violet-50 styling');
    assert.ok(editorSrc.includes('/admin/uoms'), 'Must fetch UOMs from /admin/uoms API');
  });

  await t.test('4. Toggle Switch uses GREEN for Active and RED for Inactive (No Gray)', () => {
    // Editor page toggle
    assert.ok(editorSrc.includes('#16A34A') || editorSrc.includes('bg-green-600'), 'Active toggle must be green');
    assert.ok(editorSrc.includes('#EF4444') || editorSrc.includes('bg-red-500'), 'Inactive toggle must be red');
    assert.ok(!editorSrc.includes("backgroundColor: isActive ? '#16A34A' : '#CBD5E1'"), 'Inactive must NOT be gray #CBD5E1');

    // MaterialsPage toggle also updated to green/red
    assert.ok(materialsSrc.includes('#EF4444') || materialsSrc.includes('bg-red-500'), 'MaterialsPage inactive toggle must be red');
  });

  await t.test('5. MaterialEditorPage.jsx defines Fixed Bottom Action Bar with "Simpan"', () => {
    assert.ok(editorSrc.includes('Simpan'), 'Must contain "Simpan" button');
    assert.ok(editorSrc.includes('modern-material-editor-bottom-bar'), 'Must define portal bottom bar');
    assert.ok(editorSrc.includes('#F4F4F5') || editorSrc.includes('bg-zinc-100'), 'Disabled state background');
    assert.ok(editorSrc.includes('#A1A1AA') || editorSrc.includes('text-neutral-400'), 'Disabled state text color');
  });

  await t.test('6. Exports and Shell Routing are wired correctly', () => {
    assert.ok(mainSrc.includes('mountMaterialEditorPage'), 'main.jsx exports mountMaterialEditorPage');
    assert.ok(bundleSrc.includes('mountMaterialEditorPage'), 'compiled bundle exports mountMaterialEditorPage');
    assert.ok(shellSrc.includes('business/materials/new'), 'OwnerAppShell routes business/materials/new');
    assert.ok(dashboardJs.includes('business/materials/new'), 'dashboard.js maps business/materials/new');
  });

  await t.test('7. Spacing & Header Template strictly matches ItemMasterPage.jsx', () => {
    // Both ItemMasterPage and MaterialEditorPage share the identical header layout
    assert.ok(editorSrc.includes("marginBottom: '24px'"), 'Header margin bottom must be 24px');
    assert.ok(editorSrc.includes('w-9 h-9 flex items-center justify-center -ml-2'), 'Back button dimensions and negative margin must match');
    assert.ok(editorSrc.includes('paddingBottom: \'160px\''), 'Root paddingBottom must be 160px');
    assert.ok(editorSrc.includes('gap-4'), 'Root gap must be gap-4');
  });

  await t.test('8. MaterialEditorPage.jsx Edit Mode & Deletion 1:1 Figma Spec', () => {
    // Dynamic header title in Edit Mode: "Bahan:Nama bahan yang di edit"
    assert.ok(editorSrc.includes("isEdit ? `Bahan:${name ? name : 'Nama bahan yang di edit'}` : 'Tambah bahan'"), 'Dynamic title for edit mode');
    // Card 4: Hapus bahan baku
    assert.ok(editorSrc.includes('Hapus bahan baku'), 'Card 4 must display "Hapus bahan baku" in edit mode');
    assert.ok(editorSrc.includes('Pastikan bahan baku yang ingin di hapus sudah tidak digunakan dalam resep'), 'Must display warning description');
    assert.ok(editorSrc.includes('btn-delete-material'), 'Must have delete button with data-testid');
    assert.ok(editorSrc.includes('DeleteConfirmationModal'), 'Must integrate DeleteConfirmationModal');
    assert.ok(editorSrc.includes('usageCount'), 'Must track recipe usage count for deletion safety');
  });
});
