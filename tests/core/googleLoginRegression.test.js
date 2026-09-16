'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const db = require('../../server/database/db');
const app = require('../../server/app');
const { AuthProviderService } = require('../../core/identity');

const TEST_CLIENT_ID = 'xentra-google-regression-client-id.apps.googleusercontent.com';
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

function registerGoogleToken(name, claims) {
  const jwt = `header.${name}.signature`;
  mockGoogleTokens.set(jwt, claims);
  mockGoogleTokens.set(name, claims);
  return jwt;
}

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    let finalBody = body;
    if (body && typeof body === 'object') {
      finalBody = { ...body };
      if (finalBody.credential && typeof finalBody.credential === 'string') {
        finalBody.credential = registerGoogleToken(finalBody.credential, mockGoogleTokens.get(finalBody.credential) || {});
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
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

describe('Google Login Regression — immutable sub identity contract', () => {
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
    db.prepare("UPDATE users SET status = 'active' WHERE id = 'usr_bangjo_owner'").run();
    db.prepare('DELETE FROM user_auth_providers').run();
  });

  function linkGoogleToOwner(sub = 'google-sub-reg-owner') {
    return providerService.linkProvider({
      userId: 'usr_bangjo_owner',
      provider: 'google',
      providerUserId: sub,
      email: 'admin@bangjo.com'
    });
  }

  function loginWithGoogle(credential) {
    return makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google'
    }, { credential });
  }

  test('GOOGLE-REG-01: existing Google-linked Xentra user can authenticate', async () => {
    linkGoogleToOwner('google-sub-reg-01');
    registerGoogleToken('google-token-reg-01', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'google-sub-reg-01',
      email: 'admin@bangjo.com',
      email_verified: 'true'
    });

    const res = await loginWithGoogle('google-token-reg-01');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token);
    assert.equal(res.body.user.id, 'usr_bangjo_owner');
  });

  test('GOOGLE-REG-02: Google identity lookup uses immutable sub (never email)', async () => {
    linkGoogleToOwner('google-sub-reg-02');
    const identity = providerService.findIdentity('google', 'google-sub-reg-02');
    assert.ok(identity);
    assert.equal(identity.providerUserId, 'google-sub-reg-02');
    assert.equal(identity.user.email, 'admin@bangjo.com');

    // Looking up by email must never resolve a Google identity
    assert.equal(providerService.findIdentity('google', 'admin@bangjo.com'), null);
  });

  test('GOOGLE-REG-03: existing Google login resolves the SAME Xentra user', async () => {
    linkGoogleToOwner('google-sub-reg-03');
    registerGoogleToken('google-token-reg-03', {
      aud: TEST_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'google-sub-reg-03',
      email: 'admin@bangjo.com',
      email_verified: true
    });

    const res = await loginWithGoogle('google-token-reg-03');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, 'usr_bangjo_owner');
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE email = 'admin@bangjo.com'").get().c, 1);
  });

  test('GOOGLE-REG-04: Google login does not create duplicate users', async () => {
    linkGoogleToOwner('google-sub-reg-04');
    const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    registerGoogleToken('google-token-reg-04', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'google-sub-reg-04',
      email: 'admin@bangjo.com',
      email_verified: 'true'
    });

    const res = await loginWithGoogle('google-token-reg-04');
    assert.equal(res.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before);
  });

  test('GOOGLE-REG-05: unlinked Google account receives ACCOUNT_NOT_LINKED and creates no user', async () => {
    const before = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    registerGoogleToken('google-token-reg-05', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'google-sub-reg-05-unlinked',
      email: 'stranger@gmail.com',
      email_verified: 'true'
    });

    const res = await loginWithGoogle('google-token-reg-05');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ACCOUNT_NOT_LINKED');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, before);
  });

  test('GOOGLE-REG-06: wrong Google sub cannot authenticate as another user', async () => {
    linkGoogleToOwner('google-sub-reg-06');
    registerGoogleToken('google-token-reg-06', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'google-sub-reg-06-wrong',
      email: 'admin@bangjo.com',
      email_verified: 'true'
    });

    const res = await loginWithGoogle('google-token-reg-06');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ACCOUNT_NOT_LINKED');
  });

  test('GOOGLE-REG-07: Google identity survives database/application initialization', async () => {
    linkGoogleToOwner('google-sub-reg-07');

    // Re-run schema/seed initialization exactly like an application restart.
    db.initSchema(db);
    db.seedData(db);

    const identity = providerService.findIdentity('google', 'google-sub-reg-07');
    assert.ok(identity, 'provider identity must survive schema/seed initialization');
    assert.equal(identity.user.id, 'usr_bangjo_owner');
  });

  test('GOOGLE-REG-08: disabled linked user cannot authenticate', async () => {
    linkGoogleToOwner('google-sub-reg-08');
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = 'usr_bangjo_owner'").run();
    registerGoogleToken('google-token-reg-08', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'google-sub-reg-08',
      email: 'admin@bangjo.com',
      email_verified: 'true'
    });

    try {
      const res = await loginWithGoogle('google-token-reg-08');
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'ACCOUNT_DISABLED');
    } finally {
      db.prepare("UPDATE users SET status = 'active' WHERE id = 'usr_bangjo_owner'").run();
    }
  });

  test('GOOGLE-REG-09: successful Google login preserves role/org/brand/branch scope', async () => {
    linkGoogleToOwner('google-sub-reg-09');
    const before = db.prepare("SELECT role, organization_id, brand_id, branch_id FROM users WHERE id = 'usr_bangjo_owner'").get();
    registerGoogleToken('google-token-reg-09', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'google-sub-reg-09',
      email: 'admin@bangjo.com',
      email_verified: 'true'
    });

    const res = await loginWithGoogle('google-token-reg-09');
    assert.equal(res.status, 200);
    const after = db.prepare("SELECT role, organization_id, brand_id, branch_id FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.deepEqual(after, before);
  });

  test('GOOGLE-REG-10: workforce invitation user + Google authentication remains valid', async () => {
    const userId = 'usr_reg_branch_manager';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, full_name, role, status, email_verified_at)
      VALUES (?, 'brand_bangjo', 'org_xentra_holding', 'branch_bangjo_barat', 'reg_bm', 'reg_bm@bangjo.com', 'Reg BM', 'branch_manager', 'active', datetime('now'))
    `).run(userId);
    providerService.linkProvider({
      userId,
      provider: 'google',
      providerUserId: 'google-sub-reg-10',
      email: 'reg_bm@bangjo.com'
    });
    registerGoogleToken('google-token-reg-10', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'google-sub-reg-10',
      email: 'reg_bm@bangjo.com',
      email_verified: 'true'
    });

    const res = await loginWithGoogle('google-token-reg-10');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, userId);
    assert.equal(res.body.user.role, 'branch_manager');
    assert.equal(res.body.user.branch_id, 'branch_bangjo_barat');

    db.prepare('DELETE FROM user_auth_providers WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  test('GOOGLE-REG-11: Google provider uniqueness remains enforced', () => {
    linkGoogleToOwner('google-sub-reg-11');
    const otherUserId = 'usr_reg_other';
    db.prepare("INSERT OR REPLACE INTO users (id, brand_id, organization_id, username, role, status) VALUES (?, 'brand_bangjo', 'org_xentra_holding', 'reg_other', 'owner', 'active')").run(otherUserId);

    assert.throws(() => {
      providerService.linkProvider({
        userId: otherUserId,
        provider: 'google',
        providerUserId: 'google-sub-reg-11',
        email: 'other@bangjo.com'
      });
    }, (err) => {
      assert.equal(err.code, 'PROVIDER_ALREADY_LINKED');
      assert.equal(err.status, 409);
      return true;
    });

    db.prepare('DELETE FROM users WHERE id = ?').run(otherUserId);
  });

  test('GOOGLE-REG-12: frontend uses same-origin backend and cannot bypass identity with forged role', async () => {
    const loginHtml = fs.readFileSync(path.join(__dirname, '../../apps/merchant-dashboard/login.html'), 'utf8');
    assert.ok(loginHtml.includes('/api/v1/auth/google'));
    assert.ok(!loginHtml.includes("'https://xentra.cloud/auth/broker?return_to='"));

    registerGoogleToken('google-token-reg-12', {
      aud: TEST_CLIENT_ID,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'google-sub-reg-12-unlinked',
      email: 'stranger@gmail.com',
      email_verified: 'true'
    });

    // A forged role/body value must never bypass the backend identity lookup.
    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google'
    }, {
      credential: 'google-token-reg-12',
      role: 'owner',
      brand_id: 'brand_bangjo'
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ACCOUNT_NOT_LINKED');
  });
});
