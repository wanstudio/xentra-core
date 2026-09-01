/**
 * Xentra Promotion Domain Unified Entry Point
 */
const { domain } = require('../../core');
const Promotion = require('./domain/Promotion');
const ConflictResolver = require('./domain/ConflictResolver');
const BasePromotionStrategy = require('./strategies/BasePromotionStrategy');
const InstallIncentiveStrategy = require('./strategies/InstallIncentiveStrategy');
const PromotionEngineService = require('./services/PromotionEngineService');

const PROMOTION_IDENTITY = {
  name: 'promotion',
  version: '1.0.0',
  display_name: 'Xentra Promotion Engine',
  description: 'Enterprise modular promotion framework featuring discovery, eligibility, stacking conflict resolution, and immutable redemption ledgers'
};

const PROMOTION_CAPABILITIES = {
  events_produced: [
    'promotion.reward.applied',
    'promotion.redemption.recorded',
    'promotion.conflict.resolved'
  ],
  events_consumed: [
    'commerce.order.placed',
    'payment.transaction.settled'
  ],
  permissions_required: [
    'promotion:view',
    'promotion:manage'
  ],
  features_provided: [
    'install_incentive_engine',
    'stacking_conflict_resolution',
    'configuration_driven_campaigns',
    'immutable_redemption_ledger'
  ]
};

// Self-Registration to Core Domain Registry
let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: PROMOTION_IDENTITY,
    capabilities: PROMOTION_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('promotion');
}

module.exports = {
  identity: PROMOTION_IDENTITY,
  capabilities: PROMOTION_CAPABILITIES,
  registration,
  Promotion,
  ConflictResolver,
  BasePromotionStrategy,
  InstallIncentiveStrategy,
  PromotionEngineService
};
