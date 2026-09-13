/**
 * Xentra Core Unified Module (G1 Architecture Aggregate)
 * Central entry point exposing all core platform foundations:
 * - Milestone A: Event Infrastructure
 * - Milestone B: Identity & RBAC
 * - Milestone C: Configuration & Feature Control
 * - Milestone D: Integration Foundation
 * - Milestone E: Audit & Activity
 */
const events = require('./events');
const identity = require('./identity');
const config = require('./config');
const integration = require('./integration');
const audit = require('./audit');
const domain = require('./domain');
const data = require('./data');
const media = require('./media');

module.exports = {
  events,
  identity,
  config,
  integration,
  audit,
  domain,
  data,
  media
};
