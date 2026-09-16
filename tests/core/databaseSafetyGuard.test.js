'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '../..');
const prodDbPath = path.resolve(rootDir, 'server/database/xentra.db');

test('Production Database Safety Guard — blocks running tests with production DB_PATH', () => {
  assert.ok(fs.existsSync(prodDbPath), 'Production DB path must exist to test defense');

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
