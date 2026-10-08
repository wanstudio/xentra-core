'use strict';

const ensuredDbs = new WeakSet();

function ensureProductionSchema(db) {
  if (!db) db = require('../../../core/data/DataAccess');
  if (ensuredDbs.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS production_items (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      output_product_id TEXT NOT NULL,
      production_item_code TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (organization_id, production_item_code),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (output_product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_production_items_output_status
      ON production_items(output_product_id, status, production_item_code);

    CREATE TABLE IF NOT EXISTS production_item_locations (
      id TEXT PRIMARY KEY,
      production_item_id TEXT NOT NULL,
      stock_location_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (production_item_id, stock_location_id),
      FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE CASCADE,
      FOREIGN KEY (stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_production_item_locations_location
      ON production_item_locations(stock_location_id, is_active, production_item_id);

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      production_item_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recipe_versions (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      version_number INTEGER NOT NULL CHECK (version_number > 0),
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
      planned_yield_quantity REAL NOT NULL CHECK (planned_yield_quantity > 0),
      yield_uom_id TEXT NOT NULL,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (recipe_id, version_number),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      FOREIGN KEY (yield_uom_id) REFERENCES uoms(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_recipe_versions_recipe_status
      ON recipe_versions(recipe_id, status, version_number DESC);

    CREATE TABLE IF NOT EXISTS recipe_components (
      id TEXT PRIMARY KEY,
      recipe_version_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      planned_quantity REAL NOT NULL CHECK (planned_quantity > 0),
      planned_uom_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id) ON DELETE CASCADE,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
      FOREIGN KEY (planned_uom_id) REFERENCES uoms(id) ON DELETE RESTRICT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_components_version_material
      ON recipe_components(recipe_version_id, material_id);

    CREATE TABLE IF NOT EXISTS production_batches (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      production_item_id TEXT NOT NULL,
      recipe_version_id TEXT NOT NULL,
      production_stock_location_id TEXT NOT NULL,
      input_stock_location_id TEXT NOT NULL,
      output_stock_location_id TEXT NOT NULL,
      planned_output_quantity REAL NOT NULL CHECK (planned_output_quantity > 0),
      actual_output_quantity REAL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
      production_posting_id TEXT UNIQUE,
      started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      cancelled_reason TEXT,
      created_by TEXT,
      started_by TEXT,
      completed_by TEXT,
      cancelled_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (production_stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT,
      FOREIGN KEY (input_stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT,
      FOREIGN KEY (output_stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_production_batches_execution
      ON production_batches(production_stock_location_id, status, created_at);

    CREATE INDEX IF NOT EXISTS idx_production_batches_item
      ON production_batches(production_item_id, recipe_version_id, status);

    CREATE TABLE IF NOT EXISTS production_batch_material_consumptions (
      id TEXT PRIMARY KEY,
      production_batch_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      input_stock_location_id TEXT NOT NULL,
      source_uom_id TEXT NOT NULL,
      actual_source_quantity REAL NOT NULL CHECK (actual_source_quantity > 0),
      actual_base_quantity REAL NOT NULL CHECK (actual_base_quantity > 0),
      resolved_unit_cost REAL NOT NULL CHECK (resolved_unit_cost >= 0),
      total_cost REAL NOT NULL CHECK (total_cost >= 0),
      currency_code TEXT NOT NULL CHECK (currency_code GLOB '[A-Z][A-Z][A-Z]'),
      inventory_movement_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (production_batch_id) REFERENCES production_batches(id) ON DELETE RESTRICT,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
      FOREIGN KEY (input_stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT,
      CHECK (abs(total_cost - (actual_base_quantity * resolved_unit_cost)) <= 0.000001)
    );

    CREATE INDEX IF NOT EXISTS idx_production_consumption_batch
      ON production_batch_material_consumptions(production_batch_id, material_id);

    CREATE TABLE IF NOT EXISTS production_cost_snapshots (
      id TEXT PRIMARY KEY,
      production_batch_id TEXT NOT NULL UNIQUE,
      production_posting_id TEXT NOT NULL UNIQUE,
      actual_material_cost REAL NOT NULL CHECK (actual_material_cost >= 0),
      actual_output_quantity REAL NOT NULL CHECK (actual_output_quantity > 0),
      production_output_unit_cost REAL NOT NULL CHECK (production_output_unit_cost >= 0),
      currency_code TEXT NOT NULL CHECK (currency_code GLOB '[A-Z][A-Z][A-Z]'),
      cost_availability_status TEXT NOT NULL DEFAULT 'AVAILABLE'
        CHECK (cost_availability_status IN ('AVAILABLE', 'ESTIMATED', 'UNAVAILABLE')),
      snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK (snapshot_version = 1),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (production_batch_id) REFERENCES production_batches(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_production_cost_snapshots_posting
      ON production_cost_snapshots(production_posting_id);

    CREATE TABLE IF NOT EXISTS production_cost_snapshot_lines (
      id TEXT PRIMARY KEY,
      production_cost_snapshot_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      input_stock_location_id TEXT NOT NULL,
      actual_base_quantity REAL NOT NULL CHECK (actual_base_quantity > 0),
      resolved_unit_cost REAL NOT NULL CHECK (resolved_unit_cost >= 0),
      total_cost REAL NOT NULL CHECK (total_cost >= 0),
      currency_code TEXT NOT NULL CHECK (currency_code GLOB '[A-Z][A-Z][A-Z]'),
      inventory_movement_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (production_cost_snapshot_id) REFERENCES production_cost_snapshots(id) ON DELETE RESTRICT,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
      FOREIGN KEY (input_stock_location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT,
      CHECK (abs(total_cost - (actual_base_quantity * resolved_unit_cost)) <= 0.000001)
    );

    CREATE INDEX IF NOT EXISTS idx_production_cost_snapshot_lines_snapshot
      ON production_cost_snapshot_lines(production_cost_snapshot_id);

    CREATE TRIGGER IF NOT EXISTS trg_production_item_org_scope
    BEFORE INSERT ON production_items
    FOR EACH ROW
    WHEN
      (SELECT organization_id FROM brands b JOIN products p ON p.brand_id = b.id WHERE p.id = NEW.output_product_id) <> NEW.organization_id
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCTION_ITEM_ORG_SCOPE_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_item_location_scope
    BEFORE INSERT ON production_item_locations
    FOR EACH ROW
    WHEN
      (SELECT id FROM production_items WHERE id = NEW.production_item_id) IS NULL
      OR
      (SELECT organization_id FROM production_items WHERE id = NEW.production_item_id) <>
      (SELECT organization_id FROM stock_locations WHERE id = NEW.stock_location_id)
      OR
      (SELECT is_active FROM stock_locations WHERE id = NEW.stock_location_id) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCTION_LOCATION_SCOPE_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_item_location_scope_update
    BEFORE UPDATE OF production_item_id, stock_location_id, is_active ON production_item_locations
    FOR EACH ROW
    WHEN NEW.is_active = 1
      AND (
        (SELECT id FROM production_items WHERE id = NEW.production_item_id) IS NULL
        OR
        (SELECT organization_id FROM production_items WHERE id = NEW.production_item_id) <>
        (SELECT organization_id FROM stock_locations WHERE id = NEW.stock_location_id)
        OR
        (SELECT is_active FROM stock_locations WHERE id = NEW.stock_location_id) <> 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCTION_LOCATION_SCOPE_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_route_single_active
    BEFORE INSERT ON production_item_locations
    FOR EACH ROW
    WHEN NEW.is_active = 1
      AND EXISTS (
        SELECT 1
          FROM production_item_locations pil
          JOIN production_items pi ON pi.id = pil.production_item_id
         WHERE pil.stock_location_id = NEW.stock_location_id
           AND pil.is_active = 1
           AND pi.output_product_id = (SELECT output_product_id FROM production_items WHERE id = NEW.production_item_id)
           AND pil.production_item_id <> NEW.production_item_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCTION_ROUTE_AMBIGUOUS');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_route_single_active_update
    BEFORE UPDATE OF production_item_id, stock_location_id, is_active ON production_item_locations
    FOR EACH ROW
    WHEN NEW.is_active = 1
      AND EXISTS (
        SELECT 1
          FROM production_item_locations pil
          JOIN production_items pi ON pi.id = pil.production_item_id
         WHERE pil.stock_location_id = NEW.stock_location_id
           AND pil.is_active = 1
           AND pi.output_product_id = (SELECT output_product_id FROM production_items WHERE id = NEW.production_item_id)
           AND pil.id <> NEW.id
      )
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCTION_ROUTE_AMBIGUOUS');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_recipe_version_yield_uom_active
    BEFORE INSERT ON recipe_versions
    FOR EACH ROW
    WHEN (SELECT is_active FROM uoms WHERE id = NEW.yield_uom_id) <> 1
      OR (SELECT id FROM uoms WHERE id = NEW.yield_uom_id) IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'YIELD_UOM_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_recipe_component_uom_active
    BEFORE INSERT ON recipe_components
    FOR EACH ROW
    WHEN (SELECT is_active FROM uoms WHERE id = NEW.planned_uom_id) <> 1
      OR (SELECT id FROM uoms WHERE id = NEW.planned_uom_id) IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'RECIPE_COMPONENT_UOM_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_recipe_component_material_scope
    BEFORE INSERT ON recipe_components
    FOR EACH ROW
    WHEN
      (SELECT id FROM materials WHERE id = NEW.material_id) IS NULL
      OR
      (SELECT pi.organization_id
         FROM recipes r
         JOIN production_items pi ON pi.id = r.production_item_id
        WHERE r.id = (SELECT recipe_id FROM recipe_versions WHERE id = NEW.recipe_version_id))
      <>
      (SELECT organization_id FROM materials WHERE id = NEW.material_id)
    BEGIN
      SELECT RAISE(ABORT, 'MATERIAL_ORG_SCOPE_INVALID');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_recipe_version_immutable
    BEFORE UPDATE OF recipe_id, version_number, planned_yield_quantity, yield_uom_id, published_at
    ON recipe_versions
    FOR EACH ROW
    WHEN OLD.status = 'PUBLISHED'
    BEGIN
      SELECT RAISE(ABORT, 'PUBLISHED_RECIPE_VERSION_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_recipe_version_publish_only_once
    BEFORE UPDATE OF status ON recipe_versions
    FOR EACH ROW
    WHEN OLD.status = 'PUBLISHED' AND NEW.status <> 'PUBLISHED'
      AND EXISTS (
        SELECT 1 FROM production_batches WHERE recipe_version_id = OLD.id
      )
    BEGIN
      SELECT RAISE(ABORT, 'PUBLISHED_RECIPE_VERSION_RETIRED_AFTER_REFERENCE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_batch_completed_immutable
    BEFORE UPDATE OF production_item_id, recipe_version_id, production_stock_location_id,
      input_stock_location_id, output_stock_location_id, actual_output_quantity, production_posting_id
    ON production_batches
    FOR EACH ROW
    WHEN OLD.status = 'COMPLETED'
    BEGIN
      SELECT RAISE(ABORT, 'COMPLETED_PRODUCTION_BATCH_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_cost_snapshot_immutable_upd
    BEFORE UPDATE ON production_cost_snapshots
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCTION_COST_SNAPSHOT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_cost_snapshot_immutable_del
    BEFORE DELETE ON production_cost_snapshots
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCTION_COST_SNAPSHOT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_cost_snapshot_line_immutable_upd
    BEFORE UPDATE ON production_cost_snapshot_lines
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCTION_COST_SNAPSHOT_LINE_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_production_cost_snapshot_line_immutable_del
    BEFORE DELETE ON production_cost_snapshot_lines
    FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'PRODUCTION_COST_SNAPSHOT_LINE_IMMUTABLE');
    END;
  `);

  ensuredDbs.add(db);
}

module.exports = { ensureProductionSchema };
