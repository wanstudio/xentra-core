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

  // Flow 6: Platform uses inline GSI (isPlatform guard), Client/Tenant redirects to xentra.cloud broker
  test('6. Tenant login does NOT initialize GSI and Google button redirects to xentra.cloud', () => {
    const fs = require('fs');
    const loginHtml = fs.readFileSync('apps/merchant-dashboard/login.html', 'utf8');

    // Requirement: GSI code exists only inside the isPlatform branch — guarded so client/tenant domains never execute it
    assert.ok(loginHtml.includes('if (isPlatform)'), 'login.html must gate Platform SDK code with isPlatform check');
    assert.ok(loginHtml.includes('handlePlatformGoogleCredential'), 'Platform branch must have inline credential handler');
    assert.ok(loginHtml.includes('initPlatformGoogleSignIn'), 'Platform branch must have SDK init function');

    // GSI SDK is present in JS (for Platform) but loaded dynamically — never as a static <script> tag
    assert.ok(!loginHtml.includes('<script src="https://accounts.google.com/gsi/client"'), 'GSI SDK must NOT be a static <script> tag in login.html');

    // Requirement: Client/Tenant branch: Continue with Google navigates to xentra.cloud/auth/broker?return_to=...
    assert.ok(loginHtml.includes("'https://xentra.cloud/auth/broker?return_to=' + encodeURIComponent("), 'login.html must construct xentra.cloud broker redirect with encoded return_to');
    assert.ok(!loginHtml.includes("xentra.cloud/signin?return_to="), 'login.html must NOT redirect any user to xentra.cloud/signin');
    assert.ok(loginHtml.includes("btn-google-login"), 'login.html must have btn-google-login button');
  });

  // Flow 7: Strict return_to validation via authoritative Domain Registry
  test('7. Strict return_to validation: accepts registered domain, rejects unknown, external, non-HTTPS, or malformed', () => {
    const handoffService = new HandoffService(db);

    // 7.1 Valid registered client domain
    const validResult = handoffService.validateReturnTo('https://app.mybangjo.com/dashboard/');
    assert.equal(validResult.valid, true);
    assert.equal(validResult.hostname, 'app.mybangjo.com');
    assert.equal(validResult.brand.id, 'brand_bangjo');

    // 7.2 Unknown / unregistered domain
    assert.throws(() => {
      handoffService.validateReturnTo('https://unknown-restaurant.com/dashboard/');
    }, (err) => {
      assert.equal(err.code, 'INVALID_RETURN_DOMAIN');
      assert.equal(err.status, 400);
      return true;
    });

    // 7.3 External arbitrary domain
    assert.throws(() => {
      handoffService.validateReturnTo('https://evil-attacker.com/steal-token');
    }, (err) => {
      assert.equal(err.code, 'INVALID_RETURN_DOMAIN');
      return true;
    });

    // 7.4 Non-HTTPS in production environment
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      assert.throws(() => {
        handoffService.validateReturnTo('http://app.mybangjo.com/dashboard/');
      }, (err) => {
        assert.equal(err.code, 'INVALID_RETURN_DOMAIN');
        return true;
      });

      // 7.5 Localhost / loopback rejected in production
      assert.throws(() => {
        handoffService.validateReturnTo('https://localhost/dashboard/');
      }, (err) => {
        assert.equal(err.code, 'INVALID_RETURN_DOMAIN');
        return true;
      });
    } finally {
      process.env.NODE_ENV = origEnv;
    }

    // 7.6 Malformed URL
    assert.throws(() => {
      handoffService.validateReturnTo('not-a-valid-url');
    }, (err) => {
      assert.equal(err.code, 'INVALID_RETURN_DOMAIN');
      return true;
    });

    // 7.7 Javascript: protocol rejected
    assert.throws(() => {
      handoffService.validateReturnTo('javascript:alert(1)');
    }, (err) => {
      assert.equal(err.code, 'INVALID_RETURN_DOMAIN');
      return true;
    });
  });

  // Flow 8: Centralized Google authentication on xentra.cloud with return_to
  test('8. xentra.cloud: Google Auth with return_to creates handoff ticket for client tenant', async () => {
    // Link Bangjo owner user to a test google sub
    const googleSub = 'google-sub-bangjo-owner-return-test';
    const googleToken = 'google-token-bangjo-owner-return-test';
    const email = 'admin@bangjo.com';

    // Link provider identity for googleSub -> usr_bangjo_owner
    const { AuthProviderService } = require('../../core/identity');
    const authProviderService = new AuthProviderService(db);
    authProviderService.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: googleSub,
      email
    });

    registerMockGoogleToken(googleToken, {
      sub: googleSub,
      email,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'Bangjo Owner'
    });

    try {
      const returnUrl = 'https://app.mybangjo.com/dashboard/';

      // Google authentication request on xentra.cloud with return_to
      const googleRes = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/google',
        headers: { Host: 'xentra.cloud' }
      }, {
        credential: googleToken,
        return_to: returnUrl
      });

      assert.equal(googleRes.status, 200, `Google auth failed: ${JSON.stringify(googleRes.body)}`);
      assert.equal(googleRes.body.success, true);
      assert.ok(googleRes.body.handoff_ticket, 'Response must include handoff_ticket');
      assert.ok(googleRes.body.handoff_ticket.startsWith('xnt_hdf_'), 'Ticket starts with xnt_hdf_');
      assert.ok(googleRes.body.redirect_url, 'Response must include redirect_url');
      assert.ok(googleRes.body.redirect_url.startsWith('https://app.mybangjo.com/dashboard/?handoff=xnt_hdf_'));
      // CRITICAL: Session token xnt_auth_* is NOT in the redirect URL
      assert.ok(!googleRes.body.redirect_url.includes('xnt_auth_'), 'Session token must never be in redirect URL');

      // Verify exchange on client domain
      const exchangeRes = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/auth/handoff/exchange',
        headers: { Host: 'app.mybangjo.com' }
      }, {
        ticket: googleRes.body.handoff_ticket
      });

      assert.equal(exchangeRes.status, 200, `Exchange failed: ${JSON.stringify(exchangeRes.body)}`);
      assert.equal(exchangeRes.body.success, true);
      assert.ok(exchangeRes.body.token.startsWith('xnt_auth_'));
      assert.equal(exchangeRes.body.user.id, 'usr_bangjo_owner');
    } finally {
      // Restore usr_bangjo_owner original email and remove provider identity
      db.prepare("UPDATE users SET email = 'admin@bangjo.com' WHERE id = 'usr_bangjo_owner'").run();
      db.prepare("DELETE FROM user_auth_providers WHERE provider_user_id = ?").run(googleSub);
    }
  });

  // Flow 9: Dedicated Auth Broker Page (/auth/broker) served on xentra.cloud and isolated from /signin
  test('9. GET /auth/broker is accessible on xentra.cloud, contains broker logic, and never loads xentra.cloud/signin', async () => {
    const brokerRes = await makeRequest(server, {
      method: 'GET',
      path: '/auth/broker',
      headers: { Host: 'xentra.cloud' }
    });

    assert.equal(brokerRes.status, 200);
    assert.ok(brokerRes.raw.includes('Xentra Single Sign-On'), 'Must have broker title');
    assert.ok(brokerRes.raw.includes('id="google-btn-slot"'), 'Must have google button slot');
    assert.ok(brokerRes.raw.includes('/api/v1/auth/google'), 'Must submit to /api/v1/auth/google');
    // Ensure broker does not contain signin.html platform registration or email forms
    assert.ok(!brokerRes.raw.includes('form-signin'), 'Broker page must NOT contain platform form-signin');
    assert.ok(!brokerRes.raw.includes('Get started free'), 'Broker page must NOT contain SaaS platform registration links');
  });

  // Flow 10: Unlinked Google account produces 404 ACCOUNT_NOT_LINKED without creating user or touching platform signin
  test('10. Centralized auth for unlinked account returns ACCOUNT_NOT_LINKED and preserves client context', async () => {
    const unlinkedSub = 'google-sub-unlinked-tenant-test';
    const unlinkedToken = 'google-token-unlinked-tenant-test';
    const unlinkedEmail = 'unlinked-stranger@gmail.com';

    registerMockGoogleToken(unlinkedToken, {
      sub: unlinkedSub,
      email: unlinkedEmail,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const userCountBefore = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google',
      headers: { Host: 'xentra.cloud' }
    }, {
      credential: unlinkedToken,
      return_to: 'https://app.mybangjo.com/dashboard/login'
    });

    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ACCOUNT_NOT_LINKED');
    assert.equal(res.body.success, false);

    const userCountAfter = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    assert.equal(userCountAfter, userCountBefore, 'No user record must be created for unlinked Google account');
  });

  // Flow 11: /auth/broker does not redirect to / or to /signin on xentra.cloud
  test('11. Routing verification: GET /auth/broker and /auth/broker/ do NOT redirect to / or /signin', async () => {
    for (const path of ['/auth/broker', '/auth/broker/']) {
      const res = await makeRequest(server, {
        method: 'GET',
        path,
        headers: { Host: 'xentra.cloud' }
      });

      assert.equal(res.status, 200, `Expected 200 for ${path}, got ${res.status}`);
      // Ensure it does not respond with a redirect location to / or /signin
      assert.ok(!res.headers.location, `Location header should not be set for ${path}`);
      assert.ok(res.raw.includes('Xentra Single Sign-On'), `Body must be auth-broker for ${path}`);
      assert.ok(!res.raw.includes('form-signin'), `Must not serve signin.html for ${path}`);
    }
  });

  // Flow 12: Cross-tenant handoff attempt is strictly rejected with 403 TENANT_MISMATCH
  test('12. Cross-tenant handoff ticket exchange is strictly rejected with 403 TENANT_MISMATCH', async () => {
    const otherBrandId = 'brand_023eee6563b6';

    const handoffService = new HandoffService(db);
    // Create a ticket for usr_bangjo_owner bound to brand_bangjo
    const ticketInfo = handoffService.createTicket({
      userId: 'usr_bangjo_owner',
      brandId: 'brand_bangjo',
      ttlSeconds: 60
    });

    // Attempt to consume this ticket with otherBrandId context
    assert.throws(() => {
      handoffService.consumeTicket({
        ticket: ticketInfo.ticket,
        targetBrandId: otherBrandId
      });
    }, (err) => {
      assert.equal(err.code, 'TENANT_MISMATCH');
      assert.equal(err.status, 403);
      return true;
    });
  });

  // Flow 13: Dynamic return_to without hardcoding — verifies login.html resolves window.location.origin dynamically
  test('13. Client login.html derives return_to dynamically from window.location.origin with no hardcoded client domain', () => {
    const fs = require('fs');
    const loginHtml = fs.readFileSync('apps/merchant-dashboard/login.html', 'utf8');

    assert.ok(loginHtml.includes('var currentOrigin = window.location.origin;'), 'login.html must read window.location.origin dynamically');
    assert.ok(loginHtml.includes("var returnUrl = currentOrigin + '/dashboard/login';"), 'login.html must construct returnUrl from currentOrigin');
    assert.ok(loginHtml.includes("'https://xentra.cloud/auth/broker?return_to=' + encodeURIComponent(returnUrl)"), 'login.html must encode dynamic returnUrl to auth broker');
    // Ensure no client-specific production domain is hardcoded in login.html redirect
    assert.ok(!loginHtml.includes('app.mybangjo.com/auth/broker'), 'No client domain hardcoded in broker target');
  });

  // Flow 14: Registered client domain CORS dynamically allowed on POST /api/v1/auth/handoff/exchange
  test('14. Registered client domain Origin is dynamically allowed on POST /api/v1/auth/handoff/exchange without 500 error', async () => {
    const handoffService = new HandoffService(db);
    const ticketInfo = handoffService.createTicket({
      userId: 'usr_bangjo_owner',
      brandId: 'brand_bangjo',
      ttlSeconds: 60
    });

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/handoff/exchange',
      headers: {
        Host: 'app.mybangjo.com',
        Origin: 'https://app.mybangjo.com'
      }
    }, {
      ticket: ticketInfo.ticket
    });

    assert.equal(res.status, 200, `Expected 200 OK, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token.startsWith('xnt_auth_'));
    // CORS headers verified
    assert.equal(res.headers['access-control-allow-origin'], 'https://app.mybangjo.com');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    // Ensure no wildcard CORS used
    assert.notEqual(res.headers['access-control-allow-origin'], '*');
  });

  // Flow 15: Browser preflight OPTIONS request for handoff exchange with registered client Origin
  test('15. Browser preflight OPTIONS request for handoff exchange returns 204 with registered client CORS headers', async () => {
    const res = await makeRequest(server, {
      method: 'OPTIONS',
      path: '/api/v1/auth/handoff/exchange',
      headers: {
        Host: 'app.mybangjo.com',
        Origin: 'https://app.mybangjo.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://app.mybangjo.com');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    assert.ok(res.headers['access-control-allow-methods'].includes('POST'));
    assert.notEqual(res.headers['access-control-allow-origin'], '*');
  });

  // Flow 16: Newly registered client domain works dynamically without code changes or server restart
  test('16. Newly registered dynamic client domain in database can immediately exchange handoff tickets via CORS', async () => {
    const dynamicBrandId = 'brand_dynamic_' + Date.now().toString(36);
    const dynamicOrgId = 'org_dynamic_' + Date.now().toString(36);
    const dynamicUserId = 'usr_dynamic_' + Date.now().toString(36);
    const dynamicDomain = `dashboard.brandnewresto-${dynamicBrandId}.com`;

    db.prepare("INSERT INTO organizations (id, name, slug) VALUES (?, 'Dynamic Org', ?)").run(dynamicOrgId, `dynamic-org-${dynamicOrgId}`);
    db.prepare("INSERT INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, 'Dynamic Brand', ?, ?)").run(dynamicBrandId, dynamicOrgId, `dynamic-brand-${dynamicBrandId}`, dynamicDomain);
    db.prepare("INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, ?, 'pwd_hash', 'Dynamic Owner', 'owner', 'active')").run(dynamicUserId, dynamicBrandId, dynamicOrgId, `dynowner_${dynamicUserId}`, `dynowner_${dynamicUserId}@resto.com`);

    const handoffService = new HandoffService(db);
    const ticketInfo = handoffService.createTicket({
      userId: dynamicUserId,
      brandId: dynamicBrandId,
      ttlSeconds: 60
    });

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/handoff/exchange',
      headers: {
        Host: dynamicDomain,
        Origin: `https://${dynamicDomain}`
      }
    }, {
      ticket: ticketInfo.ticket
    });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.equal(res.headers['access-control-allow-origin'], `https://${dynamicDomain}`);
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    assert.notEqual(res.headers['access-control-allow-origin'], '*');
  });

  // Flow 17: Unregistered client domain Origin is strictly rejected
  test('17. Unregistered client domain Origin is rejected and denied CORS permission', async () => {
    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/handoff/exchange',
      headers: {
        Host: 'app.mybangjo.com',
        Origin: 'https://unregistered-malicious-domain.com'
      }
    }, {
      ticket: 'any_ticket'
    });

    // When CORS rejects the origin, Access-Control-Allow-Origin header is NOT set
    assert.ok(!res.headers['access-control-allow-origin'], 'Access-Control-Allow-Origin must not be set for unregistered domain');
    assert.equal(res.status, 500, 'Rejected origin hits error handler');
  });
});
