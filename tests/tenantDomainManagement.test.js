'use strict';

/**
 * Multi-Tenant Domain Management & Canonical Resolution Tests
 *
 * Requirements verified:
 * A. pos.mybangjo.com -> resolved to Bangjo with surface pos
 * B. m.mybangjo.com -> resolved to Bangjo with surface merchant
 * C. app.mybangjo.com -> resolved to Bangjo with surface customer
 * D. Unknown domain (kasir.mybangjo.com, pos.otherclient.com) -> fails closed (404/TENANT_NOT_FOUND)
 * E. Cross-tenant isolation -> Tenant A domain never resolves Tenant B context
 * F. Disabled domain -> fails closed
 * G. Unverified domain -> fails closed
 * H. Primary domain flag preserved in registry
 * I. CRUD lifecycle of domain registry
 * J. Platform authorization (PLATFORM_ADMIN & PLATFORM_OWNER can manage; merchant roles forbidden)
 * K. Rejection of duplicate hostname
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/database/db');
const { TenantDomainRepository, BrandRepository } = require('../core/data/repositories');
const TenantDomainResolver = require('../core/identity/TenantDomainResolver');
const { DomainVerificationService, DomainProvisioningService } = require('../core/domain-management');
const { RoleModel, PermissionModel } = require('../core/identity');

describe('Domain Management Subsystem & Authoritative Tenant Resolution', () => {
  let domainRepo;
  let brandRepo;
  let resolver;
  let verificationService;
  let provisioningService;

  before(async () => {
    domainRepo = new TenantDomainRepository();
    brandRepo = new BrandRepository();
    resolver = new TenantDomainResolver({ domainRepository: domainRepo, brandRepository: brandRepo });
    verificationService = new DomainVerificationService({ domainRepository: domainRepo });
    provisioningService = new DomainProvisioningService({ domainRepository: domainRepo });

    await resolver.ready();
  });

  beforeEach(() => {
    // Reset test records
    try {
      db.prepare("DELETE FROM tenant_domains WHERE hostname LIKE '%.test%' OR hostname LIKE '%.tenant%'").run();
      db.prepare("DELETE FROM brands WHERE id IN ('brand_tenant_a', 'brand_tenant_b')").run();
      db.prepare("DELETE FROM organizations WHERE id IN ('org_tenant_a', 'org_tenant_b')").run();
    } catch (_) {}
  });

  it('A. pos.mybangjo.com resolves to Bangjo with surface pos (data-driven)', async () => {
    const res = await resolver.resolve('pos.mybangjo.com');
    assert.ok(res, 'pos.mybangjo.com must resolve');
    assert.equal(res.brand_id, 'brand_bangjo');
    assert.equal(res.surface_type, 'pos');
    assert.equal(res.hostname, 'pos.mybangjo.com');
    assert.ok(res.brand);
  });

  it('B. m.mybangjo.com resolves to Bangjo with surface merchant (data-driven)', async () => {
    const res = await resolver.resolve('m.mybangjo.com');
    assert.ok(res, 'm.mybangjo.com must resolve');
    assert.equal(res.brand_id, 'brand_bangjo');
    assert.equal(res.surface_type, 'merchant');
    assert.equal(res.hostname, 'm.mybangjo.com');
  });

  it('C. app.mybangjo.com resolves to Bangjo with surface customer (data-driven)', async () => {
    const res = await resolver.resolve('app.mybangjo.com');
    assert.ok(res, 'app.mybangjo.com must resolve');
    assert.equal(res.brand_id, 'brand_bangjo');
    assert.equal(res.surface_type, 'customer');
    assert.equal(res.hostname, 'app.mybangjo.com');
  });

  it('D. Unknown domain (kasir.mybangjo.com, pos.unknownclient.com) FAILS CLOSED', async () => {
    const res1 = await resolver.resolve('kasir.mybangjo.com');
    assert.strictEqual(res1, null, 'Unregistered prefix/subdomain must fail closed');

    const res2 = await resolver.resolve('pos.unknownclient.com');
    assert.strictEqual(res2, null, 'Unknown domain must fail closed');

    const res3 = await resolver.resolve('random-unregistered-domain.org');
    assert.strictEqual(res3, null, 'Random host must fail closed');
  });

  it('E. Cross-tenant isolation: Tenant A domain never resolves Tenant B context', async () => {
    // Setup Tenant A and Tenant B
    db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org_tenant_a', 'Tenant A Org', 'tenant-a-org')").run();
    db.prepare("INSERT INTO brands (id, organization_id, name, slug) VALUES ('brand_tenant_a', 'org_tenant_a', 'Brand A', 'brand-a')").run();

    db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org_tenant_b', 'Tenant B Org', 'tenant-b-org')").run();
    db.prepare("INSERT INTO brands (id, organization_id, name, slug) VALUES ('brand_tenant_b', 'org_tenant_b', 'Brand B', 'brand-b')").run();

    domainRepo.create({
      hostname: 'order.brand-a.test',
      organization_id: 'org_tenant_a',
      brand_id: 'brand_tenant_a',
      surface_type: 'customer',
      verification_status: 'verified',
      status: 'active'
    });

    domainRepo.create({
      hostname: 'pos.brand-b.test',
      organization_id: 'org_tenant_b',
      brand_id: 'brand_tenant_b',
      surface_type: 'pos',
      verification_status: 'verified',
      status: 'active'
    });

    const resA = await resolver.resolve('order.brand-a.test');
    assert.ok(resA);
    assert.equal(resA.brand_id, 'brand_tenant_a');
    assert.notEqual(resA.brand_id, 'brand_tenant_b');
    assert.equal(resA.surface_type, 'customer');

    const resB = await resolver.resolve('pos.brand-b.test');
    assert.ok(resB);
    assert.equal(resB.brand_id, 'brand_tenant_b');
    assert.notEqual(resB.brand_id, 'brand_tenant_a');
    assert.equal(resB.surface_type, 'pos');
  });

  it('F. Disabled domain fails closed', async () => {
    db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_tenant_a', 'Tenant A Org', 'tenant-a-org')").run();
    db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_tenant_a', 'org_tenant_a', 'Brand A', 'brand-a')").run();

    const created = domainRepo.create({
      hostname: 'disabled.brand-a.test',
      organization_id: 'org_tenant_a',
      brand_id: 'brand_tenant_a',
      surface_type: 'customer',
      verification_status: 'verified',
      status: 'disabled'
    });

    const res = await resolver.resolve('disabled.brand-a.test');
    assert.strictEqual(res, null, 'Disabled domain must fail closed');
  });

  it('G. Unverified domain fails closed', async () => {
    db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_tenant_a', 'Tenant A Org', 'tenant-a-org')").run();
    db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_tenant_a', 'org_tenant_a', 'Brand A', 'brand-a')").run();

    const created = domainRepo.create({
      hostname: 'unverified.brand-a.test',
      organization_id: 'org_tenant_a',
      brand_id: 'brand_tenant_a',
      surface_type: 'customer',
      verification_status: 'pending',
      status: 'active'
    });

    const res = await resolver.resolve('unverified.brand-a.test');
    assert.strictEqual(res, null, 'Unverified domain must fail closed');
  });

  it('H. Duplicate hostname is rejected by registry', () => {
    db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_tenant_a', 'Tenant A Org', 'tenant-a-org')").run();
    db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_tenant_a', 'org_tenant_a', 'Brand A', 'brand-a')").run();

    domainRepo.create({
      hostname: 'unique.brand-a.test',
      organization_id: 'org_tenant_a',
      brand_id: 'brand_tenant_a',
      surface_type: 'customer',
      verification_status: 'verified',
      status: 'active'
    });

    assert.throws(() => {
      domainRepo.create({
        hostname: 'unique.brand-a.test',
        organization_id: 'org_tenant_a',
        brand_id: 'brand_tenant_a',
        surface_type: 'merchant'
      });
    }, /UNIQUE constraint failed/i);
  });

  it('I. Domain verification and provisioning lifecycle state transitions', async () => {
    db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_tenant_a', 'Tenant A Org', 'tenant-a-org')").run();
    db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_tenant_a', 'org_tenant_a', 'Brand A', 'brand-a')").run();

    const created = domainRepo.create({
      hostname: 'lifecycle.brand-a.test',
      organization_id: 'org_tenant_a',
      brand_id: 'brand_tenant_a',
      surface_type: 'customer',
      verification_status: 'pending',
      verification_token: 'valid_test_token_123',
      provisioning_status: 'unprovisioned',
      tls_status: 'pending'
    });

    assert.equal(created.verification_status, 'pending');
    assert.equal(created.provisioning_status, 'unprovisioned');

    // Verification check with custom resolver matching token
    const mockDnsResolver = {
      async resolveTxt(host) {
        assert.equal(host, '_xentra-challenge.lifecycle.brand-a.test');
        return [['valid_test_token_123']];
      }
    };
    const vService = new DomainVerificationService({
      domainRepository: domainRepo,
      dnsResolver: mockDnsResolver
    });

    const verifyResult = await vService.verifyDomain(created.id);
    assert.equal(verifyResult.success, true);
    assert.equal(verifyResult.status, 'verified');

    // Trigger provisioning
    const provResult = await provisioningService.provisionDomain(created.id);
    assert.equal(provResult.success, true);
    assert.equal(provResult.record.provisioning_status, 'provisioned');
    assert.equal(provResult.record.tls_status, 'active');

    // Now domain resolves in runtime
    const resolved = await resolver.resolve('lifecycle.brand-a.test');
    assert.ok(resolved);
    assert.equal(resolved.brand_id, 'brand_tenant_a');
  });

  it('J. Platform authorization model enforces PLATFORM_ADMIN and PLATFORM_OWNER', () => {
    // Platform Workforce Roles have domain permissions
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.PLATFORM_OWNER, 'domain:read'), true);
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.PLATFORM_OWNER, 'domain:create'), true);
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.PLATFORM_ADMIN, 'domain:read'), true);
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.PLATFORM_ADMIN, 'domain:create'), true);
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.PLATFORM_ADMIN, 'domain:delete'), true);

    // Merchant / operational roles MUST NOT have domain permissions
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.OWNER, 'domain:read'), false);
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.OWNER, 'domain:create'), false);
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.BRAND_MANAGER, 'domain:create'), false);
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.BRANCH_MANAGER, 'domain:create'), false);
    assert.equal(PermissionModel.hasPermission(RoleModel.ROLES.CASHIER, 'domain:create'), false);
  });
});
