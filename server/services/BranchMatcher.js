const db = require('../../core/data/DataAccess');
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
      .filter((b) => b.straight_distance_km <= (b.max_delivery_radius_km * 1.5 || 25))
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

    const evaluatedBranches = [];

    for (const candidate of candidates.slice(0, 3)) {
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

    const eligibleMatches = evaluatedBranches.filter((item) => item.calculation.eligible);

    if (eligibleMatches.length === 0) {
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
        routing_provider: winner.road_distance.provider || 'osrm',
        routing_estimated: (winner.road_distance.provider || 'osrm') !== 'osrm',
        estimated_duration_minutes: Math.max(10, Math.round(winner.road_distance.duration_seconds / 60))
      }
    };
  }
}

module.exports = BranchMatcher;
