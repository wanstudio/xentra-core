'use strict';

/**
 * Xentra Core — Cashier Onboarding Service
 *
 * Implements Cashier Invitation & Mandatory Identity Onboarding Contract v1.
 * Mandatory Onboarding Lifecycle:
 *   INVITED -> ACCEPTED -> PIN_SET -> IDENTITY_COMPLETED -> POS Access Allowed
 *
 * Rules:
 * 1. Cashier name MUST be entered by cashier (never inferred from email/username).
 * 2. NIK must be exactly 16 numeric digits with leading zeros preserved.
 * 3. PIN must be 6 digits, stored securely (PBKDF2 via PosPinCredentialService),
 *    never logged or returned in plaintext.
 * 4. NIK masked on read (e.g. 1871**********12 or ****************).
 * 5. State transitions must be sequential; steps cannot be skipped.
 * 6. POS access strictly gated until status is IDENTITY_COMPLETED.
 */

const crypto = require('crypto');
const WorkforceRepository = require('../data/repositories/WorkforceRepository');
const PosPinCredentialService = require('./PosPinCredentialService');

const ONBOARDING_STATUS = {
  INVITED: 'INVITED',
  ACCEPTED: 'ACCEPTED',
  PIN_SET: 'PIN_SET',
  IDENTITY_COMPLETED: 'IDENTITY_COMPLETED'
};

class CashierOnboardingService {
  constructor(repository = new WorkforceRepository(), pinService = null) {
    this.repository = repository instanceof WorkforceRepository ? repository : new WorkforceRepository(repository);
    this.pinService = pinService || new PosPinCredentialService(this.repository);
  }

  static get STATUS() {
    return ONBOARDING_STATUS;
  }

  /**
   * Helper to mask NIK for privacy: e.g. "1871543210987612" -> "1871**********12"
   */
  static maskNik(nik) {
    if (!nik || typeof nik !== 'string') return null;
    const clean = nik.trim();
    if (clean.length < 6) return '*'.repeat(clean.length);
    return clean.slice(0, 4) + '*'.repeat(clean.length - 6) + clean.slice(-2);
  }

  /**
   * Validates full name input: non-empty, trimmed, min 2 chars.
   */
  static validateName(name) {
    if (typeof name !== 'string') return false;
    const clean = name.trim();
    return clean.length >= 2 && clean.length <= 100;
  }

  /**
   * Validates NIK: exactly 16 numeric digits.
   */
  static validateNik(nik) {
    if (typeof nik !== 'string') return false;
    const clean = nik.trim();
    return /^\d{16}$/.test(clean);
  }

  /**
   * Loads cashier user record and enforces cashier role and active status.
   */
  _loadCashier(userId, brandId) {
    if (!userId) {
      throw { status: 401, code: 'UNAUTHORIZED', message: 'Pengguna tidak terautentikasi.' };
    }

    let user;
    if (brandId) {
      user = this.repository.prepare(`
        SELECT id, brand_id, organization_id, branch_id, username, email, full_name, role, status,
               cashier_onboarding_status, nik, pos_pin_hash, pos_pin_salt
        FROM users WHERE id = ? AND brand_id = ?
      `).get(userId, brandId);
    } else {
      user = this.repository.prepare(`
        SELECT id, brand_id, organization_id, branch_id, username, email, full_name, role, status,
               cashier_onboarding_status, nik, pos_pin_hash, pos_pin_salt
        FROM users WHERE id = ?
      `).get(userId);
    }

    if (!user) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'Akun kasir tidak ditemukan.' };
    }
    if (user.role !== 'cashier') {
      throw { status: 403, code: 'FORBIDDEN_ROLE', message: 'Onboarding identitas kasir hanya berlaku untuk akun kasir.' };
    }
    if (user.status !== 'active') {
      throw { status: 403, code: 'ACCOUNT_DISABLED', message: 'Akun kasir tidak aktif.' };
    }

    return user;
  }

  /**
   * Get onboarding state for a cashier.
   */
  getOnboardingState(userId, brandId) {
    const user = this._loadCashier(userId, brandId);
    const rawStatus = user.cashier_onboarding_status || (user.pos_pin_hash ? ONBOARDING_STATUS.IDENTITY_COMPLETED : ONBOARDING_STATUS.ACCEPTED);
    const hasPin = Boolean(user.pos_pin_hash && user.pos_pin_salt);
    const hasIdentity = Boolean(user.full_name && user.nik && user.nik.length === 16);
    const isCompleted = rawStatus === ONBOARDING_STATUS.IDENTITY_COMPLETED || (hasPin && hasIdentity);

    let branchName = null;
    if (user.branch_id) {
      try {
        const b = this.repository.prepare('SELECT name FROM branches WHERE id = ?').get(user.branch_id);
        if (b) branchName = b.name;
      } catch (_) {}
    }

    return {
      status: isCompleted ? ONBOARDING_STATUS.IDENTITY_COMPLETED : rawStatus,
      step: isCompleted ? 4 : (rawStatus === ONBOARDING_STATUS.PIN_SET ? 3 : 2),
      has_pin: hasPin,
      has_identity: hasIdentity,
      can_access_pos: isCompleted,
      name: user.full_name || null,
      username: user.username || null,
      email: user.email || null,
      nik_masked: CashierOnboardingService.maskNik(user.nik),
      has_nik: Boolean(user.nik && user.nik.length === 16),
      branch_id: user.branch_id,
      branch_name: branchName,
      brand_id: user.brand_id
    };
  }

  /**
   * Step 2: Set Cashier PIN.
   * Cashier must be in ACCEPTED or PIN_SET status.
   */
  setPin({ userId, brandId, pin, pin_confirmation }) {
    const user = this._loadCashier(userId, brandId);

    if (!pin || typeof pin !== 'string' || !/^\d{6}$/.test(pin.trim())) {
      throw { status: 400, code: 'INVALID_PIN_FORMAT', message: 'PIN harus terdiri dari 6 digit angka.' };
    }

    const cleanPin = pin.trim();
    const cleanConfirmation = pin_confirmation ? String(pin_confirmation).trim() : '';

    if (cleanPin !== cleanConfirmation) {
      throw { status: 400, code: 'PIN_CONFIRMATION_MISMATCH', message: 'Konfirmasi PIN tidak cocok dengan PIN yang dimasukkan.' };
    }

    // Call PosPinCredentialService to enforce branch uniqueness and hash creation
    this.pinService.setPinForSelf({
      userId: user.id,
      brandId: user.brand_id,
      pin: cleanPin
    });

    // Update onboarding status to PIN_SET (if not already completed)
    const currentStatus = user.cashier_onboarding_status;
    let nextStatus = ONBOARDING_STATUS.PIN_SET;
    if (currentStatus === ONBOARDING_STATUS.IDENTITY_COMPLETED && user.nik) {
      nextStatus = ONBOARDING_STATUS.IDENTITY_COMPLETED;
    }

    this.repository.prepare(`
      UPDATE users
      SET cashier_onboarding_status = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(nextStatus, user.id);

    // Audit log (SAFE: no plaintext pin)
    this._logSecurityEvent({
      actor_id: user.id,
      actor_role: 'cashier',
      action: 'CASHIER_PIN_SET',
      target_user_id: user.id,
      target_role: 'cashier',
      brand_id: user.brand_id,
      branch_id: user.branch_id,
      result: 'success',
      metadata: {
        status: nextStatus
      }
    });

    return {
      success: true,
      status: nextStatus,
      message: 'PIN kasir berhasil disimpan. Silakan lengkapi data identitas kasir.',
      can_access_pos: nextStatus === ONBOARDING_STATUS.IDENTITY_COMPLETED
    };
  }

  /**
   * Step 3: Set Cashier Identity (Full Name + NIK).
   * Cashier must have already set their PIN (PIN_SET status or has_pin).
   */
  setIdentity({ userId, brandId, name, nik }) {
    const user = this._loadCashier(userId, brandId);

    // Verify prerequisite: PIN must be set first!
    if (!user.pos_pin_hash || !user.pos_pin_salt) {
      throw {
        status: 400,
        code: 'PIN_REQUIRED_FIRST',
        message: 'PIN kasir wajib dibuat terlebih dahulu sebelum mengisi data identitas.'
      };
    }

    // Validate name: mandatory, non-empty, min 2 chars
    if (!name || typeof name !== 'string' || !CashierOnboardingService.validateName(name)) {
      throw {
        status: 400,
        code: 'INVALID_CASHIER_NAME',
        message: 'Nama lengkap kasir wajib diisi minimal 2 karakter dan bukan berupa spasi kosong.'
      };
    }

    const cleanName = name.trim();

    // Check if name was attempted to be derived from email
    if (user.email) {
      const emailPrefix = user.email.split('@')[0].trim().toLowerCase();
      // If someone passed only their email address as name
      if (cleanName.toLowerCase() === user.email.trim().toLowerCase()) {
        throw {
          status: 400,
          code: 'NAME_CANNOT_BE_EMAIL',
          message: 'Nama kasir harus berupa nama lengkap asli Anda, bukan alamat email.'
        };
      }
    }

    // Validate NIK: if provided, must be 16 digits. If user already has 16-digit NIK and nik parameter is omitted, keep existing NIK.
    let cleanNik = null;
    if (nik !== undefined && nik !== null && String(nik).trim() !== '') {
      if (!CashierOnboardingService.validateNik(String(nik))) {
        throw {
          status: 400,
          code: 'INVALID_NIK',
          message: 'Nomor Induk Kependudukan (NIK) wajib terdiri dari tepat 16 digit angka.'
        };
      }
      cleanNik = String(nik).trim();
    } else if (user.nik && user.nik.length === 16) {
      cleanNik = user.nik;
    } else {
      throw {
        status: 400,
        code: 'INVALID_NIK',
        message: 'Nomor Induk Kependudukan (NIK) wajib terdiri dari tepat 16 digit angka.'
      };
    }

    const now = new Date().toISOString();
    this.repository.prepare(`
      UPDATE users
      SET full_name = ?,
          nik = ?,
          cashier_onboarding_status = 'IDENTITY_COMPLETED',
          updated_at = ?
      WHERE id = ?
    `).run(cleanName, cleanNik, now, user.id);

    // Safe audit log: NIK must be masked, never plaintext in logs
    const maskedNik = CashierOnboardingService.maskNik(cleanNik);
    this._logSecurityEvent({
      actor_id: user.id,
      actor_role: 'cashier',
      action: 'CASHIER_IDENTITY_COMPLETED',
      target_user_id: user.id,
      target_role: 'cashier',
      brand_id: user.brand_id,
      branch_id: user.branch_id,
      result: 'success',
      metadata: {
        name: cleanName,
        nik_masked: maskedNik,
        status: ONBOARDING_STATUS.IDENTITY_COMPLETED
      }
    });

    return {
      success: true,
      status: ONBOARDING_STATUS.IDENTITY_COMPLETED,
      can_access_pos: true,
      message: 'Onboarding kasir selesai. Anda sekarang dapat mengakses aplikasi POS.',
      user: {
        id: user.id,
        name: cleanName,
        nik_masked: maskedNik,
        branch_id: user.branch_id,
        brand_id: user.brand_id
      }
    };
  }

  _logSecurityEvent({ actor_id, actor_role, action, target_user_id, target_role, brand_id, organization_id, branch_id, result, metadata }) {
    try {
      const id = 'sal_' + crypto.randomBytes(16).toString('hex');
      const safeMetadata = metadata ? JSON.stringify(metadata) : null;
      this.repository.prepare(`
        INSERT INTO security_audit_log (id, actor_id, actor_role, action, target_user_id, target_role, brand_id, organization_id, branch_id, result, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id,
        actor_id || null,
        actor_role || null,
        action,
        target_user_id || null,
        target_role || null,
        brand_id || null,
        organization_id || null,
        branch_id || null,
        result,
        safeMetadata
      );
    } catch (_) {}
  }
}

module.exports = CashierOnboardingService;
