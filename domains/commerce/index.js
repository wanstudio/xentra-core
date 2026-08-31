/**
 * Xentra Commerce Domain Unified Module Entry
 */
const { domain } = require('../../core');
const PricingPolicyModel = require('./models/PricingPolicyModel');
const LowStockThresholdModel = require('./models/LowStockThresholdModel');
const CatalogService = require('./services/CatalogService');
const PrePaymentVerificationGate = require('./services/PrePaymentVerificationGate');
const OrderPlacementService = require('./services/OrderPlacementService');

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
    'commerce.order.status_changed',
    'inventory.low_stock_warning'
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
    'pricing_policy_lock_range',
    'pre_payment_verification_gate',
    'low_stock_alert'
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
  registration = domain.DomainRegistry.getDomain('commerce');
}

module.exports = {
  identity: COMMERCE_IDENTITY,
  capabilities: COMMERCE_CAPABILITIES,
  registration,
  PricingPolicyModel,
  LowStockThresholdModel,
  CatalogService,
  PrePaymentVerificationGate,
  OrderPlacementService
};
