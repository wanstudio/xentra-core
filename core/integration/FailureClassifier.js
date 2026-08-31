/**
 * Xentra Core Failure Classifier & Timeout Boundary (D4)
 * Normalizes provider/transport errors and enforces deterministic timeout boundaries.
 */
const IntegrationContract = require('./IntegrationContract');

class FailureClassifier {
  static ERROR_CODES = {
    TRANSPORT_ERROR: 'TRANSPORT_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    AUTH_ERROR: 'AUTH_ERROR',
    PROVIDER_REJECTED: 'PROVIDER_REJECTED',
    INVALID_RESPONSE: 'INVALID_RESPONSE',
    MISSING_CONFIG: 'MISSING_CONFIG'
  };

  /**
   * Classifies an arbitrary raw error/status into a standardized integration error code.
   */
  static classify(error, rawStatus = 500) {
    if (!error) return FailureClassifier.ERROR_CODES.TRANSPORT_ERROR;

    const msg = (error.message || String(error)).toUpperCase();
    const code = (error.code || '').toUpperCase();

    if (code === 'ETIMEDOUT' || msg.includes('TIMEOUT') || msg.includes('ETIMEDOUT') || code === 'ESOCKETTIMEDOUT' || rawStatus === 504 || rawStatus === 408) {
      return FailureClassifier.ERROR_CODES.TIMEOUT_ERROR;
    }

    if (rawStatus === 401 || rawStatus === 403 || msg.includes('UNAUTHORIZED') || msg.includes('ACCESS DENIED') || msg.includes('INVALID SECRET') || msg.includes('API KEY')) {
      return FailureClassifier.ERROR_CODES.AUTH_ERROR;
    }

    if (msg.includes('MISSING') && (msg.includes('CONFIG') || msg.includes('SECRET') || msg.includes('CHANNEL') || msg.includes('MAPPING'))) {
      return FailureClassifier.ERROR_CODES.MISSING_CONFIG;
    }

    if (rawStatus >= 400 && rawStatus < 500) {
      return FailureClassifier.ERROR_CODES.PROVIDER_REJECTED;
    }

    if (msg.includes('INVALID JSON') || msg.includes('UNEXPECTED TOKEN')) {
      return FailureClassifier.ERROR_CODES.INVALID_RESPONSE;
    }

    return FailureClassifier.ERROR_CODES.TRANSPORT_ERROR;
  }

  /**
   * Executes a promise with an enforced deterministic timeout.
   */
  static async withTimeout(promise, timeoutMs = 10000, operationName = 'Operation') {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`[TimeoutBoundary] ${operationName} timed out after ${timeoutMs}ms.`);
        err.code = 'ETIMEDOUT';
        reject(err);
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
}

module.exports = FailureClassifier;
