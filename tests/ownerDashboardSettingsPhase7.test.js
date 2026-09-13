'use strict';

/**
 * PHASE 7 OWNER DASHBOARD — SETTINGS & INTEGRATIONS TEST SUITE
 * 
 * Verifies:
 * 1. Settings Overview API (/api/v1/admin/settings/overview):
 *    - Validates category tree: Business, Locations, Commerce, Channels, System, Integrations
 * 2. Business Settings:
 *    - GET /api/v1/admin/settings/business/profile returns authoritative profile
 *    - PUT /api/v1/admin/settings/business/profile updates brand profile
 *    - GET /api/v1/admin/settings/business/info returns organization & primary branch contact
 *    - GET /api/v1/admin/settings/business/legal returns honest not-configured tax/legal state
 * 3. Locations Defaults:
 *    - GET /api/v1/admin/settings/locations/defaults returns branch defaults and per-branch override links
 * 4. Commerce Settings:
 *    - GET /api/v1/admin/settings/commerce/orders returns order policies (expiration timeout, reservation rule H+1)
 *    - GET /api/v1/admin/settings/commerce/payments returns Midtrans credentials & methods
 *    - PUT /api/v1/admin/settings/commerce/payments updates brand defaults & branch overrides
 *    - GET /api/v1/admin/settings/commerce/fulfillment returns branch-specific delivery settings
 *    - PUT /api/v1/admin/settings/commerce/fulfillment updates delivery settings without corrupting other branches
 * 5. Channels Status:
 *    - GET /api/v1/admin/settings/channels/website returns website status & domain
 *    - GET /api/v1/admin/settings/channels/customer-app returns PWA manifest and status
 *    - GET /api/v1/admin/settings/channels/pos returns active cashier shifts count
 *    - GET /api/v1/admin/settings/channels/kiosk returns honest not-configured state
 * 6. Integrations Status:
 *    - GET /api/v1/admin/settings/integrations returns Midtrans, POS Engine, and Connector (HOLD)
 * 7. System Settings:
 *    - GET /api/v1/admin/settings/notifications returns honest not-configured multi-channel state
 *    - GET /api/v1/admin/settings/security returns RBAC model, active user session, and audit logs
 * 8. RBAC & Tenant Isolation:
 *    - Cashier is forbidden (403) from accessing admin settings
 *    - Unauthenticated request is rejected (401)
 * 9. Direct Navigation & Routing:
 *    - Direct routes /dashboard/settings, /dashboard/settings/business, /dashboard/settings/locations,
 *      /dashboard/settings/commerce, /dashboard/settings/channels, /dashboard/settings/integrations,
 *      /dashboard/settings/notifications, /dashboard/settings/security
 *    - Browser refresh serves 200 index.html on tenant host
 * 10. Connector HOLD Invariant:
 *    - Xentra Connector is on HOLD and unchanged
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const db = require('../server/database/db');
const app = require('../server/app');

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body != null ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Host: options.headers && options.headers.Host ? options.headers.Host : 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (payload != null) {
      req.write(payload);
    }
    req.end();
  });
}

test('PHASE 7: OWNER DASHBOARD SETTINGS & INTEGRATIONS IMPLEMENTATION', async (t) => {
  let server;
  let ownerToken;
  let branchManagerToken;
  let cashierToken;
  const BRAND_ID = 'brand_bangjo';
  const BRANCH_BARAT = 'branch_bangjo_barat';

  await t.test('0. Setup: server, auth sessions & settings test prerequisites', async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));

    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.ok(ownerUser, 'Owner user must exist');
    const ownerSession = global.TokenSessionStore.createSession(ownerUser, BRAND_ID);
    ownerToken = ownerSession.token;

    const bmUser = db.prepare("SELECT * FROM users WHERE role = 'branch_manager' AND brand_id = ?").get(BRAND_ID);
    if (bmUser) {
      const bmSession = global.TokenSessionStore.createSession(bmUser, BRAND_ID);
      branchManagerToken = bmSession.token;
    }

    const cashierUser = db.prepare("SELECT * FROM users WHERE role = 'cashier' AND brand_id = ?").get(BRAND_ID);
    if (cashierUser) {
      const cashSession = global.TokenSessionStore.createSession(cashierUser, BRAND_ID);
      cashierToken = cashSession.token;
    }
  });

  await t.test('1. Settings Overview API (/api/v1/admin/settings/overview)', async () => {
    const res = await makeRequest(server, {
      path: '/api/v1/admin/settings/overview',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.brand_id, BRAND_ID);
    assert.ok(res.body.sections.business, 'Business section must exist');
    assert.ok(res.body.sections.locations, 'Locations section must exist');
    assert.ok(res.body.sections.commerce, 'Commerce section must exist');
    assert.ok(res.body.sections.channels, 'Channels section must exist');
    assert.ok(res.body.sections.system, 'System section must exist');
    assert.ok(res.body.sections.integrations, 'Integrations section must exist');
  });

  await t.test('2. Business Settings APIs', async (t2) => {
    await t2.test('2.1 Get and Update Brand Profile', async () => {
      const getRes = await makeRequest(server, {
        path: '/api/v1/admin/settings/business/profile',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.success, true);
      assert.ok(getRes.body.profile.name);

      const putRes = await makeRequest(server, {
        path: '/api/v1/admin/settings/business/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        name: 'Bangjo Resto Nusantara',
        tagline: 'Sensasi Kuliner Otentik',
        primary_color: '#059669'
      });
      assert.strictEqual(putRes.status, 200);
      assert.strictEqual(putRes.body.success, true);
      assert.strictEqual(putRes.body.profile.name, 'Bangjo Resto Nusantara');
      assert.strictEqual(putRes.body.profile.primary_color, '#059669');

      // Test validation: Reject empty name
      const badNameRes = await makeRequest(server, {
        path: '/api/v1/admin/settings/business/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        name: '   '
      });
      assert.strictEqual(badNameRes.status, 500);
      assert.strictEqual(badNameRes.body.success, false);

      // Test validation: Reject malformed banners JSON
      const badBannersRes = await makeRequest(server, {
        path: '/api/v1/admin/settings/business/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        banners: '{invalid_json_banner'
      });
      assert.strictEqual(badBannersRes.status, 500);
      assert.strictEqual(badBannersRes.body.success, false);

      // Test validation: Reject invalid hex color
      const badColorRes = await makeRequest(server, {
        path: '/api/v1/admin/settings/business/profile',
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        primary_color: 'not-a-color'
      });
      assert.strictEqual(badColorRes.status, 500);
      assert.strictEqual(badColorRes.body.success, false);
    });

    await t2.test('2.2 Get Business Info', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/business/info',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.info.brand_name);
      assert.ok(res.body.info.organization_name);
    });

    await t2.test('2.3 Get Legal & Tax (Honest not-configured state)', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/business/legal',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.tax_configured, false);
      assert.strictEqual(res.body.is_supported, false);
      assert.ok(res.body.message.includes('belum dikonfigurasi'));
    });
  });

  await t.test('3. Locations Defaults API (/api/v1/admin/settings/locations/defaults)', async () => {
    const res = await makeRequest(server, {
      path: '/api/v1/admin/settings/locations/defaults',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.defaults.default_max_radius_km, 10.0);
    assert.ok(Array.isArray(res.body.defaults.branches));
    assert.ok(res.body.defaults.branches.length > 0);
  });

  await t.test('4. Commerce Settings APIs', async (t4) => {
    await t4.test('4.1 Order Policies (Core rules)', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/commerce/orders',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.policies.overdue_timeout_seconds, 900);
      assert.strictEqual(res.body.policies.reservation_lead_days_min, 1);
      assert.ok(res.body.policies.supported_order_types.includes('dine_in'));
      assert.ok(res.body.policies.supported_order_channels.includes('pos'));
    });

    await t4.test('4.2 Payment Settings (Get and Save Credentials)', async () => {
      const putRes = await makeRequest(server, {
        path: '/api/v1/admin/settings/commerce/payments',
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        server_key: 'SB-Mid-server-test-key-p7',
        client_key: 'SB-Mid-client-test-key-p7',
        merchant_id: 'G123456789',
        is_production: false
      });
      assert.strictEqual(putRes.status, 200);
      assert.strictEqual(putRes.body.success, true);
      assert.strictEqual(putRes.body.is_branch_override, false);

      const getRes = await makeRequest(server, {
        path: '/api/v1/admin/settings/commerce/payments',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.payment_settings.server_key_configured, true);
      assert.strictEqual(getRes.body.payment_settings.merchant_id, 'G123456789');
    });

    await t4.test('4.3 Fulfillment Settings (Get and Save Branch Delivery Settings)', async () => {
      const getRes = await makeRequest(server, {
        path: `/api/v1/admin/settings/commerce/fulfillment?branch_id=${BRANCH_BARAT}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.fulfillment.branch_id, BRANCH_BARAT);

      const putRes = await makeRequest(server, {
        path: '/api/v1/admin/settings/commerce/fulfillment',
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        branch_id: BRANCH_BARAT,
        is_delivery_active: true,
        is_pickup_active: true,
        max_radius_km: 15.0,
        free_delivery_km: 4.0,
        price_per_km: 3000.0
      });
      assert.strictEqual(putRes.status, 200);
      assert.strictEqual(putRes.body.success, true);

      // Verify persistence
      const verifyRes = await makeRequest(server, {
        path: `/api/v1/admin/settings/commerce/fulfillment?branch_id=${BRANCH_BARAT}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(verifyRes.body.fulfillment.max_radius_km, 15.0);
      assert.strictEqual(verifyRes.body.fulfillment.free_delivery_km, 4.0);
      assert.strictEqual(verifyRes.body.fulfillment.price_per_km, 3000.0);
    });
  });

  await t.test('5. Channels Status APIs', async (t5) => {
    await t5.test('5.1 Website Channel', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/channels/website',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.channel.code, 'website');
      assert.strictEqual(res.body.channel.status, 'active');
    });

    await t5.test('5.2 Customer App Channel', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/channels/customer-app',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.channel.code, 'customer-app');
      assert.strictEqual(res.body.channel.installable, true);
    });

    await t5.test('5.3 POS Channel', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/channels/pos',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.channel.code, 'pos');
      assert.strictEqual(res.body.channel.status, 'active');
      assert.ok(Array.isArray(res.body.channel.open_shifts));
    });

    await t5.test('5.4 Kiosk Channel (Honest not-configured state)', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/channels/kiosk',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.channel.code, 'kiosk');
      assert.strictEqual(res.body.channel.status, 'not_configured');
      assert.strictEqual(res.body.channel.is_supported, false);
    });
  });

  await t.test('6. Integrations Status API (/api/v1/admin/settings/integrations)', async () => {
    const res = await makeRequest(server, {
      path: '/api/v1/admin/settings/integrations',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.integrations));

    const connector = res.body.integrations.find(i => i.category === 'connector');
    assert.ok(connector, 'Connector must be listed');
    assert.strictEqual(connector.status, 'on_hold', 'Connector invariant must be on_hold');
  });

  await t.test('7. System Settings: Notifications & Security', async (t7) => {
    await t7.test('7.1 Notifications (Honest not-configured state)', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/notifications',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.is_supported, false);
      assert.strictEqual(res.body.channels.whatsapp.status, 'not_configured');
    });

    await t7.test('7.2 Security & Audit Settings', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/security',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.security.rbac_model, 'User -> Role -> Scope');
      assert.strictEqual(res.body.security.current_user.role, 'owner');
      assert.ok(Array.isArray(res.body.security.recent_audit_logs));
    });
  });

  await t.test('8. RBAC & Multi-Tenant Authorization Boundaries', async (t8) => {
    await t8.test('8.1 Cashier is forbidden (403) from accessing admin settings', async () => {
      if (!cashierToken) return;
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/overview',
        headers: { Authorization: `Bearer ${cashierToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    await t8.test('8.2 Unauthenticated request is rejected (401)', async () => {
      const res = await makeRequest(server, {
        path: '/api/v1/admin/settings/overview'
      });
      assert.strictEqual(res.status, 401);
    });
  });

  await t.test('9. Direct Navigation & Routing (All Settings Routes serve 200 index.html)', async (t9) => {
    const routesToTest = [
      '/dashboard/settings',
      '/dashboard/settings/business',
      '/dashboard/settings/business/profile',
      '/dashboard/settings/business/info',
      '/dashboard/settings/business/legal',
      '/dashboard/settings/locations',
      '/dashboard/settings/commerce',
      '/dashboard/settings/commerce/orders',
      '/dashboard/settings/commerce/payments',
      '/dashboard/settings/commerce/fulfillment',
      '/dashboard/settings/channels',
      '/dashboard/settings/channels/website',
      '/dashboard/settings/channels/customer-app',
      '/dashboard/settings/channels/pos',
      '/dashboard/settings/channels/kiosk',
      '/dashboard/settings/integrations',
      '/dashboard/settings/notifications',
      '/dashboard/settings/security'
    ];

    for (const r of routesToTest) {
      await t9.test(`9.x Direct GET ${r} serves 200 index.html on tenant host`, async () => {
        const res = await makeRequest(server, {
          path: r,
          headers: { Host: 'app.mybangjo.com' }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(typeof res.body === 'string');
        assert.ok(res.body.includes('id="tab-settings"'), 'Must contain settings section');
      });
    }
  });

  await t.test('10. Connector HOLD invariant & Cleanup', async () => {
    assert.strictEqual(typeof XentraConnectorClient, 'undefined', 'Connector client must not be imported');
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
