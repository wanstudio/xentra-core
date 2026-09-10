'use strict';

const crypto = require('node:crypto');
const axios = require('axios');

const SUPPORTED_OPERATIONS = Object.freeze({
  GET_BRANCH_OPERATIONAL_DATA: 'branch.get_operational_data',
  GET_CATALOG_DATA: 'catalog.get',
  GET_INVENTORY_AVAILABILITY: 'inventory.get_availability',
  PERSIST_ORDER: 'order.persist',
});

class XentraConnectorError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'XentraConnectorError';
    Object.assign(this, details);
  }
}

function signRequest({ method, path, timestamp, requestId, body, secret }) {
  const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${requestId}\n${bodyHash}`;
  return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('base64url');
}

function assertConfig(config) {
  for (const field of ['baseUrl', 'connectorId', 'hmacSecret']) {
    if (typeof config[field] !== 'string' || config[field].trim() === '') {
      throw new XentraConnectorError(`Missing connector configuration: ${field}`);
    }
  }
}

class XentraConnectorClient {
  constructor(config = {}) {
    this.config = {
      baseUrl: String(config.baseUrl || process.env.XENTRA_CONNECTOR_URL || '').replace(/\/$/, ''),
      connectorId: config.connectorId || process.env.XENTRA_CONNECTOR_ID || '',
      hmacSecret: config.hmacSecret || process.env.XENTRA_CONNECTOR_HMAC_SECRET || '',
      contractVersion: config.contractVersion || process.env.XENTRA_CONTRACT_VERSION || 'v1',
      timeoutMs: Number(config.timeoutMs || process.env.XENTRA_CONNECTOR_TIMEOUT_MS || 10000),
      axios: config.axios || axios,
    };
    assertConfig(this.config);
    if (!Number.isFinite(this.config.timeoutMs) || this.config.timeoutMs < 1000) {
      throw new XentraConnectorError('Invalid connector timeout');
    }
  }

  async negotiate(requestedVersions = [this.config.contractVersion]) {
    return this.#request('/v1/contract/negotiate', {
      requested_versions: requestedVersions,
    });
  }

  async getBranchOperationalData(branchId) {
    return this.#operation(SUPPORTED_OPERATIONS.GET_BRANCH_OPERATIONAL_DATA, { branch_id: branchId });
  }

  async getCatalog(branchId) {
    return this.#operation(SUPPORTED_OPERATIONS.GET_CATALOG_DATA, { branch_id: branchId });
  }

  async getInventoryAvailability(branchId) {
    return this.#operation(SUPPORTED_OPERATIONS.GET_INVENTORY_AVAILABILITY, { branch_id: branchId });
  }

  async persistOrder(input) {
    return this.#operation(SUPPORTED_OPERATIONS.PERSIST_ORDER, input);
  }

  async #operation(operation, input) {
    return this.#request('/v1/persistence', { operation, input });
  }

  async #request(path, payload) {
    const body = JSON.stringify(payload);
    const method = 'POST';
    const timestamp = new Date().toISOString();
    const requestId = crypto.randomUUID();
    const signature = signRequest({
      method,
      path,
      timestamp,
      requestId,
      body,
      secret: this.config.hmacSecret,
    });

    try {
      const response = await this.config.axios({
        method,
        url: `${this.config.baseUrl}${path}`,
        data: body,
        timeout: this.config.timeoutMs,
        headers: {
          'content-type': 'application/json',
          'x-xentra-connector-id': this.config.connectorId,
          'x-xentra-request-id': requestId,
          'x-xentra-timestamp': timestamp,
          'x-xentra-signature': signature,
        },
        validateStatus: () => true,
      });

      const data = response.data;
      if (response.status >= 200 && response.status < 300) return data;

      throw new XentraConnectorError(
        data && data.message ? data.message : `Connector request failed with HTTP ${response.status}`,
        {
          code: data && (data.error || data.code) ? (data.error || data.code) : 'CONNECTOR_REQUEST_FAILED',
          status: response.status,
          retryable: Boolean(data && data.retryable),
          requestId,
        },
      );
    } catch (error) {
      if (error instanceof XentraConnectorError) throw error;
      const code = error && error.code ? error.code : 'CONNECTOR_UNAVAILABLE';
      throw new XentraConnectorError('Connector unavailable', {
        code,
        retryable: true,
        requestId,
        cause: error,
      });
    }
  }
}

module.exports = {
  SUPPORTED_OPERATIONS,
  XentraConnectorError,
  XentraConnectorClient,
  signRequest,
};
