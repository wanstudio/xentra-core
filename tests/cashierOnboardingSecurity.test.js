'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';

const app = require('../server/app');
const db = require('../server/database/db');
const {
  CashierOnboardingService,
  PosPinCredentialService,
  WorkforceInvitationService
} = require('../core/identity');

let server;
let baseUrl;
const testOrgId = 'org_test_onboarding';
const testBrandId = 'brand_test_onboarding';
const testBranchId = 'branch_test_onboarding';

function request(method, reqPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
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

describe('Cashier Invitation & Mandatory Identity Onboarding Contract v1', () => {
  let ownerToken;
  let cashierUser;
  let cashierToken;
  let cashierSessionToken;

  before(async () => {
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Seed test organization, brand, branch, and owner
    db.prepare('DELETE FROM security_audit_log WHERE brand_id = ?').run(testBrandId);
    db.prepare('DELETE FROM workforce_invitations WHERE brand_id = ?').run(testBrandId);
    db.prepare('DELETE FROM users WHERE brand_id = ?').run(testBrandId);
    db.prepare('DELETE FROM branches WHERE brand_id = ?').run(testBrandId);
    db.prepare('DELETE FROM brands WHERE id = ?').run(testBrandId);
    db.prepare('DELETE FROM organizations WHERE id = ?').run(testOrgId);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, created_at, updated_at)
      VALUES (?, 'Test Org Onboarding', 'test-org-onboarding', datetime('now'), datetime('now'))
    `).run(testOrgId);

    db.prepare(`
      INSERT INTO brands (id, organization_id, name, slug, custom_domain, created_at, updated_at)
      VALUES (?, ?, 'Test Brand Onboarding', 'test-brand-onboarding', 'test.mybangjo.com', datetime('now'), datetime('now'))
    `).run(testBrandId, testOrgId);

    db.prepare(`
      INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, created_at, updated_at)
      VALUES (?, ?, 'Cabang Utama', 'cabang-utama', 'Jl. Test No. 1', -6.2, 106.8, datetime('now'), datetime('now'))
    `).run(testBranchId, testBrandId);

    // Register/Create owner
    const bcrypt = require('bcryptjs');
    const ownerHash = bcrypt.hashSync('OwnerPassword123!', 10);
    db.prepare(`
      INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, email_verified_at, created_at, updated_at)
      VALUES ('usr_owner_onb', ?, ?, 'owner_onb', 'owner@example.com', ?, 'Owner Test', 'owner', 'active', datetime('now'), datetime('now'), datetime('now'))
    `).run(testBrandId, testOrgId, ownerHash);

    const ownerLogin = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'owner_onb',
      password: 'OwnerPassword123!'
    });
    ownerToken = ownerLogin.data.token;
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('1. Cashier invitation creation and acceptance sets cashier_onboarding_status = ACCEPTED', async () => {
    // Owner invites cashier
    const inviteRes = await request('POST', '/api/v1/admin/invitations', {
      email: 'budi.kasir@example.com',
      role: 'cashier',
      branch_id: testBranchId
    }, { 'Authorization': `Bearer ${ownerToken}` });

    assert.equal(inviteRes.status, 201);
    const rawToken = inviteRes.data.invitation.rawToken;
    assert.ok(rawToken, 'rawToken present in test mode');

    // Register identity account for the recipient
    const regRes = await request('POST', '/api/v1/auth/register-identity', {
      email: 'budi.kasir@example.com',
      password: 'CashierPassword123!',
      full_name: 'Temp Name'
    });
    assert.equal(regRes.status, 201);
    const cashierAuthToken = regRes.data.token;
    cashierToken = cashierAuthToken;

    // Accept invitation
    const acceptRes = await request('POST', '/api/v1/invitations/accept', {
      token: rawToken
    }, { 'Authorization': `Bearer ${cashierAuthToken}` });

    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.data.role, 'cashier');

    // Prior session was revoked upon acceptance; login again to obtain fresh cashier session
    const cashierLogin = await request('POST', '/api/v1/auth/merchant/login', {
      username: 'budi.kasir@example.com',
      password: 'CashierPassword123!'
    });
    assert.equal(cashierLogin.status, 200);
    cashierToken = cashierLogin.data.token;

    // Verify DB record: role cashier, status ACCEPTED
    const userRow = db.prepare('SELECT id, role, cashier_onboarding_status, pos_pin_hash, nik, full_name FROM users WHERE email = ?').get('budi.kasir@example.com');
    assert.ok(userRow);
    assert.equal(userRow.role, 'cashier');
    assert.equal(userRow.cashier_onboarding_status, 'ACCEPTED');
    cashierUser = userRow;
  });

  it('2. Cashier in ACCEPTED status cannot access operational POS endpoints (Fail-Closed Gate)', async () => {
    // Attempting to access POS sales or cash settlement must be rejected with 403 CASHIER_ONBOARDING_REQUIRED
    const posRes = await request('POST', '/api/v1/pos/orders/dummy_ord/settle-cash', {
      amount_tendered: 50000
    }, { 'Authorization': `Bearer ${cashierToken}` });

    assert.equal(posRes.status, 403);
    assert.equal(posRes.data.code, 'CASHIER_ONBOARDING_REQUIRED');
    assert.equal(posRes.data.onboarding_status, 'ACCEPTED');
  });

  it('3. Cashier in ACCEPTED status can check onboarding status', async () => {
    const statusRes = await request('GET', '/api/v1/auth/cashier-onboarding/status', null, {
      'Authorization': `Bearer ${cashierToken}`
    });

    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.data.status, 'ACCEPTED');
    assert.equal(statusRes.data.step, 2);
    assert.equal(statusRes.data.has_pin, false);
    assert.equal(statusRes.data.has_identity, false);
    assert.equal(statusRes.data.can_access_pos, false);
  });

  it('4. Step 3 (Identity) is blocked if Step 2 (PIN) is skipped', async () => {
    const identityRes = await request('POST', '/api/v1/auth/cashier-onboarding/identity', {
      name: 'Budi Santoso',
      nik: '1871020304050001'
    }, { 'Authorization': `Bearer ${cashierToken}` });

    assert.equal(identityRes.status, 400);
    assert.equal(identityRes.data.code, 'PIN_REQUIRED_FIRST');
  });

  it('5. Step 2 (PIN): rejects mismatched PIN confirmation and non-6-digit PINs', async () => {
    // Non-6-digit
    const invalidPinRes = await request('POST', '/api/v1/auth/cashier-onboarding/pin', {
      pin: '12345',
      pin_confirmation: '12345'
    }, { 'Authorization': `Bearer ${cashierToken}` });
    assert.equal(invalidPinRes.status, 400);
    assert.equal(invalidPinRes.data.code, 'INVALID_PIN_FORMAT');

    // Mismatched confirmation
    const mismatchRes = await request('POST', '/api/v1/auth/cashier-onboarding/pin', {
      pin: '123456',
      pin_confirmation: '654321'
    }, { 'Authorization': `Bearer ${cashierToken}` });
    assert.equal(mismatchRes.status, 400);
    assert.equal(mismatchRes.data.code, 'PIN_CONFIRMATION_MISMATCH');
  });

  it('6. Step 2 (PIN): sets valid 6-digit PIN and advances state to PIN_SET', async () => {
    const setPinRes = await request('POST', '/api/v1/auth/cashier-onboarding/pin', {
      pin: '123456',
      pin_confirmation: '123456'
    }, { 'Authorization': `Bearer ${cashierToken}` });

    assert.equal(setPinRes.status, 200);
    assert.equal(setPinRes.data.success, true);
    assert.equal(setPinRes.data.status, 'PIN_SET');
    assert.equal(setPinRes.data.can_access_pos, false);

    // Verify DB has hashed PIN (pos_pin_hash and pos_pin_salt), no plaintext PIN
    const row = db.prepare('SELECT pos_pin_hash, pos_pin_salt, cashier_onboarding_status FROM users WHERE id = ?').get(cashierUser.id);
    assert.ok(row.pos_pin_hash);
    assert.ok(row.pos_pin_salt);
    assert.equal(row.cashier_onboarding_status, 'PIN_SET');
  });

  it('7. Cashier in PIN_SET status is STILL blocked from POS operations', async () => {
    const posRes = await request('POST', '/api/v1/pos/orders/dummy_ord/settle-cash', {
      amount_tendered: 50000
    }, { 'Authorization': `Bearer ${cashierToken}` });

    assert.equal(posRes.status, 403);
    assert.equal(posRes.data.code, 'CASHIER_ONBOARDING_REQUIRED');
    assert.equal(posRes.data.onboarding_status, 'PIN_SET');
  });

  it('8. Step 3 (Identity): rejects invalid names and email addresses as name', async () => {
    // Empty name
    const emptyRes = await request('POST', '/api/v1/auth/cashier-onboarding/identity', {
      name: '   ',
      nik: '1871020304050001'
    }, { 'Authorization': `Bearer ${cashierToken}` });
    assert.equal(emptyRes.status, 400);
    assert.equal(emptyRes.data.code, 'INVALID_CASHIER_NAME');

    // Email as name
    const emailNameRes = await request('POST', '/api/v1/auth/cashier-onboarding/identity', {
      name: 'budi.kasir@example.com',
      nik: '1871020304050001'
    }, { 'Authorization': `Bearer ${cashierToken}` });
    assert.equal(emailNameRes.status, 400);
    assert.equal(emailNameRes.data.code, 'NAME_CANNOT_BE_EMAIL');
  });

  it('9. Step 3 (Identity): rejects NIK with invalid lengths or non-numeric characters', async () => {
    // 15 digits
    const shortNikRes = await request('POST', '/api/v1/auth/cashier-onboarding/identity', {
      name: 'Budi Santoso',
      nik: '187102030405000'
    }, { 'Authorization': `Bearer ${cashierToken}` });
    assert.equal(shortNikRes.status, 400);
    assert.equal(shortNikRes.data.code, 'INVALID_NIK');

    // 17 digits
    const longNikRes = await request('POST', '/api/v1/auth/cashier-onboarding/identity', {
      name: 'Budi Santoso',
      nik: '18710203040500019'
    }, { 'Authorization': `Bearer ${cashierToken}` });
    assert.equal(longNikRes.status, 400);
    assert.equal(longNikRes.data.code, 'INVALID_NIK');

    // Contains letters
    const alphaNikRes = await request('POST', '/api/v1/auth/cashier-onboarding/identity', {
      name: 'Budi Santoso',
      nik: '187102030405000A'
    }, { 'Authorization': `Bearer ${cashierToken}` });
    assert.equal(alphaNikRes.status, 400);
    assert.equal(alphaNikRes.data.code, 'INVALID_NIK');
  });

  it('10. Step 3 (Identity): valid name and 16-digit NIK completes onboarding and unlocks POS access', async () => {
    const validIdentityRes = await request('POST', '/api/v1/auth/cashier-onboarding/identity', {
      name: 'Budi Santoso',
      nik: '1871020304050001'
    }, { 'Authorization': `Bearer ${cashierToken}` });

    assert.equal(validIdentityRes.status, 200);
    assert.equal(validIdentityRes.data.success, true);
    assert.equal(validIdentityRes.data.status, 'IDENTITY_COMPLETED');
    assert.equal(validIdentityRes.data.can_access_pos, true);
    assert.equal(validIdentityRes.data.user.name, 'Budi Santoso');
    assert.equal(validIdentityRes.data.user.nik_masked, '1871**********01');

    // Verify DB
    const row = db.prepare('SELECT full_name, nik, cashier_onboarding_status FROM users WHERE id = ?').get(cashierUser.id);
    assert.equal(row.full_name, 'Budi Santoso');
    assert.equal(row.nik, '1871020304050001');
    assert.equal(row.cashier_onboarding_status, 'IDENTITY_COMPLETED');
  });

  it('11. Cashier status endpoint reflects IDENTITY_COMPLETED with masked NIK', async () => {
    const statusRes = await request('GET', '/api/v1/auth/cashier-onboarding/status', null, {
      'Authorization': `Bearer ${cashierToken}`
    });

    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.data.status, 'IDENTITY_COMPLETED');
    assert.equal(statusRes.data.can_access_pos, true);
    assert.equal(statusRes.data.has_pin, true);
    assert.equal(statusRes.data.has_identity, true);
    assert.equal(statusRes.data.name, 'Budi Santoso');
    assert.equal(statusRes.data.nik_masked, '1871**********01');
  });

  it('12. Security Audit: Sensitive PIN and full NIK are never logged plaintext in audit log', async () => {
    const logs = db.prepare(`
      SELECT action, metadata FROM security_audit_log
      WHERE brand_id = ? AND action IN ('CASHIER_PIN_SET', 'CASHIER_IDENTITY_COMPLETED')
    `).all(testBrandId);

    assert.ok(logs.length >= 2, 'Must have at least PIN and IDENTITY audit logs');
    for (const log of logs) {
      assert.ok(!log.metadata.includes('123456'), 'Plaintext PIN must never appear in audit log');
      assert.ok(!log.metadata.includes('1871020304050001'), 'Full plaintext NIK must never appear in audit log');
      if (log.action === 'CASHIER_IDENTITY_COMPLETED') {
        assert.ok(log.metadata.includes('1871**********01'), 'Masked NIK is safely logged');
      }
    }
  });

  it('13. Frontend invite.html contract parity: contains non-dismissible PIN and Identity forms with flow classes', () => {
    const inviteHtml = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/invite.html'), 'utf8');

    assert.match(inviteHtml, /id="section-cashier-pin"/);
    assert.match(inviteHtml, /id="input-cashier-pin"/);
    assert.match(inviteHtml, /id="input-cashier-pin-confirm"/);
    assert.match(inviteHtml, /id="btn-submit-pin"/);
    assert.match(inviteHtml, /id="section-cashier-identity"/);
    assert.match(inviteHtml, /id="input-cashier-name"/);
    assert.match(inviteHtml, /id="input-cashier-nik"/);
    assert.match(inviteHtml, /id="btn-submit-identity"/);
    assert.match(inviteHtml, /\.x-btn-flow\.disabled/);
    assert.match(inviteHtml, /\.x-btn-flow\.enabled/);
    assert.match(inviteHtml, /\/auth\/cashier-onboarding\/pin/);
    assert.match(inviteHtml, /\/auth\/cashier-onboarding\/identity/);
  });

  it('14. In-POS profile update allows existing cashier to update full name and retain registered NIK', async () => {
    const updateRes = await request('POST', '/api/v1/auth/cashier-onboarding/identity', {
      name: 'Budi Santoso S.E.'
    }, { 'Authorization': `Bearer ${cashierToken}` });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.data.success, true);
    assert.equal(updateRes.data.user.name, 'Budi Santoso S.E.');
    assert.equal(updateRes.data.user.nik_masked, '1871**********01');

    const row = db.prepare('SELECT full_name, nik FROM users WHERE id = ?').get(cashierUser.id);
    assert.equal(row.full_name, 'Budi Santoso S.E.');
    assert.equal(row.nik, '1871020304050001');
  });

  it('15. POS app frontend wires profile modal to pos-user-profile-btn and provides profile styling', () => {
    const posJs = fs.readFileSync(path.join(__dirname, '../apps/pos-app/assets/js/pos-app.js'), 'utf8');
    const posCss = fs.readFileSync(path.join(__dirname, '../apps/pos-app/assets/css/pos.css'), 'utf8');

    assert.match(posJs, /openCashierProfileModal/);
    assert.match(posJs, /pos-user-profile-btn/);
    assert.match(posJs, /btn-save-cashier-profile/);
    assert.match(posJs, /pos-modal-close-icon/);
    assert.match(posJs, /pos-profile-avatar-btn/);
    assert.match(posJs, /pos-profile-avatar-input/);
    assert.match(posJs, /\/auth\/cashier-onboarding\/avatar/);
    assert.match(posCss, /\.pos-modal-close-icon/);
    assert.match(posCss, /\.pos-profile-card/);
    assert.match(posCss, /\.pos-profile-avatar/);
    assert.match(posCss, /\.pos-profile-avatar-badge/);
    assert.match(posCss, /\.pos-profile-nik-badge/);
    assert.match(posCss, /\.pos-btn-save-profile/);
  });

  it('16. Cashier avatar upload via Media Engine: processes image, updates user record, and protects reference', async () => {
    const { createPngBuffer } = require('./helpers/testImageHelper');
    const pngBuf = createPngBuffer(200, 200);
    const base64Data = 'data:image/png;base64,' + pngBuf.toString('base64');

    const uploadRes = await request('POST', '/api/v1/auth/cashier-onboarding/avatar', {
      image_base64: base64Data,
      mime_type: 'image/png',
      original_filename: 'cashier-budi.png'
    }, { 'Authorization': `Bearer ${cashierToken}` });

    assert.equal(uploadRes.status, 200);
    assert.equal(uploadRes.data.success, true);
    assert.ok(uploadRes.data.media_id);
    assert.ok(uploadRes.data.avatar_url);

    // Verify DB updated
    const userRow = db.prepare('SELECT avatar_url, avatar_media_id FROM users WHERE id = ?').get(cashierUser.id);
    assert.equal(userRow.avatar_media_id, uploadRes.data.media_id);
    assert.equal(userRow.avatar_url, uploadRes.data.avatar_url);

    // Verify onboarding status endpoint returns avatar_url
    const statusRes = await request('GET', '/api/v1/auth/cashier-onboarding/status', null, {
      'Authorization': `Bearer ${cashierToken}`
    });
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.data.avatar_url, uploadRes.data.avatar_url);

    // Verify MediaReferenceResolver identifies user_avatar reference (garbage collection protection)
    const { MediaReferenceResolver } = require('../core/media');
    const resolver = new MediaReferenceResolver();
    const refCheck = await resolver.checkReference({ mediaId: uploadRes.data.media_id, brandId: testBrandId });
    assert.equal(refCheck.isReferenced, true);
    const userRef = refCheck.references.find(r => r.type === 'user_avatar');
    assert.ok(userRef, 'Should find user_avatar reference in MediaReferenceResolver');
    assert.equal(userRef.id, cashierUser.id);
  });
});


