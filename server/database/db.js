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
let dbReadyPromise = null;
const nodeVersion = process.version;
try {
  const { DatabaseSync } = require('node:sqlite');
  dbInstance = new DatabaseSync(DB_PATH);
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');
  console.log(`[Database] Native node:sqlite persistent storage initialized successfully (Node ${nodeVersion}, WAL mode).`);
  dbReadyPromise = Promise.resolve();
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
      rawSqlDb.run('PRAGMA foreign_keys = ON;');
      console.log(`[Database] sql.js database adapter ready on Node ${nodeVersion} (PRAGMA foreign_keys = ON).`);
      initSchema(db);
    }).catch(err => {
      console.warn('[Database] sql.js fallback error, using memoryStore:', err.message);
    });
    dbReadyPromise = sqlJsPromise;
  } catch (_) {
    console.log(`[Database] node:sqlite and sql.js unavailable on Node ${nodeVersion}. Using memoryStore.`);
    dbReadyPromise = Promise.resolve();
  }
}

let saveTimeout = null;
let isSaving = false;
let saveQueued = false;

function saveSqlJsToDisk(immediate = false) {
  if (!rawSqlDb || DB_PATH === ':memory:') return;

  if (sqlJsTxActive) {
    saveQueued = true;
    return;
  }

  const doSaveSync = () => {
    try {
      const data = rawSqlDb.export();
      const tmpPath = `${DB_PATH}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmpPath, Buffer.from(data));
      fs.renameSync(tmpPath, DB_PATH);
    } catch (err) {
      console.error('[Database] Failed to write sql.js to disk (sync):', err);
    }
  };

  const doSaveAsync = () => {
    if (isSaving) {
      saveQueued = true;
      return;
    }
    if (sqlJsTxActive) {
      saveQueued = true;
      return;
    }

    let data;
    try {
      data = rawSqlDb.export();
    } catch (err) {
      console.error('[Database] Failed to export sql.js:', err);
      return;
    }

    isSaving = true;
    saveQueued = false;
    const tmpPath = `${DB_PATH}.tmp.${process.pid}.${Date.now()}`;
    const buffer = Buffer.from(data);

    fs.promises.writeFile(tmpPath, buffer)
      .then(() => fs.promises.rename(tmpPath, DB_PATH))
      .catch((err) => {
        console.error('[Database] Failed to write sql.js to disk (async):', err);
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch (_) {}
      })
      .finally(() => {
        isSaving = false;
        if (saveQueued && !sqlJsTxActive) {
          saveSqlJsToDisk(false);
        }
      });
  };

  if (immediate) {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    doSaveSync();
  } else {
    if (saveTimeout) return;
    saveTimeout = setTimeout(() => {
      saveTimeout = null;
      doSaveAsync();
    }, 50);
    if (saveTimeout.unref) saveTimeout.unref();
  }
}

// Ensure flush to disk on graceful shutdown or exit
const flushOnExit = () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (rawSqlDb && DB_PATH !== ':memory:') {
    try {
      const data = rawSqlDb.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (_) {}
  }
};
process.on('beforeExit', flushOnExit);
process.on('SIGINT', () => { flushOnExit(); process.exit(0); });
process.on('SIGTERM', () => { flushOnExit(); process.exit(0); });

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
    },
    {
      id: 'branch_bangjo_pusat',
      brand_id: 'brand_bangjo',
      name: 'Bangjo Surabaya Pusat',
      slug: 'surabaya-pusat',
      address_text: 'Jl. Basuki Rahmat No. 25, Surabaya Pusat',
      latitude: -7.2600,
      longitude: 112.7400,
      phone: '081234567892',
      is_active: 1,
      free_delivery_km: 2.5,
      price_per_km: 3000.0,
      max_radius_km: 10.0,
      promo_config: JSON.stringify({ enabled: true, target: 45000, discount: 5000 })
    },
    {
      id: 'branch_bangjo_utara',
      brand_id: 'brand_bangjo',
      name: 'Bangjo Surabaya Utara',
      slug: 'surabaya-utara',
      address_text: 'Jl. Perak Timur No. 40, Surabaya Utara',
      latitude: -7.2300,
      longitude: 112.7350,
      phone: '081234567893',
      is_active: 1,
      free_delivery_km: 2.0,
      price_per_km: 3000.0,
      max_radius_km: 12.0,
      promo_config: JSON.stringify({ enabled: true, target: 50000, discount: 8000 })
    },
    {
      id: 'branch_bangjo_selatan',
      brand_id: 'brand_bangjo',
      name: 'Bangjo Surabaya Selatan',
      slug: 'surabaya-selatan',
      address_text: 'Jl. Ahmad Yani No. 102, Surabaya Selatan',
      latitude: -7.3150,
      longitude: 112.7300,
      phone: '081234567894',
      is_active: 1,
      free_delivery_km: 3.0,
      price_per_km: 2500.0,
      max_radius_km: 15.0,
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
    { id: 345, brand_id: 'brand_bangjo', category_id: 36, name: 'Kentang Goreng', price: 12000, regular_price: 12000, description: 'Kentang goreng renyah dengan bumbu balado.', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', is_active: 1, sort_order: 5 },
    { id: 286, brand_id: 'brand_bangjo', category_id: 34, name: 'Ayam Bakar', price: 28000, regular_price: 32000, description: 'Ayam bakar rempah lumuran bumbu khas Bangjo empuk sampai ke tulang.', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', is_active: 1, sort_order: 6 },
    { id: 401, brand_id: 'brand_bangjo', category_id: 22, name: 'Es Teh Manis', price: 6000, regular_price: 6000, description: 'Teh melati seduh dingin manis segar.', image: '/assets/img/iced-tea.png', is_active: 1, sort_order: 7 },
    { id: 346, brand_id: 'brand_bangjo', category_id: 34, name: 'Mie Goreng Bangjo', price: 22000, regular_price: 22000, description: 'Mie goreng spesial bumbu rempah pilihan Bangjo.', image: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', is_active: 1, sort_order: 8 }
  ],
  branch_products: [
    // Barat (4 products)
    { branch_id: 'branch_bangjo_barat', product_id: '272', branch_category_id: 'bc_barat_favorit', product_name: 'Nasi Goreng', product_description: 'Nasi goreng spesial dengan bumbu khas Bangjo.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 25000, stock: 50, is_available: 1 },
    { branch_id: 'branch_bangjo_barat', product_id: '285', branch_category_id: 'bc_barat_favorit', product_name: 'Ayam Geprek', product_description: 'Ayam goreng tepung dengan sambal geprek pedas.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png', price: 28000, stock: 30, is_available: 0 },
    { branch_id: 'branch_bangjo_barat', product_id: '288', branch_category_id: 'bc_barat_minuman', product_name: 'Es Teh', product_description: 'Teh melati seduh dingin segar.', product_image_url: '/assets/img/iced-tea.png', price: 5000, stock: 100, is_available: 1 },
    { branch_id: 'branch_bangjo_barat', product_id: '345', branch_category_id: 'bc_barat_snack', product_name: 'Kentang Goreng', product_description: 'Kentang goreng renyah dengan bumbu balado.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', price: 12000, stock: 40, is_available: 1 },
    // Timur (2 products)
    { branch_id: 'branch_bangjo_timur', product_id: '272', branch_category_id: 'bc_timur_paket', product_name: 'Nasi Goreng', product_description: 'Nasi goreng spesial dengan bumbu khas Bangjo.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 25000, stock: 75, is_available: 1 },
    { branch_id: 'branch_bangjo_timur', product_id: '287', branch_category_id: 'bc_timur_kopi', product_name: 'Kopi Susu', product_description: 'Kopi susu gula aren racikan istimewa barista Bangjo.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', price: 15000, stock: 60, is_available: 1 },
    // Pusat (3 products)
    { branch_id: 'branch_bangjo_pusat', product_id: '346', branch_category_id: 'bc_pusat_rekomendasi', product_name: 'Mie Goreng Bangjo', product_description: 'Mie goreng spesial bumbu rempah pilihan Bangjo.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', price: 22000, stock: 40, is_available: 1 },
    { branch_id: 'branch_bangjo_pusat', product_id: '286', branch_category_id: 'bc_pusat_rekomendasi', product_name: 'Ayam Bakar', product_description: 'Ayam bakar rempah lumuran bumbu khas Bangjo empuk sampai ke tulang.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 28000, stock: 25, is_available: 1 },
    { branch_id: 'branch_bangjo_pusat', product_id: '345', branch_category_id: 'bc_pusat_snack', product_name: 'Kentang Goreng', product_description: 'Kentang goreng renyah dengan bumbu balado.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', price: 12000, stock: 50, is_available: 1 },
    // Utara (3 products)
    { branch_id: 'branch_bangjo_utara', product_id: '272', branch_category_id: 'bc_utara_bestseller', product_name: 'Nasi Goreng', product_description: 'Nasi goreng spesial dengan bumbu khas Bangjo.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 26000, stock: 60, is_available: 1 },
    { branch_id: 'branch_bangjo_utara', product_id: '286', branch_category_id: 'bc_utara_bestseller', product_name: 'Ayam Bakar', product_description: 'Ayam bakar rempah lumuran bumbu khas Bangjo empuk sampai ke tulang.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 30000, stock: 20, is_available: 1 },
    { branch_id: 'branch_bangjo_utara', product_id: '401', branch_category_id: 'bc_utara_minuman', product_name: 'Es Teh Manis', product_description: 'Teh melati seduh dingin manis segar.', product_image_url: '/assets/img/iced-tea.png', price: 6000, stock: 80, is_available: 1 },
    // Selatan (4 products)
    { branch_id: 'branch_bangjo_selatan', product_id: '272', branch_category_id: 'bc_selatan_makan', product_name: 'Nasi Goreng', product_description: 'Nasi goreng spesial dengan bumbu khas Bangjo.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 25000, stock: 45, is_available: 1 },
    { branch_id: 'branch_bangjo_selatan', product_id: '346', branch_category_id: 'bc_selatan_makan', product_name: 'Mie Goreng Bangjo', product_description: 'Mie goreng spesial bumbu rempah pilihan Bangjo.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', price: 22000, stock: 35, is_available: 1 },
    { branch_id: 'branch_bangjo_selatan', product_id: '287', branch_category_id: 'bc_selatan_kopi', product_name: 'Kopi Susu', product_description: 'Kopi susu gula aren racikan istimewa barista Bangjo.', product_image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', price: 16000, stock: 50, is_available: 1 },
    { branch_id: 'branch_bangjo_selatan', product_id: '288', branch_category_id: 'bc_selatan_kopi', product_name: 'Es Teh', product_description: 'Teh melati seduh dingin segar.', product_image_url: '/assets/img/iced-tea.png', price: 5000, stock: 90, is_available: 1 }
  ],
  branch_categories: [
    // Barat
    { id: 'bc_barat_favorit', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_barat', name: 'Menu Favorit', slug: 'menu-favorit', image_url: null, sort_order: 1 },
    { id: 'bc_barat_minuman', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_barat', name: 'Minuman Segar', slug: 'minuman-segar', image_url: null, sort_order: 2 },
    { id: 'bc_barat_snack', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_barat', name: 'Cemilan', slug: 'cemilan', image_url: null, sort_order: 3 },
    // Timur
    { id: 'bc_timur_paket', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_timur', name: 'Paket Hemat', slug: 'paket-hemat', image_url: null, sort_order: 1 },
    { id: 'bc_timur_kopi', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_timur', name: 'Kopi & Teh', slug: 'kopi-teh', image_url: null, sort_order: 2 },
    // Pusat
    { id: 'bc_pusat_rekomendasi', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_pusat', name: 'Rekomendasi Chef', slug: 'rekomendasi-chef', image_url: null, sort_order: 1 },
    { id: 'bc_pusat_snack', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_pusat', name: 'Kudapan', slug: 'kudapan', image_url: null, sort_order: 2 },
    // Utara
    { id: 'bc_utara_bestseller', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_utara', name: 'Best Seller', slug: 'best-seller', image_url: null, sort_order: 1 },
    { id: 'bc_utara_minuman', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_utara', name: 'Minuman Segar', slug: 'minuman-segar', image_url: null, sort_order: 2 },
    // Selatan
    { id: 'bc_selatan_makan', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_selatan', name: 'Menu Utama', slug: 'menu-utama', image_url: null, sort_order: 1 },
    { id: 'bc_selatan_kopi', brand_id: 'brand_bangjo', branch_id: 'branch_bangjo_selatan', name: 'Kedai Kopi & Teh', slug: 'kedai-kopi-teh', image_url: null, sort_order: 2 }
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
//
// sql.js adapter transactional safety: sql.js `export()` (used for disk
// persistence) runs its own internal BEGIN/COMMIT, so persisting DURING an
// open user transaction would silently COMMIT it and make a later
// `exec('COMMIT;')` fail with "cannot commit - no transaction is active".
// Track the transaction state here and defer disk exports until the user
// transaction ends (BEGIN/COMMIT/ROLLBACK are single statements via run()).
let sqlJsTxActive = false;
const detectTransactionStatement = (sql) => {
  const s = String(sql || '').toLowerCase().replace(/;/g, ' ');
  if (s.includes('begin')) return 'begin';
  if (s.includes('commit') || s.includes('end transaction')) return 'commit';
  if (s.includes('rollback')) return 'rollback';
  return 'none';
};

const db = {
  exec: (sql) => {
    const tx = detectTransactionStatement(sql);
    if (dbInstance) return dbInstance.exec(sql);
    if (rawSqlDb) {
      const res = rawSqlDb.run(sql);
      if (tx === 'begin') {
        sqlJsTxActive = true;
      } else if (tx === 'commit' || tx === 'rollback') {
        sqlJsTxActive = false;
        saveSqlJsToDisk(false);
      } else if (!sqlJsTxActive) {
        saveSqlJsToDisk(false);
      }
      return res;
    }
    if (sqlJsPromise) {
      throw new Error('[Database] sql.js is still initializing or unavailable.');
    }
  },
  prepare: (sql) => {
    if (dbInstance) return dbInstance.prepare(sql);
    if (rawSqlDb) {
      const tx = detectTransactionStatement(sql);
      return {
        all: (...params) => {
          const stmt = rawSqlDb.prepare(sql);
          try {
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally {
            stmt.free();
          }
        },
        get: (...params) => {
          const stmt = rawSqlDb.prepare(sql);
          try {
            stmt.bind(params);
            let row = undefined;
            if (stmt.step()) row = stmt.getAsObject();
            return row;
          } finally {
            stmt.free();
          }
        },
        run: (...params) => {
          const stmt = rawSqlDb.prepare(sql);
          try {
            stmt.bind(params);
            stmt.step();
          } finally {
            stmt.free();
          }

          if (tx === 'begin') {
            sqlJsTxActive = true;
          } else if (tx === 'commit' || tx === 'rollback') {
            sqlJsTxActive = false;
            saveSqlJsToDisk(false);
          } else if (!sqlJsTxActive) {
            saveSqlJsToDisk(false);
          }

          const changes = rawSqlDb.getRowsModified();
          let lastInsertRowid = 0;
          try {
            const rowidRes = rawSqlDb.exec('SELECT last_insert_rowid() AS id;');
            if (rowidRes && rowidRes.length > 0 && rowidRes[0].values && rowidRes[0].values.length > 0) {
              lastInsertRowid = rowidRes[0].values[0][0];
            }
          } catch (_) {}

          return { changes, lastInsertRowid };
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
        if (lowerSql.includes('from branch_products')) {
          if (params[0] && params[1]) return memoryStore.branch_products.filter(bp => bp.branch_id === params[0] && bp.product_id === params[1]);
          if (params[0]) return memoryStore.branch_products.filter(bp => bp.branch_id === params[0]);
          return memoryStore.branch_products;
        }
        if (lowerSql.includes('from branch_categories')) {
          if (params[0]) return memoryStore.branch_categories.filter(bc => bc.branch_id === params[0]);
          return memoryStore.branch_categories;
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
    CREATE INDEX IF NOT EXISTS idx_customer_addresses_phone ON customer_addresses(brand_id, customer_phone);


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

    CREATE TABLE IF NOT EXISTS branch_categories (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      image_url TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS branch_products (
      branch_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      branch_category_id TEXT,
      product_name TEXT,
      product_description TEXT,
      product_image_url TEXT,
      -- Override columns: NULL = inherit from Master Product; non-NULL = branch value wins.
      name_override TEXT,
      description_override TEXT,
      image_override TEXT,
      price REAL,
      stock INTEGER DEFAULT 100,
      is_available INTEGER DEFAULT 1,
      low_stock_threshold INTEGER DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (branch_id, product_id),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_category_id) REFERENCES branch_categories(id) ON DELETE SET NULL
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
    CREATE TABLE IF NOT EXISTS branch_dining_layouts (
      id TEXT PRIMARY KEY,
      branch_id TEXT UNIQUE NOT NULL,
      canvas_config TEXT NOT NULL DEFAULT '{"width":380,"height":620}',
      sections_config TEXT NOT NULL DEFAULT '[]',
      non_table_objects_config TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS branch_tables (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      table_number TEXT NOT NULL,
      label TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 4,
      section_id TEXT,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 80,
      height REAL NOT NULL DEFAULT 60,
      shape TEXT NOT NULL DEFAULT 'rectangle',
      orientation TEXT NOT NULL DEFAULT 'horizontal',
      qr_token TEXT UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_tables_num ON branch_tables(branch_id, table_number);

    CREATE TABLE IF NOT EXISTS branch_table_states (
      table_id TEXT PRIMARY KEY,
      operational_state TEXT NOT NULL DEFAULT 'available', -- 'available' | 'held' | 'occupied' | 'reserved' | 'blocked'
      current_session_id TEXT,
      notes TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (table_id) REFERENCES branch_tables(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS branch_table_holds (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      table_id TEXT NOT NULL,
      customer_phone TEXT,
      hold_reference_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'converted' | 'expired' | 'cancelled'
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (table_id) REFERENCES branch_tables(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bth_ref ON branch_table_holds(hold_reference_id);
    CREATE INDEX IF NOT EXISTS idx_bth_expires ON branch_table_holds(expires_at) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS dining_sessions (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      customer_name TEXT,
      customer_phone TEXT,
      guest_count INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'completed'
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dining_session_tables (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      table_id TEXT NOT NULL,
      attached_at TEXT DEFAULT (datetime('now')),
      UNIQUE (session_id, table_id),
      FOREIGN KEY (session_id) REFERENCES dining_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (table_id) REFERENCES branch_tables(id) ON DELETE CASCADE
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
  try { targetDb.exec('ALTER TABLE orders ADD COLUMN dining_session_id TEXT;'); } catch (e) {}
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

  // MASTER CATALOG ↔ BRANCH CATALOG: branch_products snapshot columns and
  // branch_categories table. Idempotent — safe for fresh and existing databases.
  try { targetDb.exec('ALTER TABLE branch_products ADD COLUMN branch_category_id TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE branch_products ADD COLUMN product_name TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE branch_products ADD COLUMN product_description TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE branch_products ADD COLUMN product_image_url TEXT;'); } catch (e) {}
  // Override columns (Master Product Default + Branch Optional Override architecture).
  // NULL = inherit from Master Product at query time; non-NULL = branch value wins.
  try { targetDb.exec('ALTER TABLE branch_products ADD COLUMN name_override TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE branch_products ADD COLUMN description_override TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE branch_products ADD COLUMN image_override TEXT;'); } catch (e) {}

  // BRANCH CATEGORY MANAGEMENT (Kategori Cabang upgrade): branch_categories needs its
  // own image reference + updated_at so the dashboard can rename/re-image a category
  // and have Home read the same persisted value. Idempotent — safe on existing DBs.
  try { targetDb.exec('ALTER TABLE branch_categories ADD COLUMN image_url TEXT;'); } catch (e) {}
  try { targetDb.exec("ALTER TABLE branch_categories ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));"); } catch (e) {}

  // WORKFORCE MANAGEMENT: user lifecycle, password security, and audit
  // Idempotent — safe on existing databases with or without these columns.
  try { targetDb.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';"); } catch (e) {}
  try { targetDb.exec('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE users ADD COLUMN locked_until TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE users ADD COLUMN password_changed_at TEXT;'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT;'); } catch (e) {}

  // One-time password reset tokens (single-use, time-limited)
  try {
    targetDb.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id);'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);'); } catch (e) {}

  // Security audit log for workforce mutations (append-only)
  try {
    targetDb.exec(`
      CREATE TABLE IF NOT EXISTS security_audit_log (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        target_user_id TEXT,
        target_role TEXT,
        brand_id TEXT,
        organization_id TEXT,
        branch_id TEXT,
        result TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_sal_actor ON security_audit_log(actor_id);'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_sal_target ON security_audit_log(target_user_id);'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_sal_action ON security_audit_log(action);'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_sal_brand ON security_audit_log(brand_id);'); } catch (e) {}

  // Migrate existing branch_products:
  // 1. Fill legacy snapshot columns (product_name, etc.) idempotently from master for pre-override rows.
  // 2. Migrate legacy snapshot → override:
  //    If the legacy snapshot value DIFFERS from the current master value, that difference is
  //    a genuine branch customisation — preserve it as an explicit override.
  //    If identical to master (was just a copy), leave override NULL so the branch inherits live master.
  //    Idempotent: only runs on rows where name_override IS NULL (not yet migrated).
  // 3. Create/resolve branch-owned categories (NOT master category_id).
  // 4. Establish branch selling price from master ONCE.
  try {
    // Step 1: Fill legacy snapshot columns for rows that never had them (pre-override schema rows).
    targetDb.exec(`
      UPDATE branch_products
      SET product_name = COALESCE(product_name, (SELECT name FROM products WHERE id = branch_products.product_id)),
          product_description = COALESCE(product_description, (SELECT description FROM products WHERE id = branch_products.product_id)),
          product_image_url = COALESCE(product_image_url, (SELECT image_url FROM products WHERE id = branch_products.product_id))
      WHERE product_name IS NULL
    `);

    // Step 2: Migrate legacy snapshot values → override columns.
    // Idempotent guard: only process rows where name_override IS NULL (not yet evaluated).
    // name: if legacy snapshot differs from current master → set name_override, else leave NULL.
    targetDb.exec(`
      UPDATE branch_products
      SET name_override = CASE
            WHEN product_name IS NOT NULL
             AND product_name != (SELECT name FROM products WHERE id = branch_products.product_id)
            THEN product_name
            ELSE NULL
          END
      WHERE name_override IS NULL AND product_name IS NOT NULL
    `);
    // description
    targetDb.exec(`
      UPDATE branch_products
      SET description_override = CASE
            WHEN product_description IS NOT NULL
             AND product_description != (SELECT description FROM products WHERE id = branch_products.product_id)
            THEN product_description
            ELSE NULL
          END
      WHERE description_override IS NULL AND product_description IS NOT NULL
    `);
    // image
    targetDb.exec(`
      UPDATE branch_products
      SET image_override = CASE
            WHEN product_image_url IS NOT NULL
             AND product_image_url != (SELECT image_url FROM products WHERE id = branch_products.product_id)
            THEN product_image_url
            ELSE NULL
          END
      WHERE image_override IS NULL AND product_image_url IS NOT NULL
    `);

    // Step 3: Create branch-owned categories for adopted products.
    // For each branch + master category combination, ensure a branch-owned category exists.
    // This maps Master Category → Branch Category deterministically.
    // Each branch_product is updated by its own (branch_id, product_id) identity,
    // NOT by branch_id alone — multiple products in the same branch can map to
    // different master categories and therefore different branch categories.
    const legacyBranchProducts = targetDb.prepare(`
      SELECT DISTINCT bp.branch_id, bp.product_id, p.category_id as master_cat_id, p.brand_id
      FROM branch_products bp
      JOIN products p ON bp.product_id = p.id
      WHERE bp.branch_category_id IS NULL AND p.category_id IS NOT NULL
    `).all();

    for (const row of legacyBranchProducts) {
      // Find existing master category name
      const masterCat = targetDb.prepare('SELECT name, slug FROM categories WHERE id = ?').get(row.master_cat_id);
      const catName = masterCat?.name || 'Lainnya';
      const catSlug = masterCat?.slug || 'lainnya';

      // Find or create branch-owned category with same name
      let branchCat = targetDb.prepare(
        'SELECT id FROM branch_categories WHERE branch_id = ? AND name = ?'
      ).get(row.branch_id, catName);

      if (!branchCat) {
        const bcId = `bc_mig_${row.branch_id}_${row.master_cat_id}`;
        targetDb.prepare(`
          INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
          VALUES (?, ?, ?, ?, ?, 99)
        `).run(bcId, row.brand_id, row.branch_id, catName, catSlug);
        branchCat = { id: bcId };
      }

      // Link THIS branch_product to the branch-owned category by its exact identity.
      targetDb.prepare(
        'UPDATE branch_products SET branch_category_id = ? WHERE branch_id = ? AND product_id = ? AND branch_category_id IS NULL'
      ).run(branchCat.id, row.branch_id, row.product_id);
    }

    // Step 4: Establish branch selling price from master ONCE for adopted products without price.
    // After this, branch_products.price is the Branch selling authority.
    targetDb.exec(`
      UPDATE branch_products
      SET price = (SELECT price FROM products WHERE id = branch_products.product_id)
      WHERE price IS NULL
    `);
  } catch (e) {
    console.error('[db] Branch catalog migration failed:', e.message);
    throw e;
  }

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

  // Seed default initial merchant owner if users table is empty (bcrypt hashed)
  const userCount = targetDb.prepare('SELECT COUNT(*) as cnt FROM users WHERE brand_id = ?').get(brandId)?.cnt || 0;
  if (userCount === 0) {
    const bcrypt = require('bcryptjs');
    
    // Secure default initial merchant credential
    const initPassword = process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123';
    const defaultPasswordHash = bcrypt.hashSync(initPassword, 12);
    targetDb.prepare(`
      INSERT OR IGNORE INTO users (id, brand_id, organization_id, username, email, password_hash, full_name, role, status, password_changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    `).run('usr_bangjo_owner', brandId, orgId, 'admin', 'admin@bangjo.com', defaultPasswordHash, 'Pemilik Bangjo', 'owner');
  }

  // Migration: force re-hash admin password to bcrypt if still using legacy hash (SHA-256/MD5/etc)
  // This ensures the admin can always login after bcrypt migration
  try {
    const bcrypt = require('bcryptjs');
    const adminUser = targetDb.prepare('SELECT id, password_hash FROM users WHERE username = ? AND brand_id = ?').get('admin', brandId);
    if (adminUser && !adminUser.password_hash.startsWith('$2')) {
      const initPassword = process.env.INITIAL_ADMIN_PASSWORD || 'bangjo123';
      const newHash = bcrypt.hashSync(initPassword, 12);
      targetDb.prepare('UPDATE users SET password_hash = ?, password_changed_at = datetime(\'now\') WHERE id = ?').run(newHash, adminUser.id);
      console.log('[Migration] Admin password re-hashed from legacy format to bcrypt.');
    }
  } catch (e) {
    console.warn('[Migration] Admin password re-hash skipped:', e.message);
  }

  let branch = null;
  try {
    branch = targetDb.prepare('SELECT id FROM branches WHERE brand_id = ? LIMIT 1').get(brandId);
  } catch (e) {}
  const branchBaratId = 'branch_bangjo_barat';
  const branchTimurId = 'branch_bangjo_timur';
  const branchPusatId = 'branch_bangjo_pusat';
  const branchUtaraId = 'branch_bangjo_utara';
  const branchSelatanId = 'branch_bangjo_selatan';

  const demoBranches = [
    {
      id: branchBaratId,
      name: 'Bangjo Surabaya Barat',
      slug: 'surabaya-barat',
      address: 'Jl. Mayjen Sungkono No. 88, Surabaya Barat',
      lat: -7.2912,
      lng: 112.7154,
      phone: '081234567890',
      bds: { id: 'bds_barat_' + branchBaratId, max_radius: 12.0, free_km: 0, price_km: 3000.0, min_order: 15000.0, promo_discount: 5000.0, promo_min: 50000.0 }
    },
    {
      id: branchTimurId,
      name: 'Bangjo Surabaya Timur',
      slug: 'surabaya-timur',
      address: 'Jl. Dharmawangsa No. 12, Surabaya Timur',
      lat: -7.2845,
      lng: 112.7560,
      phone: '081234567891',
      bds: { id: 'bds_timur_' + branchTimurId, max_radius: 10.0, free_km: 3.0, price_km: 2500.0, min_order: 15000.0, promo_discount: 3000.0, promo_min: 40000.0 }
    },
    {
      id: branchPusatId,
      name: 'Bangjo Surabaya Pusat',
      slug: 'surabaya-pusat',
      address: 'Jl. Basuki Rahmat No. 25, Surabaya Pusat',
      lat: -7.2600,
      lng: 112.7400,
      phone: '081234567892',
      bds: { id: 'bds_pusat_' + branchPusatId, max_radius: 10.0, free_km: 2.5, price_km: 3000.0, min_order: 15000.0, promo_discount: 5000.0, promo_min: 45000.0 }
    },
    {
      id: branchUtaraId,
      name: 'Bangjo Surabaya Utara',
      slug: 'surabaya-utara',
      address: 'Jl. Perak Timur No. 40, Surabaya Utara',
      lat: -7.2300,
      lng: 112.7350,
      phone: '081234567893',
      bds: { id: 'bds_utara_' + branchUtaraId, max_radius: 12.0, free_km: 2.0, price_km: 3000.0, min_order: 15000.0, promo_discount: 4000.0, promo_min: 50000.0 }
    },
    {
      id: branchSelatanId,
      name: 'Bangjo Surabaya Selatan',
      slug: 'surabaya-selatan',
      address: 'Jl. Ahmad Yani No. 102, Surabaya Selatan',
      lat: -7.3150,
      lng: 112.7300,
      phone: '081234567894',
      bds: { id: 'bds_selatan_' + branchSelatanId, max_radius: 15.0, free_km: 3.0, price_km: 2500.0, min_order: 15000.0, promo_discount: 5000.0, promo_min: 40000.0 }
    }
  ];

  for (const b of demoBranches) {
    targetDb.prepare(`
      INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(b.id, brandId, b.name, b.slug, b.address, b.lat, b.lng, b.phone);

    targetDb.prepare(`
      INSERT OR IGNORE INTO branch_delivery_settings (id, branch_id, max_radius_km, free_delivery_km, price_per_km, min_order_amount, promo_delivery_discount, promo_min_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.bds.id, b.id, b.bds.max_radius, b.bds.free_km, b.bds.price_km, b.bds.min_order, b.bds.promo_discount, b.bds.promo_min);
  }

  // Safe cleanup of legacy demo branches for brandId that have 0 orders
  // Safe cleanup of non-canonical branches for brandId
  try {
    const targetBranchIds = demoBranches.map(b => b.id);
    const existingBrandBranches = targetDb.prepare('SELECT id FROM branches WHERE brand_id = ?').all(brandId);
    for (const eb of existingBrandBranches) {
      if (!targetBranchIds.includes(eb.id)) {
        try { targetDb.prepare('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE branch_id = ?)').run(eb.id); } catch(_) {}
        try { targetDb.prepare('DELETE FROM order_status_logs WHERE order_id IN (SELECT id FROM orders WHERE branch_id = ?)').run(eb.id); } catch(_) {}
        try { targetDb.prepare('DELETE FROM order_deliveries WHERE order_id IN (SELECT id FROM orders WHERE branch_id = ?)').run(eb.id); } catch(_) {}
        try { targetDb.prepare('DELETE FROM order_payments WHERE order_id IN (SELECT id FROM orders WHERE branch_id = ?)').run(eb.id); } catch(_) {}
        try { targetDb.prepare('DELETE FROM orders WHERE branch_id = ?').run(eb.id); } catch(_) {}
        try { targetDb.prepare('DELETE FROM branch_products WHERE branch_id = ?').run(eb.id); } catch(_) {}
        try { targetDb.prepare('DELETE FROM branch_categories WHERE branch_id = ?').run(eb.id); } catch(_) {}
        try { targetDb.prepare('DELETE FROM branch_delivery_settings WHERE branch_id = ?').run(eb.id); } catch(_) {}
        try { targetDb.prepare('DELETE FROM branch_operation_logs WHERE branch_id = ?').run(eb.id); } catch(_) {}
        try { targetDb.prepare('DELETE FROM branches WHERE id = ?').run(eb.id); } catch(_) {}
      }
    }
  } catch (e) {
    console.warn('[db] Safe branch cleanup skipped:', e.message);
  }

  // MASTER CATEGORIES & PRODUCTS (Superset for all branches)
  const catMakanan = '34';
  const catMinuman = '22';
  const catSnack = '36';

  targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catMakanan, brandId, 'Makanan', 'makanan', 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png', 1);
  targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catMinuman, brandId, 'Minuman', 'minuman', 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', 2);
  targetDb.prepare(`INSERT OR IGNORE INTO categories (id, brand_id, name, slug, image_url, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catSnack, brandId, 'Snack', 'snack', 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png', 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png', 3);

  const masterProducts = [
    { id: '272', cat: catMakanan, name: 'Nasi Goreng', price: 25000, reg: 25000, desc: 'Nasi goreng spesial dengan bumbu khas Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' },
    { id: '285', cat: catMakanan, name: 'Ayam Geprek', price: 28000, reg: 28000, desc: 'Ayam goreng tepung dengan sambal geprek pedas.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png' },
    { id: '288', cat: catMinuman, name: 'Es Teh', price: 5000, reg: 5000, desc: 'Teh melati seduh dingin segar.', img: '/assets/img/iced-tea.png' },
    { id: '287', cat: catMinuman, name: 'Kopi Susu', price: 15000, reg: 15000, desc: 'Kopi susu gula aren racikan istimewa barista Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png' },
    { id: '345', cat: catSnack, name: 'Kentang Goreng', price: 12000, reg: 12000, desc: 'Kentang goreng renyah dengan bumbu balado.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' },
    { id: '286', cat: catMakanan, name: 'Ayam Bakar', price: 28000, reg: 32000, desc: 'Ayam bakar rempah lumuran bumbu khas Bangjo empuk sampai ke tulang.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png' },
    { id: '401', cat: catMinuman, name: 'Es Teh Manis', price: 6000, reg: 6000, desc: 'Teh melati seduh dingin manis segar.', img: '/assets/img/iced-tea.png' },
    { id: '346', cat: catMakanan, name: 'Mie Goreng Bangjo', price: 22000, reg: 22000, desc: 'Mie goreng spesial bumbu rempah pilihan Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png' },
  ];

  for (let i = 0; i < masterProducts.length; i++) {
    const p = masterProducts[i];
    targetDb.prepare(`
      INSERT OR IGNORE INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, image_url, image, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, brandId, p.cat, p.name, p.name.toLowerCase().replace(/ /g, '-'), p.desc, p.price, p.reg, p.img, p.img, i + 1);
  }

  // BRANCH CATEGORIES: each branch owns its own category structure.
  // Branch categories are independent from Master Categories.
  const branchCategories = [
    // Barat
    { id: 'bc_barat_favorit', brand: brandId, branch: branchBaratId, name: 'Menu Favorit', slug: 'menu-favorit', sort: 1 },
    { id: 'bc_barat_minuman', brand: brandId, branch: branchBaratId, name: 'Minuman Segar', slug: 'minuman-segar', sort: 2 },
    { id: 'bc_barat_snack', brand: brandId, branch: branchBaratId, name: 'Cemilan', slug: 'cemilan', sort: 3 },
    // Timur
    { id: 'bc_timur_paket', brand: brandId, branch: branchTimurId, name: 'Paket Hemat', slug: 'paket-hemat', sort: 1 },
    { id: 'bc_timur_kopi', brand: brandId, branch: branchTimurId, name: 'Kopi & Teh', slug: 'kopi-teh', sort: 2 },
    // Pusat
    { id: 'bc_pusat_rekomendasi', brand: brandId, branch: branchPusatId, name: 'Rekomendasi Chef', slug: 'rekomendasi-chef', sort: 1 },
    { id: 'bc_pusat_snack', brand: brandId, branch: branchPusatId, name: 'Kudapan', slug: 'kudapan', sort: 2 },
    // Utara
    { id: 'bc_utara_bestseller', brand: brandId, branch: branchUtaraId, name: 'Best Seller', slug: 'best-seller', sort: 1 },
    { id: 'bc_utara_minuman', brand: brandId, branch: branchUtaraId, name: 'Minuman Segar', slug: 'minuman-segar', sort: 2 },
    // Selatan
    { id: 'bc_selatan_makan', brand: brandId, branch: branchSelatanId, name: 'Menu Utama', slug: 'menu-utama', sort: 1 },
    { id: 'bc_selatan_kopi', brand: brandId, branch: branchSelatanId, name: 'Kedai Kopi & Teh', slug: 'kedai-kopi-teh', sort: 2 },
  ];

  for (const bc of branchCategories) {
    targetDb.prepare(`
      INSERT OR IGNORE INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(bc.id, bc.brand, bc.branch, bc.name, bc.slug, bc.sort);
  }

  // BRANCH-SCOPED PRODUCT ASSIGNMENTS with snapshot fields and branch category.
  // Each branch adopts a different subset and places products into its own categories.
  const branchAssignments = [
    // Barat (4 products)
    { branch: branchBaratId, productId: '272', catId: 'bc_barat_favorit', name: 'Nasi Goreng', desc: 'Nasi goreng spesial dengan bumbu khas Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 25000, stock: 50, available: 1 },
    { branch: branchBaratId, productId: '285', catId: 'bc_barat_favorit', name: 'Ayam Geprek', desc: 'Ayam goreng tepung dengan sambal geprek pedas.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-04_05_15-PM-300x300.png', price: 28000, stock: 30, available: 0 },
    { branch: branchBaratId, productId: '288', catId: 'bc_barat_minuman', name: 'Es Teh', desc: 'Teh melati seduh dingin segar.', img: '/assets/img/iced-tea.png', price: 5000, stock: 100, available: 1 },
    { branch: branchBaratId, productId: '345', catId: 'bc_barat_snack', name: 'Kentang Goreng', desc: 'Kentang goreng renyah dengan bumbu balado.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', price: 12000, stock: 40, available: 1 },
    // Timur (2 products)
    { branch: branchTimurId, productId: '272', catId: 'bc_timur_paket', name: 'Nasi Goreng', desc: 'Nasi goreng spesial dengan bumbu khas Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 25000, stock: 75, available: 1 },
    { branch: branchTimurId, productId: '287', catId: 'bc_timur_kopi', name: 'Kopi Susu', desc: 'Kopi susu gula aren racikan istimewa barista Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', price: 15000, stock: 60, available: 1 },
    // Pusat (3 products)
    { branch: branchPusatId, productId: '346', catId: 'bc_pusat_rekomendasi', name: 'Mie Goreng Bangjo', desc: 'Mie goreng spesial bumbu rempah pilihan Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', price: 22000, stock: 40, available: 1 },
    { branch: branchPusatId, productId: '286', catId: 'bc_pusat_rekomendasi', name: 'Ayam Bakar', desc: 'Ayam bakar rempah lumuran bumbu khas Bangjo empuk sampai ke tulang.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 28000, stock: 25, available: 1 },
    { branch: branchPusatId, productId: '345', catId: 'bc_pusat_snack', name: 'Kentang Goreng', desc: 'Kentang goreng renyah dengan bumbu balado.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', price: 12000, stock: 50, available: 1 },
    // Utara (3 products)
    { branch: branchUtaraId, productId: '272', catId: 'bc_utara_bestseller', name: 'Nasi Goreng', desc: 'Nasi goreng spesial dengan bumbu khas Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 26000, stock: 60, available: 1 },
    { branch: branchUtaraId, productId: '286', catId: 'bc_utara_bestseller', name: 'Ayam Bakar', desc: 'Ayam bakar rempah lumuran bumbu khas Bangjo empuk sampai ke tulang.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 30000, stock: 20, available: 1 },
    { branch: branchUtaraId, productId: '401', catId: 'bc_utara_minuman', name: 'Es Teh Manis', desc: 'Teh melati seduh dingin manis segar.', img: '/assets/img/iced-tea.png', price: 6000, stock: 80, available: 1 },
    // Selatan (4 products)
    { branch: branchSelatanId, productId: '272', catId: 'bc_selatan_makan', name: 'Nasi Goreng', desc: 'Nasi goreng spesial dengan bumbu khas Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-02_13_17-PM-300x300.png', price: 25000, stock: 45, available: 1 },
    { branch: branchSelatanId, productId: '346', catId: 'bc_selatan_makan', name: 'Mie Goreng Bangjo', desc: 'Mie goreng spesial bumbu rempah pilihan Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-4-2026-09_24_59-AM-300x300.png', price: 22000, stock: 35, available: 1 },
    { branch: branchSelatanId, productId: '287', catId: 'bc_selatan_kopi', name: 'Kopi Susu', desc: 'Kopi susu gula aren racikan istimewa barista Bangjo.', img: 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png', price: 16000, stock: 50, available: 1 },
    { branch: branchSelatanId, productId: '288', catId: 'bc_selatan_kopi', name: 'Es Teh', desc: 'Teh melati seduh dingin segar.', img: '/assets/img/iced-tea.png', price: 5000, stock: 90, available: 1 }
  ];

  for (const a of branchAssignments) {
    const existing = targetDb.prepare('SELECT branch_id, product_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(a.branch, a.productId);
    if (!existing) {
      targetDb.prepare(`
        INSERT INTO branch_products (branch_id, product_id, branch_category_id, product_name, product_description, product_image_url, price, stock, is_available, low_stock_threshold)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 5)
      `).run(a.branch, a.productId, a.catId, a.name, a.desc, a.img, a.price, a.stock, a.available);
    } else {
      targetDb.prepare(`
        UPDATE branch_products
        SET branch_category_id = ?, product_name = ?, product_description = ?, product_image_url = ?, price = ?, stock = ?, is_available = ?
        WHERE branch_id = ? AND product_id = ?
      `).run(a.catId, a.name, a.desc, a.img, a.price, a.stock, a.available, a.branch, a.productId);
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

db.readyPromise = dbReadyPromise;

// Auto-run schema initialization for native instance (sql.js runs it in sqlJsPromise callback)
if (dbInstance) {
  initSchema(db);
}

module.exports = db;
