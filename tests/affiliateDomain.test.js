'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AffiliateService } = require('../domains/affiliate');

test('AFFILIATE DOMAIN SUITE', async (t) => {
  const service = new AffiliateService();
  service.ensureSchema();

  const brandId = 'brand_test_aff_' + Date.now();
  const customerA = 'cust_aff_a_' + Date.now();
  const customerB = 'cust_aff_b_' + Date.now();

  await t.test('1. Program defaults and update', async () => {
    const prog = await service.getProgram({ brandId });
    assert.equal(prog.commission_type, 'FIXED_PER_ITEM');
    assert.equal(prog.commission_rate, 1000.0);
    assert.equal(prog.commission_per_item, 1000.0);
    assert.equal(prog.cookie_days, 14);
    assert.equal(prog.min_payout_amount, 50000);

    const updated = await service.updateProgram({
      brandId,
      commissionType: 'PERCENTAGE',
      commissionRate: 10.0,
      cookieDays: 30,
      minPayoutAmount: 25000
    });
    assert.equal(updated.commission_type, 'PERCENTAGE');
    assert.equal(updated.commission_rate, 10.0);
    assert.equal(updated.cookie_days, 30);
    assert.equal(updated.min_payout_amount, 25000);
  });

  await t.test('2. Profile creation & unique referral code', async () => {
    const profA = await service.getOrCreateProfile({
      brandId,
      customerId: customerA,
      customerName: 'Budi Santoso'
    });
    assert.ok(profA.id);
    assert.ok(profA.referral_code.startsWith('BUDI'));

    // Same customer returns existing profile
    const profA2 = await service.getOrCreateProfile({
      brandId,
      customerId: customerA
    });
    assert.equal(profA.id, profA2.id);
    assert.equal(profA.referral_code, profA2.referral_code);
  });

  await t.test('3. Bank details update', async () => {
    const updated = await service.updateBankDetails({
      brandId,
      customerId: customerA,
      bankName: 'BCA',
      accountNumber: '1234567890',
      accountHolder: 'Budi Santoso'
    });
    assert.equal(updated.bank_name, 'BCA');
    assert.equal(updated.bank_account_number, '1234567890');
    assert.equal(updated.bank_account_holder, 'Budi Santoso');
  });

  await t.test('4. Attribution & Self-referral prevention', async () => {
    const profA = await service.getOrCreateProfile({ brandId, customerId: customerA });

    // Self-referral must be blocked
    const selfAttr = await service.recordAttribution({
      brandId,
      referralCode: profA.referral_code,
      customerId: customerA
    });
    assert.equal(selfAttr.success, false);
    assert.equal(selfAttr.reason, 'SELF_REFERRAL_BLOCKED');

    // Valid referral to Customer B
    const validAttr = await service.recordAttribution({
      brandId,
      referralCode: profA.referral_code,
      customerId: customerB,
      source: 'whatsapp'
    });
    assert.equal(validAttr.success, true);
    assert.equal(validAttr.referral_code, profA.referral_code);
  });

  await t.test('5. Order conversion calculation & commission lifecycle', async () => {
    const profA = await service.getOrCreateProfile({ brandId, customerId: customerA });
    const orderId = 'ord_aff_' + Date.now();

    // 10% commission on (Rp100.000 subtotal - Rp20.000 discount) = Rp80.000 net -> Rp8.000 commission
    const conv = await service.evaluateOrderConversion({
      brandId,
      orderId,
      referralCode: profA.referral_code,
      customerId: customerB,
      subtotal: 100000,
      discountAmount: 20000
    });

    assert.ok(conv);
    assert.equal(conv.eligible_subtotal, 80000);
    assert.equal(conv.commission_rate, 10.0);
    assert.equal(conv.commission_amount, 8000);
    assert.equal(conv.status, 'PENDING');

    // Check balances
    const stats1 = await service.getCustomerStats({ brandId, customerId: customerA });
    assert.equal(stats1.profile.balance_pending, 8000);
    assert.equal(stats1.profile.balance_payable, 0);

    // Approve commission (e.g. after order completed)
    const approved = await service.approveOrderCommission({ orderId });
    assert.equal(approved.status, 'APPROVED');

    const stats2 = await service.getCustomerStats({ brandId, customerId: customerA });
    assert.equal(stats2.profile.balance_pending, 0);
    assert.equal(stats2.profile.balance_payable, 8000);

    // Idempotency: Second evaluate does not duplicate
    const dupe = await service.evaluateOrderConversion({
      brandId,
      orderId,
      referralCode: profA.referral_code,
      customerId: customerB,
      subtotal: 100000
    });
    assert.equal(dupe.id, conv.id);
  });

  await t.test('6. Payout request and Admin approval/rejection lifecycle', async () => {
    // Current payable is 8000, min payout is 25000 -> should fail threshold
    await assert.rejects(
      async () => {
        await service.requestPayout({
          brandId,
          customerId: customerA,
          amount: 8000
        });
      },
      (err) => err.message.includes('MINIMUM_PAYOUT_AMOUNT_NOT_MET')
    );

    // Add another conversion of Rp200.000 -> Rp20.000 commission
    const orderId2 = 'ord_aff_2_' + Date.now();
    await service.evaluateOrderConversion({
      brandId,
      orderId: orderId2,
      referralCode: (await service.getOrCreateProfile({ brandId, customerId: customerA })).referral_code,
      customerId: customerB,
      subtotal: 200000
    });
    await service.approveOrderCommission({ orderId: orderId2 });

    // Total payable is now 8.000 + 20.000 = 28.000 >= 25.000 threshold
    const payoutReq = await service.requestPayout({
      brandId,
      customerId: customerA,
      amount: 25000,
      notes: 'Tarik komisi promo WhatsApp'
    });

    assert.ok(payoutReq);
    assert.equal(payoutReq.amount, 25000);
    assert.equal(payoutReq.status, 'REQUESTED');

    // Balance payable deducted immediately (28000 - 25000 = 3000)
    const statsAfterReq = await service.getCustomerStats({ brandId, customerId: customerA });
    assert.equal(statsAfterReq.profile.balance_payable, 3000);

    // Admin lists payouts
    const adminPayouts = await service.listPayoutsForAdmin({ brandId, status: 'REQUESTED' });
    assert.ok(adminPayouts.length >= 1);
    const target = adminPayouts.find((p) => p.id === payoutReq.id);
    assert.ok(target);
    assert.equal(target.amount, 25000);

    // Admin approves payout
    const processed = await service.processAdminPayout({
      brandId,
      payoutId: payoutReq.id,
      action: 'APPROVE',
      notes: 'Transfer via BCA m-Banking ref #TRX99281'
    });
    assert.equal(processed.status, 'PAID');

    const statsAfterPaid = await service.getCustomerStats({ brandId, customerId: customerA });
    assert.equal(statsAfterPaid.profile.total_withdrawn, 25000);
    assert.equal(statsAfterPaid.profile.balance_payable, 3000);
  });

  await t.test('7. Application & Owner Approval Lifecycle', async () => {
    const customerC = 'cust_aff_c_' + Date.now();
    const customerD = 'cust_aff_d_' + Date.now();

    // 1. Initial status before applying is NOT_REGISTERED
    const initialStatus = await service.getCustomerStatus({ brandId, customerId: customerC });
    assert.equal(initialStatus.registered, false);
    assert.equal(initialStatus.status, 'NOT_REGISTERED');

    // 2. Submit application -> status PENDING
    const applied = await service.applyForAffiliate({
      brandId,
      customerId: customerC,
      customerName: 'Citra Kirana',
      socialMedia: '@citra_kuliner (IG 25k followers)',
      bankName: 'BCA',
      accountNumber: '5544332211',
      accountHolder: 'Citra Kirana',
      notes: 'Mau promo menu Bangjo di reel kuliner'
    });
    assert.ok(applied);
    assert.equal(applied.status, 'PENDING');
    assert.equal(applied.social_media, '@citra_kuliner (IG 25k followers)');

    const statusPending = await service.getCustomerStatus({ brandId, customerId: customerC });
    assert.equal(statusPending.registered, true);
    assert.equal(statusPending.status, 'PENDING');

    // 3. Attribution fails while status is PENDING
    const attrFail = await service.recordAttribution({
      brandId,
      referralCode: applied.referral_code,
      customerId: customerD
    });
    assert.equal(attrFail.success, false);
    assert.equal(attrFail.reason, 'AFFILIATE_NOT_ACTIVE');

    // 4. Admin lists pending applications
    const pendingList = await service.listAffiliatesForAdmin({ brandId, status: 'PENDING' });
    const found = pendingList.find(m => m.id === applied.id);
    assert.ok(found, 'Should find applicant in admin pending list');
    assert.equal(found.status, 'PENDING');

    // 5. Admin approves application -> status ACTIVE
    const approved = await service.approveAffiliate({
      brandId,
      profileId: applied.id,
      approvedBy: 'admin_owner_1'
    });
    assert.equal(approved.status, 'ACTIVE');
    assert.ok(approved.approved_at);

    // 6. Attribution now succeeds
    const attrOk = await service.recordAttribution({
      brandId,
      referralCode: applied.referral_code,
      customerId: customerD
    });
    assert.equal(attrOk.success, true);

    // 7. Test rejection flow on another applicant
    const rejectedApp = await service.applyForAffiliate({
      brandId,
      customerId: customerD,
      customerName: 'Dodi Anonim',
      socialMedia: 'tidak ada',
      bankName: 'DANA',
      accountNumber: '08999999999',
      accountHolder: 'Dodi',
      notes: 'coba-coba'
    });
    assert.equal(rejectedApp.status, 'PENDING');

    const rejected = await service.rejectAffiliate({
      brandId,
      profileId: rejectedApp.id,
      rejectionReason: 'Akun media sosial tidak memenuhi kriteria minimal pengikut.'
    });
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.rejection_reason, 'Akun media sosial tidak memenuhi kriteria minimal pengikut.');

    const statusRejected = await service.getCustomerStatus({ brandId, customerId: customerD });
    assert.equal(statusRejected.status, 'REJECTED');
  });
});
