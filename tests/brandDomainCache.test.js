'use strict';

/**
 * P1.2 — Brand custom-domain resolution cache.
 *
 * Tenant resolution calls `findByCustomDomain` on every API request (CORS dynamic
 * origin check + tenantResolver). The cache added in P1.2 must never weaken tenant
 * isolation, so these tests pin the safety properties:
 *
 *  1. positive hit + exact normalization (trim + lowercase)
 *  2. caller mutation of the returned row never corrupts the cached row
 *  3. no negative caching → a newly registered domain resolves immediately
 *  4. tenant isolation → host A always resolves brand A, host B always brand B
 *  5. explicit invalidation (static + instance) forces an authoritative re-read
 *  6. repository brand writes invalidate the cache
 *  7. TTL expiry falls back to the authoritative query
 */

const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db');
const { BrandRepository } = require('../core/data/repositories');

function seed() {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_p12_a','P12 Org A','p12-org-a')").run();
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES ('brand_p12_a','org_p12_a','P12 Brand A','p12-brand-a','a.p12.test')").run();
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_p12_b','P12 Org B','p12-org-b')").run();
  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES ('brand_p12_b','org_p12_b','P12 Brand B','p12-brand-b','b.p12.test')").run();
  // Deterministic baseline (previous tests may have mutated these rows).
  db.prepare("UPDATE brands SET name = 'P12 Brand A', logo_url = NULL WHERE id = 'brand_p12_a'").run();
  db.prepare("UPDATE brands SET name = 'P12 Brand B' WHERE id = 'brand_p12_b'").run();
  BrandRepository.clearCustomDomainCache();
}

test('P1.2 cache — positive hit uses the same normalization as the SQL predicate', () => {
  seed();
  const repo = new BrandRepository();
  const a = repo.findByCustomDomain('a.p12.test');
  assert.ok(a && a.id === 'brand_p12_a', 'exact hostname resolves brand A');
  assert.strictEqual(repo.findByCustomDomain('  A.P12.TEST  ').id, 'brand_p12_a', 'case/space variants resolve the same brand');
});

test('P1.2 cache — caller mutation never corrupts the cached row', () => {
  seed();
  const repo = new BrandRepository();
  const first = repo.findByCustomDomain('a.p12.test');
  first.name = 'MUTATED BY CALLER';
  first.custom_domain = 'hijacked.test';
  const second = repo.findByCustomDomain('a.p12.test');
  assert.strictEqual(second.name, 'P12 Brand A', 'cached row is not mutated by callers');
  assert.strictEqual(second.custom_domain, 'a.p12.test');
});

test('P1.2 cache — unknown hostnames are NOT negatively cached', () => {
  seed();
  const repo = new BrandRepository();
  assert.strictEqual(repo.findByCustomDomain('new.p12.test'), undefined, 'unknown host resolves nothing');

  db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES ('brand_p12_new','org_p12_a','New Brand','p12-new','new.p12.test')").run();
  const fresh = repo.findByCustomDomain('new.p12.test');
  assert.ok(fresh && fresh.id === 'brand_p12_new', 'a newly registered domain resolves immediately');
});

test('P1.2 cache — tenant isolation: host A never resolves brand B (and vice versa)', () => {
  seed();
  const repo = new BrandRepository();
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(repo.findByCustomDomain('a.p12.test').id, 'brand_p12_a');
    assert.strictEqual(repo.findByCustomDomain('b.p12.test').id, 'brand_p12_b');
  }
});

test('P1.2 cache — explicit invalidation forces an authoritative re-read', () => {
  seed();
  const repo = new BrandRepository();
  assert.strictEqual(repo.findByCustomDomain('a.p12.test').name, 'P12 Brand A');

  db.prepare("UPDATE brands SET name = 'Renamed A' WHERE id = 'brand_p12_a'").run();
  assert.strictEqual(repo.findByCustomDomain('a.p12.test').name, 'P12 Brand A', 'still served from cache before invalidation');

  BrandRepository.clearCustomDomainCache();
  assert.strictEqual(repo.findByCustomDomain('a.p12.test').name, 'Renamed A', 'static invalidation reflects the write');

  db.prepare("UPDATE brands SET name = 'Renamed Again' WHERE id = 'brand_p12_a'").run();
  repo.clearCustomDomainCache();
  assert.strictEqual(repo.findByCustomDomain('a.p12.test').name, 'Renamed Again', 'instance invalidation reflects the write');
});

test('P1.2 cache — repository brand writes invalidate the cache', () => {
  seed();
  const repo = new BrandRepository();
  repo.findByCustomDomain('a.p12.test'); // populate
  repo.updateBrandLogo('brand_p12_a', '/assets/uploads/derivatives/x.png');
  const row = repo.findByCustomDomain('a.p12.test');
  assert.strictEqual(row.logo_url, '/assets/uploads/derivatives/x.png', 'logo write is visible immediately');
});

test('P1.2 cache — TTL expiry falls back to the authoritative query', (t) => {
  seed();
  // The mocked clock must be active BEFORE the entry is cached, so the entry's
  // expiry is computed against the mocked clock.
  t.mock.timers.enable({ apis: ['Date'] });
  const repo = new BrandRepository();
  assert.strictEqual(repo.findByCustomDomain('a.p12.test').name, 'P12 Brand A');

  db.prepare("UPDATE brands SET name = 'Post-TTL Name' WHERE id = 'brand_p12_a'").run();
  t.mock.timers.tick(61 * 1000); // beyond the 60s TTL

  assert.strictEqual(repo.findByCustomDomain('a.p12.test').name, 'Post-TTL Name', 'expired entry is re-read from the DB');
  t.mock.timers.reset();
});
