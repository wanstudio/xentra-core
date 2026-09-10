'use strict';

/**
 * Shared test helper: installs a controllable XentraConnectorClient mock.
 *
 * Usage in a test file:
 *   const { installConnectorMock, restoreConnectorMock, setConnectorHandler } = require('./helpers/connectorMock');
 *
 *   installConnectorMock();
 *   setConnectorHandler((operation, branchId) => { ... });
 *   // ... tests ...
 *   restoreConnectorMock();
 */

const { XentraConnectorError, SUPPORTED_OPERATIONS, signRequest } = require('../../core/integration/XentraConnectorClient');

const MODULE_PATH = require.resolve('../../core/integration/XentraConnectorClient');
const OriginalModule = require(MODULE_PATH);

let _handler = null;

function installConnectorMock() {
  const MockClient = class {
    constructor() {
      if (!_handler) throw new Error('Connector not configured (test mock)');
    }
    async getCatalog(branchId) { return _handler('catalog.get', branchId); }
    async getBranchOperationalData(branchId) { return _handler('branch.get_operationalData', branchId); }
    async getInventoryAvailability(branchId) { return _handler('inventory.get_availability', branchId); }
    async persistOrder(input) { return _handler('order.persist', input); }
  };

  require.cache[MODULE_PATH] = {
    id: MODULE_PATH,
    filename: MODULE_PATH,
    loaded: true,
    exports: {
      XentraConnectorClient: MockClient,
      XentraConnectorError,
      SUPPORTED_OPERATIONS,
      signRequest
    }
  };
}

function restoreConnectorMock() {
  _handler = null;
  require.cache[MODULE_PATH] = {
    id: MODULE_PATH,
    filename: MODULE_PATH,
    loaded: true,
    exports: OriginalModule
  };
}

function setConnectorHandler(fn) {
  _handler = fn;
}

function makeConnectorNotFound() {
  _handler = () => { throw new Error('should not be called'); };
}

module.exports = { installConnectorMock, restoreConnectorMock, setConnectorHandler, makeConnectorNotFound };
