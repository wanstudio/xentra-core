const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('DRIVER-NAV-01: Driver delivery screen uses real browser GPS and Mapbox GL', () => {
  const ui = read('apps/driver-app/assets/js/driver-app.js');

  assert.match(ui, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(ui, /navigator\.geolocation\.watchPosition/);
  assert.match(ui, /navigator\.geolocation\.clearWatch/);
  assert.match(ui, /mapbox-gl-js\/v' \+ MAPBOX_VERSION \+ '\/mapbox-gl\.js/);
  assert.match(ui, /mapbox-gl-js\/v' \+ MAPBOX_VERSION \+ '\/mapbox-gl\.css/);
  assert.match(ui, /window\.mapboxgl\.accessToken = MAPBOX_TOKEN/);
  assert.match(ui, /new window\.mapboxgl\.Map/);
  assert.match(ui, /new window\.mapboxgl\.Marker\(\{ color: '#1463ff' \}\)/);
  assert.match(ui, /new window\.mapboxgl\.Marker\(\{ color: '#e5484d' \}\)/);
});

test('DRIVER-NAV-02: Route is calculated from current Driver GPS to authoritative order destination via OSRM', () => {
  const ui = read('apps/driver-app/assets/js/driver-app.js');

  assert.match(ui, /destination\.latitude/);
  assert.match(ui, /destination\.longitude/);
  assert.match(ui, /router\.project-osrm\.org\/route\/v1\/driving\//);
  assert.match(ui, /overview=full&geometries=geojson&steps=true/);
  assert.match(ui, /route\.distance/);
  assert.match(ui, /route\.duration/);
  assert.match(ui, /route\.geometry/);
});

test('DRIVER-NAV-03: Delivery map no longer ships the previous fake map route/pins', () => {
  const ui = read('apps/driver-app/assets/js/driver-app.js');

  assert.doesNotMatch(ui, /<div class="map-grid"><\/div>/);
  assert.doesNotMatch(ui, /<div class="route"><\/div>/);
  assert.doesNotMatch(ui, /<div class="map-pin a">A<\/div>/);
  assert.doesNotMatch(ui, /<div class="map-pin b">B<\/div>/);
  assert.match(ui, /id="driver-map" class="driver-map"/);
});

test('DRIVER-NAV-04: Map fallback keeps external navigation available when GPS/map routing is unavailable', () => {
  const ui = read('apps/driver-app/assets/js/driver-app.js');

  assert.match(ui, /Gunakan navigasi eksternal/);
  assert.match(ui, /https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
});

test('DRIVER-NAV-05: GPS failure states (permission denied, timeout, unavailable, and stale watch) are handled gracefully', () => {
  const ui = read('apps/driver-app/assets/js/driver-app.js');

  // Permission denied (code 1)
  assert.match(ui, /error\.code === 1/);
  assert.match(ui, /Izin lokasi ditolak/);

  // Timeout (code 3)
  assert.match(ui, /error\.code === 3/);
  assert.match(ui, /GPS terlalu lama merespons/);

  // Unavailable / unsupported
  assert.match(ui, /GPS tidak didukung perangkat ini/);
  assert.match(ui, /Lokasi GPS belum tersedia/);

  // Watch stopped after initial position
  assert.match(ui, /GPS berhenti memperbarui/);
});

test('DRIVER-NAV-06: Destination coordinate validation handles missing or non-finite latitude/longitude', () => {
  const ui = read('apps/driver-app/assets/js/driver-app.js');

  assert.match(ui, /function destinationCoordinates\(task\)/);
  assert.match(ui, /Number\.isFinite\(lat\)/);
  assert.match(ui, /Number\.isFinite\(lng\)/);
  assert.match(ui, /Koordinat tujuan belum tersedia/);
});

test('DRIVER-NAV-07: OSRM failure handling covers HTTP error, non-Ok code, empty routes, and error messaging', () => {
  const ui = read('apps/driver-app/assets/js/driver-app.js');

  assert.match(ui, /!response\.ok/);
  assert.match(ui, /data\.code === 'Ok'/);
  assert.match(ui, /!route\.geometry/);
  assert.match(ui, /Rute gagal dihitung\. Gunakan navigasi eksternal\./);
  assert.match(ui, /Rute peta tidak tersedia saat ini\./);
});

test('DRIVER-NAV-08: routeRequestId isolates stale async responses and cleanupDriverMap cleans up watcher and map', () => {
  const ui = read('apps/driver-app/assets/js/driver-app.js');

  // Route request ID increment and stale checks
  assert.match(ui, /var requestId = \+\+mapState\.routeRequestId;/);
  assert.match(ui, /requestId !== mapState\.routeRequestId/);
  assert.match(ui, /state\.page !== 'map'/);

  // Map cleanup and clearWatch
  assert.match(ui, /function cleanupDriverMap\(\)/);
  assert.match(ui, /navigator\.geolocation\.clearWatch\(mapState\.watchId\)/);
  assert.match(ui, /mapState\.routeRequestId \+= 1;/);
  assert.match(ui, /mapState\.map\.remove\(\)/);
  assert.match(ui, /mapState\.watchId = null;/);
  assert.match(ui, /mapState\.currentPosition = null;/);
});

