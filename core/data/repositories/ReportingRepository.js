'use strict';

/**
 * Reporting persistence adapter.
 *
 * Reporting services consume semantic report queries from this repository so
 * SQL/filter construction remains behind the Core data boundary.
 */
const DataAccess = require('../DataAccess');

const COMPLETED_ORDER_STATUSES = "'confirmed', 'completed', 'delivered', 'ready_for_pickup'";

class ReportingRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  getBranchComparison(filter = {}) {
    const joinConditions = [`o.status IN (${COMPLETED_ORDER_STATUSES})`];
    const queryParams = [];

    if (filter.brand_id) {
      joinConditions.push('o.brand_id = ?');
      queryParams.push(filter.brand_id);
    }
    if (filter.start_date) {
      joinConditions.push('o.created_at >= ?');
      queryParams.push(filter.start_date);
    }
    if (filter.end_date) {
      joinConditions.push('o.created_at <= ?');
      queryParams.push(filter.end_date);
    }

    let whereClause = '';
    if (filter.brand_id) {
      whereClause = 'WHERE b.brand_id = ?';
      queryParams.push(filter.brand_id);
    }

    return this.db.queryMany(`
      SELECT
        b.id as branch_id,
        b.name as branch_name,
        b.slug as branch_slug,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(o.grand_total), 0) as total_revenue,
        COALESCE(AVG(o.grand_total), 0) as average_order_value
      FROM branches b
      LEFT JOIN orders o ON b.id = o.branch_id AND ${joinConditions.join(' AND ')}
      ${whereClause}
      GROUP BY b.id, b.name, b.slug
      ORDER BY total_revenue DESC
    `, queryParams);
  }

  _buildOrderFilter(filter = {}) {
    const whereClauses = [`status IN (${COMPLETED_ORDER_STATUSES})`];
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

    return {
      whereSql: `WHERE ${whereClauses.join(' AND ')}`,
      params
    };
  }

  getSalesOverview(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter);
    return this.db.queryOne(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(grand_total), 0) as gross_revenue,
        COALESCE(SUM(subtotal), 0) as subtotal_revenue,
        COALESCE(SUM(delivery_fee), 0) as total_delivery_fees,
        COALESCE(AVG(grand_total), 0) as average_order_value
      FROM orders
      ${whereSql}
    `, params);
  }

  getSalesByOrderType(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter);
    return this.db.queryMany(`
      SELECT
        order_type,
        COUNT(*) as order_count,
        COALESCE(SUM(grand_total), 0) as total_revenue
      FROM orders
      ${whereSql}
      GROUP BY order_type
    `, params);
  }

  getSalesByChannel(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter);
    return this.db.queryMany(`
      SELECT
        order_channel,
        COUNT(*) as order_count,
        COALESCE(SUM(grand_total), 0) as total_revenue
      FROM orders
      ${whereSql}
      GROUP BY order_channel
    `, params);
  }

  getSalesTimeline(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter);
    return this.db.queryMany(`
      SELECT
        substr(created_at, 1, 10) as date,
        COUNT(*) as order_count,
        COALESCE(SUM(grand_total), 0) as revenue
      FROM orders
      ${whereSql}
      GROUP BY substr(created_at, 1, 10)
      ORDER BY date ASC
    `, params);
  }

  getPaymentBreakdown(filter = {}) {
    const whereClauses = [];
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

    return this.db.queryMany(`
      SELECT
        p.provider,
        p.payment_status,
        COUNT(*) as transaction_count,
        COALESCE(SUM(p.amount), 0) as total_amount
      FROM order_payments p
      JOIN orders o ON p.order_id = o.id
      ${whereSql}
      GROUP BY p.provider, p.payment_status
    `, params);
  }

  getInventoryMovementBreakdown(filter = {}) {
    const movementWhere = [];
    const movementParams = [];

    if (filter.brand_id) {
      movementWhere.push('im.branch_id IN (SELECT id FROM branches WHERE brand_id = ?)');
      movementParams.push(filter.brand_id);
    }
    if (filter.branch_id) {
      movementWhere.push('im.branch_id = ?');
      movementParams.push(filter.branch_id);
    }
    if (filter.start_date) {
      movementWhere.push('im.created_at >= ?');
      movementParams.push(filter.start_date);
    }
    if (filter.end_date) {
      movementWhere.push('im.created_at <= ?');
      movementParams.push(filter.end_date);
    }

    const whereSql = movementWhere.length > 0 ? `WHERE ${movementWhere.join(' AND ')}` : '';

    return this.db.queryMany(`
      SELECT
        im.movement_type,
        COUNT(*) as record_count,
        COALESCE(SUM(im.quantity), 0) as total_quantity
      FROM inventory_movements im
      ${whereSql}
      GROUP BY im.movement_type
    `, movementParams);
  }

  getLowStockItems(filter = {}) {
    const whereClauses = ['bp.stock <= bp.low_stock_threshold'];
    const params = [];

    if (filter.brand_id) {
      whereClauses.push('p.brand_id = ? AND b.brand_id = ?');
      params.push(filter.brand_id, filter.brand_id);
    }
    if (filter.branch_id) {
      whereClauses.push('bp.branch_id = ?');
      params.push(filter.branch_id);
    }

    return this.db.queryMany(`
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
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY bp.stock ASC
    `, params);
  }

  getTopProducts(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter);
    return this.db.queryMany(`
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
    `, params);
  }

  getCategoryContribution(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter);
    return this.db.queryMany(`
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
    `, params);
  }

  getShiftSummary(filter = {}) {
    const { whereSql, params } = this._buildShiftFilter(filter);
    return this.db.queryOne(`
      SELECT
        COUNT(*) as total_shifts,
        COALESCE(SUM(s.total_cash_sales), 0) as total_cash_sales,
        COALESCE(SUM(s.total_cash_in), 0) as total_cash_in,
        COALESCE(SUM(s.total_cash_out), 0) as total_cash_out,
        COALESCE(SUM(s.variance), 0) as total_variance
      FROM pos_shifts s
      ${whereSql}
    `, params);
  }

  getShifts(filter = {}) {
    const { whereSql, params } = this._buildShiftFilter(filter);
    return this.db.queryMany(`
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
    `, params);
  }

  _buildShiftFilter(filter = {}) {
    const whereClauses = [];
    const params = [];

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

    return {
      whereSql: whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '',
      params
    };
  }
}

module.exports = ReportingRepository;
