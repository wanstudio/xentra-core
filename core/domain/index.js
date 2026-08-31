/**
 * Xentra Core Domain Module (Milestone F)
 * Unified exports for Domain Identity, Capabilities, Lifecycle, Registration, and Registry.
 */
const DomainIdentity = require('./DomainIdentity');
const DomainCapability = require('./DomainCapability');
const DomainLifecycle = require('./DomainLifecycle');
const DomainRegistrationModel = require('./DomainRegistrationModel');
const DomainRegistry = require('./DomainRegistry');

module.exports = {
  DomainIdentity,
  DomainCapability,
  DomainLifecycle,
  DomainRegistrationModel,
  DomainRegistry,

  // Factory helper
  createDomainRegistry: () => new (DomainRegistry.DomainRegistry || DomainRegistry)()
};
