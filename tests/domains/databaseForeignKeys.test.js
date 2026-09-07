'use strict';

const test = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const db = require('../../server/database/db');

// ==============================================================================
// SQL.JS & NATIVE SQLITE FOREIGN KEY ENFORCEMENT REGRESSION SUITE
// ==============================================================================

test('SQL.JS FK Enforcement — Case A: FK violation is rejected on insert', async () => {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();
  
  // Apply the same initialization policy as server/database/db.js
  sqlDb.run('PRAGMA foreign_keys = ON;');

  sqlDb.run('CREATE TABLE parent (id INTEGER PRIMARY KEY);');
  sqlDb.run(`
    CREATE TABLE child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE
    );
  `);

  // Attempt to insert child referencing non-existent parent 999
  assert.throws(
    () => {
      sqlDb.run('INSERT INTO child (parent_id) VALUES (999);');
    },
    /FOREIGN KEY constraint failed/i,
    'Inserting child with non-existent parent_id must fail under PRAGMA foreign_keys = ON'
  );
});

test('SQL.JS FK Enforcement — Case B: ON DELETE CASCADE automatically deletes children', async () => {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();
  
  // Apply the same initialization policy as server/database/db.js
  sqlDb.run('PRAGMA foreign_keys = ON;');

  sqlDb.run('CREATE TABLE parent (id INTEGER PRIMARY KEY);');
  sqlDb.run(`
    CREATE TABLE child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE
    );
  `);

  // Insert valid parent and child
  sqlDb.run('INSERT INTO parent (id) VALUES (1);');
  sqlDb.run('INSERT INTO child (id, parent_id) VALUES (10, 1);');

  const beforeDelete = sqlDb.exec('SELECT count(*) as cnt FROM child WHERE parent_id = 1;');
  assert.strictEqual(beforeDelete[0].values[0][0], 1, 'Child must exist before parent is deleted');

  // Delete parent
  sqlDb.run('DELETE FROM parent WHERE id = 1;');

  const afterDelete = sqlDb.exec('SELECT count(*) as cnt FROM child WHERE parent_id = 1;');
  assert.strictEqual(afterDelete[0].values[0][0], 0, 'Child must be automatically deleted via ON DELETE CASCADE');
});

test('SQL.JS FK Enforcement — Case C: Native runtime (current db) has foreign keys enabled and working', () => {
  // Verify that current db (whether native node:sqlite or fallback) has PRAGMA foreign_keys enabled
  const fkState = db.prepare('PRAGMA foreign_keys;').get();
  const fkValue = fkState ? Object.values(fkState)[0] : null;
  assert.strictEqual(Number(fkValue), 1, 'Current db instance must have PRAGMA foreign_keys = 1');

  // Verify FK violation rejection on current runtime
  assert.throws(
    () => {
      db.prepare(`
        INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone)
        VALUES ('br_fk_fail', 'non_existent_brand_999', 'Cabang Invalid', 'slug-invalid', 'Jl. X', -7.2, 112.7, '08123456789')
      `).run();
    },
    /FOREIGN KEY constraint failed/i,
    'Inserting branch with invalid brand_id must fail foreign key constraint'
  );
});
