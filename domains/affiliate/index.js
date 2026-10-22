'use strict';

const AffiliateRepository = require('./repositories/AffiliateRepository');
const AffiliateService = require('./services/AffiliateService');

const defaultService = new AffiliateService();

function createAffiliateService(db = null) {
  if (db) {
    return new AffiliateService(new AffiliateRepository(db));
  }
  return defaultService;
}

module.exports = {
  AffiliateRepository,
  AffiliateService,
  defaultService,
  createAffiliateService
};
