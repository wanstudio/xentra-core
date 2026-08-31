/**
 * Xentra Core External Request Handler (D3)
 * Unified router for outbound integration requests across registered adapters.
 */
const IntegrationContract = require('./IntegrationContract');
const FailureClassifier = require('./FailureClassifier');
const SecretBoundary = require('./SecretBoundary');

class ExternalRequestHandler {
  constructor(observer = null) {
    this._adapters = new Map(); // adapter_name -> BaseAdapter
    this.observer = observer;
  }

  registerAdapter(adapter) {
    if (!adapter || !adapter.name) {
      throw new Error('[ExternalRequestHandler] Invalid adapter.');
    }
    this._adapters.set(adapter.name, adapter);
  }

  /**
   * Dispatches a normalized request to the appropriate adapter.
   */
  async dispatch(rawRequest) {
    // 1. Build and validate request contract
    const request = rawRequest instanceof Object && rawRequest.adapter_name && rawRequest.action
      ? IntegrationContract.createRequest(rawRequest)
      : rawRequest;

    const adapter = this._adapters.get(request.adapter_name);
    if (!adapter) {
      const errRes = IntegrationContract.createErrorResponse({
        code: FailureClassifier.ERROR_CODES.PROVIDER_REJECTED,
        message: `Adapter "${request.adapter_name}" is not registered in integration handler.`
      });
      return errRes;
    }

    // 2. Trace and observe outbound dispatch
    if (this.observer) {
      this.observer.logOutbound(request);
    }

    // 3. Execute through adapter
    let response;
    try {
      response = await adapter.execute(request);
    } catch (err) {
      response = IntegrationContract.createErrorResponse({
        code: FailureClassifier.classify(err),
        message: err.message
      });
    }

    // 4. Trace and observe inbound response
    if (this.observer) {
      this.observer.logResponse(request, response);
    }

    return response;
  }
}

module.exports = ExternalRequestHandler;
