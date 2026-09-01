/**
 * Xentra Promo Domain — Promotion Model
 * Defines promotion entity schema, validation rules, and lifecycle.
 */
class PromotionModel {
  static PROMO_TYPES = {
    INSTALL_INCENTIVE: 'install_incentive',
    COMBO_BUNDLE: 'combo_bundle',
    MIN_SPEND: 'min_spend',
    VOUCHER_CODE: 'voucher_code'
  };

  static REWARD_TYPES = {
    FREEBIE_PRODUCT: 'freebie_product',
    FIXED_PRICE: 'fixed_price',
    FIXED_DISCOUNT: 'fixed_discount',
    PERCENTAGE_DISCOUNT: 'percentage_discount'
  };

  static TARGET_AUDIENCES = {
    ALL: 'all',
    NEW_USER: 'new_user',
    EXISTING_MEMBER: 'existing_member'
  };

  /**
   * Validates a promotion creation/update payload.
   * @param {Object} data
   * @returns {{ isValid: boolean, errors: Array<string> }}
   */
  static validate(data = {}) {
    const errors = [];

    if (!data.brand_id || typeof data.brand_id !== 'string') {
      errors.push('brand_id is required and must be a string.');
    }

    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('name is required.');
    }

    if (!data.promo_type || !Object.values(this.PROMO_TYPES).includes(data.promo_type)) {
      errors.push(`promo_type must be one of: ${Object.values(this.PROMO_TYPES).join(', ')}.`);
    }

    if (data.reward_price !== undefined && data.reward_price !== null) {
      const price = Number(data.reward_price);
      if (isNaN(price) || price < 0) {
        errors.push('reward_price must be a non-negative number (>= 0).');
      }
    }

    if (data.min_spend !== undefined && data.min_spend !== null) {
      const spend = Number(data.min_spend);
      if (isNaN(spend) || spend < 0) {
        errors.push('min_spend must be a non-negative number (>= 0).');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = PromotionModel;
