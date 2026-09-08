const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const { DiningTableService, TableRecommendationService } = require('../../domains/pos');
const Template01 = require('../../domains/pos/templates/Template01');

test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_dinein', 'Holding DineIn', 'org-dinein')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_dinein', 'org_dinein', 'Brand DineIn', 'brand-dinein')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_test_dinein_01', 'brand_dinein', 'Cabang DineIn 01', 'cabang-dinein-01', '6281111111', 'Jl. Meja 1', -7.25, 112.75)`).run();
  } catch (e) {
    console.error('DineIn Seed error:', e.message);
  }
});

test('Dine-In Table Floor Plan & DiningTableService Invariants', async (t) => {
  const branchId = 'branch_test_dinein_01';

  await t.test('1. Layout seeding and Template #01 persistence', () => {
    const layout = DiningTableService.initializeBranchLayout(branchId, 'template_01');
    assert.ok(layout);
    assert.strictEqual(layout.branch_id, branchId);
    assert.strictEqual(layout.tables.length, 15);

    // Verify layout can be retrieved with live state
    const retrieved = DiningTableService.getBranchLayout(branchId);
    assert.strictEqual(retrieved.tables.length, 15);
    
    // Check initial status: Meja 1, 3, 6 are initially blocked as per template reference
    const t1 = retrieved.tables.find(t => t.table_number === '1');
    const t2 = retrieved.tables.find(t => t.table_number === '2');
    assert.strictEqual(t1.operational_state, 'blocked');
    assert.strictEqual(t2.operational_state, 'available');
  });

  await t.test('2. Single table recommendation vs Multi-table proximity recommendation', () => {
    const layout = DiningTableService.getBranchLayout(branchId);

    // Guest count 2 => Single table (available table with capacity 4)
    const rec2 = TableRecommendationService.recommendTables({ branch_id: branchId, guest_count: 2, tables: layout.tables });
    assert.ok(rec2);
    assert.strictEqual(rec2.table_ids.length, 1);

    // Guest count 7 => Single table since meja 7, 8, 11 have capacity 8
    const rec7 = TableRecommendationService.recommendTables({ branch_id: branchId, guest_count: 7, tables: layout.tables });
    assert.ok(rec7);
    assert.strictEqual(rec7.table_ids.length, 1);
    assert.ok(rec7.total_capacity >= 7);

    // Guest count 10 => Multi-table combination (closest adjacent tables)
    const rec10 = TableRecommendationService.recommendTables({ branch_id: branchId, guest_count: 10, tables: layout.tables });
    assert.ok(rec10);
    assert.strictEqual(rec10.table_ids.length, 2);
    assert.ok(rec10.total_capacity >= 10);
  });

  await t.test('3. Table hold mechanism & concurrency', () => {
    const layout = DiningTableService.getBranchLayout(branchId);
    // Use available tables: Table 2 and Table 4
    const table2 = layout.tables.find(t => t.table_number === '2');
    const table4 = layout.tables.find(t => t.table_number === '4');

    const holdRef1 = 'ref_hold_order_001';
    const holdResult = DiningTableService.holdTablesForPayment({
      branch_id: branchId,
      table_ids: [table2.id, table4.id],
      hold_reference_id: holdRef1
    });
    assert.strictEqual(holdResult.success, true);
    assert.strictEqual(holdResult.table_ids.length, 2);

    // Verify live state reflection
    const stateAfterHold = DiningTableService.getBranchLayout(branchId);
    const t2State = stateAfterHold.tables.find(t => t.id === table2.id);
    const t4State = stateAfterHold.tables.find(t => t.id === table4.id);
    assert.strictEqual(t2State.operational_state, 'held');
    assert.strictEqual(t4State.operational_state, 'held');

    // Attempting to hold already held table fails
    assert.throws(() => {
      DiningTableService.holdTablesForPayment({
        branch_id: branchId,
        table_ids: [table2.id],
        hold_reference_id: 'ref_hold_order_002'
      });
    }, /CONCURRENCY_HOLD_CONFLICT/);

    // Releasing hold
    DiningTableService.releaseHold({ branch_id: branchId, hold_reference_id: holdRef1, reason: 'test_release' });
    const stateAfterRelease = DiningTableService.getBranchLayout(branchId);
    const t2Released = stateAfterRelease.tables.find(t => t.id === table2.id);
    assert.strictEqual(t2Released.operational_state, 'available');
  });

  await t.test('4. Payment settlement creates active Dining Session mapping multiple tables', () => {
    const layout = DiningTableService.getBranchLayout(branchId);
    // Use available tables with capacity 8: Table 8 and Table 11
    const table8 = layout.tables.find(t => t.table_number === '8');
    const table11 = layout.tables.find(t => t.table_number === '11');

    const holdRef = 'ref_order_pay_settle';
    DiningTableService.holdTablesForPayment({
      branch_id: branchId,
      table_ids: [table8.id, table11.id],
      hold_reference_id: holdRef
    });

    // Create session upon payment
    const sessionRes = DiningTableService.createOrAttachDiningSession({
      branch_id: branchId,
      table_ids: [table8.id, table11.id],
      order_id: 'order_123',
      guest_count: 12,
      customer_name: 'Ahmad',
      hold_reference_id: holdRef
    });

    assert.ok(sessionRes);
    assert.strictEqual(sessionRes.status, 'active');
    assert.strictEqual(sessionRes.table_ids.length, 2);

    // Both tables are now occupied
    const stateAfterSettle = DiningTableService.getBranchLayout(branchId);
    const t8 = stateAfterSettle.tables.find(t => t.id === table8.id);
    const t11 = stateAfterSettle.tables.find(t => t.id === table11.id);
    assert.strictEqual(t8.operational_state, 'occupied');
    assert.strictEqual(t11.operational_state, 'occupied');
    assert.strictEqual(t8.current_session_id, sessionRes.session_id);

    // Dining completion releases tables
    const completed = DiningTableService.completeDiningSession(sessionRes.session_id, 'Staff Checkout');
    assert.strictEqual(completed.status, 'completed');

    const stateAfterComplete = DiningTableService.getBranchLayout(branchId);
    const t8Done = stateAfterComplete.tables.find(t => t.id === table8.id);
    assert.strictEqual(t8Done.operational_state, 'available');
    assert.strictEqual(t8Done.current_session_id, null);
  });

  await t.test('5. QR Code Token resolution and regeneration', () => {
    const layout = DiningTableService.getBranchLayout(branchId);
    const table3 = layout.tables.find(t => t.table_number === '3');

    // Resolve by token
    const resolved = DiningTableService.resolveFromQr(table3.qr_token);
    assert.ok(resolved);
    assert.strictEqual(resolved.id, table3.id);
    assert.strictEqual(resolved.table_number, '3');

    // Regenerate QR
    const oldToken = table3.qr_token;
    const { qr_token: newToken } = DiningTableService.regenerateQrToken(table3.id);
    assert.notStrictEqual(newToken, oldToken);

    // Old token should no longer resolve
    const staleResolved = DiningTableService.resolveFromQr(oldToken);
    assert.strictEqual(staleResolved, null);

    // New token resolves correctly
    const newResolved = DiningTableService.resolveFromQr(newToken);
    assert.strictEqual(newResolved.id, table3.id);
  });

  await t.test('6. Staff operational interventions: block/unblock and reassign', () => {
    const layout = DiningTableService.getBranchLayout(branchId);
    const table4 = layout.tables.find(t => t.table_number === '4');

    // Block table
    DiningTableService.setTableBlockedState(table4.id, true, 'Maintenance');
    let state = DiningTableService.getBranchLayout(branchId);
    let t4 = state.tables.find(t => t.id === table4.id);
    assert.strictEqual(t4.operational_state, 'blocked');

    // Unblock
    DiningTableService.setTableBlockedState(table4.id, false);
    state = DiningTableService.getBranchLayout(branchId);
    t4 = state.tables.find(t => t.id === table4.id);
    assert.strictEqual(t4.operational_state, 'available');

    // Occupy table 4 in a session and reassign to table 5
    const table5 = layout.tables.find(t => t.table_number === '5');
    DiningTableService.holdTablesForPayment({
      branch_id: branchId,
      table_ids: [table4.id],
      hold_reference_id: 'ref_reassign_test'
    });
    const sessionRes = DiningTableService.createOrAttachDiningSession({
      branch_id: branchId,
      table_ids: [table4.id],
      order_id: 'order_reassign',
      guest_count: 2,
      hold_reference_id: 'ref_reassign_test'
    });

    DiningTableService.reassignSessionTables({
      session_id: sessionRes.session_id,
      new_table_ids: [table5.id]
    });
    state = DiningTableService.getBranchLayout(branchId);
    t4 = state.tables.find(t => t.id === table4.id);
    const t5 = state.tables.find(t => t.id === table5.id);
    assert.strictEqual(t4.operational_state, 'available');
    assert.strictEqual(t5.operational_state, 'occupied');
  });
});

