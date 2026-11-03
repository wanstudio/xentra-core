const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MATERIALS_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/MaterialsPage.jsx');
const MAIN_JSX_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/main.jsx');
const BUNDLE_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');
const OWNER_HTML_PATH = path.join(ROOT, 'apps/owner-app/index.html');
const DASHBOARD_JS_PATH = path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js');

test('Owner Materials Page Redesign Suite (1:1 Figma Spec)', async (t) => {
  const materialsSrc = fs.readFileSync(MATERIALS_PAGE_PATH, 'utf8');
  const mainSrc = fs.readFileSync(MAIN_JSX_PATH, 'utf8');
  const bundleSrc = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const ownerHtml = fs.readFileSync(OWNER_HTML_PATH, 'utf8');
  const dashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, 'utf8');

  await t.test('1. MaterialsPage.jsx defines 1:1 Figma Header & Title', () => {
    assert.ok(materialsSrc.includes('Bahan baku'), 'Header must display "Bahan baku"');
    assert.ok(materialsSrc.includes('fontSize: \'18px\''), 'Header title font size must be 18px');
    assert.ok(materialsSrc.includes('#0F172A'), 'Header title color must be #0F172A');
    assert.ok(materialsSrc.includes('aria-label="Kembali"'), 'Must have back button');
  });

  await t.test('2. MaterialsPage.jsx defines Search Bar matching Figma spec', () => {
    assert.ok(materialsSrc.includes('placeholder="Cari nama atau kode item"'), 'Search placeholder must match Figma');
    assert.ok(materialsSrc.includes('height: \'48px\''), 'Search bar height must be 48px');
    assert.ok(materialsSrc.includes('borderRadius: \'14px\''), 'Search bar radius must be 14px');
    assert.ok(materialsSrc.includes('#CBD5E1'), 'Search bar outline must be #CBD5E1');
    assert.ok(materialsSrc.includes('fontSize: \'13px\''), 'Search input font size must be 13px');
  });

  await t.test('3. MaterialsPage.jsx defines Status Filter Pills (Aktif / Nonaktif)', () => {
    assert.ok(materialsSrc.includes('Aktif'), 'Must contain Aktif pill');
    assert.ok(materialsSrc.includes('Nonaktif'), 'Must contain Nonaktif pill');
    assert.ok(materialsSrc.includes('width: \'75px\''), 'Pill width must be 75px');
    assert.ok(materialsSrc.includes('height: \'30px\''), 'Pill height must be 30px');
    assert.ok(materialsSrc.includes('borderRadius: \'20px\''), 'Pill border radius must be 20px');
  });

  await t.test('4. MaterialsPage.jsx defines Item Card tokens matching Figma', () => {
    assert.ok(materialsSrc.includes('borderRadius: \'12px\''), 'Item card radius must be 12px');
    assert.ok(materialsSrc.includes('width: \'45px\'') && materialsSrc.includes('height: \'45px\''), 'Thumbnail box must be 45x45');
    assert.ok(materialsSrc.includes('borderRadius: \'10px\''), 'Thumbnail box radius must be 10px');
    assert.ok(materialsSrc.includes('fontSize: \'16px\''), 'Material name font size must be 16px');
    assert.ok(materialsSrc.includes('fontSize: \'10px\''), 'SKU code font size must be 10px');
    assert.ok(materialsSrc.includes('#00A637'), 'Price text color must be #00A637');
    assert.ok(materialsSrc.includes('fontSize: \'12px\''), 'Price text font size must be 12px');
    // Switch tokens
    assert.ok(materialsSrc.includes('width: \'35px\'') && materialsSrc.includes('height: \'21px\''), 'Toggle switch must be 35x21');
    assert.ok(materialsSrc.includes('width: \'21px\'') && materialsSrc.includes('height: \'21px\''), 'Toggle knob must be 21x21');
  });

  await t.test('5. MaterialsPage.jsx defines Bottom Floating Action Bar with "Tambah" button', () => {
    assert.ok(materialsSrc.includes('borderTopLeftRadius: \'20px\''), 'Bottom bar must have top-left radius 20px');
    assert.ok(materialsSrc.includes('borderTopRightRadius: \'20px\''), 'Bottom bar must have top-right radius 20px');
    assert.ok(materialsSrc.includes('boxShadow: \'0px 0px 15px rgba(0, 0, 0, 0.15)\''), 'Bottom bar shadow must match Figma');
    assert.ok(materialsSrc.includes('height: \'110px\''), 'Bottom bar height must be 110px');
    assert.ok(materialsSrc.includes('backgroundColor: \'#00A637\''), 'Tambah button must be green #00A637');
    assert.ok(materialsSrc.includes('height: \'48px\''), 'Tambah button height must be 48px');
    assert.ok(materialsSrc.includes('Tambah'), 'Button label must be Tambah');
  });

  await t.test('6. main.jsx and compiled bundle export mountMaterialsPage and unmountMaterialsPage', () => {
    assert.ok(mainSrc.includes('export function mountMaterialsPage'), 'main.jsx must export mountMaterialsPage');
    assert.ok(mainSrc.includes('export function unmountMaterialsPage'), 'main.jsx must export unmountMaterialsPage');
    assert.ok(mainSrc.includes('window.mountMaterialsPage = mountMaterialsPage'), 'main.jsx must attach to window');
    assert.ok(bundleSrc.includes('mountMaterialsPage'), 'Bundle must contain mountMaterialsPage');
    assert.ok(bundleSrc.includes('unmountMaterialsPage'), 'Bundle must contain unmountMaterialsPage');
  });

  await t.test('7. apps/owner-app/index.html includes modern-materials-page-mount', () => {
    assert.ok(ownerHtml.includes('id="modern-materials-page-mount"'), 'Owner HTML must include mount div');
    assert.ok(ownerHtml.includes('id="legacy-materials-content"'), 'Legacy content must be safely wrapped');
  });

  await t.test('8. dashboard.js mounts modern MaterialsPage on materials route', () => {
    assert.ok(dashboardJs.includes('window.mountMaterialsPage(modernMatMount'), 'dashboard.js must mount modern materials page');
    assert.ok(dashboardJs.includes('business/materials'), 'dashboard.js route meta must recognize business/materials');
  });

  await t.test('9. Card click navigates to editor and GET /admin/materials/:id endpoint exists', () => {
    // MaterialsPage card click navigation
    assert.ok(materialsSrc.includes('handleCardClick'), 'MaterialsPage must handle card click');
    assert.ok(materialsSrc.includes('business/materials/${encodeURIComponent(materialId)}/edit'), 'Card click must navigate to editor route');

    // dashboard.js routing
    assert.ok(dashboardJs.includes('window.mountMaterialEditorPage'), 'dashboard.js must mount material editor');
    assert.ok(dashboardJs.includes('isMaterialEditor'), 'dashboard.js must detect material editor route');

    // admin-materials.js GET /admin/materials/:id
    const routesSrc = fs.readFileSync(path.join(ROOT, 'server/routes/admin-materials.js'), 'utf8');
    assert.ok(routesSrc.includes("router.get('/admin/materials/:id'"), 'Backend must register GET /admin/materials/:id');
  });
});
