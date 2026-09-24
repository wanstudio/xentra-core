const { describe, it } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('POS ↔ Merchant App surface boundary', () => {
  it('has a standalone POS application with execution-first navigation', () => {
    const html = read('apps/pos-app/index.html');
    assert.ok(html.includes('id="pos-view-kasir"'));
    assert.ok(html.includes('id="pos-view-transaksi"'));
    assert.ok(html.includes('id="pos-view-meja"'));
    assert.ok(html.includes('id="pos-view-shift"'));
    assert.ok(html.includes('data-view="kasir"'));
    assert.ok(html.includes('data-view="transaksi"'));
    assert.ok(html.includes('data-view="meja"'));
    assert.ok(html.includes('data-view="shift"'));
    assert.ok(!html.includes('data-view="menu"'), 'POS must not expose branch menu management as navigation');
    assert.ok(!html.includes('data-view="promo"'), 'POS must not expose promotion governance as navigation');
    assert.ok(!html.includes('data-view="stok"'), 'POS must not expose stock management as navigation');
    assert.ok(!html.includes('data-view="staff"'), 'POS must not expose staff administration as navigation');
    assert.ok(!html.includes('data-view="jam-operasional"'), 'POS must not expose operating-hours administration as navigation');
  });

  it('keeps Merchant App management navigation separate from cashier workflow', () => {
    const html = read('apps/merchant-app/index.html');
    assert.ok(html.includes('id="bm-stock-search"'), 'Merchant App keeps branch stock management');
    assert.ok(html.includes('id="modal-bm-add-cashier"'), 'Merchant App keeps workforce/cashier management');
    assert.ok(html.includes('bm-menu-search'), 'Merchant App keeps branch menu management');
    assert.ok(html.includes('bm-promo'), 'Merchant App keeps promotion operations');
  });

  it('routes cashier to POS and Branch Manager to Merchant App', () => {
    const auth = read('server/routes/merchant-auth.js');
    assert.ok(auth.includes("case 'branch_manager':\n        return '/merchant/';"));
    assert.ok(auth.includes("case 'cashier':\n        // Cashier owns the transaction-execution surface; management stays in Merchant App.\n        return '/pos/';"));
  });

  it('prevents operational roles from using the Owner Dashboard as a fallback surface', () => {
    const dashboard = read('apps/merchant-dashboard/assets/js/dashboard.js');
    assert.ok(dashboard.includes("var enforceSurface = _shared.enforceSurface || window.XentraShared.enforceSurface;"));
    assert.ok(dashboard.includes("enforceSurface(['/owner/', '/dashboard/', '/dashboard']);"));
  });

  it('serves the standalone POS surface', () => {
    const app = read('server/app.js');
    assert.ok(app.includes("app.use('/pos/assets'"));
    assert.ok(app.includes("path.join(__dirname, '../apps/pos-app/assets')"));
    assert.ok(app.includes("path.join(__dirname, '../apps/pos-app/index.html')"));
  });

  it('exposes cashier POS execution endpoints and leaves terminal registration managerial', () => {
    const pos = read('server/routes/pos.js');
    assert.ok(pos.includes("router.post('/pos/sales', requireAuth(['cashier'])"));
    assert.ok(pos.includes("router.get('/pos/sales', requireAuth(['cashier'])"));
    assert.ok(pos.includes("router.get('/pos/held-orders', requireAuth(['cashier'])"));
    assert.ok(pos.includes("router.post('/pos/held-orders', requireAuth(['cashier'])"));
    assert.ok(pos.includes("router.get('/pos/orders/:id/receipt', requireAuth(['cashier'])"));
    assert.ok(pos.includes("router.get('/pos/terminal/current', requireAuth(['cashier'])"));
    assert.ok(pos.includes("router.post('/pos/terminal/register', requireAuth(['owner', 'brand_manager', 'branch_manager'])"));
  });

  it('connects POS frontend to Sale, Shift, Table, Offline and Receipt contracts', () => {
    const js = read('apps/pos-app/assets/js/pos-app.js');
    for (const endpoint of [
      '/pos/sales',
      '/pos/shifts/current',
      '/pos/shifts/open',
      '/pos/shifts/',
      '/pos/held-orders',
      '/pos/orders/',
      '/pos/terminal/current',
      '/pos/local/sale',
      '/pos/local/sync-outbox',
      '/dine-in/layout',
      '/catalog/menu'
    ]) {
      assert.ok(js.includes(endpoint), 'missing POS contract: ' + endpoint);
    }
  });

  it('does not couple POS frontend to merchant-specific surface modules', () => {
    const js = read('apps/pos-app/assets/js/pos-app.js');
    assert.ok(!js.includes('XentraMerchantBranchCatalog'));
    assert.ok(!js.includes('merchant-app/assets'));
    assert.ok(!js.includes('bm-'));
  });
});
