/**
 * Xentra Commerce Domain Entry Point & Self-Registration
 * Self-registers to core/domain DomainRegistry upon initialization.
 */
const { domain, events } = require('../../core');
const PricingPolicyModel = require('./models/PricingPolicyModel');
const CatalogService = require('./services/CatalogService');

const COMMERCE_IDENTITY = {
  name: 'commerce',
  version: '1.0.0',
  display_name: 'Xentra Commerce',
  description: 'Digital ordering, product catalog, branch menu mapping & pricing policies'
};

const COMMERCE_CAPABILITIES = {
  events_produced: [
    'commerce.order.created',
    'commerce.order.placed',
    'commerce.order.status_changed'
  ],
  events_consumed: [
    'payment.transaction.settled',
    'inventory.stock.depleted'
  ],
  permissions_required: [
    'order:create',
    'order:view',
    'menu:view'
  ],
  features_provided: [
    'digital_ordering_pwa',
    'branch_catalog_mapping',
    'pricing_policy_lock_range'
  ]
};

// Self-Registration to Core Domain Registry
let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: COMMERCE_IDENTITY,
    capabilities: COMMERCE_CAPABILITIES
  });
} catch (e) {
  // Graceful fallback if already registered in current process
  registration = domain.DomainRegistry.getDomain('commerce');
}

module.exports = {
  identity: COMMERCE_IDENTITY,
  capabilities: COMMERCE_CAPABILITIES,
  registration,
  PricingPolicyModel,
  CatalogService
};
