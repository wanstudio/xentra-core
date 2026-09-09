'use strict';

const CatalogRepository = require('./CatalogRepository');
const OrderRepository = require('./OrderRepository');
const PaymentRepository = require('./PaymentRepository');
const PromotionRepository = require('./PromotionRepository');
const DiningTableRepository = require('./DiningTableRepository');
const PosOrderRepository = require('./PosOrderRepository');

module.exports = {
  CatalogRepository,
  OrderRepository,
  PaymentRepository,
  PromotionRepository,
  DiningTableRepository,
  PosOrderRepository
};
