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
const registerCustomerAuthRoutes = require('./customer-auth');
const registerOnboardingRoutes = require('./onboarding');
const registerLegacyCustomerOtpRoutes = require('./legacy-customer-otp');
const registerCheckoutRoutes = require('./checkout');
const registerCustomerAddressRoutes = require('./customer-addresses');
const registerWorkforceRoutes = require('./workforce');
const registerPlatformRoutes = require('./platform');
const registerAdminCatalogRoutes = require('./admin-catalog');
const registerAdminBrandRoutes = require('./admin-brand');
const registerAdminBranchRoutes = require('./admin-branches');
const registerAdminOrderRoutes = require('./admin-orders');
const registerOperationalOrderRoutes = require('./operational-orders');
const registerAdminBranchCatalogRoutes = require('./admin-branch-catalog');
const registerAdminBranchOperationsRoutes = require('./admin-branch-operations');
const registerDineInRoutes = require('./dine-in');
const registerPaymentWebhooks = require('./webhooks');
const registerSettingsRoutes = require('./settings');
const registerAdminMarketingPromotionRoutes = require('./admin-marketing-promotions');
const registerAdminMarketingOverviewRoutes = require('./admin-marketing-overview');
const registerAdminMarketingBannerRoutes = require('./admin-marketing-banners');
const { createBannerHelpers } = require('./banner-helpers');
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
const registerMerchantAuthRoutes = require('./merchant-auth');
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
const { bannerMediaDelivery, parseLegacyBrandBanners } = createBannerHelpers(mediaService);
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

// Customer Google authentication + broker handoff routes are isolated in server/routes/customer-auth.js.
registerCustomerAuthRoutes(router, {
  db,
  crypto,
  RateLimiter,
  TokenSessionStore
});

// 5. Menu Catalog & Home
// Canonical public catalog menu route is isolated in server/routes/catalog.js.
registerCatalogRoutes(router, { db, CatalogService, batchResolveCustomerMediaDelivery });

// Product/upsell/checkout-session support routes are isolated in server/routes/storefront.js.
registerStorefrontRoutes(router, { db, crypto, batchResolveCustomerMediaDelivery });

// Customer address CRUD is isolated in server/routes/customer-addresses.js.
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

// Retired customer OTP routes remain isolated for reference; they always return OTP_RETIRED.
registerLegacyCustomerOtpRoutes(router, {
  crypto,
  TokenSessionStore
});

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
// Customer checkout verification and order submission routes are isolated in server/routes/checkout.js.
registerCheckoutRoutes(router, {
  db,
  crypto,
  PaymentService,
  BranchMatcher,
  DeliveryCalculator,
  RouteService,
  CatalogService,
  TokenSessionStore,
  OrderStateMachine,
  AcceptanceTimeoutService,
  authorizeCustomerSession,
  requireCustomerAuth
});

// Business onboarding and tenant claim routes are isolated in server/routes/onboarding.js.
registerOnboardingRoutes(router, {
  db,
  crypto,
  TokenSessionStore,
  requireAuth
});

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
  DiningTableService: require('../../domains/pos').DiningTableService
});

// Operational order lifecycle routes are isolated in server/routes/operational-orders.js.
registerOperationalOrderRoutes(router, {
  db,
  requireAuth,
  OrderStateMachine,
  AcceptanceTimeoutService
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
  requireAuth
});

// Payment-provider webhooks are isolated in server/routes/webhooks.js.
registerPaymentWebhooks(router, { PaymentService });

// 10.0 SaaS Control Plane Business Registration Endpoint

// Merchant authentication routes are isolated as one coherent auth boundary.
registerMerchantAuthRoutes(router, {
  db,
  RateLimiter,
  TokenSessionStore,
  requireAuth,
  serializePublicBrand
});

// Workforce routes are isolated in server/routes/workforce.js.
registerWorkforceRoutes(router, { db, requireAuth, TokenSessionStore });

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
// Legacy brand/profile/logo/banner routes are isolated in server/routes/admin-brand.js.
registerAdminBrandRoutes(router, {
  db,
  path,
  fs,
  crypto,
  ImageValidator,
  requireAuth,
  serializePublicBrand,
  coreBrandRepo,
  CoreBrandRepo
});





/* =========================================================================
   ADMIN & OWNER DASHBOARD API ENDPOINTS (Protected by requireAuth)
   ========================================================================= */


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
  corePaymentRepo
});

// Marketing overview routes are isolated in server/routes/admin-marketing-overview.js.
registerAdminMarketingOverviewRoutes(router, { requireAuth, corePromotionRepo });

// 6.00 STOREFRONT BANNERS — Content + Placement/Assignment APIs
// Content is Brand-scoped. Assignment is Branch-scoped. Promotion remains separate.
// ============================================================================
// Banner content and branch assignment routes are isolated in server/routes/admin-marketing-banners.js.
registerAdminMarketingBannerRoutes(router, {
  db,
  requireAuth,
  bannerContentService,
  bannerAssignmentService,
  mediaService
});

// 6.01 Create Marketing Promotion (Owner / Brand Manager)
registerAdminMarketingPromotionRoutes(router, {
  db,
  crypto,
  requireAuth,
  corePromotionRepo,
  mediaService,
  bannerMediaDelivery
});

// Dine-in routes are isolated in server/routes/dine-in.js.
registerDineInRoutes(router, {
  db,
  crypto,
  requireAuth,
  TokenSessionStore,
  DiningTableService: require('../../domains/dining').DiningTableService,
  TableRecommendationService: require('../../domains/dining').TableRecommendationService,
  PosOrderService: require('../../domains/pos').PosOrderService
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

