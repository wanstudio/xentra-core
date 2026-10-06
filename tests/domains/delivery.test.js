'use strict';
const test = require('node:test');
const assert = require('node:assert');
const db = require('../../server/database/db');
const { domain, events } = require('../../core');
const {
  DeliveryModel,
  DeliveryCalculatorService,
  DeliveryDispatchService,
  BranchDriverProvider,
  identity,
  capabilities
} = require('../../domains/delivery');

test.before(() => {
  try {
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_del', 'Holding Delivery', 'org-del')`).run();
    db.prepare(`INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES ('brand_del', 'org_del', 'Brand Delivery', 'brand-del')`).run();
    db.prepare(`INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, latitude, longitude) VALUES ('branch_del', 'brand_del', 'Cabang Delivery', 'cabang-del', '62812345678', 'Jl. Rungkut', -7.25, 112.75)`).run();
  } catch (e) {
    console.error('Delivery seed error:', e.message);
  }
});

// ==============================================================================
// Delivery 1 — Domain Registration & Capability Declaration
// ==============================================================================
test('Delivery 1 — Domain Self-Registration: successfully registered in core DomainRegistry', () => {
  assert.strictEqual(identity.name, 'delivery');
  assert.strictEqual(capabilities.features_provided.includes('multi_branch_tariff_engine'), true);
  assert.strictEqual(capabilities.features_provided.includes('branch_driver_provider'), true);
  assert.strictEqual(domain.DomainRegistry.isDomainActive('delivery'), true);
});

// ==============================================================================
// Delivery 2 — Distance & Tariff Calculation Engine
// ==============================================================================
test('Delivery 2 — Delivery Calculator: calculates exact fee, promo discount, and max radius guard', () => {
  // 1. Within free distance (2km) -> 0 fee
  const resFree = DeliveryCalculatorService.calculate({
    distance_meters: 1800,
    free_km: 2,
    price_per_km: 3000,
    max_radius_km: 10
  });
  assert.strictEqual(resFree.eligible, true);
  assert.strictEqual(resFree.final_delivery_fee, 0);

  // 2. Beyond free distance (5km with 2km free @ Rp3.000/km) -> (5 - 2) * 3000 = Rp 9.000
  const resStandard = DeliveryCalculatorService.calculate({
    distance_meters: 5000,
    free_km: 2,
    price_per_km: 3000,
    max_radius_km: 10
  });
  assert.strictEqual(resStandard.eligible, true);
  assert.strictEqual(resStandard.base_delivery_fee, 9000);
  assert.strictEqual(resStandard.final_delivery_fee, 9000);

  // 3. Beyond max radius (12km with max 10km) -> Ineligible
  const resExceeded = DeliveryCalculatorService.calculate({
    distance_meters: 12000,
    free_km: 2,
    price_per_km: 3000,
    max_radius_km: 10
  });
  assert.strictEqual(resExceeded.eligible, false);

  // 4. Promo Discount Application (Subtotal threshold met)
  const resPromo = DeliveryCalculatorService.calculate({
    distance_meters: 5000,
    free_km: 2,
    price_per_km: 3000,
    max_radius_km: 10,
    subtotal: 100000,
    promo_config: {
      enabled: true,
      min_subtotal: 80000,
      discount_amount: 5000,
      label: 'Promo Merdeka'
    }
  });
  assert.strictEqual(resPromo.eligible, true);
  assert.strictEqual(resPromo.base_delivery_fee, 9000);
  assert.strictEqual(resPromo.discount_amount, 5000);
  assert.strictEqual(resPromo.final_delivery_fee, 4000);
});

// ==============================================================================
// Delivery 3 — Branch Driver Dispatch & Lifecycle Transitions
// ==============================================================================
test('Delivery 2b — Delivery assignment is blocked before order READY', () => {
  const orderId = `ord_not_ready_driver_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_del', 'branch_del', 'Not Ready', '62812345678', 'delivery', 'customer_app', 25000, 25000, 'cash', 'preparing')
  `).run(orderId, 'ORD-NOT-READY-' + Date.now());

  assert.throws(
    () => DeliveryDispatchService.assign({
      order_id: orderId,
      provider_type: DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
      driver_id: 'driver_not_ready',
      driver_name: 'Budi Kurir',
      driver_phone: '081299998888',
      assigned_by: 'manager_1'
    }),
    /setelah pesanan berstatus ready/
  );
});

test('Delivery 3 — Branch Driver Provider: assigns internal driver and advances delivery status to delivered', async () => {
  const orderId = `ord_test_del_${Date.now()}`;
  const orderNumber = `ORD-DEL-${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_del', 'branch_del', 'Pak Joko', '62812345678', 'delivery', 'customer_app', 50000, 50000, 'midtrans', 'ready')
  `).run(orderId, orderNumber);

  let assignedEvent = null;
  let completedEvent = null;

  events.EventBus.subscribe('delivery.driver.assigned', (evt) => {
    if (evt.payload.order_id === orderId) assignedEvent = evt;
  });
  events.EventBus.subscribe('delivery.completed', (evt) => {
    if (evt.payload.order_id === orderId) completedEvent = evt;
  });

  // 1. Assign Internal Branch Driver
  const assignResult = DeliveryDispatchService.assign({
    order_id: orderId,
    provider_type: DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
    driver_name: 'Budi Kurir',
    driver_phone: '081299998888',
    assigned_by: 'manager_1'
  });

  assert.strictEqual(assignResult.success, true);
  assert.strictEqual(assignResult.status, 'assigned');
  assert.strictEqual(assignResult.driver_name, 'Budi Kurir');

  // Verify database record
  const delRecord = DeliveryDispatchService.getDelivery(orderId);
  assert.ok(delRecord);
  assert.strictEqual(delRecord.status, 'assigned');
  assert.strictEqual(delRecord.driver_name, 'Budi Kurir');

  // Verify Event
  assert.ok(assignedEvent);
  assert.strictEqual(assignedEvent.payload.driver_name, 'Budi Kurir');

  // 2. Driver must explicitly accept before pickup.
  assert.throws(
    () => DeliveryDispatchService.updateStatus({
      order_id: orderId,
      status: DeliveryModel.STATUS.PICKED_UP,
      actor_id: 'driver_1'
    }),
    /harus diterima Driver/
  );

  const accepted = DeliveryDispatchService.acceptAssignment({
    order_id: orderId,
    actor_id: 'driver_1'
  });
  assert.strictEqual(accepted.assignment_status, 'accepted');

  DeliveryDispatchService.updateStatus({
    order_id: orderId,
    status: DeliveryModel.STATUS.PICKED_UP,
    actor_id: 'driver_1'
  });

  const pickedUpRecord = DeliveryDispatchService.getDelivery(orderId);
  assert.strictEqual(pickedUpRecord.status, 'picked_up');

  // 3. Driver starts delivery: Delivery Job + canonical Order diverge correctly
  DeliveryDispatchService.updateStatus({
    order_id: orderId,
    status: DeliveryModel.STATUS.ON_DELIVERY,
    actor_id: 'driver_1'
  });

  const onDelRecord = DeliveryDispatchService.getDelivery(orderId);
  assert.strictEqual(onDelRecord.status, 'on_delivery');
  const onDelOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(onDelOrder.status, 'out_for_delivery');

  // 4. Driver completes delivery: Delivery Job becomes delivered,
  // canonical Commerce Order becomes completed (never delivered).
  DeliveryDispatchService.updateStatus({
    order_id: orderId,
    status: DeliveryModel.STATUS.DELIVERED,
    actor_id: 'driver_1'
  });

  const deliveredRecord = DeliveryDispatchService.getDelivery(orderId);
  assert.strictEqual(deliveredRecord.status, 'delivered');

  const orderRecord = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(orderRecord.status, 'completed');

  // Verify Event
  assert.ok(completedEvent);
  assert.strictEqual(completedEvent.payload.order_id, orderId);
});

test('Delivery 5 — COD lifecycle requires Driver collection, explicit Cashier handover, then settlement', () => {
  const orderId = `ord_cod_delivery_${Date.now()}`;
  const shiftId = `shift_cod_delivery_${Date.now()}`;
  const cashierId = `cashier_cod_delivery_${Date.now()}`;

  db.prepare(`
    INSERT INTO users (id, brand_id, branch_id, username, email, password_hash, full_name, role, status)
    VALUES (?, 'brand_del', 'branch_del', ?, ?, 'hash', 'Kasir COD', 'cashier', 'active')
  `).run(cashierId, 'cashier_' + cashierId, cashierId + '@test.local');

  db.prepare(`
    INSERT INTO pos_shifts (id, branch_id, cashier_id, starting_float, total_cash_sales, status, opened_at)
    VALUES (?, 'branch_del', ?, 100000, 0, 'open', datetime('now'))
  `).run(shiftId, cashierId);

  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, delivery_fee, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_del', 'branch_del', 'COD Buyer', '628111111111', 'delivery', 'customer_app', 30000, 5000, 35000, 'cash', 'ready')
  `).run(orderId, 'ORD-COD-' + Date.now());

  db.prepare(`
    INSERT INTO order_payments (id, order_id, provider, payment_method, payment_status, amount)
    VALUES (?, ?, 'cash', 'cash', 'pending', 35000)
  `).run('pay_' + orderId, orderId);

  DeliveryDispatchService.assign({
    order_id: orderId,
    provider_type: DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
    driver_id: 'driver_cod_1',
    driver_name: 'Driver COD',
    driver_phone: '081200000001',
    assigned_by: 'manager_1'
  });
  DeliveryDispatchService.acceptAssignment({ order_id: orderId, actor_id: 'driver_cod_1' });
  DeliveryDispatchService.updateStatus({ order_id: orderId, status: DeliveryModel.STATUS.PICKED_UP, actor_id: 'driver_cod_1' });
  DeliveryDispatchService.updateStatus({ order_id: orderId, status: DeliveryModel.STATUS.ON_DELIVERY, actor_id: 'driver_cod_1' });
  DeliveryDispatchService.updateStatus({
    order_id: orderId,
    status: DeliveryModel.STATUS.DELIVERED,
    actor_id: 'driver_cod_1',
    cod_amount_tendered: 40000
  });

  const deliveryAfterDelivery = DeliveryDispatchService.getDelivery(orderId);
  assert.strictEqual(deliveryAfterDelivery.status, 'delivered');
  assert.strictEqual(deliveryAfterDelivery.cod_collection_status, 'collected');
  assert.strictEqual(deliveryAfterDelivery.cod_cash_custody, 'driver');
  assert.strictEqual(Number(deliveryAfterDelivery.cod_collected_amount), 35000);
  assert.strictEqual(Number(deliveryAfterDelivery.cod_amount_tendered), 40000);
  assert.strictEqual(Number(deliveryAfterDelivery.cod_change_given), 5000);

  const { CashSettlementService } = require('../../domains/payment');
  assert.throws(
    () => CashSettlementService.settleCashPayment({
      order_id: orderId,
      amount: 35000,
      amount_tendered: 35000,
      cashier_id: cashierId,
      shift_id: shiftId
    }),
    /COD_HANDOVER_REQUIRED/
  );

  const handover = DeliveryDispatchService.recordCodHandover({
    order_id: orderId,
    cashier_id: cashierId,
    branch_id: 'branch_del',
    received_amount: 35000
  });
  assert.strictEqual(handover.cod_cash_custody, 'cashier');

  const settlement = CashSettlementService.settleCashPayment({
    order_id: orderId,
    amount: 35000,
    amount_tendered: 35000,
    cashier_id: cashierId,
    shift_id: shiftId
  });
  assert.strictEqual(settlement.payment_status, 'settlement');

  const finalDelivery = DeliveryDispatchService.getDelivery(orderId);
  const finalPayment = db.prepare('SELECT payment_status FROM order_payments WHERE order_id = ?').get(orderId);
  assert.strictEqual(finalDelivery.cod_collection_status, 'handed_over');
  assert.strictEqual(finalDelivery.cod_cash_custody, 'cashier');
  assert.strictEqual(finalPayment.payment_status, 'settlement');

  const repeatHandover = DeliveryDispatchService.recordCodHandover({
    order_id: orderId,
    cashier_id: cashierId,
    branch_id: 'branch_del',
    received_amount: 35000
  });
  assert.strictEqual(repeatHandover.idempotent, true);
});

test('Delivery 4 — driver assignment rejects non-delivery fulfillment environments', () => {
  const orderId = 'ord_test_pickup_driver_' + Date.now();
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, ?, 'brand_del', 'branch_del', 'Siti', '62812345678', 'pickup', 'customer_app', 30000, 30000, 'cash', 'ready')
  `).run(orderId, 'ORD-PICKUP-' + Date.now());

  assert.throws(
    () => DeliveryDispatchService.assign({
      order_id: orderId,
      provider_type: DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
      driver_name: 'Budi Kurir',
      driver_phone: '081299998888'
    }),
    /Hanya Order Fulfillment Environment delivery/
  );
});
