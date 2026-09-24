'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('CATALOG DOMAIN — canonical ownership and compatibility shims', () => {
  const canonicalCatalog = require('../../domains/catalog/services/CatalogService');
  const legacyCatalog = require('../../domains/commerce/services/CatalogService');
  const canonicalPricing = require('../../domains/catalog/models/PricingPolicyModel');
  const legacyPricing = require('../../domains/commerce/models/PricingPolicyModel');
  const catalogDomain = require('../../domains/catalog');
  const commerceDomain = require('../../domains/commerce');

  assert.strictEqual(legacyCatalog, canonicalCatalog,
    'legacy CatalogService path must re-export the canonical catalog service');
  assert.strictEqual(legacyPricing, canonicalPricing,
    'legacy PricingPolicyModel path must re-export the canonical catalog pricing policy');
  assert.strictEqual(catalogDomain.CatalogService, canonicalCatalog);
  assert.strictEqual(catalogDomain.PricingPolicyModel, canonicalPricing);
  assert.strictEqual(commerceDomain.CatalogService, canonicalCatalog,
    'Commerce compatibility export must source CatalogService from domains/catalog');
  assert.strictEqual(commerceDomain.PricingPolicyModel, canonicalPricing,
    'Commerce compatibility export must source PricingPolicyModel from domains/catalog');
});
