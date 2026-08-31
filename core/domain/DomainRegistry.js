/**
 * Xentra Core Domain Registry (F5)
 * Central catalog recording and validating registered domains via self-registration.
 */
const DomainRegistrationModel = require('./DomainRegistrationModel');
const DomainLifecycle = require('./DomainLifecycle');

class DomainRegistry {
  constructor() {
    this._domains = new Map(); // domain_name -> DomainRegistrationModel
  }

  /**
   * Registers a domain via self-registration.
   * @param {Object|DomainRegistrationModel} registration - Domain registration data
   * @returns {DomainRegistrationModel}
   */
  register(registration) {
    const regModel = registration instanceof DomainRegistrationModel
      ? registration
      : new DomainRegistrationModel(registration);

    const domainName = regModel.identity.name;

    // Duplicate registration check
    if (this._domains.has(domainName)) {
      const existing = this._domains.get(domainName);
      if (existing.identity.version !== regModel.identity.version) {
        throw new Error(`[DomainRegistry] Version mismatch: Domain "${domainName}" is already registered at v${existing.identity.version}. Attempted v${regModel.identity.version}.`);
      }
      // Re-registration with same version updates metadata and preserves lifecycle
      regModel.lifecycle = existing.lifecycle;
    } else {
      // By default, a newly registered domain is activated
      regModel.lifecycle.activate();
    }

    this._domains.set(domainName, regModel);
    return regModel;
  }

  /**
   * Retrieves registration data for a domain.
   * @param {string} domainName
   * @returns {DomainRegistrationModel|null}
   */
  getDomain(domainName) {
    if (!domainName) return null;
    return this._domains.get(domainName.trim().toLowerCase()) || null;
  }

  /**
   * Checks if a domain is registered and currently active.
   * @param {string} domainName
   * @returns {boolean}
   */
  isDomainActive(domainName) {
    const d = this.getDomain(domainName);
    return d ? d.lifecycle.isActive() : false;
  }

  /**
   * Lists all registered domains.
   * @param {Object} [filter] - Optional filter { active_only: boolean }
   * @returns {Array<Object>}
   */
  listDomains(filter = {}) {
    const results = [];
    for (const model of this._domains.values()) {
      if (filter.active_only && !model.lifecycle.isActive()) {
        continue;
      }
      results.push(model.toJSON());
    }
    return results;
  }

  /**
   * Updates lifecycle state of a registered domain.
   * @param {string} domainName
   * @param {string} targetState - 'active' | 'disabled' | 'error'
   * @param {string} [reason]
   */
  setDomainState(domainName, targetState, reason = '') {
    const model = this.getDomain(domainName);
    if (!model) {
      throw new Error(`[DomainRegistry] Domain "${domainName}" is not registered.`);
    }

    switch (targetState) {
      case DomainLifecycle.STATES.ACTIVE:
        model.lifecycle.activate();
        break;
      case DomainLifecycle.STATES.DISABLED:
        model.lifecycle.disable(reason);
        break;
      case DomainLifecycle.STATES.ERROR:
        model.lifecycle.markError(reason);
        break;
      default:
        throw new Error(`[DomainRegistry] Unsupported target state "${targetState}".`);
    }
  }

  /**
   * Clears all registered domains (for testing).
   */
  clear() {
    this._domains.clear();
  }
}

// Singleton instance
const defaultDomainRegistry = new DomainRegistry();

module.exports = defaultDomainRegistry;
module.exports.DomainRegistry = DomainRegistry;
