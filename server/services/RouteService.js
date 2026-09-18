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
   * Searches for address suggestions using Nominatim with optional proximity bias and distance ranking.
   * 
   * @param {string} query
   * @param {number|string} [proximityLat]
   * @param {number|string} [proximityLon]
   * @returns {Promise<Array<{ display_name: string, title: string, address: string, latitude: number, longitude: number, distance_meters?: number }>>}
   */
  static async searchAddress(query, proximityLat, proximityLon) {
    if (!query || query.trim().length < 3) return [];

    let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query.trim()
    )}&countrycodes=id&limit=15`;

    const pLat = proximityLat != null && !isNaN(Number(proximityLat)) ? Number(proximityLat) : null;
    const pLon = proximityLon != null && !isNaN(Number(proximityLon)) ? Number(proximityLon) : null;

    if (pLat !== null && pLon !== null) {
      // Bias towards ~1 degree bounding box (~110km) around current location
      const delta = 1.0;
      const viewbox = `${pLon - delta},${pLat + delta},${pLon + delta},${pLat - delta}`;
      url += `&viewbox=${viewbox}&bounded=0`;
    }

    try {
      const response = await axios.get(url, {
        timeout: 4000,
        headers: { 'User-Agent': 'Xentra-Food-Ordering-Engine/2.0' }
      });

      const list = (response.data || []).map((item) => {
        const itemLat = parseFloat(item.lat);
        const itemLon = parseFloat(item.lon);
        const parts = (item.display_name || '').split(',');
        const title = (parts[0] || item.display_name || 'Lokasi').trim();
        const address = parts.slice(1).join(',').trim() || item.display_name || '';

        const record = {
          display_name: item.display_name,
          title: title,
          address: address,
          latitude: itemLat,
          longitude: itemLon
        };

        if (pLat !== null && pLon !== null) {
          record.distance_meters = this.calculateHaversineMeters(pLat, pLon, itemLat, itemLon);
        }

        return record;
      });

      if (pLat !== null && pLon !== null) {
        list.sort((a, b) => (a.distance_meters || 0) - (b.distance_meters || 0));
      }

      return list.slice(0, 8);
    } catch (err) {
      console.error('[RouteService] Geocoding search failed:', err.message);
      return [];
    }
  }

  /**
   * Reverse geocodes coordinates into human-readable address.
   * Prioritizes Mapbox Search Box Reverse for high-accuracy Indonesian POIs & roads,
   * falling back gracefully to Mapbox Geocoding v6, Nominatim, and coordinate formatting.
   * 
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<{ address: string, display_name: string, title?: string, road?: string, neighborhood?: string, locality?: string, city?: string, provider?: string }>}
   */
  static async reverseGeocode(lat, lon) {
    if (!lat || !lon) return { address: '', display_name: '' };

    const nLat = Number(lat);
    const nLon = Number(lon);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) {
      return { address: '', display_name: '' };
    }

    const mapboxToken = process.env.MAPBOX_TOKEN ||
      'pk.eyJ1IjoiaWtod2FucyIsImEiOiJjbXQ5c2cwMzYwOW15MnpxdXdpeWU3am45In0.YcX49DH0uXP70aBxVDC-TA';

    // 1. Mapbox Search Box Reverse (high-granularity POIs, addresses, streets)
    if (mapboxToken) {
      try {
        const sbUrl = `https://api.mapbox.com/search/searchbox/v1/reverse?longitude=${encodeURIComponent(nLon)}&latitude=${encodeURIComponent(nLat)}&access_token=${mapboxToken}&types=poi,address,street`;
        const sbRes = await axios.get(sbUrl, { timeout: 3000 });
        const features = (sbRes.data && Array.isArray(sbRes.data.features)) ? sbRes.data.features : [];

        if (features.length > 0) {
          const candidates = features.map((feat) => {
            const props = feat.properties || {};
            const ctx = props.context || {};
            const featGeom = feat.geometry && Array.isArray(feat.geometry.coordinates) ? feat.geometry.coordinates : null;
            const cLon = featGeom ? featGeom[0] : (props.coordinates && props.coordinates.longitude);
            const cLat = featGeom ? featGeom[1] : (props.coordinates && props.coordinates.latitude);
            const distMeters = (cLat != null && cLon != null) ? this.calculateHaversineMeters(nLat, nLon, cLat, cLon) : 0;

            const name = (props.name || '').trim();
            const address = (props.address || '').trim();
            const fullAddress = (props.full_address || '').trim();
            const placeFormatted = (props.place_formatted || '').trim();
            const fType = (props.feature_type || '').toLowerCase();

            const streetName = (ctx.street && ctx.street.name) || (ctx.address && ctx.address.street_name) || (fType === 'street' ? name : '');
            const neighborhood = (ctx.neighborhood && ctx.neighborhood.name) || '';
            const locality = (ctx.place && ctx.place.name) || (ctx.locality && ctx.locality.name) || '';
            const city = (ctx.region && ctx.region.name) || locality || '';

            return {
              feature_type: fType,
              name,
              address,
              full_address: fullAddress,
              place_formatted: placeFormatted,
              street: streetName,
              neighborhood,
              locality,
              city,
              distance_meters: distMeters
            };
          });

          const NON_ADDRESSABLE = ['postcode', 'country', 'region', 'district'];

          // Filter out candidates that are non-addressable or have empty/numeric names
          const validCandidates = candidates.filter((c) => {
            if (!c.name || /^\d{4,6}$/.test(c.name)) return false;
            if (NON_ADDRESSABLE.includes(c.feature_type)) return false;
            return true;
          });

          if (validCandidates.length > 0) {
            // Rank candidates: POI (weight 100) -> Address (weight 90) -> Street (weight 80) -> Other
            // Heavily penalize distance if farther than 1km
            validCandidates.sort((a, b) => {
              const typeWeight = (t) => {
                if (t === 'poi') return 100;
                if (t === 'address') return 90;
                if (t === 'street') return 80;
                return 50;
              };
              const scoreA = typeWeight(a.feature_type) - Math.min(a.distance_meters / 50, 40);
              const scoreB = typeWeight(b.feature_type) - Math.min(b.distance_meters / 50, 40);
              return scoreB - scoreA;
            });

            const winner = validCandidates[0];
            const title = winner.name;
            const road = winner.street || (winner.feature_type === 'street' ? winner.name : '') || winner.address || '';
            const full = winner.full_address || [winner.name, winner.place_formatted].filter(Boolean).join(', ') || title;

            return {
              title: title,
              address: full,
              display_name: full,
              road: road || (winner.feature_type === 'street' || winner.feature_type === 'address' ? title : (winner.street || '')),
              neighborhood: winner.neighborhood,
              locality: winner.locality,
              city: winner.city,
              provider: 'mapbox_searchbox'
            };
          }
        }
      } catch (err) {
        // Fallback to Mapbox Geocoding v6
      }

      // 2. Mapbox Geocoding v6 Reverse Fallback (sub-second Indonesian road & place accuracy)
      try {
        const mboxUrl = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${encodeURIComponent(nLon)}&latitude=${encodeURIComponent(nLat)}&access_token=${mapboxToken}&limit=1`;
        const mboxRes = await axios.get(mboxUrl, { timeout: 3000 });
        const feat = mboxRes.data && mboxRes.data.features && mboxRes.data.features[0];
        if (feat && feat.properties) {
          const props = feat.properties;
          const ctx = props.context || {};
          const NON_ADDRESSABLE = ['postcode', 'country', 'region', 'district'];
          const isNonAddressable = NON_ADDRESSABLE.includes(props.feature_type);
          const road = (!isNonAddressable && (props.feature_type === 'street' || props.feature_type === 'address')) ? (props.name || '') : '';
          const neighborhood = (ctx.neighborhood && ctx.neighborhood.name) || (!isNonAddressable && props.feature_type === 'neighborhood' ? props.name : '');
          const locality = (ctx.locality && ctx.locality.name) || (!isNonAddressable && props.feature_type === 'locality' ? props.name : '');
          const city = (ctx.place && ctx.place.name) || (ctx.region && ctx.region.name) || '';

          const name = props.name || props.full_address || props.place_formatted || '';
          const full = props.full_address || [name, props.place_formatted].filter(Boolean).join(', ') || name;
          if (name || full) {
            const chosenRoad = road || neighborhood || (isNonAddressable ? '' : name);
            return {
              title: (!isNonAddressable ? name : (road || neighborhood || '')),
              address: full || name,
              display_name: full || name,
              road: chosenRoad,
              neighborhood: neighborhood,
              locality: locality,
              city: city,
              provider: 'mapbox_geocoding_v6'
            };
          }
        }
      } catch (err) {
        // Fallback to Nominatim
      }
    }

    // 3. Nominatim fallback
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(nLat)}&lon=${encodeURIComponent(nLon)}`;

    try {
      const response = await axios.get(url, {
        timeout: 3500,
        headers: { 'User-Agent': 'Xentra-Food-Ordering-Engine/2.0' }
      });
      const data = response.data || {};
      const addr = data.address || {};
      const road = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || '';
      const city = addr.city || addr.town || addr.municipality || addr.county || '';
      const shortAddr = [road, city].filter(Boolean).join(', ') || data.display_name || '';

      if (shortAddr || data.display_name) {
        return {
          title: road || data.display_name ? (data.display_name.split(',')[0] || '').trim() : '',
          address: shortAddr || data.display_name,
          display_name: data.display_name || shortAddr,
          road: road,
          city: city,
          provider: 'nominatim'
        };
      }
    } catch (err) {
      console.error('[RouteService] Reverse geocoding failed:', err.message);
    }

    // 4. Coordinate fallback
    return {
      title: 'Titik Terpilih',
      address: `Lokasi Terpilih (${nLat.toFixed(4)}, ${nLon.toFixed(4)})`,
      display_name: `Lokasi Terpilih (${nLat.toFixed(4)}, ${nLon.toFixed(4)})`,
      road: '',
      provider: 'coordinate_fallback'
    };
  }
}

module.exports = RouteService;
