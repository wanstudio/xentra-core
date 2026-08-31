/**
 * Xentra Core Event Registry (A6)
 * Central catalog for authorized event types, schemas, and versioning.
 */
class EventRegistry {
  constructor() {
    this._registry = new Map();
  }

  /**
   * Registers a recognized event definition in the registry.
   * @param {Object} definition
   * @param {string} definition.type - Unique event type name.
   * @param {string} [definition.version='1.0.0'] - Event version.
   * @param {string} definition.producer - Producing domain.
   * @param {string} [definition.description] - Human readable description.
   * @param {Function} [definition.validator] - Optional payload validator function (payload => boolean).
   */
  register({ type, version = '1.0.0', producer, description = '', validator = null }) {
    if (!type || typeof type !== 'string') {
      throw new Error('[EventRegistry] "type" must be a non-empty string.');
    }
    if (!producer || typeof producer !== 'string') {
      throw new Error('[EventRegistry] "producer" must be a non-empty string.');
    }

    const key = `${type.trim()}@${version.trim()}`;
    this._registry.set(key, {
      type: type.trim(),
      version: version.trim(),
      producer: producer.trim().toLowerCase(),
      description,
      validator,
      registered_at: new Date().toISOString()
    });
  }

  /**
   * Checks if an event type and version is registered.
   * @param {string} type
   * @param {string} [version='1.0.0']
   * @returns {boolean}
   */
  isRegistered(type, version = '1.0.0') {
    const key = `${type.trim()}@${version.trim()}`;
    return this._registry.has(key);
  }

  /**
   * Retrieves definition for an event.
   * @param {string} type
   * @param {string} [version='1.0.0']
   * @returns {Object|null}
   */
  get(type, version = '1.0.0') {
    const key = `${type.trim()}@${version.trim()}`;
    return this._registry.get(key) || null;
  }

  /**
   * Lists all registered event definitions.
   * @returns {Array<Object>}
   */
  list() {
    return Array.from(this._registry.values());
  }

  /**
   * Clears all registered events (used primarily in test cleanup).
   */
  clear() {
    this._registry.clear();
  }
}

// Singleton default registry instance
const defaultRegistry = new EventRegistry();

// Register Reference ping event for testing & infrastructure health checks
defaultRegistry.register({
  type: 'core.reference.ping',
  version: '1.0.0',
  producer: 'core',
  description: 'Reference event used to verify Event Infrastructure pipelines end-to-end.'
});

module.exports = defaultRegistry;
module.exports.EventRegistry = EventRegistry;
