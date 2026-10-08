'use strict';

const crypto = require('crypto');
const MaterialRepository = require('../../../core/data/repositories/MaterialRepository');
const UomRepository = require('../../../core/data/repositories/UomRepository');

const materialRepository = new MaterialRepository();
const uomRepository = new UomRepository();

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function text(value, code) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw fail(code);
  return result;
}

class MaterialService {
  static createMaterial({
    organizationId,
    materialCode,
    name,
    description = null,
    baseUomId,
    status = 'DRAFT',
    repository = materialRepository,
    uomRepo = uomRepository
  }) {
    const orgId = text(organizationId, 'ORGANIZATION_REQUIRED');
    const code = text(materialCode, 'MATERIAL_CODE_REQUIRED');
    const materialName = text(name, 'MATERIAL_NAME_REQUIRED');
    const uomId = text(baseUomId, 'MATERIAL_BASE_UOM_REQUIRED');

    const uom = uomRepo.findById(uomId);
    if (!uom || Number(uom.is_active) !== 1) throw fail('MATERIAL_BASE_UOM_INVALID');

    if (repository.findByCode(orgId, code)) throw fail('MATERIAL_CODE_ALREADY_EXISTS');

    const lifecycle = String(status || 'DRAFT').toUpperCase();
    if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(lifecycle)) {
      throw fail('MATERIAL_STATUS_INVALID');
    }

    const now = new Date().toISOString();
    const id = 'mat_' + crypto.randomBytes(8).toString('hex');

    repository.insert({
      id,
      organizationId: orgId,
      materialCode: code,
      name: materialName,
      description,
      baseUomId: uomId,
      status: lifecycle,
      createdAt: now,
      updatedAt: now
    });

    return repository.findById(id);
  }

  static archiveMaterial({ materialId, repository = materialRepository }) {
    const material = repository.findById(materialId);
    if (!material) throw fail('MATERIAL_NOT_FOUND');
    const now = new Date().toISOString();
    repository.updateStatus({ id: materialId, status: 'ARCHIVED', updatedAt: now });
    return repository.findById(materialId);
  }
}

module.exports = MaterialService;
