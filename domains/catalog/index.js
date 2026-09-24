/**
 * Xentra Catalog Domain Module & Self-Registration
 *
 * Master/branch catalog resolution and pricing-policy authority.
 */
'use strict';

const { domain } = require('../../core');
const CatalogService = require('./services/CatalogService');
const PricingPolicyModel = require('./models/PricingPolicyModel');

const CATALOG_IDENTITY = {
  name: 'catalog',
  version: '1.0.0',
  display_name: 'Xentra Catalog',
  description: 'Master catalog, branch selling catalog and pricing policy resolution'
};

const CATALOG_CAPABILITIES = {
  events_produced: [],
  events_consumed: [],
  permissions_required: ['menu:view'],
  features_provided: [
    'master_catalog',
    'branch_catalog',
    'branch_menu_resolution',
    'pricing_policy_lock_range'
  ]
};

let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: CATALOG_IDENTITY,
    capabilities: CATALOG_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('catalog');
}

module.exports = {
  identity: CATALOG_IDENTITY,
  capabilities: CATALOG_CAPABILITIES,
  registration,
  CatalogService,
  PricingPolicyModel
};
