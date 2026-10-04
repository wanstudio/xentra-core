/**
 * Xentra Commerce Pre-Payment Final Verification Gate
 * 
 * Strict architectural authority executed right when customer clicks "Pay / Konfirmasi Pesanan".
 * Performs atomic verification:
 * 1. Final Price Verification: Checks the Owner Master price against the cart expectation.
 * 2. Final Stock Verification: Ensures requested quantity is still in stock.
 * 3. Final Availability: Strictly enforces branch product assignment & active status (No 999 fake fallback).
 * 4. Branch Low-Stock Threshold: Captures the Branch-configured threshold.
 * 5. Master Menu Composition: Resolves structured Owner composition for Checkout and order snapshots.
 */
const CatalogRepository = require('../../../core/data/repositories/CatalogRepository');
const ProductOptionsModel = require('../../catalog/models/ProductOptionsModel');
const MasterMenuResolver = require('../../catalog/services/MasterMenuResolver');

const catalogRepository = new CatalogRepository();

function buildMenuSnapshot({ brandId, productId }) {
  try {
    const resolved = MasterMenuResolver.resolveMasterProducts({
      brandId,
      productIds: [productId]
    })[0];
    if (!resolved) return null;

    return {
      schema_version: 'master-menu-composition-v1',
      source: 'master',
      captured_at: new Date().toISOString(),
      product_id: resolved.product_id,
      title: resolved.title,
      subtitle: resolved.subtitle,
      detail: Array.isArray(resolved.detail) ? resolved.detail.slice() : [],
      indicator: resolved.indicator,
      image: resolved.image || null,
      master: {
        category_id: resolved.master && resolved.master.category_id ? resolved.master.category_id : null
      }
    };
  } catch (_) {
    // Compatibility window: legacy products without structured composition may
    // still be ordered until migration reconciliation is complete.
    return null;
  }
}

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
      if (item && (item.is_promo_reward || item.promo_id || item.promotion_id || String(item.product_id || item.id || '').startsWith('reward_'))) {
        continue;
      }
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
          branch_id,
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
        const rewardDisplayName = bpCheck?.name || eligiblePromo.display?.reward_title || 'Hadiah Promo';
        if (!bpCheck) {
          errors.push(`Produk hadiah "${rewardDisplayName}" tidak tersedia di cabang yang akan memenuhi pesananmu. Pilih hadiah lain atau lanjut tanpa hadiah.`);
          continue;
        }
        if (bpCheck.is_available === 0) {
          errors.push(`Produk hadiah "${rewardDisplayName}" sedang dinonaktifkan di cabang yang akan memenuhi pesananmu. Pilih hadiah lain atau lanjut tanpa hadiah.`);
          continue;
        }
        const rewardStock = bpCheck.stock != null ? Number(bpCheck.stock) : null;
        if (rewardStock !== null && rewardStock < 1) {
          errors.push(`Maaf, "${rewardDisplayName}" sedang habis di cabang yang akan memenuhi pesananmu. Pilih hadiah lain atau lanjut tanpa hadiah.`);
          continue;
        }
        const authoritativeRewardPrice = Number(rewardSpec.reward_price || rewardSpec.amount_in_cents || 0);
        const authoritativeRewardName = bpCheck.name || eligiblePromo.display?.reward_title || 'Hadiah Promo Spesial';
        const catalogRewardPrice = Number(bpCheck.regular_price || bpCheck.price || authoritativeRewardPrice);
        // Architectural Invariant: One campaign identity applies at most once per order
        if (appliedPromos.some(ap => ap.promo_id === authoritativePromoId)) {
          // Promo already applied for this order; ignore/reject duplicate reward lines
          continue;
        }

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
      // FORWARD MENU AUTHORITY:
      // Resolve the exact Master Product through the selected Branch adoption.
      // This deliberately bypasses legacy Branch name/description/image/price
      // overrides for Checkout. The Branch controls availability and stock only.
      const branchMenu = MasterMenuResolver.resolveBranchMenu({
        brandId: brand_id,
        branchId: branch_id,
        productIds: [productId]
      });
      const resolvedMenuProduct = branchMenu.products[0];
      if (!resolvedMenuProduct) {
        const legacyProduct = catalogRepository.findProductForBranch({
          branchId: branch_id,
          productId,
          brandId: brand_id
        });
        const legacyName = legacyProduct && legacyProduct.name ? legacyProduct.name : (item.name || productId);
        if (legacyProduct && legacyProduct.bp_branch_id && legacyProduct.branch_availability !== 0 && legacyProduct.is_active !== 0) {
          errors.push(`Produk "${legacyName}" belum memiliki Master Menu Composition lengkap. Owner perlu melengkapi Master Menu sebelum pesanan dapat diproses.`);
        } else if (legacyProduct && legacyProduct.is_active === 0) {
          errors.push(`Produk "${legacyName}" saat ini dinonaktifkan.`);
        } else if (legacyProduct && legacyProduct.bp_branch_id) {
          errors.push(`Produk "${legacyName}" saat ini dinonaktifkan di cabang ini.`);
        } else {
          errors.push(`Produk "${legacyName}" belum dialokasikan untuk cabang ini.`);
        }
        continue;
      }

      if (!resolvedMenuProduct.is_available) {
        errors.push(`Produk "${resolvedMenuProduct.master.name}" saat ini dinonaktifkan di cabang ini.`);
        continue;
      }
      const currentStock = resolvedMenuProduct.stock_estimate != null ? Number(resolvedMenuProduct.stock_estimate) : 0;
      if (currentStock < requestedQty) {
        errors.push(`Stok produk "${resolvedMenuProduct.master.name}" tidak mencukupi (Tersedia: ${currentStock}, Diminta: ${requestedQty}).`);
        continue;
      }

      const basePrice = Number(resolvedMenuProduct.price || 0);
      let optionResolution;
      try {
        optionResolution = ProductOptionsModel.resolveSelections(
          resolvedMenuProduct.options,
          item.options || item.selected_options || item.modifiers || []
        );
      } catch (optionErr) {
        errors.push(`Pilihan pada produk "${resolvedMenuProduct.master.name}" tidak valid: ${optionErr.message}`);
        continue;
      }

      const actualPrice = basePrice + optionResolution.adjustment;
      const hasExplicitExpectedPrice = item.expected_price !== undefined && item.expected_price !== null && !isNaN(Number(item.expected_price));
      const hasExplicitItemPrice = item.price !== undefined && item.price !== null && !isNaN(Number(item.price));
      if ((hasExplicitExpectedPrice || hasExplicitItemPrice) && expectedPrice !== actualPrice) {
        priceDiffs.push({
          product_id: productId,
          name: resolvedMenuProduct.master.name,
          expected_price: expectedPrice,
          actual_price: actualPrice,
          difference: actualPrice - expectedPrice
        });
      }
      const menuSnapshot = buildMenuSnapshot({
        brandId: brand_id,
        productId
      });

      verifiedItems.push({
        product_id: productId,
        name: resolvedMenuProduct.master.name,
        quantity: requestedQty,
        menu_snapshot: menuSnapshot,
        unit_price: actualPrice,
        base_unit_price: basePrice,
        options: optionResolution.snapshot,
        modifiers_snapshot: optionResolution.snapshot,
        note: String(item.note || item.item_note || '').trim(),
        subtotal: actualPrice * requestedQty,
        current_stock: currentStock,
        branch_low_stock_threshold: resolvedMenuProduct.low_stock_threshold
      });
    }

    if (errors.length > 0) {
      const isOutOfStock = errors.some(e => /stok|habis/i.test(e));
      return {
        status: isOutOfStock ? PrePaymentVerificationGate.STATUS.OUT_OF_STOCK : PrePaymentVerificationGate.STATUS.PRODUCT_UNAVAILABLE,
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
