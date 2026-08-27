const axios = require('axios');

class RouteService {
  /**
   * Calculates straight-line distance in meters between two coordinate points (Haversine formula).
   */
  static calculateHaversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
  }

  /**
   * Calculates actual road distance and estimated driving duration using OSRM.
   * Falls back gracefully to Haversine * 1.3 (estimated road factor) if OSRM is unreachable.
   * 
   * @param {number} originLat - Branch Latitude
   * @param {number} originLng - Branch Longitude
   * @param {number} destLat - Customer Latitude
   * @param {number} destLng - Customer Longitude
   * @returns {Promise<{ distance_meters: number, duration_seconds: number, provider: string }>}
   */
  static async getRoadDistance(originLat, originLng, destLat, destLng) {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`;

    try {
      const response = await axios.get(osrmUrl, { timeout: 4000 });
      if (
        response.data &&
        response.data.code === 'Ok' &&
        response.data.routes &&
        response.data.routes.length > 0
      ) {
        const route = response.data.routes[0];
        return {
          distance_meters: Math.round(route.distance),
          duration_seconds: Math.round(route.duration),
          provider: 'osrm'
        };
      }
    } catch (err) {
      // Log OSRM fallback
      console.warn('[RouteService] OSRM query failed, falling back to Haversine calculation:', err.message);
    }

    // Fallback: Haversine with 1.3x road circuitous factor
    const haversineMeters = this.calculateHaversineMeters(originLat, originLng, destLat, destLng);
    const estimatedRoadMeters = Math.round(haversineMeters * 1.3);
    const estimatedDurationSeconds = Math.round((estimatedRoadMeters / 1000 / 25) * 3600); // 25 km/h avg speed

    return {
      distance_meters: estimatedRoadMeters,
      duration_seconds: estimatedDurationSeconds,
      provider: 'haversine_fallback'
    };
  }

  /**
   * Searches address suggestions using Nominatim OpenStreetMap.
   * 
   * @param {string} query
   * @returns {Promise<Array<{ display_name: string, lat: number, lon: number }>>}
   */
  static async searchAddress(query) {
    if (!query || query.trim().length < 3) return [];

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query
    )}&countrycodes=id&limit=5`;

    try {
      const response = await axios.get(url, {
        timeout: 3000,
        headers: { 'User-Agent': 'Xentra-Food-Ordering-Engine/2.0' }
      });
      return (response.data || []).map((item) => ({
        display_name: item.display_name,
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon)
      }));
    } catch (err) {
      console.error('[RouteService] Geocoding failed:', err.message);
      return [];
    }
  }
}

module.exports = RouteService;
