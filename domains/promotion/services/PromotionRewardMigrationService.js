'use strict';

/**
 * Legacy promotion reward target migration.
 *
 * Legacy reward rows point at Product IDs. A Product can now back multiple
 * commercial Menus, so migration must never guess which Menu was intended.
 *
 * Safe auto-migration is limited to an ACTIVE Menu Satuan whose only component
 * is the legacy Product. Multiple matches or no match remain NEEDS_REVIEW.
 */
const DataAccess = require('../../../core/data/DataAccess');

function buildProductCandidates(db, brandId, productId) {
  return db.queryMany(`
    SELECT
      m.id AS menu_id,
      m.menu_type,
      m.status,
      m.package_name,
      m.selling_price,
      COUNT(mi.product_id) AS component_count,
      SUM(CASE WHEN mi.product_id = ? AND mi.quantity = 1 THEN 1 ELSE 0 END) AS matching_single_component
    FROM menus m
    JOIN menu_items mi ON mi.menu_id = m.id
    WHERE m.brand_id = ?
      AND m.menu_type = 'SINGLE'
      AND m.status = 'ACTIVE'
    GROUP BY m.id
    HAVING component_count = 1 AND matching_single_component = 1
    ORDER BY m.id ASC
  `, [productId, brandId]);
}

class PromotionRewardMigrationService {
  static plan({ brandId = null, promotionId = null } = {}) {
    const clauses = [
      'r.target_product_id IS NOT NULL',
      "(r.target_menu_id IS NULL OR trim(r.target_menu_id) = '')"
    ];
    const params = [];

    if (brandId) {
      clauses.push('p.brand_id = ?');
      params.push(brandId);
    }
    if (promotionId) {
      clauses.push('r.promotion_id = ?');
      params.push(promotionId);
    }

    const rows = DataAccess.queryMany(`
      SELECT r.id AS reward_id, r.promotion_id, r.target_product_id, p.brand_id, p.name AS promotion_name
      FROM promotion_rewards r
      JOIN promotions p ON p.id = r.promotion_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY r.created_at ASC, r.id ASC
    `, params);

    return rows.map(row => {
      const candidates = buildProductCandidates(DataAccess, row.brand_id, row.target_product_id);
      if (candidates.length === 1) {
        return {
          status: 'SAFE_TO_MIGRATE',
          reward_id: row.reward_id,
          promotion_id: row.promotion_id,
          brand_id: row.brand_id,
          target_product_id: row.target_product_id,
          target_menu_id: candidates[0].menu_id,
          reason: 'Exactly one active Menu Satuan maps to the legacy Product target.'
        };
      }

      return {
        status: 'NEEDS_REVIEW',
        reward_id: row.reward_id,
        promotion_id: row.promotion_id,
        brand_id: row.brand_id,
        target_product_id: row.target_product_id,
        target_menu_id: null,
        reason: candidates.length === 0
          ? 'No active Menu Satuan uniquely maps to the legacy Product target.'
          : 'Multiple active Menu Satuan records map to the same Product target; migration must not guess.'
      };
    });
  }

  static apply({ brandId = null, promotionId = null } = {}) {
    const plan = this.plan({ brandId, promotionId });
    const applied = [];
    const skipped = [];

    DataAccess.exec('BEGIN IMMEDIATE');
    try {
      for (const entry of plan) {
        if (entry.status !== 'SAFE_TO_MIGRATE') {
          skipped.push(entry);
          continue;
        }

        DataAccess.execute(`
          UPDATE promotion_rewards
          SET target_menu_id = ?, target_product_id = NULL
          WHERE id = ?
            AND target_menu_id IS NULL
        `, [entry.target_menu_id, entry.reward_id]);

        const verified = DataAccess.queryOne(
          'SELECT target_menu_id FROM promotion_rewards WHERE id = ?',
          [entry.reward_id]
        );

        if (verified && String(verified.target_menu_id) === String(entry.target_menu_id)) {
          applied.push(entry);
        } else {
          skipped.push({
            ...entry,
            status: 'NEEDS_REVIEW',
            reason: 'Reward row changed during migration or could not be updated safely.'
          });
        }
      }

      DataAccess.exec('COMMIT');
    } catch (err) {
      try { DataAccess.exec('ROLLBACK'); } catch (_) {}
      throw err;
    }

    return {
      total: plan.length,
      applied,
      skipped
    };
  }
}

module.exports = PromotionRewardMigrationService;
