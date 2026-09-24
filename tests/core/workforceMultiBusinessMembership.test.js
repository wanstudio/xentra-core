'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../server/database/db');
const {
  WorkforceService,
  WorkforceInvitationService
} = require('../../core/identity');

const ORG_A = 'org_multi_wfm_a';
const ORG_B = 'org_multi_wfm_b';
const BRAND_A = 'brand_multi_wfm_a';
const BRAND_B = 'brand_multi_wfm_b';
const BRANCH_A = 'branch_multi_wfm_a';
const BRANCH_B = 'branch_multi_wfm_b';
const USER_EMAIL = 'multi.wfm@example.test';

before(() => {
  const now = new Date().toISOString();

  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ORG_A, 'Multi WFM Org A', 'multi-wfm-org-a', 'pro', now, now);
  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ORG_B, 'Multi WFM Org B', 'multi-wfm-org-b', 'pro', now, now);

  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(BRAND_A, ORG_A, 'Business A', 'multi-wfm-brand-a', now, now);
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(BRAND_B, ORG_B, 'Business B', 'multi-wfm-brand-b', now, now);

  db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(BRANCH_A, BRAND_A, 'Branch A', 'multi-wfm-branch-a', 'A', -7.2, 112.7, now, now);
  db.prepare('INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(BRANCH_B, BRAND_B, 'Branch B', 'multi-wfm-branch-b', 'B', -7.3, 112.8, now, now);
});

after(() => {
  db.prepare('DELETE FROM workforce_memberships WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(USER_EMAIL);
  db.prepare('DELETE FROM user_auth_providers WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(USER_EMAIL);
  db.prepare('DELETE FROM users WHERE email = ?').run(USER_EMAIL);
  db.prepare('DELETE FROM users WHERE email IN (?, ?)').run('owner.b@example.test', 'owner.a@example.test');
  db.prepare('DELETE FROM workforce_memberships WHERE brand_id IN (?, ?)').run(BRAND_A, BRAND_B);
});

test('WF-MULTI-01: one user can be Owner in Business A and Manager in Business B', async () => {
  const workforce = new WorkforceService();

  const ownerA = workforce.createUser({
    brand_id: BRAND_A,
    organization_id: ORG_A,
    username: 'multi_wfm_owner_a',
    email: USER_EMAIL,
    password: 'Password123!',
    full_name: 'Multi WFM User',
    role: 'owner',
    branch_id: BRANCH_A
  });

  const ownerB = workforce.createUser({
    brand_id: BRAND_B,
    organization_id: ORG_B,
    username: 'multi_wfm_owner_b',
    email: 'owner.b@example.test',
    password: 'Password123!',
    full_name: 'Business B Owner',
    role: 'owner',
    branch_id: BRANCH_B
  });

  const invitationService = new WorkforceInvitationService(db, {
    async sendTeamInvitation() {}
  });

  const invitation = await invitationService.createInvitation({
    actor: {
      actor_id: ownerB.id,
      actor_role: 'owner',
      actor_brand_id: BRAND_B,
      actor_org_id: ORG_B
    },
    email: USER_EMAIL,
    role: 'brand_manager',
    brand_id: BRAND_B,
    organization_id: ORG_B,
    branch_id: null
  });

  const accepted = invitationService.acceptInvitation({
    authenticatedUser: {
      id: ownerA.id,
      email: USER_EMAIL
    },
    rawToken: invitation.rawToken
  });

  assert.equal(accepted.success, true);
  assert.equal(accepted.user_id, ownerA.id);
  assert.equal(accepted.role, 'brand_manager');
  assert.equal(accepted.brand_id, BRAND_B);

  const identityRows = db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE LOWER(email) = ?').get(USER_EMAIL.toLowerCase());
  assert.equal(Number(identityRows.cnt), 1);

  const membershipA = db.prepare(
    'SELECT role, organization_id, brand_id, branch_id, status FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
  ).get(ownerA.id, BRAND_A);
  const membershipB = db.prepare(
    'SELECT role, organization_id, brand_id, branch_id, status FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
  ).get(ownerA.id, BRAND_B);

  assert.equal(membershipA.role, 'owner');
  assert.equal(membershipA.organization_id, ORG_A);
  assert.equal(membershipA.branch_id, BRANCH_A);
  assert.equal(membershipA.status, 'active');

  assert.equal(membershipB.role, 'brand_manager');
  assert.equal(membershipB.organization_id, ORG_B);
  assert.equal(membershipB.branch_id, null);
  assert.equal(membershipB.status, 'active');

  // Password is global to the User identity, but role/scope are resolved
  // against the requested business membership.
  const loginA = workforce.authenticate(USER_EMAIL, 'Password123!', BRAND_A);
  const loginB = workforce.authenticate(USER_EMAIL, 'Password123!', BRAND_B);

  assert.equal(loginA.success, true);
  assert.equal(loginA.user.id, ownerA.id);
  assert.equal(loginA.user.role, 'owner');
  assert.equal(loginA.user.brand_id, BRAND_A);
  assert.equal(loginA.user.branch_id, BRANCH_A);

  assert.equal(loginB.success, true);
  assert.equal(loginB.user.id, ownerA.id);
  assert.equal(loginB.user.role, 'brand_manager');
  assert.equal(loginB.user.brand_id, BRAND_B);
  assert.equal(loginB.user.branch_id, null);

  // Disabling Business B membership must not disable Business A.
  workforce.disableUser(ownerA.id, BRAND_B, {
    actor_id: ownerB.id,
    actor_role: 'owner'
  });

  const loginBAfterDisable = workforce.authenticate(USER_EMAIL, 'Password123!', BRAND_B);
  const loginAAfterDisable = workforce.authenticate(USER_EMAIL, 'Password123!', BRAND_A);

  assert.equal(loginBAfterDisable.success, false);
  assert.equal(loginBAfterDisable.error, 'ACCOUNT_DISABLED');
  assert.equal(loginAAfterDisable.success, true);
  assert.equal(loginAAfterDisable.user.role, 'owner');
});

test('WF-MULTI-02: deleting one business membership preserves the global User identity and other membership', async () => {
  const workforce = new WorkforceService();

  const user = workforce.createUser({
    brand_id: BRAND_A,
    organization_id: ORG_A,
    username: 'multi_wfm_delete_user',
    email: 'multi.delete@example.test',
    password: 'Password123!',
    full_name: 'Delete Membership User',
    role: 'owner',
    branch_id: BRANCH_A
  });

  const ownerB = workforce.createUser({
    brand_id: BRAND_B,
    organization_id: ORG_B,
    username: 'multi_wfm_delete_owner_b',
    email: 'owner.delete.b@example.test',
    password: 'Password123!',
    full_name: 'Business B Owner Delete',
    role: 'owner',
    branch_id: BRANCH_B
  });

  const invitationService = new WorkforceInvitationService(db, {
    async sendTeamInvitation() {}
  });

  const invitation = await invitationService.createInvitation({
    actor: {
      actor_id: ownerB.id,
      actor_role: 'owner',
      actor_brand_id: BRAND_B,
      actor_org_id: ORG_B
    },
    email: user.email,
    role: 'brand_manager',
    brand_id: BRAND_B,
    organization_id: ORG_B
  });

  invitationService.acceptInvitation({
    authenticatedUser: { id: user.id, email: user.email },
    rawToken: invitation.rawToken
  });

  workforce.deleteUser(user.id, BRAND_B, {
    actor_id: ownerB.id,
    actor_role: 'owner'
  });

  const userRow = db.prepare('SELECT id, email FROM users WHERE id = ?').get(user.id);
  const remainingA = db.prepare(
    'SELECT role FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
  ).get(user.id, BRAND_A);
  const removedB = db.prepare(
    'SELECT id FROM workforce_memberships WHERE user_id = ? AND brand_id = ?'
  ).get(user.id, BRAND_B);

  assert.ok(userRow);
  assert.equal(userRow.email, user.email);
  assert.equal(remainingA.role, 'owner');
  assert.equal(removedB, undefined);

  db.prepare('DELETE FROM workforce_memberships WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  db.prepare('DELETE FROM workforce_memberships WHERE user_id = ?').run(ownerB.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(ownerB.id);
});
