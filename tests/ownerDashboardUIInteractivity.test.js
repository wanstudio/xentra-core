const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('CLIENT OWNER DASHBOARD: UI INTERACTIVITY & CSS CONFLICT VERIFICATION', async (t) => {
  const indexHtmlPath = path.join(__dirname, '../apps/merchant-dashboard/index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  const dashboardJsPath = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');
  const dashboardJs = fs.readFileSync(dashboardJsPath, 'utf8');

  const dashboardCssPath = path.join(__dirname, '../apps/merchant-dashboard/assets/css/dashboard.css');
  const dashboardCss = fs.readFileSync(dashboardCssPath, 'utf8');

  await t.test('1. index.html does NOT load conflicting /assets/css/dashboard.css', () => {
    // Ensuring the old PWA dashboard stylesheet is completely removed
    assert.strictEqual(
      indexHtml.includes('href="/assets/css/dashboard.css'),
      false,
      'index.html must not link to /assets/css/dashboard.css which breaks mobile flex navigation'
    );

    // Ensuring the dedicated merchant dashboard stylesheet is loaded
    assert.ok(
      indexHtml.includes('href="/dashboard/assets/css/dashboard.css'),
      'index.html must link to /dashboard/assets/css/dashboard.css'
    );
  });

  await t.test('2. dashboard.css has proper styling for catalog sub-navigation and mobile drawer', () => {
    assert.ok(dashboardCss.includes('.x-nav-sub'), 'dashboard.css must style .x-nav-sub');
    assert.ok(dashboardCss.includes('.x-nav-sub.open'), 'dashboard.css must support .x-nav-sub.open');
    assert.ok(dashboardCss.includes('.x-nav-sub-item'), 'dashboard.css must style .x-nav-sub-item');
    assert.ok(dashboardCss.includes('.x-dash-sidebar.open'), 'dashboard.css must support mobile .x-dash-sidebar.open');
  });

  await t.test('3. dashboard.js has defensive event listener attachments without unhandled TypeError', () => {
    // prod-pricing-mode listener should not be called bare at top-level
    assert.ok(
      !dashboardJs.includes("$('prod-pricing-mode').addEventListener"),
      "dashboard.js must guard $('prod-pricing-mode') and not call bare addEventListener"
    );

    // initBrandListeners must have element existence checks
    assert.ok(
      dashboardJs.includes("if (btnUseBangjo)"),
      "btn-use-bangjo-logo must be guarded"
    );
    assert.ok(
      dashboardJs.includes("if (formBrand)"),
      "form-brand-settings must be guarded"
    );
  });

  await t.test('4. mobile drawer does NOT close when clicking parent expandable items', () => {
    assert.ok(
      dashboardJs.includes('.x-nav-item:not(.x-nav-parent)[data-route]'),
      'Mobile drawer navigation listener must exclude .x-nav-parent'
    );
  });

  await t.test('5. DOM initialization supports readyState checks and navigateTo applies routes reliably', () => {
    assert.ok(
      dashboardJs.includes("if (document.readyState === 'loading')"),
      'dashboard.js must support document.readyState checks'
    );

    assert.ok(
      dashboardJs.includes("applyRoute(route)"),
      'navigateTo must directly invoke applyRoute'
    );
  });
});
