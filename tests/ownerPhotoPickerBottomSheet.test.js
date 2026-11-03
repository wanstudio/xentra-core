'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHEET_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/PhotoPickerBottomSheet.jsx');
const MENU_EDITOR_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/MenuEditor.jsx');
const BUNDLE_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

test('Owner Mobile Photo Picker Bottom Sheet Design & Integration', async (t) => {
  const code = fs.readFileSync(SHEET_PATH, 'utf8');
  const menuEditorCode = fs.readFileSync(MENU_EDITOR_PATH, 'utf8');
  const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8');

  await t.test('1. Mounted via React Portal to document.body and mobile-first container', () => {
    assert.ok(code.includes('createPortal('), 'Must render via createPortal');
    assert.ok(code.includes('document.body'), 'Must mount to document.body');
    assert.ok(code.includes('modern-menu-portal-root'), 'Must use modern-menu-portal-root so Tailwind important rules match');
    assert.ok(code.includes("position: 'fixed'"), 'Backdrop must have explicit fixed position');
    assert.ok(code.includes('99999'), 'Backdrop must have high zIndex 99999');
    assert.ok(code.includes('max-w-[447px]'), 'Must have max-w-[447px] container');
    assert.ok(code.includes('rounded-t-[20px]'), 'Top radius must be 20px');
    assert.ok(code.includes('safe-area-inset-bottom'), 'Must support safe-area-inset-bottom');
  });

  await t.test('2. Conforms 1:1 to visual design tokens and conditional recent photo logic', () => {
    // Handle
    assert.ok(code.includes('#D9D9D9'), 'Handle must use #D9D9D9');

    // Conditional Recent Photo: 358px max height, radius 20px
    assert.ok(code.includes('recentPhotoUrl'), 'Must take recentPhotoUrl prop');
    assert.ok(code.includes("borderRadius: '20px'"), 'Recent photo must have 20px radius');

    // Buttons: 2 options (Kamera & Galeri) with PNG icons from GitHub assets
    assert.ok(code.includes('Ambil dari kamera'), 'Card 1 must be Ambil dari kamera');
    assert.ok(code.includes('Pilih dari galeri'), 'Card 2 must be Pilih dari galeri');
    assert.ok(code.includes('/owner/assets/icons/emojione_camera.png'), 'Card 1 must use emojione_camera.png');
    assert.ok(code.includes('/owner/assets/icons/flat-color-icons_gallery.png'), 'Card 2 must use flat-color-icons_gallery.png');
    assert.ok(code.includes('#D1D3D9'), 'Cards must have 1px #D1D3D9 outline');
    assert.ok(code.includes("borderRadius: '10px'"), 'Cards must have 10px radius');
    assert.ok(code.includes('16px'), 'Title font size must be 16px');
    assert.ok(code.includes('#0F172A'), 'Title color must be #0F172A');

    // Direct native label trigger with capture="environment" to bypass browser synthetic click blocks
    assert.ok(code.includes('htmlFor="menu-photo-camera-input"'), 'Camera button must use label htmlFor for direct native activation');
    assert.ok(code.includes('htmlFor="menu-photo-gallery-input"'), 'Gallery button must use label htmlFor for direct native activation');
    assert.ok(code.includes('capture="environment"'), 'Camera input must have capture=environment');
    assert.ok(code.includes('image/jpeg,image/png,image/webp'), 'Gallery input must accept jpeg/png/webp');
  });

  await t.test('3. Mobile lifecycle handling (popstate, hashchange, escape)', () => {
    assert.ok(code.includes('popstate'), 'Must listen to popstate');
    assert.ok(code.includes('hashchange'), 'Must listen to hashchange');
    assert.ok(code.includes('Escape'), 'Must support Escape key');
  });

  await t.test('4. MenuEditor integrates PhotoPickerBottomSheet and card foto 13px font & camera icon', () => {
    assert.ok(menuEditorCode.includes('PhotoPickerBottomSheet'), 'MenuEditor must import PhotoPickerBottomSheet');
    assert.ok(menuEditorCode.includes('isPhotoSheetOpen'), 'MenuEditor must manage isPhotoSheetOpen state');
    assert.ok(menuEditorCode.includes('text-[13px] font-bold text-[#00A637]'), 'MenuEditor Ganti foto font size must be 13px');
    assert.ok(menuEditorCode.includes('ant-design_camera-outlined.svg'), 'MenuEditor must reference ant-design_camera-outlined.svg icon');
    assert.ok(menuEditorCode.includes('<PhotoPickerBottomSheet'), 'MenuEditor must render PhotoPickerBottomSheet');
  });

  await t.test('5. Production bundle contains compiled PhotoPickerBottomSheet with PNG icons & camera', () => {
    assert.ok(bundleCode.includes('Ambil dari kamera'), 'Compiled bundle must include camera option');
    assert.ok(bundleCode.includes('Pilih dari galeri'), 'Compiled bundle must include gallery option');
    assert.ok(bundleCode.includes('emojione_camera.png'), 'Compiled bundle must reference emojione_camera.png');
    assert.ok(bundleCode.includes('flat-color-icons_gallery.png'), 'Compiled bundle must reference flat-color-icons_gallery.png');
    assert.ok(bundleCode.includes('menu-photo-camera-input'), 'Compiled bundle must reference native camera input');
  });

  await t.test('6. Cache-busting strings updated in index.html files', () => {
    const ownerIndex = fs.readFileSync(path.join(ROOT, 'apps/owner-app/index.html'), 'utf8');
    const dashboardIndex = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
    assert.ok(/menu-editor\.js\?v=1\.\d+\.\d+/.test(ownerIndex), 'Owner app index must have cache-busted menu-editor.js');
    assert.ok(/menu-editor\.js\?v=1\.\d+\.\d+/.test(dashboardIndex), 'Dashboard index must have cache-busted menu-editor.js');
  });

  await t.test('7. Android native app declares CAMERA permission and FileProvider', () => {
    const manifest = fs.readFileSync(path.join(ROOT, 'native/owner-android/app/src/main/AndroidManifest.xml'), 'utf8');
    assert.ok(manifest.includes('android.permission.CAMERA'), 'AndroidManifest must declare CAMERA permission');
    assert.ok(manifest.includes('androidx.core.content.FileProvider'), 'AndroidManifest must declare FileProvider for camera capture');
  });
});
