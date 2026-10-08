'use strict';

const ensuredDbs = new WeakSet();

function ensureMaterialMasterSchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      material_code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      base_uom_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (base_uom_id) REFERENCES uoms(id) ON DELETE RESTRICT,
      UNIQUE (organization_id, material_code)
    );

    CREATE INDEX IF NOT EXISTS idx_materials_org_status
      ON materials(organization_id, status, material_code);

    CREATE TRIGGER IF NOT EXISTS trg_material_base_uom_insert
    BEFORE INSERT ON materials
    FOR EACH ROW
    WHEN
      (SELECT id FROM uoms WHERE id = NEW.base_uom_id) IS NULL
      OR
      (SELECT is_active FROM uoms WHERE id = NEW.base_uom_id) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'MATERIAL_BASE_UOM_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_material_base_uom_update
    BEFORE UPDATE OF base_uom_id ON materials
    FOR EACH ROW
    WHEN
      (SELECT id FROM uoms WHERE id = NEW.base_uom_id) IS NULL
      OR
      (SELECT is_active FROM uoms WHERE id = NEW.base_uom_id) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'MATERIAL_BASE_UOM_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_material_no_destructive_archive_insert
    BEFORE INSERT ON materials
    FOR EACH ROW
    WHEN trim(NEW.material_code) = '' OR trim(NEW.name) = ''
    BEGIN
      SELECT RAISE(ABORT, 'MATERIAL_IDENTITY_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_material_no_destructive_archive_update
    BEFORE UPDATE OF material_code, name ON materials
    FOR EACH ROW
    WHEN trim(NEW.material_code) = '' OR trim(NEW.name) = ''
    BEGIN
      SELECT RAISE(ABORT, 'MATERIAL_IDENTITY_INVALID');
    END;
  `);

  ensuredDbs.add(db);
}

module.exports = { ensureMaterialMasterSchema };
