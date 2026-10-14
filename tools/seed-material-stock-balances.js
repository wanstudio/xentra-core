'use strict';

const db = require('../server/database/db');

const STOCK_LOCATION_ID = 'sl_bangjo_pringsewu';

// Harga pasar kulakan wajar bahan baku per base_uom
const MATERIAL_PRICES = {
  // Daging & Seafood (uom_kg)
  'mat_ayam_negeri': 36000,
  'mat_ayam_kampung': 55000,
  'mat_ayam_fresh': 38000,
  'mat_udang_segar': 68000,
  'mat_teri_medan': 85000,
  'mat_telur_ayam': 28000,

  // Tempe & Tahu (uom_pcs)
  'mat_tempe_mentah': 4000,
  'mat_tahu_mentah': 800,

  // Sayuran & Segaran
  'mat_kangkung': 2500,     // uom_pcs (ikat)
  'mat_terong': 9000,       // uom_kg
  'mat_timun': 7000,        // uom_kg
  'mat_tomat_merah': 12000,  // uom_kg
  'mat_tomat_hijau': 10000,  // uom_kg
  'mat_kol_lalap': 8000,    // uom_kg
  'mat_kemangi': 2000,      // uom_pcs (ikat)
  'mat_jeruk_peras': 14000, // uom_kg

  // Bumbu Rempah & Cabai (uom_kg kecuali lembar/batang)
  'mat_bawang_putih': 36000,
  'mat_bawang_merah': 34000,
  'mat_cabai_rawit': 50000,
  'mat_cabai_rawit_hijau': 35000,
  'mat_cabai_merah_keriting': 38000,
  'mat_cabai_hijau_besar': 28000,
  'mat_kunyit': 12000,
  'mat_jahe': 22000,
  'mat_lengkuas': 15000,
  'mat_ketumbar': 30000,
  'mat_kemiri': 42000,
  'mat_daun_salam': 100,    // uom_pcs
  'mat_serai': 500,         // uom_pcs
  'mat_daun_jeruk': 100,    // uom_pcs
  'mat_terasi_udang': 60000,

  // Penyedap, Perasa & Saus
  'mat_garam_halus': 8000,
  'mat_garam_dapur': 4000,
  'mat_royco_ayam': 42000,
  'mat_msg_micin': 38000,
  'mat_gula_pasir': 17500,
  'mat_gula_aren': 25000,
  'mat_saus_tiram': 32000,
  'mat_saos_sambal': 20000,

  // Karbo, Tepung & Olahan Snack
  'mat_beras_pulen': 14500,
  'mat_mie_telur': 18000,
  'mat_tepung_beras': 14000,
  'mat_tepung_tapioka': 16000,
  'mat_kentang_frozen': 28000,
  'mat_kulit_pangsit': 200,   // uom_pcs
  'mat_dumpling_raw': 1500,   // uom_pcs

  // Minyak & Cairan (uom_l)
  'mat_minyak_goreng': 16500,
  'mat_air_masak': 500,
  'mat_santan_cair': 18000,
  'mat_susu_uht': 17500,
  'mat_skm': 24000,
  'mat_air_soda': 12000,
  'mat_sirup_merah': 21000,

  // Minuman & Bubuk
  'mat_daun_teh': 40000,
  'mat_kopi_bubuk': 80000,
  'mat_es_batu': 1500,
  'mat_milo_bubuk': 75000,
  'mat_matcha_bubuk': 90000,
  'mat_powder_banana': 65000,
  'mat_powder_vanilla': 65000,
  'mat_powder_taro': 65000,
  'mat_syrup_pistachio': 75000,
  'mat_syrup_butterscotch': 75000,
  'mat_syrup_salted_caramel': 75000,
  'mat_rempah_uwuh': 3000,    // uom_pcs
  'mat_bubuk_beras_kencur': 45000,
  'mat_air_mineral_botol': 2500 // uom_pcs
};

function run() {
  console.log('Seeding material stock balances & unit costs in location:', STOCK_LOCATION_ID);
  
  const insertOrReplace = db.prepare(`
    INSERT INTO material_stock_balances (
      stock_location_id, material_id, quantity_base, carrying_value,
      moving_average_unit_cost, cost_availability_status, valuation_version,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, 'AVAILABLE', 1,
      datetime('now'), datetime('now')
    )
    ON CONFLICT(stock_location_id, material_id) DO UPDATE SET
      moving_average_unit_cost = excluded.moving_average_unit_cost,
      carrying_value = material_stock_balances.quantity_base * excluded.moving_average_unit_cost,
      cost_availability_status = 'AVAILABLE',
      updated_at = datetime('now')
  `);

  let count = 0;
  for (const [matId, unitPrice] of Object.entries(MATERIAL_PRICES)) {
    // Check if material exists
    const mat = db.prepare('SELECT id, name FROM materials WHERE id = ?').get(matId);
    if (!mat) {
      console.warn(`Material not found: ${matId}`);
      continue;
    }

    // Default initial stock: e.g. 10 base units
    const initialQty = 10;
    const carryingValue = initialQty * unitPrice;
    insertOrReplace.run(STOCK_LOCATION_ID, matId, initialQty, carryingValue, unitPrice);
    count++;
  }

  console.log(`Successfully updated ${count} materials with realistic market purchase costs!`);
}

run();
