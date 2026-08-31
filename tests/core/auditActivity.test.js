'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  AuditEventModel,
  ActorTargetContext,
  AuditWriter,
  AuditQueryFoundation,
  AuditRetentionBoundary,
  createAuditWriter,
  createAuditQuery
} = require('../../core/audit');

// ==============================================================================
// E1 — Audit Event Model Test (Level: Model & Sanitization)
// Requirement: structured audit event model with automatic secret redaction
// ==============================================================================
test('E1 — Audit Event Model: creates immutable audit records and redacts secrets', () => {
  const audit = new AuditEventModel({
    action: 'branch.update_settings',
    actor: { actor_id: 'usr_owner_01', role: 'owner', actor_type: 'user' },
    target: { entity_type: 'branch', entity_id: 'branch_surabaya', branch_id: 'branch_surabaya' },
    payload_diff: {
      pickup_time: 15,
      wablas_token: 'super_secret_token_123'
    },
    metadata: {
      gateway_secret: 'midtrans_sec_999',
      reason: 'Standard update'
    },
    correlation_id: 'corr_trace_001',
    causation_id: 'cause_cmd_002'
  });

  assert.ok(audit.audit_id.startsWith('aud_'));
  assert.strictEqual(audit.action, 'branch.update_settings');
  assert.strictEqual(audit.correlation_id, 'corr_trace_001');
  assert.strictEqual(audit.causation_id, 'cause_cmd_002');
  assert.ok(Object.isFrozen(audit));

  // Sanitization check: Sensitive tokens in payload_diff and metadata must be redacted
  assert.strictEqual(audit.payload_diff.wablas_token, '********');
  assert.strictEqual(audit.payload_diff.pickup_time, 15);
  assert.strictEqual(audit.metadata.gateway_secret, '********');
  assert.strictEqual(audit.metadata.reason, 'Standard update');

  // Negative test: Missing action throws error
  assert.throws(() => new AuditEventModel({ action: '' }), /"action" is required/);
});

// ==============================================================================
// E2 — Actor & Target Context Test (Level: Normalization)
// Requirement: standard actor & target context creation and validation
// ==============================================================================
test('E2 — Actor & Target Context: normalizes actor and target entity context', () => {
  // Actor context
  const actor = ActorTargetContext.createActor({
    actor_id: 'usr_cashier_01',
    actor_type: 'user',
    role: 'cashier',
    ip_address: '192.168.1.50',
    user_agent: 'Mozilla/5.0'
  });
  assert.strictEqual(actor.actor_id, 'usr_cashier_01');
  assert.strictEqual(actor.role, 'cashier');
  assert.ok(Object.isFrozen(actor));

  assert.throws(() => ActorTargetContext.createActor({ actor_id: '' }), /"actor_id" is required/);
  assert.throws(() => ActorTargetContext.createActor({ actor_id: 'u1', actor_type: 'invalid_type' }), /Invalid actor_type/);

  // Target context
  const target = ActorTargetContext.createTarget({
    entity_type: 'order',
    entity_id: 'ord_12345',
    branch_id: 'branch_surabaya'
  });
  assert.strictEqual(target.entity_type, 'order');
  assert.strictEqual(target.entity_id, 'ord_12345');
  assert.strictEqual(target.branch_id, 'branch_surabaya');
  assert.ok(Object.isFrozen(target));

  assert.throws(() => ActorTargetContext.createTarget({ entity_type: '', entity_id: 'ord_1' }), /"entity_type" is required/);
});

// ==============================================================================
// E3 — Audit Writer Test (Level: Append-Only Integrity)
// Requirement: appends audit events and strictly rejects mutations (update/delete)
// ==============================================================================
test('E3 — Audit Writer: append-only persistence and mutation prevention', async () => {
  let savedToDb = false;
  const mockStorage = {
    saveAudit: async (record) => {
      savedToDb = true;
    }
  };

  const writer = createAuditWriter(mockStorage);

  const event = await writer.append({
    action: 'order.cancel',
    actor: { actor_id: 'usr_mgr_01', role: 'branch_manager' },
    target: { entity_type: 'order', entity_id: 'ord_999' }
  });

  assert.strictEqual(event.action, 'order.cancel');
  assert.strictEqual(writer.getRecords().length, 1);
  assert.strictEqual(savedToDb, true);

  // Negative tests: Attempting update or delete throws explicit mutation error
  assert.throws(() => writer.update(), /Mutation forbidden: Audit records are strictly append-only/);
  assert.throws(() => writer.delete(), /Mutation forbidden: Audit records are strictly append-only/);
});

// ==============================================================================
// E4 — Audit Query Foundation Test (Level: Query & Filtering Engine)
// Requirement: filter audit trail by actor, action, target, branch, or trace ID
// ==============================================================================
test('E4 — Audit Query Foundation: filters audit events accurately', async () => {
  const writer = createAuditWriter();
  const queryEngine = createAuditQuery(writer);

  await writer.append({
    action: 'order.create',
    actor: { actor_id: 'usr_cust_01' },
    target: { entity_type: 'order', entity_id: 'ord_01', branch_id: 'branch_sby' },
    correlation_id: 'trace_001'
  });

  await writer.append({
    action: 'order.refund',
    actor: { actor_id: 'usr_mgr_01' },
    target: { entity_type: 'order', entity_id: 'ord_01', branch_id: 'branch_sby' },
    correlation_id: 'trace_002'
  });

  await writer.append({
    action: 'branch.update',
    actor: { actor_id: 'usr_owner_01' },
    target: { entity_type: 'branch', entity_id: 'branch_jkt', branch_id: 'branch_jkt' },
    correlation_id: 'trace_003'
  });

  // Query by branch
  const sbyLogs = queryEngine.query({ branch_id: 'branch_sby' });
  assert.strictEqual(sbyLogs.length, 2);

  // Query by action
  const refundLogs = queryEngine.query({ action: 'order.refund' });
  assert.strictEqual(refundLogs.length, 1);
  assert.strictEqual(refundLogs[0].actor.actor_id, 'usr_mgr_01');

  // Query by correlation ID
  const traceLogs = queryEngine.query({ correlation_id: 'trace_003' });
  assert.strictEqual(traceLogs.length, 1);
  assert.strictEqual(traceLogs[0].action, 'branch.update');
});

// ==============================================================================
// E5 — Retention / Data Boundary Test (Level: Pruning Policy)
// Requirement: time-based pruning without breaking immutability
// ==============================================================================
test('E5 — Retention Boundary: prunes expired audit records based on retention days', () => {
  const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago
  const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago

  const records = [
    { audit_id: 'aud_old', timestamp: oldDate },
    { audit_id: 'aud_recent', timestamp: recentDate }
  ];

  const retained = AuditRetentionBoundary.prune(records, 90); // 90 days retention
  assert.strictEqual(retained.length, 1);
  assert.strictEqual(retained[0].audit_id, 'aud_recent');
});
