'use strict';

const crypto = require('crypto');
const axios = require('axios');

/**
 * GoogleAuthService
 *
 * Verifies Google ID tokens (OIDC) and extracts verified subject claims.
 *
 * Invariants:
 * - Audience (`aud`) MUST match the configured GOOGLE_CLIENT_ID.
 * - Issuer (`iss`) MUST be 'https://accounts.google.com' or 'accounts.google.com'.
 * - Token expiry (`exp`) MUST be strictly validated against current system time.
 * - Verification mechanism uses Google's standard OIDC tokeninfo/cert endpoints.
 * - Google `sub` is the provider identity key; email is NEVER the provider identity key.
 * - Passwords are NEVER stored or requested from Google.
 * - Secrets and client ID must come from environment/configuration, never hardcoded.
 */
class GoogleAuthService {
  /**
   * @param {Object} [config]
   * @param {string} [config.clientId] Google Client ID (defaults to process.env.GOOGLE_CLIENT_ID)
   * @param {string} [config.tokenInfoUrl] Optional override for testing/mocking
   * @param {Function} [config.httpClient] Optional HTTP client override for testing
   */
  constructor(config = {}) {
    this.clientId = config.clientId || process.env.GOOGLE_CLIENT_ID || '';
    
    // SSRF / Endpoint Hardening:
    // In production, tokenInfoUrl MUST be the canonical Google endpoint.
    // Overriding is strictly restricted to non-production/test environments.
    const defaultTokenInfoUrl = 'https://oauth2.googleapis.com/tokeninfo';
    const isProduction = process.env.NODE_ENV === 'production';
    if (config.tokenInfoUrl && config.tokenInfoUrl !== defaultTokenInfoUrl) {
      if (isProduction) {
        throw new Error('Overriding Google tokenInfoUrl is strictly forbidden in production.');
      }
      try {
        const parsed = new URL(config.tokenInfoUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error('Invalid URL protocol');
        }
      } catch (e) {
        throw new Error(`Invalid tokenInfoUrl: ${e.message}`);
      }
      this.tokenInfoUrl = config.tokenInfoUrl;
    } else {
      this.tokenInfoUrl = defaultTokenInfoUrl;
    }

    this.httpClient = config.httpClient || axios;
  }

  /**
   * Validates a Google ID token and returns the verified profile claims.
   *
   * @param {string} idToken Raw Google JWT / ID token
   * @returns {Promise<{
   *   sub: string,
   *   email: string,
   *   email_verified: boolean,
   *   name?: string,
   *   picture?: string,
   *   rawClaims: Object
   * }>}
   */
  async verifyIdToken(idToken) {
    if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
      throw {
        status: 400,
        code: 'MISSING_GOOGLE_CREDENTIAL',
        message: 'Google credential token wajib dikirim.'
      };
    }

    const cleanToken = idToken.trim();

    // Malformed Token Guard:
    // Google OIDC ID tokens are standard compact JWTs with 3 base64url parts (header.payload.signature).
    // Validate structural integrity before making any upstream network request.
    const parts = cleanToken.split('.');
    if (parts.length !== 3 || parts.some(part => !part || part.length === 0)) {
      throw {
        status: 400,
        code: 'MALFORMED_GOOGLE_TOKEN',
        message: 'Format token Google tidak valid (harus 3-part JWT).'
      };
    }

    // Client ID must be configured in environment or passed to constructor
    const expectedAudience = this.clientId || process.env.GOOGLE_CLIENT_ID;
    if (!expectedAudience) {
      throw {
        status: 500,
        code: 'GOOGLE_AUTH_MISCONFIGURED',
        message: 'Google Client ID belum dikonfigurasi di server.'
      };
    }

    let tokenData;
    try {
      const response = await this.httpClient.get(this.tokenInfoUrl, {
        params: { id_token: cleanToken },
        timeout: 5000
      });
      tokenData = response.data;
    } catch (err) {
      // Differentiate upstream service availability from client credential validation
      // 1. Upstream network failure / timeout / DNS / connection dropped (no HTTP response)
      if (!err.response) {
        throw {
          status: 503,
          code: 'GOOGLE_SERVICE_UNAVAILABLE',
          message: 'Layanan autentikasi Google sementara tidak dapat dihubungi.'
        };
      }

      // 2. Google returned an explicit HTTP error response (e.g., 400 invalid_token)
      const errorDetail = err.response?.data?.error_description || err.response?.data?.error || err.message;
      throw {
        status: 401,
        code: 'INVALID_GOOGLE_TOKEN',
        message: `Token Google tidak valid: ${errorDetail}`
      };
    }

    if (!tokenData || typeof tokenData !== 'object') {
      throw {
        status: 401,
        code: 'INVALID_GOOGLE_TOKEN',
        message: 'Gagal memverifikasi token Google.'
      };
    }

    // 1. Audience Check
    // aud can be string or in azp
    const tokenAudience = tokenData.aud;
    if (tokenAudience !== expectedAudience) {
      throw {
        status: 401,
        code: 'INVALID_TOKEN_AUDIENCE',
        message: 'Audience token Google tidak cocok dengan konfigurasi aplikasi.'
      };
    }

    // 2. Issuer Check
    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!validIssuers.includes(tokenData.iss)) {
      throw {
        status: 401,
        code: 'INVALID_TOKEN_ISSUER',
        message: 'Issuer token Google tidak valid.'
      };
    }

    // 3. Expiry Check
    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    const exp = Number(tokenData.exp);
    if (!exp || exp < nowEpochSeconds) {
      throw {
        status: 401,
        code: 'EXPIRED_GOOGLE_TOKEN',
        message: 'Token Google telah kedaluwarsa.'
      };
    }

    // 4. Extract verified subject identity key
    const sub = tokenData.sub;
    if (!sub || typeof sub !== 'string' || !sub.trim()) {
      throw {
        status: 401,
        code: 'INVALID_TOKEN_SUBJECT',
        message: 'Token Google tidak memiliki subject identifier (sub).'
      };
    }

    // 5. Extract email & email_verified
    // Google returns email_verified as string "true"/"false" or boolean in various endpoints
    const emailVerified = tokenData.email_verified === true || tokenData.email_verified === 'true';
    const email = tokenData.email ? String(tokenData.email).trim().toLowerCase() : null;

    return {
      sub: String(sub).trim(),
      email,
      email_verified: emailVerified,
      name: tokenData.name || tokenData.given_name || null,
      picture: tokenData.picture || null,
      rawClaims: tokenData
    };
  }
}

module.exports = GoogleAuthService;
