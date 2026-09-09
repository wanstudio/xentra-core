'use strict';

const { ReportingRepository } = require('../../../core/data/repositories');
const ReportFilterModel = require('../models/ReportFilterModel');

const reportingRepository = new ReportingRepository();

class InventoryReportService {
  /**
   * Generates stock ledger movement summary and low stock alerts.
   * 
   * @param {Object} filterParams
   * @returns {Object} Inventory report summary
   */
  static getInventoryReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    // P1 MULTI-TENANT ISOLATION (NEW-01) remains enforced inside the
    // semantic reporting repository queries.
    const movementBreakdown = reportingRepository.getInventoryMovementBreakdown(filter);
    const lowStockItems = reportingRepository.getLowStockItems(filter);

    return {
      report_type: 'inventory',
      filter,
      movement_breakdown: movementBreakdown,
      low_stock_alerts: lowStockItems
    };
  }
}

module.exports = InventoryReportService;
