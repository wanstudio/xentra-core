/**
 * Xentra Promo Domain Unified Module Entry
 */
const { domain } = require('../../core');
const PromotionModel = require('./models/PromotionModel');
const BasePromoStrategy = require('./strategies/BasePromoStrategy');
const InstallIncentiveStrategy = require('./strategies/InstallIncentiveStrategy');
const PromotionEngineService = require('./services/PromotionEngineService');

const PROMO_IDENTITY = {
  name: 'promo',
  version: '1.0.0',
  display_name: 'Xentra Promotion Engine',
  description: 'Modular promotion framework supporting install incentives, combos, vouchers, and tiered rewards'
};

const PROMO_CAPABILITIES = {
  events_produced: [
    'promo.reward.claimed',
    'promo.rule.created',
    'promo.rule.updated'
  ],
  events_consumed: [
    'commerce.order.placed',
    'identity.customer.registered'
  ],
  permissions_required: [
    'promo:create',
    'promo:view',
    'promo:edit'
  ],
  features_provided: [
    'install_incentive_engine',
    'combo_bundle_engine',
    'dynamic_promo_evaluation',
    'multi_tenant_promo_config'
  ]
};

// Self-Registration to Core Domain Registry
let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: PROMO_IDENTITY,
    capabilities: PROMO_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('promo');
}

module.exports = {
  identity: PROMO_IDENTITY,
  capabilities: PROMO_CAPABILITIES,
  registration,
  PromotionModel,
  BasePromoStrategy,
  InstallIncentiveStrategy,
  PromotionEngineService
};
