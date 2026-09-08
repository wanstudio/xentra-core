#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config();
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const username = (process.argv[2] || '').trim();
  const credential = process.argv[3] || '';
  if (!username || !credential) {
    console.error('usage: node tools/reset-admin.js <username> [password-or-sha256hex]');
    process.exit(2);
  }

  if (!/^(?:[a-z0-9._-]+)$/i.test(username)) {
    console.error('username must match [a-z0-9._-]+');
    process.exit(2);
  }

  const isHash = /^[a-f0-9]{64}$/i.test(credential);
  const passwordHash = isHash ? credential.toLowerCase() : crypto.createHash('sha256').update(credential).digest('hex');
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'database', 'xentra.db');
  console.log('dbPath=' + dbPath);

  const db = require(path.join(__dirname, '..', 'server', 'database', 'db.js'));

  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    try {
      const row = db.prepare('SELECT 1 AS alive').get();
      if (row) ready = true;
    } catch (_) {}
    if (!ready) await sleep(50);
  }
  if (!ready) {
    console.error('Database is not ready.');
    process.exit(1);
  }

  console.log('usersBefore=' + JSON.stringify(db.prepare('SELECT COUNT(*) AS c FROM users').get()));
  console.log('brandsBefore=' + JSON.stringify(db.prepare('SELECT COUNT(*) AS c FROM brands').get()));
  console.log('usersColumns=' + JSON.stringify(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name + (c.notnull ? '!' : ''))));

  let brand = db.prepare("SELECT * FROM brands WHERE custom_domain = ?").get('app.mybangjo.com');
  if (!brand) brand = db.prepare("SELECT * FROM brands WHERE slug = ?").get('bangjo');
  if (!brand) brand = db.prepare("SELECT * FROM brands WHERE id = 'brand_bangjo'").get();
  if (!brand) brand = db.prepare("SELECT * FROM brands LIMIT 1").get();

  let organizationId = brand && brand.organization_id;
  if (organizationId === undefined || organizationId === null) {
    const org = db.prepare("SELECT id FROM organizations LIMIT 1").get();
    organizationId = org && org.id;
  }
  if (!brand || !organizationId) {
    console.error('No brand/organization found to attach the new user to.');
    process.exit(1);
  }
  console.log('targetBrand=' + brand.id + ' targetOrg=' + organizationId);

  const byUsername = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(username + '@bangjo.com');
  const existing = byUsername || byEmail;

  // db.exec propagates SQL errors instead of swallowing them like prepare().run() in sql.js mode.
  const esc = (v) => String(v).replace(/'/g, "''");

  if (existing) {
    db.exec("UPDATE users SET password_hash = '" + passwordHash + "', updated_at = datetime('now') WHERE id = '" + esc(existing.id) + "'");
    console.log('OK updated password for user ' + existing.id + ' (' + existing.username + ', role ' + existing.role + ')');
  } else {
    const id = 'usr_' + username;
    db.exec(
      "INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role) VALUES ('" +
        esc(id) + "', '" + esc(brand.id) + "', '" + esc(organizationId) + "', '" + esc(username) + "', '" +
        esc(username + '@bangjo.com') + "', '" + passwordHash + "', '" + esc(username) + "', 'owner')"
    );
    console.log('OK created user ' + id + ' (' + username + ', role owner, brand ' + brand.id + ')');
  }

  const verify = db.prepare('SELECT id, username, role, brand_id, password_hash FROM users WHERE username = ?').get(username);
  if (!verify || verify.password_hash !== passwordHash) {
    console.error('SANITY FAIL: user row not persisted correctly.');
    process.exit(1);
  }
  console.log('sanityOK id=' + verify.id + ' role=' + verify.role + ' brand=' + verify.brand_id);

  try {
    const tmpDir = path.join(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'restart.txt'), String(Date.now()));
    console.log('Passenger restart requested (tmp/restart.txt touched).');
  } catch (err) {
    console.warn('Could not touch tmp/restart.txt:', err.message);
  }
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});