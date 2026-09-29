'use strict';

const crypto = require('crypto');
const {
  MasterMenuCompositionRepository,
  definition
} = require('../repositories/MasterMenuCompositionRepository');

const repository = new MasterMenuCompositionRepository();

function makeId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '');
}

function normalizeType(type) {
  return String(type || '').trim().toLowerCase();
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw new Error('INVALID_BOOLEAN');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

class MasterMenuCompositionService {
  static listComponents({ brandId, type, activeOnly = false }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    return repository.listComponents({ brandId, type: normalizeType(type), activeOnly });
  }

  static createComponent({ brandId, type, name, slug = null, sortOrder = null }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const normalizedType = normalizeType(type);
    const prefix = normalizedType === 'flavor' ? 'flv' : normalizedType === 'complement' ? 'cmp' : 'lvl';
    const id = makeId(prefix);
    const normalizedSlug = slugify(slug || name);
    try {
      repository.createComponent({
        brandId,
        type: normalizedType,
        id,
        name,
        slug: normalizedSlug,
        sortOrder
      });
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(String(err && err.message))) {
        throw new Error('MENU_COMPONENT_ALREADY_EXISTS');
      }
      throw err;
    }
    return repository.findComponent({ brandId, type: normalizedType, componentId: id });
  }

  static updateComponent({ brandId, type, componentId, name, slug, sortOrder, isActive }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const normalizedType = normalizeType(type);
    try {
      const updated = repository.updateComponent({
        brandId,
        type: normalizedType,
        componentId,
        name,
        slug: slug === undefined ? undefined : slugify(slug || name),
        sortOrder,
        isActive: isActive === undefined ? undefined : normalizeBoolean(isActive, true)
      });
      if (!updated) throw new Error('MENU_COMPONENT_NOT_FOUND');
      return updated;
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(String(err && err.message))) {
        throw new Error('MENU_COMPONENT_ALREADY_EXISTS');
      }
      throw err;
    }
  }

  static toggleComponent({ brandId, type, componentId }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const normalizedType = normalizeType(type);
    const updated = repository.toggleComponent({ brandId, type: normalizedType, componentId });
    if (!updated) throw new Error('MENU_COMPONENT_NOT_FOUND');
    return updated;
  }

  static deleteComponent({ brandId, type, componentId }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const normalizedType = normalizeType(type);
    return repository.deleteComponent({ brandId, type: normalizedType, componentId });
  }

  static getComposition({ brandId, productId }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    const composition = repository.findComposition({ brandId, productId });
    if (!composition) throw new Error('MASTER_PRODUCT_NOT_FOUND');
    return composition;
  }

  static saveComposition({ brandId, productId, categoryId, flavorId = null, complementIds = [], levelId = null }) {
    if (!brandId) throw new Error('BRAND_CONTEXT_REQUIRED');
    if (!productId) throw new Error('MASTER_PRODUCT_REQUIRED');
    return repository.replaceComposition({
      brandId,
      productId,
      categoryId,
      flavorId,
      complementIds,
      levelId
    });
  }

  static validateType(type) {
    return definition(normalizeType(type)).key;
  }
}

module.exports = MasterMenuCompositionService;
