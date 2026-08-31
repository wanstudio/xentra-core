/**
 * Xentra Commerce Pricing Policy Model
 * Implements locked Notion rules:
 * 1. Mode 'lock': Branch cannot change price (fixed at owner price).
 * 2. Mode 'range': Owner defines min and max range; branch must set price within [min, max].
 * 3. History preservation: If policy changes to 'lock', old override remains in history but does not apply.
 */
class PricingPolicyModel {
  static MODES = {
    LOCK: 'lock',
    RANGE: 'range'
  };

  /**
   * Resolves effective product price for a specific branch based on owner policy and branch override.
   * 
   * @param {Object} masterProduct - Master product data
   * @param {number} masterProduct.price - Owner base price
   * @param {string} [masterProduct.pricing_mode='lock'] - 'lock' | 'range'
   * @param {number} [masterProduct.min_price] - Minimum allowed price (if mode is 'range')
   * @param {number} [masterProduct.max_price] - Maximum allowed price (if mode is 'range')
   * @param {Object} [branchOverride] - Branch pricing record
   * @param {number} [branchOverride.price] - Price set by branch
   * @returns {{ effective_price: number, mode: string, is_overridden: boolean }}
   */
  static resolvePrice(masterProduct, branchOverride = null) {
    if (!masterProduct || typeof masterProduct.price !== 'number') {
      throw new Error('[PricingPolicyModel] masterProduct must have a valid numerical price.');
    }

    const basePrice = masterProduct.price;
    const mode = masterProduct.pricing_mode || PricingPolicyModel.MODES.LOCK;

    // Mode LOCK: Branch cannot change price. Always returns base price.
    if (mode === PricingPolicyModel.MODES.LOCK) {
      return {
        effective_price: basePrice,
        mode: PricingPolicyModel.MODES.LOCK,
        is_overridden: false
      };
    }

    // Mode RANGE: Branch can set price within min_price and max_price.
    if (mode === PricingPolicyModel.MODES.RANGE) {
      const min = typeof masterProduct.min_price === 'number' ? masterProduct.min_price : basePrice;
      const max = typeof masterProduct.max_price === 'number' ? masterProduct.max_price : basePrice;

      if (branchOverride && typeof branchOverride.price === 'number') {
        const branchPrice = branchOverride.price;
        if (branchPrice < min || branchPrice > max) {
          throw new Error(`[PricingPolicyModel] Branch price ${branchPrice} is out of allowed range [${min}, ${max}].`);
        }
        return {
          effective_price: branchPrice,
          mode: PricingPolicyModel.MODES.RANGE,
          is_overridden: true
        };
      }

      // If branch has not set a price yet in range mode, default to basePrice
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
