/**
 * XENTRA CORE — LOCATION & DELIVERY ROUTES
 *
 * Branch matching and address lookup adapters. Domain/service logic remains in
 * BranchMatcher and RouteService; this module only owns HTTP transport.
 */
module.exports = function registerLocationRoutes(router, deps) {
  const { BranchMatcher, RouteService } = deps;

// 3. Match Nearest Eligible Branch
router.post('/delivery/match-branch', async (req, res) => {
  try {
    const { latitude, longitude, subtotal = 0, items } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        error: 'Parameter latitude dan longitude wajib dikirim.'
      });
    }

    // C4.2: when a cart is provided the match is a FULL-CART match — the
    // matcher (via canonical EligibilityService) only ever selects a branch
    // able to satisfy the COMPLETE cart, and fails closed otherwise. Items were
    // previously dropped silently on this route; an explicitly provided
    // non-array is rejected instead of being ignored.
    if (items !== undefined && !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: 'Parameter items harus berupa array.'
      });
    }

    const match = await BranchMatcher.matchNearestBranch({
      brand_id: req.brand_id,
      customer_lat: Number(latitude),
      customer_lng: Number(longitude),
      subtotal: Number(subtotal),
      items: Array.isArray(items) ? items : undefined
    });

    res.json({
      success: true,
      ...match
    });
  } catch (err) {
    console.error('[API] match-branch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Address Search Suggestion (Mapbox Search Box Suggest with Nominatim fallback)
router.get('/location/search', async (req, res) => {
  const q = req.query.q || '';
  const lat = req.query.lat || req.query.latitude;
  const lng = req.query.lng || req.query.longitude;
  const sessionToken = req.query.session_token;
  const results = await RouteService.searchAddress(q, lat, lng, sessionToken);
  res.json({ success: true, results });
});

// 4.0.1 Address Search Retrieve (Fetch canonical coordinates & details for selected mapbox_id)
router.get('/location/retrieve', async (req, res) => {
  const mapboxId = req.query.mapbox_id || req.query.id;
  const sessionToken = req.query.session_token;
  if (!mapboxId) {
    return res.status(400).json({ success: false, error: 'mapbox_id wajib dikirim' });
  }
  const result = await RouteService.retrieveAddress(mapboxId, sessionToken);
  if (!result) {
    return res.status(404).json({ success: false, error: 'Lokasi tidak ditemukan' });
  }
  res.json({ success: true, result });
});

// 4.1 Reverse Geocode (Coordinates -> Address Text)
router.get(['/delivery/reverse-geocode', '/address/reverse'], async (req, res) => {
  try {
    const lat = req.query.lat || req.query.latitude;
    const lng = req.query.lng || req.query.longitude;
    const result = await RouteService.reverseGeocode(lat, lng);
    res.json({
      success: true,
      address: {
        formatted_address: result.address,
        display_name: result.display_name,
        latitude: Number(lat),
        longitude: Number(lng)
      },
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


};
