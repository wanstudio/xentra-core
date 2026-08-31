'use strict';

const { domain } = require('../../core');
const InventoryMovementModel = require('./models/InventoryMovementModel');
const InventoryStockService = require('./services/InventoryStockService');
const PurchaseOrderService = require('./services/PurchaseOrderService');

const INVENTORY_IDENTITY = {
  name: 'inventory',
  version: '1.0.0',
  display_name: 'Xentra Inventory',
  description: 'Authoritative Inventory Domain for Multi-Branch Stock Ledger, Strict Non-Negative Stock, and 2-Stage Purchase In Flow'
};

const INVENTORY_CAPABILITIES = {
  events_produced: [
    'inventory.movement.recorded',
    'inventory.po.created',
    'inventory.stock.received'
  ],
  events_consumed: [
    'commerce.order.placed',
    'payment.settled'
  ],
  permissions_required: [
    'inventory:view',
    'inventory:mutate',
    'inventory:po_create',
    'inventory:po_receive',
    'inventory:adjust'
  ],
  features_provided: [
    'multi_branch_stock_ledger',
    'two_stage_purchase_in',
    'strict_non_negative_stock',
    'immutable_movement_history'
  ]
};

// Self-Registration to Core Domain Registry
let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: INVENTORY_IDENTITY,
    capabilities: INVENTORY_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('inventory');
}

module.exports = {
  identity: INVENTORY_IDENTITY,
  capabilities: INVENTORY_CAPABILITIES,
  registration,
  InventoryMovementModel,
  InventoryStockService,
  PurchaseOrderService
};
