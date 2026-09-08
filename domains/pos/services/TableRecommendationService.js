/**
 * TableRecommendationService
 *
 * Provides authoritative table recommendations for guest counts:
 * 1. Prefer a single available table with sufficient capacity.
 * 2. If no single table suffices, find the best combination of available tables.
 * 3. Spatial closeness derived from euclidean geometric distance (center-to-center).
 * 4. Capacity efficiency: avoid overly large combinations.
 * 5. Returns ONE best recommendation ({ primary_table_id, table_ids, total_capacity, guest_count }).
 */

class TableRecommendationService {
  /**
   * Recommend tables for given guest count in a branch layout.
   *
   * @param {Object} params
   * @param {Array<Object>} params.tables - List of tables from branch with layout & current operational state
   * @param {number} params.guest_count - Number of guests
   * @returns {Object|null} Recommended option or null if cannot satisfy
   */
  static recommendTables({ tables, guest_count }) {
    const guests = Math.max(1, Number(guest_count) || 1);
    if (!Array.isArray(tables) || tables.length === 0) return null;

    // Filter only available tables that are active
    const availableTables = tables.filter(t => {
      const isAct = t.is_active !== 0 && t.is_active !== false;
      const isAvail = t.operational_state === 'available' || t.status === 'available';
      return isAct && isAvail;
    });

    if (availableTables.length === 0) return null;

    // Priority 1: Single table with sufficient capacity
    const singleMatches = availableTables
      .filter(t => (t.capacity || 0) >= guests)
      .sort((a, b) => {
        // Prefer tightest capacity fit (least wasted seats)
        const capDiff = (a.capacity || 0) - (b.capacity || 0);
        if (capDiff !== 0) return capDiff;
        // Then sort by table_number
        return String(a.table_number).localeCompare(String(b.table_number), undefined, { numeric: true });
      });

    if (singleMatches.length > 0) {
      const bestSingle = singleMatches[0];
      return {
        table_ids: [bestSingle.id],
        tables: [bestSingle],
        total_capacity: bestSingle.capacity,
        guest_count: guests,
        combination_type: 'single'
      };
    }

    // Priority 2: Multi-table combination
    // Search combinations of available tables that sum to at least guest_count
    const bestCombo = this._findBestCombination(availableTables, guests);
    if (!bestCombo) return null;

    return {
      table_ids: bestCombo.tables.map(t => t.id),
      tables: bestCombo.tables,
      total_capacity: bestCombo.total_capacity,
      guest_count: guests,
      combination_type: 'multi'
    };
  }

  /**
   * Internal multi-table search using geometric spatial proximity and capacity efficiency
   */
  static _findBestCombination(availableTables, guests) {
    // Generate valid combinations up to all available tables if needed (no arbitrary cap)
    const n = availableTables.length;
    let best = null;

    // Calculate center coordinates for each table
    const tableNodes = availableTables.map(t => {
      const x = Number(t.x || 0);
      const y = Number(t.y || 0);
      const w = Number(t.width || 80);
      const h = Number(t.height || 60);
      return {
        table: t,
        centerX: x + w / 2,
        centerY: y + h / 2,
        capacity: Number(t.capacity || 0)
      };
    });

    function getDistance(a, b) {
      const dx = a.centerX - b.centerX;
      const dy = a.centerY - b.centerY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // Measure average pairwise distance for spatial cluster
    function comboSpread(nodes) {
      if (nodes.length <= 1) return 0;
      let sumDist = 0;
      let pairs = 0;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          sumDist += getDistance(nodes[i], nodes[j]);
          pairs++;
        }
      }
      return sumDist / pairs;
    }

    // Combination generator (sorted by table count first: 2 tables, 3 tables, ...)
    for (let k = 2; k <= n; k++) {
      const combos = [];
      function generate(start, current) {
        if (current.length === k) {
          combos.push([...current]);
          return;
        }
        for (let i = start; i < tableNodes.length; i++) {
          current.push(tableNodes[i]);
          generate(i + 1, current);
          current.pop();
        }
      }
      generate(0, []);

      // Filter combinations that meet capacity
      const validCombos = [];
      for (const c of combos) {
        const totalCap = c.reduce((sum, item) => sum + item.capacity, 0);
        if (totalCap >= guests) {
          const spread = comboSpread(c);
          validCombos.push({
            nodes: c,
            tables: c.map(item => item.table),
            total_capacity: totalCap,
            excess_capacity: totalCap - guests,
            spread
          });
        }
      }

      if (validCombos.length > 0) {
        // Sort by:
        // 1. Minimum excess capacity (efficiency)
        // 2. Minimum spatial spread (geometric closeness)
        validCombos.sort((a, b) => {
          if (a.excess_capacity !== b.excess_capacity) {
            return a.excess_capacity - b.excess_capacity;
          }
          return a.spread - b.spread;
        });

        best = validCombos[0];
        // Since we evaluate smaller k first, we prefer fewer tables if satisfied
        break;
      }
    }

    return best;
  }
}

module.exports = TableRecommendationService;
