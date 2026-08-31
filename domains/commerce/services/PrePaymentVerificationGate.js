/**
 * Xentra Commerce Pre-Payment Final Verification Gate
 * 
 * Strict architectural authority executed right when customer clicks "Pay / Konfirmasi Pesanan".
 * Performs atomic verification:
 * 1. Final Price Verification: Checks if prices changed since cart was added.
 * 2. Final Stock Verification: Ensures requested quantity is still in stock.
 * 3. Final Availability: Strictly enforces branch product assignment & active status (No 999 fake fallback).
 * 4. Branch Low-Stock Threshold: Captures branch manager configured threshold.
 */
const db = require('../../../server/database/db');
const PricingPolicyModel = require('../models/PricingPolicyModel');

class PrePaymentVerificationGate {
  static STATUS = {
    VERIFIED: 'VERIFIED',
    PRICE_CHANGED: 'PRICE_CHANGED',
    OUT_OF_STOCK: 'OUT_OF_STOCK',
    PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE'
  };

  /**
   * Verifies an order items payload atomically against live database state.
   * 
   * @param {Object} params
   * @param {string} params.branch_id
   * @param {string} params.brand_id
   * @param {Array<{ product_id: string|number, quantity: number, expected_price: number, name?: string }>} params.items
   * @returns {{ status: string, is_valid: boolean, verified_items: Array<Object>, price_diffs: Array<Object>, errors: Array<string> }}
   */
  static verify({ branch_id, brand_id, items = [] }) {
    if (!branch_id) {
      throw new Error('[PrePaymentVerificationGate] "branch_id" is required for final verification.');
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('[PrePaymentVerificationGate] "items" array must not be empty.');
    }

    // P1 RELATIONAL INTEGRITY (DB-01): Verify that branch belongs strictly to brand
    if (brand_id) {
      const branchBelongs = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branch_id, brand_id);
      if (!branchBelongs) {
        return {
          status: 'BRANCH_BRAND_MISMATCH',
          is_valid: false,
          verified_items: [],
          price_diffs: [],
          errors: [`Cabang "${branch_id}" bukan merupakan cabang resmi dari brand "${brand_id}".`]
        };
      }
    }

    const priceDiffs = [];
    const errors = [];
    const verifiedItems = [];

    for (const item of items) {
      const productId = item.product_id || item.id;
      const rawQty = item.quantity != null ? item.quantity : item.qty;
      const requestedQty = Number(rawQty);

      // P1 DOMAIN INVARIANT GUARD (LOGIC-03): Strictly validate quantity as positive integer > 0
      if (!Number.isInteger(requestedQty) || requestedQty <= 0) {
        errors.push(`Kuantitas untuk produk "${item.name || productId}" harus berupa bilangan bulat positif (> 0).`);
        continue;
      }

      const expectedPrice = Number(item.expected_price ?? item.price);

      // Query master product joined with branch_products
      const masterProduct = db.prepare(`
        SELECT 
          p.*, 
          bp.branch_id as bp_branch_id,
          bp.price as branch_raw_price, 
          bp.stock as branch_stock, 
          bp.is_available as branch_availability,
          bp.low_stock_threshold as branch_low_stock_threshold
        FROM products p
        LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = ?
        WHERE p.id = ? AND p.brand_id = ?
      `).get(branch_id, productId, brand_id);

      if (!masterProduct) {
        errors.push(`Produk "${item.name || productId}" tidak ditemukan di sistem.`);
        continue;
      }

      // STRICT CHECK: Product MUST be explicitly assigned to branch
      if (!masterProduct.bp_branch_id) {
        errors.push(`Produk "${masterProduct.name}" belum dialokasikan untuk cabang ini.`);
        continue;
      }

      // Check Master & Branch active status
      const isAvailable = masterProduct.is_active === 1 && (masterProduct.branch_availability !== 0);
      if (!isAvailable) {
        errors.push(`Produk "${masterProduct.name}" saat ini dinonaktifkan di cabang ini.`);
        continue;
      }

      // 1. STRICT Stock Check: No 999 fallback! If branch stock is null/undefined, stock is 0.
      const currentStock = masterProduct.branch_stock != null ? Number(masterProduct.branch_stock) : 0;
      if (currentStock < requestedQty) {
        errors.push(`Stok produk "${masterProduct.name}" tidak mencukupi (Tersedia: ${currentStock}, Diminta: ${requestedQty}).`);
        continue;
      }

      // 2. Price Check
      const pricing = PricingPolicyModel.resolvePrice(
        {
          price: masterProduct.price,
          pricing_mode: masterProduct.pricing_mode || 'lock',
          min_price: masterProduct.min_price,
          max_price: masterProduct.max_price
        },
        masterProduct.branch_raw_price
      );

      const actualPrice = pricing.effective_price;
      if (expectedPrice !== actualPrice) {
        priceDiffs.push({
          product_id: productId,
          name: masterProduct.name,
          expected_price: expectedPrice,
          actual_price: actualPrice,
          difference: actualPrice - expectedPrice
        });
      }

      verifiedItems.push({
        product_id: productId,
        name: masterProduct.name,
        quantity: requestedQty,
        unit_price: actualPrice,
        subtotal: actualPrice * requestedQty,
        current_stock: currentStock,
        branch_low_stock_threshold: masterProduct.branch_low_stock_threshold
      });
    }

    if (errors.length > 0) {
      return {
        status: errors.some(e => e.includes('Stok')) ? PrePaymentVerificationGate.STATUS.OUT_OF_STOCK : PrePaymentVerificationGate.STATUS.PRODUCT_UNAVAILABLE,
        is_valid: false,
        verified_items: [],
        price_diffs: [],
        errors
      };
    }

    if (priceDiffs.length > 0) {
      return {
        status: PrePaymentVerificationGate.STATUS.PRICE_CHANGED,
        is_valid: false,
        verified_items: verifiedItems,
        price_diffs: priceDiffs,
        errors: ['Terdapat perubahan harga pada item pesanan Anda. Mohon konfirmasi ulang.']
      };
    }

    return {
      status: PrePaymentVerificationGate.STATUS.VERIFIED,
      is_valid: true,
      verified_items: verifiedItems,
      price_diffs: [],
      errors: []
    };
  }
}

module.exports = PrePaymentVerificationGate;
