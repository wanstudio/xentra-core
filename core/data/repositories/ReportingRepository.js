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
      joinConditions.push('datetime(o.created_at) >= datetime(?)');
      queryParams.push(filter.start_date);
    }
    if (filter.end_date) {
      joinConditions.push('datetime(o.created_at) <= datetime(?)');
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

  _buildOrderFilter(filter = {}, tablePrefix = '') {
    const pfx = tablePrefix ? `${tablePrefix}.` : '';
    const whereClauses = [`${pfx}status IN (${COMPLETED_ORDER_STATUSES})`];
    const params = [];

    if (filter.brand_id) {
      whereClauses.push(`${pfx}brand_id = ?`);
      params.push(filter.brand_id);
    }
    if (filter.branch_id) {
      whereClauses.push(`${pfx}branch_id = ?`);
      params.push(filter.branch_id);
    }
    if (filter.start_date) {
      whereClauses.push(`datetime(${pfx}created_at) >= datetime(?)`);
      params.push(filter.start_date);
    }
    if (filter.end_date) {
      whereClauses.push(`datetime(${pfx}created_at) <= datetime(?)`);
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
    const { whereSql, params } = this._buildOrderFilter(filter, 'o');
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
    const { whereSql, params } = this._buildOrderFilter(filter, 'o');
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

  getSalesByFulfillment(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter);
    return this.db.queryMany(`
      SELECT
        COALESCE(fulfillment_type, order_type) as fulfillment_type,
        COUNT(*) as order_count,
        COALESCE(SUM(grand_total), 0) as total_revenue
      FROM orders
      ${whereSql}
      GROUP BY COALESCE(fulfillment_type, order_type)
    `, params);
  }

  getCustomerOverview(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter);
    const result = this.db.queryOne(`
      SELECT
        COUNT(DISTINCT customer_phone) as total_unique_customers,
        COUNT(*) as total_orders,
        COALESCE(SUM(grand_total), 0) as total_spend
      FROM orders
      ${whereSql}
      AND customer_phone IS NOT NULL AND customer_phone != ''
    `, params);

    return result || { total_unique_customers: 0, total_orders: 0, total_spend: 0 };
  }

  getTopCustomers(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter);
    return this.db.queryMany(`
      SELECT
        customer_name,
        customer_phone,
        COUNT(*) as total_orders,
        COALESCE(SUM(grand_total), 0) as total_spent,
        MAX(created_at) as last_order_date
      FROM orders
      ${whereSql}
      AND customer_phone IS NOT NULL AND customer_phone != ''
      GROUP BY customer_phone, customer_name
      ORDER BY total_spent DESC
      LIMIT 50
    `, params);
  }

  getCustomersList(filter = {}) {
    const { whereSql, params } = this._buildOrderFilter(filter, 'o');
    const extraConditions = ["o.customer_phone IS NOT NULL AND o.customer_phone != ''"];
    const queryParams = [...params];

    if (filter.search) {
      extraConditions.push('(o.customer_name LIKE ? OR o.customer_phone LIKE ?)');
      queryParams.push(`%${filter.search}%`, `%${filter.search}%`);
    }

    const whereCombined = whereSql 
      ? `${whereSql} AND ${extraConditions.join(' AND ')}`
      : `WHERE ${extraConditions.join(' AND ')}`;

    // Subquery to get favorite/most used branch
    const rows = this.db.queryMany(`
      SELECT
        o.customer_phone,
        MAX(o.customer_name) as customer_name,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(o.grand_total), 0) as total_spent,
        COALESCE(AVG(o.grand_total), 0) as average_order_value,
        MAX(o.created_at) as last_order_date,
        MIN(o.created_at) as first_order_date
      FROM orders o
      ${whereCombined}
      GROUP BY o.customer_phone
      ORDER BY total_spent DESC
    `, queryParams);

    // Enrich with favorite branch and segment
    return rows.map(customer => {
      const favBranchRow = this.db.queryOne(`
        SELECT b.id, b.name, COUNT(o.id) as branch_order_count
        FROM orders o
        JOIN branches b ON o.branch_id = b.id
        WHERE o.customer_phone = ? AND o.brand_id = ?
        GROUP BY b.id, b.name
        ORDER BY branch_order_count DESC
        LIMIT 1
      `, [customer.customer_phone, filter.brand_id || 'brand_bangjo']);

      // Segment: new (1 order) vs returning (>1 orders)
      const segment = customer.total_orders > 1 ? 'returning' : 'new';

      return {
        id: customer.customer_phone,
        name: customer.customer_name || 'Pelanggan',
        phone: customer.customer_phone,
        order_count: customer.total_orders,
        total_spend: customer.total_spent,
        average_order_value: Math.round(customer.average_order_value),
        last_order: customer.last_order_date,
        first_order: customer.first_order_date,
        favorite_branch: favBranchRow ? { id: favBranchRow.id, name: favBranchRow.name } : null,
        segment
      };
    });
  }

  getCustomerDetail(brandId, customerIdOrPhone, branchId = null) {
    const whereClauses = [
      'o.brand_id = ?',
      '(o.customer_phone = ? OR o.id = ?)',
      `o.status IN (${COMPLETED_ORDER_STATUSES})`
    ];
    const params = [brandId, customerIdOrPhone, customerIdOrPhone];

    if (branchId) {
      whereClauses.push('o.branch_id = ?');
      params.push(branchId);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    const summary = this.db.queryOne(`
      SELECT
        o.customer_phone,
        MAX(o.customer_name) as customer_name,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(o.grand_total), 0) as total_spend,
        COALESCE(AVG(o.grand_total), 0) as average_order_value,
        MAX(o.created_at) as last_order_date,
        MIN(o.created_at) as first_order_date
      FROM orders o
      ${whereSql}
      GROUP BY o.customer_phone
    `, params);

    if (!summary) return null;

    // Favorite branch
    const favBranchRow = this.db.queryOne(`
      SELECT b.id, b.name, COUNT(o.id) as branch_order_count
      FROM orders o
      JOIN branches b ON o.branch_id = b.id
      WHERE o.customer_phone = ? AND o.brand_id = ? AND o.status IN (${COMPLETED_ORDER_STATUSES})
      GROUP BY b.id, b.name
      ORDER BY branch_order_count DESC
      LIMIT 1
    `, [summary.customer_phone, brandId]);

    // Top ordered products for this customer
    const topProducts = this.db.queryMany(`
      SELECT oi.product_id, oi.product_name, SUM(oi.quantity) as total_quantity, SUM(COALESCE(oi.subtotal, oi.item_subtotal, oi.unit_price * oi.quantity)) as total_sales
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_phone = ? AND o.brand_id = ? AND o.status IN (${COMPLETED_ORDER_STATUSES})
      GROUP BY oi.product_id, oi.product_name
      ORDER BY total_quantity DESC
      LIMIT 5
    `, [summary.customer_phone, brandId]);

    // Order history
    const orderHistory = this.db.queryMany(`
      SELECT o.id, o.order_number, o.created_at, o.status, o.order_channel, o.fulfillment_type, o.grand_total, b.name as branch_name
      FROM orders o
      LEFT JOIN branches b ON o.branch_id = b.id
      WHERE o.customer_phone = ? AND o.brand_id = ?
      ORDER BY o.created_at DESC
      LIMIT 20
    `, [summary.customer_phone, brandId]);

    // Delivery addresses if any
    const addresses = this.db.queryMany(`
      SELECT id, label, address, detail, note, is_primary
      FROM customer_addresses
      WHERE customer_phone = ? AND brand_id = ?
      ORDER BY is_primary DESC, created_at DESC
    `, [summary.customer_phone, brandId]);

    return {
      id: summary.customer_phone,
      name: summary.customer_name || 'Pelanggan',
      phone: summary.customer_phone,
      total_orders: summary.total_orders,
      total_spend: summary.total_spend,
      average_order_value: Math.round(summary.average_order_value),
      last_order: summary.last_order_date,
      first_order: summary.first_order_date,
      segment: summary.total_orders > 1 ? 'returning' : 'new',
      favorite_branch: favBranchRow ? { id: favBranchRow.id, name: favBranchRow.name } : null,
      top_products: topProducts,
      orders: orderHistory,
      addresses: addresses || []
    };
  }
}

module.exports = ReportingRepository;

