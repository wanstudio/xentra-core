#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config();
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'database', 'xentra.db');

(async () => {
  if (process.argv[2] === '--inspect') {
    console.log('dbPath=' + dbPath);
    console.log('fileExists=' + fs.existsSync(dbPath) + (fs.existsSync(dbPath) ? ' size=' + fs.statSync(dbPath).size : ''));
    let sqljsOk = false;
    try {
      sqljsOk = typeof require('sql.js') === 'function';
      console.log('sqljsRequire=ok');
    } catch (e) {
      console.log('sqljsRequire=FAIL ' + e.message);
    }
    try {
      const raw = fs.readFileSync(dbPath);
      console.log('fileHeader=' + JSON.stringify(raw.slice(0, 15).toString()));
      if (sqljsOk) {
        const SQL = require('sql.js');
        const rawDb = new SQL.Database(raw);
        const tables = rawDb.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name");
        console.log('tables=' + (tables[0] ? tables[0].values.map((v) => v[0]).join(',') : 'NONE'));
        const uc = rawDb.exec('SELECT COUNT(*) FROM users');
        console.log('usersCount=' + (uc[0] ? uc[0].values[0][0] : 'no table'));
        const tc = rawDb.exec('SELECT COUNT(*) FROM brands');
        console.log('brandsCount=' + (tc[0] ? tc[0].values[0][0] : 'no table'));
        const bc = rawDb.exec('SELECT COUNT(*) FROM branches');
        console.log('branchesCount=' + (bc[0] ? bc[0].values[0][0] : 'no table'));
        const br = rawDb.exec('SELECT id, name, custom_domain FROM brands LIMIT 5');
        console.log('brandRows=' + JSON.stringify(br));
      }
    } catch (e) {
      console.log('fileReadErr=' + e.message);
    }

    const db = require(path.join(__dirname, '..', 'server', 'database', 'db.js'));
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) {
      try {
        if (db.prepare('SELECT 1 AS alive').get()) ready = true;
      } catch (_) {}
      if (!ready) await sleep(50);
    }
    let engine = 'notReady';
    if (ready) {
      const probe = db.prepare('SELECT COUNT(*) AS c FROM brands').get();
      if (probe && typeof probe.c === 'number') engine = 'persistent';
      else if (probe && probe.id) engine = 'memoryStore';
      console.log('dbjsEngine=' + engine + ' probe=' + JSON.stringify(probe));
    } else {
      console.log('dbjsEngine=notReady');
    }
    process.exit(0);
  }

  const username = (process.argv[2] || '').trim();
  const credential = process.argv[3] || '';
  if (!username || !credential) {
    console.error('usage: node tools/reset-admin.js <username> [password-or-sha256hex] or --inspect');
    process.exit(2);
  }

  if (!/^(?:[a-z0-9._-]+)$/i.test(username)) {
    console.error('username must match [a-z0-9._-]+');
    process.exit(2);
  }

  const isHash = /^[a-f0-9]{64}$/i.test(credential);
  const passwordHash = isHash ? credential.toLowerCase() : crypto.createHash('sha256').update(credential).digest('hex');
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

  const engineProbe = db.prepare('SELECT COUNT(*) AS c FROM brands').get();
  const engine = engineProbe && typeof engineProbe.c === 'number' ? 'persistent' : (engineProbe && engineProbe.id ? 'memoryStore' : 'unknown');
  console.log('dbjsEngine=' + engine);
  if (engine === 'memoryStore') {
    console.error('ABORT: db.js fell back to memoryStore on this server (sql.js unavailable). Nothing can persist.');
    process.exit(1);
  }

  console.log('usersBefore=' + JSON.stringify(db.prepare('SELECT COUNT(*) AS c FROM users').get()));

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