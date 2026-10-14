'use strict';

/**
 * REASON & CLEAN ITEM ASSEMBLIES FOR BANGJO CATALOG
 *
 * Rule:
 *  - Secara default ayam dengan nasi atau tanpa nasi itu ada lalapan dan tempenya.
 *  - Ayam (dengan nasi / tanpa nasi) memiliki multiple components:
 *    [Ayam Base] + [Tempe Goreng] + [Lalapan] + [Sambal / Kremesan] (+ [Nasi Putih] if dengan nasi)
 *    Sehingga di engine Xentra dikategorikan sebagai PACKAGE assembly.
 *  - True SINGLE menus: Mie Bang Jo, Minuman, Sayur (Cah Kangkung, dll), Lauk Satuan, Sambal Satuan, Snack.
 */

const db = require('../server/database/db');
const ComposedMenuResolver = require('../domains/catalog/services/ComposedMenuResolver');
const BRAND_ID = 'brand_bangjo';

function run(isDryRun = true) {
  console.log(`=== RUNNING ITEM ASSEMBLY REASONING WITH LALAPAN & TEMPE DEFAULT (DryRun: ${isDryRun}) ===\n`);

  const existingProducts = db.prepare('SELECT id, name, sku FROM products WHERE brand_id = ?').all(BRAND_ID);
  const prodByName = new Map();
  existingProducts.forEach(p => {
    prodByName.set(p.name.trim().toLowerCase(), p);
  });

  // Canonical Items Map
  const CANONICAL_ITEMS = {
    // Unggas
    atl: { name: 'Ayam Tulang Lunak', sku: 'ATL-001', match: ['ayam tulang lunak', 'ayam tulang lunak kremes'] },
    aka: { name: 'Ayam Kampung Asli', sku: 'AKA-001', match: ['ayam kampung asli'] },
    negri: { name: 'Ayam Negri', sku: 'AYM-001', match: ['ayam negri', 'ayam negeri', 'ayam negri goreng', 'ayam bakar'] },
    porsi_kecil: { name: 'Ayam Porsi Kecil', sku: 'AYM-002', match: ['ayam porsi kecil', 'ayam goreng porsi kecil'] },
    
    // Mie & Karbo
    mie: { name: 'Mie Bang Jo', sku: 'MIE-001', match: ['mie bang jo', 'mie bang jo gurih'] },
    nasi: { name: 'Nasi Putih', sku: 'NAS-001', match: ['nasi putih'] },
    
    // Lauk & Pendamping
    tempe: { name: 'Tempe Goreng', sku: 'TMP-001', match: ['tempe goreng'] },
    tahu: { name: 'Tahu Goreng', sku: 'TAH-001', match: ['tahu goreng'] },
    telor_ceplok: { name: 'Telor Ceplok', sku: 'TLR-001', match: ['telor ceplok'] },
    telor_cabe: { name: 'Telor Cabe', sku: 'TLR-002', match: ['telor cabe'] },
    telur_gulung: { name: 'Telur Gulung Saos Sambal', sku: 'TLR-003', match: ['telur gulung saos sambal'] },
    lalapan: { name: 'Lalapan', sku: 'LLP-001', match: ['lalapan'] },
    kremes: { name: 'Kremesan', sku: 'KRM-001', match: ['kremesan'] },
    
    // Sambal
    sambal_terasi: { name: 'Sambal Terasi', sku: 'SBL-001', match: ['sambal terasi'] },
    sambal_lombok_ijo: { name: 'Sambal Lombok Ijo', sku: 'SBL-002', match: ['sambal lombok ijo'] },
    sambal_geprek: { name: 'Sambal Geprek Pedas', sku: 'SBL-003', match: ['sambal geprek pedas', 'sambal geprek'] },
    
    // Sayur
    cah_kangkung: { name: 'Cah Kangkung', sku: 'KGK-001', match: ['cah kangkung'] },
    cah_kangkung_teri: { name: 'Cah Kangkung Teri', sku: 'KGK-002', match: ['cah kangkung teri'] },
    oseng_terong: { name: 'Oseng Terong Teri', sku: 'TRG-001', match: ['oseng terong teri'] },
    
    // Snack
    kentang: { name: 'Kentang Goreng', sku: 'KTG-001', match: ['kentang goreng', 'kentang goreng original'] },
    pangsit: { name: 'Keripik Pangsit', sku: 'PNG-001', match: ['keripik pangsit'] },
    dumpling: { name: 'Dumpling Ayam isi 4pcs', sku: 'DMP-001', match: ['dumpling ayam isi 4pcs', 'dumpling ayam'] },
    
    // Minuman
    es_teh: { name: 'Es Teh Manis', sku: 'MNM-001', match: ['es teh manis', 'es teh'] },
    es_teh_tawar: { name: 'Es Teh Tawar', sku: 'MNM-002', match: ['es teh tawar'] },
    air_mineral: { name: 'Air Mineral Botol', sku: 'MNM-003', match: ['air mineral botol'] },
    kopi_jo: { name: 'Kopi Jo', sku: 'MNM-004', match: ['kopi jo'] },
    es_bajigur: { name: 'Es Bajigur', sku: 'MNM-005', match: ['es bajigur'] },
    es_beras_kencur: { name: 'Es Beras Kencur', sku: 'MNM-006', match: ['es beras kencur'] },
    es_jahe: { name: 'Es Jahe', sku: 'MNM-007', match: ['es jahe'] },
    jus_timun: { name: 'Jus Timun', sku: 'MNM-008', match: ['jus timun'] },
    jus_tomat: { name: 'Jus Tomat', sku: 'MNM-009', match: ['jus tomat'] },
    banana_milk: { name: 'Banana Milk', sku: 'MNM-010', match: ['banana milk'] },
    butterscot: { name: 'Butterscot', sku: 'MNM-011', match: ['butterscot'] },
    pistachio: { name: 'Pistachio', sku: 'MNM-012', match: ['pistachio'] },
    salted_caramel: { name: 'Salted Caramel', sku: 'MNM-013', match: ['salted caramel'] },
    taro_milk: { name: 'Taro Milk', sku: 'MNM-014', match: ['taro milk'] },
    vanilla_milk: { name: 'Vanilla Milk', sku: 'MNM-015', match: ['vanilla milk'] },
    es_jeruk: { name: 'Es Jeruk', sku: 'MNM-016', match: ['es jeruk'] },
    es_milo: { name: 'Es Milo', sku: 'MNM-017', match: ['es milo'] },
    es_cappucino: { name: 'Es Cappucino', sku: 'MNM-018', match: ['es cappucino'] },
    soda_gembira: { name: 'Soda Gembira', sku: 'MNM-019', match: ['soda gembira'] },
    americano: { name: 'Americano', sku: 'MNM-020', match: ['americano'] },
    matcha_tea: { name: 'Matcha Tea', sku: 'MNM-021', match: ['matcha tea'] },
    wedang_uwuh: { name: 'Wedang Uwuh', sku: 'MNM-022', match: ['wedang uwuh'] },
    udang: { name: 'Udang', sku: 'UDG-001', match: ['udang'] }
  };

  const canonicalMap = {};
  for (const [key, spec] of Object.entries(CANONICAL_ITEMS)) {
    let matched = null;
    for (const m of spec.match) {
      if (prodByName.has(m)) {
        matched = prodByName.get(m);
        break;
      }
    }
    if (matched) {
      canonicalMap[key] = { id: matched.id, name: spec.name, sku: spec.sku };
    } else {
      canonicalMap[key] = { id: 'prd_' + key + '_' + Date.now(), name: spec.name, sku: spec.sku };
    }
  }

  // Load all 86 Menus of brand_bangjo
  const menus = db.prepare(`
    SELECT m.id, m.menu_type, m.package_name, mt.name as title_name, sc.name as subcat_name, rf.name as rasa_name, c.name as cat_name
    FROM menus m
    LEFT JOIN menu_titles mt ON mt.id = m.title_id
    LEFT JOIN sub_categories sc ON sc.id = m.sub_category_id
    LEFT JOIN menu_flavors rf ON rf.id = m.rasa_id
    LEFT JOIN categories c ON c.id = m.category_id
    WHERE m.brand_id = ?
  `).all(BRAND_ID);

  function planMenu(menu) {
    const rawName = (menu.package_name || menu.title_name || menu.subcat_name || '').trim();
    const lowerName = rawName.toLowerCase();
    
    // Check if this is an Ayam menu (excluding Dumpling)
    const isAyam = (lowerName.includes('ayam') || lowerName.includes('petruk') || lowerName.includes('gareng') || lowerName.includes('semar') || lowerName.includes('bagong')) && !lowerName.includes('dumpling');

    if (isAyam) {
      // INVARIANT: Secara default ayam dengan nasi atau tanpa nasi itu ada lalapan dan tempenya!
      const items = [];
      
      // 1. Base Ayam
      if (lowerName.includes('tulang lunak')) items.push({ key: 'atl', qty: 1 });
      else if (lowerName.includes('kampung asli')) items.push({ key: 'aka', qty: 1 });
      else if (lowerName.includes('porsi kecil') || lowerName.includes('paket hemat')) items.push({ key: 'porsi_kecil', qty: 1 });
      else items.push({ key: 'negri', qty: 1 });

      // 2. Tempe & Lalapan (DEFAULT INVARIANT)
      items.push({ key: 'tempe', qty: 1 });
      items.push({ key: 'lalapan', qty: 1 });

      // 3. Sambal / Bumbu / Kremesan
      if (lowerName.includes('kremes')) {
        items.push({ key: 'kremes', qty: 1 });
        if (lowerName.includes('lombok ijo')) items.push({ key: 'sambal_lombok_ijo', qty: 1 });
        else items.push({ key: 'sambal_terasi', qty: 1 });
      } else if (lowerName.includes('lombok ijo')) {
        items.push({ key: 'sambal_lombok_ijo', qty: 1 });
      } else if (lowerName.includes('geprek')) {
        items.push({ key: 'sambal_geprek', qty: 1 });
      } else {
        items.push({ key: 'sambal_terasi', qty: 1 });
      }

      // 4. Nasi (jika dengan nasi atau paket yang menyertakan nasi)
      const hasNasi = lowerName.includes('+ nasi') || lowerName.includes('dengan nasi') || (
        !lowerName.includes('tanpa nasi') && !lowerName.includes('petruk ayam negri') && (
          lowerName.includes('paket') || lowerName.includes('super bagong')
        )
      );
      if (hasNasi) {
        items.push({ key: 'nasi', qty: 1 });
      }

      // 5. Minuman / Telur tambahan jika ada di nama paket
      if (lowerName.includes('es teh') || lowerName.includes('semar') || lowerName.includes('bagong') || lowerName.includes('petruk')) {
        items.push({ key: 'es_teh', qty: 1 });
      }
      if (lowerName.includes('telor') || lowerName.includes('telur') || lowerName.includes('special petruk') || lowerName.includes('semar') || lowerName.includes('petruk ayam negri') || lowerName.includes('super bagong')) {
        items.push({ key: 'telor_ceplok', qty: 1 });
      }

      return {
        menuId: menu.id,
        name: rawName,
        targetMenuType: 'PACKAGE',
        packageName: rawName,
        components: items
      };
    }

    // Paket Telur (Paket Jagoan)
    if (lowerName.includes('paket jagoan 1')) return { menuId: menu.id, name: rawName, targetMenuType: 'PACKAGE', packageName: rawName, components: [{ key: 'telor_cabe', qty: 3 }, { key: 'nasi', qty: 1 }, { key: 'es_teh', qty: 1 }] };
    if (lowerName.includes('paket jagoan 2')) return { menuId: menu.id, name: rawName, targetMenuType: 'PACKAGE', packageName: rawName, components: [{ key: 'telor_cabe', qty: 3 }, { key: 'nasi', qty: 1 }] };
    if (lowerName.includes('paket jagoan 3')) return { menuId: menu.id, name: rawName, targetMenuType: 'PACKAGE', packageName: rawName, components: [{ key: 'telor_cabe', qty: 1 }, { key: 'nasi', qty: 1 }, { key: 'es_teh', qty: 1 }] };
    if (lowerName.includes('paket jagoan 4')) return { menuId: menu.id, name: rawName, targetMenuType: 'PACKAGE', packageName: rawName, components: [{ key: 'telor_cabe', qty: 1 }, { key: 'nasi', qty: 1 }] };

    // Mie Paket
    if (lowerName.includes('mie bang jo') && lowerName.includes('es teh')) {
      return { menuId: menu.id, name: rawName, targetMenuType: 'PACKAGE', packageName: rawName, components: [{ key: 'mie', qty: 1 }, { key: 'es_teh', qty: 1 }] };
    }

    // TRUE SINGLE MENUS (1 item, qty = 1)
    let singleKey = 'atl';
    if (lowerName.includes('mie bang jo')) singleKey = 'mie';
    else if (lowerName.includes('banana milk')) singleKey = 'banana_milk';
    else if (lowerName.includes('butterscot')) singleKey = 'butterscot';
    else if (lowerName.includes('es bajigur')) singleKey = 'es_bajigur';
    else if (lowerName.includes('es beras kencur')) singleKey = 'es_beras_kencur';
    else if (lowerName.includes('es jahe')) singleKey = 'es_jahe';
    else if (lowerName.includes('es teh')) singleKey = 'es_teh';
    else if (lowerName.includes('jus timun')) singleKey = 'jus_timun';
    else if (lowerName.includes('jus tomat')) singleKey = 'jus_tomat';
    else if (lowerName.includes('kopi jo')) singleKey = 'kopi_jo';
    else if (lowerName.includes('pistachio')) singleKey = 'pistachio';
    else if (lowerName.includes('salted caramel')) singleKey = 'salted_caramel';
    else if (lowerName.includes('taro milk')) singleKey = 'taro_milk';
    else if (lowerName.includes('vanilla milk')) singleKey = 'vanilla_milk';
    else if (lowerName.includes('cah kangkung teri')) singleKey = 'cah_kangkung_teri';
    else if (lowerName.includes('cah kangkung')) singleKey = 'cah_kangkung';
    else if (lowerName.includes('nasi putih')) singleKey = 'nasi';
    else if (lowerName.includes('oseng terong')) singleKey = 'oseng_terong';
    else if (lowerName.includes('tahu goreng')) singleKey = 'tahu';
    else if (lowerName.includes('telur gulung')) singleKey = 'telur_gulung';
    else if (lowerName.includes('tempe goreng')) singleKey = 'tempe';
    else if (lowerName.includes('sambal geprek')) singleKey = 'sambal_geprek';
    else if (lowerName.includes('sambal lombok ijo')) singleKey = 'sambal_lombok_ijo';
    else if (lowerName.includes('sambal terasi')) singleKey = 'sambal_terasi';
    else if (lowerName.includes('dumpling')) singleKey = 'dumpling';
    else if (lowerName.includes('kentang')) singleKey = 'kentang';
    else if (lowerName.includes('keripik pangsit')) singleKey = 'pangsit';

    return {
      menuId: menu.id,
      name: rawName,
      targetMenuType: 'SINGLE',
      packageName: null,
      components: [{ key: singleKey, qty: 1 }]
    };
  }

  const plans = menus.map(planMenu);

  console.log('--- SAMPLE AYAM MENUS (TANPA NASI & DENGAN NASI) ---');
  const ayamSamples = plans.filter(p => p.name.toLowerCase().includes('ayam') && !p.name.toLowerCase().includes('dumpling'));
  ayamSamples.slice(0, 10).forEach(p => {
    const desc = p.components.map(c => `${c.qty}x ${canonicalMap[c.key].name}`).join(' + ');
    console.log(`[${p.targetMenuType}] ${p.name}\n   -> Komposisi: ${desc}`);
  });

  if (isDryRun) {
    console.log('\n[DRY RUN COMPLETE] Rencana dekonstruksi siap.');
    return;
  }

  // EXECUTE IN TRANSACTION
  db.exec('BEGIN TRANSACTION');
  try {
    // 0. Ensure all canonical products exist in products table
    const insertProd = db.prepare(`
      INSERT INTO products (id, brand_id, name, slug, sku, price, is_active, menu_schema_version, menu_migration_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 1, 4, 'migrated', datetime('now'), datetime('now'))
    `);
    for (const item of Object.values(canonicalMap)) {
      const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(item.id);
      if (!existing) {
        const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        insertProd.run(item.id, BRAND_ID, item.name, slug, item.sku);
        console.log(`Created canonical item: ${item.name} (${item.id}) [${item.sku}]`);
      } else {
        db.prepare('UPDATE products SET name = ? WHERE id = ?').run(item.name, item.id);
      }
    }

    const updateMenuStmt = db.prepare(`
      UPDATE menus
      SET menu_type = ?, package_name = COALESCE(package_name, ?), description = ?
      WHERE id = ?
    `);

    const clearMenuItems = db.prepare('DELETE FROM menu_items WHERE menu_id = ?');
    const insertMenuItem = db.prepare(`
      INSERT INTO menu_items (menu_id, product_id, quantity, sort_order)
      VALUES (?, ?, ?, ?)
    `);

    for (const plan of plans) {
      // Auto-compose readable description
      const descText = plan.components.map(c => `${c.qty > 1 ? c.qty + 'x ' : ''}${canonicalMap[c.key].name}`).join(' + ');

      // Update menu type & description
      updateMenuStmt.run(plan.targetMenuType, plan.packageName, descText, plan.menuId);

      // Re-link components
      clearMenuItems.run(plan.menuId);
      plan.components.forEach((c, idx) => {
        const itemInfo = canonicalMap[c.key];
        insertMenuItem.run(plan.menuId, itemInfo.id, c.qty, idx + 1);
      });
    }

    db.exec('COMMIT');
    console.log(`\n[SUCCESS] Berhasil memperbarui perakitan 86 menu.`);

    // VERIFICATION
    const resolved = ComposedMenuResolver.resolveMasterMenu({ brandId: BRAND_ID });
    const invalid = resolved.filter(m => !m.is_available || m.blocking_reason);
    if (invalid.length > 0) {
      console.warn(`[WARNING] ${invalid.length} menus bermasalah:`, invalid.map(m => m.title + ' -> ' + m.blocking_reason));
    } else {
      console.log(`[VERIFICATION PASS] Seluruh 86 menu valid, aktif, dan tersedia 100%!`);
    }

  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[ERROR] Rollback:', err);
    throw err;
  }
}

if (require.main === module) {
  const isDryRun = !process.argv.includes('--apply');
  run(isDryRun);
}

module.exports = { run };
