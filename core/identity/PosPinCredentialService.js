'use strict';

/** XENTRA — POS PIN Credential Service */
const crypto = require('crypto');
const WorkforceRepository = require('../data/repositories/WorkforceRepository');

const PIN_LENGTH = 6;
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_DIGEST = 'sha256';
const PBKDF2_KEY_LENGTH = 32;

function normalizePin(pin) { return String(pin == null ? '' : pin).trim(); }
function assertPin(pin) {
  const normalized = normalizePin(pin);
  if (!/^\d{6}$/.test(normalized)) throw { status: 400, code: 'INVALID_POS_PIN', message: 'PIN POS harus terdiri dari tepat 6 digit angka.' };
  return normalized;
}
function derivePinHash(pin, saltBuffer) {
  const normalized = assertPin(pin);
  const salt = saltBuffer || crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(normalized, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), iterations: PBKDF2_ITERATIONS, digest: PBKDF2_DIGEST, key_length: PBKDF2_KEY_LENGTH };
}
function verifyDerivedPin(pin, credential) {
  try {
    const normalized = assertPin(pin);
    if (!credential || !credential.salt || !credential.hash) return false;
    const salt = Buffer.from(credential.salt, 'base64');
    const expected = Buffer.from(credential.hash, 'base64');
    const actual = crypto.pbkdf2Sync(normalized, salt, Number(credential.iterations || PBKDF2_ITERATIONS), Number(credential.key_length || PBKDF2_KEY_LENGTH), credential.digest || PBKDF2_DIGEST);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) { return false; }
}

class PosPinCredentialService {
  constructor(repository = new WorkforceRepository()) { this.repository = repository instanceof WorkforceRepository ? repository : new WorkforceRepository(repository); }
  static validatePin(pin) { return /^\d{6}$/.test(normalizePin(pin)); }
  static createVerifier(pin) { return derivePinHash(pin); }
  static verifyVerifier(pin, credential) { return verifyDerivedPin(pin, credential); }

  _loadCashier(userId, brandId) {
    const user = this.repository.prepare(`
      SELECT id, brand_id, organization_id, branch_id, username, email, full_name, role, status,
             pos_pin_salt, pos_pin_hash, pos_pin_failed_attempts, pos_pin_locked_until
      FROM users WHERE id = ? AND brand_id = ?
    `).get(userId, brandId);
    if (!user) throw { status: 404, code: 'USER_NOT_FOUND', message: 'Akun kasir tidak ditemukan.' };
    if (user.role !== 'cashier') throw { status: 403, code: 'POS_PIN_ROLE_REQUIRED', message: 'POS PIN hanya tersedia untuk akun Kasir.' };
    if (user.status !== 'active') throw { status: 403, code: 'ACCOUNT_DISABLED', message: 'Akun kasir tidak aktif.' };
    if (!user.branch_id) throw { status: 400, code: 'CASHIER_BRANCH_REQUIRED', message: 'Akun kasir belum memiliki cabang.' };
    return user;
  }

  getCredentialForUser(userId, brandId) {
    const user = this._loadCashier(userId, brandId);
    const credential = user.pos_pin_hash && user.pos_pin_salt ? { salt: user.pos_pin_salt, hash: user.pos_pin_hash, iterations: PBKDF2_ITERATIONS, digest: PBKDF2_DIGEST, key_length: PBKDF2_KEY_LENGTH } : null;
    return { configured: Boolean(credential), offline_credential: credential, user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name, role: user.role, branch_id: user.branch_id } };
  }

  setPinForSelf({ userId, brandId, pin }) {
    const user = this._loadCashier(userId, brandId);
    const normalized = assertPin(pin);
    const credential = derivePinHash(normalized);
    const peers = this.repository.prepare(`
      SELECT id, pos_pin_salt, pos_pin_hash FROM users
      WHERE brand_id = ? AND branch_id = ? AND role = 'cashier' AND status = 'active'
        AND pos_pin_hash IS NOT NULL AND pos_pin_salt IS NOT NULL AND id <> ?
    `).all(brandId, user.branch_id, user.id);
    const duplicate = peers.some((peer) => verifyDerivedPin(normalized, { salt: peer.pos_pin_salt, hash: peer.pos_pin_hash, iterations: PBKDF2_ITERATIONS, digest: PBKDF2_DIGEST, key_length: PBKDF2_KEY_LENGTH }));
    if (duplicate) throw { status: 409, code: 'POS_PIN_IN_USE', message: 'PIN tersebut sudah digunakan kasir lain di cabang ini. Pilih PIN lain.' };
    this.repository.prepare(`
      UPDATE users SET pos_pin_salt = ?, pos_pin_hash = ?, pos_pin_failed_attempts = 0,
        pos_pin_locked_until = NULL, pos_pin_updated_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND brand_id = ? AND role = 'cashier'
    `).run(credential.salt, credential.hash, user.id, brandId);
    return { configured: true, offline_credential: credential, user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name, role: user.role, branch_id: user.branch_id } };
  }

  authenticateWithPin({ brandId, branchId, pin }) {
    const normalized = assertPin(pin);
    if (!brandId || !branchId) throw { status: 400, code: 'POS_BRANCH_REQUIRED', message: 'Cabang POS wajib ditentukan.' };
    const branch = this.repository.prepare('SELECT id, brand_id FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
    if (!branch) throw { status: 400, code: 'INVALID_BRANCH', message: 'Cabang POS tidak valid untuk brand ini.' };
    const candidates = this.repository.prepare(`
      SELECT id, brand_id, organization_id, branch_id, username, email, full_name, role, status,
             pos_pin_salt, pos_pin_hash, pos_pin_failed_attempts, pos_pin_locked_until
      FROM users WHERE brand_id = ? AND branch_id = ? AND role = 'cashier' AND status = 'active'
        AND pos_pin_hash IS NOT NULL AND pos_pin_salt IS NOT NULL
    `).all(brandId, branchId);
    for (const candidate of candidates) {
      const credential = { salt: candidate.pos_pin_salt, hash: candidate.pos_pin_hash, iterations: PBKDF2_ITERATIONS, digest: PBKDF2_DIGEST, key_length: PBKDF2_KEY_LENGTH };
      if (!verifyDerivedPin(normalized, credential)) continue;
      if (candidate.pos_pin_locked_until && new Date(candidate.pos_pin_locked_until) > new Date()) throw { status: 423, code: 'POS_PIN_LOCKED', message: 'PIN kasir terkunci sementara. Silakan gunakan login akun atau tunggu sebelum mencoba lagi.' };
      this.repository.prepare("UPDATE users SET pos_pin_failed_attempts = 0, pos_pin_locked_until = NULL, updated_at = datetime('now') WHERE id = ?").run(candidate.id);
      return { success: true, user: { id: candidate.id, username: candidate.username, email: candidate.email, full_name: candidate.full_name, role: candidate.role, branch_id: candidate.branch_id, organization_id: candidate.organization_id, status: candidate.status, email_verified: true }, offline_credential: credential };
    }
    throw { status: 401, code: 'INVALID_POS_PIN', message: 'PIN Kasir salah.' };
  }
}

PosPinCredentialService.PIN_LENGTH = PIN_LENGTH;
PosPinCredentialService.PBKDF2_ITERATIONS = PBKDF2_ITERATIONS;
PosPinCredentialService.PBKDF2_DIGEST = PBKDF2_DIGEST;
PosPinCredentialService.PBKDF2_KEY_LENGTH = PBKDF2_KEY_LENGTH;

module.exports = PosPinCredentialService;
