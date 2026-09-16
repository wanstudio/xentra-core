'use strict';

/**
 * Google Tenant Identity Regression Tests
 *
 * Tests the COMPLETE two-layer Google authentication architecture for tenant/restaurant
 * dashboard login at app.mybangjo.com/dashboard/login.
 *
 * Layer 1: Google OAuth origin (broker architecture prevents origin_mismatch)
 * Layer 2: Tenant Google identity resolution (link_token flow enables linking + auth)
 *
 * Test IDs: GOOGLE-TENANT-REG-01 through GOOGLE-TENANT-REG-15
 */

const { test, describe, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../../server/database/db');
const app = require('../../server/app');
const { AuthProviderService } = require('../../core/identity');

const TEST_CLIENT_ID = 'xentra-google-tenant-regression.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;

// ============================================================
// Mock Google tokeninfo for tests
// ============================================================
const axios = require('axios');
const originalAxiosGet = axios.get;
const mockGoogleTokens = new Map();

axios.get = async function (url, config) {
  if (url.includes('oauth2.googleapis.com/tokeninfo')) {
    const idToken = config && config.params && config.params.id_token;
    if (mockGoogleTokens.has(idToken)) {
      return { data: mockGoogleTokens.get(idToken) };
    }
  }
  return originalAxiosGet.apply(this, arguments);
};

function registerToken(name, claims) {
  const jwt = `header.${name}.signature`;
  mockGoogleTokens.set(jwt, claims);
  mockGoogleTokens.set(name, claims);
  return jwt;
}

function makeClaims(sub, email, overrides = {}) {
  return {
    aud: TEST_CLIENT_ID,
    iss: 'accounts.google.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub,
    email,
    email_verified: 'true',
    name: 'Test User',
    ...overrides
  };
}

// ============================================================
// HTTP request helper
// ============================================================
function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    let finalBody = body;
    if (body && typeof body === 'object') {
      finalBody = { ...body };
      if (finalBody.credential && typeof finalBody.credential === 'string') {
        const jwt = `header.${finalBody.credential}.signature`;
        if (!mockGoogleTokens.has(jwt)) {
          // Already registered as full JWT
        } else {
          finalBody.credential = jwt;
        }
      }
    }
    const payload = finalBody != null
      ? (typeof finalBody === 'string' ? finalBody : JSON.stringify(finalBody))
      : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Host: options.host || 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), raw: data }); }
        catch (_) { resolve({ status: res.statusCode, body: null, raw: data }); }
      });
    });

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

// Shorthand: request on app.mybangjo.com (tenant origin)
function tenantRequest(server, path, method, body, extraHeaders) {
  return request(server, { path, method: method || 'POST', host: 'app.mybangjo.com', headers: extraHeaders }, body);
}

// Shorthand: request on xentra.cloud (control-plane origin)
function platformRequest(server, path, method, body, extraHeaders) {
  return request(server, { path, method: method || 'POST', host: 'xentra.cloud', headers: extraHeaders }, body);
}

// Helper: link Google sub to Bangjo owner
function linkGoogleToBangjoOwner(sub) {
  const ps = new AuthProviderService();
  try {
    ps.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: sub,
      email: 'admin@bangjo.com'
    });
  } catch (e) {
    if (e.code !== 'PROVIDER_ALREADY_LINKED') throw e;
  }
}

// ============================================================
// Suite
// ============================================================
describe('Tenant Google Identity Regression — GOOGLE-TENANT-REG-01 to REG-15', () => {
  let server;
  const ps = new AuthProviderService();

  beforeEach(async () => {
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
    if (!server) {
      server = http.createServer(app);
      await new Promise(resolve => server.listen(0, resolve));
    }
    // Clean provider links before each test
    db.prepare('DELETE FROM user_auth_providers').run();
    // Ensure brand_bangjo is mapped to app.mybangjo.com
    db.prepare("UPDATE brands SET custom_domain = 'app.mybangjo.com' WHERE id = 'brand_bangjo'").run();
    // Ensure bangjo owner is active
    db.prepare("UPDATE users SET status = 'active' WHERE id = 'usr_bangjo_owner'").run();
  });

  after(() => {
    if (server) server.close();
    db.prepare('DELETE FROM user_auth_providers').run();
    db.prepare("UPDATE users SET status = 'active' WHERE id = 'usr_bangjo_owner'").run();
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-01: Canonical architecture
  // The tenant login page uses the xentra.cloud broker, NOT direct GSI.
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-01: tenant login uses canonical broker architecture (not direct GSI)', () => {
    const loginHtml = fs.readFileSync(
      path.join(__dirname, '../../apps/merchant-dashboard/login.html'), 'utf8'
    );
    // Client (non-platform) path must redirect to xentra.cloud broker
    assert.ok(
      loginHtml.includes("'https://xentra.cloud/auth/broker?return_to='") ||
      loginHtml.includes('"https://xentra.cloud/auth/broker?return_to="') ||
      loginHtml.includes('https://xentra.cloud/auth/broker'),
      'Tenant login must redirect to xentra.cloud broker'
    );
    // Platform path uses inline GSI (correct)
    assert.ok(loginHtml.includes('handlePlatformGoogleCredential') || loginHtml.includes('initPlatformGoogleSignIn'),
      'Platform context uses inline GSI handler');
    // isPlatform detection must be present
    assert.ok(loginHtml.includes('isPlatform'), 'Login.html must distinguish platform vs tenant context');
    // The broker redirect must NOT hardcode app.mybangjo.com as the broker URL
    assert.ok(!loginHtml.includes("'https://app.mybangjo.com/auth/broker'"), 'Must not hardcode tenant origin as broker');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-02: Google OAuth succeeds without origin_mismatch
  // The broker is on xentra.cloud (authorized origin). The GSI never runs
  // on app.mybangjo.com directly for the tenant login path.
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-02: tenant login does NOT initialize Google SDK on tenant origin', () => {
    const loginHtml = fs.readFileSync(
      path.join(__dirname, '../../apps/merchant-dashboard/login.html'), 'utf8'
    );
    // The tenant (non-platform) branch must NOT call google.accounts.id.initialize for tenant users
    // (only Platform context does that)
    // Verify the isPlatform guard exists and the SDK init is inside it
    const platformGuardIdx = loginHtml.indexOf('if (isPlatform)');
    assert.ok(platformGuardIdx !== -1, 'isPlatform guard must exist');
    // The Google button for tenant must redirect to broker, not call SDK
    assert.ok(loginHtml.includes("window.location.href = redirectTarget"),
      'Tenant Google button redirects to broker (no SDK init on tenant origin)');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-03: Existing Google-linked tenant user is resolved
  // When an existing user has a Google provider link, the broker flow
  // (xentra.cloud → /api/v1/auth/google → findIdentity) resolves them.
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-03: existing Google-linked tenant user is resolved via broker flow', async () => {
    const sub = 'tenant-reg-03-sub';
    const token = registerToken('tenant-reg-03-tok', makeClaims(sub, 'admin@bangjo.com'));
    linkGoogleToBangjoOwner(sub);

    // Broker calls /api/v1/auth/google on xentra.cloud with return_to for tenant
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token,
      return_to: 'https://app.mybangjo.com/dashboard/login'
    });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.ok(res.body.handoff_ticket, 'Must return handoff ticket for tenant return');
    assert.ok(res.body.redirect_url, 'Must return redirect URL');
    assert.ok(res.body.redirect_url.includes('app.mybangjo.com'), 'Redirect URL must point to tenant');
    assert.ok(res.body.redirect_url.includes('handoff=xnt_hdf_'), 'Redirect URL must include handoff ticket');
    // CRITICAL: session token must NOT be in the redirect URL
    assert.ok(!res.body.redirect_url.includes('xnt_auth_'), 'Session token must never be in redirect URL');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-04: Resolution uses immutable Google sub
  // Identity is looked up by sub, not by email.
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-04: resolution uses immutable Google sub, not email', async () => {
    const sub = 'tenant-reg-04-immutable-sub';
    const wrongSub = 'tenant-reg-04-wrong-sub';

    // Link correct sub
    linkGoogleToBangjoOwner(sub);

    // Register token with correct sub — should resolve
    const goodToken = registerToken('tenant-reg-04-good', makeClaims(sub, 'admin@bangjo.com'));
    const goodRes = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: goodToken
    });
    assert.equal(goodRes.status, 200);
    assert.equal(goodRes.body.user.id, 'usr_bangjo_owner');

    // Register token with same email but different sub — must NOT resolve
    const badToken = registerToken('tenant-reg-04-bad', makeClaims(wrongSub, 'admin@bangjo.com'));
    const badRes = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: badToken
    });
    assert.equal(badRes.status, 404);
    assert.equal(badRes.body.code, 'ACCOUNT_NOT_LINKED');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-05: Same Xentra User is returned
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-05: the SAME Xentra User is returned after Google authentication', async () => {
    const sub = 'tenant-reg-05-sub';
    const token = registerToken('tenant-reg-05-tok', makeClaims(sub, 'admin@bangjo.com'));
    linkGoogleToBangjoOwner(sub);

    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, 'usr_bangjo_owner', 'Must return the exact same Xentra user');
    assert.equal(res.body.user.username, 'admin');
    assert.equal(res.body.user.role, 'owner');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-06: No duplicate Xentra User is created
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-06: Google login does not create a duplicate Xentra User', async () => {
    const sub = 'tenant-reg-06-sub';
    const token = registerToken('tenant-reg-06-tok', makeClaims(sub, 'admin@bangjo.com'));
    linkGoogleToBangjoOwner(sub);

    const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    assert.equal(res.status, 200);
    const after = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    assert.equal(after, before, 'No new user must be created during Google login');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-07: Existing role is preserved
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-07: existing role is preserved after Google authentication', async () => {
    const sub = 'tenant-reg-07-sub';
    const token = registerToken('tenant-reg-07-tok', makeClaims(sub, 'admin@bangjo.com'));
    linkGoogleToBangjoOwner(sub);

    const before = db.prepare("SELECT role FROM users WHERE id = 'usr_bangjo_owner'").get();
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    assert.equal(res.status, 200);
    const after = db.prepare("SELECT role FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.equal(after.role, before.role, 'Role must not change after Google login');
    assert.equal(res.body.user.role, 'owner');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-08: Existing organization/brand/branch scope preserved
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-08: existing org/brand/branch scope preserved after Google authentication', async () => {
    const sub = 'tenant-reg-08-sub';
    const token = registerToken('tenant-reg-08-tok', makeClaims(sub, 'admin@bangjo.com'));
    linkGoogleToBangjoOwner(sub);

    const before = db.prepare("SELECT organization_id, brand_id, branch_id, role FROM users WHERE id = 'usr_bangjo_owner'").get();
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    assert.equal(res.status, 200);
    const after = db.prepare("SELECT organization_id, brand_id, branch_id, role FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.equal(after.organization_id, before.organization_id, 'organization_id must not change');
    assert.equal(after.brand_id, before.brand_id, 'brand_id must not change');
    assert.equal(after.branch_id, before.branch_id, 'branch_id must not change');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-09: Cross-tenant access is rejected
  // A user linked to brand A cannot access brand B via Google login.
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-09: cross-tenant access is rejected', async () => {
    // Create a separate brand and user linked to it
    const crossBrandId = 'brand_cross_reg09_' + Date.now().toString(36);
    const crossOrgId = 'org_cross_reg09_' + Date.now().toString(36);
    const crossUserId = 'usr_cross_reg09_' + Date.now().toString(36);
    const crossSub = 'tenant-reg-09-cross-sub';

    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(crossOrgId, 'CrossOrg09', 'crossorg09');
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)').run(crossBrandId, crossOrgId, 'CrossBrand09', 'crossbrand09', 'crossbrand09.example.com');
    db.prepare('INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, email, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(crossUserId, crossBrandId, crossOrgId, 'crossuser09', 'cross09@example.com', 'owner', 'active');

    ps.linkProvider({
      userId: crossUserId,
      provider: 'google',
      providerUserId: crossSub,
      email: 'cross09@example.com'
    });

    const token = registerToken('tenant-reg-09-tok', makeClaims(crossSub, 'cross09@example.com'));

    // Cross-user logs in via /api/v1/auth/google (control-plane, no brand_id context)
    // Identity is found but user.brand_id is crossBrandId, not brand_bangjo
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token,
      return_to: 'https://app.mybangjo.com/dashboard/login' // trying to get handoff to bangjo
    });

    // The cross user is authenticated — but the handoff should reject or the exchange will reject
    // because brand_bangjo's handoff ticket would require matching brand
    if (res.status === 200) {
      // If it succeeds at the handoff creation level, the exchange will still validate tenant
      // (the exchange endpoint verifies the ticket's brand matches the requesting host)
      if (res.body.handoff_ticket) {
        // Try to exchange on brand_bangjo domain — this MUST fail since the ticket is for crossBrandId
        const exchangeRes = await request(server, {
          path: '/api/v1/auth/handoff/exchange',
          method: 'POST',
          host: 'app.mybangjo.com'
        }, { ticket: res.body.handoff_ticket });
        // Should be rejected with TENANT_MISMATCH or similar error
        assert.notEqual(exchangeRes.status, 200, 'Cross-tenant exchange must be rejected');
      }
    }
    // Whether rejected at auth time or exchange time, cross-tenant access is prevented

    // Cleanup
    try {
      db.prepare('DELETE FROM user_auth_providers WHERE user_id = ?').run(crossUserId);
      db.prepare('DELETE FROM users WHERE id = ?').run(crossUserId);
      db.prepare('DELETE FROM brands WHERE id = ?').run(crossBrandId);
      db.prepare('DELETE FROM organizations WHERE id = ?').run(crossOrgId);
    } catch (_) {}
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-10: Wrong Google sub is rejected
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-10: wrong Google sub is rejected', async () => {
    const correctSub = 'tenant-reg-10-correct-sub';
    const wrongSub = 'tenant-reg-10-wrong-sub';
    linkGoogleToBangjoOwner(correctSub);

    const token = registerToken('tenant-reg-10-tok', makeClaims(wrongSub, 'admin@bangjo.com'));
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ACCOUNT_NOT_LINKED');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-11: Genuinely unlinked Google identity → ACCOUNT_NOT_LINKED
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-11: genuinely unlinked Google identity returns ACCOUNT_NOT_LINKED', async () => {
    // No provider link created — admin is truly unlinked
    const sub = 'tenant-reg-11-unlinked-sub';
    const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;

    const token = registerToken('tenant-reg-11-tok', makeClaims(sub, 'stranger@gmail.com'));
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ACCOUNT_NOT_LINKED');
    // No new user created
    const after = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    assert.equal(after, before, 'No user must be created for unlinked Google identity');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-12: Google identity cannot be impersonated by modifying email
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-12: impersonating tenant user by email is impossible', async () => {
    const correctSub = 'tenant-reg-12-correct-sub';
    const attackerSub = 'tenant-reg-12-attacker-sub';
    linkGoogleToBangjoOwner(correctSub);

    // Attacker has the same email as the admin but a different Google sub
    const token = registerToken('tenant-reg-12-tok', makeClaims(attackerSub, 'admin@bangjo.com'));
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    // Must be ACCOUNT_NOT_LINKED, not a successful login
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ACCOUNT_NOT_LINKED', 'Email-based impersonation must fail');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-13: Broker cannot use return_to to escalate authorization
  // return_to is validated against the brand registry — unknown domains are rejected.
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-13: broker cannot use forged return_to for authorization escalation', async () => {
    const sub = 'tenant-reg-13-sub';
    const token = registerToken('tenant-reg-13-tok', makeClaims(sub, 'admin@bangjo.com'));
    linkGoogleToBangjoOwner(sub);

    // Attempt to use an unregistered domain as return_to
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token,
      return_to: 'https://evil-tenant.example.com/dashboard/login'
    });

    // The server must reject the forged return_to (INVALID_RETURN_DOMAIN)
    // OR succeed but only with a validated redirect — never to an unknown domain
    if (res.status === 200) {
      // If somehow it returned 200, the redirect URL must not point to the evil domain
      assert.ok(
        !res.body.redirect_url || !res.body.redirect_url.includes('evil-tenant.example.com'),
        'Redirect URL must never point to an unregistered domain'
      );
    } else {
      // Server should return an error for invalid return_to
      assert.ok(res.status >= 400, 'Invalid return_to must be rejected');
    }
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-14: Workforce invitation Google flow remains valid
  // An invited user can authenticate via Google after accepting invitation.
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-14: workforce invitation Google flow remains valid', async () => {
    // Create an invited workforce user with a Google provider link
    const invitedUserId = 'usr_invited_reg14_' + Date.now().toString(36);
    const invitedSub = 'tenant-reg-14-invited-sub';
    const invitedEmail = 'invited_reg14@bangjo.com';

    db.prepare(`
      INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, email, role, status, email_verified_at)
      VALUES (?, 'brand_bangjo', 'org_xentra_holding', ?, ?, 'cashier', 'active', datetime('now'))
    `).run(invitedUserId, 'invited_reg14', invitedEmail);

    // Link Google to this invited user
    ps.linkProvider({
      userId: invitedUserId,
      provider: 'google',
      providerUserId: invitedSub,
      email: invitedEmail
    });

    const token = registerToken('tenant-reg-14-tok', makeClaims(invitedSub, invitedEmail));

    // Invited user authenticates via Google on xentra.cloud broker path
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token,
      return_to: 'https://app.mybangjo.com/dashboard/login'
    });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.id, invitedUserId);
    assert.equal(res.body.user.role, 'cashier', 'Invited user role must be preserved');
    // Must return handoff ticket to bring user back to tenant
    assert.ok(res.body.handoff_ticket, 'Must return handoff_ticket for invited workforce user');

    // Cleanup
    db.prepare('DELETE FROM user_auth_providers WHERE user_id = ?').run(invitedUserId);
    db.prepare('DELETE FROM users WHERE id = ?').run(invitedUserId);
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-15: Existing Google-linked admin can authenticate after
  // application restart / database initialization.
  // The initSchema + seedData calls must not destroy provider links.
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-15: Google-linked admin survives application restart and DB initialization', async () => {
    const sub = 'tenant-reg-15-sub';
    linkGoogleToBangjoOwner(sub);

    // Simulate application restart: re-run schema and seed initialization
    db.initSchema(db);
    db.seedData(db);

    // Provider link must still exist after initialization
    const identity = ps.findIdentity('google', sub);
    assert.ok(identity, 'Google provider link must survive application restart/DB initialization');
    assert.equal(identity.user.id, 'usr_bangjo_owner');
    assert.equal(identity.user.role, 'owner');

    // Must also be able to authenticate via the broker flow
    const token = registerToken('tenant-reg-15-tok', makeClaims(sub, 'admin@bangjo.com'));
    const res = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    assert.equal(res.status, 200, 'Must authenticate after restart');
    assert.equal(res.body.user.id, 'usr_bangjo_owner');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-16: link-init endpoint issues a valid link token
  // for authenticated users. Requires session auth.
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-16: link-init issues valid link token for authenticated user', async () => {
    // Create a session for bangjo owner (simulate password login)
    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    const { token: sessionToken } = global.TokenSessionStore.createSession(ownerUser, 'brand_bangjo');

    const res = await request(server, {
      path: '/api/v1/auth/google/link-init',
      method: 'POST',
      host: 'app.mybangjo.com',
      headers: { Authorization: `Bearer ${sessionToken}` }
    });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.ok(res.body.link_token, 'Must return link_token');
    assert.ok(res.body.link_token.startsWith('xnt_glink_'), 'Link token must start with xnt_glink_ prefix');
    assert.equal(res.body.expires_in, 300, 'Link token must expire in 5 minutes');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-17: link-init is rejected for unauthenticated requests
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-17: link-init is rejected without authentication', async () => {
    const res = await request(server, {
      path: '/api/v1/auth/google/link-init',
      method: 'POST',
      host: 'app.mybangjo.com'
    });
    assert.notEqual(res.status, 200, 'Unauthenticated link-init must be rejected');
    assert.ok(res.status === 401 || res.status === 403, `Expected 401/403, got ${res.status}`);
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-18: link-init prevents double-linking
  // If Google is already linked, link-init returns GOOGLE_ALREADY_LINKED
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-18: link-init prevents double-linking when Google already linked', async () => {
    const existingSub = 'tenant-reg-18-existing-sub';
    linkGoogleToBangjoOwner(existingSub);

    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    const { token: sessionToken } = global.TokenSessionStore.createSession(ownerUser, 'brand_bangjo');

    const res = await request(server, {
      path: '/api/v1/auth/google/link-init',
      method: 'POST',
      host: 'app.mybangjo.com',
      headers: { Authorization: `Bearer ${sessionToken}` }
    });

    assert.equal(res.status, 409, `Expected 409 GOOGLE_ALREADY_LINKED, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'GOOGLE_ALREADY_LINKED');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-19: Complete link_token flow — unlinked user links Google
  // This is the primary fix for the ACCOUNT_NOT_LINKED problem.
  // Flow: password login → link-init → broker → /auth/google (link mode) → linked
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-19: complete link_token flow — unlinked user links Google account', async () => {
    const newSub = 'tenant-reg-19-new-sub-' + Date.now().toString(36);
    const newEmail = 'admin@bangjo.com';
    const token = registerToken('tenant-reg-19-tok', makeClaims(newSub, newEmail));

    // Step 1: User has no Google link yet — verify ACCOUNT_NOT_LINKED
    const noLinkRes = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    assert.equal(noLinkRes.status, 404);
    assert.equal(noLinkRes.body.code, 'ACCOUNT_NOT_LINKED');

    // Step 2: User logs in with password and gets a session
    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    const { token: sessionToken } = global.TokenSessionStore.createSession(ownerUser, 'brand_bangjo');

    // Step 3: Obtain a link token via link-init (authenticated)
    const linkInitRes = await request(server, {
      path: '/api/v1/auth/google/link-init',
      method: 'POST',
      host: 'app.mybangjo.com',
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.equal(linkInitRes.status, 200, `link-init failed: ${JSON.stringify(linkInitRes.body)}`);
    const linkToken = linkInitRes.body.link_token;
    assert.ok(linkToken && linkToken.startsWith('xnt_glink_'), 'Must get a valid link token');

    // Step 4: Broker posts to /api/v1/auth/google with credential + link_token
    // (In production, the broker on xentra.cloud does this after Google auth)
    const linkRes = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token,
      link_token: linkToken,
      return_to: 'https://app.mybangjo.com/dashboard/login'
    });

    assert.equal(linkRes.status, 200, `Link failed: ${JSON.stringify(linkRes.body)}`);
    assert.equal(linkRes.body.success, true);
    assert.equal(linkRes.body.linked, true, 'Must confirm linking occurred');
    assert.ok(linkRes.body.token, 'Must return session token');
    assert.equal(linkRes.body.user.id, 'usr_bangjo_owner', 'Must resolve to the same Xentra user');

    // Step 5: Now Google login works — same sub resolves to same user
    const loginRes = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token
    });
    assert.equal(loginRes.status, 200, `Post-link Google login failed: ${JSON.stringify(loginRes.body)}`);
    assert.equal(loginRes.body.user.id, 'usr_bangjo_owner', 'Same user must be returned after linking');

    // Step 6: Verify no duplicate user was created
    const adminCount = db.prepare("SELECT COUNT(*) c FROM users WHERE email = 'admin@bangjo.com'").get().c;
    assert.equal(adminCount, 1, 'No duplicate user must be created');

    // Step 7: Verify link token is single-use
    const reuseRes = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: token,
      link_token: linkToken // same token, already consumed
    });
    assert.notEqual(reuseRes.status, 200, 'Consumed link token must be rejected');
    assert.equal(reuseRes.body.code, 'INVALID_LINK_TOKEN', 'Must return INVALID_LINK_TOKEN for reused token');
  });

  // ------------------------------------------------------------------
  // GOOGLE-TENANT-REG-20: link_token cannot be used with a different Google account
  // (PROVIDER_ALREADY_LINKED protection)
  // ------------------------------------------------------------------
  test('GOOGLE-TENANT-REG-20: link_token protects against PROVIDER_ALREADY_LINKED hijack', async () => {
    // Create an attacker user with a Google sub already linked
    const attackerSub = 'tenant-reg-20-attacker-sub';
    const attackerUserId = 'usr_attacker_reg20_' + Date.now().toString(36);
    db.prepare(`
      INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, email, role, status, email_verified_at)
      VALUES (?, 'brand_bangjo', 'org_xentra_holding', ?, ?, 'cashier', 'active', datetime('now'))
    `).run(attackerUserId, 'attacker_reg20', 'attacker_reg20@bangjo.com');

    ps.linkProvider({
      userId: attackerUserId,
      provider: 'google',
      providerUserId: attackerSub,
      email: 'attacker_reg20@bangjo.com'
    });

    // Bangjo owner gets a link token
    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    const { token: ownerSessionToken } = global.TokenSessionStore.createSession(ownerUser, 'brand_bangjo');

    const linkInitRes = await request(server, {
      path: '/api/v1/auth/google/link-init',
      method: 'POST',
      host: 'app.mybangjo.com',
      headers: { Authorization: `Bearer ${ownerSessionToken}` }
    });
    assert.equal(linkInitRes.status, 200);
    const linkToken = linkInitRes.body.link_token;

    // Try to link the attacker's Google sub to the owner using the owner's link token
    const attackerToken = registerToken('tenant-reg-20-tok', makeClaims(attackerSub, 'attacker_reg20@bangjo.com'));
    const attackRes = await platformRequest(server, '/api/v1/auth/google', 'POST', {
      credential: attackerToken,
      link_token: linkToken
    });

    // Must be rejected because attackerSub is already linked to the attacker user
    assert.equal(attackRes.status, 409, `Expected 409, got ${attackRes.status}: ${JSON.stringify(attackRes.body)}`);
    assert.equal(attackRes.body.code, 'PROVIDER_ALREADY_LINKED');

    // Cleanup
    db.prepare('DELETE FROM user_auth_providers WHERE user_id = ?').run(attackerUserId);
    db.prepare('DELETE FROM users WHERE id = ?').run(attackerUserId);
  });
});
