# XENTRA MAP OPTIMIZATION — PHASE 0 AUDIT & BASELINE REPORT

**Audit Date:** 2026-09-18  
**Environment:** Xentra VPS Production Environment  
**Status:** Baseline Completed  

---

## 1. CURRENT STATE

* **VPS Directory:** `/home/ubuntu/xentra-core`
* **VPS Branch:** `main`
* **Commit:** `c97e7e38f734cdfe01167acc523830e07cbe8f23` (`fix(marketing): standardize empty state button labels and banner action cell alignment`)
* **Git Status:**
  ```text
  On branch main
  Your branch is up to date with 'origin/main'.
  Changes not staged for commit:
    modified:   apps/customer-pwa/assets/js/core/store.js
    modified:   apps/customer-pwa/assets/js/pages/checkout.js
    modified:   apps/merchant-dashboard/assets/css/dashboard.css
    modified:   apps/merchant-dashboard/assets/js/dashboard.js
    modified:   apps/merchant-dashboard/index.html
    modified:   server/database/db.js
    modified:   server/routes/api.js
    modified:   tests/customerAuth.test.js
  ```
* **Runtime & Process:**
  * Node.js: `v24.21.0` (active system binary), PM2 `v7.0.4` God Daemon
  * PM2 Process: id `0`, name `xentra-core`, status `online` (PID 519377 running `/home/ubuntu/xentra-core/server/app.js`)
* **Map Engine & Libraries:**
  * Frontend Map Engine: Mapbox GL JS `v3.4.0` dynamically injected (`https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js`) with an internal fallback interactive canvas tile renderer (OpenStreetMap tile endpoint).
  * Frontend Map Style: `mapbox://styles/mapbox/streets-v12`
  * Backend Geocoding & Routing: Mapbox Geocoding v6 (`https://api.mapbox.com/search/geocode/v6/reverse`), Mapbox Search Box v1 (`https://api.mapbox.com/search/searchbox/v1/suggest`, `/retrieve`, `/category`), Nominatim OSM (`https://nominatim.openstreetmap.org`), and OSRM driving router (`https://router.project-osrm.org/route/v1/driving`).

---

## 2. ACTUAL LOCATION FLOW

The complete call chain from user trigger to Active Destination was traced across `location-picker.js`, `location.js`, `store.js`, `api.js`, and `RouteService.js`:

### A. GPS Flow
1. User clicks "Lokasimu saat ini" on the bottom sheet or the floating GPS button on the map.
2. Handled by `triggerGpsFlow()` in `location-picker.js`:
   * Options: `{ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }` (also mirrors `XentraLocation.getCurrentPosition()` in `location.js`).
   * GPS coordinates (`lat`, `lng`, `accuracy`) are received.
3. Backend reverse geocode is requested via `GET /api/v1/delivery/reverse-geocode?lat=...&lng=...`.
4. The result does **not** directly overwrite the destination; instead, it opens the Detail Alamat sheet with `isFavorite: false` and `source: 'gps'`.
5. When confirmed by the customer, `applyActiveDestination()` sets `Store.setActiveDestination({ source: 'gps', is_explicit: false, ... })`.
6. **Background GPS Invariant Protection:** In `location.js`, `XentraLocation.canUpdateFromGps()` explicitly locks out background updates if `currentDestination.is_explicit === true` or if `source` is `['search', 'map', 'favorite']`.

### B. Search Flow
1. **Flow A (Standalone Search Sheet):**
   * Triggered in `openSearchFlow()`.
   * Input event debounced by 350ms with sequential ID check (`searchSeq`).
   * Queries backend `GET /api/v1/location/search?q=...` which proxies Nominatim (`https://nominatim.openstreetmap.org/search`) with Indonesian country filter (`countrycodes=id&limit=15`) and optional proximity viewbox.
   * User selection opens Detail Alamat sheet with `source: 'search'`, `is_explicit: true`.
2. **Flow C (Map Header Autocomplete):**
   * Triggered inside `openMapPickerFlow()`.
   * Debounced by 300ms.
   * Directly calls client-side Mapbox Search Box API (`/suggest?q=...&proximity=...&country=id&limit=8&session_token=...`).
   * When chosen, calls Mapbox Search Box `/retrieve/:mapbox_id` to acquire exact `coordinates [lng, lat]`, flies the map camera to the target, sets `isProgrammaticMove = true`, and sets `setSelectedLocation()` without triggering an unneeded reverse geocode.
   * Falls back to `GET /api/v1/location/search` if Mapbox token is absent or request fails.

### C. Map Picker Flow
1. User taps "Pilih lewat peta" or clicks "Ubah" on the location bar.
2. `openMapPickerFlow()` launches full-viewport interactive view:
   * Dynamically loads Mapbox GL JS `v3.4.0` (or falls back to canvas tiles).
   * Initial center: current `Store.getActiveDestination()` coordinates or default Bandar Lampung / Pringsewu (`-5.3971, 105.2668`).
   * Center Pin: `<div class="x-map-center-pin-wrap">` with fixed CSS placement at the exact geometric center of `#x-map-viewport`.
   * Mapbox events: `move` tracks center coordinates; `moveend` triggers after drag/pan stops.
   * Programmatic movements (`flyTo` on search selection or POI tap) set `isProgrammaticMove = true`, preventing camera repositioning from wiping already resolved place titles.
   * Manual movement `moveend` waits 250ms, then invokes `updateLocationDetailsFromCoords()` which calls `GET /api/v1/delivery/reverse-geocode?lat=...&lng=...`.
   * User taps "Konfirmasi", opening Detail Alamat sheet (`openAddressDetailSheet()`) where user can inspect the address, add label and patokan/notes, and optionally save as a favorite.

---

## 3. CURRENT MAPBOX IMPLEMENTATION

| API / Endpoint | Location in Code | Active Status | Purpose |
| :--- | :--- | :--- | :--- |
| **Mapbox GL JS v3.4.0** | `location-picker.js` | **Currently Implemented** | Interactive mobile map rendering, pan/pinch, camera flyTo, custom DOM markers. |
| **Mapbox Streets Style** | `location-picker.js` (`mapbox://styles/mapbox/streets-v12`) | **Currently Implemented** | Vector tile style with Indonesian road network. |
| **Search Box API `suggest`** | `location-picker.js` (`api.mapbox.com/search/searchbox/v1/suggest`) | **Currently Implemented** | Client-side forward geocoding & POI autocomplete on map search bar. |
| **Search Box API `retrieve`** | `location-picker.js` (`api.mapbox.com/search/searchbox/v1/retrieve`) | **Currently Implemented** | Resolving selected suggest item mapbox_id to exact coordinates. |
| **Search Box API `category`** | `location-picker.js` (`api.mapbox.com/search/searchbox/v1/category/food_and_drink`) | **Currently Implemented** | Discovering nearby restaurant & food POIs to render interactive badges on map. |
| **Geocoding v6 `reverse`** | `RouteService.js` (`api.mapbox.com/search/geocode/v6/reverse`) | **Currently Implemented** | Server-side reverse geocoding of coordinates into Indonesian place/road names. |
| **Search Box API `reverse`** | *None* | **Available but unused** | Rich POI + address reverse geocoding (`api.mapbox.com/search/searchbox/v1/reverse?types=poi,address,street`). |
| **Geocoding v6 structured reverse hierarchy** | *None* | **Available but unused** | Querying reverse with specific granular `types` prioritization. |

---

## 4. REVERSE GEOCODING ANALYSIS

The reverse geocode pipeline operates as follows:
1. Client requests `GET /api/v1/delivery/reverse-geocode?lat=...&lng=...`
2. Handled by `RouteService.reverseGeocode(lat, lon)`:
   * Calls `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lon}&latitude=${lat}&access_token=${token}&limit=1`
   * Inspects `feat = mboxRes.data.features[0]`.
   * Non-addressable types filter: `NON_ADDRESSABLE = ['postcode', 'country', 'region', 'district']`.
   * Road extraction:
     ```javascript
     const road = (!isNonAddressable && (props.feature_type === 'street' || props.feature_type === 'address')) ? (props.name || '') : '';
     const neighborhood = (ctx.neighborhood && ctx.neighborhood.name) || (!isNonAddressable && props.feature_type === 'neighborhood' ? props.name : '');
     const locality = (ctx.locality && ctx.locality.name) || (!isNonAddressable && props.feature_type === 'locality' ? props.name : '');
     const city = (ctx.place && ctx.place.name) || (ctx.region && ctx.region.name) || '';
     ```
   * Result returned:
     ```javascript
     return {
       address: full || name,
       display_name: full || name,
       road: road || neighborhood || (isNonAddressable ? '' : name),
       neighborhood: neighborhood,
       locality: locality,
       city: city
     };
     ```
   * If Mapbox request fails or throws, it falls back to Nominatim OSM reverse (`https://nominatim.openstreetmap.org/reverse?format=json&lat=...&lon=...`).
3. Client frontend display parser in `location-picker.js`:
   * Inspects `res.road`, `res.neighborhood`, `res.locality`, `res.city`.
   * Sets `title = (road || neighborhood).trim()`.
   * Sets `addr = [neighborhood !== road ? neighborhood : '', locality, city].filter(Boolean).join(', ')`.

---

## 5. KECAMATAN FALLBACK ANALYSIS

**Observed Product Problem:**
«When selecting a location on the map, the resulting displayed location can fall back to a kecamatan/district/administrative area instead of a nearby usable address, street, POI, or landmark.»

**Direct Code & Network Evidence:**
1. **Single Result Constraint (`&limit=1`):**
   * In `RouteService.js`:
     `const mboxUrl = 'https://api.mapbox.com/search/geocode/v6/reverse?...&limit=1';`
   * In Mapbox Geocoding v6, when `limit=1` is passed without feature type restrictions, Mapbox's spatial hierarchy indexes return the broadest administrative polygon containing the point (such as `neighborhood`, `locality`, or `district` representing Kelurahan or Kecamatan) whenever a pinpoint address or exact road centerline is not within a few meters of the pin.
2. **Feature Type Behavior in Indonesian Regional Areas (e.g. Lampung, Pringsewu, suburban areas):**
   * Live probe at Pringsewu `-5.3582, 104.9754`:
     Mapbox Geocoding v6 returns `feature_type: "neighborhood"` with `name: "Pringsewu Timur"`.
     Because `props.feature_type === 'neighborhood'`, `road` is empty, but `neighborhood` is set to `"Pringsewu Timur"`.
   * In `RouteService.js`:
     `road: road || neighborhood || (isNonAddressable ? '' : name)`
     This evaluates directly to `"Pringsewu Timur"`.
   * In `location-picker.js`:
     `title = (road || neighborhood).trim();`
     `addr = [neighborhood !== road ? neighborhood : '', locality, city].filter(Boolean).join(', ');`
     This causes both title and card to display `"Pringsewu Timur, Pringsewu, Pringsewu"`.
3. **Absence of POI Discovery in Reverse Geocode:**
   * Live verification comparing Mapbox Geocoding v6 vs Mapbox Search Box Reverse at `-5.3621, 104.9812` (Pringsewu):
     * **Geocoding v6 (current RouteService):** Returns 1 result: `feature_type: "neighborhood"`, `name: "Pringsewu Timur"`. Zero POIs or streets detected.
     * **Search Box Reverse (`/search/searchbox/v1/reverse?types=poi,address,street`):** Returns 5 immediate, granular Indonesian POIs and streets:
       1. `poi`: "MU STATIONERY" (Jl. Melati 3, Pringsewu)
       2. `poi`: "Anak Lanang Matrial"
       3. `poi`: "Brilink Ravi" (Jl. Melati 3, Pringsewu)
       4. `poi`: "Bestea Aura" (Jl. Melati 3, Pringsewu)
       5. `poi`: "BAKSO & MIE AYAM NEABIL" (Jl. Melati 3, Pringsewu)
4. **Summary Findings on Root Cause:**
   * **Observation:** The backend reverse geocode accepts the very first single feature from Geocoding v6 (`limit=1`) without requesting candidate POIs or prioritizing street/address types.
   * **Evidence:** `RouteService.js` and live network response data.
   * **Actual Behavior:** Returns the enclosing administrative polygon (Kecamatan / Kelurahan / Neighborhood).
   * **Expected Behavior:** High-confidence street name, house number, or nearest prominent POI/landmark (similar to Google Maps / Gojek).
   * **Confidence:** 100% (proven by direct source audit and live API verification).

---

## 6. DESTINATION MODEL

The canonical destination object representation across `store.js`, `location.js`, and database persistence:

```javascript
{
  latitude: Number,        // Destination latitude (-90 to +90)
  longitude: Number,       // Destination longitude (-180 to +180)
  address: String,         // Full formatted address string
  label: String,           // Human-readable title (e.g., "Rumah", "Kantor", "MU STATIONERY")
  detail: String,          // Benchmark / patokan / delivery instruction
  source: String,          // 'gps' | 'search' | 'map' | 'favorite' | 'manual'
  is_explicit: Boolean,    // true if chosen deliberately by user; false if passive GPS
  favorite_id: String|null,// UUID/ID if backed by a saved customer_addresses entry
  updated_at: String       // ISO timestamp
}
```

* **Persistence:**
  * Guest user: Stored in browser `localStorage.getItem('xentra_active_destination')`.
  * Authenticated user: Synchronized in `customer_addresses` table (`id`, `brand_id`, `customer_phone`, `label`, `address`, `detail`, `latitude`, `longitude`, `is_primary`) when "Simpan sebagai favorit" is checked.
* **Order Freezing:** When checkout submits an order, the destination coordinates and address are copied verbatim into `order_deliveries` (`order_id`, `destination_address`, `destination_latitude`, `destination_longitude`). Changes to favorite addresses or runtime destination never mutate historical order records.
* **Coordinate Consistency:** The exact same destination coordinate pair (`latitude`, `longitude`) is passed to:
  1. Frontend map UI
  2. Address Book persistence
  3. BranchMatcher delivery eligibility calculation
  4. OSRM road distance routing

---

## 7. BRANCH MATCHING BOUNDARY

The system maintains a clear architectural boundary between **Location Resolution** and **Branch Fulfillment**:

```
[Customer Location Sources: GPS / Search / Map Picker]
                        │
                        ▼
            [Active Destination Model]
      { latitude, longitude, address, label, detail }
                        │
                        ▼ (POST /api/v1/delivery/match-branch)
              [BranchMatcher.js]
                        │
       ┌────────────────┴────────────────┐
       ▼                                 ▼
1. Geographic Pre-filter          2. Cart Eligibility
   (Haversine straight-line          (EligibilityService: verifies all items
    <= max_radius * 1.5)              exist & are active at candidate branch)
       │                                 │
       └────────────────┬────────────────┘
                        ▼
              3. Road Routing (RouteService.getRoadDistance)
                 (OSRM driving route distance & duration)
                        │
                        ▼
              4. Fee & Radius Validation (DeliveryCalculator)
                 (distance <= branch.max_radius_km)
                        │
                        ▼
              5. Authoritative Fulfillment Branch Winner
                 (Nearest road distance; tie broken by branch ID)
```

* Location resolution does not know or care which branch serves the location.
* BranchMatcher consumes `customer_lat` and `customer_lng` strictly as read-only parameters to evaluate branch delivery zones and fees.
* Changing or improving reverse geocoding will not alter branch fulfillment rules.

---

## 8. EXISTING REGRESSION COVERAGE

Existing automated tests relevant to location and routing:

1. **`tests/services/routeServiceReverseGeocode.test.js`** (100% PASS):
   * Postcode feature never leaks as road title (regression guard for bug where "60225" was shown as street name).
   * Bare postcode feature with no context resolves to empty road.
   * Street feature preserves road name.
   * Country/region features never leak into road title.
2. **`tests/domains/locationAddress.test.js`**:
   * Distinct source builders (`GPS`, `Search`, `Map`, `Favorite`).
   * Guest customer active destination persistence without authentication.
   * **Inviolable invariant:** Background GPS must NOT silently overwrite an explicitly selected Active Destination.
   * Selecting Favorite Address promotes it to Active Destination.
   * Cart isolation: Changing Active Destination does not empty cart or mutate item provenance.
3. **`tests/domains/branchMatching.test.js`**:
   * Fail-safe rejection of invalid coordinates (no fabricated fallback points).
   * Road distance ranks over straight-line Haversine distance.
   * Full-cart matching requirement: branches missing cart items are excluded.
   * Read-only guarantee: branch matching never mutates stock, inventory, or orders.

---

## 9. NOTION / GIT / VPS CONSISTENCY

* **Aligned:**
  * **Core Invariant:** `Buyer Location ≠ Delivery Destination ≠ Fulfillment Branch` is strictly enforced in code.
  * **Explicit Destination Protection:** `canUpdateFromGps()` blocks passive GPS from overwriting user selections.
  * **Guest vs Authenticated Separation:** Guest users can place orders with temporary Active Destination without being forced to register an address book.
  * **Frozen Delivery History:** Order delivery snapshots in `order_deliveries` remain frozen.
* **Not Aligned:**
  * **Address Search Endpoint:** Notion / architecture blueprint discusses Mapbox Search Box with session-based suggest/retrieve, whereas the standalone search sheet currently queries `/location/search` (which proxies Nominatim OSM). The Map Picker header search uses client-side Mapbox Search Box, creating a slight duality between standalone search and map search.
  * **Reverse Geocoding Quality:** Notion specifies high-fidelity address resolution matching Gojek/Google Maps standards. The current single-result Mapbox Geocoding v6 (`&limit=1`) falls back to Kecamatan/Neighborhood in suburban and regional locations due to lack of candidate POI extraction.
* **Unknown / Deferred:**
  * Any server-side session caching for Mapbox Search Box token metering across multiple keystrokes (currently generated client-side per search session).

---

## 10. OPTIMIZATION GAPS

| Level | Issue | Impact | Area |
| :--- | :--- | :--- | :--- |
| **P0 — Correctness** | **Geocoding v6 `limit=1` Administrative Dominance:** Without candidate types or limit expansion, regional coordinates return broad kecamatan/kelurahan polygons instead of street names or landmarks. | Customer receives broad administrative district (e.g. "Pringsewu Timur") instead of the street or venue. | `RouteService.js` |
| **P1 — UX / Quality** | **Missing POI Reverse Geocoding in Server Pipeline:** Mapbox Search Box Reverse supports POIs (`types=poi,address,street`), while Geocoding v6 reverse does not return business POIs. | Destination pin cannot identify nearby shops, cafes, or landmarks for delivery drivers. | `RouteService.js` / `location-picker.js` |
| **P1 — UX / Quality** | **Dual Search Providers:** Standalone search uses Nominatim via backend `/location/search`, while map picker uses Mapbox Search Box. | Search quality and ranking differ depending on which UI button the user pressed. | `location-picker.js` |
| **P2 — Optimization** | **Reverse Geocode Debounce & Race Conditioning:** Rapid pan/zoom on mobile triggers multiple API calls; although sequential IDs discard stale UI text, in-flight HTTP requests consume bandwidth and quota. | Unnecessary network requests and potential transient loading flicker. | `location-picker.js` |
| **P2 — Optimization** | **Missing Coordinate Distance Sanity Check:** If user drags pin a few centimeters, geocoder re-evaluates even if distance is under 3 meters. | Excessive API invocations during micro-adjustments. | `location-picker.js` |
| **P3 — Cleanup** | **Token Exposure in Frontend Source:** Mapbox public token is embedded in frontend JS (`MAPBOX_TOKEN`). Mapbox public tokens are meant to be public, but URL domain restrictions should be configured on the Mapbox account dashboard. | Token safety and usage control. | `location-picker.js` |

---

## 11. PROPOSED PHASE 1 PLAN (SCOPED & INCREMENTAL)

Phase 1 should focus exclusively on resolving the **Kecamatan Fallback** issue and elevating reverse geocode accuracy without destabilizing the application:

1. **Phase 1.1: Server-Side Reverse Geocode Multi-Candidate Hierarchy**
   * Update `RouteService.js`:
     * Integrate Mapbox Search Box Reverse API (`/search/searchbox/v1/reverse?types=poi,address,street`) as the primary reverse geocoding resolver when token is present.
     * Maintain Geocoding v6 as secondary fallback with proper feature extraction.
     * Retain Nominatim as final tertiary fallback.
   * Classify candidates: POI > Address > Street > Neighborhood. District/Region/Postcode used solely as context, never as road/title.
2. **Phase 1.2: Frontend Location Parser Standardization**
   * Ensure `location-picker.js` consumes the structured title, subtitle, and patokan fields cleanly without falling back to raw administrative strings when a POI or street is available.
3. **Phase 1.3: Verification & Regression Shield**
   * Expand `tests/services/routeServiceReverseGeocode.test.js` to assert that suburban/regional coordinates (Pringsewu, Bandar Lampung, Surabaya suburbs) resolve to street/POI names rather than administrative kecamatan.

---

## 12. FILES / COMPONENTS TO TOUCH (IN PHASE 1)

* `server/services/RouteService.js` — *should be inspected / likely relevant* (reverse geocoding candidate querying and normalization).
* `apps/customer-pwa/assets/js/core/location-picker.js` — *should be inspected / likely relevant* (reverse geocoding result handling and map pin movement debouncing).
* `tests/services/routeServiceReverseGeocode.test.js` — *should be inspected / likely relevant* (adding regression test cases for POI prioritization and kecamatan suppression).
