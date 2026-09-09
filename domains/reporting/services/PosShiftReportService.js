'use strict';

const db = require('../../../core/data/DataAccess');
const ReportFilterModel = require('../models/ReportFilterModel');

class PosShiftReportService {
  /**
   * Generates cashier shift performance and cash variance report.
   * 
   * @param {Object} filterParams
   * @returns {Object} POS shift report summary
   */
  static getShiftReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    let whereClauses = [];
    const params = [];

    // P1 MULTI-TENANT ISOLATION: Strictly enforce brand_id scoping
    if (filter.brand_id) {
      whereClauses.push('s.branch_id IN (SELECT id FROM branches WHERE brand_id = ?)');
      params.push(filter.brand_id);
    }
    if (filter.branch_id) {
      whereClauses.push('s.branch_id = ?');
      params.push(filter.branch_id);
    }
    if (filter.start_date) {
      whereClauses.push('s.opened_at >= ?');
      params.push(filter.start_date);
    }
    if (filter.end_date) {
      whereClauses.push('s.opened_at <= ?');
      params.push(filter.end_date);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const summary = db.prepare(`
      SELECT 
        COUNT(*) as total_shifts,
        COALESCE(SUM(s.total_cash_sales), 0) as total_cash_sales,
        COALESCE(SUM(s.total_cash_in), 0) as total_cash_in,
        COALESCE(SUM(s.total_cash_out), 0) as total_cash_out,
        COALESCE(SUM(s.variance), 0) as total_variance
      FROM pos_shifts s
      ${whereSql}
    `).get(...params);

    const shifts = db.prepare(`
      SELECT 
        s.id,
        s.branch_id,
        s.cashier_id,
        s.starting_float,
        s.total_cash_sales,
        s.total_cash_in,
        s.total_cash_out,
        s.expected_cash,
        s.actual_cash,
        s.variance,
        s.status,
        s.opened_at,
        s.closed_at
      FROM pos_shifts s
      ${whereSql}
      ORDER BY s.opened_at DESC
      LIMIT 100
    `).all(...params);

    return {
      report_type: 'pos_shifts',
      filter,
      summary,
      shifts
    };
  }
}

module.exports = PosShiftReportService;
