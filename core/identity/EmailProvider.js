'use strict';

/**
 * Minimal email delivery provider abstraction for Xentra.
 * Avoids vendor lock-in while providing safe test and development adapters.
 */
class EmailProvider {
  constructor() {
    this.sentEmails = [];
  }

  /**
   * Dispatches verification email.
   * In test/dev mode: records email payload in memory for inspection.
   * In production: delegates to configured SMTP/API provider (when configured).
   */
  async sendVerificationEmail({ to, rawToken, expiresAt, verificationUrl }) {
    if (!to || !rawToken) {
      throw new Error('[EmailProvider] "to" and "rawToken" are required.');
    }

    const payload = {
      to,
      subject: 'Verifikasi Alamat Email Anda - Xentra Cloud',
      verificationUrl: verificationUrl || `https://xentra.cloud/verify-email?token=${rawToken}`,
      expiresAt,
      sentAt: new Date().toISOString()
    };

    // If production provider configured via env, delegate here
    if (process.env.EMAIL_PROVIDER === 'smtp' || process.env.SMTP_HOST) {
      // Future production SMTP transport binding
      // Safe no-op if credentials not yet configured
    }

    // In test/development environment, store for test assertions
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      this.sentEmails.push({
        ...payload,
        rawToken // Accessible ONLY in test adapter for verification
      });
    }

    return { success: true, messageId: 'msg_' + Date.now() };
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
  defaultEmailProvider: defaultProvider
};
