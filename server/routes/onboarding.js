/**
 * XENTRA CORE — ONBOARDING ROUTES
 *
 * Business creation, domain validation and tenant ownership claim.
 * Authentication/session primitives remain owned by the API auth boundary.
 */
'use strict';

const { GoogleAuthService, AuthProviderService, RegistrationService, OwnershipClaimService, TenantOwnershipTransferService, HandoffService, WorkforceService } = require('../../core/identity');

module.exports = function registerOnboardingRoutes(router, deps) {
  const { db, crypto, TokenSessionStore, requireAuth } = deps;

// POST /onboarding/create-business: Create new business for authenticated user
router.post(['/onboarding/create-business', '/api/v1/onboarding/create-business'], requireAuth(), async (req, res) => {
  try {
    const { business_name, brand_name, branch_name, phone, address_text } = req.body;
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
};
