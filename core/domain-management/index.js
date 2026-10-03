'use strict';

const DomainVerificationService = require('./DomainVerificationService');
const { DomainProvisioningService, MockEdgeAdapter } = require('./DomainProvisioningService');

module.exports = {
  DomainVerificationService,
  DomainProvisioningService,
  MockEdgeAdapter
};
