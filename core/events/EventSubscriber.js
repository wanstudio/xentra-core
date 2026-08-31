/**
 * Xentra Core Event Subscriber (A4)
 * Domain-scoped subscription manager for subscribing and binding event handlers.
 */
const defaultEventBus = require('./EventBus');

class EventSubscriber {
  /**
   * Constructs an EventSubscriber instance scoped to a specific consumer domain.
   * @param {string} consumerDomain - Domain name (e.g. 'pos', 'reporting', 'integration', 'inventory').
   * @param {Object} [bus=defaultEventBus] - Optional custom EventBus instance.
   */
  constructor(consumerDomain, bus = defaultEventBus) {
    if (!consumerDomain || typeof consumerDomain !== 'string') {
      throw new Error('[EventSubscriber] "consumerDomain" must be a non-empty string.');
    }
    this.domain = consumerDomain.trim().toLowerCase();
    this.bus = bus;
    this._subscriptions = new Set();
  }

  /**
   * Subscribes to a given event type with a handler callback.
   * @param {string} eventType - Event type to listen for (e.g., 'commerce.order.placed' or '*').
   * @param {Function} handler - Callback function (event => Promise<void>|void).
   * @returns {string} Subscription ID.
   */
  on(eventType, handler) {
    const subId = this.bus.subscribe(eventType, handler, { domain: this.domain });
    this._subscriptions.add(subId);
    return subId;
  }

  /**
   * Subscribes to an event for exactly one invocation.
   * @param {string} eventType
   * @param {Function} handler
   * @returns {string}
   */
  once(eventType, handler) {
    let subId = null;
    const wrappedHandler = async (event) => {
      try {
        await handler(event);
      } finally {
        if (subId) {
          this.off(subId);
        }
      }
    };

    subId = this.on(eventType, wrappedHandler);
    return subId;
  }

  /**
   * Unsubscribes a specific subscription.
   * @param {string} subscriptionId
   * @returns {boolean}
   */
  off(subscriptionId) {
    const success = this.bus.unsubscribe(subscriptionId);
    if (success) {
      this._subscriptions.delete(subscriptionId);
    }
    return success;
  }

  /**
   * Unsubscribes all handlers registered by this subscriber instance.
   */
  clear() {
    for (const subId of this._subscriptions) {
      this.bus.unsubscribe(subId);
    }
    this._subscriptions.clear();
  }
}

module.exports = EventSubscriber;
