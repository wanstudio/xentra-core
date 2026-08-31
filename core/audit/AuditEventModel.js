/**
 * Xentra Core Audit Event Model (E1)
 * Immutable schema representing a discrete, auditable system action.
 */
const crypto = require('crypto');
const ActorTargetContext = require('./ActorTargetContext');
const { SecretBoundary } = require('../integration');

class AuditEventModel {
  constructor({
    audit_id = null,
    action,
    actor,
    target,
    payload_diff = null,
    metadata = {},
    correlation_id = null,
    causation_id = null,
    timestamp = null
  }) {
    if (!action || typeof action !== 'string' || !action.trim()) {
      throw new Error('[AuditEventModel] "action" is required.');
    }

    this.audit_id = audit_id || `aud_${crypto.randomUUID()}`;
    this.action = action.trim();
    this.actor = actor instanceof Object ? ActorTargetContext.createActor(actor) : null;
    this.target = target instanceof Object ? ActorTargetContext.createTarget(target) : null;
    this.payload_diff = payload_diff ? Object.freeze(SecretBoundary.redact(payload_diff)) : null;
    this.metadata = Object.freeze(SecretBoundary.redact(metadata));
    this.correlation_id = correlation_id ? String(correlation_id).trim() : null;
    this.causation_id = causation_id ? String(causation_id).trim() : null;
    this.timestamp = timestamp || new Date().toISOString();

    Object.freeze(this);
  }

  toJSON() {
    return {
      audit_id: this.audit_id,
      action: this.action,
      actor: this.actor,
      target: this.target,
      payload_diff: this.payload_diff,
      metadata: this.metadata,
      correlation_id: this.correlation_id,
      causation_id: this.causation_id,
      timestamp: this.timestamp
    };
  }
}

module.exports = AuditEventModel;
