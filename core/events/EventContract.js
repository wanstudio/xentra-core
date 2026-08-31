/**
 * Xentra Core Event Contract (A1)
 * Enforces unified event schema, serialization, and strict payload validation.
 */
const crypto = require('crypto');
const EventContext = require('./EventContext');

class EventContract {
  /**
   * Constructs an immutable Event Contract instance.
   * @param {Object} params
   * @param {string} [params.id] - Unique Event ID (defaults to UUIDv4).
   * @param {string} params.type - Event type/name (e.g., 'core.reference.ping', 'commerce.order.placed').
   * @param {string} [params.version] - Event schema version (defaults to '1.0.0').
   * @param {string} params.producer - Domain / component producer name (e.g., 'core', 'commerce', 'payment').
   * @param {Object} [params.context] - Tracing & tenant context (EventContext instance or plain object).
   * @param {Object} [params.payload] - Specific event payload data.
   * @param {string} [params.timestamp] - ISO-8601 UTC timestamp.
   */
  constructor({
    id,
    type,
    version = '1.0.0',
    producer,
    context = {},
    payload = {},
    timestamp
  }) {
    if (!type || typeof type !== 'string' || !type.trim()) {
      throw new Error('[EventContract] Event "type" is required and must be a non-empty string.');
    }

    if (!producer || typeof producer !== 'string' || !producer.trim()) {
      throw new Error('[EventContract] Event "producer" is required and must be a non-empty string.');
    }

    if (payload === null || typeof payload !== 'object') {
      throw new Error('[EventContract] Event "payload" must be a valid object.');
    }

    this.id = id || crypto.randomUUID();
    this.type = type.trim();
    this.version = String(version || '1.0.0').trim();
    this.producer = producer.trim().toLowerCase();
    this.context = context instanceof EventContext ? context.toJSON() : new EventContext(context).toJSON();
    this.payload = Object.freeze({ ...payload });
    this.timestamp = timestamp || new Date().toISOString();

    Object.freeze(this);
  }

  /**
   * Validates if an object satisfies the minimum Xentra Event Contract.
   * @param {Object} event
   * @returns {{ valid: boolean, errors: string[] }}
   */
  static validate(event) {
    const errors = [];
    if (!event) {
      return { valid: false, errors: ['Event object is null or undefined.'] };
    }

    if (!event.id || typeof event.id !== 'string') errors.push('Missing or invalid "id".');
    if (!event.type || typeof event.type !== 'string') errors.push('Missing or invalid "type".');
    if (!event.version || typeof event.version !== 'string') errors.push('Missing or invalid "version".');
    if (!event.producer || typeof event.producer !== 'string') errors.push('Missing or invalid "producer".');
    if (!event.timestamp || typeof event.timestamp !== 'string') errors.push('Missing or invalid "timestamp".');
    if (!event.payload || typeof event.payload !== 'object') errors.push('Missing or invalid "payload".');
    if (!event.context || typeof event.context !== 'object') errors.push('Missing or invalid "context".');

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Serializes the event to a plain JSON object.
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      version: this.version,
      producer: this.producer,
      timestamp: this.timestamp,
      context: this.context,
      payload: this.payload
    };
  }

  /**
   * Factory method to deserialize an event from JSON or raw object.
   * @param {string|Object} input
   * @returns {EventContract}
   */
  static from(input) {
    const raw = typeof input === 'string' ? JSON.parse(input) : input;
    return new EventContract(raw);
  }
}

module.exports = EventContract;
