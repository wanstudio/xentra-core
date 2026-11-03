const test = require('node:test');
const assert = require('node:assert');
const db = require('../server/database/db.js');
const EligibilityService = require('../domains/commerce/services/EligibilityService');
const { BranchRepository } = require('../core/data/repositories');

test('BRANCH EMERGENCY SWITCH (3-MODE GOVERNANCE) SUITE', async (t) => {
  const brandId = 'brand_test_governance_' + Date.now();
  const branchId = 'branch_gov_' + Date.now();

  // Seed test brand & branch
  db.prepare(`
    INSERT OR REPLACE INTO brands (id, organization_id, name, slug)
    VALUES (?, 'org_xentra_holding', 'Test Brand Governance', 'test-brand-gov')
  `).run(brandId);

  db.prepare(`
    INSERT OR REPLACE INTO branches (
      id, brand_id, name, slug, address_text, latitude, longitude, phone,
      is_active, is_open_override, is_online_paused, timezone
    ) VALUES (?, ?, 'Cabang Test Darurat', 'cabang-test-darurat', 'Jl. Test No. 1', -6.2088, 106.8456, '08123456789', 1, 1, 0, 'Asia/Jakarta')
  `).run(branchId, brandId);

  db.prepare(`
    INSERT OR REPLACE INTO branch_delivery_settings (
      id, branch_id, is_delivery_active, is_pickup_active, max_radius_km
    ) VALUES (?, ?, 1, 1, 15.0)
  `).run('bds_' + branchId, branchId);

  await t.test('1. Schema Verification: is_online_paused column exists and defaults to 0', () => {
    const cols = db.prepare('PRAGMA table_info(branches)').all();
    const hasCol = cols.some(c => c.name === 'is_online_paused');
    assert.strictEqual(hasCol, true, 'Column is_online_paused must exist in branches table');

    const branch = db.prepare('SELECT is_online_paused FROM branches WHERE id = ?').get(branchId);
    assert.strictEqual(branch.is_online_paused, 0, 'Default is_online_paused must be 0 (Normal)');
  });

  await t.test('2. Mode Buka Normal: Both delivery & dine-in are eligible', () => {
    db.prepare('UPDATE branches SET is_open_override = 1, is_online_paused = 0 WHERE id = ?').run(branchId);

    const deliveryElig = EligibilityService.evaluateBranch({
      brand_id: brandId,
      branch_id: branchId,
      order_type: 'delivery'
    });
    assert.strictEqual(deliveryElig.eligible, true, 'Delivery must be eligible in Normal mode');

    const dineInElig = EligibilityService.evaluateBranch({
      brand_id: brandId,
      branch_id: branchId,
      order_type: 'dine_in'
    });
    assert.strictEqual(dineInElig.eligible, true, 'Dine-in must be eligible in Normal mode');
  });

  await t.test('3. Mode Pause Online Saja: Online orders rejected, but DINE-IN IS PRESERVED', () => {
    // Owner sets Pause Online Saja
    db.prepare('UPDATE branches SET is_open_override = 1, is_online_paused = 1 WHERE id = ?').run(branchId);

    const deliveryElig = EligibilityService.evaluateBranch({
      brand_id: brandId,
      branch_id: branchId,
      order_type: 'delivery'
    });
    assert.strictEqual(deliveryElig.eligible, false, 'Delivery must be rejected when online is paused');
    assert.deepStrictEqual(deliveryElig.reasons, ['BRANCH_ONLINE_PAUSED']);

    const pickupElig = EligibilityService.evaluateBranch({
      brand_id: brandId,
      branch_id: branchId,
      order_type: 'pickup'
    });
    assert.strictEqual(pickupElig.eligible, false, 'Pickup must be rejected when online is paused');
    assert.deepStrictEqual(pickupElig.reasons, ['BRANCH_ONLINE_PAUSED']);

    // CRITICAL INDUSTRIAL REQUIREMENT: In-store Dine-in MUST stay open!
    const dineInElig = EligibilityService.evaluateBranch({
      brand_id: brandId,
      branch_id: branchId,
      order_type: 'dine_in'
    });
    assert.strictEqual(dineInElig.eligible, true, 'Dine-in MUST remain eligible even when online delivery is paused');
  });

  await t.test('4. Mode Tutup Paksa: ALL orders (including Dine-in) are rejected', () => {
    // Owner sets Force Close (Tutup Toko)
    db.prepare('UPDATE branches SET is_open_override = 0, is_online_paused = 0 WHERE id = ?').run(branchId);

    const deliveryElig = EligibilityService.evaluateBranch({
      brand_id: brandId,
      branch_id: branchId,
      order_type: 'delivery'
    });
    assert.strictEqual(deliveryElig.eligible, false);
    assert.deepStrictEqual(deliveryElig.reasons, ['BRANCH_CLOSED']);

    const dineInElig = EligibilityService.evaluateBranch({
      brand_id: brandId,
      branch_id: branchId,
      order_type: 'dine_in'
    });
    assert.strictEqual(dineInElig.eligible, false);
    assert.deepStrictEqual(dineInElig.reasons, ['BRANCH_CLOSED']);
  });

  await t.test('5. BranchRepository.findActiveDeliveryBranches excludes paused branches', () => {
    const repo = new BranchRepository();

    // When branch is open normal
    db.prepare('UPDATE branches SET is_open_override = 1, is_online_paused = 0 WHERE id = ?').run(branchId);
    let active = repo.findActiveDeliveryBranches(brandId);
    assert.strictEqual(active.some(b => b.id === branchId), true, 'Normal branch must be included in active delivery');

    // When branch is online paused
    db.prepare('UPDATE branches SET is_open_override = 1, is_online_paused = 1 WHERE id = ?').run(branchId);
    active = repo.findActiveDeliveryBranches(brandId);
    assert.strictEqual(active.some(b => b.id === branchId), false, 'Paused branch must NOT be assigned delivery orders');
  });

  // Cleanup
  db.prepare('DELETE FROM branch_delivery_settings WHERE branch_id = ?').run(branchId);
  db.prepare('DELETE FROM branches WHERE id = ?').run(branchId);
  db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
});
