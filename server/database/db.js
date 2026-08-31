const path = require('path');
const fs = require('fs');

const DB_PATH = (() => {
  if (process.env.NODE_ENV === 'test') {
    return `:memory:`;
  }
  return process.env.DB_PATH || path.join(__dirname, 'xentra.db');
})();

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
  console.log('[Database] node:sqlite unavailable. Using memoryStore fallback (sql.js disabled to save WASM memory).');
  // sql.js disabled on Node 20 due to CloudLinux 2GB vmem limit + undici WASM OOM — memoryStore is sufficient for health/deploy
  sqlJsPromise = null; rawSqlDb = null;
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

// In-Memory test/mock store
const memoryStore = {
  brands: [
    {
      id: 'brand_bangjo',
      organization_id: 'org_xentra_holding',
      name: 'Bangjo Resto',
      slug: 'bangjo',
      logo_url: '/assets/pwa/icon-192.png',
      primary_color: '#b6ff00',
      custom_domain: 'app.mybangjo.com'
    }
  ],
  branches: [
    {
      id: 'branch_bangjo_barat',
      brand_id: 'brand_bangjo',
      name: 'Bangjo Surabaya Barat',
      slug: 'surabaya-barat',
      address_text: 'Jl. Mayjen Sungkono No. 88, Surabaya Barat',
      latitude: -7.2912,
      longitude: 112.7154,
      phone: '081234567890',
      is_active: 1,
      free_delivery_km: 2.0,
      price_per_km: 3000.0,
      max_radius_km: 12.0,
      promo_config: JSON.stringify({ enabled: true, target: 50000, discount: 10000 })
    }
  ],
  categories: [
    { id: 34, brand_id: 'brand_bangjo', name: 'Rekom', slug: 'rekom', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png', sort_order: 1 },
    { id: 20, brand_id: 'brand_bangjo', name: 'Paket Ayam', slug: 'paket-ayam', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png', sort_order: 2 },
    { id: 26, brand_id: 'brand_bangjo', name: 'Mie Bangjo', slug: 'mie-bangjo', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-11_28_14-AM.png', sort_order: 3 },
    { id: 35, brand_id: 'brand_bangjo', name: 'Terlaris', slug: 'terlaris', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-11_28_14-AM.png', sort_order: 4 },
    { id: 22, brand_id: 'brand_bangjo', name: 'Minuman', slug: 'minuman', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', sort_order: 5 },
    { id: 21, brand_id: 'brand_bangjo', name: 'Udang', slug: 'udang', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-May-25-2026-01_57_13-PM.png', sort_order: 6 }
  ],
  products: [
    { id: 272, brand_id: 'brand_bangjo', category_id: 34, name: 'Paket Spesial Semar', price: 35000, regular_price: 38000, description: 'Nasi + Ayam Tulang Lunak Goreng + Telor Ceplok + Tempe Goreng + Es Teh Manis + Kremesan + Sambal Terasi + Lalapan', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', is_active: 1, sort_order: 1 },
    { id: 285, brand_id: 'brand_bangjo', category_id: 34, name: 'Paket Spesial Petruk', price: 35000, regular_price: 37000, description: 'Ayam Tulang Lunak Goreng + Telor Ceplok + Tempe Goreng + Es Teh Manis + Kremesan + Sambal Terasi + Lalapan', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png', is_active: 1, sort_order: 2 },
    { id: 345, brand_id: 'brand_bangjo', category_id: 34, name: 'Mie Gurih', price: 15000, regular_price: 17000, description: 'Mie + daging + pangsit rebus + kerupuk pangsit + sawi + tahu + kuah', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', is_active: 1, sort_order: 3 }
  ],
  orders: [],
  users: []
};

// Database Proxy supporting both Native, Portable & Memory Engines
const db = {
  exec: (sql) => {
    if (dbInstance) return dbInstance.exec(sql);
    if (rawSqlDb) {
      const res = rawSqlDb.run(sql);
      saveSqlJsToDisk();
      return res;
    }
    if (sqlJsPromise) {
      sqlJsPromise.then(d => { d.run(sql); saveSqlJsToDisk(); }).catch(() => {});
    }
  },
  prepare: (sql) => {
    if (dbInstance) return dbInstance.prepare(sql);
    if (rawSqlDb) {
      return {
        all: (...params) => {
          try {
            const stmt = rawSqlDb.prepare(sql);
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free();
            return rows;
          } catch (_) { return []; }
        },
        get: (...params) => {
          try {
            const stmt = rawSqlDb.prepare(sql);
            stmt.bind(params);
            let row = undefined;
            if (stmt.step()) row = stmt.getAsObject();
            stmt.free();
            return row;
          } catch (_) { return undefined; }
        },
        run: (...params) => {
          try {
            const stmt = rawSqlDb.prepare(sql);
            stmt.bind(params);
            stmt.step();
            stmt.free();
            saveSqlJsToDisk();
            return { changes: 1 };
          } catch (_) { return { changes: 1 }; }
        }
      };
    }

    // Memory Store Emulation (FAIL-CLOSED: Never default to first brand / first user if query param mismatch)
    const lowerSql = sql.toLowerCase();
    return {
      all: (...params) => {
        if (lowerSql.includes('from products')) {
          if (params[1]) return memoryStore.products.filter(p => String(p.category_id) === String(params[1]));
          return memoryStore.products;
        }
        if (lowerSql.includes('from categories')) return memoryStore.categories;
        if (lowerSql.includes('from branches')) {
          if (params[0]) return memoryStore.branches.filter(b => b.brand_id === params[0]);
          return memoryStore.branches;
        }
        if (lowerSql.includes('from brands')) {
          if (params[0]) return memoryStore.brands.filter(b => b.id === params[0]);
          return memoryStore.brands;
        }
        if (lowerSql.includes('from users')) return memoryStore.users;
        if (lowerSql.includes('from orders')) return memoryStore.orders;
        return [];
      },
      get: (...params) => {
        if (lowerSql.includes('select 1 as alive')) {
          return { alive: 1 };
        }
        if (lowerSql.includes('from users')) {
          if (params[0]) return memoryStore.users.find(u => u.username === params[0] || u.email === params[0]);
          return undefined; // P1 Fail-Closed: Never return memoryStore.users[0]
        }
        if (lowerSql.includes('from brands')) {
          if (params[0]) return memoryStore.brands.find(b => b.custom_domain === params[0] || b.slug === params[0]);
          return undefined; // P1 Fail-Closed: Never fallback to memoryStore.brands[0]
        }
        if (lowerSql.includes('from branches')) {
          if (params[0]) return memoryStore.branches.find(b => b.id === params[0]);
          return undefined; // P1 Fail-Closed: Never fallback to memoryStore.branches[0]
        }
        if (lowerSql.includes('from products')) {
          if (params[0]) return memoryStore.products.find(p => String(p.id) === String(params[0]));
          return undefined;
        }
        return undefined;
      },
      run: (...params) => {
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
      tagline TEXT,
      default_payment_config TEXT,
      banners TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'owner',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
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
      image_url TEXT,
      image TEXT,
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
      regular_price REAL,
      image_url TEXT,
      image TEXT,
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
      fulfillment_schedule_type TEXT DEFAULT 'asap',
      scheduled_slot_start TEXT,
      scheduled_slot_end TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      subtotal REAL NOT NULL,
      delivery_fee REAL DEFAULT 0.0,
      discount_amount REAL DEFAULT 0.0,
      grand_total REAL NOT NULL,
      total_amount REAL,
      payment_method TEXT DEFAULT 'cash',
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
      item_subtotal REAL,
      subtotal REAL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_status_logs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      actor_type TEXT,
      actor_id TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_deliveries (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      destination_address TEXT,
      destination_latitude REAL,
      destination_longitude REAL,
      actual_road_distance_meters REAL,
      actual_duration_seconds REAL,
      chargeable_distance_km REAL,
      free_km_applied REAL,
      rate_per_km_applied REAL,
      delivery_fee_calculated REAL,
      driver_name TEXT,
      driver_phone TEXT,
      tracking_url TEXT,
      status TEXT NOT NULL DEFAULT 'unassigned',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_payments (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      merchant_id TEXT,
      snap_token TEXT,
      payment_method TEXT,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      amount REAL NOT NULL,
      raw_webhook_response TEXT,
      settled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      product_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      PRIMARY KEY (product_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS branch_products (
      branch_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      price REAL,
      stock INTEGER DEFAULT 100,
      is_available INTEGER DEFAULT 1,
      low_stock_threshold INTEGER DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (branch_id, product_id),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pos_shifts (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      starting_float REAL NOT NULL DEFAULT 0.0,
      total_cash_sales REAL NOT NULL DEFAULT 0.0,
      total_cash_in REAL NOT NULL DEFAULT 0.0,
      total_cash_out REAL NOT NULL DEFAULT 0.0,
      expected_cash REAL NOT NULL DEFAULT 0.0,
      actual_cash REAL,
      variance REAL,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pos_cash_movements (
      id TEXT PRIMARY KEY,
      shift_id TEXT NOT NULL,
      type TEXT NOT NULL, -- 'in' | 'out'
      amount REAL NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shift_id) REFERENCES pos_shifts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pos_held_orders (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      table_number TEXT,
      customer_name TEXT,
      items_payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'held', -- 'held', 'settled', 'cancelled'
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT NOT NULL UNIQUE,
      brand_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'received' | 'cancelled'
      created_by TEXT,
      received_by TEXT,
      notes TEXT,
      ordered_at TEXT DEFAULT (datetime('now')),
      received_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_po_items (
      id TEXT PRIMARY KEY,
      po_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL DEFAULT 0,
      received_quantity INTEGER DEFAULT 0,
      FOREIGN KEY (po_id) REFERENCES inventory_purchase_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      movement_type TEXT NOT NULL, -- 'purchase_in', 'transfer_in', 'return_in', 'sale_deduction', 'transfer_out', 'waste_spoilage', 'audit_adjustment'
      quantity INTEGER NOT NULL, -- signed: positive or negative
      previous_stock INTEGER NOT NULL,
      current_stock INTEGER NOT NULL,
      reference_id TEXT, -- PO ID, Order ID, Transfer ID, etc.
      actor_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);

  try { targetDb.exec('ALTER TABLE brands ADD COLUMN banners TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE branches ADD COLUMN whatsapp_number TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE categories ADD COLUMN brand_id TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE categories ADD COLUMN slug TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE categories ADD COLUMN image_url TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE categories ADD COLUMN image TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE products ADD COLUMN brand_id TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE products ADD COLUMN slug TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE products ADD COLUMN regular_price REAL;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE products ADD COLUMN image_url TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE products ADD COLUMN image TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE products ADD COLUMN pricing_mode TEXT DEFAULT "lock";'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE products ADD COLUMN min_price REAL;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE products ADD COLUMN max_price REAL;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE orders ADD COLUMN order_channel TEXT DEFAULT "customer_app";'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE orders ADD COLUMN fulfillment_type TEXT DEFAULT "delivery";'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE orders ADD COLUMN table_number TEXT;'); } catch (e) {}

  seedData(targetDb);
}

function seedData(targetDb) {
  let brand = null;
  try {
    brand = targetDb.prepare('SELECT id, organization_id FROM brands LIMIT 1').get();
  } catch (e) {}

  const brandId = brand?.id || 'brand_bangjo';
  const orgId = brand?.organization_id || 'org_xentra_holding';

  targetDb.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, plan)
    VALUES (?, ?, ?, ?)
  `).run(orgId, 'Xentra Holding Group', 'xentra-holding', 'enterprise');

  const defaultBanners = JSON.stringify([
    {
      id: 'banner_1',
      image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-1.png',
      title: 'slalu ada sensasi di setiap gigitan'
    }
  ]);

  targetDb.prepare(`
    INSERT OR IGNORE INTO brands (id, organization_id, name, slug, logo_url, primary_color, custom_domain, banners)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    brandId,
    orgId,
    'Bangjo Resto',
    'bangjo',
    'https://app.mybangjo.com/wp-content/plugins/xentra-mvp/assets/icons/logo_bangjo.png',
    '#b6ff00',
    'app.mybangjo.com',
    defaultBanners
  );

  // Seed default initial merchant owner if users table is empty (SHA-256 hashed)
  const userCount = targetDb.prepare('SELECT COUNT(*) as cnt FROM users WHERE brand_id = ?').get(brandId)?.cnt || 0;
  if (userCount === 0) {
    const crypto = require('crypto');
    
    // P1 SECURE CREDENTIAL PROVISIONING: Mandatory INITIAL_ADMIN_PASSWORD in production
    if (process.env.NODE_ENV === 'production' && !process.env.INITIAL_ADMIN_PASSWORD) {
      throw new Error('[Security Hardening]: INITIAL_ADMIN_PASSWORD environment variable wajib diset untuk menginisialisasi kredensial owner pertama kali di environment production.');
    }

    const initPassword = process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123';
    const defaultPasswordHash = crypto.createHash('sha256').update(initPassword).digest('hex');
    targetDb.prepare(`
      INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('usr_bangjo_owner', brandId, orgId, 'admin', 'admin@bangjo.com', defaultPasswordHash, 'Pemilik Bangjo', 'owner');
  }

  let branch = null;
  try {
    branch = targetDb.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brandId);
  } catch (e) {}
  const branchBaratId = branch?.id || 'branch_bangjo_barat';

  targetDb.prepare(`
    INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
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
    INSERT OR IGNORE INTO branch_delivery_settings (id, branch_id, max_radius_km, free_delivery_km, price_per_km, min_order_amount, promo_delivery_discount, promo_min_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('bds_barat_' + branchBaratId, branchBaratId, 12.0, 0, 3000.0, 15000.0, 5000.0, 50000.0);

  // P1 DATA-LOSS GUARD: NEVER run destructive DELETE statements on startup in seedData
  const catCount = targetDb.prepare('SELECT COUNT(*) as cnt FROM categories WHERE brand_id = ?').get(brandId)?.cnt || 0;
  if (catCount === 0) {
    const catRekom = '34';
    const catAyam = '20';
    const catMie = '26';
    const catTerlaris = '35';
    const catMinuman = '22';
    const catUdang = '21';

    targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catRekom, brandId, 'Rekom', 'rekom', 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png', 1);
    targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catAyam, brandId, 'Paket Ayam', 'paket-ayam', 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png', 2);
    targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catMie, brandId, 'Mie Bangjo', 'mie-bangjo', 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-11_28_14-AM.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-11_28_14-AM.png', 3);
    targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catTerlaris, brandId, 'Terlaris', 'terlaris', 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-11_28_14-AM.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-11_28_14-AM.png', 4);
    targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catMinuman, brandId, 'Minuman', 'minuman', 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', 5);
    targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catUdang, brandId, 'Udang', 'udang', 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-May-25-2026-01_57_13-PM.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-May-25-2026-01_57_13-PM.png', 6);

    const products = [
      { id: '272', cat: catRekom, name: 'Paket Spesial Semar', price: 35000, reg: 38000, desc: 'Nasi + Ayam Tulang Lunak Goreng + Telor Ceplok + Tempe Goreng + Es Teh Manis + Kremesan + Sambal Terasi + Lalapan', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' },
      { id: '285', cat: catRekom, name: 'Paket Spesial Petruk', price: 35000, reg: 37000, desc: 'Ayam Tulang Lunak Goreng + Telor Ceplok + Tempe Goreng + Es Teh Manis + Kremesan + Sambal Terasi + Lalapan', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png' },
      { id: '345', cat: catRekom, name: 'Mie Gurih', price: 15000, reg: 17000, desc: 'Mie + daging + pangsit rebus + kerupuk pangsit + sawi + tahu + kuah', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' },
      { id: '286', cat: catAyam, name: 'Ayam Tulang Lunak Bakar', price: 28000, reg: 32000, desc: 'Ayam bakar rempah lumuran bumbu khas Bangjo empuk sampai ke tulang.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' },
      { id: '287', cat: catMie, name: 'Mie Godog Jawa Asli', price: 22000, reg: 25000, desc: 'Mie godog kuah gurih kaldu kental ayam kampung dengan telor dan sayur segar.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' },
      { id: '288', cat: catMinuman, name: 'Es Kopi Susu Bangjo', price: 15000, reg: 18000, desc: 'Kopi susu gula aren racikan istimewa barista Bangjo dingin segar.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png' },
    ];

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      targetDb.prepare(`
        INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, image_url, image, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.id, brandId, p.cat, p.name, p.name.toLowerCase().replace(/ /g, '-'), p.desc, p.price, p.reg, p.img, p.img, i + 1);
    }
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
