'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MODAL_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/DeleteConfirmationModal.jsx');
const ITEM_EDITOR_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/ItemEditorPage.jsx');
const MENU_EDITOR_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/MenuEditor.jsx');
const CATEGORY_EDITOR_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/CategoryEditorPage.jsx');
const BUNDLE_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

test('Standard Delete Confirmation Modal Suite (Unified Design & Portaled Behavior)', async (t) => {
  const modalCode = fs.readFileSync(MODAL_PATH, 'utf8');
  const itemEditorCode = fs.readFileSync(ITEM_EDITOR_PATH, 'utf8');
  const menuEditorCode = fs.readFileSync(MENU_EDITOR_PATH, 'utf8');
  const categoryEditorCode = fs.readFileSync(CATEGORY_EDITOR_PATH, 'utf8');
  const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8');

  await t.test('1. DeleteConfirmationModal conforms to standard UI specification', () => {
    assert.ok(fs.existsSync(MODAL_PATH), 'DeleteConfirmationModal.jsx must exist');
    assert.ok(modalCode.includes('createPortal'), 'Must portal to document.body');
    assert.ok(modalCode.includes('document.body.style.overflow'), 'Must lock body scroll');
    assert.ok(modalCode.includes("e.key === 'Escape'"), 'Must handle Escape key');
    assert.ok(modalCode.includes('popstate'), 'Must handle popstate navigation');
    assert.ok(modalCode.includes('id="modern-menu-portal-root"'), 'Must wrap in portal root ID for CSS scoping');
    assert.ok(modalCode.includes('bg-red-100'), 'Must contain centered red circular badge');
    assert.ok(modalCode.includes('text-red-600'), 'Must color badge icon red');
    assert.ok(modalCode.includes('#FA3E3E'), 'Must use #FA3E3E for confirm button');
    assert.ok(modalCode.includes('rounded-full'), 'Must use rounded-full pill buttons');
  });

  await t.test('2. ItemEditorPage uses standard DeleteConfirmationModal', () => {
    assert.ok(itemEditorCode.includes("import DeleteConfirmationModal from './DeleteConfirmationModal'"), 'Must import DeleteConfirmationModal');
    assert.ok(itemEditorCode.includes('<DeleteConfirmationModal'), 'Must render DeleteConfirmationModal');
    assert.ok(itemEditorCode.includes('title="Hapus Item?"'), 'Must set title to Hapus Item?');
  });

  await t.test('3. MenuEditor uses standard DeleteConfirmationModal', () => {
    assert.ok(menuEditorCode.includes("import DeleteConfirmationModal from './DeleteConfirmationModal'"), 'Must import DeleteConfirmationModal');
    assert.ok(menuEditorCode.includes('<DeleteConfirmationModal'), 'Must render DeleteConfirmationModal');
    assert.ok(menuEditorCode.includes('title="Hapus Menu?"'), 'Must set title to Hapus Menu?');
  });

  await t.test('4. CategoryEditorPage uses standard DeleteConfirmationModal', () => {
    assert.ok(categoryEditorCode.includes("import DeleteConfirmationModal from './DeleteConfirmationModal'"), 'Must import DeleteConfirmationModal');
    assert.ok(categoryEditorCode.includes('<DeleteConfirmationModal'), 'Must render DeleteConfirmationModal');
    assert.ok(categoryEditorCode.includes('title="Hapus Kategori?"'), 'Must set title to Hapus Kategori?');
  });

  await t.test('5. Production bundle contains compiled DeleteConfirmationModal', () => {
    assert.ok(bundleCode.includes('Hapus Item?'), 'Bundle must contain compiled item delete modal');
    assert.ok(bundleCode.includes('Hapus Menu?'), 'Bundle must contain compiled menu delete modal');
    assert.ok(bundleCode.includes('Hapus Kategori?'), 'Bundle must contain compiled category delete modal');
  });
});
