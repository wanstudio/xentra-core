'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { PricingPolicyModel, CatalogService, identity, capabilities } = require('../../domains/commerce');
const { domain } = require('../../core');

// ==============================================================================
// Commerce 1 — Self-Registration Test
// Requirement: Domain registers itself to core/domain DomainRegistry on load
// ==============================================================================
test('Commerce 1 — Self-Registration: successfully registered in core DomainRegistry', () => {
  assert.strictEqual(identity.name, 'commerce');
  assert.strictEqual(capabilities.events_produced.includes('commerce.order.placed'), true);
  assert.strictEqual(domain.DomainRegistry.isDomainActive('commerce'), true);

  const registeredModel = domain.DomainRegistry.getDomain('commerce');
  assert.ok(registeredModel);
  assert.strictEqual(registeredModel.identity.name, 'commerce');
  assert.strictEqual(registeredModel.identity.version, '1.0.0');
});

// ==============================================================================
// Commerce 2 — Pricing Policy Model (Lock Mode)
// Requirement: Branch cannot change price, always returns owner base price
// ==============================================================================
test('Commerce 2 — Pricing Policy: Mode LOCK enforces owner base price', () => {
  const masterProduct = {
    price: 35000,
    pricing_mode: 'lock'
  };

  // Branch attempts override: should be ignored in LOCK mode
  const branchAttempt = { price: 40000 };
  const resolved = PricingPolicyModel.resolvePrice(masterProduct, branchAttempt);

  assert.strictEqual(resolved.effective_price, 35000);
  assert.strictEqual(resolved.mode, 'lock');
  assert.strictEqual(resolved.is_overridden, false);
});

// ==============================================================================
// Commerce 3 — Pricing Policy Model (Range Mode)
// Requirement: Owner defines min/max, branch must set price within range
// ==============================================================================
test('Commerce 3 — Pricing Policy: Mode RANGE validates branch price within allowed range', () => {
  const masterProduct = {
    price: 30000,
    pricing_mode: 'range',
    min_price: 25000,
    max_price: 35000
  };

  // 1. Valid branch override within range
  const validBranchPrice = { price: 32000 };
  const resolvedValid = PricingPolicyModel.resolvePrice(masterProduct, validBranchPrice);
  assert.strictEqual(resolvedValid.effective_price, 32000);
  assert.strictEqual(resolvedValid.is_overridden, true);

  // 2. Out of range below min throws error
  assert.throws(() => {
    PricingPolicyModel.resolvePrice(masterProduct, { price: 20000 });
  }, /out of allowed range/);

  // 3. Out of range above max throws error
  assert.throws(() => {
    PricingPolicyModel.resolvePrice(masterProduct, { price: 40000 });
  }, /out of allowed range/);
});

// ==============================================================================
// Commerce 4 — Catalog Service Query
// Requirement: Retrieves structured categories & products with resolved prices
// ==============================================================================
test('Commerce 4 — Catalog Service: retrieves active menu catalog for brand', () => {
  const menu = CatalogService.getMenu({ brand_id: 'brand_bangjo' });
  assert.ok(Array.isArray(menu.categories));
  assert.ok(Array.isArray(menu.products));
  assert.ok(menu.categories.length > 0);
  assert.ok(menu.products.length > 0);
  assert.strictEqual(typeof menu.products[0].price, 'number');
});
