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
test('Delivery 3 — Branch Driver Provider: assigns internal driver and advances delivery status to delivered', async () => {
  const orderId = `ord_test_del_${Date.now()}`;
  db.prepare(`
    INSERT INTO orders (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, order_channel, subtotal, grand_total, payment_method, status)
    VALUES (?, 'ORD-DEL-1', 'brand_del', 'branch_del', 'Pak Joko', '62812345678', 'delivery', 'customer_app', 50000, 50000, 'midtrans', 'confirmed')
  `).run(orderId);

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

  // 2. Transition status: on_delivery
  DeliveryDispatchService.updateStatus({
    order_id: orderId,
    status: DeliveryModel.STATUS.ON_DELIVERY
  });

  const onDelRecord = DeliveryDispatchService.getDelivery(orderId);
  assert.strictEqual(onDelRecord.status, 'on_delivery');

  // 3. Complete Delivery: delivered
  DeliveryDispatchService.updateStatus({
    order_id: orderId,
    status: DeliveryModel.STATUS.DELIVERED
  });

  const deliveredRecord = DeliveryDispatchService.getDelivery(orderId);
  assert.strictEqual(deliveredRecord.status, 'delivered');

  // Verify order status advanced to delivered
  const orderRecord = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(orderRecord.status, 'delivered');

  // Verify Event
  assert.ok(completedEvent);
  assert.strictEqual(completedEvent.payload.order_id, orderId);
});
