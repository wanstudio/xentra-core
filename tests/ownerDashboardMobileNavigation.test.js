'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '../apps/merchant-dashboard/index.html');
const CSS_PATH = path.join(__dirname, '../apps/merchant-shared/css/dashboard.css');
const JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');
const NAV_JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/owner-bottom-nav.js');
const NAV_ENGINE_JS_PATH = path.join(__dirname, '../apps/merchant-dashboard/assets/js/owner-navigation.js');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const js = fs.readFileSync(JS_PATH, 'utf8');
const navJs = fs.readFileSync(NAV_JS_PATH, 'utf8');
const navEngineJs = fs.readFileSync(NAV_ENGINE_JS_PATH, 'utf8');

test('Owner Dashboard Mobile Navigation', async t => {

  // --------------------------------------------------------------------------
  // HTML structure
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-01: bottom nav element exists with correct id', () => {
    assert.ok(html.includes('id="x-owner-bottom-nav"'),
      'x-owner-bottom-nav nav must exist');
  });

  await t.test('OWNER-MOB-02: bottom nav has exactly 5 nav items', () => {
    const matches = html.match(/class="x-owner-nav-item[^"]*"/g) || [];
    assert.strictEqual(matches.length, 5,
      `Expected 5 .x-owner-nav-item elements, got ${matches.length}`);
  });

  await t.test('OWNER-MOB-03: bottom nav labels match contract (Beranda, Bisnis, Pesanan, Keuangan, Lainnya)', () => {
    const required = ['Beranda', 'Bisnis', 'Pesanan', 'Keuangan', 'Lainnya'];
    for (const label of required) {
      assert.ok(html.includes(label),
        `Bottom nav label "${label}" must be present in HTML`);
    }
  });

  await t.test('OWNER-MOB-04: each bottom nav item has data-route attribute', () => {
    // data-route drives navigateTo
    const navSection = html.substring(
      html.indexOf('id="x-owner-bottom-nav"'),
      html.indexOf('</nav>', html.indexOf('id="x-owner-bottom-nav"')) + 6
    );
    const routeAttrs = navSection.match(/data-route="[^"]+"/g) || [];
    assert.strictEqual(routeAttrs.length, 5,
      `Expected 5 data-route attrs in bottom nav, got ${routeAttrs.length}`);
  });

  await t.test('OWNER-MOB-05: each bottom nav item has data-tab-module attribute for active sync', () => {
    const navSection = html.substring(
      html.indexOf('id="x-owner-bottom-nav"'),
      html.indexOf('</nav>', html.indexOf('id="x-owner-bottom-nav"')) + 6
    );
    const moduleAttrs = navSection.match(/data-tab-module="[^"]+"/g) || [];
    assert.strictEqual(moduleAttrs.length, 5,
      `Expected 5 data-tab-module attrs in bottom nav, got ${moduleAttrs.length}`);
  });

  await t.test('OWNER-MOB-06: bottom nav routes map to correct modules (beranda, bisnis, pesanan, keuangan, lainnya)', () => {
    const navSection = html.substring(
      html.indexOf('id="x-owner-bottom-nav"'),
      html.indexOf('</nav>', html.indexOf('id="x-owner-bottom-nav"')) + 6
    );
    const expectedModules = ['beranda', 'bisnis', 'pesanan', 'keuangan', 'lainnya'];
    for (const mod of expectedModules) {
      assert.ok(navSection.includes(`data-tab-module="${mod}"`),
        `Bottom nav must have data-tab-module="${mod}"`);
    }
  });

  // --------------------------------------------------------------------------
  // Focus selector (branch context)
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-07: Focus selector element (#x-branch-selector) exists in topbar', () => {
    assert.ok(html.includes('id="x-branch-selector"') || html.includes('id="x-topbar-focus-scope"'),
      'Focus selector wrapper must exist in topbar');
  });

  await t.test('OWNER-MOB-08: Focus selector uses existing dash-branch-context select', () => {
    assert.ok(html.includes('id="dash-branch-context"'),
      '#dash-branch-context select must be present (Focus uses existing selector)');
  });

  await t.test('OWNER-MOB-09: Focus selector default option label is Semua Cabang', () => {
    assert.ok(html.includes('Semua Cabang'),
      'Default branch option must read "Semua Cabang"');
  });

  // --------------------------------------------------------------------------
  // Hub sections (Bisnis and Lainnya)
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-10: tab-business hub section exists', () => {
    assert.ok(html.includes('id="tab-business"'),
      'tab-business content section must be present');
  });

  await t.test('OWNER-MOB-11: tab-more hub section exists', () => {
    assert.ok(html.includes('id="tab-more"'),
      'tab-more content section must be present');
  });

  await t.test('OWNER-MOB-11A: Business hub exposes the canonical management groups', () => {
    const business = html.substring(
      html.indexOf('id="tab-business"'),
      html.indexOf('id="tab-more"')
    );
    for (const label of ['Katalog', 'Operasional', 'Pelanggan &amp; Pemasaran', 'Tim &amp; Akses', 'Insight &amp; Laporan', 'Brand']) {
      assert.ok(business.includes(label), 'Business hub must expose section "' + label.replace(/&amp;/g, '&') + '"');
    }
    for (const route of ["catalog/categories", "catalog/products", "stock", "branches", "customers", "marketing", "team", "reports", "settings/business/profile"]) {
      assert.ok(business.includes("navigateTo('" + route + "')"), 'Business hub must expose route "' + route + '"');
    }
    assert.ok(!business.includes('Menu &amp; Paket'), 'Business hub must not expose the old combined Menu & Paket entry');
    assert.ok(!business.includes("navigateTo('catalog/menus')"), 'Branch Menu must not be presented as a Master Catalog hub card');
    assert.ok(business.includes("navigateTo('catalog/products')"), 'Business hub must expose Product Master under Katalog');
    assert.ok(business.includes("navigateTo('catalog/categories')"), 'Business hub must expose Category management');
    const catalogStart = business.indexOf('<h3 class="x-hub-section-title">Katalog');
    const operationalStart = business.indexOf('<h3 class="x-hub-section-title">Operasional');
    const catalog = business.slice(catalogStart, operationalStart);
    assert.ok(catalog.indexOf("navigateTo('catalog/categories')") < catalog.indexOf("navigateTo('catalog/products')"), 'Category must appear above Master Product in Catalog');
    assert.strictEqual((business.match(/navigateTo\('catalog\/products'\)/g) || []).length, 1, 'Catalog hub must expose only one Product Master entry');
  });

  await t.test('OWNER-MOB-11B: More hub is reserved for system/settings/account concerns', () => {
    const more = html.substring(
      html.indexOf('id="tab-more"'),
      html.indexOf('id="tab-platform-overview"')
    );
    for (const route of ["settings", "settings/integrations", "settings/notifications", "settings/security"]) {
      assert.ok(more.includes("navigateTo('" + route + "')"), 'More hub must expose route "' + route + '"');
    }
    assert.ok(!more.includes("navigateTo('team')"), 'More hub must not duplicate Team');
    assert.ok(!more.includes("navigateTo('reports')"), 'More hub must not duplicate Reports');
    assert.ok(!more.includes("navigateTo('settings/business/profile')"), 'More hub must not duplicate Brand Identity');
  });

  // --------------------------------------------------------------------------
  // Desktop sidebar preservation
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-12: desktop sidebar element is still present', () => {
    assert.ok(html.includes('id="x-dash-sidebar"'),
      'Desktop sidebar must not be removed');
  });

  await t.test('OWNER-MOB-13: desktop sidebar has existing nav items (Overview, Orders)', () => {
    assert.ok(html.includes('data-route="overview"'), 'Sidebar overview nav item must exist');
    assert.ok(html.includes('data-route="orders"'), 'Sidebar orders nav item must exist');
    assert.ok(html.includes('data-route="catalog/menus"') && html.includes('<span>Menu Cabang</span>'), 'Sidebar must label the branch-specific Menu route as Menu Cabang');
  });

  await t.test('OWNER-MOB-13A: redundant sidebar close button is not rendered in Owner Dashboard', () => {
    // Owner mobile drawer already has safe close paths via hamburger, overlay,
    // navigation selection, Escape, and breakpoint handling. Keep the legacy
    // close control out of the Owner DOM; the shared CSS/JS remains available
    // for surfaces that still use the control.
    assert.ok(!html.includes('id="btn-sidebar-close"'),
      'Owner Dashboard must not render the redundant sidebar close button');
  });

  // --------------------------------------------------------------------------
  // Application-shell architecture
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-13B: bottom nav is a direct child of body, outside route content', () => {
    const navStart = html.indexOf('<nav class="x-owner-bottom-nav"');
    const prefix = html.slice(0, navStart);
    const stack = [];
    const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z0-9-]+)(?:\s[^<>]*?)?>/g;
    for (const match of prefix.matchAll(tokenRe)) {
      const raw = match[0];
      const tag = match[1];
      if (!tag || raw.indexOf('<!--') === 0) continue;
      const name = tag.toLowerCase();
      if (raw.indexOf('</') === 0) {
        const idx = stack.lastIndexOf(name);
        if (idx >= 0) stack.splice(idx, 1);
      } else if (!voidTags.has(name) && raw.slice(-2) !== '/>') {
        stack.push(name);
      }
    }
    assert.deepEqual(stack, ['html', 'body'],
      'Bottom nav must be mounted directly under <body>, not inside a route/page container');
  });

  await t.test('OWNER-MOB-13C: bottom nav controller is a dedicated module', () => {
    assert.ok(html.includes('/merchant-dashboard/assets/js/owner-bottom-nav.js?v=1.0.0'),
      'Dedicated owner-bottom-nav.js module must be loaded');
    assert.ok(navJs.includes('function initOwnerBottomNav()'), 'Dedicated module must own bottom-nav initialization');
    assert.ok(navJs.includes('function syncOwnerBottomNavActive('), 'Dedicated module must own bottom-nav active-state sync');
    assert.ok(navJs.includes('window.navigateTo(btn.dataset.route)'), 'Dedicated module must delegate to the canonical router');
    assert.ok(!js.includes('var _ownerNavModuleMap'), 'Navigation module map must not live in the monolithic dashboard router');
  });

  await t.test('OWNER-MOB-13D: dashboard router remains the single navigation authority', () => {
    assert.ok(js.includes('syncOwnerBottomNavActive(route)'), 'dashboard.js must consume shell navigation state from the canonical route');
    assert.ok(navJs.includes('window.navigateTo(btn.dataset.route)'), 'Bottom nav must call the existing router, not implement a second router');
  });

  // --------------------------------------------------------------------------
  // CSS
  // --------------------------------------------------------------------------
  await t.test('OWNER-MOB-14C: centralized navigation engine is loaded before dashboard router', () => {
    assert.ok(html.includes('/merchant-dashboard/assets/js/owner-navigation.js?v=1.0.0'),
      'Owner Dashboard must load the centralized navigation engine');
    assert.ok(navEngineJs.includes('window.XentraNavigationController ='),
      'Navigation engine must expose one canonical controller');
    assert.ok(navEngineJs.includes('function navigate(route, options)'),
      'Engine must own route transition semantics');
    assert.ok(navEngineJs.includes('function back()'),
      'Engine must own Back semantics');
    assert.ok(navEngineJs.includes('function syncFromLocation()'),
      'Engine must synchronize manual/direct URL changes');
  });

  await t.test('OWNER-MOB-14D: dashboard no longer owns page-specific history mutations', () => {
    const navStart = js.indexOf('function configureOwnerNavigationEngine()');
    const navEnd = js.indexOf('  // Render Platform Navigation in Sidebar', navStart);
    const navBlock = js.slice(navStart, navEnd);

    assert.ok(navBlock.includes('XentraNavigationController.configure'),
      'Dashboard must configure the centralized engine');
    assert.ok(navBlock.includes('XentraNavigationController.navigate'),
      'Dashboard navigateTo must delegate to the engine');
    assert.ok(navBlock.includes('XentraNavigationController.back'),
      'Dashboard Back must delegate to the engine');
    assert.equal((navBlock.match(/window\.history\.(pushState|replaceState|back|go)\(/g) || []).length, 0,
      'Dashboard navigation adapter must not mutate browser history directly');
    assert.ok(!js.includes('OWNER_NAV_STATE_KEY'),
      'Navigation state storage must not live in the monolithic dashboard router');
    assert.ok(!js.includes('function commitOwnerBackRoute'),
      'Page-specific Back commit helper must be removed');
  });

  await t.test('OWNER-MOB-14E: route hierarchy is centralized in one navigation configuration', () => {
    const navStart = js.indexOf('var OWNER_ROUTE_ALIASES = {');
    const navEnd = js.indexOf('function configureOwnerNavigationEngine()', navStart);
    const configBlock = js.slice(navStart, navEnd);

    for (const route of [
      "catalog/products/new",
      "catalog/products",
      "catalog/categories",
      "branches",
      "customers",
      "orders",
      "reports",
      "team",
      "stock",
      "finance/overview",
      "marketing/promotions",
      "settings",
      "business",
      "more"
    ]) {
      assert.ok(configBlock.includes(route),
        'Navigation route hierarchy must know "' + route + '"');
    }
    assert.ok(configBlock.includes("return 'catalog/products';"),
      'Add Product must resolve to Product Master');
    assert.ok(configBlock.includes("return 'business';"),
      'Business-owned child pages must resolve to Business');
  });

  await t.test('OWNER-MOB-14F: engine behavior is real stack navigation, not page-specific patches', () => {
    const vm = require('node:vm');

    function createHarness(initialHash) {
      const listeners = Object.create(null);
      const entries = [{ state: null, url: initialHash || '#overview' }];
      let index = 0;
      const location = { hash: initialHash || '#overview' };

      function setUrl(url) {
        const hashIndex = String(url).indexOf('#');
        location.hash = hashIndex >= 0 ? String(url).slice(hashIndex) : '';
      }

      const history = {
        get state() {
          return entries[index].state;
        },
        pushState(state, title, url) {
          entries.splice(index + 1);
          entries.push({ state: state, url: url });
          index++;
          setUrl(url);
        },
        replaceState(state, title, url) {
          entries[index] = { state: state, url: url };
          setUrl(url);
        },
        back() {
          this.go(-1);
        },
        go(delta) {
          const next = index + Number(delta || 0);
          if (next < 0 || next >= entries.length || next === index) return;
          index = next;
          setUrl(entries[index].url);
          if (listeners.popstate) listeners.popstate({ state: entries[index].state });
        }
      };

      const window = {
        location,
        history,
        __xentraNavigationListenersBound: false,
        addEventListener(name, fn) {
          listeners[name] = fn;
        }
      };
      const context = { window, console };
      vm.runInNewContext(navEngineJs, context, { filename: 'owner-navigation.js' });
      const controller = window.XentraNavigationController;

      controller.configure({
        canonicalize: route => route,
        isRootRoute: route => route === 'business',
        parentRoute: route => {
          if (route === 'catalog/products') return 'business';
          if (route === 'catalog/products/new') return 'catalog/products';
          if (route === 'catalog/categories') return 'business';
          return null;
        },
        defaultRoute: 'business',
        getRoute: () => location.hash.replace(/^#\/?/, ''),
        renderRoute: route => { window.lastRendered = route; }
      });

      return { controller, history, location, entries, get index() { return index; }, window };
    }

    const h = createHarness('#business');
    h.controller.initialize();
    assert.deepEqual(Array.from(h.controller.getSnapshot().stack), ['business']);

    h.controller.navigate('catalog/products');
    assert.deepEqual(Array.from(h.controller.getSnapshot().stack), ['business', 'catalog/products']);

    h.controller.navigate('catalog/products/new');
    assert.deepEqual(
      Array.from(h.controller.getSnapshot().stack),
      ['business', 'catalog/products', 'catalog/products/new']
    );

    h.controller.back();
    assert.equal(h.window.lastRendered, 'catalog/products');
    assert.deepEqual(Array.from(h.controller.getSnapshot().stack), ['business', 'catalog/products']);

    h.controller.back();
    assert.equal(h.window.lastRendered, 'business');
    assert.deepEqual(Array.from(h.controller.getSnapshot().stack), ['business']);

    const deep = createHarness('#catalog/products/new');
    deep.controller.initialize();
    assert.deepEqual(
      Array.from(deep.controller.getSnapshot().stack),
      ['business', 'catalog/products', 'catalog/products/new']
    );
    deep.controller.back();
    assert.equal(deep.window.lastRendered, 'catalog/products');
  });

  await t.test('OWNER-MOB-14A: all focused child pages use the shared mobile Back header', () => {
    const requiredSelectors = [
      'id="branch-detail-view"',
      'id="order-detail-view"',
      'id="product-detail-view"',
      'id="product-editor-view"',
      'id="customers-detail-view"',
      'id="branch-editor-view"',
      'id="tab-catalog-menus"'
    ];
    for (const marker of requiredSelectors) {
      assert.ok(html.includes(marker), 'Child surface marker must exist: ' + marker);
    }

    const childHeaderCount = (html.match(/class="x-owner-child-mobile-header/g) || []).length;
    assert.ok(childHeaderCount >= 6, 'Focused child pages must expose the shared mobile header shell');

    assert.ok(html.includes('x-owner-page-back-icon'), 'Shared child headers must use the chevron Back icon');
    assert.equal((html.match(/(?:←|&larr;)/g) || []).length, 0, 'Owner Dashboard must not keep arrow glyphs in Back controls');
  });

  await t.test('OWNER-MOB-14A1: Product Master child Back uses the centralized navigation engine', () => {
    assert.ok(js.includes('window.goBackFromChildPage = function ()'),
      'Child Back must use the canonical dashboard adapter');
    const adapterStart = js.indexOf('window.goBackFromChildPage = function ()');
    const adapterEnd = js.indexOf('window.goBackFromMasterProducts', adapterStart);
    const adapter = js.slice(adapterStart, adapterEnd);
    assert.ok(adapter.includes('XentraNavigationController.back()'),
      'Child Back must delegate to the centralized navigation engine');
    assert.equal((adapter.match(/window\.history\.(pushState|replaceState|back|go)\(/g) || []).length, 0,
      'Dashboard child Back adapter must not mutate browser history directly');

    const configStart = js.indexOf('var OWNER_ROUTE_ALIASES = {');
    const configEnd = js.indexOf('function configureOwnerNavigationEngine()', configStart);
    const engine = configStart >= 0 && configEnd > configStart ? js.slice(configStart, configEnd) : '';
    assert.ok(engine.includes("catalog/products/new"),
      'Navigation engine configuration must know Product Editor route');
    assert.ok(engine.includes("return 'catalog/products';"),
      'Product Editor must resolve to Product Master as its parent');
    assert.ok(engine.includes("catalog/products"),
      'Navigation engine configuration must know Product Master route');
    assert.ok(engine.includes("return 'business';"),
      'Product Master must resolve to Business as its parent');

    const vm = require('node:vm');
    const listeners = Object.create(null);
    const entries = [{ state: null, url: '#business' }];
    let index = 0;
    const location = { hash: '#business' };
    const history = {
      get state() { return entries[index].state; },
      pushState(state, title, url) { entries.splice(index + 1); entries.push({ state, url }); index++; location.hash = String(url).slice(String(url).indexOf('#')); },
      replaceState(state, title, url) { entries[index] = { state, url }; location.hash = String(url).slice(String(url).indexOf('#')); },
      back() { this.go(-1); },
      go(delta) { const next = index + Number(delta || 0); if (next < 0 || next >= entries.length || next === index) return; index = next; location.hash = String(entries[index].url).slice(String(entries[index].url).indexOf('#')); if (listeners.popstate) listeners.popstate({ state: entries[index].state }); }
    };
    const window = { location, history, __xentraNavigationListenersBound: false, addEventListener(name, fn) { listeners[name] = fn; } };
    vm.runInNewContext(navEngineJs, { window, console }, { filename: 'owner-navigation.js' });
    const controller = window.XentraNavigationController;
    controller.configure({
      canonicalize: route => route,
      isRootRoute: route => route === 'business',
      parentRoute: route => route === 'catalog/products/new' ? 'catalog/products' : (route === 'catalog/products' ? 'business' : null),
      defaultRoute: 'business',
      getRoute: () => location.hash.replace(/^#\/?/, ''),
      renderRoute: () => {}
    });
    controller.initialize();
    controller.navigate('catalog/products');
    controller.navigate('catalog/products/new');
    assert.deepEqual(controller.getSnapshot().stack, ['business', 'catalog/products', 'catalog/products/new']);
    controller.back();
    assert.deepEqual(controller.getSnapshot().stack, ['business', 'catalog/products']);
  });

  await t.test('OWNER-MOB-14B: child Back behavior is centralized in one router helper', () => {
    assert.ok(js.includes('window.goBackFromChildPage = function ()'),
      'goBackFromChildPage must be the canonical child Back helper');
    assert.ok(js.includes('window.goBackFromMasterProducts = window.goBackFromChildPage'),
      'Legacy Product Master Back alias must use canonical helper');
    assert.ok(js.includes('window.goBackFromCategory = window.goBackFromChildPage'),
      'Legacy Category Back alias must use canonical helper');
    assert.ok(js.includes('window.goBackFromCatalogChild = window.goBackFromChildPage'),
      'Legacy Catalog child Back alias must use canonical helper');
    assert.ok(js.includes('ensureOwnerFeatureMobileHeader('),
      'Focused marketing editors must use the shared child header helper');
  });

  await t.test('OWNER-MOB-14C: shared child header CSS is a single presentation pattern', () => {
    assert.ok(css.includes('.x-owner-child-mobile-header'), 'Shared child header class must exist');
    assert.ok(css.includes('.x-owner-child-legacy-nav'), 'Legacy breadcrumb rows must be retired from the shared child presentation');
    assert.ok(css.includes('.x-owner-page-back-icon'), 'Chevron Back icon must have one shared style');
    assert.ok(css.includes('.x-feature-page-surface > .x-modal-header'), 'Focused feature editor modal headers must yield to the page header on mobile');
  });

  await t.test('OWNER-MOB-15: dense Owner routes have touch-first mobile surface rules', () => {
    assert.ok(css.includes('#orders-list-view .x-table thead'), 'Orders mobile table must transform into cards');
    assert.ok(css.includes('#customers-list-view .x-data-table thead'), 'Customers mobile table must transform into cards');
    assert.ok(css.includes('#tab-settings .settings-sidebar'), 'Settings must have a dedicated mobile navigation surface');
    assert.ok(css.includes('#tab-reports .x-filter-bar'), 'Reports filters must have mobile layout rules');
    assert.ok(css.includes('#tab-marketing .x-stat-grid'), 'Marketing KPI grid must have mobile layout rules');
    assert.ok(css.includes('#tab-branches .x-branches-grid'), 'Branches must use a single-column mobile card grid');
  });

  await t.test('OWNER-MOB-16: mobile route content reserves shell space', () => {
    assert.ok(
      css.includes('body:not(.x-merchant-app) .x-dash-main') &&
      css.includes('padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px))'),
      'Owner route content must reserve space for the persistent bottom navigation'
    );
  });


  await t.test('OWNER-MOB-13E: child page shells match the same page-level surface as Kategori and Produk Master', () => {
    const childShellIds = [
      'product-detail-view',
      'product-editor-view',
      'branch-detail-view',
      'branch-editor-view',
      'order-detail-view',
      'customers-detail-view'
    ];
    for (const id of childShellIds) {
      assert.ok(
        html.includes('id="' + id + '"') && html.includes('id="' + id + '" class="x-card-panel x-owner-child-page-shell'),
        id + ' must use the shared child page shell'
      );
    }
    assert.ok(
      html.includes('class="x-owner-child-page-header-row"'),
      'Branch Menu child header must use the page-level header row, not a card'
    );
    assert.ok(css.includes('.x-owner-child-page-shell.x-card-panel') &&
              css.includes('background: transparent !important') &&
              css.includes('box-shadow: none !important'),
      'Shared child page shell must visually remove the outer card on mobile'
    );
    assert.ok(css.includes('.x-owner-child-legacy-nav') &&
              css.includes('display: none !important'),
      'Legacy breadcrumb/header rows must stay hidden'
    );
  });

  await t.test('OWNER-MOB-14: CSS defines .x-owner-bottom-nav hidden by default', () => {
    assert.ok(css.includes('.x-owner-bottom-nav') && css.includes('display: none'),
      '.x-owner-bottom-nav must be defined in CSS with display:none default');
  });

  await t.test('OWNER-MOB-15: CSS shows .x-owner-bottom-nav at mobile breakpoint', () => {
    assert.ok(css.includes('.x-owner-bottom-nav') && css.includes('display: grid'),
      '.x-owner-bottom-nav must use display:grid inside media query');
  });

  await t.test('OWNER-MOB-16: CSS defines .x-owner-nav-item styles', () => {
    assert.ok(css.includes('.x-owner-nav-item'),
      '.x-owner-nav-item must be styled in CSS');
  });

  await t.test('OWNER-MOB-17: CSS overrides Focus selector display:none on mobile for owner', () => {
    // The CSS must undo the ≤900px and ≤768px hide rules so owner sees focus on mobile
    const afterOwnerNav = css.indexOf('OWNER DASHBOARD — Mobile Bottom Navigation');
    assert.ok(afterOwnerNav !== -1, 'Owner nav section header must exist in CSS');
    const ownerCssSection = css.substring(afterOwnerNav);
    assert.ok(ownerCssSection.includes('#x-branch-selector') &&
              ownerCssSection.includes('display: flex'),
      'Owner mobile section must override #x-branch-selector to display:flex');
  });

  // --------------------------------------------------------------------------
  // JS functions
  // --------------------------------------------------------------------------

  await t.test('OWNER-MOB-18: JS defines initOwnerBottomNav function', () => {
    assert.ok(navJs.includes('function initOwnerBottomNav()'),
      'initOwnerBottomNav must be defined in owner-bottom-nav.js');
  });

  await t.test('OWNER-MOB-19: JS defines syncOwnerBottomNavActive function', () => {
    assert.ok(navJs.includes('function syncOwnerBottomNavActive('),
      'syncOwnerBottomNavActive must be defined in owner-bottom-nav.js');
  });

  await t.test('OWNER-MOB-20: syncOwnerBottomNavActive is called from applyRoute', () => {
    assert.ok(js.includes('syncOwnerBottomNavActive(route)'),
      'syncOwnerBottomNavActive must be called inside applyRoute');
  });

  await t.test('OWNER-MOB-21: initOwnerBottomNav is called during initialization', () => {
    assert.ok(js.includes('initOwnerBottomNav()'),
      'initOwnerBottomNav must be called during app initialization');
  });

  await t.test('OWNER-MOB-22: CLIENT_ROUTE_META includes business and more routes', () => {
    assert.ok(js.includes("'business'") && js.includes("'more'"),
      'CLIENT_ROUTE_META must have business and more route entries');
  });

  await t.test('OWNER-MOB-23: bottom-nav MODULE_MAP covers all 5 modules', () => {
    const modules = ['beranda', 'bisnis', 'pesanan', 'keuangan', 'lainnya'];
    assert.ok(navJs.includes('var MODULE_MAP = {'),
      'Bottom-nav module resolver must keep one canonical MODULE_MAP');
    for (const mod of modules) {
      assert.ok(navJs.includes(`'${mod}'`),
        `MODULE_MAP must include module key '${mod}'`);
    }
  });

  await t.test('OWNER-MOB-24: Bottom nav does NOT drive authorization — no RBAC check in syncOwnerBottomNavActive', () => {
    const fnStart = navJs.indexOf('function syncOwnerBottomNavActive(');
    const fnEnd = navJs.indexOf('\n  }', fnStart) + 4;
    const fnBody = navJs.substring(fnStart, fnEnd);
    assert.ok(!fnBody.includes('isOwner') && !fnBody.includes('isBranchManager') &&
              !fnBody.includes('role'),
      'syncOwnerBottomNavActive must not check roles — Focus is not auth, nav is constant');
  });

});
