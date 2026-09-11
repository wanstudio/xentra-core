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

    // Test-only visibility for automated assertions
    if (process.env.NODE_ENV === 'test' && verificationTokenResult && verificationTokenResult.rawToken) {
      response._test_verification_token = verificationTokenResult.rawToken;
    }

    return response;
  }
}

module.exports = RegistrationService;
