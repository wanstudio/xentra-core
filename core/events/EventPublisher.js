/**
 * Xentra Core Event Publisher (A2)
 * Clean, domain-scoped API for emitting events into the Event Bus.
 */
const defaultEventBus = require('./EventBus');
const EventContract = require('./EventContract');
const EventContext = require('./EventContext');

class EventPublisher {
  /**
   * Constructs an EventPublisher instance scoped to a specific producer domain.
   * @param {string} producerDomain - Domain name (e.g. 'commerce', 'pos', 'payment', 'inventory', 'core').
   * @param {Object} [bus=defaultEventBus] - Optional custom EventBus instance.
   */
  constructor(producerDomain, bus = defaultEventBus) {
    if (!producerDomain || typeof producerDomain !== 'string') {
      throw new Error('[EventPublisher] "producerDomain" must be a non-empty string.');
    }
    this.producer = producerDomain.trim().toLowerCase();
    this.bus = bus;
  }

  /**
   * Emits an event with the producer domain automatically attached.
   * 
   * @param {string} eventType - Event type name (e.g. 'order.placed', 'payment.settled').
   * @param {Object} payload - Event payload object.
   * @param {Object|EventContext} [context] - Tracing & tenant context.
   * @param {Object} [options]
   * @param {string} [options.version='1.0.0'] - Event schema version.
   * @returns {Promise<{ success: boolean, event_id: string, delivered: number, failed: number }>}
   */
  async emit(eventType, payload = {}, context = {}, options = {}) {
    const event = new EventContract({
      type: eventType,
      producer: this.producer,
      version: options.version || '1.0.0',
      payload,
      context
    });

    return await this.bus.publish(event);
  }

  /**
   * Static helper for one-off emissions.
   * @param {string} producer
   * @param {string} eventType
   * @param {Object} payload
   * @param {Object} [context]
   * @returns {Promise<Object>}
   */
  static async publish(producer, eventType, payload, context) {
    const publisher = new EventPublisher(producer);
    return await publisher.emit(eventType, payload, context);
  }
}

module.exports = EventPublisher;
