/**
 * Xentra Core Event Dispatcher (A5)
 * Dispatches published events to registered subscribers with deterministic execution and error boundaries.
 */
const EventLogger = require('./EventLogger');

class EventDispatcher {
  /**
   * Dispatches an event to an array of subscriber handlers.
   * Ensures that a failure in one subscriber handler does not crash or block others.
   * 
   * @param {Object} event - EventContract instance
   * @param {Array<Object>} subscribers - Array of subscriber records { id, handler, domain }
   * @returns {Promise<{ delivered: number, failed: number, errors: Array<Object> }>}
   */
  static async dispatch(event, subscribers = []) {
    if (!subscribers || subscribers.length === 0) {
      EventLogger.log('dispatched', event, { subscriber_count: 0, note: 'No subscribers registered' });
      return { delivered: 0, failed: 0, errors: [] };
    }

    let delivered = 0;
    let failed = 0;
    const errors = [];

    for (const sub of subscribers) {
      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          await result;
        }
        delivered++;
        EventLogger.log('dispatched', event, { subscriber_id: sub.id, domain: sub.domain });
      } catch (err) {
        failed++;
        const errorRecord = {
          subscriber_id: sub.id,
          domain: sub.domain,
          error: err.message || String(err)
        };
        errors.push(errorRecord);
        EventLogger.log('error', event, { subscriber_id: sub.id, domain: sub.domain, error: err });
      }
    }

    return {
      delivered,
      failed,
      errors
    };
  }
}

module.exports = EventDispatcher;
