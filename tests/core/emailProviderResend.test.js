'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EmailProvider, ResendEmailAdapter } = require('../../core/identity/EmailProvider');
const EmailVerificationService = require('../../core/identity/EmailVerificationService');

describe('Email Foundation — EmailProvider & Resend Adapter (Phase 1)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Configuration & Validation', () => {
    it('throws explicit error when RESEND_API_KEY is missing in ResendEmailAdapter', () => {
      delete process.env.RESEND_API_KEY;
      process.env.EMAIL_FROM = 'Xentra <verify@xentra.cloud>';

      assert.throws(
        () => new ResendEmailAdapter(),
        (err) => {
          assert.match(err.message, /Missing RESEND_API_KEY/i);
          return true;
        }
      );
    });

    it('throws explicit error when EMAIL_FROM is missing in ResendEmailAdapter', () => {
      process.env.RESEND_API_KEY = 're_test_dummy_key_12345';
      delete process.env.EMAIL_FROM;

      assert.throws(
        () => new ResendEmailAdapter(),
        (err) => {
          assert.match(err.message, /Missing EMAIL_FROM/i);
          return true;
        }
      );
    });

    it('never leaks RESEND_API_KEY or Bearer token in normalized errors', () => {
      const secretKey = 're_sensitive_key_secret987';
      const mockClient = {
        emails: {
          send: async () => {
            const err = new Error(`Authentication with ${secretKey} and Bearer ${secretKey} failed at upstream`);
            err.name = 'AuthenticationError';
            throw err;
          }
        }
      };

      const adapter = new ResendEmailAdapter({
        apiKey: secretKey,
        from: 'verify@xentra.cloud',
        client: mockClient
      });

      assert.rejects(
        async () => {
          await adapter.sendEmail({
            to: 'merchant@example.com',
            subject: 'Test Subject',
            html: '<p>Hello</p>'
          });
        },
        (err) => {
          assert.equal(err.message.includes(secretKey), false, 'Error message must not contain secret key');
          assert.match(err.message, /REDACTED/);
          assert.equal(err.code, 'AUTHENTICATIONERROR');
          assert.equal(err.provider, 'resend');
          return true;
        }
      );
    });

    it('throws explicit error when unsupported provider is configured in EmailProvider', async () => {
      process.env.EMAIL_PROVIDER = 'unsupported_vendor_xyz';
      const provider = new EmailProvider();

      await assert.rejects(
        async () => {
          await provider.sendVerificationEmail({
            to: 'test@example.com',
            rawToken: 'token123'
          });
        },
        (err) => {
          assert.match(err.message, /Unsupported or unconfigured email provider: "unsupported_vendor_xyz"/);
          return true;
        }
      );
    });
  });

  describe('2. Provider Selection', () => {
    it('defaults to memory provider in test environment without network calls', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.EMAIL_PROVIDER;

      const provider = new EmailProvider();
      const res = await provider.sendVerificationEmail({
        to: 'merchant@test.com',
        rawToken: 'test_token_abc'
      });

      assert.equal(res.success, true);
      assert.equal(res.provider, 'memory');
      assert.equal(provider.getSentEmails().length, 1);
      assert.equal(provider.getLastSentEmail().to, 'merchant@test.com');
      assert.equal(provider.getLastSentEmail().rawToken, 'test_token_abc');
    });

    it('selects Resend adapter when EMAIL_PROVIDER=resend', async () => {
      process.env.EMAIL_PROVIDER = 'resend';
      process.env.RESEND_API_KEY = 're_mock_test_key';
      process.env.EMAIL_FROM = 'Xentra <verify@xentra.cloud>';

      let capturedPayload = null;
      const mockClient = {
        emails: {
          send: async (payload) => {
            capturedPayload = payload;
            return { data: { id: 're_msg_mock_456' }, error: null };
          }
        }
      };

      const customAdapter = new ResendEmailAdapter({
        apiKey: 're_mock_test_key',
        from: 'Xentra <verify@xentra.cloud>',
        client: mockClient
      });

      const provider = new EmailProvider({
        provider: 'resend',
        adapter: customAdapter
      });

      const result = await provider.sendVerificationEmail({
        to: 'owner@resto.com',
        rawToken: 'token_xyz_999',
        verificationUrl: 'https://xentra.cloud/verify-email?token=token_xyz_999'
      });

      assert.equal(result.success, true);
      assert.equal(result.provider, 'resend');
      assert.equal(result.messageId, 're_msg_mock_456');
      assert.equal(result.providerMessageId, 're_msg_mock_456');

      assert.ok(capturedPayload, 'Resend client should have received payload');
      assert.deepEqual(capturedPayload.to, ['owner@resto.com']);
      assert.equal(capturedPayload.from, 'Xentra <verify@xentra.cloud>');
      assert.match(capturedPayload.subject, /Verifikasi Alamat Email/);
      assert.match(capturedPayload.html, /token_xyz_999/);
    });

    it('fails explicitly in production when RESEND_API_KEY is missing (never silent mock fallback)', async () => {
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
        }
      );
    });
  });

  describe('3. Resend Adapter Delivery Semantics', () => {
    it('sends transactional email successfully and normalizes provider message ID', async () => {
      let callCount = 0;
      let sentPayload = null;

      const mockClient = {
        emails: {
          send: async (payload) => {
            callCount++;
            sentPayload = payload;
            return {
              data: { id: 'email_resend_unique_id_789' },
              error: null
            };
          }
        }
      };

      const adapter = new ResendEmailAdapter({
        apiKey: 're_dummy_mock_key',
        from: 'Xentra Notifications <noreply@xentra.cloud>',
        client: mockClient
      });

      const res = await adapter.sendVerificationEmail({
        to: 'newuser@domain.com',
        verificationUrl: 'https://xentra.cloud/verify-email?token=sample_token',
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      });

      assert.equal(callCount, 1, 'Resend send must be invoked exactly once');
      assert.equal(res.success, true);
      assert.equal(res.provider, 'resend');
      assert.equal(res.messageId, 'email_resend_unique_id_789');
      assert.equal(res.providerMessageId, 'email_resend_unique_id_789');

      assert.deepEqual(sentPayload.to, ['newuser@domain.com']);
      assert.equal(sentPayload.from, 'Xentra Notifications <noreply@xentra.cloud>');
      assert.match(sentPayload.html, /Verifikasi Alamat Email/);
      assert.match(sentPayload.html, /https:\/\/xentra\.cloud\/verify-email\?token=sample_token/);
      assert.match(sentPayload.text, /https:\/\/xentra\.cloud\/verify-email\?token=sample_token/);
    });

    it('handles Resend API error response explicitly without returning fake success', async () => {
      const mockClient = {
        emails: {
          send: async () => {
            return {
              data: null,
              error: {
                name: 'validation_error',
                message: 'Domain not verified on Resend.'
              }
            };
          }
        }
      };

      const adapter = new ResendEmailAdapter({
        apiKey: 're_dummy_mock_key',
        from: 'noreply@unverified-domain.com',
        client: mockClient
      });

      await assert.rejects(
        async () => {
          await adapter.sendVerificationEmail({
            to: 'test@domain.com',
            verificationUrl: 'https://xentra.cloud/verify-email?token=tok123'
          });
        },
        (err) => {
          assert.match(err.message, /Domain not verified on Resend/);
          assert.equal(err.code, 'VALIDATION_ERROR');
          assert.equal(err.provider, 'resend');
          return true;
        }
      );
    });
  });

  describe('4. EmailVerificationService Integration & Dependency Injection', () => {
    it('supports custom EmailProvider injection while preserving token lifecycle', async () => {
      const fakeDb = {
        prepare: () => ({
          run: () => ({ changes: 1 }),
          get: () => null
        }),
        exec: () => {}
      };

      const mockProvider = {
        dispatched: [],
        async sendVerificationEmail(params) {
          this.dispatched.push(params);
          return { success: true, messageId: 'mock_disp_1' };
        }
      };

      const service = new EmailVerificationService(fakeDb, mockProvider);
      const result = await service.createAndSendVerificationToken({
        userId: 'usr_test_123',
        email: 'injected@test.com'
      });

      assert.ok(result.tokenId);
      assert.ok(result.expiresAt);
      assert.equal(mockProvider.dispatched.length, 1);
      assert.equal(mockProvider.dispatched[0].to, 'injected@test.com');
      assert.ok(mockProvider.dispatched[0].rawToken);
    });
  });
});
