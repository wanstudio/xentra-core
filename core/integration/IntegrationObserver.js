/**
 * Xentra Core Integration Observer & Tracing (D8)
 * Connects correlation/causation tracing metadata and logs sanitized integration traffic.
 */
const SecretBoundary = require('./SecretBoundary');

class IntegrationObserver {
  constructor(eventLogger = null) {
    this.eventLogger = eventLogger;
    this._trafficLog = [];
  }

  /**
   * Records an outbound request lifecycle event.
   */
  logOutbound(request) {
    const entry = {
      type: 'OUTBOUND_REQUEST',
      adapter: request.adapter_name,
      action: request.action,
      trace_context: request.trace_context,
      sanitized_payload: SecretBoundary.redact(request.payload),
      timestamp: new Date().toISOString()
    };

    this._trafficLog.push(entry);
    if (this.eventLogger && typeof this.eventLogger.log === 'function') {
      this.eventLogger.log('integration.request_dispatched', entry);
    }
  }

  /**
   * Records an integration response event.
   */
  logResponse(request, response) {
    const entry = {
      type: 'INTEGRATION_RESPONSE',
      adapter: request.adapter_name,
      action: request.action,
      success: response.success,
      trace_context: request.trace_context,
      sanitized_response: SecretBoundary.redact(response),
      timestamp: new Date().toISOString()
    };

    this._trafficLog.push(entry);
    if (this.eventLogger && typeof this.eventLogger.log === 'function') {
      this.eventLogger.log(response.success ? 'integration.response_received' : 'integration.error_received', entry);
    }
  }

  getLogs() {
    return [...this._trafficLog];
  }

  clear() {
    this._trafficLog = [];
  }
}

module.exports = IntegrationObserver;
