const db = require('../database/db');
const RouteService = require('./RouteService');
const DeliveryCalculator = require('./DeliveryCalculator');
const EligibilityService = require('../../domains/commerce/services/EligibilityService');

class BranchMatcher {
  /**
   * Matches customer coordinates to the nearest eligible branch for a brand.
   * 
   * @param {Object} params
   * @param {string} params.brand_id
   * @param {number} params.customer_lat
   * @param {number} params.customer_lng
   * @param {number} [params.subtotal=0]
   * @returns {Promise<Object>} Nearest branch match result
   */
  static async matchNearestBranch(params) {
    const { brand_id, customer_lat, customer_lng, subtotal = 0, items = [] } = params;

    // C4.3 CUSTOMER LOCATION VALIDATION (server-authoritative input): missing,
    // non-finite or out-of-range coordinates must fail safely and explicitly —
    // never silently match on garbage coordinates or a fabricated fallback
    // location. Range checks are deterministic (lat [-90,90], lng [-180,180]).
    const latNum = Number(customer_lat);
    const lngNum = Number(customer_lng);
    const validLocation =
      customer_lat != null && customer_lng != null &&
      customer_lat !== '' && customer_lng !== '' &&
      Number.isFinite(latNum) && Number.isFinite(lngNum) &&
      latNum >= -90 && latNum <= 90 &&
      lngNum >= -180 && lngNum <= 180;

    if (!validLocation) {
      return {
        eligible: false,
        reason: 'Koordinat alamat pengantaran tidak valid.',
        branch: null,
        delivery: null
      };
    }

    // 1. Candidate discovery for delivery matching.
    // C3 CANONICAL-CONSISTENCY NOTE: the SQL predicates below
    //   (brand scope, is_active = 1, is_open_override = 1, is_delivery_active = 1)
    // are semantically IDENTICAL to the branch-level checks
    // EligibilityService._resolveBranch() performs (BRANCH_NOT_FOUND,
    // BRANCH_NOT_ACTIVE, BRANCH_CLOSED, FULFILLMENT_NOT_SUPPORTED). They are a
    // SAFE CANDIDATE-DISCOVERY OPTIMIZATION, not a second eligibility policy:
    // any branch excluded here would also be excluded by the canonical engine
    // (a missing branch_delivery_settings row -> NULL capability is rejected by
    // both), and every returned branch passes those branch facts, so per-branch
    // evaluateCart() below can only ever disagree on ITEM-level facts. Keeping
    // them in SQL preserves the early "no active delivery branch" result and
    // avoids evaluating cart items on branches the engine could never accept.
    // Selection (nearest/route/fee) stays here, outside EligibilityService.
    let branches = db
      .prepare(`
        SELECT 
          b.id, b.brand_id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone,
          b.is_active, b.is_open_override,
          s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, 
          s.max_radius_km, s.min_order_amount, s.promo_delivery_discount, s.promo_min_order
        FROM branches b
        LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
        WHERE b.brand_id = ? AND b.is_active = 1 AND b.is_open_override = 1 AND s.is_delivery_active = 1
      `)
      .all(brand_id);

    if (!branches || branches.length === 0) {
      return {
        eligible: false,
        reason: 'Maaf, belum ada cabang restoran yang aktif saat ini.',
        branch: null,
        delivery: null
      };
    }

    // C3 CANONICAL ELIGIBILITY (single decision engine): full-cart eligibility is
    // decided by EligibilityService (assignment, master active, branch availability
    // flag, inventory) — never re-implemented inline here.
    // Core v1 invariant: 1 cart -> 1 fulfillment branch. If NO branch can satisfy
    // the COMPLETE cart, the match fails closed instead of silently selecting a
    // branch that cannot fulfill it (no split fulfillment, no automatic rematch).
    if (Array.isArray(items) && items.length > 0) {
      const fullCartBranches = branches.filter((br) =>
        EligibilityService.evaluateCart({
          brand_id,
          branch_id: br.id,
          items,
          order_type: 'delivery'
        }).eligible
      );

      if (fullCartBranches.length > 0) {
        branches = fullCartBranches;
      } else {
        return {
          eligible: false,
          reason: 'Tidak ada cabang yang dapat memenuhi seluruh isi pesanan Anda saat ini.',
          branch: null,
          delivery: null
        };
      }
    }

    // 2. Spatial Pre-Filtering (Haversine straight-line filter)
    // C4.4 CLASSIFICATION: straight-line (Haversine) distance here is a
    // CANDIDATE OPTIMIZATION ONLY. The authoritative radius decision uses ROAD
    // distance via DeliveryCalculator below (branch-level max_radius_km from
    // branch_delivery_settings). The 1.5x pre-filter factor and the existing
    // defaults (`branch.max_radius_km || 30`, `* 1.5 || 25`) are the current
    // delivery-policy approximations — kept unchanged, not re-derived here.
    // C4.8 TOP-N BOUNDARY: only the 3 closest-by-Haversine candidates are road-
    // evaluated (see loop below). Classification: PERFORMANCE OPTIMIZATION WITH
    // BOUNDED CORRECTNESS — a candidate ranked 4th+ by straight line whose road
    // distance is much shorter could in principle be the road-distance winner.
    // Replacing this ranking requires an approved matching-policy decision
    // (reported contract gap); it is not silently redesigned here.
    const candidates = branches
      .map((branch) => {
        const straightMeters = RouteService.calculateHaversineMeters(
          branch.latitude,
          branch.longitude,
          customer_lat,
          customer_lng
        );
        return {
          ...branch,
          straight_distance_meters: straightMeters,
          straight_distance_km: straightMeters / 1000,
          max_delivery_radius_km: branch.max_radius_km || 30,
          promo_config: (branch.promo_delivery_discount && branch.promo_min_order)
            ? { enabled: true, target: branch.promo_min_order, discount: branch.promo_delivery_discount }
            : null
        };
      })
      // Pre-filter out branches whose straight-line distance exceeds 1.5x max radius
      .filter((b) => b.straight_distance_km <= (b.max_delivery_radius_km * 1.5 || 25))
      // Sort by closest straight-line distance first (deterministic tie-break by id)
      .sort((a, b) => {
        const byStraight = a.straight_distance_meters - b.straight_distance_meters;
        if (byStraight !== 0) return byStraight;
        const aid = String(a.id);
        const bid = String(b.id);
        return aid < bid ? -1 : aid > bid ? 1 : 0;
      });

    if (candidates.length === 0) {
      return {
        eligible: false,
        reason: 'Alamat pengantaran berada di luar jangkauan seluruh cabang kami.',
        branch: null,
        delivery: null
      };
    }

    // 3. Resolve Actual Road Distance & Calculate Delivery Fee for Top Candidates
    const evaluatedBranches = [];

    for (const candidate of candidates.slice(0, 3)) { // Evaluate top 3 candidate branches
      const road = await RouteService.getRoadDistance(
        candidate.latitude,
        candidate.longitude,
        customer_lat,
        customer_lng
      );

      const feeCalc = DeliveryCalculator.calculate({
        distance_meters: road.distance_meters,
        free_km: candidate.free_delivery_km,
        price_per_km: candidate.price_per_km,
        max_radius_km: candidate.max_delivery_radius_km,
        subtotal,
        promo_config: candidate.promo_config
      });

      evaluatedBranches.push({
        branch: candidate,
        road_distance: road,
        calculation: feeCalc
      });
    }

    // 4. Find the closest eligible branch
    const eligibleMatches = evaluatedBranches.filter((item) => item.calculation.eligible);

    if (eligibleMatches.length === 0) {
      // Find the closest branch even if ineligible to provide a helpful reason
      const closest = evaluatedBranches[0];
      return {
        eligible: false,
        reason: closest.calculation.reason || 'Di luar jangkauan pengiriman.',
        branch: {
          id: closest.branch.id,
          name: closest.branch.name,
          address: closest.branch.address_text
        },
        delivery: closest.calculation
      };
    }

    // C4.7 DETERMINISTIC WINNER: rank eligible branches by shortest actual ROAD
    // distance, then break ties by branch id — the winner must never depend on
    // database row order or request iteration order.
    eligibleMatches.sort((a, b) => {
      const byDistance = a.calculation.distance_meters - b.calculation.distance_meters;
      if (byDistance !== 0) return byDistance;
      const aid = String(a.branch.id);
      const bid = String(b.branch.id);
      return aid < bid ? -1 : aid > bid ? 1 : 0;
    });

    const winner = eligibleMatches[0];

    return {
      eligible: true,
      branch: {
        id: winner.branch.id,
        name: winner.branch.name,
        slug: winner.branch.slug,
        address: winner.branch.address_text,
        phone: winner.branch.phone
      },
      delivery: {
        distance_meters: winner.calculation.distance_meters,
        distance_km: winner.calculation.distance_km,
        free_km: winner.calculation.free_km,
        price_per_km: winner.calculation.price_per_km,
        chargeable_distance_km: winner.calculation.chargeable_distance_km,
        base_delivery_fee: winner.calculation.base_delivery_fee,
        discount_amount: winner.calculation.discount_amount,
        discount_label: winner.calculation.discount_label,
        final_delivery_fee: winner.calculation.final_delivery_fee,
        // C4.5 NON-SILENT ROUTING: disclose whether the winning distance/ETA came
        // from the routing provider or from the Haversine estimate fallback, so a
        // provider failure can never masquerade as an authoritative route.
        routing_provider: winner.road_distance.provider || 'osrm',
        routing_estimated: (winner.road_distance.provider || 'osrm') !== 'osrm',
        estimated_duration_minutes: Math.max(10, Math.round(winner.road_distance.duration_seconds / 60))
      }
    };
  }
}

module.exports = BranchMatcher;
