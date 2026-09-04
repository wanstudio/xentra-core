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

// Runtime Persistence Invariant:
// In Node.js >= 22.x LTS, native node:sqlite is used with WAL mode.
// On Node.js <= 20.x LTS (e.g. cPanel CloudLinux Passenger), sql.js / memoryStore is used as compatible fallback.
const nodeVersion = process.version;
try {
  const { DatabaseSync } = require('node:sqlite');
  dbInstance = new DatabaseSync(DB_PATH);
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');
  console.log(`[Database] Native node:sqlite persistent storage initialized successfully (Node ${nodeVersion}, WAL mode).`);
} catch (e) {
  try {
    const initSqlJs = require('sql.js');
    console.log(`[Database] node:sqlite not built-in on Node ${nodeVersion}. Initializing sql.js adapter...`);
    sqlJsPromise = initSqlJs().then(SQL => {
      if (fs.existsSync(DB_PATH)) {
        try {
          const fileBuffer = fs.readFileSync(DB_PATH);
          rawSqlDb = new SQL.Database(fileBuffer);
        } catch (_) {
          rawSqlDb = new SQL.Database();
        }
      } else {
        rawSqlDb = new SQL.Database();
      }
      console.log(`[Database] sql.js database adapter ready on Node ${nodeVersion}.`);
    }).catch(err => {
      console.warn('[Database] sql.js fallback error, using memoryStore:', err.message);
    });
  } catch (_) {
    console.log(`[Database] node:sqlite and sql.js unavailable on Node ${nodeVersion}. Using memoryStore.`);
  }
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
    },
    {
      id: 'branch_bangjo_timur',
      brand_id: 'brand_bangjo',
      name: 'Bangjo Surabaya Timur',
      slug: 'surabaya-timur',
      address_text: 'Jl. Dharmawangsa No. 12, Surabaya Timur',
      latitude: -7.2845,
      longitude: 112.7560,
      phone: '081234567891',
      is_active: 1,
      free_delivery_km: 3.0,
      price_per_km: 2500.0,
      max_radius_km: 10.0,
      promo_config: JSON.stringify({ enabled: true, target: 40000, discount: 5000 })
    }
  ],
  categories: [
    { id: 34, brand_id: 'brand_bangjo', name: 'Makanan', slug: 'makanan', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png', sort_order: 1 },
    { id: 22, brand_id: 'brand_bangjo', name: 'Minuman', slug: 'minuman', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', sort_order: 2 },
    { id: 36, brand_id: 'brand_bangjo', name: 'Snack', slug: 'snack', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png', sort_order: 3 }
  ],
  products: [
    { id: 272, brand_id: 'brand_bangjo', category_id: 34, name: 'Nasi Goreng', price: 25000, regular_price: 25000, description: 'Nasi goreng spesial dengan bumbu khas Bangjo.', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', is_active: 1, sort_order: 1 },
    { id: 285, brand_id: 'brand_bangjo', category_id: 34, name: 'Ayam Geprek', price: 28000, regular_price: 28000, description: 'Ayam goreng tepung dengan sambal geprek pedas.', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png', is_active: 1, sort_order: 2 },
    { id: 288, brand_id: 'brand_bangjo', category_id: 22, name: 'Es Teh', price: 5000, regular_price: 5000, description: 'Teh melati seduh dingin segar.', image: '/assets/img/iced-tea.png', is_active: 1, sort_order: 3 },
    { id: 287, brand_id: 'brand_bangjo', category_id: 22, name: 'Kopi Susu', price: 15000, regular_price: 15000, description: 'Kopi susu gula aren racikan istimewa barista Bangjo.', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', is_active: 1, sort_order: 4 },
    { id: 345, brand_id: 'brand_bangjo', category_id: 36, name: 'Kentang', price: 12000, regular_price: 12000, description: 'Kentang goreng renyah dengan bumbu balado.', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', is_active: 1, sort_order: 5 }
  ],
  branch_products: [
    { branch_id: 'branch_bangjo_barat', product_id: '272', price: 25000, stock: 50, is_available: 1 },
    { branch_id: 'branch_bangjo_barat', product_id: '285', price: 28000, stock: 30, is_available: 0 },
    { branch_id: 'branch_bangjo_barat', product_id: '288', price: 5000, stock: 100, is_available: 1 },
    { branch_id: 'branch_bangjo_barat', product_id: '345', price: 12000, stock: 40, is_available: 1 },
    { branch_id: 'branch_bangjo_timur', product_id: '272', price: 25000, stock: 75, is_available: 1 },
    { branch_id: 'branch_bangjo_timur', product_id: '287', price: 15000, stock: 60, is_available: 1 }
  ],
  orders: [],
  users: [],
  promotions: [
    {
      id: 'prm_bangjo_pwa_install',
      brand_id: 'brand_bangjo',
      name: 'Promo Hadiah Install PWA Es Teh',
      code: null,
      capability_type: 'install_incentive',
      stacking_policy: 'exclusive',
      priority_weight: 100,
      max_redemptions_total: null,
      max_redemptions_per_customer: 1,
      is_active: 1
    }
  ],
  promotion_rules: [
    {
      id: 'rul_pwa_install_01',
      promotion_id: 'prm_bangjo_pwa_install',
      rule_type: 'eligibility',
      rule_payload: JSON.stringify({ requires_pwa_installed: true, target_audience: 'new_user', first_order_only: true })
    }
  ],
  promotion_rewards: [
    {
      id: 'rew_pwa_install_01',
      promotion_id: 'prm_bangjo_pwa_install',
      reward_type: 'freebie_product',
      target_product_id: '288',
      amount_in_cents: 0,
      presentation_payload: JSON.stringify({
        banner_title: 'Install sekarang & dapatkan gratis es teh',
        banner_subtitle: 'syarat & ketentuan berlaku',
        reward_title: 'Selamat! Es Teh Gratis untuk pesanan pertamamu!',
        reward_badge_text: '✓ Bonus PWA Aktif (Rp0)',
        icon_url: '/assets/img/iced-tea.png'
      })
    }
  ],
  promotion_redemptions: []
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
        if (lowerSql.includes('from promotion_rules')) {
          if (params[0]) return memoryStore.promotion_rules.filter(r => r.promotion_id === params[0]);
          return memoryStore.promotion_rules;
        }
        if (lowerSql.includes('from promotion_rewards')) {
          if (params[0]) return memoryStore.promotion_rewards.filter(rw => rw.promotion_id === params[0]);
          return memoryStore.promotion_rewards;
        }
        if (lowerSql.includes('from promotion_redemptions')) return memoryStore.promotion_redemptions;
        if (lowerSql.includes('from promotions')) {
          if (params[0]) return memoryStore.promotions.filter(p => p.brand_id === params[0] && p.is_active === 1);
          return memoryStore.promotions;
        }
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
          if (params[0]) return memoryStore.brands.find(b => b.custom_domain === params[0] || b.slug === params[0] || (b.custom_domain && b.custom_domain.includes(params[0])));
          if (lowerSql.includes('limit 1') || lowerSql.includes('order by') || !params.length) return memoryStore.brands[0];
          return undefined;
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
      branch_id TEXT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'owner',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
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

    -- B1 OPERATIONAL AUDIT TRAIL (append-only): records authoritative branch operational/profile
    -- mutations so the system can determine WHAT changed, WHICH branch, WHO performed it, WHEN,
    -- and that authorization/scope was satisfied. Written by the branch mutation path only.
    CREATE TABLE IF NOT EXISTS branch_operation_logs (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      brand_id TEXT NOT NULL,
      organization_id TEXT,
      product_id TEXT,               -- set for product-scoped ops (e.g. branch product availability)
      action TEXT NOT NULL,          -- e.g. 'branch.update', 'branch.create', 'branch_product.update'
      field TEXT NOT NULL,           -- affected field: name/is_active/is_open_override/is_available/...
      previous_value TEXT,           -- stringified scalar before change (NULL when no prior value)
      new_value TEXT,                -- stringified scalar after change
      actor_id TEXT,
      actor_role TEXT,
      authorized INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
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
      client_transaction_id TEXT,
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
      PRIMARY KEY (product_id, category_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customer_addresses (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      label TEXT DEFAULT 'Rumah',
      address TEXT NOT NULL,
      detail TEXT,
      note TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      is_primary INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      capability_type TEXT NOT NULL,
      stacking_policy TEXT NOT NULL DEFAULT 'exclusive',
      priority_weight INTEGER NOT NULL DEFAULT 100,
      max_redemptions_total INTEGER,
      max_redemptions_per_customer INTEGER DEFAULT 1,
      start_at TEXT,
      end_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promotion_rules (
      id TEXT PRIMARY KEY,
      promotion_id TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      rule_payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promotion_rewards (
      id TEXT PRIMARY KEY,
      promotion_id TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      target_product_id TEXT,
      amount_in_cents INTEGER NOT NULL DEFAULT 0,
      max_discount_in_cents INTEGER,
      presentation_payload TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promotion_redemptions (
      id TEXT PRIMARY KEY,
      promotion_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      brand_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      benefit_amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      redeemed_at TEXT DEFAULT (datetime('now')),
      voided_at TEXT,
      void_reason TEXT,
      FOREIGN KEY (promotion_id) REFERENCES promotions(id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      UNIQUE (order_id, promotion_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prm_redemptions_cust ON promotion_redemptions(promotion_id, customer_phone);
    CREATE INDEX IF NOT EXISTS idx_prm_redemptions_cust_active ON promotion_redemptions(promotion_id, customer_phone) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS idx_prm_redemptions_order ON promotion_redemptions(order_id);

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

    -- C1 BRAND CONSISTENCY (C1.3/C1.9): a Product -> Branch assignment is only valid when the
    -- product master and the branch belong to the SAME brand. Enforced at the database layer so a
    -- cross-brand assignment can never be written (app-layer guards are defense-in-depth).
    CREATE TRIGGER IF NOT EXISTS trg_branch_products_brand_consistency_insert
    BEFORE INSERT ON branch_products
    FOR EACH ROW
    WHEN (SELECT brand_id FROM products WHERE id = NEW.product_id)
         IS NOT (SELECT brand_id FROM branches WHERE id = NEW.branch_id)
    BEGIN
      SELECT RAISE(ABORT, 'CROSS_BRAND_ASSIGNMENT_REJECTED');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_branch_products_brand_consistency_update
    BEFORE UPDATE OF product_id, branch_id ON branch_products
    FOR EACH ROW
    WHEN (SELECT brand_id FROM products WHERE id = NEW.product_id)
         IS NOT (SELECT brand_id FROM branches WHERE id = NEW.branch_id)
    BEGIN
      SELECT RAISE(ABORT, 'CROSS_BRAND_ASSIGNMENT_REJECTED');
    END;

    -- C2 NON-NEGATIVE PHYSICAL STOCK (C2.6/C2.15): physical stock can never become negative,
    -- regardless of which application path writes it. App-layer guards are defense-in-depth.
    CREATE TRIGGER IF NOT EXISTS trg_branch_products_stock_non_negative_insert
    BEFORE INSERT ON branch_products
    FOR EACH ROW
    WHEN NEW.stock IS NOT NULL AND NEW.stock < 0
    BEGIN
      SELECT RAISE(ABORT, 'NEGATIVE_STOCK_REJECTED');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_branch_products_stock_non_negative_update
    BEFORE UPDATE OF stock ON branch_products
    FOR EACH ROW
    WHEN NEW.stock IS NOT NULL AND NEW.stock < 0
    BEGIN
      SELECT RAISE(ABORT, 'NEGATIVE_STOCK_REJECTED');
    END;

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
      mutation_id TEXT, -- C2 idempotency key: replaying the same mutation_id never applies twice
      actor_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_order_payments_order_id ON order_payments(order_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_shifts_unique_active_cashier ON pos_shifts(cashier_id) WHERE status = 'open';
  `);

  try { targetDb.exec('ALTER TABLE users ADD COLUMN branch_id TEXT;'); } catch (e) {}
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
  try { targetDb.exec('ALTER TABLE brands ADD COLUMN tagline TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE brands ADD COLUMN banners TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE orders ADD COLUMN order_channel TEXT DEFAULT "customer_app";'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE orders ADD COLUMN selection_mode TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE orders ADD COLUMN fulfillment_type TEXT DEFAULT "delivery";'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE orders ADD COLUMN table_number TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE orders ADD COLUMN client_transaction_id TEXT;'); } catch (e) {}
  try { targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_branch_client_tx ON orders(branch_id, client_transaction_id) WHERE client_transaction_id IS NOT NULL;'); } catch (e) {}
  try { targetDb.exec("ALTER TABLE promotion_redemptions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';"); } catch (e) {}
  try { targetDb.exec('ALTER TABLE promotion_redemptions ADD COLUMN voided_at TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE promotion_redemptions ADD COLUMN void_reason TEXT;'); } catch (e) {}
  try { targetDb.exec("CREATE INDEX IF NOT EXISTS idx_prm_redemptions_cust_active ON promotion_redemptions(promotion_id, customer_phone) WHERE status = 'active';"); } catch (e) {}
  try { targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_order_payments_order_id ON order_payments(order_id);'); } catch (e) {}
  try { targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_shifts_unique_active_cashier ON pos_shifts(cashier_id) WHERE status = "open";'); } catch (e) {}
  // C2 IDEMPOTENCY (C2.8): an inventory_movements table created BEFORE the C2
  // schema exists on disk without the mutation_id column. The column ALTER and
  // the partial unique index must live OUTSIDE the CREATE TABLE batch (guarded)
  // so a stale file database migrates in place instead of crashing the boot.
  try { targetDb.exec('ALTER TABLE inventory_movements ADD COLUMN mutation_id TEXT;'); } catch (e) {}
  try { targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_mutation ON inventory_movements(mutation_id) WHERE mutation_id IS NOT NULL;'); } catch (e) {}
  // C1 AUDIT (B1/C1): branch_operation_logs created before the C1 schema lacks
  // the product_id column used for product-scoped audit rows.
  try { targetDb.exec('ALTER TABLE branch_operation_logs ADD COLUMN product_id TEXT;'); } catch (e) {}

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
    
    // Secure default initial merchant credential
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
  const branchTimurId = 'branch_bangjo_timur';

  // Branch A: Bangjo Surabaya Barat
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

  // Branch B: Bangjo Surabaya Timur (second branch for branch-scoped catalog demo)
  targetDb.prepare(`
    INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    branchTimurId,
    brandId,
    'Bangjo Surabaya Timur',
    'surabaya-timur',
    'Jl. Dharmawangsa No. 12, Surabaya Timur',
    -7.2845,
    112.7560,
    '081234567891'
  );

  targetDb.prepare(`
    INSERT OR IGNORE INTO branch_delivery_settings (id, branch_id, max_radius_km, free_delivery_km, price_per_km, min_order_amount, promo_delivery_discount, promo_min_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('bds_timur_' + branchTimurId, branchTimurId, 10.0, 3.0, 2500.0, 15000.0, 3000.0, 40000.0);

  // P1 DATA-LOSS GUARD: NEVER run destructive DELETE statements on startup in seedData
  const catCount = targetDb.prepare('SELECT COUNT(*) as cnt FROM categories WHERE brand_id = ?').get(brandId)?.cnt || 0;
  if (catCount === 0) {
    const catMakanan = '34';
    const catMinuman = '22';
    const catSnack = '36';

    targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catMakanan, brandId, 'Makanan', 'makanan', 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png', 1);
    targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catMinuman, brandId, 'Minuman', 'minuman', 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', 2);
    targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catSnack, brandId, 'Snack', 'snack', 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png', 3);

    const products = [
      { id: '272', cat: catMakanan, name: 'Nasi Goreng', price: 25000, reg: 25000, desc: 'Nasi goreng spesial dengan bumbu khas Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' },
      { id: '285', cat: catMakanan, name: 'Ayam Geprek', price: 28000, reg: 28000, desc: 'Ayam goreng tepung dengan sambal geprek pedas.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png' },
      { id: '288', cat: catMinuman, name: 'Es Teh', price: 5000, reg: 5000, desc: 'Teh melati seduh dingin segar.', img: '/assets/img/iced-tea.png' },
      { id: '287', cat: catMinuman, name: 'Kopi Susu', price: 15000, reg: 15000, desc: 'Kopi susu gula aren racikan istimewa barista Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png' },
      { id: '345', cat: catSnack, name: 'Kentang', price: 12000, reg: 12000, desc: 'Kentang goreng renyah dengan bumbu balado.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' },
    ];

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      targetDb.prepare(`
        INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, image_url, image, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.id, brandId, p.cat, p.name, p.name.toLowerCase().replace(/ /g, '-'), p.desc, p.price, p.reg, p.img, p.img, i + 1);
    }

    // Branch-scoped product assignments (branch_products)
    // Branch A (Barat): Nasi Goreng, Ayam Geprek (unavailable), Es Teh, Kentang
    // Branch B (Timur): Nasi Goreng, Kopi Susu
    const branchAssignments = [
      { branch: branchBaratId, productId: '272', price: 25000, stock: 50, available: 1 },
      { branch: branchBaratId, productId: '285', price: 28000, stock: 30, available: 0 },
      { branch: branchBaratId, productId: '288', price: 5000, stock: 100, available: 1 },
      { branch: branchBaratId, productId: '345', price: 12000, stock: 40, available: 1 },
      { branch: branchTimurId, productId: '272', price: 25000, stock: 75, available: 1 },
      { branch: branchTimurId, productId: '287', price: 15000, stock: 60, available: 1 },
    ];

    for (const a of branchAssignments) {
      targetDb.prepare(`
        INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock, is_available, low_stock_threshold)
        VALUES (?, ?, ?, ?, ?, 5)
      `).run(a.branch, a.productId, a.price, a.stock, a.available);
    }

  }

  seedInstallPromotion(targetDb, brandId);
}

function seedInstallPromotion(targetDb, brandId) {
  // Bangjo's install incentive must belong to the same authoritative tenant
  // resolved by app.mybangjo.com.
  // Do not attach the promotion to whichever brand happens to be first in the DB.
  const bangjoBrand = targetDb.prepare(
    "SELECT id FROM brands WHERE slug = 'bangjo' LIMIT 1"
  ).get();
  if (bangjoBrand && bangjoBrand.id) brandId = bangjoBrand.id;

  // Keep the authoritative reward product available even when the database already existed
  // before the install-promo seed was introduced.
  const rewardCategory = targetDb.prepare(
    'SELECT id FROM categories WHERE brand_id = ? AND (slug = ? OR name = ?) LIMIT 1'
  ).get(brandId, 'minuman', 'Minuman');
  const rewardCategoryId = rewardCategory?.id || '22';

  // Use product 288 (Es Teh) as the install incentive reward.
  // Ensure it exists and is assigned to at least one active branch.
  targetDb.prepare(`
    INSERT OR IGNORE INTO products (
      id, brand_id, category_id, name, slug, description, price, regular_price, image_url, image, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '288',
    brandId,
    rewardCategoryId,
    'Es Teh',
    'es-teh',
    'Teh melati seduh dingin segar.',
    5000,
    5000,
    '/assets/img/iced-tea.png',
    '/assets/img/iced-tea.png',
    99
  );

  const rewardBranch = targetDb.prepare(
    'SELECT id FROM branches WHERE brand_id = ? AND is_active = 1 ORDER BY id LIMIT 1'
  ).get(brandId);
  if (rewardBranch) {
    targetDb.prepare(`
      INSERT OR IGNORE INTO branch_products (
        branch_id, product_id, price, stock, is_available, low_stock_threshold
      ) VALUES (?, '288', 5000, 100, 1, 5)
    `).run(rewardBranch.id);
  }

  targetDb.prepare(`
    INSERT OR IGNORE INTO promotions (
      id, brand_id, name, code, capability_type, stacking_policy, priority_weight, max_redemptions_total, max_redemptions_per_customer, is_active
    ) VALUES (
      'prm_bangjo_pwa_install', ?, 'Promo Hadiah Install PWA Es Teh', NULL,
      'install_incentive', 'exclusive', 100, NULL, 1, 1
    )
  `).run(brandId);

  targetDb.prepare(`
    INSERT OR IGNORE INTO promotion_rules (id, promotion_id, rule_type, rule_payload)
    VALUES ('rul_pwa_install_01', 'prm_bangjo_pwa_install', 'eligibility',
      '{"requires_pwa_installed":true,"target_audience":"new_user","first_order_only":true}')
  `).run();

  // Repair pre-existing rows created by the old "first brand" seeding logic.
  targetDb.prepare(
    "UPDATE promotions SET brand_id = ? WHERE id = 'prm_bangjo_pwa_install'"
  ).run(brandId);
  targetDb.prepare(
    "UPDATE products SET brand_id = ? WHERE id = '288'"
  ).run(brandId);

  targetDb.prepare(`
    INSERT OR IGNORE INTO promotion_rewards (id, promotion_id, reward_type, target_product_id, amount_in_cents, presentation_payload)
    VALUES ('rew_pwa_install_01', 'prm_bangjo_pwa_install', 'freebie_product', '288', 0,
      '{"banner_title":"Install sekarang & dapatkan gratis es teh","banner_subtitle":"syarat & ketentuan berlaku","reward_title":"Selamat! Es Teh Gratis untuk pesanan pertamamu!","reward_badge_text":"✓ Bonus PWA Aktif (Rp0)","icon_url":"/assets/img/iced-tea.png"}')
  `).run();
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
