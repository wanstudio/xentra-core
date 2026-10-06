'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../server/database/db');
const DataAccess = require('../core/data/DataAccess');
const BrandRepository = require('../core/data/repositories/BrandRepository');
const tenantResolver = require('../server/middleware/tenantResolver');

describe('Driver Domain Registry Contract', () => {
  it('registers driver.mybangjo.com as Bangjo driver surface', async () => {
    await DataAccess.ready();

    const row = db.prepare(`
      SELECT hostname, brand_id, surface_type, status, verification_status
      FROM tenant_domains
      WHERE lower(trim(hostname)) = 'driver.mybangjo.com'
      LIMIT 1
    `).get();

    assert.ok(row, 'driver.mybangjo.com must exist in tenant_domains');
    assert.equal(row.hostname, 'driver.mybangjo.com');
    assert.equal(row.brand_id, 'brand_bangjo');
    assert.equal(row.surface_type, 'driver');
    assert.equal(row.status, 'active');
    assert.equal(row.verification_status, 'verified');
  });

  it('resolves driver.mybangjo.com through the registry with driver surface', async () => {
    await DataAccess.ready();

    const repo = new BrandRepository();
    const brand = repo.findByCustomDomain('driver.mybangjo.com');

    assert.ok(brand, 'Driver hostname must resolve');
    assert.equal(brand.id, 'brand_bangjo');
    assert.equal(brand.surface_type, 'driver');
    assert.equal(brand.registered_hostname, 'driver.mybangjo.com');
  });

  it('passes the driver surface into tenantResolver request context', async () => {
    const req = {
      headers: { host: 'driver.mybangjo.com:443' },
      path: '/api/v1/driver/me'
    };
    let nextCalled = false;

    const res = {
      status: () => { throw new Error('driver domain should resolve'); }
    };

    await tenantResolver(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.brand_id, 'brand_bangjo');
    assert.equal(req.organization_id, 'org_xentra_holding');
    assert.equal(req.surface_type, 'driver');
  });

  it('does not infer an unregistered driver-looking hostname', async () => {
    const repo = new BrandRepository();
    const brand = repo.findByCustomDomain('driver-unknown.mybangjo.com');

    assert.equal(brand, undefined);
  });
});
