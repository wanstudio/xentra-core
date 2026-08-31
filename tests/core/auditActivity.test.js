'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  AuditLogRecord,
  AuditProcessEngine,
  AuditWriter,
  AuditQueryFoundation,
  AuditRetentionBoundary,
  createAuditWriter,
  createAuditEngine,
  createAuditQuery
} = require('../../core/audit');

// ==============================================================================
// E1 — Audit Log Record Model Test (Level: Context & Schema Completeness)
// Requirement: Audit Log records the investigation process, auditor, audited period, branch, and evidence
// ==============================================================================
test('E1 — Audit Log Record Model: creates comprehensive audit process record and redacts secrets', () => {
  const auditRecord = new AuditLogRecord({
    audit_type: 'revenue_reconciliation',
    auditor: { auditor_id: 'usr_internal_auditor_01', name: 'Internal Auditor A', role: 'internal_auditor' },
    audit_period: { start_time: '2026-08-01T00:00:00Z', end_time: '2026-08-31T23:59:59Z' },
    target: {
      organization_id: 'org_bangjo',
      branch_id: 'branch_surabaya',
      branch_manager_in_charge: 'usr_mgr_surabaya'
    },
    inspected_area: 'Cash & QRIS Transaction Settlements',
    evidence_references: ['tx_settle_101', 'tx_settle_102', 'syslog_batch_99'],
    status: 'discrepancy_found',
    findings: 'Found Rp 50,000 variance between POS totals and payment gateway receipts.',
    metadata: {
      gateway_secret: 'midtrans_sec_999', // Must be redacted
      notes: 'Investigated by request of Owner'
    }
  });

  assert.ok(auditRecord.audit_id.startsWith('aud_'));
  assert.strictEqual(auditRecord.audit_type, 'revenue_reconciliation');
  assert.strictEqual(auditRecord.auditor.name, 'Internal Auditor A');
  assert.strictEqual(auditRecord.target.branch_manager_in_charge, 'usr_mgr_surabaya');
  assert.strictEqual(auditRecord.evidence_references.length, 3);
  assert.strictEqual(auditRecord.status, 'discrepancy_found');
  assert.ok(Object.isFrozen(auditRecord));

  // Sanitization check: Sensitive tokens in metadata must be redacted
  assert.strictEqual(auditRecord.metadata.gateway_secret, '********');
  assert.strictEqual(auditRecord.metadata.notes, 'Investigated by request of Owner');

  // Negative test: Missing audit_type or auditor throws error
  assert.throws(() => new AuditLogRecord({ audit_type: '', auditor: { auditor_id: 'u1' }, inspected_area: 'Test' }), /"audit_type" is required/);
  assert.throws(() => new AuditLogRecord({ audit_type: 'tax_audit', auditor: null, inspected_area: 'Test' }), /"auditor" context/);
});

// ==============================================================================
// E2 — Audit Process on Evidence Test (Level: Investigation Process Execution)
// Requirement: Audit Process examines Business/System Log evidence and generates Audit Log
// ==============================================================================
test('E2 — Audit Process Engine: examines evidence pool (Business Logs & System Records) into Audit Log', async () => {
  const writer = createAuditWriter();
  const engine = createAuditEngine(writer);

  // Evidence pool from Business Log / Transaction Records
  const evidencePool = [
    { id: 'tx_01', type: 'order.payment_settled', amount: 150000 },
    { id: 'tx_02', type: 'order.payment_settled', amount: 85000 },
    { id: 'log_01', type: 'cashier.drawer_closed', total_cash: 235000 }
  ];

  // Perform Audit Investigation
  const auditResult = await engine.performAudit({
    audit_type: 'shift_closing_reconciliation',
    auditor: { auditor_id: 'usr_auditor_02', name: 'Branch Supervisor' },
    audit_period: { start_time: '2026-08-31T08:00:00Z', end_time: '2026-08-31T16:00:00Z' },
    target: { branch_id: 'branch_surabaya', branch_manager_in_charge: 'usr_mgr_surabaya' },
    inspected_area: 'Shift 1 Cash Drawer & Transactions',
    evidence_pool: evidencePool,
    inspector_fn: async (evidence) => {
      const txSum = evidence.filter(e => e.amount).reduce((acc, curr) => acc + curr.amount, 0);
      const drawerTotal = evidence.find(e => e.total_cash)?.total_cash || 0;
      const isMatch = txSum === drawerTotal;
      return {
        status: isMatch ? 'completed' : 'discrepancy_found',
        findings: isMatch ? 'All shift records balanced' : `Discrepancy: ${drawerTotal - txSum}`
      };
    }
  });

  assert.strictEqual(auditResult.status, 'completed');
  assert.strictEqual(auditResult.findings, 'All shift records balanced');
  assert.strictEqual(auditResult.evidence_references.length, 3);
  assert.strictEqual(writer.getRecords().length, 1);
});

// ==============================================================================
// E3 — Audit Writer Test (Level: Append-Only Integrity)
// Requirement: appends audit process logs and strictly rejects mutations (update/delete)
// ==============================================================================
test('E3 — Audit Writer: append-only persistence and mutation prevention', async () => {
  const writer = createAuditWriter();

  const auditRecord = new AuditLogRecord({
    audit_type: 'inventory_loss_audit',
    auditor: { auditor_id: 'usr_auditor_01' },
    inspected_area: 'Raw Material Warehouse',
    target: { branch_id: 'branch_jakarta' },
    status: 'action_required',
    findings: 'Found missing 5kg chicken stock.'
  });

  await writer.append(auditRecord);
  assert.strictEqual(writer.getRecords().length, 1);

  // Negative tests: Attempting update or delete throws explicit mutation error
  assert.throws(() => writer.update(), /Mutation forbidden: Audit records are strictly append-only/);
  assert.throws(() => writer.delete(), /Mutation forbidden: Audit records are strictly append-only/);
});

// ==============================================================================
// E4 — Audit Query Foundation Test (Level: Query & Retrieval by Audit Context)
// Requirement: filter audit records by auditor, branch, audit_type, or status
// ==============================================================================
test('E4 — Audit Query Foundation: filters audit process records by context', async () => {
  const writer = createAuditWriter();
  const queryEngine = createAuditQuery(writer);

  await writer.append(new AuditLogRecord({
    audit_type: 'revenue_audit',
    auditor: { auditor_id: 'usr_auditor_sby' },
    target: { branch_id: 'branch_sby' },
    inspected_area: 'Revenue'
  }));

  await writer.append(new AuditLogRecord({
    audit_type: 'inventory_audit',
    auditor: { auditor_id: 'usr_auditor_jkt' },
    target: { branch_id: 'branch_jkt' },
    inspected_area: 'Inventory'
  }));

  // Query by branch
  const sbyLogs = queryEngine.query({ branch_id: 'branch_sby' });
  assert.strictEqual(sbyLogs.length, 1);
  assert.strictEqual(sbyLogs[0].audit_type, 'revenue_audit');

  // Query by auditor
  const jktAudits = queryEngine.query({ actor_id: 'usr_auditor_jkt' });
  assert.strictEqual(jktAudits.length, 1);
  assert.strictEqual(jktAudits[0].inspected_area, 'Inventory');
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
