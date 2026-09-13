'use strict';

const CatalogRepository = require('./CatalogRepository');
const OrderRepository = require('./OrderRepository');
const PaymentRepository = require('./PaymentRepository');
const PromotionRepository = require('./PromotionRepository');
const DiningTableRepository = require('./DiningTableRepository');
const PosOrderRepository = require('./PosOrderRepository');
const BranchRepository = require('./BranchRepository');
const BrandRepository = require('./BrandRepository');
const PosShiftRepository = require('./PosShiftRepository');
const InventoryRepository = require('./InventoryRepository');
const UserRepository = require('./UserRepository');
const EligibilityRepository = require('./EligibilityRepository');
const ReportingRepository = require('./ReportingRepository');
const RoutePersistenceRepository = require('./RoutePersistenceRepository');
const WorkforceRepository = require('./WorkforceRepository');
const MediaRepository = require('./MediaRepository');

module.exports = {
  CatalogRepository,
  OrderRepository,
  PaymentRepository,
  PromotionRepository,
  DiningTableRepository,
  PosOrderRepository,
  BranchRepository,
  BrandRepository,
  PosShiftRepository,
  InventoryRepository,
  UserRepository,
  EligibilityRepository,
  ReportingRepository,
  RoutePersistenceRepository,
  WorkforceRepository,
  MediaRepository
};
