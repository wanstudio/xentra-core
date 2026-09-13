'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const tenantResolver = require('../../server/middleware/tenantResolver');

describe('tenantResolver Middleware (Generic Multi-Domain Boundary)', () => {
  it('1. xentra.cloud bypasses tenant resolution (Control Plane)', async () => {
    const req = {
      headers: { host: 'xentra.cloud' },
      path: '/api/v1/some-endpoint'
    };
    let nextCalled = false;
    const res = {
      status: () => { throw new Error('status should not be called'); },
      json: () => { throw new Error('json should not be called'); }
    };

    await tenantResolver(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.brand, undefined);
  });

  it('2. xentra.cloud with port bypasses tenant resolution (Control Plane)', async () => {
    const req = {
      headers: { host: 'xentra.cloud:3001' },
      path: '/api/v1/some-endpoint'
    };
    let nextCalled = false;
    const res = {
      status: () => { throw new Error('status should not be called'); },
      json: () => { throw new Error('json should not be called'); }
    };

    await tenantResolver(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.brand, undefined);
  });

  it('2a. xentra.cloud with x-brand-slug resolves tenant brand context', async () => {
    const req = {
      headers: { host: 'xentra.cloud', 'x-brand-slug': 'bangjo' },
      path: '/api/v1/brand/branches'
    };
    let nextCalled = false;
    await tenantResolver(req, {}, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.ok(req.brand);
    assert.equal(req.brand.slug, 'bangjo');
    assert.equal(req.brand_id, 'brand_bangjo');
  });

  it('2b. xentra.cloud with x-brand-id resolves tenant brand context', async () => {
    const req = {
      headers: { host: 'xentra.cloud', 'x-brand-id': 'brand_bangjo' },
      path: '/api/v1/catalog/menu'
    };
    let nextCalled = false;
    await tenantResolver(req, {}, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.ok(req.brand);
    assert.equal(req.brand.id, 'brand_bangjo');
    assert.equal(req.brand_id, 'brand_bangjo');
  });

  it('3. Public platform / onboarding paths bypass tenant resolution', async () => {
    const publicPaths = [
      '/auth/register',
      '/api/v1/auth/register',
      '/onboarding/claim',
      '/api/v1/onboarding/check-domain',
      '/platform/metrics'
    ];

    for (const path of publicPaths) {
      const req = {
        headers: { host: 'arbitrary-host.com' },
        path
      };
      let nextCalled = false;
      const res = {
        status: () => { throw new Error('status should not be called'); }
      };

      await tenantResolver(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, `Expected next() for path: ${path}`);
    }
  });

  it('4. Registered custom domain (app.mybangjo.com) resolves to brand without hardcoded branch', async () => {
    const req = {
      headers: { host: 'app.mybangjo.com:443' },
      path: '/api/v1/brand/info'
    };
    let nextCalled = false;
    const res = {
      status: () => { throw new Error('status should not be called'); }
    };

    await tenantResolver(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.ok(req.brand, 'Brand should be resolved');
    assert.equal(req.brand.custom_domain, 'app.mybangjo.com');
    assert.equal(req.brand_id, req.brand.id);
    assert.equal(req.organization_id, req.brand.organization_id);
  });

  it('5. Hostname normalization works (handles case, whitespace, port)', async () => {
    const testHosts = [
      'APP.MYBANGJO.COM',
      'app.mybangjo.com:3001',
      '  app.mybangjo.com  '
    ];

    for (const host of testHosts) {
      const req = {
        headers: { host },
        path: '/api/v1/brand/info'
      };
      let nextCalled = false;
      const res = {
        status: () => { throw new Error('status should not be called'); }
      };

      await tenantResolver(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true, `Host failed to resolve: ${host}`);
      assert.ok(req.brand);
      assert.equal(req.brand.custom_domain, 'app.mybangjo.com');
    }
  });

  it('6. Unknown/unregistered hostname fails closed with 404 TENANT_NOT_FOUND', async () => {
    const req = {
      headers: { host: 'unknown-client-domain.org' },
      path: '/api/v1/brand/info'
    };
    let statusCode = null;
    let jsonResponse = null;
    let nextCalled = false;

    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => {
            jsonResponse = body;
          }
        };
      }
    };

    await tenantResolver(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, 'next() must NOT be called for unknown domain');
    assert.equal(statusCode, 404, 'Must return HTTP 404');
    assert.deepEqual(jsonResponse, {
      success: false,
      error: 'TENANT_NOT_FOUND',
      message: 'Brand/Tenant tidak ditemukan untuk host yang diberikan.'
    });
  });

  it('7. Multiple registered domains resolve their respective brands generically', async () => {
    const DataAccess = require('../../core/data/DataAccess');
    await DataAccess.ready();

    // Insert a second tenant domain dynamically
    const secondOrgId = 'org_test_multi_' + Date.now();
    const secondBrandId = 'brand_test_multi_' + Date.now();
    const secondDomain = 'client-b.com';

    DataAccess.execute(
      `INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)`,
      [secondOrgId, 'Client B Org', 'client-b-org']
    );

    DataAccess.execute(
      `INSERT INTO brands (id, organization_id, name, slug, custom_domain) VALUES (?, ?, ?, ?, ?)`,
      [secondBrandId, secondOrgId, 'Client B Brand', 'client-b-brand', secondDomain]
    );

    try {
      // Test domain 1
      const req1 = { headers: { host: 'app.mybangjo.com' }, path: '/api/v1/brand/info' };
      let next1 = false;
      await tenantResolver(req1, {}, () => { next1 = true; });
      assert.equal(next1, true);
      assert.equal(req1.brand.custom_domain, 'app.mybangjo.com');

      // Test domain 2
      const req2 = { headers: { host: secondDomain }, path: '/api/v1/brand/info' };
      let next2 = false;
      await tenantResolver(req2, {}, () => { next2 = true; });
      assert.equal(next2, true);
      assert.equal(req2.brand.id, secondBrandId);
      assert.equal(req2.brand.custom_domain, secondDomain);
      assert.equal(req2.brand.name, 'Client B Brand');

      // Test unregistered domain 3 fails closed
      const req3 = { headers: { host: 'client-c-unregistered.com' }, path: '/api/v1/brand/info' };
      let code3 = null;
      await tenantResolver(req3, {
        status: (c) => ({ json: () => { code3 = c; } })
      }, () => {});
      assert.equal(code3, 404);
    } finally {
      // Cleanup
      DataAccess.execute(`DELETE FROM brands WHERE id = ?`, [secondBrandId]);
      DataAccess.execute(`DELETE FROM organizations WHERE id = ?`, [secondOrgId]);
    }
  });
});
