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
  mediaService
});

// 6.01 Create Marketing Promotion (Owner / Brand Manager)
registerAdminMarketingPromotionRoutes(router, {
  db,
  crypto,
  requireAuth,
  corePromotionRepo
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

