'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';

const app = require('../../server/app');
const db = require('../../server/database/db');
const { EmailVerificationService, defaultEmailProvider, RegistrationService } = require('../../core/identity');

let server;
let baseUrl;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'xentra.cloud',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Email Verification System (EV-01 to EV-14)', () => {
  let emailVerificationService;

  before(async () => {
    emailVerificationService = new EmailVerificationService(db);
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  beforeEach(() => {
    defaultEmailProvider.clear();
  });

  it('EV-08: registration creates user in explicit unverified state and dispatches verification email', async () => {
    const regPayload = {
      email: 'unverified_new@business.com',
      password: 'SecurePassword123!',
      full_name: 'Pemilik Baru',
      business_name: 'Bisnis Baru Verifikasi',
      brand_name: 'Brand Baru'
    };

    const res = await request('POST', '/api/v1/auth/register', regPayload);
    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.equal(res.data.user.email_verified, false, 'User must be marked email_verified: false in registration response');

    // Verify database record has email_verified_at = NULL
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('unverified_new@business.com');
    assert.ok(user);
    assert.equal(user.email_verified_at, null, 'Database column email_verified_at must be NULL');

    // Verify email delivery was attempted via EmailProvider
    const sentEmail = defaultEmailProvider.getLastSentEmail('unverified_new@business.com');
    assert.ok(sentEmail, 'Verification email must be dispatched');
    assert.ok(sentEmail.rawToken, 'Verification email must contain token in test adapter');
  });

  it('EV-06: raw verification token is NEVER stored in database, only SHA-256 hash', async () => {
    // Generate an unverified user and token
    const regRes = await request('POST', '/api/v1/auth/register', {
      email: 'raw_test_token@business.com',
      password: 'SecurePassword123!',
      business_name: 'Raw Token Test'
    });
    assert.equal(regRes.status, 201);

    const sentEmail = defaultEmailProvider.getLastSentEmail('raw_test_token@business.com');
    assert.ok(sentEmail);
    const rawToken = sentEmail.rawToken;

    // Search whole database for raw token string
    const rawMatch = db.prepare('SELECT * FROM email_verification_tokens WHERE token_hash = ?').get(rawToken);
    assert.equal(rawMatch, undefined, 'Raw token string must NOT exist in token_hash column');

    // Verify only the sha256 hash exists
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const hashMatch = db.prepare('SELECT * FROM email_verification_tokens WHERE token_hash = ?').get(expectedHash);
    assert.ok(hashMatch, 'Hash must exist in token_hash column');
    assert.equal(hashMatch.used, 0);
  });

  it('EV-01 & EV-09: successful verification via GET /verify-email marks user email verified', async () => {
    // Register account
    await request('POST', '/api/v1/auth/register', {
      email: 'verify_me@business.com',
      password: 'SecurePassword123!',
      business_name: 'Verify Me Resto'
    });

    const sentEmail = defaultEmailProvider.getLastSentEmail('verify_me@business.com');
    assert.ok(sentEmail);
    const rawToken = sentEmail.rawToken;

    const res = await request('GET', `/verify-email?token=${rawToken}`);
    assert.equal(res.status, 200, `Expected 200, got: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.success, true);
    assert.equal(res.data.email, 'verify_me@business.com');
    assert.ok(res.data.verified_at);

    // Verify DB state
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('verify_me@business.com');
    assert.ok(user.email_verified_at, 'email_verified_at must be populated after verification');

    const tokenRow = db.prepare('SELECT * FROM email_verification_tokens WHERE user_id = ?').get(user.id);
    assert.equal(tokenRow.used, 1, 'Token must be marked as used');

    // Verify security audit log record
    const auditLog = db.prepare('SELECT * FROM security_audit_log WHERE action = ? AND target_user_id = ?')
      .get('EMAIL_VERIFIED', user.id);
    assert.ok(auditLog, 'Security audit log must contain EMAIL_VERIFIED event');
  });

  it('EV-04 & EV-05: already-consumed token cannot be replayed or reused', async () => {
    // Register and verify account
    await request('POST', '/api/v1/auth/register', {
      email: 'replay_prevent@business.com',
      password: 'SecurePassword123!',
      business_name: 'Replay Test'
    });

    const sentEmail = defaultEmailProvider.getLastSentEmail('replay_prevent@business.com');
    assert.ok(sentEmail);
    const rawToken = sentEmail.rawToken;

    // First consumption attempt
    const res1 = await request('GET', `/verify-email?token=${rawToken}`);
    assert.equal(res1.status, 200);

    // Second consumption attempt (replay)
    const res2 = await request('GET', `/verify-email?token=${rawToken}`);
    assert.equal(res2.status, 400);
    assert.equal(res2.data.success, false);
    assert.ok(res2.data.code === 'TOKEN_ALREADY_USED' || res2.data.code === 'VERIFICATION_FAILED');
  });

  it('EV-02: invalid token format or non-existent token is safely rejected', async () => {
    const res = await request('GET', '/verify-email?token=invalid_fabricated_token_12345');
    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.ok(res.data.code === 'INVALID_TOKEN' || res.data.code === 'VERIFICATION_FAILED');
  });

  it('EV-03: expired verification token is rejected and cannot verify user', async () => {
    // Create an unverified user
    const regService = new RegistrationService(db);
    const reg = regService.registerBusiness({
      email: 'expired_user@test.com',
      password: 'SecurePassword123!',
      business_name: 'Expired Test'
    });

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('expired_user@test.com');
    const expiredRawToken = 'expired_raw_token_test_12345';
    const expiredHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour in past

    db.prepare(`
      INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run('evt_expired_test', user.id, expiredHash, pastDate, pastDate);

    const res = await request('GET', `/verify-email?token=${expiredRawToken}`);
    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.ok(res.data.error.includes('kedaluwarsa'));

    // Verify user remained unverified
    const checkUser = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(user.id);
    assert.equal(checkUser.email_verified_at, null);
  });

  it('EV-10: resend verification invalidates prior active token and dispatches new token', async () => {
    // We have expired_user@test.com from previous test which is unverified
    const res = await request('POST', '/api/v1/auth/resend-verification', {
      email: 'expired_user@test.com'
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);

    const newEmail = defaultEmailProvider.getLastSentEmail('expired_user@test.com');
    assert.ok(newEmail);
    assert.ok(newEmail.rawToken);

    // Verify old tokens were invalidated (used = 1)
    const activeTokens = db.prepare('SELECT COUNT(*) as cnt FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) AND used = 0')
      .get('expired_user@test.com');
    assert.equal(activeTokens.cnt, 1, 'Only one token should be active (unused)');

    // Verify newly issued token can verify account
    const verifyRes = await request('POST', '/api/v1/auth/verify-email', {
      token: newEmail.rawToken
    });
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.data.success, true);
  });

  it('EV-11: rate limiting on resend verification endpoint prevents spam', async () => {
    const targetEmail = 'ratelimit_test@example.com';
    // Max attempts is 3 per window
    await request('POST', '/api/v1/auth/resend-verification', { email: targetEmail });
    await request('POST', '/api/v1/auth/resend-verification', { email: targetEmail });
    await request('POST', '/api/v1/auth/resend-verification', { email: targetEmail });

    // 4th attempt should be blocked with 429
    const res4 = await request('POST', '/api/v1/auth/resend-verification', { email: targetEmail });
    assert.equal(res4.status, 429);
    assert.equal(res4.data.error, 'TOO_MANY_REQUESTS');
  });

  it('EV-12: legacy Bangjo account login remains functional and has verified status by default', async () => {
    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123'
    }, {
      'Host': 'app.mybangjo.com'
    });

    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.success, true);
    assert.equal(loginRes.data.user.username, 'admin');
    assert.equal(loginRes.data.user.email_verified, true, 'Legacy Bangjo account must have email_verified = true');
  });

  it('EV-13: multi-tenant isolation is preserved across verification flows', async () => {
    const userA = db.prepare('SELECT brand_id, organization_id FROM users WHERE email = ?').get('unverified_new@business.com');
    const userBangjo = db.prepare('SELECT brand_id, organization_id FROM users WHERE username = ?').get('admin');

    assert.notEqual(userA.brand_id, userBangjo.brand_id);
    assert.notEqual(userA.organization_id, userBangjo.organization_id);
  });

  it('EV-14: concurrent token consumption cannot verify twice or create race conditions', async () => {
    // Create new unverified user
    const regService = new RegistrationService(db);
    const reg = regService.registerBusiness({
      email: 'concurrent_race@test.com',
      password: 'SecurePassword123!',
      business_name: 'Race Condition Test'
    });

    const sentEmail = defaultEmailProvider.getLastSentEmail('concurrent_race@test.com');
    const rawToken = sentEmail.rawToken;

    // Fire 2 concurrent verification requests
    const [res1, res2] = await Promise.all([
      request('GET', `/verify-email?token=${rawToken}`),
      request('GET', `/verify-email?token=${rawToken}`)
    ]);

    // Exactly one must succeed (200) and one must be rejected (400)
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 400], 'One request must succeed with 200 and the other must fail with 400');
  });

  it('EV-07: raw token is never exposed in production-style API response', async () => {
    const res = await request('POST', '/api/v1/auth/resend-verification', {
      email: 'unverified_new@business.com'
    });

    // In HTTP response body, the token itself must not leak in production
    const stringified = JSON.stringify(res.data);
    assert.equal(res.data.token, undefined);
  });
});
