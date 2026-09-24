'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const files = {
  paymentModel: read('domains/payment/models/PaymentModel.js'),
  paymentService: read('domains/payment/services/PaymentGatewayService.js'),
  manualQris: read('domains/payment/services/ManualQrisSettlementService.js'),
  paymentRepo: read('core/data/repositories/PaymentRepository.js'),
  orderRepo: read('core/data/repositories/OrderRepository.js'),
  paymentIndex: read('domains/payment/index.js'),
  posService: read('domains/pos/services/PosOrderService.js'),
  posRoutes: read('server/routes/pos.js'),
  posJs: read('apps/pos-app/assets/js/pos-app.js'),
  settings: read('server/routes/settings.js'),
  finance: read('server/routes/admin-finance.js'),
  posDoc: read('docs/decisions/pos-app-surface-implementation-v1.md')
};

assert(files.paymentModel.includes("QRIS_STATIC: 'qris_static'"));
assert(files.paymentService.includes("clean === 'qris_static'"));
assert(files.paymentService.includes('resolveStaticQrisConfig'));
assert(files.manualQris.includes('settleStaticQrisPayment'));
assert(files.manualQris.includes('cancelStaticQrisPayment'));
assert(files.paymentRepo.includes("'cash', 'midtrans', 'doku', 'qris_static'"));
assert(files.paymentRepo.includes('updatePaymentGatewayToken'));
assert(files.orderRepo.includes("'cash', 'midtrans', 'doku', 'qris_static'"));
assert(files.paymentIndex.includes('ManualQrisSettlementService'));
assert(files.posService.includes("payment_method === 'qris_static'"));
assert(files.posService.includes('PaymentGatewayService.createSnapTransaction'));
assert(files.posService.includes('PAYMENT_PENDING'));
assert(files.posRoutes.includes("router.get('/pos/payment-methods'"));
assert(files.posRoutes.includes("router.get('/pos/orders/:id/payment-status'"));
assert(files.posRoutes.includes("router.post('/pos/orders/:id/confirm-qris-static'"));
assert(files.posRoutes.includes("router.post('/pos/orders/:id/cancel-qris-static'"));
assert(files.posJs.includes('payment_mode'));
assert(files.posJs.includes("paymentMode==='payment_gateway'"));
assert(files.posJs.includes("paymentMode==='qris_static'"));
assert(files.posJs.includes('/pos/local/sale'));
assert(files.settings.includes("/admin/settings/commerce/payments/qris-static"));
assert(files.finance.includes("code: 'qris_static'"));
assert(files.posDoc.includes('POS payment selection is exactly **three modes**'));
assert(files.posDoc.includes('No second payment state machine'));

for (const [name, source] of Object.entries(files)) {
  if (name === 'posJs' || name === 'posService' || name === 'posRoutes' || name === 'paymentService' ||
      name === 'paymentModel' || name === 'manualQris' || name === 'paymentRepo' || name === 'orderRepo' ||
      name === 'paymentIndex' || name === 'settings' || name === 'finance') {
    new Function(source);
  }
}

console.log('POS three-payment-mode contract: PASS');
