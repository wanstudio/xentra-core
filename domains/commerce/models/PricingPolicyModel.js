/**
 * Xentra Commerce Pricing Policy Model
 * Pure domain model determining effective branch prices based on owner policy:
 * - Mode 'lock': Branch cannot change price (fixed at owner base price).
 * - Mode 'range': Branch price must be within [min_price, max_price].
 */
class PricingPolicyModel {
  static MODES = {
    LOCK: 'lock',
    RANGE: 'range'
  };

  /**
   * Resolves effective product price for a specific branch based on owner policy and branch override.
   * 
   * @param {Object} masterProduct - Master product data from Owner
   * @param {number} masterProduct.price - Owner base price
   * @param {string} [masterProduct.pricing_mode='lock'] - 'lock' | 'range'
   * @param {number} [masterProduct.min_price] - Minimum allowed price
   * @param {number} [masterProduct.max_price] - Maximum allowed price
   * @param {number|null} [branchPrice=null] - Raw price value input from branch
   * @returns {{ effective_price: number, mode: string, is_overridden: boolean }}
   */
  static resolvePrice(masterProduct, branchPrice = null) {
    if (!masterProduct || typeof masterProduct.price !== 'number') {
      throw new Error('[PricingPolicyModel] masterProduct must have a valid numerical price.');
    }

    const basePrice = masterProduct.price;
    const mode = (masterProduct.pricing_mode || PricingPolicyModel.MODES.LOCK).toLowerCase();

    // BRANCH CATALOG ISOLATION: when a concrete branch price is provided (adopted
    // product), it is authoritative. Master price must not silently override it.
    if (typeof branchPrice === 'number' && !isNaN(branchPrice)) {
      if (mode === PricingPolicyModel.MODES.RANGE) {
        const min = typeof masterProduct.min_price === 'number' ? masterProduct.min_price : basePrice;
        const max = typeof masterProduct.max_price === 'number' ? masterProduct.max_price : basePrice;
        if (branchPrice < min || branchPrice > max) {
          throw new Error(`[PricingPolicyModel] Branch price ${branchPrice} is out of allowed range [${min}, ${max}].`);
        }
      }
      return {
        effective_price: branchPrice,
        mode: mode,
        is_overridden: true
      };
    }

    // No branch price set — fall back to master base price.
    // This path is used for brand-wide (Master) catalog and range-mode products
    // that have not yet set a branch override.
    if (mode === PricingPolicyModel.MODES.LOCK) {
      return {
        effective_price: basePrice,
        mode: PricingPolicyModel.MODES.LOCK,
        is_overridden: false
      };
    }

    if (mode === PricingPolicyModel.MODES.RANGE) {
      return {
        effective_price: basePrice,
        mode: PricingPolicyModel.MODES.RANGE,
        is_overridden: false
      };
    }

    throw new Error(`[PricingPolicyModel] Unsupported pricing mode "${mode}".`);
  }
}

module.exports = PricingPolicyModel;
