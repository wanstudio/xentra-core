(function () {
  'use strict';

  var app = document.getElementById('driver-app');
  var TOKEN_KEY = 'xentra_driver_token';
  var USER_KEY = 'xentra_driver_user';

  var MAPBOX_VERSION = '3.4.0';
  var MAPBOX_TOKEN = (window.XentraConfig && window.XentraConfig.mapboxToken) ||
    'pk.eyJ1IjoiaWtod2FucyIsImEiOiJjbXQ5c2cwMzYwOW15MnpxdXdpeWU3am45In0.YcX49DH0uXP70aBxVDC-TA';

  var mapState = {
    map: null,
    driverMarker: null,
    destinationMarker: null,
    watchId: null,
    currentPosition: null,
    lastRouteAt: 0,
    lastRoutedPosition: null,
    routeRequestId: 0,
    initId: 0,
    detailInitId: 0,
    detailMap: null,
    fallbackZoom: 15
  };


  var state = {
    theme: localStorage.getItem('xentra_driver_theme') || 'dark',
    page: 'tasks',
    driver: null,
    brand: null,
    tasks: [],
    history: [],
    selectedOrderId: null,
    lastCompleted: null,
    loading: true,
    error: null,
    busy: false,
    isOnline: false,
    pickupChecks: {},
    podPhoto: null,
    podBypass: null,
    podNote: null,
    tenderedAmount: null,
    cashSettledByKasir: false
  };
  document.documentElement.setAttribute('data-theme', state.theme);

  var driverLocationService = {
    globalWatchId: null,
    heartbeatTimer: null,
    lastPingAt: 0,
    lastPosition: null,

    start: function () {
      if (!navigator.geolocation || this.globalWatchId != null) return;
      var self = this;

      function onPosition(pos) {
        if (!pos || !pos.coords) return;
        self.lastPosition = {
          latitude: Number(pos.coords.latitude),
          longitude: Number(pos.coords.longitude),
          accuracy: Number(pos.coords.accuracy || 0),
          heading: Number.isFinite(pos.coords.heading) ? Number(pos.coords.heading) : null,
          speed: Number.isFinite(pos.coords.speed) ? Number(pos.coords.speed) : null
        };
        mapState.currentPosition = self.lastPosition;
        if (state.page === 'map') {
          var task = selectedTask();
          if (task) applyDriverPosition(pos, task);
        }
        self.maybePing();
      }

      function onError(err) {
        console.warn('[Driver GPS]:', err && err.message);
      }

      navigator.geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 });

      this.globalWatchId = navigator.geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000
      });

      if (!this.heartbeatTimer) {
        this.heartbeatTimer = setInterval(function () {
          self.maybePing(true);
        }, 10000);
      }
    },

    stop: function () {
      if (this.globalWatchId != null && navigator.geolocation) {
        try { navigator.geolocation.clearWatch(this.globalWatchId); } catch (_) {}
      }
      this.globalWatchId = null;
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    },

    maybePing: async function (fromTimer) {
      if (!state.isOnline || !token() || !this.lastPosition) return;
      var now = Date.now();
      var hasActiveDelivery = state.tasks && state.tasks.some(function (t) {
        return ['picked_up', 'on_delivery'].includes(t.delivery_status);
      });
      // In-flight active delivery: ping every 5 seconds. Standby idle: ping every 25 seconds.
      var thresholdMs = hasActiveDelivery ? 5000 : 25000;
      if (fromTimer && (now - this.lastPingAt < thresholdMs)) return;

      this.lastPingAt = now;
      try {
        var payload = {
          latitude: this.lastPosition.latitude,
          longitude: this.lastPosition.longitude,
          accuracy: this.lastPosition.accuracy,
          heading: this.lastPosition.heading,
          speed: this.lastPosition.speed
        };
        if (navigator.getBattery) {
          try {
            var b = await navigator.getBattery();
            payload.battery_level = Math.round(b.level * 100);
          } catch (_) {}
        }
        await api('/driver/location', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      } catch (_) {}
    }
  };

  function rupiah(value) {
    return 'Rp ' + Number(value || 0).toLocaleString('id-ID');
  }

  function renderQrCodeHtml(payload) {
    var dataStr = String(payload || '').trim();
    if (dataStr && typeof window !== 'undefined' && typeof window.qrcode === 'function') {
      try {
        var qr = window.qrcode(0, 'M');
        qr.addData(dataStr);
        qr.make();
        var svgTag = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        return '<div class="qr-mock qr-real-svg" data-qr-payload="' + escapeHTML(dataStr) + '" title="' + escapeHTML(dataStr) + '">' + svgTag + '</div>';
      } catch (e) {
        console.warn('[DriverQR] Fallback to mock QR:', e);
      }
    }
    return '<div class="qr-mock" data-qr-payload="' + escapeHTML(dataStr) + '">' +
      '<div class="qr-pixel"></div><div class="qr-pixel"></div><div class="qr-pixel white"></div><div class="qr-pixel"></div><div class="qr-pixel"></div>' +
      '<div class="qr-pixel"></div><div class="qr-pixel white"></div><div class="qr-pixel"></div><div class="qr-pixel white"></div><div class="qr-pixel"></div>' +
      '<div class="qr-pixel white"></div><div class="qr-pixel"></div><div class="qr-pixel"></div><div class="qr-pixel"></div><div class="qr-pixel white"></div>' +
      '<div class="qr-pixel"></div><div class="qr-pixel white"></div><div class="qr-pixel white"></div><div class="qr-pixel"></div><div class="qr-pixel"></div>' +
      '<div class="qr-pixel"></div><div class="qr-pixel"></div><div class="qr-pixel white"></div><div class="qr-pixel"></div><div class="qr-pixel"></div>' +
    '</div>';
  }

  function isCodTaskSettled(task) {
    var p = task && task.payment;
    if (!p || !p.is_cod) return true;
    var colStatus = String(p.collection_status || p.settlement_status || '').toLowerCase();
    var custody = String(p.cash_custody || '').toLowerCase();
    return Boolean(
      colStatus === 'handed_over' ||
      colStatus === 'settled' ||
      custody === 'cashier' ||
      p.handed_over_at ||
      p.cod_settled_at ||
      p.settled_at
    );
  }

  function computeDriverCashCustody() {
    var total = 0;
    var seenOrderIds = {};
    if (Array.isArray(state.history)) {
      state.history.forEach(function (h) {
        var p = h && h.payment;
        if (h && h.order_id) seenOrderIds[String(h.order_id)] = true;
        if (p && p.is_cod && !isCodTaskSettled(h) && String(h.delivery_status || '').toLowerCase() !== 'failed') {
          total += Number(p.collected_amount != null ? p.collected_amount : (p.amount || 0));
        }
      });
    }
    if (state.lastCompleted && state.lastCompleted.order_id && !seenOrderIds[String(state.lastCompleted.order_id)]) {
      var lp = state.lastCompleted.payment;
      if (lp && lp.is_cod && !isCodTaskSettled(state.lastCompleted) && !state.cashSettledByKasir && String(state.lastCompleted.delivery_status || '').toLowerCase() !== 'failed') {
        total += Number(lp.collected_amount != null ? lp.collected_amount : (lp.amount || 0));
      }
    }
    return total;
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function persistUser() {
    if (state.driver) localStorage.setItem(USER_KEY, JSON.stringify(state.driver));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function api(path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    var reqBody = options.body;
    if (reqBody && typeof reqBody === 'object' && !(reqBody instanceof FormData)) {
      reqBody = JSON.stringify(reqBody);
    }
    if (!headers['Content-Type'] && reqBody) headers['Content-Type'] = 'application/json';
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;

    var res;
    try {
      res = await fetch('/api/v1' + path, Object.assign({}, options, {
        body: reqBody,
        cache: 'no-store',
        headers: headers,
        credentials: 'same-origin'
      }));
    } catch (_) {
      var networkError = new Error('Koneksi ke Xentra gagal. Periksa koneksi internet Anda.');
      networkError.code = 'NETWORK_ERROR';
      throw networkError;
    }

    var data = null;
    try { data = await res.json(); } catch (_) {}

    if (res.status === 401) {
      clearSession();
      window.location.href = '/login?target=driver';
      var authError = new Error('Sesi Driver tidak valid.');
      authError.status = 401;
      throw authError;
    }

    if (!res.ok) {
      var message = (data && (data.message || data.error)) || 'Permintaan tidak dapat diproses.';
      var err = new Error(message);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }

    return data || {};
  }


  function loadMapboxGL() {
    return new Promise(function (resolve, reject) {
      if (window.mapboxgl && typeof window.mapboxgl.Map === 'function') {
        resolve();
        return;
      }

      var css = document.getElementById('xentra-driver-mapbox-css');
      if (!css) {
        css = document.createElement('link');
        css.id = 'xentra-driver-mapbox-css';
        css.rel = 'stylesheet';
        css.href = 'https://api.mapbox.com/mapbox-gl-js/v' + MAPBOX_VERSION + '/mapbox-gl.css';
        document.head.appendChild(css);
      }

      var script = document.getElementById('xentra-driver-mapbox-js');
      if (script) {
        if (script.dataset.loaded === '1' || (window.mapboxgl && typeof window.mapboxgl.Map === 'function')) {
          resolve();
          return;
        }
        script.addEventListener('load', function () { resolve(); }, { once: true });
        script.addEventListener('error', function () { reject(new Error('Library Mapbox GL tidak dapat dimuat')); }, { once: true });
        return;
      }

      script = document.createElement('script');
      script.id = 'xentra-driver-mapbox-js';
      script.src = 'https://api.mapbox.com/mapbox-gl-js/v' + MAPBOX_VERSION + '/mapbox-gl.js';
      script.onload = function () {
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = function () {
        reject(new Error('Library Mapbox GL tidak dapat dimuat'));
      };
      document.head.appendChild(script);
    });
  }

  function setMapStatus(message, type) {
    var el = document.getElementById('driver-gps-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'map-status ' + (type || '');
  }

  function setRouteStats(distanceMeters, durationSeconds) {
    var distanceEl = document.getElementById('driver-route-distance');
    var etaEl = document.getElementById('driver-route-eta');
    if (distanceEl) {
      distanceEl.textContent = Number.isFinite(Number(distanceMeters)) ?
        (Number(distanceMeters) / 1000).toFixed(1) + ' km' : '—';
    }
    if (etaEl) {
      etaEl.textContent = Number.isFinite(Number(durationSeconds)) ?
        Math.max(1, Math.round(Number(durationSeconds) / 60)) + ' menit' : '—';
    }
    var pillEl = document.getElementById('driver-floating-route-pill');
    if (pillEl) {
      var dStr = Number.isFinite(Number(distanceMeters)) ? (Number(distanceMeters) / 1000).toFixed(1) + ' km' : '1.8 km';
      var eStr = Number.isFinite(Number(durationSeconds)) ? Math.max(1, Math.round(Number(durationSeconds) / 60)) + ' mnt' : '5 mnt';
      pillEl.textContent = dStr + ' (Est. ' + eStr + ')';
    }
  }

  function clearRouteStatus(message) {
    var el = document.getElementById('driver-route-status');
    if (el) el.textContent = message || '';
  }

  function updateMapError(message) {
    var el = document.getElementById('driver-map-error');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function destinationCoordinates(task) {
    var destination = task && task.destination || {};
    var lat = Number(destination.latitude);
    var lng = Number(destination.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
      return { latitude: lat, longitude: lng };
    }
    var pickup = task && task.pickup || {};
    var pLat = Number(pickup.latitude);
    var pLng = Number(pickup.longitude);
    if (Number.isFinite(pLat) && Number.isFinite(pLng) && pLat !== 0 && pLng !== 0) {
      return { latitude: pLat - 0.0085, longitude: pLng + 0.0095 };
    }
    return { latitude: -5.3621, longitude: 104.9723 };
  }

  function pickupCoordinates(task) {
    var pickup = task && task.pickup || {};
    var lat = Number(pickup.latitude);
    var lng = Number(pickup.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
      return { latitude: lat, longitude: lng };
    }
    return { latitude: -5.3582, longitude: 104.9688 };
  }

  function samePoint(a, b) {
    if (!a || !b) return false;
    return Math.abs(Number(a.latitude) - Number(b.latitude)) < 0.00025 &&
      Math.abs(Number(a.longitude) - Number(b.longitude)) < 0.00025;
  }

  function fitDriverRoute(originOverride) {
    if (!mapState.map) return;
    var task = selectedTask();
    var origin = originOverride || mapState.currentPosition || pickupCoordinates(task);
    var dest = destinationCoordinates(task);
    if (!origin || !dest) return;

    try {
      var bounds = new window.mapboxgl.LngLatBounds();
      bounds.extend([Number(origin.longitude), Number(origin.latitude)]);
      bounds.extend([dest.longitude, dest.latitude]);
      mapState.map.fitBounds(bounds, { padding: { top: 55, bottom: 55, left: 35, right: 35 }, maxZoom: 16, duration: 500 });
    } catch (_) {}
  }

  function drawRoute(routeGeometry) {
    if (!mapState.map || !routeGeometry) return;
    var source = mapState.map.getSource('driver-route');
    var feature = { type: 'Feature', properties: {}, geometry: routeGeometry };

    if (source) {
      source.setData({ type: 'FeatureCollection', features: [feature] });
      return;
    }

    mapState.map.addSource('driver-route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [feature] }
    });
    mapState.map.addLayer({
      id: 'driver-route-line',
      type: 'line',
      source: 'driver-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#38BDF8', 'line-width': 5, 'line-opacity': 0.92 }
    });
  }

  async function fetchDriverRoute(position, task) {
    var dest = destinationCoordinates(task);
    if (!dest) {
      clearRouteStatus('Koordinat tujuan belum tersedia.');
      setRouteStats(null, null);
      return;
    }

    var origin = (position && Number.isFinite(Number(position.latitude)) && Number.isFinite(Number(position.longitude)))
      ? { latitude: Number(position.latitude), longitude: Number(position.longitude) }
      : pickupCoordinates(task);

    var lat = Number(origin.latitude);
    var lng = Number(origin.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    var requestId = ++mapState.routeRequestId;
    clearRouteStatus('Menghitung rute…');
    updateMapError('');

    try {
      // 1. Primary: Backend Route Endpoint (Mapbox Directions -> OSRM -> Haversine Fallback)
      var resData = await api(
        '/location/route?origin_lat=' + encodeURIComponent(lat) +
        '&origin_lng=' + encodeURIComponent(lng) +
        '&dest_lat=' + encodeURIComponent(dest.latitude) +
        '&dest_lng=' + encodeURIComponent(dest.longitude)
      );

      if (requestId !== mapState.routeRequestId || state.page !== 'map') return;

      if (resData && resData.geometry) {
        var shouldFitRoute = !mapState.lastRoutedPosition;
        drawRoute(resData.geometry);
        setRouteStats(resData.distance, resData.duration);
        mapState.lastRouteAt = Date.now();
        mapState.lastRoutedPosition = { latitude: lat, longitude: lng };
        clearRouteStatus('');
        updateMapError('');
        if (shouldFitRoute) fitDriverRoute(origin);
        return;
      }
      throw new Error('Geometry kosong');
    } catch (_) {
      // 2. Client-side Fallback: Mapbox Directions API directly
      try {
        var mboxUrl = 'https://api.mapbox.com/directions/v5/mapbox/driving/' +
          encodeURIComponent(lng) + ',' + encodeURIComponent(lat) + ';' +
          encodeURIComponent(dest.longitude) + ',' + encodeURIComponent(dest.latitude) +
          '?overview=full&geometries=geojson&access_token=' + encodeURIComponent(MAPBOX_TOKEN);
        var mboxResp = await fetch(mboxUrl);
        if (mboxResp.ok) {
          var mboxJson = await mboxResp.json();
          var mRoute = mboxJson && mboxJson.routes && mboxJson.routes[0];
          if (mRoute && mRoute.geometry) {
            if (requestId !== mapState.routeRequestId || state.page !== 'map') return;
            drawRoute(mRoute.geometry);
            setRouteStats(mRoute.distance, mRoute.duration);
            mapState.lastRouteAt = Date.now();
            mapState.lastRoutedPosition = { latitude: lat, longitude: lng };
            clearRouteStatus('');
            updateMapError('');
            fitDriverRoute(origin);
            return;
          }
        }
      } catch (_e2) {}

      // 3. Deterministic GeoJSON LineString fallback so route is ALWAYS visible
      if (requestId !== mapState.routeRequestId || state.page !== 'map') return;
      var R = 6371e3;
      var dLat = ((dest.latitude - lat) * Math.PI) / 180;
      var dLon = ((dest.longitude - lng) * Math.PI) / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos((lat * Math.PI) / 180) * Math.cos((dest.latitude * Math.PI) / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
      var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      var estMeters = Math.max(200, Math.round(R * c * 1.3));
      var estSeconds = Math.max(60, Math.round((estMeters / 1000 / 25) * 3600));
      var midLng = (lng + dest.longitude) / 2 + (dest.latitude - lat) * 0.08;
      var midLat = (lat + dest.latitude) / 2 - (dest.longitude - lng) * 0.08;

      drawRoute({
        type: 'LineString',
        coordinates: [
          [lng, lat],
          [midLng, midLat],
          [dest.longitude, dest.latitude]
        ]
      });
      setRouteStats(estMeters, estSeconds);
      mapState.lastRouteAt = Date.now();
      mapState.lastRoutedPosition = { latitude: lat, longitude: lng };
      clearRouteStatus('');
      updateMapError('');
      fitDriverRoute(origin);
    }
  }

  function maybeRefreshDriverRoute(position, task, force) {
    var now = Date.now();
    var enoughTime = now - mapState.lastRouteAt >= 15000;
    var moved = !mapState.lastRoutedPosition || !samePoint(position, mapState.lastRoutedPosition);
    if (force || (enoughTime && moved)) {
      fetchDriverRoute(position, task);
    }
  }

  function applyDriverPosition(position, task) {
    if (state.page !== 'map') return;

    mapState.currentPosition = {
      latitude: Number(position.coords.latitude),
      longitude: Number(position.coords.longitude),
      accuracy: Number(position.coords.accuracy || 0)
    };

    if (!Number.isFinite(mapState.currentPosition.latitude) ||
        !Number.isFinite(mapState.currentPosition.longitude)) {
      setMapStatus('Lokasi GPS tidak valid', 'error');
      return;
    }

    setMapStatus(
      mapState.currentPosition.accuracy > 100
        ? 'GPS kurang akurat'
        : 'Lokasi GPS aktif',
      mapState.currentPosition.accuracy > 100 ? 'warning' : 'success'
    );

    if (mapState.map && !mapState.driverMarker) {
      mapState.driverMarker = new window.mapboxgl.Marker({ color: '#1463ff' })
        .setLngLat([
          mapState.currentPosition.longitude,
          mapState.currentPosition.latitude
        ])
        .addTo(mapState.map);
    } else if (mapState.map && mapState.driverMarker) {
      mapState.driverMarker.setLngLat([
        mapState.currentPosition.longitude,
        mapState.currentPosition.latitude
      ]);
    }

    if (mapState.map && mapState.destinationMarker) {
      if (!mapState.lastRoutedPosition) fitDriverRoute();
    }

    maybeRefreshDriverRoute(mapState.currentPosition, task, !mapState.lastRoutedPosition);
  }

  function startDriverGeolocation(task) {
    var fallbackOrigin = pickupCoordinates(task);
    if (!navigator.geolocation) {
      setMapStatus('Rute dari titik cabang resto', 'warning');
      updateMapError('');
      fetchDriverRoute(fallbackOrigin, task);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (position) { applyDriverPosition(position, task); },
      function () {
        setMapStatus('Rute dari cabang resto (GPS belum aktif)', 'warning');
        updateMapError('');
        if (!mapState.currentPosition) {
          fetchDriverRoute(fallbackOrigin, task);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
    );

    mapState.watchId = navigator.geolocation.watchPosition(
      function (position) { applyDriverPosition(position, task); },
      function () {
        if (mapState.currentPosition) {
          setMapStatus('GPS berhenti memperbarui', 'warning');
          return;
        }
        setMapStatus('Rute dari cabang resto', 'warning');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }

  function cleanupDriverMap() {
    if (mapState.watchId != null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(mapState.watchId); } catch (_) {}
    }
    mapState.watchId = null;
    mapState.routeRequestId += 1;
    if (mapState.map) {
      try { mapState.map.remove(); } catch (_) {}
    }
    if (mapState.detailMap) {
      try { mapState.detailMap.remove(); } catch (_) {}
    }
    mapState.map = null;
    mapState.detailMap = null;
    mapState.driverMarker = null;
    mapState.destinationMarker = null;
    mapState.currentPosition = null;
    mapState.lastRouteAt = 0;
    mapState.lastRoutedPosition = null;
  }

  function renderOsmTilePreview(container, dest, zoom) {
    if (!container || !dest) return;
    zoom = zoom || 16;
    var n = Math.pow(2, zoom);
    var rad = dest.latitude * Math.PI / 180;
    var cx = ((dest.longitude + 180) / 360) * n * 256;
    var cy = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n * 256;
    var rect = container.getBoundingClientRect();
    var w = rect.width || 360;
    var h = rect.height || 180;
    var halfW = w / 2;
    var halfH = h / 2;
    var minTx = Math.floor((cx - halfW) / 256);
    var maxTx = Math.floor((cx + halfW) / 256);
    var minTy = Math.floor((cy - halfH) / 256);
    var maxTy = Math.floor((cy + halfH) / 256);

    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    container.innerHTML = '';

    for (var tx = minTx; tx <= maxTx; tx++) {
      for (var ty = minTy; ty <= maxTy; ty++) {
        var img = document.createElement('img');
        img.src = 'https://tile.openstreetmap.org/' + zoom + '/' + tx + '/' + ty + '.png';
        img.alt = '';
        img.style.position = 'absolute';
        img.style.width = '256px';
        img.style.height = '256px';
        img.style.left = Math.round(tx * 256 - cx + halfW) + 'px';
        img.style.top = Math.round(ty * 256 - cy + halfH) + 'px';
        img.style.pointerEvents = 'none';
        img.style.userSelect = 'none';
        container.appendChild(img);
      }
    }

    var pinEl = document.createElement('div');
    pinEl.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-100%);z-index:2;pointer-events:none;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.35));';
    pinEl.innerHTML = '<svg width="32" height="38" viewBox="0 0 24 28" fill="none"><path d="M12 0C5.925 0 1 4.925 1 11c0 7.75 11 17 11 17s11-9.25 11-17c0-6.075-4.925-11-11-11z" fill="#e5484d"/><circle cx="12" cy="11" r="4.5" fill="#fff"/></svg>';
    container.appendChild(pinEl);
  }

  async function initializeDetailMap(task) {
    var initId = ++mapState.detailInitId;
    var container = document.getElementById('driver-detail-map');
    var dest = destinationCoordinates(task);
    if (!container || !dest) return;

    var pickup = task && task.pickup || {};
    var pickupLat = Number(pickup.latitude);
    var pickupLng = Number(pickup.longitude);
    var hasPickup = Number.isFinite(pickupLat) && Number.isFinite(pickupLng);

    try {
      await loadMapboxGL();
      if (initId !== mapState.detailInitId || (state.page !== 'delivery-detail' && state.page !== 'new-task')) return;
      if (window.mapboxgl && typeof window.mapboxgl.supported === 'function' && !window.mapboxgl.supported()) {
        throw new Error('WebGL tidak didukung');
      }

      container.innerHTML = '';
      window.mapboxgl.accessToken = MAPBOX_TOKEN;

      mapState.detailMap = new window.mapboxgl.Map({
        container: container,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [dest.longitude, dest.latitude],
        zoom: 15,
        attributionControl: false,
        interactive: true
      });

      if (hasPickup) {
        new window.mapboxgl.Marker({ color: '#1463ff' })
          .setLngLat([pickupLng, pickupLat])
          .addTo(mapState.detailMap);
      }

      new window.mapboxgl.Marker({ color: '#e5484d' })
        .setLngLat([dest.longitude, dest.latitude])
        .addTo(mapState.detailMap);

      if (hasPickup) {
        var bounds = new window.mapboxgl.LngLatBounds();
        bounds.extend([pickupLng, pickupLat]);
        bounds.extend([dest.longitude, dest.latitude]);
        mapState.detailMap.fitBounds(bounds, { padding: 38, maxZoom: 15.5, duration: 0 });
      }

      mapState.detailMap.on('load', function () {
        try { mapState.detailMap.resize(); } catch (_) {}
      });
      setTimeout(function () {
        if (mapState.detailMap) {
          try { mapState.detailMap.resize(); } catch (_) {}
        }
      }, 150);
    } catch (_) {
      renderOsmTilePreview(container, dest, 16);
    }
  }

  async function initializeDriverMap(task) {
    var initId = ++mapState.initId;
    var container = document.getElementById('driver-map');
    var dest = destinationCoordinates(task);
    if (!container) return;

    if (!dest) {
      setMapStatus('Koordinat tujuan belum tersedia', 'error');
      updateMapError('Pengantaran tidak dapat menampilkan rute karena koordinat tujuan belum tersedia.');
      return;
    }

    setMapStatus('Memuat peta…', '');
    updateMapError('');

    try {
      await loadMapboxGL();
      if (initId !== mapState.initId || state.page !== 'map') return;
      if (window.mapboxgl && typeof window.mapboxgl.supported === 'function' && !window.mapboxgl.supported()) {
        throw new Error('WebGL tidak didukung');
      }

      container.innerHTML = '';
      window.mapboxgl.accessToken = MAPBOX_TOKEN;
      mapState.map = new window.mapboxgl.Map({
        container: container,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [dest.longitude, dest.latitude],
        zoom: 14,
        attributionControl: true
      });

      var pickupOrigin = pickupCoordinates(task);
      if (pickupOrigin) {
        new window.mapboxgl.Marker({ color: '#10B981' })
          .setLngLat([pickupOrigin.longitude, pickupOrigin.latitude])
          .addTo(mapState.map);
      }

      mapState.destinationMarker = new window.mapboxgl.Marker({ color: '#e5484d' })
        .setLngLat([dest.longitude, dest.latitude])
        .addTo(mapState.map);

      mapState.map.on('load', function () {
        if (state.page !== 'map' || initId !== mapState.initId) return;
        try { mapState.map.resize(); } catch (_) {}
        setMapStatus('Memuat rute pengantaran…', 'success');
        var initialOrigin = mapState.currentPosition || pickupOrigin;
        if (initialOrigin) {
          fitDriverRoute(initialOrigin);
          fetchDriverRoute(initialOrigin, task);
        }
        startDriverGeolocation(task);
      });

      setTimeout(function () {
        if (mapState.map && state.page === 'map') {
          try { mapState.map.resize(); } catch (_) {}
        }
      }, 150);

      mapState.map.on('error', function () {
        startDriverGeolocation(task);
      });
    } catch (err) {
      renderOsmTilePreview(container, dest, 15);
      setMapStatus('Peta ringan aktif (Mencari GPS…)', 'success');
      startDriverGeolocation(task);
    }
  }

  function icon(name) {
    var icons = {
      bell: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
      back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
      arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
      pin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
      phone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
      chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
      bag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
      clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      map: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="6" y2="21"/></svg>',
      check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
      close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
      user: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
      history: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><polyline points="12 7 12 12 15 15"/></svg>',
      truck: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
      motor: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 14-1-3"/><path d="m3 9 6 2a2 2 0 0 1 2-2h2a2 2 0 0 1 1.99 1.81"/><path d="M8 17h3a1 1 0 0 0 1-1 6 6 0 0 1 6-6 1 1 0 0 0 1-1v-.75A5 5 0 0 0 17 5"/><circle cx="19" cy="17" r="3"/><circle cx="5" cy="17" r="3"/></svg>',
      camera: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
      settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
      nav: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>',
      box: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
      idcard: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 9h4"/><path d="M14 13h4"/><path d="M14 17h2"/></svg>',
      document: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
      logout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>'
    };
    return icons[name] || '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>';
  }

  function formatDeliveryStatus(task) {
    if (!task) return 'Tugas';
    if (task.delivery_status === 'on_delivery') return 'Sedang Diantar';
    if (task.delivery_status === 'picked_up') return 'Pesanan Diambil';
    if (task.delivery_status === 'assigned' && task.assignment_status === 'accepted') return 'Siap Ambil';
    return 'Tugas Baru';
  }

  function isNewTask(task) {
    return task.delivery_status === 'assigned' && task.assignment_status === 'pending';
  }

  function isAcceptedAssigned(task) {
    return task.delivery_status === 'assigned' && task.assignment_status === 'accepted';
  }

  function isActiveTask(task) {
    return task.delivery_status === 'picked_up' || task.delivery_status === 'on_delivery';
  }

  function selectedTask() {
    return state.tasks.find(function (task) {
      return String(task.order_id) === String(state.selectedOrderId);
    }) || null;
  }

  var ICON_SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#F59E0B;"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  var ICON_MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#6366F1;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var ICON_WHATSAPP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#25D366;flex-shrink:0;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var ICON_PHONE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#38BDF8;flex-shrink:0;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  var ICON_CHAT_INAPP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#38BDF8;flex-shrink:0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function shell(title, body, active, options) {
    options = options || {};
    var newPendingCount = state.tasks ? state.tasks.filter(isNewTask).length : 0;
    var activeTaskCount = state.tasks ? state.tasks.length : 0;
    var driverName = (state.driver && (state.driver.full_name || state.driver.username)) || 'Driver Xentra';
    var branchName = (state.driver && state.driver.branch_name) || 'Cabang Xentra';
    var avatarUrl = (state.driver && state.driver.avatar_url) || '/owner/assets/img/cat-chef-recipe.png';
    var isDark = (state.theme !== 'light');

    var header =
      '<header class="app-header">' +
        '<button type="button" class="header-driver-btn" data-page="profile">' +
          '<img src="' + escapeHTML(avatarUrl) + '" alt="Avatar" class="driver-avatar-img">' +
          '<div class="driver-meta">' +
            '<span class="driver-name">' + escapeHTML(driverName) + '</span>' +
            '<span class="driver-sub">' + escapeHTML(branchName) + '</span>' +
          '</div>' +
        '</button>' +
        '<div class="header-actions">' +
          '<button type="button" class="icon-btn-header" data-ops-chat-inbox="1" aria-label="Chat Kasir Cabang" title="Chat Kasir Cabang">' +
            '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            '<span class="chat-badge" data-ops-chat-badge style="display:none;">0</span>' +
          '</button>' +
          '<button type="button" class="theme-toggle-btn" data-action="toggle-theme" title="' + (isDark ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap') + '">' +
            (isDark ? ICON_SUN : ICON_MOON) +
          '</button>' +
          '<div class="online-toggle ' + (state.isOnline ? 'online' : 'offline') + '" data-action="toggle-availability" role="button" tabindex="0">' +
            '<span class="online-dot"></span>' +
            '<span>' + (state.isOnline ? 'Online' : 'Offline') + '</span>' +
          '</div>' +
        '</div>' +
      '</header>';

    var nav = options.hideNav ? '' :
      '<nav class="bottom-nav-bar">' +
        navItem('tasks', 'Tugas', 'bag', active, activeTaskCount) +
        navItem('history', 'Riwayat', 'clock', active, 0) +
        navItem('profile', 'Profil', 'user', active, 0) +
      '</nav>';

    var dockHtml = options.dock ? '<div class="bottom-action-dock">' + options.dock + '</div>' : '';

    app.innerHTML = '<div class="driver-shell">' + header + '<main class="content screen-viewport">' + body + '</main>' + dockHtml + nav + '</div><div id="toast" class="toast"></div>';
    bind();

    if (state.busy) {
      app.querySelectorAll('.primary-btn, .btn-primary, .danger-btn, .secondary-btn, .btn-secondary').forEach(function (button) {
        button.disabled = true;
      });
    }
  }

  function navItem(page, label, ico, active, badgeCount) {
    var badgeHtml = badgeCount > 0 ? '<span class="nav-badge">' + badgeCount + '</span>' : '';
    return '<button type="button" class="nav-tab-btn ' + (active === page ? 'active' : '') + '" data-page="' + page + '">' +
      '<span class="nav-icon">' + icon(ico) + '</span>' +
      '<span>' + label + '</span>' +
      badgeHtml +
    '</button>';
  }

  function loadingBody(message) {
    return '<div class="loading"><div style="display:grid;justify-items:center;gap:10px"><div class="spinner"></div><div>' + escapeHTML(message || 'Memuat…') + '</div></div></div>';
  }

  function errorBody(message) {
    return '<div class="card"><div class="info-box warning"><span>!</span><div>' + escapeHTML(message) + '</div></div><button class="btn-primary" data-action="reload" style="margin-top:8px">Coba Lagi</button></div>';
  }

  function taskCard(task) {
    var customer = task.customer || {};
    var destination = task.destination || {};
    var payment = task.payment || {};
    var isCod = Boolean(payment.is_cod);
    var newTask = isNewTask(task);
    var onDelivery = task.delivery_status === 'on_delivery';
    var hasArrived = onDelivery && Boolean(task.arrived_at);
    var targetPage = newTask ? 'new-task' : (hasArrived ? 'complete-action' : (onDelivery ? 'map' : 'pickup'));
    var btnLabel = newTask ? 'Terima Tugas ➔' : (hasArrived ? 'Selesaikan POD ➔' : (onDelivery ? 'Lanjut Antar ➔' : 'Ambil di Dapur ➔'));
    var statusLabel = newTask ? 'Tugas Baru' : (hasArrived ? 'Tiba di Lokasi' : (onDelivery ? 'Sedang Diantar' : 'Siap Diambil'));
    var statusBadgeCls = newTask ? 'badge-blue' : 'badge-green';
    var distKm = task.distance_meters ? (Number(task.distance_meters) / 1000).toFixed(1) + ' km' : '1.8 km';
    var itemsSummary = (Array.isArray(task.items) && task.items.length)
      ? task.items.map(function (it) { return Number(it.quantity || 1) + 'x ' + it.product_name; }).join(', ')
      : (Number(task.item_count || 1) + ' Menu Pesanan • ' + (destination.address || 'Alamat pelanggan'));

    return '<div class="card" style="border-left:4px solid ' + (isCod ? '#F59E0B' : '#10B981') + ';cursor:pointer;" data-order="' + escapeHTML(task.order_id) + '" data-page="' + targetPage + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<div>' +
          '<div style="font-size:15px;font-weight:800;color:var(--text-main);">#' + escapeHTML(task.order_number || task.order_id) + '</div>' +
          '<div style="font-size:12px;color:var(--text-sub);margin-top:1px;">' + escapeHTML(customer.name || 'Pelanggan') + ' • ' + escapeHTML(distKm) + '</div>' +
        '</div>' +
        '<span class="badge ' + statusBadgeCls + '">' + escapeHTML(statusLabel) + '</span>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-sub);margin-top:2px;">' +
        escapeHTML(itemsSummary) +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color);">' +
        '<div>' +
          '<span style="font-size:12px;font-weight:800;color:' + (isCod ? 'var(--accent-amber)' : 'var(--brand-green)') + ';">' +
            (isCod ? 'Tagih COD ' + rupiah(payment.amount) : 'Sudah Lunas (QRIS)') +
          '</span>' +
        '</div>' +
        '<button type="button" class="btn-primary ' + (newTask ? 'green' : '') + '" ' +
          (newTask ? 'data-action="accept" data-order="' + escapeHTML(task.order_id) + '"' : '') +
          ' style="height:36px;min-height:36px;width:auto;padding:0 14px;font-size:12px;">' +
          btnLabel +
        '</button>' +
      '</div>' +
    '</div>';
  }

  var _activeSliderCleanup = null;

  function initSlider(trackId, thumbId, fillId, onComplete) {
    if (typeof _activeSliderCleanup === 'function') {
      try { _activeSliderCleanup(); } catch (_) {}
      _activeSliderCleanup = null;
    }

    var track = document.getElementById(trackId);
    var thumb = document.getElementById(thumbId);
    var fill = document.getElementById(fillId);
    if (!track || !thumb || !fill) return;

    var isDragging = false;
    var isCompleted = false;
    var startX = 0;
    var maxSlide = 0;
    var currentDiff = 0;

    function getX(e) {
      if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
      if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].clientX;
      return e.clientX;
    }

    function startDrag(e) {
      if (isCompleted || track.classList.contains('disabled')) return;
      if (e.type === 'mousedown' && e.button !== 0) return;
      isDragging = true;
      currentDiff = 0;
      startX = getX(e);
      maxSlide = Math.max(0, track.clientWidth - thumb.clientWidth - 8);
      thumb.style.transition = 'none';
      fill.style.transition = 'none';
    }

    function moveDrag(e) {
      if (!isDragging || isCompleted) return;
      if (e.cancelable) e.preventDefault();
      var curX = getX(e);
      var diff = curX - startX;
      if (diff < 0) diff = 0;
      if (diff > maxSlide) diff = maxSlide;
      currentDiff = diff;

      thumb.style.transform = 'translate3d(' + diff + 'px, 0, 0)';
      fill.style.width = (diff + 24) + 'px';

      if (maxSlide > 0 && diff >= maxSlide * 0.85) {
        triggerComplete();
      }
    }

    function triggerComplete() {
      if (isCompleted) return;
      isCompleted = true;
      isDragging = false;
      thumb.style.transition = 'transform 0.12s ease-out';
      fill.style.transition = 'width 0.12s ease-out';
      thumb.style.transform = 'translate3d(' + maxSlide + 'px, 0, 0)';
      fill.style.width = '100%';
      var labelEl = track.querySelector('.slider-label');
      if (labelEl) labelEl.textContent = 'Memproses…';
      cleanListeners();
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }

    function stopDrag() {
      if (!isDragging || isCompleted) return;
      isDragging = false;
      if (maxSlide > 0 && currentDiff >= maxSlide * 0.78) {
        triggerComplete();
        return;
      }
      thumb.style.transition = 'transform 0.18s ease-out';
      fill.style.transition = 'width 0.18s ease-out';
      thumb.style.transform = 'translate3d(0px, 0, 0)';
      fill.style.width = '0%';
    }

    function cleanListeners() {
      thumb.removeEventListener('mousedown', startDrag);
      thumb.removeEventListener('touchstart', startDrag);
      window.removeEventListener('mousemove', moveDrag);
      window.removeEventListener('touchmove', moveDrag);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('touchend', stopDrag);
      window.removeEventListener('touchcancel', stopDrag);
    }

    thumb.addEventListener('mousedown', startDrag);
    thumb.addEventListener('touchstart', startDrag, { passive: true });
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('touchmove', moveDrag, { passive: false });
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchend', stopDrag);
    window.addEventListener('touchcancel', stopDrag);

    _activeSliderCleanup = cleanListeners;
  }

  function renderDriverStepper(currentStep, variant) {
    var task = selectedTask() || state.lastCompleted || (state.activeRtsTask && state.activeRtsTask.task);
    var isCod = Boolean(task && task.payment && task.payment.is_cod);
    var isRts = variant === 'rts';

    if (isRts) {
      return '<div class="stepper-bar">' +
        '<div class="step-node done"><span class="step-num">✓</span> Ambil</div>' +
        '<span class="step-arrow">›</span>' +
        '<div class="step-node done"><span class="step-num">✓</span> Antar</div>' +
        '<span class="step-arrow">›</span>' +
        '<div class="step-node danger"><span class="step-num">✕</span> Gagal</div>' +
        '<span class="step-arrow">›</span>' +
        '<div class="step-node active"><span class="step-num">4</span> Retur</div>' +
      '</div>';
    }

    var step4Label = isCod ? 'Setor' : 'Selesai';
    var n1Cls = currentStep > 1 ? 'done' : (currentStep === 1 ? 'active' : '');
    var n2Cls = currentStep > 2 ? 'done' : (currentStep === 2 ? 'active' : '');
    var n3Cls = currentStep > 3 ? 'done' : (currentStep === 3 ? 'active' : '');
    var n4Cls = currentStep > 4 ? 'done' : (currentStep === 4 ? 'active' : '');

    var n1Dot = currentStep > 1 ? '✓' : '1';
    var n2Dot = currentStep > 2 ? '✓' : '2';
    var n3Dot = currentStep > 3 ? '✓' : '3';
    var n4Dot = currentStep > 4 ? '✓' : '4';

    return '<div class="stepper-bar">' +
      '<div class="step-node ' + n1Cls + '"><span class="step-num">' + n1Dot + '</span> Ambil</div>' +
      '<span class="step-arrow">›</span>' +
      '<div class="step-node ' + n2Cls + '"><span class="step-num">' + n2Dot + '</span> Antar</div>' +
      '<span class="step-arrow">›</span>' +
      '<div class="step-node ' + n3Cls + '"><span class="step-num">' + n3Dot + '</span> Tiba</div>' +
      '<span class="step-arrow">›</span>' +
      '<div class="step-node ' + n4Cls + '"><span class="step-num">' + n4Dot + '</span> ' + step4Label + '</div>' +
    '</div>';
  }

  function renderTasks() {
    if (state.loading) return shell('Tugas', loadingBody('Memuat tugas…'), 'tasks');
    if (state.error) return shell('Tugas', errorBody(state.error), 'tasks');

    if (!state.isOnline) {
      var offlineBody =
        '<div class="card" style="align-items:center;text-align:center;padding:32px 16px;border-color:rgba(239, 68, 68, 0.4);">' +
          '<div style="width:60px;height:60px;border-radius:50%;background:rgba(239, 68, 68, 0.12);display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:12px;color:#EF4444;">' +
            '⛔' +
          '</div>' +
          '<div style="font-size:16px;font-weight:800;color:#EF4444;">Status: Offline</div>' +
          '<div style="font-size:12px;color:var(--text-sub);margin-top:4px;max-width:240px;line-height:1.4;">' +
            'Aplikasi tidak dapat menerima tugas pengantaran baru saat offline.' +
          '</div>' +
          '<button type="button" class="btn-primary green" data-action="toggle-availability" style="margin-top:16px;width:auto;padding:0 24px;">' +
            'Nyalakan Mode Online' +
          '</button>' +
        '</div>';
      return shell('Tugas', offlineBody, 'tasks');
    }

    var newTasks = state.tasks.filter(isNewTask);
    var activeTasks = state.tasks.filter(isActiveTask);
    var acceptedAssigned = state.tasks.filter(isAcceptedAssigned);
    var completedCount = Array.isArray(state.history) ? state.history.length : 0;
    var cashCustody = computeDriverCashCustody();

    var body =
      '<div class="card">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Selesai Hari Ini</div>' +
            '<div style="font-size:20px;font-weight:800;color:#38BDF8;margin-top:2px;">' + completedCount + ' Pesanan</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Kas Tertahan</div>' +
            '<div style="font-size:20px;font-weight:800;color:' + (cashCustody > 0 ? '#F59E0B' : '#10B981') + ';margin-top:2px;">' +
              rupiah(cashCustody) +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    if (activeTasks.length) {
      var firstAct = activeTasks[0];
      var isActCod = Boolean(firstAct && firstAct.payment && firstAct.payment.is_cod);
      body += '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;">Sedang Diantar (' + activeTasks.length + ')</span>' +
          '<span class="badge ' + (isActCod ? 'badge-amber' : 'badge-green') + '">' + (isActCod ? 'COD' : 'QRIS (Lunas)') + '</span>' +
        '</div>';
      activeTasks.forEach(function (task) { body += taskCard(task); });
      body += '</div>';
    }

    if (acceptedAssigned.length) {
      var firstAcc = acceptedAssigned[0];
      var isAccCod = Boolean(firstAcc && firstAcc.payment && firstAcc.payment.is_cod);
      body += '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;">Siap Diambil di Dapur (' + acceptedAssigned.length + ')</span>' +
          '<span class="badge ' + (isAccCod ? 'badge-amber' : 'badge-green') + '">' + (isAccCod ? 'COD' : 'QRIS (Lunas)') + '</span>' +
        '</div>';
      acceptedAssigned.forEach(function (task) { body += taskCard(task); });
      body += '</div>';
    }

    if (newTasks.length) {
      var firstNew = newTasks[0];
      var isNewCod = Boolean(firstNew && firstNew.payment && firstNew.payment.is_cod);
      body += '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;">Tugas Pengantaran Baru (' + newTasks.length + ')</span>' +
          '<span class="badge ' + (isNewCod ? 'badge-amber' : 'badge-green') + '">' + (isNewCod ? 'COD' : 'QRIS (Lunas)') + '</span>' +
        '</div>';
      newTasks.forEach(function (task) { body += taskCard(task); });
      body += '</div>';
    }

    if (!state.tasks.length) {
      body += '<div class="card empty"><div class="empty-art">' + icon('box') + '</div><h3>Standby — Siap Menerima Tugas</h3><p>Anda akan menerima notifikasi tugas baru secara otomatis ketika kasir atau dapur menugaskan pengantaran.</p><button class="btn-secondary" data-action="reload">Muat Ulang Tugas ↻</button></div>';
    }

    shell('Tugas', body, 'tasks');
  }

  function renderNewTask() {
    closeIncomingTaskModal();
    var task = selectedTask();
    if (!task) return shell('Tugas Baru', errorBody('Tugas tidak ditemukan atau sudah berubah.'), 'tasks', {hideNav:true});
    if (!isNewTask(task)) {
      if (task.delivery_status === 'on_delivery') {
        state.page = task.arrived_at ? 'complete-action' : 'map';
        return task.arrived_at ? renderCompleteAction() : renderMap();
      }
      state.page = 'pickup';
      return renderPickup();
    }

    var c = task.customer || {};
    var d = task.destination || {};
    var p = task.payment || {};
    var isCod = Boolean(p.is_cod);
    var distText = task.distance_meters ? (Number(task.distance_meters) / 1000).toFixed(1) + ' km' : '2.4 km';
    var itemCount = (Array.isArray(task.items) && task.items.length) ? task.items.length : Number(task.item_count || 1);
    var pickupBranch = (task.pickup && task.pickup.branch_name) || (state.driver && state.driver.branch_name) || 'Outlet Resto';

    var body =
      '<div class="incoming-modal ' + (isCod ? '' : 'qris') + '" style="border-radius:16px;border:1px solid var(--border-color);border-top:3px solid ' + (isCod ? '#F59E0B' : '#10B981') + ';">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
          '<span class="badge ' + (isCod ? 'badge-amber' : 'badge-green') + '">TUGAS PENGANTARAN</span>' +
          '<span style="font-size:13px;font-weight:800;color:' + (isCod ? '#F59E0B' : '#10B981') + ';">BARU</span>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
          '<div>' +
            '<div style="font-size:18px;font-weight:800;color:var(--text-main);">#' + escapeHTML(task.order_number || task.order_id) + '</div>' +
            '<div style="font-size:12px;color:var(--text-sub);">' + itemCount + ' Menu • ' + escapeHTML(distText) + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<span class="badge ' + (isCod ? 'badge-amber' : 'badge-green') + '">' + (isCod ? 'COD' : 'QRIS (Lunas)') + '</span>' +
            '<div style="font-size:17px;font-weight:800;color:' + (isCod ? 'var(--accent-amber)' : 'var(--brand-green)') + ';margin-top:2px;">' +
              rupiah(p.amount) +
            '</div>' +
          '</div>' +
        '</div>' +
        (!isCod
          ? '<div style="background:rgba(16, 185, 129, 0.12);border:1px solid rgba(16, 185, 129, 0.4);border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;color:#10B981;display:flex;align-items:center;gap:6px;">' +
              '<span>🛡️</span>' +
              '<span>PESANAN SUDAH LUNAS — DILARANG MENAGIH UANG</span>' +
            '</div>'
          : '') +
        '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Ambil di Resto:</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">' + escapeHTML(pickupBranch) + '</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Antar ke:</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">' + escapeHTML(c.name || 'Pelanggan') + '</div>' +
            '<div style="font-size:11px;color:var(--text-sub);">' + escapeHTML(d.address || 'Alamat tujuan belum tersedia') + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;">' +
          '<button type="button" class="btn-secondary danger" data-action="reject">Tolak</button>' +
          '<button type="button" class="btn-primary green" data-action="accept">Terima Tugas</button>' +
        '</div>' +
      '</div>';

    shell('Tugas Baru', body, 'tasks', {hideNav:true});
  }

  function renderDetail() {
    var task = selectedTask();
    if (!task) return shell('Pengantaran', errorBody('Tugas tidak ditemukan atau sudah tidak menjadi tugas Anda.'), 'tasks', {hideNav:true});
    if (task.delivery_status === 'on_delivery') {
      if (task.arrived_at) {
        state.page = 'complete-action';
        return renderCompleteAction();
      }
      state.page = 'map';
      return renderMap();
    }
    return renderPickup();
  }

  function renderPickup() {
    var task = selectedTask();
    if (!task) return shell('Ambil Pesanan', errorBody('Tugas pengantaran tidak ditemukan.'), 'tasks', {hideNav:true});

    var items = Array.isArray(task.items) && task.items.length ? task.items : [
      { id: 'default_1', quantity: Number(task.item_count || 1), product_name: 'Paket Pesanan #' + (task.order_number || task.order_id) }
    ];
    if (state.pickupChecks === null || typeof state.pickupChecks !== 'object' || Object.keys(state.pickupChecks).length === 0) {
      state.pickupChecks = {};
      items.forEach(function(it) { state.pickupChecks[it.id] = true; });
    }
    var allChecked = items.length > 0 && items.every(function(it) { return Boolean(state.pickupChecks[it.id]); });
    var isOrderCooking = (task.order_status === 'confirmed' || task.order_status === 'preparing');
    var kitchenReady = !isOrderCooking;
    var canSlide = kitchenReady && allChecked;
    var p = task.payment || {};
    var isCod = Boolean(p.is_cod);
    var pickupBranch = (task.pickup && task.pickup.branch_name) || (state.driver && state.driver.branch_name) || 'Cabang Resto';

    var expectedAmt = Number(p.amount || 0);
    var round100k = Math.max(100000, Math.ceil(expectedAmt / 100000) * 100000);
    var suggestedFloat = Math.max(0, round100k - expectedAmt);

    var itemsHtml = items.map(function(it) {
      var isChk = Boolean(state.pickupChecks[it.id]);
      return '<div class="checklist-row ' + (isChk ? 'checked' : '') + '" data-action="toggle-pickup-item" data-item-id="' + escapeHTML(String(it.id)) + '">' +
        '<div class="check-box">' + (isChk ? '✓' : '') + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:700;color:var(--text-main);">' + Number(it.quantity || 1) + 'x ' + escapeHTML(it.product_name) + '</div>' +
          (it.note ? '<div style="font-size:11px;color:#F59E0B;margin-top:2px;">Catatan: ' + escapeHTML(it.note) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    var body =
      renderDriverStepper(1) +
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-size:11px;color:var(--text-sub);">Status Dapur:</span>' +
          '<span class="badge ' + (kitchenReady ? 'badge-green' : 'badge-amber') + '">' +
            (kitchenReady ? 'Siap Diambil' : 'Sedang Dimasak') +
          '</span>' +
        '</div>' +
        '<div style="font-size:14px;font-weight:700;color:var(--text-main);">' + escapeHTML(pickupBranch) + '</div>' +
      '</div>' +
      (isCod
        ? '<div class="card" style="border:1.5px dashed #F59E0B;background:rgba(245, 158, 11, 0.08);">' +
            '<div style="display:flex;align-items:flex-start;gap:10px;">' +
              '<div style="font-size:20px;line-height:1;">💵</div>' +
              '<div style="flex:1;">' +
                '<div style="font-size:12px;font-weight:800;color:#F59E0B;text-transform:uppercase;">' +
                  'Pengingat Kasir: Bawa Uang Kembalian' +
                '</div>' +
                '<div style="font-size:12px;color:var(--text-main);margin-top:3px;line-height:1.4;">' +
                  'Tagihan COD: <strong>' + rupiah(expectedAmt) + '</strong> (antisipasi pelanggan bayar <strong>' + rupiah(round100k) + '</strong>).' +
                  '<br>' +
                  '<span style="color:#38BDF8;font-weight:700;">Ambil uang kembalian ' + rupiah(suggestedFloat) + ' dari kasir sekarang!</span>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>'
        : '<div class="card" style="border:1px solid rgba(16, 185, 129, 0.4);background:rgba(16, 185, 129, 0.06);">' +
            '<div style="display:flex;align-items:center;gap:10px;">' +
              '<div style="font-size:20px;">🛡️</div>' +
              '<div style="flex:1;">' +
                '<div style="font-size:12px;font-weight:800;color:#10B981;">PESANAN NON-TUNAI (QRIS)</div>' +
                '<div style="font-size:11px;color:var(--text-sub);margin-top:1px;">' +
                  'Sudah lunas via aplikasi. Tidak perlu mengambil uang modal kembalian dari kasir.' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>') +
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div style="font-size:12px;font-weight:800;color:var(--text-main);">Checklist Menu Pesanan</div>' +
          '<button type="button" class="btn-edit-text" data-action="check-all-items">' +
            (allChecked ? 'Batal Centang' : 'Centang Semua ✓') +
          '</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          itemsHtml +
        '</div>' +
      '</div>';

    var dock =
      '<div class="slider-track ' + (canSlide ? '' : 'disabled') + '" id="slider-track-pickup">' +
        '<div class="slider-progress-fill" id="slider-fill-pickup"></div>' +
        '<div class="slider-thumb green" id="slider-thumb-pickup">➔</div>' +
        '<span class="slider-label">' + (canSlide ? 'Geser untuk Berangkat' : 'Menunggu Dapur & Checklist') + '</span>' +
      '</div>';

    shell('Ambil Pesanan', body, 'tasks', {hideNav:true, dock: dock});

    if (canSlide) {
      initSlider('slider-track-pickup', 'slider-thumb-pickup', 'slider-fill-pickup', function() {
        handleAction('confirm-pickup-start', document.getElementById('slider-thumb-pickup'));
      });
    }
  }

  function renderMap() {
    var task = selectedTask();
    if (!task) return shell('Sedang Mengantar', errorBody('Tugas pengantaran tidak ditemukan.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var d = task.destination || {};
    var p = task.payment || {};
    var isCod = Boolean(p.is_cod);
    var distKm = task.distance_meters ? (Number(task.distance_meters) / 1000).toFixed(1) + ' km' : '1.8 km';
    var etaMin = task.duration_seconds ? Math.max(1, Math.round(Number(task.duration_seconds) / 60)) + ' mnt' : '5 mnt';
    var noteText = d.notes || task.notes || 'Pastikan titik pengantaran sesuai alamat pelanggan.';

    var body =
      renderDriverStepper(2) +
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-size:11px;color:var(--text-sub);">Tujuan Pengantaran:</span>' +
          '<span class="badge ' + (isCod ? 'badge-amber' : 'badge-green') + '">' + (isCod ? 'COD ' + rupiah(p.amount) : 'QRIS (LUNAS)') + '</span>' +
        '</div>' +
        '<div style="font-size:16px;font-weight:800;color:var(--text-main);margin-top:1px;">' + escapeHTML(c.name || 'Pelanggan') + '</div>' +
        '<div style="font-size:13px;color:var(--text-sub);line-height:1.4;">' +
          escapeHTML(d.address || 'Alamat tujuan belum tersedia') +
        '</div>' +
        '<div style="font-size:12px;color:var(--accent-amber);background:rgba(245, 158, 11, 0.1);padding:6px 10px;border-radius:8px;border:1px solid rgba(245, 158, 11, 0.2);">' +
          'Patokan: ' + escapeHTML(noteText) +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:6px;margin-top:4px;">' +
          '<button type="button" class="btn-secondary" data-action="open-customer-chat" style="position:relative;border-color:rgba(56, 189, 248, 0.4);background:rgba(56, 189, 248, 0.08);color:#38BDF8;">' +
            ICON_CHAT_INAPP +
            '<span>Chat In-App</span>' +
          '</button>' +
          '<button type="button" class="btn-secondary" data-action="open-whatsapp">' +
            ICON_WHATSAPP +
            '<span>WhatsApp</span>' +
          '</button>' +
          '<button type="button" class="btn-secondary" data-action="call">' +
            ICON_PHONE +
            '<span>Telepon</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="card map-card-container">' +
        '<div id="driver-map" class="driver-map" aria-label="Peta pengantaran"></div>' +
        '<div class="map-floating-pill">' +
          '<span style="color:#10B981;font-size:12px;">●</span>' +
          '<span id="driver-floating-route-pill">' + escapeHTML(distKm) + ' (Est. ' + escapeHTML(etaMin) + ')</span>' +
        '</div>' +
        '<div id="driver-gps-status" class="map-status" style="position:absolute;top:40px;left:12px;z-index:10;background:rgba(15,23,42,0.8);padding:2px 8px;border-radius:10px;">Mencari lokasi GPS…</div>' +
        '<div id="driver-map-error" class="map-error" hidden></div>' +
        '<div class="map-zoom-controls">' +
          '<button type="button" class="map-zoom-btn" data-action="zoom-in-map" title="Perbesar Peta" aria-label="Perbesar Peta">+</button>' +
          '<button type="button" class="map-zoom-btn" data-action="zoom-out-map" title="Perkecil Peta" aria-label="Perkecil Peta">−</button>' +
        '</div>' +
        '<button type="button" class="map-refresh-btn" data-action="refresh-map" title="Segarkan Rute">↻</button>' +
        '<button type="button" class="map-recenter-btn" data-action="recenter-map" title="Pusatkan Peta">⌖</button>' +
        '<div style="display:none;"><span id="driver-route-eta"></span><span id="driver-route-distance"></span><span id="driver-route-status"></span></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:-4px;padding:0 2px;">' +
        '<button type="button" class="btn-secondary danger" data-action="open-delivery-issue" style="height:32px;min-height:32px;padding:0 10px;font-size:11px;">' +
          'Laporkan Kendala ⚠️' +
        '</button>' +
        '<a href="javascript:void(0)" data-action="navigate" style="color:#38BDF8;font-size:12px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:4px;">' +
          'Buka di Google Maps ↗' +
        '</a>' +
      '</div>' +
      (isCod
        ? '<div class="card">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
              '<span style="font-size:12px;color:var(--text-sub);">Wajib Tagih Tunai (COD):</span>' +
              '<span style="font-size:16px;font-weight:800;color:var(--accent-amber);">' + rupiah(p.amount) + '</span>' +
            '</div>' +
          '</div>'
        : '<div class="card" style="border-color:rgba(16, 185, 129, 0.4);background:rgba(16, 185, 129, 0.06);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
              '<span style="font-size:12px;font-weight:700;color:#10B981;">STATUS: SUDAH LUNAS (QRIS)</span>' +
              '<span style="font-size:11px;color:var(--text-sub);">Dilarang minta uang</span>' +
            '</div>' +
          '</div>');

    var dock =
      '<div class="slider-track" id="slider-track-arrived">' +
        '<div class="slider-progress-fill" id="slider-fill-arrived"></div>' +
        '<div class="slider-thumb" id="slider-thumb-arrived">➔</div>' +
        '<span class="slider-label">Geser jika Sudah Tiba di Lokasi</span>' +
      '</div>';

    shell('Sedang Mengantar', body, 'tasks', {hideNav:true, dock: dock});
    initializeDriverMap(task);

    initSlider('slider-track-arrived', 'slider-thumb-arrived', 'slider-fill-arrived', function() {
      handleAction('notify-arrived', document.getElementById('slider-thumb-arrived'));
    });
  }

  function renderCompleteAction() {
    var task = selectedTask();
    if (!task) return shell('Selesaikan Pengantaran', errorBody('Tugas pengantaran tidak ditemukan.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var d = task.destination || {};
    var p = task.payment || {};
    var isCod = Boolean(p.is_cod);
    var expected = Number(p.amount || 0);
    var orderCode = task.order_number || task.order_id;
    var noteText = d.notes || task.notes || 'Pastikan pesanan diterima dengan baik.';

    var hasPhoto = Boolean(state.podPhoto);
    var hasBypass = Boolean(state.podBypass);
    var photoSatisfied = hasPhoto || hasBypass;

    if (isCod && state.tenderedAmount == null) {
      state.tenderedAmount = expected;
    }
    var change = isCod ? Math.max(0, Number(state.tenderedAmount || expected) - expected) : 0;

    var roundMid = Math.ceil((expected + 5000) / 10000) * 10000;
    if (roundMid <= expected) roundMid = expected + 5000;
    var round100k = Math.max(100000, Math.ceil(expected / 100000) * 100000);
    var presetList = [expected, roundMid, round100k];

    var paymentSectionHtml = isCod
      ? '<div class="cod-box">' +
          '<div style="font-size:11px;font-weight:800;color:var(--accent-amber);">TAGIHAN COD:</div>' +
          '<div class="cod-amount">' + rupiah(expected) + '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="calc-row">' +
            '<span style="font-size:12px;color:var(--text-sub);">Uang Diterima:</span>' +
            '<span style="font-weight:800;color:var(--text-main);">' + rupiah(state.tenderedAmount) + '</span>' +
          '</div>' +
          '<div class="calc-chips">' +
            '<button type="button" class="calc-chip ' + (state.tenderedAmount === expected ? 'selected' : '') + '" data-action="set-tendered" data-amount="' + expected + '">Uang Pas</button>' +
            '<button type="button" class="calc-chip ' + (state.tenderedAmount === roundMid ? 'selected' : '') + '" data-action="set-tendered" data-amount="' + roundMid + '">' + Number(roundMid).toLocaleString('id-ID') + '</button>' +
            '<button type="button" class="calc-chip ' + (state.tenderedAmount === round100k ? 'selected' : '') + '" data-action="set-tendered" data-amount="' + round100k + '">' + Number(round100k).toLocaleString('id-ID') + '</button>' +
            '<button type="button" class="calc-chip ' + (presetList.indexOf(state.tenderedAmount) === -1 ? 'selected' : '') + '" data-action="prompt-custom-tendered">Lainnya ✎</button>' +
          '</div>' +
          '<div class="calc-change-box">' +
            '<span style="font-size:12px;color:var(--text-sub);">Kembalian:</span>' +
            '<span class="calc-change-val" id="driver-change-display">' + rupiah(change) + '</span>' +
          '</div>' +
        '</div>'
      : '<div class="prepaid-box">' +
          '<div style="font-size:11px;font-weight:800;color:#10B981;text-transform:uppercase;letter-spacing:0.04em;">' +
            'Status Pembayaran Online' +
          '</div>' +
          '<div style="font-size:22px;font-weight:900;color:#10B981;">' +
            'SUDAH LUNAS (QRIS)' +
          '</div>' +
          '<div style="background:rgba(239, 68, 68, 0.14);border:1px solid rgba(239, 68, 68, 0.35);border-radius:10px;padding:10px 14px;color:#F87171;font-size:12px;font-weight:800;margin-top:2px;">' +
            '⛔ DILARANG MENAGIH UANG TUNAI KE PELANGGAN' +
          '</div>' +
          '<div style="font-size:12px;color:var(--text-sub);margin-top:4px;">' +
            'Total Pesanan: ' + rupiah(expected) + ' (Telah dibayar via QRIS)' +
          '</div>' +
        '</div>';

    var body =
      renderDriverStepper(3) +
      '<input type="file" id="driver-pod-file-input" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-size:11px;font-weight:800;color:var(--brand-green);display:flex;align-items:center;gap:4px;">' +
            '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--brand-green);"></span>' +
            'SUDAH DI DEPAN PAGAR' +
          '</span>' +
          '<span style="font-size:11px;color:var(--text-sub);">#' + escapeHTML(orderCode) + '</span>' +
        '</div>' +
        '<div style="font-size:16px;font-weight:800;color:var(--text-main);margin-top:2px;">' + escapeHTML(c.name || 'Pelanggan') + '</div>' +
        '<div style="font-size:13px;color:var(--text-sub);line-height:1.4;">' +
          escapeHTML(d.address || 'Alamat tujuan belum tersedia') +
        '</div>' +
        '<div style="font-size:12px;color:var(--accent-amber);background:rgba(245, 158, 11, 0.1);padding:6px 10px;border-radius:8px;border:1px solid rgba(245, 158, 11, 0.2);">' +
          'Patokan: ' + escapeHTML(noteText) +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:6px;margin-top:4px;">' +
          '<button type="button" class="btn-secondary" data-action="open-customer-chat" style="position:relative;border-color:rgba(56, 189, 248, 0.4);background:rgba(56, 189, 248, 0.08);color:#38BDF8;">' +
            ICON_CHAT_INAPP +
            '<span>Chat In-App</span>' +
          '</button>' +
          '<button type="button" class="btn-secondary" data-action="open-whatsapp">' +
            ICON_WHATSAPP +
            '<span>WhatsApp</span>' +
          '</button>' +
          '<button type="button" class="btn-secondary" data-action="call">' +
            ICON_PHONE +
            '<span>Telepon</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      paymentSectionHtml +
      '<div class="card" style="' + (!photoSatisfied ? 'border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.04);' : '') + '">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">' +
          '<div>' +
            '<div style="font-size:12px; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:6px;">' +
              '<span>Bukti Foto Serah Terima</span>' +
              '<span class="badge ' + (photoSatisfied ? 'badge-green' : 'badge-amber') + '">' +
                (photoSatisfied ? (hasBypass ? 'Dilewati' : 'Terlampir ✓') : 'Wajib Foto') +
              '</span>' +
            '</div>' +
            '<div style="font-size:11px; color:var(--text-sub); margin-top:3px; line-height:1.4;">' +
              (photoSatisfied
                ? (hasBypass
                    ? '<span style="color:#F59E0B; font-weight:700;">⚠️ Serah langsung (' + escapeHTML(state.podBypass) + ')</span>'
                    : '<span style="color:#10B981; font-weight:700;">✓ Foto paket makanan tersimpan</span>')
                : '<span style="color:#F59E0B;">Foto paket makanan di lokasi untuk membuka tombol selesai</span>') +
            '</div>' +
          '</div>' +
          '<div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">' +
            (hasPhoto
              ? '<button type="button" class="btn-primary green" data-action="trigger-pod-camera" style="height:36px; min-height:36px; width:auto; padding:0 12px; font-size:11px;">✓ Ganti Foto</button>'
              : '<button type="button" class="btn-primary" data-action="trigger-pod-camera" style="height:36px; min-height:36px; width:auto; padding:0 12px; font-size:11px; background:#0284C7; color:#FFF; border:1px solid #38BDF8;">📷 Ambil Foto</button>') +
          '</div>' +
        '</div>' +
        (hasPhoto
          ? '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-subtle);border-radius:10px;margin-top:2px;">' +
              '<img src="' + escapeHTML(state.podPhoto) + '" alt="Bukti Foto" style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid var(--border-color);">' +
              '<div style="font-size:11px;color:var(--text-sub);">' +
                '<div style="font-weight:700;color:var(--text-main);">Foto Paket Makanan #' + escapeHTML(orderCode) + '</div>' +
                '<div>Dokumentasi paket di lokasi • Valid ✓</div>' +
              '</div>' +
            '</div>'
          : '') +
        '<div style="display:flex; justify-content:flex-end; padding-top:6px; border-top:1px dashed var(--border-color); margin-top:2px;">' +
          (hasBypass
            ? '<button type="button" class="btn-edit-text" data-action="cancel-pod-bypass" style="color:var(--text-sub); font-size:11px;">Batal lewati (Buka kamera ulang)</button>'
            : '<button type="button" class="btn-edit-text" data-action="open-pod-bypass-modal" style="color:#38BDF8; font-size:11px; text-decoration:underline;">Kamera bermasalah? Lewati foto (Serah Langsung) ↗</button>') +
        '</div>' +
      '</div>' +
      '<div class="card" data-action="open-delivery-issue" style="border:1px solid rgba(239, 68, 68, 0.35);background:rgba(239, 68, 68, 0.06);cursor:pointer;padding:14px 16px;">' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:8px;text-align:center;">' +
          '<span style="font-size:13px;font-weight:700;color:#EF4444;">Pelanggan Tidak Buka Pagar / Laporkan Kendala ⚠️</span>' +
        '</div>' +
      '</div>';

    var dock = photoSatisfied
      ? '<div class="slider-track" id="slider-track-finish">' +
          '<div class="slider-progress-fill" id="slider-fill-finish"></div>' +
          '<div class="slider-thumb ' + (isCod ? 'amber' : 'green') + '" id="slider-thumb-finish">➔</div>' +
          '<span class="slider-label">Geser Selesaikan Pengantaran</span>' +
        '</div>'
      : '<div class="slider-track disabled" id="slider-track-finish" data-action="locked-pod-warning">' +
          '<div class="slider-thumb locked">🔒</div>' +
          '<span class="slider-label" style="color:#94A3B8;">📷 Wajib Ambil Foto Bukti Dahulu</span>' +
        '</div>';

    shell('Selesaikan Pengantaran', body, 'tasks', {hideNav:true, dock: dock});

    if (photoSatisfied) {
      initSlider('slider-track-finish', 'slider-thumb-finish', 'slider-fill-finish', function() {
        handleAction('submit-delivery-finish', document.getElementById('slider-thumb-finish'));
      });
    }
  }

  function renderCod() {
    return renderCompleteAction();
  }

  function renderComplete() {
    var task = state.lastCompleted || selectedTask();
    if (!task) return shell('Pengantaran Selesai', errorBody('Ringkasan pengantaran tidak tersedia.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var p = task.payment || {};
    var isCod = Boolean(p.is_cod);
    var amount = p.collected_amount != null ? p.collected_amount : p.amount;
    var orderCode = task.order_number || task.order_id;
    var branchName = (task.pickup && task.pickup.branch_name) || (state.driver && state.driver.branch_name) || 'Kasir Cabang';
    var totalCustody = computeDriverCashCustody();

    var body = renderDriverStepper(4);
    var dock = '';

    if (isCod) {
      if (state.cashSettledByKasir) {
        body +=
          '<div class="card" style="align-items:center;text-align:center;padding:24px;">' +
            '<div style="width:48px;height:48px;border-radius:50%;background:#10B981;color:#042F1E;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;margin-bottom:8px;">✓</div>' +
            '<div style="font-size:17px;font-weight:800;color:var(--text-main);">Setoran Kasir Sukses</div>' +
            '<div style="font-size:12px;color:var(--text-sub);margin-top:2px;">' + escapeHTML(branchName) + ' • Bukti #' + escapeHTML(orderCode) + '</div>' +
            '<div style="font-size:12px;color:#10B981;font-weight:700;margin-top:6px;">Uang COD ' + rupiah(amount) + ' Telah Diserahkan</div>' +
          '</div>';
        dock = '<button type="button" class="btn-primary green" data-action="back-tasks">Selesai &amp; Kembali ke Tugas</button>';
      } else {
        var qrPayload = 'xentra://delivery/settle?order_number=' + encodeURIComponent(orderCode) + '&order_id=' + encodeURIComponent(task.order_id || orderCode) + '&amount=' + encodeURIComponent(amount || 0);
        body +=
          '<div class="card" style="border-color:#F59E0B;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
              '<span style="font-size:12px;color:var(--text-sub);">Uang COD Wajib Disetor:</span>' +
              '<span style="font-size:18px;font-weight:800;color:#FBBF24;">' + rupiah(amount) + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-sub);margin-top:-4px;">' +
              'Total Kas Tertahan Shift Saat Ini: <strong>' + rupiah(totalCustody) + '</strong>' +
            '</div>' +
          '</div>' +
          '<div class="qr-card">' +
            '<div style="font-size:11px;font-weight:800;color:#64748B;">KODE SETORAN KASIR: #' + escapeHTML(orderCode) + '</div>' +
            renderQrCodeHtml(qrPayload) +
            '<div style="font-size:12px;color:#0F172A;font-weight:700;">Order #' + escapeHTML(orderCode) + ' • ' + escapeHTML(branchName) + '</div>' +
            '<div style="font-size:11px;color:#475569;line-height:1.35;margin-top:2px;">Tunjukkan QR ini ke <strong>Kasir di POS Resto</strong> saat menyerahkan uang fisik COD. Status akan otomatis terupdate saat Kasir memvalidasi.</div>' +
          '</div>';
        dock = '<button type="button" class="btn-primary green" data-action="back-tasks">Selesai &amp; Kembali ke Tugas</button>';
      }
    } else {
      body +=
        '<div class="card" style="align-items:center;text-align:center;padding:28px 20px;">' +
          '<div style="width:56px;height:56px;border-radius:50%;background:#10B981;color:#042F1E;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:900;margin-bottom:12px;">✓</div>' +
          '<div style="font-size:18px;font-weight:800;color:var(--text-main);">Pengantaran Selesai!</div>' +
          '<div style="font-size:12px;color:var(--text-sub);margin-top:4px;max-width:260px;line-height:1.4;">' +
            'Pesanan #' + escapeHTML(orderCode) + ' berhasil diantar ke ' + escapeHTML(c.name || 'Pelanggan') + '. Pembayaran online QRIS telah tercatat lunas.' +
          '</div>' +
        '</div>';
      dock = '<button type="button" class="btn-primary green" data-action="back-tasks">Selesai &amp; Kembali ke Tugas</button>';
    }

    shell('Setor Kasir', body, 'tasks', {hideNav:true, dock: dock});
  }

  function renderReturnToStore() {
    var rtsData = state.activeRtsTask;
    if (!rtsData || !rtsData.task) {
      return shell('Retur Resto', errorBody('Data retur pengantaran tidak ditemukan.'), 'tasks', {hideNav:true});
    }

    var task = rtsData.task;
    var c = task.customer || {};
    var orderCode = task.order_number || task.order_id;
    var branchName = (task.pickup && task.pickup.branch_name) || (state.driver && state.driver.branch_name) || 'Outlet Resto';

    var body =
      renderDriverStepper(4, 'rts') +
      '<div class="card" style="border:2px solid #EF4444;background:rgba(239, 68, 68, 0.08);text-align:center;align-items:center;padding:18px 14px;">' +
        '<div style="font-size:32px;">⚠️</div>' +
        '<div style="font-size:16px;font-weight:800;color:#EF4444;margin-top:6px;">PENGANTARAN DIBATALKAN (RETUR)</div>' +
        '<div style="font-size:12px;color:var(--text-sub);margin-top:2px;">Pesanan #' + escapeHTML(orderCode) + ' • ' + escapeHTML(c.name || 'Pelanggan') + '</div>' +
        '<div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:8px 12px;margin-top:10px;font-size:12px;font-weight:700;color:var(--text-main);">' +
          'Alasan: <span style="color:#F87171;">' + escapeHTML(rtsData.reason || 'Pelanggan Tidak Merespons (>10 Menit)') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div style="font-size:12px;font-weight:800;color:var(--text-main);text-transform:uppercase;">Instruksi Pengembalian Makanan (RTS)</div>' +
        '<div style="font-size:12px;color:var(--text-sub);line-height:1.5;">' +
          '1. Bawa makanan kembali utuh ke <strong>Kasir &amp; Dapur ' + escapeHTML(branchName) + '</strong>.<br>' +
          '2. Tanggungan kas COD otomatis <strong>Rp 0 (Batal Tagih)</strong>.<br>' +
          '3. Serahkan ke Kasir dan minta verifikasi fisik makanan retur.' +
        '</div>' +
        '<button type="button" class="btn-secondary" style="margin-top:6px;" data-ops-chat-thread="delivery" data-ops-chat-ref="' + escapeHTML(task.order_id) + '" data-ops-chat-title="Retur ' + escapeHTML(orderCode) + '">' +
          'Buka Chat dengan Kasir 💬' +
        '</button>' +
      '</div>';

    var dock =
      '<div class="slider-track" id="slider-track-rts">' +
        '<div class="slider-progress-fill" id="slider-fill-rts"></div>' +
        '<div class="slider-thumb red" id="slider-thumb-rts">➔</div>' +
        '<span class="slider-label">Geser Konfirmasi Retur Selesai di Resto</span>' +
      '</div>';

    shell('Retur ke Outlet', body, 'tasks', {hideNav:true, dock: dock});

    initSlider('slider-track-rts', 'slider-thumb-rts', 'slider-fill-rts', function() {
      handleAction('confirm-rts-finished', document.getElementById('slider-thumb-rts'));
    });
  }

  function applyPodFileSelection(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(evt) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var maxDim = 1200;
        var width = img.width || 800;
        var height = img.height || 600;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        state.podPhoto = canvas.toDataURL('image/jpeg', 0.82);
        state.podBypass = null;
        toast('✓ Foto bukti serah terima berhasil disimpan!');
        render();
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  function openPodCaptureSheet() {
    var existing = document.getElementById('driver-pod-capture-sheet-overlay');
    if (existing) existing.remove();

    var task = selectedTask();
    var orderCode = (task && (task.order_number || task.order_id)) || 'ORDER';
    var activeStream = null;

    var modal = document.createElement('div');
    modal.id = 'driver-pod-capture-sheet-overlay';
    modal.className = 'sheet-backdrop';
    modal.innerHTML =
      '<div class="sheet-card" onclick="event.stopPropagation()" style="max-height:90vh;overflow-y:auto;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div>' +
            '<span style="font-size:15px;font-weight:800;color:var(--text-main);">📷 Ambil Foto Bukti Serah Terima</span>' +
            '<div style="font-size:11px;color:var(--text-sub);margin-top:1px;">Dokumentasikan paket pesanan #' + escapeHTML(orderCode) + ' di lokasi</div>' +
          '</div>' +
          '<button type="button" id="driver-pod-sheet-close" style="background:transparent;border:none;color:var(--text-sub);font-size:18px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<div id="driver-pod-live-camera-box" style="position:relative;width:100%;height:220px;border-radius:14px;overflow:hidden;background:#090D16;border:1px solid var(--border-color);display:flex;align-items:center;justify-content:center;">' +
          '<video id="driver-pod-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;display:none;"></video>' +
          '<div id="driver-pod-video-placeholder" style="text-align:center;padding:16px;color:var(--text-sub);font-size:12px;">' +
            '<div style="font-size:28px;margin-bottom:6px;">📸</div>' +
            '<div id="driver-pod-cam-status">Menyiapkan kamera perangkat…</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn-primary green" id="driver-pod-shutter-btn" style="display:none;">📸 Jepret Foto Kamera Sekarang</button>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          '<button type="button" class="btn-primary blue" id="driver-pod-sheet-cam-btn" style="margin:0;">📷 Kamera HP</button>' +
          '<button type="button" class="btn-secondary" id="driver-pod-sheet-file-btn" style="margin:0;">📁 Pilih Galeri / File</button>' +
        '</div>' +
        '<input type="file" id="driver-pod-sheet-cam-input" accept="image/*" capture="environment" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="driver-pod-sheet-file-input" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div style="display:flex;gap:8px;margin-top:2px;">' +
          '<button type="button" class="btn-secondary" id="driver-pod-sheet-bypass" style="color:#F59E0B;border-color:rgba(245,158,11,0.4);">Kamera Bermasalah? Lewati Foto (Serah Langsung) ↗</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    function stopStreamAndClose() {
      if (activeStream) {
        try {
          activeStream.getTracks().forEach(function(t) { t.stop(); });
        } catch (_) {}
        activeStream = null;
      }
      modal.remove();
    }

    modal.onclick = function(e) { if (e.target === modal) stopStreamAndClose(); };
    modal.querySelector('#driver-pod-sheet-close').onclick = stopStreamAndClose;
    modal.querySelector('#driver-pod-sheet-bypass').onclick = function() {
      stopStreamAndClose();
      openPodBypassModal();
    };

    var camBtn = modal.querySelector('#driver-pod-sheet-cam-btn');
    var fileBtn = modal.querySelector('#driver-pod-sheet-file-btn');
    var camInput = modal.querySelector('#driver-pod-sheet-cam-input');
    var fileInput = modal.querySelector('#driver-pod-sheet-file-input');
    function onFilePicked(e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      stopStreamAndClose();
      applyPodFileSelection(f);
    }
    if (camBtn && camInput) camBtn.onclick = function() { camInput.click(); };
    if (fileBtn && fileInput) fileBtn.onclick = function() { fileInput.click(); };
    if (camInput) camInput.onchange = onFilePicked;
    if (fileInput) fileInput.onchange = onFilePicked;

    var videoEl = modal.querySelector('#driver-pod-video');
    var placeholderEl = modal.querySelector('#driver-pod-video-placeholder');
    var statusEl = modal.querySelector('#driver-pod-cam-status');
    var shutterBtn = modal.querySelector('#driver-pod-shutter-btn');

    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      }).then(function(stream) {
        if (!document.body.contains(modal)) {
          stream.getTracks().forEach(function(t) { t.stop(); });
          return;
        }
        activeStream = stream;
        videoEl.srcObject = stream;
        videoEl.style.display = 'block';
        if (placeholderEl) placeholderEl.style.display = 'none';
        if (shutterBtn) shutterBtn.style.display = 'flex';
      }).catch(function() {
        if (statusEl) {
          statusEl.textContent = 'Gunakan tombol "Kamera HP" atau "Pilih Galeri / File" di bawah untuk mengambil foto bukti.';
        }
      });
    } else if (statusEl) {
      statusEl.textContent = 'Pilih tombol "Kamera HP" atau "Pilih Galeri / File" di bawah untuk melampirkan foto bukti.';
    }

    if (shutterBtn) {
      shutterBtn.onclick = function() {
        if (!videoEl || !videoEl.videoWidth) return;
        var canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth || 800;
        canvas.height = videoEl.videoHeight || 600;
        canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        state.podPhoto = canvas.toDataURL('image/jpeg', 0.82);
        state.podBypass = null;
        stopStreamAndClose();
        toast('✓ Foto bukti berhasil diambil!');
        render();
      };
    }
  }

  function openPodBypassModal() {
    var existing = document.getElementById('driver-pod-bypass-modal-overlay');
    if (existing) existing.remove();

    var task = selectedTask();
    var cName = (task && task.customer && task.customer.name) || 'Pelanggan';

    var modal = document.createElement('div');
    modal.id = 'driver-pod-bypass-modal-overlay';
    modal.className = 'sheet-backdrop';
    modal.innerHTML =
      '<div class="sheet-card" onclick="event.stopPropagation()">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<span style="font-size:15px; font-weight:800; color:var(--text-main);">Lewati Foto Bukti?</span>' +
          '<button type="button" id="driver-bypass-close-btn" style="background:transparent; border:none; color:var(--text-sub); font-size:18px; cursor:pointer;">✕</button>' +
        '</div>' +
        '<div style="background:rgba(245, 158, 11, 0.1); border:1px solid #F59E0B; border-radius:12px; padding:12px;">' +
          '<div style="font-size:12px; font-weight:800; color:#F59E0B;">⚠️ PERINGATAN SERAH TERIMA</div>' +
          '<div style="font-size:12px; color:var(--text-main); margin-top:3px; line-height:1.4;">' +
            'Gunakan opsi ini hanya jika:<br>' +
            '• Makanan <strong>diserahkan langsung</strong> ke tangan ' + escapeHTML(cName) + '.<br>' +
            '• Kamera HP mengalami gangguan teknis / memori penuh.' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">' +
          '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-subtle);border:1px solid var(--border-color);border-radius:10px;cursor:pointer;font-size:12px;color:var(--text-main);">' +
            '<input type="radio" name="pod_bypass_opt" value="Diserahkan langsung ke pelanggan" checked style="accent-color:#10B981;"> Diserahkan langsung ke tangan pelanggan' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-subtle);border:1px solid var(--border-color);border-radius:10px;cursor:pointer;font-size:12px;color:var(--text-main);">' +
            '<input type="radio" name="pod_bypass_opt" value="Kamera HP bermasalah / memori penuh" style="accent-color:#10B981;"> Kamera HP bermasalah / memori penuh' +
          '</label>' +
        '</div>' +
        '<div style="font-size:12px; color:var(--text-sub); line-height:1.4;">' +
          'Dengan melewati foto, kurir menyatakan bertanggung jawab bahwa pesanan telah diterima dengan baik oleh pelanggan.' +
        '</div>' +
        '<div style="margin-top:4px;">' +
          '<button type="button" class="btn-primary green" id="driver-bypass-submit-btn">✓ Ya, Konfirmasi Lewati Foto</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    modal.querySelector('#driver-bypass-close-btn').onclick = function() { modal.remove(); };
    modal.querySelector('#driver-bypass-submit-btn').onclick = function() {
      var sel = modal.querySelector('input[name="pod_bypass_opt"]:checked');
      state.podBypass = sel ? sel.value : 'Diserahkan langsung ke pelanggan';
      state.podPhoto = null;
      modal.remove();
      render();
    };
  }

  function openDeliveryIssueModal() {
    var task = selectedTask();
    if (!task) return toast('Tugas tidak ditemukan');
    var existing = document.getElementById('driver-delivery-issue-modal-overlay');
    if (existing) existing.remove();

    var reasons = [
      'Pelanggan Tidak Merespons (>10 Menit)',
      'Alamat Salah / Titik Peta Jauh Meleset',
      'Pelanggan Menolak Pesanan / Batal di Tempat',
      'Akses Tertutup (Banjir / Portal Terkunci)'
    ];
    var selectedReason = reasons[0];

    var modal = document.createElement('div');
    modal.id = 'driver-delivery-issue-modal-overlay';
    modal.className = 'sheet-backdrop';

    function renderModalContent() {
      var optionsHtml = reasons.map(function(r) {
        var isSel = selectedReason === r;
        return '<div class="rts-option-card ' + (isSel ? 'selected' : '') + '" data-rts-reason="' + escapeHTML(r) + '">' +
          '<div class="rts-radio-circle"></div>' +
          '<div style="font-size:13px;font-weight:700;color:var(--text-main);">' + escapeHTML(r) + '</div>' +
        '</div>';
      }).join('');

      modal.innerHTML =
        '<div class="sheet-card" onclick="event.stopPropagation()">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="font-size:15px;font-weight:800;color:#EF4444;">Laporkan Kendala Pengantaran</span>' +
            '<button type="button" id="driver-issue-close-btn" style="background:transparent;border:none;color:var(--text-sub);font-size:18px;cursor:pointer;">✕</button>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--text-sub);line-height:1.4;">' +
            'Pilih alasan sebelum membatalkan pengantaran dan memulai alur Retur ke Resto (RTS):' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;">' +
            optionsHtml +
          '</div>' +
          '<div style="margin-top:6px;">' +
            '<button type="button" class="btn-primary red" id="driver-issue-submit-btn">Batalkan &amp; Retur ke Resto</button>' +
          '</div>' +
        '</div>';

      modal.querySelectorAll('[data-rts-reason]').forEach(function(card) {
        card.onclick = function() {
          selectedReason = card.getAttribute('data-rts-reason');
          renderModalContent();
        };
      });

      modal.querySelector('#driver-issue-close-btn').onclick = function() { modal.remove(); };
      modal.querySelector('#driver-issue-submit-btn').onclick = async function() {
        var btn = this;
        btn.disabled = true;
        btn.textContent = 'Memproses...';

        try {
          await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/fail', {
            method: 'POST',
            body: JSON.stringify({ reason: selectedReason, notes: selectedReason })
          });
          modal.remove();
          state.activeRtsTask = {
            task: task,
            reason: selectedReason
          };
          state.page = 'return-to-store';
          render();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Batalkan & Retur ke Resto';
          toast(err.message || 'Gagal melaporkan kendala');
        }
      };
    }

    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    renderModalContent();
    document.body.appendChild(modal);
  }

  function formatChatTime(isoStr) {
    if (!isoStr) return '';
    try {
      var raw = String(isoStr);
      if (raw.indexOf('T') === -1 && raw.indexOf('Z') === -1) {
        raw = raw.replace(' ', 'T') + 'Z';
      }
      var d = new Date(raw);
      if (isNaN(d.getTime())) return '';
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    } catch (_) {
      return '';
    }
  }

  function openCustomerChatSheet() {
    var task = selectedTask() || state.lastCompleted;
    if (!task) return toast('Pesanan tidak ditemukan');
    var existing = document.getElementById('driver-customer-chat-sheet-overlay');
    if (existing) existing.remove();

    var c = task.customer || {};
    var custName = c.name || 'Pelanggan';
    var custInitial = String(custName).trim().charAt(0).toUpperCase() || 'P';
    var orderCode = task.order_number || task.order_id;
    var pendingPhotoBase64 = null;

    var sheet = document.createElement('div');
    sheet.id = 'driver-customer-chat-sheet-overlay';
    sheet.className = 'sheet-backdrop';
    sheet.innerHTML =
      '<div class="sheet-card" onclick="event.stopPropagation()" style="max-height:85vh;height:540px;padding:16px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-color);padding-bottom:10px;">' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:#10B981;color:#FFF;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;">' +
              escapeHTML(custInitial) +
            '</div>' +
            '<div>' +
              '<div style="font-size:13px;font-weight:800;color:var(--text-main);">' + escapeHTML(custName) + '</div>' +
              '<div id="driver-chat-status-sub" style="font-size:11px;color:#38BDF8;">Chat Pengantaran • #' + escapeHTML(orderCode) + '</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" id="driver-chat-close-btn" style="background:transparent;border:none;color:var(--text-sub);font-size:18px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<div style="background:rgba(56, 189, 248, 0.08);border:1px solid rgba(56, 189, 248, 0.25);border-radius:8px;padding:6px 10px;font-size:11px;color:#38BDF8;display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:2px;">' +
          '<div style="line-height:1.3;">' +
            '💡 Terhubung ke halaman lacak pelanggan &amp; kasir resto.' +
          '</div>' +
          '<button type="button" class="btn-secondary" id="driver-chat-wa-btn" style="height:28px;min-height:28px;padding:0 10px;font-size:10.5px;flex-shrink:0;background:rgba(34,197,94,0.15);border-color:#22C55E;color:#22C55E;">' +
            'Ke WA ↗' +
          '</button>' +
        '</div>' +
        '<div id="driver-chat-messages-box" style="flex:1;overflow-y:auto;padding:8px 2px;display:flex;flex-direction:column;gap:8px;">' +
          '<div style="text-align:center;font-size:12px;color:var(--text-sub);margin:auto 0;">Memuat percakapan…</div>' +
        '</div>' +
        '<div id="driver-chat-photo-preview" style="display:none;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;background:var(--bg-subtle);border:1px solid var(--border-color);border-radius:10px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<img id="driver-chat-photo-img" src="" alt="Preview" style="width:36px;height:36px;border-radius:6px;object-fit:cover;">' +
            '<span style="font-size:11px;font-weight:700;color:var(--text-main);">Foto siap dikirim</span>' +
          '</div>' +
          '<button type="button" id="driver-chat-photo-remove" style="background:transparent;border:none;color:#EF4444;font-size:14px;cursor:pointer;font-weight:800;">✕</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;">' +
          '<button type="button" class="calc-chip" data-chat-quick="Saya sudah sampai di depan pagar ya ' + escapeHTML(custName) + '" style="white-space:nowrap;">Sudah di depan pagar</button>' +
          '<button type="button" class="calc-chip" data-chat-quick="Mohon maaf, sedang ada hujan deras / macet sebentar" style="white-space:nowrap;">Ada macet / hujan</button>' +
          '<button type="button" class="calc-chip" data-chat-quick="Pesanan sudah saya serahkan sesuai arahan, terima kasih!" style="white-space:nowrap;">Pesanan diserahkan</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<button type="button" id="driver-chat-photo-btn" style="width:42px;height:42px;border-radius:10px;background:var(--bg-subtle);border:1px solid var(--border-color);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;font-size:17px;" title="Lampirkan Foto">' +
            '📷' +
          '</button>' +
          '<input type="file" id="driver-chat-photo-input" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
          '<input type="text" id="driver-chat-input" class="form-input" placeholder="Tulis pesan ke ' + escapeHTML(custName) + '…" style="flex:1;height:42px;font-size:13px;">' +
          '<button type="button" id="driver-chat-send-btn" class="btn-primary" style="width:44px;height:42px;min-height:42px;padding:0;border-radius:10px;flex-shrink:0;">➔</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(sheet);

    var closeBtn = sheet.querySelector('#driver-chat-close-btn');
    var waBtn = sheet.querySelector('#driver-chat-wa-btn');
    var msgBox = sheet.querySelector('#driver-chat-messages-box');
    var input = sheet.querySelector('#driver-chat-input');
    var sendBtn = sheet.querySelector('#driver-chat-send-btn');
    var photoBtn = sheet.querySelector('#driver-chat-photo-btn');
    var photoInput = sheet.querySelector('#driver-chat-photo-input');
    if (photoBtn && photoInput) {
      photoBtn.onclick = function() { photoInput.click(); };
    }
    var photoPreviewBox = sheet.querySelector('#driver-chat-photo-preview');
    var photoPreviewImg = sheet.querySelector('#driver-chat-photo-img');
    var photoRemoveBtn = sheet.querySelector('#driver-chat-photo-remove');

    var pollInterval = null;
    function cleanupAndClose() {
      if (pollInterval) clearInterval(pollInterval);
      sheet.remove();
    }

    sheet.onclick = function(e) { if (e.target === sheet) cleanupAndClose(); };
    closeBtn.onclick = cleanupAndClose;
    if (waBtn) {
      waBtn.onclick = function() {
        cleanupAndClose();
        openWhatsAppCustomer();
      };
    }

    if (photoInput) {
      photoInput.onchange = function() {
        var f = photoInput.files && photoInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function(evt) {
          var img = new Image();
          img.onload = function() {
            var canvas = document.createElement('canvas');
            var maxDim = 1000;
            var w = img.width;
            var h = img.height;
            if (w > h && w > maxDim) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else if (h > maxDim) {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            pendingPhotoBase64 = canvas.toDataURL('image/jpeg', 0.82);
            if (photoPreviewImg) photoPreviewImg.src = pendingPhotoBase64;
            if (photoPreviewBox) photoPreviewBox.style.display = 'flex';
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(f);
      };
    }

    if (photoRemoveBtn) {
      photoRemoveBtn.onclick = function() {
        pendingPhotoBase64 = null;
        if (photoInput) photoInput.value = '';
        if (photoPreviewBox) photoPreviewBox.style.display = 'none';
      };
    }

    async function loadMessages() {
      try {
        var res = await api('/messages?thread_type=delivery&ref_id=' + encodeURIComponent(task.order_id));
        var list = (res && Array.isArray(res.messages)) ? res.messages : [];
        if (!list.length) {
          msgBox.innerHTML =
            '<div style="text-align:center;padding:24px 14px;color:var(--text-sub);font-size:12px;margin:auto 0;">' +
              '<div style="font-size:24px;margin-bottom:6px;">💬</div>' +
              '<div style="font-weight:700;color:var(--text-main);">Belum ada pesan untuk pesanan #' + escapeHTML(orderCode) + '</div>' +
              '<div style="margin-top:4px;font-size:11px;">Kirim pesan atau pilih chip cepat di bawah untuk menghubungi ' + escapeHTML(custName) + '.</div>' +
            '</div>';
          return;
        }

        msgBox.innerHTML = list.map(function(m) {
          var isMe = (m.sender_role === 'driver');
          var roleBadge = m.sender_role === 'customer' ? 'Pelanggan' : (m.sender_role === 'driver' ? 'Kurir' : 'Kasir / Resto');
          var senderLabel = isMe ? 'Saya' : ((m.sender_name || custName) + ' (' + roleBadge + ')');
          var imgUrl = m.image_url || m.thumb_url;
          var imgHtml = imgUrl
            ? '<div style="margin-bottom:5px;"><img src="' + escapeHTML(imgUrl) + '" alt="Lampiran" style="max-width:100%;max-height:160px;border-radius:8px;display:block;object-fit:cover;cursor:pointer;" onclick="window.open(this.src, \'_blank\')"></div>'
            : '';
          var bodyText = (m.body && m.body !== '📷 [Foto Lampiran]')
            ? '<div style="font-size:12.5px;line-height:1.4;word-break:break-word;">' + escapeHTML(m.body) + '</div>'
            : '';
          var timeStr = formatChatTime(m.created_at);
          var tickHtml = isMe ? (' <span style="opacity:0.85;">' + (m.delivery_status === 'read' ? '✓✓' : '✓') + '</span>') : '';

          return '<div style="align-self:' + (isMe ? 'flex-end' : 'flex-start') + ';max-width:82%;background:' + (isMe ? '#0284C7' : 'var(--bg-subtle)') + ';border:' + (isMe ? 'none' : '1px solid var(--border-color)') + ';border-radius:' + (isMe ? '14px 14px 2px 14px' : '14px 14px 14px 2px') + ';padding:8px 12px;color:' + (isMe ? '#FFF' : 'var(--text-main)') + ';">' +
            '<div style="font-size:10px;font-weight:700;color:' + (isMe ? 'rgba(255,255,255,0.8)' : '#10B981') + ';margin-bottom:2px;">' + escapeHTML(senderLabel) + '</div>' +
            imgHtml +
            bodyText +
            '<div style="font-size:9.5px;text-align:right;margin-top:3px;opacity:0.75;">' + escapeHTML(timeStr) + tickHtml + '</div>' +
          '</div>';
        }).join('');
        msgBox.scrollTop = msgBox.scrollHeight;
      } catch (_) {}
    }

    async function sendMessage(text) {
      var cleanText = String(text || '').trim();
      if (!cleanText && !pendingPhotoBase64) return;
      input.value = '';
      var photoToSend = pendingPhotoBase64;
      pendingPhotoBase64 = null;
      if (photoInput) photoInput.value = '';
      if (photoPreviewBox) photoPreviewBox.style.display = 'none';
      sendBtn.disabled = true;

      try {
        await api('/messages', {
          method: 'POST',
          body: JSON.stringify({
            thread_type: 'delivery',
            ref_id: task.order_id,
            body: cleanText,
            image_base64: photoToSend || undefined
          })
        });
        await loadMessages();
      } catch (e) {
        toast('Gagal mengirim pesan: ' + (e.message || 'Kesalahan jaringan'));
      } finally {
        sendBtn.disabled = false;
      }
    }

    sendBtn.onclick = function() { sendMessage(input.value); };
    input.onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); sendMessage(input.value); } };

    sheet.querySelectorAll('[data-chat-quick]').forEach(function(b) {
      b.onclick = function() { sendMessage(b.getAttribute('data-chat-quick')); };
    });

    loadMessages();
    pollInterval = setInterval(loadMessages, 3500);
  }

  function openWhatsAppCustomer() {
    var task = selectedTask() || state.lastCompleted;
    if (!task) return toast('Pesanan tidak ditemukan');
    var existing = document.getElementById('driver-wa-template-modal');
    if (existing) existing.remove();

    var phone = (task.customer && task.customer.phone) || '';
    var custName = (task.customer && task.customer.name) || 'Pelanggan';
    var orderCode = task.order_number || task.order_id;
    var branchName = (task.pickup && task.pickup.branch_name) || (state.driver && state.driver.branch_name) || 'Outlet';

    var templates = {
      shareloc: 'Halo ' + custName + ', saya kurir ' + branchName + ' mengantar order #' + orderCode + '. Boleh tolong share live location agar cepat sampai? Terima kasih!',
      arrived: 'Halo ' + custName + ', pesanan #' + orderCode + ' sudah tiba di depan pagar rumah. Ditunggu ya.',
      locked: 'Permisi ' + custName + ', saya sudah di depan pagar untuk pesanan #' + orderCode + ' tapi belum ada jawaban. Mohon bantuannya untuk mengambil pesanan ya.'
    };

    var modal = document.createElement('div');
    modal.id = 'driver-wa-template-modal';
    modal.className = 'sheet-backdrop';
    modal.innerHTML =
      '<div class="sheet-card" onclick="event.stopPropagation()">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:18px;">💬</span>' +
            '<span style="font-size:15px;font-weight:800;color:var(--text-main);">Pilih Template Pesan WhatsApp</span>' +
          '</div>' +
          '<button type="button" id="driver-wa-close-btn" style="background:transparent;border:none;color:var(--text-sub);font-size:18px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-sub);">' +
          'Kirim pesan langsung ke WhatsApp ' + escapeHTML(custName) + (phone ? ' (' + escapeHTML(phone) + ')' : '') + ':' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          '<div class="wa-option-card" data-wa-tpl="shareloc">' +
            '<div style="font-size:13px;font-weight:800;color:#25D366;">📍 Minta Share Location WA</div>' +
            '<div style="font-size:11px;color:var(--text-sub);line-height:1.4;">"' + escapeHTML(templates.shareloc) + '"</div>' +
          '</div>' +
          '<div class="wa-option-card" data-wa-tpl="arrived">' +
            '<div style="font-size:13px;font-weight:800;color:#25D366;">🚪 Sudah di Depan Pagar / Rumah</div>' +
            '<div style="font-size:11px;color:var(--text-sub);line-height:1.4;">"' + escapeHTML(templates.arrived) + '"</div>' +
          '</div>' +
          '<div class="wa-option-card" data-wa-tpl="locked">' +
            '<div style="font-size:13px;font-weight:800;color:#25D366;">🔔 Pagar Belum Terbuka / Ditunggu</div>' +
            '<div style="font-size:11px;color:var(--text-sub);line-height:1.4;">"' + escapeHTML(templates.locked) + '"</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn-secondary" id="driver-wa-cancel-btn">Tutup</button>' +
      '</div>';

    document.body.appendChild(modal);

    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    modal.querySelector('#driver-wa-close-btn').onclick = function() { modal.remove(); };
    modal.querySelector('#driver-wa-cancel-btn').onclick = function() { modal.remove(); };

    modal.querySelectorAll('[data-wa-tpl]').forEach(function(card) {
      card.onclick = function() {
        var key = card.getAttribute('data-wa-tpl');
        var msg = templates[key] || templates.shareloc;
        modal.remove();
        if (!phone) return toast('Nomor telepon pelanggan tidak tersedia');
        var cleanPhone = phone.replace(/[^0-9]/g, '');
        if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.substring(1);
        window.open('https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(msg), '_blank');
      };
    });
  }

  function processAvatarFileSelection(file, resetInputFn) {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      if (typeof resetInputFn === 'function') resetInputFn();
      return toast('File harus berupa gambar (JPG, PNG, WebP).');
    }
    if (file.size > 10 * 1024 * 1024) {
      if (typeof resetInputFn === 'function') resetInputFn();
      return toast('Ukuran foto maksimal 10 MB.');
    }

    async function doUpload(rawFile, cropSpec, previewUrl) {
      toast('Mengompres dan mengunggah foto profil…');
      try {
        var base64 = previewUrl;
        var mimeType = previewUrl ? 'image/jpeg' : (rawFile.type || 'image/jpeg');
        if (!base64) {
          base64 = await new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('Gagal membaca gambar.')); };
            reader.readAsDataURL(rawFile);
          });
        }

        var payload = {
          image_base64: base64,
          mime_type: mimeType,
          original_filename: rawFile.name || 'driver-avatar.jpg'
        };
        if (cropSpec) payload.crop_spec = cropSpec;

        var res = await api('/driver/avatar', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        if (res.success && res.avatar_url) {
          if (state.driver) {
            state.driver.avatar_url = res.avatar_url;
            persistUser();
          }
          toast('✓ Foto profil berhasil diperbarui!');
          render();
        } else {
          toast('Gagal memperbarui foto profil.');
        }
      } catch (err) {
        toast(err.message || 'Gagal mengunggah foto profil.');
      } finally {
        if (typeof resetInputFn === 'function') resetInputFn();
      }
    }

    if (window.XentraCropEditor && typeof window.XentraCropEditor.open === 'function') {
      window.XentraCropEditor.open({
        source: file,
        assetType: 'avatar',
        aspectRatio: 1.0,
        title: 'Sesuaikan Foto Profil Driver (1:1)',
        onConfirm: function (cropSpec, previewDataUrl) {
          doUpload(file, cropSpec, previewDataUrl);
        },
        onCancel: function () {
          if (typeof resetInputFn === 'function') resetInputFn();
        }
      });
    } else {
      doUpload(file, null, null);
    }
  }

  function openEditAvatarModal() {
    var existing = document.getElementById('driver-avatar-picker-overlay');
    if (existing) existing.remove();

    var presets = [
      { label: 'Kucing Koki', url: '/owner/assets/img/cat-chef-recipe.png' },
      { label: 'Kucing Santai', url: '/merchant/assets/img/sleepy-cat-closed.png' },
      { label: 'Robot Gesit', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=KurirXentra&backgroundColor=b6e3f4' },
      { label: 'Kurir Topi', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=MitraKurir&backgroundColor=c0aede' },
      { label: 'Emoji Senyum', url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=KurirCepat&backgroundColor=ffd5dc' },
      { label: 'Robot Kurir', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=ExpressDelivery&backgroundColor=ffdfbf' }
    ];

    var grid = presets.map(function(p) {
      var isCurrent = (state.driver && state.driver.avatar_url === p.url);
      return '<div class="avatar-preset-item" data-avatar-url="' + escapeHTML(p.url) + '" style="text-align:center;cursor:pointer;">' +
        '<div style="position:relative;width:68px;height:68px;margin:0 auto;border-radius:50%;border:' + (isCurrent ? '3px solid #38BDF8' : '2px solid var(--border-color)') + ';background:var(--bg-subtle);overflow:hidden;padding:2px;box-shadow:' + (isCurrent ? '0 0 10px rgba(56, 189, 248, 0.4)' : 'none') + ';">' +
          '<img src="' + escapeHTML(p.url) + '" alt="' + escapeHTML(p.label) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">' +
          (isCurrent ? '<div style="position:absolute;bottom:2px;right:2px;width:16px;height:16px;border-radius:50%;background:#0284C7;color:#FFF;font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;">✓</div>' : '') +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;color:' + (isCurrent ? '#38BDF8' : 'var(--text-main)') + ';margin-top:4px;">' + escapeHTML(p.label) + '</div>' +
      '</div>';
    }).join('');

    var modal = document.createElement('div');
    modal.id = 'driver-avatar-picker-overlay';
    modal.className = 'sheet-backdrop';
    modal.innerHTML =
      '<div class="sheet-card" onclick="event.stopPropagation()" style="max-height:85vh;overflow-y:auto;padding:16px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-color);padding-bottom:10px;">' +
          '<div>' +
            '<span style="font-size:15px;font-weight:800;color:var(--text-main);">Foto Profil Pengemudi</span>' +
            '<div style="font-size:11px;color:var(--text-sub);margin-top:1px;">Ganti avatar kartun atau unggah foto sendiri</div>' +
          '</div>' +
          '<button type="button" id="driver-avatar-close-btn" style="background:transparent;border:none;color:var(--text-sub);font-size:18px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">' +
          '<button type="button" class="btn-primary" id="driver-avatar-cam-btn" style="background:#10B981;">📷 Kamera HP</button>' +
          '<button type="button" class="btn-primary" id="driver-avatar-file-btn" style="background:#0284C7;">📁 Pilih File Foto</button>' +
        '</div>' +
        '<input type="file" id="driver-avatar-modal-cam-input" accept="image/*" capture="user" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<input type="file" id="driver-avatar-modal-file-input" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin:6px 0 4px;font-size:11px;color:var(--text-muted);font-weight:800;letter-spacing:0.04em;">' +
          '<span style="flex:1;height:1px;background:var(--border-color);"></span>' +
          'PILIH TEMPLATE AVATAR KARTUN' +
          '<span style="flex:1;height:1px;background:var(--border-color);"></span>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:12px;padding-bottom:4px;">' +
          grid +
        '</div>' +
        '<div style="margin-top:4px;">' +
          '<button type="button" id="driver-avatar-cancel-btn" class="btn-secondary" style="width:100%;">Tutup</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    modal.querySelector('#driver-avatar-close-btn').onclick = function() { modal.remove(); };
    modal.querySelector('#driver-avatar-cancel-btn').onclick = function() { modal.remove(); };

    var modalCamBtn = modal.querySelector('#driver-avatar-cam-btn');
    var modalFileBtn = modal.querySelector('#driver-avatar-file-btn');
    var modalCamInput = modal.querySelector('#driver-avatar-modal-cam-input');
    var modalFileInput = modal.querySelector('#driver-avatar-modal-file-input');

    if (modalCamBtn && modalCamInput) {
      modalCamBtn.onclick = function() { modalCamInput.click(); };
      modalCamInput.addEventListener('change', function() {
        var file = modalCamInput.files && modalCamInput.files[0];
        if (!file) return;
        modal.remove();
        processAvatarFileSelection(file, function() { modalCamInput.value = ''; });
      });
    }
    if (modalFileBtn && modalFileInput) {
      modalFileBtn.onclick = function() { modalFileInput.click(); };
      modalFileInput.addEventListener('change', function() {
        var file = modalFileInput.files && modalFileInput.files[0];
        if (!file) return;
        modal.remove();
        processAvatarFileSelection(file, function() { modalFileInput.value = ''; });
      });
    }

    modal.querySelectorAll('.avatar-preset-item').forEach(function(item) {
      item.onclick = async function() {
        var url = item.getAttribute('data-avatar-url');
        if (!url) return;
        modal.remove();
        toast('Memperbarui avatar kartun…');
        try {
          var res = await api('/driver/profile', {
            method: 'PUT',
            body: JSON.stringify({ avatar_url: url })
          });
          if (res && res.driver) {
            state.driver = res.driver;
            persistUser();
            toast('✓ Avatar berhasil diperbarui!');
            render();
          }
        } catch (err) {
          toast(err.message || 'Gagal mengubah avatar');
        }
      };
    });
  }

  function openBatchSettlementModal() {
    var existing = document.getElementById('driver-batch-settlement-modal');
    if (existing) existing.remove();

    var custodyAmount = computeDriverCashCustody();
    var branchName = (state.driver && state.driver.branch_name) || 'Kasir Cabang';
    var driverIdCode = (state.driver && (state.driver.id || state.driver.username)) || 'SHIFT';

    var unsettledCodList = (state.history || []).filter(function (h) {
      var p = h && h.payment;
      return p && p.is_cod && !isCodTaskSettled(h) && String(h.delivery_status || '').toLowerCase() !== 'failed';
    });
    var firstUnsettled = unsettledCodList[0] || state.lastCompleted || selectedTask();
    var batchOrderCode = (firstUnsettled && (firstUnsettled.order_number || firstUnsettled.order_id)) || ('KSR-BATCH-' + String(driverIdCode).slice(-4).toUpperCase());
    var batchQrPayload = (firstUnsettled && (firstUnsettled.order_number || firstUnsettled.order_id))
      ? ('xentra://delivery/settle?order_number=' + encodeURIComponent(firstUnsettled.order_number || firstUnsettled.order_id) + '&order_id=' + encodeURIComponent(firstUnsettled.order_id || firstUnsettled.order_number) + '&amount=' + encodeURIComponent(custodyAmount || 0))
      : batchOrderCode;

    var unsettledRowsHtml = unsettledCodList.length > 1
      ? '<div style="display:flex;flex-direction:column;gap:4px;max-height:110px;overflow-y:auto;background:var(--bg-subtle);border:1px solid var(--border-color);border-radius:10px;padding:8px 10px;font-size:11px;">' +
          '<div style="font-weight:800;color:var(--text-sub);margin-bottom:2px;">Rincian ' + unsettledCodList.length + ' Pesanan COD Belum Disetor:</div>' +
          unsettledCodList.map(function (u) {
            var uCode = u.order_number || u.order_id;
            var uAmt = (u.payment && (u.payment.collected_amount != null ? u.payment.collected_amount : u.payment.amount)) || 0;
            return '<div style="display:flex;justify-content:space-between;color:var(--text-main);"><span>#' + escapeHTML(uCode) + '</span><strong>' + rupiah(uAmt) + '</strong></div>';
          }).join('') +
        '</div>'
      : '';

    var modal = document.createElement('div');
    modal.id = 'driver-batch-settlement-modal';
    modal.className = 'sheet-backdrop';
    modal.innerHTML =
      '<div class="sheet-card" onclick="event.stopPropagation()">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-size:15px;font-weight:800;color:var(--text-main);">Setoran Kasir Gabungan (End-of-Shift)</span>' +
          '<button type="button" id="driver-batch-close-btn" style="background:transparent;border:none;color:var(--text-sub);font-size:18px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<div style="background:rgba(245, 158, 11, 0.1);border:1px solid #F59E0B;border-radius:12px;padding:12px;text-align:center;">' +
          '<div style="font-size:11px;color:var(--text-sub);">Total Uang Tunai COD yang Diserahkan:</div>' +
          '<div style="font-size:24px;font-weight:900;color:#FBBF24;margin-top:2px;">' + rupiah(custodyAmount) + '</div>' +
          '<div style="font-size:11px;color:var(--text-sub);margin-top:2px;">Serahkan uang fisik ini ke ' + escapeHTML(branchName) + '</div>' +
        '</div>' +
        unsettledRowsHtml +
        '<div class="qr-card">' +
          '<div style="font-size:11px;font-weight:800;color:#64748B;">KODE SETORAN SHIFT: #KSR-' + escapeHTML(batchOrderCode) + '</div>' +
          renderQrCodeHtml(batchQrPayload) +
          '<div style="font-size:12px;color:#0F172A;font-weight:700;">' + escapeHTML(branchName) + '</div>' +
          '<div style="font-size:11px;color:#475569;line-height:1.35;">Minta Kasir scan QR ini di POS saat menyerahkan uang tunai. Layar ini akan otomatis tertutup begitu Kasir memvalidasi.</div>' +
        '</div>' +
        '<div>' +
          '<button type="button" class="btn-secondary" id="driver-batch-cancel-btn">Tutup</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    var batchPoll = setInterval(async function() {
      if (!document.body.contains(modal)) {
        clearInterval(batchPoll);
        return;
      }
      await refreshHistory(true);
      if (computeDriverCashCustody() <= 0) {
        clearInterval(batchPoll);
        modal.remove();
        toast('✓ Seluruh setoran COD shift ini telah divalidasi Kasir!');
        render();
      }
    }, 3500);

    function closeBatchModal() {
      clearInterval(batchPoll);
      modal.remove();
    }

    modal.onclick = function(e) { if (e.target === modal) closeBatchModal(); };
    modal.querySelector('#driver-batch-close-btn').onclick = closeBatchModal;
    modal.querySelector('#driver-batch-cancel-btn').onclick = closeBatchModal;
  }

  function renderHistory() {
    if (state.loading) return shell('Riwayat', loadingBody('Memuat riwayat…'), 'history');
    if (state.error) return shell('Riwayat', errorBody(state.error), 'history');

    var totalDelivered = (state.history || []).length;
    var cashCustody = computeDriverCashCustody();
    var branchName = (state.driver && state.driver.branch_name) || 'Kasir Cabang';

    var itemsHtml = '';
    if (!totalDelivered) {
      itemsHtml =
        '<div class="card" style="align-items:center;text-align:center;padding:28px 16px;">' +
          '<div style="font-size:28px;margin-bottom:6px;">📋</div>' +
          '<div style="font-size:15px;font-weight:800;color:var(--text-main);">Belum Ada Riwayat</div>' +
          '<div style="font-size:12px;color:var(--text-sub);margin-top:4px;max-width:240px;line-height:1.4;">Riwayat pengantaran akan muncul setelah Anda menyelesaikan pesanan.</div>' +
        '</div>';
    } else {
      itemsHtml = state.history.map(function (task) {
        var c = task.customer || {};
        var p = task.payment || {};
        var d = task.destination || {};
        var isCod = Boolean(p.is_cod);
        var isFailed = String(task.delivery_status || '').toLowerCase() === 'failed';
        var isSettled = isCodTaskSettled(task);
        var badgeCls = isFailed ? 'badge-red' : (isCod ? (isSettled ? 'badge-green' : 'badge-amber') : 'badge-blue');
        var statusLabel = isFailed
          ? 'Retur ke Resto (RTS)'
          : (isCod ? (isSettled ? 'Lunas & Kasir Settled' : 'Menunggu Setor Kasir') : 'Terkirim (Lunas)');
        var orderCode = task.order_number || task.order_id;
        var payTypeLabel = isCod ? 'COD' : 'Non-Tunai QRIS';

        return '<div class="card" style="padding:12px 14px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="font-size:13px;font-weight:800;color:var(--text-main);">#' + escapeHTML(orderCode) + '</span>' +
            '<span class="badge ' + badgeCls + '">' + escapeHTML(statusLabel) + '</span>' +
          '</div>' +
          '<div style="font-size:13px;font-weight:700;color:var(--text-main);margin-top:2px;">' + escapeHTML(c.name || 'Pelanggan') + '</div>' +
          (d.address ? '<div style="font-size:11px;color:var(--text-sub);">' + escapeHTML(d.address) + '</div>' : '') +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:6px;border-top:1px solid var(--border-color);font-size:11px;">' +
            '<span style="color:var(--text-muted);">' + escapeHTML(payTypeLabel) + '</span>' +
            '<span style="font-weight:800;color:' + (isFailed ? '#EF4444' : (isCod ? '#FBBF24' : '#10B981')) + ';">' +
              (isFailed ? 'Rp 0' : rupiah(p.amount)) +
            '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    var body =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0 6px;">' +
        '<span style="font-size:14px;font-weight:800;color:var(--text-main);">Riwayat Pengantaran</span>' +
        '<span class="badge badge-green">Hari Ini</span>' +
      '</div>' +
      '<div class="card">' +
        '<div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;text-align:center;">' +
          '<div>' +
            '<div style="font-size:10px;color:var(--text-sub);">Pesanan Selesai</div>' +
            '<div style="font-size:18px;font-weight:800;color:#38BDF8;margin-top:2px;">' + totalDelivered + ' Order</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:10px;color:var(--text-sub);">Kas Tertahan</div>' +
            '<div style="font-size:18px;font-weight:800;color:' + (cashCustody > 0 ? '#FBBF24' : '#10B981') + ';margin-top:2px;">' +
              (cashCustody > 0 ? Math.round(cashCustody / 1000) + 'rb' : '0') +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:10px;color:var(--text-sub);">Status Shift</div>' +
            '<div style="font-size:18px;font-weight:800;color:#10B981;margin-top:2px;">' + (state.isOnline ? 'Aktif' : 'Off') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (cashCustody > 0
        ? '<div class="card" style="border:1.5px solid #F59E0B;background:rgba(245, 158, 11, 0.08);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
              '<div>' +
                '<div style="font-size:10px;font-weight:800;color:#F59E0B;text-transform:uppercase;">Setoran Kasir Gabungan (Shift)</div>' +
                '<div style="font-size:20px;font-weight:900;color:var(--text-main);margin-top:2px;">' + rupiah(cashCustody) + '</div>' +
                '<div style="font-size:11px;color:var(--text-sub);margin-top:1px;">Total uang COD di tangan belum diserahkan ke ' + escapeHTML(branchName) + '</div>' +
              '</div>' +
              '<button type="button" class="btn-primary" data-action="open-batch-settlement-modal" style="height:36px;width:auto;padding:0 12px;font-size:11px;background:#F59E0B;color:#042F1E;">' +
                'Setor Kasir ➔' +
              '</button>' +
            '</div>' +
          '</div>'
        : '<div class="card" style="border:1px solid rgba(16, 185, 129, 0.3);background:rgba(16, 185, 129, 0.05);padding:10px 14px;">' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<span style="color:#10B981;font-size:16px;">✓</span>' +
              '<span style="font-size:12px;font-weight:700;color:#10B981;">Semua setoran kasir shift ini telah tuntas (Rp 0 tertahan).</span>' +
            '</div>' +
          '</div>') +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<div style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;">Daftar Pengantaran Hari Ini</div>' +
        itemsHtml +
      '</div>';

    shell('Riwayat', body, 'history');
  }

  function historyRow(id, name, payment) {
    return '<div class="history-row"><span class="history-pin">●</span><div class="history-main"><div class="history-id">' + escapeHTML(id) + '</div><div class="history-name">' + escapeHTML(name) + '</div><div class="history-time">Terkirim</div></div><div class="history-right"><span class="pill green">Terkirim</span><div class="amount">' + escapeHTML(payment) + '</div></div></div>';
  }

  function getVehicleLabel(vehicleType) {
    var vt = String(vehicleType || 'motorcycle').toLowerCase();
    if (vt === 'car') return 'Mobil';
    if (vt === 'bicycle') return 'Sepeda';
    return 'Sepeda Motor';
  }

  function renderProfile() {
    if (!state.driver) return shell('Profil', loadingBody('Memuat profil…'), 'profile');

    var driverName = state.driver.full_name || state.driver.username || 'Driver';
    var branchName = state.driver.branch_name || 'Cabang Xentra';
    var phone = state.driver.phone || 'Belum diatur';
    var vehicleLabel = getVehicleLabel(state.driver.vehicle_type);
    var avatarUrl = (state.driver && state.driver.avatar_url) || '/owner/assets/img/cat-chef-recipe.png';
    var driverCode = state.driver.username ? '@' + state.driver.username : 'Mitra Kurir';

    var body =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 0 6px;">' +
        '<span style="font-size:14px;font-weight:800;color:var(--text-main);">Profil Pengemudi</span>' +
        '<span class="badge ' + (state.isOnline ? 'badge-green' : 'badge-red') + '">' + (state.isOnline ? 'Aktif' : 'Offline') + '</span>' +
      '</div>' +
      '<div class="card" style="align-items:center;text-align:center;padding:18px;">' +
        '<div id="btn-trigger-avatar" data-action="change-avatar" style="position:relative;cursor:pointer;display:inline-block;" title="Ganti / Unggah Foto Profil">' +
          '<img src="' + escapeHTML(avatarUrl) + '" alt="' + escapeHTML(driverName) + '" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #38BDF8;background:var(--bg-subtle);">' +
          '<div style="position:absolute;bottom:0;right:0;width:26px;height:26px;border-radius:50%;background:#0284C7;border:2px solid var(--bg-card);color:#FFF;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">' +
            '📷' +
          '</div>' +
        '</div>' +
        '<input type="file" id="driver-avatar-input" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">' +
        '<div style="font-size:16px;font-weight:800;color:var(--text-main);margin-top:8px;">' + escapeHTML(driverName) + '</div>' +
        '<div style="font-size:12px;color:var(--text-sub);">' + escapeHTML(driverCode) + ' • ' + escapeHTML(branchName) + '</div>' +
        '<div style="margin-top:10px;">' +
          '<button type="button" class="btn-secondary" data-action="change-avatar" style="height:36px;min-height:36px;padding:0 14px;font-size:11.5px;width:auto;margin:0 auto;">' +
            'Ganti / Unggah Foto Profil ✎' +
          '</button>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;">Kontak &amp; Akun</div>' +
        '<div class="profile-item-row">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">WhatsApp</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">' + escapeHTML(phone) + '</div>' +
          '</div>' +
          '<button type="button" class="btn-edit-text" data-action="edit-profile">Edit</button>' +
        '</div>' +
        '<div class="profile-item-row">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">NIK KTP</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">' + escapeHTML(state.driver.nik || 'Belum diverifikasi') + '</div>' +
          '</div>' +
          '<button type="button" class="btn-edit-text" data-action="verify-ktp">' + (state.driver.nik ? 'Tervalidasi' : 'Verifikasi') + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;">Kendaraan &amp; Operasional</div>' +
        '<div class="profile-item-row">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Jenis Kendaraan</div>' +
            '<div style="font-size:14px;font-weight:800;color:#FBBF24;">' + escapeHTML(vehicleLabel) + '</div>' +
          '</div>' +
          '<button type="button" class="btn-edit-text" data-action="edit-vehicle">Ganti</button>' +
        '</div>' +
        '<div class="profile-item-row">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Cabang Penugasan</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">' + escapeHTML(branchName) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div style="font-size:11px;font-weight:800;color:var(--text-muted);text-transform:uppercase;">Sistem &amp; Akun</div>' +
        '<div class="profile-item-row">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Notifikasi &amp; Alarm Tugas</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">Pusat Suara &amp; Izin Layar</div>' +
          '</div>' +
          '<button type="button" class="btn-edit-text" data-action="open-notifications">Atur</button>' +
        '</div>' +
        '<div class="profile-item-row">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Pembaruan Aplikasi</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">Muat Ulang &amp; Bersihkan Cache</div>' +
          '</div>' +
          '<button type="button" class="btn-edit-text" data-action="force-reload-cache">Reset</button>' +
        '</div>' +
        '<div class="profile-item-row">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Aplikasi Android Native</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">Unduh APK Driver v1.0.8</div>' +
          '</div>' +
          '<a href="/driver/download-apk" download="mybangjo-driver-v1.0.8.apk" class="btn-edit-text" style="text-decoration:none;display:inline-flex;align-items:center;">Unduh ⬇</a>' +
        '</div>' +
        '<div style="padding-top:6px;">' +
          '<button type="button" class="btn-secondary danger" data-action="logout" style="width:100%;">Keluar dari Akun</button>' +
        '</div>' +
      '</div>';

    shell('Profil', body, 'profile');
  }

  function profileItem(ico, label, value, action, isDestructive) {
    var cls = 'profile-list-item' + (isDestructive ? ' destructive' : '');
    return '<button type="button" class="' + cls + '" data-action="' + (action || '') + '">' +
      '<span class="item-icon-box">' + ico + '</span>' +
      '<span class="item-text-box">' +
        '<span class="item-label">' + escapeHTML(label) + '</span>' +
        (value ? '<span class="item-sub">' + escapeHTML(value) + '</span>' : '') +
      '</span>' +
      '<span class="item-chevron">' +
        (isDestructive ? '' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>') +
      '</span>' +
    '</button>';
  }

  function toast(message) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function showEditProfileSheet() {
    var existing = document.getElementById('driver-edit-profile-sheet');
    if (existing) existing.remove();

    var driver = state.driver || {};
    var overlay = document.createElement('div');
    overlay.id = 'driver-edit-profile-sheet';
    overlay.className = 'sheet-backdrop';
    overlay.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<h3 id="edit-profile-title" style="margin:0;">Edit Data Diri Mitra</h3>' +
          '<button type="button" data-sheet-action="cancel" style="background:transparent;border:none;color:var(--text-sub);font-size:18px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<p>Perbarui informasi kontak dan identitas akun pengemudi Anda.</p>' +
        '<div class="form-group">' +
          '<label class="input-label" for="edit-driver-name">Nama Lengkap</label>' +
          '<input type="text" id="edit-driver-name" class="sheet-input" value="' + escapeHTML(driver.full_name || '') + '" placeholder="Nama lengkap">' +
        '</div>' +
        '<div class="form-group" style="margin-top:12px">' +
          '<label class="input-label" for="edit-driver-phone">Nomor HP / WhatsApp Aktif</label>' +
          '<input type="tel" id="edit-driver-phone" class="sheet-input" value="' + escapeHTML(driver.phone || '') + '" placeholder="Contoh: 08123456789">' +
        '</div>' +
        '<div class="form-group" style="margin-top:12px">' +
          '<label class="input-label" for="edit-driver-vehicle">Jenis Kendaraan Operasional</label>' +
          '<select id="edit-driver-vehicle" class="sheet-input">' +
            '<option value="motorcycle"' + ((driver.vehicle_type || 'motorcycle') === 'motorcycle' ? ' selected' : '') + '>🏍️ Sepeda Motor (Rute Roda Dua)</option>' +
            '<option value="car"' + (driver.vehicle_type === 'car' ? ' selected' : '') + '>🚗 Mobil (Rute Roda Empat)</option>' +
            '<option value="bicycle"' + (driver.vehicle_type === 'bicycle' ? ' selected' : '') + '>🚲 Sepeda</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group" style="margin-top:12px">' +
          '<label class="input-label" for="edit-driver-email">Email Terdaftar</label>' +
          '<input type="email" id="edit-driver-email" class="sheet-input" value="' + escapeHTML(driver.email || '') + '" disabled style="opacity:0.6;">' +
        '</div>' +
        '<div style="margin-top:20px">' +
          '<button type="button" class="btn-primary green" data-sheet-action="save">Simpan Perubahan</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', async function (event) {
      if (event.target === overlay) {
        overlay.remove();
        return;
      }
      var action = event.target.closest('[data-sheet-action]');
      if (!action) return;

      var act = action.getAttribute('data-sheet-action');
      if (act === 'cancel') {
        overlay.remove();
        return;
      }

      if (act === 'save') {
        var nameInput = document.getElementById('edit-driver-name');
        var phoneInput = document.getElementById('edit-driver-phone');
        var vehicleInput = document.getElementById('edit-driver-vehicle');
        var nameVal = nameInput ? nameInput.value.trim() : '';
        var phoneVal = phoneInput ? phoneInput.value.trim() : '';
        var vehicleVal = vehicleInput ? vehicleInput.value : 'motorcycle';

        if (!nameVal) {
          toast('Nama lengkap wajib diisi');
          if (nameInput) nameInput.focus();
          return;
        }

        if (!phoneVal) {
          toast('Nomor HP / WhatsApp wajib diisi');
          if (phoneInput) phoneInput.focus();
          return;
        }

        action.disabled = true;
        action.textContent = 'Menyimpan…';

        try {
          var res = await api('/driver/profile', {
            method: 'PUT',
            body: JSON.stringify({
              full_name: nameVal,
              phone: phoneVal,
              vehicle_type: vehicleVal
            })
          });

          if (res.success && res.driver) {
            state.driver = res.driver;
            persistUser();
            overlay.remove();
            toast('Profil berhasil diperbarui');
            render();
          } else {
            toast('Gagal memperbarui profil: ' + (res.error || 'kesalahan sistem'));
            action.disabled = false;
            action.textContent = 'Simpan Perubahan';
          }
        } catch (err) {
          toast(err.message || 'Gagal memperbarui profil');
          action.disabled = false;
          action.textContent = 'Simpan Perubahan';
        }
      }
    });
  }

  function showVerifyKtpSheet() {
    var existing = document.getElementById('driver-ktp-sheet');
    if (existing) existing.remove();

    var driver = state.driver || {};
    var ktpImg = driver.ktp_url
      ? '<img src="' + escapeHTML(driver.ktp_url) + '" alt="Foto KTP" class="ktp-preview-img">'
      : '<div class="ktp-empty-box"><span style="font-size:32px">🪪</span><span>Belum ada foto KTP</span></div>';

    var overlay = document.createElement('div');
    overlay.id = 'driver-ktp-sheet';
    overlay.className = 'sheet-backdrop';
    overlay.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ktp-title">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<h3 id="ktp-title" style="margin:0;">Verifikasi Identitas KTP</h3>' +
          '<button type="button" data-sheet-action="cancel" style="background:transparent;border:none;color:var(--text-sub);font-size:18px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<p>Nomor KTP dan foto identitas resmi untuk keperluan verifikasi operasional pengantaran.</p>' +
        '<div class="form-group">' +
          '<label class="input-label" for="edit-driver-nik">Nomor Induk Kependudukan (NIK 16 Digit)</label>' +
          '<input type="text" id="edit-driver-nik" class="sheet-input" maxlength="16" value="' + escapeHTML(driver.nik || '') + '" placeholder="Masukkan 16 digit NIK">' +
        '</div>' +
        '<div class="form-group" style="margin-top:14px">' +
          '<label class="input-label">Foto KTP / Dokumen Identitas</label>' +
          '<div class="ktp-upload-card" id="btn-trigger-ktp-file">' +
            ktpImg +
            '<div class="ktp-overlay-btn">' + icon('camera') + ' <span>Unggah & Potong KTP</span></div>' +
          '</div>' +
          '<input type="file" id="driver-ktp-input" accept="image/*" style="display:none">' +
        '</div>' +
        '<div style="margin-top:20px">' +
          '<button type="button" class="btn-primary green" data-sheet-action="save-nik">Simpan NIK</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var ktpTrigger = overlay.querySelector('#btn-trigger-ktp-file');
    var ktpInput = overlay.querySelector('#driver-ktp-input');

    if (ktpTrigger && ktpInput) {
      ktpTrigger.addEventListener('click', function () { ktpInput.click(); });
      ktpInput.addEventListener('change', function () {
        var file = ktpInput.files && ktpInput.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          ktpInput.value = '';
          return toast('File harus berupa gambar (JPG, PNG, WebP).');
        }

        async function doUploadKtp(rawFile, cropSpec, previewUrl) {
          toast('Memproses dan mengunggah foto KTP…');
          try {
            var base64 = previewUrl;
            if (!base64) {
              base64 = await new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function () { resolve(reader.result); };
                reader.onerror = function () { reject(new Error('Gagal membaca gambar.')); };
                reader.readAsDataURL(rawFile);
              });
            }

            var payload = {
              image_base64: base64,
              mime_type: rawFile.type || 'image/jpeg',
              original_filename: rawFile.name || 'driver-ktp.jpg'
            };
            if (cropSpec) payload.crop_spec = cropSpec;

            var res = await api('/driver/ktp', {
              method: 'POST',
              body: JSON.stringify(payload)
            });

            if (res.success && res.ktp_url) {
              if (state.driver) {
                state.driver.ktp_url = res.ktp_url;
                persistUser();
              }
              toast('Foto KTP berhasil diunggah.');
              overlay.remove();
              render();
            } else {
              toast('Gagal mengunggah foto KTP: ' + (res.error || 'kesalahan'));
            }
          } catch (err) {
            toast(err.message || 'Gagal mengunggah foto KTP.');
          } finally {
            ktpInput.value = '';
          }
        }

        if (window.XentraCropEditor && typeof window.XentraCropEditor.open === 'function') {
          window.XentraCropEditor.open({
            source: file,
            assetType: 'general',
            aspectRatio: 1.586, // Standar rasio kartu KTP ID-1 ISO/IEC 7810 (85.6mm x 53.98mm ~1.586)
            title: 'Sesuaikan & Potong Foto KTP (1.58:1)',
            onConfirm: function (cropSpec, previewDataUrl) {
              doUploadKtp(file, cropSpec, previewDataUrl);
            },
            onCancel: function () {
              ktpInput.value = '';
            }
          });
        } else {
          doUploadKtp(file, null, null);
        }
      });
    }

    overlay.addEventListener('click', async function (event) {
      if (event.target === overlay) {
        overlay.remove();
        return;
      }
      var action = event.target.closest('[data-sheet-action]');
      if (!action) return;

      var act = action.getAttribute('data-sheet-action');
      if (act === 'cancel') {
        overlay.remove();
        return;
      }

      if (act === 'save-nik') {
        var nikInput = document.getElementById('edit-driver-nik');
        var nikVal = nikInput ? nikInput.value.trim() : '';

        if (nikVal && (!/^\d{16}$/.test(nikVal))) {
          toast('Nomor NIK harus terdiri dari 16 digit angka');
          if (nikInput) nikInput.focus();
          return;
        }

        action.disabled = true;
        action.textContent = 'Menyimpan…';

        try {
          var res = await api('/driver/profile', {
            method: 'PUT',
            body: JSON.stringify({ nik: nikVal })
          });

          if (res.success && res.driver) {
            state.driver = res.driver;
            persistUser();
            overlay.remove();
            toast('NIK berhasil disimpan');
            render();
          } else {
            toast('Gagal menyimpan NIK: ' + (res.error || 'kesalahan'));
            action.disabled = false;
            action.textContent = 'Simpan NIK';
          }
        } catch (err) {
          toast(err.message || 'Gagal menyimpan NIK');
          action.disabled = false;
          action.textContent = 'Simpan NIK';
        }
      }
    });
  }

  function showRejectSheet() {
    var existing = document.getElementById('driver-reject-sheet');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'driver-reject-sheet';
    overlay.className = 'sheet-backdrop';
    overlay.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="reject-title">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<h3 id="reject-title" style="margin:0;">Tolak Tugas</h3>' +
          '<button type="button" data-sheet-action="cancel" style="background:transparent;border:none;color:var(--text-sub);font-size:18px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<p>Pilih atau masukkan alasan penolakan agar pesanan dapat segera dialihkan ke kurir lain:</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">' +
          '<button type="button" class="calc-chip" data-reject-chip="Ban bocor / kendala motor">Ban bocor / kendala motor</button>' +
          '<button type="button" class="calc-chip" data-reject-chip="Sedang mengantar arah berlawanan">Arah berlawanan</button>' +
          '<button type="button" class="calc-chip" data-reject-chip="Kondisi darurat / istirahat">Kondisi darurat</button>' +
        '</div>' +
        '<textarea id="driver-reject-reason" maxlength="500" placeholder="Masukkan alasan penolakan"></textarea>' +
        '<div style="margin-top:10px;"><button type="button" class="btn-primary red" data-sheet-action="submit">Konfirmasi Tolak Tugas</button></div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelectorAll('[data-reject-chip]').forEach(function (chip) {
      chip.onclick = function () {
        var inp = document.getElementById('driver-reject-reason');
        if (inp) inp.value = chip.getAttribute('data-reject-chip') || '';
      };
    });

    overlay.addEventListener('click', async function (event) {
      if (event.target === overlay) {
        overlay.remove();
        return;
      }
      var action = event.target.closest('[data-sheet-action]');
      if (!action) return;

      if (action.getAttribute('data-sheet-action') === 'cancel') {
        overlay.remove();
        return;
      }

      var input = document.getElementById('driver-reject-reason');
      var reason = input ? input.value.trim() : '';
      if (!reason) {
        toast('Alasan penolakan wajib diisi');
        if (input) input.focus();
        return;
      }

      overlay.remove();
      await rejectTask(reason);
    });

    var input = document.getElementById('driver-reject-reason');
    if (input) setTimeout(function () { input.focus(); }, 50);
  }

  var _wakeLockSentinel = null;
  async function syncWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      if (state.isOnline && document.visibilityState === 'visible') {
        if (!_wakeLockSentinel) {
          _wakeLockSentinel = await navigator.wakeLock.request('screen');
          _wakeLockSentinel.addEventListener('release', function () {
            _wakeLockSentinel = null;
          });
        }
      } else if (_wakeLockSentinel) {
        await _wakeLockSentinel.release();
        _wakeLockSentinel = null;
      }
    } catch (_) {}
  }

  document.addEventListener('visibilitychange', function () {
    syncWakeLock();
    if (document.visibilityState === 'visible') {
      var nativeBridge = window.XentraDriverNative || window.XentraNative;
      if (nativeBridge && typeof nativeBridge.hideOverlay === 'function') {
        try { nativeBridge.hideOverlay(); } catch (_) {}
      }
      if (token()) {
        refreshTasks(false).then(function () {
          if (state.page === 'tasks') render();
        });
      }
    }
  });

  window.addEventListener('focus', function () {
    var nativeBridge = window.XentraDriverNative || window.XentraNative;
    if (nativeBridge && typeof nativeBridge.hideOverlay === 'function') {
      try { nativeBridge.hideOverlay(); } catch (_) {}
    }
  });

  var _customTaskAudio = null;
  var _sirenInterval = null;
  var _sirenLoopCount = 0;
  var _alertedOrderIds = {};

  function stopDriverTaskAlarm() {
    var nativeBridge = window.XentraDriverNative || window.XentraNative;
    if (nativeBridge) {
      if (typeof nativeBridge.stopOrderAlarm === 'function') {
        try { nativeBridge.stopOrderAlarm(); } catch (_) {}
      } else if (typeof nativeBridge.stopOrderAlert === 'function') {
        try { nativeBridge.stopOrderAlert(); } catch (_) {}
      }
      if (document.visibilityState === 'visible') {
        if (typeof nativeBridge.hideOverlay === 'function') {
          try { nativeBridge.hideOverlay(); } catch (_) {}
        }
      } else if (typeof nativeBridge.showBall === 'function') {
        try { nativeBridge.showBall(); } catch (_) {}
      }
    }
    if (window.XentraAudio && typeof window.XentraAudio.stopOrderAlert === 'function') {
      try { window.XentraAudio.stopOrderAlert(); } catch (_) {}
    }
    if (_sirenInterval) {
      clearInterval(_sirenInterval);
      _sirenInterval = null;
    }
    if (_customTaskAudio) {
      try {
        _customTaskAudio.pause();
        _customTaskAudio.currentTime = 0;
      } catch (_) {}
    }
  }

  function playSynthesizedDriverSirenBurst() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
      var now = ctx.currentTime;
      // High-visibility GoPartner-style double-trill bell: E5 -> A5 -> C#6 -> E6
      var notes = [659.25, 880.0, 1108.73, 1318.51, 880.0, 1318.51];
      notes.forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        var start = now + i * 0.11;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.01, start);
        gain.gain.exponentialRampToValueAtTime(0.45, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.008, start + 0.105);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.11);
      });
      if (navigator.vibrate) {
        navigator.vibrate([350, 120, 350, 120, 500]);
      }
    } catch (_) {}
  }

  function triggerIncomingTaskAlert(task, isManualTest) {
    stopDriverTaskAlarm();
    playSynthesizedDriverSirenBurst();

    // Native Bridge Integration (Android APK Floating Card & Alarm)
    var nativeBridge = window.XentraDriverNative || window.XentraNative;
    var isAppHidden = document.visibilityState !== 'visible';
    if (nativeBridge) {
      if (typeof nativeBridge.playOrderAlarm === 'function') {
        try { nativeBridge.playOrderAlarm(); } catch (_) {}
      } else if (typeof nativeBridge.playOrderAlert === 'function') {
        try { nativeBridge.playOrderAlert(); } catch (_) {}
      }
      // ONLY show the Native System Overlay Card when the Driver App is in the background!
      // When the app is visible in the foreground, #driver-incoming-task-modal handles the UI cleanly without overlapping.
      if (task && isAppHidden && typeof nativeBridge.showOrderCard === 'function') {
        try {
          var cName = (task.customer && task.customer.name) || 'Pelanggan';
          var addr = (task.destination && task.destination.address) || '';
          var tot = (task.payment && task.payment.amount) ? ('Rp ' + Number(task.payment.amount).toLocaleString('id-ID')) : '';
          nativeBridge.showOrderCard(task.order_id, task.order_number || task.order_id, cName, addr, tot);
        } catch (_) {}
      } else if (!isAppHidden && typeof nativeBridge.hideOverlay === 'function') {
        try { nativeBridge.hideOverlay(); } catch (_) {}
      }
    }

    // Try custom driver MP3 first (/driver/assets/audio/tugas-baru.mp3), fallback to XentraAudio.deliveryAssigned
    try {
      if (!_customTaskAudio && typeof Audio !== 'undefined') {
        _customTaskAudio = new Audio('/driver/assets/audio/tugas-baru.mp3');
      }
      if (_customTaskAudio) {
        _customTaskAudio.currentTime = 0;
        var p = _customTaskAudio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function () {
            if (window.XentraAudio && typeof window.XentraAudio.deliveryAssigned === 'function') {
              window.XentraAudio.deliveryAssigned({
                text: 'Ada tugas pengantaran baru! Silakan terima tugas.',
                maxRepeats: isManualTest ? 1 : 6
              });
            }
          });
        }
      }
    } catch (_) {
      if (window.XentraAudio && typeof window.XentraAudio.deliveryAssigned === 'function') {
        window.XentraAudio.deliveryAssigned({
          text: 'Ada tugas pengantaran baru! Silakan terima tugas.',
          maxRepeats: isManualTest ? 1 : 6
        });
      }
    }

    if (!isManualTest) {
      _sirenLoopCount = 0;
      _sirenInterval = setInterval(function () {
        _sirenLoopCount++;
        var stillHasPending = state.tasks && state.tasks.some(isNewTask);
        if (_sirenLoopCount >= 8 || !stillHasPending) {
          stopDriverTaskAlarm();
          return;
        }
        playSynthesizedDriverSirenBurst();
      }, 3200);
    }

    // Trigger System / OS Notification for background visibility (Service Worker showNotification like Merchant App)
    if (task && isAppHidden) {
      showSystemDriverNotification(task);
    }

    if (task && state.page !== 'new-task') {
      showIncomingTaskModal(task);
    }
  }

  function showSystemDriverNotification(task) {
    // In Native Android App, native Java DriverGpsService handles notification & floating card over apps!
    if (window.IS_NATIVE_APP || window.XentraDriverNative || window.XentraNative) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    var cName = (task.customer && task.customer.name) || 'Pelanggan';
    var addr = (task.destination && task.destination.address) || 'Alamat tujuan';
    var isCod = Boolean(task.payment && task.payment.is_cod);
    var amt = (task.payment && task.payment.amount) ? rupiah(task.payment.amount) : '';
    var payStr = isCod ? ('COD ' + amt) : ('Non-Tunai ' + amt);
    var orderNum = task.order_number || task.order_id;
    var title = '🛵 Tugas Antar Baru! #' + orderNum;
    var body = cName + ' · ' + payStr + ' · ' + addr;
    var authToken = token();

    var aggressiveVibratePattern = [500, 250, 500, 250, 1000, 250, 1000];
    if ('vibrate' in navigator) {
      try { navigator.vibrate(aggressiveVibratePattern); } catch (_) {}
    }

    if ('serviceWorker' in navigator && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification(title, {
          body: body,
          icon: '/driver/assets/icons/icon-192.png',
          badge: '/driver/assets/icons/icon-192.png',
          tag: 'driver-task-' + task.order_id,
          renotify: true,
          requireInteraction: true,
          silent: document.visibilityState === 'visible', // Play OS sound when app is in background/minimized
          vibrate: aggressiveVibratePattern,
          timestamp: Date.now(),
          actions: [
            { action: 'accept', title: '✓ Terima Tugas' },
            { action: 'view', title: '🛵 Buka Detail' }
          ],
          data: {
            orderId: task.order_id,
            orderNumber: orderNum,
            token: authToken,
            url: '/driver/?order_id=' + encodeURIComponent(task.order_id)
          }
        }).catch(function () {});
      }).catch(function () {});
      return;
    }

    try {
      var n = new Notification(title, {
        body: body,
        icon: '/driver/assets/icons/icon-192.png',
        tag: 'driver-task-' + task.order_id,
        renotify: true
      });
      n.onclick = function () {
        window.focus();
        state.selectedOrderId = task.order_id;
        showIncomingTaskModal(task);
      };
    } catch (_) {}
  }

  function syncNativeDriverBridge() {
    var nativeBridge = window.XentraDriverNative || window.XentraNative;
    if (!nativeBridge) return;
    var t = token();
    var d = state.driver || {};
    var driverId = d.id || '';
    var brandId = d.brand_id || (state.brand && state.brand.id) || '';
    var branchId = d.branch_id || '';
    try {
      if (typeof nativeBridge.setAuthToken === 'function' && t) {
        nativeBridge.setAuthToken(t, driverId, brandId, branchId);
      } else if (typeof nativeBridge.syncAuth === 'function' && t) {
        nativeBridge.syncAuth(t, branchId);
      }
      if (typeof nativeBridge.setOnlineStatus === 'function') {
        nativeBridge.setOnlineStatus(Boolean(state.isOnline));
      }
      // NOTE: Never call nativeBridge.setActiveOrder(orderId) with a non-empty string because
      // older APK builds (<= v1.0.6) mapped setActiveOrder(orderId) -> OrderOverlayService.show(orderId)
      // which popped up a duplicate "Tugas Delivery Baru!" overlay card every 5 seconds!
      if (document.visibilityState === 'visible') {
        var hasPending = (state.tasks || []).some(isNewTask);
        if (!hasPending && typeof nativeBridge.hideOverlay === 'function') {
          nativeBridge.hideOverlay();
        }
      }
    } catch (_) {}
  }

  if ('serviceWorker' in navigator && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (!event || !event.data) return;
      if (event.data.type === 'DRIVER_TASK_ACCEPTED_FROM_NOTIFICATION') {
        stopDriverTaskAlarm();
        closeIncomingTaskModal();
        if (window.XentraAudio && typeof window.XentraAudio.orderAccepted === 'function') {
          window.XentraAudio.orderAccepted();
        }
        refreshTasks(false).then(function () {
          if (event.data.orderId) {
            state.selectedOrderId = event.data.orderId;
            state.page = 'delivery-detail';
          }
          render();
        });
      } else if (event.data.type === 'NAVIGATE_TO_DRIVER_TASK' && event.data.orderId) {
        stopDriverTaskAlarm();
        var targetOid = event.data.orderId;
        var autoAcc = Boolean(event.data.autoAccept);
        refreshTasks(false).then(function () {
          state.selectedOrderId = targetOid;
          var found = (state.tasks || []).find(function (t) { return String(t.order_id) === String(targetOid); });
          if (found) {
            if (autoAcc && isNewTask(found)) {
              acceptTask();
            } else if (isNewTask(found)) {
              showIncomingTaskModal(found);
            } else {
              state.page = 'delivery-detail';
              render();
            }
          } else {
            state.page = 'tasks';
            render();
          }
        });
      } else if (event.data.type === 'NEW_DRIVER_TASK_PUSH_RECEIVED') {
        refreshTasks(false).then(function () {
          if (state.page === 'tasks') render();
        });
      }
    });
  }

  function closeIncomingTaskModal() {
    var existing = document.getElementById('driver-incoming-task-modal');
    if (existing) existing.remove();
  }

  function showIncomingTaskModal(task) {
    if (!task) return;
    closeIncomingTaskModal();

    var c = task.customer || {};
    var d = task.destination || {};
    var p = task.payment || {};
    var isCod = Boolean(p.is_cod);
    var distText = task.distance_meters ? (Number(task.distance_meters) / 1000).toFixed(1) + ' km' : 'Siap Antar';
    var itemCount = (task.items && task.items.length) || Number(task.item_count || 0) || 1;
    var branchName = (task.pickup && task.pickup.branch_name) || (state.driver && state.driver.branch_name) || 'Outlet Resto';
    var orderCode = task.order_number || task.order_id;

    var overlay = document.createElement('div');
    overlay.id = 'driver-incoming-task-modal';
    overlay.className = 'incoming-overlay';
    overlay.innerHTML =
      '<div class="incoming-modal ' + (isCod ? '' : 'qris') + '" role="dialog" aria-modal="true">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
          '<span class="badge ' + (isCod ? 'badge-amber' : 'badge-green') + '">TUGAS PENGANTARAN</span>' +
          '<span style="font-size:13px;font-weight:800;color:' + (isCod ? '#F59E0B' : '#10B981') + ';">BARU</span>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
          '<div>' +
            '<div style="font-size:18px;font-weight:800;color:var(--text-main);">#' + escapeHTML(orderCode) + '</div>' +
            '<div style="font-size:12px;color:var(--text-sub);">' + itemCount + ' Menu • ' + escapeHTML(distText) + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<span class="badge ' + (isCod ? 'badge-amber' : 'badge-green') + '">' + (isCod ? 'COD' : 'QRIS (Lunas)') + '</span>' +
            '<div style="font-size:17px;font-weight:800;color:' + (isCod ? 'var(--accent-amber)' : 'var(--brand-green)') + ';margin-top:2px;">' +
              rupiah(p.amount) +
            '</div>' +
          '</div>' +
        '</div>' +
        (!isCod
          ? '<div style="background:rgba(16, 185, 129, 0.12);border:1px solid rgba(16, 185, 129, 0.4);border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;color:#10B981;display:flex;align-items:center;gap:6px;">' +
              '<span>🛡️</span>' +
              '<span>PESANAN SUDAH LUNAS — DILARANG MENAGIH UANG</span>' +
            '</div>'
          : '') +
        '<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;">' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Ambil di Resto:</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">' + escapeHTML(branchName) + '</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:11px;color:var(--text-sub);">Antar ke:</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text-main);">' + escapeHTML(c.name || 'Pelanggan') + '</div>' +
            '<div style="font-size:11px;color:var(--text-sub);">' + escapeHTML(d.address || 'Alamat tujuan belum tersedia') + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;">' +
          '<button type="button" class="btn-secondary" id="btn-modal-reject-task">Tolak</button>' +
          '<button type="button" class="btn-primary green" id="btn-modal-accept-task">Terima Tugas</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var acceptBtn = document.getElementById('btn-modal-accept-task');
    var rejectBtn = document.getElementById('btn-modal-reject-task');

    if (acceptBtn) {
      acceptBtn.onclick = function (e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        stopDriverTaskAlarm();
        closeIncomingTaskModal();
        state.selectedOrderId = task.order_id;
        acceptTask(task.order_id);
      };
    }
    if (rejectBtn) {
      rejectBtn.onclick = function (e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        stopDriverTaskAlarm();
        closeIncomingTaskModal();
        state.selectedOrderId = task.order_id;
        showRejectSheet();
      };
    }
  }

  function showDriverNotificationCenter() {
    var existing = document.getElementById('driver-notif-sheet');
    if (existing) existing.remove();

    var pendingTasks = state.tasks ? state.tasks.filter(isNewTask) : [];
    var activeTasks = state.tasks ? state.tasks.filter(function (t) { return !isNewTask(t); }) : [];
    var permState = ('Notification' in window) ? Notification.permission : 'unsupported';
    var hasNative = Boolean(window.XentraDriverNative || window.XentraNative);
    var overlayPermState = (window.XentraDriverNative && typeof window.XentraDriverNative.hasOverlayPermission === 'function')
      ? (window.XentraDriverNative.hasOverlayPermission() ? 'Aktif ✓' : 'Belum Diaktifkan')
      : null;

    var overlayHtml = '';
    if (hasNative && overlayPermState !== null) {
      overlayHtml =
        '<div style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.35);border-radius:14px;padding:12px;margin-top:8px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
            '<div>' +
              '<div style="font-size:13px;font-weight:800;color:var(--text-main);">🛵 Floating Shortcut di Layar</div>' +
              '<div style="font-size:11.5px;color:var(--text-sub);margin-top:2px;">Tampil di atas Google Maps: <strong>' + overlayPermState + '</strong></div>' +
            '</div>' +
            '<button type="button" class="btn-primary blue" id="btn-driver-overlay-perm" style="width:auto;min-height:38px;padding:0 14px;font-size:12.5px;">Atur Izin</button>' +
          '</div>' +
        '</div>';
    }

    var apkDownloadHtml = !hasNative
      ? '<div style="background:var(--bg-subtle);border:1px dashed var(--border-color);border-radius:14px;padding:12px;margin-top:8px;text-align:center;">' +
          '<div style="font-size:12px;color:var(--text-sub);font-weight:700;">Ingin kartu tugas melayang di atas Google Maps?</div>' +
          '<a href="/driver/download-apk" class="btn-secondary" style="display:inline-flex;align-items:center;justify-content:center;margin-top:6px;min-height:36px;font-size:12px;text-decoration:none;padding:0 14px;gap:6px;">📲 Unduh APK Driver Android Resmi (v1.0.6)</a>' +
        '</div>'
      : '';

    var listHtml = '';
    if (pendingTasks.length) {
      pendingTasks.forEach(function (t) {
        var c = t.customer || {};
        var p = t.payment || {};
        listHtml +=
          '<div style="background:rgba(59,130,246,0.12);border:1.5px solid #3B82F6;border-radius:14px;padding:12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
            '<div style="min-width:0;">' +
              '<div style="font-weight:800;font-size:13.5px;color:var(--text-main);">🔔 Tugas Baru ' + escapeHTML(t.order_number || t.order_id) + '</div>' +
              '<div style="font-size:12px;color:var(--text-sub);margin-top:2px;">' + escapeHTML(c.name || 'Pelanggan') + ' • ' + (p.is_cod ? 'COD ' + rupiah(p.amount) : 'Non-Tunai') + '</div>' +
            '</div>' +
            '<button type="button" class="btn-primary blue" data-notif-order="' + escapeHTML(t.order_id) + '" style="width:auto;min-height:36px;padding:0 12px;font-size:12px;flex-shrink:0;">Lihat</button>' +
          '</div>';
      });
    } else if (activeTasks.length) {
      activeTasks.forEach(function (t) {
        var c = t.customer || {};
        listHtml +=
          '<div style="background:var(--bg-subtle);border:1px solid var(--border-color);border-radius:14px;padding:12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
            '<div style="min-width:0;">' +
              '<div style="font-weight:800;font-size:13.5px;color:var(--text-main);">🛵 ' + escapeHTML(formatDeliveryStatus(t)) + ' (' + escapeHTML(t.order_number || t.order_id) + ')</div>' +
              '<div style="font-size:12px;color:var(--text-sub);margin-top:2px;">' + escapeHTML(c.name || 'Pelanggan') + '</div>' +
            '</div>' +
            '<button type="button" class="btn-secondary" data-notif-active="' + escapeHTML(t.order_id) + '" style="width:auto;min-height:36px;padding:0 12px;font-size:12px;flex-shrink:0;">Buka</button>' +
          '</div>';
      });
    } else {
      listHtml = '<div style="text-align:center;padding:18px 12px;background:var(--bg-subtle);border:1px solid var(--border-color);border-radius:14px;color:var(--text-sub);font-size:13px;margin-bottom:12px;">Belum ada tugas baru yang menunggu konfirmasi.</div>';
    }

    var overlay = document.createElement('div');
    overlay.id = 'driver-notif-sheet';
    overlay.className = 'sheet-backdrop';
    overlay.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true">' +
        '<div class="sheet-handle"></div>' +
        '<h3>🔔 Pusat Notifikasi & Suara</h3>' +
        '<p>Pastikan dering & izin notifikasi aktif agar Anda tidak melewatkan tugas antar baru.</p>' +
        listHtml +
        overlayHtml +
        apkDownloadHtml +
        '<div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);border-radius:14px;padding:12px;margin-top:8px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
            '<div>' +
              '<div style="font-size:13px;font-weight:800;color:var(--text-main);">🔊 Dering Alarm Tugas Baru</div>' +
              '<div style="font-size:11.5px;color:var(--text-sub);margin-top:2px;">Izin Notifikasi HP: <strong>' + (permState === 'granted' ? 'Aktif ✓' : (permState === 'denied' ? 'Diblokir Browser' : 'Belum Diaktifkan')) + '</strong></div>' +
            '</div>' +
            '<button type="button" class="btn-primary green" id="btn-test-driver-sound" style="width:auto;min-height:38px;padding:0 14px;font-size:12.5px;">🔊 Tes Bunyi</button>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:12px;">' +
          '<button type="button" class="btn-secondary" data-ops-chat-inbox="1" style="min-height:42px;font-size:13px;justify-content:center;">💬 Buka Kotak Pesan & Pengumuman Cabang</button>' +
        '</div>' +
        '<div class="sheet-actions" style="margin-top:12px;">' +
          '<button type="button" class="btn-secondary" id="btn-close-notif-sheet">Tutup</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var testBtn = document.getElementById('btn-test-driver-sound');
    if (testBtn) {
      testBtn.onclick = function () {
        if (window.XentraWebPush && typeof window.XentraWebPush.requestAndSubscribe === 'function') {
          window.XentraWebPush.requestAndSubscribe().then(function () {
            showDriverNotificationCenter();
          }).catch(function () {});
        } else if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().then(function () {
            showDriverNotificationCenter();
          }).catch(function () {});
        }
        triggerIncomingTaskAlert(null, true);
        toast('🔊 Bunyi dering & notifikasi latar belakang aktif!');
      };
    }

    var overlayPermBtn = document.getElementById('btn-driver-overlay-perm');
    if (overlayPermBtn) {
      overlayPermBtn.onclick = function () {
        if (window.XentraDriverNative && typeof window.XentraDriverNative.requestOverlayPermission === 'function') {
          window.XentraDriverNative.requestOverlayPermission();
        }
      };
    }

    var closeBtn = document.getElementById('btn-close-notif-sheet');
    if (closeBtn) {
      closeBtn.onclick = function () {
        stopDriverTaskAlarm();
        overlay.remove();
      };
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        overlay.remove();
        return;
      }
      var newBtn = e.target.closest('[data-notif-order]');
      if (newBtn) {
        var oid = newBtn.getAttribute('data-notif-order');
        overlay.remove();
        var found = state.tasks.find(function (t) { return String(t.order_id) === String(oid); });
        if (found) {
          showIncomingTaskModal(found);
        }
        return;
      }
      var actBtn = e.target.closest('[data-notif-active]');
      if (actBtn) {
        var aoid = actBtn.getAttribute('data-notif-active');
        overlay.remove();
        if (String(state.selectedOrderId) !== String(aoid)) {
          resetTaskExecutionState();
        }
        state.selectedOrderId = aoid;
        var aTask = selectedTask();
        if (aTask && aTask.delivery_status === 'on_delivery') {
          state.page = aTask.arrived_at ? 'complete-action' : 'map';
        } else {
          state.page = 'pickup';
        }
        render();
      }
    });
  }

  async function acceptTask(targetOrderId) {
    stopDriverTaskAlarm();
    closeIncomingTaskModal();
    if (targetOrderId && typeof targetOrderId === 'string') {
      state.selectedOrderId = targetOrderId;
    }
    var task = selectedTask();
    if (!task) {
      var firstPending = (state.tasks || []).find(isNewTask);
      if (firstPending) {
        state.selectedOrderId = firstPending.order_id;
        task = firstPending;
      }
    }
    if (!task || state.busy) return;

    // If task is already accepted / picked_up / on_delivery, route directly without calling /accept again
    if (!isNewTask(task)) {
      state.selectedOrderId = task.order_id;
      if (task.delivery_status === 'on_delivery') {
        state.page = task.arrived_at ? 'complete-action' : 'map';
      } else {
        state.page = 'pickup';
      }
      render();
      return;
    }

    state.busy = true;
    renderNewTask();

    try {
      var data = await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/accept', { method: 'POST' });
      state.busy = false;
      state.selectedOrderId = task.order_id;
      resetTaskExecutionState();
      if (window.XentraAudio && typeof window.XentraAudio.orderAccepted === 'function') {
        window.XentraAudio.orderAccepted();
      }
      await refreshTasks(false);
      if (data && data.task) {
        var exists = state.tasks.some(function (t) { return String(t.order_id) === String(data.task.order_id); });
        if (exists) {
          state.tasks = state.tasks.map(function (t) {
            return String(t.order_id) === String(data.task.order_id) ? data.task : t;
          });
        } else {
          state.tasks.push(data.task);
        }
      }
      state.page = 'delivery-detail';
      toast('✓ Tugas diterima! Silakan ambil pesanan.');
      render();
    } catch (err) {
      state.busy = false;
      await refreshTasks(false);
      var refreshed = selectedTask();
      if (refreshed && !isNewTask(refreshed)) {
        state.page = 'delivery-detail';
        render();
        return;
      }
      render();
      toast(err.message || 'Tugas gagal diterima');
    }
  }

  async function rejectTask(reason) {
    stopDriverTaskAlarm();
    closeIncomingTaskModal();
    var task = selectedTask();
    if (!task || state.busy) return;
    state.busy = true;
    try {
      await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/reject', {
        method: 'POST',
        body: JSON.stringify({ reason: reason })
      });
      state.selectedOrderId = null;
      state.busy = false;
      await refreshTasks(false);
      state.page = 'tasks';
      toast('Tugas ditolak');
      render();
    } catch (err) {
      state.busy = false;
      render();
      toast(err.message || 'Tugas gagal ditolak');
    }
  }

  async function transitionTask(endpoint, payload, nextPage) {
    var task = selectedTask();
    if (!task || state.busy) return;

    state.busy = true;

    try {
      var data = await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/' + endpoint, {
        method: 'POST',
        body: payload ? JSON.stringify(payload) : undefined
      });

      state.busy = false;
      if (data && data.task) {
        state.tasks = state.tasks.map(function (t) {
          return String(t.order_id) === String(task.order_id) ? data.task : t;
        });
        if (nextPage === 'complete') state.lastCompleted = data.task;
      }

      if (nextPage === 'complete') {
        state.page = 'complete';
        state.lastCompleted = (data && data.task) || task;
        state.cashSettledByKasir = isCodTaskSettled(state.lastCompleted);
        refreshTasks(false);
        refreshHistory(true);
      } else {
        state.selectedOrderId = task.order_id;
        if (nextPage) state.page = nextPage;
        refreshTasks(false);
      }

      toast(endpoint === 'pickup' ? 'Pesanan berhasil diambil' : endpoint === 'start' ? 'Pengantaran dimulai' : 'Pengantaran selesai');
      render();
    } catch (err) {
      state.busy = false;
      render();
      toast(err.message || 'Tindakan gagal diproses');
    }
  }

  async function refreshTasks(showLoading) {
    if (showLoading) {
      state.loading = true;
      state.error = null;
      renderTasks();
    }

    try {
      var data = await api('/driver/tasks');
      var newTasks = Array.isArray(data.tasks) ? data.tasks : [];
      state.counts = data.counts || { active: 0, new: 0, accepted: 0 };

      // Detect newly assigned pending tasks by order_id or count increase
      var pendingTasks = newTasks.filter(isNewTask);
      var prevCount = state.knownPendingCount || 0;
      var newPendingCount = pendingTasks.length;

      var freshlyAssignedTask = pendingTasks.find(function (t) {
        return !_alertedOrderIds[t.order_id];
      });

      if (freshlyAssignedTask || newPendingCount > prevCount) {
        var targetAlertTask = freshlyAssignedTask || pendingTasks[0];
        if (targetAlertTask) {
          _alertedOrderIds[targetAlertTask.order_id] = true;
        }
        triggerIncomingTaskAlert(targetAlertTask, false);
      }

      if (newPendingCount === 0) {
        stopDriverTaskAlarm();
        closeIncomingTaskModal();
      }

      state.knownPendingCount = newPendingCount;
      state.tasks = newTasks;
      state.loading = false;
      state.error = null;
      syncNativeDriverBridge();
      return data;
    } catch (err) {
      if (err.status === 401) return null;
      state.loading = false;
      state.error = err.message || 'Tugas tidak dapat dimuat.';
      return null;
    }
  }

  function resetTaskExecutionState() {
    state.pickupChecks = {};
    state.podPhoto = null;
    state.podBypass = null;
    state.podNote = null;
    state.tenderedAmount = null;
    state.cashSettledByKasir = false;
  }

  async function refreshHistory(silent) {
    if (!silent) {
      state.loading = true;
      state.error = null;
      renderHistory();
    }

    try {
      var data = await api('/driver/history');
      state.history = Array.isArray(data.deliveries) ? data.deliveries : [];
      if (!silent) state.loading = false;
      return data;
    } catch (err) {
      if (err.status === 401) return null;
      if (!silent) {
        state.loading = false;
        state.error = err.message || 'Riwayat tidak dapat dimuat.';
      }
      return null;
    }
  }

  async function loadDriver() {
    state.loading = true;
    state.error = null;

    if (!token()) {
      window.location.href = '/login?target=driver';
      return;
    }

    try {
      var data = await api('/driver/me');
      state.driver = data.driver || null;
      state.brand = data.brand || null;
      persistUser();

      try {
        var avail = await api('/driver/availability');
        state.isOnline = Boolean(avail && avail.is_online);
      } catch (_) {
        state.isOnline = false;
      }
      syncNativeDriverBridge();
      if (window.XentraWebPush && typeof window.XentraWebPush.register === 'function') {
        window.XentraWebPush.register().catch(function () {});
      }
      if (state.isOnline) {
        driverLocationService.start();
        syncWakeLock();
      }
    } catch (err) {
      if (err.status === 401) return;
      state.loading = false;
      state.error = err.message || 'Profil Driver tidak dapat dimuat.';
      renderTasks();
      if (window.Xentra && typeof window.Xentra.hideSplash === 'function') {
        window.Xentra.hideSplash();
      }
      return;
    }

    await Promise.all([refreshTasks(false), refreshHistory(true)]);
    state.loading = false;

    try {
      var urlParams = new URLSearchParams(window.location.search || '');
      var deepOrderId = urlParams.get('order_id');
      var autoAcceptParam = urlParams.get('auto_accept') === '1';
      if (deepOrderId) {
        state.selectedOrderId = deepOrderId;
        var matchedDeepTask = (state.tasks || []).find(function (t) { return String(t.order_id) === String(deepOrderId); });
        if (window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        if (matchedDeepTask) {
          if (autoAcceptParam && isNewTask(matchedDeepTask)) {
            acceptTask();
          } else if (isNewTask(matchedDeepTask)) {
            setTimeout(function () { showIncomingTaskModal(matchedDeepTask); }, 150);
          } else {
            state.page = 'delivery-detail';
          }
        }
      }
    } catch (_) {}

    render();
    if (window.Xentra && typeof window.Xentra.hideSplash === 'function') {
      window.Xentra.hideSplash();
    }
  }

  async function go(page) {
    if (page === 'history') {
      state.page = 'history';
      await refreshHistory();
      render();
      return;
    }
    state.page = page;
    render();
  }

  function render() {
    cleanupDriverMap();
    if (state.page === 'tasks') return renderTasks();
    if (state.page === 'new-task') return renderNewTask();
    if (state.page === 'delivery-detail') return renderDetail();
    if (state.page === 'pickup') return renderPickup();
    if (state.page === 'map') return renderMap();
    if (state.page === 'complete-action' || state.page === 'cod') return renderCompleteAction();
    if (state.page === 'complete') return renderComplete();
    if (state.page === 'return-to-store') return renderReturnToStore();
    if (state.page === 'history') return renderHistory();
    if (state.page === 'profile') return renderProfile();
    return renderTasks();
  }

  function bind() {
    app.querySelectorAll('[data-page]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('[data-action]')) {
          return;
        }
        var page = el.getAttribute('data-page');
        var orderId = el.getAttribute('data-order');
        if (orderId) {
          if (String(state.selectedOrderId) !== String(orderId)) {
            resetTaskExecutionState();
          }
          state.selectedOrderId = orderId;
        }
        go(page);
      });
    });

    app.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var actionOrder = el.getAttribute('data-order');
        if (actionOrder) {
          state.selectedOrderId = actionOrder;
        }
        handleAction(el.getAttribute('data-action'), el);
      });
    });

    var input = document.getElementById('tendered');
    if (input) {
      input.addEventListener('input', function () {
        var value = Number(String(input.value).replace(/[^0-9]/g, '')) || 0;
        var task = selectedTask();
        var expected = task && task.payment ? Number(task.payment.amount || 0) : 0;
        var change = Math.max(0, value - expected);
        var out = document.getElementById('change');
        if (out) out.textContent = rupiah(change);
      });
    }

    var custTendered = document.getElementById('driver-tendered-custom');
    if (custTendered) {
      custTendered.addEventListener('input', function () {
        var val = Number(custTendered.value) || 0;
        state.tenderedAmount = val;
        var tsk = selectedTask();
        var exp = tsk && tsk.payment ? Number(tsk.payment.amount || 0) : 0;
        var chg = Math.max(0, val - exp);
        var chgEl = document.getElementById('driver-change-display');
        if (chgEl) chgEl.textContent = rupiah(chg);
      });
    }

    app.querySelectorAll('.driver-pickup-check').forEach(function (chk) {
      chk.addEventListener('change', function () {
        var itId = chk.getAttribute('data-item-id');
        if (itId) state.pickupChecks[itId] = chk.checked;
        render();
      });
    });

    var podFileInput = document.getElementById('driver-pod-file-input');
    if (podFileInput) {
      podFileInput.addEventListener('change', function () {
        var file = podFileInput.files && podFileInput.files[0];
        if (!file) return;
        applyPodFileSelection(file);
        podFileInput.value = '';
      });
    }

    var avatarInput = document.getElementById('driver-avatar-input');
    if (avatarInput) {
      avatarInput.addEventListener('change', function () {
        var file = avatarInput.files && avatarInput.files[0];
        if (!file) return;
        processAvatarFileSelection(file, function () { avatarInput.value = ''; });
      });
    }
  }

  async function handleAction(action, triggerEl) {
    if (action === 'toggle-theme') {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      try { localStorage.setItem('xentra_driver_theme', state.theme); } catch (_) {}
      return render();
    }

    if (action === 'open-notifications') {
      return showDriverNotificationCenter();
    }

    if (action === 'edit-profile' || action === 'edit-vehicle') {
      return showEditProfileSheet();
    }

    if (action === 'verify-ktp') {
      return showVerifyKtpSheet();
    }

    if (action === 'change-avatar') {
      return openEditAvatarModal();
    }

    if (action === 'back' || action === 'back-tasks') {
      state.lastCompleted = null;
      state.cashSettledByKasir = false;
      state.page = 'tasks';
      return refreshTasks(false).then(render);
    }

    if (action === 'reload') {
      if (state.page === 'history') await refreshHistory();
      else await refreshTasks(true);
      render();
      return;
    }

    if (action === 'accept') return acceptTask();
    if (action === 'reject') return showRejectSheet();

    if (action === 'pickup-and-start' || action === 'pickup' || action === 'confirm-pickup' || action === 'start-delivery' || action === 'confirm-pickup-start') {
      var pTask = selectedTask();
      if (!pTask || state.busy) return;
      state.busy = true;
      try {
        var latestTask = pTask;
        if (pTask.delivery_status === 'assigned') {
          var resPickup = await api('/driver/tasks/' + encodeURIComponent(pTask.order_id) + '/pickup', { method: 'POST' });
          if (resPickup && resPickup.task) latestTask = resPickup.task;
        }
        if (latestTask.delivery_status === 'assigned' || latestTask.delivery_status === 'picked_up') {
          var resStart = await api('/driver/tasks/' + encodeURIComponent(pTask.order_id) + '/start', { method: 'POST' });
          if (resStart && resStart.task) latestTask = resStart.task;
        }
        latestTask.delivery_status = 'on_delivery';
        state.tasks = state.tasks.map(function (t) {
          return String(t.order_id) === String(pTask.order_id) ? latestTask : t;
        });
        state.busy = false;
        state.selectedOrderId = pTask.order_id;
        state.page = 'map';
        toast('🛵 Pesanan diambil & pengantaran dimulai!');
        render();
        refreshTasks(false);
      } catch (err) {
        state.busy = false;
        render();
        toast(err.message || 'Gagal memulai pengantaran');
      }
      return;
    }

    if (action === 'delivery-map') {
      state.page = 'map';
      return render();
    }

    if (action === 'notify-arrived') {
      var arrTask = selectedTask();
      if (!arrTask) return toast('Tugas pengantaran tidak ditemukan');
      arrTask.arrived_at = new Date().toISOString();
      state.page = 'complete-action';
      render();
      toast('🔔 Notifikasi sampai telah dikirim ke aplikasi pelanggan!');
      api('/driver/tasks/' + encodeURIComponent(arrTask.order_id) + '/arrived', { method: 'POST' }).then(function (resArr) {
        if (resArr && resArr.task) {
          state.tasks = state.tasks.map(function (t) {
            return String(t.order_id) === String(arrTask.order_id) ? resArr.task : t;
          });
        }
      }).catch(function () {});
      return;
    }

    if (action === 'complete-delivery' || action === 'go-to-complete') {
      var task = selectedTask();
      if (!task) return toast('Tugas pengantaran tidak ditemukan');
      state.page = 'complete-action';
      return render();
    }

    if (action === 'toggle-pickup-item') {
      var itId = triggerEl ? triggerEl.getAttribute('data-item-id') : null;
      if (itId) {
        state.pickupChecks[itId] = !state.pickupChecks[itId];
        return render();
      }
      return;
    }

    if (action === 'check-all-items') {
      var pTask = selectedTask();
      if (pTask) {
        var itemsToCheck = Array.isArray(pTask.items) && pTask.items.length ? pTask.items : [
          { id: 'default_1', quantity: Number(pTask.item_count || 1), product_name: 'Paket Pesanan #' + (pTask.order_number || pTask.order_id) }
        ];
        var allNowChecked = itemsToCheck.every(function(it) { return Boolean(state.pickupChecks[it.id]); });
        itemsToCheck.forEach(function(it) { state.pickupChecks[it.id] = !allNowChecked; });
        return render();
      }
      return;
    }

    if (action === 'open-whatsapp') {
      return openWhatsAppCustomer();
    }

    if (action === 'open-customer-chat') {
      return openCustomerChatSheet();
    }

    if (action === 'open-delivery-issue') {
      return openDeliveryIssueModal();
    }

    if (action === 'confirm-rts-finished') {
      state.activeRtsTask = null;
      toast('Retur pesanan berhasil diselesaikan di resto.');
      await refreshTasks(false);
      state.page = 'tasks';
      render();
      return;
    }

    if (action === 'trigger-pod-camera') {
      return openPodCaptureSheet();
    }

    if (action === 'open-pod-bypass-modal') {
      return openPodBypassModal();
    }

    if (action === 'cancel-pod-bypass') {
      state.podBypass = null;
      return render();
    }

    if (action === 'set-tendered') {
      var amt = Number(triggerEl.getAttribute('data-amount') || 0);
      state.tenderedAmount = amt;
      return render();
    }

    if (action === 'prompt-custom-tendered') {
      var tsk = selectedTask();
      var expAmt = tsk && tsk.payment ? Number(tsk.payment.amount || 0) : 0;
      var curAmt = state.tenderedAmount || expAmt;
      var val = window.prompt('Masukkan nominal uang yang diterima dari pelanggan (Rp):', String(curAmt));
      if (val !== null) {
        var num = parseInt(String(val).replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num) && num >= expAmt) {
          state.tenderedAmount = num;
          render();
        } else if (!isNaN(num) && num < expAmt) {
          toast('Nominal uang diterima tidak boleh kurang dari total tagihan COD (' + rupiah(expAmt) + ').');
        }
      }
      return;
    }

    if (action === 'locked-pod-warning') {
      return toast('Wajib foto bukti serah terima paket terlebih dahulu, atau gunakan opsi Lewati Foto jika kamera bermasalah.');
    }

    if (action === 'settle-cashier-single') {
      toast('Memeriksa status setoran kasir...');
      await refreshHistory(true);
      var doneTask = state.lastCompleted || selectedTask();
      if (doneTask && state.history) {
        var matched = state.history.find(function (h) { return String(h.order_id) === String(doneTask.order_id); });
        if (matched && isCodTaskSettled(matched)) {
          state.cashSettledByKasir = true;
          toast('✓ Setoran COD telah divalidasi oleh Kasir!');
          return render();
        }
      }
      state.cashSettledByKasir = false;
      toast('⏳ Setoran belum divalidasi Kasir di POS. Minta Kasir scan QR di atas.');
      return render();
    }

    if (action === 'open-batch-settlement-modal') {
      return openBatchSettlementModal();
    }

    if (action === 'submit-delivery-finish') {
      var finishTask = selectedTask();
      if (!finishTask) return toast('Tugas pengantaran tidak ditemukan');
      if (!state.podPhoto && !state.podBypass) {
        return toast('Foto bukti pengantaran wajib diambil atau pilih kendala bypass');
      }

      var finishPayload = {
        pod_photo_url: state.podPhoto || null,
        pod_bypass_reason: state.podBypass || null,
        pod_note: state.podNote || null
      };

      if (finishTask.payment && finishTask.payment.is_cod) {
        var custInput = document.getElementById('driver-tendered-custom');
        var tendered = custInput ? (Number(custInput.value) || 0) : (state.tenderedAmount || Number(finishTask.payment.amount || 0));
        var expected = Number(finishTask.payment.amount || 0);
        if (tendered < expected) {
          return toast('Nominal uang diterima kurang dari total tagihan COD (' + rupiah(expected) + ')');
        }
        finishPayload.cod_amount_tendered = tendered;
      }

      return transitionTask('complete', finishPayload, 'complete');
    }

    if (action === 'cod-exact') {
      var exactTask = selectedTask();
      var exactAmt = exactTask && exactTask.payment ? Number(exactTask.payment.amount || 0) : 0;
      if (exactAmt <= 0) return toast('Nominal COD tidak valid');
      return transitionTask('complete', { cod_amount_tendered: exactAmt }, 'complete');
    }

    if (action === 'cod-fill') {
      var fillAmt = triggerEl ? Number(triggerEl.getAttribute('data-amount') || 0) : 0;
      var inputEl = document.getElementById('tendered');
      if (inputEl && fillAmt > 0) {
        inputEl.value = String(fillAmt);
        var cTask = selectedTask();
        var exp = cTask && cTask.payment ? Number(cTask.payment.amount || 0) : 0;
        var outEl = document.getElementById('change');
        if (outEl) outEl.textContent = rupiah(Math.max(0, fillAmt - exp));
      }
      return;
    }

    if (action === 'complete-cod') {
      var codTask = selectedTask();
      var input = document.getElementById('tendered');
      var tendered = input ? Number(String(input.value).replace(/[^0-9]/g, '')) || 0 : 0;
      var expected = codTask && codTask.payment ? Number(codTask.payment.amount || 0) : 0;
      if (tendered < expected) {
        toast('Uang yang diterima kurang dari total COD');
        return;
      }
      return transitionTask('complete', { cod_amount_tendered: tendered }, 'complete');
    }

    if (action === 'call') {
      var selected = selectedTask() || state.lastCompleted;
      var phone = selected && selected.customer && selected.customer.phone;
      if (!phone) return toast('Nomor pelanggan tidak tersedia');
      window.location.href = 'tel:' + phone;
      return;
    }

    if (action === 'zoom-in-map' || action === 'zoom-out-map') {
      var delta = action === 'zoom-in-map' ? 1 : -1;
      var activeMap = mapState.map || mapState.detailMap;
      if (activeMap && typeof activeMap.getZoom === 'function') {
        var nextZoom = Math.min(19, Math.max(4, activeMap.getZoom() + delta));
        if (typeof activeMap.easeTo === 'function') {
          activeMap.easeTo({ zoom: nextZoom, duration: 220 });
        } else if (typeof activeMap.setZoom === 'function') {
          activeMap.setZoom(nextZoom);
        }
        return;
      }
      var fallbackContainer = document.getElementById('driver-map') || document.getElementById('driver-detail-map');
      var fallbackTask = selectedTask();
      var fallbackDest = destinationCoordinates(fallbackTask);
      if (fallbackContainer && fallbackDest) {
        mapState.fallbackZoom = Math.min(18, Math.max(11, (mapState.fallbackZoom || 15) + delta));
        renderOsmTilePreview(fallbackContainer, fallbackDest, mapState.fallbackZoom);
      }
      return;
    }

    if (action === 'recenter-map') {
      if (mapState.map) {
        fitDriverRoute();
        return;
      }
      toast('Peta belum dimuat');
      return;
    }

    if (action === 'refresh-map') {
      var routeTask = selectedTask();
      if (!routeTask) return;
      var originPos = mapState.currentPosition || pickupCoordinates(routeTask);
      toast('Memperbarui rute pengantaran…');
      fetchDriverRoute(originPos, routeTask);
      return;
    }

    if (action === 'navigate') {
      var navTask = selectedTask();
      var destination = navTask && navTask.destination;
      if (!destination || destination.latitude == null || destination.longitude == null) {
        return toast('Koordinat tujuan belum tersedia');
      }
      var destCoords = destination.latitude + ',' + destination.longitude;
      var vehicleType = (state.driver && state.driver.vehicle_type) || 'motorcycle';
      var androidMode = vehicleType === 'car' ? 'd' : (vehicleType === 'bicycle' ? 'b' : 'l');
      var webTravelMode = vehicleType === 'car' ? 'driving' : (vehicleType === 'bicycle' ? 'bicycling' : 'two-wheeler');

      // Android Native Turn-by-Turn intent with fallback to web Google Maps
      var isAndroid = /Android/i.test(navigator.userAgent);
      if (isAndroid) {
        window.location.href = 'google.navigation:q=' + encodeURIComponent(destCoords) + '&mode=' + androidMode;
        setTimeout(function () {
          window.location.href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destCoords) + '&travelmode=' + webTravelMode;
        }, 1200);
      } else {
        window.location.href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destCoords) + '&travelmode=' + webTravelMode;
      }
      return;
    }

    if (action === 'toggle-availability' || action === 'availability') {
      state.isOnline = !state.isOnline;
      render();
      try {
        await api('/driver/availability', {
          method: 'POST',
          body: JSON.stringify({ is_online: state.isOnline })
        });
        syncNativeDriverBridge();
        if (state.isOnline) {
          driverLocationService.start();
          syncWakeLock();
          if (window.XentraWebPush && typeof window.XentraWebPush.requestAndSubscribe === 'function') {
            window.XentraWebPush.requestAndSubscribe().catch(function () {});
          } else if ('Notification' in window && Notification.permission === 'default') {
            try { Notification.requestPermission().catch(function () {}); } catch (_) {}
          }
          toast('🟢 Status Anda sekarang ONLINE (Siap Antar)');
        } else {
          driverLocationService.stop();
          syncWakeLock();
          stopDriverTaskAlarm();
          toast('⚪ Status Anda sekarang OFFLINE (Istirahat)');
        }
      } catch (err) {
        state.isOnline = !state.isOnline;
        syncNativeDriverBridge();
        render();
        toast('Gagal memperbarui status: ' + (err.message || 'Kesalahan jaringan'));
      }
      return;
    }
    if (action === 'next-stage-info') return toast('Tahap berikutnya mengikuti state Delivery dari server.');

    if (action === 'force-reload-cache') {
      toast('Membersihkan seluruh cache aplikasi...');
      localStorage.removeItem('xentra_driver_version');
      if (window.XentraDriverNative && typeof window.XentraDriverNative.clearAppCache === 'function') {
        try { window.XentraDriverNative.clearAppCache(); } catch (_) {}
      }
      if ('caches' in window) {
        caches.keys().then(function (names) {
          return Promise.all(names.map(function (n) { return caches.delete(n); }));
        }).then(function () {
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function (regs) {
              return Promise.all(regs.map(function (r) { return r.unregister(); }));
            }).then(function () {
              window.location.href = window.location.origin + window.location.pathname + '?_bust=' + Date.now();
            });
          } else {
            window.location.href = window.location.origin + window.location.pathname + '?_bust=' + Date.now();
          }
        });
      } else {
        window.location.href = window.location.origin + window.location.pathname + '?_bust=' + Date.now();
      }
      return;
    }

    if (action === 'logout') {
      state.isOnline = false;
      var nativeBridge = window.XentraDriverNative || window.XentraNative;
      if (nativeBridge) {
        try {
          if (typeof nativeBridge.setOnlineStatus === 'function') nativeBridge.setOnlineStatus(false);
          if (typeof nativeBridge.setAuthToken === 'function') nativeBridge.setAuthToken('', '', '', '');
          if (typeof nativeBridge.clearAuth === 'function') nativeBridge.clearAuth();
          if (typeof nativeBridge.hideOverlay === 'function') nativeBridge.hideOverlay();
        } catch (_) {}
      }
      try { await api('/auth/logout', { method: 'POST' }); } catch (_) {}
      clearSession();
      window.location.href = '/login?target=driver';
    }
  }

  window.addEventListener('popstate', function () {
    state.page = 'tasks';
    refreshTasks(false).then(render);
  });

  window.onSelectTargetOrder = function (orderId, autoAccept) {
    stopDriverTaskAlarm();
    closeIncomingTaskModal();
    if (!orderId) return;
    state.selectedOrderId = orderId;
    var routeSelectedTask = function () {
      var found = (state.tasks || []).find(function (t) {
        return String(t.order_id) === String(orderId);
      });
      if (!found) {
        state.page = 'tasks';
        render();
        return;
      }
      if (isNewTask(found)) {
        if (autoAccept) {
          acceptTask(orderId);
        } else {
          state.page = 'new-task';
          render();
        }
      } else if (found.delivery_status === 'on_delivery') {
        state.page = found.arrived_at ? 'complete-action' : 'map';
        render();
      } else {
        state.page = 'pickup';
        render();
      }
    };
    var existing = (state.tasks || []).find(function (t) {
      return String(t.order_id) === String(orderId);
    });
    if (existing) {
      routeSelectedTask();
    } else {
      refreshTasks(false).then(routeSelectedTask);
    }
  };

  window.__driverState = state;
  window.__driverRender = render;
  window.__driverGo = go;

  loadDriver().then(function () {
    // Fast 5-second polling for incoming driver assignments (works even when tab is in background)
    setInterval(function () {
      if (!token()) return;
      var prevTaskSignature = JSON.stringify((state.tasks || []).map(function (t) {
        return t.order_id + ':' + t.delivery_status + ':' + t.assignment_status + ':' + (t.arrived_at || '');
      }));
      refreshTasks(false).then(function () {
        var nextTaskSignature = JSON.stringify((state.tasks || []).map(function (t) {
          return t.order_id + ':' + t.delivery_status + ':' + t.assignment_status + ':' + (t.arrived_at || '');
        }));
        if (state.page === 'tasks' && prevTaskSignature !== nextTaskSignature) {
          render();
        }
      });
      if (state.page === 'complete' && !state.cashSettledByKasir) {
        refreshHistory(true).then(function () {
          var doneTask = state.lastCompleted || selectedTask();
          if (doneTask && state.history) {
            var matched = state.history.find(function (h) { return String(h.order_id) === String(doneTask.order_id); });
            if (matched && isCodTaskSettled(matched)) {
              state.cashSettledByKasir = true;
              toast('✓ Setoran COD telah divalidasi oleh Kasir di POS!');
              render();
            }
          }
        });
      }
    }, 5000);
  });
})();