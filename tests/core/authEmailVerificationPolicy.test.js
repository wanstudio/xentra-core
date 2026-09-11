'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';

const app = require('../../server/app');
const db = require('../../server/database/db');
const { defaultEmailProvider, RegistrationService, EmailVerificationService } = require('../../core/identity');

let server;
let baseUrl;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'xentra.cloud',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Email Verification Access Policy (AUTHV-01 to AUTHV-11)', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('AUTHV-01: newly registered owner is explicitly unverified', async () => {
    defaultEmailProvider.clear();
    const res = await request('POST', '/api/v1/auth/register', {
      email: 'authv01_owner@cafe.com',
      password: 'SecurePassword123!',
      business_name: 'AuthV01 Cafe'
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.user.email_verified, false);
    assert.ok(res.data.token);

    const user = db.prepare('SELECT email_verified_at FROM users WHERE email = ?').get('authv01_owner@cafe.com');
    assert.equal(user.email_verified_at, null);
  });

  it('AUTHV-02 & AUTHV-03: unverified owner is blocked from protected merchant/dashboard operations with EMAIL_NOT_VERIFIED', async () => {
    defaultEmailProvider.clear();
    // Register business and get its brand custom domain so tenant check passes
    const regRes = await request('POST', '/api/v1/auth/register', {
      email: 'authv02_owner@cafe.com',
      password: 'SecurePassword123!',
      business_name: 'AuthV02 Cafe'
    });
    assert.equal(regRes.status, 201);
    const token = regRes.data.token;
    const brandId = regRes.data.brand.id;

    // Set custom_domain for this brand to test against it
    db.prepare('UPDATE brands SET custom_domain = ? WHERE id = ?').run('authv02.test.mybangjo.com', brandId);

    const tenantHeaders = {
      'Authorization': `Bearer ${token}`,
      'Host': 'authv02.test.mybangjo.com'
    };

    // Attempt protected operational dashboard actions
    // 1. Brand profile access
    const brandRes = await request('GET', '/api/v1/admin/brand', null, tenantHeaders);
    assert.equal(brandRes.status, 403);
    assert.equal(brandRes.data.success, false);
    assert.equal(brandRes.data.code, 'EMAIL_NOT_VERIFIED');

    // 2. Branch list access
    const branchesRes = await request('GET', '/api/v1/admin/branches', null, tenantHeaders);
    assert.equal(branchesRes.status, 403);
    assert.equal(branchesRes.data.code, 'EMAIL_NOT_VERIFIED');

    // 3. User workforce list access
    const usersRes = await request('GET', '/api/v1/admin/users', null, tenantHeaders);
    assert.equal(usersRes.status, 403);
    assert.equal(usersRes.data.code, 'EMAIL_NOT_VERIFIED');

    // 4. Products list access
    const productsRes = await request('GET', '/api/v1/admin/products', null, tenantHeaders);
    assert.equal(productsRes.status, 403);
    assert.equal(productsRes.data.code, 'EMAIL_NOT_VERIFIED');

    // However, non-operational verification UX routes must be permitted:
    // User profile status check
    const meRes = await request('GET', '/api/v1/auth/merchant/me', null, tenantHeaders);
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.user.email_verified, false);

    // Resend verification using bearer session
    const resendRes = await request('POST', '/api/v1/auth/resend-verification', {}, tenantHeaders);
    assert.equal(resendRes.status, 200);
    assert.equal(resendRes.data.success, true);
  });

  it('AUTHV-04: verification immediately enables normal owner authorization without manual DB intervention', async () => {
    defaultEmailProvider.clear();
    const regRes = await request('POST', '/api/v1/auth/register', {
      email: 'authv04_owner@cafe.com',
      password: 'SecurePassword123!',
      business_name: 'AuthV04 Cafe'
    });
    assert.equal(regRes.status, 201);
    const brandId = regRes.data.brand.id;
    db.prepare('UPDATE brands SET custom_domain = ? WHERE id = ?').run('authv04.test.mybangjo.com', brandId);

    // Get verification token sent for authv04_owner@cafe.com
    const sentEmail = defaultEmailProvider.getLastSentEmail('authv04_owner@cafe.com');
    assert.ok(sentEmail);
    const rawToken = sentEmail.rawToken;

    // Verify token via GET /verify-email?token=...
    const verifyRes = await request('GET', `/verify-email?token=${rawToken}`);
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.data.success, true);

    // Login as verified owner
    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'authv04_owner@cafe.com',
      password: 'SecurePassword123!'
    }, {
      'Host': 'authv04.test.mybangjo.com'
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.user.email_verified, true);
    const verifiedToken = loginRes.data.token;

    const tenantHeaders = {
      'Authorization': `Bearer ${verifiedToken}`,
      'Host': 'authv04.test.mybangjo.com'
    };

    // Access previously blocked operational dashboard routes - must now succeed
    const brandRes = await request('GET', '/api/v1/admin/brand', null, tenantHeaders);
    assert.equal(brandRes.status, 200);
    assert.equal(brandRes.data.success, true);

    const branchesRes = await request('GET', '/api/v1/admin/branches', null, tenantHeaders);
    assert.equal(branchesRes.status, 200);
    assert.equal(branchesRes.data.success, true);
  });

  it('AUTHV-05: verified legacy Bangjo admin remains fully functional', async () => {
    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    }, {
      'Host': 'app.mybangjo.com'
    });

    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.user.email_verified, true);
    const adminToken = loginRes.data.token;

    // Operational routes succeed
    const brandRes = await request('GET', '/api/v1/admin/brand', null, {
      'Authorization': `Bearer ${adminToken}`,
      'Host': 'app.mybangjo.com'
    });
    assert.equal(brandRes.status, 200);
  });

  it('AUTHV-06: stale session created BEFORE verification auto-heals and gains access once verified in DB', async () => {
    defaultEmailProvider.clear();
    const regRes = await request('POST', '/api/v1/auth/register', {
      email: 'stale_session@cafe.com',
      password: 'SecurePassword123!',
      business_name: 'Stale Session Cafe'
    });
    const preVerificationToken = regRes.data.token;
    const brandId = regRes.data.brand.id;
    db.prepare('UPDATE brands SET custom_domain = ? WHERE id = ?').run('stale.test.mybangjo.com', brandId);

    const tenantHeaders = {
      'Authorization': `Bearer ${preVerificationToken}`,
      'Host': 'stale.test.mybangjo.com'
    };

    // Blocked before verification
    const preRes = await request('GET', '/api/v1/admin/brand', null, tenantHeaders);
    assert.equal(preRes.status, 403);
    assert.equal(preRes.data.code, 'EMAIL_NOT_VERIFIED');

    // Complete email verification out-of-band (e.g. clicking link in another tab)
    const emailVerification = new EmailVerificationService(db);
    const sentEmail = defaultEmailProvider.getLastSentEmail('stale_session@cafe.com');
    emailVerification.verifyToken(sentEmail.rawToken);

    // Using the EXACT SAME OLD SESSION TOKEN without logging in again
    // The middleware detects verified status from DB and allows request
    const postRes = await request('GET', '/api/v1/admin/brand', null, tenantHeaders);
    assert.equal(postRes.status, 200, 'Stale session must auto-heal from DB and succeed');
    assert.equal(postRes.data.success, true);
  });

  it('AUTHV-07: verification of User A does not affect unverified User B', async () => {
    defaultEmailProvider.clear();
    const regB = await request('POST', '/api/v1/auth/register', {
      email: 'user_b_unverified@cafe.com',
      password: 'SecurePassword123!',
      business_name: 'User B Cafe'
    });
    const tokenB = regB.data.token;
    const brandIdB = regResB_id(regB);
    db.prepare('UPDATE brands SET custom_domain = ? WHERE id = ?').run('userb.test.mybangjo.com', brandIdB);

    function regResB_id(res) {
      return res.data.brand.id;
    }

    const tenantHeadersB = {
      'Authorization': `Bearer ${tokenB}`,
      'Host': 'userb.test.mybangjo.com'
    };

    // User A was verified in previous test, User B remains unverified
    const resB = await request('GET', '/api/v1/admin/brand', null, tenantHeadersB);
    assert.equal(resB.status, 403);
    assert.equal(resB.data.code, 'EMAIL_NOT_VERIFIED');
  });

  it('AUTHV-08: cross-tenant verification attempt fails and tenant isolation is preserved', async () => {
    const userB = db.prepare('SELECT * FROM users WHERE email = ?').get('user_b_unverified@cafe.com');
    const userA = db.prepare('SELECT * FROM users WHERE email = ?').get('stale_session@cafe.com');

    // Ensure distinct tenants
    assert.notEqual(userB.brand_id, userA.brand_id);
    assert.notEqual(userB.organization_id, userA.organization_id);

    // Verify user B's token cannot verify user A or be used cross-tenant
    const sentEmailB = defaultEmailProvider.getLastSentEmail('user_b_unverified@cafe.com');
    const emailVerification = new EmailVerificationService(db);
    const verifyResult = emailVerification.verifyToken(sentEmailB.rawToken);

    // Verify target of token was strictly user B
    assert.equal(verifyResult.userId, userB.id);
    assert.equal(verifyResult.brandId, userB.brand_id);
    assert.notEqual(verifyResult.brandId, userA.brand_id);
  });
});
