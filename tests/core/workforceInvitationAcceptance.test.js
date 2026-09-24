'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';

const app = require('../../server/app');
const db = require('../../server/database/db');
const {
  WorkforceInvitationService,
  WorkforceService,
  WorkforceMembershipService
} = require('../../core/identity');

let server;
let baseUrl;

const testBrandId = 'brand_inv_acc_main';
const testOrgId = 'org_inv_acc_main';
const testBranch1Id = 'branch_inv_acc_1';
const testBranch2Id = 'branch_inv_acc_2';

let ownerUser;
let existingRecipientUser;
let wrongRecipientUser;
let unassignedUser;

let ownerToken;
let existingRecipientToken;
let wrongRecipientToken;
let unassignedUserToken;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
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

describe('Phase 4: Workforce Invitation Acceptance (INV-ACC-01 to INV-ACC-18)', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(testOrgId, 'Test Org Inv Acc', 'test-org-inv-acc', 'pro', now, now);

    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain, primary_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(testBrandId, testOrgId, 'Test Brand Inv Acc', 'test-brand-inv-acc', 'test.mybangjo.com', '#b6ff00', now, now);

    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(testBranch1Id, testBrandId, 'Cabang Barat Acc', 'cabang-barat-acc', 'Jl. Barat Acc 1', -7.25, 112.75, now, now);

    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(testBranch2Id, testBrandId, 'Cabang Timur Acc', 'cabang-timur-acc', 'Jl. Timur Acc 2', -7.26, 112.76, now, now);

    const workforce = new WorkforceService();

    // Owner user
    try {
      ownerUser = workforce.createUser({
        brand_id: testBrandId,
        organization_id: testOrgId,
        username: 'owner_inv_acc',
        email: 'owner_acc@test.com',
        password: 'Password123!',
        full_name: 'Owner Acc Test',
        role: 'owner',
        created_by: 'seed'
      });
    } catch (_) {
      ownerUser = db.prepare('SELECT * FROM users WHERE username = ?').get('owner_inv_acc');
    }

    // Existing recipient user: invited email matches this user's email
    try {
      existingRecipientUser = workforce.createUser({
        brand_id: testBrandId,
        organization_id: testOrgId,
        username: 'alice_existing_user',
        email: 'alice.recipient@test.com',
        password: 'Password123!',
        full_name: 'Alice Recipient',
        role: 'cashier',
        branch_id: testBranch1Id,
        created_by: ownerUser.id
      });
    } catch (_) {
      existingRecipientUser = db.prepare('SELECT * FROM users WHERE username = ?').get('alice_existing_user');
    }

    // Wrong recipient user: email does NOT match invitation email
    try {
      wrongRecipientUser = workforce.createUser({
        brand_id: testBrandId,
        organization_id: testOrgId,
        username: 'bob_wrong_user',
        email: 'bob.wrong@test.com',
        password: 'Password123!',
        full_name: 'Bob Wrong',
        role: 'cashier',
        branch_id: testBranch1Id,
        created_by: ownerUser.id
      });
    } catch (_) {
      wrongRecipientUser = db.prepare('SELECT * FROM users WHERE username = ?').get('bob_wrong_user');
    }

    // Unassigned user (e.g. brand-wide or pending user with no branch assigned)
    try {
      unassignedUser = workforce.createUser({
        brand_id: testBrandId,
        organization_id: testOrgId,
        username: 'charlie_unassigned',
        email: 'charlie.unassigned@test.com',
        password: 'Password123!',
        full_name: 'Charlie Unassigned',
        role: 'brand_manager',
        created_by: ownerUser.id
      });
    } catch (_) {
      unassignedUser = db.prepare('SELECT * FROM users WHERE username = ?').get('charlie_unassigned');
    }

    // Login users to get tokens
    const loginOwner = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'owner_inv_acc',
      password: 'Password123!'
    });
    ownerToken = loginOwner.data.token;

    const loginExisting = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'alice_existing_user',
      password: 'Password123!'
    });
    existingRecipientToken = loginExisting.data.token;

    const loginWrong = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'bob_wrong_user',
      password: 'Password123!'
    });
    wrongRecipientToken = loginWrong.data.token;

    const loginUnassigned = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'charlie_unassigned',
      password: 'Password123!'
    });
    unassignedUserToken = loginUnassigned.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  beforeEach(async () => {
    db.prepare("DELETE FROM workforce_invitations WHERE brand_id = ?").run(testBrandId);
    db.prepare("DELETE FROM security_audit_log WHERE brand_id = ?").run(testBrandId);

    // Reset existing recipient to baseline cashier role at branch 1
    const membershipService = new WorkforceMembershipService();
    db.prepare("UPDATE users SET role = 'cashier', brand_id = ?, organization_id = ?, branch_id = ?, status = 'active' WHERE id = ?")
      .run(testBrandId, testOrgId, testBranch1Id, existingRecipientUser.id);
    membershipService.ensureMembership({
      userId: existingRecipientUser.id,
      organizationId: testOrgId,
      brandId: testBrandId,
      branchId: testBranch1Id,
      role: 'cashier',
      status: 'active'
    });

    // Reset wrong recipient user
    db.prepare("UPDATE users SET role = 'cashier', brand_id = ?, organization_id = ?, branch_id = ?, status = 'active' WHERE id = ?")
      .run(testBrandId, testOrgId, testBranch1Id, wrongRecipientUser.id);
    membershipService.ensureMembership({
      userId: wrongRecipientUser.id,
      organizationId: testOrgId,
      brandId: testBrandId,
      branchId: testBranch1Id,
      role: 'cashier',
      status: 'active'
    });

    // Refresh recipient user sessions for tests that make REST requests
    const loginExisting = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'alice_existing_user',
      password: 'Password123!'
    });
    existingRecipientToken = loginExisting.data.token;

    const loginWrong = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'bob_wrong_user',
      password: 'Password123!'
    });
    wrongRecipientToken = loginWrong.data.token;
  });

  it('INV-ACC-01: Authenticated recipient with matching verified email successfully accepts pending invitation', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch2Id
    });

    const rawToken = created.rawToken;
    assert.ok(rawToken, 'rawToken must be returned in test env');

    const acceptRes = service.acceptInvitation({
      authenticatedUser: {
        id: existingRecipientUser.id,
        email: 'alice.recipient@test.com'
      },
      rawToken
    });

    assert.equal(acceptRes.success, true);
    assert.equal(acceptRes.status, 'accepted');
    assert.equal(acceptRes.role, 'branch_manager');
    assert.equal(acceptRes.branch_id, testBranch2Id);
    assert.equal(acceptRes.brand_id, testBrandId);

    // Verify DB state
    const invRow = db.prepare('SELECT * FROM workforce_invitations WHERE id = ?').get(created.id);
    assert.equal(invRow.status, 'accepted');
    assert.ok(invRow.accepted_at);

    // Verify the target business membership changed; the global user identity
    // remains reusable by other businesses.
    const membership = db.prepare(
      'SELECT role, brand_id, branch_id FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
    ).get(existingRecipientUser.id, testBrandId);
    assert.equal(membership.role, 'branch_manager');
    assert.equal(membership.brand_id, testBrandId);
    assert.equal(membership.branch_id, testBranch2Id);
  });

  it('INV-ACC-02: Missing or unauthenticated user is rejected with 401 UNAUTHORIZED', async () => {
    const service = new WorkforceInvitationService();
    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: null,
        rawToken: 'some-dummy-token'
      });
    }, (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.code, 'UNAUTHORIZED');
      return true;
    });
  });

  it('INV-ACC-03: Invalid or empty rawToken is rejected with 400 INVALID_TOKEN', async () => {
    const service = new WorkforceInvitationService();
    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
        rawToken: ''
      });
    }, (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'INVALID_TOKEN');
      return true;
    });
  });

  it('INV-ACC-04: Non-existent token hash is rejected with 404 INVITATION_NOT_FOUND', async () => {
    const service = new WorkforceInvitationService();
    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
        rawToken: '0000000000000000000000000000000000000000000000000000000000000000'
      });
    }, (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'INVITATION_NOT_FOUND');
      return true;
    });
  });

  it('INV-ACC-05: Revoked invitation is rejected with 410 INVITATION_REVOKED', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    service.revokeInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      invitation_id: created.id
    });

    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 410);
      assert.equal(err.code, 'INVITATION_REVOKED');
      return true;
    });
  });

  it('INV-ACC-06: Expired invitation is rejected with 410 INVITATION_EXPIRED and transitions state to expired', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // Manually backdate expiration date
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE workforce_invitations SET expires_at = ? WHERE id = ?').run(past, created.id);

    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 410);
      assert.equal(err.code, 'INVITATION_EXPIRED');
      return true;
    });

    const updated = db.prepare('SELECT status FROM workforce_invitations WHERE id = ?').get(created.id);
    assert.equal(updated.status, 'expired');
  });

  it('INV-ACC-07: Already accepted invitation is rejected with 410 INVITATION_ALREADY_ACCEPTED', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // First acceptance succeeds
    service.acceptInvitation({
      authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
      rawToken: created.rawToken
    });

    // Second acceptance fails
    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 410);
      assert.equal(err.code, 'INVITATION_ALREADY_ACCEPTED');
      return true;
    });
  });

  it('INV-ACC-08: Recipient mismatch is rejected with 403 RECIPIENT_MISMATCH and audit log is recorded', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // Bob tries to accept Alice's invitation
    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: wrongRecipientUser.id, email: 'bob.wrong@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'RECIPIENT_MISMATCH');
      return true;
    });

    // Status remains pending
    const invRow = db.prepare('SELECT status FROM workforce_invitations WHERE id = ?').get(created.id);
    assert.equal(invRow.status, 'pending');

    // Security audit log contains INVITATION_ACCEPT_DENIED
    const auditRow = db.prepare('SELECT * FROM security_audit_log WHERE action = ? ORDER BY created_at DESC').get('INVITATION_ACCEPT_DENIED');
    assert.ok(auditRow);
    assert.equal(auditRow.result, 'denied');
    const meta = JSON.parse(auditRow.metadata);
    assert.equal(meta.reason, 'RECIPIENT_MISMATCH');
    assert.equal(meta.invitation_id, created.id);
  });

  it('INV-ACC-09: Recipient email comparison is case-insensitive and whitespace-tolerant', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const acceptRes = service.acceptInvitation({
      authenticatedUser: {
        id: existingRecipientUser.id,
        email: '  ALICE.Recipient@Test.COM  '
      },
      rawToken: created.rawToken
    });

    assert.equal(acceptRes.success, true);
    assert.equal(acceptRes.status, 'accepted');
  });

  it('INV-ACC-10: Client-supplied role/brand/branch in request are ignored; values are derived strictly from invitation record', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // Send request via REST API with fraudulent role/branch payload
    const res = await request('POST', '/api/v1/invitations/accept', {
      token: created.rawToken,
      role: 'owner', // Malicious attempt to escalate role
      branch_id: testBranch2Id, // Malicious attempt to hijack branch
      brand_id: 'brand_hacked'
    }, {
      'Authorization': `Bearer ${existingRecipientToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.role, 'cashier'); // Strictly cashier from invitation
    assert.equal(res.data.branch_id, testBranch1Id); // Strictly branch 1 from invitation
    assert.equal(res.data.brand_id, testBrandId);

    // Verify the target membership, not the legacy user scope.
    const userRow = db.prepare(
      'SELECT role, branch_id, brand_id FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
    ).get(existingRecipientUser.id, testBrandId);
    assert.equal(userRow.role, 'cashier');
    assert.equal(userRow.branch_id, testBranch1Id);
    assert.equal(userRow.brand_id, testBrandId);
  });

  it('INV-ACC-11: Atomic transition: concurrent acceptance attempts execute exactly once', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const user = { id: existingRecipientUser.id, email: 'alice.recipient@test.com' };
    const rawToken = created.rawToken;

    let successCount = 0;
    let failCount = 0;

    const promises = [1, 2].map(() => {
      return new Promise((resolve) => {
        try {
          const res = service.acceptInvitation({ authenticatedUser: user, rawToken });
          if (res.success) successCount++;
        } catch (err) {
          if (err.code === 'INVITATION_ALREADY_ACCEPTED' || err.code === 'INVALID_STATE') {
            failCount++;
          }
        }
        resolve();
      });
    });

    await Promise.all(promises);

    assert.equal(successCount, 1, 'Exactly one concurrent accept should succeed');
    assert.equal(failCount, 1, 'The other concurrent accept should fail');
  });

  it('INV-ACC-12: Acceptance records INVITATION_ACCEPTED security audit log without raw tokens', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    service.acceptInvitation({
      authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
      rawToken: created.rawToken
    });

    const auditRow = db.prepare('SELECT * FROM security_audit_log WHERE action = ? ORDER BY created_at DESC').get('INVITATION_ACCEPTED');
    assert.ok(auditRow);
    assert.equal(auditRow.result, 'success');
    assert.equal(auditRow.brand_id, testBrandId);
    assert.equal(auditRow.branch_id, testBranch1Id);

    // Verify rawToken was NOT logged anywhere in metadata
    assert.equal(auditRow.metadata.includes(created.rawToken), false);
  });

  it('INV-ACC-13: REST API POST /api/v1/invitations/accept requires authentication', async () => {
    const res = await request('POST', '/api/v1/invitations/accept', {
      token: 'some-token'
    });
    assert.equal(res.status, 401);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'UNAUTHORIZED');
  });

  it('INV-ACC-14: REST API POST /api/v1/invitations/accept rejects recipient mismatch with 403', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const res = await request('POST', '/api/v1/invitations/accept', {
      token: created.rawToken
    }, {
      'Authorization': `Bearer ${wrongRecipientToken}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.data.success, false);
    assert.equal(res.data.error, 'RECIPIENT_MISMATCH');
  });

  it('INV-ACC-15: REST API POST /api/v1/invitations/accept succeeds for verified authenticated recipient', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'kitchen',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const res = await request('POST', '/api/v1/invitations/accept', {
      token: created.rawToken
    }, {
      'Authorization': `Bearer ${existingRecipientToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.role, 'kitchen');
    assert.equal(res.data.status, 'accepted');
  });

  it('INV-ACC-16: REST API POST /api/v1/admin/invitations/accept alias works identically', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const res = await request('POST', '/api/v1/admin/invitations/accept', {
      token: created.rawToken
    }, {
      'Authorization': `Bearer ${existingRecipientToken}`
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.role, 'cashier');
  });

  it('INV-ACC-17: Superseded invitation token cannot be accepted after resend', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const oldToken = created.rawToken;

    // Resend invitation
    const resent = await service.resendInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      invitation_id: created.id
    });

    const newToken = resent.rawToken;
    assert.notEqual(oldToken, newToken);

    // Old token should be rejected as not found
    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
        rawToken: oldToken
      });
    }, (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'INVITATION_NOT_FOUND');
      return true;
    });

    // New token succeeds
    const acceptRes = service.acceptInvitation({
      authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
      rawToken: newToken
    });
    assert.equal(acceptRes.success, true);
  });

  it('INV-ACC-18: Non-existent user ID in authenticated session returns 404 USER_NOT_FOUND', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'phantom.user@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: 'usr_ghost_non_existent', email: 'phantom.user@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'USER_NOT_FOUND');
      return true;
    });
  });

  // ==================== PHASE 4A RECONCILIATION TESTS ====================

  it('ACC-REC-01: Existing user is reused without creating duplicate user identity', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const userCountBefore = db.prepare('SELECT COUNT(*) as count FROM users WHERE email = ?').get('alice.recipient@test.com').count;

    const res = service.acceptInvitation({
      authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
      rawToken: created.rawToken
    });

    assert.equal(res.success, true);
    assert.equal(res.user_id, existingRecipientUser.id);

    const userCountAfter = db.prepare('SELECT COUNT(*) as count FROM users WHERE email = ?').get('alice.recipient@test.com').count;
    assert.equal(userCountAfter, userCountBefore, 'No duplicate user identity created');
  });

  it('ACC-REC-02: Existing Owner identity cannot be demoted to staff/manager via invitation acceptance', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'owner_acc@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: ownerUser.id, email: 'owner_acc@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'WORKFORCE_ROLE_CONFLICT');
      return true;
    });

    // Verify Owner role preserved
    const ownerDb = db.prepare('SELECT role FROM users WHERE id = ?').get(ownerUser.id);
    assert.equal(ownerDb.role, 'owner');
  });

  it('ACC-REC-03: Existing user may accept invitation for a second business without overwriting the first membership', async () => {
    const service = new WorkforceInvitationService();

    const otherBrandId = 'brand_acc_foreign';
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain, primary_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(otherBrandId, testOrgId, 'Other Foreign Brand', 'other-foreign', 'other-foreign.xentra.cloud', '#ffffff');

    const workforce = new WorkforceService();
    let foreignUser;
    try {
      foreignUser = workforce.createUser({
        brand_id: otherBrandId,
        organization_id: testOrgId,
        username: 'foreign_worker',
        email: 'foreign.worker@test.com',
        password: 'Password123!',
        full_name: 'Foreign Worker',
        role: 'cashier',
        branch_id: null
      });
    } catch (_) {
      foreignUser = db.prepare('SELECT * FROM users WHERE username = ?').get('foreign_worker');
    }

    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'foreign.worker@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const result = service.acceptInvitation({
      authenticatedUser: { id: foreignUser.id, email: 'foreign.worker@test.com' },
      rawToken: created.rawToken
    });

    assert.equal(result.success, true);
    assert.equal(result.role, 'branch_manager');
    assert.equal(result.brand_id, testBrandId);
    assert.equal(result.branch_id, testBranch1Id);

    const userRow = db.prepare('SELECT brand_id, role, branch_id FROM users WHERE id = ?').get(foreignUser.id);
    assert.equal(userRow.brand_id, otherBrandId);
    assert.equal(userRow.role, 'cashier');

    const memberships = db.prepare(
      'SELECT brand_id, role, branch_id FROM workforce_memberships WHERE user_id = ? ORDER BY brand_id'
    ).all(foreignUser.id);

    assert.equal(memberships.length, 2);
    assert.ok(memberships.some(m => m.brand_id === otherBrandId && m.role === 'cashier'));
    assert.ok(memberships.some(m => m.brand_id === testBrandId && m.role === 'branch_manager' && m.branch_id === testBranch1Id));
  });

  it('ACC-REC-04: Manager cannot be demoted to cashier or kitchen role via invitation', async () => {
    const service = new WorkforceInvitationService();

    // Set Alice as brand_manager in the canonical workforce membership.
    db.prepare("UPDATE users SET role = 'brand_manager', branch_id = NULL WHERE id = ?").run(existingRecipientUser.id);
    new WorkforceMembershipService().updateRoleScope(existingRecipientUser.id, testBrandId, {
      role: 'brand_manager',
      branchId: null,
      status: 'active'
    });

    // Invitation is for cashier
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'WORKFORCE_ROLE_CONFLICT');
      return true;
    });

    // Alice remains brand_manager
    const aliceDb = db.prepare('SELECT role FROM users WHERE id = ?').get(existingRecipientUser.id);
    assert.equal(aliceDb.role, 'brand_manager');
  });

  it('ACC-REC-05: Branch Manager cannot be reassigned to a different branch via invitation', async () => {
    const service = new WorkforceInvitationService();

    // Set Alice as branch_manager for branch 1 in the canonical membership.
    db.prepare("UPDATE users SET role = 'branch_manager', branch_id = ? WHERE id = ?").run(testBranch1Id, existingRecipientUser.id);
    new WorkforceMembershipService().updateRoleScope(existingRecipientUser.id, testBrandId, {
      role: 'branch_manager',
      branchId: testBranch1Id,
      status: 'active'
    });

    // Invitation is for branch 2
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch2Id
    });

    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'WORKFORCE_SCOPE_CONFLICT');
      return true;
    });

    // Alice remains at branch 1
    const aliceDb = db.prepare('SELECT branch_id FROM users WHERE id = ?').get(existingRecipientUser.id);
    assert.equal(aliceDb.branch_id, testBranch1Id);
  });

  it('ACC-REC-06: Disabled user account cannot accept invitations', async () => {
    const service = new WorkforceInvitationService();

    // Disable Alice
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(existingRecipientUser.id);

    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'ACCOUNT_DISABLED');
      return true;
    });
  });

  it('ACC-REC-07: Duplicate acceptance of identical membership is safe and idempotent', async () => {
    const service = new WorkforceInvitationService();

    // Set Alice to cashier at branch 1
    db.prepare("UPDATE users SET role = 'cashier', branch_id = ? WHERE id = ?").run(testBranch1Id, existingRecipientUser.id);

    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const res = service.acceptInvitation({
      authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
      rawToken: created.rawToken
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 'accepted');
    assert.equal(res.role, 'cashier');
    assert.equal(res.branch_id, testBranch1Id);
  });

  // ==================== SECURITY AUDIT FAILURE SEMANTICS (AUDIT-FAIL-01 to 06) ====================

  it('AUDIT-FAIL-01: Normal INVITATION_ACCEPT_DENIED writes security_audit_log with authoritative metadata', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'owner_acc@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    assert.throws(() => {
      service.acceptInvitation({
        authenticatedUser: { id: ownerUser.id, email: 'owner_acc@test.com' },
        rawToken: created.rawToken
      });
    }, (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'WORKFORCE_ROLE_CONFLICT');
      return true;
    });

    const auditRow = db.prepare(`
      SELECT * FROM security_audit_log 
      WHERE action = 'INVITATION_ACCEPT_DENIED' AND actor_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(ownerUser.id);

    assert.ok(auditRow, 'Authoritative audit row was recorded');
    assert.equal(auditRow.result, 'denied');
    const metadata = JSON.parse(auditRow.metadata);
    assert.equal(metadata.reason, 'CANNOT_DEMOTE_OWNER');
    assert.equal(metadata.invitation_id, created.id);
  });

  it('AUDIT-FAIL-02: Simulated security_audit_log persistence failure does NOT turn a denied invitation into success', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'owner_acc@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // Mock db.prepare to simulate failure on security_audit_log INSERT
    const origPrepare = service.db.prepare.bind(service.db);
    service.db.prepare = function(sql) {
      if (typeof sql === 'string' && sql.includes('INSERT INTO security_audit_log')) {
        return {
          run: () => {
            throw new Error('disk I/O error or table locked');
          }
        };
      }
      return origPrepare(sql);
    };

    try {
      // Must still be rejected and NEVER succeed
      assert.throws(() => {
        service.acceptInvitation({
          authenticatedUser: { id: ownerUser.id, email: 'owner_acc@test.com' },
          rawToken: created.rawToken
        });
      }, (err) => {
        // Must fail with controlled error (AUDIT_PERSISTENCE_FAILED with 500)
        assert.equal(err.status, 500);
        assert.equal(err.code, 'AUDIT_PERSISTENCE_FAILED');
        return true;
      });
    } finally {
      service.db.prepare = origPrepare;
    }
  });

  it('AUDIT-FAIL-03: Internal DB/audit error details are not exposed through API response', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    // Simulate failure with sensitive SQLite internal details
    const origPrepare = service.db.prepare.bind(service.db);
    service.db.prepare = function(sql) {
      if (typeof sql === 'string' && sql.includes('INSERT INTO security_audit_log')) {
        return {
          run: () => {
            throw new Error('SQLITE_CORRUPT: database disk image is malformed at offset 0x4000');
          }
        };
      }
      return origPrepare(sql);
    };

    let caughtErr;
    try {
      // Wrong user Bob attempts acceptance
      service.acceptInvitation({
        authenticatedUser: { id: wrongRecipientUser.id, email: 'bob.wrong@test.com' },
        rawToken: created.rawToken
      });
    } catch (err) {
      caughtErr = err;
    } finally {
      service.db.prepare = origPrepare;
    }

    assert.ok(caughtErr);
    assert.equal(caughtErr.status, 500);
    assert.equal(caughtErr.code, 'AUDIT_PERSISTENCE_FAILED');
    // Verify no raw sqlite/internal leak in message
    assert.ok(!caughtErr.message.includes('SQLITE'));
    assert.ok(!caughtErr.message.includes('0x4000'));
    assert.ok(!caughtErr.message.includes('malformed'));
  });

  it('AUDIT-FAIL-04: Invitation remains pending/not accepted when the denial path is executed', async () => {
    const service = new WorkforceInvitationService();
    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const origPrepare = service.db.prepare.bind(service.db);
    service.db.prepare = function(sql) {
      if (typeof sql === 'string' && sql.includes('INSERT INTO security_audit_log')) {
        return {
          run: () => {
            throw new Error('Simulated audit error');
          }
        };
      }
      return origPrepare(sql);
    };

    try {
      // Wrong recipient
      assert.throws(() => {
        service.acceptInvitation({
          authenticatedUser: { id: wrongRecipientUser.id, email: 'bob.wrong@test.com' },
          rawToken: created.rawToken
        });
      });
    } finally {
      service.db.prepare = origPrepare;
    }

    // Invitation remains strictly pending
    const inv = db.prepare('SELECT status, accepted_at FROM workforce_invitations WHERE id = ?').get(created.id);
    assert.equal(inv.status, 'pending');
    assert.equal(inv.accepted_at, null);
  });

  it('AUDIT-FAIL-05: Existing successful invitation acceptance remains successful and records audit', async () => {
    const service = new WorkforceInvitationService();
    // Ensure clean canonical membership state for recipient.
    db.prepare("UPDATE users SET role = 'cashier', brand_id = ?, organization_id = ?, branch_id = NULL WHERE id = ?").run(testBrandId, testOrgId, existingRecipientUser.id);
    new WorkforceMembershipService().updateRoleScope(existingRecipientUser.id, testBrandId, {
      role: 'cashier',
      branchId: null,
      status: 'active'
    });

    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'alice.recipient@test.com',
      role: 'brand_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: null
    });

    const res = service.acceptInvitation({
      authenticatedUser: { id: existingRecipientUser.id, email: 'alice.recipient@test.com' },
      rawToken: created.rawToken
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 'accepted');
    assert.equal(res.role, 'brand_manager');

    // Confirm audit was written
    const auditRow = db.prepare(`
      SELECT * FROM security_audit_log 
      WHERE action = 'INVITATION_ACCEPTED' AND actor_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(existingRecipientUser.id);

    assert.ok(auditRow);
    assert.equal(auditRow.result, 'success');
  });

  it('AUDIT-FAIL-06: Cross-business membership is additive, not destructive', async () => {
    const service = new WorkforceInvitationService();
    const otherBrandId = 'brand_acc_foreign_2';
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain, primary_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))')
      .run(otherBrandId, testOrgId, 'Other Foreign Brand 2', 'other-foreign-2', 'other-foreign-2.xentra.cloud', '#ffffff');

    const foreignUser = new WorkforceService().createUser({
      brand_id: otherBrandId,
      organization_id: testOrgId,
      username: 'foreign_worker_2',
      email: 'foreign.worker2@test.com',
      password: 'Password123!',
      full_name: 'Foreign Worker 2',
      role: 'cashier'
    });

    const created = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'foreign.worker2@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    const result = service.acceptInvitation({
      authenticatedUser: { id: foreignUser.id, email: 'foreign.worker2@test.com' },
      rawToken: created.rawToken
    });

    assert.equal(result.success, true);
    assert.equal(
      db.prepare('SELECT brand_id FROM users WHERE id = ?').get(foreignUser.id).brand_id,
      otherBrandId
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS cnt FROM workforce_memberships WHERE user_id = ?').get(foreignUser.id).cnt,
      2
    );
  });
});
