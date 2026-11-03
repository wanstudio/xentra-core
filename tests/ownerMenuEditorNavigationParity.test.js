const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DASHBOARD_JS_PATH = path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js');
const NAV_ENGINE_JS_PATH = path.join(ROOT, 'apps/merchant-dashboard/assets/js/owner-navigation.js');
const BUNDLE_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

test('Owner Menu Editor Navigation Parity (Swipe Back vs Header Arrow)', async (t) => {
  const dashboardJs = fs.readFileSync(DASHBOARD_JS_PATH, 'utf8');
  const navEngineJs = fs.readFileSync(NAV_ENGINE_JS_PATH, 'utf8');
  const bundleJs = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');

  await t.test('1. dashboard.js defines dynamic category parent for master menu editor routes', () => {
    // Extract ownerParentRoute function logic using VM
    const mockStorage = new Map();
    const context = {
      window: {
        location: { hash: '#catalog/categories/cat-123' },
        _ownerMasterMenuState: {
          preselectedCategoryId: 'cat-123',
          menus: [{ id: 'menu-456', category_id: 'cat-123', name: 'Kentang Goreng' }]
        },
        XentraNavigationController: {
          getSnapshot() {
            return { route: 'catalog/categories/cat-123', stack: ['business', 'business/catalog', 'catalog/categories', 'catalog/categories/cat-123'] };
          }
        }
      },
      sessionStorage: {
        getItem(k) { return mockStorage.get(k) || null; },
        setItem(k, v) { mockStorage.set(k, v); }
      },
      isPlatformContext() { return false; },
      canonicalizeOwnerRoute(r) { return r; }
    };

    // Extract ownerParentRoute snippet from dashboard.js
    const match = dashboardJs.match(/function ownerParentRoute\s*\(route\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(match, 'ownerParentRoute function must exist in dashboard.js');

    const fnBody = match[1];
    global.window = context.window;
    global.sessionStorage = context.sessionStorage;
    const testFn = (route) => {
      const fn = new Function('route', 'isPlatformContext', 'canonicalizeOwnerRoute', fnBody);
      return fn.call(context, route, () => false, (r) => r);
    };

    // Test 1a: With preselectedCategoryId in _ownerMasterMenuState
    const parentWithState = testFn('catalog/master-menus/menu-456/edit');
    assert.strictEqual(parentWithState, 'catalog/categories/cat-123',
      'Parent of menu editor must be the category detail page when preselectedCategoryId is set');

    // Test 1b: With sessionStorage fallback
    context.window._ownerMasterMenuState.preselectedCategoryId = null;
    mockStorage.set('xentra_owner_last_category_id', 'cat-789');
    const parentWithStorage = testFn('catalog/master-menus/menu-456/edit');
    assert.strictEqual(parentWithStorage, 'catalog/categories/cat-789',
      'Parent of menu editor must use sessionStorage last category id fallback');

    // Test 1c: Fallback to category list if no specific category id
    mockStorage.clear();
    context.window._ownerMasterMenuState.menus = [];
    const parentFallback = testFn('catalog/master-menus/menu-456/edit');
    assert.strictEqual(parentFallback, 'catalog/categories',
      'Parent of menu editor must default to catalog/categories when accessed in category context');

    // Test 1d: When accessed explicitly from catalog/master-menus desktop tab
    context.window.XentraNavigationController.getSnapshot = () => ({ route: 'catalog/master-menus' });
    const parentLegacy = testFn('catalog/master-menus/menu-456/edit');
    assert.strictEqual(parentLegacy, 'catalog/master-menus',
      'Parent of menu editor should remain catalog/master-menus if caller was on legacy master menu tab');

    delete global.window;
    delete global.sessionStorage;
  });

  await t.test('2. owner-navigation.js pushes menu editor onto category stack and unwinds back to category on popstate', () => {
    const listeners = {};
    const historyStack = [];
    let stateIndex = -1;

    const mockHistory = {
      get state() {
        return stateIndex >= 0 ? historyStack[stateIndex].state : null;
      },
      pushState(state, title, url) {
        historyStack.splice(stateIndex + 1);
        historyStack.push({ state, url });
        stateIndex = historyStack.length - 1;
        mockLocation.hash = url || mockLocation.hash;
      },
      replaceState(state, title, url) {
        if (stateIndex >= 0) {
          historyStack[stateIndex] = { state, url };
        } else {
          historyStack.push({ state, url });
          stateIndex = 0;
        }
        mockLocation.hash = url || mockLocation.hash;
      },
      back() {
        if (stateIndex > 0) {
          stateIndex--;
          mockLocation.hash = historyStack[stateIndex].url;
          if (listeners.popstate) {
            listeners.popstate({ state: historyStack[stateIndex].state });
          }
        }
      }
    };

    const mockLocation = { hash: '#business' };

    let currentRendered = null;

    const win = {
      history: mockHistory,
      location: mockLocation,
      navigator: { userAgent: 'Mozilla/5.0' },
      __xentraNavigationListenersBound: false,
      addEventListener(evt, fn) {
        listeners[evt] = fn;
      },
      removeEventListener() {}
    };

    vm.runInNewContext(navEngineJs, { window: win, console }, { filename: 'owner-navigation.js' });

    const controller = win.XentraNavigationController;
    controller.configure({
      canonicalize(r) { return r; },
      isRootRoute(r) { return r === 'business'; },
      parentRoute(r) {
        if (r === 'catalog/master-menus/menu-1/edit' || r === 'catalog/master-menus/new') {
          return 'catalog/categories/cat-food';
        }
        if (r === 'catalog/categories/cat-food') return 'catalog/categories';
        if (r === 'catalog/categories') return 'business/catalog';
        if (r === 'business/catalog') return 'business';
        return null;
      },
      defaultRoute: 'business',
      getRoute() { return mockLocation.hash.replace(/^#\/?/, ''); },
      renderRoute(r) { currentRendered = r; }
    });

    controller.initialize();

    // User navigates from Business -> CatalogSubHub -> Categories -> Category Detail
    controller.navigate('business/catalog');
    controller.navigate('catalog/categories');
    controller.navigate('catalog/categories/cat-food');

    assert.strictEqual(currentRendered, 'catalog/categories/cat-food');
    assert.deepEqual(controller.getSnapshot().stack, [
      'business',
      'business/catalog',
      'catalog/categories',
      'catalog/categories/cat-food'
    ]);

    // User taps menu card: navigates to edit menu
    controller.navigate('catalog/master-menus/menu-1/edit', { history: 'push' });

    assert.strictEqual(currentRendered, 'catalog/master-menus/menu-1/edit');
    assert.deepEqual(controller.getSnapshot().stack, [
      'business',
      'business/catalog',
      'catalog/categories',
      'catalog/categories/cat-food',
      'catalog/master-menus/menu-1/edit'
    ], 'Menu editor route must be pushed on top of category detail');

    // Simulate mobile gesture hand swipe left back (browser history.back() triggering popstate)
    mockHistory.back();

    assert.strictEqual(currentRendered, 'catalog/categories/cat-food',
      'Gesture hand swipe left (popstate) must return to Category Detail page, NOT Menu Master');
    assert.deepEqual(controller.getSnapshot().stack, [
      'business',
      'business/catalog',
      'catalog/categories',
      'catalog/categories/cat-food'
    ], 'Stack must cleanly unwind back to Category Detail');
  });

  await t.test('3. compiled bundle contains push option and sessionStorage category persistence', () => {
    assert.ok(bundleJs.includes('xentra_owner_last_category_id'),
      'Production bundle must persist last active category ID in sessionStorage');
    assert.ok(bundleJs.includes('catalog/master-menus/new') && bundleJs.includes('history:"push"'),
      'Production bundle must forward push option when opening menu editor');
  });
});
