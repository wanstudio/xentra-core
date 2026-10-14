'use strict';

const db = require('../../../server/database/db');
const { UomConversionService } = require('../../uom');
const UomRepository = require('../../../core/data/repositories/UomRepository');
const uomRepository = new UomRepository();

class ReplenishmentService {
  /**
   * Menghitung rekomendasi pengadaan/belanja bahan baku:
   * 1. Defisit menu dari target stok (delta = target - stok)
   * 2. Ledakan resep (BOM) menjadi kebutuhan gross bahan mentah
   * 3. Pengurangan saldo fisik bahan & PO in-transit menjadi kebutuhan bersih (net deficit)
   * 4. Pembulatan kemasan pack dan batas MOQ supplier
   *
   * @param {Object} params
   * @param {string} params.organizationId
   * @param {string} [params.stockLocationId]
   * @param {string} [params.branchId]
   * @param {Object} [params.dbInstance]
   */
  static calculateReplenishment({ organizationId, stockLocationId = null, branchId = null, dbInstance = db }) {
    if (!organizationId) throw new Error('ORGANIZATION_REQUIRED');

    // 1. Resolve stock location
    let location = null;
    if (stockLocationId) {
      location = dbInstance.prepare(
        'SELECT id, organization_id, branch_id, name FROM stock_locations WHERE id = ? AND organization_id = ? AND is_active = 1'
      ).get(stockLocationId, organizationId);
    } else if (branchId) {
      location = dbInstance.prepare(
        "SELECT id, organization_id, branch_id, name FROM stock_locations WHERE branch_id = ? AND organization_id = ? AND is_active = 1 AND location_type = 'BRANCH' LIMIT 1"
      ).get(branchId, organizationId);
    } else {
      // Fallback: ambil lokasi stok cabang aktif pertama milik organisasi jika tidak ada filter cabang spesifik
      location = dbInstance.prepare(
        "SELECT id, organization_id, branch_id, name FROM stock_locations WHERE organization_id = ? AND is_active = 1 AND location_type = 'BRANCH' ORDER BY id ASC LIMIT 1"
      ).get(organizationId);
    }

    if (!location) {
      return {
        organization_id: organizationId,
        stock_location_id: null,
        branch_id: branchId || null,
        suggestions: [],
        total_estimated_cost: 0,
        summary: { total_materials_needed: 0, total_packs: 0 }
      };
    }

    const locId = location.id;

    // 2. Ambil seluruh saldo produk dan kebijakan reorder produk
    const productPolicies = dbInstance.prepare(`
      SELECT 
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        COALESCE(psb.quantity, 0) AS current_stock,
        COALESCE(rp.minimum_quantity, bpi.low_stock_threshold, 0) AS minimum_quantity,
        COALESCE(rp.target_quantity, bpi.low_stock_threshold, 0) AS target_quantity
      FROM products p
      JOIN brands br ON br.id = p.brand_id AND br.organization_id = ?
      LEFT JOIN product_stock_balances psb ON psb.product_id = p.id AND psb.stock_location_id = ?
      LEFT JOIN inventory_reorder_policies rp ON rp.stock_location_id = ? AND rp.identity_type = 'PRODUCT' AND rp.identity_id = p.id
      LEFT JOIN branch_product_inventory bpi ON bpi.branch_id = ? AND bpi.product_id = p.id
      WHERE p.is_active = 1
    `).all(organizationId, locId, locId, location.branch_id);

    // 3. Ambil seluruh resep versi aktif
    const recipes = dbInstance.prepare(`
      SELECT 
        pi.id AS production_item_id,
        pi.output_product_id,
        pi.name AS production_item_name,
        rv.id AS recipe_version_id,
        rv.planned_yield_quantity,
        rv.yield_uom_id
      FROM production_items pi
      JOIN recipes r ON r.production_item_id = pi.id
      JOIN recipe_versions rv ON rv.recipe_id = r.id
      WHERE pi.organization_id = ? AND pi.status = 'ACTIVE' AND r.status = 'ACTIVE' AND rv.status = 'PUBLISHED'
      ORDER BY rv.version_number DESC
    `).all(organizationId);

    // Filter ke resep terbaru per output_product_id
    const latestRecipeByProduct = new Map();
    for (const r of recipes) {
      if (!latestRecipeByProduct.has(String(r.output_product_id))) {
        latestRecipeByProduct.set(String(r.output_product_id), r);
      }
    }

    // Ambil komponen untuk setiap resep yang relevan
    const recipeVersionIds = Array.from(new Set(Array.from(latestRecipeByProduct.values()).map(r => r.recipe_version_id)));
    const componentsByVersion = new Map();
    if (recipeVersionIds.length > 0) {
      const placeholders = recipeVersionIds.map(() => '?').join(',');
      const rows = dbInstance.prepare(`
        SELECT 
          rc.recipe_version_id,
          rc.material_id,
          m.name AS material_name,
          m.material_code,
          m.base_uom_id,
          bu.name AS base_uom_name,
          bu.code AS base_uom_code,
          rc.planned_quantity,
          rc.planned_uom_id
        FROM recipe_components rc
        JOIN materials m ON m.id = rc.material_id
        JOIN uoms bu ON bu.id = m.base_uom_id
        WHERE rc.recipe_version_id IN (${placeholders})
        ORDER BY rc.sort_order, m.name
      `).all(...recipeVersionIds);

      for (const row of rows) {
        if (!componentsByVersion.has(row.recipe_version_id)) {
          componentsByVersion.set(row.recipe_version_id, []);
        }
        componentsByVersion.get(row.recipe_version_id).push(row);
      }
    }

    // 4. Analisis batas atas kebutuhan resep per bahan baku (Worst-Case Recipe Requirement)
    // Misalnya Bahan A dipakai 3g di Menu X dan 5g di Menu Y -> max_unit_usage = 5g (Menu Y).
    // Jika sisa stok bahan A < 5g (atau <= 0), bahan tersebut otomatis masuk rekomendasi belanja!
    const materialRecipeDemandMap = new Map();

    for (const [prodId, recipe] of latestRecipeByProduct.entries()) {
      const yieldQty = Number(recipe.planned_yield_quantity) || 1;
      const components = componentsByVersion.get(recipe.recipe_version_id) || [];
      const prodInfo = productPolicies.find(p => String(p.product_id) === String(prodId));
      const prodName = (prodInfo && prodInfo.product_name) || recipe.production_item_name || 'Menu';

      for (const comp of components) {
        let qtyInBase = Number(comp.planned_quantity || 0);
        if (comp.planned_uom_id && comp.planned_uom_id !== comp.base_uom_id) {
          try {
            const conv = UomConversionService.convertQuantity({
              quantity: qtyInBase,
              sourceUomId: comp.planned_uom_id,
              targetUomId: comp.base_uom_id,
              repository: uomRepository
            });
            qtyInBase = Number(conv.target_quantity);
          } catch (_) {}
        }

        const unitUsage = qtyInBase / yieldQty;
        const matId = String(comp.material_id);

        if (!materialRecipeDemandMap.has(matId)) {
          materialRecipeDemandMap.set(matId, {
            material_id: comp.material_id,
            material_name: comp.material_name,
            material_code: comp.material_code,
            base_uom_id: comp.base_uom_id,
            base_uom_name: comp.base_uom_name,
            base_uom_code: comp.base_uom_code,
            total_resto_usage: 0,
            max_unit_usage: 0,
            max_unit_product_name: '',
            max_batch_usage: 0,
            max_batch_product_name: '',
            usages: []
          });
        }

        const demand = materialRecipeDemandMap.get(matId);
        demand.total_resto_usage += unitUsage;
        demand.usages.push({
          product_id: prodId,
          product_name: prodName,
          unit_usage: unitUsage,
          batch_usage: qtyInBase,
          yield_quantity: yieldQty
        });

        if (unitUsage > demand.max_unit_usage) {
          demand.max_unit_usage = unitUsage;
          demand.max_unit_product_name = prodName;
        }
        if (qtyInBase > demand.max_batch_usage) {
          demand.max_batch_usage = qtyInBase;
          demand.max_batch_product_name = prodName;
        }
      }
    }

    // 5. Hitung kebutuhan kotor bahan baku (Gross Material Requirement) dari defisit menu siap jual
    // materialGrossMap: material_id -> { material_id, material_name, material_code, base_uom_id, base_uom_name, base_uom_code, gross_needed, demand_sources: [] }
    const materialGrossMap = new Map();

    for (const prod of productPolicies) {
      const currentStock = Number(prod.current_stock || 0);
      const minStock = Number(prod.minimum_quantity || 0);
      const targetStock = Math.max(Number(prod.target_quantity || 0), minStock);

      // Trigger: Stok saat ini <= batas minimum & target > current
      if (currentStock <= minStock && targetStock > currentStock) {
        const deficitPortions = targetStock - currentStock;
        const recipe = latestRecipeByProduct.get(String(prod.product_id));

        if (recipe) {
          const yieldQty = Number(recipe.planned_yield_quantity) || 1;
          const components = componentsByVersion.get(recipe.recipe_version_id) || [];

          for (const comp of components) {
            // Konversi planned_quantity dari planned_uom ke base_uom jika berbeda
            let qtyInBase = Number(comp.planned_quantity || 0);
            if (comp.planned_uom_id && comp.planned_uom_id !== comp.base_uom_id) {
              try {
                const conv = UomConversionService.convertQuantity({
                  quantity: qtyInBase,
                  sourceUomId: comp.planned_uom_id,
                  targetUomId: comp.base_uom_id,
                  repository: uomRepository
                });
                qtyInBase = Number(conv.target_quantity);
              } catch (_) {
                // Gunakan rasio 1:1 jika fallback
              }
            }

            // Proporsi kebutuhan bahan untuk defisit porsi menu
            const neededForDeficit = (deficitPortions / yieldQty) * qtyInBase;
            const matId = String(comp.material_id);

            if (!materialGrossMap.has(matId)) {
              materialGrossMap.set(matId, {
                material_id: comp.material_id,
                material_name: comp.material_name,
                material_code: comp.material_code,
                base_uom_id: comp.base_uom_id,
                base_uom_name: comp.base_uom_name,
                base_uom_code: comp.base_uom_code,
                gross_needed: 0,
                demand_sources: []
              });
            }

            const item = materialGrossMap.get(matId);
            item.gross_needed += neededForDeficit;
            item.demand_sources.push({
              product_id: prod.product_id,
              product_name: prod.product_name,
              current_stock: currentStock,
              target_stock: targetStock,
              deficit_portions: deficitPortions,
              material_portion_needed: Math.round(neededForDeficit * 1000) / 1000
            });
          }
        }
      }
    }

    // 6. Evaluasi stok bahan mentah gudang:
    // - Batas atas kebutuhan menu terbesar (Worst-Case Threshold)
    // - Direct reorder policy jika disetel
    const materialBalances = dbInstance.prepare(`
      SELECT 
        m.id AS material_id,
        m.name AS material_name,
        m.material_code,
        m.base_uom_id,
        COALESCE(m.purchase_uom_name, '') AS purchase_uom_name,
        COALESCE(m.purchase_uom_ratio, 1) AS purchase_uom_ratio,
        u.name AS base_uom_name,
        u.code AS base_uom_code,
        COALESCE(msb.quantity_base, 0) AS current_stock,
        COALESCE(msb.moving_average_unit_cost, 0) AS moving_average_unit_cost,
        COALESCE(rp.minimum_quantity, 0) AS minimum_quantity,
        COALESCE(rp.target_quantity, 0) AS target_quantity
      FROM materials m
      JOIN uoms u ON u.id = m.base_uom_id
      LEFT JOIN material_stock_balances msb ON msb.material_id = m.id AND msb.stock_location_id = ?
      LEFT JOIN inventory_reorder_policies rp ON rp.stock_location_id = ? AND rp.identity_type = 'MATERIAL' AND rp.identity_id = m.id
      WHERE m.organization_id = ? AND m.status = 'ACTIVE'
    `).all(locId, locId, organizationId);

    const materialBalancesMap = new Map();
    for (const mb of materialBalances) {
      materialBalancesMap.set(String(mb.material_id), mb);

      const curStock = Number(mb.current_stock || 0);
      const minStock = Number(mb.minimum_quantity || 0);
      const tarStock = Math.max(Number(mb.target_quantity || 0), minStock);
      const matId = String(mb.material_id);
      const recipeDemand = materialRecipeDemandMap.get(matId);

      // A. Cek defisit reorder policy langsung
      // Jika target stok belanja telah diisi dan stok saat ini berada di bawah target
      // (baik karena menyentuh batas minimum atau sisa fisik saat ini < target belanja kulkas)
      const hasPolicyDeficit = tarStock > curStock && (minStock > 0 ? curStock <= minStock : curStock < tarStock);

      // B. Cek Batas Kebutuhan Resto (Total Resep Resto & Safety Buffer):
      // Ambang batas warning dihitung dari total kebutuhan seluruh menu resto yang memakai bahan tersebut x 2 (Safety Buffer),
      // dan minimal 2x takaran porsi menu terbesar agar dapur aman dan tidak kehabisan bahan saat ramai!
      let hasWorstCaseDeficit = false;
      let singlePortionUsage = 0;
      let totalRestoUsage = 0;
      let safeRestoThreshold = 0;
      let worstProductName = '';

      if (recipeDemand && (recipeDemand.total_resto_usage > 0 || recipeDemand.max_unit_usage > 0)) {
        singlePortionUsage = recipeDemand.max_unit_usage || 0;
        totalRestoUsage = recipeDemand.total_resto_usage || singlePortionUsage;
        safeRestoThreshold = Math.max(totalRestoUsage * 2, singlePortionUsage * 2);
        worstProductName = recipeDemand.max_unit_product_name || 'Menu';

        if (curStock <= safeRestoThreshold || curStock <= 0) {
          hasWorstCaseDeficit = true;
        }
      }

      if (hasPolicyDeficit || hasWorstCaseDeficit) {
        if (!materialGrossMap.has(matId)) {
          materialGrossMap.set(matId, {
            material_id: mb.material_id,
            material_name: mb.material_name,
            material_code: mb.material_code,
            base_uom_id: mb.base_uom_id,
            base_uom_name: mb.base_uom_name,
            base_uom_code: mb.base_uom_code,
            gross_needed: 0,
            demand_sources: []
          });
        }

        const item = materialGrossMap.get(matId);

        if (hasWorstCaseDeficit) {
          const recommendedMinTarget = Math.max(recipeDemand.max_batch_usage || 0, safeRestoThreshold * 2, tarStock, 1);
          const deficit = Math.max(1, recommendedMinTarget - curStock);

          if (item.gross_needed < recommendedMinTarget) {
            item.gross_needed = recommendedMinTarget;
          }

          item.demand_sources.push({
            type: 'WORST_CASE_RECIPE_THRESHOLD',
            material_name: mb.material_name,
            current_stock: curStock,
            total_resto_usage: Math.round(totalRestoUsage * 1000) / 1000,
            single_portion_usage: Math.round(singlePortionUsage * 1000) / 1000,
            threshold: Math.round(safeRestoThreshold * 1000) / 1000,
            worst_product_name: worstProductName,
            deficit: Math.round(deficit * 1000) / 1000,
            target_stock: recommendedMinTarget
          });
        } else if (hasPolicyDeficit) {
          const matDeficit = tarStock - curStock;
          item.gross_needed = Math.max(item.gross_needed, tarStock);
          item.demand_sources.push({
            type: 'DIRECT_MATERIAL_POLICY',
            material_name: mb.material_name,
            current_stock: curStock,
            target_stock: tarStock,
            deficit_portions: matDeficit,
            material_portion_needed: matDeficit
          });
        }
      }
    }

    if (materialGrossMap.size === 0) {
      return {
        organization_id: organizationId,
        stock_location_id: locId,
        stock_location_name: location.name,
        branch_id: location.branch_id,
        suggestions: [],
        total_estimated_cost: 0,
        summary: { total_materials_needed: 0, total_packs: 0 }
      };
    }

    // 5. Cek PO yang sedang In-Transit / Ordered ke lokasi ini untuk menghitung Effective Stock (sisa yang belum diterima)
    const onOrderRows = dbInstance.prepare(`
      SELECT 
        sm.material_id,
        COALESCE(SUM(MAX(0, pol.resolved_base_quantity - pol.received_base_quantity)), 0) AS on_order_base_qty
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      JOIN supplier_materials sm ON sm.id = pol.supplier_material_id
      WHERE po.destination_stock_location_id = ?
        AND po.status IN ('ORDERED', 'PARTIALLY_RECEIVED')
      GROUP BY sm.material_id
    `).all(locId);

    const onOrderMap = new Map();
    for (const row of onOrderRows) {
      onOrderMap.set(String(row.material_id), Number(row.on_order_base_qty || 0));
    }

    // 6. Ambil katalog Supplier Material Pack aktif untuk bahan-bahan tersebut
    const materialIds = Array.from(materialGrossMap.keys());
    const placeholders = materialIds.map(() => '?').join(',');
    const supplierPackRows = dbInstance.prepare(`
      SELECT 
        smp.id AS supplier_pack_id,
        smp.name AS supplier_pack_name,
        smp.content_quantity,
        smp.content_uom_id,
        cu.name AS content_uom_name,
        cu.code AS content_uom_code,
        smp.minimum_order_quantity,
        smp.unit_price,
        smp.currency_code,
        sm.id AS supplier_material_id,
        sm.supplier_id,
        s.name AS supplier_name,
        sm.material_id
      FROM supplier_material_packs smp
      JOIN supplier_materials sm ON sm.id = smp.supplier_material_id
      JOIN suppliers s ON s.id = sm.supplier_id
      JOIN uoms cu ON cu.id = smp.content_uom_id
      WHERE sm.material_id IN (${placeholders})
        AND s.organization_id = ?
        AND s.status = 'ACTIVE'
        AND sm.is_active = 1
        AND smp.is_active = 1
      ORDER BY smp.unit_price ASC
    `).all(...materialIds, organizationId);

    // Ambil default pack terbaik (termurah) per material
    const bestPackByMaterial = new Map();
    for (const pack of supplierPackRows) {
      const matId = String(pack.material_id);
      if (!bestPackByMaterial.has(matId)) {
        bestPackByMaterial.set(matId, pack);
      }
    }

    // 7. Rangkai Rekomendasi Replenishment
    const suggestions = [];
    let totalEstCost = 0;
    let totalPacksCount = 0;

    for (const [matId, grossInfo] of materialGrossMap.entries()) {
      const balance = materialBalancesMap.get(matId);
      const currentPhysicalStock = balance ? Number(balance.current_stock || 0) : 0;
      const onOrderStock = onOrderMap.get(matId) || 0;
      const effectiveStock = currentPhysicalStock + onOrderStock;

      const grossNeeded = grossInfo.gross_needed;
      // Net Deficit = max(0, Gross Needed - Effective Stock)
      const netDeficit = Math.max(0, grossNeeded - effectiveStock);

      if (netDeficit <= 0) {
        // Kebutuhan kotor sudah tertutup oleh stok fisik dan pesanan yang sedang jalan
        continue;
      }

      const pack = bestPackByMaterial.get(matId);
      let purchasePacks = 0;
      let purchaseTotalBaseQty = 0;
      let packSize = 1;
      let baseQtyPerPack = 1;
      let moq = 1;
      let unitPrice = 0;
      let estCost = 0;
      let supplierInfo = null;

      if (pack) {
        packSize = Number(pack.content_quantity) || 1;
        baseQtyPerPack = packSize;

        // Jika satuan kemasan pack berbeda dengan base UOM material, konversi ke base UOM
        if (pack.content_uom_id && pack.content_uom_id !== grossInfo.base_uom_id) {
          try {
            const convertedPack = UomConversionService.convertQuantity({
              quantity: packSize,
              sourceUomId: pack.content_uom_id,
              targetUomId: grossInfo.base_uom_id,
              repository: uomRepository
            });
            baseQtyPerPack = Number(convertedPack.target_quantity);
          } catch (_) {
            baseQtyPerPack = packSize;
          }
        }

        moq = Math.max(1, Number(pack.minimum_order_quantity) || 1);
        unitPrice = Number(pack.unit_price) || 0;

        // Hitung packs needed dengan pembulatan ke atas (ceiling) terhadap isi per pack dalam base UOM
        const rawPacks = Math.ceil(netDeficit / baseQtyPerPack);
        // Terapkan batas MOQ supplier
        purchasePacks = Math.max(rawPacks, moq);
        purchaseTotalBaseQty = purchasePacks * baseQtyPerPack;
        estCost = purchasePacks * unitPrice;

        supplierInfo = {
          supplier_id: pack.supplier_id,
          supplier_name: pack.supplier_name,
          supplier_material_id: pack.supplier_material_id,
          supplier_pack_id: pack.supplier_pack_id,
          supplier_pack_name: pack.supplier_pack_name,
          pack_size: packSize,
          pack_uom_name: pack.content_uom_name || pack.content_uom_code || grossInfo.base_uom_name,
          base_quantity_per_pack: baseQtyPerPack,
          minimum_order_quantity: moq,
          unit_price: unitPrice,
          currency_code: pack.currency_code || 'IDR'
        };

        totalPacksCount += purchasePacks;
      } else {
        // Fallback jika belum didaftarkan supplier pack resmi: gunakan belanja pasar/eceran (Market Purchase)
        const marketUnitName = (balance && balance.purchase_uom_name) ? balance.purchase_uom_name : grossInfo.base_uom_name;
        const marketUnitRatio = (balance && Number(balance.purchase_uom_ratio) > 0) ? Number(balance.purchase_uom_ratio) : 1;

        // Hitung kebutuhan dibulatkan ke satuan beli pasar terdekat (misal Ekor, Bungkus, Jerigen)
        purchasePacks = Math.ceil(netDeficit / marketUnitRatio);
        purchaseTotalBaseQty = purchasePacks * marketUnitRatio;
        unitPrice = balance ? Number(balance.moving_average_unit_cost || 0) : 0;
        estCost = Math.round(purchaseTotalBaseQty * unitPrice);

        supplierInfo = {
          is_market_purchase: true,
          purchase_uom_name: marketUnitName,
          purchase_uom_ratio: marketUnitRatio,
          base_uom_name: grossInfo.base_uom_name
        };
      }

      totalEstCost += estCost;

      suggestions.push({
        material_id: grossInfo.material_id,
        material_name: grossInfo.material_name,
        material_code: grossInfo.material_code,
        base_uom_name: grossInfo.base_uom_name,
        base_uom_code: grossInfo.base_uom_code,
        purchase_uom_name: (balance && balance.purchase_uom_name) || (supplierInfo && supplierInfo.pack_uom_name) || grossInfo.base_uom_name,
        purchase_uom_ratio: (balance && Number(balance.purchase_uom_ratio) > 0) ? Number(balance.purchase_uom_ratio) : 1,
        gross_quantity_needed: Math.round(grossNeeded * 1000) / 1000,
        current_stock: currentPhysicalStock,
        on_order_stock: onOrderStock,
        effective_stock: effectiveStock,
        net_deficit_quantity: Math.round(netDeficit * 1000) / 1000,
        recommended_purchase_packs: purchasePacks,
        recommended_purchase_base_quantity: purchaseTotalBaseQty,
        estimated_cost: estCost,
        unit_price: unitPrice,
        supplier: supplierInfo,
        reasons: grossInfo.demand_sources
      });
    }

    return {
      organization_id: organizationId,
      stock_location_id: locId,
      stock_location_name: location.name,
      branch_id: location.branch_id,
      suggestions: suggestions,
      total_estimated_cost: totalEstCost,
      summary: {
        total_materials_needed: suggestions.length,
        total_packs: totalPacksCount
      }
    };
  }
}

module.exports = ReplenishmentService;
