'use strict';

const db = require('../../../server/database/db');
const ReportFilterModel = require('../models/ReportFilterModel');

class InventoryReportService {
  /**
   * Generates stock ledger movement summary and low stock alerts.
   * 
   * @param {Object} filterParams
   * @returns {Object} Inventory report summary
   */
  static getInventoryReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    let movementWhere = [];
    const movementParams = [];

    if (filter.branch_id) {
      movementWhere.push('branch_id = ?');
      movementParams.push(filter.branch_id);
    }
    if (filter.start_date) {
      movementWhere.push('created_at >= ?');
      movementParams.push(filter.start_date);
    }
    if (filter.end_date) {
      movementWhere.push('created_at <= ?');
      movementParams.push(filter.end_date);
    }

    const movementWhereSql = movementWhere.length > 0 ? `WHERE ${movementWhere.join(' AND ')}` : '';

    // 1. Movement summary by movement_type
    const movementBreakdown = db.prepare(`
      SELECT 
        movement_type,
        COUNT(*) as record_count,
        COALESCE(SUM(quantity), 0) as total_quantity
      FROM inventory_movements
      ${movementWhereSql}
      GROUP BY movement_type
    `).all(...movementParams);

    // 2. Low Stock Alerts
    let branchProductWhere = ['bp.stock <= bp.low_stock_threshold'];
    const branchProductParams = [];

    if (filter.branch_id) {
      branchProductWhere.push('bp.branch_id = ?');
      branchProductParams.push(filter.branch_id);
    }

    const lowStockItems = db.prepare(`
      SELECT 
        bp.branch_id,
        b.name as branch_name,
        p.id as product_id,
        p.name as product_name,
        bp.stock as current_stock,
        bp.low_stock_threshold
      FROM branch_products bp
      JOIN products p ON bp.product_id = p.id
      JOIN branches b ON bp.branch_id = b.id
      WHERE ${branchProductWhere.join(' AND ')}
      ORDER BY bp.stock ASC
    `).all(...branchProductParams);

    return {
      report_type: 'inventory',
      filter,
      movement_breakdown: movementBreakdown,
      low_stock_alerts: lowStockItems
    };
  }
}

module.exports = InventoryReportService;
