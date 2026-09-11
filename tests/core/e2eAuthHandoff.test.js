'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const db = require('../../server/database/db');
const app = require('../../server/app');
const { HandoffService } = require('../../core/identity');
const axios = require('axios');

process.env.GOOGLE_CLIENT_ID = 'xentra-e2e-client-id.apps.googleusercontent.com';

// Mock registry for Google tokeninfo
const mockGoogleTokens = new Map();
const originalAxiosGet = axios.get;

axios.get = async function(url, config) {
  if (url.includes('oauth2.googleapis.com/tokeninfo')) {
    const idToken = config?.params?.id_token;
    if (mockGoogleTokens.has(idToken)) {
      return { data: mockGoogleTokens.get(idToken) };
    }
  }
  return originalAxiosGet.apply(this, arguments);
};

function formatMockJwt(name) {
  if (typeof name === 'string' && name.includes('.')) return name;
  return `header.${name}.signature`;
}

function registerMockGoogleToken(idToken, payload) {
  const jwt = formatMockJwt(idToken);
  mockGoogleTokens.set(jwt, payload);
  mockGoogleTokens.set(idToken, payload);
  return jwt;
}

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    let finalBody = body;
    if (body && typeof body === 'object') {
      finalBody = { ...body };
      if (finalBody.credential && typeof finalBody.credential === 'string') {
        finalBody.credential = formatMockJwt(finalBody.credential);
      }
      if (finalBody.id_token && typeof finalBody.id_token === 'string') {
        finalBody.id_token = formatMockJwt(finalBody.id_token);
      }
    }
    const payload = finalBody != null ? (typeof finalBody === 'string' ? finalBody : JSON.stringify(finalBody)) : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
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
          body: parsed,
          raw: data
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

describe('Real E2E Auth Flow: xentra.cloud Google Onboard → Handoff → app.mybangjo.com', () => {
  let server;

  beforeEach(async () => {
    // Ensure brand_bangjo custom_domain is app.mybangjo.com
    db.prepare('UPDATE brands SET custom_domain = ? WHERE id = ?').run('app.mybangjo.com', 'brand_bangjo');

    if (!server) {
      server = http.createServer(app);
      await new Promise(resolve => server.listen(0, resolve));
    }
  });

  after(() => {
    if (server) {
      server.close();
    }
  });

  // Flow 1: xentra.cloud → Google Sign-In → onboarding → Xentra session
  test('1. xentra.cloud: Google Sign-In → onboarding → Xentra session', async () => {
    const runId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const googleSub = `google-sub-e2e-${runId}`;
    const googleToken = `google-token-e2e-${runId}`;
    const email = `e2e_owner_${runId}@xentra.cloud`;

    registerMockGoogleToken(googleToken, {
      sub: googleSub,
      email,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'E2E Google Owner'
    });

    // Request from xentra.cloud host to onboarding endpoint
    const onboardRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google-onboard',
      headers: { Host: 'xentra.cloud' }
    }, {
      credential: googleToken,
      business_name: `E2E Resto ${runId}`,
      brand_name: `E2E Resto ${runId}`,
      branch_name: 'Cabang Pusat',
      phone: '08123456789'
    });

    assert.equal(onboardRes.status, 201, `Onboarding failed: ${JSON.stringify(onboardRes.body)}`);
    assert.equal(onboardRes.body.success, true);
    assert.ok(onboardRes.body.token.startsWith('xnt_auth_'), 'Must return standard Xentra session token');
    assert.equal(onboardRes.body.user.email, email);
    assert.equal(onboardRes.body.user.role, 'owner');
    assert.ok(onboardRes.body.brand.id);
  });

  // Flow 2 & 3: xentra.cloud → create handoff → app.mybangjo.com/dashboard
  // Verification: handoff is single-use, expires, and is brand/tenant-bound
  test('2 & 3. xentra.cloud: create handoff → app.mybangjo.com exchange (single-use, expires, tenant-bound)', async () => {
    // 2.1 Authenticate owner on xentra.cloud
    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.ok(ownerUser, 'Bangjo owner must exist in DB');

    // Create session in TokenSessionStore for xentra.cloud control-plane
    const { token: cloudSessionToken } = global.TokenSessionStore.createSession(ownerUser, null);

    // 2.2 Create handoff ticket for brand_bangjo
    const handoffCreateRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/handoff/create',
      headers: {
        Host: 'xentra.cloud',
        Authorization: `Bearer ${cloudSessionToken}`
      }
    }, {
      brand_id: 'brand_bangjo'
    });

    assert.equal(handoffCreateRes.status, 200, `Handoff create failed: ${JSON.stringify(handoffCreateRes.body)}`);
    assert.equal(handoffCreateRes.body.success, true);
    const handoffTicket = handoffCreateRes.body.handoff_ticket;
    assert.ok(handoffTicket.startsWith('xnt_hdf_'), 'Ticket must start with xnt_hdf_ prefix');
    assert.ok(handoffCreateRes.body.redirect_url.includes('app.mybangjo.com/dashboard/?handoff=xnt_hdf_'));
    // CRITICAL: Session token xnt_auth_* is NOT in the redirect URL
    assert.ok(!handoffCreateRes.body.redirect_url.includes('xnt_auth_'), 'Session token must never be in redirect URL');

    // 3.1 Exchange handoff ticket on target domain app.mybangjo.com
    const exchangeRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/handoff/exchange',
      headers: {
        Host: 'app.mybangjo.com'
      }
    }, {
      ticket: handoffTicket
    });

    assert.equal(exchangeRes.status, 200, `Handoff exchange failed: ${JSON.stringify(exchangeRes.body)}`);
    assert.equal(exchangeRes.body.success, true);
    const tenantSessionToken = exchangeRes.body.token;
    assert.ok(tenantSessionToken.startsWith('xnt_auth_'));
    assert.equal(exchangeRes.body.user.id, 'usr_bangjo_owner');

    // Verify brand-bound session can access app.mybangjo.com protected endpoints
    const meRes = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/auth/merchant/me',
      headers: {
        Host: 'app.mybangjo.com',
        Authorization: `Bearer ${tenantSessionToken}`
      }
    });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.id, 'usr_bangjo_owner');

    // 3.2 Verify SINGLE-USE: Replaying the same handoff ticket must fail immediately
    const replayRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/handoff/exchange',
      headers: {
        Host: 'app.mybangjo.com'
      }
    }, {
      ticket: handoffTicket
    });
    assert.equal(replayRes.status, 401, 'Replayed ticket must be rejected');

    // 3.3 Verify TENANT BOUNDARY: Exchanging a ticket for brand A on tenant domain B must fail
    // Create a new brand B in DB
    const brandBId = 'brand_other_tenant';
    const orgBId = 'org_other_tenant';
    db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Other Org', 'other-org')").run(orgBId);
    db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, 'Other Brand', 'other-brand', 'other.tenant.com')").run(brandBId, orgBId);
    const userBId = 'usr_other_tenant';
    db.prepare("INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status) VALUES (?, ?, ?, 'otheruser', 'other@tenant.com', 'pwd_hash', 'Other User', 'owner', 'active')").run(userBId, brandBId, orgBId);

    const handoffService = new HandoffService(db);
    // Ticket explicitly created for brandBId
    const crossTicket = handoffService.createTicket({ userId: userBId, brandId: brandBId });

    // Attempt to consume ticket on app.mybangjo.com (which resolves to brand_bangjo)
    const mismatchRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/handoff/exchange',
      headers: {
        Host: 'app.mybangjo.com'
      }
    }, {
      ticket: crossTicket.ticket
    });
    assert.equal(mismatchRes.status, 403, 'Cross-tenant handoff exchange must be forbidden');
    assert.equal(mismatchRes.body.code, 'TENANT_MISMATCH');

    // 3.4 Verify EXPIRATION: Expired ticket must fail
    const expiredTicket = handoffService.createTicket({ userId: 'usr_bangjo_owner', brandId: 'brand_bangjo', ttlSeconds: -1 });
    const expiredRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/handoff/exchange',
      headers: {
        Host: 'app.mybangjo.com'
      }
    }, {
      ticket: expiredTicket.ticket
    });
    assert.equal(expiredRes.status, 401);
    assert.equal(expiredRes.body.code, 'TICKET_EXPIRED');
  });

  // Flow 4: Verify no auth/session token is exposed in the URL
  test('4. Security invariant: No auth or session token (xnt_auth_*) is ever exposed in the URL', async () => {
    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    const { token: cloudSessionToken } = global.TokenSessionStore.createSession(ownerUser, null);

    const handoffCreateRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/handoff/create',
      headers: {
        Host: 'xentra.cloud',
        Authorization: `Bearer ${cloudSessionToken}`
      }
    }, {
      brand_id: 'brand_bangjo'
    });

    assert.equal(handoffCreateRes.status, 200);
    const redirectUrl = handoffCreateRes.body.redirect_url;
    assert.ok(redirectUrl, 'Must return redirect_url');

    // URL contains only ?handoff=xnt_hdf_<hex>
    const parsedUrl = new URL(redirectUrl);
    assert.ok(!parsedUrl.searchParams.has('token'), 'URL must NOT have ?token');
    assert.ok(!parsedUrl.searchParams.has('auth_token'), 'URL must NOT have ?auth_token');
    assert.ok(!parsedUrl.searchParams.has('session'), 'URL must NOT have ?session');
    assert.ok(parsedUrl.searchParams.has('handoff'), 'URL must only contain ephemeral ?handoff code');
    assert.ok(!parsedUrl.searchParams.get('handoff').startsWith('xnt_auth_'), 'Handoff code is NOT a session token');

    // Check dashboard.js and login.html source code never injects token into URL or history
    const fs = require('fs');
    const dashboardJs = fs.readFileSync('apps/merchant-dashboard/assets/js/dashboard.js', 'utf8');
    assert.ok(dashboardJs.includes("urlParams.delete('handoff')"), 'dashboard.js must scrub handoff from URL immediately');
    assert.ok(dashboardJs.includes('window.history.replaceState'), 'dashboard.js must use replaceState to clean URL');

    const loginHtml = fs.readFileSync('apps/merchant-dashboard/login.html', 'utf8');
    assert.ok(loginHtml.includes("urlParams.delete('handoff')"), 'login.html must scrub handoff from URL immediately');
    assert.ok(loginHtml.includes('window.history.replaceState'), 'login.html must use replaceState to clean URL');
  });

  // Flow 5: Verify existing Bangjo legacy login still works
  test('5. Verify existing Bangjo legacy merchant login (/api/v1/auth/merchant/login) still works completely', async () => {
    const loginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/merchant/login',
      headers: {
        Host: 'app.mybangjo.com'
      }
    }, {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    });

    assert.equal(loginRes.status, 200, `Legacy login failed: ${JSON.stringify(loginRes.body)}`);
    assert.equal(loginRes.body.success, true);
    assert.ok(loginRes.body.token.startsWith('xnt_auth_'));
    assert.equal(loginRes.body.user.id, 'usr_bangjo_owner');
    assert.equal(loginRes.body.user.role, 'owner');

    // Verify token works on tenant protected route
    const testRes = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/auth/merchant/me',
      headers: {
        Host: 'app.mybangjo.com',
        Authorization: `Bearer ${loginRes.body.token}`
      }
    });
    assert.equal(testRes.status, 200);
    assert.equal(testRes.body.user.id, 'usr_bangjo_owner');
  });
});
