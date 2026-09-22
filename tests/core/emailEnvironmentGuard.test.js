'use strict';

/**
 * Email environment guard — Resend must be unreachable outside production.
 *
 * The provider resolves its transport from EMAIL_PROVIDER before NODE_ENV, so an
 * environment that exports EMAIL_PROVIDER=resend/RESEND_API_KEY (a local .env,
 * a CI variable, a shell profile) could otherwise make tests, CI and local
 * development perform real deliveries and consume the Resend quota.
 *
 * These tests prove:
 *   - test / development always resolve to the in-memory provider
 *   - an explicit 'resend' request is demoted outside production
 *   - a live Resend transport cannot be constructed outside production
 *   - the production selection path is unchanged
 *   - the Resend SDK module is never loaded outside production
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { EmailProvider, ResendEmailAdapter } = require('../../core/identity/EmailProvider');

const RESEND_MODULE_FRAGMENT = 'node_modules/resend';

function resendModuleLoaded() {
  return Object.keys(require.cache).some((p) => p.includes(RESEND_MODULE_FRAGMENT));
}

function withEnv(vars, fn) {
  const saved = {};
  Object.keys(vars).forEach((k) => { saved[k] = process.env[k]; });

  Object.keys(vars).forEach((k) => {
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  });

  try {
    return fn();
  } finally {
    Object.keys(saved).forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  }
}

// Env that would select Resend if the guard were absent.
const RESEND_LOOKING_ENV = {
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_guard_test_key_not_real',
  EMAIL_FROM: 'Xentra <noreply@xentra.cloud>'
};

test('EMAIL PROVIDER GUARD — Resend is unreachable outside production', async (t) => {

  await t.test('1. NODE_ENV=test with EMAIL_PROVIDER=resend resolves to the in-memory provider', async () => {
    await withEnv({ ...RESEND_LOOKING_ENV, NODE_ENV: 'test' }, async () => {
      const provider = new EmailProvider();

      assert.equal(provider.activeProviderName, 'memory', 'test must resolve to memory');

      const res = await provider.sendVerificationEmail({
        to: 'guard-test@example.com',
        rawToken: 'guard_token_1'
      });

      assert.equal(res.success, true);
      assert.equal(res.provider, 'memory', 'no live provider may be used');
      assert.equal(provider.getSentEmails().length, 1, 'email is recorded in memory');
    });
  });

  await t.test('2. NODE_ENV=development with EMAIL_PROVIDER=resend resolves to the in-memory provider', async () => {
    await withEnv({ ...RESEND_LOOKING_ENV, NODE_ENV: 'development' }, async () => {
      const provider = new EmailProvider();
      assert.equal(provider.activeProviderName, 'memory', 'development must resolve to memory');

      const res = await provider.sendTeamInvitation({
        to: 'guard-dev@example.com',
        rawToken: 'guard_token_2'
      });

      assert.equal(res.provider, 'memory');
      assert.equal(provider.getSentEmails().length, 1);
    });
  });

  await t.test('3. an explicit provider:"resend" without an injected adapter is demoted outside production', async () => {
    await withEnv({ ...RESEND_LOOKING_ENV, NODE_ENV: 'test' }, async () => {
      const provider = new EmailProvider({ provider: 'resend' });

      assert.equal(provider.activeProviderName, 'memory');

      const res = await provider.sendVerificationEmail({
        to: 'guard-explicit@example.com',
        rawToken: 'guard_token_3'
      });

      assert.equal(res.provider, 'memory');
    });
  });

  await t.test('4. a live Resend transport cannot be constructed outside production', () => {
    ['test', 'development', undefined].forEach((env) => {
      withEnv({ ...RESEND_LOOKING_ENV, NODE_ENV: env }, () => {
        assert.throws(
          () => new ResendEmailAdapter(),
          (err) => {
            assert.match(err.message, /Refusing to construct a live Resend transport outside production/);
            return true;
          },
          `no live transport may be built when NODE_ENV=${env || 'unset'}`
        );
      });
    });
  });

  await t.test('5. an explicitly injected client is still allowed outside production (test seam)', async () => {
    await withEnv({ ...RESEND_LOOKING_ENV, NODE_ENV: 'test' }, async () => {
      let calls = 0;
      const mockClient = {
        emails: { send: async () => { calls += 1; return { data: { id: 'mock_1' }, error: null }; } }
      };

      const adapter = new ResendEmailAdapter({
        apiKey: 're_guard_test_key_not_real',
        from: 'Xentra <noreply@xentra.cloud>',
        client: mockClient
      });

      const res = await adapter.sendEmail({ to: 'a@b.c', subject: 's', text: 't' });
      assert.equal(res.success, true);
      assert.equal(calls, 1, 'only the injected client is used');
    });
  });

  await t.test('6. production selection is unchanged', () => {
    withEnv({ EMAIL_PROVIDER: undefined, NODE_ENV: 'production' }, () => {
      const provider = new EmailProvider();
      assert.equal(provider.activeProviderName, 'resend', 'production still selects Resend');
    });

    withEnv({ EMAIL_PROVIDER: 'resend', NODE_ENV: 'production' }, () => {
      const provider = new EmailProvider();
      assert.equal(provider.activeProviderName, 'resend', 'explicit Resend in production is honoured');
    });

    withEnv({ EMAIL_PROVIDER: undefined, NODE_ENV: 'production' }, () => {
      const provider = new EmailProvider({ provider: 'memory' });
      assert.equal(provider.activeProviderName, 'memory', 'production may still opt into memory');
    });
  });

  await t.test('7. the Resend SDK module is never loaded outside production', () => {
    withEnv({ ...RESEND_LOOKING_ENV, NODE_ENV: 'test' }, () => {
      const provider = new EmailProvider();
      assert.equal(provider.activeProviderName, 'memory');
      assert.throws(() => new ResendEmailAdapter(), /Refusing to construct/);
    });

    assert.equal(
      resendModuleLoaded(),
      false,
      'the Resend SDK must not be required anywhere outside the production path'
    );
  });

  await t.test('8. unknown providers still fail explicitly (contract preserved)', async () => {
    await withEnv({ NODE_ENV: 'test', EMAIL_PROVIDER: 'unsupported_vendor_xyz' }, async () => {
      const provider = new EmailProvider();
      await assert.rejects(
        () => provider.sendVerificationEmail({ to: 'x@y.z', rawToken: 'tok' }),
        /Unsupported or unconfigured email provider/
      );
    });
  });
});
