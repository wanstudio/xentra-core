'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  XentraConnectorClient,
  signRequest,
  SUPPORTED_OPERATIONS,
} = require('../core/integration/XentraConnectorClient');

test('connector client signs typed persistence requests with the locked canonical format', async () => {
  let captured;
  const fakeAxios = async (request) => {
    captured = request;
    return {
      status: 200,
      data: { ok: true, operation: request.data && JSON.parse(request.data).operation },
    };
  };

  const client = new XentraConnectorClient({
    baseUrl: 'https://connector.example.com',
    connectorId: 'bangjo-connector',
    hmacSecret: 'secret',
    axios: fakeAxios,
  });

  const result = await client.getCatalog('branch-1');
  assert.deepEqual(result, { ok: true, operation: SUPPORTED_OPERATIONS.GET_CATALOG_DATA });
  assert.equal(captured.url, 'https://connector.example.com/v1/persistence');
  assert.equal(captured.method, 'POST');
  assert.equal(captured.headers['x-xentra-connector-id'], 'bangjo-connector');

  const payload = captured.data;
  const requestId = captured.headers['x-xentra-request-id'];
  const timestamp = captured.headers['x-xentra-timestamp'];
  const expected = signRequest({
    method: 'POST',
    path: '/v1/persistence',
    timestamp,
    requestId,
    body: payload,
    secret: 'secret',
  });
  assert.equal(captured.headers['x-xentra-signature'], expected);
});

test('connector client surfaces connector errors as typed errors', async () => {
  const client = new XentraConnectorClient({
    baseUrl: 'https://connector.example.com',
    connectorId: 'bangjo-connector',
    hmacSecret: 'secret',
    axios: async () => ({
      status: 409,
      data: { error: 'CONFLICT', message: 'already applied', retryable: false },
    }),
  });

  await assert.rejects(
    () => client.persistOrder({ mutation_id: 'm1', order: { id: 'o1' } }),
    (error) => error.name === 'XentraConnectorError'
      && error.code === 'CONFLICT'
      && error.status === 409
      && error.retryable === false,
  );
});

test('signRequest matches HMAC-SHA256 base64url encoding used by the connector', () => {
  const body = JSON.stringify({ operation: 'catalog.get', input: { branch_id: 'b1' } });
  const expectedCanonical = [
    'POST',
    '/v1/persistence',
    '2026-09-10T00:00:00.000Z',
    'req-1',
    crypto.createHash('sha256').update(body, 'utf8').digest('hex'),
  ].join('\n');
  const expected = crypto.createHmac('sha256', 'secret').update(expectedCanonical, 'utf8').digest('base64url');
  assert.equal(signRequest({
    method: 'POST',
    path: '/v1/persistence',
    timestamp: '2026-09-10T00:00:00.000Z',
    requestId: 'req-1',
    body,
    secret: 'secret',
  }), expected);
});
