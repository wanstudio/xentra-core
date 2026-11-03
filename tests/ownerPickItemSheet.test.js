'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHEET_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/PickItemSheet.jsx');
const MENU_EDITOR_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/MenuEditor.jsx');
const BUNDLE_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

test('Owner Mobile Pick Item Sheet Design & Visual Logic Integration', async (t) => {
  const code = fs.readFileSync(SHEET_PATH, 'utf8');
  const menuEditorCode = fs.readFileSync(MENU_EDITOR_PATH, 'utf8');
  const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8');

  await t.test('1. Mounted via React Portal to document.body and mobile-first container', () => {
    assert.ok(code.includes('createPortal('), 'Must render via createPortal');
    assert.ok(code.includes('document.body'), 'Must mount to document.body');
    assert.ok(code.includes('max-w-[447px]'), 'Must have max-w-[447px] container');
    assert.ok(code.includes('rounded-t-[20px]'), 'Top radius must be 20px');
    assert.ok(code.includes('safe-area-inset-bottom'), 'Must support safe-area-inset-bottom');
  });

  await t.test('2. Conforms 1:1 to visual design tokens (colors, typography, cards)', () => {
    // Handle & Title
    assert.ok(code.includes('#D9D9D9'), 'Handle must use #D9D9D9');
    assert.ok(code.includes('Pilih item'), 'Must have title Pilih item');
    assert.ok(code.includes('Plus Jakarta Sans'), 'Must use Plus Jakarta Sans');

    // Search bar
    assert.ok(code.includes('#CBD5E1'), 'Search outline must be #CBD5E1');
    assert.ok(code.includes('Cari menu atau pengaturan bisnis'), 'Placeholder must match design');
    assert.ok(code.includes('#94A3B8'), 'Placeholder color #94A3B8');

    // Item cards
    assert.ok(code.includes('#D1D3D9'), 'Card outline must be 1px #D1D3D9');
    assert.ok(code.includes("borderRadius: '10px'") || code.includes('rounded-[10px]'), 'Card border-radius must be 10px');
    assert.ok(code.includes('45px'), 'Thumbnail dimension must be 45px');
    assert.ok(code.includes('#0F172A'), 'Title and price color #0F172A');
    assert.ok(code.includes('#979797'), 'SKU text color #979797');

    // Radio selection
    assert.ok(code.includes('#00A637'), 'Active radio color must be #00A637');
  });

  await t.test('3. Mobile lifecycle handling (popstate, hashchange, escape)', () => {
    assert.ok(code.includes('popstate'), 'Must listen to popstate');
    assert.ok(code.includes('hashchange'), 'Must listen to hashchange');
    assert.ok(code.includes('Escape'), 'Must support Escape key');
  });

  await t.test('4. MenuEditor integrates PickItemSheet on item selection', () => {
    assert.ok(menuEditorCode.includes('<PickItemSheet'), 'MenuEditor must render PickItemSheet');
    assert.ok(menuEditorCode.includes('isPickSheetOpen'), 'MenuEditor must pass isPickSheetOpen');
    assert.ok(menuEditorCode.includes('onSelectProduct={handleSelectProduct}'), 'MenuEditor must wire onSelectProduct');
  });

  await t.test('5. Decision bottom bar (bottom bar keputusan) matches design and state logic', () => {
    assert.ok(code.includes('0px 0px 15px rgba(0, 0, 0, 0.15)'), 'Must have 0px 0px 15px rgba(0,0,0,0.15) box shadow');
    assert.ok(code.includes('Tambah'), 'Must have button text Tambah');
    assert.ok(code.includes('#00A637'), 'Must turn green #00A637 when item is selected');
    assert.ok(code.includes('#F2F2F2'), 'Must be neutral #F2F2F2 when unselected');
    assert.ok(code.includes('canSubmit'), 'Must disable/enable button based on selection');
  });

  await t.test('6. Production bundle contains compiled PickItemSheet', () => {
    assert.ok(bundleCode.includes('Pilih item'), 'Compiled bundle must include title');
    assert.ok(bundleCode.includes('Cari menu atau pengaturan bisnis'), 'Compiled bundle must include search placeholder');
    assert.ok(bundleCode.includes('Tambah'), 'Compiled bundle must include Tambah button');
  });
});
