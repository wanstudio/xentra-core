'use strict';

/**
 * Resend Email Adapter for Xentra Core.
 *
 * Implements production email transport using the official Resend SDK.
 * Encapsulates all Resend-specific API interactions and normalizes results and errors.
 * Secrets (RESEND_API_KEY) are server-only and NEVER leaked in return values,
 * error messages, or logs.
 */
class ResendEmailAdapter {
  /**
   * @param {Object} options
   * @param {string} [options.apiKey] - Resend API key (defaults to process.env.RESEND_API_KEY)
   * @param {string} [options.from] - Default sender address (defaults to process.env.EMAIL_FROM)
   * @param {Object} [options.client] - Injected Resend client instance (primarily for testing/mocking)
   */
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.RESEND_API_KEY || '';
    this.from = options.from || process.env.EMAIL_FROM || '';

    // Validate required configuration
    if (!this.apiKey) {
      throw new Error('[ResendEmailAdapter] Configuration error: Missing RESEND_API_KEY.');
    }
    if (!this.from) {
      throw new Error('[ResendEmailAdapter] Configuration error: Missing EMAIL_FROM.');
    }

    if (options.client) {
      this.client = options.client;
    } else {
      const { Resend } = require('resend');
      this.client = new Resend(this.apiKey);
    }
  }

  /**
   * Normalizes error safely without leaking secrets or auth headers.
   * @param {Error|Object} err
   * @returns {Error}
   */
  _normalizeError(err) {
    let message = 'Unknown email delivery failure';
    let code = 'PROVIDER_ERROR';

    if (err) {
      if (typeof err.message === 'string') {
        message = err.message;
      } else if (typeof err.name === 'string') {
        message = err.name;
      }
      if (err.name) {
        code = String(err.name).toUpperCase();
      }
    }

    // Safety scrub: ensure raw API keys or auth headers are NEVER in error message
    if (this.apiKey && message.includes(this.apiKey)) {
      message = message.split(this.apiKey).join('[REDACTED_API_KEY]');
    }
    message = message.replace(/re_[a-zA-Z0-9_-]+/g, '[REDACTED_API_KEY]');
    message = message.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');

    const normalized = new Error(`[Resend] Delivery failed: ${message}`);
    normalized.code = code;
    normalized.provider = 'resend';
    return normalized;
  }

  /**
   * Builds the transactional HTML & text body for email verification.
   * @param {Object} params
   * @param {string} params.verificationUrl
   * @param {string} [params.expiresAt]
   * @returns {{ html: string, text: string }}
   */
  _buildVerificationContent({ verificationUrl, expiresAt }) {
    const safeUrl = String(verificationUrl || '');
    const expiryNote = expiresAt ? `<p style="color:#64748b;font-size:13px;margin-top:16px;">Tautan ini berlaku hingga ${new Date(expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.</p>` : '';

    const html = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Verifikasi Alamat Email Anda</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 32px 16px; color: #1e293b;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; padding: 32px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #0f172a; margin: 0 0 8px 0; font-size: 22px; font-weight: 700;">Verifikasi Alamat Email</h2>
      <p style="color: #64748b; margin: 0; font-size: 14px;">Selamat datang di Xentra Cloud</p>
    </div>
    <div style="line-height: 1.6; font-size: 14px; color: #334155;">
      <p>Halo,</p>
      <p>Terima kasih telah mendaftar di Xentra Cloud. Klik tombol di bawah ini untuk memverifikasi alamat email Anda dan mengaktifkan akun merchant Anda:</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${safeUrl}" style="background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 14px;">Verifikasi Email Sekarang</a>
      </div>
      <p style="font-size: 12px; color: #94a3b8; word-break: break-all;">Jika tombol di atas tidak berfungsi, salin dan buka tautan berikut di browser Anda:<br><a href="${safeUrl}" style="color: #0284c7;">${safeUrl}</a></p>
      ${expiryNote}
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
      <p style="font-size: 12px; color: #94a3b8; margin: 0;">Jika Anda tidak membuat akun di Xentra Cloud, abaikan email ini.</p>
    </div>
  </div>
</body>
</html>
`.trim();

    const text = `Halo,

Terima kasih telah mendaftar di Xentra Cloud.
Silakan buka tautan berikut untuk memverifikasi alamat email Anda:
${safeUrl}

Jika Anda tidak membuat akun di Xentra Cloud, abaikan email ini.`;

    return { html, text };
  }

  /**
   * Sends an email via Resend API.
   *
   * @param {Object} params
   * @param {string} params.to - Recipient email
   * @param {string} params.subject - Email subject
   * @param {string} [params.html] - HTML body
   * @param {string} [params.text] - Plain text body
   * @param {string} [params.from] - Sender override
   * @param {string} [params.type] - Message type (e.g. EMAIL_VERIFICATION, TEAM_INVITATION)
   * @returns {Promise<{ success: boolean, messageId: string, provider: string }>}
   */
  async sendEmail({ to, subject, html, text, from, type }) {
    if (!to) {
      throw new Error('[ResendEmailAdapter] Recipient "to" is required.');
    }
    if (!subject) {
      throw new Error('[ResendEmailAdapter] "subject" is required.');
    }
    if (!html && !text) {
      throw new Error('[ResendEmailAdapter] "html" or "text" content is required.');
    }

    const payload = {
      from: from || this.from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html || undefined,
      text: text || undefined
    };

    let response;
    try {
      response = await this.client.emails.send(payload);
    } catch (sdkError) {
      throw this._normalizeError(sdkError);
    }

    // Resend SDK returns { data: { id }, error }
    if (response && response.error) {
      throw this._normalizeError(response.error);
    }

    const data = response && response.data ? response.data : response;
    const providerMessageId = (data && data.id) ? data.id : ('resend_' + Date.now());

    return {
      success: true,
      messageId: providerMessageId,
      providerMessageId,
      provider: 'resend',
      type: type || 'TRANSACTIONAL'
    };
  }

  /**
   * Builds the transactional HTML & text body for workforce team invitation.
   * @param {Object} params
   * @param {string} params.invitationUrl
   * @param {string} [params.role]
   * @param {string} [params.brandName]
   * @param {string} [params.branchName]
   * @param {string} [params.expiresAt]
   * @returns {{ html: string, text: string }}
   */
  _buildInvitationContent({ invitationUrl, role, brandName, branchName, expiresAt }) {
    const safeUrl = String(invitationUrl || '');
    const safeBrand = brandName ? String(brandName) : 'tim';
    const safeBranch = branchName ? `cabang ${branchName}` : '';
    const safeRole = role ? String(role).replace('_', ' ') : 'anggota tim';
    const contextStr = safeBranch ? `${safeRole} untuk ${safeBrand} (${safeBranch})` : `${safeRole} untuk ${safeBrand}`;
    const expiryNote = expiresAt ? `<p style="color:#64748b;font-size:13px;margin-top:16px;">Undangan ini berlaku hingga ${new Date(expiresAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB (7 hari).</p>` : '';

    const html = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Undangan Bergabung ke Tim Xentra Cloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 32px 16px; color: #1e293b;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; padding: 32px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #0f172a; margin: 0 0 8px 0; font-size: 22px; font-weight: 700;">Undangan Bergabung</h2>
      <p style="color: #64748b; margin: 0; font-size: 14px;">Xentra Cloud Workspace</p>
    </div>
    <div style="line-height: 1.6; font-size: 14px; color: #334155;">
      <p>Halo,</p>
      <p>Anda telah diundang untuk bergabung sebagai <strong>${contextStr}</strong> di Xentra Cloud.</p>
      <p>Klik tombol di bawah ini untuk melihat detail dan menerima undangan Anda:</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${safeUrl}" style="background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 14px;">Terima Undangan</a>
      </div>
      <p style="font-size: 12px; color: #94a3b8; word-break: break-all;">Jika tombol di atas tidak berfungsi, salin dan buka tautan berikut di browser Anda:<br><a href="${safeUrl}" style="color: #0284c7;">${safeUrl}</a></p>
      ${expiryNote}
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
      <p style="font-size: 12px; color: #94a3b8; margin: 0;">Jika Anda merasa tidak mengenali undangan ini, Anda dapat mengabaikan email ini dengan aman.</p>
    </div>
  </div>
</body>
</html>
`.trim();

    const text = `Halo,

Anda telah diundang untuk bergabung sebagai ${contextStr} di Xentra Cloud.
Silakan buka tautan berikut untuk menerima undangan Anda:
${safeUrl}

Undangan ini memiliki batas waktu kadaluarsa.
Jika Anda tidak mengenali undangan ini, abaikan email ini.`;

    return { html, text };
  }

  /**
   * Dispatches verification email via Resend.
   *
   * @param {Object} params
   * @param {string} params.to
   * @param {string} params.verificationUrl
   * @param {string} [params.expiresAt]
   * @returns {Promise<{ success: boolean, messageId: string, provider: string }>}
   */
  async sendVerificationEmail({ to, verificationUrl, expiresAt }) {
    const subject = 'Verifikasi Alamat Email Anda - Xentra Cloud';
    const { html, text } = this._buildVerificationContent({ verificationUrl, expiresAt });

    return this.sendEmail({
      to,
      subject,
      html,
      text,
      type: 'EMAIL_VERIFICATION'
    });
  }

  /**
   * Dispatches workforce team invitation email via Resend.
   *
   * @param {Object} params
   * @param {string} params.to
   * @param {string} params.invitationUrl
   * @param {string} [params.role]
   * @param {string} [params.brandName]
   * @param {string} [params.branchName]
   * @param {string} [params.expiresAt]
   * @returns {Promise<{ success: boolean, messageId: string, provider: string }>}
   */
  async sendTeamInvitation({ to, invitationUrl, role, brandName, branchName, expiresAt }) {
    const subject = brandName 
      ? `Undangan Bergabung ke Tim ${brandName} - Xentra Cloud`
      : 'Undangan Bergabung ke Tim - Xentra Cloud';
    const { html, text } = this._buildInvitationContent({ invitationUrl, role, brandName, branchName, expiresAt });

    return this.sendEmail({
      to,
      subject,
      html,
      text,
      type: 'TEAM_INVITATION'
    });
  }
}

module.exports = ResendEmailAdapter;
