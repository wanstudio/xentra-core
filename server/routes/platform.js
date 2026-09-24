/**
 * XENTRA CORE — PLATFORM OWNER ROUTES
 *
 * Control-plane authentication and profile endpoints. Platform scope remains
 * isolated from tenant merchant operations.
 */
module.exports = function registerPlatformRoutes(router, deps) {
  const {
    db,
    RateLimiter,
    TokenSessionStore,
    requirePlatformAuth,
    PlatformBootstrapService
  } = deps;

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

};
