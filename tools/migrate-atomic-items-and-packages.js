'use strict';

const db = require('../server/database/db');
const ComposedMenuResolver = require('../domains/catalog/services/ComposedMenuResolver');

function run() {
  console.log('[Migration] Starting atomic items & packages separation for brand_bangjo...');

  db.exec('BEGIN TRANSACTION;');

  try {
    const brandId = 'brand_bangjo';

    // 1. Ensure atomic products exist
    const atomicNewProducts = [
      { id: 'prd_telor_ceplok', name: 'Telor Ceplok', price: 5000, inventory_type: 'COOKED' },
      { id: 'prd_telor_cabe', name: 'Telor Cabe', price: 6000, inventory_type: 'COOKED' },
      { id: 'prd_kremesan', name: 'Kremesan', price: 3000, inventory_type: 'COOKED' },
      { id: 'prd_ayam_negri_goreng', name: 'Ayam Negri Goreng', price: 20000, inventory_type: 'COOKED' },
      { id: 'prd_ayam_porsi_kecil', name: 'Ayam Goreng Porsi Kecil', price: 12000, inventory_type: 'COOKED' },
      { id: 'prd_ayam_negri_panggang', name: 'Ayam Negri Panggang', price: 22000, inventory_type: 'COOKED' },
      { id: 'prd_ayam_negri_oseng_mercon', name: 'Ayam Negri Oseng Mercon', price: 25000, inventory_type: 'COOKED' },
      { id: 'prd_atl_panggang_pedas', name: 'Ayam Tulang Lunak Panggang Pedas', price: 32000, inventory_type: 'COOKED' },
      { id: 'prd_aka_panggang_kecap_pedas', name: 'Ayam Kampung Asli Panggang Kecap Pedas', price: 32000, inventory_type: 'COOKED' }
    ];

    const insertProd = db.prepare(`
      INSERT OR IGNORE INTO products (id, brand_id, name, slug, description, price, regular_price, image_url, is_active, inventory_type)
      VALUES (?, ?, ?, ?, '', ?, NULL, NULL, 1, ?)
    `);

    for (const p of atomicNewProducts) {
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      insertProd.run(p.id, brandId, p.name, slug, p.price, p.inventory_type);
      console.log(`[Item] Ensured atomic item: ${p.name} (${p.id})`);
    }

    // Standard atomic product IDs:
    const NASI_PUTIH = 'prod_1789465084504';
    const ES_TEH_MANIS = '401';
    const TEMPE_GORENG = 'prod_1789465110186';
    const SAMBAL_TERASI = 'prod_1789464976642';
    const SAMBAL_LOMBOK_IJO = 'prod_1789464953953';
    const SAMBAL_GEPREK = 'prod_1789464929957';
    const LALAPAN = 'prd_b5b95706974f40acbb6c5ba0d90983d2';
    const TELOR_CEPLOK = 'prd_telor_ceplok';
    const TELOR_CABE = 'prd_telor_cabe';
    const KREMESAN = 'prd_kremesan';
    const AYAM_NEGRI_GORENG = 'prd_ayam_negri_goreng';
    const AYAM_PORSI_KECIL = 'prd_ayam_porsi_kecil';
    const AYAM_NEGRI_PANGGANG = 'prd_ayam_negri_panggang';
    const AYAM_NEGRI_OSENG_MERCON = 'prd_ayam_negri_oseng_mercon';
    const ATL_PANGGANG_PEDAS = 'prd_atl_panggang_pedas';
    const AKA_PANGGANG_KECAP_PEDAS = 'prd_aka_panggang_kecap_pedas';
    const ATL_KREMES = '272';
    const ATL_LOMBOK_IJO = 'prod_1789462383895';
    const ATL_PANGGANG_KECAP = 'prod_1789462323837';
    const ATL_TERASI = 'prod_1789462434161';
    const ATL_GEPREK = 'prod_1789462462057';
    const AYAM_NEGRI_GEPREK = 'prod_1789462753260';
    const AYAM_NEGRI_LOMBOK_IJO = 'prod_1789463621370';
    const AYAM_NEGRI_TONGSENG = 'prod_1789462681632';
    const AKA_LOMBOK_IJO = 'prod_1789464491905';
    const AKA_PEDAS_MANIS = 'prod_1789464309647';
    const AKA_TERASI = 'prod_1789464164606';
    const AKA_GEPREK = 'prod_1789464226817';
    const MIE_GURIH = '346';
    const MIE_MANIS = 'prod_1789464650536';
    const MIE_PEDAS = 'prod_1789464688641';
    const MIE_PEDAS_MANIS = 'prod_1789464713922';

    // 2. The 43 package menus mapping
    const packageMappings = [
      {
        menuId: 'demo_bangjo_menu_prod_1789464424693',
        title: 'Ayam Kampung Asli Lombok Ijo + Nasi',
        desc: 'Ayam Kampung Asli Lombok Ijo + Nasi Putih + Lalapan',
        items: [
          { productId: AKA_LOMBOK_IJO, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789464368133',
        title: 'Ayam Kampung Asli Panggang Kecap Pedas + Nasi',
        desc: 'Ayam Kampung Asli Panggang Kecap Pedas + Sambal Terasi + Lalapan + Nasi Putih',
        items: [
          { productId: AKA_PANGGANG_KECAP_PEDAS, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789464259147',
        title: 'Ayam Kampung Asli Pedas Manis + Nasi',
        desc: 'Ayam Kampung Asli Pedas Manis + Nasi Putih',
        items: [
          { productId: AKA_PEDAS_MANIS, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789464131471',
        title: 'Ayam Kampung Asli Terasi + Nasi',
        desc: 'Ayam Kampung Asli Terasi + Lalapan + Nasi Putih',
        items: [
          { productId: AKA_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462720397',
        title: 'Ayam Negri Geprek + Nasi',
        desc: 'Ayam Negri Geprek + Lalapan + Nasi Putih',
        items: [
          { productId: AYAM_NEGRI_GEPREK, quantity: 1 },
          { productId: LALAPAN, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462616347',
        title: 'Ayam Negri Geprek + Nasi + Es Teh Manis',
        desc: 'Ayam Negri Geprek + Nasi Putih + Es Teh Manis + Lalapan',
        items: [
          { productId: AYAM_NEGRI_GEPREK, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789463521772',
        title: 'Ayam Negri Lombok Ijo + Nasi',
        desc: 'Ayam Negri Lombok Ijo + Lalapan + Nasi Putih',
        items: [
          { productId: AYAM_NEGRI_LOMBOK_IJO, quantity: 1 },
          { productId: LALAPAN, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462552618',
        title: 'Ayam Negri Oseng Mercon + Nasi + Es Teh Manis',
        desc: 'Ayam Negri Oseng Mercon + Nasi Putih + Es Teh Manis',
        items: [
          { productId: AYAM_NEGRI_OSENG_MERCON, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462782466',
        title: 'Ayam Negri Panggang + Nasi',
        desc: 'Ayam Negri Panggang + Sambal Terasi + Lalapan + Nasi Putih',
        items: [
          { productId: AYAM_NEGRI_PANGGANG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462652443',
        title: 'Ayam Negri Tongseng + Nasi',
        desc: 'Ayam Negri Tongseng + Nasi Putih',
        items: [
          { productId: AYAM_NEGRI_TONGSENG, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462241757',
        title: 'Ayam Tulang Lunak Geprek + Nasi',
        desc: 'Ayam Tulang Lunak Geprek + Nasi Putih',
        items: [
          { productId: ATL_GEPREK, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462097154',
        title: 'Ayam Tulang Lunak Kremes + Nasi',
        desc: 'Ayam Tulang Lunak Kremes + Nasi Putih',
        items: [
          { productId: ATL_KREMES, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789461985133',
        title: 'Ayam Tulang Lunak Lombok Ijo + Nasi',
        desc: 'Ayam Tulang Lunak Lombok Ijo + Nasi Putih',
        items: [
          { productId: ATL_LOMBOK_IJO, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462157980',
        title: 'Ayam Tulang Lunak Panggang Kecap + Nasi',
        desc: 'Ayam Tulang Lunak Panggang Kecap + Nasi Putih',
        items: [
          { productId: ATL_PANGGANG_KECAP, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462066770',
        title: 'Ayam Tulang Lunak Panggang Pedas + Nasi',
        desc: 'Ayam Tulang Lunak Panggang Pedas + Sambal Terasi + Lalapan + Nasi Putih',
        items: [
          { productId: ATL_PANGGANG_PEDAS, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789462210050',
        title: 'Ayam Tulang Lunak Terasi + Nasi',
        desc: 'Ayam Tulang Lunak Terasi + Nasi Putih',
        items: [
          { productId: ATL_TERASI, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789464778964',
        title: 'Mie Bang Jo Manis + Es teh manis',
        desc: 'Mie Bang Jo Manis + Es Teh Manis',
        items: [
          { productId: MIE_MANIS, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789464752841',
        title: 'Mie Bang Jo Original + Es teh manis',
        desc: 'Mie Bang Jo Gurih + Es Teh Manis',
        items: [
          { productId: MIE_GURIH, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789464806985',
        title: 'Mie Bang Jo Pedas + Es teh manis',
        desc: 'Mie Bang Jo Pedas + Es Teh Manis',
        items: [
          { productId: MIE_PEDAS, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789464831440',
        title: 'Mie Bang Jo Pedas Manis + Es teh manis',
        desc: 'Mie Bang Jo Pedas Manis + Es Teh Manis',
        items: [
          { productId: MIE_PEDAS_MANIS, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789452222041',
        title: 'Paket Bagong Ayam Negri',
        desc: 'Ayam Negri Goreng + Nasi Putih + Es Teh Manis + Tempe Goreng + Sambal Terasi + Lalapan',
        items: [
          { productId: AYAM_NEGRI_GORENG, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789452367859',
        title: 'Paket Gareng Ayam Negri',
        desc: 'Ayam Negri Goreng + Nasi Putih + Tempe Goreng + Sambal Terasi + Lalapan',
        items: [
          { productId: AYAM_NEGRI_GORENG, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460820991',
        title: 'Paket Hemat Bagong Kremes',
        desc: 'Ayam Goreng Porsi Kecil + Nasi Putih + Es Teh Manis + Tempe Goreng + Kremesan + Sambal Terasi + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: KREMESAN, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460695906',
        title: 'Paket Hemat Bagong Lombok Ijo',
        desc: 'Ayam Goreng Porsi Kecil + Nasi Putih + Es Teh Manis + Tempe Goreng + Sambal Lombok Ijo + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_LOMBOK_IJO, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460763148',
        title: 'Paket Hemat Bagong Terasi',
        desc: 'Ayam Goreng Porsi Kecil + Nasi Putih + Es Teh Manis + Tempe Goreng + Sambal Terasi + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460925498',
        title: 'Paket Hemat Gareng Kremes',
        desc: 'Ayam Goreng Porsi Kecil + Nasi Putih + Tempe Goreng + Sambal Terasi + Kremesan + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: KREMESAN, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460853189',
        title: 'Paket Hemat Gareng Lombok Ijo',
        desc: 'Ayam Goreng Porsi Kecil + Nasi Putih + Tempe Goreng + Sambal Lombok Ijo + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_LOMBOK_IJO, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460892616',
        title: 'Paket Hemat Gareng Terasi',
        desc: 'Ayam Goreng Porsi Kecil + Nasi Putih + Tempe Goreng + Sambal Terasi + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789461046696',
        title: 'Paket Hemat Petruk Kremes',
        desc: 'Ayam Goreng Porsi Kecil + Telor Ceplok + Es Teh Manis + Tempe Goreng + Sambal Terasi + Kremesan + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: KREMESAN, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460967730',
        title: 'Paket Hemat Petruk Lombok Ijo',
        desc: 'Ayam Goreng Porsi Kecil + Telor Ceplok + Es Teh Manis + Tempe Goreng + Sambal Lombok Ijo + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_LOMBOK_IJO, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789461014539',
        title: 'Paket Hemat Petruk Terasi',
        desc: 'Ayam Goreng Porsi Kecil + Telor Ceplok + Es Teh Manis + Tempe Goreng + Sambal Terasi + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460580958',
        title: 'Paket Hemat Semar Kremes',
        desc: 'Ayam Goreng Porsi Kecil + Nasi Putih + Telor Ceplok + Es Teh Manis + Tempe Goreng + Sambal Terasi + Kremesan + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: KREMESAN, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460518342',
        title: 'Paket Hemat Semar Lombok Ijo',
        desc: 'Ayam Goreng Porsi Kecil + Nasi Putih + Telor Ceplok + Es Teh Manis + Tempe Goreng + Sambal Lombok Ijo + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_LOMBOK_IJO, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460646895',
        title: 'Paket Hemat Semar Terasi',
        desc: 'Ayam Goreng Porsi Kecil + Nasi Putih + Telor Ceplok + Es Teh Manis + Tempe Goreng + Sambal Terasi + Lalapan',
        items: [
          { productId: AYAM_PORSI_KECIL, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789461192799',
        title: 'Paket Jagoan 1',
        desc: 'Nasi Putih + 3x Telor Cabe + Es Teh Manis',
        items: [
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TELOR_CABE, quantity: 3 },
          { productId: ES_TEH_MANIS, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789461260718',
        title: 'Paket Jagoan 2',
        desc: 'Nasi Putih + 3x Telor Cabe',
        items: [
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TELOR_CABE, quantity: 3 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789461300871',
        title: 'Paket Jagoan 3',
        desc: 'Nasi Putih + 1x Telor Cabe + Es Teh Manis',
        items: [
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TELOR_CABE, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789461336158',
        title: 'Paket Jagoan 4',
        desc: 'Nasi Putih + 1x Telor Cabe',
        items: [
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TELOR_CABE, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789460441443',
        title: 'Paket Petruk Ayam Negri',
        desc: 'Ayam Negri Goreng + Telor Ceplok + Es Teh Manis + Sambal Terasi + Tempe Goreng + Lalapan',
        items: [
          { productId: AYAM_NEGRI_GORENG, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789452133261',
        title: 'Paket Semar Ayam Negri',
        desc: 'Ayam Negri Goreng + Nasi Putih + Telor Ceplok + Es Teh Manis + Tempe Goreng + Sambal Terasi + Lalapan',
        items: [
          { productId: AYAM_NEGRI_GORENG, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789351875251',
        title: 'Paket Special Gareng',
        desc: 'Ayam Tulang Lunak Kremes + Nasi Putih + Tempe Goreng + Sambal Terasi + Lalapan',
        items: [
          { productId: ATL_KREMES, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789450228711',
        title: 'Paket Special Petruk',
        desc: 'Ayam Tulang Lunak Kremes + Telor Ceplok + Es Teh Manis + Tempe Goreng + Sambal Terasi + Lalapan',
        items: [
          { productId: ATL_KREMES, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      },
      {
        menuId: 'demo_bangjo_menu_prod_1789463714196',
        title: 'Super Bagong Ayam Negri',
        desc: 'Ayam Negri Goreng + Nasi Putih + Telor Ceplok + Tempe Goreng + Es Teh Manis + Kremesan + Sambal Terasi + Lalapan',
        items: [
          { productId: AYAM_NEGRI_GORENG, quantity: 1 },
          { productId: NASI_PUTIH, quantity: 1 },
          { productId: TELOR_CEPLOK, quantity: 1 },
          { productId: TEMPE_GORENG, quantity: 1 },
          { productId: ES_TEH_MANIS, quantity: 1 },
          { productId: KREMESAN, quantity: 1 },
          { productId: SAMBAL_TERASI, quantity: 1 },
          { productId: LALAPAN, quantity: 1 }
        ]
      }
    ];

    const updateMenuStmt = db.prepare(`
      UPDATE menus 
      SET menu_type = 'PACKAGE', 
          package_name = ?, 
          description = ?,
          title_id = NULL,
          rasa_id = NULL,
          sub_category_id = NULL,
          level_id = NULL
      WHERE id = ?
    `);

    const deleteMenuItemsStmt = db.prepare(`DELETE FROM menu_items WHERE menu_id = ?`);
    const insertMenuItemStmt = db.prepare(`
      INSERT INTO menu_items (menu_id, product_id, quantity, sort_order)
      VALUES (?, ?, ?, ?)
    `);

    const pseudoProductIds = [];

    for (const pkg of packageMappings) {
      // Find old product_id from old menu_items before deleting
      const oldItems = db.prepare(`SELECT product_id FROM menu_items WHERE menu_id = ?`).all(pkg.menuId);
      oldItems.forEach(oi => {
        if (oi.product_id && !pseudoProductIds.includes(oi.product_id)) {
          pseudoProductIds.push(oi.product_id);
        }
      });

      // Update menu
      updateMenuStmt.run(pkg.title, pkg.desc, pkg.menuId);

      // Replace menu items
      deleteMenuItemsStmt.run(pkg.menuId);
      pkg.items.forEach((item, idx) => {
        insertMenuItemStmt.run(pkg.menuId, item.productId, item.quantity, idx);
      });

      console.log(`[Package Menu] Updated ${pkg.title} (${pkg.menuId}) with ${pkg.items.length} items`);
    }

    console.log(`[Pseudo Products] Found ${pseudoProductIds.length} pseudo-products to purge from products catalog.`);

    // 3. Purge pseudo-products
    for (const pid of pseudoProductIds) {
      // Clean dependent tables if any
      db.prepare(`DELETE FROM branch_products WHERE product_id = ?`).run(pid);
      db.prepare(`DELETE FROM branch_product_inventory WHERE product_id = ?`).run(pid);
      db.prepare(`DELETE FROM inventory_movements WHERE product_id = ?`).run(pid);
      db.prepare(`DELETE FROM product_menu_migrations WHERE product_id = ?`).run(pid);
      db.prepare(`DELETE FROM product_categories WHERE product_id = ?`).run(pid);
      db.prepare(`DELETE FROM product_flavors WHERE product_id = ?`).run(pid);
      db.prepare(`DELETE FROM product_complements WHERE product_id = ?`).run(pid);
      db.prepare(`DELETE FROM product_levels WHERE product_id = ?`).run(pid);
      
      // Delete from products table
      const res = db.prepare(`DELETE FROM products WHERE id = ?`).run(pid);
      console.log(`[Purge] Deleted pseudo-product ${pid} (changes: ${res.changes})`);
    }

    db.exec('COMMIT;');
    console.log('[Migration] Transaction committed successfully!');
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('[Migration ERROR]:', err);
    process.exit(1);
  }
}

run();
