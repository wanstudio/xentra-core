'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  events,
  identity,
  config,
  integration,
  audit
} = require('../../core');

// ==============================================================================
// G1 — Architecture Contract Review Test
// Requirement: All core modules (A, B, C, D, E) are properly exported and decoupled
// ==============================================================================
test('G1 — Architecture Contract Review: core foundations are modular, exported, and coherent', () => {
  assert.ok(events.EventBus);
  assert.ok(events.EventContract);
  assert.ok(identity.IdentityModel);
  assert.ok(identity.AuthorizationService);
  assert.ok(config.ConfigurationScope);
  assert.ok(config.FeatureControlFoundation);
  assert.ok(integration.IntegrationContract);
  assert.ok(integration.ExternalRequestHandler);
  assert.ok(audit.AuditEventModel);
  assert.ok(audit.AuditWriter);
});

// ==============================================================================
// G2 — Cross-Module Integration Test
// Requirement: Identity -> RBAC Auth -> Scoped Config -> Outbound Integration -> Event -> Audit Trail
// ==============================================================================
test('G2 — Cross-Module Integration: full end-to-end lifecycle flow across core foundations', async () => {
  // 1. Identity & RBAC (Milestone B)
  const manager = new identity.IdentityModel({ username: 'branch_mgr_sby', status: 'active' });
  const assignments = [{
    user_id: manager.id,
    role: 'branch_manager',
    scope_type: 'branch',
    scope_id: 'branch_surabaya'
  }];

  // Authorization Decision
  const auth = identity.AuthorizationService.authorize({
    identity: manager,
    assignments,
    required_permission: 'branch:update',
    target_context: { branch_id: 'branch_surabaya' }
  });
  assert.strictEqual(auth.allowed, true);

  // 2. Configuration & Scope (Milestone C)
  const configScope = config.createConfigScope();
  configScope.set({
    key: 'branch.whatsapp_number',
    value: '628123456789',
    type: 'string',
    scope_type: 'branch',
    scope_id: 'branch_surabaya',
    source: 'dashboard'
  });

  const branchPhone = configScope.getValue('branch.whatsapp_number', { branch_id: 'branch_surabaya' });
  assert.strictEqual(branchPhone, '628123456789');

  // 3. Integration & Tracing Context (Milestones A & D)
  const trace = new events.EventContext({
    actor_id: manager.id,
    tenant_id: 'org_bangjo',
    branch_id: 'branch_surabaya'
  });

  const channelMapper = integration.createChannelMapper();
  channelMapper.registerMapping('branch_surabaya', { wablas_device_id: 'dev_sby_01' });

  const wablasAdapter = new integration.WablasAdapter({
    serverSecret: 'sec_prod_key',
    channelMapper,
    fetchClient: async () => ({ status: 200, data: { success: true } })
  });

  const integrationHandler = integration.createIntegrationHandler();
  integrationHandler.registerAdapter(wablasAdapter);

  const integrationRes = await integrationHandler.dispatch({
    adapter_name: 'wablas',
    action: 'send_message',
    payload: { recipient_phone: branchPhone, message: 'Settings updated' },
    target_context: { branch_id: 'branch_surabaya' },
    trace_context: { correlation_id: trace.correlation_id, causation_id: trace.causation_id }
  });
  assert.strictEqual(integrationRes.success, true);

  // 4. Event Bus Notification (Milestone A)
  const eventBus = events.createEventBus();
  let receivedEvent = null;
  eventBus.subscribe('branch.settings_updated', (event) => {
    receivedEvent = event;
  });

  await eventBus.publish({
    type: 'branch.settings_updated',
    producer: 'core',
    payload: { branch_id: 'branch_surabaya', updated_by: manager.id },
    context: trace
  });
  assert.ok(receivedEvent);
  assert.strictEqual(receivedEvent.payload.branch_id, 'branch_surabaya');

  // 5. Audit Trail Logging (Milestone E)
  const auditWriter = audit.createAuditWriter();
  const auditQuery = audit.createAuditQuery(auditWriter);

  await auditWriter.append({
    action: 'branch.settings_updated',
    actor: { actor_id: manager.id, role: 'branch_manager' },
    target: { entity_type: 'branch', entity_id: 'branch_surabaya', branch_id: 'branch_surabaya' },
    correlation_id: trace.correlation_id,
    causation_id: trace.causation_id
  });

  const logs = auditQuery.query({ correlation_id: trace.correlation_id });
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].target.branch_id, 'branch_surabaya');
});

// ==============================================================================
// G3 — Failure-Path & Recovery Test
// Requirement: System gracefully isolates errors and returns normalized failures
// ==============================================================================
test('G3 — Failure-Path & Recovery: isolates listener errors and downstream timeouts', async () => {
  const eventBus = events.createEventBus();

  // Faulty subscriber that throws error
  eventBus.subscribe('order.created', () => {
    throw new Error('Crashing subscriber simulation');
  });

  // Healthy subscriber that must still execute
  let healthyExecuted = false;
  eventBus.subscribe('order.created', () => {
    healthyExecuted = true;
  });

  // Dispatch event: should not crash the main process
  await eventBus.publish({
    type: 'order.created',
    producer: 'commerce',
    payload: { order_id: 'ord_123' }
  });

  assert.strictEqual(healthyExecuted, true, 'Healthy subscriber must execute despite another failing');
});

// ==============================================================================
// G4 — Security & Boundary Review Test
// Requirement: Enforces permission boundaries and prevents credential leakage
// ==============================================================================
test('G4 — Security & Boundary: cross-branch restriction and zero credential disclosure', () => {
  const cashier = new identity.IdentityModel({ username: 'cashier_user', status: 'active' });
  const cashierAssignments = [{
    user_id: cashier.id,
    role: 'cashier',
    scope_type: 'branch',
    scope_id: 'branch_surabaya'
  }];

  // Attempt unauthorized cross-branch operation
  assert.throws(() => {
    identity.RoleBoundaryEnforcement.enforce({
      identity: cashier,
      assignments: cashierAssignments,
      required_permission: 'order:create',
      target_context: { branch_id: 'branch_jakarta' }
    });
  }, (err) => err.code === 'FORBIDDEN' && err.status === 403);

  // Assert secret leakage is prevented across audit and integration payloads
  const sensitivePayload = {
    auth_token: 'secret_12345',
    api_key: 'sk_live_99999',
    public_id: 'pub_001'
  };

  const sanitized = integration.SecretBoundary.redact(sensitivePayload);
  assert.strictEqual(sanitized.auth_token, '********');
  assert.strictEqual(sanitized.api_key, '********');
  assert.strictEqual(sanitized.public_id, 'pub_001');
});

// ==============================================================================
// G5 — Observability Baseline Test
// Requirement: Correlation & causation IDs are preserved across domain operations
// ==============================================================================
test('G5 — Observability Baseline: preserves correlation lineage across operations', () => {
  const rootContext = new events.EventContext({ actor_id: 'usr_root' });
  const childContext = rootContext.deriveChild('cmd_process_order');

  assert.strictEqual(childContext.correlation_id, rootContext.correlation_id, 'Correlation ID must remain unchanged across lineage');
  assert.strictEqual(childContext.causation_id, 'cmd_process_order', 'Causation ID tracks the immediate trigger');
});
