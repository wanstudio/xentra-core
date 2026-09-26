'use strict';

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const db = require('../../server/database/db');
const PosPinCredentialService = require('../../core/identity/PosPinCredentialService');

describe('POS Cashier PIN Credential', () => {
  const brandId = 'brand_bangjo';
  let branchId;

  before(() => {
    db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_bangjo', 'Bangjo Holding', 'bangjo-holding')").run();
    db.prepare("INSERT OR IGNORE INTO brands (id, organization_id, name, slug, custom_domain) VALUES ('brand_bangjo', 'org_bangjo', 'Bangjo', 'bangjo', 'app.mybangjo.com')").run();
    db.prepare("INSERT OR IGNORE INTO branches (id, brand_id, name, slug, whatsapp_number, address_text, is_active, latitude, longitude) VALUES ('branch_bangjo_main', 'brand_bangjo', 'Bangjo Pusat', 'bangjo-pusat', '62812345678', 'Jl. Sudirman', 1, -6.2, 106.8)").run();
  });

  beforeEach(() => {
    const branch = db.prepare('SELECT id FROM branches WHERE brand_id = ? ORDER BY id LIMIT 1').get(brandId);
    assert.ok(branch, 'A test branch must exist');
    branchId = branch.id;
    db.prepare("DELETE FROM users WHERE id LIKE 'usr_pin_test_%'").run();
  });

  test('PIN contract accepts exactly six digits and rejects non-six-digit values', () => {
    assert.equal(PosPinCredentialService.validatePin('123456'), true);
    assert.equal(PosPinCredentialService.validatePin('12345'), false);
    assert.equal(PosPinCredentialService.validatePin('1234567'), false);
    assert.equal(PosPinCredentialService.validatePin('12ab56'), false);
  });

  test('PIN verifier never stores the raw PIN and verifies deterministically', () => {
    const pin = '482731';
    const credential = PosPinCredentialService.createVerifier(pin);
    assert.equal(typeof credential.salt, 'string');
    assert.equal(typeof credential.hash, 'string');
    assert.notEqual(credential.hash, pin);
    assert.equal(PosPinCredentialService.verifyVerifier(pin, credential), true);
    assert.equal(PosPinCredentialService.verifyVerifier('482732', credential), false);
  });

  test('cashier can set a POS PIN and authenticate through the same user identity', () => {
    const userId = 'usr_pin_test_' + crypto.randomBytes(6).toString('hex');
    const username = 'cashier_pin_' + crypto.randomBytes(4).toString('hex');
    db.prepare(`
      INSERT INTO users (
        id, brand_id, organization_id, branch_id, username, email, password_hash,
        full_name, role, status, email_verified_at
      )
      VALUES (?, ?, 'org_xentra_holding', ?, ?, ?, NULL, 'PIN Test Cashier', 'cashier', 'active', datetime('now'))
    `).run(userId, brandId, branchId, username, username + '@test.invalid');

    const service = new PosPinCredentialService();
    const saved = service.setPinForSelf({ userId, brandId, pin: '482731' });
    assert.equal(saved.configured, true);
    assert.equal(saved.user.id, userId);
    assert.equal(saved.user.role, 'cashier');
    assert.equal(saved.user.branch_id, branchId);

    const row = db.prepare('SELECT pos_pin_salt, pos_pin_hash FROM users WHERE id = ?').get(userId);
    assert.ok(row.pos_pin_salt);
    assert.ok(row.pos_pin_hash);
    assert.equal(String(row.pos_pin_hash).includes('482731'), false);

    const terminalId = 'term_test_' + crypto.randomBytes(4).toString('hex');
    db.prepare(`
      INSERT INTO pos_terminals (id, branch_id, device_name, device_identifier, status)
      VALUES (?, ?, 'Test POS', 'pos_dev_1', 'active')
    `).run(terminalId, branchId);

    const auth = service.authenticateWithPin({ brandId, branchId, pin: '482731', terminalId });
    assert.equal(auth.success, true);
    assert.equal(auth.user.id, userId);
    assert.equal(auth.user.role, 'cashier');
    assert.equal(auth.user.branch_id, branchId);
    assert.ok(auth.offline_credential && auth.offline_credential.hash);
  });

  test('same POS PIN cannot identify two active cashiers in one branch', () => {
    const userA = 'usr_pin_test_' + crypto.randomBytes(6).toString('hex');
    const userB = 'usr_pin_test_' + crypto.randomBytes(6).toString('hex');
    const usernameA = 'cashier_pina_' + crypto.randomBytes(4).toString('hex');
    const usernameB = 'cashier_pinb_' + crypto.randomBytes(4).toString('hex');
    const insert = (id, username, name) => db.prepare(`
      INSERT INTO users (
        id, brand_id, organization_id, branch_id, username, email, password_hash,
        full_name, role, status, email_verified_at
      )
      VALUES (?, ?, 'org_xentra_holding', ?, ?, ?, NULL, ?, 'cashier', 'active', datetime('now'))
    `).run(id, brandId, branchId, username, username + '@test.invalid', name);
    insert(userA, usernameA, 'Cashier A');
    insert(userB, usernameB, 'Cashier B');
    const service = new PosPinCredentialService();
    service.setPinForSelf({ userId: userA, brandId, pin: '135790' });
    assert.throws(
      () => service.setPinForSelf({ userId: userB, brandId, pin: '135790' }),
      (err) => err && err.code === 'POS_PIN_IN_USE' && err.status === 409
    );
  });
});
