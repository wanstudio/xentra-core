/**
 * XENTRA CORE — CUSTOMER AUTH ROUTES
 *
 * Google customer authentication plus tenant-scoped customer broker handoff.
 * Workforce authentication remains isolated in workforce.js.
 */
'use strict';

const GoogleAuthService = require('../services/GoogleAuthService');
const { CustomerIdentityService } = require('../../core/identity');

module.exports = function registerCustomerAuthRoutes(router, deps) {
  const { db, crypto, RateLimiter, TokenSessionStore } = deps;

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

      if (!verifiedClaims.email_verified) {
        return res.status(400).json({
          success: false,
          code: 'UNVERIFIED_GOOGLE_EMAIL',
          error: 'Email akun Google belum diverifikasi. Harap verifikasi email Google Anda terlebih dahulu.'
        });
      }

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
      const displayName = customerRecord.display_name ||
        verifiedClaims.name ||
        (verifiedClaims.email ? verifiedClaims.email.split('@')[0] : 'Pelanggan');

      const customerSession = TokenSessionStore.createCustomerSession(
        customerRecord.phone || verifiedClaims.email,
        req.brand_id,
        2592000,
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

      console.log(
        `[CUSTOMER_GOOGLE_AUTH] brand=${req.brand_id} customer_id=${customerRecord.id} email=${(customerRecord.email || verifiedClaims.email).replace(/@.*/, '@...')} sub=${verifiedClaims.sub.substring(0, 8)}...`
      );

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
    }
  });

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
        store.set(ticket, {
          customerId,
          brandId,
          organizationId,
          customerEmail,
          customerName,
          expiresAt: Date.now() + ttlSeconds * 1000,
          used: false
        });
        return ticket;
      },
      consume(ticket) {
        if (!ticket || typeof ticket !== 'string') return null;
        const entry = store.get(ticket);
        if (!entry) return null;
        if (entry.used || Date.now() > entry.expiresAt) {
          store.delete(ticket);
          return null;
        }
        entry.used = true;
        store.delete(ticket);
        return entry;
      }
    };
  })();

  router.post('/customer/auth/broker/init', (req, res) => {
    try {
      const brandId = req.brand_id;
      if (!brandId) {
        return res.status(400).json({
          success: false,
          code: 'TENANT_REQUIRED',
          error: 'Tenant brand context diperlukan.'
        });
      }
      const brand = req.brand || db.prepare('SELECT id, custom_domain FROM brands WHERE id = ?').get(brandId);
      if (!brand || !brand.custom_domain) {
        return res.status(400).json({
          success: false,
          code: 'TENANT_DOMAIN_NOT_CONFIGURED',
          error: 'Tenant domain tidak dikonfigurasi.'
        });
      }
      const returnTo = `https://${brand.custom_domain}/`;
      const brokerBase = process.env.XENTRA_CONTROL_PLANE_URL || 'https://xentra.cloud';
      const brokerUrl = `${brokerBase}/auth/broker?mode=customer&return_to=${encodeURIComponent(returnTo)}&brand_id=${encodeURIComponent(brandId)}`;
      return res.json({ success: true, broker_url: brokerUrl, return_to: returnTo });
    } catch (err) {
      console.error('[CUSTOMER_BROKER_INIT]', err);
      return res.status(500).json({
        success: false,
        code: 'BROKER_INIT_ERROR',
        error: 'Gagal menginisialisasi customer broker.'
      });
    }
  });

  router.post('/customer/auth/broker/exchange', async (req, res) => {
    try {
      const { code } = req.body || {};
      if (!code || typeof code !== 'string' || !code.startsWith('xnt_chdf_')) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CUSTOMER_CODE',
          error: 'Customer handoff code tidak valid.'
        });
      }
      const brandId = req.brand_id;
      if (!brandId) {
        return res.status(400).json({
          success: false,
          code: 'TENANT_REQUIRED',
          error: 'Penukaran code harus dilakukan dari domain tenant.'
        });
      }

      const entry = CustomerHandoffStore.consume(code);
      if (!entry) {
        return res.status(401).json({
          success: false,
          code: 'CODE_EXPIRED_OR_USED',
          error: 'Customer handoff code sudah digunakan, kadaluarsa, atau tidak valid.'
        });
      }
      if (entry.brandId !== brandId) {
        return res.status(403).json({
          success: false,
          code: 'TENANT_MISMATCH',
          error: 'Customer handoff code tidak valid untuk tenant ini.'
        });
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
        customer: {
          id: entry.customerId,
          name: entry.customerName,
          email: entry.customerEmail
        }
      });
    } catch (err) {
      console.error('[CUSTOMER_BROKER_EXCHANGE]', err);
      return res.status(500).json({
        success: false,
        code: 'EXCHANGE_ERROR',
        error: 'Gagal menukarkan customer handoff code.'
      });
    }
  });

  router.post('/customer/auth/broker/google', async (req, res) => {
    try {
      const origin = (req.headers.origin || '').toLowerCase();
      const host = (req.headers.host || '').split(':')[0].trim().toLowerCase();
      const isProduction = process.env.NODE_ENV === 'production';
      const allowedOrigins = ['https://xentra.cloud'];
      const isFromBroker = allowedOrigins.some(o => origin.startsWith(o)) ||
        (!isProduction && (host === 'localhost' || host === '127.0.0.1'));

      if (isProduction && !isFromBroker) {
        return res.status(403).json({
          success: false,
          code: 'BROKER_ONLY',
          error: 'Endpoint ini hanya dapat dipanggil oleh Xentra Auth Broker.'
        });
      }

      const { credential, brand_id: brokerBrandId, return_to } = req.body || {};
      if (!credential) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_GOOGLE_CREDENTIAL',
          error: 'Credential Google wajib dikirim.'
        });
      }
      if (!brokerBrandId) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_BRAND_ID',
          error: 'brand_id wajib dikirim oleh broker.'
        });
      }

      const googleAuth = new GoogleAuthService();
      let verifiedClaims;
      try {
        verifiedClaims = await googleAuth.verifyIdToken(credential);
      } catch (verifyErr) {
        const status = verifyErr.status || 401;
        return res.status(status).json({
          success: false,
          code: verifyErr.code || 'INVALID_GOOGLE_TOKEN',
          error: verifyErr.message || 'Token Google tidak valid.'
        });
      }

      if (!verifiedClaims.email_verified) {
        return res.status(400).json({
          success: false,
          code: 'UNVERIFIED_GOOGLE_EMAIL',
          error: 'Email Google belum diverifikasi.'
        });
      }

      const brand = db.prepare('SELECT id, organization_id, custom_domain FROM brands WHERE id = ?').get(brokerBrandId);
      if (!brand) {
        return res.status(400).json({
          success: false,
          code: 'BRAND_NOT_FOUND',
          error: 'Brand tidak ditemukan.'
        });
      }

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
      const displayName = customerRecord.display_name ||
        verifiedClaims.name ||
        (verifiedClaims.email ? verifiedClaims.email.split('@')[0] : 'Pelanggan');

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
      return res.status(status).json({
        success: false,
        code: err.code || 'BROKER_GOOGLE_ERROR',
        error: err.message || 'Autentikasi customer melalui broker gagal.'
      });
    }
  });
};
