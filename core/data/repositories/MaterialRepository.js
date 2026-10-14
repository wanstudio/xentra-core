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

  listWithDetails(organizationId, { includeArchived = false, locationId = null } = {}) {
    const statusClause = includeArchived ? "" : "AND m.status <> 'ARCHIVED'";
    const recipeJoin = `
      LEFT JOIN (
        SELECT 
          rc.material_id,
          ROUND(SUM((rc.planned_quantity * COALESCE(pu.conversion_factor, 1.0) / COALESCE(bu.conversion_factor, 1.0)) / COALESCE(NULLIF(rv.planned_yield_quantity, 0), 1)), 4) AS total_resto_usage,
          ROUND(SUM((rc.planned_quantity * COALESCE(pu.conversion_factor, 1.0) / COALESCE(bu.conversion_factor, 1.0)) / COALESCE(NULLIF(rv.planned_yield_quantity, 0), 1)) * 2, 4) AS min_recipe_requirement,
          ROUND(MAX((rc.planned_quantity * COALESCE(pu.conversion_factor, 1.0) / COALESCE(bu.conversion_factor, 1.0)) / COALESCE(NULLIF(rv.planned_yield_quantity, 0), 1)), 4) AS single_portion_usage,
          p.name AS worst_product_name,
          COUNT(DISTINCT pi.output_product_id) AS menu_count
        FROM recipe_components rc
        JOIN materials rm ON rm.id = rc.material_id
        JOIN uoms bu ON bu.id = rm.base_uom_id
        LEFT JOIN uoms pu ON pu.id = rc.planned_uom_id
        JOIN recipe_versions rv ON rv.id = rc.recipe_version_id
        JOIN recipes r ON r.id = rv.recipe_id
        JOIN production_items pi ON pi.id = r.production_item_id
        LEFT JOIN products p ON p.id = pi.output_product_id
        WHERE rv.status = 'PUBLISHED' AND r.status = 'ACTIVE' AND pi.status = 'ACTIVE'
        GROUP BY rc.material_id
      ) rec ON rec.material_id = m.id
    `;

    if (locationId) {
      const sql = `
        SELECT 
          m.id,
          m.organization_id,
          m.material_code,
          m.name,
          m.description,
          m.base_uom_id,
          COALESCE(m.purchase_uom_name, '') AS purchase_uom_name,
          COALESCE(m.purchase_uom_ratio, 1) AS purchase_uom_ratio,
          m.status,
          m.created_at,
          m.updated_at,
          u.name AS base_uom_name,
          u.code AS base_uom_code,
          COALESCE(msb.quantity_base, 0) AS current_stock,
          COALESCE(msb.moving_average_unit_cost, 0) AS moving_average_unit_cost,
          COALESCE(msb.moving_average_unit_cost, 0) AS unit_cost,
          COALESCE(msb.carrying_value, 0) AS carrying_value,
          COALESCE(rp.minimum_quantity, 0) AS minimum_quantity,
          COALESCE(rp.target_quantity, 0) AS target_quantity,
          COALESCE(rec.total_resto_usage, 0) AS total_resto_usage,
          COALESCE(rec.single_portion_usage, 0) AS single_portion_usage,
          COALESCE(rec.min_recipe_requirement, 0) AS min_recipe_requirement,
          rec.worst_product_name,
          COALESCE(rec.menu_count, 0) AS menu_count
        FROM materials m
        JOIN uoms u ON u.id = m.base_uom_id
        LEFT JOIN material_stock_balances msb 
          ON msb.material_id = m.id AND msb.stock_location_id = ?
        LEFT JOIN inventory_reorder_policies rp 
          ON rp.identity_id = m.id AND rp.identity_type = 'MATERIAL' AND rp.stock_location_id = ?
        ${recipeJoin}
        WHERE m.organization_id = ? ${statusClause}
        ORDER BY m.material_code
      `;
      return this.db.queryMany(sql, [locationId, locationId, organizationId]);
    } else {
      const sql = `
        SELECT 
          m.id,
          m.organization_id,
          m.material_code,
          m.name,
          m.description,
          m.base_uom_id,
          COALESCE(m.purchase_uom_name, '') AS purchase_uom_name,
          COALESCE(m.purchase_uom_ratio, 1) AS purchase_uom_ratio,
          m.status,
          m.created_at,
          m.updated_at,
          u.name AS base_uom_name,
          u.code AS base_uom_code,
          COALESCE(msb.quantity_base, 0) AS current_stock,
          COALESCE(msb.moving_average_unit_cost, 0) AS moving_average_unit_cost,
          COALESCE(msb.moving_average_unit_cost, 0) AS unit_cost,
          COALESCE(msb.carrying_value, 0) AS carrying_value,
          COALESCE(rp.minimum_quantity, 0) AS minimum_quantity,
          COALESCE(rp.target_quantity, 0) AS target_quantity,
          COALESCE(rec.total_resto_usage, 0) AS total_resto_usage,
          COALESCE(rec.single_portion_usage, 0) AS single_portion_usage,
          COALESCE(rec.min_recipe_requirement, 0) AS min_recipe_requirement,
          rec.worst_product_name,
          COALESCE(rec.menu_count, 0) AS menu_count
        FROM materials m
        JOIN uoms u ON u.id = m.base_uom_id
        LEFT JOIN (
          SELECT 
            material_id,
            SUM(quantity_base) AS quantity_base,
            AVG(CASE WHEN moving_average_unit_cost > 0 THEN moving_average_unit_cost ELSE NULL END) AS moving_average_unit_cost,
            SUM(carrying_value) AS carrying_value
          FROM material_stock_balances
          GROUP BY material_id
        ) msb ON msb.material_id = m.id
        LEFT JOIN (
          SELECT 
            identity_id,
            MAX(minimum_quantity) AS minimum_quantity,
            MAX(target_quantity) AS target_quantity
          FROM inventory_reorder_policies
          WHERE identity_type = 'MATERIAL'
          GROUP BY identity_id
        ) rp ON rp.identity_id = m.id
        ${recipeJoin}
        WHERE m.organization_id = ? ${statusClause}
        ORDER BY m.material_code
      `;
      return this.db.queryMany(sql, [organizationId]);
    }
  }

  updateDetails({ id, name, description = null, updatedAt }) {
    return this.db.execute(
      'UPDATE materials SET name = ?, description = ?, updated_at = ? WHERE id = ?',
      [name, description, updatedAt, id]
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
