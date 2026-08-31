/**
 * Xentra Core Integration Contract (D1)
 * Stable, normalized request and response contracts for external communications.
 */
class IntegrationContract {
  /**
   * Constructs and validates a normalized outbound integration request.
   */
  static createRequest({
    adapter_name,
    action,
    payload = {},
    target_context = {},
    trace_context = {},
    timeout_ms = 10000
  }) {
    if (!adapter_name || typeof adapter_name !== 'string' || !adapter_name.trim()) {
      throw new Error('[IntegrationContract] "adapter_name" is required.');
    }

    if (!action || typeof action !== 'string' || !action.trim()) {
      throw new Error('[IntegrationContract] "action" is required.');
    }

    return Object.freeze({
      adapter_name: adapter_name.trim(),
      action: action.trim(),
      payload: Object.freeze({ ...payload }),
      target_context: Object.freeze({ ...target_context }),
      trace_context: Object.freeze({
        correlation_id: trace_context.correlation_id || null,
        causation_id: trace_context.causation_id || null,
        actor_id: trace_context.actor_id || null
      }),
      timeout_ms: Number(timeout_ms) || 10000,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Constructs a normalized integration response.
   */
  static createSuccessResponse({ data = null, raw_status = 200, metadata = {} }) {
    return Object.freeze({
      success: true,
      data,
      error: null,
      raw_status,
      metadata: Object.freeze({ ...metadata }),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Constructs a normalized integration failure response.
   */
  static createErrorResponse({ code = 'INTEGRATION_ERROR', message, details = null, raw_status = 500 }) {
    return Object.freeze({
      success: false,
      data: null,
      error: Object.freeze({
        code: code || 'INTEGRATION_ERROR',
        message: message || 'Unknown integration error',
        details
      }),
      raw_status,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = IntegrationContract;
