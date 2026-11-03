'use strict';

const crypto = require('crypto');
const DataAccess = require('../../../core/data/DataAccess');
const { ensureTheoreticalConsumptionSchema } = require('../schema/TheoreticalConsumptionSchema');

class RecipeConsumptionService {
  /**
   * Resolves active recipes for product IDs in a single query.
   * A Product links to a ProductionItem (output_product_id), which links to an ACTIVE Recipe,
   * which has a PUBLISHED (or highest version) RecipeVersion, containing RecipeComponents.
   *
   * @param {string[]} productIds
   * @param {Object} [db=DataAccess]
   * @returns {Map<string, Object>} Map from product_id to recipe definition with components
   */
  static getRecipesForProducts(productIds = [], db = DataAccess) {
    if (!Array.isArray(productIds) || productIds.length === 0) return new Map();

    const placeholders = productIds.map(() => '?').join(',');
    const query = `
      SELECT 
        pi.output_product_id AS product_id,
        p.name AS product_name,
        r.id AS recipe_id,
        r.name AS recipe_name,
        rv.id AS recipe_version_id,
        rv.version_number,
        rv.planned_yield_quantity,
        yu.conversion_factor AS yield_uom_factor,
        rc.material_id,
        m.name AS material_name,
        m.base_uom_id,
        bu.code AS base_uom_code,
        rc.planned_quantity,
        cu.conversion_factor AS planned_uom_factor,
        bu.conversion_factor AS base_uom_factor
      FROM production_items pi
      JOIN products p ON p.id = pi.output_product_id
      JOIN recipes r ON r.production_item_id = pi.id AND r.status = 'ACTIVE'
      JOIN recipe_versions rv ON rv.recipe_id = r.id AND rv.status = 'PUBLISHED'
      JOIN recipe_components rc ON rc.recipe_version_id = rv.id
      JOIN materials m ON m.id = rc.material_id AND m.status = 'ACTIVE'
      JOIN uoms yu ON yu.id = rv.yield_uom_id
      JOIN uoms cu ON cu.id = rc.planned_uom_id
      JOIN uoms bu ON bu.id = m.base_uom_id
      WHERE pi.output_product_id IN (${placeholders})
      ORDER BY rv.version_number DESC, rc.sort_order ASC
    `;

    const rows = db.queryMany ? db.queryMany(query, productIds) : (db.prepare ? db.prepare(query).all(...productIds) : []);
    const resultMap = new Map();

    for (const row of rows) {
      if (!resultMap.has(row.product_id)) {
        resultMap.set(row.product_id, {
          product_id: row.product_id,
          product_name: row.product_name,
          recipe_id: row.recipe_id,
          recipe_name: row.recipe_name,
          recipe_version_id: row.recipe_version_id,
          version_number: row.version_number,
          planned_yield_quantity: Number(row.planned_yield_quantity || 1),
          yield_uom_factor: Number(row.yield_uom_factor || 1),
          components: []
        });
      }

      // If we already have components for this product from the highest version, keep them
      const recipe = resultMap.get(row.product_id);
      if (recipe.recipe_version_id === row.recipe_version_id) {
        recipe.components.push({
          material_id: row.material_id,
          material_name: row.material_name,
          base_uom_id: row.base_uom_id,
          base_uom_code: row.base_uom_code,
          planned_quantity: Number(row.planned_quantity || 0),
          planned_uom_factor: Number(row.planned_uom_factor || 1),
          base_uom_factor: Number(row.base_uom_factor || 1)
        });
      }
    }

    return resultMap;
  }

  /**
   * Helper to evaluate modifier effect multiplier for a given material.
   * e.g., if material is Ice/Es and modifier contains 'hangat' / 'panas' / 'hot' / 'no ice' / 'tanpa es' -> multiplier = 0
   * e.g., if material is Sugar/Gula and modifier contains 'less sugar' / 'sedikit gula' -> multiplier = 0.5
   * e.g., if material is Sugar/Gula and modifier contains 'no sugar' / 'tanpa gula' -> multiplier = 0
   * e.g., if modifier contains 'extra' for a topping -> multiplier = 1.5 or 2.0
   *
   * @param {string} materialName
   * @param {Array<Object>} modifiers
   * @returns {number} Consumption multiplier (0 to n, default 1.0)
   */
  static evaluateModifierMultiplier(materialName = '', modifiers = []) {
    if (!Array.isArray(modifiers) || modifiers.length === 0) return 1.0;

    const matLower = String(materialName || '').toLowerCase();
    const isIceMaterial = matLower.includes('es') || matLower.includes('ice');
    const isSugarMaterial = matLower.includes('gula') || matLower.includes('sugar') || matLower.includes('sirup') || matLower.includes('syrup');

    let multiplier = 1.0;

    for (const mod of modifiers) {
      const optName = String(mod.option_name || mod.name || mod.label || mod || '').toLowerCase();
      const groupName = String(mod.group_name || mod.group || '').toLowerCase();
      const fullText = `${groupName} ${optName}`;

      // 1. Ice rules
      if (isIceMaterial) {
        if (
          fullText.includes('hangat') ||
          fullText.includes('panas') ||
          fullText.includes('hot') ||
          fullText.includes('no ice') ||
          fullText.includes('tanpa es') ||
          fullText.includes('zero ice')
        ) {
          return 0.0; // Skip ice completely
        }
        if (fullText.includes('less ice') || fullText.includes('sedikit es')) {
          multiplier = Math.min(multiplier, 0.5);
        }
        if (fullText.includes('extra ice') || fullText.includes('banyak es')) {
          multiplier = Math.max(multiplier, 1.5);
        }
      }

      // 2. Sugar rules
      if (isSugarMaterial) {
        if (
          fullText.includes('no sugar') ||
          fullText.includes('tanpa gula') ||
          fullText.includes('zero sugar') ||
          fullText.includes('tawar')
        ) {
          return 0.0; // Skip sugar completely
        }
        if (
          fullText.includes('less sugar') ||
          fullText.includes('sedikit gula') ||
          fullText.includes('half sugar') ||
          fullText.includes('50% sugar')
        ) {
          multiplier = Math.min(multiplier, 0.5);
        }
        if (
          fullText.includes('extra sugar') ||
          fullText.includes('extra manis') ||
          fullText.includes('banyak gula')
        ) {
          multiplier = Math.max(multiplier, 1.5);
        }
      }
    }

    return multiplier;
  }

  /**
   * Processes theoretical material consumption for a placed/settled order.
   * Asynchronous, non-blocking, idempotent per order_id.
   *
   * @param {Object} params
   * @param {string} params.order_id
   * @param {string} params.order_number
   * @param {string} params.branch_id
   * @param {Array<Object>} params.items - order items with product_id, quantity, component_snapshot, modifiers_snapshot
   * @param {Object} [db=DataAccess]
   * @returns {Object} { success: boolean, records_inserted: number, idempotent?: boolean }
   */
  static processOrderTheoreticalConsumption({
    order_id,
    order_number = '',
    branch_id,
    items = []
  }, db = DataAccess) {
    if (!order_id) return { success: false, reason: 'ORDER_ID_REQUIRED' };
    if (!Array.isArray(items) || items.length === 0) return { success: true, records_inserted: 0 };

    ensureTheoreticalConsumptionSchema(db);

    // Idempotency check: if this order was already processed, skip
    const existing = db.queryOne
      ? db.queryOne('SELECT id FROM order_recipe_consumptions WHERE order_id = ? LIMIT 1', [order_id])
      : (db.prepare ? db.prepare('SELECT id FROM order_recipe_consumptions WHERE order_id = ? LIMIT 1').get(order_id) : null);

    if (existing) {
      return { success: true, idempotent: true, records_inserted: 0 };
    }

    // 1. Flatten items into line items with their specific modifiers
    const explodedLines = []; // [{ productId, quantity, name, modifiers }]
    const allProductIds = new Set();

    for (const item of items) {
      const itemQty = Number(item.quantity || 1);

      // Parse modifiers for this item
      let modifiers = [];
      const rawMods = item.modifiers_snapshot || item.options || item.modifiers;
      if (rawMods) {
        if (Array.isArray(rawMods)) {
          modifiers = rawMods;
        } else if (typeof rawMods === 'string') {
          try { modifiers = JSON.parse(rawMods); } catch (_) { modifiers = []; }
        }
      }

      // If Composed Menu, inspect components
      let components = [];
      if (item.component_snapshot) {
        if (Array.isArray(item.component_snapshot)) {
          components = item.component_snapshot;
        } else if (typeof item.component_snapshot === 'string') {
          try { components = JSON.parse(item.component_snapshot); } catch (_) { components = []; }
        }
      }

      if (components.length > 0) {
        for (const comp of components) {
          const compProductId = String(comp.product_id || '').trim();
          const compQty = Number(comp.quantity || 1) * itemQty;
          if (!compProductId) continue;

          allProductIds.add(compProductId);
          explodedLines.push({
            productId: compProductId,
            quantity: compQty,
            name: comp.product_name || comp.name || item.product_name || item.name || 'Component',
            modifiers
          });
        }
      } else {
        // Direct / Single product
        const prodId = String(item.product_id || '').trim();
        if (prodId) {
          allProductIds.add(prodId);
          explodedLines.push({
            productId: prodId,
            quantity: itemQty,
            name: item.product_name || item.name || 'Product',
            modifiers
          });
        }
      }
    }

    const uniqueProductIds = Array.from(allProductIds);
    if (uniqueProductIds.length === 0) return { success: true, records_inserted: 0 };

    // 2. Fetch recipe definitions for all unique products
    const recipesMap = this.getRecipesForProducts(uniqueProductIds, db);
    if (recipesMap.size === 0) {
      return { success: true, records_inserted: 0 };
    }

    // 3. Calculate material requirements with modifier multiplier
    const recordsToInsert = [];
    const now = new Date().toISOString();

    for (const line of explodedLines) {
      const recipe = recipesMap.get(line.productId);
      if (!recipe || !recipe.components || recipe.components.length === 0) continue;

      const orderedQty = line.quantity;
      const plannedYield = recipe.planned_yield_quantity > 0 ? recipe.planned_yield_quantity : 1;
      const batchMultiplier = orderedQty / plannedYield;

      for (const comp of recipe.components) {
        // Evaluate modifier effect on this specific material (e.g. skip ice for hot/hangat)
        const modMultiplier = this.evaluateModifierMultiplier(comp.material_name, line.modifiers);
        if (modMultiplier <= 0) {
          // Explicitly skipped by customer modifier (e.g. No Ice)
          continue;
        }

        // Convert planned_quantity to base UOM
        const plannedInBase = comp.planned_quantity * (comp.planned_uom_factor / (comp.base_uom_factor || 1));
        const totalBaseQty = plannedInBase * batchMultiplier * modMultiplier;

        recordsToInsert.push({
          id: 'orc_' + crypto.randomBytes(8).toString('hex'),
          order_id,
          order_number: order_number || '',
          branch_id: branch_id || '',
          product_id: line.productId,
          product_name: line.name || recipe.product_name,
          recipe_id: recipe.recipe_id,
          recipe_version_id: recipe.recipe_version_id,
          material_id: comp.material_id,
          material_name: comp.material_name,
          consumed_base_qty: totalBaseQty,
          base_uom_id: comp.base_uom_id,
          base_uom_code: comp.base_uom_code || '',
          created_at: now
        });
      }
    }

    if (recordsToInsert.length === 0) {
      return { success: true, records_inserted: 0 };
    }

    // 4. Batch insert into order_recipe_consumptions
    const insertSql = `
      INSERT INTO order_recipe_consumptions (
        id, order_id, order_number, branch_id, product_id, product_name,
        recipe_id, recipe_version_id, material_id, material_name,
        consumed_base_qty, base_uom_id, base_uom_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    if (typeof db.transaction === 'function') {
      const runTx = db.transaction((rows) => {
        const stmt = db.prepare(insertSql);
        for (const row of rows) {
          stmt.run(
            row.id, row.order_id, row.order_number, row.branch_id, row.product_id, row.product_name,
            row.recipe_id, row.recipe_version_id, row.material_id, row.material_name,
            row.consumed_base_qty, row.base_uom_id, row.base_uom_code, row.created_at
          );
        }
      });
      runTx(recordsToInsert);
    } else if (typeof db.execute === 'function') {
      for (const row of recordsToInsert) {
        db.execute(insertSql, [
          row.id, row.order_id, row.order_number, row.branch_id, row.product_id, row.product_name,
          row.recipe_id, row.recipe_version_id, row.material_id, row.material_name,
          row.consumed_base_qty, row.base_uom_id, row.base_uom_code, row.created_at
        ]);
      }
    } else if (typeof db.prepare === 'function') {
      const stmt = db.prepare(insertSql);
      for (const row of recordsToInsert) {
        stmt.run(
          row.id, row.order_id, row.order_number, row.branch_id, row.product_id, row.product_name,
          row.recipe_id, row.recipe_version_id, row.material_id, row.material_name,
          row.consumed_base_qty, row.base_uom_id, row.base_uom_code, row.created_at
        );
      }
    }

    return {
      success: true,
      records_inserted: recordsToInsert.length,
      materials_affected: recordsToInsert.map(r => ({
        material_id: r.material_id,
        material_name: r.material_name,
        consumed_qty: r.consumed_base_qty,
        uom: r.base_uom_code
      }))
    };
  }
}

module.exports = RecipeConsumptionService;
