const crypto = require('crypto');
const GoogleAuthService = require('../services/GoogleAuthService');

module.exports = function registerMerchantAuthRoutes(router, deps) {
  const {
    db,
    RateLimiter,
    TokenSessionStore,
    requireAuth,
    serializePublicBrand
  } = deps;

  // Merchant authentication boundary.
  //
  // This module intentionally owns the full merchant auth HTTP surface as one
  // coherent boundary: registration, email verification, password login,
  // Google/workforce auth, cross-domain handoff, and Google account linking.
  // The underlying identity/session/security infrastructure remains injected
  // from api.js so this refactor does not create a second auth system.
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
  
      const { token, expiresAt } = TokenSessionStore.createSession(sessionUser, result.brand.id);
  
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
        // Cashier owns the transaction-execution surface; management stays in Merchant App.
        return '/pos/';
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
  
  // 10.1.1 POS PIN credential endpoints.
  // POS PIN belongs to the canonical Cashier identity but is never a general login credential.
  router.get('/auth/pos-pin', requireAuth(['cashier']), (req, res) => {
    try {
      const { PosPinCredentialService } = require('../../core/identity');
      const service = new PosPinCredentialService();
      const userId = req.user.id || req.user.userId;
      res.json({ success: true, ...service.getCredentialForUser(userId, req.brand_id) });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, code: err.code || 'POS_PIN_ERROR', error: err.message || 'Gagal memuat POS PIN.' });
    }
  });

  router.put('/auth/pos-pin', requireAuth(['cashier']), (req, res) => {
    try {
      const { PosPinCredentialService, WorkforceService } = require('../../core/identity');
      const service = new PosPinCredentialService();
      const userId = req.user.id || req.user.userId;
      const result = service.setPinForSelf({ userId, brandId: req.brand_id, pin: req.body && req.body.pin });

      const workforce = new WorkforceService();
      workforce.logSecurityEvent({
        actor_id: userId,
        actor_role: 'cashier',
        action: 'POS_PIN_SET',
        target_user_id: userId,
        target_role: 'cashier',
        brand_id: req.brand_id,
        branch_id: req.user.branch_id || req.user.branchId,
        result: 'success'
      });

      res.json({ success: true, message: 'PIN POS berhasil disimpan.', ...result });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, code: err.code || 'POS_PIN_ERROR', error: err.message || 'Gagal menyimpan POS PIN.' });
    }
  });

  router.post('/auth/pos/pin', (req, res) => {
    try {
      const { PosPinCredentialService, WorkforceService } = require('../../core/identity');
      const service = new PosPinCredentialService();
      const body = req.body || {};
      const branchId = body.branch_id;
      const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const rateLimitKey = 'pos-pin-login:' + (req.brand_id || 'unknown') + ':' + (branchId || 'unknown') + ':' + clientIp;
      const rateCheck = RateLimiter.check(rateLimitKey, 10, 300);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          success: false,
          code: 'TOO_MANY_REQUESTS',
          error: 'Terlalu banyak percobaan PIN. Coba lagi dalam ' + rateCheck.retryAfter + ' detik.'
        });
      }

      const authResult = service.authenticateWithPin({
        brandId: req.brand_id,
        branchId,
        terminalId: body.terminal_id,
        pin: body.pin
      });

      const user = authResult.user;
      const { token, expiresAt } = TokenSessionStore.createSession(user, req.brand_id);
      RateLimiter.reset(rateLimitKey);

      const workforce = new WorkforceService();
      workforce.logSecurityEvent({
        actor_id: user.id,
        actor_role: 'cashier',
        action: 'POS_PIN_LOGIN_SUCCESS',
        target_user_id: user.id,
        target_role: 'cashier',
        brand_id: req.brand_id,
        branch_id: user.branch_id,
        result: 'success'
      });

      res.json({
        success: true,
        token,
        expires_at: new Date(expiresAt).toISOString(),
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role: 'cashier',
          branch_id: user.branch_id,
          email_verified: user.email_verified
        },
        offline_credential: authResult.offline_credential,
        landing: '/pos/',
        entitlements: { kds: false }
      });
    } catch (err) {
      const status = err.status || 500;
      if (status === 401 || status === 423) {
        try {
          const { WorkforceService } = require('../../core/identity');
          const workforce = new WorkforceService();
          workforce.logSecurityEvent({
            action: 'POS_PIN_LOGIN_FAILED',
            brand_id: req.brand_id,
            branch_id: req.body && req.body.branch_id,
            result: 'failure',
            metadata: { reason: err.code || 'INVALID_POS_PIN' }
          });
        } catch (_) {}
      }
      res.status(status).json({
        success: false,
        code: err.code || 'POS_PIN_LOGIN_ERROR',
        error: err.message || 'PIN Kasir tidak valid.'
      });
    }
  });

  // 10.2 Google Authentication & Account Linking Endpoints
  const GoogleAuthService = require('../services/GoogleAuthService');
  const { AuthProviderService, WorkforceInvitationService, WorkforceService } = require('../../core/identity');
  
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
        identity = authProviderService.findIdentity(
          'google',
          verifiedClaims.sub,
          acceptResult.brand_id || req.brand_id || null
        );
        if (!identity && acceptResult.user) {
          identity = {
            userId: acceptResult.user_id,
            user: acceptResult.user
          };
        }
      } else {
        identity = authProviderService.findIdentity('google', verifiedClaims.sub, req.brand_id || null);
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
};
