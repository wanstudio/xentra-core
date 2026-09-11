'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';

const app = require('../../server/app');
const db = require('../../server/database/db');
const { RegistrationService } = require('../../core/identity');

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

describe('SaaS Business Registration & Provisioning', () => {
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

  it('REG-01: successfully registers a new business and provisions organization, brand, branch, and owner', async () => {
    const regPayload = {
      email: 'owner@kedaikopi.com',
      password: 'SecurePassword123!',
      full_name: 'Budi Santoso',
      business_name: 'Kedai Kopi Mantap',
      brand_name: 'Kedai Kopi Mantap',
      branch_name: 'Cabang Pusat',
      phone: '081298765432',
      address_text: 'Jl. Pemuda No. 45, Surabaya'
    };

    const res = await request('POST', '/api/v1/auth/register', regPayload);

    assert.equal(res.status, 201, `Expected 201 Created, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.success, true);
    assert.ok(res.data.token, 'Must return authentication session token');
    assert.ok(res.data.expires_at, 'Must return session expiration timestamp');

    // Verify response structure
    assert.ok(res.data.user);
    assert.equal(res.data.user.email, 'owner@kedaikopi.com');
    assert.equal(res.data.user.role, 'owner');
    assert.equal(res.data.user.status, 'active');
    assert.equal(res.data.user.full_name, 'Budi Santoso');

    // Never return password or hash
    assert.equal(res.data.user.password, undefined);
    assert.equal(res.data.user.password_hash, undefined);
    assert.equal(JSON.stringify(res.data).includes('password_hash'), false);

    assert.ok(res.data.organization);
    assert.equal(res.data.organization.name, 'Kedai Kopi Mantap');
    assert.ok(res.data.brand);
    assert.equal(res.data.brand.name, 'Kedai Kopi Mantap');
    assert.ok(res.data.branch);
    assert.equal(res.data.branch.name, 'Cabang Pusat');

    // Verify database persistence
    const savedUser = db.prepare('SELECT * FROM users WHERE email = ?').get('owner@kedaikopi.com');
    assert.ok(savedUser);
    assert.equal(savedUser.role, 'owner');
    assert.equal(savedUser.organization_id, res.data.organization.id);
    assert.equal(savedUser.brand_id, res.data.brand.id);
    assert.equal(savedUser.branch_id, res.data.branch.id);

    // Password must be hashed with bcrypt
    assert.ok(savedUser.password_hash.startsWith('$2'));
    assert.ok(bcrypt.compareSync('SecurePassword123!', savedUser.password_hash));

    // Verify Organization row
    const savedOrg = db.prepare('SELECT * FROM organizations WHERE id = ?').get(res.data.organization.id);
    assert.ok(savedOrg);
    assert.equal(savedOrg.name, 'Kedai Kopi Mantap');

    // Verify Brand row
    const savedBrand = db.prepare('SELECT * FROM brands WHERE id = ?').get(res.data.brand.id);
    assert.ok(savedBrand);
    assert.equal(savedBrand.organization_id, savedOrg.id);

    // Verify Branch & Delivery Settings rows
    const savedBranch = db.prepare('SELECT * FROM branches WHERE id = ?').get(res.data.branch.id);
    assert.ok(savedBranch);
    assert.equal(savedBranch.brand_id, savedBrand.id);
    assert.equal(savedBranch.phone, '081298765432');

    const savedBds = db.prepare('SELECT * FROM branch_delivery_settings WHERE branch_id = ?').get(savedBranch.id);
    assert.ok(savedBds);
  });

  it('REG-02: rejects duplicate email registration with 409 Conflict', async () => {
    const regPayload = {
      email: 'owner@kedaikopi.com', // same email
      password: 'AnotherPassword123!',
      full_name: 'Budi Duplicate',
      business_name: 'Kopi Cabang Lain'
    };

    const res = await request('POST', '/api/v1/auth/register', regPayload);

    assert.equal(res.status, 409);
    assert.equal(res.data.success, false);
    assert.equal(res.data.code, 'EMAIL_EXISTS');
  });

  it('REG-03: rejects invalid or short password with 400 Bad Request', async () => {
    const res = await request('POST', '/api/v1/auth/register', {
      email: 'shortpass@example.com',
      password: 'short',
      business_name: 'Bisnis Test'
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.equal(res.data.code, 'PASSWORD_TOO_SHORT');
  });

  it('REG-04: rejects invalid email format with 400 Bad Request', async () => {
    const res = await request('POST', '/api/v1/auth/register', {
      email: 'invalid-email-format',
      password: 'ValidPassword123!',
      business_name: 'Bisnis Test'
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.equal(res.data.code, 'INVALID_EMAIL');
  });

  it('REG-05: rejects missing business/brand name with 400 Bad Request', async () => {
    const res = await request('POST', '/api/v1/auth/register', {
      email: 'noname@example.com',
      password: 'ValidPassword123!'
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.equal(res.data.code, 'BUSINESS_NAME_REQUIRED');
  });

  it('REG-06: atomic rollback on simulated provisioning error ensures zero orphaned records', () => {
    const regService = new RegistrationService(db);

    // Mock an error during execution by passing a bad database call or invalid trigger
    assert.throws(() => {
      // Intentionally trigger failure by simulating invalid parameters inside a transaction
      regService.registerBusiness({
        email: 'fail_tx@example.com',
        password: 'ValidPassword123!',
        business_name: 'Bisnis Gagal Rollback',
        // Pass a non-numeric latitude or something that triggers error
        latitude: 'INVALID_GEO'
      });
    });

    // Verify that NO partial records were inserted into users, organizations, or brands
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('fail_tx@example.com');
    assert.equal(user, undefined, 'User must not exist after rollback');

    const org = db.prepare('SELECT * FROM organizations WHERE name = ?').get('Bisnis Gagal Rollback');
    assert.equal(org, undefined, 'Organization must not exist after rollback');
  });

  it('REG-07: legacy Bangjo username login remains fully functional and isolated', async () => {
    // Bangjo admin uses legacy username 'admin' and password 'bangjo123'
    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    }, {
      'Host': 'app.mybangjo.com'
    });

    assert.equal(loginRes.status, 200, `Legacy Bangjo admin login failed: ${JSON.stringify(loginRes.data)}`);
    assert.equal(loginRes.data.success, true);
    assert.equal(loginRes.data.user.username, 'admin');
    assert.equal(loginRes.data.user.role, 'owner');
    assert.ok(loginRes.data.token);

    // Verify tenant isolation: Bangjo admin cannot access newly registered business's brand
    const newlyRegisteredUser = db.prepare('SELECT brand_id FROM users WHERE email = ?').get('owner@kedaikopi.com');
    assert.notEqual(loginRes.data.user.brand_name, 'Kedai Kopi Mantap');
    assert.notEqual(loginRes.data.user.branch_id, newlyRegisteredUser.brand_id);
  });
});
