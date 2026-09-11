'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';

const app = require('../../server/app');
const db = require('../../server/database/db');
const {
  PlatformBootstrapService,
  RoleModel,
  WorkforceService
} = require('../../core/identity');

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

describe('TASK 3B — Platform Owner Authentication (HTTP & Boundary)', () => {
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
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    // Clean platform users and reset rate limiters / test state
    try {
      db.prepare("DELETE FROM users WHERE role = 'platform_owner'").run();
      db.prepare("DELETE FROM security_audit_log WHERE actor_role = 'platform_owner' OR action LIKE 'PLATFORM%'").run();
    } catch (_) {}

    // Bootstrap a known Platform Owner for auth testing
    const bootstrapService = new PlatformBootstrapService(db);
    bootstrapService.bootstrapPlatformOwner({
      email: 'admin@xentra.cloud',
      password: 'PlatformPassword123!',
      full_name: 'Platform Superadmin'
    });
  });

  it('1. Valid Platform Owner login returns token, platform_user profile, and MFA readiness', async () => {
    const res = await request('POST', '/api/v1/platform/auth/login', {
      email: 'admin@xentra.cloud',
      password: 'PlatformPassword123!'
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.token && res.data.token.startsWith('xnt_auth_'));
    assert.ok(res.data.expires_at);

    // Profile verification
    const user = res.data.platform_user;
    assert.ok(user);
    assert.equal(user.email, 'admin@xentra.cloud');
    assert.equal(user.role, 'platform_owner');
    assert.equal(user.status, 'active');
    assert.strictEqual(user.password, undefined);
    assert.strictEqual(user.password_hash, undefined);

    // MFA readiness verification
    assert.equal(user.mfa_status.mfa_enrolled, false);
    assert.equal(user.mfa_status.mfa_required, true);
    assert.equal(user.mfa_status.mfa_ready, true);
    assert.equal(user.mfa_status.mfa_enforced, false);
  });

  it('2. Invalid Platform Owner password returns 401 INVALID_CREDENTIALS', async () => {
    const res = await request('POST', '/api/v1/platform/auth/login', {
      email: 'admin@xentra.cloud',
      password: 'WrongPassword999!'
    });

    assert.equal(res.status, 401);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'INVALID_CREDENTIALS');
    assert.strictEqual(res.data.token, undefined);
  });

  it('3. Nonexistent Platform Owner returns 401 INVALID_CREDENTIALS without leaking user existence', async () => {
    const res = await request('POST', '/api/v1/platform/auth/login', {
      email: 'nonexistent@xentra.cloud',
      password: 'AnyPassword123!'
    });

    assert.equal(res.status, 401);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'INVALID_CREDENTIALS');
    assert.equal(res.data.message, 'Email atau password salah.');
  });

  it('4. Merchant Owner credentials CANNOT login through platform login', async () => {
    // Legacy merchant admin exists: admin@bangjo.com / bangjo123
    const res = await request('POST', '/api/v1/platform/auth/login', {
      email: 'admin@bangjo.com',
      password: 'bangjo123'
    });

    assert.equal(res.status, 401);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'INVALID_CREDENTIALS');
    assert.strictEqual(res.data.token, undefined);
  });

  it('5. Platform Owner credentials CANNOT login through merchant login', async () => {
    // Attempt login to merchant endpoint with platform owner credentials
    const res = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'admin@xentra.cloud',
      password: 'PlatformPassword123!'
    }, {
      'Host': 'app.mybangjo.com'
    });

    assert.equal(res.status, 401);
    assert.equal(res.data.success, false);
    assert.strictEqual(res.data.token, undefined);
  });

  it('6. Valid platform token passes requirePlatformAuth() on GET /api/v1/platform/me', async () => {
    // 1. Login
    const loginRes = await request('POST', '/api/v1/platform/auth/login', {
      email: 'admin@xentra.cloud',
      password: 'PlatformPassword123!'
    });
    assert.equal(loginRes.status, 200);
    const token = loginRes.data.token;

    // 2. Call /api/v1/platform/me with token
    const meRes = await request('GET', '/api/v1/platform/me', null, {
      'Authorization': `Bearer ${token}`
    });

    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.success, true);
    assert.equal(meRes.data.platform_user.email, 'admin@xentra.cloud');
    assert.equal(meRes.data.platform_user.role, 'platform_owner');
    assert.equal(meRes.data.platform_user.mfa_status.mfa_ready, true);
    assert.equal(meRes.data.platform_user.mfa_status.mfa_enforced, false);
  });

  it('7. Platform token CANNOT access merchant tenant operations (rejected by requireAuth)', async () => {
    // 1. Login as Platform Owner
    const loginRes = await request('POST', '/api/v1/platform/auth/login', {
      email: 'admin@xentra.cloud',
      password: 'PlatformPassword123!'
    });
    const token = loginRes.data.token;

    // 2. Attempt to call protected merchant admin endpoint on app.mybangjo.com
    const merchantRes = await request('GET', '/api/v1/admin/brand', null, {
      'Host': 'app.mybangjo.com',
      'Authorization': `Bearer ${token}`
    });

    assert.equal(merchantRes.status, 403);
    assert.equal(merchantRes.data.success, false);
    assert.equal(merchantRes.data.error, 'FORBIDDEN_TENANT_ACCESS');
  });

  it('8. Merchant token CANNOT access platform operations (rejected by requirePlatformAuth)', async () => {
    // 1. Login as Merchant Owner
    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'admin',
      password: 'bangjo123'
    }, {
      'Host': 'app.mybangjo.com'
    });
    assert.equal(loginRes.status, 200);
    const merchantToken = loginRes.data.token;

    // 2. Attempt to call platform me endpoint with merchant token
    const platformRes = await request('GET', '/api/v1/platform/me', null, {
      'Authorization': `Bearer ${merchantToken}`
    });

    assert.equal(platformRes.status, 403);
    assert.equal(platformRes.data.success, false);
    assert.equal(platformRes.data.error, 'FORBIDDEN_PLATFORM_ACCESS');
  });

  it('9. Platform session has NO fake tenant requirement (brand_id is null)', async () => {
    const loginRes = await request('POST', '/api/v1/platform/auth/login', {
      email: 'admin@xentra.cloud',
      password: 'PlatformPassword123!'
    });
    const token = loginRes.data.token;

    const session = global.TokenSessionStore.getSession(token);
    assert.ok(session);
    assert.equal(session.role, 'platform_owner');
    assert.equal(session.brandId, null);
    assert.equal(session.brand_id, null);
    assert.equal(session.organizationId, null);
    assert.equal(session.organization_id, null);
    assert.equal(session.branchId, null);
  });

  it('10. Sensitive secrets (password/hash/token) are NEVER leaked or logged', async () => {
    const loginRes = await request('POST', '/api/v1/platform/auth/login', {
      email: 'admin@xentra.cloud',
      password: 'PlatformPassword123!'
    });

    const bodyStr = JSON.stringify(loginRes.data);
    assert.strictEqual(bodyStr.includes('PlatformPassword123!'), false);
    assert.strictEqual(bodyStr.includes('$2'), false);

    // Verify security_audit_log
    const auditRows = db.prepare("SELECT * FROM security_audit_log WHERE action = 'PLATFORM_LOGIN_SUCCESS'").all();
    assert.ok(auditRows.length > 0);

    for (const row of auditRows) {
      const rowStr = JSON.stringify(row);
      assert.strictEqual(rowStr.includes('PlatformPassword123!'), false);
      assert.strictEqual(rowStr.includes('$2'), false);
      assert.strictEqual(rowStr.includes(loginRes.data.token), false);
    }
  });

  it('11. Failed login audit event is logged without sensitive secrets', async () => {
    await request('POST', '/api/v1/platform/auth/login', {
      email: 'admin@xentra.cloud',
      password: 'WrongPasswordAttempt!'
    });

    const failedAudit = db.prepare("SELECT * FROM security_audit_log WHERE action = 'PLATFORM_LOGIN_FAILED' ORDER BY created_at DESC LIMIT 1").get();
    assert.ok(failedAudit);
    assert.equal(failedAudit.result, 'failure');
    assert.equal(failedAudit.actor_role, 'platform_owner');

    const meta = JSON.parse(failedAudit.metadata);
    assert.strictEqual(meta.reason, 'password_mismatch');
    assert.strictEqual(JSON.stringify(failedAudit).includes('WrongPasswordAttempt!'), false);
  });

  it('12. Missing email or password returns 400 VALIDATION_ERROR', async () => {
    const res1 = await request('POST', '/api/v1/platform/auth/login', {
      email: 'admin@xentra.cloud'
    });
    assert.equal(res1.status, 400);
    assert.equal(res1.data.error, 'VALIDATION_ERROR');

    const res2 = await request('POST', '/api/v1/platform/auth/login', {
      password: 'PlatformPassword123!'
    });
    assert.equal(res2.status, 400);
    assert.equal(res2.data.error, 'VALIDATION_ERROR');
  });

});
