'use strict';

const { domain } = require('../../core');
const ReportFilterModel = require('./models/ReportFilterModel');
const SalesReportService = require('./services/SalesReportService');
const PaymentReportService = require('./services/PaymentReportService');
const InventoryReportService = require('./services/InventoryReportService');
const PosShiftReportService = require('./services/PosShiftReportService');
const ProductReportService = require('./services/ProductReportService');
const BranchCompareService = require('./services/BranchCompareService');

const REPORTING_IDENTITY = {
  name: 'reporting',
  version: '1.0.0',
  display_name: 'Xentra Reporting',
  description: 'Authoritative Reporting Domain for Multi-Branch Analytics, Sales, Payment, Inventory, and POS Metrics'
};

const REPORTING_CAPABILITIES = {
  events_produced: [],
  events_consumed: [
    'commerce.order.placed',
    'payment.settled',
    'inventory.movement.recorded',
    'pos.shift.closed'
  ],
  permissions_required: [
    'report:sales_view',
    'report:payment_view',
    'report:inventory_view',
    'report:shift_view',
    'report:branch_compare'
  ],
  features_provided: [
    'sales_analytics',
    'payment_reconciliation_report',
    'inventory_ledger_report',
    'pos_shift_variance_report',
    'product_menu_performance',
    'branch_comparison_leaderboard'
  ]
};

// Self-Registration to Core Domain Registry
let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: REPORTING_IDENTITY,
    capabilities: REPORTING_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('reporting');
}

class ReportingEngine {
  /**
   * Universal router for report queries.
   * 
   * @param {string} reportType - 'sales' | 'payment' | 'inventory' | 'pos_shifts' | 'products' | 'branches'
   * @param {Object} filterParams
   * @returns {Object} Generated report payload
   */
  static generateReport(reportType, filterParams = {}) {
    switch (reportType) {
      case 'sales':
        return SalesReportService.getSalesReport(filterParams);
      case 'payment':
        return PaymentReportService.getPaymentReport(filterParams);
      case 'inventory':
        return InventoryReportService.getInventoryReport(filterParams);
      case 'pos_shifts':
      case 'shift':
        return PosShiftReportService.getShiftReport(filterParams);
      case 'products':
      case 'menu':
        return ProductReportService.getProductReport(filterParams);
      case 'branches':
      case 'branch_comparison':
        return BranchCompareService.getBranchComparisonReport(filterParams);
      default:
        throw new Error(`[ReportingEngine] Report type "${reportType}" tidak dikenali.`);
    }
  }
}

module.exports = {
  identity: REPORTING_IDENTITY,
  capabilities: REPORTING_CAPABILITIES,
  registration,
  ReportingEngine,
  ReportFilterModel,
  SalesReportService,
  PaymentReportService,
  InventoryReportService,
  PosShiftReportService,
  ProductReportService,
  BranchCompareService
};
