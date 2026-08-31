/**
 * Xentra Core Domain Registration Model (F2)
 * Structure contract submitted by a domain during self-registration on initialization.
 */
const DomainIdentity = require('./DomainIdentity');
const DomainCapability = require('./DomainCapability');
const DomainLifecycle = require('./DomainLifecycle');

class DomainRegistrationModel {
  constructor({
    identity,
    capabilities = {},
    metadata = {}
  }) {
    if (!identity) {
      throw new Error('[DomainRegistrationModel] Domain "identity" is required.');
    }

    this.identity = identity instanceof DomainIdentity ? identity : new DomainIdentity(identity);
    this.capabilities = capabilities instanceof DomainCapability ? capabilities : new DomainCapability(capabilities);
    this.lifecycle = new DomainLifecycle();
    this.metadata = Object.freeze({ ...metadata });
    this.registered_at = new Date().toISOString();
  }

  toJSON() {
    return {
      identity: this.identity.toJSON(),
      capabilities: this.capabilities.toJSON(),
      state: this.lifecycle.state,
      metadata: this.metadata,
      registered_at: this.registered_at
    };
  }
}

module.exports = DomainRegistrationModel;
