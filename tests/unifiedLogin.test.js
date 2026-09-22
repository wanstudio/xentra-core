'use strict';

/**
 * Unified login + role-resolved landing.
 *
 * One login entry point (/login) for every role; the SERVER resolves the
 * landing surface from the authenticated role, and each surface enforces that
 * resolution so swapping the URL cannot grant a surface. Authentication stays
 * single; authorization/RBAC stays separate (unchanged). KDS remains an
 * optional, inactive capability.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-unified-login';

const app = require('../server/app');
const db = require('../server/database/db');

// Users are branch-scoped, so the demo branches must exist first.
require('./helpers/demoFixtures.js')();

let server;
let baseUrl;

const BRAND_ID = 'brand_bangjo';
const ORG_ID = 'org_xentra_holding';
const BRANCH_ID = 'branch_bangjo_barat';

function request(method, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, baseUrl);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { Host: 'app.mybangjo.com', ...headers }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Inject a staff session for a real user row (no login needed). */
function seedSession(userId, role, branchId = BRANCH_ID) {
  const token = 'uul_' + Math.random().toString(36).slice(2);
  db.prepare(
    `INSERT OR REPLACE INTO users (id, brand_id, organization_id, branch_id, username, email, full_name, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`
  ).run(userId, BRAND_ID, ORG_ID, branchId, userId, userId + '@test.local', 'UUL ' + role, role);
  global.TokenSessionStore.sessions.set(token, {
    type: 'staff',
    role,
    brandId: BRAND_ID,
    brand_id: BRAND_ID,
    organizationId: ORG_ID,
    organization_id: ORG_ID,
    branchId: role === 'owner' ? null : branchId,
    branch_id: role === 'owner' ? null : branchId,
    userId,
    username: userId,
    email_verified: true,
    expiresAt: Date.now() + 3600 * 1000
  });
  return token;
}

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('UNIFIED LOGIN — one entry point, server-resolved landing', async (t) => {
  t.before(async () => {
    await new Promise((resolve) => { server = app.listen(0, resolve); baseUrl = 'http://127.0.0.1:' + server.address().port; });
  });
  t.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db.prepare("DELETE FROM users WHERE id LIKE 'uul_%'").run();
  });

  await t.test('1. /login serves the single login page', async () => {
    const res = await request('GET', '/login');
    assert.equal(res.status, 200, '/login must serve the login page');
    assert.match(res.headers['content-type'] || '', /text\/html/);
    assert.match(res.body, /xentra_merchant_token/, 'must be the merchant login page');
  });

  await t.test('2. the legacy /dashboard/login entry forwards to /login', async () => {
    const res = await request('GET', '/dashboard/login?claim_domain=example.com');
    assert.ok([301, 302, 307, 308].includes(res.status), 'must redirect, not serve a second login surface');
    assert.match(res.headers.location || '', /^\/login(\?|$)/, 'must forward to /login');
    assert.match(res.headers.location || '', /claim_domain=example\.com/, 'must preserve the query');
  });

  await t.test('3. the tenant guard still applies to /login', async () => {
    const url = new URL('/login', baseUrl);
    const res = await new Promise((resolve, reject) => {
      const req = http.request({ method: 'GET', hostname: url.hostname, port: url.port, path: '/login', headers: { Host: 'unknown-tenant.invalid' } },
        (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.status, 404, 'unknown host must fail closed');
    assert.match(res.body, /TENANT_NOT_FOUND/);
  });

  await t.test('4. the server resolves the landing surface per role', async () => {
    const cases = [
      ['uul_owner', 'owner', '/owner/'],
      ['uul_brand', 'brand_manager', '/owner/'],
      ['uul_bm', 'branch_manager', '/merchant/'],
      ['uul_cashier', 'cashier', '/owner/'],
      // KDS capability is OFF in MVP → kitchen has no dedicated surface
      ['uul_kitchen', 'kitchen', '/owner/']
    ];
    for (const [id, role, expected] of cases) {
      const token = seedSession(id, role);
      const res = await request('GET', '/api/v1/auth/merchant/me', { Authorization: 'Bearer ' + token });
      assert.equal(res.status, 200, role + ' must authenticate');
      const body = JSON.parse(res.body);
      assert.equal(body.landing, expected, role + ' must land on ' + expected);
      assert.equal(body.entitlements.kds, false, 'KDS entitlement must stay off in MVP');
    }
  });

  await t.test('5. no surface keeps its own login implementation', () => {
    const files = [
      'apps/merchant-dashboard/assets/js/dashboard.js',
      'apps/merchant-app/assets/js/merchant-app.js',
      'apps/kitchen-app/assets/js/kitchen-app.js',
      'apps/merchant-shared/js/shared.js'
    ];
    files.forEach((f) => {
      assert.ok(!read(f).includes("'/dashboard/login'"),
        f + ' must not hardcode the legacy login path');
    });
    assert.ok(read('apps/merchant-shared/js/shared.js').includes("window.location.href = '/login'"),
      'the shared session guard must send users to /login');
    assert.ok(!/function\s+(login|handleLogin)\s*\(/.test(read('apps/merchant-app/assets/js/merchant-app.js')),
      'merchant-app must not implement its own login');
  });

  await t.test('6. the login page consumes the server-resolved landing', () => {
    const html = read('apps/merchant-dashboard/login.html');
    assert.ok(html.includes('data.landing'), 'login must use the landing returned by the server');
    assert.ok(html.includes('/api/v1/auth/merchant/me'), 'an existing session must re-resolve its landing from the server');
    assert.ok(!html.includes("currentOrigin + '/dashboard/login'"), 'Google return_to must target the unified login');
  });

  await t.test('7. surfaces enforce the landing (URL swap cannot grant a surface)', () => {
    assert.ok(read('apps/merchant-app/assets/js/merchant-app.js').includes("enforceSurface(['/merchant/', '/merchant-app/'])"),
      'merchant-app must guard its own surface');
    assert.ok(read('apps/kitchen-app/assets/js/kitchen-app.js').includes("enforceSurface(['/kitchen/', '/kitchen-app/'])"),
      'kitchen-app must guard its own surface');
    assert.ok(read('apps/merchant-shared/js/shared.js').includes('function enforceSurface('),
      'the guard must live once, in the shared layer');
  });

  await t.test('8. KDS stays inactive: the kitchen surface is not routed', () => {
    const appSource = read('server/app.js');
    assert.ok(!appSource.includes("'/kitchen-app/assets'"), 'kitchen assets must not be mounted while KDS is off');
    assert.ok(!/\\\/kitchen(-app)?\(/.test(appSource), 'no /kitchen-app route may exist while KDS is off');
  });
  await t.test('9. the short surface paths resolve to the right app', async () => {
    const owner = await request('GET', '/owner');
    assert.equal(owner.status, 200, '/owner must serve the owner surface');
    const merchant = await request('GET', '/merchant');
    assert.equal(merchant.status, 200, '/merchant must serve the merchant surface');
    assert.notEqual(owner.body, merchant.body, 'the two surfaces must stay distinct');

    const legacy = await request('GET', '/merchant-app/');
    assert.equal(legacy.status, 200, 'the previous path must keep working');

    const src = read('server/app.js');
    assert.ok(src.includes(String.raw`/^\/owner(\/.*)?$/`), '/owner must be a registered route');
    assert.ok(src.includes(String.raw`/^\/merchant(\/.*)?$/`), '/merchant must be a registered route');
  });
});
