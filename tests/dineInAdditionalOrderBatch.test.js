const { describe, it } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const posJs = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/js/pos-app.js'), 'utf8');
const posHtml = fs.readFileSync(path.join(ROOT, 'apps/pos-app/index.html'), 'utf8');
const posCss = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/css/pos.css'), 'utf8');
const additionService = fs.readFileSync(path.join(ROOT, 'domains/commerce/services/OrderAdditionService.js'), 'utf8');
const additionRepo = fs.readFileSync(path.join(ROOT, 'core/data/repositories/OrderAdditionRepository.js'), 'utf8');
const orderRepo = fs.readFileSync(path.join(ROOT, 'core/data/repositories/OrderRepository.js'), 'utf8');
const posRoutes = fs.readFileSync(path.join(ROOT, 'server/routes/pos.js'), 'utf8');
const operationalRoutes = fs.readFileSync(path.join(ROOT, 'server/routes/operational-orders.js'), 'utf8');
const customerRoutes = fs.readFileSync(path.join(ROOT, 'server/routes/customer.js'), 'utf8');
const customerCheckoutJs = fs.readFileSync(path.join(ROOT, 'apps/customer-pwa/assets/js/pages/checkout.js'), 'utf8');
const schemaJs = fs.readFileSync(path.join(ROOT, 'server/database/db.js'), 'utf8');

describe('Dine-in Additional Order Batch contract', () => {
  it('keeps additions under one canonical Commerce Order', () => {
    assert.ok(additionService.includes('order_addition_batches'));
    assert.ok(additionService.includes('order_id: order.id'));
    assert.ok(!additionService.includes('submitOrder({'));
    assert.ok(schemaJs.includes('UNIQUE (order_id, sequence_no)'));
    assert.ok(orderRepo.includes('addition_batch_id'));
  });

  it('uses an explicit submission then Merchant acceptance boundary', () => {
    assert.ok(additionService.includes("status: 'PENDING_ACCEPTANCE'"));
    assert.ok(additionService.includes("status === 'pending_acceptance'"));
    assert.ok(additionService.includes("decision === 'accept'"));
    assert.ok(additionService.includes("markAccepted"));
    assert.ok(operationalRoutes.includes("/orders/:id/additions/:additionId/branch-acceptance"));
  });

  it('does not deduct stock at draft submission', () => {
    const submitStart = additionService.indexOf('static async submit(');
    const submitEnd = additionService.indexOf('\n  static decide(', submitStart);
    const submitBlock = additionService.slice(submitStart, submitEnd);
    assert.ok(!submitBlock.includes('deductStockForItems'));
  });

  it('keeps stock deduction idempotent and tied to the addition reference', () => {
    assert.ok(additionService.includes('deductStockForItems'));
    assert.ok(additionService.includes("reference_id: lockedOrder.order_number + ':addition:' + addition.id"));
  });

  it('exposes the addition context to POS and customer boundaries', () => {
    assert.ok(posRoutes.includes("router.get('/pos/orders/:id/additions'"));
    assert.ok(posRoutes.includes("router.post('/pos/orders/:id/additions'"));
    assert.ok(customerRoutes.includes("router.post('/customer/dining-session/additions'"));
  });

  it('locks the accepted parent order while preserving payment allocation', () => {
    assert.ok(posJs.includes('activeOrderLocked'));
    assert.ok(posJs.includes('isOrderLockedForEditing'));
    assert.ok(posJs.includes('showOrderLockedWarning'));
    assert.ok(posJs.includes('await openCheckManager(state.activeHeldOrderId);'));
    const manyPaymentStart = posJs.indexOf('async function openManyPaymentFromCart(){');
    const manyPaymentEnd = posJs.indexOf('function resetSale(){', manyPaymentStart);
    const manyPaymentBlock = posJs.slice(manyPaymentStart, manyPaymentEnd);
    assert.ok(!manyPaymentBlock.includes("/pos/held-orders/"));
    assert.ok(posJs.includes('if(state.activeOrderLocked) return showOrderLockedWarning();'));
  });

  it('routes an active customer dine-in cart into the existing order instead of create-order', () => {
    assert.ok(customerCheckoutJs.includes('getActiveDineInOrderId'));
    assert.ok(customerCheckoutJs.includes('/customer/dining-session/additions'));
    assert.ok(customerCheckoutJs.includes('proceedCreateAdditionalOrder(items)'));
    assert.ok(customerCheckoutJs.includes('if (isAdditionalDineIn)'));
    assert.ok(customerRoutes.includes('active_order_id: activeOrders.length ? activeOrders[activeOrders.length - 1].id : null'));
  });

  it('persists an idempotency key for additional batches', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'server/database/db.js'), 'utf8');
    assert.ok(schema.includes('order_addition_batches'));
    assert.ok(schema.includes('client_transaction_id TEXT'));
    assert.ok(schema.includes('idx_order_addition_batches_client_tx'));
    assert.ok(additionRepo.includes('findByClientTransactionId'));
    assert.ok(additionService.includes('findByClientTransactionId'));
  });

  it('provides explicit additional-order UX and locked styling', () => {
    assert.ok(posHtml.includes('id="btn-pos-additional-order"'));
    assert.ok(posHtml.includes('id="pos-order-addition-banner"'));
    assert.ok(posJs.includes("function enterAdditionalOrderMode()"));
    assert.ok(posJs.includes("function submitAdditionalOrder()"));
    assert.ok(posCss.includes('.pos-product.order-locked'));
    assert.ok(posCss.includes('.pos-cart-item-locked .pos-qty'));
  });

  it('does not mutate the original Hold Bill when opening Masing-masing', () => {
    const start = posJs.indexOf('async function openManyPaymentFromCart(){');
    const end = posJs.indexOf('\n  function resetSale(){', start);
    const block = posJs.slice(start, end);
    assert.ok(block.includes('await openCheckManager(state.activeHeldOrderId);'));
    assert.ok(!block.includes("method:'PUT'"));
    assert.ok(!block.includes('/pos/held-orders/'));
  });
});
