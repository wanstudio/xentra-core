'use strict';

const ResendEmailAdapter = require('./ResendEmailAdapter');

/**
 * Minimal email delivery provider abstraction for Xentra.
 * Avoids vendor lock-in while providing safe test and development adapters,
 * and production transport delegation (e.g. Resend).
 *
 * Architecture:
 *   Domain / Identity / Workforce
 *               ↓
 *         EmailProvider (Boundary)
 *         ├── In-Memory Adapter (test/dev)
 *         └── Resend Adapter (production / EMAIL_PROVIDER=resend)
 */
class EmailProvider {
  /**
   * @param {Object} [options]
   * @param {string} [options.provider] - 'memory' | 'resend' (defaults based on env)
   * @param {Object} [options.adapter] - Injected concrete adapter instance
   */
  constructor(options = {}) {
    this.sentEmails = [];
    this.options = options;

    if (options.adapter) {
      this.adapter = options.adapter;
      this.activeProviderName = options.provider || 'custom';
    } else {
      this.adapter = null;
      this.activeProviderName = this._determineProviderName(options.provider);
    }
  }

  /**
   * Determines provider name based on options and environment.
   * Priority:
   * 1. Explicit options.provider
   * 2. process.env.EMAIL_PROVIDER ('resend', 'smtp', 'memory', etc.)
   * 3. 'resend' if process.env.NODE_ENV === 'production'
   * 4. 'memory' for test and development
   */
  _determineProviderName(explicitProvider) {
    if (explicitProvider) return explicitProvider.toLowerCase();
    if (process.env.EMAIL_PROVIDER) return process.env.EMAIL_PROVIDER.toLowerCase();
    if (process.env.NODE_ENV === 'production') return 'resend';
    return 'memory';
  }

  /**
   * Lazily resolves or instantiates the concrete transport adapter.
   */
  _getAdapter() {
    if (this.adapter) {
      return this.adapter;
    }

    const providerName = this._determineProviderName(this.options.provider);
    this.activeProviderName = providerName;

    if (providerName === 'resend') {
      this.adapter = new ResendEmailAdapter();
      return this.adapter;
    }

    if (providerName === 'memory' || providerName === 'test') {
      return null; // Uses in-memory sentEmails list
    }

    // Explicitly fail if an unknown or unsupported provider is configured
    throw new Error(`[EmailProvider] Unsupported or unconfigured email provider: "${providerName}".`);
  }

  /**
   * Dispatches verification email.
   * In test/dev mode: records email payload in memory for inspection.
   * In production / resend mode: delegates to concrete transport adapter.
   *
   * @param {Object} params
   * @param {string} params.to
   * @param {string} params.rawToken
   * @param {string} [params.expiresAt]
   * @param {string} [params.verificationUrl]
   * @returns {Promise<{ success: boolean, messageId: string, provider: string }>}
   */
  async sendVerificationEmail({ to, rawToken, expiresAt, verificationUrl }) {
    if (!to || !rawToken) {
      throw new Error('[EmailProvider] "to" and "rawToken" are required.');
    }

    const url = verificationUrl || `https://xentra.cloud/verify-email?token=${rawToken}`;
    const adapter = this._getAdapter();

    if (adapter) {
      // Production transport delegation (e.g. Resend)
      const result = await adapter.sendVerificationEmail({
        to,
        rawToken,
        expiresAt,
        verificationUrl: url
      });

      return {
        success: true,
        messageId: result.messageId || result.providerMessageId,
        providerMessageId: result.providerMessageId || result.messageId,
        provider: result.provider || this.activeProviderName
      };
    }

    // In-Memory / Test / Dev Adapter
    const payload = {
      to,
      subject: 'Verifikasi Alamat Email Anda - Xentra Cloud',
      verificationUrl: url,
      expiresAt,
      sentAt: new Date().toISOString()
    };

    // In test/development environment, store for test assertions
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      this.sentEmails.push({
        ...payload,
        rawToken // Accessible ONLY in test adapter for verification
      });
    }

    const msgId = 'msg_' + Date.now();
    return {
      success: true,
      messageId: msgId,
      providerMessageId: msgId,
      provider: 'memory'
    };
  }

  /**
   * Dispatches workforce team invitation email.
   * In test/dev mode: records email payload in memory for inspection.
   * In production / resend mode: delegates to concrete transport adapter.
   *
   * @param {Object} params
   * @param {string} params.to
   * @param {string} params.rawToken
   * @param {string} [params.role]
   * @param {string} [params.brandName]
   * @param {string} [params.branchName]
   * @param {string} [params.expiresAt]
   * @param {string} [params.invitationUrl]
   * @returns {Promise<{ success: boolean, messageId: string, provider: string, type: string }>}
   */
  async sendTeamInvitation({ to, rawToken, role, brandName, branchName, expiresAt, invitationUrl }) {
    if (!to || !rawToken) {
      throw new Error('[EmailProvider] "to" and "rawToken" are required.');
    }

    const url = invitationUrl || `https://xentra.cloud/invite/${rawToken}`;
    const adapter = this._getAdapter();

    if (adapter) {
      // Production transport delegation (e.g. Resend)
      const result = await adapter.sendTeamInvitation({
        to,
        invitationUrl: url,
        role,
        brandName,
        branchName,
        expiresAt
      });

      return {
        success: true,
        messageId: result.messageId || result.providerMessageId,
        providerMessageId: result.providerMessageId || result.messageId,
        provider: result.provider || this.activeProviderName,
        type: 'TEAM_INVITATION'
      };
    }

    // In-Memory / Test / Dev Adapter
    const payload = {
      to,
      subject: brandName ? `Undangan Bergabung ke Tim ${brandName} - Xentra Cloud` : 'Undangan Bergabung ke Tim - Xentra Cloud',
      invitationUrl: url,
      role,
      brandName,
      branchName,
      expiresAt,
      type: 'TEAM_INVITATION',
      sentAt: new Date().toISOString()
    };

    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      this.sentEmails.push({
        ...payload,
        rawToken // Accessible ONLY in test adapter for verification
      });
    }

    const msgId = 'msg_' + Date.now();
    return {
      success: true,
      messageId: msgId,
      providerMessageId: msgId,
      provider: 'memory',
      type: 'TEAM_INVITATION'
    };
  }

  /**
   * Generic sendEmail method supporting future transactional message types:
   * EMAIL_VERIFICATION, PASSWORD_RESET, TEAM_INVITATION, SECURITY_NOTIFICATION.
   *
   * @param {Object} params
   * @param {string} params.to
   * @param {string} params.subject
   * @param {string} [params.html]
   * @param {string} [params.text]
   * @param {string} [params.from]
   * @param {string} [params.type]
   * @returns {Promise<{ success: boolean, messageId: string, provider: string }>}
   */
  async sendEmail(params) {
    const { to, subject } = params;
    if (!to || !subject) {
      throw new Error('[EmailProvider] "to" and "subject" are required.');
    }

    const adapter = this._getAdapter();
    if (adapter) {
      return adapter.sendEmail(params);
    }

    // In-memory record
    const record = {
      ...params,
      sentAt: new Date().toISOString()
    };
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      this.sentEmails.push(record);
    }

    const msgId = 'msg_' + Date.now();
    return {
      success: true,
      messageId: msgId,
      providerMessageId: msgId,
      provider: 'memory',
      type: params.type || 'TRANSACTIONAL'
    };
  }

  getSentEmails() {
    return this.sentEmails;
  }

  getLastSentEmail(to) {
    if (to) {
      const filtered = this.sentEmails.filter(e => e.to.toLowerCase() === to.toLowerCase());
      return filtered[filtered.length - 1] || null;
    }
    return this.sentEmails[this.sentEmails.length - 1] || null;
  }

  clear() {
    this.sentEmails = [];
  }
}

// Singleton provider instance for application runtime
const defaultProvider = new EmailProvider();

module.exports = {
  EmailProvider,
  defaultEmailProvider: defaultProvider,
  ResendEmailAdapter
};
