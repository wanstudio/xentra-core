/**
 * Xentra Promotion Domain — Base Promotion Strategy Interface
 */
class BasePromotionStrategy {
  constructor(capabilityType) {
    this.capabilityType = capabilityType;
  }

  /**
   * Evaluates eligibility and calculates benefit for this promotion strategy.
   * @param {Object} promotion - Normalized promotion entity with rules and rewards
   * @param {Object} context - Transaction evaluation context (customer, cart, device, channel)
   * @returns {{ isEligible: boolean, reason?: string, display?: Object, reward?: Object }}
   */
  evaluate(promotion, context = {}) {
    throw new Error(`evaluate() must be implemented by strategy for "${this.capabilityType}".`);
  }
}

module.exports = BasePromotionStrategy;
