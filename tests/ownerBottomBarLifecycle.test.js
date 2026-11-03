'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const MAIN_JSX_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/main.jsx');
const DASHBOARD_JS_PATH = path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js');
const CAT_REF_JS_PATH = path.join(ROOT, 'apps/merchant-dashboard/assets/js/modules/catalog-reference.js');
const MASTER_MENU_JS_PATH = path.join(ROOT, 'apps/merchant-dashboard/assets/js/modules/master-menu.js');
const CATALOG_JS_PATH = path.join(ROOT, 'apps/merchant-dashboard/assets/js/modules/catalog.js');
const PRES_SHELL_JS_PATH = path.join(ROOT, 'apps/merchant-shared/js/presentation-shells.js');
const SHEET_MODAL_JS_PATH = path.join(ROOT, 'apps/merchant-shared/js/sheet-modal.js');
const BUNDLE_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

test('Owner Mobile Bottom Bar & Bottom Sheet Lifecycle', async (t) => {
  await t.test('1. main.jsx enforces single active page root so portaled bottom bars never stack', () => {
    const mainJsx = fs.readFileSync(MAIN_JSX_PATH, 'utf8');
    assert.ok(mainJsx.includes('new Map()'), 'main.jsx must track roots in an iterable Map');
    assert.ok(mainJsx.includes('unmountOtherPageRoots(container)'), 'Each page mount must unmount other page roots');
    assert.ok(mainJsx.includes('export function unmountAllModernPages'), 'main.jsx must export unmountAllModernPages');
    assert.ok(mainJsx.includes('window.unmountAllModernPages = unmountAllModernPages'), 'window.unmountAllModernPages must be exposed globally');

    const bundleJs = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');
    assert.ok(bundleJs.includes('unmountAllModernPages'), 'Compiled bundle must include unmountAllModernPages');
  });

  await t.test('2. Route transitions in dashboard.js and catalog modules unmount previous pages and close open sheets', () => {
    const dashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, 'utf8');
    const catRefJs = fs.readFileSync(CAT_REF_JS_PATH, 'utf8');
    const masterMenuJs = fs.readFileSync(MASTER_MENU_JS_PATH, 'utf8');
    const catalogJs = fs.readFileSync(CATALOG_JS_PATH, 'utf8');

    assert.ok(dashboardJs.includes('window.XentraPresentation.closeAll()'), 'applyRoute must close all XentraPresentation sheets');
    assert.ok(dashboardJs.includes('window.unmountAllModernPages()'), 'applyRoute must unmount previous modern React pages');
    assert.ok(catRefJs.includes('window.unmountCategoriesPage(modernMount)'), 'showCategoryEditorSection must unmount CategoriesPage');
    assert.ok(masterMenuJs.includes('window.unmountCategoriesPage(modernCatMount)'), 'showOwnerMasterMenuEditor must unmount CategoriesPage');
    assert.ok(catalogJs.includes('window.unmountMenuEditor(modernMenuMount)'), 'showProductListSection must unmount MenuEditor');
  });

  await t.test('2b. CatalogSubHub -> BusinessHub Back transition runs once without double-trigger or forced rAF animation restart', () => {
    const catalogSubHubJsx = fs.readFileSync(path.join(ROOT, 'packages/menu-editor-ui/src/components/CatalogSubHub.jsx'), 'utf8');
    const businessHubJsx = fs.readFileSync(path.join(ROOT, 'packages/menu-editor-ui/src/components/BusinessHub.jsx'), 'utf8');
    const dashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, 'utf8');

    // CatalogSubHub.handleBack must delegate to XentraNavigationController.back() first and return before calling onBack()
    const navIdx = catalogSubHubJsx.indexOf('window.XentraNavigationController.back()');
    const onBackIdx = catalogSubHubJsx.indexOf('onBack()');
    assert.ok(navIdx > 0 && onBackIdx > navIdx, 'CatalogSubHub.handleBack must call XentraNavigationController.back() and return before fallback onBack()');

    // BusinessHub must not register a duplicate hashchange/popstate listener that races with dashboard.js applyRoute
    assert.ok(!businessHubJsx.includes('syncRouteFromHash'), 'BusinessHub must not duplicate hash/popstate route sync that causes double transition');

    // triggerOwnerPageSlideTransition rAF loop must not restart animations on modern React roots
    const slideFnStart = dashboardJs.indexOf('function triggerOwnerPageSlideTransition(');
    const slideFnEnd = dashboardJs.indexOf('function applyRoute(', slideFnStart);
    const slideFnBody = dashboardJs.slice(slideFnStart, slideFnEnd);
    assert.ok(!slideFnBody.includes('#modern-business-hub-root'), 'triggerOwnerPageSlideTransition rAF must not force reflow/restart CSS animation on #modern-business-hub-root');
  });

  await t.test('3. XentraPresentation and XentraUI.Modal destroy/close open bottom sheets on popstate (Back) and closeAll()', () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="anchor-parent"><div id="sheet-content">Sheet</div></div></body></html>', {
      url: 'http://localhost:3000/owner/#catalog/categories'
    });
    const { window } = dom;
    const { document } = window;

    const presShellCode = fs.readFileSync(PRES_SHELL_JS_PATH, 'utf8');
    const sheetModalCode = fs.readFileSync(SHEET_MODAL_JS_PATH, 'utf8');

    vm.runInNewContext(presShellCode, { window, document, Date, Promise }, { filename: 'presentation-shells.js' });
    vm.runInNewContext(sheetModalCode, { window, document, requestAnimationFrame: (cb) => cb(), setTimeout: (cb) => cb() }, { filename: 'sheet-modal.js' });

    const content = document.getElementById('sheet-content');
    window.XentraPresentation.open({
      id: 'test-bottom-sheet',
      type: 'bottom-sheet',
      content
    });

    assert.equal(window.XentraPresentation.stackSize(), 1, 'Bottom sheet should be open');
    assert.ok(document.querySelector('.x-presentation-bottom-sheet'), 'Bottom sheet shell must exist in DOM');

    // Simulate pressing Back (popstate)
    window.dispatchEvent(new window.PopStateEvent('popstate'));

    assert.equal(window.XentraPresentation.stackSize(), 0, 'Bottom sheet stack must be empty after Back (popstate)');
    assert.equal(document.querySelector('.x-presentation-bottom-sheet'), null, 'Bottom sheet shell must be destroyed from DOM on Back');
  });

  await t.test('4. Anti-Flicker & Smooth Page Transition Standard (No green WebView progressBar flash, no raw location.hash mutations, no outer .x-tab-content animation)', () => {
    // 4a. Native Android WebViews must never show the top horizontal green progressBar on SPA transitions
    const androidActivities = [
      path.join(ROOT, 'native/owner-android/app/src/main/java/com/mybangjo/owner/MainActivity.java'),
      path.join(ROOT, 'native/merchant-android/app/src/main/java/com/mybangjo/merchant/MainActivity.java'),
      path.join(ROOT, 'native/pos-android/app/src/main/java/com/mybangjo/pos/MainActivity.java'),
    ];
    for (const activityPath of androidActivities) {
      const javaSrc = fs.readFileSync(activityPath, 'utf8');
      assert.ok(
        !javaSrc.includes('progressBar.setVisibility(View.VISIBLE)'),
        `${path.relative(ROOT, activityPath)} must not set progressBar VISIBLE on page/hash changes`
      );
    }

    // 4b. React components in menu-editor-ui must use navigateTo / history APIs instead of raw window.location.hash = ...
    const reactComponents = [
      'BusinessHub.jsx',
      'CatalogSubHub.jsx',
      'CategoriesPage.jsx',
      'CategoryDetailPage.jsx',
      'CategoryEditorPage.jsx',
      'CategorySortPage.jsx',
      'CategoryMenuSortPage.jsx',
      'ItemMasterPage.jsx',
      'MenuEditor.jsx',
      'OverviewPage.tsx',
    ];
    for (const comp of reactComponents) {
      const compSrc = fs.readFileSync(path.join(ROOT, 'packages/menu-editor-ui/src/components', comp), 'utf8');
      assert.ok(
        !/window\.location\.hash\s*=/.test(compSrc),
        `${comp} must not assign window.location.hash directly (use window.navigateTo)`
      );
    }

    // 4c. Outer .x-tab-content must not have competing fadeIn animation, and shared.css / index.css must define canonical transitions
    const dashboardCss = fs.readFileSync(path.join(ROOT, 'apps/merchant-shared/css/dashboard.css'), 'utf8');
    const sharedCss = fs.readFileSync(path.join(ROOT, 'apps/merchant-shared/css/shared.css'), 'utf8');
    const ownerAppCss = fs.readFileSync(path.join(ROOT, 'apps/owner-app/assets/css/owner-app.css'), 'utf8');
    const dashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, 'utf8');

    const tabContentRuleMatch = dashboardCss.match(/\.x-tab-content\s*\{[^}]*\}/);
    assert.ok(tabContentRuleMatch, '.x-tab-content rule must exist in dashboard.css');
    assert.ok(!tabContentRuleMatch[0].includes('fadeIn'), '.x-tab-content must not apply vertical fadeIn animation');
    assert.ok(sharedCss.includes('@keyframes xentraSlidePushIn'), 'shared.css must define canonical xentraSlidePushIn keyframe');
    assert.ok(sharedCss.includes('@keyframes xentraSlidePopIn'), 'shared.css must define canonical xentraSlidePopIn keyframe');
    assert.ok(ownerAppCss.includes('#legacy-business-main-content'), 'owner-app.css must hide legacy fallback containers by default');
    assert.ok(dashboardJs.includes('prepareOwnerRouteDirection(route)'), 'applyRoute must set data-nav-dir synchronously before mounting');

    // 4d. owner-navigation.js back() and ancestor navigate() must use synchronous replaceState + render
    // instead of window.history.back() / window.history.go(-delta) which trigger native WebView progress bar flashes
    const navEngineSrc = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/owner-navigation.js'), 'utf8');
    assert.ok(
      !navEngineSrc.includes('window.history.back()') && !navEngineSrc.includes('window.history.go('),
      'owner-navigation.js must use writeState(..., "replace") + render() instead of history.back()/history.go() to prevent WebView progress bar flash on Back'
    );

    // 4e. main.jsx must use flushSync for synchronous React 18 page commits, BusinessHub must sync initialSubHub during render,
    // and server/app.js must serve /owner/assets with _smartStaticHeaders (so SVG icons are cached instead of no-store)
    const mainSrc = fs.readFileSync(MAIN_JSX_PATH, 'utf8');
    assert.ok(mainSrc.includes('flushSync'), 'main.jsx must commit page roots synchronously via flushSync to prevent blank frame flashes');

    const businessHubSrc = fs.readFileSync(path.join(ROOT, 'packages/menu-editor-ui/src/components/BusinessHub.jsx'), 'utf8');
    assert.ok(
      businessHubSrc.includes('if (initialSubHub !== prevInitialSubHub)'),
      'BusinessHub.jsx must derive activeSubHub synchronously during render when initialSubHub changes'
    );

    const serverAppSrc = fs.readFileSync(path.join(ROOT, 'server/app.js'), 'utf8');
    const ownerAssetsBlock = serverAppSrc.slice(
      serverAppSrc.indexOf("app.use(['/owner-app/assets', '/owner/assets']"),
      serverAppSrc.indexOf("app.use(['/owner-app/assets', '/owner/assets']") + 260
    );
    assert.ok(
      ownerAssetsBlock.includes('_smartStaticHeaders'),
      'server/app.js must serve /owner/assets with _smartStaticHeaders so SVG icons are cached and do not trigger WebView progress bar on every navigation'
    );
  });
});
