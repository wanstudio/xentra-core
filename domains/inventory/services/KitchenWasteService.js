'use strict';

const crypto = require('crypto');
const DataAccess = require('../../../core/data/DataAccess');
const { ensureKitchenWasteSchema } = require('../schema/KitchenWasteSchema');

class KitchenWasteService {
  /**
   * Records a kitchen/bar waste event (spoilage, dropped, burnt, re-cook).
   * Deducts physical material balance or branch product stock and inserts an audit log.
   *
   * @param {Object} params
   * @param {string} params.branchId
   * @param {string} params.itemType - 'MATERIAL' | 'PRODUCT'
   * @param {string} params.itemId
   * @param {number} params.quantity
   * @param {string} params.reasonCode - 'BURNT_COOKING_ERROR' | 'SPOILED_EXPIRED' | 'DROPPED_CONTAMINATED' | 'CUSTOMER_COMPLAINT_RECOOK' | 'OTHER'
   * @param {string} [params.notes]
   * @param {string} params.reportedBy - User ID
   * @param {Object} [db=DataAccess]
   * @returns {Object} { success: boolean, waste_log_id: string, new_stock: number, cost_amount: number }
   */
  static recordWaste(params, db = DataAccess) {
    const record = () => KitchenWasteService._recordWaste(params || {}, db);
    if (typeof db.exec !== 'function') return record();

    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const result = record();
      db.exec('COMMIT;');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw err;
    }
  }

  static _recordWaste({
    branchId,
    itemType = 'MATERIAL',
    itemId,
    quantity,
    reasonCode = 'BURNT_COOKING_ERROR',
    notes = '',
    reportedBy
  }, db) {
    if (!branchId) throw new Error('[KitchenWasteService] branchId is required.');
    if (!itemId) throw new Error('[KitchenWasteService] itemId is required.');
    if (!reportedBy) throw new Error('[KitchenWasteService] reportedBy is required.');

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('[KitchenWasteService] quantity must be a positive number.');
    }

    const validReasons = ['BURNT_COOKING_ERROR', 'SPOILED_EXPIRED', 'DROPPED_CONTAMINATED', 'CUSTOMER_COMPLAINT_RECOOK', 'OTHER'];
    if (!validReasons.includes(reasonCode)) {
      throw new Error('[KitchenWasteService] reasonCode tidak valid.');
    }

    ensureKitchenWasteSchema(db);

    const now = new Date().toISOString();
    const wasteLogId = 'kwl_' + crypto.randomBytes(8).toString('hex');
    let itemName = '';
    let uomCode = '';
    let costAmount = 0;
    let newStock = 0;

    const normalizedItemType = String(itemType || 'MATERIAL').toUpperCase();
    if (!['MATERIAL', 'PRODUCT'].includes(normalizedItemType)) {
      throw new Error('[KitchenWasteService] itemType must be MATERIAL or PRODUCT.');
    }

    if (normalizedItemType === 'MATERIAL') {
      // 1. Fetch material & UOM
      const matQuery = `
        SELECT m.id, m.name, bu.code AS base_uom_code
        FROM materials m
        JOIN uoms bu ON bu.id = m.base_uom_id
        JOIN branches b ON b.id = ?
        JOIN brands br ON br.id = b.brand_id AND br.organization_id = m.organization_id
        WHERE m.id = ? AND m.status = 'ACTIVE'
      `;
      const mat = db.queryOne ? db.queryOne(matQuery, [branchId, itemId]) : (db.prepare ? db.prepare(matQuery).get(branchId, itemId) : null);
      if (!mat) throw new Error('[KitchenWasteService] Bahan baku tidak ditemukan.');

      itemName = mat.name;
      uomCode = mat.base_uom_code;

      // 2. Fetch stock location for branch
      const locQuery = "SELECT id FROM stock_locations WHERE branch_id = ? AND location_type = 'BRANCH' AND is_active = 1 ORDER BY id";
      const locations = db.queryMany ? db.queryMany(locQuery, [branchId]) : (db.prepare ? db.prepare(locQuery).all(branchId) : []);
      if (!locations.length) throw new Error('[KitchenWasteService] Lokasi stok cabang belum aktif.');
      if (locations.length > 1) throw new Error('[KitchenWasteService] Cabang memiliki lebih dari satu lokasi stok aktif.');
      const loc = locations[0];

      {
        const balQuery = `
          SELECT quantity_base, carrying_value, moving_average_unit_cost, valuation_version
          FROM material_stock_balances
          WHERE stock_location_id = ? AND material_id = ?
        `;
        const bal = db.queryOne ? db.queryOne(balQuery, [loc.id, itemId]) : (db.prepare ? db.prepare(balQuery).get(loc.id, itemId) : null);
        if (!bal) throw new Error('[KitchenWasteService] Saldo bahan belum dicatat; lakukan opname sebelum mencatat waste.');
        {
          const currentQty = Number(bal.quantity_base || 0);
          if (qty > currentQty + 1e-9) {
            throw new Error('[KitchenWasteService] Jumlah waste melebihi stok bahan yang tercatat.');
          }
          const unitCost = Number(bal.moving_average_unit_cost || 0);
          newStock = Number((currentQty - qty).toFixed(6));
          costAmount = Number((qty * unitCost).toFixed(4));
          const newCarryingVal = Number((newStock * unitCost).toFixed(4));
          // Query monotonic valuation version for material_stock_movements
          const maxMovQuery = `
            SELECT MAX(valuation_version) AS max_v
            FROM material_stock_movements
            WHERE stock_location_id = ? AND material_id = ?
          `;
          const maxRow = db.queryOne ? db.queryOne(maxMovQuery, [loc.id, itemId]) : (db.prepare ? db.prepare(maxMovQuery).get(loc.id, itemId) : null);
          const newMovVer = ((maxRow && maxRow.max_v != null) ? Number(maxRow.max_v) : 0) + 1;

          // Update material balance
          const updateBalSql = `
            UPDATE material_stock_balances
            SET quantity_base = ?, carrying_value = ?, valuation_version = ?, updated_at = ?
            WHERE stock_location_id = ? AND material_id = ?
          `;
          if (db.execute) {
            db.execute(updateBalSql, [newStock, newCarryingVal, newMovVer, now, loc.id, itemId]);
          } else if (db.prepare) {
            db.prepare(updateBalSql).run(newStock, newCarryingVal, newMovVer, now, loc.id, itemId);
          }

          // Insert material stock movement (WASTE)
          const movSql = `
            INSERT INTO material_stock_movements (
              id, stock_location_id, material_id, movement_type, quantity_base,
              previous_quantity, current_quantity, unit_cost, total_cost, currency_code,
              valuation_method, cost_basis_type, source_type, source_reference,
              posting_mutation_id, valuation_version, posting_timestamp, actor_id, notes, created_at
            ) VALUES (?, ?, ?, 'WASTE', ?, ?, ?, ?, ?, 'IDR', 'MOVING_AVERAGE', 'CURRENT_MOVING_AVERAGE', 'KITCHEN_WASTE', ?, ?, ?, ?, ?, ?, ?)
          `;
          const movId = 'msm_' + crypto.randomBytes(8).toString('hex');
          const movParams = [
            movId, loc.id, itemId, -qty, currentQty, newStock, unitCost, -costAmount,
            wasteLogId, wasteLogId + ':waste', newMovVer, now, reportedBy, notes || reasonCode, now
          ];
          if (db.execute) db.execute(movSql, movParams);
          else if (db.prepare) db.prepare(movSql).run(...movParams);
        }
      }
    } else {
      // Direct Product / Finished Good
      const prodQuery = 'SELECT p.id, p.name FROM products p JOIN branches b ON b.id = ? AND b.brand_id = p.brand_id WHERE p.id = ?';
      const prod = db.queryOne ? db.queryOne(prodQuery, [branchId, itemId]) : (db.prepare ? db.prepare(prodQuery).get(branchId, itemId) : null);
      if (!prod) throw new Error('[KitchenWasteService] Produk tidak ditemukan.');

      itemName = prod.name;
      uomCode = 'pcs';

      // Update branch_products stock
      const bpQuery = 'SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?';
      const bp = db.queryOne ? db.queryOne(bpQuery, [branchId, itemId]) : (db.prepare ? db.prepare(bpQuery).get(branchId, itemId) : null);
      if (!bp) throw new Error('[KitchenWasteService] Stok produk cabang tidak ditemukan.');
      {
        const curStock = Number(bp.stock || 0);
        if (qty > curStock + 1e-9) {
          throw new Error('[KitchenWasteService] Jumlah waste melebihi stok produk yang tercatat.');
        }
        newStock = Number((curStock - qty).toFixed(6));
        const updateBpSql = 'UPDATE branch_products SET stock = ?, updated_at = ? WHERE branch_id = ? AND product_id = ?';
        if (db.execute) db.execute(updateBpSql, [newStock, now, branchId, itemId]);
        else if (db.prepare) db.prepare(updateBpSql).run(newStock, now, branchId, itemId);
      }
    }

    // 3. Insert into kitchen_waste_logs
    const insertLogSql = `
      INSERT INTO kitchen_waste_logs (
        id, branch_id, item_type, item_id, item_name, quantity, uom_code,
        reason_code, reason_notes, cost_amount, reported_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const logParams = [
      wasteLogId, branchId, normalizedItemType, itemId, itemName, qty, uomCode,
      reasonCode, notes, costAmount, reportedBy, now
    ];

    if (db.execute) db.execute(insertLogSql, logParams);
    else if (db.prepare) db.prepare(insertLogSql).run(...logParams);

    return {
      success: true,
      waste_log_id: wasteLogId,
      item_name: itemName,
      quantity_wasted: qty,
      uom: uomCode,
      new_stock: newStock,
      cost_amount: costAmount
    };
  }

  /**
   * Retrieves waste logs for a specific branch.
   */
  static getBranchWasteLogs({ branchId, limit = 50 }, db = DataAccess) {
    if (!branchId) return [];
    ensureKitchenWasteSchema(db);

    const query = `
      SELECT *
      FROM kitchen_waste_logs
      WHERE branch_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;
    return db.queryMany ? db.queryMany(query, [branchId, limit]) : (db.prepare ? db.prepare(query).all(branchId, limit) : []);
  }
}

module.exports = KitchenWasteService;
