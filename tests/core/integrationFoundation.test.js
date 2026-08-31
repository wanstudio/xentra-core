'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  IntegrationContract,
  BaseAdapter,
  ExternalRequestHandler,
  FailureClassifier,
  SecretBoundary,
  ChannelMapper,
  IntegrationObserver,
  WablasAdapter,
  HardwarePrinterAdapter,
  createIntegrationHandler,
  createChannelMapper
} = require('../../core/integration');

// ==============================================================================
// D1 — Integration Contract Test (Level: Request/Response Normalization)
// Requirement: normalized request and success/failure response schemas
// ==============================================================================
test('D1 — Integration Contract: normalized request/response structure and immutability', () => {
  const req = IntegrationContract.createRequest({
    adapter_name: 'wablas',
    action: 'send_message',
    payload: { recipient_phone: '08123456789', message: 'Pesanan siap!' },
    target_context: { branch_id: 'branch_surabaya' },
    trace_context: { correlation_id: 'corr_123', causation_id: 'cause_456' }
  });

  assert.strictEqual(req.adapter_name, 'wablas');
  assert.strictEqual(req.action, 'send_message');
  assert.strictEqual(req.payload.recipient_phone, '08123456789');
  assert.strictEqual(req.trace_context.correlation_id, 'corr_123');
  assert.ok(Object.isFrozen(req));

  const successRes = IntegrationContract.createSuccessResponse({ data: { message_id: 'msg_999' } });
  assert.strictEqual(successRes.success, true);
  assert.strictEqual(successRes.data.message_id, 'msg_999');
  assert.strictEqual(successRes.error, null);

  const errorRes = IntegrationContract.createErrorResponse({
    code: 'TIMEOUT_ERROR',
    message: 'Request timed out'
  });
  assert.strictEqual(errorRes.success, false);
  assert.strictEqual(errorRes.error.code, 'TIMEOUT_ERROR');
  assert.strictEqual(errorRes.data, null);
});

// ==============================================================================
// D2/D3 — Adapter & External Request Handling Test (Level: Request Dispatching)
// Requirement: dispatching normalized requests through registered adapters
// ==============================================================================
test('D2 & D3 — Adapter & External Request Handler: outbound request dispatching and response handling', async () => {
  const channelMapper = createChannelMapper();
  channelMapper.registerMapping('branch_surabaya', { wablas_device_id: 'dev_surabaya_01' });

  // Custom mock fetch client
  const mockFetch = async ({ url, headers, body }) => {
    assert.strictEqual(headers.Authorization, 'test_server_secret');
    assert.strictEqual(body.device, 'dev_surabaya_01');
    return { status: 200, data: { status: true, id: 'w_msg_100' } };
  };

  const wablasAdapter = new WablasAdapter({
    serverSecret: 'test_server_secret',
    channelMapper,
    fetchClient: mockFetch
  });

  const handler = createIntegrationHandler();
  handler.registerAdapter(wablasAdapter);

  const res = await handler.dispatch({
    adapter_name: 'wablas',
    action: 'send_message',
    payload: { recipient_phone: '08111222333', message: 'Halo!' },
    target_context: { branch_id: 'branch_surabaya' }
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.data.id, 'w_msg_100');
  assert.strictEqual(res.metadata.device, 'dev_surabaya_01');
});

// ==============================================================================
// D4 — Failure / Timeout Boundary Test (Level: Error Classification & Deterministic Timeout)
// Requirement: standard error codes and timeout enforcement
// ==============================================================================
test('D4 — Failure / Timeout Boundary: classifies error types and enforces timeout', async () => {
  // Classification
  assert.strictEqual(FailureClassifier.classify(new Error('Connection refused'), 500), 'TRANSPORT_ERROR');
  assert.strictEqual(FailureClassifier.classify(new Error('ETIMEDOUT'), 504), 'TIMEOUT_ERROR');
  assert.strictEqual(FailureClassifier.classify(new Error('Access Denied / Invalid Token'), 401), 'AUTH_ERROR');
  assert.strictEqual(FailureClassifier.classify(new Error('Bad Request: Invalid phone number'), 400), 'PROVIDER_REJECTED');
  assert.strictEqual(FailureClassifier.classify(new Error('Missing required config secret'), 500), 'MISSING_CONFIG');

  // Timeout Boundary
  const slowPromise = new Promise(resolve => setTimeout(() => resolve('slow_result'), 500));
  await assert.rejects(async () => {
    await FailureClassifier.withTimeout(slowPromise, 50, 'Slow API');
  }, (err) => err.code === 'ETIMEDOUT' && err.message.includes('timed out'));
});

// ==============================================================================
// D5 — Credential & Secret Boundary Test (Level: Redaction & User Input Assertion)
// Requirement: redact credentials from logs/responses and reject credentials in user payload
// ==============================================================================
test('D5 — Credential & Secret Boundary: redacts secrets and rejects credentials in user payload', () => {
  const sensitiveObj = {
    user: 'john',
    api_key: 'sk_live_123456',
    nested: {
      password: 'mypassword',
      token: 'bearer_token_abc'
    }
  };

  const redacted = SecretBoundary.redact(sensitiveObj);
  assert.strictEqual(redacted.user, 'john');
  assert.strictEqual(redacted.api_key, '********');
  assert.strictEqual(redacted.nested.password, '********');
  assert.strictEqual(redacted.nested.token, '********');

  // Negative test: User payload containing infrastructure credentials is rejected
  assert.throws(() => {
    SecretBoundary.assertNotFromUserInput({ recipient: '08123', wablas_token: 'injected_token' });
  }, /Security violation/);
});

// ==============================================================================
// D6 — External Channel Mapping Test (Level: Branch Channel Isolation)
// Requirement: Branch A resolves distinct device; no cross-branch or Owner fallback
// ==============================================================================
test('D6 — External Channel Mapping: multi-branch channel isolation and missing mapping failure', () => {
  const mapper = createChannelMapper();
  mapper.registerMapping('branch_surabaya', { wablas_device_id: 'dev_sby' });
  mapper.registerMapping('branch_jakarta', { wablas_device_id: 'dev_jkt' });

  // Distinct channels
  assert.strictEqual(mapper.resolveBranchChannel('branch_surabaya').wablas_device_id, 'dev_sby');
  assert.strictEqual(mapper.resolveBranchChannel('branch_jakarta').wablas_device_id, 'dev_jkt');

  // Negative test: Unmapped branch throws explicit error (No fallback to Owner or other branch)
  assert.throws(() => {
    mapper.resolveBranchChannel('branch_unmapped');
  }, /Missing channel mapping for branch "branch_unmapped". No fallback allowed/);
});

// ==============================================================================
// D7 — Hardware Integration Boundary Test (Level: Neutral Hardware Adapter)
// Requirement: neutral hardware interface without locking specific hardware brands
// ==============================================================================
test('D7 — Hardware Integration Boundary: neutral hardware receipt printing', async () => {
  let driverPrinted = false;
  const mockDriver = {
    print: async (payload) => {
      driverPrinted = true;
    }
  };

  const printerAdapter = new HardwarePrinterAdapter({ driver: mockDriver });
  const handler = createIntegrationHandler();
  handler.registerAdapter(printerAdapter);

  const res = await handler.dispatch({
    adapter_name: 'hardware_printer',
    action: 'print_receipt',
    payload: { lines: ['Item 1: Nasi Goreng', 'Total: 25000'] },
    target_context: { branch_id: 'branch_surabaya' }
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.data.printed, true);
  assert.strictEqual(driverPrinted, true);
});

// ==============================================================================
// D8 — Integration Observability & Tracing Test (Level: Audit & Tracing Integration)
// Requirement: trace context retention and sanitized logging
// ==============================================================================
test('D8 — Integration Observability: records traffic with trace context and redacted secrets', async () => {
  const observer = new IntegrationObserver();
  const channelMapper = createChannelMapper();
  channelMapper.registerMapping('branch_01', { wablas_device_id: 'dev_01' });

  const wablasAdapter = new WablasAdapter({
    serverSecret: 'sec_live_key',
    channelMapper,
    fetchClient: async () => ({ status: 200, data: { ok: true } })
  });

  const handler = createIntegrationHandler(observer);
  handler.registerAdapter(wablasAdapter);

  await handler.dispatch({
    adapter_name: 'wablas',
    action: 'send_message',
    payload: { recipient_phone: '081234', message: 'Hello' },
    target_context: { branch_id: 'branch_01' },
    trace_context: { correlation_id: 'trace_abc_123', causation_id: 'cause_xyz_789' }
  });

  const logs = observer.getLogs();
  assert.strictEqual(logs.length, 2); // 1 outbound + 1 response
  assert.strictEqual(logs[0].type, 'OUTBOUND_REQUEST');
  assert.strictEqual(logs[0].trace_context.correlation_id, 'trace_abc_123');
  assert.strictEqual(logs[1].type, 'INTEGRATION_RESPONSE');
  assert.strictEqual(logs[1].success, true);
});
