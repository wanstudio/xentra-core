/**
 * Xentra Location Foundation
 *
 * Distinct location concepts:
 * 1. GPS: location source (coordinates + accuracy)
 * 2. Search: location source (query -> Nominatim geocoding)
 * 3. Map Selection: location source (map pin / reverse geocode)
 * 4. Favorite Address: persisted saved address (SQLite customer_addresses)
 * 5. Active Destination: runtime customer destination context
 *
 * Invariants:
 * - Active Destination can originate from GPS, search, map, or favorite address.
 * - Changing GPS later must NOT silently overwrite an explicitly selected Active Destination.
 * - Selecting a Favorite Address makes that address the Active Destination (source: 'favorite').
 * - Active Destination is runtime context, not automatically a saved address.
 */
window.XentraLocation = {
  SOURCES: {
    GPS: 'gps',
    SEARCH: 'search',
    MAP: 'map',
    FAVORITE: 'favorite',
    MANUAL: 'manual'
  },

  getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject({ message: 'GPS tidak tersedia' });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          reject({ message: error.message });
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  },

  /**
   * Check if a background GPS signal can update the Active Destination.
   * LOCKED RULE: GPS must NOT silently overwrite an explicitly selected destination.
   *
   * @param {object|null} currentDestination
   * @returns {boolean}
   */
  canUpdateFromGps(currentDestination) {
    if (!currentDestination) return true;
    if (currentDestination.latitude == null || currentDestination.longitude == null) return true;
    // If the destination was explicitly selected by user (e.g. from search, map pin, or favorite),
    // background GPS must NOT overwrite it.
    if (currentDestination.is_explicit === true) return false;
    if (['search', 'map', 'favorite'].includes(currentDestination.source)) return false;
    return true;
  },

  /**
   * Canonical builder from GPS coordinates.
   */
  createDestinationFromGps(coords, addressText) {
    var lat = coords && (coords.lat != null ? coords.lat : coords.latitude);
    var lng = coords && (coords.lng != null ? coords.lng : coords.longitude);
    return {
      latitude: Number(lat),
      longitude: Number(lng),
      address: addressText || 'Lokasi Saya Saat Ini',
      label: 'Lokasi Sekarang',
      detail: '',
      source: this.SOURCES.GPS,
      is_explicit: false, // GPS is a lightweight signal by default
      accuracy: coords && coords.accuracy != null ? coords.accuracy : null
    };
  },

  /**
   * Canonical builder from Search suggestion.
   */
  createDestinationFromSearch(item) {
    var lat = item && (item.latitude != null ? item.latitude : item.lat);
    var lng = item && (item.longitude != null ? item.longitude : item.lon);
    return {
      latitude: Number(lat),
      longitude: Number(lng),
      address: (item && (item.display_name || item.address || item.formatted_address)) || '',
      label: (item && item.label) || 'Hasil Pencarian',
      detail: (item && item.detail) || '',
      source: this.SOURCES.SEARCH,
      is_explicit: true
    };
  },

  /**
   * Canonical builder from Map pin selection.
   */
  createDestinationFromMap(coords, addressText, detail) {
    var lat = coords && (coords.lat != null ? coords.lat : coords.latitude);
    var lng = coords && (coords.lng != null ? coords.lng : coords.longitude);
    return {
      latitude: Number(lat),
      longitude: Number(lng),
      address: addressText || 'Titik Peta Terpilih',
      label: 'Titik Peta',
      detail: detail || '',
      source: this.SOURCES.MAP,
      is_explicit: true
    };
  },

  /**
   * Canonical builder from Favorite Address.
   * Selecting a Favorite Address makes that address the Active Destination.
   */
  createDestinationFromFavorite(favorite) {
    return {
      latitude: Number(favorite.latitude),
      longitude: Number(favorite.longitude),
      address: favorite.address || '',
      label: favorite.label || 'Alamat Favorit',
      detail: favorite.detail || '',
      source: this.SOURCES.FAVORITE,
      is_explicit: true,
      favorite_id: favorite.id || null
    };
  }
};