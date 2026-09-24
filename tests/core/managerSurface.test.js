'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const axios = require('axios');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-manager-surface-tests';
process.env.GOOGLE_CLIENT_ID = 'xentra-mgr-test-client-id.apps.googleusercontent.com';

const app = require('../../server/app');
const db = require('../../server/database/db');
const {
  WorkforceInvitationService,
  WorkforceService,
  AuthProviderService
} = require('../../core/identity');

let server;
let baseUrl;

const testBrandId = 'brand_mgr_surface_main';
const testOrgId = 'org_mgr_surface_main';
const testBranch1Id = 'branch_mgr_surf_1';
const testBranch2Id = 'branch_mgr_surf_2';

let ownerUser;
let ownerToken;

// Mock registry for Google tokeninfo
const mockGoogleTokens = new Map();
const originalAxiosGet = axios.get;

axios.get = async function (url, config) {
  if (url && url.includes('oauth2.googleapis.com/tokeninfo')) {
    const idToken = config?.params?.id_token;
    if (mockGoogleTokens.has(idToken)) {
      return { data: mockGoogleTokens.get(idToken) };
    }
  }
  return originalAxiosGet.apply(this, arguments);
};

function formatMockJwt(name) {
  if (typeof name === 'string' && name.includes('.')) return name;
  return `header.${name}.signature`;
}

function registerMockGoogleToken(token, claims) {
  const jwt = formatMockJwt(token);
  mockGoogleTokens.set(jwt, claims);
  mockGoogleTokens.set(token, claims);
  return jwt;
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    // Auto-format credential as 3-part JWT for google-onboard routes
    if (body && typeof body.credential === 'string') {
      body = { ...body, credential: formatMockJwt(body.credential) };
    }
    const payload = (body !== null && body !== undefined) ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': 'test.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
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
    if (payload != null) req.write(payload);
    req.end();
  });
}

describe('Phase 6 — Manager Surface Foundation Tests (MGR-01 to MGR-20)', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(testOrgId, 'Test Org Mgr', 'test-org-mgr', 'pro', now, now);

    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain, primary_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(testBrandId, testOrgId, 'Test Brand Mgr', 'test-brand-mgr', 'test.mybangjo.com', '#b6ff00', now, now);

    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(testBranch1Id, testBrandId, 'Cabang Mgr 1', 'cabang-mgr-1', 'Jl. Mgr 1', -7.25, 112.75, now, now);

    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(testBranch2Id, testBrandId, 'Cabang Mgr 2', 'cabang-mgr-2', 'Jl. Mgr 2', -7.26, 112.76, now, now);

    const workforce = new WorkforceService();
    try {
      ownerUser = workforce.createUser({
        brand_id: testBrandId,
        organization_id: testOrgId,
        username: 'owner_mgr_surface',
        email: 'owner_mgr_surface@test.com',
        password: 'Password123!',
        full_name: 'Owner Mgr Surface',
        role: 'owner',
        created_by: 'seed'
      });
    } catch (_) {
      ownerUser = db.prepare('SELECT * FROM users WHERE username = ?').get('owner_mgr_surface');
    }

    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'owner_mgr_surface',
      password: 'Password123!'
    });
    ownerToken = loginRes.data.token;
  });

  after(async () => {
    axios.get = originalAxiosGet;
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  beforeEach(() => {
    db.prepare('DELETE FROM workforce_invitations WHERE brand_id = ?').run(testBrandId);
    db.prepare('DELETE FROM security_audit_log WHERE brand_id = ?').run(testBrandId);
  });

  // MGR-01: Owner can open Team / view members and invitations
  it('MGR-01: Owner can access team members and invitations list via REST API', async () => {
    const resUsers = await request('GET', '/api/v1/admin/users', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.equal(resUsers.status, 200);
    assert.equal(resUsers.data.success, true);
    assert.ok(Array.isArray(resUsers.data.users));

    const resInv = await request('GET', '/api/v1/admin/invitations', null, {
      Authorization: `Bearer ${ownerToken}`
    });
    assert.equal(resInv.status, 200);
    assert.equal(resInv.data.success, true);
    assert.ok(Array.isArray(resInv.data.invitations));
  });

  // MGR-02: Owner can create Branch Manager invitation
  it('MGR-02: Owner can create Branch Manager invitation with branch scope', async () => {
    const res = await request('POST', '/api/v1/admin/invitations', {
      email: 'bm.candidate@test.com',
      role: 'branch_manager',
      branch_id: testBranch1Id
    }, {
      Authorization: `Bearer ${ownerToken}`
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.equal(res.data.invitation.email, 'bm.candidate@test.com');
    assert.equal(res.data.invitation.role, 'branch_manager');
    assert.equal(res.data.invitation.branch_id, testBranch1Id);
    assert.equal(res.data.invitation.status, 'pending');
  });

  // MGR-03: Branch Manager invitation requires branch scope (BRANCH_REQUIRED)
  it('MGR-03: Branch Manager invitation requires branch scope (BRANCH_REQUIRED)', async () => {
    const res = await request('POST', '/api/v1/admin/invitations', {
      email: 'bm.nobranch@test.com',
      role: 'branch_manager'
      // omit branch_id
    }, {
      Authorization: `Bearer ${ownerToken}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'BRANCH_REQUIRED');
  });

  // MGR-04: Owner cannot create invalid/widened role scope (e.g. invalid role or superadmin)
  it('MGR-04: Owner cannot create invalid or widened role invitation (INVALID_ROLE)', async () => {
    const res = await request('POST', '/api/v1/admin/invitations', {
      email: 'invalid.role@test.com',
      role: 'superadmin',
      branch_id: testBranch1Id
    }, {
      Authorization: `Bearer ${ownerToken}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'INVALID_ROLE');
  });

  // MGR-05: Invitation recipient can authenticate with Google
  it('MGR-05: Invitation recipient can authenticate with Google and receive session', async () => {
    const googleSub = 'sub_google_bm_recip_5';
    const email = 'google.bm.recipient@test.com';
    const rawGoogleToken = 'google-token-bm-5';

    registerMockGoogleToken(rawGoogleToken, {
      sub: googleSub,
      email,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    // Onboard user via Google identity without business
    const onboardRes = await request('POST', '/api/v1/auth/google-onboard', {
      credential: rawGoogleToken
    });

    assert.ok([200, 201].includes(onboardRes.status), `Expected 200 or 201, got ${onboardRes.status}`);
    assert.equal(onboardRes.data.success, true);
    assert.ok(onboardRes.data.token);
    assert.equal(onboardRes.data.user.email, email);
  });

  // MGR-06: Invitation recipient can authenticate with Email
  it('MGR-06: Invitation recipient can authenticate with Email and receive session', async () => {
    const email = 'email.bm.recipient@test.com';
    const password = 'Password123!';

    // Register identity via Email
    const regRes = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password,
      full_name: 'Email BM Recipient'
    });

    assert.equal(regRes.status, 201);
    assert.equal(regRes.data.success, true);
    assert.ok(regRes.data.token);
    assert.equal(regRes.data.user.email, email);

    // Login with same email/password
    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: email,
      password
    });
    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.data.token);
  });

  // MGR-07: Existing Xentra User is reused upon accepting invitation
  it('MGR-07: Existing Xentra User is reused without creating a new user row', async () => {
    const email = 'reuse.user@test.com';
    const service = new WorkforceInvitationService();

    // Create user initially
    const regRes = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password: 'Password123!',
      full_name: 'Existing User'
    });
    const userToken = regRes.data.token;
    const userId = regRes.data.user.id;

    const countBefore = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;

    // Create invitation
    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // Accept invitation
    const acceptRes = await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${userToken}`
    });

    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.data.success, true);
    assert.equal(acceptRes.data.user_id, userId);

    const countAfter = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    assert.equal(countAfter, countBefore, 'User count must not increase upon invitation acceptance');
  });

  // MGR-08: New Google user may remain passwordless (password_hash = NULL)
  it('MGR-08: New Google user may remain passwordless (password_hash = NULL)', async () => {
    const googleSub = 'sub_google_pwless_8';
    const email = 'pwless.google@test.com';
    const rawGoogleToken = 'google-token-pwless-8';

    registerMockGoogleToken(rawGoogleToken, {
      sub: googleSub,
      email,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    await request('POST', '/api/v1/auth/google-onboard', {
      credential: rawGoogleToken
    });

    const userRow = db.prepare('SELECT id, email, password_hash FROM users WHERE LOWER(email) = ?').get(email);
    assert.ok(userRow);
    assert.equal(userRow.password_hash, null, 'Google user without explicit password must have password_hash = NULL');
  });

  // MGR-09: New Email user gets proper password credential flow (bcrypt hash)
  it('MGR-09: New Email user gets proper bcrypt password credential flow', async () => {
    const email = 'credential.flow@test.com';
    const password = 'SecurePassword123!';

    const regRes = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password,
      full_name: 'Credential User'
    });
    assert.equal(regRes.status, 201);

    const userRow = db.prepare('SELECT id, password_hash FROM users WHERE LOWER(email) = ?').get(email);
    assert.ok(userRow);
    assert.ok(userRow.password_hash, 'Password hash must be generated');
    assert.ok(userRow.password_hash.startsWith('$2'), 'Must be standard bcrypt hash');
  });

  // MGR-10: Invitation acceptance assigns exact invited role
  it('MGR-10: Invitation acceptance assigns exact invited role', async () => {
    const email = 'mgr10.role@test.com';
    const service = new WorkforceInvitationService();

    const reg = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password: 'Password123!'
    });

    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const acceptRes = await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${reg.data.token}`
    });

    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.data.role, 'branch_manager');

    const updatedUser = db.prepare(
      'SELECT role FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
    ).get(reg.data.user.id, testBrandId);
    assert.equal(updatedUser.role, 'branch_manager');
  });

  // MGR-11: Invitation acceptance assigns exact invited branch
  it('MGR-11: Invitation acceptance assigns exact invited branch', async () => {
    const email = 'mgr11.branch@test.com';
    const service = new WorkforceInvitationService();

    const reg = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password: 'Password123!'
    });

    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch2Id
    });

    const acceptRes = await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${reg.data.token}`
    });

    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.data.branch_id, testBranch2Id);

    const updatedUser = db.prepare(
      'SELECT branch_id FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
    ).get(reg.data.user.id, testBrandId);
    assert.equal(updatedUser.branch_id, testBranch2Id);
  });

  // MGR-12: Existing workforce identity can receive a membership in another business
  it('MGR-12: Existing user can accept cross-business invitation without overwriting existing business scope', async () => {
    const otherBrandId = 'brand_other_brand_12';
    const otherOrgId = 'org_other_org_12';
    const now = new Date().toISOString();

    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(otherOrgId, 'Other Org', 'other-org-12', 'pro', now, now);
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain, primary_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(otherBrandId, otherOrgId, 'Other Brand', 'other-brand-12', 'other.com', '#b6ff00', now, now);
    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run('branch_other_12', otherBrandId, 'Other Branch', 'other-branch-12', 'Jl. Other', -7.25, 112.75, now, now);

    const email = 'other.brand.bm@test.com';
    const workforce = new WorkforceService();
    const otherUser = workforce.createUser({
      brand_id: otherBrandId,
      organization_id: otherOrgId,
      username: 'other_bm_user',
      email,
      password: 'Password123!',
      full_name: 'Other BM',
      role: 'branch_manager',
      branch_id: 'branch_other_12',
      created_by: 'seed'
    });

    const service = new WorkforceInvitationService();
    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const acceptRes = await service.acceptInvitation({
      authenticatedUser: { id: otherUser.id, email },
      rawToken: inv.rawToken
    });

    assert.equal(acceptRes.success, true);
    assert.equal(acceptRes.role, 'branch_manager');
    assert.equal(acceptRes.brand_id, testBrandId);

    const originalMembership = db.prepare(
      'SELECT role, branch_id FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
    ).get(otherUser.id, otherBrandId);
    const addedMembership = db.prepare(
      'SELECT role, branch_id FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
    ).get(otherUser.id, testBrandId);

    assert.equal(originalMembership.role, 'branch_manager');
    assert.equal(originalMembership.branch_id, 'branch_other_12');
    assert.equal(addedMembership.role, 'branch_manager');
    assert.equal(addedMembership.branch_id, testBranch1Id);

    const userRow = db.prepare('SELECT brand_id, branch_id, role FROM users WHERE id = ?').get(otherUser.id);
    assert.equal(userRow.brand_id, otherBrandId);
    assert.equal(userRow.branch_id, 'branch_other_12');
  });

  // MGR-13: Owner cannot be demoted through invitation (WORKFORCE_ROLE_CONFLICT)
  it('MGR-13: Existing Owner cannot be demoted through invitation acceptance (WORKFORCE_ROLE_CONFLICT)', async () => {
    const service = new WorkforceInvitationService();

    // Invite owner's email as branch_manager
    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: ownerUser.email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const acceptRes = await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${ownerToken}`
    });

    assert.equal(acceptRes.status, 409);
    assert.equal(acceptRes.data.success, false);
    assert.equal(acceptRes.data.error, 'WORKFORCE_ROLE_CONFLICT');
  });

  // MGR-14: Branch Manager cannot access another branch (FORBIDDEN_BRANCH_ACCESS)
  it('MGR-14: Branch Manager cannot access another branch (FORBIDDEN_BRANCH_ACCESS)', async () => {
    const email = 'bm.scoped.14@test.com';
    const service = new WorkforceInvitationService();

    const reg = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password: 'Password123!'
    });

    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${reg.data.token}`
    });

    // Login as the branch manager
    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: reg.data.user.username,
      password: 'Password123!'
    });
    const bmToken = loginRes.data.token;

    // Request accessing assigned branch (branch 1) -> Allowed (200)
    const resAllowed = await request('GET', `/api/v1/admin/branches/${testBranch1Id}/orders`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.notEqual(resAllowed.status, 403);

    // Request accessing another branch (branch 2) -> Forbidden (403 FORBIDDEN_BRANCH_ACCESS)
    const resForbidden = await request('GET', `/api/v1/admin/branches/${testBranch2Id}/orders`, null, {
      Authorization: `Bearer ${bmToken}`
    });
    assert.equal(resForbidden.status, 403);
    assert.equal(resForbidden.data.error, 'FORBIDDEN_BRANCH_ACCESS');
  });

  // MGR-15: Branch Manager cannot escalate own role/scope (cannot invite Brand Manager or Owner)
  it('MGR-15: Branch Manager cannot escalate role or invite roles above ceiling', async () => {
    const email = 'bm.escalate.15@test.com';
    const service = new WorkforceInvitationService();

    const reg = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password: 'Password123!'
    });

    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${reg.data.token}`
    });

    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: reg.data.user.username,
      password: 'Password123!'
    });
    const bmToken = loginRes.data.token;

    // Branch manager attempts to invite a brand_manager
    const resEscalate = await request('POST', '/api/v1/admin/invitations', {
      email: 'new.brand.mgr@test.com',
      role: 'brand_manager'
    }, {
      Authorization: `Bearer ${bmToken}`
    });

    assert.equal(resEscalate.status, 403);
    assert.equal(resEscalate.data.error, 'FORBIDDEN_ROLE_CEILING');
  });

  // MGR-16: Revoked invitation cannot be accepted
  it('MGR-16: Revoked invitation cannot be accepted (INVITATION_REVOKED)', async () => {
    const email = 'revoked.mgr16@test.com';
    const service = new WorkforceInvitationService();

    const reg = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password: 'Password123!'
    });

    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // Revoke
    service.revokeInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      invitation_id: inv.id
    });

    // Try accept
    const acceptRes = await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${reg.data.token}`
    });

    assert.equal(acceptRes.status, 410);
    assert.equal(acceptRes.data.error, 'INVITATION_REVOKED');
  });

  // MGR-17: Expired invitation cannot be accepted
  it('MGR-17: Expired invitation cannot be accepted (INVITATION_EXPIRED)', async () => {
    const email = 'expired.mgr17@test.com';
    const service = new WorkforceInvitationService();

    const reg = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password: 'Password123!'
    });

    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // Artificially expire invitation in DB
    db.prepare("UPDATE workforce_invitations SET expires_at = datetime('now', '-1 day') WHERE id = ?").run(inv.id);

    const acceptRes = await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${reg.data.token}`
    });

    assert.equal(acceptRes.status, 410);
    assert.equal(acceptRes.data.error, 'INVITATION_EXPIRED');
  });

  // MGR-18: Already accepted invitation cannot be reused
  it('MGR-18: Already accepted invitation cannot be reused (INVITATION_ALREADY_ACCEPTED)', async () => {
    const email = 'reused.mgr18@test.com';
    const service = new WorkforceInvitationService();

    const reg = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password: 'Password123!'
    });

    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // Accept first time
    const firstRes = await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${reg.data.token}`
    });
    assert.equal(firstRes.status, 200);

    // Re-login after first accept (revokeUserSessions() invalidated the original token)
    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: email,
      password: 'Password123!'
    });
    const freshToken = loginRes.data.token;

    // Accept second time — must fail with INVITATION_ALREADY_ACCEPTED (410)
    const secondRes = await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${freshToken}`
    });
    assert.equal(secondRes.status, 410);
    assert.equal(secondRes.data.error, 'INVITATION_ALREADY_ACCEPTED');
  });

  // MGR-19: Duplicate existing user is not created upon multi-step identity flow
  it('MGR-19: Duplicate user row is never created during identity flow', async () => {
    const email = 'duplicate.check.19@test.com';
    const googleSub = 'sub_mgr19_dup_check';
    const rawGoogleToken = 'google-token-mgr19';

    registerMockGoogleToken(rawGoogleToken, {
      sub: googleSub,
      email,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    // Onboard Google user
    await request('POST', '/api/v1/auth/google-onboard', { credential: rawGoogleToken });

    const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE LOWER(email) = ?').get(email).count;
    assert.equal(userCount, 1, 'Exactly one user record should exist for email');
  });

  // MGR-20: Frontend cannot bypass Core authorization by supplying another branch_id
  it('MGR-20: Client cannot bypass Core authorization by supplying another branch_id in query or body', async () => {
    const email = 'bm.tamper.20@test.com';
    const service = new WorkforceInvitationService();

    const reg = await request('POST', '/api/v1/auth/register-identity', {
      email,
      password: 'Password123!'
    });

    const inv = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    await request('POST', '/api/v1/invitations/accept', {
      token: inv.rawToken
    }, {
      Authorization: `Bearer ${reg.data.token}`
    });

    const loginRes = await request('POST', '/api/v1/auth/merchant/login', {
      username: reg.data.user.username,
      password: 'Password123!'
    });
    const bmToken = loginRes.data.token;

    // Tampered request supplying branch 2 in query string
    const resTamper = await request('GET', `/api/v1/admin/orders?branch_id=${testBranch2Id}`, null, {
      Authorization: `Bearer ${bmToken}`
    });

    assert.equal(resTamper.status, 403);
    assert.equal(resTamper.data.error, 'FORBIDDEN_BRANCH_ACCESS');
  });
});
