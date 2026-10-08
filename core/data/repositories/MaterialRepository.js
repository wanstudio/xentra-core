'use strict';

const DataAccess = require('../DataAccess');

class MaterialRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findById(id) {
    return this.db.queryOne(
      'SELECT id, organization_id, material_code, name, description, base_uom_id, status, created_at, updated_at FROM materials WHERE id = ?',
      [id]
    );
  }

  findByCode(organizationId, materialCode) {
    return this.db.queryOne(
      'SELECT id, organization_id, material_code, name, description, base_uom_id, status, created_at, updated_at FROM materials WHERE organization_id = ? AND lower(trim(material_code)) = lower(trim(?))',
      [organizationId, materialCode]
    );
  }

  listByOrganization(organizationId, { includeArchived = false } = {}) {
    const sql = includeArchived
      ? 'SELECT id, organization_id, material_code, name, description, base_uom_id, status, created_at, updated_at FROM materials WHERE organization_id = ? ORDER BY material_code'
      : "SELECT id, organization_id, material_code, name, description, base_uom_id, status, created_at, updated_at FROM materials WHERE organization_id = ? AND status <> 'ARCHIVED' ORDER BY material_code";
    return this.db.queryMany(sql, [organizationId]);
  }

  insert({ id, organizationId, materialCode, name, description = null, baseUomId, status = 'DRAFT', createdAt, updatedAt }) {
    return this.db.execute(
      'INSERT INTO materials (id, organization_id, material_code, name, description, base_uom_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, organizationId, materialCode, name, description, baseUomId, status, createdAt, updatedAt]
    );
  }

  updateStatus({ id, status, updatedAt }) {
    return this.db.execute(
      'UPDATE materials SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, id]
    );
  }
}

module.exports = MaterialRepository;
