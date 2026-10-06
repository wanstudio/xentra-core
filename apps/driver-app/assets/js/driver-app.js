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
    initId: 0
  };


  var state = {
    page: 'tasks',
    driver: null,
    brand: null,
    tasks: [],
    history: [],
    selectedOrderId: null,
    lastCompleted: null,
    loading: true,
    error: null,
    busy: false
  };

  function rupiah(value) {
    return 'Rp' + Number(value || 0).toLocaleString('id-ID');
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
    if (!headers['Content-Type'] && options.body) headers['Content-Type'] = 'application/json';
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;

    var res;
    try {
      res = await fetch('/api/v1' + path, Object.assign({}, options, {
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
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { latitude: lat, longitude: lng };
  }

  function samePoint(a, b) {
    if (!a || !b) return false;
    return Math.abs(Number(a.latitude) - Number(b.latitude)) < 0.00025 &&
      Math.abs(Number(a.longitude) - Number(b.longitude)) < 0.00025;
  }

  function fitDriverRoute() {
    if (!mapState.map || !mapState.currentPosition) return;
    var task = selectedTask();
    var dest = destinationCoordinates(task);
    if (!dest) return;

    var bounds = new window.mapboxgl.LngLatBounds();
    bounds.extend([Number(mapState.currentPosition.longitude), Number(mapState.currentPosition.latitude)]);
    bounds.extend([dest.longitude, dest.latitude]);
    mapState.map.fitBounds(bounds, { padding: { top: 95, bottom: 110, left: 35, right: 35 }, maxZoom: 16.5, duration: 650 });
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
      paint: { 'line-color': '#1463ff', 'line-width': 6, 'line-opacity': 0.88 }
    });
  }

  async function fetchDriverRoute(position, task) {
    var dest = destinationCoordinates(task);
    if (!dest) {
      clearRouteStatus('Koordinat tujuan belum tersedia.');
      setRouteStats(null, null);
      return;
    }

    var lat = Number(position && position.latitude);
    var lng = Number(position && position.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    var requestId = ++mapState.routeRequestId;
    clearRouteStatus('Menghitung rute…');

    var url = 'https://router.project-osrm.org/route/v1/driving/' +
      encodeURIComponent(lng) + ',' + encodeURIComponent(lat) + ';' +
      encodeURIComponent(dest.longitude) + ',' + encodeURIComponent(dest.latitude) +
      '?overview=full&geometries=geojson&steps=true';

    try {
      var response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('OSRM HTTP ' + response.status);
      var data = await response.json();
      var route = data && data.code === 'Ok' && data.routes && data.routes[0];
      if (!route || !route.geometry) throw new Error('Rute tidak tersedia');

      if (requestId !== mapState.routeRequestId || state.page !== 'map') return;

      var shouldFitRoute = !mapState.lastRoutedPosition;
      drawRoute(route.geometry);
      setRouteStats(route.distance, route.duration);
      mapState.lastRouteAt = Date.now();
      mapState.lastRoutedPosition = { latitude: lat, longitude: lng };
      clearRouteStatus('');
      if (shouldFitRoute) fitDriverRoute();
    } catch (err) {
      if (requestId !== mapState.routeRequestId) return;
      clearRouteStatus('Rute gagal dihitung. Gunakan navigasi eksternal.');
      updateMapError('Rute peta tidak tersedia saat ini.');
      setRouteStats(null, null);
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
    if (!navigator.geolocation) {
      setMapStatus('GPS tidak didukung perangkat ini', 'error');
      updateMapError('Perangkat tidak menyediakan GPS browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (position) { applyDriverPosition(position, task); },
      function (error) {
        var message = error && error.code === 1
          ? 'Izin lokasi ditolak'
          : error && error.code === 3
            ? 'GPS terlalu lama merespons'
            : 'Lokasi GPS belum tersedia';
        setMapStatus(message, 'error');
        updateMapError('Aktifkan izin lokasi agar rute dari posisi Anda dapat dihitung.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );

    mapState.watchId = navigator.geolocation.watchPosition(
      function (position) { applyDriverPosition(position, task); },
      function (error) {
        if (mapState.currentPosition) {
          setMapStatus('GPS berhenti memperbarui', 'warning');
          return;
        }
        var message = error && error.code === 1
          ? 'Izin lokasi ditolak'
          : 'Lokasi GPS tidak tersedia';
        setMapStatus(message, 'error');
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
    mapState.map = null;
    mapState.driverMarker = null;
    mapState.destinationMarker = null;
    mapState.currentPosition = null;
    mapState.lastRouteAt = 0;
    mapState.lastRoutedPosition = null;
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

      window.mapboxgl.accessToken = MAPBOX_TOKEN;
      mapState.map = new window.mapboxgl.Map({
        container: container,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [dest.longitude, dest.latitude],
        zoom: 14,
        attributionControl: true
      });

      mapState.destinationMarker = new window.mapboxgl.Marker({ color: '#e5484d' })
        .setLngLat([dest.longitude, dest.latitude])
        .addTo(mapState.map);

      mapState.map.on('load', function () {
        if (state.page !== 'map' || initId !== mapState.initId) return;
        setMapStatus('Mencari lokasi GPS…', '');
        startDriverGeolocation(task);
        if (mapState.currentPosition) {
          fitDriverRoute();
          maybeRefreshDriverRoute(mapState.currentPosition, task, true);
        }
      });

      mapState.map.on('error', function () {
        updateMapError('Peta gagal dimuat. Gunakan navigasi eksternal.');
      });
    } catch (err) {
      setMapStatus('Peta tidak dapat dimuat', 'error');
      updateMapError('Peta Xentra gagal dimuat. Anda masih dapat membuka navigasi eksternal.');
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
      info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
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

  function shell(title, body, active, options) {
    options = options || {};

    var header = options.back
      ? '<header class="driver-header"><div class="back-row" style="margin:0"><button class="back-btn" data-action="back">' + icon('back') + '</button><div class="back-title">' + escapeHTML(title) + '</div></div></header>'
      : '<header class="driver-header"><div class="brand"><span class="brand-mark">X</span><span>Xentra Driver</span></div><div class="header-meta"><span class="header-branch">' + escapeHTML(state.driver && state.driver.branch_name || '') + '</span><button class="icon-btn" aria-label="Notifikasi">' + icon('bell') + '</button></div></header>';

    var nav = options.hideNav ? '' :
      '<nav class="bottom-nav">' +
        navItem('tasks', 'Tugas', 'bag', active) +
        navItem('history', 'Riwayat', 'history', active) +
        navItem('profile', 'Profil', 'user', active) +
      '</nav>';

    app.innerHTML = '<div class="driver-shell">' + header + '<main class="content">' + body + '</main>' + nav + '</div><div id="toast" class="toast"></div>';
    bind();

    if (state.busy) {
      app.querySelectorAll('.primary-btn, .danger-btn, .secondary-btn').forEach(function (button) {
        button.disabled = true;
      });
    }
  }

  function navItem(page, label, ico, active) {
    return '<button class="nav-item ' + (active === page ? 'active' : '') + '" data-page="' + page + '"><span class="nav-icon">' + icon(ico) + '</span><span>' + label + '</span></button>';
  }

  function loadingBody(message) {
    return '<div class="loading"><div style="display:grid;justify-items:center;gap:10px"><div class="spinner"></div><div>' + escapeHTML(message || 'Memuat…') + '</div></div></div>';
  }

  function errorBody(message) {
    return '<div class="card"><div class="info-box warning"><span>!</span><div>' + escapeHTML(message) + '</div></div><button class="primary-btn" data-action="reload" style="margin-top:12px">Coba Lagi</button></div>';
  }

  function taskCard(task) {
    var customer = task.customer || {};
    var destination = task.destination || {};
    var payment = task.payment || {};
    var newTask = isNewTask(task);

    return '<article class="card task-card">' +
      '<div class="task-top"><span class="task-id">' + escapeHTML(task.order_number || task.order_id) + '</span><span class="pill ' + (newTask ? 'orange' : 'blue') + '">' + escapeHTML(formatDeliveryStatus(task)) + '</span></div>' +
      '<div class="customer-row"><span class="pin">' + icon('pin') + '</span><div style="min-width:0"><div class="customer-name">' + escapeHTML(customer.name || 'Pelanggan') + '</div><div class="address">' + escapeHTML(destination.address || 'Alamat tujuan belum tersedia') + '</div></div></div>' +
      '<div class="meta-row"><span class="meta-item">' + icon('bag') + ' ' + Number(task.item_count || 0) + ' item</span>' +
      (payment.is_cod ? '<span class="meta-item">🟧 COD ' + rupiah(payment.amount) + '</span>' : '<span class="meta-item">✓ Online</span>') +
      '</div>' +
      '<button class="primary-btn" data-order="' + escapeHTML(task.order_id) + '" data-page="' + (newTask ? 'new-task' : 'delivery-detail') + '" style="margin-top:14px">' +
      (newTask ? 'Lihat Tugas' : 'Lihat Pengantaran') + ' ' + icon('arrow') + '</button>' +
    '</article>';
  }

  function renderTasks() {
    if (state.loading) return shell('Tugas', loadingBody('Memuat tugas…'), 'tasks');
    if (state.error) return shell('Tugas', errorBody(state.error), 'tasks');

    var newTasks = state.tasks.filter(isNewTask);
    var activeTasks = state.tasks.filter(isActiveTask);
    var acceptedAssigned = state.tasks.filter(isAcceptedAssigned);

    var body = '<h1 class="screen-title">Tugas</h1><div class="screen-subtitle">Pengantaran yang ditugaskan kepada Anda.</div>' +
      '<div class="status-card"><div class="status-dot">✓</div><div><div class="status-title">Tersedia</div><div class="status-copy">Status availability akan dihubungkan pada tahap berikutnya.</div></div></div>';

    if (activeTasks.length) {
      body += '<div class="section-head"><div class="section-title">Tugas Aktif</div><span class="badge-count">' + activeTasks.length + '</span></div>';
      activeTasks.forEach(function (task) { body += taskCard(task); });
    }

    if (acceptedAssigned.length) {
      body += '<div class="section-head"><div class="section-title">Siap Diambil</div><span class="badge-count">' + acceptedAssigned.length + '</span></div>';
      acceptedAssigned.forEach(function (task) { body += taskCard(task); });
    }

    if (newTasks.length) {
      body += '<div class="section-head"><div class="section-title">Tugas Baru</div><span class="badge-count">' + newTasks.length + '</span></div>';
      newTasks.forEach(function (task) { body += taskCard(task); });
    }

    if (!state.tasks.length) {
      body += '<div class="empty"><div class="empty-art">' + icon('box') + '</div><h3>Tidak ada tugas saat ini</h3><p>Anda akan melihat tugas baru ketika Branch Manager menugaskan pengantaran kepada Anda.</p><button class="secondary-btn" data-action="reload">Muat Ulang</button></div>';
    }

    shell('Tugas', body, 'tasks');
  }

  function renderNewTask() {
    var task = selectedTask();
    if (!task) return shell('Tugas Baru', errorBody('Tugas tidak ditemukan atau sudah berubah.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var d = task.destination || {};
    var p = task.payment || {};

    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Tugas Baru</div></div>' +
      '<div class="card">' +
        '<div class="task-top"><span class="task-id">Pengantaran ' + escapeHTML(task.order_number || task.order_id) + '</span><span class="pill orange">Menunggu Anda</span></div>' +
        '<div class="customer-row"><span class="pin">' + icon('pin') + '</span><div><div class="customer-name">' + escapeHTML(c.name || 'Pelanggan') + '</div><div class="address">' + escapeHTML(d.address || 'Alamat tujuan belum tersedia') + '</div></div></div>' +
        '<div class="meta-row"><span class="meta-item">⌖ ' + escapeHTML(task.distance_meters ? (Number(task.distance_meters) / 1000).toFixed(1) + ' km' : 'Jarak akan dihitung') + '</span><span class="meta-item">◷ ' + escapeHTML(task.duration_seconds ? Math.round(Number(task.duration_seconds) / 60) + ' menit' : 'ETA akan dihitung') + '</span></div>' +
        (p.is_cod ? '<div class="money-card"><div class="money-label">COD / Bayar di Tempat</div><div class="money">' + rupiah(p.amount) + '</div></div>' : '<div class="money-card"><div class="money-label">Pembayaran</div><div class="money">Sudah dibayar</div></div>') +
        '<div class="info-box"><span>i</span><div>Terima tugas jika Anda siap mengambil pesanan dari cabang dan mengantarkannya ke pelanggan.</div></div>' +
      '</div>' +
      '<div class="sticky-action"><div class="btn-row"><button class="danger-btn" data-action="reject">× Tolak</button><button class="primary-btn" data-action="accept">✓ Terima Tugas</button></div></div>';

    shell('Tugas Baru', body, 'tasks', {hideNav:true});
  }

  function renderDetail() {
    var task = selectedTask();
    if (!task) return shell('Pengantaran', errorBody('Tugas tidak ditemukan atau sudah tidak menjadi tugas Anda.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var d = task.destination || {};
    var p = task.payment || {};
    var action = '';
    var actionLabel = '';

    if (isAcceptedAssigned(task)) {
      action = 'pickup';
      actionLabel = 'Ambil Pesanan';
    } else if (task.delivery_status === 'picked_up') {
      action = 'start-delivery';
      actionLabel = 'Mulai Antar';
    } else if (task.delivery_status === 'on_delivery') {
      action = 'delivery-map';
      actionLabel = 'Lihat Pengantaran';
    }

    var statusBox = isAcceptedAssigned(task)
      ? '<div class="info-box"><span>→</span><div><strong>Tugas Diterima</strong><br>Pesanan siap untuk diambil dari cabang.</div></div>'
      : task.delivery_status === 'picked_up'
        ? '<div class="info-box success"><span>✓</span><div><strong>Pesanan Diambil</strong><br>Siap dimulai untuk pengantaran.</div></div>'
        : '<div class="info-box success"><span>✓</span><div><strong>Sedang Diantar</strong><br>Pengantaran sedang berjalan.</div></div>';

    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Pengantaran ' + escapeHTML(task.order_number || task.order_id) + '</div></div>' +
      '<div class="card">' + statusBox + '</div>' +
      '<div class="card"><div class="section-title">Tujuan</div><div class="customer-row"><span class="pin">' + icon('pin') + '</span><div style="flex:1"><div class="customer-name">' + escapeHTML(c.name || 'Pelanggan') + '</div><div class="address">' + escapeHTML(d.address || 'Alamat tujuan belum tersedia') + '</div></div><button class="icon-btn" data-action="call" aria-label="Telepon pelanggan">☎</button></div><button class="secondary-btn" data-action="navigate" style="margin-top:13px">⌖ Buka Navigasi</button></div>' +
      '<div class="card"><div class="section-title">Pesanan</div><div class="meta-row"><span class="meta-item">▣ ' + Number(task.item_count || 0) + ' item</span></div></div>' +
      '<div class="card"><div class="section-title">Pembayaran</div><div class="money">' + (p.is_cod ? rupiah(p.amount) : 'Sudah dibayar') + '</div><div class="pill ' + (p.is_cod ? 'orange' : 'green') + '" style="margin-top:8px">' + (p.is_cod ? 'Bayar di Tempat (COD)' : 'Online') + '</div></div>';

    if (action) {
      body += '<div class="sticky-action"><button class="primary-btn" data-action="' + action + '">' + actionLabel + ' ' + icon('arrow') + '</button></div>';
    }

    shell('Detail Pengantaran', body, 'tasks', {hideNav:true});
  }

  function renderPickup() {
    var task = selectedTask();
    if (!task) return shell('Ambil Pesanan', errorBody('Tugas tidak ditemukan.'), 'tasks', {hideNav:true});

    var p = task.payment || {};
    var pickupName = task.pickup && task.pickup.branch_name || 'Cabang';
    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Ambil Pesanan</div></div>' +
      '<div class="card"><div class="customer-row" style="margin-top:0"><span class="pin" style="background:#fff0f4;color:#d64572">▣</span><div><div class="customer-name">' + escapeHTML(pickupName) + '</div><div class="address">Tunjukkan nomor pesanan kepada staf.</div></div></div></div>' +
      '<div class="card"><div class="task-top"><span class="task-id">Pesanan ' + escapeHTML(task.order_number || task.order_id) + '</span><span class="pill blue">' + Number(task.item_count || 0) + ' item</span></div>' +
      (p.is_cod ? '<div class="money-card"><div class="money-label">COD</div><div class="money">' + rupiah(p.amount) + '</div></div>' : '') +
      '<div class="info-box"><span>i</span><div>Pastikan jumlah dan kondisi pesanan sesuai sebelum Anda mengonfirmasi pengambilan.</div></div>' +
      '<div class="check-list"><div class="check"><span class="check-icon">✓</span>Jumlah item sesuai</div><div class="check"><span class="check-icon">✓</span>Kemasan dalam kondisi baik</div></div></div>' +
      '<div class="sticky-action"><button class="primary-btn" data-action="confirm-pickup">Konfirmasi Pesanan Diambil ' + icon('arrow') + '</button></div>';

    shell('Ambil Pesanan', body, 'tasks', {hideNav:true});
  }

  function renderMap() {
    var task = selectedTask();
    if (!task) return shell('Sedang Mengantar', errorBody('Tugas pengantaran tidak ditemukan.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var d = task.destination || {};
    var body =
      '<div class="hero-map">' +
        '<div id="driver-map" class="driver-map" aria-label="Peta pengantaran"></div>' +
        '<div class="nav-banner">' +
          '<div class="nav-turn">Tujuan Pengantaran</div>' +
          '<div class="nav-road">' + escapeHTML(d.address || 'Alamat tujuan') + '</div>' +
          '<div id="driver-gps-status" class="map-status">Mencari lokasi GPS…</div>' +
        '</div>' +
        '<div id="driver-map-error" class="map-error" hidden></div>' +
        '<div class="map-controls">' +
          '<button class="map-control" data-action="recenter-map" aria-label="Pusatkan peta">➤</button>' +
          '<button class="map-control" data-action="refresh-map" aria-label="Segarkan rute">↻</button>' +
        '</div>' +
      '</div>' +
      '<div class="map-sheet">' +
        '<div class="route-stats">' +
          '<div class="route-stat"><strong id="driver-route-eta">—</strong><span>ETA</span></div>' +
          '<div class="route-stat"><strong id="driver-route-distance">—</strong><span>jarak</span></div>' +
        '</div>' +
        '<div id="driver-route-status" class="route-status"></div>' +
        '<div class="customer-row" style="margin-top:0">' +
          '<span class="pin" style="background:#fff0f0;color:var(--red)">●</span>' +
          '<div style="flex:1"><div class="customer-name">' + escapeHTML(c.name || 'Pelanggan') + '</div>' +
          '<div class="address">' + escapeHTML(d.address || 'Alamat tujuan belum tersedia') + '</div></div>' +
          '<button class="icon-btn" data-action="call" aria-label="Telepon pelanggan">☎</button>' +
        '</div>' +
        '<button class="secondary-btn" data-action="navigate" style="margin-top:13px">⌖ Buka Navigasi</button>' +
        '<div class="sticky-action"><button class="primary-btn green" data-action="complete-delivery">Selesaikan Pengantaran ' + icon('arrow') + '</button></div>' +
      '</div>';

    shell('Sedang Mengantar', body, 'tasks', {hideNav:true});
    initializeDriverMap(task);
  }

  function renderCod() {
    var task = selectedTask();
    if (!task) return shell('Konfirmasi COD', errorBody('Tugas pengantaran tidak ditemukan.'), 'tasks', {hideNav:true});

    var p = task.payment || {};
    var body = '<div class="back-row"><button class="back-btn" data-action="back">‹</button><div class="back-title">Konfirmasi COD</div></div>' +
      '<div class="card"><div class="money-card"><div class="money-label">Yang harus dibayar (COD)</div><div class="money">' + rupiah(p.amount) + '</div></div>' +
      '<label class="input-label" for="tendered">Uang diterima dari pelanggan</label><input id="tendered" class="money-input" inputmode="numeric" autocomplete="off" placeholder="Masukkan nominal">' +
      '<div class="change-box"><div class="change-label">Kembalian untuk pelanggan</div><div id="change" class="change-value">Rp0</div></div>' +
      '<div class="info-box warning" style="margin-top:12px"><span>!</span><div>Uang tunai ini akan tetap berada pada Anda sampai diserahkan kepada Kasir.</div></div></div>' +
      '<div class="sticky-action"><button class="primary-btn" data-action="complete-cod">Konfirmasi Uang Diterima</button></div>';

    shell('Konfirmasi COD', body, 'tasks', {hideNav:true});
  }

  function renderComplete() {
    var task = state.lastCompleted || selectedTask();
    if (!task) return shell('Pengantaran Selesai', errorBody('Ringkasan pengantaran tidak tersedia.'), 'tasks', {hideNav:true});

    var c = task.customer || {};
    var p = task.payment || {};
    var amount = p.collected_amount != null ? p.collected_amount : p.amount;
    var cashState = p.is_cod
      ? '<div class="cash-custody"><div class="label">UANG COD DI TANGAN ANDA</div><div class="value">' + rupiah(amount) + '</div><div style="font-size:12px;color:#8b520b;margin-top:5px">Serahkan uang ini kepada Kasir untuk penyelesaian pembayaran.</div></div>'
      : '<div class="info-box success"><span>✓</span><div>Pembayaran online sudah tercatat. Tidak ada kas COD yang perlu diserahkan.</div></div>';

    var body = '<div class="card complete"><div class="summary-icon">✓</div><h2>Pengantaran Selesai</h2><p>Pelanggan telah menerima pesanan.</p></div>' +
      '<div class="card"><div class="customer-row" style="margin-top:0"><span class="pin">▣</span><div><div class="customer-name">Pesanan ' + escapeHTML(task.order_number || task.order_id) + '</div><div class="address">' + escapeHTML(c.name || 'Pelanggan') + '</div></div></div><div class="meta-row"><span class="meta-item">▣ ' + Number(task.item_count || 0) + ' item</span>' +
      (p.is_cod ? '<span class="meta-item">🟧 COD ' + rupiah(p.amount) + '</span><span class="pill green">✓ Uang diterima</span>' : '<span class="pill green">✓ Online</span>') +
      '</div></div>' + cashState +
      '<div class="sticky-action"><button class="primary-btn" data-action="back-tasks">Kembali ke Tugas</button></div>';

    shell('Pengantaran Selesai', body, 'tasks', {hideNav:true});
  }

  function renderHistory() {
    if (state.loading) return shell('Riwayat', loadingBody('Memuat riwayat…'), 'history');
    if (state.error) return shell('Riwayat', errorBody(state.error), 'history');

    var body = '<h1 class="screen-title">Riwayat Pengantaran</h1><div class="screen-subtitle">Pengantaran yang sudah selesai.</div>';

    if (!state.history.length) {
      body += '<div class="empty"><div class="empty-art">' + icon('history') + '</div><h3>Belum ada riwayat</h3><p>Riwayat akan muncul setelah Anda menyelesaikan pengantaran.</p></div>';
    } else {
      body += '<div class="history-group"><div class="history-date">Terbaru</div>';
      state.history.forEach(function (task) {
        var c = task.customer || {};
        var p = task.payment || {};
        body += historyRow(task.order_number || task.order_id, c.name || 'Pelanggan', p.is_cod ? 'COD ' + rupiah(p.amount) : 'Online');
      });
      body += '</div>';
    }

    shell('Riwayat', body, 'history');
  }

  function historyRow(id, name, payment) {
    return '<div class="history-row"><span class="history-pin">●</span><div class="history-main"><div class="history-id">' + escapeHTML(id) + '</div><div class="history-name">' + escapeHTML(name) + '</div><div class="history-time">Terkirim</div></div><div class="history-right"><span class="pill green">Terkirim</span><div class="amount">' + escapeHTML(payment) + '</div></div></div>';
  }

  function renderProfile() {
    if (!state.driver) return shell('Profil', loadingBody('Memuat profil…'), 'profile');

    var driverName = state.driver.full_name || state.driver.username || 'Driver';
    var branchName = state.driver.branch_name || 'Cabang Xentra';
    var phone = state.driver.phone || 'Nomor telepon belum diatur';
    var totalDelivered = state.history ? state.history.length : 0;

    var avatarContent = state.driver.avatar_url
      ? '<img src="' + escapeHTML(state.driver.avatar_url) + '" alt="' + escapeHTML(driverName) + '" class="profile-avatar-img">'
      : icon('user');

    var body =
      '<div class="profile-header-card">' +
        '<div class="profile-avatar-wrap">' +
          '<div class="profile-avatar" id="btn-trigger-avatar" title="Klik untuk ganti foto profil">' +
            avatarContent +
            '<button type="button" class="profile-avatar-edit-badge" aria-label="Ganti Foto Profil">' + icon('camera') + '</button>' +
          '</div>' +
          '<span class="profile-status-indicator" title="Driver Aktif"></span>' +
          '<input type="file" id="driver-avatar-input" accept="image/*" style="display:none">' +
        '</div>' +
        '<div class="profile-main-info">' +
          '<h2 class="profile-name">' + escapeHTML(driverName) + '</h2>' +
          '<div class="profile-badge-row">' +
            '<span class="pill blue">Mitra Driver</span>' +
            '<span class="pill green">Aktif</span>' +
          '</div>' +
          '<div class="profile-branch-text">' +
            icon('pin') + ' <span>' + escapeHTML(branchName) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-kpi-grid">' +
        '<div class="profile-kpi-card">' +
          '<div class="profile-kpi-val">' + totalDelivered + '</div>' +
          '<div class="profile-kpi-label">Pesanan Selesai</div>' +
        '</div>' +
        '<div class="profile-kpi-card">' +
          '<div class="profile-kpi-val">100%</div>' +
          '<div class="profile-kpi-label">Keberhasilan</div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-group-title">Operasional & Pengiriman</div>' +
      '<div class="profile-list-card">' +
        profileItem(icon('check'), 'Status Kerja', 'Siap Menerima Pesanan', 'availability') +
        profileItem(icon('motor'), 'Kendaraan', 'Sepeda Motor (Reguler)') +
        profileItem(icon('camera'), 'Ganti Foto Profil', 'Perbarui foto diri', 'change-avatar') +
        profileItem(icon('map'), 'Navigasi Pilihan', 'Google Maps / Waze', 'navigate') +
      '</div>' +

      '<div class="profile-group-title">Akun & Bantuan</div>' +
      '<div class="profile-list-card">' +
        profileItem(icon('phone'), 'Kontak Telepon', escapeHTML(phone)) +
        profileItem(icon('info'), 'Versi Sistem', 'Xentra Driver v1.2') +
        profileItem(icon('logout'), 'Keluar dari Akun', '', 'logout', true) +
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

  function showRejectSheet() {
    var existing = document.getElementById('driver-reject-sheet');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'driver-reject-sheet';
    overlay.className = 'sheet-backdrop';
    overlay.innerHTML =
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="reject-title">' +
        '<div class="sheet-handle"></div>' +
        '<h3 id="reject-title">Tolak Tugas</h3>' +
        '<p>Alasan penolakan wajib dicatat agar Branch Manager dapat menindaklanjuti penugasan.</p>' +
        '<textarea id="driver-reject-reason" maxlength="500" placeholder="Masukkan alasan penolakan"></textarea>' +
        '<div class="sheet-actions"><button class="danger-btn" data-sheet-action="cancel">Batal</button><button class="primary-btn" data-sheet-action="submit">Tolak Tugas</button></div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', async function (event) {
      if (event.target === overlay) return;
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

  async function acceptTask() {
    var task = selectedTask();
    if (!task || state.busy) return;
    state.busy = true;
    renderNewTask();

    try {
      var data = await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/accept', { method: 'POST' });
      state.busy = false;
      state.selectedOrderId = task.order_id;
      await refreshTasks(false);
      if (data && data.task) state.tasks.push(data.task);
      state.page = 'delivery-detail';
      toast('Tugas diterima');
      render();
    } catch (err) {
      state.busy = false;
      render();
      toast(err.message || 'Tugas gagal diterima');
    }
  }

  async function rejectTask(reason) {
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
    render();

    try {
      var data = await api('/driver/tasks/' + encodeURIComponent(task.order_id) + '/' + endpoint, {
        method: 'POST',
        body: payload ? JSON.stringify(payload) : undefined
      });

      state.busy = false;
      if (data && data.task) {
        if (nextPage === 'complete') state.lastCompleted = data.task;
      }

      if (nextPage === 'complete') {
        state.page = 'complete';
        state.lastCompleted = (data && data.task) || task;
      } else {
        await refreshTasks(false);
        state.selectedOrderId = task.order_id;
        state.page = nextPage;
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
      state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      state.loading = false;
      state.error = null;
      return data;
    } catch (err) {
      if (err.status === 401) return null;
      state.loading = false;
      state.error = err.message || 'Tugas tidak dapat dimuat.';
      return null;
    }
  }

  async function refreshHistory() {
    state.loading = true;
    state.error = null;
    renderHistory();

    try {
      var data = await api('/driver/history');
      state.history = Array.isArray(data.deliveries) ? data.deliveries : [];
      state.loading = false;
      return data;
    } catch (err) {
      if (err.status === 401) return null;
      state.loading = false;
      state.error = err.message || 'Riwayat tidak dapat dimuat.';
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
    } catch (err) {
      if (err.status === 401) return;
      state.loading = false;
      state.error = err.message || 'Profil Driver tidak dapat dimuat.';
      renderTasks();
      return;
    }

    await refreshTasks(false);
    state.loading = false;
    render();
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
    if (state.page === 'cod') return renderCod();
    if (state.page === 'complete') return renderComplete();
    if (state.page === 'history') return renderHistory();
    if (state.page === 'profile') return renderProfile();
    return renderTasks();
  }

  function bind() {
    app.querySelectorAll('[data-page]').forEach(function (el) {
      el.addEventListener('click', function () {
        var page = el.getAttribute('data-page');
        var orderId = el.getAttribute('data-order');
        if (orderId) state.selectedOrderId = orderId;
        go(page);
      });
    });

    app.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', function () {
        handleAction(el.getAttribute('data-action'));
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

    var avatarInput = document.getElementById('driver-avatar-input');
    if (avatarInput) {
      avatarInput.addEventListener('change', async function () {
        var file = avatarInput.files && avatarInput.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          return toast('File harus berupa gambar (JPG, PNG, WebP).');
        }
        if (file.size > 5 * 1024 * 1024) {
          return toast('Ukuran foto maksimal 5 MB.');
        }

        toast('Mengunggah foto profil…');
        var reader = new FileReader();
        reader.onload = async function (e) {
          try {
            var base64 = e.target.result;
            var res = await api('/driver/avatar', {
              method: 'POST',
              body: JSON.stringify({
                image_base64: base64,
                mime_type: file.type,
                original_filename: file.name
              })
            });
            if (res.success && res.avatar_url) {
              if (state.driver) {
                state.driver.avatar_url = res.avatar_url;
                persistUser();
              }
              toast('Foto profil berhasil diperbarui.');
              render();
            } else {
              toast('Gagal memperbarui foto profil.');
            }
          } catch (err) {
            toast(err.message || 'Gagal mengunggah foto profil.');
          }
        };
        reader.readAsDataURL(file);
      });
    }

    var avatarTrigger = document.getElementById('btn-trigger-avatar');
    if (avatarTrigger) {
      avatarTrigger.addEventListener('click', function () {
        if (avatarInput) avatarInput.click();
      });
    }
  }

  async function handleAction(action) {
    if (action === 'change-avatar') {
      var input = document.getElementById('driver-avatar-input');
      if (input) input.click();
      return;
    }

    if (action === 'back' || action === 'back-tasks') {
      state.lastCompleted = null;
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

    if (action === 'pickup') {
      state.page = 'pickup';
      return render();
    }

    if (action === 'confirm-pickup') {
      return transitionTask('pickup', null, 'delivery-detail');
    }

    if (action === 'start-delivery') {
      return transitionTask('start', null, 'map');
    }

    if (action === 'delivery-map') {
      state.page = 'map';
      return render();
    }

    if (action === 'complete-delivery') {
      var task = selectedTask();
      if (!task) return toast('Tugas pengantaran tidak ditemukan');
      if (task.payment && task.payment.is_cod) {
        state.page = 'cod';
        return render();
      }
      return transitionTask('complete', null, 'complete');
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

    if (action === 'recenter-map') {
      if (!mapState.map || !mapState.currentPosition) {
        toast('Lokasi GPS belum tersedia');
        return;
      }
      fitDriverRoute();
      return;
    }

    if (action === 'refresh-map') {
      var routeTask = selectedTask();
      if (!routeTask || !mapState.currentPosition) {
        toast('Lokasi GPS belum tersedia');
        return;
      }
      fetchDriverRoute(mapState.currentPosition, routeTask);
      return;
    }

    if (action === 'navigate') {
      var navTask = selectedTask();
      var destination = navTask && navTask.destination;
      if (!destination || destination.latitude == null || destination.longitude == null) {
        return toast('Koordinat tujuan belum tersedia');
      }
      window.location.href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destination.latitude + ',' + destination.longitude);
      return;
    }

    if (action === 'availability') return toast('Availability Driver akan dihubungkan setelah API availability diterapkan.');
    if (action === 'next-stage-info') return toast('Tahap berikutnya mengikuti state Delivery dari server.');

    if (action === 'logout') {
      try { await api('/auth/logout', { method: 'POST' }); } catch (_) {}
      clearSession();
      window.location.href = '/login?target=driver';
    }
  }

  window.addEventListener('popstate', function () {
    state.page = 'tasks';
    refreshTasks(false).then(render);
  });

  loadDriver();
})();