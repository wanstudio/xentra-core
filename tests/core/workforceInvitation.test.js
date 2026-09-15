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
  EmailProvider
} = require('../../core/identity');

let server;
let baseUrl;

const testBrandId = 'brand_inv_test_main';
const testOrgId = 'org_inv_test_main';
const testBranch1Id = 'branch_inv_test_1';
const testBranch2Id = 'branch_inv_test_2';

let ownerUser;
let branchManagerUser;
let ownerToken;
let branchManagerToken;

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

describe('Phase 3: Workforce Invitation Implementation (INV-01 to INV-12)', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Seed test org, brand, branches, and test users
    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(testOrgId, 'Test Org Inv', 'test-org-inv', 'pro', now, now);

    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain, primary_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(testBrandId, testOrgId, 'Test Brand Inv', 'test-brand-inv', 'test.mybangjo.com', '#b6ff00', now, now);

    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(testBranch1Id, testBrandId, 'Cabang Barat', 'cabang-barat', 'Jl. Barat 1', -7.25, 112.75, now, now);

    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(testBranch2Id, testBrandId, 'Cabang Timur', 'cabang-timur', 'Jl. Timur 2', -7.26, 112.76, now, now);

    const workforce = new WorkforceService();
    try {
      ownerUser = workforce.createUser({
        brand_id: testBrandId,
        organization_id: testOrgId,
        username: 'owner_inv_test',
        email: 'owner_inv@test.com',
        password: 'Password123!',
        full_name: 'Owner Inv Test',
        role: 'owner',
        created_by: 'seed'
      });
    } catch (_) {
      ownerUser = db.prepare('SELECT * FROM users WHERE username = ?').get('owner_inv_test');
    }

    try {
      branchManagerUser = workforce.createUser({
        brand_id: testBrandId,
        organization_id: testOrgId,
        branch_id: testBranch1Id,
        username: 'bm_inv_test',
        email: 'bm_inv@test.com',
        password: 'Password123!',
        full_name: 'Branch Manager 1',
        role: 'branch_manager',
        created_by: ownerUser.id
      });
    } catch (_) {
      branchManagerUser = db.prepare('SELECT * FROM users WHERE username = ?').get('bm_inv_test');
    }

    // Login to obtain auth tokens
    const loginOwner = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'owner_inv_test',
      password: 'Password123!'
    });
    ownerToken = loginOwner.data.token;

    const loginBM = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'bm_inv_test',
      password: 'Password123!'
    });
    branchManagerToken = loginBM.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  beforeEach(() => {
    db.prepare("DELETE FROM workforce_invitations WHERE brand_id = ?").run(testBrandId);
    db.prepare("DELETE FROM security_audit_log WHERE brand_id = ?").run(testBrandId);
  });

  // INV-01: Authorized Owner creates Branch Manager invitation
  it('INV-01: Authorized Owner creates Branch Manager invitation with branch scope and dispatches email', async () => {
    const mockProvider = new EmailProvider({ provider: 'memory' });
    const service = new WorkforceInvitationService(db, mockProvider);

    const email = 'candidate_bm@test.com';
    const result = await service.createInvitation({
      actor: {
        actor_id: ownerUser.id,
        actor_role: 'owner',
        actor_branch_id: null
      },
      email,
      role: 'branch_manager',
      brand_id: testBrandId,
      organization_id: testOrgId,
      branch_id: testBranch1Id
    });

    assert.ok(result.id);
    assert.equal(result.email, email);
    assert.equal(result.role, 'branch_manager');
    assert.equal(result.branch_id, testBranch1Id);
    assert.equal(result.status, 'pending');
    assert.equal(result.delivery.success, true);

    // Verify DB record
    const row = db.prepare('SELECT * FROM workforce_invitations WHERE id = ?').get(result.id);
    assert.ok(row);
    assert.equal(row.email, email);
    assert.equal(row.role, 'branch_manager');
    assert.equal(row.branch_id, testBranch1Id);
    assert.equal(row.status, 'pending');
    assert.ok(row.token_hash);
    assert.notEqual(row.token_hash, result.rawToken, 'Database must only store token_hash, never raw token');

    // Verify email provider sent TEAM_INVITATION
    const sent = mockProvider.getSentEmails();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'TEAM_INVITATION');
    assert.equal(sent[0].to, email);
    assert.equal(sent[0].role, 'branch_manager');
  });

  // INV-02: Unauthorized actor rejected
  it('INV-02: Unauthorized actor cannot create invitation; no record created or email sent', async () => {
    const mockProvider = new EmailProvider({ provider: 'memory' });
    const service = new WorkforceInvitationService(db, mockProvider);

    // Kitchen or Cashier actor attempts invitation
    await assert.rejects(
      async () => {
        await service.createInvitation({
          actor: {
            actor_id: 'usr_cashier_fake',
            actor_role: 'cashier',
            actor_branch_id: testBranch1Id
          },
          email: 'new_cashier@test.com',
          role: 'cashier',
          brand_id: testBrandId,
          branch_id: testBranch1Id
        });
      },
      (err) => {
        assert.equal(err.code, 'FORBIDDEN_ROLE_CEILING');
        return true;
      }
    );

    const count = db.prepare('SELECT COUNT(*) as cnt FROM workforce_invitations').get().cnt;
    assert.equal(count, 0, 'No invitation row should be created');
    assert.equal(mockProvider.getSentEmails().length, 0, 'No email should be dispatched');
  });

  // INV-03: Invalid branch hierarchy rejected
  it('INV-03: Branch hierarchy mismatch is rejected', async () => {
    // Create foreign branch belonging to another brand
    const foreignBrandId = 'brand_inv_foreign';
    const foreignBranchId = 'branch_inv_foreign';
    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(foreignBrandId, testOrgId, 'Foreign Brand', 'foreign-brand', now, now);
    db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(foreignBranchId, foreignBrandId, 'Foreign Branch', 'foreign-branch', 'Jl. Foreign', -7.27, 112.77, now, now);

    const service = new WorkforceInvitationService(db);

    await assert.rejects(
      async () => {
        await service.createInvitation({
          actor: {
            actor_id: ownerUser.id,
            actor_role: 'owner',
            actor_branch_id: null
          },
          email: 'test_mismatch@test.com',
          role: 'branch_manager',
          brand_id: testBrandId, // Brand A
          branch_id: foreignBranchId // Branch belongs to Foreign Brand
        });
      },
      (err) => {
        assert.equal(err.code, 'INVALID_BRANCH_HIERARCHY');
        return true;
      }
    );
  });

  // INV-04: Role escalation rejected
  it('INV-04: Role escalation beyond actor ceiling is rejected', async () => {
    const service = new WorkforceInvitationService(db);

    // Branch manager tries to invite a brand_manager or another branch_manager
    await assert.rejects(
      async () => {
        await service.createInvitation({
          actor: {
            actor_id: branchManagerUser.id,
            actor_role: 'branch_manager',
            actor_branch_id: testBranch1Id
          },
          email: 'escalate@test.com',
          role: 'brand_manager',
          brand_id: testBrandId,
          branch_id: testBranch1Id
        });
      },
      (err) => {
        assert.equal(err.code, 'FORBIDDEN_ROLE_CEILING');
        return true;
      }
    );

    // Branch manager tries to invite cashier to DIFFERENT branch
    await assert.rejects(
      async () => {
        await service.createInvitation({
          actor: {
            actor_id: branchManagerUser.id,
            actor_role: 'branch_manager',
            actor_branch_id: testBranch1Id
          },
          email: 'other_branch_cashier@test.com',
          role: 'cashier',
          brand_id: testBrandId,
          branch_id: testBranch2Id
        });
      },
      (err) => {
        assert.equal(err.code, 'FORBIDDEN_BRANCH_SCOPE');
        return true;
      }
    );
  });

  // INV-05: Token is hash-only
  it('INV-05: Token is stored strictly as SHA-256 hash in database', async () => {
    const service = new WorkforceInvitationService(db);
    const result = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'hash_test@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      branch_id: testBranch1Id
    });

    const dbRow = db.prepare('SELECT * FROM workforce_invitations WHERE id = ?').get(result.id);
    assert.ok(dbRow.token_hash);
    assert.equal(dbRow.token_hash.length, 64); // SHA-256 hex string
    assert.notEqual(dbRow.token_hash, result.rawToken);

    // Check that querying rawToken against token_hash returns nothing
    const wrongQuery = db.prepare('SELECT * FROM workforce_invitations WHERE token_hash = ?').get(result.rawToken);
    assert.equal(wrongQuery, undefined);
  });

  // INV-06: Token expires after TTL
  it('INV-06: Expired invitation is rejected and marks status expired', async () => {
    const service = new WorkforceInvitationService(db);
    const result = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'expire_test@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      branch_id: testBranch1Id
    });

    // Artificially expire the invitation in DB
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    db.prepare('UPDATE workforce_invitations SET expires_at = ? WHERE id = ?').run(pastDate, result.id);

    // Validation must reject
    assert.throws(
      () => {
        service.validateInvitationToken(result.rawToken);
      },
      (err) => {
        assert.equal(err.code, 'INVITATION_EXPIRED');
        return true;
      }
    );

    const updatedRow = db.prepare('SELECT status FROM workforce_invitations WHERE id = ?').get(result.id);
    assert.equal(updatedRow.status, 'expired');
  });

  // INV-07: Resend supersedes old token
  it('INV-07: Resend supersedes prior active token, invalidating old token', async () => {
    const mockProvider = new EmailProvider({ provider: 'memory' });
    const service = new WorkforceInvitationService(db, mockProvider);

    const result1 = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'resend_flow@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      branch_id: testBranch1Id
    });

    const oldToken = result1.rawToken;
    assert.ok(service.validateInvitationToken(oldToken).valid);

    // Resend
    const resendResult = await service.resendInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      invitation_id: result1.id
    });

    const newToken = resendResult.rawToken;
    assert.notEqual(oldToken, newToken);

    // Old token must now be invalid
    assert.throws(
      () => {
        service.validateInvitationToken(oldToken);
      },
      (err) => {
        assert.equal(err.code, 'INVITATION_NOT_FOUND');
        return true;
      }
    );

    // New token must be valid
    const validRes = service.validateInvitationToken(newToken);
    assert.equal(validRes.valid, true);
    assert.equal(validRes.invitation.id, result1.id);
  });

  // INV-08: Revocation
  it('INV-08: Revocation marks status revoked and immediately invalidates token capability', async () => {
    const service = new WorkforceInvitationService(db);

    const result = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'revoke_test@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      branch_id: testBranch1Id
    });

    assert.ok(service.validateInvitationToken(result.rawToken).valid);

    // Revoke
    const revoked = service.revokeInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      invitation_id: result.id
    });

    assert.equal(revoked.status, 'revoked');

    // Token must be rejected
    assert.throws(
      () => {
        service.validateInvitationToken(result.rawToken);
      },
      (err) => {
        assert.equal(err.code, 'INVITATION_REVOKED');
        return true;
      }
    );

    // Double revoke rejected
    assert.throws(
      () => {
        service.revokeInvitation({
          actor: { actor_id: ownerUser.id, actor_role: 'owner' },
          invitation_id: result.id
        });
      },
      (err) => {
        assert.equal(err.code, 'ALREADY_REVOKED');
        return true;
      }
    );
  });

  // INV-09: Invalid state transitions
  it('INV-09: Revoked and expired invitations cannot be resent', async () => {
    const service = new WorkforceInvitationService(db);

    const result = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'transition_test@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      branch_id: testBranch1Id
    });

    // Revoke
    service.revokeInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      invitation_id: result.id
    });

    // Attempt resend on revoked invitation
    await assert.rejects(
      async () => {
        await service.resendInvitation({
          actor: { actor_id: ownerUser.id, actor_role: 'owner' },
          invitation_id: result.id
        });
      },
      (err) => {
        assert.equal(err.code, 'INVALID_STATE');
        return true;
      }
    );
  });

  // INV-10: Email provider failure
  it('INV-10: Email provider transport failure does not roll back invitation record', async () => {
    const failingProvider = {
      async sendTeamInvitation() {
        throw new Error('Resend upstream gateway timeout 504');
      }
    };

    const service = new WorkforceInvitationService(db, failingProvider);

    const result = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'provider_fail@test.com',
      role: 'branch_manager',
      brand_id: testBrandId,
      branch_id: testBranch1Id
    });

    assert.ok(result.id);
    assert.equal(result.status, 'pending');
    assert.equal(result.delivery.success, false);
    assert.match(result.delivery.error, /Resend upstream gateway timeout 504/);

    // Verify DB still persists the pending invitation
    const row = db.prepare('SELECT * FROM workforce_invitations WHERE id = ?').get(result.id);
    assert.ok(row);
    assert.equal(row.status, 'pending');

    // Token capability remains valid and inspectable
    const valid = service.validateInvitationToken(result.rawToken);
    assert.equal(valid.valid, true);
  });

  // INV-11: Duplicate active token prevention on re-invitation
  it('INV-11: Re-inviting same email within same brand updates and supersedes pending token', async () => {
    const service = new WorkforceInvitationService(db);

    const first = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'dedup@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      branch_id: testBranch1Id
    });

    const second = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'dedup@test.com',
      role: 'branch_manager', // updated role
      brand_id: testBrandId,
      branch_id: testBranch1Id
    });

    assert.equal(first.id, second.id, 'Must reuse the pending invitation record');
    assert.equal(second.role, 'branch_manager');

    // Verify only ONE row exists
    const rows = db.prepare('SELECT * FROM workforce_invitations WHERE email = ? AND brand_id = ?').all('dedup@test.com', testBrandId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, 'branch_manager');

    // First raw token must be invalid
    assert.throws(
      () => service.validateInvitationToken(first.rawToken),
      (err) => {
        assert.equal(err.code, 'INVITATION_NOT_FOUND');
        return true;
      }
    );

    // Second raw token must be valid
    assert.equal(service.validateInvitationToken(second.rawToken).valid, true);
  });

  // INV-12: Audit log records invitation events
  it('INV-12: All security-sensitive invitation events are recorded in security_audit_log without secrets', async () => {
    const service = new WorkforceInvitationService(db);

    const result = await service.createInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      email: 'audit_test@test.com',
      role: 'cashier',
      brand_id: testBrandId,
      branch_id: testBranch1Id
    });

    service.revokeInvitation({
      actor: { actor_id: ownerUser.id, actor_role: 'owner' },
      invitation_id: result.id
    });

    const logs = db.prepare(`
      SELECT * FROM security_audit_log 
      WHERE brand_id = ? AND action LIKE 'INVITATION_%' AND action != 'INVITATION_CREATE_DENIED'
      ORDER BY created_at ASC
    `).all(testBrandId);

    const actions = logs.map(l => l.action);
    assert.ok(actions.includes('INVITATION_CREATED'));
    assert.ok(actions.includes('INVITATION_SEND_ATTEMPTED'));
    assert.ok(actions.includes('INVITATION_REVOKED'));

    // Check that raw token or secrets are NEVER in metadata or logs
    for (const log of logs) {
      if (log.metadata) {
        assert.equal(log.metadata.includes(result.rawToken), false, 'Raw token must not be in audit log metadata');
        assert.equal(log.metadata.includes('Bearer'), false);
        assert.equal(/re_[a-zA-Z0-9_-]{10,}/.test(log.metadata), false);
      }
    }
  });

  // REST API Integration: Endpoints
  it('REST API: Owner creates invitation via POST /api/v1/admin/invitations and retrieves via GET /api/v1/admin/invitations', async () => {
    const res = await request(
      'POST',
      '/api/v1/admin/invitations',
      {
        email: 'api_invitee@test.com',
        role: 'branch_manager',
        branch_id: testBranch1Id
      },
      { 'Authorization': `Bearer ${ownerToken}` }
    );

    assert.equal(res.status, 201);
    assert.equal(res.data.success, true);
    assert.equal(res.data.invitation.email, 'api_invitee@test.com');
    assert.equal(res.data.invitation.role, 'branch_manager');
    const inviteId = res.data.invitation.id;

    // List invitations
    const listRes = await request(
      'GET',
      '/api/v1/admin/invitations',
      null,
      { 'Authorization': `Bearer ${ownerToken}` }
    );

    assert.equal(listRes.status, 200);
    assert.equal(listRes.data.success, true);
    const found = listRes.data.invitations.find(i => i.id === inviteId);
    assert.ok(found);
    assert.equal(found.status, 'pending');

    // Public capability validate
    const rawToken = res.data.invitation.rawToken;
    if (rawToken) {
      const validateRes = await request('GET', `/api/v1/invitations/validate/${rawToken}`, null);
      assert.equal(validateRes.status, 200);
      assert.equal(validateRes.data.valid, true);
      assert.equal(validateRes.data.invitation.email, 'api_invitee@test.com');
    }

    // Revoke
    const revokeRes = await request(
      'POST',
      `/api/v1/admin/invitations/${inviteId}/revoke`,
      {},
      { 'Authorization': `Bearer ${ownerToken}` }
    );
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeRes.data.invitation.status, 'revoked');
  });
});
