'use strict';

/**
 * Domain Provisioning Service (Control Plane Subsystem)
 *
 * Manages infrastructure edge routing & TLS provisioning lifecycle
 * (Cloudflare / Edge / Ingress).
 *
 * States:
 *   'unprovisioned' -> 'provisioning' -> 'provisioned' | 'failed'
 *   TLS: 'pending' -> 'active' | 'failed'
 *
 * Designed with adapter pattern: uses Cloudflare/Edge API adapter when configured,
 * otherwise deterministic mock/local-safe driver.
 */

class DomainProvisioningService {
  constructor({
    domainRepository,
    edgeAdapter = null
  } = {}) {
    this.domainRepo = domainRepository;
    this.edgeAdapter = edgeAdapter || new MockEdgeAdapter();
  }

  /**
   * Triggers provisioning for a verified domain.
   *
   * @param {string} domainId
   * @returns {Promise<Object>} updated domain record
   */
  async provisionDomain(domainId) {
    const domain = this.domainRepo.findById(domainId);
    if (!domain) {
      throw new Error(`[DomainProvisioningService] Domain "${domainId}" not found.`);
    }

    if (domain.verification_status !== 'verified') {
      throw new Error(`[DomainProvisioningService] Domain "${domain.hostname}" must be verified before provisioning.`);
    }

    // Update state to provisioning
    this.domainRepo.update(domainId, {
      provisioning_status: 'provisioning',
      tls_status: 'pending'
    });

    try {
      const result = await this.edgeAdapter.provision({
        hostname: domain.hostname,
        surface_type: domain.surface_type,
        brand_id: domain.brand_id,
        organization_id: domain.organization_id
      });

      const updated = this.domainRepo.update(domainId, {
        provisioning_status: result.provisioning_status || 'provisioned',
        tls_status: result.tls_status || 'active',
        status: 'active'
      });

      return {
        success: true,
        record: updated,
        message: 'Domain edge routing and TLS certificates successfully provisioned.'
      };
    } catch (err) {
      const updated = this.domainRepo.update(domainId, {
        provisioning_status: 'failed',
        tls_status: 'failed'
      });

      return {
        success: false,
        error: err.message,
        record: updated,
        message: `Edge provisioning failed: ${err.message}`
      };
    }
  }

  /**
   * Deprovisions edge routing and releases SSL for a domain.
   *
   * @param {string} domainId
   * @returns {Promise<Object>}
   */
  async deprovisionDomain(domainId) {
    const domain = this.domainRepo.findById(domainId);
    if (!domain) {
      throw new Error(`[DomainProvisioningService] Domain "${domainId}" not found.`);
    }

    try {
      await this.edgeAdapter.deprovision({
        hostname: domain.hostname
      });
    } catch (_) {}

    const updated = this.domainRepo.update(domainId, {
      provisioning_status: 'unprovisioned',
      tls_status: 'pending'
    });

    return {
      success: true,
      record: updated,
      message: 'Domain deprovisioned successfully.'
    };
  }
}

/**
 * Deterministic Edge Adapter (Default / Mock driver)
 */
class MockEdgeAdapter {
  async provision({ hostname }) {
    if (hostname.includes('error-fail-provision')) {
      throw new Error('Edge gateway connection timed out.');
    }
    return {
      provisioning_status: 'provisioned',
      tls_status: 'active'
    };
  }

  async deprovision({ hostname }) {
    return { success: true };
  }
}

module.exports = {
  DomainProvisioningService,
  MockEdgeAdapter
};
