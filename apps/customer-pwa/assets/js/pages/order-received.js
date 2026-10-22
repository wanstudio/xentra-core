/**
 * Xentra Customer PWA — Order Received & Branch Acceptance Waiting Screen
 * P7.1–P7.7: Branch Acceptance lifecycle display.
 *
 * Authority rule: ALL order state comes from server (GET /orders/:id).
 * The client DISPLAYS, POLLS, and NAVIGATES. It NEVER mutates order state.
 * The 3-minute countdown is a UX timer anchored to the server-supplied
 * acceptance_deadline_at — reaching zero triggers a server fetch, not a
 * state mutation.
 *
 * P7.4 Refresh/re-entry: mount() always fetches from server; no local
 * variable or timer instance is the source of truth.
 */
(function () {
  'use strict';

  var API = window.Xentra.API;
  var Store = window.Xentra.Store;
  var UI = window.Xentra.UI;
  var Router = window.Xentra.Router;

  var currentOrderId = null;
  var targetContainer = null;
  var pollingTimer = null;
  var countdownTimer = null;
  var lastDeliveryStatus = null;
  var lastDriverName = null;

  var MAPBOX_VERSION = '3.4.0';
  var MAPBOX_TOKEN = (window.XentraConfig && window.XentraConfig.mapboxToken) ||
    'pk.eyJ1IjoiaWtod2FucyIsImEiOiJjbXQ5c2cwMzYwOW15MnpxdXdpeWU3am45In0.YcX49DH0uXP70aBxVDC-TA';

  var trackingMapState = {
    map: null,
    driverMarker: null,
    destMarker: null,
    branchMarker: null,
    lastRouteKey: '',
    lastDriverCoords: null,
    lastDriverHeading: 0,
    fallbackMode: false,
    fallbackDelivery: null,
    initSeq: 0
  };

  function calculateBearing(lat1, lng1, lat2, lng2) {
    if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return null;
    var dLat = Math.abs(lat2 - lat1);
    var dLng = Math.abs(lng2 - lng1);
    if (dLat < 0.00002 && dLng < 0.00002) return null;
    var phi1 = lat1 * Math.PI / 180;
    var phi2 = lat2 * Math.PI / 180;
    var deltaLambda = (lng2 - lng1) * Math.PI / 180;
    var y = Math.sin(deltaLambda) * Math.cos(phi2);
    var x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    var theta = Math.atan2(y, x);
    return (theta * 180 / Math.PI + 360) % 360;
  }

  function resolveDriverHeading(delivery, drvLat, drvLng) {
    var dLoc = delivery && delivery.driver_location;
    var rawHeading = dLoc && dLoc.heading != null ? Number(dLoc.heading) : NaN;
    if (Number.isFinite(rawHeading) && rawHeading >= 0 && rawHeading <= 360) {
      trackingMapState.lastDriverHeading = rawHeading;
      return rawHeading;
    }
    if (trackingMapState.lastDriverCoords) {
      var movedBearing = calculateBearing(
        trackingMapState.lastDriverCoords.lat,
        trackingMapState.lastDriverCoords.lng,
        drvLat,
        drvLng
      );
      if (movedBearing !== null) {
        trackingMapState.lastDriverHeading = movedBearing;
        return movedBearing;
      }
    }
    var destLat = delivery && delivery.destination_latitude != null ? Number(delivery.destination_latitude) : NaN;
    var destLng = delivery && delivery.destination_longitude != null ? Number(delivery.destination_longitude) : NaN;
    var toDest = calculateBearing(drvLat, drvLng, destLat, destLng);
    if (toDest !== null) {
      trackingMapState.lastDriverHeading = toDest;
      return toDest;
    }
    return trackingMapState.lastDriverHeading || 0;
  }

  // Multi-angle 2.5D isometric scooter + green-jacket rider SVG (back, right, left, front)
  // Automatically switches perspective based on road bearing / heading like Gojek/Grab
  function getDirectionalScooterSvg(headingDeg) {
    var h = ((Number(headingDeg) || 0) % 360 + 360) % 360;
    // Normalize into 4 isometric camera views relative to screen-up (North = 0°):
    // 1. GOING UP / STRAIGHT AWAY (315°..360° or 0°..45°): Seen from behind (back of rider & rear wheel)
    // 2. TURNING RIGHT / HEADING EAST (45°..135°): Seen from right side profile (facing right)
    // 3. GOING DOWN / TOWARD CAMERA (135°..225°): Seen from front-angle (headlight & front shield)
    // 4. TURNING LEFT / HEADING WEST (225°..315°): Seen from left side profile (facing left, mirrored right)
    if (h >= 45 && h < 135) {
      var tiltRight = Math.max(-18, Math.min(18, h - 90));
      return (
        '<svg width="44" height="44" viewBox="0 0 48 48" style="transform:rotate(' + tiltRight.toFixed(1) + 'deg);transition:transform 0.35s ease;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.28));">' +
        '  <ellipse cx="24" cy="40" rx="16" ry="4" fill="rgba(0,0,0,0.22)"/>' +
        '  <!-- Rear & Front Wheels (Right Side Profile) -->' +
        '  <circle cx="13" cy="34" r="6" fill="#1e293b" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <circle cx="13" cy="34" r="2.5" fill="#94a3b8"/>' +
        '  <circle cx="35" cy="34" r="6" fill="#1e293b" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <circle cx="35" cy="34" r="2.5" fill="#94a3b8"/>' +
        '  <!-- Delivery Box at Rear -->' +
        '  <rect x="6" y="18" width="9" height="9" rx="2" fill="#059669" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <!-- Scooter Body (White/Emerald) -->' +
        '  <path d="M10 28 L23 28 L28 33 L35 31 L31 20 L27 20 L25 26 L12 25 Z" fill="#ffffff" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/>' +
        '  <!-- Headlight & Handlebar -->' +
        '  <circle cx="33" cy="20" r="2.2" fill="#fde047" stroke="#0f172a" stroke-width="1.2"/>' +
        '  <!-- Rider Legs & Green Jacket (Right Profile) -->' +
        '  <path d="M18 25 L24 26 L25 32 L21 32 Z" fill="#1e293b"/>' +
        '  <path d="M16 15 C16 13 22 13 23 16 L26 22 L21 25 L16 24 Z" fill="#10b981" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round"/>' +
        '  <!-- Green Helmet facing Right -->' +
        '  <circle cx="21" cy="10" r="5.2" fill="#10b981" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <path d="M23 8.5 L26.5 10.5 L23 12.5 Z" fill="#1e293b"/>' +
        '</svg>'
      );
    }
    if (h >= 225 && h < 315) {
      var tiltLeft = Math.max(-18, Math.min(18, h - 270));
      return (
        '<svg width="44" height="44" viewBox="0 0 48 48" style="transform:rotate(' + tiltLeft.toFixed(1) + 'deg) scaleX(-1);transition:transform 0.35s ease;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.28));">' +
        '  <ellipse cx="24" cy="40" rx="16" ry="4" fill="rgba(0,0,0,0.22)"/>' +
        '  <circle cx="13" cy="34" r="6" fill="#1e293b" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <circle cx="13" cy="34" r="2.5" fill="#94a3b8"/>' +
        '  <circle cx="35" cy="34" r="6" fill="#1e293b" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <circle cx="35" cy="34" r="2.5" fill="#94a3b8"/>' +
        '  <rect x="6" y="18" width="9" height="9" rx="2" fill="#059669" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <path d="M10 28 L23 28 L28 33 L35 31 L31 20 L27 20 L25 26 L12 25 Z" fill="#ffffff" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/>' +
        '  <circle cx="33" cy="20" r="2.2" fill="#fde047" stroke="#0f172a" stroke-width="1.2"/>' +
        '  <path d="M18 25 L24 26 L25 32 L21 32 Z" fill="#1e293b"/>' +
        '  <path d="M16 15 C16 13 22 13 23 16 L26 22 L21 25 L16 24 Z" fill="#10b981" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round"/>' +
        '  <circle cx="21" cy="10" r="5.2" fill="#10b981" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <path d="M23 8.5 L26.5 10.5 L23 12.5 Z" fill="#1e293b"/>' +
        '</svg>'
      );
    }
    if (h >= 135 && h < 225) {
      var tiltDown = Math.max(-20, Math.min(20, 180 - h));
      // Front-facing isometric view (heading South/down)
      return (
        '<svg width="44" height="44" viewBox="0 0 48 48" style="transform:rotate(' + tiltDown.toFixed(1) + 'deg);transition:transform 0.35s ease;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.28));">' +
        '  <ellipse cx="24" cy="41" rx="11" ry="3.5" fill="rgba(0,0,0,0.22)"/>' +
        '  <!-- Handlebar Mirrors -->' +
        '  <line x1="13" y1="18" x2="35" y2="18" stroke="#1e293b" stroke-width="2.5" stroke-linecap="round"/>' +
        '  <!-- Rider Shoulders (Green Jacket) -->' +
        '  <path d="M15 16 C15 11 33 11 33 16 L31 24 L17 24 Z" fill="#10b981" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <!-- Rider Helmet (Front Visor) -->' +
        '  <circle cx="24" cy="10" r="5.8" fill="#10b981" stroke="#ffffff" stroke-width="1.5"/>' +
        '  <rect x="19.5" y="8" width="9" height="4" rx="2" fill="#1e293b"/>' +
        '  <!-- Front Scooter Shield & Headlight -->' +
        '  <path d="M17 19 L31 19 L29 34 L19 34 Z" fill="#ffffff" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/>' +
        '  <circle cx="24" cy="22" r="3" fill="#fde047" stroke="#0f172a" stroke-width="1.2"/>' +
        '  <!-- Front Tire -->' +
        '  <rect x="21" y="31" width="6" height="10" rx="3" fill="#1e293b" stroke="#ffffff" stroke-width="1.2"/>' +
        '</svg>'
      );
    }
    // Default: Straight / Going Up (seen from behind: back of green jacket, helmet, taillight & rear tire)
    var signedUp = h > 180 ? h - 360 : h;
    var tiltUp = Math.max(-22, Math.min(22, signedUp));
    return (
      '<svg width="44" height="44" viewBox="0 0 48 48" style="transform:rotate(' + tiltUp.toFixed(1) + 'deg);transition:transform 0.35s ease;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.28));">' +
      '  <ellipse cx="24" cy="41" rx="11" ry="3.5" fill="rgba(0,0,0,0.22)"/>' +
      '  <!-- Handlebar ends -->' +
      '  <line x1="13" y1="17" x2="35" y2="17" stroke="#1e293b" stroke-width="2.5" stroke-linecap="round"/>' +
      '  <!-- Rider Back (Gojek-style Green Jacket with White Stripe) -->' +
      '  <path d="M15 16 C15 11 33 11 33 16 L32 27 L16 27 Z" fill="#10b981" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>' +
      '  <rect x="19" y="19" width="10" height="2.2" rx="1" fill="#ffffff"/>' +
      '  <!-- Helmet from behind -->' +
      '  <circle cx="24" cy="10" r="5.8" fill="#10b981" stroke="#ffffff" stroke-width="1.5"/>' +
      '  <!-- Scooter Rear Body & Red Taillight -->' +
      '  <path d="M17 26 L31 26 L29 34 L19 34 Z" fill="#ffffff" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/>' +
      '  <rect x="20.5" y="28" width="7" height="3" rx="1.5" fill="#ef4444"/>' +
      '  <!-- Rear Tire -->' +
      '  <rect x="21" y="32" width="6" height="9" rx="3" fill="#1e293b" stroke="#ffffff" stroke-width="1.2"/>' +
      '</svg>'
    );
  }

  function loadMapboxGL() {
    return new Promise(function (resolve, reject) {
      if (window.mapboxgl && typeof window.mapboxgl.Map === 'function') {
        resolve();
        return;
      }
      var css = document.getElementById('xentra-mapbox-css');
      if (!css) {
        css = document.createElement('link');
        css.id = 'xentra-mapbox-css';
        css.rel = 'stylesheet';
        css.href = 'https://api.mapbox.com/mapbox-gl-js/v' + MAPBOX_VERSION + '/mapbox-gl.css';
        document.head.appendChild(css);
      }
      var script = document.getElementById('xentra-mapbox-js');
      if (script) {
        if (script.dataset.loaded === '1' || (window.mapboxgl && typeof window.mapboxgl.Map === 'function')) {
          resolve();
          return;
        }
        script.addEventListener('load', function () { resolve(); }, { once: true });
        script.addEventListener('error', function () { reject(new Error('Mapbox GL gagal dimuat')); }, { once: true });
        return;
      }
      script = document.createElement('script');
      script.id = 'xentra-mapbox-js';
      script.src = 'https://api.mapbox.com/mapbox-gl-js/v' + MAPBOX_VERSION + '/mapbox-gl.js';
      script.onload = function () {
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = function () { reject(new Error('Mapbox GL gagal dimuat')); };
      document.head.appendChild(script);
    });
  }

  function cleanupTrackingMap() {
    trackingMapState.initSeq++;
    if (trackingMapState.map) {
      try { trackingMapState.map.remove(); } catch (_) {}
    }
    trackingMapState.map = null;
    trackingMapState.driverMarker = null;
    trackingMapState.destMarker = null;
    trackingMapState.branchMarker = null;
    trackingMapState.lastRouteKey = '';
    trackingMapState.fallbackMode = false;
    trackingMapState.fallbackDelivery = null;
  }

  function createDriverMarkerElement(headingDeg) {
    var el = document.createElement('div');
    el.className = 'x-driver-scooter-marker';
    el.style.cssText = 'width:48px;height:48px;display:flex;align-items:center;justify-content:center;z-index:6;pointer-events:none;';
    el.innerHTML = getDirectionalScooterSvg(headingDeg);
    return el;
  }

  function renderFallbackTrackingTileMap(container, delivery) {
    if (!container || !delivery) return;
    trackingMapState.fallbackMode = true;
    trackingMapState.fallbackDelivery = delivery;

    var destLat = Number(delivery.destination_latitude);
    var destLng = Number(delivery.destination_longitude);
    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return;

    var branchLat = delivery.branch_latitude != null ? Number(delivery.branch_latitude) : NaN;
    var branchLng = delivery.branch_longitude != null ? Number(delivery.branch_longitude) : NaN;
    var dLoc = delivery.driver_location;
    var drvLat = dLoc && dLoc.latitude != null ? Number(dLoc.latitude) : branchLat;
    var drvLng = dLoc && dLoc.longitude != null ? Number(dLoc.longitude) : branchLng;

    var centerLat = Number.isFinite(drvLat) ? (destLat + drvLat) / 2 : destLat;
    var centerLng = Number.isFinite(drvLng) ? (destLng + drvLng) / 2 : destLng;
    var zoom = 15;
    if (Number.isFinite(drvLat) && Number.isFinite(drvLng)) {
      var span = Math.max(Math.abs(destLat - drvLat), Math.abs(destLng - drvLng));
      if (span > 0.04) zoom = 12;
      else if (span > 0.02) zoom = 13;
      else if (span > 0.008) zoom = 14;
      else if (span < 0.003) zoom = 16;
    }

    function latLngToWorld(lat, lng, z) {
      var n = Math.pow(2, z);
      var rad = lat * Math.PI / 180;
      var x = ((lng + 180) / 360) * n * 256;
      var y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n * 256;
      return { x: x, y: y };
    }

    var rect = container.getBoundingClientRect();
    var w = rect.width || 360;
    var h = rect.height || 220;
    var halfW = w / 2;
    var halfH = h / 2;
    var centerPt = latLngToWorld(centerLat, centerLng, zoom);

    var minTileX = Math.floor((centerPt.x - halfW) / 256);
    var maxTileX = Math.floor((centerPt.x + halfW) / 256);
    var minTileY = Math.floor((centerPt.y - halfH) / 256);
    var maxTileY = Math.floor((centerPt.y + halfH) / 256);

    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    container.innerHTML = '';

    for (var tx = minTileX; tx <= maxTileX; tx++) {
      for (var ty = minTileY; ty <= maxTileY; ty++) {
        var img = document.createElement('img');
        img.src = 'https://tile.openstreetmap.org/' + zoom + '/' + tx + '/' + ty + '.png';
        img.alt = '';
        img.style.cssText = 'position:absolute;width:256px;height:256px;left:' + (tx * 256 - centerPt.x + halfW) + 'px;top:' + (ty * 256 - centerPt.y + halfH) + 'px;pointer-events:none;user-select:none;';
        container.appendChild(img);
      }
    }

    var destPt = latLngToWorld(destLat, destLng, zoom);
    var destX = destPt.x - centerPt.x + halfW;
    var destY = destPt.y - centerPt.y + halfH;

    if (Number.isFinite(drvLat) && Number.isFinite(drvLng)) {
      var drvPt = latLngToWorld(drvLat, drvLng, zoom);
      var drvX = drvPt.x - centerPt.x + halfW;
      var drvY = drvPt.y - centerPt.y + halfH;

      var svgLine = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgLine.setAttribute('width', String(w));
      svgLine.setAttribute('height', String(h));
      svgLine.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;';
      svgLine.innerHTML = '<line x1="' + drvX.toFixed(1) + '" y1="' + drvY.toFixed(1) + '" x2="' + destX.toFixed(1) + '" y2="' + destY.toFixed(1) + '" stroke="#10b981" stroke-width="4" stroke-dasharray="6,5" stroke-linecap="round"/>';
      container.appendChild(svgLine);

      var heading = resolveDriverHeading(delivery, drvLat, drvLng);
      trackingMapState.lastDriverCoords = { lat: drvLat, lng: drvLng };

      var drvEl = createDriverMarkerElement(heading);
      drvEl.style.position = 'absolute';
      drvEl.style.left = (drvX - 24) + 'px';
      drvEl.style.top = (drvY - 24) + 'px';
      container.appendChild(drvEl);
    }

    var pinEl = document.createElement('div');
    pinEl.style.cssText = 'position:absolute;left:' + (destX - 14) + 'px;top:' + (destY - 28) + 'px;width:28px;height:28px;z-index:4;pointer-events:none;display:flex;align-items:center;justify-content:center;font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));';
    pinEl.innerHTML = '📍';
    container.appendChild(pinEl);
  }

  function updateTrackingRouteLine(map, fromLng, fromLat, toLng, toLat) {
    if (!map || !Number.isFinite(fromLng) || !Number.isFinite(fromLat) || !Number.isFinite(toLng) || !Number.isFinite(toLat)) return;
    var routeKey = fromLng.toFixed(4) + ',' + fromLat.toFixed(4) + ';' + toLng.toFixed(4) + ',' + toLat.toFixed(4);
    if (trackingMapState.lastRouteKey === routeKey) return;
    trackingMapState.lastRouteKey = routeKey;

    var url = 'https://router.project-osrm.org/route/v1/driving/' +
      encodeURIComponent(fromLng) + ',' + encodeURIComponent(fromLat) + ';' +
      encodeURIComponent(toLng) + ',' + encodeURIComponent(toLat) +
      '?overview=full&geometries=geojson';

    fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var route = data && data.code === 'Ok' && data.routes && data.routes[0];
        if (!route || !route.geometry) return;

        var etaEl = document.getElementById('x-live-driver-eta');
        if (etaEl && Number.isFinite(route.duration)) {
          var mins = Math.max(1, Math.round(route.duration / 60));
          var km = (route.distance / 1000).toFixed(1);
          etaEl.textContent = 'Estimasi tiba ~' + mins + ' menit (' + km + ' km)';
        }

        // Also refine scooter direction using the first road segment ahead of the driver
        var coords = route.geometry.coordinates;
        if (Array.isArray(coords) && coords.length >= 2 && trackingMapState.driverMarker) {
          var segBearing = calculateBearing(coords[0][1], coords[0][0], coords[1][1], coords[1][0]);
          if (segBearing !== null) {
            trackingMapState.lastDriverHeading = segBearing;
            var markerEl = trackingMapState.driverMarker.getElement && trackingMapState.driverMarker.getElement();
            if (markerEl) markerEl.innerHTML = getDirectionalScooterSvg(segBearing);
          }
        }

        if (!trackingMapState.map || trackingMapState.map !== map) return;
        var feature = { type: 'Feature', properties: {}, geometry: route.geometry };
        var source = map.getSource('x-customer-live-route');
        if (source) {
          source.setData({ type: 'FeatureCollection', features: [feature] });
        } else {
          map.addSource('x-customer-live-route', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [feature] }
          });
          map.addLayer({
            id: 'x-customer-live-route-line',
            type: 'line',
            source: 'x-customer-live-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#10b981', 'line-width': 5, 'line-opacity': 0.85 }
          });
        }
      })
      .catch(function () {});
  }

  function updateLiveDriverPosition(delivery) {
    if (!delivery) return;
    if (trackingMapState.fallbackMode) {
      var fallbackContainer = document.getElementById('x-customer-live-map');
      if (fallbackContainer) renderFallbackTrackingTileMap(fallbackContainer, delivery);
      return;
    }

    var map = trackingMapState.map;
    if (!map || !window.mapboxgl) return;

    var dLoc = delivery.driver_location;
    var hasLiveGps = Boolean(dLoc && dLoc.latitude != null && dLoc.longitude != null);
    var drvLat = hasLiveGps ? Number(dLoc.latitude) : (delivery.branch_latitude != null ? Number(delivery.branch_latitude) : NaN);
    var drvLng = hasLiveGps ? Number(dLoc.longitude) : (delivery.branch_longitude != null ? Number(delivery.branch_longitude) : NaN);
    var destLat = delivery.destination_latitude != null ? Number(delivery.destination_latitude) : NaN;
    var destLng = delivery.destination_longitude != null ? Number(delivery.destination_longitude) : NaN;

    if (Number.isFinite(drvLat) && Number.isFinite(drvLng)) {
      var heading = resolveDriverHeading(delivery, drvLat, drvLng);
      trackingMapState.lastDriverCoords = { lat: drvLat, lng: drvLng };

      if (!trackingMapState.driverMarker) {
        var el = createDriverMarkerElement(heading);
        trackingMapState.driverMarker = new window.mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([drvLng, drvLat])
          .addTo(map);
      } else {
        trackingMapState.driverMarker.setLngLat([drvLng, drvLat]);
        var markerEl = trackingMapState.driverMarker.getElement && trackingMapState.driverMarker.getElement();
        if (markerEl) markerEl.innerHTML = getDirectionalScooterSvg(heading);
      }

      var statusBadge = document.getElementById('x-live-gps-badge');
      if (statusBadge && hasLiveGps) {
        statusBadge.textContent = '● Live GPS Aktif';
        statusBadge.style.background = '#dcfce7';
        statusBadge.style.color = '#15803d';
      }

      if (Number.isFinite(destLat) && Number.isFinite(destLng)) {
        updateTrackingRouteLine(map, drvLng, drvLat, destLng, destLat);
      }
    }
  }

  function initCustomerTrackingMap(delivery) {
    cleanupTrackingMap();
    var container = document.getElementById('x-customer-live-map');
    if (!container || !delivery) return;

    var destLat = delivery.destination_latitude != null ? Number(delivery.destination_latitude) : NaN;
    var destLng = delivery.destination_longitude != null ? Number(delivery.destination_longitude) : NaN;
    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return;

    var branchLat = delivery.branch_latitude != null ? Number(delivery.branch_latitude) : NaN;
    var branchLng = delivery.branch_longitude != null ? Number(delivery.branch_longitude) : NaN;
    var dLoc = delivery.driver_location;
    var drvLat = dLoc && dLoc.latitude != null ? Number(dLoc.latitude) : branchLat;
    var drvLng = dLoc && dLoc.longitude != null ? Number(dLoc.longitude) : branchLng;

    var seq = trackingMapState.initSeq;
    loadMapboxGL()
      .then(function () {
        if (seq !== trackingMapState.initSeq) return;
        var el = document.getElementById('x-customer-live-map');
        if (!el) return;

        window.mapboxgl.accessToken = MAPBOX_TOKEN;
        var map = new window.mapboxgl.Map({
          container: el,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [destLng, destLat],
          zoom: 14.5,
          attributionControl: false
        });
        trackingMapState.map = map;

        map.on('error', function (ev) {
          if (ev && ev.error && /webgl|style|worker/i.test(String(ev.error.message || ''))) {
            try { map.remove(); } catch (_) {}
            trackingMapState.map = null;
            renderFallbackTrackingTileMap(el, delivery);
          }
        });

        if (Number.isFinite(branchLat) && Number.isFinite(branchLng)) {
          trackingMapState.branchMarker = new window.mapboxgl.Marker({ color: '#1463ff' })
            .setLngLat([branchLng, branchLat])
            .addTo(map);
        }

        trackingMapState.destMarker = new window.mapboxgl.Marker({ color: '#e5484d' })
          .setLngLat([destLng, destLat])
          .addTo(map);

        // Place scooter marker immediately even before style 'load' finishes
        if (Number.isFinite(drvLat) && Number.isFinite(drvLng)) {
          var initHeading = resolveDriverHeading(delivery, drvLat, drvLng);
          trackingMapState.lastDriverCoords = { lat: drvLat, lng: drvLng };
          var scooterEl = createDriverMarkerElement(initHeading);
          trackingMapState.driverMarker = new window.mapboxgl.Marker({ element: scooterEl, anchor: 'center' })
            .setLngLat([drvLng, drvLat])
            .addTo(map);
        }

        setTimeout(function () {
          if (trackingMapState.map === map) {
            try { map.resize(); } catch (_) {}
          }
        }, 120);

        map.on('load', function () {
          if (seq !== trackingMapState.initSeq) return;
          try { map.resize(); } catch (_) {}
          var bounds = new window.mapboxgl.LngLatBounds();
          bounds.extend([destLng, destLat]);

          if (Number.isFinite(drvLat) && Number.isFinite(drvLng)) {
            bounds.extend([drvLng, drvLat]);
            updateLiveDriverPosition(delivery);
          } else if (Number.isFinite(branchLat) && Number.isFinite(branchLng)) {
            bounds.extend([branchLng, branchLat]);
            updateTrackingRouteLine(map, branchLng, branchLat, destLng, destLat);
          }

          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 44, maxZoom: 15.8, duration: 500 });
          }
        });
      })
      .catch(function () {
        var el = document.getElementById('x-customer-live-map');
        if (el) renderFallbackTrackingTileMap(el, delivery);
      });
  }

  // P7.13 Stale-response guard: increment on each fetch; discard responses
  // whose sequence number is older than the current one.
  var fetchSeq = 0;

  // P7.3 Platform policy: 3 minutes (matches server ACCEPTANCE_TIMEOUT_SECONDS = 180)
  var ACCEPTANCE_TIMEOUT_SECONDS = 180;

  // P8.6 Terminal states — polling stops unconditionally here
  var TERMINAL_STATES = { rejected: 1, timeout: 1, cancelled: 1, completed: 1, refunded: 1 };

  // ─── P7.4 Entry point ─────────────────────────────────────────────────────
  // Always fetches from server; never relies on window memory or local state.
  function mount(container, orderId) {
    targetContainer = container
      || document.getElementById('x-order-content')
      || document.getElementById('xentra-order-view');
    currentOrderId = orderId
      || (Router && Router.getOrderIdFromUrl())
      || getOrderIdFromLocation();

    // Clear local cart upon reaching confirmation screen
    try {
      Store.clearCart();
      localStorage.removeItem('xentra_checkout_draft');
      localStorage.removeItem('xentra_order_note');
    } catch (_) {}

    if (!currentOrderId) {
      renderNotFound('Nomor pesanan tidak disertakan.');
      return;
    }

    renderLoading();
    loadOrder(currentOrderId);
  }

  function getOrderIdFromLocation() {
    var hash = window.location.hash || '';
    var matchHash = hash.match(/#order-received[\\/=]([a-zA-Z0-9_-]+)/);
    if (matchHash && matchHash[1]) return matchHash[1];

    var path = window.location.pathname;
    var match = path.match(/\/order-received\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return match[1];

    var params = new URLSearchParams(window.location.search);
    return params.get('order_id') || params.get('id') || null;
  }

  function stopTimers() {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function formatPWAOrderCode(order) {
    if (!order) return '#—';
    var raw = (typeof order === 'string') ? order : (order.order_number || order.orderNumber || order.code || order.id || '');
    raw = String(raw).trim();
    if (!raw) return '#—';

    var match = raw.match(/^(?:#)?(OD|DI|TK|RS|POS)-(\d{3,4})\b/i);
    if (match) {
      var prefix = match[1].toUpperCase();
      if (prefix === 'POS') prefix = 'TK';
      return '#' + prefix + '-' + match[2];
    }

    var type = (typeof order === 'object' && order !== null) ? (order.order_type || order.fulfillment_type || '') : '';
    var pfx = 'TK';
    if (type === 'delivery') pfx = 'OD';
    else if (type === 'dine_in') pfx = 'DI';
    else if (type === 'reservation') pfx = 'RS';

    var digits = raw.replace(/\D/g, '');
    var num = digits.length >= 3 ? digits.slice(-3) : ((digits + '100').slice(0, 3));
    return '#' + pfx + '-' + num;
  }

  function renderLoading() {
    if (!targetContainer) return;
    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div style="padding:60px 20px;text-align:center;color:#6b7280;font-size:15px;font-weight:600;">' +
      '  <div style="width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:var(--x-primary);border-radius:50%;margin:0 auto 16px;animation:spin 1s linear infinite;"></div>' +
      '  Memuat status pesanan...' +
      '</div>';
  }

  // P7.2 Server-authoritative fetch with stale-response guard
  function loadOrder(id) {
    var seq = ++fetchSeq;
    API.get('/orders/' + encodeURIComponent(id))
      .then(function (data) {
        if (seq !== fetchSeq) return; // P7.13: stale — discard
        if (data.success && data.order) {
          stopTimers();
          renderOrder(data);
          var payStatus = (data.payment && data.payment.payment_status) || data.order.payment_status || 'pending';
          schedulePolling(data.order.status, payStatus, data.order.acceptance_deadline_at);
        } else {
          renderNotFound(data.error || 'Pesanan tidak ditemukan.');
        }
      })
      .catch(function (err) {
        if (seq !== fetchSeq) return;
        renderNotFound('Gagal memuat status pesanan: ' + err.message);
      });
  }

  function renderNotFound(msg) {
    if (!targetContainer) return;
    stopTimers();
    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div class="x-order-status-container" style="padding:40px 18px;text-align:center;">' +
      '  <div style="font-size:48px;margin-bottom:12px;">⚠️</div>' +
      '  <h2 style="font-size:18px;font-weight:800;color:#111;margin-bottom:8px;">Pesanan Tidak Ditemukan</h2>' +
      '  <p style="color:#6b7280;font-size:14px;line-height:1.5;margin-bottom:24px;">' + UI.escape(msg) + '</p>' +
      '  <button type="button" id="x-btn-back-home" style="display:inline-block;padding:12px 28px;font-size:14px;border:none;border-radius:24px;cursor:pointer;background:#d6ff00;color:#111;font-weight:800;">Kembali ke Menu</button>' +
      '</div>';

    var btn = document.getElementById('x-btn-back-home');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };
  }

  // ─── Top-level dispatcher ─────────────────────────────────────────────────
  function renderOrder(data) {
    if (!targetContainer) return;
    var order = data.order;
    var payment = data.payment || {};
    var status = order.status;
    var payMethod = (order.payment_method || payment.payment_method || 'cash').toLowerCase();
    var payStatus = (payment.payment_status || order.payment_status || 'pending').toLowerCase();
    var isOnline = isOnlineMethod(payMethod);

    // Reservation is a booking lifecycle, not a payment/fulfillment order.
    // Keep it outside generic payment and cooking-progress surfaces.
    if (order.order_type === 'reservation') {
      renderReservationOrder(data);
      return;
    }

    // P6.5 PAYMENT FAILURE: Online payment cancelled, denied, or expired
    if (isOnline && (payStatus === 'deny' || payStatus === 'cancel' || payStatus === 'expire')) {
      renderPaymentFailed(data, payStatus);
      return;
    }

    // P6.3 PAYMENT PENDING / PROCESSING: Online payment has not settled yet
    if (isOnline && (payStatus === 'pending' || payStatus === 'reconciliation_pending')) {
      if (status === 'cancelled') {
        renderCancelled(order, data.items);
        return;
      }
      renderPaymentPending(data);
      return;
    }

    // P6.4 / P6.6 PAYMENT SUCCESS -> AWAITING_BRANCH_ACCEPTANCE
    // When payment is settled (or cash), and order status is 'pending',
    // the order is awaiting branch confirmation. Delivery/pickup use the
    // unified tracking layout (phase 0 = PESANAN DIBUAT); other order types
    // keep the legacy waiting surface.
    if (status === 'pending') {
      var pendingType = order.order_type || 'delivery';
      if (pendingType === 'delivery' || pendingType === 'pickup') {
        renderTrackingOrder(data);
        return;
      }
      renderWaiting(data);
      return;
    }

    // P7.6 REJECTED
    if (status === 'rejected') {
      renderRejected(order, data.logs || []);
      return;
    }

    // P7.7 TIMEOUT
    if (status === 'timeout') {
      renderTimeout(order);
      return;
    }

    // Cancelled (customer-initiated)
    if (status === 'cancelled') {
      renderCancelled(order, data.items);
      return;
    }

    // P7.5 ACCEPTED and beyond (confirmed/preparing/ready/out_for_delivery/completed)
    renderFulfillmentOrder(data);
  }

  // ─── Reservation booking surface ─────────────────────────────────────────
  function renderReservationOrder(data) {
    if (!targetContainer) return;
    var order = data.order || {};
    var branchName = order.branch_name || 'Restoran';
    var orderNumber = formatPWAOrderCode(order);
    var date = order.reservation_date || '';
    var time = order.reservation_time || '';
    var guests = Number(order.guest_count || 0);
    var status = order.status || 'confirmed';

    if (status === 'cancelled') {
      renderCancelled(order, data.items);
      return;
    }

    var scheduleText = date
      ? UI.escape(date) + (time ? ' • ' + UI.escape(time) : '')
      : 'Jadwal belum tersedia';

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-reservation-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div class="x-aux-header" style="background:#fff;margin-bottom:12px;">' +
      '    <button type="button" class="x-aux-back-btn" id="x-btn-reservation-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Reservasi</h1>' +
      '  </div>' +
      '  <div style="background:#fff;padding:28px 18px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);margin-bottom:12px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">📅</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px;">Reservasi Berhasil</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0;line-height:1.5;">Reservasimu sudah tercatat di ' + UI.escape(branchName) + '.</p>' +
      '  </div>' +
      '  <div style="background:#fff;margin:0 14px 12px;border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 4px 14px rgba(0,0,0,0.05);">' +
      '    <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#6b7280;font-size:13px;">Tanggal & Jam</span><strong style="font-size:13px;color:#111;text-align:right;">' + scheduleText + '</strong></div>' +
      '    <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#6b7280;font-size:13px;">Jumlah Tamu</span><strong style="font-size:13px;color:#111;">' + (guests > 0 ? guests + ' orang' : '—') + '</strong></div>' +
      '    <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#6b7280;font-size:13px;">Nomor Reservasi</span><strong style="font-size:13px;color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '    <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#6b7280;font-size:13px;">Total</span><strong style="font-size:13px;color:#111;">Rp 0</strong></div>' +
      '  </div>' +
      (order.order_note ? '  <div style="background:#fff;margin:0 14px 12px;border-radius:16px;padding:14px 18px;box-shadow:0 4px 14px rgba(0,0,0,0.05);">' +
        '    <div style="font-size:12px;font-weight:800;color:#6b7280;letter-spacing:.04em;margin-bottom:6px;">CATATAN</div>' +
        '    <div style="font-size:13px;color:#4b5563;line-height:1.5;">' + UI.escape(order.order_note) + '</div>' +
      '  </div>' : '') +
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-reservation-back-home" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Kembali ke Menu</button>' +
      '  </div>' +
      '</div>';

    var back = document.getElementById('x-btn-reservation-back');
    if (back && Router) back.onclick = function () { Router.navigate('history'); };
    var backHome = document.getElementById('x-btn-reservation-back-home');
    if (backHome && Router) backHome.onclick = function () { Router.navigate('home'); };
  }

  // ─── P6.3 PAYMENT PENDING SURFACE ─────────────────────────────────────────
  function renderPaymentPending(data) {
    if (!targetContainer) return;
    var order = data.order;
    var payment = data.payment || {};
    var payStatus = (payment.payment_status || order.payment_status || 'pending').toLowerCase();
    var payMethod = (payment.payment_method || order.payment_method || 'cash').toLowerCase();
    var branchName = order.branch_name || 'Cabang';
    var orderNumber = formatPWAOrderCode(order);
    var snapToken = payment.snap_token || order.snap_token || null;
    // DOKU tidak memakai Snap: ia memberi halaman pembayarannya sendiri.
    var gatewayRedirectUrl = payment.redirect_url || order.redirect_url || null;
    var isRecon = payStatus === 'reconciliation_pending';

    var headerTitle = isRecon ? 'Memverifikasi Pembayaran' : 'Menunggu Pembayaran';
    var headerDesc = isRecon
      ? 'Pembayaran online sedang diverifikasi dengan sistem gateway. Mohon tunggu sejenak.'
      : 'Selesaikan pembayaran online sebesar <strong>' + UI.money(order.grand_total || 0) + '</strong> agar pesanan dapat diteruskan ke cabang <strong>' + UI.escape(branchName) + '</strong>.';

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-payment-pending-screen" class="x-payment-pending-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div style="background:#fff;padding:28px 18px 22px;margin-bottom:12px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="width:56px;height:56px;border-radius:50%;background:#e0f2fe;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:28px;">💳</div>' +
      '    <h1 id="x-pay-pending-title" style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px;">' + headerTitle + '</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 18px;line-height:1.5;">' + headerDesc + '</p>' +
      '    <div style="background:#fef9c3;border:1px solid #fde047;border-radius:12px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:center;gap:8px;">' +
      '      <span style="font-size:14px;">' + (isRecon ? '🔄' : '⏱️') + '</span>' +
      '      <span id="x-pay-status-label" style="font-size:13px;font-weight:700;color:#854d0e;">' + (isRecon ? 'Verifikasi Gateway Sedang Berjalan' : 'Status: Menunggu Pembayaran') + '</span>' +
      '    </div>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;display:flex;flex-direction:column;gap:8px;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Cabang</span><span style="font-weight:700;color:#111;">' + UI.escape(branchName) + '</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Metode Pembayaran</span><span style="font-weight:700;color:#111;">' + onlinePayLabel(payMethod, true) + '</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Total Tagihan</span><span style="font-weight:700;color:#111;">' + UI.money(order.grand_total || 0) + '</span></div>' +
      '    </div>' +
      '  </div>' +
      '  <div style="padding:0 14px;display:flex;flex-direction:column;gap:10px;">' +
      ((snapToken || gatewayRedirectUrl) ? '    <button type="button" id="x-btn-resume-pay" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Bayar Sekarang</button>' : '') +
      '    <button type="button" id="x-btn-cancel-pending" style="display:block;width:100%;height:44px;font-size:14px;font-weight:700;border:2px solid #e5e7eb;border-radius:24px;cursor:pointer;background:#fff;color:#6b7280;">Batalkan Pesanan</button>' +
      '  </div>' +
      '</div>';

    var resumeBtn = document.getElementById('x-btn-resume-pay');
    if (resumeBtn && (snapToken || gatewayRedirectUrl)) {
      resumeBtn.onclick = function () {
        // Jalur ke gateway diurus modul bersama: ia memuat Snap.js dengan client key
        // yang dikonfigurasi, atau mengarahkan ke halaman DOKU. Dulu halaman ini
        // memanggil window.snap langsung padahal Snap.js tidak pernah dimuat, jadi
        // tombolnya selalu gagal dengan pesan "sedang dimuat".
        var Gateway = window.Xentra && window.Xentra.PaymentGateway;
        if (!Gateway) {
          if (UI && UI.toast) UI.toast('Pembayaran tidak dapat dibuka. Silakan coba lagi.');
          return;
        }
        var back = function () { loadOrder(order.id); };
        Gateway.pay({
          snapToken: snapToken,
          redirectUrl: gatewayRedirectUrl,
          handlers: { onSuccess: back, onPending: back, onError: back, onClose: back }
        }).catch(function (err) {
          if (UI && UI.toast) UI.toast(Gateway.messageFor(err));
        });
      };
    }

    var cancelBtn = document.getElementById('x-btn-cancel-pending');
    if (cancelBtn) cancelBtn.onclick = function () { confirmCancel(order.id); };
  }

  // Provider online mana pun dihitung "online" — bukan hanya Midtrans. Dulu
  // perbandingannya mengunci satu nama provider, jadi pesanan DOKU tidak
  // diperlakukan sebagai pembayaran online.
  function isOnlineMethod(method) {
    var G = window.Xentra && window.Xentra.PaymentGateway;
    if (G && typeof G.isOnlineMethod === 'function') return G.isOnlineMethod(method);
    var m = String(method || '').toLowerCase();
    return m === 'midtrans' || m === 'doku';
  }

  // Nama provider tidak ditulis di sini: label diambil dari modul. Kalau modul belum
  // termuat, labelnya dibuat generik — bukan menebak salah satu provider.
  function onlinePayLabel(method, withChannels) {
    var G = window.Xentra && window.Xentra.PaymentGateway;
    if (G && typeof G.onlineLabel === 'function') return G.onlineLabel(method, withChannels);
    return 'Online Pay';
  }

  // ─── P6.5 PAYMENT FAILURE SURFACE ─────────────────────────────────────────
  function renderPaymentFailed(data, payStatus) {
    if (!targetContainer) return;
    stopTimers();
    var order = data.order;
    var orderNumber = formatPWAOrderCode(order);
    var branchName = order.branch_name || 'Cabang';

    var failTitle = 'Pembayaran Gagal';
    var failDesc = 'Pembayaran tidak dapat diproses.';
    if (payStatus === 'expire') {
      failTitle = 'Waktu Pembayaran Habis';
      failDesc = 'Batas waktu pembayaran online telah berakhir. Pesanan otomatis dibatalkan.';
    } else if (payStatus === 'deny') {
      failTitle = 'Pembayaran Ditolak';
      failDesc = 'Pembayaran ditolak oleh penyedia pembayaran/bank. Saldo Anda tidak terpotong.';
    } else if (payStatus === 'cancel') {
      failTitle = 'Pembayaran Dibatalkan';
      failDesc = 'Transaksi pembayaran online telah dibatalkan.';
    }

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-payment-failed-screen" class="x-payment-failed-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div style="background:#fff;padding:28px 18px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);margin-bottom:12px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">❌</div>' +
      '    <h1 id="x-pay-failed-title" style="font-size:20px;font-weight:800;color:#dc2626;margin:0 0 8px;">' + failTitle + '</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.5;">' + failDesc + '</p>' +
      '    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;font-size:13px;color:#dc2626;margin-bottom:16px;text-align:left;">' +
      '      Pesanan tidak diproses oleh cabang karena pembayaran belum berhasil.' +
      '    </div>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;display:flex;flex-direction:column;gap:8px;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Cabang</span><span style="font-weight:700;color:#111;">' + UI.escape(branchName) + '</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Total</span><span style="font-weight:700;color:#111;">' + UI.money(order.grand_total || 0) + '</span></div>' +
      '    </div>' +
      '  </div>' +
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-pay-retry" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Pesan Lagi</button>' +
      '  </div>' +
      '</div>';

    var btn = document.getElementById('x-btn-pay-retry');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };
  }

  // ─── Customer fulfillment projection ─────────────────────────────────────
  // Primary phases come from the shared Fulfillment Environment contract.
  // Backend status remains authoritative; this function only projects it into
  // customer-facing language and the appropriate phase count for the order type.
  function resolveOrderPhase(status, orderType, context) {
    var FE = window.Xentra && window.Xentra.FulfillmentEnvironments;
    var type = FE && FE.normalize ? FE.normalize(orderType || 'delivery') : (orderType || 'delivery');

    if (FE && typeof FE.project === 'function') {
      var projected = FE.project(type, status, context || {});
      return {
        title: String(projected.statusLabel || projected.currentPhase.label || '').toUpperCase(),
        badge: type === 'delivery' ? '🛵' : (type === 'pickup' ? '🛍️' : (type === 'dine_in' ? '🍽️' : '📅')),
        steps: projected.phases.map(function (p) { return p.label; }),
        doneCount: projected.currentPhaseIndex + (projected.isException ? 0 : 1)
      };
    }

    // Backward-compatible fallback for stale deployments.
    var isPickup = type === 'pickup';
    var isDineIn = type === 'dine_in';
    var isReservation = type === 'reservation';
    var steps;
    var idx = 0;
    if (isPickup) {
      steps = ['Pesanan diterima', 'Sedang disiapkan', 'Siap diambil', 'Sudah diambil'];
      if (status === 'preparing') idx = 1;
      else if (status === 'ready') idx = 2;
      else if (status === 'completed') idx = 3;
    } else if (isDineIn) {
      steps = ['Pesanan diterima', 'Sedang disiapkan', 'Siap disajikan', 'Pesanan selesai'];
      if (status === 'preparing') idx = 1;
      else if (status === 'ready') idx = 2;
      else if (status === 'completed') idx = 3;
    } else if (isReservation) {
      steps = ['Reservasi dibuat', 'Reservasi dikonfirmasi', 'Menunggu kedatangan'];
      if (status === 'confirmed') idx = 1;
      else if (status === 'active_table') idx = 2;
    } else {
      steps = ['Pesanan diterima', 'Sedang disiapkan', 'Siap diantar', 'Sedang diantar', 'Selesai diantar'];
      if (status === 'preparing') idx = 1;
      else if (status === 'ready') idx = 2;
      else if (status === 'out_for_delivery') idx = 3;
      else if (status === 'completed') idx = 4;
    }

    var title = 'PESANAN DITERIMA';
    if (status === 'preparing') title = 'SEDANG DISIAPKAN';
    else if (status === 'ready') title = isPickup ? 'SIAP DIAMBIL' : (isDineIn ? 'SIAP DISAJIKAN' : 'SIAP DIANTAR');
    else if (status === 'out_for_delivery') title = 'SEDANG DIANTAR';
    else if (status === 'completed') title = isPickup ? 'SUDAH DIAMBIL' : (isDineIn ? 'PESANAN SELESAI' : 'SELESAI DIANTAR');
    else if (status === 'pending') title = 'MENUNGGU DITERIMA';

    return {
      title: title,
      badge: isPickup ? '🛍️' : (isDineIn ? '🍽️' : (isReservation ? '📅' : '🛵')),
      steps: steps,
      doneCount: idx + 1,
      currentPhaseIndex: idx,
      currentPhase: { label: steps[idx] || '', description: '' },
      label: isPickup ? 'Pickup' : (isDineIn ? 'Dine-in' : (isReservation ? 'Reservasi' : 'Delivery'))
    };
  }

  function renderPhaseProgress(phase) {
    var html = '<div id="x-order-progress" style="display:flex;flex-direction:column;">';
    for (var i = 0; i < phase.steps.length; i++) {
      var done = i < phase.doneCount;
      var last = i === phase.steps.length - 1;
      var dot = done
        ? '<div style="width:22px;height:22px;border-radius:50%;background:var(--x-primary);color:var(--x-primary-text,#111);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0;">✓</div>'
        : '<div style="width:22px;height:22px;border-radius:50%;border:2px solid #e5e7eb;background:#fff;flex-shrink:0;box-sizing:border-box;"></div>';
      html +=
        '<div style="display:flex;align-items:flex-start;gap:10px;">' +
        '  <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">' +
        dot +
        (last ? '' : '<div style="width:2px;flex:1;min-height:16px;background:' + (done && (i + 1) < phase.doneCount ? 'var(--x-primary)' : '#e5e7eb') + ';"></div>') +
        '  </div>' +
        '  <div style="font-size:13.5px;font-weight:' + (done ? '700' : '500') + ';color:' + (done ? '#111' : '#9ca3af') + ';padding:2px 0 ' + (last ? '0' : '16px') + ' 0;">' + phase.steps[i] + '</div>' +
        '</div>';
    }
    return html + '</div>';
  }

  function fmtDistance(meters) {
    var m = Number(meters || 0);
    if (!m || m <= 0) return '';
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toFixed(1).replace('.', ',') + ' km';
  }

  // ─── Unified tracking layout (delivery + pickup, any active status) ───
  // Section order: Header → Dynamic Title → Progress → Route/Location →
  // DIKIRIM KEPADA → PEMBELIAN → DETAIL PEMBAYARAN → CATATAN → Batalkan.
  function renderTrackingOrder(data) {
    if (!targetContainer) return;
    var order = data.order;
    var items = data.items || [];
    var delivery = data.delivery || {};
    var payment = data.payment || {};
    var orderType = order.order_type || 'delivery';
    var isPickup = orderType === 'pickup';
    var status = order.status;

    var phase = resolveOrderPhase(status, orderType);
    var branchName = order.branch_name || 'Restoran';
    var isCash = (payment.payment_method || order.payment_method || 'cash') === 'cash';
    // Tunai yang dibayar di kasir (dine-in & pickup) bukan COD: labelnya harus
    // sama dengan yang dipilih konsumen di checkout.
    var cashAtCounter = isCash && (orderType === 'dine_in' || orderType === 'dinein' || orderType === 'pickup');
    var payLabel = isCash ? (cashAtCounter ? '💵 Cash Tunai • Bayar ke kasir' : '💵 Tunai (COD)') : 'Online Pay';
    if (order.payment_status === 'settlement' || order.payment_status === 'paid' || payment.payment_status === 'settlement' || payment.payment_status === 'paid') {
      payLabel += ' • Lunas';
    }

    var dist = fmtDistance(delivery.actual_road_distance_meters);
    var destAddr = delivery.destination_address || delivery.address_text || '';

    // Recipient snapshot first; buyer columns for pre-snapshot legacy orders;
    // owner session as final fallback (IDOR guard guarantees only the owner
    // views this order, so the session IS the buyer). Always real profile
    // data — never a bare placeholder. Phone shown as-is, never masked.
    var sess = null;
    try { sess = Store.getState().customerSession; } catch (_) {}
    var rName = order.recipient_name || order.customer_name || (sess && sess.name) || '';
    var rPhone = order.recipient_phone || order.customer_phone || (sess && sess.phone) || '';

    var itemsHtml = '';
    items.forEach(function (item) {
      var itemTotal = Number(item.unit_price || 0) * Number(item.quantity || 0);
      itemsHtml +=
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid #f3f4f6;">' +
        '  <div style="flex:1;min-width:0;padding-right:12px;">' +
        '    <div style="font-size:14px;font-weight:700;color:#111;">' + item.quantity + '× ' + UI.escape(item.product_name || item.name) + '</div>' +
        (item.note ? '<div style="font-size:12px;color:#6b7280;margin-top:2px;">Catatan: ' + UI.escape(item.note) + '</div>' : '') +
        '  </div>' +
        '  <div style="font-size:14px;font-weight:700;color:#111;white-space:nowrap;">' + UI.money(itemTotal) + '</div>' +
        '</div>';
    });

    var hasLiveMap = !isPickup && delivery.destination_latitude != null && delivery.destination_longitude != null &&
      (status === 'out_for_delivery' || status === 'ready' || delivery.status === 'on_delivery' || delivery.status === 'picked_up' || delivery.status === 'assigned');

    var liveMapHtml = '';
    if (hasLiveMap) {
      var hasGps = delivery.driver_location && delivery.driver_location.latitude != null;
      var waPhone = delivery.driver_phone ? String(delivery.driver_phone).replace(/[^0-9]/g, '').replace(/^0/, '62') : '';
      liveMapHtml =
        '<div style="margin-bottom:14px;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;background:#f8fafc;">' +
        '  <div style="position:relative;">' +
        '    <div id="x-customer-live-map" style="width:100%;height:220px;background:#e8ece8;"></div>' +
        '    <div style="position:absolute;top:10px;left:10px;right:10px;display:flex;justify-content:space-between;align-items:center;pointer-events:none;z-index:2;">' +
        '      <span id="x-live-gps-badge" style="padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,0.12);' + (hasGps ? 'background:#dcfce7;color:#15803d;' : 'background:#ffffff;color:#374151;') + '">' +
                 (hasGps ? '● Live GPS Aktif' : (status === 'out_for_delivery' ? '🛵 Kurir Menuju Lokasi' : '📍 Peta Pengantaran')) +
        '      </span>' +
        '    </div>' +
        '  </div>' +
        (delivery.driver_name
          ? '  <div style="padding:12px 14px;background:#ffffff;border-top:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
            '    <div style="display:flex;align-items:center;gap:10px;min-width:0;">' +
            '      <div style="width:38px;height:38px;border-radius:50%;background:#ecfdf5;color:#059669;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🛵</div>' +
            '      <div style="min-width:0;">' +
            '        <div style="font-size:14px;font-weight:800;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + UI.escape(delivery.driver_name) + '</div>' +
            '        <div id="x-live-driver-eta" style="font-size:11.5px;color:#059669;font-weight:700;margin-top:1px;">' + (status === 'out_for_delivery' ? 'Sedang menuju alamatmu' : 'Kurir Cabang') + '</div>' +
            '      </div>' +
            '    </div>' +
            (delivery.driver_phone
              ? '    <div style="display:flex;gap:6px;flex-shrink:0;">' +
                (waPhone ? '<a href="https://wa.me/' + encodeURIComponent(waPhone) + '" target="_blank" rel="noopener" style="width:36px;height:36px;border-radius:50%;background:#dcfce7;color:#15803d;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:15px;" title="Chat WhatsApp">💬</a>' : '') +
                '      <a href="tel:' + UI.escape(delivery.driver_phone) + '" style="width:36px;height:36px;border-radius:50%;background:#f1f5f9;color:#0f172a;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:15px;" title="Telepon Kurir">📞</a>' +
                '    </div>'
              : '') +
            '  </div>'
          : '') +
        '</div>';
    }

    var routeHtml;
    if (isPickup) {
      routeHtml =
        '<div style="display:flex;gap:10px;align-items:flex-start;">' +
        '  <div style="font-size:20px;line-height:1.3;">🍴</div>' +
        '  <div style="min-width:0;">' +
        '    <div style="font-size:12px;color:#6b7280;">Lokasi pengambilan</div>' +
        '    <div style="font-size:14px;font-weight:700;color:#111;">' + UI.escape(branchName) + '</div>' +
        '    <div style="font-size:12.5px;color:#6b7280;margin-top:2px;">Siap diambil di lokasi restoran</div>' +
        '  </div>' +
        '</div>';
    } else {
      routeHtml =
        liveMapHtml +
        '<div style="display:flex;gap:10px;align-items:flex-start;">' +
        '  <div style="font-size:20px;line-height:1.3;">🍴</div>' +
        '  <div style="min-width:0;">' +
        '    <div style="font-size:12px;color:#6b7280;">Alamat restoran</div>' +
        '    <div style="font-size:14px;font-weight:700;color:#111;">' + UI.escape(branchName) + '</div>' +
        '  </div>' +
        '</div>' +
        '<div style="margin:6px 0 6px 9px;border-left:2px dotted #d1d5db;height:14px;"></div>' +
        '<div style="display:flex;gap:10px;align-items:flex-start;">' +
        '  <div style="font-size:20px;line-height:1.3;">📍</div>' +
        '  <div style="min-width:0;">' +
        '    <div style="font-size:12px;color:#6b7280;">Alamat pengiriman' + (dist ? ' · ' + dist : '') + '</div>' +
        '    <div style="font-size:13.5px;color:#111;line-height:1.45;">' + UI.escape(destAddr || 'Alamat tujuan') + '</div>' +
        (!hasLiveMap && delivery.driver_name
          ? '<div style="margin-top:8px;padding:9px 12px;background:#f0fdf4;border-radius:10px;font-size:13px;color:#166534;">🛵 Kurir: <strong>' + UI.escape(delivery.driver_name) + '</strong>' +
            (delivery.driver_phone ? ' (' + UI.escape(delivery.driver_phone) + ')' : '') +
            (delivery.tracking_url ? '<div style="margin-top:6px;"><a href="' + UI.escape(delivery.tracking_url) + '" target="_blank" rel="noopener noreferrer" style="color:#16a34a;font-weight:700;text-decoration:underline;">Lacak Pengiriman Langsung →</a></div>' : '') +
            '</div>'
          : '') +
        '  </div>' +
        '</div>';
    }

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div class="x-order-tracking-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +

      // Top bar (same pattern as the Riwayat Pesanan header)
      '  <div class="x-aux-header" style="background:#fff;margin-bottom:10px;">' +
      '    <button type="button" class="x-aux-back-btn" id="x-btn-order-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Pesanan</h1>' +
      '  </div>' +

      // Header: dynamic status title + progress phases in ONE card.
      // Order meta (number/branch) and badge icon are hidden by design.
      '  <div style="background:#fff;padding:20px 18px;margin:0 14px 10px;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <h1 id="x-order-phase-title" style="font-size:20px;font-weight:800;color:#111;margin:0 0 14px;">' + phase.title + '</h1>' +
      renderPhaseProgress(phase) +
      '  </div>' +

      // Route / location (no heading)
      '  <div style="background:#fff;padding:16px 18px;margin:0 14px 10px;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      routeHtml +
      '  </div>' +

      // Dikirim kepada
      '  <div style="background:#fff;padding:14px 18px;margin:0 14px 10px;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="font-size:12px;font-weight:800;letter-spacing:.04em;color:#6b7280;margin-bottom:6px;">DIKIRIM KEPADA</div>' +
      '    <div style="font-size:14px;font-weight:700;color:#111;">' + UI.escape(rName || 'Pelanggan') + '</div>' +
      (rPhone ? '<div style="font-size:13px;color:#4b5563;margin-top:1px;">' + UI.escape(rPhone) + '</div>' : '') +
      '  </div>' +

      // Pembelian
      '  <div style="background:#fff;padding:14px 18px;margin:0 14px 10px;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="font-size:12px;font-weight:800;letter-spacing:.04em;color:#6b7280;margin-bottom:4px;">PEMBELIAN</div>' +
      itemsHtml +
      '  </div>' +

      // Detail pembayaran
      '  <div style="background:#fff;padding:14px 18px;margin:0 14px 10px;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="font-size:12px;font-weight:800;letter-spacing:.04em;color:#6b7280;margin-bottom:8px;">DETAIL PEMBAYARAN</div>' +
      '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;"><span style="color:#6b7280;">Subtotal</span><span style="color:#111;">' + UI.money(order.subtotal || 0) + '</span></div>' +
      (!isPickup ? '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;"><span style="color:#6b7280;">Biaya Pengiriman</span><span style="color:#111;">' + UI.money(order.delivery_fee || 0) + '</span></div>' : '') +
      (Number(order.discount_amount) > 0 ? '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;color:#ff4040;"><span>Diskon</span><span>−' + UI.money(order.discount_amount) + '</span></div>' : '') +
      '    <div style="height:1px;background:#e5e7eb;margin:8px 0;"></div>' +
      '    <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;color:#111;"><span>Total</span><span>' + UI.money(order.grand_total || 0) + '</span></div>' +
      '    <div style="font-size:12px;color:#6b7280;margin-top:6px;">' + UI.escape(payLabel) + '</div>' +
      ((isCash && order.cash_tendered != null && Number(order.cash_tendered) > 0)
        ? '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:8px;"><span style="color:#6b7280;">Bayar dengan uang</span><span style="color:#111;font-weight:600;">' + UI.money(order.cash_tendered) + '</span></div>' +
          '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:4px;"><span style="color:#6b7280;">Kembalian</span><span style="color:#111;font-weight:600;">' + UI.money(order.expected_change != null ? order.expected_change : Math.max(0, Number(order.cash_tendered) - Number(order.grand_total || 0))) + '</span></div>'
        : '') +
      '  </div>' +

      // Catatan pengantaran
      (order.order_note
        ? '  <div style="background:#fff;padding:14px 18px;margin:0 14px 10px;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
          '    <div style="font-size:12px;font-weight:800;letter-spacing:.04em;color:#6b7280;margin-bottom:6px;">CATATAN PENGANTARAN</div>' +
          '    <div style="font-size:13px;color:#4b5563;line-height:1.5;">' + UI.escape(order.order_note) + '</div>' +
          '  </div>'
        : '') +

      // Cancel (server allows only while pending)
      (status === 'pending'
        ? '  <div style="padding:2px 14px 0;">' +
          '    <button type="button" id="x-btn-cancel-order" style="display:block;width:100%;height:44px;font-size:14px;font-weight:700;border:2px solid #e5e7eb;border-radius:24px;cursor:pointer;background:#fff;color:#6b7280;">Batalkan Pesanan</button>' +
          '  </div>'
        : '') +

      '</div>';

    var cancelBtn = document.getElementById('x-btn-cancel-order');
    if (cancelBtn) cancelBtn.onclick = function () { confirmCancel(order.id); };

    var backBtn = document.getElementById('x-btn-order-back');
    if (backBtn && Router) backBtn.onclick = function () { Router.navigate('history'); };

    lastDeliveryStatus = delivery.status || null;
    lastDriverName = delivery.driver_name || null;

    if (hasLiveMap) {
      initCustomerTrackingMap(delivery);
    } else {
      cleanupTrackingMap();
    }
  }

  // ─── P7.1 AWAITING BRANCH ACCEPTANCE SURFACE ─────────────────────────────
  function renderWaiting(data) {
    if (!targetContainer) return;
    var order = data.order;
    var payment = data.payment || {};
    var branchName = order.branch_name || 'Cabang';
    var orderNumber = formatPWAOrderCode(order);
    var deadlineAt = order.acceptance_deadline_at || null;
    var payMethod = (order.payment_method || payment.payment_method || 'cash').toLowerCase();
    var isOnline = isOnlineMethod(payMethod);

    // P7.3 Derive seconds remaining from server-authoritative deadline
    var secsRemaining = ACCEPTANCE_TIMEOUT_SECONDS;
    if (deadlineAt) {
      var msRemaining = new Date(deadlineAt).getTime() - Date.now();
      secsRemaining = Math.max(0, Math.floor(msRemaining / 1000));
    }

    var payBadgeHtml = isOnline
      ? '<div id="x-badge-pay-confirmed" style="display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:12px;">✓ Pembayaran Berhasil Dikonfirmasi</div>'
      : '<div id="x-badge-pay-cash" style="display:inline-flex;align-items:center;gap:6px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:12px;">💵 Pembayaran Tunai (COD)</div>';

    var waitingDesc = isOnline
      ? 'Pembayaran berhasil dikonfirmasi. Cabang <strong>' + UI.escape(branchName) + '</strong> sedang memproses konfirmasi penerimaan pesanan.'
      : 'Pesananmu sudah diterima sistem. Cabang <strong>' + UI.escape(branchName) + '</strong> sedang memproses konfirmasi penerimaan pesanan.';

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-waiting-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +

      // Status Header Card
      '  <div style="background:#fff;padding:28px 18px 22px;margin-bottom:12px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="width:56px;height:56px;border-radius:50%;background:#fef9c3;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:28px;">⏳</div>' +
      payBadgeHtml +
      '    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px;">Menunggu Konfirmasi Cabang</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 18px;line-height:1.5;">' + waitingDesc + '</p>' +

      // P7.3 Countdown — display only, never authoritative
      '    <div style="background:#fef9c3;border-radius:14px;padding:14px 16px;margin-bottom:16px;">' +
      '      <div style="font-size:12px;color:#92400e;font-weight:600;margin-bottom:4px;">Batas waktu konfirmasi cabang</div>' +
      '      <div id="x-acceptance-countdown" style="font-size:32px;font-weight:900;color:#92400e;font-variant-numeric:tabular-nums;">' + fmtCountdown(secsRemaining) + '</div>' +
      '      <div style="font-size:11px;color:#92400e;margin-top:4px;">Timer ini hanya tampilan. Status pesanan selalu dari server.</div>' +
      '    </div>' +

      // Order summary
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;display:flex;flex-direction:column;gap:8px;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Cabang</span><span style="font-weight:700;color:#111;">' + UI.escape(branchName) + '</span></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Total</span><span style="font-weight:700;color:#111;">' + UI.money(order.grand_total || 0) + '</span></div>' +
      '    </div>' +
      '  </div>' +

      // Info card
      '  <div style="background:#fff;padding:18px;margin:0 14px 12px;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 12px;color:#111;">Yang Terjadi Selanjutnya</h2>' +
      '    <div style="display:flex;flex-direction:column;gap:12px;">' +
      renderInfoStep('1', 'Menunggu Konfirmasi', 'Cabang ' + branchName + ' akan mengkonfirmasi pesanan dalam batas waktu yang ditentukan.') +
      renderInfoStep('2', 'Pesanan Diterima', 'Jika diterima, pesananmu langsung masuk ke dapur dan kamu dapat memantau statusnya.') +
      renderInfoStep('3', 'Jika Ditolak atau Timeout', 'Cabang dapat menolak atau tidak merespons. Kamu akan diberitahu dan pesanan tidak diproses.') +
      '    </div>' +
      '  </div>' +

      // Cancel button (only valid while pending — server enforces)
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-cancel-order" style="display:block;width:100%;height:44px;font-size:14px;font-weight:700;border:2px solid #e5e7eb;border-radius:24px;cursor:pointer;background:#fff;color:#6b7280;">Batalkan Pesanan</button>' +
      '  </div>' +

      '</div>';

    var cancelBtn = document.getElementById('x-btn-cancel-order');
    if (cancelBtn) cancelBtn.onclick = function () { confirmCancel(order.id); };

    // P7.3 Start countdown anchored to server deadline
    startCountdown(secsRemaining, order.id);
  }

  function fmtCountdown(s) {
    var m = Math.floor(Math.max(0, s) / 60);
    var sec = Math.max(0, s) % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function renderInfoStep(num, title, desc) {
    return (
      '<div style="display:flex;align-items:flex-start;gap:10px;">' +
      '  <div style="width:24px;height:24px;border-radius:50%;background:#fef9c3;color:#92400e;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0;">' + num + '</div>' +
      '  <div>' +
      '    <div style="font-size:13px;font-weight:700;color:#111;">' + UI.escape(title) + '</div>' +
      '    <div style="font-size:12px;color:#6b7280;margin-top:2px;line-height:1.4;">' + UI.escape(desc) + '</div>' +
      '  </div>' +
      '</div>'
    );
  }

  // P7.3 UX countdown — purely presentational.
  // When it reaches zero: fetch server state. NEVER mutate order state.
  function startCountdown(initialSeconds, orderId) {
    if (countdownTimer) clearInterval(countdownTimer);
    var secs = initialSeconds;
    countdownTimer = setInterval(function () {
      secs = Math.max(0, secs - 1);
      var el = document.getElementById('x-acceptance-countdown');
      if (el) {
        if (secs > 0) {
          el.textContent = fmtCountdown(secs);
        } else {
          el.style.fontSize = '18px';
          el.textContent = 'Memeriksa status pesanan...';
        }
      }
      if (secs <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        // P7.3: timer at zero → fetch authoritative state; never assume timeout
        loadOrder(orderId);
      }
    }, 1000);
  }

  // ─── P7.6 REJECTED STATE ─────────────────────────────────────────────────
  function renderRejected(order, logs) {
    if (!targetContainer) return;
    var orderNumber = formatPWAOrderCode(order);
    var branchName = order.branch_name || 'Cabang';

    // Extract rejection reason from audit log (server-provided, never fabricated)
    var rejectionNote = '';
    for (var i = logs.length - 1; i >= 0; i--) {
      if (logs[i].new_status === 'rejected' && logs[i].note) {
        rejectionNote = String(logs[i].note).replace(/^\[REJECT by [^\]]+\]\s*/, '').trim();
        break;
      }
    }

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-rejected-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div style="background:#fff;padding:28px 18px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);margin-bottom:12px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">❌</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#dc2626;margin:0 0 8px;">Pesanan Ditolak</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.5;">Cabang <strong>' + UI.escape(branchName) + '</strong> tidak dapat memproses pesananmu saat ini.</p>' +
      (rejectionNote ? '    <div id="x-rejection-note" style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;font-size:13px;color:#dc2626;margin-bottom:16px;text-align:left;">' + UI.escape(rejectionNote) + '</div>' : '') +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '    </div>' +
      '  </div>' +
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-order-again" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Pesan Menu Lainnya</button>' +
      '  </div>' +
      '</div>';

    var btn = document.getElementById('x-btn-order-again');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };
  }

  // ─── P7.7 TIMEOUT STATE ──────────────────────────────────────────────────
  function renderTimeout(order) {
    if (!targetContainer) return;
    var orderNumber = formatPWAOrderCode(order);
    var branchName = order.branch_name || 'Cabang';

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div id="x-timeout-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div style="background:#fff;padding:28px 18px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);margin-bottom:12px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">⌛</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#d97706;margin:0 0 8px;">Waktu Konfirmasi Habis</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.5;">Cabang <strong>' + UI.escape(branchName) + '</strong> tidak merespons dalam batas waktu. Pesananmu tidak diproses.</p>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;text-align:left;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '    </div>' +
      '  </div>' +
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-try-again" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Coba Pesan Lagi</button>' +
      '  </div>' +
      '</div>';

    var btn = document.getElementById('x-btn-try-again');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };
  }

  // Cancelled by customer — informative + direct reorder, no order code.
  // Shows WHAT was cancelled and offers Pesan Ini Lagi (same items back to
  // cart, branch-scoped checkout) + Pesan Menu Baru. Promo reward lines are
  // never re-added directly — they go through promotion eligibility again.
  function renderCancelled(order, items) {
    if (!targetContainer) return;
    items = items || [];
    var branchName = order.branch_name || 'Restoran';

    var summaryText = items.length > 0
      ? items.map(function (it) {
          return (it.quantity || 1) + '× ' + (it.product_name || it.name || 'Menu');
        }).join(', ')
      : '';

    var itemsHtml = '';
    items.forEach(function (item) {
      var itemTotal = Number(item.unit_price || 0) * Number(item.quantity || 0);
      itemsHtml +=
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid #f3f4f6;">' +
        '  <div style="flex:1;min-width:0;padding-right:12px;">' +
        '    <div style="font-size:14px;font-weight:700;color:#111;">' + (item.quantity || 1) + '× ' + UI.escape(item.product_name || item.name || 'Menu') + '</div>' +
        (item.note ? '<div style="font-size:12px;color:#6b7280;margin-top:2px;">Catatan: ' + UI.escape(item.note) + '</div>' : '') +
        '  </div>' +
        '  <div style="font-size:14px;font-weight:700;color:#111;white-space:nowrap;">' + UI.money(itemTotal) + '</div>' +
        '</div>';
    });

    targetContainer.style.display = 'block';
    targetContainer.innerHTML =
      '<div style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +
      '  <div class="x-aux-header" style="background:#fff;margin-bottom:12px;">' +
      '    <button type="button" class="x-aux-back-btn" id="x-btn-cancelled-back" aria-label="Kembali">' +
      '      <img src="/assets/icons/arrowback.svg" alt="Kembali">' +
      '    </button>' +
      '    <h1 class="x-aux-title">Pesanan Batal</h1>' +
      '  </div>' +
      '  <div style="background:#fff;padding:28px 18px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);margin-bottom:12px;">' +
      '    <div style="font-size:48px;margin-bottom:12px;">🚫</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 8px;">Pesanan Dibatalkan</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0;line-height:1.5;">' +
      (summaryText
        ? 'Pesananmu (' + UI.escape(summaryText) + ') dari <strong>' + UI.escape(branchName) + '</strong> telah dibatalkan.'
        : 'Pesananmu dari <strong>' + UI.escape(branchName) + '</strong> telah dibatalkan.') +
      '    </p>' +
      '  </div>' +
      (itemsHtml
        ? '  <div style="background:#fff;padding:14px 18px;margin:0 14px 10px;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
          '    <div style="font-size:12px;font-weight:800;letter-spacing:.04em;color:#6b7280;margin-bottom:4px;">PESANAN YANG DIBATALKAN</div>' +
          itemsHtml +
          '  </div>'
        : '') +
      '  <div style="padding:4px 14px 0;display:flex;flex-direction:column;gap:10px;">' +
      (itemsHtml
        ? '    <button type="button" id="x-btn-reorder-same" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);">Pesan Ini Lagi</button>'
        : '') +
      '    <button type="button" id="x-btn-new-order" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border-radius:24px;cursor:pointer;background:#fff;color:#111;border:2px solid #e5e7eb;">Pesan Menu Baru</button>' +
      '  </div>' +
      '</div>';

    var reorderBtn = document.getElementById('x-btn-reorder-same');
    if (reorderBtn) reorderBtn.onclick = function () {
      try {
        items.forEach(function (it) {
          var pid = String(it.product_id || it.id || '');
          // Promo reward lines re-enter only via promotion eligibility —
          // never copy them straight into the cart.
          if (!pid || pid.indexOf('reward_') === 0 || pid.indexOf('prm_') === 0) return;
          if (it.note && String(it.note).indexOf('[PROMO:') !== -1) return;
          if (Store && typeof Store.addItem === 'function') {
            Store.addItem({
              id: pid,
              product_id: pid,
              name: it.product_name || it.name || 'Menu',
              price: Number(it.unit_price || 0),
              regular_price: null,
              image_url: it.image_url || '',
              description: '',
              note: ''
            }, Number(it.quantity || 1), { branch_id: order.branch_id, branch_name: order.branch_name || null });
          }
        });
      } catch (_) {}
      if (Router) Router.navigate('checkout', order.branch_id ? { branchId: order.branch_id } : null);
    };

    var btn = document.getElementById('x-btn-new-order');
    if (btn && Router) btn.onclick = function () { Router.navigate('home'); };

    var backBtn = document.getElementById('x-btn-cancelled-back');
    if (backBtn && Router) backBtn.onclick = function () { Router.navigate('history'); };
  }

  // ─── P7.5 ACCEPTED STATE and fulfillment tracking ─────────────────────────
  function renderFulfillmentOrder(data) {
    if (!targetContainer) return;
    // Metode pembayaran pesanan ini, untuk label. Nama provider tidak ditulis di sini.
    var payMethod = ((data.order && data.order.payment_method) || (data.payment && data.payment.payment_method) || 'cash').toLowerCase();
    // Delivery/pickup use the unified tracking layout (dynamic title +
    // progress from resolveOrderPhase). Other order types keep legacy.
    var fulType = (data.order && data.order.order_type) || 'delivery';
    if (fulType === 'delivery' || fulType === 'pickup') {
      renderTrackingOrder(data);
      return;
    }
    var order = data.order;
    var items = data.items || [];
    var delivery = data.delivery || {};
    var payment = data.payment || {};

    var orderNumber = formatPWAOrderCode(order);
    var orderType = order.order_type || 'delivery';
    var status = order.status;
    var isCash = (payment.payment_method || order.payment_method || 'cash') === 'cash';
    var phase = resolveOrderPhase(status, orderType);


    var statusTitle = 'Pesanan Diterima Cabang!';
    var statusDesc = 'Cabang telah mengonfirmasi pesananmu. Dapur sedang menyiapkan makanan.';
    var badgeIcon = '✓';

    if (status === 'preparing') {
      statusTitle = 'Sedang Disiapkan di Dapur';
      statusDesc = 'Dapur cabang sedang memasak dan menyiapkan pesananmu.';
      badgeIcon = '🍳';
    } else if (status === 'ready') {
      if (orderType === 'delivery') {
        statusTitle = 'Pesanan Siap Diantar';
        statusDesc = 'Makanan sudah selesai dimasak dan siap diserahkan kepada kurir.';
      } else if (orderType === 'pickup') {
        statusTitle = 'Pesanan Siap Diambil!';
        statusDesc = 'Makananmu sudah siap. Silakan ambil di konter cabang ' + UI.escape(order.branch_name || '') + '.';
      } else if (orderType === 'dine_in') {
        statusTitle = 'Pesanan Siap Disajikan';
        statusDesc = 'Makananmu sudah siap dan akan segera disajikan ke mejamu.';
      } else {
        statusTitle = 'Pesanan Siap';
        statusDesc = 'Pesananmu sudah selesai disiapkan.';
      }
      badgeIcon = '🔔';
    } else if (status === 'out_for_delivery') {
      statusTitle = 'Dalam Pengantaran Kurir';
      statusDesc = 'Kurir sedang dalam perjalanan mengantarkan pesanan ke alamat tujuan.';
      badgeIcon = '🛵';
    } else if (status === 'completed') {
      statusTitle = 'Pesanan Selesai';
      statusDesc = 'Pesanan telah selesai dinikmati. Terima kasih telah memesan di ' + UI.escape(order.branch_name || 'kami') + '!';
      badgeIcon = '🎉';
    } else if (orderType === 'reservation') {
      statusTitle = 'Reservasi Berhasil Dikonfirmasi!';
      statusDesc = 'Reservasi mejamu sudah tercatat di cabang ' + UI.escape(order.branch_name || '') + '. Kasir akan melakukan Check-in saat kamu tiba.';
    }

    // Primary phase completion comes entirely from the Fulfillment Environment
    // projection so each purchase type can have its own number of phases.

    var itemsHtml = '';
    if (items.length > 0) {
      items.forEach(function (item) {
        var itemTotal = Number(item.unit_price || 0) * Number(item.quantity || 0);
        var noteHtml = item.note
          ? '<div style="font-size:12px;color:#6b7280;margin-top:2px;">Catatan: ' + UI.escape(item.note) + '</div>'
          : '';
        itemsHtml +=
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f3f4f6;">' +
          '  <div style="flex:1;min-width:0;padding-right:12px;">' +
          '    <div style="font-size:14px;font-weight:700;color:#111;">' + item.quantity + '× ' + UI.escape(item.product_name || item.name) + '</div>' +
          noteHtml +
          '  </div>' +
          '  <div style="font-size:14px;font-weight:700;color:#111;white-space:nowrap;">' + UI.money(itemTotal) + '</div>' +
          '</div>';
      });
    } else if (orderType === 'reservation') {
      itemsHtml = '<div style="padding:8px 0;font-size:13px;color:#6b7280;font-style:italic;">Booking meja belum membawa item menu. Menu dapat dipesan langsung saat tiba.</div>';
    }

    var orderTypeBadge = '🛵 Delivery';
    if (orderType === 'pickup') orderTypeBadge = '🛍️ Pick-up';
    if (orderType === 'dine_in') orderTypeBadge = '🍽️ Dine-in ' + (order.table_number ? '(' + order.table_number + ')' : '');
    if (orderType === 'reservation') orderTypeBadge = '📅 Reservasi (' + (order.guest_count || 2) + ' Tamu)';

    var paymentStatusText = isCash ? 'Bayar di Tempat' : onlinePayLabel(payMethod);
    if (order.payment_status === 'settlement' || order.payment_status === 'paid' || payment.payment_status === 'settlement' || payment.payment_status === 'paid') {
      paymentStatusText += ' • Lunas';
    }

    targetContainer.innerHTML =
      '<div class="x-order-status-screen" style="max-width:480px;margin:0 auto;padding-bottom:40px;background:#f8f9fa;min-height:100vh;">' +

      // 1. Status Header Card
      '  <div class="x-status-card" style="background:#fff;padding:24px 18px;margin-bottom:12px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.06);">' +
      '    <div style="width:48px;height:48px;border-radius:50%;background:#f0fdf4;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;color:#16a34a;font-size:24px;font-weight:bold;">' + badgeIcon + '</div>' +
      '    <h1 style="font-size:20px;font-weight:800;color:#111;margin:0 0 6px;">' + statusTitle + '</h1>' +
      '    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;line-height:1.4;">' + statusDesc + '</p>' +
      '    <div style="background:#f8f9fa;border-radius:14px;padding:12px 16px;display:flex;flex-direction:column;gap:8px;text-align:left;">' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Pesanan</span><strong style="color:#111;">' + UI.escape(orderNumber) + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Cabang</span><strong style="color:#111;">' + UI.escape(order.branch_name || 'Cabang Utama') + '</strong></div>' +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Tipe Layanan</span><span style="font-weight:700;color:#111;">' + orderTypeBadge + '</span></div>' +
      (orderType === 'dine_in' && order.table_number ? '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Nomor Meja</span><strong style="color:#111;">' + UI.escape(order.table_number) + '</strong></div>' : '') +
      '      <div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#6b7280;">Metode Bayar</span><span style="font-weight:700;color:#111;">' + paymentStatusText + '</span></div>' +
      '    </div>' +
      '  </div>' +

      // 2. Stepper
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 16px;color:#111;">Status Alur Pesanan</h2>' +
      '    <div style="display:flex;flex-direction:column;gap:16px;">' +
      phase.steps.map(function (stepLabel, idx) {
        var done = idx < phase.doneCount;
        return renderStep(
          idx + 1,
          stepLabel,
          idx === phase.currentPhaseIndex && phase.currentPhase && phase.currentPhase.description
            ? phase.currentPhase.description
            : 'Tahap ' + (idx + 1) + ' pada alur ' + phase.label,
          done
        );
      }).join('') +
      '    </div>' +
      '  </div>' +

      // 3. Delivery Address & Driver Info
      (orderType === 'delivery' && (delivery.address_text || delivery.destination_address)
        ? '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
          '    <h2 style="font-size:15px;font-weight:800;margin:0 0 10px;color:#111;">Alamat Pengantaran</h2>' +
          '    <div style="font-size:14px;color:#111;font-weight:600;line-height:1.4;">' + UI.escape(delivery.address_text || delivery.destination_address) + '</div>' +
          (delivery.driver_name
            ? '    <div style="margin-top:10px;padding:10px 12px;background:#f0fdf4;border-radius:10px;font-size:13px;color:#166534;">' +
              '      🛵 Kurir: <strong>' + UI.escape(delivery.driver_name) + '</strong>' +
              (delivery.driver_phone ? ' (' + UI.escape(delivery.driver_phone) + ')' : '') +
              (delivery.tracking_url ? '<div style="margin-top:6px;"><a href="' + UI.escape(delivery.tracking_url) + '" target="_blank" rel="noopener noreferrer" style="color:#16a34a;font-weight:700;text-decoration:underline;">Lacak Pengiriman Langsung →</a></div>' : '') +
              '    </div>'
            : '') +
          '</div>'
        : '') +

      // 4. Items
      '  <div style="background:#fff;padding:18px;margin:12px 14px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
      '    <h2 style="font-size:15px;font-weight:800;margin:0 0 8px;color:#111;">Rincian Pesanan</h2>' +
      itemsHtml +
      (order.order_note ? '    <div style="margin-top:12px;padding:10px 14px;background:#f9fafb;border-radius:10px;font-size:13px;color:#4b5563;border-left:3px solid var(--x-primary);"><strong style="color:#111;">Catatan Pesanan:</strong> ' + UI.escape(order.order_note) + '</div>' : '') +
      '  </div>' +

      // 5. Payment Summary
      (orderType !== 'reservation'
        ? '  <div style="background:#fff;padding:18px;margin:12px 14px 20px;box-shadow:0 4px 14px rgba(0,0,0,0.06);border-radius:16px;">' +
          '    <h2 style="font-size:15px;font-weight:800;margin:0 0 12px;color:#111;">Rincian Pembayaran</h2>' +
          '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:#6b7280;">Subtotal</span><span>' + UI.money(order.subtotal || 0) + '</span></div>' +
          (orderType === 'delivery' ? '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:#6b7280;">Biaya Pengiriman</span><span>' + UI.money(order.delivery_fee || 0) + '</span></div>' : '') +
          (Number(order.discount_amount) > 0 ? '    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;color:#ff4040;"><span>Diskon</span><span>−' + UI.money(order.discount_amount) + '</span></div>' : '') +
          '    <div style="height:1px;background:#e5e7eb;margin:10px 0;"></div>' +
          '    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;color:#111;"><span>Total Tagihan</span><span>' + UI.money(order.grand_total || order.total_amount || 0) + '</span></div>' +
          '  </div>'
        : '') +

      // 6. Action
      '  <div style="padding:0 14px;">' +
      '    <button type="button" id="x-btn-reorder" style="display:block;width:100%;height:48px;font-size:15px;font-weight:800;border:none;border-radius:24px;cursor:pointer;background:var(--x-primary);color:var(--x-primary-text);box-shadow:0 4px 12px var(--x-primary-shadow,rgba(0,0,0,0.06));">Pesan Menu Lainnya</button>' +
      '  </div>' +

      '</div>';

    var reorderBtn = document.getElementById('x-btn-reorder');
    if (reorderBtn && Router) reorderBtn.onclick = function () { Router.navigate('home'); };
  }

  function renderStep(num, title, desc, isDone) {
    var markerBg = isDone ? 'var(--x-primary)' : '#e5e7eb';
    var markerColor = isDone ? 'var(--x-primary-text, #111)' : '#9ca3af';
    var icon = isDone ? '✓' : num;
    return (
      '<div style="display:flex;align-items:flex-start;gap:12px;">' +
      '  <div style="width:28px;height:28px;border-radius:50%;background:' + markerBg + ';color:' + markerColor + ';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;margin-top:1px;">' + icon + '</div>' +
      '  <div style="flex:1;">' +
      '    <div style="font-size:14px;font-weight:700;color:#111;">' + title + '</div>' +
      '    <div style="font-size:12px;color:#6b7280;margin-top:2px;">' + desc + '</div>' +
      '  </div>' +
      '</div>'
    );
  }

  // Customer cancellation while awaiting acceptance (server-enforced gate)
  function confirmCancel(orderId) {
    if (!confirm('Yakin ingin membatalkan pesanan ini?')) return;
    API.post('/orders/' + encodeURIComponent(orderId) + '/cancel', {
      reason: 'Dibatalkan customer dari halaman menunggu konfirmasi'
    })
      .then(function () { loadOrder(orderId); })
      .catch(function (err) {
        var msg = (err && err.data && err.data.error) || (err && err.message) || 'Gagal membatalkan pesanan.';
        if (UI && UI.toast) UI.toast(msg);
      });
  }

  // ─── P7.2 Server-authoritative polling ───────────────────────────────────
  // P7.14 Stops on all terminal states.
  // P7.13 Stale responses discarded via fetchSeq.
  function schedulePolling(currentStatus, currentPayStatus, deadlineAt) {
    if (TERMINAL_STATES[currentStatus]) return;
    if (['deny', 'cancel', 'expire'].includes(currentPayStatus)) return;
    if (pollingTimer) clearInterval(pollingTimer);

    pollingTimer = setInterval(function () {
      if (!currentOrderId) return;
      var seq = ++fetchSeq;
      API.get('/orders/' + encodeURIComponent(currentOrderId))
        .then(function (data) {
          if (seq !== fetchSeq) return; // P7.13: stale — discard
          if (!data.success || !data.order) return;
          var newStatus = data.order.status;
          var newPayStatus = (data.payment && data.payment.payment_status) || data.order.payment_status || 'pending';
          var newDelStatus = (data.delivery && data.delivery.status) || null;
          var newDriverName = (data.delivery && data.delivery.driver_name) || null;

          if (newStatus !== currentStatus || newPayStatus !== currentPayStatus || newDelStatus !== lastDeliveryStatus || newDriverName !== lastDriverName) {
            stopTimers();
            renderOrder(data);
            currentStatus = newStatus;
            currentPayStatus = newPayStatus;
            if (!TERMINAL_STATES[newStatus] && !['deny', 'cancel', 'expire'].includes(newPayStatus)) {
              schedulePolling(newStatus, newPayStatus, data.order.acceptance_deadline_at);
            }
          } else if (data.delivery && trackingMapState.map) {
            updateLiveDriverPosition(data.delivery);
          }
        })
        .catch(function () {});
    }, 4000);
  }

  function unmount() {
    stopTimers();
    cleanupTrackingMap();
    targetContainer = null;
    currentOrderId = null;
    fetchSeq = 0;
  }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.OrderReceived = {
    mount: mount,
    unmount: unmount
  };
})();
