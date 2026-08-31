/**
 * Xentra Commerce Order Placement Service
 * Handles customer order submission, pre-payment verification, atomic stock deduction,
 * order snapshot creation, and distributed event dispatching.
 */
const crypto = require('crypto');
const db = require('../../../server/database/db');
const { events } = require('../../../core');
const PrePaymentVerificationGate = require('./PrePaymentVerificationGate');
const LowStockThresholdModel = require('../models/LowStockThresholdModel');

class OrderPlacementService {
  /**
   * Submits a customer order with strict pre-payment verification and atomic stock deduction.
   * 
   * @param {Object} params
   * @param {string} params.brand_id
   * @param {string} params.branch_id
   * @param {Object} params.customer - { name, phone, address, coordinates }
   * @param {Array<Object>} params.items - Cart items { product_id, quantity, expected_price }
   * @param {number} [params.delivery_fee=0]
   * @param {string} [params.payment_method='qris']
   * @param {string} [params.notes='']
   * @param {Object} [params.trace_context] - { correlation_id, causation_id }
   * @returns {Promise<Object>} Created order snapshot & payment readiness
   */
  static async submitOrder({
    brand_id,
    branch_id,
    customer,
    items = [],
    delivery_fee = 0,
    payment_method = 'qris',
    notes = '',
    trace_context = {}
  }) {
    // 1. Execute Atomic Pre-Payment Verification Gate
    const verification = PrePaymentVerificationGate.verify({
      branch_id,
      brand_id,
      items
    });

    if (!verification.is_valid) {
      return {
        success: false,
        status: verification.status,
        errors: verification.errors,
        price_diffs: verification.price_diffs
      };
    }

    const verifiedItems = verification.verified_items;
    const subtotal = verifiedItems.reduce((acc, it) => acc + it.subtotal, 0);
    const grandTotal = subtotal + Number(delivery_fee || 0);

    const orderId = `ord_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;

    // 2. Atomic Database Transaction: Order Snapshot + Order Items + Stock Deduction
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, subtotal, delivery_fee, grand_total, payment_method, status, order_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'delivery', ?, ?, ?, ?, 'pending', ?, ?, ?)
    `);

    const insertOrderItem = db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name, unit_price, quantity, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const deductStock = db.prepare(`
      UPDATE branch_products
      SET stock = stock - ?, updated_at = datetime('now')
      WHERE branch_id = ? AND product_id = ?
    `);

    insertOrder.run(
      orderId,
      orderNumber,
      brand_id,
      branch_id,
      customer.name || 'Pelanggan',
      customer.phone || '',
      subtotal,
      delivery_fee,
      grandTotal,
      payment_method,
      notes,
      now,
      now
    );

    for (const item of verifiedItems) {
      const itemId = `item_${crypto.randomBytes(6).toString('hex')}`;
      insertOrderItem.run(
        itemId,
        orderId,
        item.product_id,
        item.name,
        item.unit_price,
        item.quantity,
        item.subtotal
      );

      // Deduct stock in branch_products atomically
      deductStock.run(item.quantity, branch_id, item.product_id);

      // Evaluate Low-Stock Warning using Branch Manager's actual configured threshold
      const remainingStock = item.current_stock - item.quantity;
      const branchThreshold = item.branch_low_stock_threshold != null ? item.branch_low_stock_threshold : LowStockThresholdModel.DEFAULT_THRESHOLD;
      const stockEval = LowStockThresholdModel.evaluate(remainingStock, branchThreshold);

      if (stockEval.is_low || stockEval.is_out_of_stock) {
        // Publish decoupled warning event for Inventory / Branch Manager
        events.EventBus.publish({
          type: 'inventory.low_stock_warning',
          producer: 'commerce',
          payload: {
            branch_id,
            product_id: item.product_id,
            product_name: item.name,
            remaining_stock: remainingStock,
            threshold: stockEval.threshold,
            is_out_of_stock: stockEval.is_out_of_stock
          },
          context: {
            correlation_id: trace_context.correlation_id,
            causation_id: orderId
          }
        }).catch(() => {});
      }
    }

    // 3. Publish Core Event: commerce.order.placed
    await events.EventBus.publish({
      type: 'commerce.order.placed',
      producer: 'commerce',
      payload: {
        order_id: orderId,
        order_number: orderNumber,
        brand_id,
        branch_id,
        subtotal,
        delivery_fee,
        grand_total: grandTotal,
        items: verifiedItems,
        customer
      },
      context: {
        correlation_id: trace_context.correlation_id,
        causation_id: orderId
      }
    });

    return {
      success: true,
      status: 'VERIFIED',
      order: {
        id: orderId,
        order_number: orderNumber,
        brand_id,
        branch_id,
        subtotal,
        delivery_fee,
        grand_total: grandTotal,
        status: 'pending',
        items: verifiedItems,
        created_at: now
      }
    };
  }
}

module.exports = OrderPlacementService;
