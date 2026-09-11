'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const db = require('../../server/database/db');
const app = require('../../server/app');
const { AuthProviderService, WorkforceService } = require('../../core/identity');
process.env.GOOGLE_CLIENT_ID = 'xentra-google-test-client-id.apps.googleusercontent.com';

const axios = require('axios');
const GoogleAuthService = require('../../server/services/GoogleAuthService');

// Global mock registry for Google tokeninfo
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

function registerMockGoogleToken(token, claims) {
  const jwt = formatMockJwt(token);
  mockGoogleTokens.set(jwt, claims);
  mockGoogleTokens.set(token, claims);
  return jwt;
}

// Helper to make test HTTP requests
function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
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
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Host: 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload != null) {
      req.write(payload);
    }
    req.end();
  });
}

// Mock HTTP client for GoogleAuthService
function createMockHttpClient(tokenResponses = {}) {
  return {
    async get(url, config) {
      const idToken = config?.params?.id_token;
      if (tokenResponses[idToken]) {
        const resp = tokenResponses[idToken];
        if (resp.error) {
          const err = new Error(resp.error.message || 'Google token error');
          err.response = { data: resp.error };
          throw err;
        }
        return { data: resp.data };
      }
      const err = new Error('Token not found');
      err.response = { data: { error_description: 'Token not found or invalid' } };
      throw err;
    }
  };
}

describe('Google-First Authentication & Bangjo Owner Linking', () => {
  let server;
  const TEST_CLIENT_ID = 'xentra-google-test-client-id.apps.googleusercontent.com';

  beforeEach(async () => {
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
    if (!server) {
      server = http.createServer(app);
      await new Promise(resolve => server.listen(0, resolve));
    }
    // Clean up any test provider links
    db.prepare('DELETE FROM user_auth_providers').run();
  });

  // A. Google provider identity lookup by sub
  test('A. AuthProviderService finds linked identity by (provider, providerUserId)', () => {
    const service = new AuthProviderService();
    const testSub = 'google-sub-1001';

    // Link to existing Bangjo Owner
    const link = service.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: testSub,
      email: 'owner@bangjo.com'
    });

    assert.equal(link.success, true);
    assert.equal(link.linked, true);

    const identity = service.findIdentity('google', testSub);
    assert.ok(identity, 'Identity must be found');
    assert.equal(identity.userId, 'usr_bangjo_owner');
    assert.equal(identity.provider, 'google');
    assert.equal(identity.providerUserId, testSub);
    assert.equal(identity.user.id, 'usr_bangjo_owner');
    assert.equal(identity.user.role, 'owner');
    assert.equal(identity.user.email_verified, true);
  });

  // B. Existing Bangjo Owner linking: Google sub -> usr_bangjo_owner
  test('B. Existing Bangjo Owner links Google sub via POST /auth/link-google and retains usr_bangjo_owner identity', async () => {
    // 1. Authenticate Bangjo Owner with legacy credentials
    const loginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/merchant/login'
    }, {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    });

    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.body.token);
    assert.equal(loginRes.body.user.id, 'usr_bangjo_owner');

    const ownerToken = loginRes.body.token;
    const testGoogleSub = 'google-bangjo-owner-sub-999';

    // Mock Google token
    const validGoogleToken = 'valid-google-owner-id-token';
    registerMockGoogleToken(validGoogleToken, {
      sub: testGoogleSub,
      email: 'bangjo.owner.personal@gmail.com',
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    // 2. Link Google account using authenticated session
    const linkRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/link-google',
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    }, {
      credential: validGoogleToken
    });

    assert.equal(linkRes.status, 200);
    assert.equal(linkRes.body.success, true);
    assert.equal(linkRes.body.provider, 'google');

    // 3. Verify in database: strictly mapped to usr_bangjo_owner
    const row = db.prepare("SELECT * FROM user_auth_providers WHERE provider = 'google' AND provider_user_id = ?").get(testGoogleSub);
    assert.ok(row, 'Provider row must exist');
    assert.equal(row.user_id, 'usr_bangjo_owner');
  });

  // C. No duplicate user created
  test('C. Linking Google does NOT create any duplicate user record in users table', async () => {
    const countBefore = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    const service = new AuthProviderService();
    service.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: 'sub-no-dup-check',
      email: 'verified@gmail.com'
    });

    const countAfter = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    assert.equal(countAfter, countBefore, 'Number of users in users table must not change on link');

    const ownerRows = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").all();
    assert.equal(ownerRows.length, 1, 'Exactly one usr_bangjo_owner record must exist');
  });

  // D. Existing legacy login still works
  test('D. Existing legacy username/email + password login still works normally after linking Google', async () => {
    const service = new AuthProviderService();
    service.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: 'sub-legacy-verify',
      email: 'owner@gmail.com'
    });

    const loginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/merchant/login'
    }, {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    });

    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.user.id, 'usr_bangjo_owner');
    assert.equal(loginRes.body.user.role, 'owner');
  });

  // E. Same Google sub logs into the same user on subsequent requests
  test('E. Subsequent requests with the same Google sub authenticate as usr_bangjo_owner with identical scopes', async () => {
    const testSub = 'google-sub-repeat-auth';
    const testToken = 'google-token-repeat';

    // Link usr_bangjo_owner
    const service = new AuthProviderService();
    service.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: testSub,
      email: 'owner@bangjo.com'
    });

    // Mock Google tokeninfo
    registerMockGoogleToken(testToken, {
      sub: testSub,
      email: 'owner@bangjo.com',
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    // Authenticate via POST /auth/google
    const authRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google'
    }, {
      credential: testToken
    });

    assert.equal(authRes.status, 200);
    assert.ok(authRes.body.token);
    assert.equal(authRes.body.user.id, 'usr_bangjo_owner');
    assert.equal(authRes.body.user.role, 'owner');
    assert.equal(authRes.body.user.email, 'admin@bangjo.com');

    // Use returned token to access protected merchant endpoint
    const meRes = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/auth/merchant/me',
      headers: {
        Authorization: `Bearer ${authRes.body.token}`
      }
    });

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.id, 'usr_bangjo_owner');
  });

  // F. Same Google sub cannot be linked to another user
  test('F. Same Google sub cannot be linked to a second Xentra user', async () => {
    const testSub = 'google-sub-conflict';
    const service = new AuthProviderService();

    // Link to usr_bangjo_owner
    service.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: testSub,
      email: 'first@gmail.com'
    });

    // Create a second test user
    const workforce = new WorkforceService();
    let secondUser;
    try {
      secondUser = workforce.createUser({
        brand_id: 'brand_bangjo',
        organization_id: 'org_xentra_holding',
        branch_id: 'branch_bangjo_barat',
        username: 'test_cashier_conflict',
        password: 'Password123!',
        full_name: 'Conflict Cashier',
        role: 'cashier',
        created_by: 'usr_bangjo_owner'
      });
    } catch (e) {
      secondUser = db.prepare("SELECT * FROM users WHERE username = 'test_cashier_conflict'").get();
    }

    assert.throws(() => {
      service.linkProvider({
        userId: secondUser.id,
        provider: 'google',
        providerUserId: testSub,
        email: 'second@gmail.com'
      });
    }, (err) => {
      return err.code === 'PROVIDER_ALREADY_LINKED' && err.status === 409;
    });
  });

  // G. Unverified Google email cannot be linked
  test('G. Unverified Google email is rejected on linking attempt with UNVERIFIED_GOOGLE_EMAIL', async () => {
    // Authenticate owner
    const loginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/merchant/login'
    }, {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    });

    const ownerToken = loginRes.body.token;
    const unverifiedToken = 'google-token-unverified';

    registerMockGoogleToken(unverifiedToken, {
      sub: 'google-sub-unverified',
      email: 'unverified@gmail.com',
      email_verified: false, // NOT VERIFIED!
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const linkRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/link-google',
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    }, {
      credential: unverifiedToken
    });

    assert.equal(linkRes.status, 400);
    assert.equal(linkRes.body.code, 'UNVERIFIED_GOOGLE_EMAIL');
  });

  // H. Invalid/expired/wrong-audience Google token rejected
  test('H1. Expired Google token is rejected with 401 EXPIRED_GOOGLE_TOKEN', async () => {
    const expiredToken = 'google-token-expired';
    registerMockGoogleToken(expiredToken, {
      sub: 'google-sub-exp',
      email: 'test@gmail.com',
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) - 300 // expired 5 minutes ago
    });

    const authRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google'
    }, {
      credential: expiredToken
    });

    assert.equal(authRes.status, 401);
    assert.equal(authRes.body.code, 'EXPIRED_GOOGLE_TOKEN');
  });

  test('H2. Wrong audience Google token is rejected with 401 INVALID_TOKEN_AUDIENCE', async () => {
    const wrongAudToken = 'google-token-wrong-aud';
    registerMockGoogleToken(wrongAudToken, {
      sub: 'google-sub-aud',
      email: 'test@gmail.com',
      email_verified: true,
      aud: 'attacker-client-id.apps.googleusercontent.com', // WRONG AUDIENCE!
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const authRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google'
    }, {
      credential: wrongAudToken
    });

    assert.equal(authRes.status, 401);
    assert.equal(authRes.body.code, 'INVALID_TOKEN_AUDIENCE');
  });

  test('H3. Invalid issuer is rejected with 401 INVALID_TOKEN_ISSUER', async () => {
    const wrongIssToken = 'google-token-wrong-iss';
    registerMockGoogleToken(wrongIssToken, {
      sub: 'google-sub-iss',
      email: 'test@gmail.com',
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://fake-google.attacker.com', // WRONG ISSUER!
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const authRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google'
    }, {
      credential: wrongIssToken
    });

    assert.equal(authRes.status, 401);
    assert.equal(authRes.body.code, 'INVALID_TOKEN_ISSUER');
  });

  // I. Authenticated user cannot choose another target user_id
  test('I. POST /auth/link-google derives target user strictly from session and ignores payload user_id', async () => {
    const loginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/merchant/login'
    }, {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    });

    const ownerToken = loginRes.body.token;
    const testSub = 'google-sub-idor-check';
    const idorToken = 'google-token-idor';

    registerMockGoogleToken(idorToken, {
      sub: testSub,
      email: 'idor@gmail.com',
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    // Attacker tries to inject user_id: 'usr_someone_else' in the request body
    const linkRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/link-google',
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    }, {
      credential: idorToken,
      user_id: 'usr_someone_else'
    });

    assert.equal(linkRes.status, 200);

    // Verify it was linked to usr_bangjo_owner, NEVER 'usr_someone_else'
    const linkRow = db.prepare('SELECT user_id FROM user_auth_providers WHERE provider_user_id = ?').get(testSub);
    assert.equal(linkRow.user_id, 'usr_bangjo_owner');
  });

  // J. Repeating the same link operation is safe/idempotent
  test('J. Repeating the same link operation for the same user is safe and idempotent', async () => {
    const loginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/merchant/login'
    }, {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    });

    const ownerToken = loginRes.body.token;
    const testSub = 'google-sub-idempotent';
    const idemToken = 'google-token-idempotent';

    registerMockGoogleToken(idemToken, {
      sub: testSub,
      email: 'idem@gmail.com',
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    // First call: links
    const firstRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/link-google',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, { credential: idemToken });
    assert.equal(firstRes.status, 200);
    assert.equal(firstRes.body.already_linked, false);

    // Second call: idempotent success
    const secondRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/link-google',
      headers: { Authorization: `Bearer ${ownerToken}` }
    }, { credential: idemToken });
    assert.equal(secondRes.status, 200);
    assert.equal(secondRes.body.already_linked, true);

    // Confirm only 1 row in database
    const rows = db.prepare("SELECT * FROM user_auth_providers WHERE provider = 'google' AND provider_user_id = ?").all(testSub);
    assert.equal(rows.length, 1);
  });

  // K. Existing sessions/authorization remain compatible
  test('K. Google authentication creates standard TokenSessionStore session and preserves role/tenant boundary', async () => {
    const testSub = 'google-sub-compat-test';
    const compatToken = 'google-token-compat';

    const service = new AuthProviderService();
    service.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: testSub,
      email: 'owner@bangjo.com'
    });

    registerMockGoogleToken(compatToken, {
      sub: testSub,
      email: 'owner@bangjo.com',
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const authRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google'
    }, { credential: compatToken });

    assert.equal(authRes.status, 200);
    const token = authRes.body.token;
    assert.ok(token.startsWith('xnt_auth_'));

    // Check internal TokenSessionStore
    const session = global.TokenSessionStore.getSession(token);
    assert.ok(session);
    assert.equal(session.id, 'usr_bangjo_owner');
    assert.equal(session.role, 'owner');
    assert.equal(session.brandId, 'brand_bangjo');
    assert.equal(session.organizationId, 'org_xentra_holding');
    assert.equal(session.email_verified, true);

    // Verify session can access authorized endpoint (e.g. GET /api/v1/admin/users)
    const usersRes = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/admin/users',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(usersRes.status, 200);
    assert.ok(Array.isArray(usersRes.body.users));
  });

  // L. Upstream Google availability failure (network timeout / DNS / connection drop) fails closed with 503
  test('L. Google network timeout or unreachable fails closed with 503 GOOGLE_SERVICE_UNAVAILABLE', async () => {
    // Mock a network error where err.response is undefined (e.g. timeout / ENOTFOUND)
    const timeoutClient = {
      async get() {
        const timeoutErr = new Error('connect ETIMEDOUT 142.250.190.42:443');
        timeoutErr.code = 'ETIMEDOUT';
        // Note: No err.response property present on network timeouts
        throw timeoutErr;
      }
    };

    const svc = new GoogleAuthService({
      clientId: TEST_CLIENT_ID,
      httpClient: timeoutClient
    });

    await assert.rejects(async () => {
      await svc.verifyIdToken('header.validpayload.signature');
    }, (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.code, 'GOOGLE_SERVICE_UNAVAILABLE');
      return true;
    });
  });

  // M. Malformed / empty token string is rejected before upstream call
  test('M. Malformed or non-3-part token is rejected with 400 MALFORMED_GOOGLE_TOKEN before upstream request', async () => {
    let upstreamCalled = false;
    const trackingClient = {
      async get() {
        upstreamCalled = true;
        return { data: {} };
      }
    };

    const svc = new GoogleAuthService({
      clientId: TEST_CLIENT_ID,
      httpClient: trackingClient
    });

    // 1. Not a 3-part JWT
    await assert.rejects(async () => {
      await svc.verifyIdToken('just-a-plain-string');
    }, (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'MALFORMED_GOOGLE_TOKEN');
      return true;
    });
    assert.equal(upstreamCalled, false, 'Upstream network call must NOT be made for malformed token');

    // 2. Empty token
    await assert.rejects(async () => {
      await svc.verifyIdToken('   ');
    }, (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'MISSING_GOOGLE_CREDENTIAL');
      return true;
    });
  });

  // N. Insecure or arbitrary tokenInfoUrl in production is rejected (SSRF protection)
  test('N. Insecure or arbitrary tokenInfoUrl is rejected in production to prevent SSRF', () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      assert.throws(() => {
        new GoogleAuthService({
          clientId: TEST_CLIENT_ID,
          tokenInfoUrl: 'http://169.254.169.254/latest/meta-data/' // AWS metadata SSRF attempt
        });
      }, /Overriding Google tokenInfoUrl is strictly forbidden in production/);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  // O. GET /auth/config exposes google_enabled and google_client_id correctly
  test('O. GET /auth/config returns runtime auth configuration without exposing secrets', async () => {
    const res = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/auth/config'
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.google_enabled, true);
    assert.equal(res.body.google_client_id, TEST_CLIENT_ID);
    assert.equal(res.body.client_secret, undefined, 'Client secret must never exist in response');
  });

  // P. Unlinked Google account authentication returns 404 ACCOUNT_NOT_LINKED without creating user
  test('P. Unlinked Google account login returns 404 ACCOUNT_NOT_LINKED and creates no new user', async () => {
    const unlinkedSub = 'google-sub-unlinked-visitor';
    const unlinkedToken = 'google-token-unlinked';

    registerMockGoogleToken(unlinkedToken, {
      sub: unlinkedSub,
      email: 'unlinked.stranger@gmail.com',
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const userCountBefore = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;

    const authRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google'
    }, {
      credential: unlinkedToken
    });

    assert.equal(authRes.status, 404);
    assert.equal(authRes.body.code, 'ACCOUNT_NOT_LINKED');

    const userCountAfter = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    assert.equal(userCountAfter, userCountBefore, 'No user record must be created for unlinked Google account');
  });

  // Q. GET /dashboard/login serves login page containing Google auth integration elements
  test('Q. GET /dashboard/login serves HTML page containing Google Sign-In container and SDK setup', async () => {
    const res = await makeRequest(server, {
      method: 'GET',
      path: '/dashboard/login'
    });

    assert.equal(res.status, 200);
    assert.ok(res.raw.includes('id="google-auth-container"'), 'Page must have google-auth-container');
    assert.ok(res.raw.includes('id="google-btn-slot"'), 'Page must have google-btn-slot');
    assert.ok(res.raw.includes('/api/v1/auth/google'), 'Page must wire to /api/v1/auth/google');
    assert.ok(res.raw.includes('form-merchant-login'), 'Legacy form must remain present');
  });

  // R. Environment GOOGLE_CLIENT_ID is strictly enforced as expected audience
  test('R. process.env.GOOGLE_CLIENT_ID is strictly used as the expected audience in verification', async () => {
    const customClientId = 'custom-configured-client-id.apps.googleusercontent.com';
    const prevClientId = process.env.GOOGLE_CLIENT_ID;
    
    try {
      process.env.GOOGLE_CLIENT_ID = customClientId;
      const svc = new GoogleAuthService();
      assert.equal(svc.clientId, customClientId, 'Service must consume process.env.GOOGLE_CLIENT_ID');

      // Mock tokeninfo returning the custom audience
      const customToken = formatMockJwt('google-token-custom-aud');
      registerMockGoogleToken(customToken, {
        sub: 'sub-custom-aud',
        email: 'custom@bangjo.com',
        email_verified: true,
        aud: customClientId,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 3600
      });

      const verified = await svc.verifyIdToken(customToken);
      assert.equal(verified.sub, 'sub-custom-aud');

      // Reject token with previous or mismatched audience
      const mismatchedToken = formatMockJwt('google-token-mismatch');
      registerMockGoogleToken(mismatchedToken, {
        sub: 'sub-mismatch',
        email: 'custom@bangjo.com',
        email_verified: true,
        aud: 'mismatched-aud.apps.googleusercontent.com',
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 3600
      });

      await assert.rejects(async () => {
        await svc.verifyIdToken(mismatchedToken);
      }, (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.code, 'INVALID_TOKEN_AUDIENCE');
        return true;
      });
    } finally {
      process.env.GOOGLE_CLIENT_ID = prevClientId;
    }
  });

  // S. Google-First Registration & Onboarding provisions Organization, Brand, Branch, User, and Links Google sub
  test('S. POST /auth/google-onboard provisions full tenant stack and links Google sub atomically', async () => {
    const runId = Math.random().toString(36).substring(2, 8);
    const onboardSub = `google-sub-onboard-${runId}`;
    const onboardToken = `google-token-onboard-${runId}`;
    const onboardEmail = `owner_${runId}@newresto.com`;

    registerMockGoogleToken(onboardToken, {
      sub: onboardSub,
      email: onboardEmail,
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'Fresh Owner'
    });

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google-onboard'
    }, {
      credential: onboardToken,
      business_name: 'Resto Baru Sedap',
      brand_name: 'Resto Baru Sedap',
      branch_name: 'Cabang Utama Baru',
      phone: '081299998888',
      address_text: 'Jl. Raya Baru No. 10'
    });

    assert.equal(res.status, 201, `Expected 201 Created, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token, 'Must return valid session token');
    assert.equal(res.body.user.email, onboardEmail);
    assert.equal(res.body.user.role, 'owner');
    assert.equal(res.body.user.email_verified, true, 'Google email must be marked verified immediately');
    assert.ok(res.body.organization.id);
    assert.ok(res.body.brand.id);
    assert.ok(res.body.branch.id);

    // Verify user_auth_providers link exists and is mapped to the new user
    const link = db.prepare("SELECT * FROM user_auth_providers WHERE provider = 'google' AND provider_user_id = ?").get(onboardSub);
    assert.ok(link, 'Google sub link must exist in database');
    assert.equal(link.user_id, res.body.user.id);
    assert.equal(link.email, onboardEmail);

    // Verify the returned token can access owner-protected endpoints immediately
    const meRes = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/auth/merchant/me',
      headers: { Authorization: `Bearer ${res.body.token}` }
    });
    assert.equal(meRes.status, 200, `Expected 200, got ${meRes.status}: ${JSON.stringify(meRes.body)}`);
    assert.equal(meRes.body.user.id, res.body.user.id);
    assert.equal(meRes.body.user.role, 'owner');

    // Verify subsequent login with the same Google account resolves to this new user
    const loginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google',
      headers: { Host: 'xentra.cloud' }
    }, {
      credential: onboardToken
    });
    assert.equal(loginRes.status, 200, `Expected 200, got ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
    assert.equal(loginRes.body.user.id, res.body.user.id);
  });

  // T. POST /auth/google-onboard rejects unverified Google email
  test('T. POST /auth/google-onboard rejects unverified Google email with 400 UNVERIFIED_GOOGLE_EMAIL', async () => {
    const unverifiedToken = 'google-token-onboard-unverified';
    registerMockGoogleToken(unverifiedToken, {
      sub: 'google-sub-onboard-unverified',
      email: 'unverified.owner@newresto.com',
      email_verified: false,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google-onboard'
    }, {
      credential: unverifiedToken,
      business_name: 'Unverified Resto'
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'UNVERIFIED_GOOGLE_EMAIL');
  });

  // U. POST /auth/google-onboard rejects duplicate Google sub if already linked to any user
  test('U. POST /auth/google-onboard rejects duplicate Google sub with 409 PROVIDER_ALREADY_LINKED', async () => {
    const alreadyLinkedSub = 'google-sub-already-linked-owner';
    const alreadyLinkedToken = 'google-token-already-linked-owner';

    // Link to Bangjo owner first
    const service = new AuthProviderService();
    service.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: alreadyLinkedSub,
      email: 'owner@bangjo.com'
    });

    registerMockGoogleToken(alreadyLinkedToken, {
      sub: alreadyLinkedSub,
      email: 'owner@bangjo.com',
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google-onboard'
    }, {
      credential: alreadyLinkedToken,
      business_name: 'Duplicate Resto Attempt'
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'PROVIDER_ALREADY_LINKED');
  });

  // V. Email collision protection: cannot onboard a new account if email exists in users table under different user
  test('V. POST /auth/google-onboard rejects if Google email matches existing user under different sub', async () => {
    const collisionSub = 'google-sub-email-collision-stranger';
    const collisionToken = 'google-token-email-collision-stranger';

    // usr_bangjo_owner has email: admin@bangjo.com
    registerMockGoogleToken(collisionToken, {
      sub: collisionSub,
      email: 'admin@bangjo.com', // COLLIDES with existing Bangjo owner email!
      email_verified: true,
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google-onboard'
    }, {
      credential: collisionToken,
      business_name: 'Hijack Attempt Resto'
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'EMAIL_EXISTS');
  });

  // W. Existing legacy Bangjo Owner remains completely unaffected by Google onboarding
  test('W. Existing Bangjo Owner and legacy authentication remain fully functional after new Google onboarding', async () => {
    const loginRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/merchant/login'
    }, {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    });

    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.user.id, 'usr_bangjo_owner');
    assert.equal(loginRes.body.user.role, 'owner');
  });

  after(() => {
    if (server) {
      server.close();
    }
  });
});

