'use strict';

const db = require('../../../core/data/DataAccess');
const ReportFilterModel = require('../models/ReportFilterModel');

class PaymentReportService {
  /**
   * Generates payment reconciliation and breakdown (Cash vs Midtrans).
   * 
   * @param {Object} filterParams
   * @returns {Object} Payment report summary
   */
  static getPaymentReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    let whereClauses = [];
    const params = [];

    if (filter.branch_id) {
      whereClauses.push('o.branch_id = ?');
      params.push(filter.branch_id);
    }
    if (filter.brand_id) {
      whereClauses.push('o.brand_id = ?');
      params.push(filter.brand_id);
    }
    if (filter.start_date) {
      whereClauses.push('p.created_at >= ?');
      params.push(filter.start_date);
    }
    if (filter.end_date) {
      whereClauses.push('p.created_at <= ?');
      params.push(filter.end_date);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Breakdown by payment provider & status
    const breakdown = db.prepare(`
      SELECT 
        p.provider,
        p.payment_status,
        COUNT(*) as transaction_count,
        COALESCE(SUM(p.amount), 0) as total_amount
      FROM order_payments p
      JOIN orders o ON p.order_id = o.id
      ${whereSql}
      GROUP BY p.provider, p.payment_status
    `).all(...params);

    // Summary of settled funds
    let totalCashSettled = 0;
    let totalMidtransSettled = 0;
    let totalPending = 0;

    for (const row of breakdown) {
      if (row.payment_status === 'settlement') {
        if (row.provider === 'cash') totalCashSettled += row.total_amount;
        if (row.provider === 'midtrans') totalMidtransSettled += row.total_amount;
      } else if (row.payment_status === 'pending') {
        totalPending += row.total_amount;
      }
    }

    return {
      report_type: 'payment',
      filter,
      summary: {
        total_settled: totalCashSettled + totalMidtransSettled,
        cash_settled: totalCashSettled,
        midtrans_settled: totalMidtransSettled,
        total_pending: totalPending
      },
      breakdown
    };
  }
}

module.exports = PaymentReportService;
