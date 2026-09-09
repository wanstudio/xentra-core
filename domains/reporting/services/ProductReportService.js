'use strict';

const db = require('../../../core/data/DataAccess');
const ReportFilterModel = require('../models/ReportFilterModel');

class ProductReportService {
  /**
   * Generates product / menu performance report (top sellers and category contribution).
   * 
   * @param {Object} filterParams
   * @returns {Object} Product report summary
   */
  static getProductReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);

    let whereClauses = ["o.status IN ('confirmed', 'completed', 'delivered', 'ready_for_pickup')"];
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
      whereClauses.push('o.created_at >= ?');
      params.push(filter.start_date);
    }
    if (filter.end_date) {
      whereClauses.push('o.created_at <= ?');
      params.push(filter.end_date);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Top selling items from order_items
    const topProducts = db.prepare(`
      SELECT 
        oi.product_id,
        oi.product_name,
        COALESCE(c.name, 'Uncategorized') as category_name,
        SUM(oi.quantity) as total_units_sold,
        SUM(COALESCE(oi.subtotal, oi.item_subtotal, oi.unit_price * oi.quantity)) as total_gross_sales
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereSql}
      GROUP BY oi.product_id, oi.product_name, c.name
      ORDER BY total_units_sold DESC
      LIMIT 50
    `).all(...params);

    // Category Contribution
    const categoryContribution = db.prepare(`
      SELECT 
        COALESCE(c.name, 'Uncategorized') as category_name,
        SUM(oi.quantity) as total_units_sold,
        SUM(COALESCE(oi.subtotal, oi.item_subtotal, oi.unit_price * oi.quantity)) as total_gross_sales
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereSql}
      GROUP BY c.name
      ORDER BY total_gross_sales DESC
    `).all(...params);

    return {
      report_type: 'products',
      filter,
      top_products: topProducts,
      category_contribution: categoryContribution
    };
  }
}

module.exports = ProductReportService;
