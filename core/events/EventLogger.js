/**
 * Xentra Core Event Logger / Audit Foundation (A8)
 * Provides centralized audit and diagnostics for event publishing, delivery, and errors.
 */
class EventLogger {
  constructor() {
    this._inMemoryLogs = [];
    this._maxLogs = 1000;
  }

  /**
   * Records an event lifecycle action.
   * @param {'published'|'dispatched'|'error'|'registered'} stage
   * @param {Object} event - EventContract instance or plain event
   * @param {Object} [details] - Additional execution context / error
   */
  log(stage, event, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      stage,
      event_id: event?.id,
      event_type: event?.type,
      producer: event?.producer,
      correlation_id: event?.context?.correlation_id,
      details: details.error ? { error: details.error.message || String(details.error) } : details
    };

    this._inMemoryLogs.push(entry);
    if (this._inMemoryLogs.length > this._maxLogs) {
      this._inMemoryLogs.shift();
    }

    if (process.env.DEBUG_EVENTS === 'true') {
      console.log(`[EventLogger:${stage.toUpperCase()}]`, JSON.stringify(entry));
    }
  }

  /**
   * Retrieves logged activity for inspection / test verification.
   * @param {string} [eventId]
   * @returns {Array<Object>}
   */
  getLogs(eventId = null) {
    if (!eventId) return [...this._inMemoryLogs];
    return this._inMemoryLogs.filter(l => l.event_id === eventId);
  }

  /**
   * Clears internal log buffer.
   */
  clear() {
    this._inMemoryLogs = [];
  }
}

const defaultLogger = new EventLogger();

module.exports = defaultLogger;
module.exports.EventLogger = EventLogger;
