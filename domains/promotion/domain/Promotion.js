/**
 * Xentra Promotion Domain — Core Promotion Entity
 */
class Promotion {
  constructor({
    id,
    brand_id,
    name,
    code = null,
    capability_type,
    stacking_policy = 'exclusive', // 'exclusive' | 'combinable' | 'priority_override'
    priority_weight = 100,
    max_redemptions_total = null,
    max_redemptions_per_customer = 1,
    start_at = null,
    end_at = null,
    is_active = 1,
    rules = [],
    rewards = []
  }) {
    this.id = id;
    this.brand_id = brand_id;
    this.name = name;
    this.code = code;
    this.capability_type = capability_type;
    this.stacking_policy = stacking_policy;
    this.priority_weight = Number(priority_weight || 100);
    this.max_redemptions_total = max_redemptions_total !== null ? Number(max_redemptions_total) : null;
    this.max_redemptions_per_customer = Number(max_redemptions_per_customer || 1);
    this.start_at = start_at;
    this.end_at = end_at;
    this.is_active = is_active === 1 || is_active === true ? 1 : 0;
    this.rules = rules;
    this.rewards = rewards;
  }

  isExclusive() {
    return this.stacking_policy === 'exclusive';
  }

  isCombinable() {
    return this.stacking_policy === 'combinable';
  }
}

module.exports = Promotion;
