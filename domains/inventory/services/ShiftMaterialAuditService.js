'use strict';

const crypto = require('crypto');
const DataAccess = require('../../../core/data/DataAccess');
const { ensureShiftMaterialAuditSchema } = require('../schema/ShiftMaterialAuditSchema');
const { ensureTheoreticalConsumptionSchema } = require('../schema/TheoreticalConsumptionSchema');

class ShiftMaterialAuditService {
  /**
   * Retrieves the blind list of materials that should be audited for a shift.
   * STRICT BLIND POLICY: Returns only identity, code, and UOM.
   * Current physical quantity or theoretical system quantity is intentionally NOT exposed
   * to prevent staff from copying system figures.
   *
   * @param {Object} params
   * @param {string} params.branchId
   * @param {Object} [db=DataAccess]
   * @returns {Array<Object>} Blind material checklist: [{ material_id, material_code, material_name, base_uom_code }]
   */
  static getBlindAuditChecklist({ branchId }, db = DataAccess) {
    if (!branchId) throw new Error('[ShiftMaterialAuditService] branchId is required.');

    const query = `
      SELECT DISTINCT
        m.id AS material_id,
        m.material_code,
        m.name AS material_name,
        bu.code AS base_uom_code,
        bu.name AS base_uom_name
      FROM materials m
      JOIN uoms bu ON bu.id = m.base_uom_id
      JOIN stock_locations sl ON sl.organization_id = m.organization_id
      WHERE sl.branch_id = ? AND m.status = 'ACTIVE' AND sl.is_active = 1
      ORDER BY m.name ASC
    `;

    return db.queryMany ? db.queryMany(query, [branchId]) : (db.prepare ? db.prepare(query).all(branchId) : []);
  }

  /**
   * Records physical stock count counts at shift closing, calculates variance
   * against theoretical consumption, and persists the audit trail.
   *
   * @param {Object} params
   * @param {string} params.shiftId
   * @param {string} params.branchId
   * @param {string} params.actorId
   * @param {Array<{ material_id: string, actual_qty: number }>} params.counts
   * @param {Object} [db=DataAccess]
   * @returns {Object} { success: boolean, audits: Array<Object>, summary: { total_items, balanced, surplus, deficit } }
   */
  static submitShiftMaterialAudit({
    shiftId,
    branchId,
    actorId = null,
    counts = []
  }, db = DataAccess) {
    if (!shiftId) throw new Error('[ShiftMaterialAuditService] shiftId is required.');
    if (!branchId) throw new Error('[ShiftMaterialAuditService] branchId is required.');
    if (!Array.isArray(counts) || counts.length === 0) {
      return { success: true, audits: [], summary: { total_items: 0, balanced: 0, surplus: 0, deficit: 0 } };
    }

    ensureShiftMaterialAuditSchema(db);
    ensureTheoreticalConsumptionSchema(db);

    // 1. Fetch shift details to know the time window
    const shiftQuery = 'SELECT id, branch_id, opened_at, closed_at FROM pos_shifts WHERE id = ?';
    const shift = db.queryOne ? db.queryOne(shiftQuery, [shiftId]) : (db.prepare ? db.prepare(shiftQuery).get(shiftId) : null);
    if (!shift) throw new Error('[ShiftMaterialAuditService] Shift tidak ditemukan.');

    const openedAt = shift.opened_at;
    const closedAt = shift.closed_at || new Date().toISOString();

    // 2. Fetch stock location for branch
    const locQuery = 'SELECT id FROM stock_locations WHERE branch_id = ? AND is_active = 1 LIMIT 1';
    const stockLoc = db.queryOne ? db.queryOne(locQuery, [branchId]) : (db.prepare ? db.prepare(locQuery).get(branchId) : null);
    const stockLocationId = stockLoc ? stockLoc.id : null;

    // 3. For each counted material, evaluate:
    // starting_qty (from balance) + theoretical consumption during shift
    const auditRows = [];
    const now = new Date().toISOString();

    for (const item of counts) {
      const materialId = String(item.material_id || '').trim();
      const actualQty = Number(item.actual_qty);
      if (!materialId || !Number.isFinite(actualQty) || actualQty < 0) continue;

      // Material identity
      const matQuery = `
        SELECT m.id, m.material_code, m.name, bu.code AS base_uom_code
        FROM materials m
        JOIN uoms bu ON bu.id = m.base_uom_id
        WHERE m.id = ?
      `;
      const mat = db.queryOne ? db.queryOne(matQuery, [materialId]) : (db.prepare ? db.prepare(matQuery).get(materialId) : null);
      if (!mat) continue;

      // Current balance in stock_location
      let currentBalQty = 0;
      if (stockLocationId) {
        const balQuery = 'SELECT quantity_base FROM material_stock_balances WHERE stock_location_id = ? AND material_id = ?';
        const bal = db.queryOne ? db.queryOne(balQuery, [stockLocationId, materialId]) : (db.prepare ? db.prepare(balQuery).get(stockLocationId, materialId) : null);
        if (bal) currentBalQty = Number(bal.quantity_base || 0);
      }

      // Theoretical consumption during this shift window
      const consQuery = `
        SELECT COALESCE(SUM(consumed_base_qty), 0) AS total_consumed
        FROM order_recipe_consumptions
        WHERE branch_id = ? AND material_id = ? AND created_at >= ? AND created_at <= ?
      `;
      const consRow = db.queryOne
        ? db.queryOne(consQuery, [branchId, materialId, openedAt, closedAt])
        : (db.prepare ? db.prepare(consQuery).get(branchId, materialId, openedAt, closedAt) : null);

      const consumedQty = consRow ? Number(consRow.total_consumed || 0) : 0;

      // Expected qty = starting/current balance minus theoretical consumption
      // If current balance is already updated post-production, expected = currentBalQty.
      // If tracking against starting: expected = Math.max(0, currentBalQty - consumedQty)
      const expectedQty = Math.max(0, currentBalQty - consumedQty);
      const varianceQty = Number((actualQty - expectedQty).toFixed(4));

      let status = 'BALANCED';
      if (varianceQty > 0.0001) status = 'SURPLUS';
      else if (varianceQty < -0.0001) status = 'DEFICIT';

      auditRows.push({
        id: 'sma_' + crypto.randomBytes(8).toString('hex'),
        shift_id: shiftId,
        branch_id: branchId,
        stock_location_id: stockLocationId,
        material_id: mat.id,
        material_code: mat.material_code,
        material_name: mat.name,
        base_uom_code: mat.base_uom_code,
        starting_qty: currentBalQty,
        consumed_qty: consumedQty,
        expected_qty: expectedQty,
        actual_qty: actualQty,
        variance_qty: varianceQty,
        status,
        audited_by: actorId,
        created_at: now
      });
    }

    if (auditRows.length === 0) {
      return { success: true, audits: [], summary: { total_items: 0, balanced: 0, surplus: 0, deficit: 0 } };
    }

    // 4. Batch insert into shift_material_audits
    const insertSql = `
      INSERT INTO shift_material_audits (
        id, shift_id, branch_id, stock_location_id, material_id, material_code, material_name,
        base_uom_code, starting_qty, consumed_qty, expected_qty, actual_qty, variance_qty, status, audited_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    if (typeof db.transaction === 'function') {
      const runTx = db.transaction((rows) => {
        const stmt = db.prepare(insertSql);
        for (const r of rows) {
          stmt.run(
            r.id, r.shift_id, r.branch_id, r.stock_location_id, r.material_id, r.material_code, r.material_name,
            r.base_uom_code, r.starting_qty, r.consumed_qty, r.expected_qty, r.actual_qty, r.variance_qty, r.status, r.audited_by, r.created_at
          );
        }
      });
      runTx(auditRows);
    } else if (typeof db.prepare === 'function') {
      const stmt = db.prepare(insertSql);
      for (const r of auditRows) {
        stmt.run(
          r.id, r.shift_id, r.branch_id, r.stock_location_id, r.material_id, r.material_code, r.material_name,
          r.base_uom_code, r.starting_qty, r.consumed_qty, r.expected_qty, r.actual_qty, r.variance_qty, r.status, r.audited_by, r.created_at
        );
      }
    }

    const summary = {
      total_items: auditRows.length,
      balanced: auditRows.filter(r => r.status === 'BALANCED').length,
      surplus: auditRows.filter(r => r.status === 'SURPLUS').length,
      deficit: auditRows.filter(r => r.status === 'DEFICIT').length
    };

    return {
      success: true,
      audits: auditRows,
      summary
    };
  }

  /**
   * Retrieves audit results for a specific shift.
   */
  static getShiftAudits(shiftId, db = DataAccess) {
    if (!shiftId) return [];
    ensureShiftMaterialAuditSchema(db);
    const query = `
      SELECT *
      FROM shift_material_audits
      WHERE shift_id = ?
      ORDER BY material_name ASC
    `;
    return db.queryMany ? db.queryMany(query, [shiftId]) : (db.prepare ? db.prepare(query).all(shiftId) : []);
  }
}

module.exports = ShiftMaterialAuditService;
