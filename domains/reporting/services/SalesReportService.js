'use strict';

const { ReportingRepository } = require('../../../core/data/repositories');
const ReportFilterModel = require('../models/ReportFilterModel');

const reportingRepository = new ReportingRepository();

class SalesReportService {
  /**
   * Generates comprehensive sales analytics by channel, order type, and time.
   * 
   * @param {Object} filterParams
   * @returns {Object} Sales report summary
   */
  static getSalesReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    // 1. Overall Aggregates
    const overall = reportingRepository.getSalesOverview(filter);

    // 2. Breakdown by order_type (delivery, pickup, dine_in, reservation)
    const byOrderType = reportingRepository.getSalesByOrderType(filter);

    // 3. Breakdown by order_channel (pos_cashier, customer_app, etc.)
    const byChannel = reportingRepository.getSalesByChannel(filter);

    // 4. Daily / Hourly distribution
    const timeline = reportingRepository.getSalesTimeline(filter);

    return {
      report_type: 'sales',
      filter,
      summary: {
        total_orders: overall.total_orders,
        gross_revenue: overall.gross_revenue,
        subtotal_revenue: overall.subtotal_revenue,
        total_delivery_fees: overall.total_delivery_fees,
        average_order_value: Math.round(overall.average_order_value)
      },
      by_order_type: byOrderType,
      by_channel: byChannel,
      timeline
    };
  }
}

module.exports = SalesReportService;
