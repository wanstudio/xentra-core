'use strict';

/**
 * Workforce Google Invitation Test Suite (INV-GOOGLE-01 to INV-GOOGLE-09)
 *
 * Requirements Matrix:
 * - INV-GOOGLE-01: First-time Google login with valid workforce invitation:
 *                  Creates user, links Google sub, assigns server-side role & branch,
 *                  consumes invitation (pending -> accepted), and returns active session.
 * - INV-GOOGLE-02: Recipient email mismatch rejection:
 *                  Google email does not match invitation recipient email -> 403 INVITATION_EMAIL_MISMATCH.
 * - INV-GOOGLE-03: Existing user with matching email:
 *                  Links Google provider, accepts invitation, updates role/scope,
 *                  does not create duplicate user record.
 * - INV-GOOGLE-04: Google provider already linked to another user:
 *                  Rejects with 409 PROVIDER_ALREADY_LINKED.
 * - INV-GOOGLE-05: Expired invitation rejection:
 *                  Expired invitation token -> 410 INVITATION_EXPIRED.
 * - INV-GOOGLE-06: Already accepted invitation rejection:
 *                  Invitation already in accepted status -> 410 INVITATION_ALREADY_ACCEPTED.
 * - INV-GOOGLE-07: Normal Google login without invitation:
 *                  Unlinked Google account with no invitation token -> 404 ACCOUNT_NOT_LINKED.
 * - INV-GOOGLE-08: Tamper resistance:
 *                  Client-supplied role/branch in body is ignored; role and branch strictly
 *                  derived from server-side invitation record.
 * - INV-GOOGLE-09: Atomic transaction rollback:
 *                  If user or provider insertion encounters an error, invitation state is
 *                  not corrupted and transaction cleanly rolls back.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const axios = require('axios');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-workforce-google-invitation';
process.env.GOOGLE_CLIENT_ID = 'xentra-google-test-client-id.apps.googleusercontent.com';

const app = require('../../server/app');
const db = require('../../server/database/db');
const {
  WorkforceInvitationService,
  AuthProviderService
} = require('../../core/identity');

// Mock Google Token Info
const mockGoogleTokens = new Map();
const originalAxiosGet = axios.get;

axios.get = async function (url, config) {
  if (url.includes('oauth2.googleapis.com/tokeninfo')) {
    const idToken = config?.params?.id_token;
    if (mockGoogleTokens.has(idToken)) {
      return { data: mockGoogleTokens.get(idToken) };
    }
  }
  return originalAxiosGet.apply(this, arguments);
};

function registerMockGoogle(token, claims) {
  const jwt = token.includes('.') ? token : `header.${token}.signature`;
  const fullClaims = {
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://accounts.google.com',
    aud: process.env.GOOGLE_CLIENT_ID,
    ...claims
  };
  mockGoogleTokens.set(jwt, fullClaims);
  mockGoogleTokens.set(token, fullClaims);
  return jwt;
}

let server;
let baseUrl;

const TEST_ORG_ID = 'org_inv_google_test';
const TEST_BRAND_ID = 'brand_inv_google_test';
const TEST_BRANCH_ID = 'branch_inv_google_test';
const TEST_ACTOR_ID = 'usr_inv_google_owner';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Host: 'test.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, raw });
        }
      });
    });
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function createTestInvitation({
  email,
  role = 'branch_manager',
  branchId = TEST_BRANCH_ID,
  brandId = TEST_BRAND_ID,
  orgId = TEST_ORG_ID,
  status = 'pending',
  expiresInDays = 7
}) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const invId = 'wiv_' + crypto.randomBytes(12).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO workforce_invitations (
      id, organization_id, brand_id, branch_id, email, role,
      invited_by_user_id, status, token_hash, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(invId, orgId, brandId, branchId, email.toLowerCase(), role, TEST_ACTOR_ID, status, tokenHash, expiresAt, now, now);

  return { id: invId, rawToken, tokenHash, email, role, branchId, brandId };
}

describe('Workforce Google Invitation (INV-GOOGLE-01 to INV-GOOGLE-09)', () => {
  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Seed baseline org, brand, and branch in test DB
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug, plan, created_at, updated_at)
      VALUES (?, 'Google Inv Org', 'google-inv-org', 'pro', ?, ?)
    `).run(TEST_ORG_ID, now, now);

    db.prepare(`
      INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain, primary_color, created_at, updated_at)
      VALUES (?, ?, 'Google Inv Brand', 'google-inv-brand', 'test.mybangjo.com', '#b6ff00', ?, ?)
    `).run(TEST_BRAND_ID, TEST_ORG_ID, now, now);

    db.prepare(`
      INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at)
      VALUES (?, ?, 'Google Inv Cabang Utama', 'google-inv-cabang', 'Jl. Test No. 1', -7.25, 112.75, 1, ?, ?)
    `).run(TEST_BRANCH_ID, TEST_BRAND_ID, now, now);

    db.prepare(`
      INSERT OR IGNORE INTO users (id, brand_id, organization_id, branch_id, username, password_hash, full_name, email, role, status, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 'inv_owner', 'hash', 'Test Owner', 'owner@xentra.test', 'owner', 'active', datetime('now'), datetime('now'))
    `).run(TEST_ACTOR_ID, TEST_BRAND_ID, TEST_ORG_ID);
  });

  after(() => {
    if (server) server.close();
    axios.get = originalAxiosGet;
  });

  it('INV-GOOGLE-01: First-time Google login with valid invitation creates user, links provider, assigns role & branch, and consumes invitation', async () => {
    const inviteEmail = 'bm_new_user@xentra.test';
    const googleSub = 'sub_google_inv_01';
    const invite = createTestInvitation({
      email: inviteEmail,
      role: 'branch_manager',
      branchId: TEST_BRANCH_ID
    });

    const mockJwt = registerMockGoogle('tok_google_inv_01', {
      sub: googleSub,
      email: inviteEmail,
      email_verified: 'true',
      name: 'Branch Manager Bambang',
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com'
    });

    const res = await request('POST', '/api/v1/auth/google', {
      credential: mockJwt,
      invitation_token: invite.rawToken
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token, 'Must return session token');
    assert.equal(res.body.user.email, inviteEmail);
    assert.equal(res.body.user.role, 'branch_manager');
    assert.equal(res.body.user.branch_id, TEST_BRANCH_ID);
    assert.equal(res.body.redirect_url, '/merchant/');
    assert.equal(res.body.is_new_user, true);

    // Verify invitation is marked accepted
    const invRow = db.prepare('SELECT status, accepted_at FROM workforce_invitations WHERE id = ?').get(invite.id);
    assert.equal(invRow.status, 'accepted');
    assert.ok(invRow.accepted_at);

    // Verify user in DB
    const userRow = db.prepare('SELECT id, role, branch_id, brand_id FROM users WHERE email = ?').get(inviteEmail);
    assert.ok(userRow);
    assert.equal(userRow.role, 'branch_manager');
    assert.equal(userRow.branch_id, TEST_BRANCH_ID);

    // Verify user_auth_providers link
    const authProvider = db.prepare('SELECT provider, provider_user_id, user_id FROM user_auth_providers WHERE provider_user_id = ?').get(googleSub);
    assert.ok(authProvider);
    assert.equal(authProvider.user_id, userRow.id);
  });

  it('INV-GOOGLE-02: Rejects when Google email does not match invitation recipient email (403 INVITATION_EMAIL_MISMATCH)', async () => {
    const inviteEmail = 'intended_bm@xentra.test';
    const attackerEmail = 'different_account@gmail.com';
    const googleSub = 'sub_google_mismatch_02';
    const invite = createTestInvitation({ email: inviteEmail });

    const mockJwt = registerMockGoogle('tok_google_mismatch_02', {
      sub: googleSub,
      email: attackerEmail,
      email_verified: 'true',
      name: 'Uninvited User',
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com'
    });

    const res = await request('POST', '/api/v1/auth/google', {
      credential: mockJwt,
      invitation_token: invite.rawToken
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'INVITATION_EMAIL_MISMATCH');

    // Invitation must remain pending
    const invRow = db.prepare('SELECT status FROM workforce_invitations WHERE id = ?').get(invite.id);
    assert.equal(invRow.status, 'pending');

    // No user created for attacker
    const userRow = db.prepare('SELECT id FROM users WHERE email = ?').get(attackerEmail);
    assert.equal(userRow, undefined);
  });

  it('INV-GOOGLE-03: Existing user with matching email links provider, updates role/scope, and does not create duplicate user', async () => {
    const existingEmail = 'existing_staff@xentra.test';
    const existingUserId = 'usr_existing_staff_03';
    const googleSub = 'sub_google_existing_03';

    // Pre-insert existing user without google auth
    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, branch_id, username, password_hash, full_name, email, role, status, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 'existing_staff', 'hash', 'Existing Staff', ?, 'cashier', 'active', datetime('now'), datetime('now'))
    `).run(existingUserId, TEST_BRAND_ID, TEST_ORG_ID, existingEmail);

    const invite = createTestInvitation({
      email: existingEmail,
      role: 'branch_manager',
      branchId: TEST_BRANCH_ID
    });

    const mockJwt = registerMockGoogle('tok_google_existing_03', {
      sub: googleSub,
      email: existingEmail,
      email_verified: 'true',
      name: 'Existing Staff Updated',
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com'
    });

    const res = await request('POST', '/api/v1/auth/google', {
      credential: mockJwt,
      invitation_token: invite.rawToken
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.id, existingUserId);
    assert.equal(res.body.user.role, 'branch_manager');
    assert.equal(res.body.user.branch_id, TEST_BRANCH_ID);

    // Verify user count with this email is strictly 1 (no duplicate)
    const countRow = db.prepare('SELECT count(*) as count FROM users WHERE email = ?').get(existingEmail);
    assert.equal(countRow.count, 1);

    // Verify provider was linked to existing user
    const providerRow = db.prepare('SELECT user_id FROM user_auth_providers WHERE provider_user_id = ?').get(googleSub);
    assert.equal(providerRow.user_id, existingUserId);
  });

  it('INV-GOOGLE-04: Rejects if Google sub is already linked to another user (409 PROVIDER_ALREADY_LINKED)', async () => {
    const victimUserId = 'usr_victim_04';
    const victimSub = 'sub_google_shared_04';
    const inviteEmail = 'new_invitee_04@xentra.test';

    // Link victimSub to victimUser
    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, branch_id, username, password_hash, full_name, email, role, status, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 'victim_user', 'hash', 'Victim User', 'victim@xentra.test', 'cashier', 'active', datetime('now'), datetime('now'))
    `).run(victimUserId, TEST_BRAND_ID, TEST_ORG_ID);

    db.prepare(`
      INSERT INTO user_auth_providers (id, user_id, provider, provider_user_id, email, metadata, linked_at, created_at, updated_at)
      VALUES ('uap_test_04', ?, 'google', ?, 'victim@xentra.test', '{}', datetime('now'), datetime('now'), datetime('now'))
    `).run(victimUserId, victimSub);

    const invite = createTestInvitation({ email: inviteEmail });

    // Attacker tries to use the victim's Google token with their own invitation
    const mockJwt = registerMockGoogle('tok_google_shared_04', {
      sub: victimSub,
      email: inviteEmail,
      email_verified: 'true',
      name: 'Invited Name',
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com'
    });

    const res = await request('POST', '/api/v1/auth/google', {
      credential: mockJwt,
      invitation_token: invite.rawToken
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'PROVIDER_ALREADY_LINKED');
  });

  it('INV-GOOGLE-05: Rejects expired invitation token (410 INVITATION_EXPIRED)', async () => {
    const inviteEmail = 'expired_user@xentra.test';
    const googleSub = 'sub_google_expired_05';
    const invite = createTestInvitation({
      email: inviteEmail,
      expiresInDays: -1 // Expired in past
    });

    const mockJwt = registerMockGoogle('tok_google_expired_05', {
      sub: googleSub,
      email: inviteEmail,
      email_verified: 'true',
      name: 'Expired User',
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com'
    });

    const res = await request('POST', '/api/v1/auth/google', {
      credential: mockJwt,
      invitation_token: invite.rawToken
    });

    assert.equal(res.status, 410);
    assert.equal(res.body.code, 'INVITATION_EXPIRED');
  });

  it('INV-GOOGLE-06: Rejects already accepted invitation token (410 INVITATION_ALREADY_ACCEPTED)', async () => {
    const inviteEmail = 'already_accepted@xentra.test';
    const googleSub = 'sub_google_accepted_06';
    const invite = createTestInvitation({
      email: inviteEmail,
      status: 'accepted'
    });

    const mockJwt = registerMockGoogle('tok_google_accepted_06', {
      sub: googleSub,
      email: inviteEmail,
      email_verified: 'true',
      name: 'Accepted User',
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com'
    });

    const res = await request('POST', '/api/v1/auth/google', {
      credential: mockJwt,
      invitation_token: invite.rawToken
    });

    assert.equal(res.status, 410);
    assert.equal(res.body.code, 'INVITATION_ALREADY_ACCEPTED');
  });

  it('INV-GOOGLE-07: Normal Google login without invitation still returns 404 ACCOUNT_NOT_LINKED', async () => {
    const unlinkedEmail = 'random_google_user@gmail.com';
    const unlinkedSub = 'sub_google_unlinked_07';

    const mockJwt = registerMockGoogle('tok_google_unlinked_07', {
      sub: unlinkedSub,
      email: unlinkedEmail,
      email_verified: 'true',
      name: 'Random Google User',
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com'
    });

    const res = await request('POST', '/api/v1/auth/google', {
      credential: mockJwt
      // NO invitation_token provided
    });

    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'ACCOUNT_NOT_LINKED');
  });

  it('INV-GOOGLE-08: Client-supplied role/branch tampering is strictly ignored; backend uses invitation values', async () => {
    const inviteEmail = 'tamper_test@xentra.test';
    const googleSub = 'sub_google_tamper_08';
    const invite = createTestInvitation({
      email: inviteEmail,
      role: 'cashier', // server says cashier
      branchId: TEST_BRANCH_ID
    });

    const mockJwt = registerMockGoogle('tok_google_tamper_08', {
      sub: googleSub,
      email: inviteEmail,
      email_verified: 'true',
      name: 'Tamper Tester',
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com'
    });

    // Attacker sends role='owner' and fake branch in body
    const res = await request('POST', '/api/v1/auth/google', {
      credential: mockJwt,
      invitation_token: invite.rawToken,
      role: 'owner',
      branch_id: 'tampered_branch_id'
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'cashier', 'Role must remain cashier from invitation');
    assert.equal(res.body.user.branch_id, TEST_BRANCH_ID, 'Branch must remain assigned branch');
    assert.equal(res.body.redirect_url, '/pos/', 'Invited cashier must land in POS, not the management dashboard');

    const userInDb = db.prepare('SELECT role, branch_id FROM users WHERE email = ?').get(inviteEmail);
    assert.equal(userInDb.role, 'cashier');
    assert.equal(userInDb.branch_id, TEST_BRANCH_ID);
  });

  it('INV-GOOGLE-09: Atomic transaction: if step fails, changes are cleanly rolled back', () => {
    const inviteEmail = 'rollback_test@xentra.test';
    const googleSub = 'sub_google_rollback_09';
    const invite = createTestInvitation({
      email: inviteEmail,
      role: 'branch_manager'
    });

    const invitationService = new WorkforceInvitationService(db);

    // Mock db.prepare to throw error on INSERT INTO users to simulate database failure
    const originalPrepare = db.prepare.bind(db);
    let prepareCount = 0;

    db.prepare = function (sql) {
      if (typeof sql === 'string' && sql.includes('INSERT INTO users')) {
        throw new Error('Simulated database write error during user creation');
      }
      return originalPrepare(sql);
    };

    try {
      assert.throws(() => {
        invitationService.acceptInvitationWithGoogle({
          rawToken: invite.rawToken,
          verifiedGoogleClaims: {
            sub: googleSub,
            email: inviteEmail,
            email_verified: true,
            name: 'Rollback User'
          }
        });
      }, /Simulated database write error/);
    } finally {
      db.prepare = originalPrepare;
    }

    // Verify invitation is still pending due to transaction rollback
    const invRow = db.prepare('SELECT status FROM workforce_invitations WHERE id = ?').get(invite.id);
    assert.equal(invRow.status, 'pending', 'Invitation must still be pending after rollback');

    // Verify no user or provider was created
    const userRow = db.prepare('SELECT id FROM users WHERE email = ?').get(inviteEmail);
    assert.equal(userRow, undefined);

    const providerRow = db.prepare('SELECT id FROM user_auth_providers WHERE provider_user_id = ?').get(googleSub);
    assert.equal(providerRow, undefined);
  });
});
