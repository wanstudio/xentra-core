'use strict';

const crypto = require('crypto');
const CustomerRepository = require('../data/repositories/CustomerRepository');
const db = require('../../server/database/db');

class CustomerIdentityService {
  constructor(customerRepository = new CustomerRepository(), database = db) {
    this.customerRepo = customerRepository;
    this.db = database;
  }

  /**
   * Resolves or registers a customer from Google OAuth/OIDC claims.
   *
   * Invariants:
   * 1. Google `sub` is the immutable provider identity key.
   * 2. Email is NOT the primary identity key. If the Google account email changes,
   *    the customer identity resolved by `sub` remains the SAME internal Customer.
   * 3. Google `sub` is NEVER used directly as the internal customer ID (`cst_` / `cust_`).
   * 4. Customer domain is strictly isolated from workforce domain (`users`, `user_auth_providers`, RBAC).
   * 5. Atomically handles concurrent requests for the same Google `sub` to prevent duplicates.
   *
   * @param {Object} params
   * @param {string} params.brand_id Tenant brand ID (current commerce context)
   * @param {string} [params.organization_id] Tenant organization ID (canonical customer boundary)
   * @param {string} params.sub Google subject identifier (unique immutable provider ID)
   * @param {string} params.email Google verified email
   * @param {string} [params.name] Google account name
   * @param {string} [params.picture] Google profile picture
   * @returns {Object} { customer, authProvider, isNew }
   */
  findOrCreateFromGoogle({ brand_id, organization_id, sub, email, name, picture }) {
    if (!brand_id) {
      const err = new Error('brand_id is required for customer resolution.');
      err.status = 400;
      err.code = 'MISSING_BRAND_ID';
      throw err;
    }
    if (!sub) {
      const err = new Error('Google sub is required for customer resolution.');
      err.status = 400;
      err.code = 'MISSING_GOOGLE_SUB';
      throw err;
    }

    // Verify authoritative organization_id from database
    const brandRow = this.db.prepare('SELECT id, organization_id FROM brands WHERE id = ?').get(brand_id);
    if (!brandRow || !brandRow.organization_id) {
      const err = new Error('Organization not found for brand.');
      err.status = 404;
      err.code = 'ORGANIZATION_NOT_FOUND';
      throw err;
    }

    if (organization_id && String(brandRow.organization_id) !== String(organization_id)) {
      const err = new Error('Brand organization does not match provided organization.');
      err.status = 403;
      err.code = 'BRAND_ORGANIZATION_MISMATCH';
      throw err;
    }

    const resolvedOrgId = brandRow.organization_id;

    const cleanSub = String(sub).trim();
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanName = name ? String(name).trim() : (cleanEmail ? cleanEmail.split('@')[0] : 'Pelanggan');

    // Fast path: Check existing link by provider + sub.
    // Customer identity is tenant-scoped by organization_id (Organization Scope v1).
    // The same Google account resolves to the SAME canonical Customer across brands within
    // the same organization. A Google account from another organization must fail closed.
    const existing = this.customerRepo.findCustomerWithProvider('google', cleanSub);
    if (existing) {
      let existingOrgId = existing.organization_id;
      if (!existingOrgId && existing.brand_id) {
        const b = this.db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(existing.brand_id);
        existingOrgId = b ? b.organization_id : null;
      }

      if (String(existingOrgId) !== String(resolvedOrgId)) {
        const err = new Error('Google account is already registered to another organization.');
        err.status = 403;
        err.code = 'CUSTOMER_IDENTITY_ORGANIZATION_MISMATCH';
        throw err;
      }

      let customerNeedsUpdate = false;
      let providerNeedsUpdate = false;

      // Invariant: If Google email or name changed, update them without changing customer.id
      if (cleanEmail && existing.email !== cleanEmail) {
        customerNeedsUpdate = true;
      }
      if (cleanName && existing.display_name !== cleanName && existing.display_name === existing.email?.split('@')[0]) {
        // Only update display_name if it was a default placeholder
        customerNeedsUpdate = true;
      }
      if (cleanEmail && existing.provider_email !== cleanEmail) {
        providerNeedsUpdate = true;
      }

      if (customerNeedsUpdate) {
        try {
          this.customerRepo.updateCustomerProfile(existing.id, {
            email: cleanEmail,
            displayName: cleanName
          });
        } catch (_) {}
      }

      if (providerNeedsUpdate && existing.auth_provider_id) {
        try {
          this.customerRepo.updateAuthProviderEmail(existing.auth_provider_id, cleanEmail);
        } catch (_) {}
      }

      return {
        customer: {
          id: existing.id,
          organization_id: resolvedOrgId,
          brand_id: existing.brand_id,
          display_name: cleanName || existing.display_name,
          email: cleanEmail || existing.email,
          phone: existing.phone,
          created_at: existing.created_at,
          updated_at: existing.updated_at
        },
        authProvider: {
          id: existing.auth_provider_id,
          provider: 'google',
          provider_user_id: cleanSub,
          email: cleanEmail
        },
        isNew: false
      };
    }

    // Slow path / new user registration:
    // Execute atomic creation under BEGIN IMMEDIATE or transaction to guarantee no duplicate sub
    const customerId = 'cst_' + crypto.randomBytes(12).toString('hex');
    const authProviderId = 'cap_' + crypto.randomBytes(12).toString('hex');
    const now = new Date().toISOString();
    const metadata = JSON.stringify({ picture: picture || null, name: cleanName });

    try {
      this.db.exec('BEGIN IMMEDIATE;');

      // Double-check inside transaction to eliminate race conditions
      const raceCheck = this.customerRepo.findCustomerWithProvider('google', cleanSub);
      if (raceCheck) {
        this.db.exec('COMMIT;');
        let raceOrgId = raceCheck.organization_id;
        if (!raceOrgId && raceCheck.brand_id) {
          const b = this.db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(raceCheck.brand_id);
          raceOrgId = b ? b.organization_id : null;
        }

        if (String(raceOrgId) !== String(resolvedOrgId)) {
          const err = new Error('Google account is already registered to another organization.');
          err.status = 403;
          err.code = 'CUSTOMER_IDENTITY_ORGANIZATION_MISMATCH';
          throw err;
        }

        return {
          customer: {
            id: raceCheck.id,
            organization_id: resolvedOrgId,
            brand_id: raceCheck.brand_id,
            display_name: raceCheck.display_name,
            email: raceCheck.email,
            phone: raceCheck.phone,
            created_at: raceCheck.created_at,
            updated_at: raceCheck.updated_at
          },
          authProvider: {
            id: raceCheck.auth_provider_id,
            provider: 'google',
            provider_user_id: cleanSub,
            email: raceCheck.provider_email
          },
          isNew: false
        };
      }

      // Insert customer record with organization_id and initial brand_id
      this.customerRepo.insertCustomer({
        id: customerId,
        organizationId: resolvedOrgId,
        brandId: brand_id,
        displayName: cleanName,
        email: cleanEmail,
        phone: null,
        createdAt: now,
        updatedAt: now
      });

      // Insert customer auth provider record
      this.customerRepo.insertAuthProvider({
        id: authProviderId,
        customerId,
        provider: 'google',
        providerUserId: cleanSub,
        email: cleanEmail,
        metadata,
        linkedAt: now,
        createdAt: now,
        updatedAt: now
      });

      this.db.exec('COMMIT;');

      return {
        customer: {
          id: customerId,
          organization_id: resolvedOrgId,
          brand_id,
          display_name: cleanName,
          email: cleanEmail,
          phone: null,
          created_at: now,
          updated_at: now
        },
        authProvider: {
          id: authProviderId,
          provider: 'google',
          provider_user_id: cleanSub,
          email: cleanEmail
        },
        isNew: true
      };
    } catch (txErr) {
      try { this.db.exec('ROLLBACK;'); } catch (_) {}
      
      // If constraint error occurred due to concurrent race, re-query existing
      if (txErr.message && (txErr.message.includes('UNIQUE constraint failed') || txErr.message.includes('constraint'))) {
        const fallback = this.customerRepo.findCustomerWithProvider('google', cleanSub);
        if (fallback) {
          let fallbackOrgId = fallback.organization_id;
          if (!fallbackOrgId && fallback.brand_id) {
            const b = this.db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(fallback.brand_id);
            fallbackOrgId = b ? b.organization_id : null;
          }

          if (String(fallbackOrgId) !== String(resolvedOrgId)) {
            const err = new Error('Google account is already registered to another organization.');
            err.status = 403;
            err.code = 'CUSTOMER_IDENTITY_ORGANIZATION_MISMATCH';
            throw err;
          }

          return {
            customer: {
              id: fallback.id,
              organization_id: resolvedOrgId,
              brand_id: fallback.brand_id,
              display_name: fallback.display_name,
              email: fallback.email,
              phone: fallback.phone,
              created_at: fallback.created_at,
              updated_at: fallback.updated_at
            },
            authProvider: {
              id: fallback.auth_provider_id,
              provider: 'google',
              provider_user_id: cleanSub,
              email: fallback.provider_email
            },
            isNew: false
          };
        }
      }

      throw txErr;
    }
  }

  /**
   * Finds customer by ID.
   */
  /**
   * Hapus akun dari sudut pandang CUSTOMER.
   *
   * Yang diputus: identitas Google (sub), alamat tersimpan, seluruh sesi login,
   * dan keterkaitan pesanannya. Yang DIPERTAHANKAN: pesanan itu sendiri beserta
   * nominal/statusnya — catatan transaksi milik resto, bukan milik tamu.
   *
   * Konsekuensi penting: setelah baris identitas dihapus, login lagi dengan Google
   * yang sama TIDAK menyambung ke akun lama — findOrCreateFromGoogle tidak menemukan
   * kaitan apa pun, jadi lahir customer baru dengan id baru (email boleh sama, karena
   * customers.email tidak UNIQUE).
   *
   * Semua langkah dalam satu transaksi: gagal di tengah berarti tidak ada yang berubah.
   */
  deleteCustomerAccount({ customerId, brandId }) {
    if (!customerId || !brandId) throw new Error('[CustomerIdentity] customerId dan brandId wajib diisi.');

    const customer = this.db.prepare('SELECT id, brand_id, phone, email, display_name FROM customers WHERE id = ?').get(customerId);
    if (!customer) throw new Error('[CustomerIdentity] Customer tidak ditemukan.');
    if (customer.brand_id !== brandId) throw new Error('[CustomerIdentity] Customer bukan milik brand ini.');

    const phone = customer.phone || null;
    // Penanda netral: tidak bisa dipakai menghubungi siapa pun, tapi baris tetap sah.
    const marker = 'deleted:' + String(brandId);
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      // putus kaitan orang <-> akun (inilah yang membuat akun lama tak bisa dimasuki)
      this.db.prepare('DELETE FROM customer_auth_providers WHERE customer_id = ?').run(customerId);

      // alamat: FK-nya ON DELETE SET NULL, jadi harus dihapus eksplisit —
      // termasuk yang sudah tak bertuan tapi nomornya sama (tamu lama)
      if (phone) {
        this.db.prepare('DELETE FROM customer_addresses WHERE customer_id = ? OR (customer_id IS NULL AND customer_phone = ?)').run(customerId, phone);
      } else {
        this.db.prepare('DELETE FROM customer_addresses WHERE customer_id = ?').run(customerId);
      }

      // sesi login: keluar dari semua perangkat
      if (phone) {
        this.db.prepare('DELETE FROM customer_sessions WHERE customer_id = ? OR phone = ?').run(customerId, phone);
      } else {
        this.db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customerId);
      }

      // pesanan DIPERTAHANKAN; hanya keterkaitan ke orangnya yang dilepas.
      // Nominal, status, dan tanggal tidak disentuh sama sekali.
      let ordersAnonymized = 0;
      if (phone) {
        // Nama dan nomor tamu SAMA-SAMA PII, dan keduanya tersimpan di pesanan
        // (customer_name NOT NULL). Jadi keduanya dilepas; nominal/status/tanggal
        // tidak disentuh sama sekali.
        const res = this.db.prepare('UPDATE orders SET customer_phone = ?, customer_name = ? WHERE customer_phone = ?')
          .run(marker, 'Tamu', phone);
        ordersAnonymized = res.changes || 0;
      }

      // baris customer: anonymize + tandai terhapus (bukan DELETE)
      this.db.prepare(`
        UPDATE customers
        SET display_name = 'Akun Dihapus', email = NULL, phone = NULL, deleted_at = ?, updated_at = ?
        WHERE id = ? AND brand_id = ?
      `).run(now, now, customerId, brandId);

      this.db.exec('COMMIT;');
      return { success: true, customer_id: customerId, orders_anonymized: ordersAnonymized };
    } catch (err) {
      try { this.db.exec('ROLLBACK;'); } catch (_) {}
      throw err;
    }
  }

  findById(customerId) {
    return this.customerRepo.findById(customerId);
  }
}

module.exports = CustomerIdentityService;
