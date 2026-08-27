/**
 * DeliveryCalculator — Single Source of Truth for Delivery Fee Calculation.
 * 
 * Formula:
 * - If distance <= free_km: delivery_fee = 0
 * - If distance > free_km: delivery_fee = (distance_km - free_km) * price_per_km
 * - If distance > max_radius_km (and max_radius_km > 0): delivery is unavailable
 * - Discount is applied on top of the calculated base fee if promo conditions are met.
 */

class DeliveryCalculator {
  /**
   * Calculates delivery fee and eligibility.
   * 
   * @param {Object} params
   * @param {number} params.distance_meters - Actual road distance from OSRM
   * @param {number} params.free_km - Configured free distance
   * @param {number} params.price_per_km - Configured rate per KM
   * @param {number} params.max_radius_km - Maximum allowed delivery radius
   * @param {number} [params.subtotal=0] - Cart subtotal for promo eligibility
   * @param {Object} [params.promo_config=null] - Optional promo rules
   * @returns {Object} Calculation result
   */
  static calculate(params) {
    const meters = Math.max(0, Number(params.distance_meters) || 0);
    const distance_km = Number((meters / 1000).toFixed(2));
    const free_km = Math.max(0, Number(params.free_km) || 0);
    const price_per_km = Math.max(0, Number(params.price_per_km) || 0);
    const max_radius_km = Math.max(0, Number(params.max_radius_km) || 0);
    const subtotal = Math.max(0, Number(params.subtotal) || 0);

    // 1. Check Radius Eligibility
    if (max_radius_km > 0 && distance_km > max_radius_km) {
      return {
        eligible: false,
        reason: `Alamat pengantaran (${distance_km} km) di luar jangkauan maksimal (${max_radius_km} km).`,
        distance_meters: meters,
        distance_km,
        chargeable_distance_km: 0,
        base_delivery_fee: 0,
        discount_amount: 0,
        final_delivery_fee: 0
      };
    }

    // 2. Compute Base Delivery Fee
    let chargeable_distance_km = 0;
    let base_delivery_fee = 0;

    if (distance_km > free_km) {
      chargeable_distance_km = Number((distance_km - free_km).toFixed(2));
      base_delivery_fee = Math.round(chargeable_distance_km * price_per_km);
    }

    // 3. Compute Promo Delivery Discount if applicable
    let discount_amount = 0;
    let discount_label = '';

    if (params.promo_config && params.promo_config.enabled) {
      const target = Number(params.promo_config.target || params.promo_config.min_subtotal) || 0;
      const discount = Number(params.promo_config.discount || params.promo_config.discount_amount) || 0;

      if (target > 0 && discount > 0 && subtotal >= target) {
        discount_amount = Math.min(discount, base_delivery_fee);
        discount_label = params.promo_config.label || 'Diskon Ongkir';
      }
    }

    const final_delivery_fee = Math.max(0, base_delivery_fee - discount_amount);

    return {
      eligible: true,
      distance_meters: meters,
      distance_km,
      free_km,
      price_per_km,
      chargeable_distance_km,
      base_delivery_fee,
      discount_amount,
      discount_label,
      final_delivery_fee
    };
  }
}

module.exports = DeliveryCalculator;
