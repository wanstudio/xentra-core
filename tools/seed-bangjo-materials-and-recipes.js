'use strict';

const db = require('../server/database/db');
const { ProductionService } = require('../domains/production');
const ProductionRepository = require('../core/data/repositories/ProductionRepository');
const MaterialRepository = require('../core/data/repositories/MaterialRepository');
const UomRepository = require('../core/data/repositories/UomRepository');
const InventoryRepository = require('../core/data/repositories/InventoryRepository');

const productionRepository = new ProductionRepository();
const materialRepository = new MaterialRepository();
const uomRepository = new UomRepository();
const inventoryRepository = new InventoryRepository();

const ORG_ID = 'org_xentra_holding';
const BRAND_ID = 'brand_bangjo';
const STOCK_LOCATION_ID = 'sl_bangjo_pringsewu';

// Master bahan baku mentah
const RAW_MATERIALS = [
  // Unggas & Daging & Seafood
  { id: 'mat_ayam_kampung', code: 'AYM-02', name: 'Daging Ayam Kampung Utuh', base_uom_id: 'uom_kg' },
  { id: 'mat_ayam_negeri', code: 'AYM-03', name: 'Daging Ayam Negeri Karkas', base_uom_id: 'uom_kg' },
  { id: 'mat_udang_segar', code: 'UDG-01', name: 'Udang Segar Kupas', base_uom_id: 'uom_kg' },
  
  // Tahu, Tempe, Nabati
  { id: 'mat_tempe_mentah', code: 'TMP-01', name: 'Tempe Kedelai Mentah Papan', base_uom_id: 'uom_pcs' },
  { id: 'mat_tahu_mentah', code: 'TAH-01', name: 'Tahu Putih Mentah Kotak', base_uom_id: 'uom_pcs' },
  { id: 'mat_teri_medan', code: 'TRI-01', name: 'Ikan Teri Medan Asin', base_uom_id: 'uom_kg' },

  // Sayuran & Segaran
  { id: 'mat_kangkung', code: 'KGK-01', name: 'Sayur Kangkung Segar', base_uom_id: 'uom_pcs' },
  { id: 'mat_terong', code: 'TRG-01', name: 'Terong Ungu Segar', base_uom_id: 'uom_kg' },
  { id: 'mat_timun', code: 'TMN-01', name: 'Timun Segar Lalap', base_uom_id: 'uom_kg' },
  { id: 'mat_tomat_merah', code: 'TMT-01', name: 'Tomat Merah Segar', base_uom_id: 'uom_kg' },
  { id: 'mat_tomat_hijau', code: 'TMT-02', name: 'Tomat Hijau Segar', base_uom_id: 'uom_kg' },
  { id: 'mat_kol_lalap', code: 'KOL-01', name: 'Kol Segar Lalapan', base_uom_id: 'uom_kg' },
  { id: 'mat_kemangi', code: 'KMG-01', name: 'Daun Kemangi Segar', base_uom_id: 'uom_pcs' },
  { id: 'mat_jeruk_peras', code: 'JRK-01', name: 'Jeruk Peras Segar', base_uom_id: 'uom_kg' },

  // Bumbu Rempah & Cabai
  { id: 'mat_bawang_putih', code: 'BWP-01', name: 'Bawang Putih Kating', base_uom_id: 'uom_kg' },
  { id: 'mat_cabai_rawit_hijau', code: 'CBR-02', name: 'Cabai Rawit Hijau', base_uom_id: 'uom_kg' },
  { id: 'mat_cabai_merah_keriting', code: 'CBK-01', name: 'Cabai Merah Keriting', base_uom_id: 'uom_kg' },
  { id: 'mat_cabai_hijau_besar', code: 'CBH-01', name: 'Cabai Hijau Besar', base_uom_id: 'uom_kg' },
  { id: 'mat_kunyit', code: 'KNY-01', name: 'Kunyit Segar', base_uom_id: 'uom_kg' },
  { id: 'mat_jahe', code: 'JHE-01', name: 'Jahe Segar', base_uom_id: 'uom_kg' },
  { id: 'mat_lengkuas', code: 'LKS-01', name: 'Lengkuas Segar', base_uom_id: 'uom_kg' },
  { id: 'mat_ketumbar', code: 'KTM-01', name: 'Ketumbar Bubuk', base_uom_id: 'uom_kg' },
  { id: 'mat_kemiri', code: 'KMR-01', name: 'Kemiri Bulat', base_uom_id: 'uom_kg' },
  { id: 'mat_daun_salam', code: 'SLM-01', name: 'Daun Salam Lembar', base_uom_id: 'uom_pcs' },
  { id: 'mat_serai', code: 'SER-01', name: 'Serai Wangi Batang', base_uom_id: 'uom_pcs' },
  { id: 'mat_daun_jeruk', code: 'DJR-01', name: 'Daun Jeruk Purut Lembar', base_uom_id: 'uom_pcs' },
  { id: 'mat_terasi_udang', code: 'TRS-01', name: 'Terasi Udang Matang', base_uom_id: 'uom_kg' },

  // Penyedap, Perasa, Gula & Saus
  { id: 'mat_garam_halus', code: 'GRM-02', name: 'Garam Halus Dapur', base_uom_id: 'uom_kg' },
  { id: 'mat_royco_ayam', code: 'RYC-01', name: 'Royco Penyedap Rasa Ayam', base_uom_id: 'uom_kg' },
  { id: 'mat_msg_micin', code: 'MSG-01', name: 'Penyedap Rasa / MSG Micin', base_uom_id: 'uom_kg' },
  { id: 'mat_gula_pasir', code: 'GLA-01', name: 'Gula Pasir Kristal', base_uom_id: 'uom_kg' },
  { id: 'mat_gula_aren', code: 'GLA-02', name: 'Gula Aren / Gula Jawa', base_uom_id: 'uom_kg' },
  { id: 'mat_saus_tiram', code: 'STR-01', name: 'Saus Tiram', base_uom_id: 'uom_kg' },
  { id: 'mat_saos_sambal', code: 'SOS-01', name: 'Saos Sambal Botol', base_uom_id: 'uom_kg' },

  // Karbohidrat, Tepung & Olahan Snack
  { id: 'mat_beras_pulen', code: 'BRS-01', name: 'Beras Putih Pulen', base_uom_id: 'uom_kg' },
  { id: 'mat_mie_telur', code: 'MIE-01', name: 'Mie Kuning Telur Mentah', base_uom_id: 'uom_kg' },
  { id: 'mat_tepung_beras', code: 'TPG-01', name: 'Tepung Beras', base_uom_id: 'uom_kg' },
  { id: 'mat_tepung_tapioka', code: 'TPG-02', name: 'Tepung Tapioka / Maizena', base_uom_id: 'uom_kg' },
  { id: 'mat_kentang_frozen', code: 'KTG-01', name: 'Kentang Potong Frozen', base_uom_id: 'uom_kg' },
  { id: 'mat_kulit_pangsit', code: 'PNG-01', name: 'Kulit Pangsit Mentah', base_uom_id: 'uom_pcs' },
  { id: 'mat_dumpling_raw', code: 'DMP-01', name: 'Dumpling Ayam Frozen Mentah', base_uom_id: 'uom_pcs' },

  // Minyak & Cairan
  { id: 'mat_minyak_goreng', code: 'MYK-01', name: 'Minyak Goreng Sawit', base_uom_id: 'uom_l' },
  { id: 'mat_air_masak', code: 'AIR-01', name: 'Air Bersih Masak RO', base_uom_id: 'uom_l' },
  { id: 'mat_santan_cair', code: 'STN-01', name: 'Santan Kelapa Cair', base_uom_id: 'uom_l' },
  { id: 'mat_susu_uht', code: 'SSU-01', name: 'Susu UHT Full Cream', base_uom_id: 'uom_l' },
  { id: 'mat_skm', code: 'SKM-01', name: 'Susu Kental Manis Putih', base_uom_id: 'uom_l' },
  { id: 'mat_air_soda', code: 'SDA-01', name: 'Air Soda Botol Plain', base_uom_id: 'uom_l' },
  { id: 'mat_sirup_merah', code: 'SRP-01', name: 'Sirup Coco Pandan Merah', base_uom_id: 'uom_l' },

  // Minuman & Bubuk
  { id: 'mat_daun_teh', code: 'TEH-01', name: 'Daun Teh Melati Tubruk', base_uom_id: 'uom_kg' },
  { id: 'mat_kopi_bubuk', code: 'KOP-01', name: 'Kopi Bubuk Robusta Bang Jo', base_uom_id: 'uom_kg' },
  { id: 'mat_es_batu', code: 'ESB-01', name: 'Es Batu Tube Kristal', base_uom_id: 'uom_kg' },
  { id: 'mat_milo_bubuk', code: 'MLO-01', name: 'Milo Bubuk Cokelat Malt', base_uom_id: 'uom_kg' },
  { id: 'mat_matcha_bubuk', code: 'MTC-01', name: 'Matcha Green Tea Bubuk', base_uom_id: 'uom_kg' },
  { id: 'mat_powder_banana', code: 'PDR-01', name: 'Powder Banana Milk', base_uom_id: 'uom_kg' },
  { id: 'mat_powder_vanilla', code: 'PDR-02', name: 'Powder Vanilla Milk', base_uom_id: 'uom_kg' },
  { id: 'mat_powder_taro', code: 'PDR-03', name: 'Powder Taro Milk', base_uom_id: 'uom_kg' },
  { id: 'mat_syrup_pistachio', code: 'SYR-01', name: 'Sirup Pistachio Flavor', base_uom_id: 'uom_l' },
  { id: 'mat_syrup_butterscotch', code: 'SYR-02', name: 'Sirup Butterscotch Flavor', base_uom_id: 'uom_l' },
  { id: 'mat_syrup_salted_caramel', code: 'SYR-03', name: 'Sirup Salted Caramel Flavor', base_uom_id: 'uom_l' },
  { id: 'mat_rempah_uwuh', code: 'RMP-01', name: 'Racikan Rempah Wedang Uwuh', base_uom_id: 'uom_pcs' },
  { id: 'mat_bubuk_beras_kencur', code: 'BKC-01', name: 'Bubuk Jamu Beras Kencur', base_uom_id: 'uom_kg' },
  { id: 'mat_air_mineral_botol', code: 'AMB-01', name: 'Air Mineral Botol 600ml Kemasan', base_uom_id: 'uom_pcs' }
];

// Definisi Resep per Produk Fisik (47 Items)
const RECIPE_DEFINITIONS = [
  // 1. Ayam Tulang Lunak (AYM-ATL-001) - Batch 10 Porsi Presto
  {
    sku: 'AYM-ATL-001',
    yieldQty: 10,
    recipeName: 'Resep Ungkep Presto Ayam Tulang Lunak (10 Porsi)',
    components: [
      { material_id: 'mat_ayam_negeri', planned_quantity: 2.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_bawang_putih', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 80, planned_uom_id: 'uom_g' },
      { material_id: 'mat_kunyit', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_jahe', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_lengkuas', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_ketumbar', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_daun_salam', planned_quantity: 5, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_serai', planned_quantity: 3, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_garam_halus', planned_quantity: 45, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_msg_micin', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 2, planned_uom_id: 'uom_l' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 0.5, planned_uom_id: 'uom_l' }
    ]
  },

  // 2. Ayam Kampung Asli (AYM-KMP-001) - Batch 10 Porsi Ungkep
  {
    sku: 'AYM-KMP-001',
    yieldQty: 10,
    recipeName: 'Resep Ungkep Ayam Kampung Asli (10 Porsi)',
    components: [
      { material_id: 'mat_ayam_kampung', planned_quantity: 2.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_bawang_putih', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 80, planned_uom_id: 'uom_g' },
      { material_id: 'mat_kunyit', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_jahe', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_lengkuas', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_ketumbar', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_daun_salam', planned_quantity: 5, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_serai', planned_quantity: 3, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_garam_halus', planned_quantity: 45, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_msg_micin', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 2, planned_uom_id: 'uom_l' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 0.5, planned_uom_id: 'uom_l' }
    ]
  },

  // 3. Ayam Negri (AYM-NGR-001) - Batch 10 Porsi Ungkep
  {
    sku: 'AYM-NGR-001',
    yieldQty: 10,
    recipeName: 'Resep Ungkep Ayam Negeri Bumbu Kuning (10 Porsi)',
    components: [
      { material_id: 'mat_ayam_negeri', planned_quantity: 2.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_bawang_putih', planned_quantity: 80, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 70, planned_uom_id: 'uom_g' },
      { material_id: 'mat_kunyit', planned_quantity: 40, planned_uom_id: 'uom_g' },
      { material_id: 'mat_ketumbar', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_daun_salam', planned_quantity: 4, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_serai', planned_quantity: 2, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_garam_halus', planned_quantity: 40, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_msg_micin', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 1.5, planned_uom_id: 'uom_l' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 0.5, planned_uom_id: 'uom_l' }
    ]
  },

  // 4. Ayam Porsi Kecil (AYM-KCL-001) - Batch 10 Porsi
  {
    sku: 'AYM-KCL-001',
    yieldQty: 10,
    recipeName: 'Resep Ungkep Ayam Hemat Porsi Kecil (10 Porsi)',
    components: [
      { material_id: 'mat_ayam_negeri', planned_quantity: 1.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_bawang_putih', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 40, planned_uom_id: 'uom_g' },
      { material_id: 'mat_kunyit', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_ketumbar', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 25, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 1, planned_uom_id: 'uom_l' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 0.3, planned_uom_id: 'uom_l' }
    ]
  },

  // 5. Nasi Putih (NAS-PTH-001) - Batch 15 Porsi Magic Com
  {
    sku: 'AYM-KCL-001' ? 'NAS-PTH-001' : '',
    yieldQty: 15,
    recipeName: 'Resep Memasak Nasi Putih Pulen (15 Porsi)',
    components: [
      { material_id: 'mat_beras_pulen', planned_quantity: 1.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_air_masak', planned_quantity: 2, planned_uom_id: 'uom_l' }
    ]
  },

  // 6. Mie Bang Jo (MIE-BJO-001) - Batch 5 Porsi
  {
    sku: 'MIE-BJO-001',
    yieldQty: 5,
    recipeName: 'Resep Olahan Mie Bang Jo (5 Porsi)',
    components: [
      { material_id: 'mat_mie_telur', planned_quantity: 0.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_bawang_putih', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_saus_tiram', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 50, planned_uom_id: 'uom_ml' }
    ]
  },

  // 7. Tempe Goreng (LAU-TMP-001) - Batch 10 Porsi
  {
    sku: 'LAU-TMP-001',
    yieldQty: 10,
    recipeName: 'Resep Tempe Goreng Bumbu Gurih (10 Porsi)',
    components: [
      { material_id: 'mat_tempe_mentah', planned_quantity: 10, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_bawang_putih', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_ketumbar', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 200, planned_uom_id: 'uom_ml' }
    ]
  },

  // 8. Tahu Goreng (LAU-TAH-001) - Batch 10 Porsi
  {
    sku: 'LAU-TAH-001',
    yieldQty: 10,
    recipeName: 'Resep Tahu Goreng Gurih (10 Porsi)',
    components: [
      { material_id: 'mat_tahu_mentah', planned_quantity: 10, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_bawang_putih', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 200, planned_uom_id: 'uom_ml' }
    ]
  },

  // 9. Telor Ceplok (LAU-TLR-001) - Batch 5 Porsi
  {
    sku: 'LAU-TLR-001',
    yieldQty: 5,
    recipeName: 'Resep Telor Ceplok Goreng (5 Porsi)',
    components: [
      { material_id: 'mat_telur_ayam', planned_quantity: 0.3, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 50, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_garam_halus', planned_quantity: 5, planned_uom_id: 'uom_g' }
    ]
  },

  // 10. Telor Cabe (LAU-TLR-002) - Batch 5 Porsi
  {
    sku: 'LAU-TLR-002',
    yieldQty: 5,
    recipeName: 'Resep Telor Cabe Balado (5 Porsi)',
    components: [
      { material_id: 'mat_telur_ayam', planned_quantity: 0.3, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_cabai_rawit', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_putih', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 50, planned_uom_id: 'uom_ml' }
    ]
  },

  // 11. Telur Gulung Saos Sambal (LAU-TLR-003) - Batch 5 Porsi
  {
    sku: 'LAU-TLR-003',
    yieldQty: 5,
    recipeName: 'Resep Telur Gulung Saos Sambal (5 Porsi)',
    components: [
      { material_id: 'mat_telur_ayam', planned_quantity: 0.25, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 50, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_saos_sambal', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 100, planned_uom_id: 'uom_ml' }
    ]
  },

  // 12. Udang (LAU-UDG-001) - Batch 5 Porsi
  {
    sku: 'LAU-UDG-001',
    yieldQty: 5,
    recipeName: 'Resep Udang Goreng Bumbu Gurih (5 Porsi)',
    components: [
      { material_id: 'mat_udang_segar', planned_quantity: 0.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_bawang_putih', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 150, planned_uom_id: 'uom_ml' }
    ]
  },

  // 13. Cah Kangkung (SAY-KGK-001) - Batch 5 Porsi
  {
    sku: 'SAY-KGK-001',
    yieldQty: 5,
    recipeName: 'Resep Cah Kangkung Saus Tiram (5 Porsi)',
    components: [
      { material_id: 'mat_kangkung', planned_quantity: 5, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_bawang_merah', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_putih', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_cabai_rawit', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_saus_tiram', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 50, planned_uom_id: 'uom_ml' }
    ]
  },

  // 14. Cah Kangkung Teri (SAY-KGK-002) - Batch 5 Porsi
  {
    sku: 'SAY-KGK-002',
    yieldQty: 5,
    recipeName: 'Resep Cah Kangkung Teri Medan (5 Porsi)',
    components: [
      { material_id: 'mat_kangkung', planned_quantity: 5, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_teri_medan', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_putih', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_cabai_rawit', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_saus_tiram', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 5, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 50, planned_uom_id: 'uom_ml' }
    ]
  },

  // 15. Oseng Terong Teri (SAY-TRG-001) - Batch 5 Porsi
  {
    sku: 'SAY-TRG-001',
    yieldQty: 5,
    recipeName: 'Resep Oseng Terong Ungu Teri (5 Porsi)',
    components: [
      { material_id: 'mat_terong', planned_quantity: 0.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_teri_medan', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 40, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_putih', planned_quantity: 25, planned_uom_id: 'uom_g' },
      { material_id: 'mat_cabai_rawit', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_gula_pasir', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 50, planned_uom_id: 'uom_ml' }
    ]
  },

  // 16. Lalapan (PEL-LLP-001) - Batch 10 Porsi
  {
    sku: 'PEL-LLP-001',
    yieldQty: 10,
    recipeName: 'Resep Racikan Sayur Lalapan Segar (10 Porsi)',
    components: [
      { material_id: 'mat_timun', planned_quantity: 0.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_kol_lalap', planned_quantity: 0.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_kemangi', planned_quantity: 5, planned_uom_id: 'uom_pcs' }
    ]
  },

  // 17. Kremesan (PEL-KRM-001) - Batch 20 Porsi
  {
    sku: 'PEL-KRM-001',
    yieldQty: 20,
    recipeName: 'Resep Adonan Kremesan Renyah Gurih (20 Porsi)',
    components: [
      { material_id: 'mat_tepung_beras', planned_quantity: 250, planned_uom_id: 'uom_g' },
      { material_id: 'mat_tepung_tapioka', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_telur_ayam', planned_quantity: 0.06, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_royco_ayam', planned_quantity: 20, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 500, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 500, planned_uom_id: 'uom_ml' }
    ]
  },

  // 18. Sambal Geprek (SBL-GPK-001) - Batch 10 Porsi
  {
    sku: 'SBL-GPK-001',
    yieldQty: 10,
    recipeName: 'Resep Sambal Geprek Asli Bawang (10 Porsi)',
    components: [
      { material_id: 'mat_cabai_rawit', planned_quantity: 150, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_putih', planned_quantity: 40, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_msg_micin', planned_quantity: 5, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 100, planned_uom_id: 'uom_ml' }
    ]
  },

  // 19. Sambal Geprek Pedas (SBL-GPK-002) - Batch 10 Porsi
  {
    sku: 'SBL-GPK-002',
    yieldQty: 10,
    recipeName: 'Resep Sambal Geprek Extra Pedas (10 Porsi)',
    components: [
      { material_id: 'mat_cabai_rawit', planned_quantity: 250, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_putih', planned_quantity: 40, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_msg_micin', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 100, planned_uom_id: 'uom_ml' }
    ]
  },

  // 20. Sambal Lombok Ijo (SBL-IJO-001) - Batch 15 Porsi
  {
    sku: 'SBL-IJO-001',
    yieldQty: 15,
    recipeName: 'Resep Sambal Lombok Ijo Padang (15 Porsi)',
    components: [
      { material_id: 'mat_cabai_hijau_besar', planned_quantity: 200, planned_uom_id: 'uom_g' },
      { material_id: 'mat_cabai_rawit_hijau', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 80, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_putih', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_tomat_hijau', planned_quantity: 80, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_gula_pasir', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_royco_ayam', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 100, planned_uom_id: 'uom_ml' }
    ]
  },

  // 21. Sambal Terasi (SBL-TRS-001) - Batch 20 Porsi
  {
    sku: 'SBL-TRS-001',
    yieldQty: 20,
    recipeName: 'Resep Sambal Terasi Matang Bang Jo (20 Porsi)',
    components: [
      { material_id: 'mat_cabai_rawit', planned_quantity: 200, planned_uom_id: 'uom_g' },
      { material_id: 'mat_cabai_merah_keriting', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_merah', planned_quantity: 80, planned_uom_id: 'uom_g' },
      { material_id: 'mat_bawang_putih', planned_quantity: 40, planned_uom_id: 'uom_g' },
      { material_id: 'mat_tomat_merah', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_terasi_udang', planned_quantity: 30, planned_uom_id: 'uom_g' },
      { material_id: 'mat_gula_aren', planned_quantity: 40, planned_uom_id: 'uom_g' },
      { material_id: 'mat_garam_halus', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_msg_micin', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 100, planned_uom_id: 'uom_ml' }
    ]
  },

  // 22. Kentang Goreng (SNK-KTG-001) - Batch 5 Porsi
  {
    sku: 'SNK-KTG-001',
    yieldQty: 5,
    recipeName: 'Resep Kentang Goreng French Fries (5 Porsi)',
    components: [
      { material_id: 'mat_kentang_frozen', planned_quantity: 0.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_garam_halus', planned_quantity: 10, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 200, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_saos_sambal', planned_quantity: 50, planned_uom_id: 'uom_g' }
    ]
  },

  // 23. Keripik Pangsit (SNK-PNG-001) - Batch 5 Porsi
  {
    sku: 'SNK-PNG-001',
    yieldQty: 5,
    recipeName: 'Resep Keripik Pangsit Goreng Gurih (5 Porsi)',
    components: [
      { material_id: 'mat_kulit_pangsit', planned_quantity: 25, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_royco_ayam', planned_quantity: 15, planned_uom_id: 'uom_g' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 200, planned_uom_id: 'uom_ml' }
    ]
  },

  // 24. Dumpling Ayam isi 4pcs (SNK-DMP-001) - Batch 5 Porsi
  {
    sku: 'SNK-DMP-001',
    yieldQty: 5,
    recipeName: 'Resep Dumpling Ayam Goreng Crispy (5 Porsi)',
    components: [
      { material_id: 'mat_dumpling_raw', planned_quantity: 20, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_minyak_goreng', planned_quantity: 100, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_saos_sambal', planned_quantity: 50, planned_uom_id: 'uom_g' }
    ]
  },

  // 25. Es Teh (MNM-TEH-001) - Batch 10 Porsi
  {
    sku: 'MNM-TEH-001',
    yieldQty: 10,
    recipeName: 'Resep Es Teh Segar Melati (10 Porsi)',
    components: [
      { material_id: 'mat_daun_teh', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 2, planned_uom_id: 'uom_l' },
      { material_id: 'mat_es_batu', planned_quantity: 1, planned_uom_id: 'uom_kg' }
    ]
  },

  // 26. Es Teh Manis (MNM-TEH-002) - Batch 10 Porsi
  {
    sku: 'MNM-TEH-002',
    yieldQty: 10,
    recipeName: 'Resep Es Teh Manis Teko (10 Porsi)',
    components: [
      { material_id: 'mat_daun_teh', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_gula_pasir', planned_quantity: 250, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 2, planned_uom_id: 'uom_l' },
      { material_id: 'mat_es_batu', planned_quantity: 1, planned_uom_id: 'uom_kg' }
    ]
  },

  // 27. Es Teh Tawar (MNM-TEH-003) - Batch 10 Porsi
  {
    sku: 'MNM-TEH-003',
    yieldQty: 10,
    recipeName: 'Resep Es Teh Tawar Melati (10 Porsi)',
    components: [
      { material_id: 'mat_daun_teh', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 2, planned_uom_id: 'uom_l' },
      { material_id: 'mat_es_batu', planned_quantity: 1, planned_uom_id: 'uom_kg' }
    ]
  },

  // 28. Kopi Jo (MNM-KOP-001) - Batch 5 Porsi
  {
    sku: 'MNM-KOP-001',
    yieldQty: 5,
    recipeName: 'Resep Es Kopi Susu Gula Aren Khas Bang Jo (5 Porsi)',
    components: [
      { material_id: 'mat_kopi_bubuk', planned_quantity: 75, planned_uom_id: 'uom_g' },
      { material_id: 'mat_gula_aren', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_susu_uht', planned_quantity: 150, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_air_masak', planned_quantity: 750, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 29. Americano (MNM-KOP-002) - Batch 5 Porsi
  {
    sku: 'MNM-KOP-002',
    yieldQty: 5,
    recipeName: 'Resep Kopi Americano Dingin / Panas (5 Porsi)',
    components: [
      { material_id: 'mat_kopi_bubuk', planned_quantity: 75, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 1, planned_uom_id: 'uom_l' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 30. Es Cappucino (MNM-KOP-003) - Batch 5 Porsi
  {
    sku: 'MNM-KOP-003',
    yieldQty: 5,
    recipeName: 'Resep Es Kopi Cappucino Creamy (5 Porsi)',
    components: [
      { material_id: 'mat_kopi_bubuk', planned_quantity: 75, planned_uom_id: 'uom_g' },
      { material_id: 'mat_susu_uht', planned_quantity: 500, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_gula_pasir', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 250, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 31. Es Jeruk (MNM-JRK-001) - Batch 5 Porsi
  {
    sku: 'MNM-JRK-001',
    yieldQty: 5,
    recipeName: 'Resep Es Jeruk Peras Segar (5 Porsi)',
    components: [
      { material_id: 'mat_jeruk_peras', planned_quantity: 0.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_gula_pasir', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 500, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 32. Jus Timun (MNM-JUS-001) - Batch 5 Porsi
  {
    sku: 'MNM-JUS-001',
    yieldQty: 5,
    recipeName: 'Resep Jus Timun Serut Dingin (5 Porsi)',
    components: [
      { material_id: 'mat_timun', planned_quantity: 0.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_gula_pasir', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 500, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 33. Jus Tomat (MNM-JUS-002) - Batch 5 Porsi
  {
    sku: 'MNM-JUS-002',
    yieldQty: 5,
    recipeName: 'Resep Jus Tomat Segar Susu (5 Porsi)',
    components: [
      { material_id: 'mat_tomat_merah', planned_quantity: 0.5, planned_uom_id: 'uom_kg' },
      { material_id: 'mat_gula_pasir', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_skm', planned_quantity: 100, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_air_masak', planned_quantity: 400, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 34. Soda Gembira (MNM-SDA-001) - Batch 5 Porsi
  {
    sku: 'MNM-SDA-001',
    yieldQty: 5,
    recipeName: 'Resep Es Soda Gembira Susu Merah (5 Porsi)',
    components: [
      { material_id: 'mat_air_soda', planned_quantity: 1, planned_uom_id: 'uom_l' },
      { material_id: 'mat_sirup_merah', planned_quantity: 150, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_skm', planned_quantity: 150, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 35. Es Bajigur (MNM-TRD-001) - Batch 5 Porsi
  {
    sku: 'MNM-TRD-001',
    yieldQty: 5,
    recipeName: 'Resep Tradisional Bajigur Santan Kelapa (5 Porsi)',
    components: [
      { material_id: 'mat_santan_cair', planned_quantity: 1, planned_uom_id: 'uom_l' },
      { material_id: 'mat_gula_aren', planned_quantity: 150, planned_uom_id: 'uom_g' },
      { material_id: 'mat_jahe', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_daun_salam', planned_quantity: 2, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 36. Es Jahe (MNM-TRD-002) - Batch 5 Porsi
  {
    sku: 'MNM-TRD-002',
    yieldQty: 5,
    recipeName: 'Resep Minuman Jahe Hangat / Es (5 Porsi)',
    components: [
      { material_id: 'mat_jahe', planned_quantity: 150, planned_uom_id: 'uom_g' },
      { material_id: 'mat_gula_aren', planned_quantity: 150, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 1, planned_uom_id: 'uom_l' },
      { material_id: 'mat_serai', planned_quantity: 2, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 37. Es Beras Kencur (MNM-TRD-003) - Batch 5 Porsi
  {
    sku: 'MNM-TRD-003',
    yieldQty: 5,
    recipeName: 'Resep Jamu Segar Es Beras Kencur (5 Porsi)',
    components: [
      { material_id: 'mat_bubuk_beras_kencur', planned_quantity: 150, planned_uom_id: 'uom_g' },
      { material_id: 'mat_gula_aren', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 1, planned_uom_id: 'uom_l' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 38. Wedang Uwuh (MNM-TRD-004) - Batch 5 Porsi
  {
    sku: 'MNM-TRD-004',
    yieldQty: 5,
    recipeName: 'Resep Wedang Uwuh Khas Imogiri (5 Porsi)',
    components: [
      { material_id: 'mat_rempah_uwuh', planned_quantity: 5, planned_uom_id: 'uom_pcs' },
      { material_id: 'mat_gula_pasir', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_jahe', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 1, planned_uom_id: 'uom_l' }
    ]
  },

  // 39. Es Milo (MNM-MLO-001) - Batch 5 Porsi
  {
    sku: 'MNM-MLO-001',
    yieldQty: 5,
    recipeName: 'Resep Es Milo Cokelat Kental (5 Porsi)',
    components: [
      { material_id: 'mat_milo_bubuk', planned_quantity: 150, planned_uom_id: 'uom_g' },
      { material_id: 'mat_skm', planned_quantity: 100, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_air_masak', planned_quantity: 750, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 40. Matcha Tea (MNM-MTC-001) - Batch 5 Porsi
  {
    sku: 'MNM-MTC-001',
    yieldQty: 5,
    recipeName: 'Resep Es Matcha Green Tea Latte (5 Porsi)',
    components: [
      { material_id: 'mat_matcha_bubuk', planned_quantity: 100, planned_uom_id: 'uom_g' },
      { material_id: 'mat_susu_uht', planned_quantity: 500, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_gula_pasir', planned_quantity: 75, planned_uom_id: 'uom_g' },
      { material_id: 'mat_air_masak', planned_quantity: 250, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 41. Banana Milk (MNM-MLK-001) - Batch 5 Porsi
  {
    sku: 'MNM-MLK-001',
    yieldQty: 5,
    recipeName: 'Resep Minuman Korean Banana Milk (5 Porsi)',
    components: [
      { material_id: 'mat_powder_banana', planned_quantity: 150, planned_uom_id: 'uom_g' },
      { material_id: 'mat_susu_uht', planned_quantity: 750, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_gula_pasir', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 42. Vanilla Milk (MNM-MLK-002) - Batch 5 Porsi
  {
    sku: 'MNM-MLK-002',
    yieldQty: 5,
    recipeName: 'Resep Minuman Vanilla Milk Shake (5 Porsi)',
    components: [
      { material_id: 'mat_powder_vanilla', planned_quantity: 150, planned_uom_id: 'uom_g' },
      { material_id: 'mat_susu_uht', planned_quantity: 750, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_gula_pasir', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 43. Taro Milk (MNM-MLK-003) - Batch 5 Porsi
  {
    sku: 'MNM-MLK-003',
    yieldQty: 5,
    recipeName: 'Resep Minuman Taro Milk Latte (5 Porsi)',
    components: [
      { material_id: 'mat_powder_taro', planned_quantity: 150, planned_uom_id: 'uom_g' },
      { material_id: 'mat_susu_uht', planned_quantity: 750, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_gula_pasir', planned_quantity: 50, planned_uom_id: 'uom_g' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 44. Pistachio (MNM-FLV-001) - Batch 5 Porsi
  {
    sku: 'MNM-FLV-001',
    yieldQty: 5,
    recipeName: 'Resep Minuman Pistachio Milk Latte (5 Porsi)',
    components: [
      { material_id: 'mat_syrup_pistachio', planned_quantity: 150, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_susu_uht', planned_quantity: 750, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 45. Butterscot (MNM-FLV-002) - Batch 5 Porsi
  {
    sku: 'MNM-FLV-002',
    yieldQty: 5,
    recipeName: 'Resep Minuman Butterscotch Milk Cream (5 Porsi)',
    components: [
      { material_id: 'mat_syrup_butterscotch', planned_quantity: 150, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_susu_uht', planned_quantity: 750, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 46. Salted Caramel (MNM-FLV-003) - Batch 5 Porsi
  {
    sku: 'MNM-FLV-003',
    yieldQty: 5,
    recipeName: 'Resep Minuman Salted Caramel Latte (5 Porsi)',
    components: [
      { material_id: 'mat_syrup_salted_caramel', planned_quantity: 150, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_susu_uht', planned_quantity: 750, planned_uom_id: 'uom_ml' },
      { material_id: 'mat_es_batu', planned_quantity: 0.5, planned_uom_id: 'uom_kg' }
    ]
  },

  // 47. Air Mineral Botol (MNM-AIR-001) - Batch 10 Pcs
  {
    sku: 'MNM-AIR-001',
    yieldQty: 10,
    recipeName: 'Penyajian Air Mineral Botol 600ml Dingin (10 Pcs)',
    components: [
      { material_id: 'mat_air_mineral_botol', planned_quantity: 10, planned_uom_id: 'uom_pcs' }
    ]
  }
];

function run() {
  console.log('=== SEEDING BANGJO RAW MATERIALS & RECIPES ===');
  console.log(`Organization: ${ORG_ID}`);
  console.log(`Brand: ${BRAND_ID}`);
  console.log(`Stock Location: ${STOCK_LOCATION_ID}\n`);

  // 1. Pastikan UOM 'uom_pcs' terpasang pada seluruh 47 produk fisik Bang Jo
  const updateUom = db.prepare("UPDATE products SET product_stock_uom_id = 'uom_pcs' WHERE brand_id = ?").run(BRAND_ID);
  console.log(`1. Updated products product_stock_uom_id -> 'uom_pcs' (affected: ${updateUom.changes})`);

  // 2. Insert atau Abaikan (INSERT OR IGNORE) Master Materials
  const insertMat = db.prepare(`
    INSERT OR IGNORE INTO materials (id, organization_id, material_code, name, base_uom_id, status)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE')
  `);
  let addedMaterials = 0;
  for (const mat of RAW_MATERIALS) {
    const res = insertMat.run(mat.id, ORG_ID, mat.code, mat.name, mat.base_uom_id);
    if (res.changes > 0) addedMaterials++;
  }
  console.log(`2. Processed ${RAW_MATERIALS.length} raw materials (newly inserted: ${addedMaterials})\n`);

  // 3. Process Recipes for each product
  const products = db.prepare("SELECT id, name, sku FROM products WHERE brand_id = ?").all(BRAND_ID);
  const prodBySku = new Map();
  for (const p of products) {
    if (p.sku) prodBySku.set(p.sku, p);
  }

  const results = [];
  for (const def of RECIPE_DEFINITIONS) {
    if (!def.sku) continue;
    const prod = prodBySku.get(def.sku);
    if (!prod) {
      console.warn(`WARNING: Product with SKU ${def.sku} not found!`);
      continue;
    }

    try {
      // Periksa apakah Production Item sudah ada untuk produk dan lokasi ini
      const existingRoute = productionRepository.findProductionItemByProductAndLocation(prod.id, STOCK_LOCATION_ID);
      let prodItem;
      let recipe;

      if (existingRoute.length > 0) {
        prodItem = productionRepository.findProductionItem(existingRoute[0].id);
        recipe = productionRepository.findRecipeByProductionItemId(prodItem.id);
        if (!recipe) {
          recipe = ProductionService.createRecipe({
            productionItemId: prodItem.id,
            name: def.recipeName,
            repository: productionRepository
          });
          ProductionService.activateRecipe({ recipeId: recipe.id, repository: productionRepository });
        }
      } else {
        const prodItemCode = `PRD-${def.sku}`;
        prodItem = ProductionService.createProductionItem({
          organizationId: ORG_ID,
          outputProductId: prod.id,
          productionItemCode: prodItemCode,
          name: prod.name,
          status: 'ACTIVE',
          repository: productionRepository
        });
        ProductionService.addProductionLocation({
          productionItemId: prodItem.id,
          stockLocationId: STOCK_LOCATION_ID,
          repository: productionRepository
        });
        recipe = ProductionService.createRecipe({
          productionItemId: prodItem.id,
          name: def.recipeName,
          repository: productionRepository
        });
        ProductionService.activateRecipe({ recipeId: recipe.id, repository: productionRepository });
      }

      // Buat Recipe Version baru jika belum ada versi yang aktif
      const existingVersion = db.prepare(`
        SELECT rv.id, rv.version_number, rv.status 
        FROM recipe_versions rv 
        WHERE rv.recipe_id = ? AND rv.status = 'PUBLISHED'
      `).get(recipe.id);

      let versionId;
      if (existingVersion) {
        versionId = existingVersion.id;
        results.push({
          sku: def.sku,
          product: prod.name,
          recipe: def.recipeName,
          components: def.components.length,
          status: 'ALREADY_EXISTS'
        });
      } else {
        const version = ProductionService.createRecipeVersion({
          recipeId: recipe.id,
          plannedYieldQuantity: def.yieldQty,
          yieldUomId: 'uom_pcs',
          components: def.components.map((c, idx) => ({
            material_id: c.material_id,
            planned_quantity: c.planned_quantity,
            planned_uom_id: c.planned_uom_id,
            sort_order: idx
          })),
          repository: productionRepository
        });

        ProductionService.publishRecipeVersion({
          recipeVersionId: version.recipe_version.id,
          repository: productionRepository
        });

        results.push({
          sku: def.sku,
          product: prod.name,
          recipe: def.recipeName,
          yield: `${def.yieldQty} pcs`,
          components: def.components.length,
          status: 'CREATED & PUBLISHED'
        });
      }
    } catch (err) {
      console.error(`ERROR creating recipe for ${prod.name} (${def.sku}):`, err.message);
      results.push({
        sku: def.sku,
        product: prod.name,
        recipe: def.recipeName,
        status: `FAILED: ${err.message}`
      });
    }
  }

  console.log('\n--- RECIPE CREATION RESULTS ---');
  console.table(results);
}

run();
