/**
 * Xentra Core Secret Boundary (D5)
 * Sanitizes credentials from outputs/logs, prevents user input credentials, and asserts secure sources.
 */
class SecretBoundary {
  static SENSITIVE_KEYS = [
    'secret',
    'token',
    'password',
    'api_key',
    'server_key',
    'client_secret',
    'authorization',
    'bearer'
  ];

  /**
   * Recursively redacts sensitive keys from an object or error before logging/returning.
   */
  static redact(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => SecretBoundary.redact(item));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      const isSensitive = SecretBoundary.SENSITIVE_KEYS.some(k => lower.includes(k));

      if (isSensitive && value) {
        sanitized[key] = '********';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = SecretBoundary.redact(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Asserts that infrastructure secrets originate strictly from secure runtime/environment,
   * never from end-user or business payloads.
   */
  static assertNotFromUserInput(payload) {
    if (!payload || typeof payload !== 'object') return;

    for (const [key, val] of Object.entries(payload)) {
      const lower = key.toLowerCase();
      if (SecretBoundary.SENSITIVE_KEYS.some(k => lower.includes(k))) {
        throw new Error(`[SecretBoundary] Security violation: Infrastructure credential "${key}" must not be supplied via user/business payload.`);
      }
    }
  }
}

module.exports = SecretBoundary;
