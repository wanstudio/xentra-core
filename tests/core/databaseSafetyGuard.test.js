'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '../..');
const prodDbPath = path.resolve(rootDir, 'server/database/xentra.db');

test('Production Database Safety Guard — blocks running tests with production DB_PATH', () => {
  // Verify that attempting to initialize db with NODE_ENV=test and production DB_PATH throws
  assert.throws(() => {
    const { execSync } = require('child_process');
    execSync(`node -e "process.env.NODE_ENV='test'; process.env.DB_PATH='${prodDbPath}'; require('./server/database/db.js');"`, {
      cwd: rootDir,
      stdio: 'pipe'
    });
  }, (err) => {
    const output = err.stderr ? err.stderr.toString() : err.message;
    return output.includes('Refusing to run tests against the production database path');
  }, 'Database safety guard must throw and refuse production DB path in test environment');
});

test('Production Database Safety Guard — blocks running tests when npm_lifecycle_event=test without NODE_ENV=test', () => {
  assert.throws(() => {
    const { execSync } = require('child_process');
    execSync(`node -e "delete process.env.NODE_ENV; process.env.npm_lifecycle_event='test'; require('./server/database/db.js');"`, {
      cwd: rootDir,
      stdio: 'pipe'
    });
  }, (err) => {
    const output = err.stderr ? err.stderr.toString() : err.message;
    return output.includes('Running tests without NODE_ENV=test is strictly prohibited');
  }, 'Database safety guard must block execution when test lifecycle is detected without NODE_ENV=test');
});

test('Production Database Safety Guard — server/app.js does not load production .env when NODE_ENV=test', () => {
  const { execSync } = require('child_process');
  const result = execSync(`node -e "process.env.NODE_ENV='test'; require('./server/app.js'); console.log('RESOLVED_NODE_ENV:' + process.env.NODE_ENV);"`, {
    cwd: rootDir,
    stdio: 'pipe'
  }).toString();

  assert.ok(result.includes('RESOLVED_NODE_ENV:test'), 'NODE_ENV must remain test and not be overwritten by dotenv');
});

test('Production Database Safety Guard — rejects symlink pointing to production DB', (t) => {
  if (!fs.existsSync(prodDbPath)) {
    t.skip('Production DB is not present in CI; production-path symlink behavior requires a real production DB fixture.');
    return;
  }
  const os = require('os');
  const tmpSymlink = path.join(os.tmpdir(), 'symlink_to_prod_' + Date.now() + '.db');
  try {
    fs.symlinkSync(prodDbPath, tmpSymlink);
    assert.throws(() => {
      const { execSync } = require('child_process');
      execSync(`node -e "process.env.NODE_ENV='test'; process.env.DB_PATH='${tmpSymlink}'; require('./server/database/db.js');"`, {
        cwd: rootDir,
        stdio: 'pipe'
      });
    }, (err) => {
      const output = err.stderr ? err.stderr.toString() : err.message;
      return output.includes('Refusing to run tests against the production database path');
    }, 'Must reject symlink to production DB');
  } finally {
    try { fs.unlinkSync(tmpSymlink); } catch (_) {}
  }
});

test('Production Database Safety Guard — raw node --test defaults to memory DB without writing to xentra.db', () => {
  const { execSync } = require('child_process');
  const tmpTestFile = path.join(rootDir, 'tests/tempIsolationProbe.test.js');
  try {
    fs.writeFileSync(tmpTestFile, "const db = require('../server/database/db'); const dbs = db.prepare('PRAGMA database_list').all(); console.log('ACTIVE_DB_FILE:' + (dbs[0] ? dbs[0].file : 'none'));");
    const cleanEnv = { ...process.env };
    delete cleanEnv.NODE_TEST_CONTEXT;
    delete cleanEnv.NODE_TEST_WORKER_ID;
    delete cleanEnv.NODE_ENV;
    delete cleanEnv.npm_lifecycle_event;

    const output = execSync(`"${process.execPath}" --test "${tmpTestFile}"`, {
      cwd: rootDir,
      env: cleanEnv,
      encoding: 'utf8'
    });
    assert.ok(output.includes('ACTIVE_DB_FILE:'), 'Must log active DB file. Output: ' + output);
    // An in-memory database in SQLite has an empty string "" for file
    assert.ok(!output.includes('xentra.db'), 'Must NOT point to xentra.db');
  } finally {
    try { fs.unlinkSync(tmpTestFile); } catch (_) {}
  }
});

test('Production Database Safety Guard — dummy test fixtures do not leak to production database', (t) => {
  if (!fs.existsSync(prodDbPath)) {
    t.skip('Production DB is not present in CI; this check is a deployment-host invariant.');
    return;
  }
  const { DatabaseSync } = require('node:sqlite');
  const prodDb = new DatabaseSync(prodDbPath, { readOnly: true });

  const dummyBranch = prodDb.prepare("SELECT * FROM branches WHERE name = 'Branch Test' OR id = 'branch_sec_01'").all();
  assert.strictEqual(dummyBranch.length, 0, 'No dummy branches should exist in production DB');

  const bangjo = prodDb.prepare("SELECT id, name FROM branches WHERE id = 'branch_1789606246242_08knv'").get();
  assert.ok(bangjo, 'Bangjo Pringsewu must remain untouched in production DB');
  assert.strictEqual(bangjo.name, 'Bangjo Pringsewu');
});
