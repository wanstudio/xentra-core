'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AffiliateService } = require('../domains/affiliate');
const OrderStateMachine = require('../server/services/OrderStateMachine');

test('AFFILIATE CHECKOUT & LIFECYCLE INTEGRATION SUITE', async (t) => {
  const affService = new AffiliateService();
  affService.ensureSchema();
  const db = affService.repo.db;

  const brandId = 'brand_integ_' + Date.now();
  const branchId = 'branch_integ_' + Date.now();
  const customerA = 'cust_aff_' + Date.now();
  const customerB = 'cust_buyer_' + Date.now();
  const orderId = 'order_integ_' + Date.now();
  const orderNumber = 'ORD-' + Date.now();

  await t.test('1. Setup brand, branch, order and referrer profile with bank account', async () => {
    db.execute(`
      INSERT OR IGNORE INTO organizations (id, name, slug)
      VALUES ('org_test', 'Org Test', 'org-test')
    `);

    db.execute(`
      INSERT OR IGNORE INTO brands (id, organization_id, name, slug)
      VALUES (?, 'org_test', 'Test Brand', ?)
    `, [brandId, 'slug-' + brandId]);

    db.execute(`
      INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active)
      VALUES (?, ?, 'Test Branch', ?, 'Jl. Test No. 1', -6.2, 106.8, 1)
    `, [branchId, brandId, 'slug-' + branchId]);

    db.execute(
      'INSERT INTO orders (id, order_number, brand_id, branch_id, customer_id, customer_name, customer_phone, status, order_type, subtotal, grand_total, payment_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))',
      [orderId, orderNumber, brandId, branchId, customerB, 'Buyer B', '08123456789', 'pending', 'delivery', 100000, 110000, 'unpaid']
    );

    const profileA = await affService.getOrCreateProfile({
      brandId,
      customerId: customerA,
      customerName: 'Affiliate A',
      customerPhone: '08111111111'
    });
    assert.ok(profileA.referral_code, 'Referral code should exist');

    await affService.updateBankDetails({
      brandId,
      customerId: customerA,
      bankName: 'BCA',
      accountNumber: '1234567890',
      accountHolder: 'Affiliate A'
    });

    const updated = affService.repo.findProfileById(profileA.id);
    assert.equal(updated.bank_name, 'BCA');
  });

  await t.test('2. Evaluate order conversion on checkout (pending status)', async () => {
    const profileA = affService.repo.findProfileByCustomer({ brandId, customerId: customerA });

    const conversion = await affService.evaluateOrderConversion({
      brandId,
      orderId,
      referralCode: profileA.referral_code,
      customerId: customerB,
      subtotal: 100000,
      discountAmount: 0,
      totalItems: 3
    });

    assert.ok(conversion, 'Conversion created');
    assert.equal(conversion.status, 'PENDING');
    assert.equal(conversion.commission_amount, 3000); // 3 items * Rp1.000

    const profileAfterOrder = affService.repo.findProfileById(profileA.id);
    assert.equal(profileAfterOrder.balance_pending, 3000);
    assert.equal(profileAfterOrder.balance_payable, 0);
  });

  await t.test('3. Order completion via OrderStateMachine settles commission to payable', async () => {
    const profileA = affService.repo.findProfileByCustomer({ brandId, customerId: customerA });

    // Transition lifecycle
    OrderStateMachine.transition({ order_id: orderId, target_status: 'confirmed', actor_type: 'staff', actor_id: 'user_1' });
    OrderStateMachine.transition({ order_id: orderId, target_status: 'preparing', actor_type: 'staff', actor_id: 'user_1' });
    OrderStateMachine.transition({ order_id: orderId, target_status: 'ready', actor_type: 'staff', actor_id: 'user_1' });
    OrderStateMachine.transition({ order_id: orderId, target_status: 'out_for_delivery', actor_type: 'driver', actor_id: 'drv_1' });
    OrderStateMachine.transition({ order_id: orderId, target_status: 'completed', actor_type: 'driver', actor_id: 'drv_1' });

    const profileAfterComplete = affService.repo.findProfileById(profileA.id);
    assert.equal(profileAfterComplete.balance_pending, 0, 'Pending balance cleared');
    assert.equal(profileAfterComplete.balance_payable, 3000, 'Payable balance credited');

    const conv = affService.repo.findConversionByOrder(orderId);
    assert.equal(conv.status, 'APPROVED');
  });

  await t.test('4. Payout request and Admin transfer approval', async () => {
    const profileA = affService.repo.findProfileByCustomer({ brandId, customerId: customerA });

    // Temporarily set min payout threshold to 3000
    await affService.updateProgram({ brandId, minPayoutAmount: 3000 });

    const payout = await affService.requestPayout({
      brandId,
      customerId: customerA,
      amount: 3000,
      notes: 'Withdraw commission'
    });
    assert.equal(payout.status, 'REQUESTED');
    assert.equal(payout.amount, 3000);

    const profileAfterReq = affService.repo.findProfileById(profileA.id);
    assert.equal(profileAfterReq.balance_payable, 0);

    const approved = await affService.processAdminPayout({
      brandId,
      payoutId: payout.id,
      action: 'APPROVE',
      transferReference: 'TRF-TEST-888',
      actorId: 'admin_1'
    });
    assert.equal(approved.status, 'PAID');
    assert.equal(approved.transfer_reference, 'TRF-TEST-888');

    const profileAfterPaid = affService.repo.findProfileById(profileA.id);
    assert.equal(profileAfterPaid.total_withdrawn, 3000);
  });
});
