'use strict';

const db = require('../server/database/db');
const { ComposedMenuService } = require('../domains/catalog');

const BRAND_ID = 'brand_bangjo';

const SKU_MAPPINGS = [
  // Unggas / Ayam
  { id: 'prd_27cd8b114c734f798b9d780dfa40f3d7', name: 'Ayam Tulang Lunak', newSku: 'AYM-ATL-001' },
  { id: 'prd_97fdbca7891f4c3d8469e2a63c965eb0', name: 'Ayam Kampung Asli', newSku: 'AYM-KMP-001' },
  { id: 'prd_ayam_negri_goreng', name: 'Ayam Negri', newSku: 'AYM-NGR-001' },
  { id: 'prd_ayam_porsi_kecil', name: 'Ayam Porsi Kecil', newSku: 'AYM-KCL-001' },

  // Nasi & Karbo
  { id: 'prod_1789465084504', name: 'Nasi Putih', newSku: 'NAS-PTH-001' },
  { id: '346', name: 'Mie Bang Jo', newSku: 'MIE-BJO-001' },

  // Lauk Pauk
  { id: 'prod_1789465110186', name: 'Tempe Goreng', newSku: 'LAU-TMP-001' },
  { id: 'prod_1789465137551', name: 'Tahu Goreng', newSku: 'LAU-TAH-001' },
  { id: 'prd_telor_ceplok', name: 'Telor Ceplok', newSku: 'LAU-TLR-001' },
  { id: 'prd_telor_cabe', name: 'Telor Cabe', newSku: 'LAU-TLR-002' },
  { id: 'prod_1789465165295', name: 'Telur Gulung Saos Sambal', newSku: 'LAU-TLR-003' },
  { id: 'prod_1789466628734', name: 'Udang', newSku: 'LAU-UDG-001' },

  // Sayuran
  { id: 'prod_1789461927384', name: 'Cah Kangkung', newSku: 'SAY-KGK-001' },
  { id: 'prod_1789465046476', name: 'Cah Kangkung Teri', newSku: 'SAY-KGK-002' },
  { id: 'prod_1789465246074', name: 'Oseng Terong Teri', newSku: 'SAY-TRG-001' },

  // Pelengkap / Kondimen
  { id: 'prd_b5b95706974f40acbb6c5ba0d90983d2', name: 'Lalapan', newSku: 'PEL-LLP-001' },
  { id: 'prd_kremesan', name: 'Kremesan', newSku: 'PEL-KRM-001' },

  // Sambal
  { id: 'prd_271909715e3c42c9adc42d82b9b418c6', name: 'Sambal Geprek', newSku: 'SBL-GPK-001' },
  { id: 'prod_1789464929957', name: 'Sambal Geprek Pedas', newSku: 'SBL-GPK-002' },
  { id: 'prod_1789464953953', name: 'Sambal Lombok Ijo', newSku: 'SBL-IJO-001' },
  { id: 'prod_1789464976642', name: 'Sambal Terasi', newSku: 'SBL-TRS-001' },

  // Snack
  { id: 'prod_1789465365328', name: 'Kentang Goreng', newSku: 'SNK-KTG-001' },
  { id: 'prod_1789465331364', name: 'Keripik Pangsit', newSku: 'SNK-PNG-001' },
  { id: 'prod_1789465408628', name: 'Dumpling Ayam isi 4pcs', newSku: 'SNK-DMP-001' },

  // Minuman - Teh
  { id: '288', name: 'Es Teh', newSku: 'MNM-TEH-001' },
  { id: '401', name: 'Es Teh Manis', newSku: 'MNM-TEH-002' },
  { id: 'prod_1789466069510', name: 'Es Teh Tawar', newSku: 'MNM-TEH-003' },

  // Minuman - Kopi
  { id: '287', name: 'Kopi Jo', newSku: 'MNM-KOP-001' },
  { id: 'prod_1789465817799', name: 'Americano', newSku: 'MNM-KOP-002' },
  { id: 'prod_1789466128788', name: 'Es Cappucino', newSku: 'MNM-KOP-003' },

  // Minuman - Buah & Segar
  { id: 'prod_1789466099102', name: 'Es Jeruk', newSku: 'MNM-JRK-001' },
  { id: 'prod_1789465472871', name: 'Jus Timun', newSku: 'MNM-JUS-001' },
  { id: 'prod_1789465530397', name: 'Jus Tomat', newSku: 'MNM-JUS-002' },
  { id: 'prod_1789466157755', name: 'Soda Gembira', newSku: 'MNM-SDA-001' },

  // Minuman - Tradisional
  { id: 'prod_1789465554452', name: 'Es Bajigur', newSku: 'MNM-TRD-001' },
  { id: 'prod_1789465582589', name: 'Es Jahe', newSku: 'MNM-TRD-002' },
  { id: 'prod_1789465614579', name: 'Es Beras Kencur', newSku: 'MNM-TRD-003' },
  { id: 'prod_1789466217217', name: 'Wedang Uwuh', newSku: 'MNM-TRD-004' },

  // Minuman - Susu & Cokelat
  { id: 'prod_1789466187365', name: 'Es Milo', newSku: 'MNM-MLO-001' },
  { id: 'prod_1789465994616', name: 'Matcha Tea', newSku: 'MNM-MTC-001' },
  { id: 'prod_1789461862109', name: 'Banana Milk', newSku: 'MNM-MLK-001' },
  { id: 'prod_1789461811655', name: 'Vanilla Milk', newSku: 'MNM-MLK-002' },
  { id: 'prod_1789461839032', name: 'Taro Milk', newSku: 'MNM-MLK-003' },

  // Minuman - Flavour
  { id: 'prod_1789461765875', name: 'Pistachio', newSku: 'MNM-FLV-001' },
  { id: 'prod_1789465640982', name: 'Butterscot', newSku: 'MNM-FLV-002' },
  { id: 'prod_1789465678811', name: 'Salted Caramel', newSku: 'MNM-FLV-003' },

  // Minuman - Air Mineral
  { id: 'prod_1789465790053', name: 'Air Mineral Botol', newSku: 'MNM-AIR-001' }
];

function run() {
  console.log(`Starting SKU standardization for brand: ${BRAND_ID}...`);
  console.log(`Total items to update: ${SKU_MAPPINGS.length}`);

  const results = [];
  for (const item of SKU_MAPPINGS) {
    const existing = db.prepare('SELECT id, name, sku FROM products WHERE id = ? AND brand_id = ?').get(item.id, BRAND_ID);
    if (!existing) {
      console.warn(`WARNING: Product ${item.id} (${item.name}) not found!`);
      continue;
    }

    const previousSku = existing.sku;
    try {
      ComposedMenuService.setProductSku({
        brandId: BRAND_ID,
        productId: item.id,
        sku: item.newSku,
        actorId: 'admin_bangjo',
        actorRole: 'owner'
      });
      results.push({
        id: item.id,
        name: existing.name,
        previousSku: previousSku || '(KOSONG)',
        newSku: item.newSku,
        status: 'SUCCESS'
      });
    } catch (err) {
      console.error(`ERROR updating ${item.name} (${item.id}):`, err.message);
      results.push({
        id: item.id,
        name: existing.name,
        previousSku: previousSku || '(KOSONG)',
        newSku: item.newSku,
        status: `FAILED: ${err.message}`
      });
    }
  }

  console.log('\n--- SKU UPDATE RESULTS ---');
  console.table(results);
}

run();
