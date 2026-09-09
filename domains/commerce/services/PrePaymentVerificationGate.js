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
const CatalogRepository = require('../../../core/data/repositories/CatalogRepository');
const PricingPolicyModel = require('../models/PricingPolicyModel');

const catalogRepository = new CatalogRepository();

class PrePaymentVerificationGate {
  static STATUS = {
    VERIFIED: 'VERIFIED',
    PRICE_CHANGED: 'PRICE_CHANGED',
    OUT_OF_STOCK: 'OUT_OF_STOCK',
    PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
    CHECKOUT_SINGLE_BRANCH_REQUIRED: 'CHECKOUT_SINGLE_BRANCH_REQUIRED'
  };

  static assertSingleBranchCheckout(branchId, items = []) {
    const provKeys = [];
    const seen = {};
    for (const item of Array.isArray(items) ? items : []) {
      const raw = item && (item.branch_id != null && String(item.branch_id).trim() !== '') ? String(item.branch_id) : null;
      if (raw && !seen[raw]) {
        seen[raw] = true;
        provKeys.push(raw);
      }
    }
    if (provKeys.length > 1) {
      return {
        status: PrePaymentVerificationGate.STATUS.CHECKOUT_SINGLE_BRANCH_REQUIRED,
        error: 'Checkout hanya dapat berisi produk dari satu cabang. Pisahkan pesanan Anda per cabang.'
      };
    }
    if (provKeys.length === 1 && branchId && String(branchId) !== provKeys[0]) {
      return {
        status: PrePaymentVerificationGate.STATUS.CHECKOUT_SINGLE_BRANCH_REQUIRED,
        error: `Produk dalam pesanan berasal dari cabang "${provKeys[0]}" sedangkan checkout ditujukan ke cabang "${branchId}". Checkout harus single-branch; pilih cabang yang sesuai.`
      };
    }
    return null;
  }

  static verify({ branch_id, brand_id, items = [], customer = {}, pwa_runtime = null }) {
    if (!branch_id) throw new Error('[PrePaymentVerificationGate] "branch_id" is required for final verification.');
    if (!Array.isArray(items) || items.length === 0) throw new Error('[PrePaymentVerificationGate] "items" array must not be empty.');

    const installRequirementSatisfied = Boolean(pwa_runtime && (
      pwa_runtime.display_mode === 'standalone' ||
      pwa_runtime.install_requirement_satisfied === true
    ));

    if (brand_id && !catalogRepository.branchBelongsToBrand(branch_id, brand_id)) {
      return {
        status: 'BRANCH_BRAND_MISMATCH',
        is_valid: false,
        verified_items: [],
        price_diffs: [],
        errors: [`Cabang "${branch_id}" bukan merupakan cabang resmi dari brand "${brand_id}".`]
      };
    }

    const priceDiffs = [];
    const errors = [];
    const verifiedItems = [];
    const appliedPromos = [];

    let PromotionEngineService = null;
    try {
      PromotionEngineService = require('../../promotion/services/PromotionEngineService');
    } catch (_) {}

    for (const item of items) {
      const productId = item.product_id || item.id;
      const rawQty = item.quantity != null ? item.quantity : item.qty;
      const requestedQty = Number(rawQty);
      if (!productId) {
        errors.push('Setiap baris pesanan wajib menyertakan product_id.');
        continue;
      }
      if (!Number.isInteger(requestedQty) || requestedQty <= 0) {
        errors.push(`Kuantitas untuk produk "${item.name || productId}" harus berupa bilangan bulat positif (> 0).`);
        continue;
      }

      const isRewardIntent = Boolean(
        item.is_promo_reward || item.promo_id || String(productId).startsWith('reward_')
      );

      if (isRewardIntent && PromotionEngineService) {
        let promoId = item.promo_id || (String(productId).startsWith('reward_') ? String(productId).replace(/^reward_/, '') : null);
        const nonRewardItems = items.filter(it => {
          const pid = String(it.product_id || it.id || '');
          return !it.is_promo_reward && !it.promo_id && !pid.startsWith('reward_');
        });
        const evalResult = PromotionEngineService.evaluate({
          brand_id,
          is_pwa_installed: installRequirementSatisfied,
          customer_phone: (customer && customer.phone) ? String(customer.phone).trim() : '',
          cart_items: nonRewardItems
        });
        const eligiblePromo = (evalResult.applied || []).find(p => !promoId || p.promo_id === promoId || p.id === promoId) ||
                              (evalResult.discovery || []).find(p => (!promoId || p.promo_id === promoId || p.id === promoId) && p.should_grant_reward);
        if (!eligiblePromo) {
          errors.push('Klaim hadiah promo tidak valid atau syarat promo belum terpenuhi.');
          continue;
        }
        const authoritativePromoId = eligiblePromo.promo_id || eligiblePromo.id;
        const rewardSpec = eligiblePromo.reward || {};
        const targetPid = rewardSpec.product_id;
        if (!targetPid) {
          errors.push(`Definisi produk hadiah promo "${eligiblePromo.name || authoritativePromoId}" tidak ditemukan.`);
          continue;
        }
        const bpCheck = catalogRepository.findRewardProduct(branch_id, targetPid);
        if (!bpCheck) {
          errors.push('Produk hadiah tidak tersedia di katalog cabang tujuan.');
          continue;
        }
        if (bpCheck.is_available === 0) {
          errors.push(`Produk hadiah "${bpCheck.name || 'Promo'}" sedang dinonaktifkan di cabang ini.`);
          continue;
        }
        const authoritativeRewardPrice = Number(rewardSpec.reward_price || rewardSpec.amount_in_cents || 0);
        const authoritativeRewardName = bpCheck.name || eligiblePromo.display?.reward_title || 'Hadiah Promo Spesial';
        const catalogRewardPrice = Number(bpCheck.regular_price || bpCheck.price || authoritativeRewardPrice);
        verifiedItems.push({
          product_id: targetPid,
          promo_id: authoritativePromoId,
          is_promo_reward: true,
          name: authoritativeRewardName,
          quantity: 1,
          unit_price: authoritativeRewardPrice,
          subtotal: authoritativeRewardPrice,
          notes: eligiblePromo.display?.reward_badge_text || 'Bonus Promo Terverifikasi'
        });
        appliedPromos.push({
          promo_id: authoritativePromoId,
          benefit_amount: authoritativeRewardPrice === 0 ? catalogRewardPrice : authoritativeRewardPrice
        });
        continue;
      }

      const expectedPrice = Number(item.expected_price ?? item.price);
      const masterProduct = catalogRepository.findProductForBranch({
        branchId: branch_id,
        productId,
        brandId: brand_id
      });
      if (!masterProduct) {
        errors.push(`Produk "${item.name || productId}" tidak ditemukan di sistem.`);
        continue;
      }
      if (!masterProduct.bp_branch_id) {
        errors.push(`Produk "${masterProduct.name}" belum dialokasikan untuk cabang ini.`);
        continue;
      }
      const isAvailable = (masterProduct.branch_availability !== 0);
      if (!isAvailable) {
        errors.push(`Produk "${masterProduct.name}" saat ini dinonaktifkan di cabang ini.`);
        continue;
      }
      const currentStock = masterProduct.branch_stock != null ? Number(masterProduct.branch_stock) : 0;
      if (currentStock < requestedQty) {
        errors.push(`Stok produk "${masterProduct.name}" tidak mencukupi (Tersedia: ${currentStock}, Diminta: ${requestedQty}).`);
        continue;
      }
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
      const hasExplicitExpectedPrice = item.expected_price !== undefined && item.expected_price !== null && !isNaN(Number(item.expected_price));
      const hasExplicitItemPrice = item.price !== undefined && item.price !== null && !isNaN(Number(item.price));
      if ((hasExplicitExpectedPrice || hasExplicitItemPrice) && expectedPrice !== actualPrice) {
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
      applied_promos: appliedPromos,
      price_diffs: [],
      errors: []
    };
  }
}

module.exports = PrePaymentVerificationGate;
