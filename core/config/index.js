/**
 * Xentra Core Configuration & Feature Control Module (Milestone C)
 * Unified exports for Configuration Model, Scope, Validator, Access, and Feature Control.
 */
const ConfigurationModel = require('./ConfigurationModel');
const ConfigurationScope = require('./ConfigurationScope');
const ConfigurationValidator = require('./ConfigurationValidator');
const ConfigurationAccess = require('./ConfigurationAccess');
const FeatureControlFoundation = require('./FeatureControlFoundation');

module.exports = {
  ConfigurationModel,
  ConfigurationScope,
  ConfigurationValidator,
  ConfigurationAccess,
  FeatureControlFoundation,

  // Factory Helpers
  createConfigScope: () => new ConfigurationScope(),
  createFeatureControl: (scopeManager) => new FeatureControlFoundation(scopeManager)
};
