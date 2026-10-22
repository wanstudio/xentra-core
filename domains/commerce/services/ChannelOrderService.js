/**
 * XENTRA CORE — EXTERNAL CHANNEL ORDER SERVICE
 *
 * Handles automated ingestion, verification, menu mapping, and bookkeeping
 * for external delivery marketplace orders (GoFood, GrabFood, ShopeeFood).
 */
'use strict';

const crypto = require('crypto');

class ChannelOrderService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Default commission rules per delivery aggregator channel
   */
  static get DEFAULT_COMMISSION_RATES() {
    return {
      gofood: 0.20,       // 20%
      grabfood: 0.20,     // 20%
      shopeefood: 0.20    // 20%
    };
  }

  static get PLATFORM_HANDLING_FEES() {
    return {
      gofood: 1000,
      grabfood: 1000,
      shopeefood: 1000
    };
  }

  /**
   * Ingest and book an order received from an external channel.
   *
   * @param {Object} params
   * @param {string} params.channel - 'gofood' | 'grabfood' | 'shopeefood'
   * @param {string} params.external_order_id - e.g. 'GF-8472910'
   * @param {string} params.brand_id - Brand ID
   * @param {string} params.branch_id - Branch ID
   * @param {string} [params.customer_name] - Customer name on food app
   * @param {string} [params.customer_phone] - Customer phone / driver contact
   * @param {string} [params.driver_name] - Assigned ojol driver name
   * @param {string} [params.driver_phone] - Ojol driver phone
   * @param {number} params.gross_amount - Gross order total from app
   * @param {number} [params.commission_rate] - Override rate (e.g. 0.20)
   * @param {Array<Object>} [params.items] - List of ordered items: [{ product_id, name, quantity, price }]
   * @param {string} [params.order_note] - Special customer instructions
   * @param {Object} [params.raw_payload] - Raw notification or webhook body
   */
  ingestChannelOrder({
    channel,
    external_order_id,
    brand_id,
    branch_id,
    customer_name = 'Pelanggan Ojol',
    customer_phone = '080000000000',
    driver_name = null,
    driver_phone = null,
    gross_amount,
    commission_rate = null,
    items = [],
    order_note = '',
    raw_payload = null
  }) {
    if (!channel || !['gofood', 'grabfood', 'shopeefood'].includes(channel.toLowerCase())) {
      throw new Error(`Saluran pesanan tidak valid: ${channel}. Hanya gofood, grabfood, atau shopeefood.`);
    }
    const normalizedChannel = channel.toLowerCase();

    if (!external_order_id || typeof external_order_id !== 'string') {
      throw new Error('ID pesanan eksternal (external_order_id) wajib diisi.');
    }

    if (!brand_id || !branch_id) {
      throw new Error('brand_id dan branch_id wajib disertakan.');
    }

    const parsedGross = Number(gross_amount);
    if (isNaN(parsedGross) || parsedGross <= 0) {
      throw new Error('gross_amount harus berupa angka positif.');
    }

    // 1. Idempotency Check: Prevent duplicate recording of the same external order
    const existing = this.db.prepare(
      'SELECT id, order_id, gross_amount, net_amount, channel FROM external_channel_orders WHERE channel = ? AND external_order_id = ? AND branch_id = ?'
    ).get(normalizedChannel, external_order_id.trim(), branch_id);

    if (existing) {
      return {
        success: true,
        is_duplicate: true,
        message: `Pesanan ${normalizedChannel.toUpperCase()} #${external_order_id} sudah pernah dibukukan sebelumnya.`,
        order_id: existing.order_id,
        channel_order_id: existing.id
      };
    }

    // 2. Financial calculation: Gross, Commission, Platform Fee, and Net Revenue
    let rate = commission_rate !== null && !isNaN(Number(commission_rate)) ? Number(commission_rate) : null;
    let platformFee = null;

    if (rate === null || platformFee === null) {
      try {
        const setting = this.db.prepare(
          'SELECT is_active, commission_rate, platform_fee FROM branch_channel_settings WHERE branch_id = ? AND channel = ?'
        ).get(branch_id, normalizedChannel);
        if (setting) {
          if (rate === null) rate = Number(setting.commission_rate);
          platformFee = Number(setting.platform_fee);
        }
      } catch (_) {}
    }

    if (rate === null) rate = ChannelOrderService.DEFAULT_COMMISSION_RATES[normalizedChannel] || 0.20;
    if (platformFee === null) platformFee = ChannelOrderService.PLATFORM_HANDLING_FEES[normalizedChannel] || 1000;

    const commissionAmount = Math.round(parsedGross * rate);
    const totalChannelFee = commissionAmount + platformFee;
    const netRevenue = Math.max(0, parsedGross - totalChannelFee);

    // 3. Generate primary keys
    const orderId = 'ord_' + crypto.randomBytes(12).toString('hex');
    const channelOrderRecordId = 'eco_' + crypto.randomBytes(12).toString('hex');
    const orderNumPrefix = normalizedChannel === 'gofood' ? 'GF-' : (normalizedChannel === 'grabfood' ? 'GRB-' : 'SPF-');
    const orderNumber = orderNumPrefix + external_order_id.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();

    // 4. Atomic transaction: create core order, items, and external channel bookkeeping entry
    const insertCoreOrder = this.db.prepare(`
      INSERT INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, fulfillment_type, status,
        subtotal, grand_total, total_amount, payment_method, payment_status,
        channel_fee, net_revenue, external_order_id, order_note, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        'takeaway', ?, 'takeaway', 'confirmed',
        ?, ?, ?, ?, 'settlement',
        ?, ?, ?, ?, datetime('now'), datetime('now')
      )
    `);

    const insertChannelRecord = this.db.prepare(`
      INSERT INTO external_channel_orders (
        id, order_id, channel, external_order_id, brand_id, branch_id,
        driver_name, driver_phone, gross_amount, commission_rate,
        commission_amount, platform_fee, net_amount, raw_payload, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, datetime('now')
      )
    `);

    const insertOrderItem = this.db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name, unit_price, quantity, item_subtotal, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.prepare('BEGIN').run();
    try {
      insertCoreOrder.run(
        orderId,
        orderNumber,
        brand_id,
        branch_id,
        customer_name,
        customer_phone,
        normalizedChannel, // order_channel: 'gofood' | 'grabfood' | 'shopeefood'
        parsedGross,
        parsedGross,
        parsedGross,
        `${normalizedChannel}_pay`,
        totalChannelFee,
        netRevenue,
        external_order_id.trim(),
        order_note || (driver_name ? `Driver: ${driver_name}` : null)
      );

      insertChannelRecord.run(
        channelOrderRecordId,
        orderId,
        normalizedChannel,
        external_order_id.trim(),
        brand_id,
        branch_id,
        driver_name || null,
        driver_phone || null,
        parsedGross,
        rate,
        commissionAmount,
        platformFee,
        netRevenue,
        raw_payload ? JSON.stringify(raw_payload) : null
      );

      // Insert line items if parsed
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const itemId = 'item_' + crypto.randomBytes(8).toString('hex');
          const pPrice = Number(item.price || item.unit_price) || 0;
          const pQty = Number(item.quantity) || 1;
          const pSubtotal = pPrice * pQty;
          insertOrderItem.run(
            itemId,
            orderId,
            item.product_id || 'item_custom',
            item.name || 'Menu Ojol',
            pPrice,
            pQty,
            pSubtotal,
            pSubtotal
          );
        }
      } else {
        // Fallback single line item representing external bundle
        const itemId = 'item_' + crypto.randomBytes(8).toString('hex');
        insertOrderItem.run(
          itemId,
          orderId,
          'item_bundle_ojol',
          `Pesanan ${normalizedChannel.toUpperCase()} (#${external_order_id})`,
          parsedGross,
          1,
          parsedGross,
          parsedGross
        );
      }

      this.db.prepare('COMMIT').run();

      return {
        success: true,
        is_duplicate: false,
        order_id: orderId,
        order_number: orderNumber,
        channel: normalizedChannel,
        external_order_id: external_order_id.trim(),
        gross_amount: parsedGross,
        commission_amount: commissionAmount,
        platform_fee: platformFee,
        net_revenue: netRevenue,
        status: 'confirmed'
      };
    } catch (err) {
      try { this.db.prepare('ROLLBACK').run(); } catch (_) {}
      throw err;
    }
  }

  /**
   * Summary of external channels financial breakdown for bookkeeping
   */
  getChannelFinancialSummary({ brand_id, branch_id, start_date, end_date }) {
    let sql = `
      SELECT
        channel,
        COUNT(*) as total_orders,
        COALESCE(SUM(gross_amount), 0) as total_gross,
        COALESCE(SUM(commission_amount + platform_fee), 0) as total_commission_fee,
        COALESCE(SUM(net_amount), 0) as total_net_payout
      FROM external_channel_orders
      WHERE brand_id = ?
    `;
    const params = [brand_id];

    if (branch_id && branch_id !== 'all') {
      sql += ' AND branch_id = ?';
      params.push(branch_id);
    }
    if (start_date) {
      sql += ' AND datetime(created_at) >= datetime(?)';
      params.push(start_date.length === 10 ? start_date + ' 00:00:00' : start_date);
    }
    if (end_date) {
      sql += ' AND datetime(created_at) <= datetime(?)';
      params.push(end_date.length === 10 ? end_date + ' 23:59:59' : end_date);
    }

    sql += ' GROUP BY channel';
    return this.db.prepare(sql).all(...params);
  }

  /**
   * Retrieve configured channel rates and toggle states for a branch
   */
  getChannelSettings(branchId) {
    if (!branchId) throw new Error('branch_id wajib disertakan.');

    const rows = this.db.prepare(
      'SELECT channel, is_active, commission_rate, platform_fee, auto_accept FROM branch_channel_settings WHERE branch_id = ?'
    ).all(branchId);

    const map = new Map(rows.map(r => [r.channel, r]));
    const channels = ['gofood', 'grabfood', 'shopeefood'];

    return channels.map(ch => {
      const existing = map.get(ch);
      if (existing) {
        return {
          channel: ch,
          is_active: Number(existing.is_active) === 1,
          commission_rate: Number(existing.commission_rate),
          commission_percent: Math.round(Number(existing.commission_rate) * 100),
          platform_fee: Number(existing.platform_fee),
          auto_accept: Number(existing.auto_accept) === 1
        };
      }
      return {
        channel: ch,
        is_active: true,
        commission_rate: ChannelOrderService.DEFAULT_COMMISSION_RATES[ch] || 0.20,
        commission_percent: Math.round((ChannelOrderService.DEFAULT_COMMISSION_RATES[ch] || 0.20) * 100),
        platform_fee: ChannelOrderService.PLATFORM_HANDLING_FEES[ch] || 1000,
        auto_accept: true
      };
    });
  }

  /**
   * Save or update channel rates and status for a branch
   */
  saveChannelSettings(branchId, settingsList) {
    if (!branchId) throw new Error('branch_id wajib disertakan.');
    if (!Array.isArray(settingsList)) throw new Error('settings harus berupa array.');

    const upsert = this.db.prepare(`
      INSERT INTO branch_channel_settings (
        id, branch_id, channel, is_active, commission_rate, platform_fee, auto_accept, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(branch_id, channel) DO UPDATE SET
        is_active = excluded.is_active,
        commission_rate = excluded.commission_rate,
        platform_fee = excluded.platform_fee,
        auto_accept = excluded.auto_accept,
        updated_at = datetime('now')
    `);

    this.db.prepare('BEGIN').run();
    try {
      for (const item of settingsList) {
        const ch = (item.channel || '').toLowerCase();
        if (!['gofood', 'grabfood', 'shopeefood'].includes(ch)) continue;

        const id = 'bcs_' + crypto.randomBytes(8).toString('hex');
        const isActive = (item.is_active === true || item.is_active === 1 || item.is_active === 'true') ? 1 : 0;
        const commRate = !isNaN(Number(item.commission_rate))
          ? Number(item.commission_rate)
          : (!isNaN(Number(item.commission_percent)) ? Number(item.commission_percent) / 100 : 0.20);
        const platformFee = !isNaN(Number(item.platform_fee)) ? Number(item.platform_fee) : 1000;
        const autoAccept = (item.auto_accept === false || item.auto_accept === 0 || item.auto_accept === 'false') ? 0 : 1;

        upsert.run(id, branchId, ch, isActive, commRate, platformFee, autoAccept);
      }
      this.db.prepare('COMMIT').run();
      return this.getChannelSettings(branchId);
    } catch (e) {
      try { this.db.prepare('ROLLBACK').run(); } catch (_) {}
      throw e;
    }
  }

  /**
   * Get detailed orders list for reconciliation table
   */
  getChannelOrders({ brand_id, branch_id, channel, start_date, end_date, limit = 50, offset = 0 }) {
    let sql = `
      SELECT
        eco.id,
        eco.order_id,
        eco.channel,
        eco.external_order_id,
        eco.branch_id,
        eco.driver_name,
        eco.driver_phone,
        eco.gross_amount,
        eco.commission_rate,
        eco.commission_amount,
        eco.platform_fee,
        eco.net_amount,
        eco.created_at,
        o.order_number,
        o.customer_name,
        o.status as order_status,
        b.name as branch_name
      FROM external_channel_orders eco
      JOIN orders o ON o.id = eco.order_id
      LEFT JOIN branches b ON b.id = eco.branch_id
      WHERE eco.brand_id = ?
    `;
    const params = [brand_id];

    if (branch_id && branch_id !== 'all') {
      sql += ' AND eco.branch_id = ?';
      params.push(branch_id);
    }
    if (channel && channel !== 'all') {
      sql += ' AND eco.channel = ?';
      params.push(channel.toLowerCase());
    }
    if (start_date) {
      sql += ' AND datetime(eco.created_at) >= datetime(?)';
      params.push(start_date.length === 10 ? start_date + ' 00:00:00' : start_date);
    }
    if (end_date) {
      sql += ' AND datetime(eco.created_at) <= datetime(?)';
      params.push(end_date.length === 10 ? end_date + ' 23:59:59' : end_date);
    }

    sql += ' ORDER BY eco.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit) || 50, Number(offset) || 0);

    return this.db.prepare(sql).all(...params);
  }
}

module.exports = ChannelOrderService;
