const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const RoutePersistenceRepository = require('../../core/data/repositories/RoutePersistenceRepository');
const db = new RoutePersistenceRepository();
const BranchMatcher = require('../services/BranchMatcher');
const DeliveryCalculator = require('../services/DeliveryCalculator');
const PaymentService = require('../services/PaymentService');
const OrderStateMachine = require('../services/OrderStateMachine');
const AcceptanceTimeoutService = require('../services/AcceptanceTimeoutService');
const RouteService = require('../services/RouteService');
const { PromotionEngineService } = require('../../domains/promotion');
const { InventoryStockService, InventoryMovementModel } = require('../../domains/inventory');
const CatalogService = require('../../domains/commerce/services/CatalogService');
const PricingPolicyModel = require('../../domains/commerce/models/PricingPolicyModel');
const { XentraConnectorClient, XentraConnectorError } = require('../../core/integration/XentraConnectorClient');
const { ImageValidator } = require('../../core/domain');
const { MediaService } = require('../../core/media');
const { BannerContentService, BannerAssignmentService } = require('../../domains/banner');
const mediaService = new MediaService();
const bannerContentService = new BannerContentService({ media: mediaService });
const bannerAssignmentService = new BannerAssignmentService();

// 0. Active Promotions & Evaluation Endpoint
router.get(['/promo/active', '/promotions/active'], (req, res) => {
  try {
    const brandId = req.brand.id;
    const isPwa = req.query.is_pwa === '1' || req.query.is_pwa === 'true';
    const phone = req.query.phone || '';
    const branchId = req.query.branch_id || req.query.branchId || null;

    const evaluation = PromotionEngineService.evaluate({
      brand_id: brandId,
      branch_id: branchId,
      is_pwa_installed: isPwa,
      customer_phone: phone
    });

    res.json({
      success: true,
      promotions: evaluation.discovery,
      applied: evaluation.applied,
      rejected: evaluation.rejected
    });
  } catch (err) {
    console.error('[API Error /promo/active]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1. Get Brand Profile & Theme
function resolveCustomerBannerPayload(req, brandId) {
  const legacy = parseLegacyBrandBanners(req.brand);
  const requestedBranchId = req.query.branch_id || req.query.branchId || null;

  if (!requestedBranchId) {
    return legacy.map(b => resolveBannerDelivery(b, brandId));
  }

  const branch = db.prepare(`
    SELECT id, timezone
    FROM branches
    WHERE id = ?
      AND brand_id = ?
      AND is_active = 1
      AND (is_archived = 0 OR is_archived IS NULL)
    LIMIT 1
  `).get(String(requestedBranchId), brandId);

  if (!branch) {
    return legacy.map(b => resolveBannerDelivery(b, brandId));
  }

  // Explicit reconciliation rule:
  // legacy Brand banners remain the fallback until the Branch has at least one
  // new Banner Assignment. Once the Branch uses the new assignment system, that
  // system becomes authoritative for the Branch, including the intentional
  // zero-visible-banner case (all paused/future/ended).
  const assignmentCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM storefront_banner_assignments
    WHERE brand_id = ? AND branch_id = ?
  `).get(brandId, branch.id);

  if (!assignmentCount || Number(assignmentCount.count || 0) === 0) {
    return legacy.map(b => resolveBannerDelivery(b, brandId));
  }

  const resolved = bannerAssignmentService.listCustomerBanners({
    brandId,
    branchId: branch.id
  });

  return resolved.map(banner => {
    const delivery = bannerMediaDelivery(brandId, banner.media_id);
    return {
      id: banner.id,
      assignment_id: banner.assignment_id,
      branch_id: banner.branch_id,
      placement: banner.placement,
      position: banner.position,
      active: banner.active,
      starts_at: banner.starts_at,
      ends_at: banner.ends_at,
      timezone: banner.timezone || branch.timezone || 'Asia/Jakarta',
      publication_status: banner.publication_status,
      effective_status: banner.effective_status,
      title: banner.title,
      alt_text: banner.alt_text,
      media_id: banner.media_id,
      preview_url: delivery.preview_url,
      srcset_variants: delivery.srcset_variants,
      cta_type: banner.cta_type,
      cta_target_id: banner.cta_target_id,
      cta_url: banner.cta_url,
      promotion_id: banner.promotion_id,
      link: banner.cta_type === 'URL' ? banner.cta_url : '#'
    };
  });
}

router.get('/brand/info', (req, res) => {
  try {
    const brandId = req.brand_id;

    // M6: Resolve canonical media delivery for logo (logo_media_id → derivative)
    let logoDeliveryUrl = req.brand.logo_url || null;
    try {
      // P1.3: tenantResolver already resolved this brand row with `SELECT *`, so the
      // logo_media_id is present on req.brand. Reuse it instead of re-reading the
      // same row (removes one query from the Home critical path); only fall back to
      // the authoritative query when the property is genuinely absent.
      const logoMediaId = Object.prototype.hasOwnProperty.call(req.brand, 'logo_media_id')
        ? req.brand.logo_media_id
        : (db.prepare('SELECT logo_media_id FROM brands WHERE id = ?').get(brandId) || {}).logo_media_id;
      if (logoMediaId) {
        const logoDelivery = resolveCustomerMediaDelivery({
          mediaId: logoMediaId,
          brandId,
          assetType: 'square',
          legacyUrl: req.brand.logo_url || null
        });
        if (logoDelivery.preview_url) logoDeliveryUrl = logoDelivery.preview_url;
      }
    } catch (_) {}

    const enrichedBanners = resolveCustomerBannerPayload(req, brandId);

    res.json({
      success: true,
      brand: {
        id: req.brand.id,
        name: req.brand.name,
        slug: req.brand.slug,
        logo_url: logoDeliveryUrl,
        primary_color: req.brand.primary_color || '#b6ff00',
        banners: enrichedBanners
      }
    });
  } catch (err) {
    console.error('[API Error /brand/info]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// 2. List Branches for Brand
router.get('/brand/branches', (req, res) => {
  try {
    const branches = db
      .prepare(`
        SELECT 
          b.id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone,
          b.is_active, b.is_open_override, b.timezone, b.reservation_max_guests,
          s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km,
          s.promo_delivery_discount, s.promo_min_order
        FROM branches b
        LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
        WHERE b.brand_id = ? AND b.is_active = 1 AND (b.is_archived = 0 OR b.is_archived IS NULL)
      `)
      .all(req.brand_id);

    res.json({
      success: true,
      branches
    });
  } catch (err) {
    console.error('[API Error /brand/branches]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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

// 4.2 Real Auth OTP Challenge & Verification Store (In-Memory with TTL & Max Attempts)
const OtpChallengeStore = {
  challenges: new Map(),
  rateLimits: new Map(), // key: brandId:phone -> lastSentTimestamp
  
  checkRateLimit(phone, brandId, minIntervalSeconds = 60) {
    if (process.env.NODE_ENV === 'test' && !process.env.TEST_OTP_RATE_LIMIT && !phone.endsWith('109')) {
      return { allowed: true, retryAfter: 0 };
    }
    const key = `${brandId}:${phone}`;
    const lastSent = this.rateLimits.get(key);
    if (lastSent) {
      const elapsedSeconds = Math.floor((Date.now() - lastSent) / 1000);
      if (elapsedSeconds < minIntervalSeconds) {
        return {
          allowed: false,
          retryAfter: minIntervalSeconds - elapsedSeconds
        };
      }
    }
    return { allowed: true, retryAfter: 0 };
  },

  createChallenge(phone, brandId, otpCode, ttlSeconds = 300) {
    const challengeId = 'chk_' + crypto.randomBytes(16).toString('hex');
    const otpHash = crypto.createHash('sha256').update(String(otpCode).trim()).digest('hex');
    const expiresAt = Date.now() + ttlSeconds * 1000;

    // Record rate limit timestamp
    this.rateLimits.set(`${brandId}:${phone}`, Date.now());

    this.challenges.set(challengeId, {
      phone,
      otpHash,
      expiresAt,
      attempts: 0,
      verified: false,
      brandId
    });
    return { challengeId, expiresAt };
  },
  verifyOtp(challengeId, otpCode, phone, brandId) {
    if (!challengeId || !this.challenges.has(challengeId)) {
      return { success: false, error: 'CHALLENGE_NOT_FOUND', message: 'Challenge OTP tidak ditemukan atau telah kedaluwarsa.' };
    }
    const record = this.challenges.get(challengeId);
    if (Date.now() > record.expiresAt) {
      this.challenges.delete(challengeId);
      return { success: false, error: 'OTP_EXPIRED', message: 'Kode OTP telah kedaluwarsa. Silakan minta kode baru.' };
    }
    if (record.brandId !== brandId) {
      return { success: false, error: 'TENANT_MISMATCH', message: 'Challenge OTP tidak valid untuk tenant ini.' };
    }
    if (phone && record.phone !== phone) {
      return { success: false, error: 'PHONE_MISMATCH', message: 'Nomor telepon tidak cocok dengan permintaan OTP.' };
    }
    if (record.attempts >= 3) {
      this.challenges.delete(challengeId);
      return { success: false, error: 'MAX_ATTEMPTS_EXCEEDED', message: 'Batas percobaan OTP terlampaui. Silakan minta kode baru.' };
    }

    record.attempts += 1;
    const inputHash = crypto.createHash('sha256').update(String(otpCode).trim()).digest('hex');
    if (inputHash !== record.otpHash) {
      return { success: false, error: 'INVALID_OTP', message: 'Kode OTP yang Anda masukkan salah.' };
    }

    record.verified = true;
    return { success: true, verified: true, phone: record.phone };
  },
  isTrusted(challengeId, phone, brandId) {
    if (!challengeId || !this.challenges.has(challengeId)) return false;
    const record = this.challenges.get(challengeId);
    if (Date.now() > record.expiresAt) return false;
    return record.verified === true && record.phone === phone && record.brandId === brandId;
  }
};

// Rate Limiter for sensitive endpoints (login, password change, etc.)
const RateLimiter = {
  attempts: new Map(),
  
  check(key, maxAttempts = 5, windowSeconds = 300) {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    // Prune stale entries if map exceeds 5000 keys to prevent unbounded memory growth
    if (this.attempts.size > 5000) {
      for (const [k, v] of this.attempts.entries()) {
        if (now - (v.firstAttempt || 0) > windowMs) {
          this.attempts.delete(k);
        }
      }
    }

    const record = this.attempts.get(key) || { count: 0, firstAttempt: now };
    
    // Reset if window expired
    if (now - record.firstAttempt > windowMs) {
      record.count = 0;
      record.firstAttempt = now;
    }
    
    record.count++;
    this.attempts.set(key, record);
    
    return {
      allowed: record.count <= maxAttempts,
      remaining: Math.max(0, maxAttempts - record.count),
      retryAfter: record.count > maxAttempts ? Math.ceil((record.firstAttempt + windowMs - now) / 1000) : 0
    };
  },
  
  reset(key) {
    this.attempts.delete(key);
  }
};

// ── RETIRED (2026-09-21): WhatsApp OTP login ────────────────────────────────
// The WhatsApp OTP identity flow and its Wablas transport are RETIRED and no
// longer used by the Customer PWA. Customer identity is Google Sign-In +
// Phone Completion (PATCH /customer/profile/phone) only.
// The legacy challenge store + OTP routes below are intentionally KEPT for
// reference but are unreachable: each route short-circuits with OTP_RETIRED and
// NEVER dispatches to Wablas. Do not re-enable without a new decision.
const OTP_RETIRED = {
  success: false,
  error: 'OTP_RETIRED',
  message: 'Login dengan kode OTP sudah tidak digunakan. Silakan masuk dengan Google.'
};

router.post('/auth/otp/send', async (req, res) => {
  // RETIRED — no WhatsApp / Wablas dispatch. Legacy implementation kept below.
  return res.status(410).json(OTP_RETIRED);

  const { phone } = req.body;
  if (!phone || !phone.trim()) {
    return res.status(400).json({ success: false, error: 'Nomor WhatsApp / telepon wajib diisi.' });
  }

  const cleanPhone = phone.trim();

  // P1 HARDENING (FINDING 09): Enforce strict Rate Limiting (60s cooldown per phone & tenant)
  const rateLimitCheck = OtpChallengeStore.checkRateLimit(cleanPhone, req.brand_id, 60);
  if (!rateLimitCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: 'TOO_MANY_REQUESTS',
      retry_after: rateLimitCheck.retryAfter,
      message: `Harap tunggu ${rateLimitCheck.retryAfter} detik sebelum meminta kode OTP kembali.`
    });
  }

  // P1 HARDENING (FINDING 09): CSPRNG Cryptographically Secure Random Number Generator
  const otpCode = process.env.NODE_ENV === 'production' 
    ? crypto.randomInt(100000, 1000000).toString() 
    : '123456';

  const maskedPhone = cleanPhone.replace(/(\d{4})\d+(\d{2})$/, '$1******$2');
  console.log(`[OTP_SEND_REQUEST] brand=${req.brand_id} phone=${maskedPhone}`);

  // Dispatch OTP via Wablas before creating the challenge.
  // In test environment, skip the real transport so unit tests stay isolated.
  if (process.env.NODE_ENV !== 'test') {
    const wablasApiKey = process.env.WABLAS_API_KEY;
    const wablasDeviceId = process.env.WABLAS_DEVICE_ID;
    const wablasApiUrl = process.env.WABLAS_API_URL || 'https://kudus.wablas.com/api/send-message';

    if (!wablasApiKey) {
      console.error('[OTP_SEND_FAILURE] WABLAS_API_KEY is not configured in runtime environment.');
      return res.status(503).json({
        success: false,
        error: 'OTP_TRANSPORT_UNAVAILABLE',
        message: 'Layanan pengiriman OTP belum dikonfigurasi. Hubungi administrator.'
      });
    }

    if (!wablasDeviceId) {
      console.error('[OTP_SEND_FAILURE] WABLAS_DEVICE_ID is not configured in runtime environment.');
      return res.status(503).json({
        success: false,
        error: 'OTP_TRANSPORT_UNAVAILABLE',
        message: 'Perangkat WhatsApp pengirim OTP belum dikonfigurasi. Hubungi administrator.'
      });
    }

    try {
      console.log(`[OTP_TRANSPORT_SELECTED] transport=wablas device=${wablasDeviceId}`);
      console.log(`[WABLAS_REQUEST_STARTED] phone=${maskedPhone} device=${wablasDeviceId}`);

      const axios = require('axios');
      const otpMessage = `Kode OTP Anda: *${otpCode}*\n\nKode berlaku selama 5 menit. Jangan bagikan kode ini kepada siapa pun.`;

      const wablasRes = await axios.post(
        wablasApiUrl,
        { phone: cleanPhone, message: otpMessage, device: wablasDeviceId },
        {
          headers: { Authorization: wablasApiKey },
          validateStatus: () => true,
          timeout: 15000
        }
      );

      console.log(`[WABLAS_RESPONSE_STATUS] status=${wablasRes.status}`);

      if (wablasRes.status < 200 || wablasRes.status >= 300) {
        console.error(`[WABLAS_REQUEST_FAILED] status=${wablasRes.status} response=${JSON.stringify(wablasRes.data)}`);
        return res.status(502).json({
          success: false,
          error: 'OTP_DELIVERY_FAILED',
          message: 'Gagal mengirim OTP ke WhatsApp. Pastikan nomor Anda aktif dan coba lagi.'
        });
      }

      // Wablas may return status=true in body even with HTTP 200 when the device is offline
      const wablasBody = wablasRes.data;
      if (wablasBody && wablasBody.status === false) {
        console.error(`[WABLAS_REQUEST_FAILED] wablas_status=false message=${wablasBody.message || 'unknown'}`);
        return res.status(502).json({
          success: false,
          error: 'OTP_DELIVERY_FAILED',
          message: 'Perangkat WhatsApp pengirim tidak aktif. Coba lagi nanti.'
        });
      }

      console.log(`[OTP_SEND_SUCCESS] brand=${req.brand_id} phone=${maskedPhone}`);
    } catch (transportErr) {
      console.error(`[WABLAS_REQUEST_FAILED] ${transportErr.message}`);
      return res.status(503).json({
        success: false,
        error: 'OTP_TRANSPORT_ERROR',
        message: 'Gagal menghubungi layanan WhatsApp. Periksa koneksi dan coba lagi.'
      });
    }
  }

  const { challengeId } = OtpChallengeStore.createChallenge(cleanPhone, req.brand_id, otpCode);
  res.json({
    success: true,
    challenge_id: challengeId,
    retry_after: 60,
    message: 'Kode OTP telah dikirimkan ke nomor WhatsApp Anda.'
  });
});

router.post('/auth/otp/verify', (req, res) => {
  // RETIRED — no OTP challenge verification. Legacy implementation kept below.
  return res.status(410).json(OTP_RETIRED);

  const { challenge_id, otp, code, phone } = req.body;
  const otpInput = otp || code;

  if (!challenge_id || !otpInput) {
    return res.status(400).json({ success: false, error: 'Challenge ID dan Kode OTP wajib diisi.' });
  }

  const result = OtpChallengeStore.verifyOtp(challenge_id, otpInput, phone ? phone.trim() : null, req.brand_id);
  if (!result.success) {
    return res.status(400).json(result);
  }

  // P1 CUSTOMER AUTHENTICATION (Finding 1): Issue signed customer session token upon OTP verification
  const customerSession = TokenSessionStore.createCustomerSession(result.phone, req.brand_id);
  res.json({
    success: true,
    verified: true,
    phone: result.phone,
    token: customerSession.token,
    expires_at: customerSession.expiresAt
  });
});

router.post('/auth/otp/trust', (req, res) => {
  // RETIRED — no OTP trust lookup. Legacy implementation kept below.
  return res.status(410).json(OTP_RETIRED);

  const { challenge_id, phone } = req.body;
  if (!challenge_id || !phone) {
    return res.status(400).json({ success: false, error: 'Challenge ID dan nomor telepon wajib disertakan.' });
  }

  const trusted = OtpChallengeStore.isTrusted(challenge_id, phone.trim(), req.brand_id);
  if (!trusted) {
    return res.status(403).json({ success: false, trusted: false, error: 'Perangkat atau sesi nomor belum diverifikasi OTP.' });
  }

  const customerSession = TokenSessionStore.createCustomerSession(phone.trim(), req.brand_id);
  res.json({
    success: true,
    trusted: true,
    token: customerSession.token,
    expires_at: customerSession.expiresAt
  });
});

// 4.3 Customer Google Authentication Gate
// POST /customer/auth/google
// Verifies a Google ID token and issues a Xentra customer session (xnt_cust_).
// This route is STRICTLY customer-only and MUST NOT issue workforce sessions.
// Google ID token → verifiedClaims → xnt_cust_ token via createCustomerSession.
// The Google sub/email are NEVER used as an internal customer ID.
// This is separate from the workforce /auth/google route (line 3311) which
// resolves user_auth_providers and issues xnt_auth_ workforce sessions.
router.post('/customer/auth/google', async (req, res) => {
  try {
    const { credential, id_token } = req.body || {};
    const rawToken = credential || id_token;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_GOOGLE_CREDENTIAL',
        error: 'Credential token Google wajib dikirim.'
      });
    }

    // Rate limiting: 10 attempts per 5 minutes per IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const rateLimitKey = `customer-google-auth:${req.brand_id}:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 10, 300);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        code: 'TOO_MANY_REQUESTS',
        error: `Terlalu banyak percobaan autentikasi Google. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    // Verify Google ID token using the shared GoogleAuthService
    const googleAuth = new GoogleAuthService();
    let verifiedClaims;
    try {
      verifiedClaims = await googleAuth.verifyIdToken(rawToken);
    } catch (verifyErr) {
      const status = verifyErr.status || 401;
      return res.status(status).json({
        success: false,
        code: verifyErr.code || 'INVALID_GOOGLE_TOKEN',
        error: verifyErr.message || 'Token Google tidak valid.'
      });
    }

    // Customer MUST have a verified Google email to proceed
    if (!verifiedClaims.email_verified) {
      return res.status(400).json({
        success: false,
        code: 'UNVERIFIED_GOOGLE_EMAIL',
        error: 'Email akun Google belum diverifikasi. Harap verifikasi email Google Anda terlebih dahulu.'
      });
    }

    // Resolve or create Customer and CustomerAuthProvider using Google sub as immutable key.
    // Customer domain is strictly separated from workforce (no users / user_auth_providers touched).
    // Customer identity is organization-scoped (Organization Scope v1).
    const { CustomerIdentityService } = require('../../core/identity');
    const customerIdentityService = new CustomerIdentityService();
    const resolvedCustomer = customerIdentityService.findOrCreateFromGoogle({
      brand_id: req.brand_id,
      organization_id: req.organization_id || (req.brand && req.brand.organization_id),
      sub: verifiedClaims.sub,
      email: verifiedClaims.email,
      name: verifiedClaims.name,
      picture: verifiedClaims.picture
    });

    const customerRecord = resolvedCustomer.customer;
    const displayName = customerRecord.display_name || verifiedClaims.name || (verifiedClaims.email ? verifiedClaims.email.split('@')[0] : 'Pelanggan');

    // Issue a Xentra customer session bound to customer_id.
    // The token prefix is xnt_cust_, verified by requireCustomerAuth().
    // Google sub is stored as google_sub for audit; it is NEVER the internal customer ID.
    const customerSession = TokenSessionStore.createCustomerSession(
      customerRecord.phone || verifiedClaims.email,
      req.brand_id,
      2592000,  // 30 days TTL
      {
        customerId: customerRecord.id,
        customer_id: customerRecord.id,
        organizationId: customerRecord.organization_id || req.organization_id,
        organization_id: customerRecord.organization_id || req.organization_id,
        name: displayName,
        email: customerRecord.email || verifiedClaims.email,
        google_sub: verifiedClaims.sub
      }
    );

    RateLimiter.reset(rateLimitKey);

    console.log(`[CUSTOMER_GOOGLE_AUTH] brand=${req.brand_id} customer_id=${customerRecord.id} email=${(customerRecord.email || verifiedClaims.email).replace(/@.*/, '@...')} sub=${verifiedClaims.sub.substring(0, 8)}...`);

    return res.json({
      success: true,
      token: customerSession.token,
      expires_at: new Date(customerSession.expiresAt).toISOString(),
      customer: {
        id: customerRecord.id,
        name: displayName,
        email: customerRecord.email || verifiedClaims.email,
        phone: customerRecord.phone || null
      }
    });
  } catch (err) {
    console.error('[CUSTOMER_GOOGLE_AUTH] Unexpected error:', err);
    const status = Number(err && err.status);
    if (status >= 400 && status < 500) {
      return res.status(status).json({
        success: false,
        code: err.code || 'CUSTOMER_AUTH_ERROR',
        error: err.message || 'Autentikasi Customer ditolak.'
      });
    }
    return res.status(500).json({
      success: false,
      code: 'AUTH_ERROR',
      error: 'Terjadi kesalahan saat autentikasi. Coba lagi.'
    });
  }});

// ─── CUSTOMER BROKER HANDOFF STORE ───────────────────────────────────────────
// Short-lived, single-use handoff tickets issued by the Xentra Auth Broker
// after a successful Google identity verification for a customer.
// These are STRICTLY separate from the merchant HandoffService (xnt_hdf_).
// Customer tickets use the xnt_chdf_ prefix and carry customer_id + brand_id.
// ─────────────────────────────────────────────────────────────────────────────
const CustomerHandoffStore = (() => {
  const store = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of store) {
      if (now > val.expiresAt) store.delete(key);
    }
  }, 5 * 60 * 1000).unref();
  return {
    create({ customerId, brandId, organizationId, customerEmail, customerName, ttlSeconds = 120 }) {
      const ticket = 'xnt_chdf_' + crypto.randomBytes(24).toString('hex');
      store.set(ticket, { customerId, brandId, organizationId, customerEmail, customerName, expiresAt: Date.now() + ttlSeconds * 1000, used: false });
      return ticket;
    },
    consume(ticket) {
      if (!ticket || typeof ticket !== 'string') return null;
      const entry = store.get(ticket);
      if (!entry) return null;
      if (entry.used || Date.now() > entry.expiresAt) { store.delete(ticket); return null; }
      entry.used = true;
      store.delete(ticket);
      return entry;
    }
  };
})();

// POST /customer/auth/broker/init
// Called by a customer tenant when the user clicks "Masuk dengan Google".
// Returns a broker_url pointing to https://xentra.cloud/auth/broker?mode=customer&...
// The tenant NEVER initializes Google GSI directly; only the broker (xentra.cloud) does.
router.post('/customer/auth/broker/init', (req, res) => {
  try {
    const brandId = req.brand_id;
    if (!brandId) {
      return res.status(400).json({ success: false, code: 'TENANT_REQUIRED', error: 'Tenant brand context diperlukan.' });
    }
    // Use req.brand from tenantResolver middleware (already resolved and cached)
    const brand = req.brand || db.prepare('SELECT id, custom_domain FROM brands WHERE id = ?').get(brandId);
    if (!brand || !brand.custom_domain) {
      return res.status(400).json({ success: false, code: 'TENANT_DOMAIN_NOT_CONFIGURED', error: 'Tenant domain tidak dikonfigurasi.' });
    }
    const returnTo = `https://${brand.custom_domain}/`;
    const brokerBase = process.env.XENTRA_CONTROL_PLANE_URL || 'https://xentra.cloud';
    const brokerUrl = `${brokerBase}/auth/broker?mode=customer&return_to=${encodeURIComponent(returnTo)}&brand_id=${encodeURIComponent(brandId)}`;
    return res.json({ success: true, broker_url: brokerUrl, return_to: returnTo });
  } catch (err) {
    console.error('[CUSTOMER_BROKER_INIT]', err);
    return res.status(500).json({ success: false, code: 'BROKER_INIT_ERROR', error: 'Gagal menginisialisasi customer broker.' });
  }
});

// POST /customer/auth/broker/exchange
// Called by the customer tenant after returning from the broker with a
// one-time customer handoff code (xnt_chdf_*).
// Validates the code, enforces tenant binding, issues xnt_cust_ session.
// The raw Google credential/token is NEVER present here — it stays server-side.
router.post('/customer/auth/broker/exchange', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string' || !code.startsWith('xnt_chdf_')) {
      return res.status(400).json({ success: false, code: 'INVALID_CUSTOMER_CODE', error: 'Customer handoff code tidak valid.' });
    }
    const brandId = req.brand_id;
    if (!brandId) {
      return res.status(400).json({ success: false, code: 'TENANT_REQUIRED', error: 'Penukaran code harus dilakukan dari domain tenant.' });
    }
    const entry = CustomerHandoffStore.consume(code);
    if (!entry) {
      return res.status(401).json({ success: false, code: 'CODE_EXPIRED_OR_USED', error: 'Customer handoff code sudah digunakan, kadaluarsa, atau tidak valid.' });
    }
    if (entry.brandId !== brandId) {
      return res.status(403).json({ success: false, code: 'TENANT_MISMATCH', error: 'Customer handoff code tidak valid untuk tenant ini.' });
    }
    const customerSession = TokenSessionStore.createCustomerSession(
      entry.customerEmail || entry.customerId,
      brandId,
      2592000,
      {
        customerId: entry.customerId,
        customer_id: entry.customerId,
        organizationId: entry.organizationId,
        organization_id: entry.organizationId,
        name: entry.customerName,
        email: entry.customerEmail
      }
    );
    console.log(`[CUSTOMER_BROKER_EXCHANGE] brand=${brandId} customer_id=${entry.customerId}`);
    return res.json({
      success: true,
      token: customerSession.token,
      expires_at: new Date(customerSession.expiresAt).toISOString(),
      customer: { id: entry.customerId, name: entry.customerName, email: entry.customerEmail }
    });
  } catch (err) {
    console.error('[CUSTOMER_BROKER_EXCHANGE]', err);
    return res.status(500).json({ success: false, code: 'EXCHANGE_ERROR', error: 'Gagal menukarkan customer handoff code.' });
  }
});

// POST /customer/auth/broker/google
// Called ONLY by the Xentra Auth Broker (xentra.cloud) after Google verifies the
// customer identity. NOT called directly by tenant browsers.
// Verifies Google credential server-side, resolves/creates customer identity,
// issues xnt_chdf_ code, and returns a redirect_url to the tenant.
// Raw Google credential is NEVER forwarded to the tenant browser in any URL param.
router.post('/customer/auth/broker/google', async (req, res) => {
  try {
    const origin = (req.headers.origin || '').toLowerCase();
    const host = (req.headers.host || '').split(':')[0].trim().toLowerCase();
    const isProduction = process.env.NODE_ENV === 'production';
    const allowedOrigins = ['https://xentra.cloud'];
    const isFromBroker = allowedOrigins.some(o => origin.startsWith(o)) ||
      (!isProduction && (host === 'localhost' || host === '127.0.0.1'));
    if (isProduction && !isFromBroker) {
      return res.status(403).json({ success: false, code: 'BROKER_ONLY', error: 'Endpoint ini hanya dapat dipanggil oleh Xentra Auth Broker.' });
    }

    const { credential, brand_id: brokerBrandId, return_to } = req.body || {};
    if (!credential) {
      return res.status(400).json({ success: false, code: 'MISSING_GOOGLE_CREDENTIAL', error: 'Credential Google wajib dikirim.' });
    }
    if (!brokerBrandId) {
      return res.status(400).json({ success: false, code: 'MISSING_BRAND_ID', error: 'brand_id wajib dikirim oleh broker.' });
    }

    const googleAuth = new GoogleAuthService();
    let verifiedClaims;
    try {
      verifiedClaims = await googleAuth.verifyIdToken(credential);
    } catch (verifyErr) {
      const status = verifyErr.status || 401;
      return res.status(status).json({ success: false, code: verifyErr.code || 'INVALID_GOOGLE_TOKEN', error: verifyErr.message || 'Token Google tidak valid.' });
    }
    if (!verifiedClaims.email_verified) {
      return res.status(400).json({ success: false, code: 'UNVERIFIED_GOOGLE_EMAIL', error: 'Email Google belum diverifikasi.' });
    }

    const brand = db.prepare('SELECT id, organization_id, custom_domain FROM brands WHERE id = ?').get(brokerBrandId);
    if (!brand) {
      return res.status(400).json({ success: false, code: 'BRAND_NOT_FOUND', error: 'Brand tidak ditemukan.' });
    }

    const { CustomerIdentityService } = require('../../core/identity');
    const customerIdentityService = new CustomerIdentityService();
    const resolvedCustomer = customerIdentityService.findOrCreateFromGoogle({
      brand_id: brand.id,
      organization_id: brand.organization_id,
      sub: verifiedClaims.sub,
      email: verifiedClaims.email,
      name: verifiedClaims.name,
      picture: verifiedClaims.picture
    });

    const customerRecord = resolvedCustomer.customer;
    const displayName = customerRecord.display_name || verifiedClaims.name || (verifiedClaims.email ? verifiedClaims.email.split('@')[0] : 'Pelanggan');

    const handoffCode = CustomerHandoffStore.create({
      customerId: customerRecord.id,
      brandId: brand.id,
      organizationId: brand.organization_id,
      customerEmail: customerRecord.email || verifiedClaims.email,
      customerName: displayName,
      ttlSeconds: 120
    });

    let redirectUrl = null;
    if (return_to) {
      try {
        const dest = new URL(return_to);
        dest.searchParams.set('customer_code', handoffCode);
        redirectUrl = dest.toString();
      } catch (_) {}
    }
    if (!redirectUrl && brand.custom_domain) {
      redirectUrl = `https://${brand.custom_domain}/?customer_code=${handoffCode}`;
    }

    console.log(`[CUSTOMER_BROKER_GOOGLE] brand=${brand.id} customer_id=${customerRecord.id} new=${resolvedCustomer.isNew}`);
    return res.json({ success: true, redirect_url: redirectUrl });
  } catch (err) {
    const status = err.status || 500;
    console.error('[CUSTOMER_BROKER_GOOGLE]', err);
    return res.status(status).json({ success: false, code: err.code || 'BROKER_GOOGLE_ERROR', error: err.message || 'Autentikasi customer melalui broker gagal.' });
  }
});

// 5. Menu Catalog & Home
router.get(['/catalog/menu', '/home'], async (req, res) => {
  try {
    const brandId = req.brand_id;
    const branchId = req.query.branch_id || '';

    // P3 BRANCH-SCOPED MENU: when a branch context is explicitly requested it must
    // belong to this brand AND be active; otherwise fail closed (400) instead of
    // silently serving a different scope (product pages never silently re-scope).
    let branchScope = null;
    if (branchId) {
      const branch = db.prepare('SELECT id, is_active FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
      if (!branch) {
        return res.status(400).json({ success: false, error: 'branch not found' });
      }
      if (!branch.is_active) {
        return res.status(400).json({ success: false, error: 'branch is inactive' });
      }
      branchScope = branch;
    }

    // P3: always reuse the canonical commerce CatalogService — both branch-scoped
    // and brand-wide menus go through the same domain ownership path.
    // CatalogService returns branch price override, C1 operational availability,
    // and branch stock estimate when branch_id is provided.
    const menu = CatalogService.getMenu({ brand_id: brandId, branch_id: branchScope ? branchScope.id : null });

    // Collect all media IDs across categories and products for batch resolution (O(1) roundtrips)
    const allMediaIds = [];
    for (const c of menu.categories) {
      if (c.media_id) allMediaIds.push(c.media_id);
    }
    for (const p of menu.products) {
      if (p.media_id) allMediaIds.push(p.media_id);
    }

    const mediaMap = batchResolveCustomerMediaDelivery({
      mediaIds: allMediaIds,
      brandId,
      assetType: 'square'
    });

    // Helper to enrich any item using the batch-resolved map with legacy fallback
    const enrichItemMedia = (item) => {
      const legacyImg = item.image_url || item.icon_url || item.image || '';
      const resolved = item.media_id ? mediaMap.get(item.media_id) : null;
      const previewUrl = resolved ? resolved.preview_url : (legacyImg || null);
      const variants = resolved ? resolved.srcset_variants : [];
      return {
        preview_url: previewUrl,
        image_url: previewUrl || legacyImg,
        image: previewUrl || legacyImg,
        media_id: resolved ? resolved.media_id : null,
        srcset_variants: variants
      };
    };

    // Enrich categories
    const categories = menu.categories.map((c) => {
      const media = enrichItemMedia(c);
      return {
        ...c,
        image: media.image,
        image_url: media.image_url,
        media_id: media.media_id,
        preview_url: media.preview_url,
        srcset_variants: media.srcset_variants
      };
    });

    // Enrich products ONCE into allNormalized flat list
    const allNormalized = menu.products.map((p) => {
      const media = enrichItemMedia(p);
      return {
        ...p,
        image: media.image,
        image_url: media.image_url,
        media_id: media.media_id,
        preview_url: media.preview_url,
        srcset_variants: media.srcset_variants,
        regular_price: p.regular_price || p.price,
        sale_price: p.price
      };
    });

    // Group enriched products by category_id (supports M:N categories)
    const productsByCategoryId = new Map();
    for (const p of allNormalized) {
      const catIds = (Array.isArray(p.category_ids) && p.category_ids.length > 0)
        ? p.category_ids.map(String)
        : (p.category_id != null ? [String(p.category_id)] : []);

      for (const catKey of catIds) {
        if (!productsByCategoryId.has(catKey)) {
          productsByCategoryId.set(catKey, []);
        }
        productsByCategoryId.get(catKey).push(p);
      }
    }

    // Build category tree from enriched items
    const tree = categories.map((cat) => {
      const catProducts = productsByCategoryId.get(String(cat.id)) || [];
      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug || String(cat.name || '').toLowerCase().replace(/\s+/g, '-'),
        image: cat.preview_url || cat.image_url || '',
        image_url: cat.preview_url || cat.image_url || '',
        media_id: cat.media_id || null,
        preview_url: cat.preview_url || null,
        srcset_variants: cat.srcset_variants || [],
        products: catProducts
      };
    });


    res.json({
      success: true,
      categories: tree,
      all_products: allNormalized,
      products: {
        items: allNormalized
      },
      promo: {
        enabled: true,
        target: 50000,
        discount: 5000,
        label: 'Selamat, kamu berhasil dapetin diskon Rp 5.000 ketika checkout!'
      }
    });
  } catch (err) {
    console.error('[API Error /catalog/menu]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.1 Products List Endpoint (with Category Filtering)
router.get('/products', (req, res) => {
  try {
    const brandId = req.brand_id;
    const cat = req.query.category;
    let products = [];
    try {
      // P1 STRICT TENANT ISOLATION (NEW-01 & NEW-03):
      // Filter strictly by requested category within authoritative brand_id
      if (cat && cat !== 'all') {
        products = db.prepare(`
          SELECT DISTINCT p.* FROM products p
          WHERE p.brand_id = ?
            AND (p.category_id = ? OR ? = 'all')
            AND (p.is_active = 1 OR p.is_active IS NULL)
          ORDER BY p.sort_order ASC
        `).all(brandId, cat, cat);
      } else {
        products = db.prepare('SELECT * FROM products WHERE brand_id = ? AND (is_active = 1 OR is_active IS NULL) ORDER BY sort_order ASC').all(brandId);
      }
    } catch (err) {
      console.warn('[Products DB Error]:', err.message);
    }

    // M6: Resolve canonical media delivery in batch (avoid N+1 queries)
    const mediaIds = (products || []).map(p => p.media_id).filter(Boolean);
    const mediaMap = batchResolveCustomerMediaDelivery({ mediaIds, brandId, assetType: 'square' });

    const normalized = (products || []).map((p) => {
      const legacyImg = p.image_url || p.image || '';
      const delivery = (p.media_id && mediaMap.get(p.media_id)) || {
        media_id: p.media_id || null,
        preview_url: legacyImg || null,
        srcset_variants: []
      };
      return {
        ...p,
        image: delivery.preview_url || legacyImg,
        image_url: delivery.preview_url || legacyImg,
        media_id: delivery.media_id,
        preview_url: delivery.preview_url,
        srcset_variants: delivery.srcset_variants,
        regular_price: p.regular_price || p.price,
        sale_price: p.price
      };
    });

    res.json({
      success: true,
      items: normalized,
      total: normalized.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.1 Upsell Products
router.get(['/catalog/upsell', '/checkout/upsell'], (req, res) => {
  try {
    const upsells = [
      { id: 4, name: 'Es Teh Manis Jumbo', price: 6000, regular_price: 6000, image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400' },
      { id: 5, name: 'Es Jeruk Peras Asli', price: 10000, regular_price: 12000, image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400' }
    ];
    res.json({ success: true, products: upsells });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.2 Checkout Session Sync
router.post(['/cart/sync', '/checkout/session'], (req, res) => {
  const { items = [], mode = 'all' } = req.body;
  const token = 'sess_' + crypto.randomBytes(12).toString('hex');
  res.json({
    success: true,
    token,
    session: {
      token,
      items,
      mode,
      created_at: new Date().toISOString()
    }
  });
});

// 5.2 Customer Profile — canonical Customer identity (phone lives here, not in checkout).
// GET returns authoritative profile; PATCH /phone validates + normalizes + saves.
router.get('/customer/profile', requireCustomerAuth(), (req, res) => {
  try {
    const customerId = req.customer.customerId || req.customer.customer_id;
    if (!customerId) {
      return res.status(404).json({ success: false, error: 'Customer identity tidak ditemukan.' });
    }
    const CustomerRepository = require('../../core/data/repositories/CustomerRepository');
    const customerRepo = new CustomerRepository();
    const record = customerRepo.findById(customerId);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Customer tidak ditemukan.' });
    }
    return res.json({
      success: true,
      customer: {
        id: record.id,
        name: record.display_name || null,
        email: record.email || null,
        phone: record.phone || null
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Gagal memuat profil customer.' });
  }
});

router.patch('/customer/profile/phone', requireCustomerAuth(), (req, res) => {
  try {
    const customerId = req.customer.customerId || req.customer.customer_id;
    if (!customerId) {
      return res.status(404).json({ success: false, error: 'Customer identity tidak ditemukan.' });
    }
    const rawPhone = String((req.body && req.body.phone) || '').trim();
    const clean = rawPhone.replace(/[^0-9]/g, '');
    // Canonical Indonesian WhatsApp/mobile validation (same rule as recipient + OTP).
    const isIndoMobile = clean.startsWith('08') || clean.startsWith('628') || clean.startsWith('8');
    if (!rawPhone || !isIndoMobile || clean.length < 9 || clean.length > 15) {
      return res.status(400).json({ success: false, error: 'Nomor WhatsApp/telepon tidak valid. Gunakan format 08xx atau 628xx (9-15 digit).' });
    }
    const CustomerRepository = require('../../core/data/repositories/CustomerRepository');
    const customerRepo = new CustomerRepository();
    const record = customerRepo.findById(customerId);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Customer tidak ditemukan.' });
    }
    customerRepo.updateCustomerProfile(customerId, { phone: clean });
    // Refresh the live session so SELF recipient resolves immediately without re-login.
    try {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();
      const live = token && TokenSessionStore.getSession(token);
      if (live) {
        live.phone = clean;
        live.customerPhone = clean;
      }
      const rawDb = require('../database/db');
      if (token) {
        try { rawDb.prepare('UPDATE customer_sessions SET phone = ? WHERE token = ?').run(clean, token); } catch (_) {}
      }
    } catch (_) {}
    return res.json({ success: true, customer: { id: customerId, phone: clean } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Gagal menyimpan nomor WhatsApp.' });
  }
});

// 5.3 Addresses (Protected by Customer Session - Brand scoped data)
// ── Customer: bill meja yang masih terbuka (dine-in) ────────────────────────
// Satu meja = satu bill (dining_sessions). Ini pintu untuk KONSUMEN:
//   - GET  /customer/dining-session         → bill miliknya sendiri
//   - POST /customer/dining-session/claim   → bill terbuka di meja dari QR (ganti HP)
// Tanpa ini, konsumen yang me-refresh halaman kehilangan jejak billnya.
// Pencocokan bill milik sendiri memakai kontrak yang sama dengan endpoint
// customer lain: kesamaan persis pada req.customer.phone (tidak ada normalisasi
// karangan sendiri, supaya bill orang lain tidak mungkin ikut terbaca).
function buildOpenBill(sessionId, brandId) {
  const session = db.prepare(`
    SELECT ds.id, ds.opened_at, ds.customer_name
    FROM dining_sessions ds
    JOIN branches b ON b.id = ds.branch_id
    WHERE ds.id = ? AND ds.status = 'active' AND b.brand_id = ?
  `).get(sessionId, brandId);
  if (!session) return null;

  const tables = db.prepare(`
    SELECT t.id, t.table_number, t.label
    FROM dining_session_tables dst
    JOIN branch_tables t ON t.id = dst.table_id
    WHERE dst.session_id = ?
    ORDER BY t.table_number
  `).all(session.id);

  const orders = db.prepare(`
    SELECT id, order_number, order_type, status, payment_status, grand_total, created_at
    FROM orders
    WHERE dining_session_id = ?
    ORDER BY created_at
  `).all(session.id);

  let totalBill = 0;
  let outstanding = 0;
  const billOrders = orders.map((o) => {
    const amount = Number(o.grand_total) || 0;
    const isSettled = o.payment_status === 'settlement' || o.payment_status === 'paid';
    const isCancelled = o.status === 'cancelled';
    if (!isCancelled) {
      totalBill += amount;
      if (!isSettled) outstanding += amount;
    }
    return {
      id: o.id,
      order_number: o.order_number,
      order_type: o.order_type,
      status: o.status,
      payment_status: o.payment_status,
      grand_total: amount,
      is_settled: isSettled,
      created_at: o.created_at
    };
  });

  return {
    session_id: session.id,
    opened_at: session.opened_at,
    customer_name: session.customer_name,
    tables: tables.map((t) => ({ id: t.id, table_number: t.table_number, label: t.label })),
    orders: billOrders,
    total_bill: totalBill,
    outstanding_total: outstanding
  };
}

router.get('/customer/dining-session', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    if (!customerPhone) return res.json({ success: true, session: null });

    const row = db.prepare(`
      SELECT ds.id
      FROM dining_sessions ds
      JOIN branches b ON b.id = ds.branch_id
      WHERE ds.status = 'active' AND b.brand_id = ? AND ds.customer_phone = ?
      ORDER BY ds.opened_at DESC
      LIMIT 1
    `).get(req.brand_id, customerPhone);

    return res.json({ success: true, session: row ? buildOpenBill(row.id, req.brand_id) : null });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/customer/dining-session/claim', requireCustomerAuth(), (req, res) => {
  try {
    const { qr_token, branch_id } = req.body || {};
    if (!qr_token) {
      return res.status(400).json({ success: false, error: 'qr_token wajib diisi.' });
    }

    const raw = String(qr_token).trim();
    let tableRow = null;

    // Kode manusiawi: "meja7", "Meja 7", atau "7" saja. Nomor meja hanya unik per
    // CABANG (tiga cabang satu brand boleh sama-sama punya Meja 7), jadi cabangnya
    // wajib disebut — tanpa itu kita tidak boleh menebak, karena bisa nyasar ke
    // meja nomor sama di cabang lain.
    const alias = /^(?:meja\s*)?(\d{1,4})$/i.exec(raw);
    if (alias) {
      if (!branch_id) {
        return res.status(400).json({
          success: false,
          error: 'BRANCH_REQUIRED',
          message: 'Cabang belum dipilih, jadi kode meja belum bisa dipakai.'
        });
      }
      tableRow = db.prepare(`
        SELECT id, table_number, label, branch_id FROM branch_tables
        WHERE branch_id = ? AND (table_number = ? OR lower(replace(label, ' ', '')) = ?)
      `).get(branch_id, alias[1], 'meja' + alias[1]);
      if (!tableRow) {
        return res.status(404).json({
          success: false,
          error: 'MEJA_TIDAK_DITEMUKAN',
          message: 'Meja itu tidak ada di cabang ini.'
        });
      }
    } else {
      const { DiningTableService } = require('../../domains/pos');
      const table = DiningTableService.resolveFromQr(raw);
      if (!table) {
        return res.status(404).json({ success: false, error: 'QR Meja tidak valid atau telah dicabut.' });
      }
      const tableId = table.id || table.table_id;
      tableRow = db.prepare('SELECT id, table_number, label, branch_id FROM branch_tables WHERE id = ?').get(tableId) || { id: tableId };
    }

    // Meja harus benar-benar milik brand ini.
    const brandOfBranch = db.prepare('SELECT brand_id FROM branches WHERE id = ?').get(tableRow.branch_id);
    if (!brandOfBranch || brandOfBranch.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'MEJA_TIDAK_DITEMUKAN' });
    }

    const tableId = tableRow.id;

    // Mejanya selalu dikembalikan, walau belum ada billnya: konsumen yang scan QR
    // tidak boleh diminta memilih meja lagi — mejanya sudah ada di QR itu.
    const tableInfo = {
      id: tableId,
      table_number: tableRow.table_number || null,
      label: tableRow.label || null
    };

    // SENGAJA hanya mejanya, tanpa isi tagihan. QR meja ditempel permanen di meja,
    // jadi QR itu bukan rahasia dan tidak boleh jadi kunci: kalau QR ini bisa
    // membuka tagihan, siapa pun yang pernah memfotonya bisa membaca tagihan tamu
    // berikutnya. Melihat tagihan tetap lewat identitas tamu sendiri
    // (GET /customer/dining-session).
    return res.json({ success: true, session: null, via: 'qr', table_id: tableId, table: tableInfo });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/addresses', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    let addresses;
    if (customerId) {
      // Canonical ownership: addresses strictly belong to customer_id within the requested brand
      addresses = db.prepare(`
        SELECT * FROM customer_addresses 
        WHERE brand_id = ? AND customer_id = ?
        ORDER BY is_primary DESC, updated_at DESC, created_at DESC
      `).all(req.brand_id, customerId);
    } else {
      // Legacy fallback: unlinked addresses without customer_id
      addresses = db.prepare(`
        SELECT * FROM customer_addresses 
        WHERE brand_id = ? AND customer_id IS NULL AND customer_phone = ? 
        ORDER BY is_primary DESC, updated_at DESC, created_at DESC
      `).all(req.brand_id, customerPhone);
    }

    res.json({ success: true, addresses: addresses || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/addresses', requireCustomerAuth(), (req, res) => {
  try {
    const { label = 'Rumah', address = '', detail = '', note = '', latitude, longitude, is_primary } = req.body;
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id || null;

    if (latitude == null || longitude == null || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
      return res.status(400).json({
        success: false,
        error: 'Titik koordinat (latitude & longitude) wajib diisi dengan angka yang valid.'
      });
    }

    if (!address || !String(address).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Alamat lengkap wajib diisi.'
      });
    }

    const addrId = 'addr_' + crypto.randomBytes(6).toString('hex');
    const existingCount = customerId
      ? db.prepare('SELECT COUNT(*) as cnt FROM customer_addresses WHERE brand_id = ? AND customer_id = ?').get(req.brand_id, customerId)
      : db.prepare('SELECT COUNT(*) as cnt FROM customer_addresses WHERE brand_id = ? AND customer_id IS NULL AND customer_phone = ?').get(req.brand_id, customerPhone);
    
    let isPrimary = 0;
    if (is_primary !== undefined) {
      isPrimary = (is_primary === 1 || is_primary === true || is_primary === '1') ? 1 : 0;
    } else {
      isPrimary = (!existingCount || existingCount.cnt === 0) ? 1 : 0;
    }

    // If marked as primary, demote any existing primary addresses for this customer & brand
    if (isPrimary === 1) {
      if (customerId) {
        db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_id = ?').run(req.brand_id, customerId);
      } else {
        db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_id IS NULL AND customer_phone = ?').run(req.brand_id, customerPhone);
      }
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO customer_addresses (
        id, brand_id, customer_id, customer_phone, label, address, detail, note, latitude, longitude, is_primary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      addrId,
      req.brand_id,
      customerId,
      customerPhone,
      (label || 'Rumah').trim(),
      String(address).trim(),
      (detail || '').trim(),
      (note || '').trim(),
      Number(latitude),
      Number(longitude),
      isPrimary,
      now,
      now
    );

    const created = {
      id: addrId,
      brand_id: req.brand_id,
      customer_id: customerId,
      customer_phone: customerPhone,
      label: (label || 'Rumah').trim(),
      address: String(address).trim(),
      detail: (detail || '').trim(),
      note: (note || '').trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      is_primary: isPrimary,
      created_at: now,
      updated_at: now
    };

    res.status(201).json({ success: true, address: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/addresses/:id', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    const existing = customerId
      ? db.prepare('SELECT * FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_id = ?').get(req.params.id, req.brand_id, customerId)
      : db.prepare('SELECT * FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_id IS NULL AND customer_phone = ?').get(req.params.id, req.brand_id, customerPhone);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Alamat tidak ditemukan atau Anda tidak memiliki akses.' });
    }

    const { label, address, detail, note, latitude, longitude, is_primary } = req.body;

    const newLabel = label !== undefined ? String(label).trim() : existing.label;
    const newAddress = address !== undefined ? String(address).trim() : existing.address;
    const newDetail = detail !== undefined ? String(detail).trim() : existing.detail;
    const newNote = note !== undefined ? String(note).trim() : existing.note;

    if (newAddress === '') {
      return res.status(400).json({ success: false, error: 'Alamat lengkap tidak boleh kosong.' });
    }

    let newLat = existing.latitude;
    let newLng = existing.longitude;
    if (latitude !== undefined) {
      if (latitude == null || isNaN(Number(latitude))) {
        return res.status(400).json({ success: false, error: 'Latitude harus berupa angka valid.' });
      }
      newLat = Number(latitude);
    }
    if (longitude !== undefined) {
      if (longitude == null || isNaN(Number(longitude))) {
        return res.status(400).json({ success: false, error: 'Longitude harus berupa angka valid.' });
      }
      newLng = Number(longitude);
    }

    let newIsPrimary = existing.is_primary;
    if (is_primary !== undefined) {
      newIsPrimary = (is_primary === 1 || is_primary === true || is_primary === '1') ? 1 : 0;
      if (newIsPrimary === 1) {
        if (customerId) {
          db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_id = ? AND id != ?').run(req.brand_id, customerId, req.params.id);
        } else {
          db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_id IS NULL AND customer_phone = ? AND id != ?').run(req.brand_id, customerPhone, req.params.id);
        }
      }
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE customer_addresses
      SET label = ?, address = ?, detail = ?, note = ?, latitude = ?, longitude = ?, is_primary = ?, updated_at = ?
      WHERE id = ? AND brand_id = ?
    `).run(
      newLabel,
      newAddress,
      newDetail,
      newNote,
      newLat,
      newLng,
      newIsPrimary,
      now,
      req.params.id,
      req.brand_id
    );

    const updated = {
      id: req.params.id,
      brand_id: req.brand_id,
      customer_id: existing.customer_id || customerId,
      customer_phone: customerPhone,
      label: newLabel,
      address: newAddress,
      detail: newDetail,
      note: newNote,
      latitude: newLat,
      longitude: newLng,
      is_primary: newIsPrimary,
      created_at: existing.created_at,
      updated_at: now
    };

    res.json({ success: true, address: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/addresses/:id', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    const result = customerId
      ? db.prepare('DELETE FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_id = ?').run(req.params.id, req.brand_id, customerId)
      : db.prepare('DELETE FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_id IS NULL AND customer_phone = ?').run(req.params.id, req.brand_id, customerPhone);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Alamat tidak ditemukan atau Anda tidak memiliki akses.' });
    }
    res.json({ success: true, message: 'Alamat berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/checkout/verify', requireCustomerAuth(), (req, res) => {
  try {
    const { branch_id, items = [], order_type = 'delivery', pwa_runtime = null } = req.body;
    if (!branch_id) {
      return res.status(400).json({ success: false, error: 'Cabang pemesanan (branch_id) wajib dipilih.' });
    }
    const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');

    // R1 CART/CHECKOUT BOUNDARY — CHECKOUT IS SINGLE-BRANCH: reject any
    // verification payload mixing item branch provenance or contradicting the
    // checkout branch before any further evaluation. No silent merge/split.
    const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(branch_id, items);
    if (scopeError) {
      return res.status(400).json({ success: false, status: scopeError.status, error: scopeError.error });
    }

    if (order_type === 'reservation') {
      return res.json({ success: true, is_valid: true, status: 'VERIFIED', verified_items: [], price_diffs: [], errors: [] });
    }
    const verification = PrePaymentVerificationGate.verify({
      branch_id,
      brand_id: req.brand_id,
      items,
      customer: { phone: req.customer.phone, name: req.body.customer?.name || '' },
      pwa_runtime
    });
    return res.json({
      success: verification.is_valid,
      ...verification
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// 6. Create Order & Submit Checkout
router.post(['/checkout/create-order', '/checkout/submit'], async (req, res) => {
  try {
    let {
      branch_id,
      customer = {},
      pwa_runtime = null,
      order_type,
      fulfillment = {},
      schedule_type = 'asap',
      scheduled_slot_start,
      scheduled_slot_end,
      table_number,
      reservation_date,
      guest_count,
      delivery,
      address,
      items = [],
      payment_method = 'cash',
      cash_tendered = null,
      note = '',
      order_note = ''
    } = req.body;

    order_type = order_type || fulfillment.type || 'delivery';
    order_note = order_note || note || '';
    table_number = table_number || fulfillment.table_number || null;
    reservation_date = reservation_date || fulfillment.reservation_date || null;
    guest_count = guest_count || fulfillment.guest_count || null;

    if (address && !delivery) {
      delivery = {
        latitude: address.latitude,
        longitude: address.longitude,
        address: address.formatted_address || address.address || 'Alamat Customer'
      };
    }

    // P1 SECURE PAYMENT METHOD VALIDATION: Whitelist only officially supported payment methods
    const allowedPaymentMethods = ['cash', 'midtrans'];
    if (!allowedPaymentMethods.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        error: `Metode pembayaran "${payment_method}" tidak valid. Pilihan yang didukung: ${allowedPaymentMethods.join(', ')}.`
      });
    }

    // COD CASH TENDER VALIDATION:
    // If cash payment, cash_tendered must be a valid positive number if provided,
    // and non-negative / non-empty when custom tender is specified.
    let parsedCashTendered = null;
    if (payment_method === 'cash') {
      if (cash_tendered !== null && cash_tendered !== undefined && cash_tendered !== '') {
        const numTendered = Number(cash_tendered);
        if (!Number.isFinite(numTendered) || numTendered < 0 || isNaN(numTendered)) {
          return res.status(400).json({
            success: false,
            error: 'Nominal uang tunai (cash_tendered) tidak valid. Masukkan angka yang valid.'
          });
        }
        parsedCashTendered = Math.round(numTendered);
      }
    }

    // P1 CUSTOMER IDENTITY BINDING (NEW-02): Extract customer session token
    const authHeader = req.headers['authorization'] || '';
    const customerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();

    if (!customerToken) {
      return res.status(401).json({
        success: false,
        error: 'CUSTOMER_AUTH_REQUIRED',
        message: 'Checkout memerlukan otentikasi. Silakan login atau verifikasi nomor WhatsApp Anda.'
      });
    }

    const customerSession = TokenSessionStore.getSession(customerToken);

    // CUSTOMER AUTH BOUNDARY: Checkout requires a valid authenticated customer session.
    // Sessions may be issued via OTP (xnt_cust_ prefix) or Google Identity Gate (also xnt_cust_ prefix).
    // The server is the sole authority for customer identity — client-provided phone
    // is never trusted as the sole identity source for order creation.
    if (!customerSession || (customerSession.type !== 'customer' && customerSession.role !== 'customer')) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_CUSTOMER_SESSION',
        message: 'Sesi akun customer Anda tidak valid atau telah kedaluwarsa. Silakan masuk kembali untuk melanjutkan.'
      });
    }

    const authCheck = authorizeCustomerSession(customerSession, req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({
        success: false,
        error: authCheck.error,
        message: authCheck.message
      });
    }

    // Authoritative identity from customer session — never from request body.
    // For OTP sessions: phone is the WhatsApp number.
    // For Google sessions: phone field holds the Google email (used as contact identifier).
    customer.phone = customerSession.phone;

    // For Google-auth sessions, also propagate name from session if request body name is missing.
    if (!customer.name && customerSession.name) {
      customer.name = customerSession.name;
    }

    // Locked Decision: Customer information must be valid
    if (!customer.phone || !customer.phone.trim()) {
      return res.status(400).json({ success: false, error: 'Nomor telepon customer wajib diisi.' });
    }
    if (!customer.name || !customer.name.trim()) {
      return res.status(400).json({ success: false, error: 'Nama customer wajib diisi.' });
    }


    // P1 RECONCILIATION-AWARE CHECKOUT RECOVERY (NEW-01 & NEW-03):
    // If this customer already has an existing order in 'reconciliation_pending', query gateway before creating duplicate orders
    const existingRecon = db.prepare(`
      SELECT o.id, o.order_number, o.status, p.payment_status, p.snap_token
      FROM orders o
      JOIN order_payments p ON p.order_id = o.id
      WHERE o.brand_id = ? AND o.customer_phone = ? AND p.payment_status = 'reconciliation_pending'
      ORDER BY o.created_at DESC LIMIT 1
    `).get(req.brand_id, customer.phone.trim());

    if (existingRecon) {
      try {
        const inquiryRes = await PaymentService.checkTransactionStatus(existingRecon.id);
        if (inquiryRes && inquiryRes.payment_status === 'settlement') {
          return res.status(200).json({
            success: true,
            order_id: existingRecon.id,
            order_number: existingRecon.order_number,
            reconciled: true,
            message: 'Pesanan sebelumnya telah berhasil dikonfirmasi pembayarannya.',
            redirect: '/order-received/' + existingRecon.id
          });
        }
      } catch (inqErr) {
        console.warn('[Checkout Pending Recon Inquiry]:', inqErr.message);
      }
    }

    // P1 LOGIC VALIDATION (NEW-02): For delivery orders, strict coordinates are mandatory (NO fallback to default coordinates)
    if (order_type === 'delivery') {
      if (!delivery || delivery.latitude == null || delivery.longitude == null || isNaN(Number(delivery.latitude)) || isNaN(Number(delivery.longitude))) {
        return res.status(400).json({
          success: false,
          error: 'Titik koordinat pengantaran (latitude & longitude) wajib disertakan secara valid untuk pesanan delivery.'
        });
      }
    }

    // R2 BRANCH SELECTION MODE — how the fulfillment branch is established.
    // AUTO = Core matches the branch (BranchMatcher) from the delivery
    // destination; CUSTOMER_SELECTED = the customer explicitly chose branch_id
    // (INPUT, never authority — Core still validates eligibility).
    // selection_mode is distinct from fulfillment branch_id and is persisted
    // on the order for auditability. Legacy clients that send branch_id without
    // a mode are derived as CUSTOMER_SELECTED (unchanged behavior).
    let selection_mode = (req.body.selection_mode || req.body.selectionMode || '').toString().trim().toUpperCase();
    if (selection_mode && !['AUTO', 'CUSTOMER_SELECTED'].includes(selection_mode)) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_SELECTION_MODE',
        error: `selection_mode "${selection_mode}" tidak valid. Gunakan AUTO atau CUSTOMER_SELECTED.`
      });
    }
    if (!selection_mode) {
      selection_mode = branch_id ? 'CUSTOMER_SELECTED' : 'AUTO';
    }
    if (selection_mode === 'CUSTOMER_SELECTED' && !branch_id) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_SELECTION_MODE',
        error: 'Mode CUSTOMER_SELECTED memerlukan branch_id yang dipilih customer.'
      });
    }
    if (selection_mode === 'AUTO' && branch_id) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_SELECTION_MODE',
        error: 'Mode AUTO berarti Core mencocokkan cabang dari tujuan pengantaran — kirim tanpa branch_id agar BranchMatcher memilih. Jangan mengirim branch_id pada mode AUTO.'
      });
    }

    // 1. Resolve Branch with Intelligence (Scoped strictly to current brand, NO arbitrary LIMIT 1)
    let branch = null;
    if (branch_id) {
      branch = db.prepare(`
        SELECT 
          b.id, b.brand_id, b.name, b.latitude, b.longitude,
          s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order
        FROM branches b 
        LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id 
        WHERE b.id = ? AND b.brand_id = ? AND b.is_active = 1
      `).get(branch_id, req.brand_id);

      if (!branch) {
        return res.status(404).json({
          success: false,
          error: `Cabang dengan ID "${branch_id}" tidak ditemukan atau sedang nonaktif pada brand ini.`
        });
      }

      // C4/CHECKOUT ALIGNMENT — CUSTOMER_SELECTED: an explicit branch_id is a
      // customer PREFERENCE, never trusted directly. Core validates the selected
      // branch through the SAME canonical operational eligibility as AUTO
      // (exists/active/open + represented fulfillment capability). If the
      // selected branch is ineligible we REJECT explicitly — there is
      // deliberately NO silent rematch to another branch. Reservation keeps its
      // existing dedicated path (it bypasses the pre-payment gate and has no
      // locked branch-open contract yet).
      if (order_type !== 'reservation') {
        const EligibilityService = require('../../domains/commerce/services/EligibilityService');
        const selectedElig = EligibilityService.evaluateBranch({
          brand_id: req.brand_id,
          branch_id: branch.id,
          order_type
        });

        if (!selectedElig.eligible) {
          const selectedBranchMsg = {
            BRANCH_NOT_FOUND: `Cabang "${branch_id}" tidak ditemukan pada brand ini.`,
            BRANCH_NOT_ACTIVE: `Cabang "${branch_id}" sedang nonaktif.`,
            BRANCH_CLOSED: `Cabang "${branch_id}" sedang tutup. Silakan pilih cabang lain.`,
            FULFILLMENT_NOT_SUPPORTED: `Cabang "${branch_id}" tidak mendukung metode pemesanan ini. Silakan pilih metode lain.`
          };
          const reason = selectedElig.reasons && selectedElig.reasons[0];
          return res.status(400).json({
            success: false,
            error: selectedBranchMsg[reason] || `Cabang "${branch_id}" tidak dapat melayani pesanan ini saat ini. Silakan pilih cabang lain.`,
            reason: reason || 'BRANCH_INELIGIBLE',
            branch_id: branch.id
          });
        }
      }
    } else if (order_type === 'delivery' && delivery && delivery.latitude != null && delivery.longitude != null) {
      // Intelligent Branch Resolution based on customer coordinates & cart availability
      const matchResult = await BranchMatcher.matchNearestBranch({
        brand_id: req.brand_id,
        customer_lat: Number(delivery.latitude),
        customer_lng: Number(delivery.longitude),
        subtotal: 0,
        items
      });

      if (matchResult && matchResult.eligible && matchResult.branch) {
        branch = db.prepare(`
          SELECT 
            b.id, b.brand_id, b.name, b.latitude, b.longitude,
            s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order
          FROM branches b 
          LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id 
          WHERE b.id = ? AND b.brand_id = ?
        `).get(matchResult.branch.id, req.brand_id);
      } else {
        return res.status(400).json({
          success: false,
          error: matchResult ? matchResult.reason : 'Tidak ditemukan cabang terdekat yang dapat melayani pengantaran ke lokasi Anda.'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Cabang pemesanan (branch_id) wajib dipilih.'
      });
    }

    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang restoran tidak ditemukan untuk brand ini.' });
    }

    // R1 CART/CHECKOUT BOUNDARY — CHECKOUT IS SINGLE-BRANCH (multi-branch cart
    // is allowed, but each checkout/order resolves to exactly ONE fulfillment
    // branch). Per-item branch provenance declares the cart scope that produced
    // the item; mixing scopes, or shipping one scope against a different branch,
    // is REJECTED with CHECKOUT_SINGLE_BRANCH_REQUIRED. The system never
    // silently selects, merges, splits, or rematches items across branches.
    const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');
    const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(branch.id, items);
    if (scopeError) {
      return res.status(400).json({ success: false, status: scopeError.status, error: scopeError.error });
    }

    // 2. Authoritative Pre-Payment Verification Gate (Single Source of Truth for Product Pricing & Stock)
    let verifiedItems = [];
    let verifiedSubtotal = 0;

    if (order_type !== 'reservation') {
      const verification = PrePaymentVerificationGate.verify({
        branch_id: branch.id,
        brand_id: req.brand_id,
        items,
        customer,
        pwa_runtime
      });

      if (!verification.is_valid) {
        const primaryError = (verification.errors && verification.errors[0]) || 'Gagal memverifikasi produk atau harga pesanan.';
        return res.status(400).json({
          success: false,
          status: verification.status,
          error: primaryError,
          errors: verification.errors,
          price_diffs: verification.price_diffs
        });
      }

      verifiedItems = verification.verified_items;
      verifiedSubtotal = verifiedItems.reduce((acc, it) => acc + it.subtotal, 0);
    }

    // 3. Compute Delivery Fee using Authoritative Verified Subtotal
    let deliveryFee = 0;
    let discountAmount = 0;
    let deliveryRecord = null;

    if (order_type === 'delivery') {
      const custLat = Number(delivery.latitude);
      const custLng = Number(delivery.longitude);

      const road = await RouteService.getRoadDistance(
        branch.latitude,
        branch.longitude,
        custLat,
        custLng
      );

      const promoConfig = (Number(branch.promo_delivery_discount) > 0 && Number(branch.promo_min_order) > 0)
        ? { enabled: true, target: Number(branch.promo_min_order), discount: Number(branch.promo_delivery_discount) }
        : { enabled: false, target: 0, discount: 0 };

      // P1 AUTHORITATIVE PRICING INVARIANT (Finding NEW-01): Use verifiedSubtotal from server, NEVER client price
      const feeCalc = DeliveryCalculator.calculate({
        distance_meters: road.distance_meters,
        free_km: branch.free_delivery_km || 0,
        price_per_km: branch.price_per_km || 3000,
        max_radius_km: branch.max_radius_km || 30,
        subtotal: verifiedSubtotal,
        promo_config: promoConfig
      });

      if (!feeCalc.eligible) {
        return res.status(400).json({
          success: false,
          error: feeCalc.reason || 'Alamat pengantaran berada di luar radius layanan cabang ini.'
        });
      }

      deliveryFee = feeCalc.final_delivery_fee;
      discountAmount = feeCalc.discount_amount;

      deliveryRecord = {
        id: 'del_' + crypto.randomBytes(6).toString('hex'),
        destination_address: (delivery && delivery.address) || 'Alamat Customer',
        destination_latitude: custLat,
        destination_longitude: custLng,
        actual_road_distance_meters: feeCalc.distance_meters,
        actual_duration_seconds: road.duration_seconds,
        chargeable_distance_km: feeCalc.chargeable_distance_km,
        free_km_applied: feeCalc.free_km,
        rate_per_km_applied: feeCalc.price_per_km,
        delivery_fee_calculated: feeCalc.base_delivery_fee
      };
    }

    // 3. Dine-in Table Validation and Concurrency Hold
    let tableIdsToHold = [];
    if (order_type === 'dine_in') {
      const { DiningTableService } = require('../../domains/pos');
      const reqTableIds = Array.isArray(req.body.table_ids) ? req.body.table_ids : [];
      if (reqTableIds.length === 0 && table_number) {
        // Resolve table_id from table_number if table_ids array not directly sent
        const tblRow = db.prepare('SELECT id FROM branch_tables WHERE branch_id = ? AND (table_number = ? OR label = ?)').get(branch.id, table_number, table_number);
        if (tblRow) reqTableIds.push(tblRow.id);
      }

      if (reqTableIds.length > 0) {
        // Authoritatively check availability
        const availCheck = DiningTableService.validateTablesAvailable(branch.id, reqTableIds);
        if (!availCheck.valid) {
          return res.status(400).json({
            success: false,
            status: 'TABLE_UNAVAILABLE',
            error: availCheck.error,
            unavailable_table_id: availCheck.unavailable_table_id
          });
        }
        tableIdsToHold = reqTableIds;
      }
    }

    // R-Recipient Identity Layer: resolve authoritative recipient snapshot.
    // SELF = authenticated customer identity (from session — never trusted from client).
    // OTHER = validated recipient name + WhatsApp/mobile phone supplied by client.
    // Recipient ≠ buyer; stored as order snapshot, independent of addresses.
    const incomingRecipient = (req.body && req.body.recipient) || {};
    const isOther = !!incomingRecipient && incomingRecipient.type === 'other';
    let recipientName = (customerSession.name || customer.name || 'Pelanggan');
    let recipientPhone = (customerSession.phone || customer.phone || '');
    let recipient;
    if (isOther) {
      const rName = String(incomingRecipient.name || '').trim();
      const rawPhone = String(incomingRecipient.phone || '').trim();
      const clean = rawPhone.replace(/[^0-9]/g, '');
      const isIndoMobile = clean.startsWith('08') || clean.startsWith('628') || clean.startsWith('8');
      if (!rName) {
        return res.status(400).json({ success: false, error: 'Nama penerima wajib diisi.' });
      }
      if (!rawPhone || !isIndoMobile || clean.length < 9 || clean.length > 15) {
        return res.status(400).json({ success: false, error: 'Nomor WhatsApp/telepon penerima tidak valid.' });
      }
      recipientName = rName;
      recipientPhone = rawPhone;
      recipient = { type: 'other', name: rName, phone: rawPhone };
    } else {
      recipient = { type: 'self', name: recipientName, phone: recipientPhone };
    }

    // 4. Delegate Cleanly to OrderPlacementService (ACID database transaction & event publishing)
    const OrderPlacementService = require('../../domains/commerce/services/OrderPlacementService');
    const placementResult = await OrderPlacementService.submitOrder({
      brand_id: req.brand_id,
      branch_id: branch.id,
      client_transaction_id: req.body.client_transaction_id || req.body.clientTransactionId || null,
      customer: {
        id: customerSession.customerId || customerSession.customer_id || null,
        name: customer.name.trim(),
        phone: customer.phone.trim()
      },
      recipient,
      items,
      delivery_fee: deliveryFee,
      discount_amount: discountAmount,
      delivery_record: deliveryRecord,
      fulfillment_schedule_type: schedule_type,
      scheduled_slot_start: scheduled_slot_start || null,
      scheduled_slot_end: scheduled_slot_end || null,
      payment_method,
      cash_tendered: parsedCashTendered,
      order_channel: 'customer_app',
      order_type,
      selection_mode,
      table_number,
      reservation_date,
      guest_count,
      pwa_runtime,
      notes: order_note,
      trace_context: {
        correlation_id: `chk_${Date.now()}`
      }
    });

    if (!placementResult.success) {
      const primaryError = (placementResult.errors && placementResult.errors[0]) || 'Gagal memproses pesanan.';
      return res.status(400).json({
        success: false,
        status: placementResult.status,
        error: primaryError,
        errors: placementResult.errors,
        price_diffs: placementResult.price_diffs
      });
    }

    const order = placementResult.order;
    const grandTotal = order.grand_total;
    const orderId = order.id;
    const orderNumber = order.order_number;
    const subtotal = order.subtotal;

    // 4a. Dine-in Table Hold for Payment Stage (15-minute hold) or Immediate Session for Cash
    if (order_type === 'dine_in' && tableIdsToHold.length > 0) {
      const { DiningTableService } = require('../../domains/pos');
      try {
        if (payment_method === 'midtrans') {
          DiningTableService.holdTablesForPayment({
            branch_id: branch.id,
            table_ids: tableIdsToHold,
            customer_phone: customer.phone,
            hold_reference_id: orderId
          });
        } else if (payment_method === 'cash') {
          DiningTableService.createOrAttachDiningSession({
            branch_id: branch.id,
            table_ids: tableIdsToHold,
            order_id: orderId,
            customer_name: customer.name,
            customer_phone: customer.phone,
            guest_count: guest_count || 1,
            hold_reference_id: null
          });
        }
      } catch (tblHoldErr) {
        console.warn('[Checkout Dine-In Table Hold Warning]:', tblHoldErr.message);
      }
    }

    // 4. Payment Gateway Resolution (Midtrans Snap or Cash)
    let snapResult = { snap_token: null, redirect_url: null, merchant_id: payment_method === 'cash' ? 'cash' : 'midtrans_default' };

    if (payment_method === 'midtrans') {
      const existingPayment = placementResult.idempotent
        ? db.prepare('SELECT snap_token, merchant_id FROM order_payments WHERE order_id = ?').get(orderId)
        : null;
      if (existingPayment && existingPayment.snap_token) {
        snapResult = {
          snap_token: existingPayment.snap_token,
          redirect_url: null,
          merchant_id: existingPayment.merchant_id || 'midtrans_default'
        };
      } else {
        try {
          snapResult = await PaymentService.createSnapTransaction(
            { id: orderId, grand_total: grandTotal, branch_id: branch.id, brand_id: req.brand_id, delivery_fee: deliveryFee, discount_amount: discountAmount },
            order ? order.items : items,
            customer
          );
        } catch (payErr) {
        console.error('[Payment Gateway Error / Timeout]:', payErr.message);
        // P1 RECONCILIATION-AWARE FAILURE HANDLING (NEW-01 & NEW-02):
        // Mark payment as 'reconciliation_pending' so if gateway actually processed the transaction,
        // incoming settlement webhook can reconcile and confirm the order cleanly.
        db.exec('BEGIN IMMEDIATE;');
        try {
          db.prepare("UPDATE order_payments SET payment_status = 'reconciliation_pending', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
          db.prepare("UPDATE orders SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(orderId);
          db.exec('COMMIT;');
        } catch (_) {
          try { db.exec('ROLLBACK;'); } catch (_) {}
        }
        return res.status(502).json({
          success: false,
          error: 'PAYMENT_GATEWAY_TIMEOUT',
          message: `Koneksi ke gateway pembayaran online mengalami kendala (${payErr.message}). Jika Anda sudah melakukan pembayaran, transaksi akan otomatis direkonsiliasi.`
        });
        }
      }
    }

    if (snapResult.snap_token || snapResult.merchant_id) {
      db.prepare(`
        UPDATE order_payments
        SET snap_token = ?, merchant_id = ?, updated_at = ?
        WHERE order_id = ?
      `).run(snapResult.snap_token || null, snapResult.merchant_id || (payment_method === 'cash' ? 'cash' : 'midtrans'), new Date().toISOString(), orderId);
    }

    res.status(201).json({
      success: true,
      order_id: orderId,
      order_number: orderNumber,
      grand_total: grandTotal,
      subtotal,
      delivery_fee: deliveryFee,
      discount_amount: discountAmount,
      cash_tendered: parsedCashTendered,
      expected_change: (payment_method === 'cash' && parsedCashTendered !== null) ? Math.max(0, parsedCashTendered - grandTotal) : null,
      payment: {
        method: payment_method,
        cash_tendered: parsedCashTendered,
        expected_change: (payment_method === 'cash' && parsedCashTendered !== null) ? Math.max(0, parsedCashTendered - grandTotal) : null,
        snap_token: snapResult.snap_token,
        redirect_url: snapResult.redirect_url
      },
      snap_token: snapResult.snap_token,
      redirect_url: snapResult.redirect_url,
      redirect: '/order-received/' + orderId
    });
  } catch (err) {
    console.error('[API] checkout error:', err);
    res.status(500).json({ success: false, error: err.message, message: err.message });
  }
});

// In-Memory Token & Session Store with TTL + Revocation Support
const TokenSessionStore = {
  sessions: new Map(),
  revokedTokens: new Set(),
  revokedUserIds: new Set(),
  createSession(user, brand_id, ttlSeconds = 86400) {
    const token = 'xnt_auth_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.sessions.set(token, {
      id: user.id,
      userId: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      full_name: user.full_name,
      role: user.role,
      brandId: brand_id,
      brand_id: brand_id,
      organizationId: user.organization_id || null,
      organization_id: user.organization_id || null,
      branchId: user.branch_id || null,
      branch_id: user.branch_id || null,
      status: user.status || 'active',
      email_verified: user.email_verified !== undefined ? Boolean(user.email_verified) : true,
      expiresAt
    });
    return { token, expiresAt };
  },
  createCustomerSession(phone, brand_id, ttlSeconds = 2592000, extra = {}) {
    const token = 'xnt_cust_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const customerId = (extra && (extra.customerId || extra.customer_id)) || null;
    let organizationId = (extra && (extra.organizationId || extra.organization_id)) || null;

    // Resolve authoritative brand organization if available
    let brandOrgId = null;
    if (brand_id) {
      try {
        const b = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(brand_id);
        if (b) brandOrgId = b.organization_id;
      } catch (_) {}
    }

    if (!organizationId) {
      organizationId = brandOrgId;
    }

    // Invariant: If customerId is provided, verify customer exists and belongs to the same organization
    if (customerId) {
      try {
        const cust = db.prepare('SELECT organization_id FROM customers WHERE id = ?').get(customerId);
        if (cust) {
          if (cust.organization_id && organizationId && String(cust.organization_id) !== String(organizationId)) {
            const err = new Error('Customer organization does not match session organization.');
            err.status = 403;
            err.code = 'CUSTOMER_ORGANIZATION_MISMATCH';
            throw err;
          }
          if (cust.organization_id && !organizationId) {
            organizationId = cust.organization_id;
          }
        }
      } catch (custErr) {
        if (custErr.code === 'CUSTOMER_ORGANIZATION_MISMATCH') throw custErr;
      }
    }

    // Invariant: Brand organization must match session organization
    if (brandOrgId && organizationId && String(brandOrgId) !== String(organizationId)) {
      const err = new Error('Brand organization does not match session organization.');
      err.status = 403;
      err.code = 'BRAND_ORGANIZATION_MISMATCH';
      throw err;
    }

    const sessionData = {
      type: 'customer',
      role: 'customer',
      customerId: customerId,
      customer_id: customerId,
      organizationId: organizationId,
      organization_id: organizationId,
      phone: phone ? phone.trim() : '',
      customerPhone: phone ? phone.trim() : '',
      brandId: brand_id,
      brand_id: brand_id,
      expiresAt
    };

    // Optional extra fields for Google-authenticated customers
    if (extra && typeof extra === 'object') {
      if (extra.name)       sessionData.name = String(extra.name);
      if (extra.email)      sessionData.email = String(extra.email);
      if (extra.google_sub) sessionData.google_sub = String(extra.google_sub);
    }

    this.sessions.set(token, sessionData);

    try {
      db.prepare(`
        INSERT OR REPLACE INTO customer_sessions (token, customer_id, organization_id, phone, brand_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(token, customerId, organizationId, phone ? phone.trim() : '', brand_id, expiresAt);
    } catch (dbErr) {
      console.error('[TokenSessionStore] Failed to persist customer session to SQLite:', dbErr.message);
    }

    return { token, expiresAt };
  },
  getSession(token) {
    if (!token) return null;
    if (this.revokedTokens.has(token)) return null;

    // L1: In-memory cache
    const cachedSession = this.sessions.get(token);
    if (cachedSession) {
      if (Date.now() > cachedSession.expiresAt) {
        this.sessions.delete(token);
        // Clean up expired in SQLite if it was customer token
        if (token.startsWith('xnt_cust_')) {
          try { db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token); } catch (_) {}
        }
        return null;
      }
      return cachedSession;
    }

    // L2: SQLite backing for customer sessions
    if (token.startsWith('xnt_cust_')) {
      try {
        const row = db.prepare('SELECT token, customer_id, organization_id, phone, brand_id, expires_at FROM customer_sessions WHERE token = ?').get(token);
        if (!row) return null;

        if (Date.now() > Number(row.expires_at)) {
          try { db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token); } catch (_) {}
          return null;
        }

        const hydrated = {
          type: 'customer',
          role: 'customer',
          customerId: row.customer_id || null,
          customer_id: row.customer_id || null,
          organizationId: row.organization_id || null,
          organization_id: row.organization_id || null,
          phone: row.phone,
          customerPhone: row.phone,
          brandId: row.brand_id,
          brand_id: row.brand_id,
          expiresAt: Number(row.expires_at)
        };
        // Hydrate L1 memory cache
        this.sessions.set(token, hydrated);
        return hydrated;
      } catch (dbErr) {
        console.error('[TokenSessionStore] SQLite session lookup failed:', dbErr.message);
        return null;
      }
    }

    return null;
  },
  destroySession(token) {
    if (token) {
      this.sessions.delete(token);
      this.revokedTokens.add(token);
      if (token.startsWith('xnt_cust_')) {
        try { db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token); } catch (_) {}
      }
    }
  },
  revokeUserSessions(userId) {
    this.revokedUserIds.add(userId);
    for (const [token, session] of this.sessions.entries()) {
      if (session.userId === userId || session.id === userId) {
        this.sessions.delete(token);
      }
    }
  },
  destroyAllUserSessions(userId) {
    this.revokeUserSessions(userId);
  }
};

// Expose globally for WorkforceService
global.TokenSessionStore = TokenSessionStore;

// Authoritative customer session organization authorization
function authorizeCustomerSession(session, req) {
  const reqOrgId = req.organization_id || (req.brand && req.brand.organization_id);
  if (!reqOrgId || !req.brand_id) {
    return {
      status: 403,
      error: 'TENANT_NOT_RESOLVED',
      message: 'Tenant tidak dapat diselesaikan secara otoritatif.'
    };
  }

  let sessionOrgId = session.organization_id || session.organizationId;
  const customerId = session.customerId || session.customer_id;

  // Verify against authoritative database records
  if (customerId) {
    try {
      const cust = db.prepare('SELECT id, organization_id FROM customers WHERE id = ?').get(customerId);
      if (!cust) {
        return {
          status: 401,
          error: 'CUSTOMER_NOT_FOUND',
          message: 'Data customer tidak ditemukan.'
        };
      }
      if (!sessionOrgId) {
        sessionOrgId = cust.organization_id;
        session.organization_id = cust.organization_id;
        session.organizationId = cust.organization_id;
      } else if (String(cust.organization_id) !== String(sessionOrgId)) {
        return {
          status: 403,
          error: 'TENANT_MISMATCH',
          message: 'Sesi customer tidak valid untuk organisasi ini.'
        };
      }
    } catch (dbErr) {
      console.error('[authorizeCustomerSession] Customer DB verification error:', dbErr.message);
      return {
        status: 500,
        error: 'DATABASE_ERROR',
        message: 'Gagal memverifikasi identitas customer.'
      };
    }
  } else if (!sessionOrgId && session.brandId) {
    // Legacy session fallback: resolve organization from session brand
    try {
      const b = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(session.brandId);
      if (b && b.organization_id) {
        sessionOrgId = b.organization_id;
        session.organization_id = b.organization_id;
        session.organizationId = b.organization_id;
      }
    } catch (_) {}
  }

  // Authoritative check: Customer Organization must match Request Organization
  if (!sessionOrgId || String(sessionOrgId) !== String(reqOrgId)) {
    return {
      status: 403,
      error: 'TENANT_MISMATCH',
      message: 'Sesi customer tidak valid untuk organisasi ini.'
    };
  }

  return { ok: true, sessionOrgId };
}

// Middleware: Require Authenticated Customer Session (Finding 1)
function requireCustomerAuth() {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'CUSTOMER_AUTH_REQUIRED',
        message: 'Akses ditolak: Sesi customer tidak ditemukan. Harap masuk terlebih dahulu untuk mengakses layanan ini.'
      });
    }

    const session = TokenSessionStore.getSession(token);
    if (!session || (session.type !== 'customer' && session.role !== 'customer')) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_CUSTOMER_SESSION',
        message: 'Sesi akun customer Anda tidak valid atau telah kedaluwarsa. Silakan masuk kembali untuk melanjutkan.'
      });
    }

    const authCheck = authorizeCustomerSession(session, req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({
        success: false,
        error: authCheck.error,
        message: authCheck.message
      });
    }

    req.customer = session;
    next();
  };
}

// Core Identity & RBAC Integration
const { IdentityModel, AuthorizationService } = require('../../core/identity');

// Middleware: Require Authenticated Token (Header-Only: Bearer token or x-auth-token)
function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Token otentikasi tidak ditemukan. Silakan login terlebih dahulu.'
      });
    }

    const session = TokenSessionStore.getSession(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Sesi Anda telah kedaluwarsa atau token tidak valid. Silakan login kembali.'
      });
    }

    // Platform Owner is platform-scoped and cannot access tenant-scoped operations as a merchant user
    if (session.role === 'platform_owner') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_TENANT_ACCESS',
        message: 'Platform Owner adalah akun platform-scoped dan tidak dapat mengakses operasi tenant secara langsung tanpa support context.'
      });
    }

    // P9-17 AUTHORITATIVE ACCOUNT STATUS ENFORCEMENT
    // A workforce account disabled/suspended AFTER login must not keep operating
    // with a pre-disable session. Status is read from the DB (authoritative),
    // never from client input or the cached session snapshot.
    if (session.userId) {
      const account = db.prepare('SELECT status FROM users WHERE id = ?').get(session.userId);
      if (account && account.status && account.status !== 'active') {
        return res.status(403).json({
          success: false,
          error: 'ACCOUNT_DISABLED',
          message: 'Akun Anda telah dinonaktifkan. Hubungi administrator.'
        });
      }
    }

    // P1 TENANT & ORGANIZATION BOUNDARY ENFORCEMENT via Core Identity
    let isTenantAuthorized = session.brandId === req.brand_id;
    const isInvitationAcceptRoute = req.path === '/invitations/accept' || (req.originalUrl && req.originalUrl.includes('/invitations/accept'));
    if (isInvitationAcceptRoute) {
      // Recipient is accepting an invitation to join a brand/workforce; tenant authorization is governed by invitation acceptance
      isTenantAuthorized = true;
    } else if (!isTenantAuthorized) {
      const isIdentityRoute = req.path === '/auth/merchant/me' || (req.originalUrl && req.originalUrl.includes('/auth/merchant/me')) ||
          req.path === '/auth/handoff/create' || (req.originalUrl && req.originalUrl.includes('/auth/handoff/create'));
      const isOnboardingRoute = session.role === 'owner' && (req.path.includes('/onboarding/') || (req.originalUrl && req.originalUrl.includes('/onboarding/')));
      if (isIdentityRoute || isOnboardingRoute) {
        // Safe profile, handoff generation, and owner business onboarding/setup choice
        isTenantAuthorized = true;
      } else if (session.role === 'owner' && session.organizationId && req.brand && req.brand.organization_id) {
        isTenantAuthorized = session.organizationId === req.brand.organization_id;
      }
    }

    if (!isTenantAuthorized) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_TENANT_ACCESS',
        message: 'Anda tidak memiliki akses ke tenant brand ini.'
      });
    }

    // Role check if specified
    if (allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Role Anda tidak memiliki izin untuk mengakses resource ini.'
      });
    }

    // EMAIL VERIFICATION ACCESS POLICY ENFORCEMENT
    // Exclude safe identity/verification-UX routes so unverified users can inspect their status, log out, resend, or accept workforce invitations
    const verificationExemptRoutes = ['/auth/merchant/me', '/auth/logout', '/auth/resend-verification', '/invitations/accept'];
    const isExemptRoute = verificationExemptRoutes.includes(req.path) || isInvitationAcceptRoute;

    if (!isExemptRoute && session.role === 'owner') {
      // Check verification status from session or authoritatively from DB if session claims unverified
      let isVerified = Boolean(session.email_verified);
      if (!isVerified) {
        const userRow = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(session.userId || session.id);
        if (userRow && userRow.email_verified_at) {
          isVerified = true;
          session.email_verified = true; // Heal session in place immediately
        }
      }

      if (!isVerified) {
        return res.status(403).json({
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          error: 'EMAIL_NOT_VERIFIED',
          message: 'Silakan verifikasi alamat email Anda terlebih dahulu untuk mengakses fitur operasional dashboard.'
        });
      }
    }

    // P1 BRANCH SCOPE BOUNDARY ENFORCEMENT (FINDING-01 & NEW-05)
    // Branch-level roles (branch_manager, cashier, kitchen) MUST be assigned to a branch and cannot access outside it
    const branchScopedRoles = ['branch_manager', 'cashier', 'kitchen'];
    if (branchScopedRoles.includes(session.role) && !isInvitationAcceptRoute) {
      if (!session.branchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_UNASSIGNED_BRANCH',
          message: 'Akses ditolak: Akun operator Anda belum ditugaskan ke cabang tertentu.'
        });
      }
      const requestedBranchId = req.query.branch_id || req.body?.branch_id || req.params?.branch_id;
      if (requestedBranchId && requestedBranchId !== session.branchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_ACCESS',
          message: 'Akses ditolak: Anda hanya memiliki izin untuk mengakses cabang yang ditugaskan.'
        });
      }
    }

    req.session = session;
    req.user = session;
    next();
  };
}

// Middleware: Require Authenticated Platform Owner (Header-Only: Bearer token or x-auth-token)
function requirePlatformAuth() {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Token otentikasi platform tidak ditemukan. Silakan login ke Control Plane.'
      });
    }

    const session = TokenSessionStore.getSession(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Sesi platform Anda telah kedaluwarsa atau tidak valid. Silakan login kembali.'
      });
    }

    // STRICT PLATFORM SCOPE ENFORCEMENT: Merchant Owner or other merchant roles CANNOT access
    if (session.role !== 'platform_owner') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_PLATFORM_ACCESS',
        message: 'Akses ditolak: Operasi ini membutuhkan kewenangan Platform Owner.'
      });
    }

    req.session = session;
    req.platformUser = session;
    next();
  };
}

// 6.0 Platform Owner Authentication Endpoint
router.post(['/platform/auth/login', '/api/v1/platform/auth/login'], (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    const identifier = (email || username || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Email/username dan password wajib diisi.'
      });
    }

    // Rate limiting: 5 attempts per 5 minutes per identifier/IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const rateLimitKey = `platform_login:${clientIp}:${identifier.toLowerCase()}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 5, 300);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak percobaan login platform. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    const { PlatformBootstrapService } = require('../../core/identity');
    const platformService = new PlatformBootstrapService(db);
    const authResult = platformService.authenticate(identifier, password);

    if (!authResult.success) {
      const statusCode = authResult.error === 'ACCOUNT_DISABLED' ? 403 : 401;
      return res.status(statusCode).json({
        success: false,
        error: authResult.error || 'INVALID_CREDENTIALS',
        message: authResult.message || 'Email atau password salah.'
      });
    }

    // Reset rate limiter on successful authentication
    RateLimiter.reset(rateLimitKey);

    const user = authResult.user;

    // Register active platform session in TokenSessionStore (brand_id is strictly null)
    const { token, expiresAt } = TokenSessionStore.createSession(user, null);

    res.json({
      success: true,
      message: 'Login Platform Owner berhasil.',
      token,
      expires_at: new Date(expiresAt).toISOString(),
      platform_user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        mfa_status: {
          mfa_enrolled: Boolean(user.mfa_enabled),
          mfa_required: true,
          mfa_ready: true,
          mfa_enforced: false,
          note: 'MFA readiness established. Enforcement is reserved for future implementation.'
        }
      }
    });
  } catch (err) {
    console.error('[Platform Login Error]:', err);
    res.status(500).json({
      success: false,
      error: 'PLATFORM_AUTH_ERROR',
      message: 'Terjadi kesalahan sistem pada autentikasi platform.'
    });
  }
});

// 6.1 Platform Control Plane Endpoints
router.get(['/platform/me', '/api/v1/platform/me'], requirePlatformAuth(), (req, res) => {
  try {
    const userRow = db.prepare(`
      SELECT id, username, email, full_name, role, status, mfa_enabled, mfa_enrolled_at, created_at, updated_at
      FROM users WHERE id = ?
    `).get(req.platformUser.id || req.platformUser.userId);

    if (!userRow) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
    }

    res.json({
      success: true,
      platform_user: {
        id: userRow.id,
        username: userRow.username,
        email: userRow.email,
        full_name: userRow.full_name,
        role: userRow.role,
        status: userRow.status,
        mfa_status: {
          mfa_enrolled: Boolean(userRow.mfa_enabled),
          mfa_required: true,
          mfa_ready: true,
          mfa_enforced: false, // Explicit: MFA is not claimed to be enforced yet
          note: 'MFA readiness established. Enforcement is reserved for future implementation.'
        },
        created_at: userRow.created_at,
        updated_at: userRow.updated_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Get Order Details & Live Status (Protected by Ownership or Operator Auth - NEW-01)
router.get('/orders/:id', (req, res) => {
  // P1 TENANT ISOLATION: Join branches to strictly verify brand ownership.
  // branch_name is included for P7.1 Branch Acceptance Waiting surface.
  const order = db.prepare(`
    SELECT o.*, b.brand_id, b.name AS branch_name
    FROM orders o
    JOIN branches b ON b.id = o.branch_id
    WHERE o.id = ? AND b.brand_id = ?
  `).get(req.params.id, req.brand_id);

  if (!order) {
    return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada brand ini.' });
  }

  // P1 HORIZONTAL & BRANCH AUTHORIZATION (IDOR Guard - NEW-01 & NEW-02):
  // Check if caller is authenticated staff/operator (with strict branch isolation) or authenticated customer
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();
  const session = token ? TokenSessionStore.getSession(token) : null;
  
  let isAuthorized = false;

  if (session) {
    if (session.type === 'customer' || session.role === 'customer') {
      // Customer must own the order by canonical customer_id and match tenant organization
      const custId = session.customerId || session.customer_id;
      const orderCustId = order.customer_id;
      const reqOrgId = req.organization_id || (req.brand && req.brand.organization_id);
      const sessionOrgId = session.organization_id || session.organizationId;
      const isOrgMatch = sessionOrgId && reqOrgId && String(sessionOrgId) === String(reqOrgId);

      if (isOrgMatch && order.brand_id === req.brand_id) {
        if (custId && orderCustId && String(custId) === String(orderCustId)) {
          isAuthorized = true;
        } else if (!orderCustId && !custId && session.phone && order.customer_phone && session.phone === order.customer_phone) {
          // Controlled legacy compatibility only when order has no customer_id and session is legacy unmigrated
          isAuthorized = true;
        }
      }
    } else if (['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'].includes(session.role)) {
      // Operator must match tenant brand
      let isBrandMatch = session.brandId === req.brand_id;
      if (!isBrandMatch && session.role === 'owner' && session.organizationId && req.brand?.organization_id) {
        isBrandMatch = session.organizationId === req.brand.organization_id;
      }

      if (isBrandMatch) {
        // Branch-scoped operator roles (branch_manager, cashier, kitchen) MUST match order's branch
        const branchScopedRoles = ['branch_manager', 'cashier', 'kitchen'];
        if (branchScopedRoles.includes(session.role)) {
          if (session.branchId === order.branch_id) {
            isAuthorized = true;
          }
        } else {
          // Brand-level roles (owner, brand_manager) can view all branches in the brand
          isAuthorized = true;
        }
      }
    }
  }

  if (!isAuthorized) {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN_ORDER_ACCESS',
      message: 'Akses ditolak: Anda tidak memiliki sesi terotentikasi yang sah untuk melihat detail pesanan ini.'
    });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const delivery = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);
  const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order.id);
  const logs = db.prepare('SELECT previous_status, new_status, note, created_at FROM order_status_logs WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

  // P1 INFORMATION HIDING & PRIVACY (NEW-01 & NEW-09):
  // Return clean DTO projection to prevent internal data/GPS leakage.
  // P7.2 BRANCH ACCEPTANCE SURFACE: branch_name, branch_id, acceptance_deadline_at
  // are exposed to support the awaiting-acceptance waiting screen.
  // acceptance_deadline_at is server-computed via AcceptanceTimeoutService (3-minute platform policy).
  // It is a DISPLAY timestamp only — the client countdown reaching zero never
  // transitions order state. Status is always fetched from server.
  const acceptanceDeadlineAt = AcceptanceTimeoutService.computeAcceptanceDeadlineAt(order);

  const safeOrder = {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    order_type: order.order_type,
    order_channel: order.order_channel,
    table_number: order.table_number,
    subtotal: order.subtotal,
    delivery_fee: order.delivery_fee,
    discount_amount: order.discount_amount,
    grand_total: order.grand_total,
    payment_method: order.payment_method,
    payment_status: order.payment_status || (payment ? payment.payment_status : 'pending'),
    cash_tendered: order.cash_tendered !== null && order.cash_tendered !== undefined ? Number(order.cash_tendered) : null,
    expected_change: (order.payment_method === 'cash' && order.cash_tendered !== null && order.cash_tendered !== undefined)
      ? Math.max(0, Number(order.cash_tendered) - Number(order.grand_total))
      : null,
    order_note: order.order_note,
    created_at: order.created_at,
    updated_at: order.updated_at,
    // P7.2: branch context for awaiting-acceptance surface
    branch_id: order.branch_id,
    branch_name: order.branch_name || null,
    // Recipient Identity Layer: order-level snapshot (projection only — the
    // columns are written at placement; later profile edits never mutate them).
    recipient_type: order.recipient_type || 'self',
    recipient_name: order.recipient_name || '',
    recipient_phone: order.recipient_phone || '',
    // Buyer identity as display fallback for pre-snapshot legacy orders only.
    customer_name: order.customer_name || '',
    customer_phone: order.customer_phone || '',
    // P7.2: server-authoritative acceptance deadline (display only, null when not pending)
    acceptance_deadline_at: acceptanceDeadlineAt
  };

  const safeItems = (items || []).map(it => ({
    id: it.id,
    product_id: it.product_id,
    product_name: it.product_name || it.name,
    unit_price: it.unit_price,
    quantity: it.quantity,
    item_subtotal: it.item_subtotal,
    note: it.note || '',
    // Reorder support: catalog image is not stored on order_items, so resolve
    // it live (branch override first, then canonical product). Read-only.
    image_url: (() => {
      try {
        const bp = order.branch_id && it.product_id
          ? db.prepare('SELECT product_image_url, image_override FROM branch_products WHERE branch_id = ? AND product_id = ?').get(order.branch_id, String(it.product_id))
          : null;
        if (bp && (bp.image_override || bp.product_image_url)) return bp.image_override || bp.product_image_url;
        const prod = it.product_id
          ? db.prepare('SELECT image_url, image FROM products WHERE id = ?').get(String(it.product_id))
          : null;
        if (prod && (prod.image_url || prod.image)) return prod.image_url || prod.image;
      } catch (_) {}
      return '';
    })()
  }));

  const safeDelivery = delivery ? {
    destination_address: delivery.destination_address,
    actual_road_distance_meters: delivery.actual_road_distance_meters,
    delivery_fee_calculated: delivery.delivery_fee_calculated,
    driver_name: delivery.driver_name || null,
    driver_phone: delivery.driver_phone || null,
    tracking_url: delivery.tracking_url || null,
    status: delivery.status || null
  } : null;

  const safePayment = payment ? {
    payment_method: payment.payment_method || payment.provider,
    payment_status: payment.payment_status,
    cash_tendered: order.cash_tendered !== null && order.cash_tendered !== undefined ? Number(order.cash_tendered) : null,
    expected_change: (order.payment_method === 'cash' && order.cash_tendered !== null && order.cash_tendered !== undefined)
      ? Math.max(0, Number(order.cash_tendered) - Number(order.grand_total))
      : null,
    snap_token: payment.snap_token || null,
    amount: payment.amount,
    settled_at: payment.settled_at,
    created_at: payment.created_at
  } : null;

  res.json({
    success: true,
    order: safeOrder,
    items: safeItems,
    delivery: safeDelivery,
    payment: safePayment,
    logs
  });
});

// 7.1 Customer Order History (Protected by Customer Auth)
router.get('/customer/orders', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    let orders;
    if (customerId) {
      // Canonical ownership: customer only sees orders explicitly belonging to their customer_id
      orders = db.prepare(`
        SELECT o.id, o.order_number, o.status, o.order_type, o.subtotal, o.delivery_fee, o.discount_amount,
               o.grand_total, o.payment_method, o.created_at, b.name as branch_name
        FROM orders o
        JOIN branches b ON b.id = o.branch_id
        WHERE b.brand_id = ? AND o.customer_id = ?
        ORDER BY o.created_at DESC
        LIMIT 50
      `).all(req.brand_id, customerId);
    } else {
      // Legacy session without customer_id: only access unlinked legacy orders with no customer_id
      orders = db.prepare(`
        SELECT o.id, o.order_number, o.status, o.order_type, o.subtotal, o.delivery_fee, o.discount_amount,
               o.grand_total, o.payment_method, o.created_at, b.name as branch_name
        FROM orders o
        JOIN branches b ON b.id = o.branch_id
        WHERE b.brand_id = ? AND o.customer_id IS NULL AND o.customer_phone = ?
        ORDER BY o.created_at DESC
        LIMIT 50
      `).all(req.brand_id, customerPhone);
    }

    const enriched = orders.map(ord => ({
      ...ord,
      items: db.prepare('SELECT id, product_name, quantity, unit_price, item_subtotal FROM order_items WHERE order_id = ?').all(ord.id)
    }));

    res.json({ success: true, orders: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Kitchen Display Queue (Strictly Tenant-Scoped & Branch-Scoped for Operator Roles)
router.get('/kitchen/queue', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  // If user is a branch-level operator, strictly enforce their assigned branch
  const effectiveBranchId = (['branch_manager', 'cashier', 'kitchen'].includes(req.user.role) && req.user.branchId)
    ? req.user.branchId
    : req.query.branch_id;

  let sql = `
    SELECT o.*, b.name as branch_name, b.brand_id
    FROM orders o
    JOIN branches b ON b.id = o.branch_id
    WHERE b.brand_id = ? AND o.status IN ('confirmed', 'preparing', 'ready')
  `;
  const params = [req.brand_id];

  if (effectiveBranchId) {
    sql += ' AND o.branch_id = ?';
    params.push(effectiveBranchId);
  }

  sql += ' ORDER BY o.created_at ASC';

  const orders = db.prepare(sql).all(...params);

  const enriched = orders.map((ord) => ({
    ...ord,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
    delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id)
  }));

  res.json({ success: true, orders: enriched });
});

// 9. Update Order Status (Kitchen / Operator with Auth Binding, Branch Guard & Role-Based Status Transitions)
router.patch('/kitchen/orders/:id/status', requireAuth(['owner', 'brand_manager', 'branch_manager', 'kitchen']), (req, res) => {
  try {
    const { status, note = '' } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: 'Status target wajib diisi.' });
    }

    // P1 ROLE-BASED TRANSITION AUTHORITY (FINDING-02A)
    // Kitchen role can ONLY advance operational cooking stages ('preparing', 'ready').
    // Manager/Owner can advance the operational fulfillment lifecycle
    // ('preparing' → 'ready' → 'out_for_delivery' → 'completed').
    // R5 BOUNDARY (CHECK-1/CHECK-4): ACCEPT ('confirmed') is EXCLUSIVELY served
    // by POST /orders/:id/branch-acceptance (branch_manager | brand_manager |
    // owner, audited [ACCEPT by <actor>], idempotent); this generic PATCH must
    // NOT offer 'confirmed' — payment/kitchen/generic flows must never silently
    // become Branch operational acceptance. 'cancelled' is likewise removed:
    // after ACCEPT, cancellation is NOT a generic normal operation — it is a
    // Branch Exception / recovery path (R8, later task) or payment-driven
    // failure. Customer cancellation is served by POST /orders/:id/cancel
    // (pending only). Financial/Refund state is EXCLUSIVELY handled via a
    // dedicated recovery flow.
    const ROLE_ALLOWED_TARGET_STATUSES = {
      kitchen: ['preparing', 'ready'],
      branch_manager: ['preparing', 'ready', 'out_for_delivery', 'completed'],
      brand_manager: ['preparing', 'ready', 'out_for_delivery', 'completed'],
      owner: ['preparing', 'ready', 'out_for_delivery', 'completed']
    };

    const allowedTargetStatuses = ROLE_ALLOWED_TARGET_STATUSES[req.user.role] || [];
    if (!allowedTargetStatuses.includes(status)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_ROLE_AUTHORITY',
        message: `Role "${req.user.role}" tidak memiliki wewenang untuk mengubah status pesanan menjadi "${status}".`
      });
    }

    // P1 AUTH BINDING: Use authoritative actor identity from authenticated session
    const actor_type = req.user.role === 'kitchen' ? 'kitchen' : 'staff';
    const actor_id = req.user.userId || req.user.username;

    // Verify order exists and belongs to current brand before transition
    let verifySql = `
      SELECT o.id, o.branch_id, b.brand_id 
      FROM orders o
      JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND b.brand_id = ?
    `;
    const verifyParams = [req.params.id, req.brand_id];

    // If branch operator, ensure order belongs to their assigned branch
    if (['branch_manager', 'cashier', 'kitchen'].includes(req.user.role) && req.user.branchId) {
      verifySql += ' AND o.branch_id = ?';
      verifyParams.push(req.user.branchId);
    }

    const existingOrder = db.prepare(verifySql).get(...verifyParams);

    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada kewenangan cabang Anda.' });
    }

    const result = OrderStateMachine.transition({
      order_id: req.params.id,
      target_status: status,
      actor_type,
      actor_id,
      note
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.0 R5 BRANCH ACCEPTANCE — operational acceptance boundary for an order
// awaiting branch acceptance (orders.status = 'pending').
//   ACCEPT → 'confirmed' (ACCEPTED — the locked operational acceptance state:
//           order valid, kitchen/fulfillment may proceed, inventory deducts)
//   REJECT → 'rejected' (REJECTED — terminal, DISTINCT from customer
//           cancellation 'cancelled')
// TIMEOUT is reserved for a separate timeout-worker task (not implemented).
// Decisions are server-authoritative, branch/brand-scoped, atomic
// (OrderStateMachine: BEGIN IMMEDIATE + compare-and-swap + audit log),
// auditable (order_status_logs: order, actor, previous/new state, decision,
// reason, timestamp), and idempotent for repeated identical decisions.
// A rejected branch is NEVER silently rematched to another branch, and an
// order with a settled payment cannot be branch-rejected (refund flow first).
router.post('/orders/:id/branch-acceptance', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { decision, reason = '', note = '' } = req.body;
    if (!decision || !['accept', 'reject'].includes(decision)) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_DECISION',
        error: 'decision wajib bernilai "accept" atau "reject".'
      });
    }

    const targetStatus = decision === 'accept' ? 'confirmed' : 'rejected';
    if (decision === 'reject' && !String(reason || '').trim()) {
      return res.status(400).json({
        success: false,
        status: 'REASON_REQUIRED',
        error: 'Alasan penolakan cabang (reason) wajib diisi untuk audit.'
      });
    }

    // Branch scope: branch_manager acts ONLY on their assigned branch;
    // brand_manager/owner are brand-wide. Never trust a client branch_id.
    const verifySql = `
      SELECT o.id, o.branch_id, o.status, b.brand_id
      FROM orders o
      JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND b.brand_id = ?
      ${(req.user.role === 'branch_manager' && req.user.branchId) ? ' AND o.branch_id = ?' : ''}
    `;
    const verifyParams = [req.params.id, req.brand_id];
    if (req.user.role === 'branch_manager' && req.user.branchId) verifyParams.push(req.user.branchId);

    const order = db.prepare(verifySql).get(...verifyParams);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada kewenangan cabang Anda.' });
    }

    // Idempotency: repeating the SAME decision on an order already in the
    // target state is a safe no-op (no state change, no duplicate audit).
    if (order.status === targetStatus) {
      return res.json({
        success: true,
        order_id: order.id,
        decision,
        previous_status: order.status,
        new_status: order.status,
        idempotent: true
      });
    }

    const actorLabel = req.user.role + ':' + (req.user.username || req.user.userId || 'actor');
    const actorNote = decision === 'accept'
      ? `[ACCEPT by ${actorLabel}] ${note ? note : ''}`.trim()
      : `[REJECT by ${actorLabel}] ${String(reason).trim()}`;

    const result = OrderStateMachine.transition({
      order_id: order.id,
      target_status: targetStatus,
      actor_type: 'branch_actor',
      actor_id: req.user.userId || req.user.username,
      note: actorNote
    });

    res.json({ success: true, decision, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.0.1 R7 CUSTOMER CANCELLATION — a customer may cancel ONLY an order still
// awaiting branch acceptance (orders.status = 'pending'). ACCEPTED
// ('confirmed') and later orders may NOT be customer-cancelled here (branch
// exception / refund are later tasks), and REJECTED / TIMEOUT / CANCELLED
// orders are terminal. Server-side enforcement: UI restrictions alone are
// insufficient. Actor semantics are never client-classified: the audit log
// records actor_type 'customer' + the AUTHENTICATED phone (from the OTP
// session — never from the request body) with a [CUSTOMER_CANCEL] note, so
// CUSTOMER_CANCEL stays distinct from BRANCH_REJECT, BRANCH_TIMEOUT,
// SYSTEM_CANCEL, and PAYMENT_FAILURE.
router.post('/orders/:id/cancel', requireCustomerAuth(), (req, res) => {
  try {
    const reason = String(req.body.reason || req.body.note || '').trim();
    const order = db.prepare('SELECT id, status, customer_id, customer_phone FROM orders WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan.' });
    }
    const custId = req.customer.customerId || req.customer.customer_id;
    const isOwner = (custId && order.customer_id && String(custId) === String(order.customer_id)) ||
                    (!custId && !order.customer_id && req.customer.phone && order.customer_phone && String(req.customer.phone) === String(order.customer_phone));
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_ORDER_OWNERSHIP',
        message: 'Anda hanya dapat membatalkan pesanan milik Anda sendiri.'
      });
    }

    if (order.status !== 'pending') {
      const hint = order.status === 'confirmed'
        ? 'Pesanan sudah diterima cabang dan tidak dapat dibatalkan oleh customer pada tahap ini.'
        : `Pesanan sudah berstatus "${order.status}" dan tidak dapat dibatalkan lagi.`;
      return res.status(400).json({
        success: false,
        status: 'CUSTOMER_CANCEL_NOT_ALLOWED',
        error: hint
      });
    }

    const result = OrderStateMachine.transition({
      order_id: order.id,
      target_status: 'cancelled',
      actor_type: 'customer',
      actor_id: req.customer.phone,
      note: `[CUSTOMER_CANCEL]${reason ? ' ' + reason : ''}`,
      // R11 TOCTOU GUARD: re-validated INSIDE the machine transaction — if a
      // branch ACCEPT (or timeout) committed between the pre-check above and
      // this transaction, the order is no longer pending and the cancel must
      // fail ([STATE_CHANGED]) instead of cancelling an ACCEPTED order.
      expected_current_status: 'pending'
    });

    res.json({ success: true, decision: 'customer_cancel', ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.1 Staff / POS Cash Settlement Endpoint (Authorized Cashiers, Branch Managers, & Brand Owners)
router.post('/pos/orders/:id/settle-cash', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const orderId = req.params.id;
    const { amount_tendered, shift_id } = req.body;

    // Canonical Session Identity Resolution
    const cashierId = req.user ? (req.user.id || req.user.userId) : null;
    const userBranchId = req.user ? (req.user.branch_id || req.user.branchId) : null;

    // Scope & Branch Boundary Enforcement
    let verifySql = 'SELECT * FROM orders WHERE id = ? AND brand_id = ?';
    const verifyParams = [orderId, req.brand_id];

    if (req.user && ['branch_manager', 'cashier'].includes(req.user.role) && userBranchId) {
      verifySql += ' AND branch_id = ?';
      verifyParams.push(userBranchId);
    }

    const order = db.prepare(verifySql).get(...verifyParams);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Pesanan tidak ditemukan atau berada di luar kewenangan cabang Anda.'
      });
    }

    let effectiveShiftId = null;

    // P1 SHIFT RESOLUTION & OVERRIDE POLICY (NEW-04):
    // Cashier MUST use their own active shift on the order's branch.
    // Branch manager / Owner can supply explicit shift_id if it belongs to the same branch.
    if (req.user.role === 'cashier') {
      const activeShift = db.prepare(`
        SELECT id FROM pos_shifts 
        WHERE cashier_id = ? AND branch_id = ? AND status = 'open' 
        ORDER BY opened_at DESC LIMIT 1
      `).get(cashierId, order.branch_id);

      if (activeShift) {
        effectiveShiftId = activeShift.id;
      } else {
        return res.status(400).json({
          success: false,
          error: 'Kasir belum membuka shift aktif. Harap buka shift kasir terlebih dahulu sebelum menerima pembayaran tunai.'
        });
      }
    } else {
      if (shift_id) {
        const checkShift = db.prepare('SELECT id, branch_id FROM pos_shifts WHERE id = ?').get(shift_id);
        if (!checkShift || checkShift.branch_id !== order.branch_id) {
          return res.status(400).json({
            success: false,
            error: 'Shift yang ditentukan tidak valid atau tidak cocok dengan cabang pesanan ini.'
          });
        }
        effectiveShiftId = shift_id;
      }
    }

    // P1 EXPLICIT CASHIER ASSERTION: amount_tendered is strictly required (no silent inference)
    if (amount_tendered === undefined || amount_tendered === null || !Number.isFinite(Number(amount_tendered)) || Number(amount_tendered) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Nominal uang yang diterima (amount_tendered) wajib diisi dengan angka positif yang valid.'
      });
    }

    // Authoritative Domain Settlement Execution (Single Source of Truth)
    const { CashSettlementService } = require('../../domains/payment');
    const result = CashSettlementService.settleCashPayment({
      order_id: orderId,
      amount: Number(order.grand_total),
      amount_tendered: Number(amount_tendered),
      cashier_id: cashierId,
      shift_id: effectiveShiftId
    });

    res.json({
      success: true,
      message: result.message || 'Pembayaran tunai berhasil diselesaikan.',
      idempotent: !!result.idempotent,
      payment: result
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.2 POS Shift Management Endpoints (Strictly Authorized Cashiers, Branch Managers & Owners)
router.get('/pos/shifts/current', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const cashierId = req.user.id || req.user.userId;
    const userRole = req.user.role;
    const userBranchId = (['cashier', 'branch_manager'].includes(userRole))
      ? (req.user.branch_id || req.user.branchId)
      : (req.user.branch_id || req.user.branchId || req.query.branch_id);
    const targetCashierId = (['owner', 'brand_manager', 'branch_manager'].includes(userRole) && req.query.cashier_id)
      ? req.query.cashier_id
      : cashierId;

    if (!userBranchId) {
      return res.status(400).json({ success: false, error: 'Parameter branch_id wajib disertakan.' });
    }

    const shift = db.prepare(`
      SELECT * FROM pos_shifts 
      WHERE cashier_id = ? AND branch_id = ? AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1
    `).get(targetCashierId, userBranchId);

    res.json({
      success: true,
      has_active_shift: !!shift,
      shift: shift || null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/pos/shifts/open', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const cashierId = req.user.id || req.user.userId;
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    const { starting_float = 0, branch_id: requestedBranchId, cashier_id: requestedCashierId } = req.body;

    let targetBranchId = userBranchId || requestedBranchId;
    let targetCashierId = cashierId;

    // P1 ROLE-BASED BRANCH ENFORCEMENT (NEW-03)
    if (userRole === 'cashier') {
      if (userBranchId && requestedBranchId && requestedBranchId !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Kasir hanya berwenang membuka shift di cabang yang ditugaskan (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId || requestedBranchId;
      targetCashierId = cashierId; // Cashier cannot open shift on behalf of other cashiers
    } else if (userRole === 'branch_manager') {
      if (userBranchId && requestedBranchId && requestedBranchId !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Manajer cabang hanya berwenang membuka shift di cabang yang ditugaskan (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId || requestedBranchId;
      if (requestedCashierId) {
        targetCashierId = requestedCashierId;
      } else {
        const branchCashier = db.prepare('SELECT id FROM users WHERE branch_id = ? AND role = "cashier" LIMIT 1').get(targetBranchId);
        if (!branchCashier) {
          return res.status(400).json({ success: false, error: 'Parameter cashier_id (user dengan role "cashier") wajib disertakan untuk membuka shift.' });
        }
        targetCashierId = branchCashier.id;
      }
    } else if (['owner', 'brand_manager'].includes(userRole)) {
      targetBranchId = requestedBranchId || userBranchId;
      if (requestedCashierId) {
        targetCashierId = requestedCashierId;
      } else {
        const branchCashier = db.prepare('SELECT id FROM users WHERE branch_id = ? AND role = "cashier" LIMIT 1').get(targetBranchId);
        if (!branchCashier) {
          return res.status(400).json({ success: false, error: 'Parameter cashier_id (user dengan role "cashier") wajib disertakan untuk membuka shift.' });
        }
        targetCashierId = branchCashier.id;
      }
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'Cabang (branch_id) wajib disertakan untuk membuka shift.' });
    }

    // Verify branch belongs to authenticated brand
    const branchCheck = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(targetBranchId, req.brand_id);
    if (!branchCheck) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const { PosShiftService } = require('../../domains/pos');
    const shift = PosShiftService.openShift({
      branch_id: targetBranchId,
      cashier_id: targetCashierId,
      starting_float: Number(starting_float) || 0
    });

    res.status(201).json({
      success: true,
      message: 'Shift kasir berhasil dibuka.',
      shift
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/shifts/:id/cash-movement', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const shiftId = req.params.id;
    const { type, amount, reason = '' } = req.body;

    const cashierId = req.user.id || req.user.userId;
    const userBranchId = req.user.branch_id || req.user.branchId;

    // Strict Shift Tenant & Ownership Verification
    const shift = db.prepare(`
      SELECT s.*, b.brand_id 
      FROM pos_shifts s
      JOIN branches b ON b.id = s.branch_id
      WHERE s.id = ? AND b.brand_id = ?
    `).get(shiftId, req.brand_id);

    if (!shift) {
      return res.status(404).json({ success: false, error: 'Shift tidak ditemukan pada brand ini.' });
    }

    // P1 SHIFT MUTATION RBAC & OWNERSHIP GUARD (NEW-01)
    if (req.user.role === 'cashier') {
      if (shift.cashier_id !== cashierId || (userBranchId && shift.branch_id !== userBranchId)) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Kasir hanya berwenang mencatat mutasi kas pada shift miliknya sendiri.'
        });
      }
    } else if (req.user.role === 'branch_manager') {
      if (userBranchId && shift.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Manajer cabang hanya berwenang mengelola shift di cabang yang ditugaskan.'
        });
      }
    }

    if (!type || !['in', 'out'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Tipe mutasi kas wajib "in" atau "out".' });
    }
    if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Jumlah uang (amount) harus berupa angka positif.' });
    }

    const { PosShiftService } = require('../../domains/pos');
    const updatedShift = PosShiftService.recordCashMovement({
      shift_id: shiftId,
      type,
      amount: Number(amount),
      reason: String(reason),
      actor_id: cashierId,
      actor_role: req.user.role
    });

    res.json({
      success: true,
      message: `Mutasi kas (${type === 'in' ? 'Cash In' : 'Cash Out'}) berhasil dicatat.`,
      shift: updatedShift
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/shifts/:id/close', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const shiftId = req.params.id;
    const { actual_cash } = req.body;

    const cashierId = req.user.id || req.user.userId;
    const userBranchId = req.user.branch_id || req.user.branchId;

    // Strict Shift Tenant & Ownership Verification
    const shift = db.prepare(`
      SELECT s.*, b.brand_id 
      FROM pos_shifts s
      JOIN branches b ON b.id = s.branch_id
      WHERE s.id = ? AND b.brand_id = ?
    `).get(shiftId, req.brand_id);

    if (!shift) {
      return res.status(404).json({ success: false, error: 'Shift tidak ditemukan pada brand ini.' });
    }

    // P1 SHIFT CLOSING RBAC & OWNERSHIP GUARD (NEW-01 & NEW-02)
    if (req.user.role === 'cashier') {
      if (shift.cashier_id !== cashierId || (userBranchId && shift.branch_id !== userBranchId)) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Kasir hanya berwenang menutup shift miliknya sendiri.'
        });
      }
    } else if (req.user.role === 'branch_manager') {
      if (userBranchId && shift.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Manajer cabang hanya berwenang menutup shift di cabang yang ditugaskan.'
        });
      }
    }

    if (actual_cash === undefined || actual_cash === null || !Number.isFinite(Number(actual_cash)) || Number(actual_cash) < 0) {
      return res.status(400).json({
        success: false,
        error: 'Nominal kas fisik aktual (actual_cash) wajib diisi dengan angka valid.'
      });
    }

    const { PosShiftService } = require('../../domains/pos');
    const closedShift = PosShiftService.closeShift({
      shift_id: shiftId,
      actual_cash: Number(actual_cash),
      actor_id: cashierId,
      actor_role: req.user.role
    });

    res.json({
      success: true,
      message: 'Shift kasir berhasil ditutup.',
      shift: closedShift
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.3 POS Offline Synchronization Endpoints (F05)
router.post('/pos/offline-sync', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    // F05 Security Invariant: authorized branch scope cannot be bypassed by client-supplied branch_id
    if (['cashier', 'branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang melakukan sinkronisasi untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'Cabang (branch_id) wajib ditentukan.' });
    }

    const { OfflineReconciliationService } = require('../../domains/pos');
    const result = await OfflineReconciliationService.reconcileOfflineTransaction({
      ...req.body,
      brand_id: req.brand_id,
      branch_id: targetBranchId
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/offline-sync/batch', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    if (['cashier', 'branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang melakukan sinkronisasi untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'Cabang (branch_id) wajib ditentukan.' });
    }

    const { OfflineReconciliationService } = require('../../domains/pos');
    const result = await OfflineReconciliationService.processBatchSync({
      branch_id: targetBranchId,
      transactions: req.body.transactions || []
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.4 POS Phase 1: Local Operational Foundation Endpoints
router.post('/pos/terminal/register', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    if (['branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang mendaftarkan terminal untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'Cabang (branch_id) wajib ditentukan.' });
    }

    const { PosLocalOperationService } = require('../../domains/pos');
    const terminal = PosLocalOperationService.registerTerminal({
      branch_id: targetBranchId,
      device_name: req.body.device_name,
      device_identifier: req.body.device_identifier,
      config_version: req.body.config_version || 1
    });

    res.json({ success: true, terminal });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/local/sale', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    if (['cashier', 'branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang mencatat penjualan untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    const { PosLocalOperationService } = require('../../domains/pos');
    const result = PosLocalOperationService.recordOfflineSale({
      ...req.body,
      brand_id: req.brand_id,
      branch_id: targetBranchId
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/local/sync-outbox', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    if (['cashier', 'branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang menyinkronkan antrean untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    const { PosLocalOperationService } = require('../../domains/pos');
    const result = await PosLocalOperationService.syncOutboxQueue({
      terminal_id: req.body.terminal_id,
      branch_id: targetBranchId
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/inventory-conflicts/:id/resolve', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { PosLocalOperationService } = require('../../domains/pos');
    const result = PosLocalOperationService.resolveInventoryConflict({
      conflict_id: req.params.id,
      resolution_decision: req.body.resolution_decision,
      resolved_by: req.user.id || req.user.username || 'manager',
      reason: req.body.reason
    });

    res.json({ success: true, conflict: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 10. Midtrans Webhook
router.post('/webhooks/midtrans', (req, res) => {
  try {
    const result = PaymentService.handleWebhook(req.body);
    res.json(result);
  } catch (err) {
    console.error('[Webhook] Midtrans error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 10.0 SaaS Control Plane Business Registration Endpoint
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, full_name, business_name, brand_name, branch_name, phone, address_text } = req.body;

    // Rate limiting: 5 registration attempts per 10 minutes per IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const rateLimitKey = `register:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 5, 600);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak permintaan pendaftaran. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    const { RegistrationService, WorkforceService } = require('../../core/identity');
    const registration = new RegistrationService();
    const result = await registration.registerBusiness({
      email,
      password,
      full_name,
      business_name,
      brand_name,
      branch_name,
      phone,
      address_text
    });

    // Create session token for newly registered owner
    const sessionUser = {
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      full_name: result.user.full_name,
      role: 'owner',
      brand_id: result.brand.id,
      organization_id: result.organization.id,
      branch_id: result.branch.id,
      status: 'active',
      email_verified: false
    };

    const { token, expiresAt } = TokenSessionStore.createSession(sessionUser, null);

    // Audit log
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: result.user.id,
      actor_role: 'owner',
      action: 'BUSINESS_REGISTERED',
      target_user_id: result.user.id,
      target_role: 'owner',
      brand_id: result.brand.id,
      organization_id: result.organization.id,
      branch_id: result.branch.id,
      result: 'success',
      metadata: { email: result.user.email, org_name: result.organization.name }
    });

    res.status(201).json({
      success: true,
      message: 'Pendaftaran bisnis berhasil.',
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: result.user,
      organization: result.organization,
      brand: result.brand,
      branch: result.branch
    });
  } catch (err) {
    const status = err.status || 500;
    const errorMsg = err.message || 'Terjadi kesalahan sistem saat pendaftaran.';
    res.status(status).json({
      success: false,
      code: err.code || 'REGISTRATION_ERROR',
      error: errorMsg
    });
  }
});

// 10.0.0b SaaS Identity-Only Registration (email signup without business setup)
// Used by the new signup UX — business name collected later on /onboarding
router.post('/auth/register-identity', (req, res) => {
  try {
    const { email, password, full_name } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        error: 'Email dan password wajib diisi.'
      });
    }

    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const cleanEmail = String(email).trim().toLowerCase();
    const rateLimitKey = `register:${cleanEmail}:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 5, 600);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak permintaan pendaftaran. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    const { RegistrationService } = require('../../core/identity');
    const registration = new RegistrationService();
    const result = registration.registerIdentity({ email, password, full_name });

    const sessionUser = {
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      full_name: result.user.full_name,
      role: 'owner',
      brand_id: null,
      organization_id: null,
      branch_id: null,
      status: 'active',
      email_verified: false
    };

    const { token, expiresAt } = TokenSessionStore.createSession(sessionUser, null);

    res.status(201).json({
      success: true,
      message: 'Akun berhasil dibuat. Silakan lanjutkan setup bisnis.',
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: result.user
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'REGISTRATION_ERROR',
      error: err.message || 'Terjadi kesalahan sistem saat pendaftaran.'
    });
  }
});

// 10.0.1 Email Verification Endpoints (GET /verify-email & POST /auth/verify-email)
const handleEmailVerification = (req, res) => {
  try {
    const rawToken = req.query.token || req.body.token;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        code: 'TOKEN_REQUIRED',
        error: 'Token verifikasi wajib disertakan.'
      });
    }

    const { EmailVerificationService, WorkforceService } = require('../../core/identity');
    const emailVerification = new EmailVerificationService();
    const result = emailVerification.verifyToken(rawToken);

    // Security event audit logging
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: result.userId,
      actor_role: result.role || 'owner',
      action: 'EMAIL_VERIFIED',
      target_user_id: result.userId,
      target_role: result.role || 'owner',
      brand_id: result.brandId,
      organization_id: result.organizationId,
      result: 'success',
      metadata: { email: result.email, verified_at: result.verifiedAt }
    });

    res.json({
      success: true,
      message: 'Email berhasil diverifikasi.',
      email: result.email,
      verified_at: result.verifiedAt
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'VERIFICATION_FAILED',
      error: err.message || 'Verifikasi email gagal.'
    });
  }
};

router.get('/verify-email', handleEmailVerification);
router.get('/auth/verify-email', handleEmailVerification);
router.post('/auth/verify-email', handleEmailVerification);

// 10.0.2 Resend Email Verification Endpoint
router.post('/auth/resend-verification', async (req, res) => {
  try {
    let targetEmail = req.body && req.body.email;

    if (!targetEmail) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();
      if (token) {
        const session = TokenSessionStore.getSession(token);
        if (session && session.email) {
          targetEmail = session.email;
        }
      }
    }

    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        code: 'EMAIL_REQUIRED',
        error: 'Alamat email wajib disertakan.'
      });
    }

    // Rate limiting: 3 resend attempts per 15 minutes per email/IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const cleanEmail = String(targetEmail).trim().toLowerCase();
    const rateLimitKey = `resend-verify:${cleanEmail}:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 3, 900);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak permintaan kirim ulang. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    const { EmailVerificationService } = require('../../core/identity');
    const emailVerification = new EmailVerificationService();
    const result = await emailVerification.resendVerificationEmail(cleanEmail);

    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'RESEND_FAILED',
      error: err.message || 'Gagal mengirim ulang email verifikasi.'
    });
  }
});

// GET /auth/merchant/me: Authenticated operator/merchant profile
router.get('/auth/merchant/me', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id || req.user.userId,
      username: req.user.username,
      email: req.user.email,
      full_name: req.user.full_name,
      role: req.user.role,
      brand_id: req.user.brandId || req.user.brand_id,
      organization_id: req.user.organizationId || req.user.organization_id,
      branch_id: req.user.branchId || req.user.branch_id,
      email_verified: req.user.email_verified
    },
    ...landingPayload(req.user.role)
  });
});

// 10.1 Merchant Auth Endpoints

// ── Unified login: role resolution ─────────────────────────────────────────
// ONE place decides where an authenticated user lands. Authentication is the
// same for every role; only authorization and the landing surface differ.
// Surfaces must not be chosen from the URL: each surface compares its own path
// against the landing resolved here.
//
// KDS is an optional SaaS capability. It is OFF in MVP, so the smallest
// entitlement contract is a single server-side flag — no plugin framework.
const KDS_ENTITLED = process.env.XENTRA_KDS_ENABLED === '1';

function resolveLanding(role) {
  switch (role) {
    case 'branch_manager':
      return '/merchant/';
    case 'kitchen':
      // The kitchen surface exists only when the capability is enabled. It has
      // no route while the capability is off, so it cannot be a landing target.
      return KDS_ENTITLED ? '/kitchen/' : '/owner/';
    case 'cashier':
      // Cashier is branch-scoped but has no dedicated surface in MVP.
      return '/owner/';
    case 'owner':
    case 'brand_manager':
    default:
      return '/owner/';
  }
}

function landingPayload(role) {
  return { landing: resolveLanding(role), entitlements: { kds: KDS_ENTITLED } };
}
const handleMerchantLogin = (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username dan password wajib diisi.' });
    }

    // Rate limiting: 5 attempts per 5 minutes per username+brand
    const rateLimitKey = `login:${req.brand_id}:${username}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 5, 300);
    if (!rateCheck.allowed) {
      return res.status(429).json({ 
        success: false, 
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak percobaan login. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    // Use WorkforceService for authentication (bcrypt + account lockout + status check)
    const { WorkforceService } = require('../../core/identity');
    const workforce = new WorkforceService();
    const authResult = workforce.authenticate(username, password, req.brand_id);

    if (!authResult.success) {
      // Log failed attempt
      workforce.logSecurityEvent({
        action: 'LOGIN_FAILED',
        brand_id: req.brand_id,
        result: 'failure',
        metadata: { username, reason: authResult.error }
      });

      const statusCode = authResult.error === 'ACCOUNT_DISABLED' ? 403 : 
                         authResult.error === 'ACCOUNT_LOCKED' ? 423 : 401;
      return res.status(statusCode).json({ 
        success: false, 
        error: authResult.error === 'INVALID_CREDENTIALS' ? 'Username atau password salah.' : authResult.message 
      });
    }

    const user = authResult.user;
    const effectiveBrandId = req.brand_id || user.brand_id;

    // B1 BRANCH/BRAND INTEGRITY: branch-scoped operator must reference owned branch
    if (user.branch_id && effectiveBrandId) {
      const ownedBranch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(user.branch_id, effectiveBrandId);
      if (!ownedBranch) {
        return res.status(401).json({
          success: false,
          error: 'BRANCH_TENANT_MISMATCH',
          message: 'Akun operator tidak terdaftar pada cabang brand ini. Hubungi pemilik brand.'
        });
      }
    }

    // Register active session in TokenSessionStore
    const { token, expiresAt } = TokenSessionStore.createSession(user, effectiveBrandId);

    // Reset rate limiter on successful login
    RateLimiter.reset(rateLimitKey);

    // If on control plane (xentra.cloud) and brand has a custom_domain, issue handoff ticket
    let handoffInfo = null;
    const host = req.headers.host || '';
    const cleanHost = host.split(':')[0].trim().toLowerCase();
    if (cleanHost === 'xentra.cloud' && effectiveBrandId) {
      const brandRow = db.prepare('SELECT id, custom_domain FROM brands WHERE id = ?').get(effectiveBrandId);
      if (brandRow && brandRow.custom_domain) {
        const { HandoffService } = require('../../core/identity');
        const handoffService = new HandoffService(db);
        try {
          handoffInfo = handoffService.createTicket({
            userId: user.id,
            brandId: brandRow.id,
            ttlSeconds: 60
          });
        } catch (_) {}
      }
    }

    // Log successful login
    workforce.logSecurityEvent({
      actor_id: user.id,
      actor_role: user.role,
      action: 'LOGIN_SUCCESS',
      brand_id: effectiveBrandId,
      result: 'success'
    });

    const loginResponse = {
      success: true,
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        branch_id: user.branch_id || null,
        email_verified: user.email_verified,
        brand_name: (req.brand && req.brand.name) ? req.brand.name : 'Bangjo Resto'
      }
    };

    loginResponse.landing = resolveLanding(user.role);
    loginResponse.entitlements = { kds: KDS_ENTITLED };

    if (handoffInfo) {
      loginResponse.handoff_ticket = handoffInfo.ticket;
      loginResponse.redirect_url = handoffInfo.redirect_url;
    }

    res.json(loginResponse);
  } catch (err) {
    console.error('[Merchant Auth Error]:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan sistem saat autentikasi.' });
  }
};

router.post('/auth/merchant/login', handleMerchantLogin);
router.post('/auth/login', handleMerchantLogin);

// 10.2 Google Authentication & Account Linking Endpoints
const GoogleAuthService = require('../services/GoogleAuthService');
const { AuthProviderService } = require('../../core/identity');

// In-memory store for short-lived Google account linking tokens.
// These tokens are issued by /auth/google/link-init and consumed by /auth/google (link_token mode).
// Each token is single-use, bound to an authenticated user, and expires in 5 minutes.
if (!global.__googleLinkTokens) {
  global.__googleLinkTokens = new Map();
}
const GoogleLinkTokenStore = global.__googleLinkTokens;

// POST /auth/google: Google-First Authentication
router.post('/auth/google', async (req, res) => {
  try {
    const { credential, id_token } = req.body || {};
    const rawToken = credential || id_token;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_GOOGLE_CREDENTIAL',
        error: 'Credential token Google wajib dikirim.'
      });
    }

    const googleAuth = new GoogleAuthService();
    const verifiedClaims = await googleAuth.verifyIdToken(rawToken);

    // Rate limiting: 10 attempts per 5 minutes per Google sub + IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const rateLimitKey = `google-auth:${verifiedClaims.sub}:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 10, 300);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        code: 'TOO_MANY_REQUESTS',
        error: `Terlalu banyak percobaan autentikasi Google. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    const authProviderService = new AuthProviderService();

    // link_token mode: issued by /auth/google/link-init for authenticated users who want to link Google.
    // This path links the verified Google sub to the pre-authenticated Xentra user and then creates a session.
    // The link_token is single-use, short-lived (5 minutes), and strictly bound to the user who created it.
    const { link_token, return_to } = req.body || {};
    if (link_token) {
      const linkEntry = GoogleLinkTokenStore.get(link_token);
      if (!linkEntry || linkEntry.used || Date.now() > linkEntry.expiresAt) {
        // Remove stale entry
        if (linkEntry) GoogleLinkTokenStore.delete(link_token);
        return res.status(401).json({
          success: false,
          code: 'INVALID_LINK_TOKEN',
          error: 'Link token tidak valid atau telah kedaluwarsa. Silakan mulai proses penghubungan ulang.'
        });
      }
      // Mark consumed immediately (single-use)
      linkEntry.used = true;
      GoogleLinkTokenStore.delete(link_token);

      // Verify that the user from the link token still exists and is active
      const linkUser = db.prepare('SELECT id, brand_id, organization_id, branch_id, username, email, full_name, role, status FROM users WHERE id = ?').get(linkEntry.userId);
      if (!linkUser || linkUser.status !== 'active') {
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_DISABLED',
          error: 'Akun pengguna tidak aktif atau tidak ditemukan.'
        });
      }

      // Check that Google email is verified before linking
      if (!verifiedClaims.email_verified) {
        return res.status(400).json({
          success: false,
          code: 'UNVERIFIED_GOOGLE_EMAIL',
          error: 'Email akun Google belum diverifikasi oleh Google. Tidak dapat menghubungkan akun.'
        });
      }

      // Link the verified Google sub to the authenticated user (idempotent)
      let linkResult;
      try {
        linkResult = authProviderService.linkProvider({
          userId: linkUser.id,
          provider: 'google',
          providerUserId: verifiedClaims.sub,
          email: verifiedClaims.email,
          metadata: {
            name: verifiedClaims.name,
            picture: verifiedClaims.picture,
            linked_via: 'broker_link_mode'
          }
        });
      } catch (linkErr) {
        if (linkErr.code === 'PROVIDER_ALREADY_LINKED') {
          // Already linked to a different user — security reject
          return res.status(409).json({
            success: false,
            code: 'PROVIDER_ALREADY_LINKED',
            error: 'Akun Google ini telah terhubung ke akun Xentra lain. Gunakan akun Google yang berbeda.'
          });
        }
        throw linkErr;
      }

      // Log security audit
      const workforceLink = new WorkforceService();
      workforceLink.logSecurityEvent({
        actor_id: linkUser.id,
        actor_role: linkUser.role,
        action: 'GOOGLE_ACCOUNT_LINKED',
        target_user_id: linkUser.id,
        target_role: linkUser.role,
        brand_id: linkEntry.brandId || linkUser.brand_id,
        organization_id: linkUser.organization_id,
        branch_id: linkUser.branch_id,
        result: 'success',
        metadata: {
          sub: verifiedClaims.sub,
          email: verifiedClaims.email,
          already_linked: linkResult.alreadyLinked,
          linked_via: 'broker_link_mode'
        }
      });

      // Create session for the now-linked user
      const effectiveBrandId = linkEntry.brandId || linkUser.brand_id;
      const { token: linkSessionToken, expiresAt: linkSessionExpiry } = TokenSessionStore.createSession(linkUser, effectiveBrandId);

      // If return_to is provided, create handoff ticket to return user to tenant
      let linkHandoffInfo = null;
      if (return_to) {
        try {
          const { HandoffService } = require('../../core/identity');
          const handoffSvc = new HandoffService(db);
          linkHandoffInfo = handoffSvc.createTicket({
            userId: linkUser.id,
            returnTo: return_to,
            ttlSeconds: 60
          });
        } catch (_) { /* if handoff fails, fall back to direct token */ }
      }

      RateLimiter.reset(rateLimitKey);

      const linkPayload = {
        success: true,
        linked: true,
        already_linked: linkResult.alreadyLinked || false,
        token: linkSessionToken,
        expires_at: new Date(linkSessionExpiry).toISOString(),
        user: {
          id: linkUser.id,
          username: linkUser.username,
          email: linkUser.email,
          full_name: linkUser.full_name,
          role: linkUser.role,
          branch_id: linkUser.branch_id || null,
          brand_name: (req.brand && req.brand.name) ? req.brand.name : 'Bangjo Resto'
        }
      };
      if (linkHandoffInfo) {
        linkPayload.handoff_ticket = linkHandoffInfo.ticket;
        linkPayload.redirect_url = linkHandoffInfo.redirect_url;
      }
      return res.json(linkPayload);
    }

    // Normal login or Invitation acceptance mode:
    // Check if invitation_token was supplied (e.g. invited team member signing in via Google for first time)
    const { invitation_token } = req.body || {};

    let identity = null;
    let acceptResult = null;

    if (invitation_token) {
      // Validate invitation and perform atomic onboarding via verified Google credential
      const invitationService = new WorkforceInvitationService();
      acceptResult = invitationService.acceptInvitationWithGoogle({
        rawToken: invitation_token,
        verifiedGoogleClaims: verifiedClaims
      });

      // Now lookup newly created / reconciled identity
      identity = authProviderService.findIdentity('google', verifiedClaims.sub);
      if (!identity && acceptResult.user) {
        identity = {
          userId: acceptResult.user_id,
          user: acceptResult.user
        };
      }
    } else {
      identity = authProviderService.findIdentity('google', verifiedClaims.sub);
    }

    if (!identity) {
      return res.status(404).json({
        success: false,
        code: 'ACCOUNT_NOT_LINKED',
        error: 'Akun Google belum terhubung ke akun Xentra.',
        google: {
          sub: verifiedClaims.sub,
          email: verifiedClaims.email,
          email_verified: verifiedClaims.email_verified
        }
      });
    }

    const user = identity.user;

    // Check account active status
    if (user.status === 'disabled') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DISABLED',
        error: 'Akun telah dinonaktifkan. Hubungi administrator.'
      });
    }

    // Tenant / Branch boundary checks
    // If tenant brand is provided on request host/context, verify accessibility
    if (req.brand_id && user.brand_id && user.brand_id !== req.brand_id) {
      // If user is owner, check organization match
      let isAllowed = false;
      if (user.role === 'owner' && user.organization_id && req.brand && req.brand.organization_id) {
        isAllowed = user.organization_id === req.brand.organization_id;
      }
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_TENANT_ACCESS',
          error: 'Akun Anda tidak memiliki akses ke tenant brand ini.'
        });
      }
    }

    // Branch check if branch-scoped operator
    const effectiveBrandId = req.brand_id || user.brand_id;
    if (user.branch_id && effectiveBrandId) {
      const ownedBranch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(user.branch_id, effectiveBrandId);
      if (!ownedBranch) {
        return res.status(401).json({
          success: false,
          code: 'BRANCH_TENANT_MISMATCH',
          error: 'Akun operator tidak terdaftar pada cabang brand ini.'
        });
      }
    }

    // Register active session using existing TokenSessionStore
    const { token, expiresAt } = TokenSessionStore.createSession(user, effectiveBrandId);

    // Reset rate limiter on success
    RateLimiter.reset(rateLimitKey);

    // If return_to is provided, create a short-lived single-use handoff ticket
    let handoffInfo = null;
    if (return_to) {
      const { HandoffService } = require('../../core/identity');
      const handoffService = new HandoffService(db);
      try {
        handoffInfo = handoffService.createTicket({
          userId: user.id,
          returnTo: return_to,
          ttlSeconds: 60
        });
      } catch (_) {}
    }

    // If on control plane (xentra.cloud) without a valid return_to, but the brand has a custom_domain,
    // generate a cross-domain handoff ticket so the user lands on their tenant dashboard
    const host = req.headers.host || '';
    const cleanHost = host.split(':')[0].trim().toLowerCase();
    if (!handoffInfo && cleanHost === 'xentra.cloud' && effectiveBrandId) {
      const brandRow = db.prepare('SELECT id, custom_domain FROM brands WHERE id = ?').get(effectiveBrandId);
      if (brandRow && brandRow.custom_domain) {
        const { HandoffService } = require('../../core/identity');
        const handoffService = new HandoffService(db);
        try {
          handoffInfo = handoffService.createTicket({
            userId: user.id,
            brandId: brandRow.id,
            ttlSeconds: 60
          });
        } catch (_) {}
      }
    }

    // Log security audit event
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: user.id,
      actor_role: user.role,
      action: 'GOOGLE_LOGIN_SUCCESS',
      brand_id: handoffInfo ? handoffInfo.brand_id : effectiveBrandId,
      organization_id: user.organization_id,
      branch_id: user.branch_id,
      result: 'success',
      metadata: {
        sub: verifiedClaims.sub,
        email: verifiedClaims.email,
        has_handoff: Boolean(handoffInfo)
      }
    });

    const responsePayload = {
      success: true,
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        branch_id: user.branch_id || null,
        email_verified: user.email_verified,
        brand_name: (req.brand && req.brand.name) ? req.brand.name : 'Bangjo Resto'
      }
    };

    if (acceptResult) {
      responsePayload.is_new_user = Boolean(acceptResult.is_new_user);
      responsePayload.invitation_accepted = true;
      // Invited workforce members always go to dashboard, never to /onboarding
      responsePayload.redirect_url = handoffInfo ? handoffInfo.redirect_url : '/dashboard/';
    }

    if (handoffInfo) {
      responsePayload.handoff_ticket = handoffInfo.ticket;
      responsePayload.redirect_url = handoffInfo.redirect_url;
    }

    res.json(responsePayload);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'GOOGLE_AUTH_ERROR',
      error: err.message || 'Terjadi kesalahan saat autentikasi Google.'
    });
  }
});

// POST /auth/google-onboard: Google-First Business Registration & Onboarding
// Used when an unlinked Google account completes onboarding on xentra.cloud
router.post('/auth/google-onboard', async (req, res) => {
  try {
    const { credential, id_token, business_name, brand_name, branch_name, phone, address_text } = req.body || {};
    const rawToken = credential || id_token;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_GOOGLE_CREDENTIAL',
        error: 'Credential token Google wajib dikirim.'
      });
    }

    const googleAuth = new GoogleAuthService();
    const verifiedClaims = await googleAuth.verifyIdToken(rawToken);

    // Rate limiting: 5 onboarding registrations per 10 minutes per email/IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const cleanEmail = String(verifiedClaims.email || '').trim().toLowerCase();
    const rateLimitKey = `google-onboard:${cleanEmail}:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 5, 600);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        code: 'TOO_MANY_REQUESTS',
        error: `Terlalu banyak permintaan onboarding. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    // Email must be verified by Google
    if (!verifiedClaims.email_verified) {
      return res.status(400).json({
        success: false,
        code: 'UNVERIFIED_GOOGLE_EMAIL',
        error: 'Email akun Google belum diverifikasi oleh Google. Tidak dapat melakukan pendaftaran.'
      });
    }

    // Check if domain is specified and already exists to prevent duplicate tenant creation
    const domainToCheck = req.body.custom_domain || req.body.domain;
    if (domainToCheck) {
      const { ExistingTenantResolver } = require('../../core/identity');
      const tenantResolverService = new ExistingTenantResolver(db);
      const existingTenant = tenantResolverService.resolveByDomain(domainToCheck);
      if (existingTenant) {
        return res.status(409).json({
          success: false,
          code: 'TENANT_ALREADY_EXISTS',
          error: `Domain "${existingTenant.custom_domain}" sudah terdaftar untuk bisnis "${existingTenant.business_name}". Silakan gunakan alur Klaim Bisnis (Adoption).`,
          existing_business: {
            business_name: existingTenant.business_name,
            custom_domain: existingTenant.custom_domain
          }
        });
      }
    }

    const { RegistrationService, WorkforceService, AuthProviderService } = require('../../core/identity');
    const authProviderService = new AuthProviderService(db);
    const existingIdentity = authProviderService.findIdentity('google', verifiedClaims.sub);
    const hasBusinessName = !!(business_name || brand_name);

    if (existingIdentity) {
      if (hasBusinessName) {
        return res.status(409).json({
          success: false,
          code: 'PROVIDER_ALREADY_LINKED',
          error: 'Akun Google ini sudah terhubung ke akun pengguna Xentra lain.'
        });
      }
      const user = existingIdentity.user;
      const { token, expiresAt } = TokenSessionStore.createSession(user, user.brand_id || null);
      RateLimiter.reset(rateLimitKey);
      return res.json({
        success: true,
        message: 'Google auth berhasil.',
        token,
        expires_at: new Date(expiresAt).toISOString(),
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          branch_id: user.branch_id || null,
          email_verified: user.email_verified,
          brand_name: (req.brand && req.brand.name) ? req.brand.name : null
        },
        organization: null,
        brand: null,
        branch: null
      });
    }

    const registration = new RegistrationService();
    let result;

    if (hasBusinessName) {
      result = registration.registerBusinessWithGoogle({
        googleSub: verifiedClaims.sub,
        email: verifiedClaims.email,
        full_name: verifiedClaims.name,
        picture: verifiedClaims.picture,
        business_name,
        brand_name,
        branch_name,
        phone,
        address_text
      });
    } else {
      // Check if user with this email already exists
      const existingEmailUser = db.prepare('SELECT id, username, email, full_name, role, status, email_verified_at, brand_id, organization_id, branch_id FROM users WHERE LOWER(email) = ?').get(verifiedClaims.email.toLowerCase());
      if (existingEmailUser) {
        authProviderService.linkProvider({
          userId: existingEmailUser.id,
          provider: 'google',
          providerUserId: verifiedClaims.sub,
          email: verifiedClaims.email
        });
        result = {
          user: {
            ...existingEmailUser,
            email_verified: true
          }
        };
      } else {
        result = registration.registerIdentityWithGoogle({
          googleSub: verifiedClaims.sub,
          email: verifiedClaims.email,
          full_name: verifiedClaims.name,
          picture: verifiedClaims.picture
        });
      }
    }

    // Create session token for the owner
    const sessionUser = {
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      full_name: result.user.full_name,
      role: result.user.role || 'owner',
      brand_id: result.user.brand_id || (result.brand && result.brand.id) || null,
      organization_id: result.user.organization_id || (result.organization && result.organization.id) || null,
      branch_id: result.user.branch_id || (result.branch && result.branch.id) || null,
      status: 'active',
      email_verified: true
    };

    const { token, expiresAt } = TokenSessionStore.createSession(sessionUser, sessionUser.brand_id);

    // Reset rate limiter on success
    RateLimiter.reset(rateLimitKey);

    // Security audit log
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: result.user.id,
      actor_role: result.user.role || 'owner',
      action: 'GOOGLE_BUSINESS_ONBOARDED',
      target_user_id: result.user.id,
      target_role: result.user.role || 'owner',
      brand_id: sessionUser.brand_id,
      organization_id: sessionUser.organization_id,
      branch_id: sessionUser.branch_id,
      result: 'success',
      metadata: {
        sub: verifiedClaims.sub,
        email: result.user.email,
        org_name: result.organization ? result.organization.name : null
      }
    });

    res.status(201).json({
      success: true,
      message: 'Onboarding akun dengan Google berhasil.',
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: {
        ...result.user,
        brand_name: result.brand ? result.brand.name : null
      },
      organization: result.organization || null,
      brand: result.brand || null,
      branch: result.branch || null
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'GOOGLE_ONBOARD_ERROR',
      error: err.message || 'Terjadi kesalahan saat onboarding Google.'
    });
  }
});


// POST /onboarding/create-business: Create new business for authenticated user
router.post(['/onboarding/create-business', '/api/v1/onboarding/create-business'], requireAuth(), async (req, res) => {
  try {
    const { business_name, brand_name, branch_name, phone, address_text } = req.body;
    const { RegistrationService } = require('../../core/identity');
    const registration = new RegistrationService();
    
    const result = registration.createBusinessForUser(req.user.id, {
      business_name,
      brand_name,
      branch_name,
      phone,
      address_text
    });

    req.user.brand_id = result.brand.id;
    req.user.organization_id = result.organization.id;
    req.user.branch_id = result.branch.id;
    
    const { token } = TokenSessionStore.createSession(req.user, result.brand.id);
    
    res.json({
      success: true,
      token,
      user: req.user,
      business: result.brand
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Gagal membuat bisnis.'
    });
  }
});

// POST /onboarding/check-domain: Check whether a business domain already exists on Xentra
router.post(['/onboarding/check-domain', '/api/v1/onboarding/check-domain'], async (req, res) => {
  try {
    const { domain } = req.body || {};
    if (!domain || typeof domain !== 'string' || !domain.trim()) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DOMAIN',
        message: 'Domain bisnis wajib diisi.'
      });
    }

    const { OwnershipClaimService } = require('../../core/identity');
    const claimService = new OwnershipClaimService(db);
    const result = claimService.checkDomain(domain);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'CHECK_DOMAIN_ERROR',
      message: err.message || 'Gagal memeriksa domain bisnis.'
    });
  }
});

// POST /onboarding/claim: Claim/Adopt an existing tenant without duplicating entities
router.post(['/onboarding/claim', '/api/v1/onboarding/claim'], async (req, res) => {
  try {
    const { domain, password, credential, id_token } = req.body || {};
    if (!domain || typeof domain !== 'string' || !domain.trim()) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DOMAIN',
        message: 'Domain bisnis wajib disertakan.'
      });
    }

    // Determine calling user:
    // 1. Authenticated session (Authorization: Bearer <token>)
    // 2. Google credential in payload
    let targetUserId = null;
    let targetEmail = null;

    const authHeader = req.headers['authorization'] || '';
    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();

    if (sessionToken) {
      const session = TokenSessionStore.getSession(sessionToken);
      if (session) {
        targetUserId = session.userId || session.id;
        targetEmail = session.email;
      }
    }

    // If no valid session token, check for Google credential in payload
    const rawGoogleToken = credential || id_token;
    if (!targetUserId && rawGoogleToken) {
      const googleAuth = new GoogleAuthService();
      const verified = await googleAuth.verifyIdToken(rawGoogleToken);
      if (!verified.email_verified) {
        return res.status(400).json({
          success: false,
          code: 'UNVERIFIED_GOOGLE_EMAIL',
          message: 'Email Google belum terverifikasi.'
        });
      }

      // Check if user exists with this Google sub or email
      const { AuthProviderService } = require('../../core/identity');
      const providerService = new AuthProviderService(db);
      const identity = providerService.findIdentity('google', verified.sub);

      if (identity) {
        targetUserId = identity.user.id;
        targetEmail = identity.user.email;
      } else {
        // Find by email or provision Xentra User
        const existingUser = db.prepare('SELECT id, email, status FROM users WHERE LOWER(email) = ?').get(verified.email.toLowerCase());
        if (existingUser) {
          targetUserId = existingUser.id;
          targetEmail = existingUser.email;
          // Link provider
          providerService.linkProvider({
            userId: targetUserId,
            provider: 'google',
            providerUserId: verified.sub,
            email: verified.email
          });
        } else {
          // Provision clean standalone user for claim
          const newUserId = 'usr_' + crypto.randomBytes(12).toString('hex');
          const randPw = crypto.randomBytes(32).toString('hex');
          const { WorkforceService } = require('../../core/identity');
          const wf = new WorkforceService();
          const pwHash = wf.hashPassword(randPw);
          const username = verified.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') + '_' + crypto.randomBytes(3).toString('hex');
          const now = new Date().toISOString();

          db.prepare(`
            INSERT INTO users (id, username, email, password_hash, full_name, role, status, email_verified_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?, ?, ?)
          `).run(newUserId, username, verified.email.toLowerCase(), pwHash, verified.name || 'Merchant Owner', now, now, now);

          providerService.linkProvider({
            userId: newUserId,
            provider: 'google',
            providerUserId: verified.sub,
            email: verified.email
          });

          targetUserId = newUserId;
          targetEmail = verified.email;
        }
      }
    }

    if (!targetUserId) {
      return res.status(401).json({
        success: false,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Sesi login Xentra atau kredensial Google diperlukan untuk mengklaim bisnis.'
      });
    }

    const { TenantOwnershipTransferService, HandoffService } = require('../../core/identity');
    const transferService = new TenantOwnershipTransferService(db);

    const claimResult = transferService.claimAndAttachTenant({
      userId: targetUserId,
      domain,
      password: password || null
    });

    // Create session token bound to the adopted brand
    const { token: tenantToken, expiresAt: tenantExpiresAt } = TokenSessionStore.createSession(claimResult.user, claimResult.business.brand_id);

    // Create cross-domain handoff ticket if custom domain exists
    let handoffInfo = null;
    if (claimResult.business.custom_domain) {
      const handoffService = new HandoffService(db);
      try {
        handoffInfo = handoffService.createTicket({
          userId: claimResult.user.id,
          brandId: claimResult.business.brand_id,
          ttlSeconds: 60
        });
      } catch (hErr) {
        console.warn('[Handoff creation during claim warn]:', hErr.message);
      }
    }

    res.json({
      success: true,
      message: claimResult.message,
      token: tenantToken,
      expires_at: new Date(tenantExpiresAt).toISOString(),
      redirect_url: handoffInfo ? handoffInfo.redirect_url : null,
      user: claimResult.user,
      business: claimResult.business
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'CLAIM_ERROR',
      error: err.message || 'Gagal memproses klaim bisnis.'
    });
  }
});

// POST /auth/handoff/create: Issue single-use, time-limited cross-domain handoff ticket
router.post('/auth/handoff/create', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), async (req, res) => {
  try {
    const { brand_id } = req.body || {};
    const targetBrandId = brand_id || req.user.brandId || req.brand_id;

    if (!targetBrandId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_BRAND_ID',
        error: 'Target brand_id wajib disertakan untuk pembuatan handoff.'
      });
    }

    const { HandoffService } = require('../../core/identity');
    const handoffService = new HandoffService(db);
    const userId = req.user.userId || req.user.id;

    const result = handoffService.createTicket({
      userId,
      brandId: targetBrandId,
      ttlSeconds: 60 // 60s TTL for secure cross-domain handoff
    });

    res.json({
      success: true,
      handoff_ticket: result.ticket,
      expires_at: result.expires_at,
      redirect_url: result.redirect_url,
      brand_id: result.brand_id,
      custom_domain: result.custom_domain
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'HANDOFF_CREATE_ERROR',
      error: err.message || 'Gagal membuat tiket handoff.'
    });
  }
});

// POST /auth/handoff/exchange: Consume handoff ticket and issue tenant session token
router.post('/auth/handoff/exchange', async (req, res) => {
  try {
    const { handoff_ticket, ticket } = req.body || {};
    const rawTicket = handoff_ticket || ticket;

    if (!rawTicket) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_TICKET',
        error: 'Tiket handoff wajib disertakan.'
      });
    }

    // Must be bound to a tenant domain context
    const targetBrandId = req.brand_id;
    if (!targetBrandId) {
      return res.status(400).json({
        success: false,
        code: 'TENANT_REQUIRED',
        error: 'Penukaran tiket handoff harus dilakukan pada domain tenant brand.'
      });
    }

    const { HandoffService, WorkforceService } = require('../../core/identity');
    const handoffService = new HandoffService(db);

    const consumed = handoffService.consumeTicket({
      ticket: rawTicket,
      targetBrandId
    });

    // Create brand-bound session in TokenSessionStore
    const { token, expiresAt } = TokenSessionStore.createSession(consumed.user, targetBrandId);

    // Audit log
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: consumed.user.id,
      actor_role: consumed.user.role,
      action: 'HANDOFF_SESSION_EXCHANGED',
      brand_id: targetBrandId,
      organization_id: consumed.organizationId,
      branch_id: consumed.user.branch_id,
      result: 'success',
      metadata: { userId: consumed.user.id, targetBrandId }
    });

    res.json({
      success: true,
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: {
        id: consumed.user.id,
        username: consumed.user.username,
        email: consumed.user.email,
        full_name: consumed.user.full_name,
        role: consumed.user.role,
        branch_id: consumed.user.branch_id || null,
        email_verified: consumed.user.email_verified,
        brand_name: (req.brand && req.brand.name) ? req.brand.name : 'Merchant Resto'
      },
      landing: resolveLanding(consumed.user.role),
      entitlements: { kds: KDS_ENTITLED }
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'HANDOFF_EXCHANGE_ERROR',
      error: err.message || 'Gagal menukarkan tiket handoff.'
    });
  }
});

// POST /auth/link-google: Explicit Google Account Linking for Authenticated User
router.post('/auth/link-google', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), async (req, res) => {
  try {
    const { credential, id_token } = req.body || {};
    const rawToken = credential || id_token;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_GOOGLE_CREDENTIAL',
        error: 'Credential token Google wajib dikirim.'
      });
    }

    const googleAuth = new GoogleAuthService();
    const verifiedClaims = await googleAuth.verifyIdToken(rawToken);

    // Explicit security requirement: email_verified must be true
    if (!verifiedClaims.email_verified) {
      return res.status(400).json({
        success: false,
        code: 'UNVERIFIED_GOOGLE_EMAIL',
        error: 'Email akun Google belum diverifikasi oleh Google. Tidak dapat menghubungkan akun.'
      });
    }

    // Invariant: Target user is ALWAYS derived strictly from the authenticated session, never request body!
    const targetUserId = req.user.userId || req.user.id;

    const authProviderService = new AuthProviderService();
    const linkResult = authProviderService.linkProvider({
      userId: targetUserId,
      provider: 'google',
      providerUserId: verifiedClaims.sub,
      email: verifiedClaims.email,
      metadata: {
        name: verifiedClaims.name,
        picture: verifiedClaims.picture
      }
    });

    // Log security audit event
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: targetUserId,
      actor_role: req.user.role,
      action: 'GOOGLE_ACCOUNT_LINKED',
      target_user_id: targetUserId,
      target_role: req.user.role,
      brand_id: req.user.brandId || req.brand_id,
      organization_id: req.user.organizationId,
      branch_id: req.user.branchId,
      result: 'success',
      metadata: {
        sub: verifiedClaims.sub,
        email: verifiedClaims.email,
        already_linked: linkResult.alreadyLinked
      }
    });

    res.json({
      success: true,
      message: linkResult.alreadyLinked
        ? 'Akun Google ini sudah terhubung ke akun Anda.'
        : 'Akun Google berhasil dihubungkan ke akun Xentra Anda.',
      provider: 'google',
      already_linked: linkResult.alreadyLinked,
      linked_at: new Date().toISOString()
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'LINK_GOOGLE_ERROR',
      error: err.message || 'Gagal menghubungkan akun Google.'
    });
  }
});

// GET /auth/config: Public auth provider client configuration

// POST /auth/google/link-init: Issue a short-lived single-use link token for Google account linking.
// Called by authenticated tenant users who want to link their Google account via the broker.
// The returned link_token is passed to the broker (/auth/broker?mode=link&link_token=...),
// which then calls /auth/google with both credential and link_token to complete the link.
// The link_token is bound to the authenticated user's ID and expires in 5 minutes.
// It is single-use and strictly server-validated; the user cannot escalate authorization via it.
router.post('/auth/google/link-init', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const brandId = req.user.brandId || req.user.brand_id || req.brand_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHENTICATED',
        error: 'Pengguna tidak terautentikasi.'
      });
    }

    // Verify user still exists and is active
    const user = db.prepare('SELECT id, status FROM users WHERE id = ?').get(userId);
    if (!user || user.status !== 'active') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DISABLED',
        error: 'Akun pengguna tidak aktif atau tidak ditemukan.'
      });
    }

    // Check if already linked to a Google account
    const authProviderService = new AuthProviderService();
    const linked = authProviderService.listLinkedProviders(userId);
    const alreadyLinked = linked.some(p => p.provider === 'google');
    if (alreadyLinked) {
      return res.status(409).json({
        success: false,
        code: 'GOOGLE_ALREADY_LINKED',
        error: 'Akun Anda sudah terhubung ke Google. Silakan login menggunakan Google atau hapus link terlebih dahulu.',
        already_linked: true
      });
    }

    // Issue link token: single-use, 5-minute TTL, bound to user and brand
    const crypto = require('crypto');
    const linkToken = 'xnt_glink_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    GoogleLinkTokenStore.set(linkToken, {
      token: linkToken,
      userId,
      brandId: brandId || null,
      expiresAt,
      used: false
    });

    return res.json({
      success: true,
      link_token: linkToken,
      expires_in: 300, // seconds
      expires_at: new Date(expiresAt).toISOString(),
      message: 'Link token berhasil dibuat. Gunakan token ini untuk menghubungkan akun Google melalui broker.'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      code: 'LINK_INIT_ERROR',
      error: err.message || 'Gagal membuat link token.'
    });
  }
});


router.get('/auth/config', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  res.json({
    success: true,
    google_enabled: Boolean(googleClientId),
    google_client_id: googleClientId || null
  });
});

// ==================== WORKFORCE MANAGEMENT ENDPOINTS ====================
const { WorkforceService, WorkforceInvitationService } = require('../../core/identity');

// Helper: extract workforce actor context from session
function getWorkforceActor(req) {
  return {
    actor_id: req.user.userId || req.user.id,
    actor_role: req.user.role,
    actor_branch_id: req.user.branchId || req.user.branch_id
  };
}

// List users within authorized scope
router.get('/admin/users', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { role, branch_id, status, limit, offset } = req.query;
    
    // Branch managers can only see users in their branch
    const filters = {};
    if (role) filters.role = role;
    if (status) filters.status = status;
    if (req.user.role === 'branch_manager') {
      filters.branch_id = req.user.branchId || req.user.branch_id;
    } else if (branch_id) {
      filters.branch_id = branch_id;
    }
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);

    const users = workforce.listUsers(req.brand_id, filters);
    res.json({ success: true, users });
  } catch (err) {
    console.error('[Admin Users List Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single user
router.get('/admin/users/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const user = workforce.getUser(req.params.id, req.brand_id);
    
    // Branch managers can only see users in their branch
    if (req.user.role === 'branch_manager' && user.branch_id !== (req.user.branchId || req.user.branch_id)) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
    }

    res.json({ success: true, user });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Create user
router.post('/admin/users', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const { username, email, password, full_name, role, branch_id } = req.body;

    // Authorization: determine what role/scope the actor can assign
    let allowedRoles = [];
    let targetBranchId = branch_id;

    if (actor.actor_role === 'owner') {
      allowedRoles = ['brand_manager', 'branch_manager', 'cashier', 'kitchen'];
    } else if (actor.actor_role === 'brand_manager') {
      allowedRoles = ['branch_manager', 'cashier', 'kitchen'];
    } else if (actor.actor_role === 'branch_manager') {
      allowedRoles = ['cashier'];
      targetBranchId = actor.actor_branch_id; // Force to own branch
    }

    if (!allowedRoles.includes(role)) {
      workforce.logSecurityEvent({
        ...actor,
        action: 'USER_CREATED',
        brand_id: req.brand_id,
        result: 'denied',
        metadata: { reason: 'FORBIDDEN_ROLE_CEILING', requested_role: role }
      });
      return res.status(403).json({ 
        success: false, 
        error: 'FORBIDDEN_ROLE_CEILING',
        message: 'Anda tidak memiliki izin untuk membuat akun dengan role ini.' 
      });
    }

    // Validate branch scope
    if (targetBranchId) {
      const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(targetBranchId, req.brand_id);
      if (!branch) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH' });
      }
      
      // Branch manager cannot assign to different branch
      if (actor.actor_role === 'branch_manager' && targetBranchId !== actor.actor_branch_id) {
        workforce.logSecurityEvent({
          ...actor,
          action: 'USER_CREATED',
          brand_id: req.brand_id,
          result: 'denied',
          metadata: { reason: 'FORBIDDEN_SCOPE_ESCALATION', requested_branch: targetBranchId }
        });
        return res.status(403).json({ success: false, error: 'FORBIDDEN_SCOPE_ESCALATION' });
      }
    }

    // Get organization_id from brand
    const brand = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(req.brand_id);
    
    const newUser = workforce.createUser({
      brand_id: req.brand_id,
      organization_id: brand.organization_id,
      branch_id: targetBranchId,
      username,
      email,
      password,
      full_name,
      role,
      created_by: actor.actor_id
    });

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_CREATED',
      target_user_id: newUser.id,
      target_role: role,
      brand_id: req.brand_id,
      organization_id: brand.organization_id,
      branch_id: targetBranchId,
      result: 'success',
      metadata: { username }
    });

    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Update user profile
router.put('/admin/users/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const target = workforce.getUser(req.params.id, req.brand_id);

    // Branch managers can only update Cashier in their branch
    if (actor.actor_role === 'branch_manager') {
      if (target.role !== 'cashier' || target.branch_id !== actor.actor_branch_id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const updated = workforce.updateUser(req.params.id, req.brand_id, req.body, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_UPDATED',
      target_user_id: target.id,
      target_role: target.role,
      brand_id: req.brand_id,
      result: 'success',
      metadata: { fields: Object.keys(req.body) }
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Disable user
router.post('/admin/users/:id/disable', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const disabled = workforce.disableUser(req.params.id, req.brand_id, actor);

    // Invalidate all sessions for the disabled user
    workforce.invalidateUserSessions(req.params.id);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_DISABLED',
      target_user_id: disabled.id,
      target_role: disabled.role,
      brand_id: req.brand_id,
      result: 'success'
    });

    res.json({ success: true, user: disabled });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Enable user
router.post('/admin/users/:id/enable', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const enabled = workforce.enableUser(req.params.id, req.brand_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_ENABLED',
      target_user_id: enabled.id,
      target_role: enabled.role,
      brand_id: req.brand_id,
      result: 'success'
    });

    res.json({ success: true, user: enabled });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Delete user (Owner only)
router.delete('/admin/users/:id', requireAuth(['owner']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const deleted = workforce.deleteUser(req.params.id, req.brand_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_DELETED',
      target_user_id: deleted.deleted_user_id,
      target_role: deleted.role,
      brand_id: req.brand_id,
      result: 'success',
      metadata: { deleted_user_name: deleted.deleted_user_name }
    });

    res.json({ success: true, message: 'Anggota tim berhasil dihapus.', ...deleted });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message, code: err.code });
  }
});

// Change user role (Owner only)
router.post('/admin/users/:id/role', requireAuth(['owner']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const { role } = req.body;

    const updated = workforce.changeUserRole(req.params.id, req.brand_id, role, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'ROLE_CHANGED',
      target_user_id: updated.id,
      target_role: role,
      brand_id: req.brand_id,
      result: 'success',
      metadata: { previous_role: updated.role }
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Change user branch scope
router.post('/admin/users/:id/scope', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const { branch_id } = req.body;

    const updated = workforce.changeUserScope(req.params.id, req.brand_id, branch_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'SCOPE_CHANGED',
      target_user_id: updated.id,
      target_role: updated.role,
      brand_id: req.brand_id,
      branch_id: branch_id,
      result: 'success',
      metadata: { previous_branch_id: updated.branch_id }
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// ==================== PASSWORD MANAGEMENT ====================

// Self password change
router.post('/auth/change-password', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ success: false, error: 'CURRENT_PASSWORD_REQUIRED' });
    }

    workforce.selfChangePassword(
      req.user.userId || req.user.id,
      req.brand_id,
      current_password,
      new_password,
      confirm_password
    );

    // Invalidate all sessions except current one (force re-login on other devices)
    const currentToken = req.headers['authorization']?.startsWith('Bearer ') 
      ? req.headers['authorization'].substring(7).trim()
      : req.headers['x-auth-token'];
    
    // Revoke all sessions for this user except the current one
    const userId = req.user.userId || req.user.id;
    for (const [token, session] of TokenSessionStore.sessions.entries()) {
      if ((session.userId === userId || session.id === userId) && token !== currentToken) {
        TokenSessionStore.sessions.delete(token);
      }
    }

    workforce.logSecurityEvent({
      actor_id: userId,
      actor_role: req.user.role,
      action: 'PASSWORD_CHANGED',
      brand_id: req.brand_id,
      result: 'success'
    });

    res.json({ success: true, message: 'Password berhasil diubah.' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Admin reset password (generates one-time token)
router.post('/admin/users/:id/reset-password', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const result = workforce.adminResetPassword(req.params.id, req.brand_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'PASSWORD_RESET_REQUESTED',
      target_user_id: req.params.id,
      brand_id: req.brand_id,
      result: 'success'
    });

    // NOTE: The raw reset token is returned ONCE to the administrator
    // who must securely transmit it to the target user.
    // It is NEVER logged or stored in plaintext.
    res.json({ 
      success: true, 
      reset_token: result.reset_token,
      expires_at: result.expires_at,
      message: 'Reset token berhasil dibagikan. Berikan token ini kepada pengguna secara aman.' 
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Complete password reset (using one-time token)
router.post('/auth/reset-password', (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ success: false, error: 'Token dan password baru wajib diisi.' });
    }

    const result = workforce.completePasswordReset(token, new_password);

    workforce.logSecurityEvent({
      action: 'PASSWORD_RESET_COMPLETED',
      target_user_id: result.user_id,
      brand_id: result.brand_id,
      result: 'success'
    });

    res.json({ success: true, message: 'Password berhasil direset. Silakan login dengan password baru.' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Logout
router.post('/auth/logout', (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();

    if (token) {
      const session = TokenSessionStore.getSession(token);
      if (session) {
        const workforce = new WorkforceService();
        workforce.logSecurityEvent({
          actor_id: session.userId || session.id,
          actor_role: session.role,
          action: 'LOGOUT',
          brand_id: req.brand_id,
          result: 'success'
        });
      }
      TokenSessionStore.destroySession(token);
    }

    res.json({ success: true, message: 'Berhasil logout.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Security audit log (Owner/Brand Manager only)
router.get('/admin/security-audit', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { action, actor_id, target_user_id, limit, offset } = req.query;

    const logs = workforce.getSecurityAuditLog(req.brand_id, {
      action,
      actor_id,
      target_user_id,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    });

    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper: sanitize invitation objects for the public REST API contract (prevents leaking internal provider errors or credentials)
function sanitizePublicInvitation(invitation) {
  if (!invitation || typeof invitation !== 'object') return invitation;
  const safe = { ...invitation };
  if (safe.delivery) {
    safe.delivery = {
      success: Boolean(safe.delivery.success),
      error: safe.delivery.success ? null : 'EMAIL_DELIVERY_FAILED'
    };
  }
  return safe;
}

// ==================== WORKFORCE INVITATIONS (PHASE 3) ====================
// Create workforce invitation
router.post('/admin/invitations', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const actor = getWorkforceActor(req);
    const { email, role, branch_id } = req.body;

    const brand = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(req.brand_id);
    if (!brand) {
      return res.status(404).json({ success: false, error: 'BRAND_NOT_FOUND', message: 'Brand not found.' });
    }

    const invitation = await invitationService.createInvitation({
      actor,
      email,
      role,
      brand_id: req.brand_id,
      organization_id: brand.organization_id,
      branch_id
    });

    res.status(201).json({ success: true, invitation: sanitizePublicInvitation(invitation) });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'INVITATION_ERROR', message: err.message });
  }
});

// List workforce invitations for brand
router.get('/admin/invitations', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const { status, branch_id, role } = req.query;

    const effectiveBranchId = req.user.role === 'branch_manager'
      ? (req.user.branchId || req.user.branch_id)
      : branch_id;

    const invitations = invitationService.listInvitations(req.brand_id, {
      status,
      branch_id: effectiveBranchId,
      role
    });

    res.json({ success: true, invitations });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'LIST_ERROR', message: err.message });
  }
});

// Resend workforce invitation
router.post('/admin/invitations/:id/resend', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const actor = getWorkforceActor(req);

    const result = await invitationService.resendInvitation({
      actor,
      invitation_id: req.params.id
    });

    res.json({ success: true, invitation: sanitizePublicInvitation(result) });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'RESEND_ERROR', message: err.message });
  }
});

// Revoke workforce invitation
router.post('/admin/invitations/:id/revoke', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const actor = getWorkforceActor(req);

    const result = invitationService.revokeInvitation({
      actor,
      invitation_id: req.params.id
    });

    res.json({ success: true, invitation: result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'REVOKE_ERROR', message: err.message });
  }
});

// Validate workforce invitation token capability (Public capability check)
router.get('/invitations/validate/:token', (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const result = invitationService.validateInvitationToken(req.params.token);
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.code || 'VALIDATION_ERROR', message: err.message });
  }
});

// Accept workforce invitation (Phase 4: Authenticated recipient acceptance)
// Client cannot supply or alter role/brand/branch; derived strictly from invitation record
const handleAcceptInvitation = async (req, res) => {
  try {
    const invitationService = new WorkforceInvitationService();
    const authenticatedUser = req.user;
    const { token } = req.body || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Token undangan wajib diisi.'
      });
    }

    const result = invitationService.acceptInvitation({
      authenticatedUser,
      rawToken: token
    });

    let redirectUrl = '/dashboard/';
    const host = req.headers.host || '';
    const cleanHost = host.split(':')[0].trim().toLowerCase();
    if (result.brand_id && cleanHost === 'xentra.cloud') {
      const brandRow = db.prepare('SELECT id, custom_domain FROM brands WHERE id = ?').get(result.brand_id);
      if (brandRow && brandRow.custom_domain) {
        const { HandoffService } = require('../../core/identity');
        const handoffService = new HandoffService(db);
        try {
          const ticketInfo = handoffService.createTicket({
            userId: authenticatedUser.id || authenticatedUser.userId,
            brandId: brandRow.id,
            ttlSeconds: 60
          });
          redirectUrl = ticketInfo.redirect_url;
        } catch (_) {}
      }
    }

    res.json({ success: true, redirect_url: redirectUrl, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      error: err.code || 'ACCEPT_ERROR',
      message: err.message
    });
  }
};

router.post('/invitations/accept', requireAuth(), handleAcceptInvitation);
router.post('/admin/invitations/accept', requireAuth(), handleAcceptInvitation);

// ==================== END WORKFORCE MANAGEMENT ====================

// P1 DATA SANITIZATION HELPER (SEC-02 & FINDING 10)
function serializePublicBrand(brand) {
  if (!brand) return null;
  let banners = [];
  const hasExplicitBanners = brand.banners !== null && brand.banners !== undefined && brand.banners !== '';
  if (hasExplicitBanners) {
    try {
      banners = typeof brand.banners === 'string' ? JSON.parse(brand.banners) : brand.banners;
    } catch (_) {
      banners = [];
    }
    if (!Array.isArray(banners)) banners = [];
  } else {
    banners = [
      {
        id: 'banner_1',
        image_url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop&q=80',
        title: 'Slalu ada sensasi di setiap gigitan',
        link: '#'
      },
      {
        id: 'banner_2',
        image_url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop&q=80',
        title: 'Paket Spesial Diskon 20%',
        link: '#'
      },
      {
        id: 'banner_3',
        image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format&fit=crop&q=80',
        title: 'Ayam Tulang Lunak Khas Bangjo',
        link: '#'
      }
    ];
  }

  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    logo_url: brand.logo_url || '/assets/pwa/icon-192.png',
    primary_color: brand.primary_color || '#b6ff00',
    custom_domain: brand.custom_domain || 'app.mybangjo.com',
    tagline: brand.tagline || 'Official Online Food Ordering',
    banners
  };
}

// P1 SECURE ME ENDPOINT: Strictly verifies Bearer token session and sanitizes brand DTO (FINDING 10)
router.get('/auth/merchant/me', requireAuth(), (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.userId,
      username: req.user.username,
      email: req.user.email,
      full_name: req.user.fullName,
      role: req.user.role,
      branch_id: req.user.branchId || null,
      email_verified: req.user.email_verified !== undefined ? req.user.email_verified : true,
      brand_name: req.brand ? req.brand.name : 'Bangjo Resto'
    },
    brand: serializePublicBrand(req.brand)
  });
});



/* =========================================================================
   ADMIN & OWNER DASHBOARD API ENDPOINTS (Protected by requireAuth)
   ========================================================================= */

// 11. Admin Brand Profile & Theme
router.get('/admin/brand', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.brand_id);
    if (!brand) brand = req.brand;
    res.json({
      success: true,
      brand: serializePublicBrand(brand)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/brand', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, primary_color, logo_url, custom_domain, tagline, banners } = req.body;
    const bannersJson = banners ? (typeof banners === 'string' ? banners : JSON.stringify(banners)) : null;

    let normalizedPrimaryColor = undefined;
    if (primary_color !== undefined && primary_color !== null) {
      if (typeof primary_color !== 'string') {
        return res.status(400).json({ success: false, error: 'Format warna tema (hex) tidak valid.' });
      }
      let cleanHex = primary_color.trim();
      if (!cleanHex.startsWith('#')) cleanHex = '#' + cleanHex;
      if (/^#[0-9a-fA-F]{3}$/.test(cleanHex)) {
        cleanHex = '#' + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2] + cleanHex[3] + cleanHex[3];
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(cleanHex)) {
        return res.status(400).json({ success: false, error: 'Format warna tema (hex) tidak valid. Gunakan format #RRGGBB.' });
      }
      normalizedPrimaryColor = cleanHex.toUpperCase();
    }

    db.prepare(`
      UPDATE brands 
      SET name = COALESCE(?, name),
          primary_color = COALESCE(?, primary_color),
          logo_url = COALESCE(?, logo_url),
          custom_domain = COALESCE(?, custom_domain),
          tagline = COALESCE(?, tagline),
          banners = COALESCE(?, banners),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name !== undefined ? name : null,
      normalizedPrimaryColor !== undefined ? normalizedPrimaryColor : null,
      logo_url !== undefined ? logo_url : null,
      custom_domain !== undefined ? custom_domain : null,
      tagline !== undefined ? tagline : null,
      bannersJson,
      req.brand_id
    );
    // P1.2: brand row written → drop the cached hostname→brand mapping so the
    // new profile/domain is authoritative immediately.
    CoreBrandRepo.clearCustomDomainCache();

    if (req.brand) {
      req.brand.name = name || req.brand.name;
      req.brand.primary_color = normalizedPrimaryColor || req.brand.primary_color;
      req.brand.logo_url = logo_url || req.brand.logo_url;
      req.brand.custom_domain = custom_domain || req.brand.custom_domain;
      req.brand.tagline = tagline || req.brand.tagline;
      if (bannersJson) req.brand.banners = bannersJson;
    }

    let parsedBanners = [];
    try {
      parsedBanners = bannersJson ? JSON.parse(bannersJson) : (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners);
    } catch (_) {}

    res.json({
      success: true,
      message: 'Pengaturan brand dan tema berhasil diperbarui.',
      brand: {
        id: req.brand.id,
        name: req.brand.name,
        slug: req.brand.slug,
        logo_url: req.brand.logo_url || '/assets/pwa/icon-192.png',
        primary_color: req.brand.primary_color || '#b6ff00',
        custom_domain: req.brand.custom_domain || 'app.mybangjo.com',
        tagline: req.brand.tagline || 'Official Online Food Ordering',
        banners: Array.isArray(parsedBanners) ? parsedBanners : []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Brand Logo Upload & Delete Endpoints
const BRAND_LOGO_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/logos');
const BANNER_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/banners');

router.post('/admin/brand/logo', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { image_base64, mime_type } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Gambar logo wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'logo'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code });
    }

    fs.mkdirSync(BRAND_LOGO_DIR, { recursive: true });
    const fileName = `logo-${crypto.randomBytes(8).toString('hex')}-${Date.now()}.${validation.info.ext}`;
    fs.writeFileSync(path.join(BRAND_LOGO_DIR, fileName), validation.buffer);

    const logoUrl = `/assets/uploads/logos/${fileName}`;
    coreBrandRepo.updateBrandLogo(req.brand_id, logoUrl);

    if (req.brand) {
      req.brand.logo_url = logoUrl;
    }

    res.json({
      success: true,
      message: 'Logo brand berhasil diunggah.',
      logo_url: logoUrl
    });
  } catch (err) {
    console.error('[API Error POST /admin/brand/logo]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/brand/logo', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    coreBrandRepo.removeBrandLogo(req.brand_id);
    if (req.brand) {
      req.brand.logo_url = null;
    }
    res.json({
      success: true,
      message: 'Logo brand berhasil dihapus.',
      logo_url: null
    });
  } catch (err) {
    console.error('[API Error DELETE /admin/brand/logo]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11.1 Add/Upload/Delete Banners
router.post('/admin/banners/upload', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { image_base64, mime_type } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Gambar banner wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'banner'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
    }

    fs.mkdirSync(BANNER_IMAGE_DIR, { recursive: true });
    const fileName = `banner-${crypto.randomBytes(8).toString('hex')}-${Date.now()}.${validation.info.ext}`;
    fs.writeFileSync(path.join(BANNER_IMAGE_DIR, fileName), validation.buffer);

    const bannerUrl = `/assets/uploads/banners/${fileName}`;
    res.json({
      success: true,
      message: 'Foto banner berhasil diunggah.',
      image_url: bannerUrl,
      info: validation.info
    });
  } catch (err) {
    console.error('[API Error POST /admin/banners/upload]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/admin/banners', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let { image_url, image_base64, mime_type, title = '', link = '#' } = req.body || {};

    let banners = [];
    try {
      banners = req.brand.banners ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners) : [];
    } catch(e) {}
    if (!Array.isArray(banners)) banners = [];
    if (banners.length >= 5) {
      return res.status(400).json({ success: false, error: 'Maksimal 5 slide banner promo.' });
    }

    if (image_base64) {
      const validation = ImageValidator.validateImageUpload({
        imageBase64: image_base64,
        mimeType: mime_type,
        assetType: 'banner'
      });

      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
      }

      fs.mkdirSync(BANNER_IMAGE_DIR, { recursive: true });
      const fileName = `banner-${crypto.randomBytes(8).toString('hex')}-${Date.now()}.${validation.info.ext}`;
      fs.writeFileSync(path.join(BANNER_IMAGE_DIR, fileName), validation.buffer);
      image_url = `/assets/uploads/banners/${fileName}`;
    }

    if (!image_url) {
      return res.status(400).json({ success: false, error: 'URL gambar banner atau file banner wajib diunggah.' });
    }

    const newBanner = {
      id: 'banner_' + Date.now(),
      image_url,
      title,
      link
    };
    banners.push(newBanner);
    const bannersJson = JSON.stringify(banners);
    db.prepare('UPDATE brands SET banners = ?, updated_at = datetime(\'now\') WHERE id = ?').run(bannersJson, req.brand_id);
    if (req.brand) req.brand.banners = bannersJson;
    res.json({ success: true, message: 'Banner berhasil ditambahkan.', banners });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/banners/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let banners = [];
    try {
      banners = req.brand.banners ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners) : [];
    } catch(e) {}
    if (!Array.isArray(banners)) banners = [];
    banners = banners.filter(b => b.id !== req.params.id);
    const bannersJson = JSON.stringify(banners);
    db.prepare('UPDATE brands SET banners = ?, updated_at = datetime(\'now\') WHERE id = ?').run(bannersJson, req.brand_id);
    if (req.brand) req.brand.banners = bannersJson;
    res.json({ success: true, message: 'Banner berhasil dihapus.', banners });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// CANONICAL MEDIA SYSTEM (M1) - Upload Security, Staging, Lifecycle & Attach
// ============================================================================

// Stage an upload into TEMPORARY state with binary validation
router.post('/admin/media/upload', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { image_base64, mime_type, original_filename, asset_type, enforce_aspect_ratio } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'Data gambar wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
    }

    const asset = await mediaService.stageUpload({
      brandId: req.brand_id,
      tenantId: req.brand ? req.brand.organization_id : null,
      userId: req.user ? req.user.id : null,
      imageBase64: image_base64,
      mimeType: mime_type,
      declaredFilename: original_filename,
      assetType: asset_type || 'general',
      enforceAspectRatio: Boolean(enforce_aspect_ratio)
    });

    res.status(201).json({
      success: true,
      message: 'Media berhasil diunggah ke staging.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'UPLOAD_ERROR',
      dimensions: err.dimensions
    });
  }
});

// Mark asset as READY (completing upload pipeline)
router.post('/admin/media/:id/ready', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const asset = await mediaService.markReady({
      mediaId: req.params.id,
      brandId: req.brand_id
    });
    res.json({
      success: true,
      message: 'Media siap digunakan.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'TRANSITION_ERROR'
    });
  }
});

// Update crop specification intent (M2)
router.post('/admin/media/:id/crop', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { crop_spec } = req.body || {};
    if (!crop_spec || typeof crop_spec !== 'object') {
      return res.status(400).json({ success: false, error: 'crop_spec object wajib disertakan.', code: 'MISSING_CROP_SPEC' });
    }

    const asset = await mediaService.setCropSpec({
      mediaId: req.params.id,
      brandId: req.brand_id,
      cropSpec: crop_spec
    });

    res.json({
      success: true,
      message: 'Spesifikasi crop berhasil disimpan.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'CROP_SPEC_ERROR'
    });
  }
});

// Canonical M3 Server-Side Image Processing Pipeline
router.post('/admin/media/:id/process', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { crop_spec } = req.body || {};
    const asset = await mediaService.processMedia({
      mediaId: req.params.id,
      brandId: req.brand_id,
      cropSpec: crop_spec || null
    });

    res.json({
      success: true,
      message: 'Pemrosesan gambar kanonikal berhasil diselesaikan.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'PROCESSING_ERROR',
      asset: err.asset || null
    });
  }
});


// Transition lifecycle status
router.post('/admin/media/:id/transition', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { target_status, error_message } = req.body || {};
    const asset = await mediaService.transitionStatus({
      mediaId: req.params.id,
      brandId: req.brand_id,
      targetStatus: target_status,
      errorMessage: error_message
    });
    res.json({
      success: true,
      message: `Status media berhasil diubah menjadi '${target_status}'.`,
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'TRANSITION_ERROR'
    });
  }
});

// Retry a failed asset
router.post('/admin/media/:id/retry', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const asset = await mediaService.retryFailed({
      mediaId: req.params.id,
      brandId: req.brand_id
    });
    res.json({
      success: true,
      message: 'Aset media berhasil di-retry.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'RETRY_ERROR'
    });
  }
});

// Attach a READY asset to an entity
router.post('/admin/media/:id/attach', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { entity_type, entity_id } = req.body || {};
    if (!entity_type || !entity_id) {
      return res.status(400).json({ success: false, error: 'entity_type dan entity_id wajib disertakan.', code: 'MISSING_ATTACH_TARGET' });
    }

    const asset = await mediaService.attachToEntity({
      mediaId: req.params.id,
      brandId: req.brand_id,
      entityType: entity_type,
      entityId: String(entity_id)
    });

    res.json({
      success: true,
      message: 'Media berhasil dikaitkan ke entitas.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'ATTACH_ERROR'
    });
  }
});

// Atomic replacement of media
router.post('/admin/media/replace', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { new_media_id, old_media_id, entity_type, entity_id } = req.body || {};
    if (!new_media_id || !entity_type || !entity_id) {
      return res.status(400).json({
        success: false,
        error: 'new_media_id, entity_type, dan entity_id wajib disertakan.',
        code: 'MISSING_REPLACE_PARAMS'
      });
    }

    const asset = await mediaService.replaceEntityMedia({
      newMediaId: new_media_id,
      oldMediaId: old_media_id,
      brandId: req.brand_id,
      entityType: entity_type,
      entityId: String(entity_id)
    });

    res.json({
      success: true,
      message: 'Media berhasil diganti secara atomik.',
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'REPLACE_ERROR'
    });
  }
});

// Media storage consistency check (M4) — defined before parameterized /:id route
router.get('/admin/media/consistency', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const result = await mediaService.checkConsistency({
      brandId: req.brand_id
    });
    res.json({
      success: true,
      result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      code: 'CONSISTENCY_CHECK_ERROR'
    });
  }
});

// List media for current brand — defined before parameterized /:id route
router.get('/admin/media', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { status, asset_type, limit, offset } = req.query || {};
    const assets = mediaService.listMedia({
      brandId: req.brand_id,
      status,
      assetType: asset_type,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0
    });
    res.json({
      success: true,
      assets
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'LIST_MEDIA_ERROR'
    });
  }
});

// Get media by ID (Strictly tenant scoped)
router.get('/admin/media/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const asset = mediaService.getMedia({
      mediaId: req.params.id,
      brandId: req.brand_id
    });
    res.json({
      success: true,
      asset
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'GET_MEDIA_ERROR'
    });
  }
});


// Delete media (Strictly tenant scoped, moves to ORPHAN or force hard delete)
router.delete('/admin/media/:id', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const result = await mediaService.deleteMedia({
      mediaId: req.params.id,
      brandId: req.brand_id,
      force
    });
    res.json({
      success: true,
      message: force ? 'Media berhasil dihapus permanen.' : 'Media berhasil di-unlink dan masuk masa tenggang (orphan).',
      result
    });
  } catch (err) {
    const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'MEDIA_NOT_FOUND' ? 404 : 400);
    res.status(statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'DELETE_MEDIA_ERROR',
      references: err.references || null
    });
  }
});

// Reconcile orphan assets (M4)
router.post('/admin/media/reconcile', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const gracePeriodDays = Number(req.body && req.body.grace_period_days) || 30;
    const result = await mediaService.reconcileOrphans({
      gracePeriodDays,
      brandId: req.brand_id
    });
    res.json({
      success: true,
      message: 'Rekonsiliasi aset media selesai.',
      result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      code: 'RECONCILIATION_ERROR'
    });
  }
});

// Trigger Media Garbage Collection (M4)
router.post('/admin/media/gc', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const temporaryHours = Number(req.body && req.body.temporary_hours) || 24;
    const orphanGraceDays = Number(req.body && req.body.orphan_grace_days) || 30;
    const result = await mediaService.collectGarbage({
      temporaryHours,
      orphanGraceDays,
      brandId: req.brand_id
    });
    res.json({
      success: true,
      message: 'Media Garbage Collection selesai.',
      result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      code: 'GC_ERROR'
    });
  }
});



// ============================================================================
// M5 DASHBOARD MEDIA INTEGRATION — Entity-specific canonical upload pipeline
// Upload → Crop → Process → Attach in one round-trip per entity type.
// All operations remain tenant-scoped and RBAC-protected.
// ============================================================================

/**
 * Helper: resolve the best derivative URL for dashboard preview.
 * Returns the smallest variant that is >= minWidth, or the largest available.
 */
function resolvePreviewUrl(asset, minWidth = 320) {
  if (!asset || !Array.isArray(asset.variants) || asset.variants.length === 0) {
    return asset ? asset.url : null;
  }
  const sorted = [...asset.variants].sort((a, b) => a.width - b.width);
  const candidate = sorted.find(v => v.width >= minWidth) || sorted[sorted.length - 1];
  return candidate ? candidate.url : asset.url;
}

// ============================================================================
// M6 CUSTOMER PWA MEDIA DELIVERY — Canonical media resolution for customer-facing data.
// Customer PWA is a delivery consumer: it never processes originals.
// All media resolution here is tenant-scoped and read-only (delivery-safe fields only).
// ============================================================================

/**
 * M6 HELPER: Resolve delivery-safe canonical media representation for a customer-facing entity.
 *
 * Inputs:
 *   mediaId  — the entity's canonical media_id (nullable)
 *   brandId  — required for strict tenant isolation
 *   assetType — 'square' or 'banner' — selects the correct derivative matrix
 *   legacyUrl — existing image_url / logo_url / banner image_url (fallback only)
 *
 * Returns:
 *   {
 *     preview_url:     string|null  — smallest usable derivative URL (640 square, 640 banner sm)
 *     srcset_variants: Array<{ url, width }>  — sorted derivatives for responsive delivery
 *     media_id:        string|null  — canonical identifier (immutable, cache-safe)
 *     legacy_url:      string|null  — preserved for backward compatibility only
 *   }
 *
 * Rules:
 *   - If canonical media exists and has READY variants → prefer derivative, never original.
 *   - If canonical media has no ready variants → fall through to legacyUrl.
 *   - Never expose storage_key, original binary paths, or admin metadata.
 *   - Never allow cross-tenant access (brand_id is always enforced).
 */
function resolveCustomerMediaDelivery({ mediaId, brandId, assetType = 'square', legacyUrl = null }) {
  const result = {
    preview_url: legacyUrl || null,
    srcset_variants: [],
    media_id: null,
    legacy_url: legacyUrl || null
  };

  if (!mediaId || !brandId) return result;

  try {
    const map = batchResolveCustomerMediaDelivery({
      mediaIds: [mediaId],
      brandId,
      assetType
    });
    const resolved = map.get(mediaId);
    if (resolved) {
      return {
        ...resolved,
        preview_url: resolved.preview_url || legacyUrl || null,
        legacy_url: legacyUrl || null
      };
    }
  } catch (_) {
    // Fall back to legacy gracefully
  }

  return result;
}

/**
 * M7 BUGFIX: Batch resolves canonical media delivery for multiple media_ids.
 * Performs at most 2 bounded database queries (1 for assets, 1 for variants)
 * instead of 2 queries per item (N+1 query elimination).
 *
 * @param {Object} params
 * @param {Array<string>} params.mediaIds
 * @param {string} params.brandId
 * @param {string} params.assetType - 'square' | 'banner'
 * @returns {Map<string, { preview_url: string|null, srcset_variants: Array, media_id: string }>}
 */
function batchResolveCustomerMediaDelivery({ mediaIds = [], brandId, assetType = 'square' }) {
  const resultMap = new Map();
  if (!brandId || !Array.isArray(mediaIds) || mediaIds.length === 0) {
    return resultMap;
  }

  // Filter unique, non-empty media IDs
  const uniqueIds = Array.from(new Set(mediaIds.filter(id => Boolean(id) && typeof id === 'string')));
  if (uniqueIds.length === 0) return resultMap;

  try {
    // 1. Batch query assets scoped to brandId (enforces tenant boundary)
    const placeholders = uniqueIds.map(() => '?').join(',');
    const assets = db.prepare(
      `SELECT id, brand_id, status FROM media_assets WHERE brand_id = ? AND status = 'ready' AND id IN (${placeholders})`
    ).all(brandId, ...uniqueIds);

    if (!assets || assets.length === 0) return resultMap;

    const readyIds = assets.map(a => a.id);
    const readyPlaceholders = readyIds.map(() => '?').join(',');

    // 2. Batch query all variants for ready assets
    const variants = db.prepare(
      `SELECT media_id, variant_name, width, height, storage_key FROM media_variants WHERE media_id IN (${readyPlaceholders}) ORDER BY width ASC`
    ).all(...readyIds);

    // Group variants by media_id in-memory
    const variantsByMediaId = new Map();
    for (const v of (variants || [])) {
      if (!variantsByMediaId.has(v.media_id)) {
        variantsByMediaId.set(v.media_id, []);
      }
      variantsByMediaId.get(v.media_id).push(v);
    }

    // Build delivery objects
    for (const asset of assets) {
      const itemVariants = variantsByMediaId.get(asset.id) || [];
      if (itemVariants.length === 0) continue;

      const deliveryVariants = itemVariants.map(v => ({
        name: v.variant_name,
        width: v.width,
        height: v.height,
        url: mediaService.storage.resolveUrl(v.storage_key)
      }));

      let previewVariant;
      if (assetType === 'banner') {
        previewVariant = deliveryVariants.find(v => v.width >= 640) || deliveryVariants[deliveryVariants.length - 1];
      } else {
        previewVariant = deliveryVariants.find(v => v.width >= 640) || deliveryVariants[deliveryVariants.length - 1];
      }

      resultMap.set(asset.id, {
        media_id: asset.id,
        preview_url: previewVariant ? previewVariant.url : null,
        srcset_variants: deliveryVariants.map(v => ({ url: v.url, width: v.width, height: v.height, name: v.name }))
      });
    }
  } catch (_) {
    // Fail-safe: empty map causes callers to seamlessly use legacyUrl
  }

  return resultMap;
}


/**
 * M6 HELPER: Resolve canonical media for a banner entry.
 * Banner entries may carry a media_id (canonical) or only an image_url (legacy).
 * Returns the banner with enriched delivery fields.
 */
function resolveBannerDelivery(banner, brandId) {
  if (!banner) return banner;
  const mediaId = banner.media_id || null;
  const legacyUrl = banner.image_url || null;

  const delivery = resolveCustomerMediaDelivery({
    mediaId,
    brandId,
    assetType: 'banner',
    legacyUrl
  });

  return {
    id: banner.id,
    title: banner.title || '',
    link: banner.link || '#',
    // Canonical delivery fields:
    preview_url: delivery.preview_url,
    srcset_variants: delivery.srcset_variants,
    media_id: delivery.media_id,
    // Legacy preserved for backward compat:
    image_url: delivery.preview_url || legacyUrl // prefer canonical derivative
  };
}

/**
 * Helper: run the full canonical pipeline for a single entity image upload.
 *   stageUpload → setCropSpec (optional) → processMedia → return asset + previewUrl
 * On processing failure, the staged asset is left in FAILED state (never published).
 */
async function runEntityMediaPipeline({ brandId, tenantId, userId, imageBase64, mimeType,
  originalFilename, assetType, cropSpec }) {
  // Stage
  const staged = await mediaService.stageUpload({
    brandId,
    tenantId,
    userId,
    imageBase64,
    mimeType,
    declaredFilename: originalFilename,
    assetType,
    enforceAspectRatio: false  // Source may be any ratio; crop fixes it
  });

  // Persist crop spec if provided (M2)
  if (cropSpec && typeof cropSpec === 'object') {
    await mediaService.setCropSpec({ mediaId: staged.media_id, brandId, cropSpec });
  }

  // Process (M3 — crop → resize → WebP derivatives)
  const processed = await mediaService.processMedia({
    mediaId: staged.media_id,
    brandId,
    cropSpec: cropSpec || null
  });

  return processed;
}

// ---- Brand Logo (M5 canonical) ----

/**
 * POST /admin/media/entity/brand/logo
 * Upload, process, and attach a canonical logo to the current brand.
 * Body: { image_base64, mime_type, original_filename, crop_spec? }
 * Response includes asset with derivatives and preview_url.
 */
router.post('/admin/media/entity/brand/logo',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar logo wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      // Fetch current logo_media_id for replacement semantics
      const brand = db.prepare('SELECT logo_media_id FROM brands WHERE id = ?').get(req.brand_id);
      const oldMediaId = brand ? brand.logo_media_id : null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'logo',
        cropSpec: crop_spec || null
      });

      // Attach to entity
      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'brand_logo',
        entityId: req.brand_id
      });

      // Atomic replacement: if old logo media exists, orphan it
      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.replaceEntityMedia({
          newMediaId: asset.media_id,
          oldMediaId,
          brandId: req.brand_id,
          entityType: 'brand_logo',
          entityId: req.brand_id
        }).catch(() => {}); // Non-fatal — attachment already done above
      }

      // Resolve preview URL (prefer smallest derivative for logo thumbnail)
      const previewUrl = resolvePreviewUrl(asset, 320);

      // Sync brand table: logo_media_id + logo_url (derivative) for legacy consumers
      coreBrandRepo.updateBrandLogoMedia(req.brand_id, {
        mediaId: asset.media_id,
        logoUrl: previewUrl || asset.url
      });

      if (req.brand) req.brand.logo_url = previewUrl || asset.url;

      res.status(201).json({
        success: true,
        message: 'Logo brand berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        logo_url: previewUrl || asset.url
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
      console.error('[M5 POST /admin/media/entity/brand/logo]:', err.message);
      res.status(statusCode).json({
        success: false,
        error: err.message,
        code: err.code || 'LOGO_UPLOAD_ERROR'
      });
    }
  }
);

/**
 * DELETE /admin/media/entity/brand/logo
 * Remove brand logo using canonical lifecycle (soft-orphan).
 */
router.delete('/admin/media/entity/brand/logo',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      const brand = db.prepare('SELECT logo_media_id FROM brands WHERE id = ?').get(req.brand_id);
      const mediaId = brand ? brand.logo_media_id : null;

      if (mediaId) {
        await mediaService.unlinkMedia({ mediaId, brandId: req.brand_id }).catch(() => {});
      }

      coreBrandRepo.removeBrandLogoMedia(req.brand_id);
      if (req.brand) req.brand.logo_url = null;

      res.json({ success: true, message: 'Logo brand berhasil dihapus.', logo_url: null });
    } catch (err) {
      console.error('[M5 DELETE /admin/media/entity/brand/logo]:', err.message);
      res.status(500).json({ success: false, error: err.message, code: 'LOGO_DELETE_ERROR' });
    }
  }
);

// ---- Master Product Image (M5 canonical) ----

/**
 * POST /admin/media/entity/products/:productId/image
 * Upload, process, and attach canonical media to a master product.
 * Body: { image_base64, mime_type, original_filename?, crop_spec? }
 */
router.post('/admin/media/entity/products/:productId/image',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      const product = db.prepare('SELECT id, media_id FROM products WHERE id = ? AND brand_id = ?')
        .get(req.params.productId, req.brand_id);
      if (!product) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan.', code: 'PRODUCT_NOT_FOUND' });

      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar produk wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const oldMediaId = product.media_id || null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'product',
        cropSpec: crop_spec || null
      });

      // Attach to entity
      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'product',
        entityId: String(req.params.productId)
      });

      // Orphan old asset if different
      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id }).catch(() => {});
      }

      const previewUrl = resolvePreviewUrl(asset, 320);

      // Update product: canonical media_id + legacy image_url sync
      db.prepare("UPDATE products SET media_id = ?, image_url = ?, image = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?")
        .run(asset.media_id, previewUrl || asset.url, previewUrl || asset.url, req.params.productId, req.brand_id);

      res.status(201).json({
        success: true,
        message: 'Gambar produk berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        product: {
          id: req.params.productId,
          media_id: asset.media_id,
          image_url: previewUrl || asset.url
        }
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'PRODUCT_NOT_FOUND' ? 404 : 400);
      console.error('[M5 POST /admin/media/entity/products/:productId/image]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'PRODUCT_IMAGE_UPLOAD_ERROR' });
    }
  }
);

// ---- Master Category Image (M5 canonical) ----

/**
 * POST /admin/media/entity/categories/:categoryId/image
 * Upload, process, and attach canonical media to a master category.
 */
router.post('/admin/media/entity/categories/:categoryId/image',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      const category = db.prepare('SELECT id, media_id FROM categories WHERE id = ? AND brand_id = ?')
        .get(req.params.categoryId, req.brand_id);
      if (!category) return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan.', code: 'CATEGORY_NOT_FOUND' });

      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar kategori wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const oldMediaId = category.media_id || null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'category',
        cropSpec: crop_spec || null
      });

      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'category',
        entityId: String(req.params.categoryId)
      });

      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id }).catch(() => {});
      }

      const previewUrl = resolvePreviewUrl(asset, 320);

      db.prepare("UPDATE categories SET media_id = ?, image_url = ?, image = ? WHERE id = ? AND brand_id = ?")
        .run(asset.media_id, previewUrl || asset.url, previewUrl || asset.url, req.params.categoryId, req.brand_id);

      res.status(201).json({
        success: true,
        message: 'Gambar kategori berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        category: {
          id: req.params.categoryId,
          media_id: asset.media_id,
          image_url: previewUrl || asset.url
        }
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'CATEGORY_NOT_FOUND' ? 404 : 400);
      console.error('[M5 POST /admin/media/entity/categories/:categoryId/image]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'CATEGORY_IMAGE_UPLOAD_ERROR' });
    }
  }
);

// ---- Promo Banner (M5 canonical) ----

/**
 * POST /admin/media/entity/banners
 * Upload, process (banner 1.94:1 ratio), and add as canonical banner entry.
 * Body: { image_base64, mime_type, title?, link?, crop_spec? }
 */
router.post('/admin/media/entity/banners',
  requireAuth(['owner', 'brand_manager']),
  async (req, res) => {
    try {
      let banners = [];
      try {
        banners = req.brand && req.brand.banners
          ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners)
          : [];
      } catch (_) {}
      if (!Array.isArray(banners)) banners = [];

      if (banners.length >= 5) {
        return res.status(400).json({ success: false, error: 'Maksimal 5 slide banner promo.', code: 'BANNER_LIMIT_EXCEEDED' });
      }

      const { image_base64, mime_type, original_filename, title = '', link = '#', crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar banner wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'banner',
        cropSpec: crop_spec || null
      });

      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'brand_banner',
        entityId: req.brand_id
      });

      const previewUrl = resolvePreviewUrl(asset, 640);

      const newBanner = {
        id: 'banner_' + Date.now(),
        media_id: asset.media_id,
        image_url: previewUrl || asset.url,
        title,
        link
      };
      banners.push(newBanner);
      const bannersJson = JSON.stringify(banners);
      db.prepare("UPDATE brands SET banners = ?, updated_at = datetime('now') WHERE id = ?").run(bannersJson, req.brand_id);
      if (req.brand) req.brand.banners = bannersJson;

      res.status(201).json({
        success: true,
        message: 'Banner promo berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        banner: newBanner,
        banners
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
      console.error('[M5 POST /admin/media/entity/banners]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'BANNER_UPLOAD_ERROR' });
    }
  }
);

// ---- Branch Category Image (M5 canonical) ----

/**
 * POST /admin/media/entity/branches/:branchId/categories/:catId/image
 * Upload, process, and attach canonical media to a branch category.
 * Respects branch_manager scope restriction.
 */
router.post('/admin/media/entity/branches/:branchId/categories/:catId/image',
  requireAuth(['owner', 'brand_manager', 'branch_manager']),
  async (req, res) => {
    try {
      // Branch scope enforcement
      if (req.user.role === 'branch_manager') {
        const assignedBranchId = req.user.branchId || req.user.branch_id;
        if (assignedBranchId && assignedBranchId !== req.params.branchId) {
          return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', code: 'FORBIDDEN_BRANCH_SCOPE' });
        }
      }

      const cat = db.prepare('SELECT id, media_id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
        .get(req.params.catId, req.params.branchId, req.brand_id);
      if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.', code: 'CATEGORY_NOT_FOUND' });

      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar kategori cabang wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const oldMediaId = cat.media_id || null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'category',
        cropSpec: crop_spec || null
      });

      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'branch_category',
        entityId: String(req.params.catId)
      });

      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id }).catch(() => {});
      }

      const previewUrl = resolvePreviewUrl(asset, 320);

      try {
        db.prepare("UPDATE branch_categories SET media_id = ?, image_url = ?, updated_at = datetime('now') WHERE id = ? AND branch_id = ?")
          .run(asset.media_id, previewUrl || asset.url, req.params.catId, req.params.branchId);
      } catch (e) {
        if (String(e).includes('no such column: media_id')) {
          db.prepare("UPDATE branch_categories SET image_url = ?, updated_at = datetime('now') WHERE id = ? AND branch_id = ?")
            .run(previewUrl || asset.url, req.params.catId, req.params.branchId);
        } else throw e;
      }

      res.status(201).json({
        success: true,
        message: 'Gambar kategori cabang berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        category: { id: req.params.catId, media_id: asset.media_id, image_url: previewUrl || asset.url }
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : (err.code === 'CATEGORY_NOT_FOUND' ? 404 : 400);
      console.error('[M5 POST /admin/media/entity/branches/:branchId/categories/:catId/image]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'BRANCH_CAT_IMAGE_ERROR' });
    }
  }
);

// ---- Branch Product Image Override (M5 canonical) ----

/**
 * POST /admin/media/entity/branches/:branchId/products/:productId/image
 * Upload, process, and attach canonical media as branch product image override.
 */
router.post('/admin/media/entity/branches/:branchId/products/:productId/image',
  requireAuth(['owner', 'brand_manager', 'branch_manager']),
  async (req, res) => {
    try {
      if (req.user.role === 'branch_manager') {
        const assignedBranchId = req.user.branchId || req.user.branch_id;
        if (assignedBranchId && assignedBranchId !== req.params.branchId) {
          return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', code: 'FORBIDDEN_BRANCH_SCOPE' });
        }
      }

      const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.branchId, req.brand_id);
      if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.', code: 'BRANCH_NOT_FOUND' });

      const bp = db.prepare('SELECT branch_id, image_media_id FROM branch_products WHERE branch_id = ? AND product_id = ?')
        .get(req.params.branchId, req.params.productId);
      if (!bp) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.', code: 'BRANCH_PRODUCT_NOT_FOUND' });

      const { image_base64, mime_type, original_filename, crop_spec } = req.body || {};
      if (!image_base64) {
        return res.status(400).json({ success: false, error: 'Data gambar produk cabang wajib diunggah.', code: 'MISSING_IMAGE_DATA' });
      }

      const oldMediaId = bp.image_media_id || null;

      const asset = await runEntityMediaPipeline({
        brandId: req.brand_id,
        tenantId: req.brand ? req.brand.organization_id : null,
        userId: req.user ? req.user.id : null,
        imageBase64: image_base64,
        mimeType: mime_type,
        originalFilename: original_filename,
        assetType: 'product',
        cropSpec: crop_spec || null
      });

      await mediaService.attachToEntity({
        mediaId: asset.media_id,
        brandId: req.brand_id,
        entityType: 'branch_product',
        entityId: `${req.params.branchId}:${req.params.productId}`
      });

      if (oldMediaId && oldMediaId !== asset.media_id) {
        await mediaService.unlinkMedia({ mediaId: oldMediaId, brandId: req.brand_id }).catch(() => {});
      }

      const previewUrl = resolvePreviewUrl(asset, 320);

      try {
        db.prepare("UPDATE branch_products SET image_media_id = ?, image_override = ?, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?")
          .run(asset.media_id, previewUrl || asset.url, req.params.branchId, req.params.productId);
      } catch (e) {
        if (String(e).includes('no such column: image_media_id')) {
          db.prepare("UPDATE branch_products SET image_override = ?, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?")
            .run(previewUrl || asset.url, req.params.branchId, req.params.productId);
        } else throw e;
      }

      res.status(201).json({
        success: true,
        message: 'Gambar produk cabang berhasil diproses dan dikaitkan.',
        asset,
        preview_url: previewUrl,
        product: {
          branch_id: req.params.branchId,
          product_id: req.params.productId,
          media_id: asset.media_id,
          image_url: previewUrl || asset.url,
          image_override: previewUrl || asset.url
        }
      });
    } catch (err) {
      const statusCode = err.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
      console.error('[M5 POST /admin/media/entity/branches/:branchId/products/:productId/image]:', err.message);
      res.status(statusCode).json({ success: false, error: err.message, code: err.code || 'BRANCH_PRODUCT_IMAGE_ERROR' });
    }
  }
);

/**
 * GET /admin/media/entity/:entityType/:entityId
 * Fetch the current canonical media asset attached to an entity with derivative preview URLs.
 * entity_type: brand_logo | product | category | branch_category | branch_product | brand_banner
 */
router.get('/admin/media/entity/:entityType/:entityId',
  requireAuth(['owner', 'brand_manager', 'branch_manager']),
  (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      // Find the attached asset from media_assets
      const asset = db.prepare(
        "SELECT * FROM media_assets WHERE brand_id = ? AND attached_to_type = ? AND attached_to_id = ? AND status = 'ready' ORDER BY attached_at DESC LIMIT 1"
      ).get(req.brand_id, entityType, entityId);

      if (!asset) {
        return res.json({ success: true, asset: null, preview_url: null });
      }

      const formatted = mediaService.getMedia({ mediaId: asset.id, brandId: req.brand_id });
      const previewUrl = resolvePreviewUrl(formatted, 320);

      res.json({ success: true, asset: formatted, preview_url: previewUrl });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message, code: 'ENTITY_MEDIA_FETCH_ERROR' });
    }
  }
);

// 12. Admin Categories CRUD

router.get('/admin/categories', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories WHERE brand_id = ? ORDER BY sort_order ASC').all(req.brand_id);
    res.json({ success: true, categories: categories || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/admin/categories', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, image } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi.' });

    const id = 'cat_' + Date.now();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    db.prepare(`
      INSERT INTO categories (id, brand_id, name, slug, sort_order)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE brand_id = ?))
    `).run(id, req.brand_id, name, slug, req.brand_id);

    res.status(201).json({
      success: true,
      category: { id, name, slug, image: image || '/assets/icons/delivery.png' }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/categories/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, image, sort_order, is_active } = req.body;
    let normIsActive = null;
    if (is_active !== undefined && is_active !== null) {
      if (is_active === true || is_active === 1 || is_active === '1' || is_active === 'true') {
        normIsActive = 1;
      } else if (is_active === false || is_active === 0 || is_active === '0' || is_active === 'false') {
        normIsActive = 0;
      }
    }
    db.prepare(`
      UPDATE categories 
      SET name = COALESCE(?, name),
          sort_order = COALESCE(?, sort_order),
          is_active = COALESCE(?, is_active)
      WHERE id = ? AND brand_id = ?
    `).run(
      name !== undefined ? name : null,
      sort_order !== undefined ? sort_order : null,
      normIsActive !== null ? normIsActive : null,
      req.params.id,
      req.brand_id
    );

    res.json({ success: true, message: 'Kategori berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/admin/categories/:id/toggle', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const stmt = db.prepare(`
      UPDATE categories 
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
      WHERE id = ? AND brand_id = ?
    `).run(req.params.id, req.brand_id);

    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan atau tidak berubah.' });
    }

    res.json({ success: true, message: 'Status ketersediaan kategori berhasil diubah.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/categories/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const existing = db.prepare('SELECT id, name FROM categories WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan.' });
    }

    // Category assignment protection: check if products are assigned
    const assignedCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE category_id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (assignedCount && assignedCount.count > 0) {
      return res.status(400).json({
        success: false,
        error: `Kategori "${existing.name}" tidak dapat dihapus karena masih digunakan oleh ${assignedCount.count} produk. Pindahkan atau hapus produk terlebih dahulu.`
      });
    }

    db.prepare('DELETE FROM categories WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);
    res.json({ success: true, message: 'Kategori berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Admin Products CRUD
router.get('/admin/products', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products WHERE brand_id = ? ORDER BY sort_order ASC').all(req.brand_id);
    res.json({ success: true, products: products || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/admin/products/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produk tidak ditemukan.' });
    }

    // Include branch adoption status across all active branches for this brand
    const branchAdoptions = db.prepare(`
      SELECT 
        b.id AS branch_id,
        b.name AS branch_name,
        b.address_text AS branch_address,
        b.is_active AS is_branch_active,
        bp.product_id,
        bp.price AS branch_price,
        bp.stock AS branch_stock,
        bp.is_available AS branch_is_available,
        bp.branch_category_id,
        bc.name AS branch_category_name,
        CASE WHEN bp.product_id IS NOT NULL THEN 1 ELSE 0 END AS is_adopted
      FROM branches b
      LEFT JOIN branch_products bp ON bp.branch_id = b.id AND bp.product_id = ?
      LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id
      WHERE b.brand_id = ? AND (b.is_archived = 0 OR b.is_archived IS NULL)
      ORDER BY b.name ASC
    `).all(req.params.id, req.brand_id);

    res.json({ success: true, product, branch_adoptions: branchAdoptions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/admin/products', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, category_id, price, regular_price, description, image, pricing_mode, min_price, max_price } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, error: 'Nama dan harga menu wajib diisi.' });

    // P1 TENANT CATEGORY INTEGRITY GUARD (FINDING 02)
    if (category_id) {
      const validCategory = db.prepare('SELECT id FROM categories WHERE id = ? AND brand_id = ?').get(category_id, req.brand_id);
      if (!validCategory) {
        return res.status(400).json({
          success: false,
          error: 'Kategori produk tidak ditemukan atau bukan milik brand ini.'
        });
      }
    }

    const id = 'prod_' + Date.now();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    db.prepare(`
      INSERT INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, pricing_mode, min_price, max_price, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products WHERE brand_id = ?))
    `).run(
      id,
      req.brand_id,
      category_id !== undefined ? category_id : null,
      name,
      slug,
      description !== undefined ? description : '',
      Number(price),
      regular_price ? Number(regular_price) : Number(price),
      pricing_mode || 'lock',
      min_price !== undefined ? Number(min_price) : null,
      max_price !== undefined ? Number(max_price) : null,
      req.brand_id
    );

    res.status(201).json({
      success: true,
      product: {
        id,
        name,
        category_id,
        price: Number(price),
        regular_price: regular_price ? Number(regular_price) : Number(price),
        description,
        image: image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400',
        is_active: 1
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/products/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, category_id, price, regular_price, description, image, is_active, pricing_mode, min_price, max_price } = req.body;

    // P1 TENANT CATEGORY INTEGRITY GUARD (FINDING 02)
    if (category_id !== undefined && category_id !== null) {
      const validCategory = db.prepare('SELECT id FROM categories WHERE id = ? AND brand_id = ?').get(category_id, req.brand_id);
      if (!validCategory) {
        return res.status(400).json({
          success: false,
          error: 'Kategori produk tidak ditemukan atau bukan milik brand ini.'
        });
      }
    }

    let normIsActive = null;
    if (is_active !== undefined && is_active !== null) {
      if (is_active === true || is_active === 1 || is_active === '1' || is_active === 'true') {
        normIsActive = 1;
      } else if (is_active === false || is_active === 0 || is_active === '0' || is_active === 'false') {
        normIsActive = 0;
      }
    }

    const stmt = db.prepare(`
      UPDATE products 
      SET name = COALESCE(?, name),
          category_id = COALESCE(?, category_id),
          price = COALESCE(?, price),
          regular_price = COALESCE(?, regular_price),
          pricing_mode = COALESCE(?, pricing_mode),
          min_price = COALESCE(?, min_price),
          max_price = COALESCE(?, max_price),
          description = COALESCE(?, description),
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
      WHERE id = ? AND brand_id = ?
    `).run(
      name !== undefined ? name : null,
      category_id !== undefined ? category_id : null,
      price !== undefined ? price : null,
      regular_price !== undefined ? regular_price : null,
      pricing_mode !== undefined ? pricing_mode : null,
      min_price !== undefined ? min_price : null,
      max_price !== undefined ? max_price : null,
      description !== undefined ? description : null,
      normIsActive !== null ? normIsActive : null,
      req.params.id,
      req.brand_id
    );

    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan atau tidak berubah.' });
    }

    res.json({ success: true, message: 'Menu produk berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/admin/products/:id/toggle', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const stmt = db.prepare(`
      UPDATE products 
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
          updated_at = datetime('now')
      WHERE id = ? AND brand_id = ?
    `).run(req.params.id, req.brand_id);

    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan atau tidak berubah.' });
    }

    res.json({ success: true, message: 'Status ketersediaan menu berhasil diubah.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/products/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM products WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);
    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan.' });
    }
    res.json({ success: true, message: 'Menu berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Admin Branches & Delivery Settings
router.get('/admin/branches', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const branches = db.prepare(`
      SELECT 
        b.id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone, b.whatsapp_number, b.is_active, b.is_open_override, b.is_archived, b.timezone,
        s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order,
        (SELECT COUNT(*) FROM orders o WHERE o.branch_id = b.id) AS total_orders,
        (SELECT COUNT(*) FROM orders o WHERE o.branch_id = b.id AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery')) AS active_orders
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.brand_id = ? AND (b.is_archived = 0 OR b.is_archived IS NULL)
    `).all(req.brand_id);

    res.json({ success: true, branches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14.1 Create Branch (Mandatory Branch WhatsApp Business Number - FINDING-03)
router.post('/admin/branches', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const {
      name,
      address_text,
      latitude,
      longitude,
      phone,
      whatsapp_number,
      free_delivery_km,
      price_per_km,
      max_radius_km,
      promo_min_order,
      promo_delivery_discount,
      timezone
    } = req.body;

    const rawWa = (whatsapp_number || phone || '').trim();

    // P1 BUSINESS INVARIANT (FINDING-03): Branch WhatsApp Business identity is mandatory & must be a valid mobile WA number
    if (!rawWa) {
      return res.status(400).json({
        success: false,
        error: 'Nomor WhatsApp Business cabang wajib diisi saat pendaftaran cabang.'
      });
    }

    // Validate standard Indonesian WhatsApp mobile format (e.g. 08..., 628..., +628...)
    const cleanDigits = rawWa.replace(/[^0-9]/g, '');
    const isIndoMobile = cleanDigits.startsWith('08') || cleanDigits.startsWith('628') || cleanDigits.startsWith('8');
    if (!isIndoMobile || cleanDigits.length < 9 || cleanDigits.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Format nomor WhatsApp cabang tidak valid. Harap gunakan format nomor ponsel WhatsApp aktif (contoh: 081234567890 atau 6281234567890).'
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Nama cabang wajib diisi.'
      });
    }

    const branchId = 'branch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const branchPhone = (phone || rawWa).trim();
    const branchWa = rawWa;

    const isOpenOverride = req.body.is_open_override !== undefined ? (req.body.is_open_override ? 1 : 0) : 1;
    const branchTimezone = String(timezone || 'Asia/Jakarta').trim();
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: branchTimezone }).format(new Date());
    } catch (_) {
      return res.status(400).json({ success: false, error: 'Timezone cabang tidak valid. Gunakan IANA timezone seperti Asia/Jakarta.' });
    }

    db.prepare(`
      INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, whatsapp_number, is_active, is_open_override, timezone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      branchId,
      req.brand_id,
      name.trim(),
      slug,
      address_text ? address_text.trim() : '',
      latitude !== undefined ? latitude : 0,
      longitude !== undefined ? longitude : 0,
      branchPhone,
      branchWa,
      isOpenOverride,
      branchTimezone
    );

    const deliverySettingsId = 'bds_' + branchId;
    db.prepare(`
      INSERT OR REPLACE INTO branch_delivery_settings (id, branch_id, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      deliverySettingsId,
      branchId,
      free_delivery_km !== undefined ? free_delivery_km : 0,
      price_per_km !== undefined ? price_per_km : 3000,
      max_radius_km !== undefined ? max_radius_km : 10,
      promo_min_order !== undefined ? promo_min_order : 50000,
      promo_delivery_discount !== undefined ? promo_delivery_discount : 0
    );

    res.status(201).json({
      success: true,
      message: 'Cabang berhasil didaftarkan.',
      branch_id: branchId,
      branch: {
        id: branchId,
        brand_id: req.brand_id,
        name: name.trim(),
        slug,
        phone: branchPhone,
        whatsapp_number: branchWa,
        address_text: address_text || '',
        is_active: 1,
        is_open_override: isOpenOverride,
        timezone: branchTimezone
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14.1.1 Get Single Branch Detail
router.get('/admin/branches/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan untuk mengakses cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare(`
      SELECT 
        b.id, b.brand_id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone, b.whatsapp_number, b.is_active, b.is_open_override, b.is_archived, b.timezone,
        b.created_at, b.updated_at,
        s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order,
        (SELECT COUNT(*) FROM branch_products bp WHERE bp.branch_id = b.id) AS adopted_products_count,
        (SELECT COUNT(*) FROM branch_categories bc WHERE bc.branch_id = b.id) AS branch_categories_count,
        (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.brand_id = b.brand_id) AS staff_count,
        (SELECT COUNT(*) FROM orders o WHERE o.branch_id = b.id) AS total_orders,
        (SELECT COUNT(*) FROM orders o WHERE o.branch_id = b.id AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery')) AS active_orders
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.id = ? AND b.brand_id = ? AND (b.is_archived = 0 OR b.is_archived IS NULL)
    `).get(req.params.id, req.brand_id);

    if (!branch) {
      return res.status(404).json({
        success: false,
        error: 'BRANCH_NOT_FOUND',
        message: 'Cabang tidak ditemukan pada brand ini.'
      });
    }

    res.json({ success: true, branch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/branches/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { name, address_text, latitude, longitude, phone, whatsapp_number, is_active, is_open_override, is_delivery_active, is_pickup_active, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount, timezone, reservation_max_guests } = req.body;
    const targetPhone = phone !== undefined ? phone : null;
    const targetWa = whatsapp_number !== undefined ? whatsapp_number : null;

    // B1 OPERATIONAL STATE VALIDATION (B1.3): authoritative branch operational booleans
    // (is_active lifecycle, is_open_override open/close switch) accept ONLY 0 or 1.
    // Rejects invalid transitions instead of silently persisting arbitrary client values.
    const normBoolField = (value) => {
      if (value === undefined || value === null) return null;
      if (value === true) return 1;
      if (value === false) return 0;
      const n = Number(value);
      if (n !== 0 && n !== 1) return undefined; // sentinel: invalid
      return n;
    };
    const providedIsActive = normBoolField(is_active);
    const providedIsOpenOverride = normBoolField(is_open_override);
    if (is_active !== undefined && providedIsActive === undefined) {
      return res.status(400).json({ success: false, error: 'Nilai is_active tidak valid. Gunakan 0 atau 1.' });
    }
    if (is_open_override !== undefined && providedIsOpenOverride === undefined) {
      return res.status(400).json({ success: false, error: 'Nilai is_open_override tidak valid. Gunakan 0 atau 1.' });
    }

    // P1 TENANT WRITE BOUNDARY GUARD (FINDING 01): Verify branch ownership before ANY mutation
    // B1: full pre-mutation snapshot is captured so every authorized change is auditable (B1.10).
    const existingBranch = db.prepare(`
      SELECT id, name, address_text, latitude, longitude, phone, whatsapp_number, is_active, is_open_override, timezone
      FROM branches WHERE id = ? AND brand_id = ?
    `).get(req.params.id, req.brand_id);
    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        error: 'Cabang tidak ditemukan pada brand ini.'
      });
    }

    let normalizedTimezone = timezone === undefined
      ? (existingBranch.timezone || 'Asia/Jakarta')
      : String(timezone || '').trim();

    if (!normalizedTimezone) normalizedTimezone = 'Asia/Jakarta';

    if (timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: normalizedTimezone }).format(new Date());
      } catch (_) {
        return res.status(400).json({
          success: false,
          error: 'Timezone cabang tidak valid. Gunakan IANA timezone seperti Asia/Jakarta.'
        });
      }
    }

    if (req.user.role === 'branch_manager' &&
        timezone !== undefined &&
        normalizedTimezone !== (existingBranch.timezone || 'Asia/Jakarta')) {
      return res.status(403).json({
        success: false,
        error: 'Branch Manager tidak berwenang mengubah timezone cabang.'
      });
    }

    const existingSettings = db.prepare(`
      SELECT free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount
      FROM branch_delivery_settings WHERE branch_id = ?
    `).get(req.params.id) || {};

    // P1 RBAC BRANCH SCOPE GUARD: Branch Manager can ONLY update their assigned branch profile
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan untuk memperbarui profil cabang yang ditugaskan.'
        });
      }
      // GLOBAL BRANCH ACTIVATION GUARD: Only Owner / Brand Manager can mutate is_active
      if (is_active !== undefined) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Hanya Pemilik Toko (Owner) atau Brand Manager yang berwenang mengubah status aktivasi global cabang.'
        });
      }
      // DELIVERY SETTINGS GUARD: Branch Manager cannot change delivery fee policy (ongkir formula)
      const deliveryFields = [free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount];
      const deliveryFieldNames = ['free_delivery_km', 'price_per_km', 'max_radius_km', 'promo_min_order', 'promo_delivery_discount'];
      const hasDeliveryChange = deliveryFields.some((v, i) => v !== undefined && v !== null && String(v) !== String(Object.values(existingSettings)[i] ?? ''));
      if (hasDeliveryChange) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Hanya Pemilik Toko (Owner) atau Brand Manager yang berwenang mengubah pengaturan ongkir dan promosi pengiriman.'
        });
      }
    }

    // Kapasitas reservasi: bilangan bulat 1..1000. 0 berarti DIKOSONGKAN lagi
    // (reservasi jadi mati di aplikasi konsumen). NULL/undefined = tidak diubah,
    // karena UPDATE memakai COALESCE.
    let normalizedMaxGuests = null;
    if (reservation_max_guests !== undefined && reservation_max_guests !== null && String(reservation_max_guests).trim() !== '') {
      const n = Number(reservation_max_guests);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1000) {
        return res.status(400).json({
          success: false,
          error: 'Kapasitas maksimal reservasi harus bilangan bulat antara 0 dan 1000. Isi 0 untuk mengosongkan.'
        });
      }
      normalizedMaxGuests = n;
    }

    if (targetWa !== null && targetWa !== undefined) {
      const cleanWaDigits = String(targetWa).replace(/[^0-9]/g, '');
      const isIndoMobile = cleanWaDigits.startsWith('08') || cleanWaDigits.startsWith('628') || cleanWaDigits.startsWith('8');
      if (String(targetWa).trim() === '' || !isIndoMobile || cleanWaDigits.length < 9) {
        return res.status(400).json({
          success: false,
          error: 'Format nomor WhatsApp cabang tidak valid. Harap gunakan format nomor ponsel WhatsApp aktif.'
        });
      }
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        UPDATE branches 
        SET name = COALESCE(?, name),
            address_text = COALESCE(?, address_text),
            latitude = COALESCE(?, latitude),
            longitude = COALESCE(?, longitude),
            phone = COALESCE(?, phone),
            whatsapp_number = COALESCE(?, whatsapp_number),
            is_active = COALESCE(?, is_active),
            is_open_override = COALESCE(?, is_open_override),
            timezone = COALESCE(?, timezone),
            reservation_max_guests = COALESCE(?, reservation_max_guests),
            updated_at = datetime('now')
        WHERE id = ? AND brand_id = ?
      `).run(
        name !== undefined ? name : null,
        address_text !== undefined ? address_text : null,
        latitude !== undefined ? latitude : null,
        longitude !== undefined ? longitude : null,
        targetPhone !== undefined ? targetPhone : null,
        targetWa !== undefined ? targetWa : null,
        providedIsActive,
        providedIsOpenOverride,
        timezone !== undefined ? normalizedTimezone : null,
        normalizedMaxGuests,
        req.params.id,
        req.brand_id
      );

      // Scoped update with explicit tenant subquery guard
      const normToggle = (v) => {
        if (v === undefined || v === null) return null;
        if (v === true || v === 1 || v === '1') return 1;
        if (v === false || v === 0 || v === '0') return 0;
        return null;
      };
      const providedIsDelivery = normToggle(is_delivery_active);
      const providedIsPickup = normToggle(is_pickup_active);

      db.prepare(`
        INSERT INTO branch_delivery_settings (id, branch_id, is_delivery_active, is_pickup_active, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(branch_id) DO UPDATE SET
          is_delivery_active = COALESCE(excluded.is_delivery_active, branch_delivery_settings.is_delivery_active),
          is_pickup_active = COALESCE(excluded.is_pickup_active, branch_delivery_settings.is_pickup_active),
          free_delivery_km = COALESCE(excluded.free_delivery_km, branch_delivery_settings.free_delivery_km),
          price_per_km = COALESCE(excluded.price_per_km, branch_delivery_settings.price_per_km),
          max_radius_km = COALESCE(excluded.max_radius_km, branch_delivery_settings.max_radius_km),
          promo_min_order = COALESCE(excluded.promo_min_order, branch_delivery_settings.promo_min_order),
          promo_delivery_discount = COALESCE(excluded.promo_delivery_discount, branch_delivery_settings.promo_delivery_discount),
          updated_at = datetime('now')
      `).run(
        'bds_' + req.params.id,
        req.params.id,
        providedIsDelivery,
        providedIsPickup,
        free_delivery_km !== undefined ? free_delivery_km : null,
        price_per_km !== undefined ? price_per_km : null,
        max_radius_km !== undefined ? max_radius_km : null,
        promo_min_order !== undefined ? promo_min_order : null,
        promo_delivery_discount !== undefined ? promo_delivery_discount : null
      );

      // B1 OPERATIONAL AUDIT TRAIL (B1.10): append-only branch_operation_logs rows for every
      // field actually changed by this AUTHORIZED mutation. Records what changed, which branch,
      // who performed it (actor id + role), and that authorization/scope was satisfied.
      const stringifyScalar = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
      const normNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
      const scalarChanged = (prev, next, isNum) => {
        const p = prev === undefined ? null : prev;
        const n = next === undefined ? null : next;
        if (p === null && n === null) return false;
        if (p === null || n === null) return true;
        if (isNum) return Number(p) !== Number(n);
        return String(p) !== String(n);
      };

      const prevOpen = (existingBranch.is_open_override === null || existingBranch.is_open_override === undefined) ? 1 : existingBranch.is_open_override;
      const tracked = [
        { field: 'name', prev: existingBranch.name, next: name !== undefined ? String(name) : existingBranch.name, isNum: false },
        { field: 'address_text', prev: existingBranch.address_text, next: address_text !== undefined ? String(address_text) : existingBranch.address_text, isNum: false },
        { field: 'latitude', prev: existingBranch.latitude, next: latitude !== undefined ? normNum(latitude) : existingBranch.latitude, isNum: true },
        { field: 'longitude', prev: existingBranch.longitude, next: longitude !== undefined ? normNum(longitude) : existingBranch.longitude, isNum: true },
        { field: 'phone', prev: existingBranch.phone, next: targetPhone !== undefined ? String(targetPhone) : existingBranch.phone, isNum: false },
        { field: 'whatsapp_number', prev: existingBranch.whatsapp_number || null, next: targetWa !== undefined ? String(targetWa) : (existingBranch.whatsapp_number || null), isNum: false },
        { field: 'is_active', prev: existingBranch.is_active, next: providedIsActive !== null ? providedIsActive : existingBranch.is_active, isNum: true },
        { field: 'is_open_override', prev: prevOpen, next: providedIsOpenOverride !== null ? providedIsOpenOverride : prevOpen, isNum: true },
        { field: 'timezone', prev: existingBranch.timezone || 'Asia/Jakarta', next: timezone !== undefined ? normalizedTimezone : (existingBranch.timezone || 'Asia/Jakarta'), isNum: false }
      ];

      const hadSettingsRow = Boolean(db.prepare('SELECT 1 FROM branch_delivery_settings WHERE branch_id = ?').get(req.params.id));
      if (hadSettingsRow) {
        const sPrev = existingSettings;
        tracked.push(
          { field: 'free_delivery_km', prev: sPrev.free_delivery_km, next: free_delivery_km !== undefined ? normNum(free_delivery_km) : sPrev.free_delivery_km, isNum: true },
          { field: 'price_per_km', prev: sPrev.price_per_km, next: price_per_km !== undefined ? normNum(price_per_km) : sPrev.price_per_km, isNum: true },
          { field: 'max_radius_km', prev: sPrev.max_radius_km, next: max_radius_km !== undefined ? normNum(max_radius_km) : sPrev.max_radius_km, isNum: true },
          { field: 'promo_min_order', prev: sPrev.promo_min_order, next: promo_min_order !== undefined ? normNum(promo_min_order) : sPrev.promo_min_order, isNum: true },
          { field: 'promo_delivery_discount', prev: sPrev.promo_delivery_discount, next: promo_delivery_discount !== undefined ? normNum(promo_delivery_discount) : sPrev.promo_delivery_discount, isNum: true }
        );
      }

      const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
      const actorRole = req.user ? (req.user.role || 'system') : 'system';
      for (const t of tracked) {
        if (!scalarChanged(t.prev, t.next, t.isNum)) continue;
        db.prepare(`
          INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
          VALUES (?, ?, ?, ?, 'branch.update', ?, ?, ?, ?, ?, 1)
        `).run(
          'bol_' + crypto.randomUUID(),
          existingBranch.id,
          req.brand_id,
          req.organization_id || null,
          t.field,
          stringifyScalar(t.prev),
          stringifyScalar(t.next),
          actorId,
          actorRole
        );
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({
      success: true,
      message: 'Pengaturan cabang & ongkir berhasil disimpan.',
      branch: {
        id: existingBranch.id,
        is_active: providedIsActive !== null ? providedIsActive : existingBranch.is_active,
        is_open_override: providedIsOpenOverride !== null ? providedIsOpenOverride : (existingBranch.is_open_override == null ? 1 : existingBranch.is_open_override),
        timezone: timezone !== undefined ? normalizedTimezone : (existingBranch.timezone || 'Asia/Jakarta')
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/branches/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const existing = db.prepare('SELECT id, name, is_active, is_archived FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Cabang tidak ditemukan pada brand ini.'
      });
    }

    // Active orders in progress
    const activeOrderRow = db.prepare(`
      SELECT COUNT(*) as count FROM orders 
      WHERE branch_id = ? AND status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
    `).get(req.params.id);
    const activeOrders = (activeOrderRow && activeOrderRow.count) ? activeOrderRow.count : 0;

    // Total order history
    const totalOrderRow = db.prepare('SELECT COUNT(*) as count FROM orders WHERE branch_id = ?').get(req.params.id);
    const totalOrders = (totalOrderRow && totalOrderRow.count) ? totalOrderRow.count : 0;

    const isBranchActive = existing.is_active === 1 || existing.is_active === true;

    // Rule 1: Cabang aktif dengan pesanan aktif -> tidak boleh dihapus.
    if (isBranchActive && activeOrders > 0) {
      return res.status(400).json({
        success: false,
        error: `Cabang "${existing.name}" masih aktif dan sedang melayani ${activeOrders} pesanan aktif. Selesaikan atau batalkan pesanan terlebih dahulu sebelum memproses cabang ini.`
      });
    }

    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';

    // Rule 2: Cabang nonaktif yang memiliki riwayat transaksi -> jangan hard delete, gunakan Archive.
    if (totalOrders > 0) {
      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare('UPDATE branches SET is_archived = 1, updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);

        db.prepare(`
          INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
          VALUES (?, ?, ?, ?, 'branch.archive', 'is_archived', '0', '1', ?, ?, 1)
        `).run(
          'bol_' + crypto.randomUUID(),
          existing.id,
          req.brand_id,
          req.organization_id || null,
          actorId,
          actorRole
        );

        db.exec('COMMIT;');
      } catch (txErr) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw txErr;
      }

      return res.json({
        success: true,
        archived: true,
        message: `Cabang "${existing.name}" berhasil diarsipkan karena memiliki riwayat transaksi. Data riwayat pesanan tetap tersimpan dengan aman.`,
        branch_id: req.params.id
      });
    }

    // Rule 3: Cabang nonaktif tanpa riwayat transaksi -> boleh dihapus permanen.
    db.exec('BEGIN TRANSACTION;');
    try {
      // Unlink users assigned to this branch
      db.prepare('UPDATE users SET branch_id = NULL WHERE branch_id = ?').run(req.params.id);

      // Clean up child tables
      db.prepare('DELETE FROM branch_delivery_settings WHERE branch_id = ?').run(req.params.id);
      db.prepare('DELETE FROM branch_products WHERE branch_id = ?').run(req.params.id);
      db.prepare('DELETE FROM branch_categories WHERE branch_id = ?').run(req.params.id);
      db.prepare('DELETE FROM branch_operation_logs WHERE branch_id = ?').run(req.params.id);

      // Delete the branch row
      db.prepare('DELETE FROM branches WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);

      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({
      success: true,
      archived: false,
      message: `Cabang "${existing.name}" berhasil dihapus permanen.`,
      branch_id: req.params.id
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14.1.3 Get Branch Operational Activity Logs
router.get('/admin/branches/:id/operation-logs', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan untuk melihat log cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        error: 'BRANCH_NOT_FOUND',
        message: 'Cabang tidak ditemukan pada brand ini.'
      });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const logs = db.prepare(`
      SELECT id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized, created_at
      FROM branch_operation_logs
      WHERE branch_id = ? AND brand_id = ?
      ORDER BY datetime(created_at) DESC, rowid DESC
      LIMIT ?
    `).all(req.params.id, req.brand_id, limit);

    res.json({
      success: true,
      logs: logs || []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================================
   C1 — PRODUCT → BRANCH ASSIGNMENT BOUNDARY
   Product Master stays brand-owned (products.brand_id). A branch_products row
   is the EXPLICIT assignment of a brand product to a branch of the SAME brand.
   - Assignment (create/list) = Owner / Brand authority.
   - Operational availability toggle (is_available) = Branch Manager within
     their own branch, or Owner / Brand.
   - Assignment NEVER mutates stock: physical stock belongs to the Inventory
     domain and is intentionally not fabricated here (stock stays NULL).
   ========================================================================= */

// C1 List assignments of one branch
router.get('/admin/branches/:id/products', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const assignments = db.prepare(`
      SELECT bp.branch_id, bp.product_id, bp.price, bp.stock, bp.is_available, bp.low_stock_threshold,
             p.name AS product_name, p.is_active AS is_master_active,
             c.name AS category_name
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.params.id);

    res.json({ success: true, branch_id: req.params.id, assignments: assignments || [] });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/products]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Branch orders — enforces branch scope for branch_manager (mirrors products route)
router.get('/admin/branches/:id/orders', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_ACCESS',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const statusFilter = req.query.status;
    let query = `
      SELECT o.*, b.name as branch_name 
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.brand_id = ? AND o.branch_id = ?
    `;
    const params = [req.brand_id, req.params.id];

    if (statusFilter && statusFilter !== 'all') {
      query += ' AND o.status = ?';
      params.push(statusFilter);
    }

    query += ' ORDER BY o.created_at DESC';

    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 200) : 100;
    query += ` LIMIT ${limit}`;

    if (req.query.offset) {
      query += ` OFFSET ${parseInt(req.query.offset, 10)}`;
    }

    const orders = db.prepare(query).all(...params);

    const enriched = orders.map(ord => ({
      ...ord,
      acceptance_deadline_at: ord.acceptance_deadline_at || AcceptanceTimeoutService.computeAcceptanceDeadlineAt(ord),
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
      delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id),
      payment: db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(ord.id)
    }));

    res.json({ success: true, branch_id: req.params.id, orders: enriched });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/orders]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


router.post('/admin/branches/:id/products', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const productId = String((req.body && req.body.product_id) || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, error: 'product_id wajib diisi.' });
    }

    // Branch ownership (tenant-scoped)
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    // C1.3 Brand consistency: the product master must belong to the SAME brand as the branch.
    // (A product of another brand is not found here → cross-brand assignment is impossible.)
    const product = db.prepare('SELECT id, brand_id, price, is_active FROM products WHERE id = ? AND brand_id = ?').get(productId, req.brand_id);
    if (!product) {
      return res.status(400).json({
        success: false,
        error: 'PRODUCT_BRAND_MISMATCH',
        message: 'Produk tidak ditemukan atau bukan milik brand ini; produk hanya dapat dialokasikan ke cabang brand yang sama.'
      });
    }
    if (product.is_active === 0) {
      return res.status(400).json({
        success: false,
        error: 'PRODUCT_INACTIVE',
        message: 'Produk master sedang nonaktif dan tidak dapat dialokasikan ke cabang.'
      });
    }

    // C1.4 Assignment != Inventory: the assignment row is created WITHOUT fabricating stock.
    // stock stays NULL until the Inventory domain records actual branch stock.
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock)
      VALUES (?, ?, ?, NULL)
    `).run(req.params.id, productId, product.price != null ? product.price : null);
    const alreadyAssigned = !stmt || stmt.changes === 0;

    const assignment = db.prepare(`
      SELECT branch_id, product_id, price, stock, is_available, low_stock_threshold
      FROM branch_products WHERE branch_id = ? AND product_id = ?
    `).get(req.params.id, productId);

    res.status(alreadyAssigned ? 200 : 201).json({
      success: true,
      already_assigned: alreadyAssigned,
      assignment
    });
  } catch (err) {
    if (String(err && err.message).includes('CROSS_BRAND_ASSIGNMENT_REJECTED')) {
      return res.status(400).json({
        success: false,
        error: 'CROSS_BRAND_ASSIGNMENT_REJECTED',
        message: 'Produk dan cabang harus berasal dari brand yang sama.'
      });
    }
    console.error('[API Error POST /admin/branches/:id/products]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1 Toggle operational availability (is_available) of an assigned product.
// Branch Manager limited to own branch; Owner/Brand anywhere in their brand.
router.patch('/admin/branches/:id/products/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    // Strict 0|1 validation of the availability flag.
    const rawAvail = req.body && req.body.is_available;
    let nextAvailability = null;
    if (rawAvail !== undefined && rawAvail !== null) {
      if (rawAvail === true) nextAvailability = 1;
      else if (rawAvail === false) nextAvailability = 0;
      else {
        const n = Number(rawAvail);
        if (n !== 0 && n !== 1) {
          return res.status(400).json({ success: false, error: 'Nilai is_available tidak valid. Gunakan 0 atau 1.' });
        }
        nextAvailability = n;
      }
    } else if (rawAvail === null) {
      return res.status(400).json({ success: false, error: 'Nilai is_available tidak valid. Gunakan 0 atau 1.' });
    }
    if (nextAvailability === null) {
      return res.status(400).json({ success: false, error: 'Nilai is_available wajib diisi (0 atau 1).' });
    }

    // Branch Manager may only toggle their OWN branch.
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    // Branch ownership + assignment existence with brand-consistent product.
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }
    const assignment = db.prepare(`
      SELECT bp.branch_id, bp.product_id, bp.is_available, p.name AS product_name
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.brand_id, req.params.id, req.params.productId);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Produk tidak dialokasikan ke cabang ini.'
      });
    }

    const previousValue = assignment.is_available;
    const stmt = db.prepare(`
      UPDATE branch_products SET is_available = ?, updated_at = datetime('now')
      WHERE branch_id = ? AND product_id = ?
    `).run(nextAvailability, req.params.id, req.params.productId);
    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Alokasi produk tidak ditemukan.' });
    }

    // B1/C1 operational audit trail (append-only).
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product.update', 'is_available', ?, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify(previousValue),
      JSON.stringify(nextAvailability),
      req.user.userId || req.user.id || req.user.username || 'system',
      req.user.role || 'system'
    );

    res.json({
      success: true,
      assignment: {
        branch_id: req.params.id,
        product_id: req.params.productId,
        product_name: assignment.product_name,
        is_available: nextAvailability
      }
    });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/products/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.5 Comprehensive Branch Catalog View (Adopted & Available Master Products)
router.get('/admin/branches/:id/catalog', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id, name, slug, address_text, is_active FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const branchCategories = db.prepare(`
      SELECT bc.id, bc.brand_id, bc.branch_id, bc.name, bc.slug, bc.image_url, bc.sort_order,
        (SELECT COUNT(*) FROM branch_product_categories bpc WHERE bpc.branch_category_id = bc.id) AS product_count
      FROM branch_categories bc
      WHERE bc.branch_id = ? AND bc.brand_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.brand_id);

    const adoptedProducts = db.prepare(`
      SELECT 
        bp.product_id,
        COALESCE(bp.name_override, p.name) as name,
        COALESCE(bp.description_override, p.description) as description,
        COALESCE(bp.image_override, p.image_url) as image_url,
        bp.name_override,
        bp.description_override,
        bp.image_override,
        p.name as master_name,
        p.description as master_description,
        p.image_url as master_image_url,
        bp.branch_category_id,
        bc.name as branch_category_name,
        bp.price,
        p.price as master_price,
        p.pricing_mode,
        p.min_price,
        p.max_price,
        bp.stock,
        bp.is_available
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.brand_id, req.params.id);

    // M:N category memberships per product
    let productCategoryRows = [];
    try {
      productCategoryRows = db.prepare(`
        SELECT bpc.product_id, bpc.branch_category_id, bc.name as category_name, bc.slug as category_slug
        FROM branch_product_categories bpc
        JOIN branch_categories bc ON bc.id = bpc.branch_category_id
        WHERE bpc.branch_id = ?
        ORDER BY bc.sort_order ASC, bc.name ASC
      `).all(req.params.id);
    } catch (_) {}

    const productCategoriesMap = {};
    for (const r of productCategoryRows) {
      if (!productCategoriesMap[r.product_id]) productCategoriesMap[r.product_id] = [];
      productCategoriesMap[r.product_id].push({
        id: r.branch_category_id,
        name: r.category_name,
        slug: r.category_slug
      });
    }

    const enrichedAdopted = adoptedProducts.map(p => {
      const cats = productCategoriesMap[p.product_id] || [];
      const catIds = cats.map(c => c.id);
      if (catIds.length === 0 && p.branch_category_id) {
        catIds.push(p.branch_category_id);
        if (p.branch_category_name) {
          cats.push({ id: p.branch_category_id, name: p.branch_category_name, slug: '' });
        }
      }
      return {
        ...p,
        category_ids: catIds,
        categories: cats,
        branch_category_id: catIds[0] || p.branch_category_id || null,
        branch_category_name: cats.map(c => c.name).join(', ') || p.branch_category_name || null
      };
    });

    const adoptedIds = adoptedProducts.map(ap => ap.product_id);
    const placeholders = adoptedIds.length > 0 ? adoptedIds.map(() => '?').join(',') : null;
    const masterQuery = placeholders
      ? `SELECT id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price
         FROM products WHERE brand_id = ? AND (is_active = 1 OR is_active IS NULL) AND id NOT IN (${placeholders}) ORDER BY sort_order ASC, name ASC`
      : `SELECT id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price
         FROM products WHERE brand_id = ? AND (is_active = 1 OR is_active IS NULL) ORDER BY sort_order ASC, name ASC`;
    const masterParams = placeholders ? [req.brand_id, ...adoptedIds] : [req.brand_id];
    const availableMasterProducts = db.prepare(masterQuery).all(...masterParams);

    res.json({
      success: true,
      branch,
      categories: branchCategories,
      adopted_products: enrichedAdopted,
      available_master_products: availableMasterProducts
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/catalog]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.6 Adopt / Add Product to Branch Catalog with Pricing Policy enforcement
router.post('/admin/branches/:id/adopt', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const productId = String((req.body && req.body.product_id) || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, error: 'product_id wajib diisi.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const product = db.prepare(`
      SELECT id, brand_id, category_id, name, description, image_url, price, pricing_mode, min_price, max_price, is_active
      FROM products WHERE id = ? AND brand_id = ?
    `).get(productId, req.brand_id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produk master tidak ditemukan pada brand ini.' });
    }
    if (product.is_active === 0) {
      return res.status(400).json({ success: false, error: 'Produk master sedang nonaktif dan tidak dapat diadopsi.' });
    }

    // Resolve price according to locked PricingPolicyModel:
    // If pricing_mode is 'lock', branch CANNOT override price (enforces master price)
    const mode = (product.pricing_mode || 'lock').toLowerCase();
    const rawPriceInput = mode === 'lock'
      ? null
      : (req.body.price !== undefined && req.body.price !== null && req.body.price !== '' ? Number(req.body.price) : null);

    let resolved;
    try {
      resolved = PricingPolicyModel.resolvePrice(
        {
          price: product.price,
          pricing_mode: product.pricing_mode || 'lock',
          min_price: product.min_price,
          max_price: product.max_price
        },
        rawPriceInput
      );
    } catch (pricingErr) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_BRANCH_PRICE',
        message: pricingErr.message
      });
    }

    // Branch Category handling: supports category_ids (array) or branch_category_id (scalar)
    let targetCategoryIds = [];
    if (Array.isArray(req.body.category_ids) && req.body.category_ids.length > 0) {
      for (const rawId of req.body.category_ids) {
        const idStr = String(rawId).trim();
        const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ?').get(idStr, req.params.id);
        if (validCat && !targetCategoryIds.includes(idStr)) targetCategoryIds.push(idStr);
      }
    } else if (req.body.branch_category_id) {
      const idStr = String(req.body.branch_category_id).trim();
      const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ?').get(idStr, req.params.id);
      if (validCat) targetCategoryIds.push(idStr);
    }

    // If no branch category specified, resolve or auto-create branch category from master category name
    if (targetCategoryIds.length === 0) {
      const masterCat = product.category_id ? db.prepare('SELECT name, slug FROM categories WHERE id = ?').get(product.category_id) : null;
      const catName = masterCat?.name || 'Menu Utama';
      const catSlug = masterCat?.slug || 'menu-utama';

      let existingBranchCat = db.prepare('SELECT id FROM branch_categories WHERE branch_id = ? AND name = ?').get(req.params.id, catName);
      if (!existingBranchCat) {
        const newBcId = 'bc_' + crypto.randomUUID();
        db.prepare(`
          INSERT INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
          VALUES (?, ?, ?, ?, ?, 99)
        `).run(newBcId, req.brand_id, req.params.id, catName, catSlug);
        targetCategoryIds.push(newBcId);
      } else {
        targetCategoryIds.push(existingBranchCat.id);
      }
    }

    const primaryBranchCategoryId = targetCategoryIds[0] || null;

    // Insert or adopt branch_products (override columns start NULL = inherit master).
    db.prepare(`
      INSERT INTO branch_products (
        branch_id, product_id, branch_category_id, price, is_available, stock
      ) VALUES (?, ?, ?, ?, 1, 100)
      ON CONFLICT(branch_id, product_id) DO UPDATE SET
        branch_category_id = excluded.branch_category_id,
        price = excluded.price,
        is_available = 1,
        updated_at = datetime('now')
    `).run(
      req.params.id,
      product.id,
      primaryBranchCategoryId,
      resolved.effective_price
    );

    // M:N category junction
    for (const catId of targetCategoryIds) {
      db.prepare(`
        INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id)
        VALUES (?, ?, ?)
      `).run(req.params.id, product.id, catId);
    }

    // Audit trail
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product.adopt', 'product_id', NULL, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      product.id,
      JSON.stringify({ product_id: product.id, price: resolved.effective_price, branch_category_id: primaryBranchCategoryId, category_ids: targetCategoryIds }),
      actorId,
      actorRole
    );

    res.status(201).json({
      success: true,
      message: 'Produk berhasil diadopsi ke katalog cabang.',
      adopted: {
        branch_id: req.params.id,
        product_id: product.id,
        price: resolved.effective_price,
        branch_category_id: primaryBranchCategoryId,
        category_ids: targetCategoryIds
      }
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/adopt]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.7 Remove (Un-adopt) Product from Branch Catalog
router.delete('/admin/branches/:id/products/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    db.prepare('DELETE FROM branch_product_categories WHERE branch_id = ? AND product_id = ?').run(req.params.id, req.params.productId);
    const stmt = db.prepare('DELETE FROM branch_products WHERE branch_id = ? AND product_id = ?').run(req.params.id, req.params.productId);
    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });
    }

    // Audit log
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product.remove', 'product_id', ?, NULL, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify({ product_id: req.params.productId }),
      actorId,
      actorRole
    );

    res.json({
      success: true,
      message: 'Produk berhasil dihapus dari katalog cabang.'
    });
  } catch (err) {
    console.error('[API Error DELETE /admin/branches/:id/products/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.9 Sync Branch Catalog to Connector — pushes branch catalog data from Core DB to the
// enterprise connector's client DB. Idempotent, safe to run repeatedly.
router.post('/admin/branches/:id/sync-catalog', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const branchId = req.params.id;
    const brandId = req.brand_id;

    const branch = db.prepare('SELECT id, brand_id, name FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    let connectorClient;
    try {
      connectorClient = new XentraConnectorClient();
    } catch (_e) {
      return res.status(503).json({ success: false, error: 'Connector not configured' });
    }

    const branchCategories = db.prepare(
      'SELECT id, brand_id, branch_id, name, image_url, sort_order FROM branch_categories WHERE branch_id = ?'
    ).all(branchId);

    const branchProducts = db.prepare(
      'SELECT branch_id, product_id, branch_category_id, name_override, description_override, image_override, price, stock, is_available, low_stock_threshold, created_at FROM branch_products WHERE branch_id = ?'
    ).all(branchId);

    if (branchProducts.length === 0) {
      return res.status(400).json({ success: false, error: 'Branch has no products to sync' });
    }

    const productIds = branchProducts.map((bp) => bp.product_id);
    const placeholders = productIds.map(() => '?').join(',');
    const masterProducts = db.prepare(
      `SELECT id, brand_id, name, slug, description, image_url, category_id FROM products WHERE brand_id = ? AND id IN (${placeholders})`
    ).all(brandId, ...productIds);

    if (masterProducts.length !== branchProducts.length) {
      return res.status(409).json({ success: false, error: 'Branch catalog contains products outside this brand' });
    }

    const mutationId = `catalog_sync_${branchId}_${Date.now()}`;

    const result = await connectorClient.syncBranchCatalog({
      mutation_id: mutationId,
      brand_id: brandId,
      branch_id: branchId,
      categories: branchCategories.map((c) => ({
        id: c.id,
        name: c.name,
        image_url: c.image_url || null,
        sort_order: c.sort_order || 0,
      })),
      products: masterProducts.map((p) => {
        const bp = branchProducts.find((b) => b.product_id === p.id);
        return {
          id: p.id,
          name: p.name,
          slug: p.slug || '',
          description: p.description || '',
          image_url: p.image_url || null,
          category_id: p.category_id || null,
          branch_category_id: bp.branch_category_id || null,
          name_override: bp.name_override || null,
          description_override: bp.description_override || null,
          image_override: bp.image_override || null,
          price: bp.price,
          stock: bp.stock,
          is_available: Boolean(bp.is_available),
          low_stock_threshold: bp.low_stock_threshold,
          created_at: bp.created_at || new Date().toISOString(),
        };
      }),
    });

    res.json({
      success: true,
      branch_id: branchId,
      categories_synced: result.result.categories_upserted,
      products_synced: result.result.products_upserted,
      branch_products_synced: result.result.branch_products_upserted,
      replay: Boolean(result.replay),
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/sync-catalog]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.8-OVR Branch Product Override — set or clear per-field content overrides
// plus pricing policy (price) and category assignment (branch_category_id).
// NULL body field = clear override (branch falls back to live Master Product value).
// Non-null body field = branch override wins at query time via COALESCE in CatalogService.
router.patch('/admin/branches/:id/products/:productId/override', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const bp = db.prepare(`
      SELECT bp.branch_id, bp.branch_category_id, bp.price,
             p.price as master_price, p.pricing_mode, p.min_price, p.max_price
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.brand_id, req.params.id, req.params.productId);
    if (!bp) {
      return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });
    }

    // Only fields explicitly present in the request body are updated.
    // Pass null to clear an override; omit the key entirely to leave it untouched.
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      updates.name_override = req.body.name != null ? String(req.body.name).trim() || null : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
      updates.description_override = req.body.description != null ? String(req.body.description).trim() || null : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'image_url')) {
      updates.image_override = req.body.image_url != null ? String(req.body.image_url).trim() || null : null;
    }

    // price — enforced by the same locked PricingPolicyModel used at adopt time:
    //   lock  → branch CANNOT change price (custom price rejected, master wins)
    //   range → branch price must sit inside [min_price, max_price]
    if (Object.prototype.hasOwnProperty.call(req.body, 'price')) {
      const rawPrice = req.body.price;
      const mode = (bp.pricing_mode || 'lock').toLowerCase();

      const branchPrice = (rawPrice === null || rawPrice === '' || rawPrice === undefined)
        ? bp.master_price
        : Number(rawPrice);
      if (!Number.isFinite(branchPrice) || branchPrice < 0) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH_PRICE', message: 'Harga cabang harus berupa angka positif.' });
      }
      if (mode === 'lock' && branchPrice !== bp.master_price) {
        return res.status(403).json({
          success: false,
          error: 'PRICE_LOCKED',
          message: 'Harga cabang dikunci owner. Tidak dapat diubah oleh cabang.'
        });
      }
      try {
        const resolved = PricingPolicyModel.resolvePrice(
          {
            price: bp.master_price,
            pricing_mode: mode,
            min_price: bp.min_price,
            max_price: bp.max_price
          },
          branchPrice
        );
        updates.price = resolved.effective_price;
      } catch (pricingErr) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH_PRICE', message: pricingErr.message });
      }
    }

    // Category assignment handling:
    // Supports category_ids (array for M:N) or branch_category_id (scalar for backward compatibility).
    let hasCategoryUpdate = false;
    let targetOverrideCatIds = null;
    if (Array.isArray(req.body.category_ids)) {
      hasCategoryUpdate = true;
      targetOverrideCatIds = [];
      for (const rawId of req.body.category_ids) {
        const catId = String(rawId).trim();
        const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
          .get(catId, req.params.id, req.brand_id);
        if (!validCat) {
          return res.status(400).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Kategori cabang tidak valid untuk cabang ini.'
          });
        }
        if (!targetOverrideCatIds.includes(catId)) targetOverrideCatIds.push(catId);
      }
      updates.branch_category_id = targetOverrideCatIds.length > 0 ? targetOverrideCatIds[0] : null;
    } else if (Object.prototype.hasOwnProperty.call(req.body, 'branch_category_id')) {
      hasCategoryUpdate = true;
      const rawCat = req.body.branch_category_id;
      if (rawCat === null || rawCat === '' || rawCat === undefined) {
        updates.branch_category_id = null;
        targetOverrideCatIds = [];
      } else {
        const catId = String(rawCat).trim();
        const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
          .get(catId, req.params.id, req.brand_id);
        if (!validCat) {
          return res.status(400).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Kategori cabang tidak valid untuk cabang ini.'
          });
        }
        updates.branch_category_id = catId;
        targetOverrideCatIds = [catId];
      }
    }

    if (Object.keys(updates).length === 0 && !hasCategoryUpdate) {
      return res.status(400).json({ success: false, error: 'Tidak ada field override yang disediakan (name, description, image_url, price, branch_category_id, category_ids).' });
    }

    if (Object.keys(updates).length > 0) {
      const setParts = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), req.params.id, req.params.productId];
      db.prepare(`UPDATE branch_products SET ${setParts}, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?`).run(...values);
    }

    if (hasCategoryUpdate && targetOverrideCatIds !== null) {
      db.prepare('DELETE FROM branch_product_categories WHERE branch_id = ? AND product_id = ?')
        .run(req.params.id, req.params.productId);
      for (const catId of targetOverrideCatIds) {
        db.prepare(`
          INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id)
          VALUES (?, ?, ?)
        `).run(req.params.id, req.params.productId, catId);
      }
    }

    // Read back the resolved state for the response
    const resolved = db.prepare(`
      SELECT
        COALESCE(bp.name_override, p.name) as name,
        COALESCE(bp.description_override, p.description) as description,
        COALESCE(bp.image_override, p.image_url) as image_url,
        bp.name_override, bp.description_override, bp.image_override,
        p.name as master_name, p.description as master_description, p.image_url as master_image_url,
        bp.price, p.price as master_price, p.pricing_mode, p.min_price, p.max_price,
        bp.branch_category_id, bc.name as branch_category_name,
        bp.is_available, bp.stock
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.params.id, req.params.productId);

    // Attach M:N category memberships
    const prodCats = db.prepare(`
      SELECT bc.id, bc.name, bc.slug
      FROM branch_product_categories bpc
      JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bpc.branch_id = ? AND bpc.product_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.params.productId);

    if (resolved) {
      resolved.categories = prodCats;
      resolved.category_ids = prodCats.map(c => c.id);
      if (prodCats.length > 0) {
        resolved.branch_category_name = prodCats.map(c => c.name).join(', ');
      }
    }

    res.json({
      success: true,
      message: 'Override produk berhasil disimpan.',
      override: resolved
    });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/products/:productId/override]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.8 Create Branch-owned Category
router.post('/admin/branches/:id/categories', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const name = String((req.body && req.body.name) || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Nama kategori cabang wajib diisi.' });
    }
    if (name.length > 40) {
      return res.status(400).json({ success: false, error: 'Nama kategori maksimal 40 karakter.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const bcId = 'bc_' + crypto.randomUUID();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const sortOrder = req.body.sort_order ? Number(req.body.sort_order) : 99;

    db.prepare(`
      INSERT INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(bcId, req.brand_id, req.params.id, name, slug, sortOrder);

    res.status(201).json({
      success: true,
      category: { id: bcId, name, slug, sort_order: sortOrder }
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/categories]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rename a branch category
router.patch('/admin/branches/:id/categories/:catId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi.' });
    if (name.length > 40) {
      return res.status(400).json({ success: false, error: 'Nama kategori maksimal 40 karakter.' });
    }

    const cat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    try {
      db.prepare("UPDATE branch_categories SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?")
        .run(name, slug, req.params.catId);
    } catch (e) {
      if (String(e).includes('no such column')) {
        db.prepare("UPDATE branch_categories SET name = ?, slug = ? WHERE id = ?")
          .run(name, slug, req.params.catId);
      } else {
        throw e;
      }
    }

    res.json({ success: true, category: { id: req.params.catId, name, slug } });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/categories/:catId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload / replace a branch category's image.
// Persisted to disk under /assets/uploads/categories and verified strictly via ImageValidator.
const CATEGORY_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/categories');
const PRODUCT_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/products');
const BRANCH_PRODUCT_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/branch-products');

router.post('/admin/branches/:id/categories/:catId/image', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const cat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    const { image_base64, mime_type } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'Gambar kategori wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'category'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
    }

    fs.mkdirSync(CATEGORY_IMAGE_DIR, { recursive: true });
    const fileName = `${req.params.catId}-${Date.now()}.${validation.info.ext}`;
    fs.writeFileSync(path.join(CATEGORY_IMAGE_DIR, fileName), validation.buffer);

    const imageUrl = `/assets/uploads/categories/${fileName}`;
    try {
      db.prepare("UPDATE branch_categories SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
        .run(imageUrl, req.params.catId);
    } catch (e) {
      if (String(e).includes('no such column')) {
        db.prepare("UPDATE branch_categories SET image_url = ? WHERE id = ?")
          .run(imageUrl, req.params.catId);
      } else {
        throw e;
      }
    }

    res.json({ success: true, category: { id: req.params.catId, image_url: imageUrl } });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/categories/:catId/image]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload / replace a master product (menu item) image.
router.post('/admin/products/:productId/image', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND brand_id = ?')
      .get(req.params.productId, req.brand_id);
    if (!product) return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan.' });

    const { image_base64, mime_type } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'Gambar menu wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'product'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
    }

    fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });
    const fileName = `${req.params.productId}-${Date.now()}.${validation.info.ext}`;
    fs.writeFileSync(path.join(PRODUCT_IMAGE_DIR, fileName), validation.buffer);

    const imageUrl = `/assets/uploads/products/${fileName}`;
    db.prepare("UPDATE products SET image_url = ?, image = ?, updated_at = datetime('now') WHERE id = ?")
      .run(imageUrl, imageUrl, req.params.productId);

    res.json({ success: true, product: { id: req.params.productId, image_url: imageUrl, image: imageUrl } });
  } catch (err) {
    console.error('[API Error POST /admin/products/:productId/image]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload / replace an adopted (branch) product's own photo override.
router.post('/admin/branches/:id/products/:productId/image', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    const bp = db.prepare('SELECT branch_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
    if (!bp) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });

    const { image_base64, mime_type } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'Gambar menu wajib diunggah.' });
    }

    const validation = ImageValidator.validateImageUpload({
      imageBase64: image_base64,
      mimeType: mime_type,
      assetType: 'product'
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error, code: validation.code, dimensions: validation.dimensions });
    }

    fs.mkdirSync(BRANCH_PRODUCT_IMAGE_DIR, { recursive: true });
    const fileName = `${req.params.id}-${req.params.productId}-${Date.now()}.${validation.info.ext}`;
    fs.writeFileSync(path.join(BRANCH_PRODUCT_IMAGE_DIR, fileName), validation.buffer);

    const imageUrl = `/assets/uploads/branch-products/${fileName}`;
    db.prepare("UPDATE branch_products SET image_override = ?, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?")
      .run(imageUrl, req.params.id, req.params.productId);

    res.json({ success: true, product: { branch_id: req.params.id, product_id: req.params.productId, image_url: imageUrl, image_override: imageUrl } });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/products/:productId/image]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a branch category (products in it remain, just lose category assignment)
router.delete('/admin/branches/:id/categories/:catId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const cat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    // Unassign products, delete the category, then re-pack the remaining categories'
    // sort_order into a contiguous 1..N sequence — all inside one atomic transaction
    // so Home never observes a gap (e.g. 1, 4, 7) or a half-applied delete.
    const remaining = db.prepare(
      'SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ? AND id != ? ORDER BY sort_order ASC, name ASC'
    ).all(req.params.id, req.brand_id, req.params.catId);

    const updateSort = db.prepare('UPDATE branch_categories SET sort_order = ? WHERE id = ?');

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('DELETE FROM branch_product_categories WHERE branch_category_id = ? AND branch_id = ?')
        .run(req.params.catId, req.params.id);
      db.prepare(`
        UPDATE branch_products
        SET branch_category_id = (
          SELECT branch_category_id FROM branch_product_categories
          WHERE branch_product_categories.branch_id = branch_products.branch_id
            AND branch_product_categories.product_id = branch_products.product_id
          LIMIT 1
        )
        WHERE branch_category_id = ? AND branch_id = ?
      `).run(req.params.catId, req.params.id);
      db.prepare('DELETE FROM branch_categories WHERE id = ?').run(req.params.catId);
      remaining.forEach((c, idx) => updateSort.run(idx + 1, c.id));
      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API Error DELETE /admin/branches/:id/categories/:catId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reorder branch categories — accepts ordered array of category IDs, updates sort_order atomically
router.put('/admin/branches/:id/categories/reorder', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const { order } = req.body; // array of category IDs in desired display order
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, error: 'Payload "order" harus berupa array ID kategori.' });
    }

    // Reject duplicate IDs in the payload — a duplicate would make ordering ambiguous
    // and would silently clobber another category's sort_order.
    const uniqueIds = new Set(order.map(String));
    if (uniqueIds.size !== order.length) {
      return res.status(400).json({ success: false, error: 'Payload "order" mengandung ID kategori duplikat.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    // AUTHORITATIVE VALIDATION: every ID in the payload must actually belong to THIS
    // branch (and brand). Reject the whole request up front — never let one branch's
    // reorder touch another branch's categories, and never trust client-sent order
    // for IDs we haven't verified ownership of.
    const owned = db.prepare('SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ?')
      .all(req.params.id, req.brand_id);
    const ownedIds = new Set(owned.map((c) => String(c.id)));
    const invalidIds = order.filter((catId) => !ownedIds.has(String(catId)));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'FORBIDDEN_BRANCH_SCOPE',
        message: 'Sebagian ID kategori tidak valid atau bukan milik cabang ini.'
      });
    }

    // Categories that exist for this branch but were NOT included in the payload keep
    // their relative order and are placed deterministically after the reordered set,
    // so no category is ever left with an undefined/garbage sort_order.
    const orderedIdStrings = order.map(String);
    const untouched = owned
      .map((c) => String(c.id))
      .filter((id) => !uniqueIds.has(id));
    const finalOrder = [...orderedIdStrings, ...untouched];

    // Update every category's sort_order inside a single atomic transaction — if
    // anything throws mid-way, the whole transaction rolls back and the previous
    // ordering stays fully intact.
    const updateSort = db.prepare('UPDATE branch_categories SET sort_order = ? WHERE id = ? AND branch_id = ? AND brand_id = ?');

    db.exec('BEGIN IMMEDIATE;');
    try {
      finalOrder.forEach((catId, idx) => {
        updateSort.run(idx + 1, catId, req.params.id, req.brand_id);
      });
      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API Error PUT /admin/branches/:id/categories/reorder]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// M:N BRANCH PRODUCT ↔ CATEGORY MEMBERSHIP (PHASE 3)
// Reconciled endpoints allowing multiple category assignments per product
// =========================================================================

// Retrieve all categories assigned to a branch product
router.get('/admin/branches/:id/products/:productId/categories', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.' });
      }
    }
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });

    const bp = db.prepare('SELECT product_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
    if (!bp) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });

    const categories = db.prepare(`
      SELECT bc.id, bc.brand_id, bc.branch_id, bc.name, bc.slug, bc.image_url, bc.sort_order
      FROM branch_product_categories bpc
      JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bpc.branch_id = ? AND bpc.product_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.params.productId);

    res.json({
      success: true,
      branch_id: req.params.id,
      product_id: req.params.productId,
      categories: categories || []
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/products/:productId/categories]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Assign product to a branch category (supports single category_id or category_ids array)
router.post('/admin/branches/:id/products/:productId/categories', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.' });
      }
    }
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });

    const bp = db.prepare('SELECT product_id, branch_category_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
    if (!bp) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });

    const rawCatId = (req.body && (req.body.branch_category_id || req.body.category_id)) || '';
    const catId = String(rawCatId).trim();
    if (!catId) {
      return res.status(400).json({ success: false, error: 'category_id wajib diisi.' });
    }

    const cat = db.prepare('SELECT id, name FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(catId, req.params.id, req.brand_id);
    if (!cat) {
      return res.status(400).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Kategori cabang tidak valid atau bukan milik cabang ini.' });
    }

    const prevCats = db.prepare('SELECT branch_category_id FROM branch_product_categories WHERE branch_id = ? AND product_id = ?')
      .all(req.params.id, req.params.productId).map(r => r.branch_category_id);

    db.prepare(`
      INSERT OR IGNORE INTO branch_product_categories (branch_id, product_id, branch_category_id)
      VALUES (?, ?, ?)
    `).run(req.params.id, req.params.productId, catId);

    // Sync legacy primary column if not already populated
    if (!bp.branch_category_id) {
      db.prepare('UPDATE branch_products SET branch_category_id = ?, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?')
        .run(catId, req.params.id, req.params.productId);
    }

    const newCats = db.prepare(`
      SELECT bc.id, bc.name, bc.slug
      FROM branch_product_categories bpc
      JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bpc.branch_id = ? AND bpc.product_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.params.productId);

    // Audit trail
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product_category.assign', 'branch_category_id', ?, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify(prevCats),
      JSON.stringify(newCats.map(c => c.id)),
      actorId,
      actorRole
    );

    res.status(201).json({
      success: true,
      message: 'Kategori cabang berhasil ditambahkan ke produk.',
      branch_id: req.params.id,
      product_id: req.params.productId,
      assigned_category_id: catId,
      category_ids: newCats.map(c => c.id),
      categories: newCats
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/products/:productId/categories]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Remove product from a branch category
router.delete('/admin/branches/:id/products/:productId/categories/:catId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.' });
      }
    }
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });

    const prevCats = db.prepare('SELECT branch_category_id FROM branch_product_categories WHERE branch_id = ? AND product_id = ?')
      .all(req.params.id, req.params.productId).map(r => r.branch_category_id);

    const delStmt = db.prepare('DELETE FROM branch_product_categories WHERE branch_id = ? AND product_id = ? AND branch_category_id = ?')
      .run(req.params.id, req.params.productId, req.params.catId);

    if (!delStmt || delStmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Keanggotaan kategori produk tidak ditemukan.' });
    }

    const remainingCats = db.prepare(`
      SELECT bc.id, bc.name, bc.slug
      FROM branch_product_categories bpc
      JOIN branch_categories bc ON bc.id = bpc.branch_category_id
      WHERE bpc.branch_id = ? AND bpc.product_id = ?
      ORDER BY bc.sort_order ASC, bc.name ASC
    `).all(req.params.id, req.params.productId);

    // Sync legacy primary column
    const nextPrimaryCat = remainingCats.length > 0 ? remainingCats[0].id : null;
    db.prepare('UPDATE branch_products SET branch_category_id = ?, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?')
      .run(nextPrimaryCat, req.params.id, req.params.productId);

    // Audit trail
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product_category.remove', 'branch_category_id', ?, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify(prevCats),
      JSON.stringify(remainingCats.map(c => c.id)),
      actorId,
      actorRole
    );

    res.json({
      success: true,
      message: 'Keanggotaan kategori berhasil dihapus dari produk.',
      branch_id: req.params.id,
      product_id: req.params.productId,
      removed_category_id: req.params.catId,
      category_ids: remainingCats.map(c => c.id),
      categories: remainingCats
    });
  } catch (err) {
    console.error('[API Error DELETE /admin/branches/:id/products/:productId/categories/:catId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Retrieve all products belonging to a branch category
router.get('/admin/branches/:id/categories/:catId/products', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.' });
      }
    }
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });

    const cat = db.prepare('SELECT id, name, slug, image_url, sort_order FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    const products = db.prepare(`
      SELECT
        bp.product_id,
        COALESCE(bp.name_override, p.name) as name,
        COALESCE(bp.description_override, p.description) as description,
        COALESCE(bp.image_override, p.image_url) as image_url,
        bp.price,
        p.price as master_price,
        p.pricing_mode,
        bp.stock,
        bp.is_available
      FROM branch_product_categories bpc
      JOIN branch_products bp ON bp.branch_id = bpc.branch_id AND bp.product_id = bpc.product_id
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bpc.branch_id = ? AND bpc.branch_category_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.brand_id, req.params.id, req.params.catId);

    res.json({
      success: true,
      branch_id: req.params.id,
      category: cat,
      products: products || []
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/categories/:catId/products]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


/* =========================================================================
   C2 — BRANCH INVENTORY BOUNDARY
   Physical stock is owned and mutated at the Branch boundary. Mutations go
   through InventoryStockService (atomic guarded UPDATE + immutable
   inventory_movements ledger). Only operational adjustments are exposed
   here: audit_adjustment (+/-) and waste_spoilage (-). Stock intake via
   purchase_in belongs to the Purchase Order flow and sale_deduction belongs
   to order settlement — neither is exposed as a manual operation.
   ========================================================================= */

// C2 Branch inventory list (read-only; branch-scoped for Branch Manager)
router.get('/admin/branches/:id/inventory', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const rows = db.prepare(`
      SELECT bp.product_id, p.name AS product_name, bp.price, bp.stock, bp.is_available, bp.low_stock_threshold
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.brand_id, req.params.id);

    res.json({ success: true, branch_id: req.params.id, inventory: rows || [] });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/inventory]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C2 Branch inventory mutation (operational adjustment)
// body: { movement_type: 'audit_adjustment'|'waste_spoilage', quantity: <signed int>, mutation_id?, notes? }
router.patch('/admin/branches/:id/inventory/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    // Branch Manager may only mutate their OWN branch.
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    // Branch ownership (tenant-scoped)
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const movement_type = req.body && req.body.movement_type;
    const rawQuantity = req.body && req.body.quantity;
    const mutation_id = (req.body && req.body.mutation_id) ? String(req.body.mutation_id).trim() : null;
    const notes = (req.body && req.body.notes) ? String(req.body.notes) : '';

    // Only operational adjustments are exposed; purchase_in / sale_deduction stay owned by
    // their respective flows (PO receipt / order settlement).
    const MANUAL_MOVEMENT_TYPES = ['audit_adjustment', 'waste_spoilage'];
    if (!MANUAL_MOVEMENT_TYPES.includes(movement_type)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_MOVEMENT_TYPE',
        message: 'Jenis mutasi manual hanya mendukung audit_adjustment atau waste_spoilage. Penerimaan PO dan pemotongan pesanan dikelola oleh alurnya masing-masing.'
      });
    }

    // C2.9 Quantity validation (finite integer; never silently coerced)
    const quantity = Number(rawQuantity);
    if (rawQuantity === null || rawQuantity === undefined || rawQuantity === '' ||
        !Number.isFinite(Number(rawQuantity)) || !Number.isInteger(quantity) || quantity === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'Quantity harus berupa bilangan bulat bukan-nol (mis. +5 atau -3).'
      });
    }
    if (movement_type === 'waste_spoilage' && quantity > 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'waste_spoilage hanya menerima pengurangan stok (quantity negatif).'
      });
    }

    // Assignment + brand consistency must already hold (C1 trigger enforces it at the DB too).
    const assignment = db.prepare(`
      SELECT bp.branch_id
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.brand_id, req.params.id, req.params.productId);
    if (!assignment) {
      return res.status(404).json({ success: false, error: 'Produk tidak dialokasikan ke cabang ini.' });
    }

    try {
      const movement = InventoryStockService.recordMovement({
        branch_id: req.params.id,
        product_id: req.params.productId,
        movement_type,
        quantity,
        mutation_id,
        reference_id: null,
        actor_id: req.user.userId || req.user.id || req.user.username || 'system',
        actor_role: req.user.role || 'system',
        notes
      });

      const current = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
      res.json({
        success: true,
        movement,
        stock: current ? current.stock : 0
      });
    } catch (stockErr) {
      const msg = String(stockErr && stockErr.message || '');
      if (msg.includes('Stok tidak boleh negatif')) {
        return res.status(409).json({ success: false, error: 'INSUFFICIENT_STOCK', message: stockErr.message });
      }
      if (msg.includes('tidak terdaftar di cabang')) {
        return res.status(404).json({ success: false, error: 'Produk tidak dialokasikan ke cabang ini.' });
      }
      console.error('[API Error PATCH /admin/branches/:id/inventory/:productId]:', stockErr);
      res.status(500).json({ success: false, error: stockErr.message });
    }
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/inventory/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15. Admin Orders List & Analytics Summary
router.get('/admin/orders', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const {
      branch_id,
      status,
      order_channel,
      fulfillment_type,
      start_date,
      end_date,
      search,
      limit,
      offset
    } = req.query;

    let query = `
      SELECT o.*, b.name as branch_name 
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.brand_id = ?
    `;
    const params = [req.brand_id];

    // Branch manager is strictly scoped to their assigned branch
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId) {
        query += ' AND o.branch_id = ?';
        params.push(assignedBranchId);
      }
    } else if (branch_id && branch_id !== 'all') {
      query += ' AND o.branch_id = ?';
      params.push(branch_id);
    }

    if (status && status !== 'all') {
      query += ' AND o.status = ?';
      params.push(status);
    }

    if (order_channel && order_channel !== 'all') {
      query += ' AND o.order_channel = ?';
      params.push(order_channel);
    }

    if (fulfillment_type && fulfillment_type !== 'all') {
      query += ' AND o.fulfillment_type = ?';
      params.push(fulfillment_type);
    }

    if (start_date) {
      query += ' AND o.created_at >= ?';
      params.push(start_date.includes(' ') || start_date.includes('T') ? start_date : start_date + ' 00:00:00');
    }

    if (end_date) {
      query += ' AND o.created_at <= ?';
      params.push(end_date.includes(' ') || end_date.includes('T') ? end_date : end_date + ' 23:59:59');
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      query += ' AND (o.order_number LIKE ? OR o.id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)';
      params.push(q, q, q, q);
    }

    query += ' ORDER BY o.created_at DESC';

    const maxLimit = limit ? Math.min(parseInt(limit, 10), 200) : 100;
    query += ` LIMIT ${maxLimit}`;

    if (offset) {
      query += ` OFFSET ${parseInt(offset, 10)}`;
    }

    const orders = db.prepare(query).all(...params);

    const enriched = orders.map(ord => ({
      ...ord,
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
      delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id),
      payment: db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(ord.id)
    }));

    res.json({ success: true, orders: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15.1 Admin Single Order Detail
router.get('/admin/orders/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const order = db.prepare(`
      SELECT o.*, b.name as branch_name
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND o.brand_id = ?
    `).get(req.params.id, req.brand_id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'ORDER_NOT_FOUND',
        message: 'Pesanan tidak ditemukan pada brand ini.'
      });
    }

    // Branch manager scope guard
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== order.branch_id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya dapat mengakses pesanan cabang yang ditugaskan.'
        });
      }
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const delivery = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);
    const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order.id);
    const logs = db.prepare('SELECT previous_status, new_status, note, created_at FROM order_status_logs WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

    // If dine-in order with dining_session_id, retrieve all session additions
    let sessionOrders = [];
    if (order.dining_session_id) {
      sessionOrders = db.prepare(`
        SELECT id, order_number, order_channel, fulfillment_type, status, grand_total, payment_status, created_at
        FROM orders
        WHERE dining_session_id = ? AND brand_id = ? AND id != ?
        ORDER BY created_at ASC
      `).all(order.dining_session_id, req.brand_id, order.id);
    }

    res.json({
      success: true,
      order: {
        ...order,
        acceptance_deadline_at: order.acceptance_deadline_at || AcceptanceTimeoutService.computeAcceptanceDeadlineAt(order),
        items: items || [],
        delivery: delivery || null,
        payment: payment || null,
        status_logs: logs || [],
        session_orders: sessionOrders
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/admin/analytics/summary', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE brand_id = ?').get(req.brand_id);
    const totalOmzet = db.prepare('SELECT SUM(grand_total) as sum FROM orders WHERE brand_id = ?').get(req.brand_id);
    const activeProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE brand_id = ? AND is_active = 1').get(req.brand_id);

    res.json({
      success: true,
      summary: {
        total_orders: totalOrders ? totalOrders.count : 0,
        total_omzet: totalOmzet && totalOmzet.sum ? totalOmzet.sum : 0,
        active_products: activeProducts ? activeProducts.count : 5
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Phase 4: Owner Overview API — Real authoritative business metrics
const { ReportingRepository } = require('../../core/data/repositories');
const overviewReportingRepo = new ReportingRepository();

router.get('/admin/overview', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;

    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const filter = {
      brand_id: req.brand_id,
      branch_id: effectiveBranchId,
      start_date,
      end_date
    };

    // 1. Primary KPIs
    const salesOverview = overviewReportingRepo.getSalesOverview(filter);
    const customerOverview = overviewReportingRepo.getCustomerOverview(filter);

    const netSales = salesOverview.gross_revenue || 0;
    const ordersCount = salesOverview.total_orders || 0;
    const customersCount = customerOverview.total_unique_customers || 0;
    const aov = salesOverview.average_order_value || 0;

    // 2. Sales Performance
    const timeline = overviewReportingRepo.getSalesTimeline(filter);
    const byChannel = overviewReportingRepo.getSalesByChannel(filter);
    const byFulfillment = overviewReportingRepo.getSalesByFulfillment(filter);

    // 3. Branch Performance (Only for Owner/Brand Manager if All Branches, or scoped to branch)
    let branchPerformance = [];
    if (req.user.role !== 'branch_manager') {
      branchPerformance = overviewReportingRepo.getBranchComparison({
        brand_id: req.brand_id,
        start_date,
        end_date
      });
    }

    // 4. Top Products
    const topProducts = overviewReportingRepo.getTopProducts(filter).slice(0, 5);

    // 5. Needs Attention (e.g. low stock alerts)
    const lowStockItems = overviewReportingRepo.getLowStockItems(filter).slice(0, 10);

    res.json({
      success: true,
      data: {
        kpis: {
          net_sales: netSales,
          orders: ordersCount,
          customers: customersCount,
          aov: Math.round(aov)
        },
        sales_performance: {
          timeline,
          by_channel: byChannel,
          by_fulfillment: byFulfillment
        },
        branch_performance: branchPerformance,
        top_products: topProducts,
        needs_attention: {
          low_stock_items: lowStockItems,
          low_stock_count: lowStockItems.length
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 16. Reporting Domain Single-Entrypoint API (Protected with Granular Per-Report RBAC Matrix)
const { ReportingEngine } = require('../../domains/reporting');
router.get('/reports/:report_type', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { report_type } = req.params;
    const { branch_id, start_date, end_date } = req.query;

    // P1 GRANULAR REPORT AUTHORIZATION MATRIX
    // Multi-branch comparison / leaderboard is strictly reserved for Owner & Brand Executive scope
    const REPORT_ALLOWED_ROLES = {
      sales: ['owner', 'brand_manager', 'branch_manager'],
      orders: ['owner', 'brand_manager', 'branch_manager'],
      customers: ['owner', 'brand_manager'],
      operations: ['owner', 'brand_manager', 'branch_manager'],
      payment: ['owner', 'brand_manager', 'branch_manager'],
      inventory: ['owner', 'brand_manager', 'branch_manager'],
      pos_shifts: ['owner', 'brand_manager', 'branch_manager'],
      products: ['owner', 'brand_manager', 'branch_manager'],
      branches: ['owner', 'brand_manager'],
      branch_comparison: ['owner', 'brand_manager']
    };

    const allowedRoles = REPORT_ALLOWED_ROLES[report_type];
    if (allowedRoles && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_REPORT_AUTHORITY',
        message: `Role "${req.user.role}" tidak memiliki wewenang untuk mengakses laporan multi-cabang "${report_type}". Laporan ini khusus untuk wewenang Owner / Brand Manager.`
      });
    }

    const report = ReportingEngine.generateReport(report_type, {
      brand_id: req.brand_id,
      branch_id: branch_id || req.query.branchId,
      start_date,
      end_date,
      actor: req.user
    });

    res.json({
      success: true,
      data: report
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Phase 5: Owner Dashboard Customers APIs (Authoritative Core Data)
router.get('/admin/customers', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, search, segment } = req.query;

    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const customers = overviewReportingRepo.getCustomersList({
      brand_id: req.brand_id,
      branch_id: effectiveBranchId,
      search: search ? String(search).trim() : null
    });

    let filtered = customers;
    if (segment === 'new') {
      filtered = customers.filter(c => c.segment === 'new');
    } else if (segment === 'returning') {
      filtered = customers.filter(c => c.segment === 'returning');
    }

    res.json({
      success: true,
      customers: filtered,
      total: filtered.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/admin/customers/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { id } = req.params;
    let branchId = req.query.branch_id;
    if (req.user.role === 'branch_manager') {
      branchId = req.user.branch_id || req.user.branchId;
    }

    const customer = overviewReportingRepo.getCustomerDetail(req.brand_id, id, branchId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'CUSTOMER_NOT_FOUND',
        message: 'Data pelanggan tidak ditemukan untuk identifier yang diberikan.'
      });
    }

    res.json({
      success: true,
      customer
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// PHASE 6: CLIENT OWNER DASHBOARD — FINANCE & MARKETING APIS
// Authoritative Core reuse with strict multi-tenant & RBAC scoping
// =========================================================================
const { PaymentRepository: CorePaymentRepo, PromotionRepository: CorePromotionRepo } = require('../../core/data/repositories');
const corePaymentRepo = new CorePaymentRepo();
const corePromotionRepo = new CorePromotionRepo();

function logPromotionSecurityEvent({ actor_id, actor_role, action, brand_id, organization_id = null, branch_id = null, result, metadata }) {
  try {
    const id = 'sal_' + crypto.randomBytes(16).toString('hex');
    const safeMetadata = metadata ? JSON.stringify(metadata) : null;
    db.prepare(`
      INSERT INTO security_audit_log (id, actor_id, actor_role, action, target_user_id, target_role, brand_id, organization_id, branch_id, result, metadata, created_at)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, actor_id || null, actor_role || null, action, brand_id || null, organization_id || null, branch_id || null, result, safeMetadata);
  } catch (e) {
    console.warn('[Promotion Audit Log Error]:', e.message);
  }
}

// 1. Finance Overview API
router.get('/admin/finance/overview', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const filter = {
      brand_id: req.brand_id,
      branch_id: effectiveBranchId,
      start_date,
      end_date
    };

    // Authoritative payment breakdown & summary from PaymentReportService
    const paymentReport = ReportingEngine.generateReport('payment', filter);
    const salesOverview = overviewReportingRepo.getSalesOverview(filter);

    // Unreconciled count
    const pendingRecon = corePaymentRepo.findReconciliationRecords({
      brandId: req.brand_id,
      branchId: effectiveBranchId
    });

    const totalGrossSales = salesOverview ? (salesOverview.gross_revenue || 0) : 0;
    const totalNetSales = salesOverview ? (salesOverview.subtotal_revenue || 0) : 0;
    const totalSettled = paymentReport.summary?.total_settled || 0;
    const cashSettled = paymentReport.summary?.cash_settled || 0;
    const midtransSettled = paymentReport.summary?.midtrans_settled || 0;
    const totalPending = paymentReport.summary?.total_pending || 0;

    let totalTxCount = 0;
    if (Array.isArray(paymentReport.breakdown)) {
      for (const row of paymentReport.breakdown) {
        totalTxCount += Number(row.transaction_count || 0);
      }
    }

    res.json({
      success: true,
      data: {
        summary: {
          gross_sales: totalGrossSales,
          net_sales: totalNetSales,
          total_settled: totalSettled,
          cash_settled: cashSettled,
          midtrans_settled: midtransSettled,
          total_pending: totalPending,
          transaction_count: totalTxCount,
          unreconciled_count: pendingRecon.length,
          unreconciled_amount: pendingRecon.reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
          refunds: { total_amount: 0, count: 0, supported: false, status: 'not_configured' },
          payouts: { total_amount: 0, count: 0, supported: false, status: 'not_configured' }
        },
        breakdown: paymentReport.breakdown || [],
        unreconciled_records: pendingRecon
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Finance Transactions List API
router.get('/admin/finance/transactions', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, payment_method, payment_status, start_date, end_date, limit, offset } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const result = corePaymentRepo.findTransactions({
      brandId: req.brand_id,
      branchId: effectiveBranchId,
      paymentMethod: payment_method || null,
      paymentStatus: payment_status || null,
      startDate: start_date || null,
      endDate: end_date || null,
      limit,
      offset
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Finance Reconciliation API
router.get('/admin/finance/reconciliation', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const records = corePaymentRepo.findReconciliationRecords({
      brandId: req.brand_id,
      branchId: effectiveBranchId
    });

    res.json({
      success: true,
      reconciliation: {
        pending_count: records.length,
        total_pending_amount: records.reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
        records
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Finance Payment Methods Config API
router.get('/admin/finance/payment-methods', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const brandConfig = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
    let parsedBrandConfig = null;
    if (brandConfig && brandConfig.default_payment_config) {
      try { parsedBrandConfig = JSON.parse(brandConfig.default_payment_config); } catch (_) {}
    }

    let branchOverride = null;
    if (effectiveBranchId) {
      const branchRow = corePaymentRepo.findBranchPaymentConfig(effectiveBranchId, req.brand_id);
      if (branchRow && branchRow.payment_config_override) {
        try { branchOverride = JSON.parse(branchRow.payment_config_override); } catch (_) {}
      }
    }

    const midtransActive = Boolean(
      (branchOverride && branchOverride.server_key) ||
      (parsedBrandConfig && parsedBrandConfig.server_key) ||
      process.env.MIDTRANS_SERVER_KEY
    );

    const isProduction = Boolean(
      (branchOverride && branchOverride.is_production) ||
      (parsedBrandConfig && parsedBrandConfig.is_production) ||
      process.env.MIDTRANS_IS_PRODUCTION === 'true'
    );

    res.json({
      success: true,
      payment_methods: [
        {
          code: 'cash',
          name: 'Tunai (Cash)',
          provider: 'cash',
          is_enabled: true,
          type: 'offline',
          settlement_mode: 'manual_cashier',
          description: 'Pembayaran tunai langsung di kasir cabang dengan validasi shift POS'
        },
        {
          code: 'midtrans',
          name: 'Midtrans Online Payment',
          provider: 'midtrans',
          is_enabled: midtransActive,
          type: 'online_gateway',
          environment: isProduction ? 'production' : 'sandbox',
          has_branch_override: Boolean(branchOverride),
          description: 'Payment gateway multi-channel (QRIS, GoPay, ShopeePay, Virtual Account, Kartu Kredit)'
        }
      ]
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Marketing Overview API
router.get('/admin/marketing/overview', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const filter = {
      brand_id: req.brand_id,
      branch_id: effectiveBranchId,
      start_date,
      end_date
    };

    const customerOverview = overviewReportingRepo.getCustomerOverview(filter);
    const customersList = overviewReportingRepo.getCustomersList(filter);

    let newCount = 0;
    let returningCount = 0;
    let repeatPurchaseRate = 0;
    if (Array.isArray(customersList) && customersList.length > 0) {
      newCount = customersList.filter(c => c.segment === 'new').length;
      returningCount = customersList.filter(c => c.segment === 'returning').length;
      repeatPurchaseRate = Math.round((returningCount / customersList.length) * 100);
    }

    const allPromos = corePromotionRepo.findAllPromotions(req.brand_id);
    const redemptions = corePromotionRepo.findPromotionRedemptions({
      brandId: req.brand_id,
      branchId: effectiveBranchId,
      limit: 10
    });

    const activePromosCount = allPromos.filter(p => p.is_active === 1).length;
    const totalBenefitSum = allPromos.reduce((acc, p) => acc + (p.total_benefit_amount || 0), 0);
    const totalRedemptionsSum = allPromos.reduce((acc, p) => acc + (p.redemptions_count || 0), 0);

    res.json({
      success: true,
      data: {
        customer_metrics: {
          total_customers: customerOverview.total_unique_customers || 0,
          new_customers: newCount,
          returning_customers: returningCount,
          repeat_purchase_rate_pct: repeatPurchaseRate
        },
        promotion_metrics: {
          active_promotions: activePromosCount,
          total_promotions: allPromos.length,
          total_redemptions: totalRedemptionsSum,
          total_benefit_amount: totalBenefitSum
        },
        recent_redemptions: redemptions.redemptions || [],
        campaigns: { supported: false, status: 'not_configured' },
        loyalty: { supported: false, status: 'not_configured' }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Marketing Promotions List API
router.get('/admin/marketing/promotions', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const isBM = req.user.role === 'branch_manager';
    const effectiveBranchId = isBM ? (req.user.branch_id || req.user.branchId) : null;
    const promotions = corePromotionRepo.findAllPromotions(req.brand_id, effectiveBranchId);
    const enrichedPromotions = promotions.map(p => {
      const rewards = (p.rewards || []).map(r => {
        let pres = {};
        if (r.presentation_payload) {
          try {
            pres = typeof r.presentation_payload === 'string'
              ? JSON.parse(r.presentation_payload)
              : r.presentation_payload;
          } catch (_) {}
        }
        let delivery = null;
        if (pres.media_id) {
          delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
        }
        return {
          ...r,
          presentation: pres,
          presentation_delivery: delivery
        };
      });
      return {
        ...p,
        rewards
      };
    });
    res.json({
      success: true,
      promotions: enrichedPromotions,
      total: enrichedPromotions.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// 6.00 STOREFRONT BANNERS — Content + Placement/Assignment APIs
// Content is Brand-scoped. Assignment is Branch-scoped. Promotion remains separate.
// ============================================================================
function bannerActor(req) {
  return {
    id: req.user && (req.user.userId || req.user.id),
    userId: req.user && (req.user.userId || req.user.id),
    role: req.user && req.user.role,
    branch_id: req.user && (req.user.branch_id || req.user.branchId),
    branchId: req.user && (req.user.branch_id || req.user.branchId),
    organization_id: req.brand && req.brand.organization_id
  };
}

function bannerMediaDelivery(brandId, mediaId) {
  if (!mediaId) {
    return { media_id: null, preview_url: null, srcset_variants: [] };
  }

  try {
    const asset = mediaService.getMedia({ mediaId, brandId });
    const variants = Array.isArray(asset.variants) ? asset.variants : [];
    const preview = variants.find(v => Number(v.width) >= 640) || variants[variants.length - 1] || null;
    return {
      media_id: mediaId,
      preview_url: preview ? preview.url : asset.url,
      srcset_variants: variants.map(v => ({
        url: v.url,
        width: v.width,
        height: v.height,
        name: v.name
      }))
    };
  } catch (_) {
    return { media_id: mediaId, preview_url: null, srcset_variants: [] };
  }
}

function parseLegacyBrandBanners(brand) {
  if (!brand || brand.banners === null || brand.banners === undefined || brand.banners === '') return [];
  try {
    const parsed = typeof brand.banners === 'string' ? JSON.parse(brand.banners) : brand.banners;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function bannerRowToAdminDto(row) {
  const published = row.published_revision_id ? {
    id: row.published_revision_id,
    revision_number: row.published_revision_number,
    title: row.published_title || '',
    alt_text: row.published_alt_text || '',
    media_id: row.published_media_id,
    cta_type: row.published_cta_type || 'NONE',
    cta_target_id: row.published_cta_target_id || null,
    cta_url: row.published_cta_url || null,
    promotion_id: row.published_promotion_id || null
  } : null;

  const draft = row.draft_revision_id ? {
    id: row.draft_revision_id,
    revision_number: row.draft_revision_number,
    title: row.draft_title || '',
    alt_text: row.draft_alt_text || '',
    media_id: row.draft_media_id,
    cta_type: row.draft_cta_type || 'NONE',
    cta_target_id: row.draft_cta_target_id || null,
    cta_url: row.draft_cta_url || null,
    promotion_id: row.draft_promotion_id || null
  } : null;

  const liveContent = published || draft;
  const media = bannerMediaDelivery(row.brand_id, liveContent ? liveContent.media_id : null);

  return {
    id: row.banner_id,
    banner_id: row.banner_id,
    title: liveContent ? liveContent.title : '',
    alt_text: liveContent ? liveContent.alt_text : '',
    publication_status: row.banner_publication_status || 'DRAFT',
    has_draft_changes: Boolean(draft && published),
    published_revision: published,
    draft_revision: draft,
    media,
    assignment: {
      id: row.id,
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      branch_timezone: row.branch_timezone || 'Asia/Jakarta',
      placement: row.placement,
      position: Number(row.position),
      active: Number(row.active) === 1,
      starts_at: row.starts_at || null,
      ends_at: row.ends_at || null,
      timezone: row.branch_timezone || row.timezone || 'Asia/Jakarta',
      governance_locked: Number(row.governance_locked) === 1,
      effective_status: require('../../domains/banner/services/BannerDateTime').effectiveStatus({
        published: row.banner_publication_status === 'PUBLISHED' && Boolean(row.published_revision_id),
        active: Number(row.active) === 1,
        startsAt: row.starts_at,
        endsAt: row.ends_at
      })
    }
  };
}

router.get('/admin/marketing/banners', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const requestedBranchId = req.query.branch_id || null;
    const rows = bannerAssignmentService.listAssignments({
      brandId: req.brand_id,
      branchId: requestedBranchId,
      actor
    });

    const contentItems = bannerContentService.listBanners({ brandId: req.brand_id });
    const result = rows.map(bannerRowToAdminDto);
    const assignedBannerIds = new Set(result.map(item => item.banner_id));

    const includeUnassignedContent = actor.role !== 'branch_manager' && !requestedBranchId;

    for (const content of contentItems) {
      if (assignedBannerIds.has(content.id)) continue;
      if (!includeUnassignedContent) continue;
      const published = content.published_revision;
      const draft = content.draft_revision;
      const live = published || draft;
      const media = bannerMediaDelivery(req.brand_id, live ? live.media_id : null);
      result.push({
        id: content.id,
        banner_id: content.id,
        title: live ? live.title : '',
        alt_text: live ? live.alt_text : '',
        publication_status: content.publication_status,
        has_draft_changes: Boolean(draft && published),
        published_revision: published ? {
          id: published.id,
          revision_number: published.revision_number,
          title: published.title || '',
          alt_text: published.alt_text || '',
          media_id: published.media_id,
          cta_type: published.cta_type || 'NONE',
          cta_target_id: published.cta_target_id || null,
          cta_url: published.cta_url || null,
          promotion_id: published.promotion_id || null
        } : null,
        draft_revision: draft ? {
          id: draft.id,
          revision_number: draft.revision_number,
          title: draft.title || '',
          alt_text: draft.alt_text || '',
          media_id: draft.media_id,
          cta_type: draft.cta_type || 'NONE',
          cta_target_id: draft.cta_target_id || null,
          cta_url: draft.cta_url || null,
          promotion_id: draft.promotion_id || null
        } : null,
        media,
        assignment: null
      });
    }

    result.sort((a, b) => {
      const an = (a.assignment && a.assignment.branch_name) || '';
      const bn = (b.assignment && b.assignment.branch_name) || '';
      return an.localeCompare(bn) || Number(a.assignment?.position || 9999) - Number(b.assignment?.position || 9999);
    });

    var branches = bannerAssignmentService.repository.listBranches(req.brand_id);
    if (actor.role === 'branch_manager') {
      const ownBranchId = actor.branch_id || actor.branchId;
      branches = ownBranchId
        ? branches.filter(function (branch) { return String(branch.id) === String(ownBranchId); })
        : [];
    }

    const legacy = parseLegacyBrandBanners(req.brand);
    res.json({
      success: true,
      placement: 'HOME_BANNER_CAROUSEL',
      banners: result,
      branches,
      legacy: {
        available: legacy.length > 0,
        count: legacy.length,
        fallback_active: true
      }
    });
  } catch (err) {
    const status = ['FORBIDDEN_BRANCH_SCOPE', 'BRANCH_NOT_FOUND', 'ASSIGNMENT_GOVERNANCE_LOCKED'].includes(err.code) ? 403 : 500;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_LIST_ERROR' });
  }
});

router.get('/admin/marketing/banners/:bannerId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const content = bannerContentService.getBanner({
      brandId: req.brand_id,
      bannerId: req.params.bannerId
    });
    const assignments = bannerAssignmentService.listAssignments({
      brandId: req.brand_id,
      branchId: actor.role === 'branch_manager' ? actor.branch_id : null,
      actor
    }).filter(row => row.banner_id === req.params.bannerId);

    if (actor.role === 'branch_manager' && assignments.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_BRANCH_SCOPE',
        message: 'Banner tidak ditugaskan pada cabang Branch Manager.'
      });
    }

    res.json({
      success: true,
      banner: {
        id: content.id,
        brand_id: content.brand_id,
        publication_status: content.publication_status,
        published_revision: content.published_revision,
        draft_revision: content.draft_revision,
        revisions: content.revisions || [],
        assignments: assignments.map(bannerRowToAdminDto).map(item => item.assignment),
        media: bannerMediaDelivery(
          req.brand_id,
          content.draft_revision?.media_id || content.published_revision?.media_id || null
        )
      }
    });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' || err.code === 'ASSIGNMENT_NOT_FOUND' ? 404 : (err.code ? 403 : 500);
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_DETAIL_ERROR' });
  }
});

router.post('/admin/marketing/banners', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const {
      media_id,
      title = '',
      alt_text = '',
      cta_type = 'NONE',
      cta_target_id = null,
      cta_url = null,
      promotion_id = null
    } = req.body || {};

    const banner = await bannerContentService.createDraft({
      brandId: req.brand_id,
      actorId: actor.id,
      actorRole: actor.role,
      mediaId: media_id,
      title,
      altText: alt_text,
      ctaType: cta_type,
      ctaTargetId: cta_target_id,
      ctaUrl: cta_url,
      promotionId: promotion_id
    });

    res.status(201).json({ success: true, banner });
  } catch (err) {
    const status = ['BANNER_NOT_FOUND', 'INVALID_PRODUCT_REFERENCE', 'INVALID_CATEGORY_REFERENCE', 'INVALID_PROMOTION_REFERENCE'].includes(err.code)
      ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_CREATE_ERROR' });
  }
});

router.patch('/admin/marketing/banners/:bannerId/draft', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const {
      media_id,
      title = '',
      alt_text = '',
      cta_type = 'NONE',
      cta_target_id = null,
      cta_url = null,
      promotion_id = null
    } = req.body || {};

    const banner = await bannerContentService.updateDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role,
      mediaId: media_id,
      title,
      altText: alt_text,
      ctaType: cta_type,
      ctaTargetId: cta_target_id,
      ctaUrl: cta_url,
      promotionId: promotion_id
    });

    res.json({ success: true, banner });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_DRAFT_UPDATE_ERROR' });
  }
});

router.post('/admin/marketing/banners/:bannerId/publish', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const banner = await bannerContentService.publishDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role
    });
    res.json({ success: true, banner });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' || err.code === 'DRAFT_NOT_FOUND' ? 404
      : err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_PUBLISH_ERROR', conflict: err.conflict || null });
  }
});

router.post('/admin/marketing/banners/:bannerId/discard-draft', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const banner = await bannerContentService.discardDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role
    });
    res.json({ success: true, banner });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' || err.code === 'DRAFT_NOT_FOUND' ? 404
      : err.code === 'DISCARD_REQUIRES_PUBLISHED' ? 409
      : 400;
    res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || 'BANNER_DISCARD_DRAFT_ERROR'
    });
  }
});

router.delete('/admin/marketing/banners/:bannerId', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const result = await bannerContentService.deleteDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role
    });
    res.json(result);
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' ? 404
      : ['BANNER_ASSIGNMENTS_EXIST', 'PUBLISHED_BANNER_DELETE_FORBIDDEN'].includes(err.code) ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_DELETE_ERROR' });
  }
});

router.post('/admin/marketing/banners/:bannerId/assignments', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const assignment = bannerAssignmentService.createAssignment({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actor,
      branchId: req.body && req.body.branch_id,
      placement: req.body && req.body.placement,
      position: req.body && req.body.position,
      active: req.body && req.body.active !== undefined ? req.body.active : true,
      startsAtLocal: req.body && (req.body.starts_at_local || req.body.startsAtLocal),
      endsAtLocal: req.body && (req.body.ends_at_local || req.body.endsAtLocal),
      governanceLocked: req.body && req.body.governance_locked
    });
    res.status(201).json({
      success: true,
      assignment: bannerAssignmentDtoForResponse(req.brand_id, assignment)
    });
  } catch (err) {
    const status = err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : ['BRANCH_NOT_FOUND', 'BANNER_NOT_FOUND'].includes(err.code) ? 404
      : err.code && String(err.code).indexOf('FORBIDDEN') === 0 ? 403
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_CREATE_ERROR', conflict: err.conflict || null });
  }
});

router.post('/admin/marketing/banners/:bannerId/assignments/bulk', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const assignments = bannerAssignmentService.createAssignmentsBulk({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actor,
      branchIds: req.body && req.body.branch_ids,
      placement: req.body && req.body.placement,
      position: req.body && req.body.position,
      active: req.body && req.body.active !== undefined ? req.body.active : true,
      startsAtLocal: req.body && (req.body.starts_at_local || req.body.startsAtLocal),
      endsAtLocal: req.body && (req.body.ends_at_local || req.body.endsAtLocal),
      governanceLocked: req.body && req.body.governance_locked
    });

    res.status(201).json({
      success: true,
      assignments: assignments.map(item => bannerAssignmentDtoForResponse(req.brand_id, item))
    });
  } catch (err) {
    const status = err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : ['BRANCH_NOT_FOUND', 'BANNER_NOT_FOUND'].includes(err.code) ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_BULK_ERROR', conflict: err.conflict || null });
  }
});

router.patch('/admin/marketing/banners/:bannerId/assignments/:assignmentId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const current = bannerAssignmentService.getBannerAssignment(req.brand_id, req.params.assignmentId);
    if (current.banner_id !== req.params.bannerId) {
      return res.status(404).json({ success: false, error: 'Banner Assignment tidak ditemukan.', code: 'ASSIGNMENT_NOT_FOUND' });
    }

    const assignment = bannerAssignmentService.updateAssignment({
      brandId: req.brand_id,
      assignmentId: req.params.assignmentId,
      actor,
      position: req.body && req.body.position !== undefined ? req.body.position : null,
      active: req.body && req.body.active !== undefined ? req.body.active : null,
      startsAtLocal: req.body && (req.body.starts_at_local !== undefined ? req.body.starts_at_local : undefined),
      endsAtLocal: req.body && (req.body.ends_at_local !== undefined ? req.body.ends_at_local : undefined),
      governanceLocked: req.body && req.body.governance_locked !== undefined ? req.body.governance_locked : null
    });
    res.json({ success: true, assignment: bannerAssignmentDtoForResponse(req.brand_id, assignment) });
  } catch (err) {
    const status = err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : err.code === 'ASSIGNMENT_NOT_FOUND' ? 404
      : err.code === 'ASSIGNMENT_GOVERNANCE_LOCKED' ? 403
      : err.code && String(err.code).indexOf('FORBIDDEN') === 0 ? 403
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_UPDATE_ERROR', conflict: err.conflict || null });
  }
});

router.delete('/admin/marketing/banners/:bannerId/assignments/:assignmentId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const current = bannerAssignmentService.getBannerAssignment(req.brand_id, req.params.assignmentId);
    if (current.banner_id !== req.params.bannerId) {
      return res.status(404).json({ success: false, error: 'Banner Assignment tidak ditemukan.', code: 'ASSIGNMENT_NOT_FOUND' });
    }
    const result = bannerAssignmentService.deleteAssignment({
      brandId: req.brand_id,
      assignmentId: req.params.assignmentId,
      actor
    });
    res.json(result);
  } catch (err) {
    const status = err.code === 'ASSIGNMENT_NOT_FOUND' ? 404
      : err.code === 'ASSIGNMENT_GOVERNANCE_LOCKED' ? 403
      : err.code && String(err.code).indexOf('FORBIDDEN') === 0 ? 403
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_DELETE_ERROR' });
  }
});

// Helper kept local to the API boundary for response consistency.
function bannerAssignmentDtoForResponse(brandId, assignment) {
  const row = bannerAssignmentService.getBannerAssignment(brandId, assignment.id);
  const published = row.banner_publication_status === 'PUBLISHED';
  return {
    id: row.id,
    banner_id: row.banner_id,
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    branch_timezone: row.branch_timezone || 'Asia/Jakarta',
    placement: row.placement,
    position: Number(row.position),
    active: Number(row.active) === 1,
    starts_at: row.starts_at || null,
    ends_at: row.ends_at || null,
    timezone: row.branch_timezone || row.timezone || 'Asia/Jakarta',
    governance_locked: Number(row.governance_locked) === 1,
    effective_status: require('../../domains/banner/services/BannerDateTime').effectiveStatus({
      published: published,
      active: Number(row.active) === 1,
      startsAt: row.starts_at,
      endsAt: row.ends_at
    })
  };
}

// 6.01 Create Marketing Promotion (Owner / Brand Manager)
router.post('/admin/marketing/promotions', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const {
      id,
      name,
      code,
      capability_type,
      stacking_policy,
      priority_weight,
      max_redemptions_total,
      max_redemptions_per_customer,
      start_at,
      end_at,
      is_active,
      rules,
      rewards,
      branch_ids
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Nama promosi wajib diisi.' });
    }

    if (start_at && end_at) {
      const sTime = new Date(start_at).getTime();
      const eTime = new Date(end_at).getTime();
      if (eTime < sTime) {
        return res.status(400).json({ success: false, error: 'Tanggal berakhir promosi tidak boleh lebih awal dari tanggal mulai.' });
      }
    }

    const safeBranchIds = Array.isArray(branch_ids) ? branch_ids : [];
    if (safeBranchIds.length > 0) {
      const placeholders = safeBranchIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id FROM branches WHERE brand_id = ? AND id IN (${placeholders})`).all(req.brand_id, ...safeBranchIds);
      if (rows.length !== safeBranchIds.length) {
        return res.status(403).json({
          success: false,
          error: 'Satu atau lebih cabang tidak valid atau bukan milik brand ini.'
        });
      }
    }

    if (Array.isArray(rewards) && rewards.length > 0) {
      for (const rw of rewards) {
        if (rw.target_product_id) {
          const prod = db.prepare('SELECT id FROM products WHERE id = ? AND brand_id = ?').get(rw.target_product_id, req.brand_id);
          if (!prod) {
            return res.status(400).json({
              success: false,
              error: 'Produk reward tidak valid atau bukan milik brand ini.'
            });
          }
        }
      }
    }

    const created = corePromotionRepo.createPromotion({
      id,
      brandId: req.brand_id,
      name: name.trim(),
      code: code ? code.trim().toUpperCase() : null,
      capabilityType: capability_type || 'install_incentive',
      stackingPolicy: stacking_policy || 'exclusive',
      priorityWeight: priority_weight !== undefined ? Number(priority_weight) : 100,
      maxRedemptionsTotal: max_redemptions_total ? Number(max_redemptions_total) : null,
      maxRedemptionsPerCustomer: max_redemptions_per_customer !== undefined ? Number(max_redemptions_per_customer) : 1,
      startAt: start_at || null,
      endAt: end_at || null,
      isActive: is_active !== undefined ? (is_active ? 1 : 0) : 1,
      rules: Array.isArray(rules) ? rules : [],
      rewards: Array.isArray(rewards) ? rewards : [],
      branchIds: safeBranchIds
    });

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_CREATED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: {
        promotion_id: created.id,
        name: created.name,
        branch_ids: safeBranchIds
      }
    });

    res.status(201).json({
      success: true,
      promotion: created
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.02 Update Marketing Promotion (Owner / Brand Manager)
router.put('/admin/marketing/promotions/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const existing = corePromotionRepo.findPromotion(promotionId);
    if (!existing || existing.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    const {
      name,
      code,
      capability_type,
      stacking_policy,
      priority_weight,
      max_redemptions_total,
      max_redemptions_per_customer,
      start_at,
      end_at,
      is_active,
      rules,
      rewards,
      branch_ids
    } = req.body;

    const effectiveStartAt = start_at !== undefined ? start_at : existing.start_at;
    const effectiveEndAt = end_at !== undefined ? end_at : existing.end_at;
    if (effectiveStartAt && effectiveEndAt) {
      const sTime = new Date(effectiveStartAt).getTime();
      const eTime = new Date(effectiveEndAt).getTime();
      if (eTime < sTime) {
        return res.status(400).json({ success: false, error: 'Tanggal berakhir promosi tidak boleh lebih awal dari tanggal mulai.' });
      }
    }

    if (Array.isArray(branch_ids) && branch_ids.length > 0) {
      const placeholders = branch_ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id FROM branches WHERE brand_id = ? AND id IN (${placeholders})`).all(req.brand_id, ...branch_ids);
      if (rows.length !== branch_ids.length) {
        return res.status(403).json({
          success: false,
          error: 'Satu atau lebih cabang tidak valid atau bukan milik brand ini.'
        });
      }
    }

    if (Array.isArray(rewards) && rewards.length > 0) {
      for (const rw of rewards) {
        if (rw.target_product_id) {
          const prod = db.prepare('SELECT id FROM products WHERE id = ? AND brand_id = ?').get(rw.target_product_id, req.brand_id);
          if (!prod) {
            return res.status(400).json({
              success: false,
              error: 'Produk reward tidak valid atau bukan milik brand ini.'
            });
          }
        }
      }
    }

    const updated = corePromotionRepo.updatePromotion(promotionId, req.brand_id, {
      name: name !== undefined ? name.trim() : undefined,
      code: code !== undefined ? (code ? code.trim().toUpperCase() : null) : undefined,
      stackingPolicy: stacking_policy,
      priorityWeight: priority_weight,
      maxRedemptionsTotal: max_redemptions_total !== undefined ? (max_redemptions_total ? Number(max_redemptions_total) : null) : undefined,
      maxRedemptionsPerCustomer: max_redemptions_per_customer !== undefined ? (max_redemptions_per_customer ? Number(max_redemptions_per_customer) : null) : undefined,
      startAt: start_at,
      endAt: end_at,
      isActive: is_active !== undefined ? (is_active ? 1 : 0) : undefined,
      rules,
      rewards,
      branchIds: branch_ids
    });

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_UPDATED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: {
        promotion_id: promotionId,
        is_active: is_active !== undefined ? (is_active ? 1 : 0) : undefined
      }
    });

    const enrichedUpdated = {
      ...updated,
      rewards: (updated.rewards || []).map(r => {
        let pres = {};
        if (r.presentation_payload) {
          try {
            pres = typeof r.presentation_payload === 'string'
              ? JSON.parse(r.presentation_payload)
              : r.presentation_payload;
          } catch (_) {}
        }
        let delivery = null;
        if (pres.media_id) {
          delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
        }
        return {
          ...r,
          presentation: pres,
          presentation_delivery: delivery
        };
      })
    };

    res.json({
      success: true,
      promotion: enrichedUpdated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.02b Update Promotion Presentation Payload specifically (Owner / Brand Manager)
router.patch('/admin/marketing/promotions/:id/presentation', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const existing = corePromotionRepo.findPromotion(promotionId);
    if (!existing || existing.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    const {
      banner_title,
      banner_subtitle,
      reward_title,
      reward_badge_text,
      cta_text,
      media_id,
      icon_url
    } = req.body || {};

    const presentationUpdates = {};

    if (banner_title !== undefined) {
      presentationUpdates.banner_title = typeof banner_title === 'string' ? banner_title.trim() : '';
    }
    if (banner_subtitle !== undefined) {
      presentationUpdates.banner_subtitle = typeof banner_subtitle === 'string' ? banner_subtitle.trim() : '';
    }
    if (cta_text !== undefined) {
      presentationUpdates.cta_text = typeof cta_text === 'string' ? cta_text.trim() : '';
    }
    if (reward_title !== undefined) {
      presentationUpdates.reward_title = typeof reward_title === 'string' ? reward_title.trim() : '';
    }
    if (reward_badge_text !== undefined) {
      presentationUpdates.reward_badge_text = typeof reward_badge_text === 'string' ? reward_badge_text.trim() : '';
    }

    // Media verification if media_id is provided
    if (media_id !== undefined) {
      if (media_id) {
        let asset = null;
        try {
          asset = mediaService.getMedia({ mediaId: media_id, brandId: req.brand_id });
        } catch (mediaErr) {
          const status = mediaErr.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
          return res.status(status).json({
            success: false,
            error: mediaErr.message || 'Aset media tidak valid.',
            code: mediaErr.code || 'MEDIA_ERROR'
          });
        }

        if (asset.status !== 'ready') {
          return res.status(400).json({
            success: false,
            error: 'Aset media belum selesai diproses (status harus READY).',
            code: 'MEDIA_NOT_READY'
          });
        }

        presentationUpdates.media_id = media_id;
        presentationUpdates.icon_url = asset.url;
      } else {
        presentationUpdates.media_id = null;
        presentationUpdates.icon_url = icon_url || null;
      }
    } else if (icon_url !== undefined) {
      presentationUpdates.icon_url = icon_url;
    }

    const updated = corePromotionRepo.updatePresentationPayload(promotionId, req.brand_id, presentationUpdates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Gagal memperbarui presentasi promosi.' });
    }

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_PRESENTATION_UPDATED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: {
        promotion_id: promotionId,
        presentation_keys: Object.keys(presentationUpdates)
      }
    });

    const enrichedUpdated = {
      ...updated,
      rewards: (updated.rewards || []).map(r => {
        let pres = {};
        if (r.presentation_payload) {
          try {
            pres = typeof r.presentation_payload === 'string'
              ? JSON.parse(r.presentation_payload)
              : r.presentation_payload;
          } catch (_) {}
        }
        let delivery = null;
        if (pres.media_id) {
          delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
        }
        return {
          ...r,
          presentation: pres,
          presentation_delivery: delivery
        };
      })
    };

    res.json({
      success: true,
      promotion: enrichedUpdated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.03 Delete / Deactivate Marketing Promotion (Owner / Brand Manager)
router.delete('/admin/marketing/promotions/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const existing = corePromotionRepo.findPromotion(promotionId);
    if (!existing || existing.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    // Safety Audit: block hard delete if redemptions exist to preserve immutable audit trail
    const redemptionRow = db.prepare('SELECT COUNT(*) as count FROM promotion_redemptions WHERE promotion_id = ?').get(promotionId);
    if (redemptionRow && Number(redemptionRow.count) > 0) {
      return res.status(409).json({
        success: false,
        error: 'Promosi tidak dapat dihapus karena memiliki riwayat penebusan pesanan. Silakan nonaktifkan promosi sebagai gantinya.'
      });
    }

    corePromotionRepo.deletePromotion(promotionId, req.brand_id);

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_DELETED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: { promotion_id: promotionId, name: existing.name }
    });

    res.json({
      success: true,
      message: 'Promosi berhasil dihapus.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.1 Assign/Update Branch Scopes for Promotion (Owner / Brand Manager only)
router.post('/admin/marketing/promotions/:id/scopes', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const { branch_ids, is_active = 1 } = req.body;

    if (!Array.isArray(branch_ids) || branch_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'branch_ids must be a non-empty array.' });
    }

    const promo = corePromotionRepo.findPromotion(promotionId);
    if (!promo || promo.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    // Strict validation: every branch_id must belong to req.brand_id
    const placeholders = branch_ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id FROM branches WHERE brand_id = ? AND id IN (${placeholders})`).all(req.brand_id, ...branch_ids);
    if (rows.length !== branch_ids.length) {
      return res.status(403).json({
        success: false,
        error: 'Satu atau lebih cabang tidak valid atau bukan milik brand ini.'
      });
    }

    for (const branchId of branch_ids) {
      corePromotionRepo.assignBranchScope({
        promotionId,
        brandId: req.brand_id,
        branchId,
        isActive: is_active
      });
    }

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_SCOPE_ASSIGNED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: { promotion_id: promotionId, branch_ids, is_active }
    });

    const scopes = corePromotionRepo.findBranchScopes(promotionId);
    res.json({
      success: true,
      promotion_id: promotionId,
      scopes
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.2 Toggle Promotion Branch Activation (BM can only modify their own assigned branch; Owner/Brand Manager can modify any branch)
router.patch('/admin/marketing/promotions/:id/branch-activation', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const { is_active } = req.body;
    let targetBranchId = req.body.branch_id;

    const promo = corePromotionRepo.findPromotion(promotionId);
    if (!promo || promo.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    if (req.user.role === 'branch_manager') {
      const userBranchId = req.user.branch_id || req.user.branchId;
      if (!userBranchId) {
        return res.status(403).json({ success: false, error: 'Branch Manager must be assigned to a branch.' });
      }
      if (targetBranchId && String(targetBranchId) !== String(userBranchId)) {
        return res.status(403).json({ success: false, error: 'Branch Manager cannot modify promotions for other branches.' });
      }
      targetBranchId = userBranchId;
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'branch_id is required.' });
    }

    // Verify target branch belongs to caller's brand
    const branchRecord = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(targetBranchId, req.brand_id);
    if (!branchRecord) {
      return res.status(403).json({ success: false, error: 'Cabang bukan milik brand ini.' });
    }

    const existingScope = corePromotionRepo.findBranchScope(promotionId, targetBranchId);
    if (!existingScope) {
      return res.status(404).json({ success: false, error: 'Promotion is not scoped to this branch.' });
    }

    const newActiveState = (is_active === 1 || is_active === true) ? 1 : 0;

    // Prerequisite validation when activating: reward products must be available in target branch catalog
    if (newActiveState === 1) {
      const rewards = corePromotionRepo.findRewards(promotionId);
      for (const reward of rewards) {
        if (reward.reward_type === 'freebie_product' || reward.target_product_id) {
          const targetPid = reward.target_product_id;
          if (!targetPid) {
            return res.status(422).json({
              success: false,
              error: 'Promo belum dapat diaktifkan karena definisi produk hadiah tidak valid.'
            });
          }

          const product = db.prepare('SELECT id, name, brand_id, is_active FROM products WHERE id = ? AND brand_id = ?').get(targetPid, req.brand_id);
          if (!product || product.is_active === 0) {
            const prodName = product?.name || `ID ${targetPid}`;
            return res.status(422).json({
              success: false,
              error: `Promo belum dapat diaktifkan karena produk hadiah '${prodName}' belum tersedia di katalog brand ini.`
            });
          }

          const bp = db.prepare('SELECT is_available, stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(targetBranchId, targetPid);
          if (!bp) {
            return res.status(422).json({
              success: false,
              error: `Promo belum dapat diaktifkan karena produk hadiah '${product.name}' belum tersedia di katalog cabang ini.`
            });
          }

          if (bp.is_available !== 1) {
            return res.status(422).json({
              success: false,
              error: `Promo belum dapat diaktifkan karena produk hadiah '${product.name}' sedang dinonaktifkan di cabang ini.`
            });
          }
        }
      }
    }

    corePromotionRepo.setBranchScopeActivation({
      promotionId,
      branchId: targetBranchId,
      isActive: newActiveState
    });

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_BRANCH_ACTIVATED',
      brand_id: req.brand_id,
      branch_id: targetBranchId,
      result: 'SUCCESS',
      metadata: { promotion_id: promotionId, is_active: newActiveState }
    });

    res.json({
      success: true,
      promotion_id: promotionId,
      branch_id: targetBranchId,
      is_active: newActiveState
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Marketing Promotion Redemptions API
router.get('/admin/marketing/redemptions', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, promotion_id, limit, offset } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const result = corePromotionRepo.findPromotionRedemptions({
      brandId: req.brand_id,
      branchId: effectiveBranchId,
      promotionId: promotion_id || null,
      limit,
      offset
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// DINE-IN TABLE FLOOR PLAN & OPERATIONAL DOMAIN APIS
// =========================================================================
const { DiningTableService, TableRecommendationService } = require('../../domains/pos');

// Customer / Public / Staff: Get Branch Floor Plan & Operational Table State
router.get('/dine-in/layout', (req, res) => {
  try {
    // If an authenticated staff token is presented, enforce branch scope
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();
    let session = null;
    if (token) {
      session = TokenSessionStore.getSession(token);
    }

    let branchId = req.query.branch_id || (req.query.branchId ? req.query.branchId : null);

    if (session && ['branch_manager', 'cashier', 'kitchen'].includes(session.role)) {
      const assignedBranchId = session.branchId || session.branch_id;
      if (branchId && branchId !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_ACCESS',
          message: 'Akses ditolak: Anda hanya memiliki izin untuk mengakses cabang yang ditugaskan.'
        });
      }
      branchId = assignedBranchId;
    }

    if (!branchId && req.brand_id) {
      const defaultBranch = db.prepare('SELECT b.id FROM branches b LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id WHERE b.brand_id = ? AND b.is_active = 1 ORDER BY COALESCE(s.is_delivery_active, 1) DESC, b.created_at ASC LIMIT 1').get(req.brand_id);
      if (defaultBranch) branchId = defaultBranch.id;
    }

    if (!branchId) {
      return res.status(400).json({ success: false, error: 'branch_id parameter wajib disertakan.' });
    }

    const layout = DiningTableService.getBranchLayout(branchId);
    res.json({ success: true, layout });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Customer: Recommend Table(s) based on Guest Count & Spatial Proximity
router.post('/dine-in/recommend-tables', (req, res) => {
  try {
    let { branch_id, guest_count } = req.body || {};
    if (!branch_id && req.brand_id) {
      const defaultBranch = db.prepare('SELECT b.id FROM branches b LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id WHERE b.brand_id = ? AND b.is_active = 1 ORDER BY COALESCE(s.is_delivery_active, 1) DESC, b.created_at ASC LIMIT 1').get(req.brand_id);
      if (defaultBranch) branch_id = defaultBranch.id;
    }

    if (!branch_id) {
      return res.status(400).json({ success: false, error: 'branch_id wajib diisi.' });
    }

    const layout = DiningTableService.getBranchLayout(branch_id);
    const recommendation = TableRecommendationService.recommendTables({
      tables: layout.tables,
      guest_count: Number(guest_count) || 1
    });

    res.json({ success: true, recommendation });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Customer: Resolve Branch & Table from scanned QR token
router.get('/dine-in/qr/:token', (req, res) => {
  try {
    const resolved = DiningTableService.resolveFromQr(req.params.token);
    if (!resolved) {
      return res.status(404).json({ success: false, error: 'QR Meja tidak valid atau telah dicabut.' });
    }
    res.json({ success: true, table: resolved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / Owner: Regenerate QR Token for a table
// Staff: QR meja untuk dicetak / dibagikan / dikirim ke printer.
//
// Isinya URL GABUNG, bukan token mentah: kamera bawaan HP mana pun bisa
// membacanya dan langsung membuka PWA, tanpa aplikasi kita dan tanpa izin apa
// pun. Tokennya TIDAK dirotasi di sini — QR yang sudah ditempel di meja harus
// tetap berlaku sampai staf sengaja mem-rotate-nya; token hanya dibuat kalau
// meja itu belum punya.
router.get('/dine-in/tables/:id/qr', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const table = db.prepare('SELECT id, branch_id, table_number, label, qr_token FROM branch_tables WHERE id = ?').get(req.params.id);
    if (!table) {
      return res.status(404).json({ success: false, error: 'MEJA_TIDAK_DITEMUKAN' });
    }

    if (['branch_manager', 'cashier'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (table.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada meja cabang yang ditugaskan.'
        });
      }
    }

    let token = table.qr_token;
    if (!token) {
      const { DiningTableService } = require('../../domains/pos');
      token = DiningTableService.regenerateQrToken(table.id).qr_token;
    }

    const joinUrl = 'https://' + req.headers.host + '/join?meja=' + encodeURIComponent(token);

    const qrcode = require('qrcode-generator');
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();

    res.json({
      success: true,
      table: { id: table.id, table_number: table.table_number, label: table.label },
      join_url: joinUrl,
      svg: qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true })
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/dine-in/tables/:id/regenerate-qr', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      const table = db.prepare('SELECT branch_id FROM branch_tables WHERE id = ?').get(req.params.id);
      if (!table || table.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada meja cabang yang ditugaskan.'
        });
      }
    }
    const result = DiningTableService.regenerateQrToken(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / POS: Block or Unblock a table (with strict branch scope guard)
router.post('/dine-in/tables/:id/block', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const { is_blocked, reason } = req.body;

    // Scope check: branch_manager or cashier can operate only on assigned branch
    if (['branch_manager', 'cashier'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      const table = db.prepare('SELECT branch_id FROM branch_tables WHERE id = ?').get(req.params.id);
      if (!table || table.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada meja cabang yang ditugaskan.'
        });
      }
    }

    const result = DiningTableService.setTableBlockedState(req.params.id, Boolean(is_blocked), reason);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / POS: Complete Active Dining Session (Releases tables)
router.post('/dine-in/sessions/:id/complete', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    if (['branch_manager', 'cashier'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      const session = db.prepare('SELECT branch_id FROM dining_sessions WHERE id = ?').get(req.params.id);
      if (!session || session.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada sesi cabang yang ditugaskan.'
        });
      }
    }
    const actorId = req.user ? (req.user.id || req.user.username) : 'staff';
    const result = DiningTableService.completeDiningSession(req.params.id, actorId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / POS: Operational Table Reassignment for Active Dining Session
router.post('/dine-in/sessions/:id/reassign-tables', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    if (['branch_manager', 'cashier'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      const session = db.prepare('SELECT branch_id FROM dining_sessions WHERE id = ?').get(req.params.id);
      if (!session || session.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada sesi cabang yang ditugaskan.'
        });
      }
    }
    const { table_ids } = req.body;
    const result = DiningTableService.reassignSessionTables({
      session_id: req.params.id,
      new_table_ids: table_ids
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Owner / Brand Governance: Update Branch Dining Layout Configuration (Geometry / Physical Structure)
// Branch Manager operates daily table states only, does not modify physical floor layout geometry.
router.put('/dine-in/layout/:branch_id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const branchId = req.params.branch_id;
    const { canvas, sections, non_table_objects, tables } = req.body;

    const existingLayout = db.prepare('SELECT id FROM branch_dining_layouts WHERE branch_id = ?').get(branchId);
    const layoutId = existingLayout ? existingLayout.id : `layout_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`
        INSERT INTO branch_dining_layouts (
          id, branch_id, canvas_config, sections_config, non_table_objects_config, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(branch_id) DO UPDATE SET
          canvas_config = excluded.canvas_config,
          sections_config = excluded.sections_config,
          non_table_objects_config = excluded.non_table_objects_config,
          updated_at = excluded.updated_at
      `).run(
        layoutId,
        branchId,
        JSON.stringify(canvas || { width: 380, height: 620 }),
        JSON.stringify(sections || []),
        JSON.stringify(non_table_objects || []),
        now,
        now
      );

      if (Array.isArray(tables)) {
        for (const t of tables) {
          const tableId = t.id || `tbl_${branchId}_${t.table_number}`;
          const qrToken = t.qr_token || `qr_${crypto.randomBytes(8).toString('hex')}`;

          db.prepare(`
            INSERT INTO branch_tables (
              id, branch_id, table_number, label, capacity, section_id,
              x, y, width, height, shape, orientation, qr_token, is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(branch_id, table_number) DO UPDATE SET
              label = excluded.label,
              capacity = excluded.capacity,
              section_id = excluded.section_id,
              x = excluded.x,
              y = excluded.y,
              width = excluded.width,
              height = excluded.height,
              shape = excluded.shape,
              orientation = excluded.orientation,
              is_active = excluded.is_active,
              updated_at = excluded.updated_at
          `).run(
            tableId,
            branchId,
            String(t.table_number),
            t.label || `meja ${t.table_number}`,
            Number(t.capacity) || 4,
            t.section_id || null,
            Number(t.x) || 0,
            Number(t.y) || 0,
            Number(t.width) || 80,
            Number(t.height) || 60,
            t.shape || 'rectangle',
            t.orientation || 'horizontal',
            qrToken,
            t.is_active !== undefined ? (t.is_active ? 1 : 0) : 1,
            now,
            now
          );

          if (t.operational_state) {
            db.prepare(`
              INSERT INTO branch_table_states (table_id, operational_state, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(table_id) DO UPDATE SET
                operational_state = excluded.operational_state,
                updated_at = excluded.updated_at
            `).run(tableId, t.operational_state, now);
          }
        }
      }

      db.exec('COMMIT;');
    } catch (saveErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw saveErr;
    }

    res.json({ success: true, message: 'Tata letak meja berhasil diperbarui.' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// =========================================================================
// PHASE 7: CLIENT OWNER DASHBOARD — SETTINGS & INTEGRATIONS APIS
// Authoritative Core reuse with strict multi-tenant & RBAC scoping
// =========================================================================
const {
  BrandRepository: CoreBrandRepo,
  BranchRepository: CoreBranchRepo,
  UserRepository: CoreUserRepo
} = require('../../core/data/repositories');
const coreBrandRepo = new CoreBrandRepo();
const coreBranchRepo = new CoreBranchRepo();
const coreUserRepo = new CoreUserRepo();

// 1. Settings Overview / Metadata Tree
router.get('/admin/settings/overview', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    const branches = db.prepare('SELECT id, name, is_active FROM branches WHERE brand_id = ?').all(req.brand_id);
    const branchCount = branches ? branches.length : 0;

    res.json({
      success: true,
      brand_id: req.brand_id,
      brand_name: brand ? brand.name : 'Unknown Brand',
      sections: {
        business: { status: 'configured', subcategories: ['profile', 'info', 'legal'] },
        locations: { status: 'configured', subcategories: ['defaults'], total_branches: branchCount },
        commerce: { status: 'configured', subcategories: ['orders', 'payments', 'fulfillment'] },
        channels: { status: 'configured', subcategories: ['website', 'customer-app', 'pos', 'kiosk'] },
        system: { status: 'configured', subcategories: ['notifications', 'security'] },
        integrations: { status: 'configured', subcategories: ['integrations'] }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Business Settings
// 2.1 Brand Profile (GET)
router.get('/admin/settings/business/profile', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    let banners = [];
    try {
      banners = brand && brand.banners ? (typeof brand.banners === 'string' ? JSON.parse(brand.banners) : brand.banners) : [];
    } catch (_) {}

    res.json({
      success: true,
      profile: {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        tagline: brand.tagline || '',
        logo_url: brand.logo_url || '/assets/pwa/icon-192.png',
        primary_color: brand.primary_color || '#b6ff00',
        custom_domain: brand.custom_domain || '',
        banners: Array.isArray(banners) ? banners : []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.2 Brand Profile (PUT - Owner/Brand Manager only)
router.put('/admin/settings/business/profile', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, tagline, logo_url, primary_color, banners } = req.body;
    coreBrandRepo.updateBrandProfile(req.brand_id, {
      name,
      tagline,
      logo_url,
      primary_color,
      banners
    });

    const updated = coreBrandRepo.findById(req.brand_id);
    res.json({
      success: true,
      message: 'Profil brand berhasil diperbarui.',
      profile: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        tagline: updated.tagline,
        logo_url: updated.logo_url,
        primary_color: updated.primary_color,
        custom_domain: updated.custom_domain
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.3 Business Info
router.get('/admin/settings/business/info', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(brand.organization_id);
    const primaryBranch = db.prepare('SELECT address_text, phone, whatsapp_number FROM branches WHERE brand_id = ? ORDER BY created_at ASC LIMIT 1').get(req.brand_id);

    res.json({
      success: true,
      info: {
        brand_name: brand.name,
        organization_name: org ? org.name : 'Xentra Merchant Group',
        organization_slug: org ? org.slug : '',
        primary_address: primaryBranch ? primaryBranch.address_text : '',
        contact_phone: primaryBranch ? primaryBranch.phone : '',
        contact_whatsapp: primaryBranch ? primaryBranch.whatsapp_number : '',
        registered_at: brand.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.4 Legal / Tax (Honest not-configured state)
router.get('/admin/settings/business/legal', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  res.json({
    success: true,
    is_supported: false,
    tax_configured: false,
    npwp: null,
    vat_percentage: 0,
    pb1_percentage: 0,
    terms_url: null,
    privacy_url: null,
    message: 'Konfigurasi pajak (PPN / PB1) dan entitas legal belum dikonfigurasi pada Core engine v1. Semua harga transaksi dianggap harga final (nett).'
  });
});

// 3. Locations / Branch Defaults
router.get('/admin/settings/locations/defaults', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const branches = db.prepare(`
      SELECT b.id, b.name, b.slug, b.is_active, b.is_open_override,
             s.is_delivery_active, s.is_pickup_active, s.max_radius_km, s.free_delivery_km, s.price_per_km, s.min_order_amount
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.brand_id = ?
      ORDER BY b.created_at ASC
    `).all(req.brand_id);

    res.json({
      success: true,
      defaults: {
        delivery_enabled_default: true,
        pickup_enabled_default: true,
        dine_in_enabled_default: true,
        default_max_radius_km: 10.0,
        default_free_delivery_km: 3.0,
        default_price_per_km: 2500.0,
        branches_count: branches.length,
        branches: branches.map(b => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          is_active: b.is_active === 1,
          is_delivery_active: b.is_delivery_active !== null ? b.is_delivery_active === 1 : true,
          is_pickup_active: b.is_pickup_active !== null ? b.is_pickup_active === 1 : true,
          max_radius_km: b.max_radius_km || 10.0,
          price_per_km: b.price_per_km || 2500.0
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Commerce Settings
// 4.1 Order Settings
router.get('/admin/settings/commerce/orders', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  res.json({
    success: true,
    policies: {
      order_acceptance_mode: 'manual_or_pos',
      allow_preorder: false,
      reservation_lead_days_min: 1,
      reservation_rule: 'Reservasi hanya dapat dipesan untuk H+1 ke atas (pemesanan hari yang sama/same-day dilarang sesuai OrderEngine)',
      overdue_timeout_seconds: 900,
      supported_order_types: ['delivery', 'takeaway', 'dine_in', 'reservation'],
      supported_order_channels: ['web', 'pwa', 'pos', 'kiosk']
    }
  });
});

// 4.2 Payment Settings
router.get('/admin/settings/commerce/payments', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const brandConfig = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
    let parsedBrandConfig = null;
    if (brandConfig && brandConfig.default_payment_config) {
      try { parsedBrandConfig = JSON.parse(brandConfig.default_payment_config); } catch (_) {}
    }

    let branchOverride = null;
    if (effectiveBranchId && effectiveBranchId !== 'all') {
      const branchRow = corePaymentRepo.findBranchPaymentConfig(effectiveBranchId, req.brand_id);
      if (branchRow && branchRow.payment_config_override) {
        try { branchOverride = JSON.parse(branchRow.payment_config_override); } catch (_) {}
      }
    }

    const effectiveConfig = branchOverride || parsedBrandConfig || {};
    const hasOverride = Boolean(branchOverride);

    res.json({
      success: true,
      payment_settings: {
        branch_id: effectiveBranchId || null,
        has_branch_override: hasOverride,
        server_key_configured: Boolean(effectiveConfig.server_key || process.env.MIDTRANS_SERVER_KEY),
        client_key_configured: Boolean(effectiveConfig.client_key || process.env.MIDTRANS_CLIENT_KEY),
        merchant_id: effectiveConfig.merchant_id || process.env.MIDTRANS_MERCHANT_ID || '',
        is_production: Boolean(effectiveConfig.is_production !== undefined ? effectiveConfig.is_production : (process.env.MIDTRANS_IS_PRODUCTION === 'true')),
        methods: [
          { code: 'cash', name: 'Tunai Kasir', enabled: true, mode: 'pos_cashier' },
          { code: 'midtrans', name: 'Midtrans Payment Gateway', enabled: Boolean(effectiveConfig.server_key || process.env.MIDTRANS_SERVER_KEY), mode: 'online' }
        ]
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.3 Payment Settings (PUT - Owner/Brand Manager only)
router.put('/admin/settings/commerce/payments', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { branch_id, server_key, client_key, merchant_id, is_production } = req.body;
    const configPayload = {
      server_key: server_key || '',
      client_key: client_key || '',
      merchant_id: merchant_id || '',
      is_production: Boolean(is_production)
    };
    const jsonStr = JSON.stringify(configPayload);

    if (branch_id && branch_id !== 'all') {
      // Branch-specific override
      const belongs = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branch_id, req.brand_id);
      if (!belongs) {
        return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan atau bukan milik brand ini.' });
      }
      corePaymentRepo.updateBranchPaymentConfig(branch_id, jsonStr);
      return res.json({ success: true, message: 'Override pembayaran cabang berhasil disimpan.', is_branch_override: true });
    }

    // Brand-level default
    corePaymentRepo.updateBrandPaymentConfig(req.brand_id, jsonStr);
    res.json({ success: true, message: 'Pengaturan pembayaran default brand berhasil disimpan.', is_branch_override: false });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.4 Fulfillment Settings
router.get('/admin/settings/commerce/fulfillment', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id } = req.query;
    let targetBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      targetBranchId = req.user.branch_id || req.user.branchId;
    }

    if (!targetBranchId || targetBranchId === 'all') {
      const firstBranch = db.prepare('SELECT id FROM branches WHERE brand_id = ? ORDER BY created_at ASC LIMIT 1').get(req.brand_id);
      targetBranchId = firstBranch ? firstBranch.id : null;
    }

    if (!targetBranchId) {
      return res.json({
        success: true,
        fulfillment: {
          branch_id: null,
          is_delivery_active: true,
          is_pickup_active: true,
          is_dine_in_active: true,
          max_radius_km: 10.0,
          free_delivery_km: 3.0,
          price_per_km: 2500.0,
          min_order_amount: 0.0,
          promo_delivery_discount: 0.0,
          promo_min_order: 0.0
        }
      });
    }

    const settings = coreBranchRepo.findBranchDeliverySettings(targetBranchId);
    res.json({
      success: true,
      fulfillment: {
        branch_id: targetBranchId,
        branch_name: settings ? settings.branch_name : 'Cabang Utama',
        is_delivery_active: settings ? settings.is_delivery_active === 1 : true,
        is_pickup_active: settings ? settings.is_pickup_active === 1 : true,
        is_dine_in_active: true,
        max_radius_km: settings ? settings.max_radius_km : 10.0,
        free_delivery_km: settings ? settings.free_delivery_km : 3.0,
        price_per_km: settings ? settings.price_per_km : 2500.0,
        min_order_amount: settings ? settings.min_order_amount : 0.0,
        promo_delivery_discount: settings ? settings.promo_delivery_discount : 0.0,
        promo_min_order: settings ? settings.promo_min_order : 0.0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.5 Fulfillment Settings (PUT - Branch Manager / Brand Manager / Owner)
router.put('/admin/settings/commerce/fulfillment', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    let { branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount, promo_delivery_discount, promo_min_order } = req.body;
    if (req.user.role === 'branch_manager') {
      branch_id = req.user.branch_id || req.user.branchId;
    }

    if (!branch_id || branch_id === 'all') {
      return res.status(400).json({ success: false, error: 'ID cabang spesifik diperlukan untuk memperbarui pemenuhan pesanan.' });
    }

    const belongs = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branch_id, req.brand_id);
    if (!belongs) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan atau tidak memiliki akses.' });
    }

    coreBranchRepo.updateBranchDeliverySettings(branch_id, {
      is_delivery_active,
      is_pickup_active,
      max_radius_km,
      free_delivery_km,
      price_per_km,
      min_order_amount,
      promo_delivery_discount,
      promo_min_order
    });

    res.json({ success: true, message: 'Konfigurasi pemenuhan pesanan cabang berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Channels Status & Config
// 5.1 Website
router.get('/admin/settings/channels/website', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    const hostHeader = (req.get('host') || '').split(':')[0];
    const resolvedDomain = brand.custom_domain || hostHeader || 'localhost';
    res.json({
      success: true,
      channel: {
        code: 'website',
        name: 'Official Merchant Web Ordering',
        status: 'active',
        domain: resolvedDomain,
        url: 'https://' + resolvedDomain + '/',
        features: ['Desktop Catalog', 'Checkout', 'Midtrans Gateway', 'Order Tracking']
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.2 Customer App (PWA)
router.get('/admin/settings/channels/customer-app', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    res.json({
      success: true,
      channel: {
        code: 'customer-app',
        name: 'Customer PWA (Progressive Web App)',
        status: 'active',
        manifest_url: '/manifest.json',
        pwa_icon: brand.logo_url || '/assets/pwa/icon-192.png',
        primary_color: brand.primary_color || '#b6ff00',
        installable: true,
        offline_shell: true
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.3 POS
router.get('/admin/settings/channels/pos', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const openShifts = db.prepare(`
      SELECT s.id, s.branch_id, b.name as branch_name, s.cashier_id, s.opened_at
      FROM pos_shifts s
      JOIN branches b ON s.branch_id = b.id
      WHERE b.brand_id = ? AND s.status = 'open'
    `).all(req.brand_id);

    res.json({
      success: true,
      channel: {
        code: 'pos',
        name: 'Point of Sale (POS Kasir)',
        status: 'active',
        active_shifts_count: openShifts ? openShifts.length : 0,
        open_shifts: openShifts || [],
        features: ['Cashier Shift Management', 'Split / Merge Order', 'Cash Drawer Movements', 'Receipt Printing']
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.4 Kiosk (Honest not-configured state)
router.get('/admin/settings/channels/kiosk', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  res.json({
    success: true,
    channel: {
      code: 'kiosk',
      name: 'Self-Service Kiosk Terminal',
      status: 'not_configured',
      is_supported: false,
      message: 'Self-Service Ordering Kiosk belum dikonfigurasi untuk brand ini. Dapat diaktifkan saat perangkat terminal kiosk fisik terhubung.'
    }
  });
});

// 6. Integrations Status API
router.get('/admin/settings/integrations', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brandConfig = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
    let parsedConfig = null;
    if (brandConfig && brandConfig.default_payment_config) {
      try { parsedConfig = JSON.parse(brandConfig.default_payment_config); } catch (_) {}
    }

    const midtransActive = Boolean(parsedConfig?.server_key || process.env.MIDTRANS_SERVER_KEY);
    const midtransEnv = (parsedConfig?.is_production || process.env.MIDTRANS_IS_PRODUCTION === 'true') ? 'production' : 'sandbox';

    res.json({
      success: true,
      integrations: [
        {
          id: 'payment_gateway_midtrans',
          name: 'Midtrans Payment Gateway',
          category: 'payment',
          status: midtransActive ? 'connected' : 'disconnected',
          environment: midtransEnv,
          description: 'Payment gateway multi-channel untuk pembayaran online checkout PWA dan web.',
          is_configurable: true
        },
        {
          id: 'pos_cashier_engine',
          name: 'Xentra Core POS Engine',
          category: 'pos',
          status: 'connected',
          environment: 'native',
          description: 'Sistem POS kasir terintegrasi langsung dengan manajemen shift, laci kas, dan dapur.',
          is_configurable: false
        },
        {
          id: 'xentra_connector',
          name: 'Xentra Connector (External POS / ERP Bridge)',
          category: 'connector',
          status: 'on_hold',
          description: 'Bridge penghubung ekosistem ERP dan hardware eksternal. Invariant: Status HOLD.',
          is_configurable: false
        }
      ]
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Notifications Settings (Honest not-configured state)
router.get('/admin/settings/notifications', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  res.json({
    success: true,
    is_supported: false,
    channels: {
      email: { enabled: false, provider: 'smtp', status: 'not_configured' },
      whatsapp: { enabled: false, provider: 'wa_gateway', status: 'not_configured' },
      push_notification: { enabled: false, provider: 'fcm_web_push', status: 'not_configured' }
    },
    message: 'Preferensi notifikasi multi-channel (WhatsApp, Email, Web Push) belum dikonfigurasi di Core persistence v1. Notifikasi pesanan saat ini berjalan secara lokal realtime di dashboard via WebSocket/polling.'
  });
});

// 8. Security & Audit Settings
router.get('/admin/settings/security', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const logs = coreUserRepo.findAuditLogsForBrand(req.brand_id, 15);
    res.json({
      success: true,
      security: {
        auth_mode: 'jwt_bearer_token',
        session_ttl_hours: 24,
        rbac_model: 'User -> Role -> Scope',
        roles_supported: ['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'],
        current_user: {
          id: req.user.id || req.user.userId,
          username: req.user.username,
          role: req.user.role,
          branch_id: req.user.branch_id || req.user.branchId || null
        },
        recent_audit_logs: logs || []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// JSON 404 for any unmatched API request (all methods) — prevents clients that
// parse with res.json() from ever receiving Express's HTML default body.
router.use((req, res) => {
  res.status(404).json({ success: false, error: 'ENDPOINT_NOT_FOUND', status_code: 404 });
});

module.exports = router;

