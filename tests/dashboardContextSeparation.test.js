'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../server/app');

describe('Dashboard Context Separation — Platform vs Client Owner', () => {
  let server;
  let port;

  before(async () => {
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  function makeRequest(pathname, hostHeader) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port: port,
        path: pathname,
        method: 'GET',
        headers: {
          Host: hostHeader
        }
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('1. xentra.cloud Host serves Platform Dashboard (200 OK)', async () => {
    const res = await makeRequest('/dashboard', 'xentra.cloud');
    assert.equal(res.status, 200);
    assert.match(res.body, /tab-platform-overview/);
    assert.match(res.body, /tab-platform-organizations/);
  });

  it('2. Registered tenant Host (app.mybangjo.com) serves Client Dashboard (200 OK)', async () => {
    const res = await makeRequest('/dashboard', 'app.mybangjo.com');
    assert.equal(res.status, 200);
    assert.match(res.body, /tab-overview/);
  });

  it('3. Unregistered/unknown domain fails closed with 404 TENANT_NOT_FOUND on /dashboard', async () => {
    const res = await makeRequest('/dashboard', 'unregistered-domain.com');
    assert.equal(res.status, 404);
    const json = JSON.parse(res.body);
    assert.equal(json.success, false);
    assert.equal(json.error, 'TENANT_NOT_FOUND');
  });

  it('4. Unregistered/unknown domain fails closed with 404 TENANT_NOT_FOUND on /dashboard/login', async () => {
    const res = await makeRequest('/dashboard/login', 'unregistered-domain.com');
    assert.equal(res.status, 404);
    const json = JSON.parse(res.body);
    assert.equal(json.success, false);
    assert.equal(json.error, 'TENANT_NOT_FOUND');
  });

  it('5. xentra.cloud Host serves login page (200 OK)', async () => {
    const res = await makeRequest('/dashboard/login', 'xentra.cloud');
    assert.equal(res.status, 200);
    assert.match(res.body, /store-name-badge/);
  });

  it('6. Client Owner Dashboard index.html contains all 10 platform placeholder tabs', () => {
    const indexPath = path.join(__dirname, '../apps/merchant-dashboard/index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    const expectedTabs = [
      'tab-platform-overview',
      'tab-platform-organizations',
      'tab-platform-brands',
      'tab-platform-domains',
      'tab-platform-provisioning',
      'tab-platform-users',
      'tab-platform-billing',
      'tab-platform-audit-logs',
      'tab-platform-integrations',
      'tab-platform-settings'
    ];

    expectedTabs.forEach((tabId) => {
      assert.ok(indexHtml.includes(`id="${tabId}"`), `Missing tab id: ${tabId}`);
    });
  });

  it('7. dashboard.js defines separate PLATFORM_ROUTE_META and CLIENT_ROUTE_META', () => {
    const jsPath = path.join(__dirname, '../apps/merchant-dashboard/assets/js/dashboard.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    assert.match(jsContent, /var PLATFORM_ROUTE_META =/);
    assert.match(jsContent, /var CLIENT_ROUTE_META =/);
    assert.match(jsContent, /function isPlatformContext\(\)/);
    assert.match(jsContent, /function renderPlatformNavigation\(\)/);

    // Platform routes presence
    const platformRoutes = [
      'overview', 'organizations', 'brands', 'domains', 'provisioning',
      'users-access', 'billing', 'audit-logs', 'integrations', 'settings'
    ];
    platformRoutes.forEach((route) => {
      assert.ok(jsContent.includes(`'${route}'`), `Missing platform route: ${route}`);
    });

    // Client navigation groups present in index.html
    const indexPath = path.join(__dirname, '../apps/merchant-dashboard/index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    assert.match(indexHtml, /BUSINESS/);
    assert.match(indexHtml, /GROWTH/);
    assert.match(indexHtml, /OPERATIONS/);
    assert.match(indexHtml, /SYSTEM/);
  });

  it('8. login.html adapts branding to Platform context when on xentra.cloud or ?context=platform', () => {
    const loginPath = path.join(__dirname, '../apps/merchant-dashboard/login.html');
    const loginHtml = fs.readFileSync(loginPath, 'utf8');

    assert.match(loginHtml, /Platform Control Plane: xentra\.cloud/);
    assert.match(loginHtml, /Masuk ke Platform Dashboard/);
    assert.match(loginHtml, /isPlatform/);
  });

  it('9. login.html uses inline Google SDK for Platform and broker redirect for Client tenant', () => {
    const loginPath = path.join(__dirname, '../apps/merchant-dashboard/login.html');
    const loginHtml = fs.readFileSync(loginPath, 'utf8');

    // Platform: inline SDK path — calls /api/v1/auth/google directly (NOT a redirect to /signin)
    assert.match(loginHtml, /handlePlatformGoogleCredential/);
    assert.match(loginHtml, /\/api\/v1\/auth\/google/);
    assert.match(loginHtml, /initPlatformGoogleSignIn/);
    // Must NOT redirect platform users to /signin
    assert.doesNotMatch(loginHtml, /\/signin\?return_to=.*\/dashboard/);

    // Client/Tenant: broker redirect path
    assert.match(loginHtml, /https:\/\/xentra\.cloud\/auth\/broker\?return_to=/);
  });
});

