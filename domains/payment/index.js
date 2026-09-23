'use strict';

const { domain } = require('../../core');
const PaymentModel = require('./models/PaymentModel');
const CashSettlementService = require('./services/CashSettlementService');
const PaymentGatewayService = require('./services/PaymentGatewayService');

const PAYMENT_IDENTITY = {
  name: 'payment',
  version: '1.1.0',
  display_name: 'Xentra Payment',
  description: 'Authoritative Payment Domain for Physical Cash Settlement & Multi-Gateway Online Payments (Midtrans, DOKU) with full lifecycle isolation'
};

const PAYMENT_CAPABILITIES = {
  events_produced: [
    'payment.settled',
    'payment.failed'
  ],
  events_consumed: [
    'order.created',
    'order.cancelled'
  ],
  permissions_required: [
    'payment:read',
    'payment:settle',
    'payment:manage'
  ],
  features_provided: [
    'cash_settlement',
    'midtrans_snap',
    'midtrans_webhook_signature',
    'doku_checkout',
    'doku_webhook_signature',
    'payment_lifecycle_isolation'
  ]
};

// 3. Register with Core Domain Registry
let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: PAYMENT_IDENTITY,
    capabilities: PAYMENT_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('payment');
}

module.exports = {
  identity: PAYMENT_IDENTITY,
  capabilities: PAYMENT_CAPABILITIES,
  registration,
  PaymentModel,
  CashSettlementService,
  PaymentGatewayService
};

