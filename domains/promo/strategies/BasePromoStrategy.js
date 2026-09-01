/**
 * Xentra Promo Domain — Base Promotion Strategy
 * Abstract interface for all modular promotion strategies.
 */
class BasePromoStrategy {
  constructor(type) {
    this.type = type;
  }

  /**
   * Evaluates if a given promotion rule is applicable to the context.
   * @param {Object} promo - Promotion record from database
   * @param {Object} context - Evaluation context (cart, customer, clientEnv)
   * @returns {{ isApplicable: boolean, reason?: string, reward?: Object }}
   */
  evaluate(promo, context = {}) {
    throw new Error(`Method evaluate() must be implemented by strategy for "${this.type}".`);
  }
}

module.exports = BasePromoStrategy;
