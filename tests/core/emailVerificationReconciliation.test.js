'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';

const db = require('../../server/database/db');
const { EmailVerificationService, RegistrationService } = require('../../core/identity');
const { EmailProvider } = require('../../core/identity/EmailProvider');

describe('Phase 2: Email Verification Reconciliation Tests (Tests A - G)', () => {
  beforeEach(() => {
    // Clean up test users / tokens created during testing
    db.prepare("DELETE FROM email_verification_tokens WHERE user_id LIKE 'usr_test_p2_%'").run();
    db.prepare("DELETE FROM users WHERE id LIKE 'usr_test_p2_%'").run();
  });

  // Test A: Successful registration creates user with email_verified_at = null,
  // generates verification token record in DB, and dispatches via emailProvider.
  it('Test A: Successful registration creates unverified user and dispatches verification token', async () => {
    const sentEmails = [];
    const mockProvider = {
      async sendVerificationEmail(payload) {
        sentEmails.push(payload);
        return { success: true, messageId: 'msg_test_a' };
      },
      async sendEmail() {
        return { success: true };
      }
    };

    const regService = new RegistrationService(db, mockProvider);
    const unique = crypto.randomBytes(4).toString('hex');
    const email = `owner_${unique}@testp2.com`;

    const result = await regService.registerBusiness({
      email,
      password: 'StrongPassword123!',
      business_name: `Biz ${unique}`,
      full_name: 'Owner Tester'
    });

    assert.ok(result.user.id);
    assert.equal(result.user.email_verified, false);

    // Verify DB user state
    const userRow = db.prepare('SELECT id, email, email_verified_at FROM users WHERE id = ?').get(result.user.id);
    assert.ok(userRow);
    assert.equal(userRow.email_verified_at, null, 'email_verified_at must be NULL upon registration');

    // Verify token record in DB
    const tokenRows = db.prepare('SELECT * FROM email_verification_tokens WHERE user_id = ?').all(result.user.id);
    assert.equal(tokenRows.length, 1, 'Exactly one verification token must be created');
    assert.equal(tokenRows[0].used, 0, 'Token must initially be unused (used = 0)');
    assert.ok(tokenRows[0].token_hash, 'Token record must have token_hash');

    // Verify email provider was called
    assert.equal(sentEmails.length, 1, 'Email provider must have been invoked once');
    assert.equal(sentEmails[0].to, email);
    assert.ok(sentEmails[0].rawToken, 'rawToken must be dispatched to email');
  });

  // Test B: Post-commit async dispatch is actually awaited when using await registerBusiness.
  // We use a mock provider with a deliberate 60ms delay and measure elapsed time.
  it('Test B: Async dispatch is awaited by caller without holding DB transaction', async () => {
    const DELAY_MS = 60;
    let providerFinished = false;

    const delayedProvider = {
      async sendVerificationEmail(payload) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        providerFinished = true;
        return { success: true, messageId: 'msg_delayed' };
      }
    };

    const regService = new RegistrationService(db, delayedProvider);
    const unique = crypto.randomBytes(4).toString('hex');
    const email = `delayed_${unique}@testp2.com`;

    const start = Date.now();
    const result = await regService.registerBusiness({
      email,
      password: 'StrongPassword123!',
      business_name: `Delayed Biz ${unique}`
    });
    const elapsed = Date.now() - start;

    assert.ok(elapsed >= DELAY_MS - 5, `Expected elapsed >= ${DELAY_MS}ms, got ${elapsed}ms`);
    assert.equal(providerFinished, true, 'Provider async execution must be completed when registerBusiness resolves');
    assert.ok(result.user.id);
  });

  // Test C: Provider rejection is observed, logged, does NOT throw unhandled rejection,
  // and does NOT roll back business persistence. User remains registered and unverified.
  it('Test C: Provider failure does not rollback registration; user remains persisted and unverified', async () => {
    const failingProvider = {
      async sendVerificationEmail() {
        throw new Error('Resend API down: connection refused 503');
      }
    };

    const regService = new RegistrationService(db, failingProvider);
    const unique = crypto.randomBytes(4).toString('hex');
    const email = `fail_provider_${unique}@testp2.com`;

    // Should NOT throw an error to caller despite email provider failing
    const result = await regService.registerBusiness({
      email,
      password: 'StrongPassword123!',
      business_name: `Fail Provider Biz ${unique}`
    });

    assert.ok(result.user.id);

    // Verify user and org ARE persisted in database
    const userRow = db.prepare('SELECT id, email, email_verified_at FROM users WHERE id = ?').get(result.user.id);
    assert.ok(userRow, 'User must exist in DB despite email failure');
    assert.equal(userRow.email_verified_at, null, 'User must remain unverified');

    const orgRow = db.prepare('SELECT id FROM organizations WHERE id = ?').get(result.organization.id);
    assert.ok(orgRow, 'Organization must exist in DB despite email failure');
  });

  // Test D: Missing production configuration fails explicitly in production mode without silent fallback to mock.
  it('Test D: Missing production configuration fails explicitly in production mode', async () => {
    const origEnv = process.env.NODE_ENV;
    const origKey = process.env.RESEND_API_KEY;
    const origProvider = process.env.EMAIL_PROVIDER;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.EMAIL_PROVIDER;
      delete process.env.RESEND_API_KEY;
      process.env.EMAIL_FROM = 'verify@xentra.cloud';

      const provider = new EmailProvider();

      await assert.rejects(
        async () => {
          await provider.sendVerificationEmail({
            to: 'user@prod.com',
            rawToken: 'token_prod_123'
          });
        },
        (err) => {
          assert.match(err.message, /Missing RESEND_API_KEY/);
          return true;
        },
        'Should fail fast in production when RESEND_API_KEY is missing'
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origKey) process.env.RESEND_API_KEY = origKey;
      if (origProvider) process.env.EMAIL_PROVIDER = origProvider;
    }
  });

  // Test E: Token verification works, populates email_verified_at, and cannot be replayed.
  it('Test E: Token verification consumes token atomically and prevents replay', async () => {
    let capturedToken = null;
    const mockProvider = {
      async sendVerificationEmail({ rawToken }) {
        capturedToken = rawToken;
        return { success: true };
      }
    };

    const regService = new RegistrationService(db, mockProvider);
    const unique = crypto.randomBytes(4).toString('hex');
    const email = `verify_${unique}@testp2.com`;

    const result = await regService.registerBusiness({
      email,
      password: 'StrongPassword123!',
      business_name: `Verify Biz ${unique}`
    });

    assert.ok(capturedToken, 'Raw token should be captured by email provider');

    const evService = new EmailVerificationService(db, mockProvider);

    // 1st verification attempt must succeed
    const verifyResult = evService.verifyToken(capturedToken);
    assert.equal(verifyResult.success, true);
    assert.equal(verifyResult.userId, result.user.id);

    // Verify DB user now has email_verified_at
    const updatedUser = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(result.user.id);
    assert.ok(updatedUser.email_verified_at, 'email_verified_at must be populated after verification');

    // 2nd verification attempt with SAME token must fail (replay protection)
    assert.throws(
      () => {
        evService.verifyToken(capturedToken);
      },
      (err) => {
        assert.equal(err.code, 'TOKEN_ALREADY_USED');
        return true;
      },
      'Replay of consumed token must be rejected with TOKEN_ALREADY_USED'
    );
  });

  // Test F: Resend invalidates old token and dispatches new valid token.
  it('Test F: Resending verification token invalidates prior active tokens', async () => {
    const tokens = [];
    const mockProvider = {
      async sendVerificationEmail({ rawToken }) {
        tokens.push(rawToken);
        return { success: true };
      }
    };

    const regService = new RegistrationService(db, mockProvider);
    const unique = crypto.randomBytes(4).toString('hex');
    const email = `resend_${unique}@testp2.com`;

    const result = await regService.registerBusiness({
      email,
      password: 'StrongPassword123!',
      business_name: `Resend Biz ${unique}`
    });

    assert.equal(tokens.length, 1);
    const firstToken = tokens[0];

    const evService = new EmailVerificationService(db, mockProvider);

    // Resend a new verification token
    const resendResult = await evService.createAndSendVerificationToken({
      userId: result.user.id,
      email
    });

    assert.equal(tokens.length, 2);
    const secondToken = tokens[1];
    assert.notEqual(firstToken, secondToken, 'New token must be distinct from first token');

    // First token must now be invalid / already marked used
    assert.throws(
      () => {
        evService.verifyToken(firstToken);
      },
      (err) => {
        assert.equal(err.code, 'TOKEN_ALREADY_USED');
        return true;
      },
      'First token should be superseded and rejected'
    );

    // Second token must successfully verify
    const verifyResult = evService.verifyToken(secondToken);
    assert.equal(verifyResult.success, true);
    assert.equal(verifyResult.userId, result.user.id);
  });

  // Test G: Expired token is rejected
  it('Test G: Expired verification token is rejected', async () => {
    let capturedToken = null;
    const mockProvider = {
      async sendVerificationEmail({ rawToken }) {
        capturedToken = rawToken;
        return { success: true };
      }
    };

    const regService = new RegistrationService(db, mockProvider);
    const unique = crypto.randomBytes(4).toString('hex');
    const email = `expired_${unique}@testp2.com`;

    const result = await regService.registerBusiness({
      email,
      password: 'StrongPassword123!',
      business_name: `Expired Biz ${unique}`
    });

    // Artificially expire the token in the database
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    db.prepare('UPDATE email_verification_tokens SET expires_at = ? WHERE user_id = ?').run(pastDate, result.user.id);

    const evService = new EmailVerificationService(db, mockProvider);

    assert.throws(
      () => {
        evService.verifyToken(capturedToken);
      },
      (err) => {
        assert.equal(err.code, 'TOKEN_EXPIRED');
        return true;
      },
      'Expired token must be rejected with TOKEN_EXPIRED'
    );
  });
});
