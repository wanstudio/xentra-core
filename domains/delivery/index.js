'use strict';

const { domain } = require('../../core');
const DeliveryModel = require('./models/DeliveryModel');
const DeliveryCalculatorService = require('./services/DeliveryCalculatorService');
const DeliveryDispatchService = require('./services/DeliveryDispatchService');
const BranchDriverProvider = require('./providers/BranchDriverProvider');

const DELIVERY_IDENTITY = {
  name: 'delivery',
  version: '1.0.0',
  display_name: 'Xentra Delivery',
  description: 'Authoritative Delivery Domain for Multi-Branch Tariff Calculation, Delivery Lifecycle, and Pluggable Driver Providers'
};

const DELIVERY_CAPABILITIES = {
  events_produced: [
    'delivery.driver.assigned',
    'delivery.completed'
  ],
  events_consumed: [
    'commerce.order.placed'
  ],
  permissions_required: [
    'delivery:calculate',
    'delivery:assign',
    'delivery:status_update'
  ],
  features_provided: [
    'multi_branch_tariff_engine',
    'promo_delivery_discount',
    'branch_driver_provider',
    'delivery_lifecycle_management'
  ]
};

// Self-Registration to Core Domain Registry
let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: DELIVERY_IDENTITY,
    capabilities: DELIVERY_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('delivery');
}

module.exports = {
  identity: DELIVERY_IDENTITY,
  capabilities: DELIVERY_CAPABILITIES,
  registration,
  DeliveryModel,
  DeliveryCalculatorService,
  DeliveryDispatchService,
  BranchDriverProvider
};
