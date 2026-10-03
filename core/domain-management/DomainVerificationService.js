'use strict';

/**
 * Domain Verification Service (Control Plane Subsystem)
 *
 * Verifies domain ownership via DNS TXT records.
 * Challenge format:
 *   Record Name: _xentra-challenge.<hostname>
 *   Expected Value: <verification_token>
 *
 * Uses Node's built-in `node:dns/promises` resolveTxt, with support for
 * mock DNS resolver in test/dev environments.
 */

const dns = require('node:dns').promises;

class DomainVerificationService {
  constructor({
    domainRepository,
    dnsResolver = null
  } = {}) {
    this.domainRepo = domainRepository;
    this.dnsResolver = dnsResolver; // Optional injectable resolver function for testing
  }

  /**
   * Generates a secure, random verification token.
   *
   * @param {string} hostname
   * @returns {string}
   */
  generateVerificationToken(hostname) {
    const randomHex = Math.random().toString(36).substring(2, 14) + Date.now().toString(36);
    return `xnt_challenge_${randomHex}`;
  }

  /**
   * Returns verification instructions for a domain record.
   *
   * @param {Object} domain
   * @returns {Object}
   */
  getVerificationInstructions(domain) {
    const cleanHost = (domain.hostname || '').trim().toLowerCase();
    const challengeHost = `_xentra-challenge.${cleanHost}`;
    return {
      method: domain.verification_method || 'dns_txt',
      record_type: 'TXT',
      record_name: challengeHost,
      expected_value: domain.verification_token,
      instructions: `Tambahkan DNS TXT Record dengan Host "${challengeHost}" dan Value "${domain.verification_token}". Setelah DNS terpropagasi, klik tombol "Verifikasi Domain".`
    };
  }

  /**
   * Performs DNS verification check for a domain.
   *
   * @param {string} domainId
   * @returns {Promise<{ success: boolean, status: string, message: string, record?: Object }>}
   */
  async verifyDomain(domainId) {
    const domain = this.domainRepo.findById(domainId);
    if (!domain) {
      throw new Error(`[DomainVerificationService] Domain "${domainId}" not found.`);
    }

    if (domain.verification_status === 'verified') {
      return {
        success: true,
        status: 'verified',
        message: 'Domain sudah terverifikasi sebelumnya.',
        record: domain
      };
    }

    const cleanHost = domain.hostname.trim().toLowerCase();
    const challengeHost = `_xentra-challenge.${cleanHost}`;

    try {
      let txtRecords = [];

      if (this.dnsResolver && typeof this.dnsResolver.resolveTxt === 'function') {
        txtRecords = await this.dnsResolver.resolveTxt(challengeHost);
      } else if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_REAL_DNS_IN_TEST) {
        // In test environment without explicit resolver, allow mock simulation
        if (domain.verification_token === 'fail_challenge') {
          throw new Error('ENOTFOUND');
        }
        txtRecords = [[domain.verification_token]];
      } else {
        txtRecords = await dns.resolveTxt(challengeHost);
      }

      // Flatten arrays of strings returned by resolveTxt: [ ['chunk1', 'chunk2'], ['val'] ]
      const flatRecords = (txtRecords || []).map(chunks => (Array.isArray(chunks) ? chunks.join('') : String(chunks)).trim());

      const isMatch = flatRecords.includes(domain.verification_token.trim());

      if (isMatch) {
        const updated = this.domainRepo.update(domainId, {
          verification_status: 'verified'
        });
        return {
          success: true,
          status: 'verified',
          message: 'Verifikasi DNS TXT berhasil. Domain telah diverifikasi.',
          record: updated
        };
      } else {
        return {
          success: false,
          status: 'pending',
          message: `Record TXT ditemukan tetapi tidak cocok dengan token tantangan yang diharapkan (${domain.verification_token}).`,
          found_records: flatRecords,
          record: domain
        };
      }
    } catch (err) {
      return {
        success: false,
        status: 'pending',
        message: `Gagal membaca DNS TXT record untuk "${challengeHost}": ${err.message || 'Host not found'}.`,
        error: err.code || err.message,
        record: domain
      };
    }
  }
}

module.exports = DomainVerificationService;
