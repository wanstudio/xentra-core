/**
 * Xentra Core Discovery — Fast Branch Discovery helpers
 *
 * P2 HOME / FAST BRANCH DISCOVERY contract:
 * Home discovery is presentation/discovery ONLY. It uses a cheap
 * straight-line (haversine) proximity computation over the brand's branch
 * list. It never performs road routing, ETA, delivery-cost, payment, stock,
 * eligibility, or acceptance checks on Home.
 *
 * This module stays PURE (no network, no DOM, no localStorage) so the exact
 * ordering/preference logic is unit-testable. Nothing here is transaction
 * authority: ordering may change after reload or interaction, and the first
 * displayed branch is never a fulfillment commitment.
 */
(function () {
  'use strict';

  var EARTH_RADIUS_KM = 6371;

  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function toRad(deg) {
    return Number(deg) * Math.PI / 180;
  }

  /**
   * Straight-line distance in kilometers between two coordinates.
   * Returns null when any coordinate is missing/non-numeric.
   */
  function distanceKm(aLat, aLng, bLat, bLng) {
    var la1 = toNum(aLat), lo1 = toNum(aLng), la2 = toNum(bLat), lo2 = toNum(bLng);
    if (la1 == null || lo1 == null || la2 == null || lo2 == null) return null;

    var dLat = toRad(la2 - la1);
    var dLng = toRad(lo2 - lo1);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(la1)) * Math.cos(toRad(la2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Order branches for discovery presentation.
   *
   * - With a valid origin (latitude/longitude): branches that have valid
   *   coordinates sort by ascending straight-line distance first; branches
   *   without measurable coordinates come last, preserving server order.
   * - Without an origin: the input/server order is preserved untouched.
   *
   * Returns a NEW array of shallow-cloned branches; the input is never
   * mutated. Each returned branch carries `_distance_km` (null when not
   * measurable) which is presentation-only.
   */
  function orderBranches(branches, origin) {
    var list = Array.isArray(branches) ? branches.slice() : [];
    var oLat = toNum(origin && origin.latitude);
    var oLng = toNum(origin && origin.longitude);
    var hasOrigin = oLat != null && oLng != null;

    var enriched = list.map(function (b) {
      var copy = Object.assign({}, b || {});
      copy._distance_km = null;
      if (hasOrigin && copy.latitude != null && copy.longitude != null) {
        copy._distance_km = distanceKm(oLat, oLng, copy.latitude, copy.longitude);
      }
      return copy;
    });

    if (!hasOrigin) return enriched;

    var measurable = enriched.filter(function (b) { return b._distance_km != null; });
    var unmeasurable = enriched.filter(function (b) { return b._distance_km == null; });

    measurable.sort(function (a, b) { return a._distance_km - b._distance_km; });
    return measurable.concat(unmeasurable);
  }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.Discovery = {
    distanceKm: distanceKm,
    orderBranches: orderBranches
  };
})();