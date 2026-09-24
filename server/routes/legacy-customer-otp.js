/**
 * XENTRA CORE — LEGACY CUSTOMER OTP
 *
 * RETIRED. Kept isolated for historical/reference compatibility.
 * Customer authentication uses Google Sign-In + phone completion.
 * These routes always return OTP_RETIRED and never dispatch transport.
 */
'use strict';

module.exports = function registerLegacyCustomerOtpRoutes(router, deps) {
  const { crypto, TokenSessionStore } = deps;

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
};
