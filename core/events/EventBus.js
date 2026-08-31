/**
 * Xentra Core Event Bus (A3)
 * Central asynchronous event bus that connects domain publishers and subscribers.
 */
const crypto = require('crypto');
const EventContract = require('./EventContract');
const EventDispatcher = require('./EventDispatcher');
const EventRegistry = require('./EventRegistry');
const EventLogger = require('./EventLogger');

class EventBus {
  constructor() {
    this._subscribers = new Map(); // Map<eventType, Set<{ id, handler, domain }>>
  }

  /**
   * Registers a subscriber listener function for a given event type or wildcard.
   * @param {string} eventType - Event type to listen to (e.g. 'commerce.order.placed' or '*').
   * @param {Function} handler - Async or sync callback (event => void).
   * @param {Object} [options]
   * @param {string} [options.domain='generic'] - Subscribing domain name.
   * @returns {string} Subscription ID (used to unsubscribe).
   */
  subscribe(eventType, handler, options = {}) {
    if (!eventType || typeof eventType !== 'string') {
      throw new Error('[EventBus] "eventType" must be a non-empty string.');
    }
    if (typeof handler !== 'function') {
      throw new Error('[EventBus] "handler" must be a valid function.');
    }

    const type = eventType.trim();
    if (!this._subscribers.has(type)) {
      this._subscribers.set(type, new Set());
    }

    const subId = `sub_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const subRecord = {
      id: subId,
      eventType: type,
      handler,
      domain: options.domain || 'generic'
    };

    this._subscribers.get(type).add(subRecord);
    return subId;
  }

  /**
   * Removes a subscription by its ID.
   * @param {string} subscriptionId
   * @returns {boolean}
   */
  unsubscribe(subscriptionId) {
    for (const [type, subs] of this._subscribers.entries()) {
      for (const sub of subs) {
        if (sub.id === subscriptionId) {
          subs.delete(sub);
          if (subs.size === 0) this._subscribers.delete(type);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Publishes an event to the Event Bus.
   * @param {EventContract|Object} rawEvent
   * @returns {Promise<{ success: boolean, event_id: string, delivered: number, failed: number, errors: Array<Object> }>}
   */
  async publish(rawEvent) {
    let event;
    if (rawEvent instanceof EventContract) {
      event = rawEvent;
    } else {
      event = new EventContract(rawEvent);
    }

    // Verify contract validity
    const validation = EventContract.validate(event);
    if (!validation.valid) {
      const err = new Error(`[EventBus] Invalid Event Contract: ${validation.errors.join(', ')}`);
      EventLogger.log('error', event, { error: err });
      throw err;
    }

    // Log published event
    EventLogger.log('published', event);

    // Collect targeted subscribers + global wildcard subscribers ('*')
    const targetSubs = this._subscribers.get(event.type) || new Set();
    const wildcardSubs = this._subscribers.get('*') || new Set();
    const allSubs = Array.from(new Set([...targetSubs, ...wildcardSubs]));

    // Dispatch asynchronously via EventDispatcher
    const dispatchResult = await EventDispatcher.dispatch(event, allSubs);

    return {
      success: dispatchResult.failed === 0,
      event_id: event.id,
      delivered: dispatchResult.delivered,
      failed: dispatchResult.failed,
      errors: dispatchResult.errors
    };
  }

  /**
   * Clears all subscribers and internal state (for testing).
   */
  clear() {
    this._subscribers.clear();
  }
}

// Default Singleton Event Bus
const defaultEventBus = new EventBus();

module.exports = defaultEventBus;
module.exports.EventBus = EventBus;
