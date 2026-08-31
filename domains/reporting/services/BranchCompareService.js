'use strict';

const db = require('../../../server/database/db');
const ReportFilterModel = require('../models/ReportFilterModel');

class BranchCompareService {
  /**
   * Generates comparative performance metrics across branches for Owner/Executive scope.
   * 
   * @param {Object} filterParams
   * @returns {Object} Branch comparison report summary
   */
  static getBranchComparisonReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    let whereClauses = ["o.status IN ('confirmed', 'completed', 'delivered', 'ready_for_pickup')"];
    const params = [];

    if (filter.brand_id) {
      whereClauses.push('o.brand_id = ?');
      params.push(filter.brand_id);
    }
    if (filter.start_date) {
      whereClauses.push('o.created_at >= ?');
      params.push(filter.start_date);
    }
    if (filter.end_date) {
      whereClauses.push('o.created_at <= ?');
      params.push(filter.end_date);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const branchesComparison = db.prepare(`
      SELECT 
        b.id as branch_id,
        b.name as branch_name,
        b.slug as branch_slug,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(o.grand_total), 0) as total_revenue,
        COALESCE(AVG(o.grand_total), 0) as average_order_value
      FROM branches b
      LEFT JOIN orders o ON b.id = o.branch_id AND ${whereClauses.join(' AND ')}
      ${filter.brand_id ? 'WHERE b.brand_id = ?' : ''}
      GROUP BY b.id, b.name, b.slug
      ORDER BY total_revenue DESC
    `).all(...(filter.brand_id ? [...params, filter.brand_id] : params));

    return {
      report_type: 'branch_comparison',
      filter,
      branches: branchesComparison
    };
  }
}

module.exports = BranchCompareService;
