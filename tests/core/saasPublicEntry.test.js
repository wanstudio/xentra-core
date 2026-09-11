'use strict';
/**
 * saasPublicEntry.test.js
 *
 * Verifies the Xentra Cloud SaaS public entry architecture:
 *   1. GET / (xentra.cloud host) → landing page HTML
 *   2. GET /signin (xentra.cloud host) → sign-in page HTML
 *   3. GET /signup (xentra.cloud host) → sign-up page HTML
 *   4. GET /onboarding (xentra.cloud host) → onboarding HTML (auth guard is client-side)
 *   5. GET / (tenant host app.mybangjo.com) → customer PWA (not landing page)
 *   6. GET /signin (tenant host) → falls through to PWA (no SaaS page on tenant domain)
 *   7. Unknown path on xentra.cloud → redirects to / (landing), not /onboarding
 *   8. /dashboard/login still works (backwards-compat for existing Bangjo flows)
 *   9. /dashboard/ still works
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Use the real Express app wired with test DB
process.env.NODE_ENV = 'test';
const app = require('../../server/app');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
    server.on('error', reject);
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/**
 * Simple HTTP GET helper that does NOT follow redirects.
 */
function get(path, host) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Host: host || '127.0.0.1' }
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Xentra Cloud SaaS Public Entry Architecture', () => {

  it('1. GET / with xentra.cloud host → landing page HTML (200)', async () => {
    const res = await get('/', 'xentra.cloud');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(
      res.body.includes('Xentra Cloud') || res.body.includes('landing'),
      'Landing page must contain Xentra branding'
    );
    // Must NOT be the customer PWA (which has different content)
    assert.ok(!res.body.includes('xentra_cart'), 'Landing page must not be the customer PWA');
  });

  it('2. GET /signin with xentra.cloud host → sign-in page HTML (200)', async () => {
    const res = await get('/signin', 'xentra.cloud');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(
      res.body.includes('Sign in') || res.body.includes('signin') || res.body.includes('Xentra'),
      'Sign-in page must contain sign-in content'
    );
  });

  it('3. GET /signup with xentra.cloud host → sign-up page HTML (200)', async () => {
    const res = await get('/signup', 'xentra.cloud');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(
      res.body.includes('Create') || res.body.includes('signup') || res.body.includes('Xentra'),
      'Sign-up page must contain registration content'
    );
  });

  it('4. GET /onboarding with xentra.cloud host → onboarding HTML (200, auth guard is client-side)', async () => {
    const res = await get('/onboarding', 'xentra.cloud');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(
      res.body.includes('onboarding') || res.body.includes('Onboarding') || res.body.includes('Bisnis'),
      'Onboarding page must contain onboarding content'
    );
  });

  it('5. GET / with tenant host (app.mybangjo.com) → customer PWA or redirect, NOT landing page', async () => {
    const res = await get('/', 'app.mybangjo.com');
    // Must not be 404, and must not serve the landing page (which has specific Xentra SaaS branding)
    assert.ok(res.status === 200 || res.status === 302, `Expected 200 or 302, got ${res.status}`);
    if (res.status === 200) {
      // If it serves HTML, it should be the customer PWA, not the landing page
      // The landing page has 'Get Started Free' / 'Restaurant SaaS Platform' distinctively
      assert.ok(
        !res.body.includes('Get Started Free') || res.body.includes('xentra_merchant_token'),
        'Tenant domain / must not serve the Xentra SaaS landing page'
      );
    }
  });

  it('6. GET /signin with tenant host falls through (no SaaS route on tenant domain)', async () => {
    const res = await get('/signin', 'app.mybangjo.com');
    // On a tenant domain /signin should fall through to the PWA (200 serving PWA) or redirect
    // It must NOT serve the SaaS sign-in page exclusively for xentra.cloud
    // The key invariant: status is not 500, the route does not crash
    assert.ok(res.status === 200 || res.status === 302 || res.status === 404,
      `Got unexpected status ${res.status} for tenant /signin`);
    // Must not be the SaaS sign-in page (which would have "Sign in to Xentra" heading)
    if (res.status === 200) {
      assert.ok(
        !res.body.includes('Sign in to Xentra'),
        'Tenant domain /signin must not serve the SaaS sign-in page'
      );
    }
  });

  it('7. Unknown path on xentra.cloud → redirects to / (landing page), not /onboarding', async () => {
    const res = await get('/some-unknown-path-xyz', 'xentra.cloud');
    assert.equal(res.status, 302, `Expected 302 redirect, got ${res.status}`);
    const location = res.headers['location'] || '';
    assert.equal(location, '/', `xentra.cloud wildcard must redirect to /, got: ${location}`);
    assert.notEqual(location, '/onboarding', 'xentra.cloud wildcard must NOT redirect to /onboarding');
  });

  it('8. GET /dashboard/login still works (backwards-compat for Bangjo merchants)', async () => {
    const res = await get('/dashboard/login', 'app.mybangjo.com');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(
      res.body.includes('login') || res.body.includes('Login') || res.body.includes('Masuk'),
      'Legacy /dashboard/login must still serve login page'
    );
  });

  it('9. GET /dashboard/ still serves merchant dashboard app', async () => {
    const res = await get('/dashboard/', 'app.mybangjo.com');
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(res.body.length > 0, 'Dashboard must serve HTML');
  });

  it('10. /onboarding page contains auth guard redirect to /signin for unauthenticated users', async () => {
    const res = await get('/onboarding', 'xentra.cloud');
    assert.equal(res.status, 200);
    // The page must contain client-side logic that checks for token and redirects to /signin
    assert.ok(
      res.body.includes('/signin') && res.body.includes('xentra_merchant_token'),
      'Onboarding must contain client-side auth guard that redirects to /signin'
    );
    // Must NOT redirect to /dashboard/login
    assert.ok(
      !res.body.includes('/dashboard/login'),
      'Onboarding must not reference /dashboard/login for unauthenticated redirect'
    );
  });

});
