/**
 * Xentra Core Domain Capability (F3)
 * Declares capabilities, produced/consumed events, and permissions for a domain.
 */
class DomainCapability {
  constructor({
    events_produced = [],
    events_consumed = [],
    permissions_required = [],
    features_provided = []
  } = {}) {
    this.events_produced = Object.freeze([...(Array.isArray(events_produced) ? events_produced : [])]);
    this.events_consumed = Object.freeze([...(Array.isArray(events_consumed) ? events_consumed : [])]);
    this.permissions_required = Object.freeze([...(Array.isArray(permissions_required) ? permissions_required : [])]);
    this.features_provided = Object.freeze([...(Array.isArray(features_provided) ? features_provided : [])]);

    Object.freeze(this);
  }

  toJSON() {
    return {
      events_produced: this.events_produced,
      events_consumed: this.events_consumed,
      permissions_required: this.permissions_required,
      features_provided: this.features_provided
    };
  }
}

module.exports = DomainCapability;
