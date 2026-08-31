/**
 * Xentra Core Integration Foundation Module (Milestone D)
 * Unified exports for contracts, adapters, failure classifiers, secrets, and observers.
 */
const IntegrationContract = require('./IntegrationContract');
const BaseAdapter = require('./BaseAdapter');
const ExternalRequestHandler = require('./ExternalRequestHandler');
const FailureClassifier = require('./FailureClassifier');
const SecretBoundary = require('./SecretBoundary');
const ChannelMapper = require('./ChannelMapper');
const IntegrationObserver = require('./IntegrationObserver');
const WablasAdapter = require('./adapters/WablasAdapter');
const HardwarePrinterAdapter = require('./adapters/HardwarePrinterAdapter');

module.exports = {
  IntegrationContract,
  BaseAdapter,
  ExternalRequestHandler,
  FailureClassifier,
  SecretBoundary,
  ChannelMapper,
  IntegrationObserver,
  WablasAdapter,
  HardwarePrinterAdapter,

  // Factory helper
  createIntegrationHandler: (observer) => new ExternalRequestHandler(observer),
  createChannelMapper: () => new ChannelMapper()
};
