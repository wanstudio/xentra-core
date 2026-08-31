/**
 * Xentra Core Event Context & Metadata (A7)
 * Provides metadata for distributed tracing, correlation, and causal lineage across domains.
 */
const crypto = require('crypto');

class EventContext {
  /**
   * Creates a standardized Event Context.
   * @param {Object} [params]
   * @param {string} [params.correlation_id] - Distributed trace ID across transaction chains.
   * @param {string} [params.causation_id] - The ID of the event that directly caused this event.
   * @param {string} [params.actor_id] - User / System / Machine ID that initiated the action.
   * @param {string} [params.actor_type] - 'user' | 'system' | 'merchant' | 'customer' | 'webhook'.
   * @param {string} [params.tenant_id] - Organization / Brand identifier.
   * @param {string} [params.branch_id] - Branch identifier (if applicable).
   */
  constructor(params = {}) {
    this.correlation_id = params.correlation_id || EventContext.generateId('corr');
    this.causation_id = params.causation_id || null;
    this.actor_id = params.actor_id || 'system';
    this.actor_type = params.actor_type || 'system';
    this.tenant_id = params.tenant_id || null;
    this.branch_id = params.branch_id || null;
  }

  /**
   * Helper to generate standardized random IDs.
   * @param {string} prefix
   * @returns {string}
   */
  static generateId(prefix = 'evt') {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
  }

  /**
   * Derives a child context from an existing event context (preserving correlation_id, updating causation_id).
   * @param {EventContext|Object} parentContext
   * @param {string} parentEventId
   * @param {Object} [overrides]
   * @returns {EventContext}
   */
  static deriveChild(parentContext, parentEventId, overrides = {}) {
    return new EventContext({
      correlation_id: parentContext?.correlation_id || EventContext.generateId('corr'),
      causation_id: parentEventId,
      actor_id: overrides.actor_id || parentContext?.actor_id,
      actor_type: overrides.actor_type || parentContext?.actor_type,
      tenant_id: overrides.tenant_id || parentContext?.tenant_id,
      branch_id: overrides.branch_id || parentContext?.branch_id,
      ...overrides
    });
  }

  toJSON() {
    return {
      correlation_id: this.correlation_id,
      causation_id: this.causation_id,
      actor_id: this.actor_id,
      actor_type: this.actor_type,
      tenant_id: this.tenant_id,
      branch_id: this.branch_id
    };
  }
}

module.exports = EventContext;
