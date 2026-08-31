const { PaymentGatewayService, CashSettlementService } = require('../../domains/payment');

class PaymentService {
  static resolvePaymentConfig(branch_id, brand_id) {
    return PaymentGatewayService.resolvePaymentConfig(branch_id, brand_id);
  }

  static async createSnapTransaction(order, items, customer) {
    return PaymentGatewayService.createSnapTransaction(order, items, customer);
  }

  static handleWebhook(webhookData, options = {}) {
    return PaymentGatewayService.handleWebhook(webhookData, options);
  }

  static settleCash(params) {
    return CashSettlementService.settleCashPayment(params);
  }
}

module.exports = PaymentService;
