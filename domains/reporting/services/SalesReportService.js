'use strict';

const db = require('../../../server/database/db');
const ReportFilterModel = require('../models/ReportFilterModel');

class SalesReportService {
  /**
   * Generates comprehensive sales analytics by channel, order type, and time.
   * 
   * @param {Object} filterParams
   * @returns {Object} Sales report summary
   */
  static getSalesReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    let whereClauses = ["status IN ('confirmed', 'completed', 'delivered', 'ready_for_pickup')"];
    const params = [];

    if (filter.brand_id) {
      whereClauses.push('brand_id = ?');
      params.push(filter.brand_id);
    }
    if (filter.branch_id) {
      whereClauses.push('branch_id = ?');
      params.push(filter.branch_id);
    }
    if (filter.start_date) {
      whereClauses.push('created_at >= ?');
      params.push(filter.start_date);
    }
    if (filter.end_date) {
      whereClauses.push('created_at <= ?');
      params.push(filter.end_date);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 1. Overall Aggregates
    const overall = db.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(grand_total), 0) as gross_revenue,
        COALESCE(SUM(subtotal), 0) as subtotal_revenue,
        COALESCE(SUM(delivery_fee), 0) as total_delivery_fees,
        COALESCE(AVG(grand_total), 0) as average_order_value
      FROM orders
      ${whereSql}
    `).get(...params);

    // 2. Breakdown by order_type (delivery, pickup, dine_in, reservation)
    const byOrderType = db.prepare(`
      SELECT 
        order_type,
        COUNT(*) as order_count,
        COALESCE(SUM(grand_total), 0) as total_revenue
      FROM orders
      ${whereSql}
      GROUP BY order_type
    `).all(...params);

    // 3. Breakdown by order_channel (pos_cashier, customer_app, etc.)
    const byChannel = db.prepare(`
      SELECT 
        order_channel,
        COUNT(*) as order_count,
        COALESCE(SUM(grand_total), 0) as total_revenue
      FROM orders
      ${whereSql}
      GROUP BY order_channel
    `).all(...params);

    // 4. Daily / Hourly distribution
    const timeline = db.prepare(`
      SELECT 
        substr(created_at, 1, 10) as date,
        COUNT(*) as order_count,
        COALESCE(SUM(grand_total), 0) as revenue
      FROM orders
      ${whereSql}
      GROUP BY substr(created_at, 1, 10)
      ORDER BY date ASC
    `).all(...params);

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
