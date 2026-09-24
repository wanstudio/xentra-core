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
const registerCustomerOrderRoutes = require('./customer-orders');
const registerCustomerRoutes = require('./customer');
const registerCustomerAddressRoutes = require('./customer-addresses');
const registerPlatformRoutes = require('./platform');
const registerAdminCatalogRoutes = require('./admin-catalog');
const registerAdminBranchRoutes = require('./admin-branches');
const registerAdminOrderRoutes = require('./admin-orders');
const registerOperationalOrderRoutes = require('./operational-orders');
const registerAdminBranchCatalogRoutes = require('./admin-branch-catalog');
const registerPaymentWebhooks = require('./webhooks');
const registerSettingsRoutes = require('./settings');
const registerAdminMarketingPromotionRoutes = require('./admin-marketing-promotions');
const registerAdminMarketingBannerRoutes = require('./admin-marketing-banners');
const registerAdminReportingRoutes = require('./admin-reporting');
const registerAdminFinanceRoutes = require('./admin-finance');
const registerMediaUploadRoutes = require('./media-upload');
const registerMediaEntityRoutes = require('./media-entities');
const registerPaymentConfigRoutes = require('./payment-config');
const registerLocationRoutes = require('./location');
const registerPublicBrandRoutes = require('./public-brand');
const registerStorefrontRoutes = require('./storefront');
const registerCatalogRoutes = require('./catalog');
const registerPosRoutes = require('./pos');
const OrderStateMachine = require('../services/OrderStateMachine');
const AcceptanceTimeoutService = require('../services/AcceptanceTimeoutService');
const RouteService = require('../services/RouteService');
const { PromotionEngineService } = require('../../domains/promotion');
const { InventoryStockService, InventoryMovementModel } = require('../../domains/inventory');
const CatalogService = require('../../domains/commerce/services/CatalogService');
const PricingPolicyModel = require('../../domains/commerce/models/PricingPolicyModel');
const { XentraConnectorClient, XentraConnectorError } = require('../../core/integration/XentraConnectorClient');
const { BrandRepository: CoreBrandRepo, BranchRepository: CoreBranchRepo, UserRepository: CoreUserRepo } = require('../../core/data/repositories');
const coreBrandRepo = new CoreBrandRepo();
const coreBranchRepo = new CoreBranchRepo();
const coreUserRepo = new CoreUserRepo();

const { ImageValidator } = require('../../core/domain');
const { MediaService } = require('../../core/media');
const { BannerContentService, BannerAssignmentService } = require('../../domains/banner');
const mediaService = new MediaService();
const bannerContentService = new BannerContentService({ media: mediaService });
const bannerAssignmentService = new BannerAssignmentService();

// Public brand discovery routes are isolated in server/routes/public-brand.js.
registerPublicBrandRoutes(router, { db, PromotionEngineService });

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


// Branch matching and address lookup routes are isolated in server/routes/location.js.
registerLocationRoutes(router, { BranchMatcher, RouteService });

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
// Canonical public catalog menu route is isolated in server/routes/catalog.js.
registerCatalogRoutes(router, { db, CatalogService, batchResolveCustomerMediaDelivery });

// Product/upsell/checkout-session support routes are isolated in server/routes/storefront.js.
registerStorefrontRoutes(router, { db, crypto, batchResolveCustomerMediaDelivery });

// Customer address CRUD is isolated in server/routes/customer-addresses.js.
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
      reservation_time,
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
    reservation_time = reservation_time || fulfillment.reservation_time || null;
    guest_count = guest_count || fulfillment.guest_count || null;

    if (address && !delivery) {
      delivery = {
        latitude: address.latitude,
        longitude: address.longitude,
        address: address.formatted_address || address.address || 'Alamat Customer'
      };
    }

    // P1 SECURE PAYMENT METHOD VALIDATION: Whitelist only officially supported payment methods
    const allowedPaymentMethods = ['cash', 'midtrans', 'doku'];
    if (!payment_method || !allowedPaymentMethods.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_PAYMENT_PROVIDER',
        error: 'INVALID_PAYMENT_PROVIDER',
        message: `Metode pembayaran "${payment_method}" tidak valid. Pilihan yang didukung: ${allowedPaymentMethods.join(', ')}.`
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
      let reqTableIds = [];
      if (req.body.table_id) {
        reqTableIds.push(req.body.table_id);
      } else if (Array.isArray(req.body.table_ids)) {
        reqTableIds = [...req.body.table_ids];
      }
      if (reqTableIds.length === 0 && table_number) {
        // Resolve table_id from table_number if table_ids array not directly sent
        const tblRow = db.prepare('SELECT id FROM branch_tables WHERE branch_id = ? AND (table_number = ? OR label = ?)').get(branch.id, table_number, table_number);
        if (tblRow) reqTableIds.push(tblRow.id);
      }

      // Single-table enforcement for customer dine-in (Section 6 & Notion locked decision)
      if (reqTableIds.length > 1) {
        return res.status(400).json({
          success: false,
          status: 'SINGLE_TABLE_REQUIRED',
          error: 'Pesanan dine-in customer hanya diperbolehkan untuk 1 meja.'
        });
      }

      if (reqTableIds.length > 0) {
        // Authoritatively check availability
        const custPhone = (customer && customer.phone) || (customerSession && customerSession.phone) || null;
        const availCheck = DiningTableService.validateTablesAvailable(branch.id, reqTableIds, custPhone);
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
      table_id: tableIdsToHold[0] || req.body.table_id || null,
      table_ids: tableIdsToHold,
      dining_session_id: req.body.dining_session_id || req.body.sessionId || null,
      reservation_date,
      reservation_time,
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

    // Reservation is a booking, not a purchase. It must never enter table-hold
    // or online-payment gateway resolution, even if a malicious/stale client
    // sends payment_method=doku/midtrans.
    if (order_type === 'reservation') {
      return res.status(201).json({
        success: true,
        order_id: orderId,
        order_number: orderNumber,
        grand_total: 0,
        subtotal: 0,
        delivery_fee: 0,
        discount_amount: 0,
        cash_tendered: null,
        payment: {
          method: null,
          cash_tendered: null,
          expected_change: null,
          snap_token: null,
          redirect_url: null
        },
        snap_token: null,
        redirect_url: null,
        redirect: '/order-received/' + orderId,
        order: {
          ...order,
          order_type: 'reservation',
          payment_method: null
        }
      });
    }

    // 4a. Dine-in Table Hold for Payment / Acceptance Stage (15-minute hold)
    // Baseline Business Flow:
    // Customer -> QR / Floor Plan -> 1 Table -> Order (Hold Table / Pending) -> Merchant Accept -> Active Dining Session
    // A customer dine-in order does NOT immediately become an active dining session at checkout.
    // Both Cash and Online hold the table pending merchant acceptance or payment.
    // If the customer already has an active session, order is already linked to it.
    if (order_type === 'dine_in' && tableIdsToHold.length > 0 && !order.dining_session_id) {
      const { DiningTableService } = require('../../domains/pos');
      try {
        DiningTableService.holdTablesForPayment({
          branch_id: branch.id,
          table_id: tableIdsToHold[0],
          table_ids: tableIdsToHold,
          customer_phone: customer.phone,
          hold_reference_id: orderId,
          channel: 'customer_app'
        });
      } catch (tblHoldErr) {
        console.warn('[Checkout Dine-In Table Hold Warning]:', tblHoldErr.message);
      }
    }

    // 4. Payment Gateway Resolution (Midtrans Snap, DOKU Checkout, or Cash)
    let snapResult = { snap_token: null, redirect_url: null, merchant_id: payment_method === 'cash' ? 'cash' : (payment_method === 'doku' ? 'doku_default' : 'midtrans_default') };

    if (payment_method === 'midtrans' || payment_method === 'doku') {
      const existingPayment = placementResult.idempotent
        ? db.prepare('SELECT snap_token, merchant_id FROM order_payments WHERE order_id = ?').get(orderId)
        : null;
      if (existingPayment && existingPayment.snap_token) {
        snapResult = {
          snap_token: existingPayment.snap_token,
          redirect_url: null,
          merchant_id: existingPayment.merchant_id || (payment_method === 'doku' ? 'doku_default' : 'midtrans_default')
        };
      } else {
        let reqProto = 'https';
        try { reqProto = req.protocol || 'https'; } catch (_) { reqProto = 'https'; }
        let reqHost = 'localhost';
        try { reqHost = (typeof req.get === 'function' ? req.get('host') : req.headers?.host) || 'localhost'; } catch (_) { reqHost = 'localhost'; }
        const reqOrigin = `${reqProto}://${reqHost}`;
        const xentraOrderReceivedUrl = `${reqOrigin}/order-received/${orderId}`;
        try {
          snapResult = await PaymentService.createSnapTransaction(
            { id: orderId, grand_total: grandTotal, branch_id: branch.id, brand_id: req.brand_id, delivery_fee: deliveryFee, discount_amount: discountAmount, customer_name: customer.name, customer_phone: customer.phone, callback_url: xentraOrderReceivedUrl, payment_method: payment_method },
            order ? order.items : items,
            customer
          );
        } catch (payErr) {
          console.error('[Payment Gateway Error / Timeout]:', payErr.message);
          const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED|ECONNRESET/i.test(payErr.code || payErr.message);
          const isConfigError = /kredensial|belum dikonfigurasi|tidak ada gateway|client_id|secret_key|server_key/i.test(payErr.message);

          db.exec('BEGIN IMMEDIATE;');
          try {
            if (isTimeout) {
              db.prepare("UPDATE order_payments SET payment_status = 'reconciliation_pending', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
              db.prepare("UPDATE orders SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(orderId);
            } else {
              db.prepare("UPDATE order_payments SET payment_status = 'failed', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
              db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(orderId);
            }
            db.exec('COMMIT;');
          } catch (_) {
            try { db.exec('ROLLBACK;'); } catch (_) {}
          }

          if (isConfigError) {
            return res.status(400).json({
              success: false,
              error: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
              message: payErr.message || 'Layanan pembayaran online belum dikonfigurasi atau tidak aktif.'
            });
          }

          if (isTimeout) {
            return res.status(504).json({
              success: false,
              error: 'PAYMENT_GATEWAY_TIMEOUT',
              message: `Koneksi ke gateway pembayaran online mengalami timeout (${payErr.message}). Jika Anda sudah melakukan pembayaran, transaksi akan otomatis direkonsiliasi.`
            });
          }

          return res.status(502).json({
            success: false,
            error: 'PAYMENT_GATEWAY_ERROR',
            message: `Gagal memproses pembayaran melalui gateway (${payErr.message}). Silakan coba beberapa saat lagi atau pilih metode pembayaran lain.`
          });
        }
      }
    }

    if (snapResult.snap_token || snapResult.merchant_id) {
      db.prepare(`
        UPDATE order_payments
        SET snap_token = ?, merchant_id = ?, updated_at = ?
        WHERE order_id = ?
      `).run(snapResult.snap_token || null, snapResult.merchant_id || (payment_method === 'cash' ? 'cash' : payment_method), new Date().toISOString(), orderId);
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

registerCustomerRoutes(router, {
  db,
  RateLimiter,
  TokenSessionStore,
  requireCustomerAuth,
  CustomerIdentityService: require('../../core/identity').CustomerIdentityService,
  CustomerRepository: require('../../core/data/repositories').CustomerRepository,
  DiningTableService: require('../../domains/pos').DiningTableService
});

registerCustomerAddressRoutes(router, { db, crypto, requireCustomerAuth });

// 6.0 Platform Owner Authentication Endpoint
registerPlatformRoutes(router, {
  db,
  RateLimiter,
  TokenSessionStore,
  requirePlatformAuth,
  PlatformBootstrapService: require('../../core/identity').PlatformBootstrapService
});

// 7.1 Customer Order History (Protected by Customer Auth)
registerCustomerOrderRoutes(router, {
  db,
  TokenSessionStore,
  AcceptanceTimeoutService,
  OrderStateMachine,
  requireCustomerAuth,
  D// Operational order lifecycle routes are isolated in server/routes/operational-orders.js.
registerOperationalOrderRoutes(router, {
  db,
  requireAuth,
  OrderStateMachine,
  AcceptanceTimeoutService
});
.status(400).json({ success: false, error: outerErr.message });
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
// 9.1 Staff / POS Cash Settlement Endpoint (Authorized Cashiers, Branch Managers, & Brand Owners)
registerPosRoutes(router, {
  db,
  requireAuth,
  PaymentService,
  CashSettlementService,
  PosShiftService,
  OfflineReconciliationService,
  PosLocalOperationService
});

// Payment-provider webhooks are isolated in server/routes/webhooks.js.
registerPaymentWebhooks(router, { PaymentService });

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
  const brand = req.brand || null;
  const userId = req.user.id || req.user.userId;
  const brandId = req.user.brandId || req.user.brand_id || req.brand_id || null;
  const branchId = req.user.branchId || req.user.branch_id || null;
  const organizationId = req.user.organizationId || req.user.organization_id || null;

  res.json({
    success: true,
    user: {
      id: userId,
      username: req.user.username,
      email: req.user.email,
      full_name: req.user.full_name || req.user.fullName,
      role: req.user.role,
      brand_id: brandId,
      organization_id: organizationId,
      branch_id: branchId,
      email_verified: req.user.email_verified !== undefined ? req.user.email_verified : true,
      brand_name: brand ? brand.name : null
    },
    brand: serializePublicBrand(brand),
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
    res.status(200).json({
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

// Canonical entity media routes are isolated in server/routes/media-entities.js.
registerMediaEntityRoutes(router, { db, requireAuth, mediaService, coreBrandRepo });

// Master catalog CRUD is isolated in server/routes/admin-catalog.js.
registerAdminCatalogRoutes(router, { db, requireAuth });

// Branch CRUD/operations are isolated in server/routes/admin-branches.js.
registerAdminBranchRoutes(router, { db, crypto, requireAuth });

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
registerAdminOrderRoutes(router, { db, requireAuth, AcceptanceTimeoutService });
registerAdminBranchCatalogRoutes(router, {
  db,
  crypto,
  requireAuth,
  CatalogService,
  PricingPolicyModel,
  XentraConnectorClient,
  InventoryStockService
});

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

// Analytics/reporting routes are isolated in server/routes/admin-reporting.js.
const { PaymentRepository: CorePaymentRepo, PromotionRepository: CorePromotionRepo } = require('../../core/data/repositories');
const corePaymentRepo = new CorePaymentRepo();
const corePromotionRepo = new CorePromotionRepo();
registerPaymentConfigRoutes(router, { corePaymentRepo });

// Promotion audit helper and management routes are isolated in server/routes/admin-marketing-promotions.js.
// 1. Finance Overview API
// Finance/reporting route modules share the canonical repositories initialized above.
registerAdminReportingRoutes(router, {
  db,
  requireAuth,
  corePromotionRepo,
  corePaymentRepo
});
registerAdminFinanceRoutes(router, {
  requireAuth,
  ReportingEngine,
  overviewReportingRepo,
  corePaymentRepo
});

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
// Banner content and branch assignment routes are isolated in server/routes/admin-marketing-banners.js.
registerAdminMarketingBannerRoutes(router, {
  db,
  requireAuth,
  bannerContentService,
  bannerAssignmentService,
  bannerMediaDelivery,
  parseLegacyBrandBanners
});

// 6.01 Create Marketing Promotion (Owner / Brand Manager)
registerAdminMarketingPromotionRoutes(router, {
  db,
  crypto,
  requireAuth,
  corePromotionRepo
});

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

// Staff / POS: Reservation operational lifecycle
router.post('/pos/reservations/:id/check-in', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const reservation = db.prepare(
      "SELECT id, brand_id, branch_id, order_type FROM orders WHERE id = ? AND brand_id = ?"
    ).get(req.params.id, req.brand_id);

    if (!reservation) {
      return res.status(404).json({ success: false, error: 'RESERVATION_NOT_FOUND' });
    }
    if (reservation.order_type !== 'reservation') {
      return res.status(400).json({ success: false, error: 'NOT_A_RESERVATION' });
    }

    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (!assignedBranchId || reservation.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya dapat check-in reservasi pada cabang yang ditugaskan.'
        });
      }
    }

    const tableNumber = String((req.body && (req.body.table_number || req.body.tableNumber)) || '').trim();
    if (!tableNumber) {
      return res.status(400).json({ success: false, error: 'TABLE_NUMBER_REQUIRED' });
    }

    const { PosOrderService } = require('../../domains/pos');
    const result = PosOrderService.checkInReservation({
      reservation_order_id: reservation.id,
      table_number: tableNumber
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const status = /FORBIDDEN_BRANCH_SCOPE/.test(err.message) ? 403 : 400;
    return res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/pos/reservations/:id/no-show', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const reservation = db.prepare(
      "SELECT id, brand_id, branch_id, order_type FROM orders WHERE id = ? AND brand_id = ?"
    ).get(req.params.id, req.brand_id);

    if (!reservation) {
      return res.status(404).json({ success: false, error: 'RESERVATION_NOT_FOUND' });
    }
    if (reservation.order_type !== 'reservation') {
      return res.status(400).json({ success: false, error: 'NOT_A_RESERVATION' });
    }

    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (!assignedBranchId || reservation.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya dapat membatalkan no-show reservasi pada cabang yang ditugaskan.'
        });
      }
    }

    const reason = String((req.body && (req.body.reason || req.body.note)) || '').trim();
    const { PosOrderService } = require('../../domains/pos');
    const result = PosOrderService.cancelNoShowReservation({
      reservation_order_id: reservation.id,
      actor_id: req.user.id || req.user.username || 'branch_manager',
      reason: reason || 'No-Show: Melewati batas toleransi kedatangan'
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const status = /FORBIDDEN_BRANCH_SCOPE/.test(err.message) ? 403 : 400;
    return res.status(status).json({ success: false, error: err.message });
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
      new_table_ids: table_ids,
      actor: req.user
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

// Admin settings routes are isolated in server/routes/settings.js.
registerSettingsRoutes(router, {
  db,
  requireAuth,
  coreBrandRepo,
  coreBranchRepo,
  coreUserRepo,
  corePaymentRepo
});

// JSON 404 for any unmatched API request (all methods) — prevents clients that
// parse with res.json() from ever receiving Express's HTML default body.
router.use((req, res) => {
  res.status(404).json({ success: false, error: 'ENDPOINT_NOT_FOUND', status_code: 404 });
});

module.exports = router;

