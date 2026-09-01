/**
 * Xentra Promotion Domain — Conflict & Stacking Resolver
 * Decides which evaluated promotions can be applied simultaneously or strictly exclusively.
 */
class ConflictResolver {
  /**
   * Resolves stacking conflicts among evaluated promotions.
   * 
   * Rule Priority:
   * 1. Sort by Priority Weight (Higher = first).
   * 2. If an exclusive promo is selected, it blocks any other exclusive promos.
   * 3. Combinable promos can stack alongside other combinable promos.
   * 
   * @param {Array<Object>} candidatePromotions - List of promotions that passed eligibility
   * @returns {{ applied: Array<Object>, rejected: Array<{ promo_id: string, reason: string }> }}
   */
  static resolve(candidatePromotions = []) {
    if (!Array.isArray(candidatePromotions) || candidatePromotions.length === 0) {
      return { applied: [], rejected: [] };
    }

    // Sort descending by priority_weight
    const sorted = [...candidatePromotions].sort((a, b) => {
      return (b.priority_weight || 100) - (a.priority_weight || 100);
    });

    const applied = [];
    const rejected = [];
    let hasExclusiveApplied = false;

    for (const promo of sorted) {
      const isExclusive = promo.stacking_policy === 'exclusive';

      if (isExclusive) {
        if (hasExclusiveApplied || applied.length > 0) {
          rejected.push({
            promo_id: promo.id || promo.promo_id,
            reason: 'Promotion is exclusive and cannot be stacked with existing applied promotions.'
          });
          continue;
        }
        applied.push(promo);
        hasExclusiveApplied = true;
      } else {
        // Combinable
        if (hasExclusiveApplied) {
          rejected.push({
            promo_id: promo.id || promo.promo_id,
            reason: 'Cannot stack with an already applied exclusive promotion.'
          });
          continue;
        }
        applied.push(promo);
      }
    }

    return { applied, rejected };
  }
}

module.exports = ConflictResolver;
