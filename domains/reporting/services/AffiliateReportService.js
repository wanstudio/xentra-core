'use strict';

const DataAccess = require('../../../core/data/DataAccess');
const ReportFilterModel = require('../models/ReportFilterModel');

class AffiliateReportService {
  /**
   * Generates comprehensive mobile-first affiliate report for Merchant & Owner.
   * 
   * @param {Object} filterParams
   * @returns {Object} Affiliate report payload
   */
  static getAffiliateReport(filterParams = {}) {
    const filter = ReportFilterModel.normalize(filterParams);
    const db = DataAccess;

    const brandId = filter.brand_id;
    if (!brandId) throw new Error('[AffiliateReportService] brand_id is required');

    let dateClause = '';
    const dateParams = [];
    if (filter.start_date_sql && filter.end_date_sql) {
      dateClause = ' AND c.created_at >= ? AND c.created_at <= ?';
      dateParams.push(filter.start_date_sql, filter.end_date_sql);
    } else if (filter.start_date_sql) {
      dateClause = ' AND c.created_at >= ?';
      dateParams.push(filter.start_date_sql);
    } else if (filter.end_date_sql) {
      dateClause = ' AND c.created_at <= ?';
      dateParams.push(filter.end_date_sql);
    }

    // 1. Overall Summary
    const summaryRow = db.queryOne(`
      SELECT 
        COUNT(c.id) AS total_orders,
        COALESCE(SUM(c.eligible_subtotal), 0) AS total_sales,
        COALESCE(SUM(c.total_items), 0) AS total_items_sold,
        COALESCE(SUM(c.commission_amount), 0) AS total_commission,
        COUNT(DISTINCT c.affiliate_profile_id) AS active_affiliates_count
      FROM affiliate_conversions c
      WHERE c.brand_id = ? AND c.status != 'VOID' ${dateClause}
    `, [brandId, ...dateParams]) || {};

    const totalOrders = Number(summaryRow.total_orders || 0);
    const totalSales = Number(summaryRow.total_sales || 0);
    const totalItemsSold = Number(summaryRow.total_items_sold || 0);
    const totalCommission = Number(summaryRow.total_commission || 0);
    const activeAffiliatesCount = Number(summaryRow.active_affiliates_count || 0);

    const effectiveRate = totalSales > 0 ? ((totalCommission / totalSales) * 100).toFixed(1) : '0.0';
    const aov = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;

    // Paid out vs Pending commissions
    const paidRow = db.queryOne(`
      SELECT COALESCE(SUM(amount), 0) AS total_paid
      FROM affiliate_payouts
      WHERE brand_id = ? AND status = 'PAID'
    `, [brandId]) || {};
    const totalPaid = Number(paidRow.total_paid || 0);

    // 2. Top Performing Affiliates
    const topAffiliates = db.queryMany(`
      SELECT 
        p.id AS profile_id,
        p.referral_code,
        COALESCE(p.bank_account_holder, c.display_name, 'Mitra Afiliasi') AS affiliate_name,
        COALESCE(c.phone, '') AS phone,
        p.status,
        COUNT(conv.id) AS orders_count,
        COALESCE(SUM(conv.total_items), 0) AS items_sold,
        COALESCE(SUM(conv.eligible_subtotal), 0) AS total_sales,
        COALESCE(SUM(conv.commission_amount), 0) AS total_commission
      FROM affiliate_profiles p
      LEFT JOIN customers c ON c.id = p.customer_id
      JOIN affiliate_conversions conv ON conv.affiliate_profile_id = p.id
      WHERE p.brand_id = ? AND conv.status != 'VOID' ${dateClause.replace(/c\./g, 'conv.')}
      GROUP BY p.id
      ORDER BY total_sales DESC
      LIMIT 15
    `, [brandId, ...dateParams]) || [];

    // 3. Top Products sold via affiliate links
    const topProducts = db.queryMany(`
      SELECT 
        oi.product_name,
        SUM(oi.quantity) AS quantity_sold,
        COALESCE(SUM(COALESCE(oi.subtotal, oi.quantity * oi.unit_price)), 0) AS total_sales
      FROM affiliate_conversions c
      JOIN order_items oi ON oi.order_id = c.order_id
      WHERE c.brand_id = ? AND c.status != 'VOID' ${dateClause}
      GROUP BY oi.product_name
      ORDER BY quantity_sold DESC
      LIMIT 10
    `, [brandId, ...dateParams]) || [];

    // 4. Recent Conversions Log
    const recentConversions = db.queryMany(`
      SELECT 
        c.id,
        c.order_id,
        COALESCE(o.order_number, c.order_id) AS order_number,
        c.created_at,
        p.referral_code,
        COALESCE(p.bank_account_holder, cust.display_name, 'Mitra') AS affiliate_name,
        c.total_items,
        c.eligible_subtotal,
        c.commission_amount,
        c.status
      FROM affiliate_conversions c
      LEFT JOIN orders o ON o.id = c.order_id
      LEFT JOIN affiliate_profiles p ON p.id = c.affiliate_profile_id
      LEFT JOIN customers cust ON cust.id = p.customer_id
      WHERE c.brand_id = ? ${dateClause}
      ORDER BY c.created_at DESC
      LIMIT 30
    `, [brandId, ...dateParams]) || [];

    return {
      report_type: 'affiliate',
      filter,
      summary: {
        total_orders: totalOrders,
        total_sales: totalSales,
        total_items_sold: totalItemsSold,
        total_commission: totalCommission,
        total_paid: totalPaid,
        active_affiliates_count: activeAffiliatesCount,
        effective_commission_rate: effectiveRate,
        average_order_value: aov
      },
      top_affiliates: topAffiliates,
      top_products: topProducts,
      recent_conversions: recentConversions
    };
  }
}

module.exports = AffiliateReportService;
