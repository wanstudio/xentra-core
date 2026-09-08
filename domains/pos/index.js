/**
 * Xentra POS Domain Module & Self-Registration
 */
const { domain } = require('../../core');
const PosShiftModel = require('./models/PosShiftModel');
const OfflineRiskLimitModel = require('./models/OfflineRiskLimitModel');
const PosShiftService = require('./services/PosShiftService');
const PosOrderService = require('./services/PosOrderService');
const PosHardwareRouter = require('./services/PosHardwareRouter');
const OfflineReconciliationService = require('./services/OfflineReconciliationService');

const POS_IDENTITY = {
  name: 'pos',
  version: '1.0.0',
  display_name: 'Xentra POS',
  description: 'Cashier shift management, table holding, offline reconciliation & kitchen routing'
};

const POS_CAPABILITIES = {
  events_produced: [
    'pos.shift.opened',
    'pos.shift.closed',
    'pos.order.placed',
    'pos.order.settled',
    'pos.kitchen.ticket_routed',
    'pos.offline.reconciled',
    'pos.disaster_recovery.reconciled'
  ],
  events_consumed: [
    'commerce.order.placed',
    'inventory.stock.deducted'
  ],
  permissions_required: [
    'pos:access',
    'pos:order_create',
    'shift:manage'
  ],
  features_provided: [
    'cashier_shift_management',
    'table_order_holding',
    'split_merge_bill',
    'offline_risk_limit',
    'offline_idempotency_reconciliation',
    'hardware_receipt_cash_drawer',
    'kitchen_ticket_kds_routing'
  ]
};

// Self-Registration to Core Domain Registry
let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: POS_IDENTITY,
    capabilities: POS_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('pos');
}

const DiningTableService = require('./services/DiningTableService');
const TableRecommendationService = require('./services/TableRecommendationService');

module.exports = {
  identity: POS_IDENTITY,
  capabilities: POS_CAPABILITIES,
  registration,
  PosShiftModel,
  OfflineRiskLimitModel,
  PosShiftService,
  PosOrderService,
  PosHardwareRouter,
  OfflineReconciliationService,
  DiningTableService,
  TableRecommendationService
};
