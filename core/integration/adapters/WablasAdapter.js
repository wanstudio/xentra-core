/**
 * Xentra Core Wablas Messaging Adapter (D2 / D3)
 * Implements WhatsApp messaging transport via Wablas API.
 */
const BaseAdapter = require('../BaseAdapter');
const IntegrationContract = require('../IntegrationContract');
const FailureClassifier = require('../FailureClassifier');
const SecretBoundary = require('../SecretBoundary');
const axios = require('axios');

class WablasAdapter extends BaseAdapter {
  /**
   * @param {Object} options
   * @param {string} [options.serverSecret] - Wablas API Key from server environment
   * @param {Object} [options.channelMapper] - ChannelMapper instance
   * @param {Function} [options.fetchClient] - Custom HTTP client for testing/injection
   */
  constructor({ serverSecret, channelMapper, fetchClient = null } = {}) {
    super('wablas');
    this.serverSecret = serverSecret || null;
    this.channelMapper = channelMapper || null;
    this.fetchClient = fetchClient;
  }

  /**
   * Sends a message via Wablas.
   */
  async execute(request) {
    // 1. Secret & Input assertions
    SecretBoundary.assertNotFromUserInput(request.payload);

    if (!this.serverSecret) {
      return IntegrationContract.createErrorResponse({
        code: FailureClassifier.ERROR_CODES.MISSING_CONFIG,
        message: 'Missing Wablas server secret in runtime environment.'
      });
    }

    const { action, payload, target_context } = request;

    if (action !== 'send_message') {
      return IntegrationContract.createErrorResponse({
        code: FailureClassifier.ERROR_CODES.PROVIDER_REJECTED,
        message: `Unsupported action "${action}" for Wablas adapter.`
      });
    }

    // 2. Resolve Branch Channel
    let channel;
    try {
      if (!this.channelMapper) {
        throw new Error('ChannelMapper is not configured in WablasAdapter.');
      }
      channel = this.channelMapper.resolveBranchChannel(target_context.branch_id);
    } catch (err) {
      return IntegrationContract.createErrorResponse({
        code: FailureClassifier.ERROR_CODES.MISSING_CONFIG,
        message: err.message
      });
    }

    // 3. Dispatch outbound request with timeout
    try {
      const executeHttp = async () => {
        const wablasUrl = process.env.WABLAS_API_URL || 'https://kudus.wablas.com/api/send-message';

        // fetchClient injection is used by tests; production always uses axios
        if (this.fetchClient) {
          return await this.fetchClient({
            url: wablasUrl,
            method: 'POST',
            headers: {
              Authorization: this.serverSecret
            },
            body: {
              phone: payload.recipient_phone,
              message: payload.message,
              device: channel.wablas_device_id
            }
          });
        }

        // Production path: real HTTP POST to Wablas via axios (built-in project dependency)
        console.log(`[WABLAS_REQUEST_STARTED] phone=${String(payload.recipient_phone || '').replace(/(\d{4})\d+(\d{2})/, '$1******$2')} device=${channel.wablas_device_id} url=${wablasUrl}`);
        const axiosRes = await axios.post(
          wablasUrl,
          {
            phone: payload.recipient_phone,
            message: payload.message,
            device: channel.wablas_device_id
          },
          {
            headers: { Authorization: this.serverSecret },
            validateStatus: () => true,
            timeout: request.timeout_ms || 10000
          }
        );
        console.log(`[WABLAS_RESPONSE_STATUS] status=${axiosRes.status}`);
        return { status: axiosRes.status, data: axiosRes.data };
      };

      const rawRes = await FailureClassifier.withTimeout(executeHttp(), request.timeout_ms, 'Wablas send_message');

      if (rawRes.status >= 200 && rawRes.status < 300) {
        return IntegrationContract.createSuccessResponse({
          data: rawRes.data,
          raw_status: rawRes.status,
          metadata: { device: channel.wablas_device_id }
        });
      }

      const code = FailureClassifier.classify(rawRes.data, rawRes.status);
      return IntegrationContract.createErrorResponse({
        code,
        message: rawRes.data?.message || 'Wablas API error',
        raw_status: rawRes.status
      });
    } catch (err) {
      const code = FailureClassifier.classify(err);
      return IntegrationContract.createErrorResponse({
        code,
        message: err.message
      });
    }
  }
}

module.exports = WablasAdapter;
