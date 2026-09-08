#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config();
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'database', 'xentra.db');

const USERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    branch_id TEXT,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'owner',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`;

async function openDb() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const raw = fs.readFileSync(dbPath);
  return new SQL.Database(raw ? raw : Buffer.from(''));
}

function persist(SQL, rawDb) {
  const data = rawDb.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

(async () => {
  if (process.argv[2] === '--inspect') {
    console.log('dbPath=' + dbPath);
    console.log('fileExists=' + fs.existsSync(dbPath) + (fs.existsSync(dbPath) ? ' size=' + fs.statSync(dbPath).size : ''));
    if (!fs.existsSync(dbPath)) process.exit(0);
    const SQL = await require('sql.js')();
    const rawDb = new SQL.Database(fs.readFileSync(dbPath));
    const tables = rawDb.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name");
    console.log('tables=' + (tables[0] ? tables[0].values.map((v) => v[0]).join(',') : 'NONE'));
    for (const t of ['users', 'brands', 'branches']) {
      const r = rawDb.exec('SELECT COUNT(*) FROM ' + t);
      console.log(t + 'Count=' + (r[0] ? r[0].values[0][0] : 'no table'));
    }
    const br = rawDb.exec('SELECT id, name, custom_domain FROM brands LIMIT 5');
    console.log('brandRows=' + JSON.stringify(br));
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
  console.log('dbPath=' + dbPath + ' exists=' + fs.existsSync(dbPath));

  try {
    const SQL = await require('sql.js')();
    const rawDb = new SQL.Database(fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined);
    rawDb.run('PRAGMA foreign_keys = OFF;');
    rawDb.run(USERS_TABLE_SQL);
    rawDb.run('PRAGMA foreign_keys = ON;');

    let brand = rawDb.exec("SELECT * FROM brands WHERE custom_domain = 'app.mybangjo.com'");
    if (!brand[0] || !brand[0].values.length) brand = rawDb.exec("SELECT * FROM brands WHERE slug = 'bangjo'");
    const brandId = brand[0] ? brand[0].values[0][brand[0].columns.indexOf('id')] : null;
    let orgId = brand[0] ? brand[0].values[0][brand[0].columns.indexOf('organization_id')] : null;
    if (!orgId) {
      const org = rawDb.exec('SELECT id FROM organizations LIMIT 1');
      if (org[0] && org[0].values.length) orgId = org[0].values[0][0];
    }
    if (!brandId || !orgId) {
      console.error('No brand/organization found.');
      process.exit(1);
    }
    console.log('targetBrand=' + brandId + ' targetOrg=' + orgId);

    const existing = rawDb.exec('SELECT id FROM users WHERE username = ? OR email = ?', [username, username + '@bangjo.com']);
    if (existing[0] && existing[0].values.length) {
      const uid = existing[0].values[0][0];
      rawDb.run('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?', [passwordHash, uid]);
      console.log('OK updated password for user ' + uid + ' (' + username + ')');
    } else {
      const uid = 'usr_' + username;
      rawDb.run(
        'INSERT INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uid, brandId, orgId, username, username + '@bangjo.com', passwordHash, username, 'owner']
      );
      console.log('OK created user ' + uid + ' (' + username + ', role owner, brand ' + brandId + ')');
    }

    persist(SQL, rawDb);

    const check = new SQL.Database(fs.readFileSync(dbPath));
    const v = check.exec('SELECT id, username, role, brand_id, password_hash FROM users WHERE username = ?', [username]);
    const row = v[0] && v[0].values[0] ? v[0].values[0] : null;
    if (!row || row[4] !== passwordHash) {
      console.error('SANITY FAIL: user row not persisted correctly.');
      process.exit(1);
    }
    console.log('sanityOK id=' + row[0] + ' role=' + row[2] + ' brand=' + row[3]);

    try {
      const tmpDir = path.join(__dirname, '..', 'tmp');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'restart.txt'), String(Date.now()));
      console.log('Passenger restart requested (tmp/restart.txt touched).');
    } catch (err) {
      console.warn('Could not touch tmp/restart.txt:', err.message);
    }
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exit(1);
  }
})().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});