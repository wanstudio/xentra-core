'use strict';

const { ReportingRepository } = require('../../../core/data/repositories');
const ReportFilterModel = require('../models/ReportFilterModel');

const reportingRepository = new ReportingRepository();

class PaymentReportService {
  /**
   * Generates payment reconciliation and breakdown (Cash vs Midtrans).
   * 
   * @param {Object} filterParams
   * @returns {Object} Payment report summary
   */
  static getPaymentReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);
    const breakdown = reportingRepository.getPaymentBreakdown(filter);

    let totalCashSettled = 0;
    let totalMidtransSettled = 0;
    let totalDokuSettled = 0;
    let totalQrisStaticSettled = 0;
    let totalPending = 0;

    for (const row of breakdown) {
      if (row.payment_status === 'settlement') {
        if (row.provider === 'cash') totalCashSettled += row.total_amount;
        if (row.provider === 'midtrans') totalMidtransSettled += row.total_amount;
        if (row.provider === 'doku') totalDokuSettled += row.total_amount;
        if (row.provider === 'qris_static') totalQrisStaticSettled += row.total_amount;
      } else if (row.payment_status === 'pending') {
        totalPending += row.total_amount;
      }
    }

    return {
      report_type: 'payment',
      filter,
      summary: {
        total_settled: totalCashSettled + totalMidtransSettled + totalDokuSettled + totalQrisStaticSettled,
        cash_settled: totalCashSettled,
        midtrans_settled: totalMidtransSettled,
        doku_settled: totalDokuSettled,
        qris_static_settled: totalQrisStaticSettled,
        total_pending: totalPending
      },
      breakdown
    };
  }
}

module.exports = PaymentReportService;
