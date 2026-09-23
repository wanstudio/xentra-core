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

  static getActiveProvider(branch_id, brand_id) {
    return PaymentGatewayService.getActiveProvider(branch_id, brand_id);
  }

  static validatePaymentMethod(payment_method, options = {}) {
    return PaymentGatewayService.validatePaymentMethod(payment_method, options);
  }

  static checkTransactionStatus(order_id) {
    return PaymentGatewayService.checkTransactionStatus(order_id);
  }

  static reconcilePendingTransactions() {
    return PaymentGatewayService.reconcilePendingTransactions();
  }
}

module.exports = PaymentService;
