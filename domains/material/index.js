'use strict';

const MaterialService = require('./services/MaterialService');
const { generateMaterialPrefix, generateMaterialCode } = require('./utils/materialCodeGenerator');

module.exports = {
  MaterialService,
  generateMaterialPrefix,
  generateMaterialCode
};
