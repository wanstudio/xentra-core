'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../../server/database/db');

const BCRYPT_ROUNDS = 12;

function generateSlug(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'business';
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  // RFC 5322 compliant regex subset
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email.trim());
}

class RegistrationService {
  constructor(database = db) {
    this.db = database;
  }

  hashPassword(password) {
    return bcrypt.hashSync(password, BCRYPT_ROUNDS);
  }

  /**
   * Atomically registers a new business:
   * 1. Validates payload (email, password, business name, etc.)
   * 2. Checks email uniqueness
   * 3. Creates Organization
   * 4. Creates initial Brand
   * 5. Creates initial Branch + Delivery Settings
   * 6. Creates initial User with role = 'owner'
   * 7. Commits or rolls back transaction on error
   */
  registerBusiness({
    email,
    password,
    full_name,
    business_name,
    brand_name,
    branch_name,
    phone,
    address_text,
    latitude = -7.250445,
    longitude = 112.768845
  }) {
    // 1. Validation
    if (!email || !isValidEmail(email)) {
      throw { status: 400, code: 'INVALID_EMAIL', message: 'Format email tidak valid.' };
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!password || typeof password !== 'string' || password.length < 8) {
      throw { status: 400, code: 'PASSWORD_TOO_SHORT', message: 'Password minimal harus 8 karakter.' };
    }

    const orgName = (business_name || brand_name || '').trim();
    if (!orgName) {
      throw { status: 400, code: 'BUSINESS_NAME_REQUIRED', message: 'Nama bisnis / brand wajib diisi.' };
    }

    const finalBrandName = (brand_name || orgName).trim();
    const finalBranchName = (branch_name || 'Cabang Utama').trim();
    const finalFullName = (full_name || cleanEmail.split('@')[0]).trim();
    const branchPhone = (phone || '081234567890').trim();
    const branchAddress = (address_text || 'Alamat Belum Diatur').trim();

    // 2. Pre-check email uniqueness
    const existingEmailUser = this.db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(cleanEmail);
    if (existingEmailUser) {
      throw { status: 409, code: 'EMAIL_EXISTS', message: 'Email sudah terdaftar. Silakan login atau gunakan email lain.' };
    }

    // Generate unique IDs
    const randHex = crypto.randomBytes(6).toString('hex');
    const orgId = 'org_' + randHex;
    const brandId = 'brand_' + randHex;
    const branchId = 'branch_' + randHex;
    const bdsId = 'bds_' + randHex;
    const userId = 'usr_' + crypto.randomBytes(12).toString('hex');

    // Generate unique slug
    const baseSlug = generateSlug(orgName);
    const existingOrgSlug = this.db.prepare('SELECT id FROM organizations WHERE slug = ?').get(baseSlug);
    const orgSlug = existingOrgSlug ? `${baseSlug}-${randHex}` : baseSlug;
    const brandSlug = orgSlug;
    const branchSlug = generateSlug(finalBranchName);

    // Generate username from email prefix for legacy compatibility (guaranteed unique)
    let baseUsername = cleanEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (baseUsername.length < 3) baseUsername = 'user';
    let candidateUsername = baseUsername;
    const existingUser = this.db.prepare('SELECT id FROM users WHERE username = ?').get(candidateUsername);
    if (existingUser) {
      candidateUsername = `${baseUsername}_${randHex}`;
    }

    const passwordHash = this.hashPassword(password);
    const now = new Date().toISOString();

    // 3. Atomic Transaction
    this.db.exec('BEGIN;');
    try {
      // 3.1 Organization
      this.db.prepare(`
        INSERT INTO organizations (id, name, slug, plan, created_at, updated_at)
        VALUES (?, ?, ?, 'pro', ?, ?)
      `).run(orgId, orgName, orgSlug, now, now);

      // 3.2 Brand
      this.db.prepare(`
        INSERT INTO brands (id, organization_id, name, slug, primary_color, created_at, updated_at)
        VALUES (?, ?, ?, ?, '#b6ff00', ?, ?)
      `).run(brandId, orgId, finalBrandName, brandSlug, now, now);

      // 3.3 Branch
      this.db.prepare(`
        INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(branchId, brandId, finalBranchName, branchSlug, branchAddress, Number(latitude), Number(longitude), branchPhone, now, now);

      // 3.4 Branch Delivery Settings
      this.db.prepare(`
        INSERT INTO branch_delivery_settings (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount, created_at, updated_at)
        VALUES (?, ?, 1, 1, 10.0, 2.0, 3000.0, 15000.0, ?, ?)
      `).run(bdsId, branchId, now, now);

      // 3.5 User (Owner) - Unverified email state initially
      this.db.prepare(`
        INSERT INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'owner', 'active', ?, NULL, ?, ?)
      `).run(userId, brandId, orgId, branchId, candidateUsername, cleanEmail, passwordHash, finalFullName, now, now, now);

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch (_) {}

      // Detect unique constraint violations (e.g. race condition on email)
      if (err.message && (err.message.includes('UNIQUE constraint failed: users.email') || err.message.includes('idx_users_email_unique'))) {
        throw { status: 409, code: 'EMAIL_EXISTS', message: 'Email sudah terdaftar. Silakan login atau gunakan email lain.' };
      }

      throw err;
    }

    // 4. Trigger Email Verification Token Generation and Dispatch
    const EmailVerificationService = require('./EmailVerificationService');
    const emailVerification = new EmailVerificationService(this.db);
    let verificationTokenResult = null;
    try {
      verificationTokenResult = emailVerification.createAndSendVerificationToken({
        userId,
        email: cleanEmail
      });
    } catch (tokenErr) {
      console.error('[RegistrationService] Failed to dispatch verification email:', tokenErr.message);
    }

    // 5. Return sanitized response (NEVER return password, password_hash, or raw token in prod)
    const response = {
      user: {
        id: userId,
        email: cleanEmail,
        username: candidateUsername,
        full_name: finalFullName,
        role: 'owner',
        status: 'active',
        email_verified: false
      },
      organization: {
        id: orgId,
        name: orgName,
        slug: orgSlug,
        plan: 'pro'
      },
      brand: {
        id: brandId,
        name: finalBrandName,
        slug: brandSlug
      },
      branch: {
        id: branchId,
        name: finalBranchName,
        slug: branchSlug
      }
    };

    return response;
  }

  /**
   * Atomically registers a new business for a verified Google account:
   * 1. Validates business payload (business_name, etc.)
   * 2. Checks Google sub is not already linked to any user
   * 3. Creates Organization
   * 4. Creates initial Brand
   * 5. Creates initial Branch + Delivery Settings
   * 6. Creates initial User with role = 'owner', email_verified_at = now (since Google email is verified)
   * 7. Links Google sub in user_auth_providers atomically
   * 8. Commits or rolls back transaction on error
   */
  registerBusinessWithGoogle({
    googleSub,
    email,
    full_name,
    picture = null,
    business_name,
    brand_name,
    branch_name,
    phone,
    address_text,
    latitude = -7.250445,
    longitude = 112.768845
  }) {
    if (!googleSub || typeof googleSub !== 'string' || !googleSub.trim()) {
      throw { status: 400, code: 'INVALID_GOOGLE_SUB', message: 'Google subject identifier (sub) wajib diisi.' };
    }
    const cleanSub = String(googleSub).trim();

    if (!email || !isValidEmail(email)) {
      throw { status: 400, code: 'INVALID_EMAIL', message: 'Format email tidak valid.' };
    }
    const cleanEmail = email.trim().toLowerCase();

    const orgName = (business_name || brand_name || '').trim();
    if (!orgName) {
      throw { status: 400, code: 'BUSINESS_NAME_REQUIRED', message: 'Nama bisnis / brand wajib diisi.' };
    }

    const finalBrandName = (brand_name || orgName).trim();
    const finalBranchName = (branch_name || 'Cabang Utama').trim();
    const finalFullName = (full_name || cleanEmail.split('@')[0]).trim();
    const branchPhone = (phone || '081234567890').trim();
    const branchAddress = (address_text || 'Alamat Belum Diatur').trim();

    // Pre-check 1: Google sub must not already belong to any Xentra User
    const existingProvider = this.db.prepare(
      "SELECT id, user_id FROM user_auth_providers WHERE provider = 'google' AND provider_user_id = ?"
    ).get(cleanSub);
    if (existingProvider) {
      throw {
        status: 409,
        code: 'PROVIDER_ALREADY_LINKED',
        message: 'Akun Google ini sudah terhubung ke akun pengguna Xentra lain.'
      };
    }

    // Pre-check 2: Email uniqueness in users table (prevent creating conflicting user)
    const existingEmailUser = this.db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(cleanEmail);
    if (existingEmailUser) {
      throw {
        status: 409,
        code: 'EMAIL_EXISTS',
        message: 'Email Google sudah terdaftar di Xentra. Silakan login dengan password atau hubungkan akun.'
      };
    }

    // Generate unique IDs
    const randHex = crypto.randomBytes(6).toString('hex');
    const orgId = 'org_' + randHex;
    const brandId = 'brand_' + randHex;
    const branchId = 'branch_' + randHex;
    const bdsId = 'bds_' + randHex;
    const userId = 'usr_' + crypto.randomBytes(12).toString('hex');
    const providerLinkId = 'uap_' + crypto.randomBytes(16).toString('hex');

    // Generate unique slug
    const baseSlug = generateSlug(orgName);
    const existingOrgSlug = this.db.prepare('SELECT id FROM organizations WHERE slug = ?').get(baseSlug);
    const orgSlug = existingOrgSlug ? `${baseSlug}-${randHex}` : baseSlug;
    const brandSlug = orgSlug;
    const branchSlug = generateSlug(finalBranchName);

    // Generate username from email prefix for legacy compatibility (guaranteed unique)
    let baseUsername = cleanEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (baseUsername.length < 3) baseUsername = 'user';
    let candidateUsername = baseUsername;
    const existingUser = this.db.prepare('SELECT id FROM users WHERE username = ?').get(candidateUsername);
    if (existingUser) {
      candidateUsername = `${baseUsername}_${randHex}`;
    }

    // Unusable random password hash for Google-registered users (cannot be brute-forced via legacy login without password reset)
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = this.hashPassword(randomPassword);
    const now = new Date().toISOString();

    const providerMetadataStr = JSON.stringify({
      name: finalFullName,
      picture: picture || null,
      registered_via: 'google_onboarding'
    });

    // Atomic Transaction
    this.db.exec('BEGIN;');
    try {
      // 1. Organization
      this.db.prepare(`
        INSERT INTO organizations (id, name, slug, plan, created_at, updated_at)
        VALUES (?, ?, ?, 'pro', ?, ?)
      `).run(orgId, orgName, orgSlug, now, now);

      // 2. Brand
      this.db.prepare(`
        INSERT INTO brands (id, organization_id, name, slug, primary_color, created_at, updated_at)
        VALUES (?, ?, ?, ?, '#b6ff00', ?, ?)
      `).run(brandId, orgId, finalBrandName, brandSlug, now, now);

      // 3. Branch
      this.db.prepare(`
        INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(branchId, brandId, finalBranchName, branchSlug, branchAddress, Number(latitude), Number(longitude), branchPhone, now, now);

      // 4. Branch Delivery Settings
      this.db.prepare(`
        INSERT INTO branch_delivery_settings (id, branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount, created_at, updated_at)
        VALUES (?, ?, 1, 1, 10.0, 2.0, 3000.0, 15000.0, ?, ?)
      `).run(bdsId, branchId, now, now);

      // 5. User (Owner) - Immediately email_verified since Google verified the email
      this.db.prepare(`
        INSERT INTO users (id, brand_id, organization_id, branch_id, username, email, password_hash, full_name, role, status, password_changed_at, email_verified_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'owner', 'active', ?, ?, ?, ?)
      `).run(userId, brandId, orgId, branchId, candidateUsername, cleanEmail, passwordHash, finalFullName, now, now, now, now);

      // 6. Link Google Auth Provider atomically
      this.db.prepare(`
        INSERT INTO user_auth_providers (
          id, user_id, provider, provider_user_id, email, metadata, linked_at, created_at, updated_at
        ) VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?)
      `).run(providerLinkId, userId, cleanSub, cleanEmail, providerMetadataStr, now, now, now);

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch (_) {}

      if (err.message && (err.message.includes('UNIQUE constraint failed: users.email') || err.message.includes('idx_users_email_unique'))) {
        throw { status: 409, code: 'EMAIL_EXISTS', message: 'Email sudah terdaftar. Silakan login atau gunakan email lain.' };
      }
      if (err.message && err.message.includes('user_auth_providers')) {
        throw { status: 409, code: 'PROVIDER_ALREADY_LINKED', message: 'Akun Google ini sudah terhubung ke akun pengguna Xentra lain.' };
      }

      throw err;
    }

    return {
      user: {
        id: userId,
        email: cleanEmail,
        username: candidateUsername,
        full_name: finalFullName,
        role: 'owner',
        status: 'active',
        email_verified: true
      },
      organization: {
        id: orgId,
        name: orgName,
        slug: orgSlug,
        plan: 'pro'
      },
      brand: {
        id: brandId,
        name: finalBrandName,
        slug: brandSlug
      },
      branch: {
        id: branchId,
        name: finalBranchName,
        slug: branchSlug
      }
    };
  }
}

module.exports = RegistrationService;
