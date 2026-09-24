'use strict';

/**
 * Xentra Dining Domain Module & Self-Registration
 *
 * Table, dining-session, hold, and recommendation authority.
 * Persistence remains behind Core repositories during the incremental migration.
 */
const { domain } = require('../../core');
const DiningTableService = require('./services/DiningTableService');
const TableRecommendationService = require('./services/TableRecommendationService');

const DINING_IDENTITY = {
  name: 'dining',
  version: '1.0.0',
  display_name: 'Xentra Dining',
  description: 'Dining tables, table holds, dining sessions and table recommendation authority'
};

const DINING_CAPABILITIES = {
  events_produced: [],
  events_consumed: [],
  permissions_required: [],
  features_provided: [
    'table_lifecycle',
    'table_operational_state',
    'table_payment_hold',
    'dining_session_lifecycle',
    'table_session_binding',
    'table_reassignment',
    'table_recommendation'
  ]
};

let registration = null;
try {
  registration = domain.DomainRegistry.register({
    identity: DINING_IDENTITY,
    capabilities: DINING_CAPABILITIES
  });
} catch (e) {
  registration = domain.DomainRegistry.getDomain('dining');
}

module.exports = {
  identity: DINING_IDENTITY,
  capabilities: DINING_CAPABILITIES,
  registration,
  DiningTableService,
  TableRecommendationService
};
