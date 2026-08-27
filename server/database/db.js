const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'xentra.db');

// Ensure db directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let dbInstance = null;
let sqlJsPromise = null;
let rawSqlDb = null;

// 1. Try Native Node 22.5+ / Node 24 SQLite (Synchronous)
try {
  const { DatabaseSync } = require('node:sqlite');
  dbInstance = new DatabaseSync(DB_PATH);
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');
  console.log('[Database] Native node:sqlite initialized successfully.');
} catch (e) {
  console.log('[Database] node:sqlite unavailable. Initializing portable sql.js engine for Node 20...');
  const initSqlJs = require('sql.js/dist/sql-asm.js');
  sqlJsPromise = initSqlJs().then(SQL => {
    if (fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      rawSqlDb = new SQL.Database(fileBuffer);
    } else {
      rawSqlDb = new SQL.Database();
    }
    return rawSqlDb;
  });
}

function saveSqlJsToDisk() {
  if (!rawSqlDb) return;
  try {
    const data = rawSqlDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[Database] Failed to write sql.js to disk:', err);
  }
}

// Database Proxy supporting both Native & Portable Engines
const db = {
  exec: (sql) => {
    if (dbInstance) {
      return dbInstance.exec(sql);
    }
    if (rawSqlDb) {
      const res = rawSqlDb.run(sql);
      saveSqlJsToDisk();
      return res;
    }
    // If not yet ready, run on ready
    sqlJsPromise.then(d => {
      d.run(sql);
      saveSqlJsToDisk();
    });
  },
  prepare: (sql) => {
    if (dbInstance) {
      return dbInstance.prepare(sql);
    }
    return {
      all: (...params) => {
        if (!rawSqlDb) return [];
        const stmt = rawSqlDb.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      },
      get: (...params) => {
        if (!rawSqlDb) return undefined;
        const stmt = rawSqlDb.prepare(sql);
        stmt.bind(params);
        let row = undefined;
        if (stmt.step()) {
          row = stmt.getAsObject();
        }
        stmt.free();
        return row;
      },
      run: (...params) => {
        if (!rawSqlDb) return { changes: 0 };
        const stmt = rawSqlDb.prepare(sql);
        stmt.bind(params);
        stmt.step();
        stmt.free();
        saveSqlJsToDisk();
        return { changes: 1 };
      }
    };
  }
};

function initSchema(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'pro',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS brands (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      logo_url TEXT,
      primary_color TEXT DEFAULT '#b6ff00',
      custom_domain TEXT UNIQUE,
      default_payment_config TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      address_text TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      phone TEXT,
      is_active INTEGER DEFAULT 1,
      is_open_override INTEGER DEFAULT 1,
      payment_config_override TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS branch_delivery_settings (
      id TEXT PRIMARY KEY,
      branch_id TEXT UNIQUE NOT NULL,
      is_delivery_active INTEGER DEFAULT 1,
      is_pickup_active INTEGER DEFAULT 1,
      max_radius_km REAL DEFAULT 10.0,
      free_delivery_km REAL DEFAULT 2.0,
      price_per_km REAL DEFAULT 3000.0,
      min_order_amount REAL DEFAULT 15000.0,
      promo_delivery_discount REAL DEFAULT 0.0,
      promo_min_order REAL DEFAULT 0.0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      brand_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      order_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      subtotal REAL NOT NULL,
      delivery_fee REAL DEFAULT 0.0,
      discount_amount REAL DEFAULT 0.0,
      total_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      order_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      item_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_deliveries (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      recipient_address TEXT NOT NULL,
      recipient_lat REAL NOT NULL,
      recipient_lng REAL NOT NULL,
      distance_km REAL NOT NULL,
      delivery_fee_calculated REAL NOT NULL,
      delivery_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_status_logs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS midtrans_transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      snap_token TEXT,
      snap_redirect_url TEXT,
      payment_type TEXT,
      transaction_status TEXT,
      fraud_status TEXT,
      gross_amount REAL NOT NULL,
      midtrans_response_raw TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );
  `);

  seedData(targetDb);
}

function seedData(targetDb) {
  const orgCheck = targetDb.prepare('SELECT id FROM organizations LIMIT 1').get();
  if (orgCheck) return;

  const orgId = 'org_xentra_holding';
  const brandId = 'brand_bangjo_master';
  const branchBaratId = 'branch_bangjo_barat';
  const branchTimurId = 'branch_bangjo_timur';

  targetDb.prepare(`
    INSERT INTO organizations (id, name, slug, plan)
    VALUES (?, ?, ?, ?)
  `).run(orgId, 'Xentra Holding Group', 'xentra-holding', 'enterprise');

  targetDb.prepare(`
    INSERT INTO brands (id, organization_id, name, slug, logo_url, primary_color, custom_domain)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    brandId,
    orgId,
    'Bangjo Resto',
    'bangjo',
    'https://app.mybangjo.com/wp-content/plugins/xentra-mvp/assets/icons/logo_bangjo.png',
    '#b6ff00',
    'app.mybangjo.com'
  );

  targetDb.prepare(`
    INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    branchBaratId,
    brandId,
    'Bangjo Surabaya Barat',
    'surabaya-barat',
    'Jl. Mayjen Sungkono No. 88, Surabaya Barat',
    -7.2912,
    112.7154,
    '081234567890'
  );

  targetDb.prepare(`
    INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    branchTimurId,
    brandId,
    'Bangjo Surabaya Timur',
    'surabaya-timur',
    'Jl. Kertajaya Indah No. 42, Surabaya Timur',
    -7.2785,
    112.7821,
    '081234567891'
  );

  targetDb.prepare(`
    INSERT INTO branch_delivery_settings (id, branch_id, max_radius_km, free_delivery_km, price_per_km, min_order_amount, promo_delivery_discount, promo_min_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('bds_barat', branchBaratId, 12.0, 2.0, 3000.0, 15000.0, 5000.0, 50000.0);

  targetDb.prepare(`
    INSERT INTO branch_delivery_settings (id, branch_id, max_radius_km, free_delivery_km, price_per_km, min_order_amount, promo_delivery_discount, promo_min_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('bds_timur', branchTimurId, 10.0, 2.0, 3000.0, 15000.0, 5000.0, 50000.0);

  const catMakan = 'cat_makanan';
  const catMinum = 'cat_minuman';
  const catSnack = 'cat_snack';

  targetDb.prepare(`INSERT INTO categories (id, brand_id, name, slug, sort_order) VALUES (?, ?, ?, ?, ?)`).run(catMakan, brandId, 'Makanan Utama', 'makanan-utama', 1);
  targetDb.prepare(`INSERT INTO categories (id, brand_id, name, slug, sort_order) VALUES (?, ?, ?, ?, ?)`).run(catMinum, brandId, 'Minuman Segar', 'minuman-segar', 2);
  targetDb.prepare(`INSERT INTO categories (id, brand_id, name, slug, sort_order) VALUES (?, ?, ?, ?, ?)`).run(catSnack, brandId, 'Camilan & Side', 'camilan', 3);

  const products = [
    { id: 'prod_1', cat: catMakan, name: 'Ayam Bakar Madu Bangjo', price: 28000, desc: 'Ayam bakar dengan lumuran madu asli rempah khas Bangjo.' },
    { id: 'prod_2', cat: catMakan, name: 'Bebek Goreng Crispy', price: 34000, desc: 'Bebek ungkep gurih digoreng renyah dengan sambal korek pedas.' },
    { id: 'prod_3', cat: catMakan, name: 'Nasi Goreng Spesial Bangjo', price: 25000, desc: 'Nasi goreng racikan istimewa telur mata sapi dan acar.' },
    { id: 'prod_4', cat: catMinum, name: 'Es Teh Manis Jumbo', price: 6000, desc: 'Teh melati seduh dingin segar porsi besar.' },
    { id: 'prod_5', cat: catMinum, name: 'Es Jeruk Peras Asli', price: 10000, desc: 'Jeruk peras murni tanpa pengawet.' },
  ];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    targetDb.prepare(`
      INSERT INTO products (id, brand_id, category_id, name, slug, description, price, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, brandId, p.cat, p.name, p.name.toLowerCase().replace(/ /g, '-'), p.desc, p.price, i + 1);
  }
}

// Auto-run schema initialization
if (dbInstance) {
  initSchema(db);
} else if (sqlJsPromise) {
  sqlJsPromise.then(raw => {
    initSchema(db);
  });
}

module.exports = db;
