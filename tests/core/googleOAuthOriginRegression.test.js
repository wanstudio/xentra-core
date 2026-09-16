'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const db = require('../../server/database/db');
const app = require('../../server/app');
const { AuthProviderService } = require('../../core/identity');

const TEST_CLIENT_ID = 'xentra-google-oauth-origin-test.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;

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

function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    let finalBody = body;
    if (body && typeof body === 'object') {
      finalBody = { ...body };
      if (finalBody.credential && typeof finalBody.credential === 'string') {
        finalBody.credential = registerToken(finalBody.credential, mockGoogleTokens.get(finalBody.credential) || {});
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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

describe('Google OAuth Origin Regression — tenant/platform canonical flow', () => {
  let server;
  const providerService = new AuthProviderService();

  beforeEach(async () => {
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
    if (!server) {
      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
    }
    db.prepare('DELETE FROM user_auth_providers').run();
  });

  after(() => {
    if (server) server.close();
    db.prepare('DELETE FROM user_auth_providers').run();
  });

  const loginHtml = () => fs.readFileSync(path.join(__dirname, '../../apps/merchant-dashboard/login.html'), 'utf8');

  test('GOOGLE-OAUTH-REG-01: merchant login page uses the intended broker flow for tenant origin', () => {
    const html = loginHtml();
    assert.ok(html.includes("'https://xentra.cloud/auth/broker?return_to='"), 'tenant login must redirect to xentra.cloud broker');
    assert.ok(html.includes('/api/v1/auth/google'), 'broker and platform paths must reference the Google auth endpoint');
  });

  test('GOOGLE-OAUTH-REG-02: Google client configuration is loaded from process.env, not hardcoded', async () => {
    const res = await request(server, { method: 'GET', path: '/api/v1/auth/config' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.google_client_id, TEST_CLIENT_ID);
    assert.equal(res.body.google_enabled, true);
  });

  test('GOOGLE-OAUTH-REG-03: tenant/platform origin handling follows the canonical architecture', () => {
    const html = loginHtml();
    assert.ok(html.includes('handlePlatformGoogleCredential'), 'platform path uses inline GSI handler');
    assert.ok(html.includes('initPlatformGoogleSignIn'), 'platform path initializes GSI');
    assert.ok(html.includes("'https://xentra.cloud/auth/broker?return_to='"), 'tenant path uses the xentra.cloud broker');
  });

  test('GOOGLE-OAUTH-REG-04: no hardcoded incorrect tenant origin is introduced', () => {
    const html = loginHtml();
    assert.ok(!html.includes('app.mybangjo.com/auth/broker'), 'login.html must not hardcode the tenant origin as the broker target');
  });

  test('GOOGLE-OAUTH-REG-05: no incorrect return_to domain is introduced', () => {
    const html = loginHtml();
    assert.ok(html.includes('var currentOrigin = window.location.origin;'), 'return_to must be derived from the current origin');
    assert.ok(html.includes("var returnUrl = currentOrigin + '/dashboard/login';"), 'return_to must be built dynamically');
    assert.ok(!html.includes('app.mybangjo.com/auth/broker'), 'return_to must not hardcode a client domain');
  });

  test('GOOGLE-OAUTH-REG-06: /api/v1/auth/google identity lookup remains by immutable sub', async () => {
    providerService.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: 'oauth-sub-06',
      email: 'admin@bangjo.com'
    });
    registerToken('oauth-token-06', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'oauth-sub-06',
      email: 'admin@bangjo.com',
      email_verified: 'true'
    });

    const res = await request(server, { method: 'POST', path: '/api/v1/auth/google' }, { credential: 'oauth-token-06' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, 'usr_bangjo_owner');
  });

  test('GOOGLE-OAUTH-REG-07: existing Google-linked Xentra User still resolves by immutable sub', () => {
    providerService.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: 'oauth-sub-07',
      email: 'admin@bangjo.com'
    });
    const identity = providerService.findIdentity('google', 'oauth-sub-07');
    assert.ok(identity);
    assert.equal(identity.providerUserId, 'oauth-sub-07');
    assert.equal(identity.user.id, 'usr_bangjo_owner');
  });

  test('GOOGLE-OAUTH-REG-08: unlinked Google identity still produces ACCOUNT_NOT_LINKED', async () => {
    registerToken('oauth-token-08', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'oauth-sub-08-unlinked',
      email: 'stranger@gmail.com',
      email_verified: 'true'
    });

    const res = await request(server, { method: 'POST', path: '/api/v1/auth/google' }, { credential: 'oauth-token-08' });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ACCOUNT_NOT_LINKED');
  });

  test('GOOGLE-OAUTH-REG-09: no duplicate Xentra User is created during Google login', async () => {
    providerService.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: 'oauth-sub-09',
      email: 'admin@bangjo.com'
    });
    const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    registerToken('oauth-token-09', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'oauth-sub-09',
      email: 'admin@bangjo.com',
      email_verified: 'true'
    });

    const res = await request(server, { method: 'POST', path: '/api/v1/auth/google' }, { credential: 'oauth-token-09' });
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before);
  });

  test('GOOGLE-OAUTH-REG-10: workforce invitation Google flow remains compatible', async () => {
    const userId = 'usr_oauth_branch_manager';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, full_name, role, status, email_verified_at)
      VALUES (?, 'brand_bangjo', 'org_xentra_holding', 'branch_bangjo_barat', 'oauth_bm', 'oauth_bm@bangjo.com', 'OAuth BM', 'branch_manager', 'active', datetime('now'))
    `).run(userId);
    providerService.linkProvider({
      userId,
      provider: 'google',
      providerUserId: 'oauth-sub-10',
      email: 'oauth_bm@bangjo.com'
    });
    registerToken('oauth-token-10', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'oauth-sub-10',
      email: 'oauth_bm@bangjo.com',
      email_verified: 'true'
    });

    const res = await request(server, { method: 'POST', path: '/api/v1/auth/google' }, { credential: 'oauth-token-10' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'branch_manager');
    assert.equal(res.body.user.branch_id, 'branch_bangjo_barat');

    db.prepare('DELETE FROM user_auth_providers WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
});
