'use strict';

const CostingRepository = require('../../../core/data/repositories/CostingRepository');
const UomConversionService = require('../../uom/services/UomConversionService');

const repository = new CostingRepository();

const COST_BASES = new Set(['ACTUAL_OUTPUT', 'THEORETICAL_RECIPE']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function text(value, code) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw fail(code);
  return result;
}

function finiteNonNegative(value, code) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw fail(code);
  return n;
}

function normalizeCurrency(value) {
  const code = text(value, 'CURRENCY_BASIS_UNRESOLVED').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw fail('CURRENCY_BASIS_UNRESOLVED');
  return code;
}

function resolvePurchasedProductCost({ product, stockLocationId, repo }) {
  const balance = repo.findProductBalance({ stockLocationId, productId: product.id });
  if (!balance || Number(balance.quantity) <= 0 || balance.cost_availability_status !== 'AVAILABLE') {
    return {
      status: 'UNAVAILABLE',
      reason: 'PRODUCT_INVENTORY_COST_UNAVAILABLE',
      product_id: product.id
    };
  }

  const movement = repo.findLatestMaterialMovement
    ? null
    : null;
  return {
    status: 'AVAILABLE',
    source: 'PRODUCT_INVENTORY_CARRYING_COST',
    product_id: product.id,
    unit_cost: Number(balance.moving_average_unit_cost),
    total_value: Number(balance.carrying_value),
    valuation_version: Number(balance.valuation_version),
    currency_code: null
  };
}

function resolveActualProductionCost({ product, stockLocationId, repo }) {
  const snapshot = repo.findLatestProductionCostSnapshot({
    productId: product.id,
    stockLocationId
  });
  if (!snapshot) {
    return {
      status: 'UNAVAILABLE',
      reason: 'PRODUCTION_ACTUAL_OUTPUT_COST_UNAVAILABLE',
      product_id: product.id
    };
  }

  return {
    status: snapshot.cost_availability_status,
    source: 'PRODUCTION_ACTUAL_OUTPUT',
    product_id: product.id,
    unit_cost: finiteNonNegative(snapshot.production_output_unit_cost, 'PRODUCTION_COST_INVALID'),
    currency_code: normalizeCurrency(snapshot.currency_code),
    production_batch_id: snapshot.production_batch_id,
    production_posting_id: snapshot.production_posting_id,
    snapshot_id: snapshot.id,
    actual_output_quantity: Number(snapshot.actual_output_quantity)
  };
}

function resolveTheoreticalProductionCost({ product, stockLocationId, repo }) {
  const routes = repo.findProductionRoute({
    productId: product.id,
    stockLocationId
  });

  if (routes.length === 0) {
    return {
      status: 'UNAVAILABLE',
      reason: 'PRODUCTION_ROUTE_NOT_FOUND',
      product_id: product.id
    };
  }
  if (routes.length > 1) {
    return {
      status: 'UNAVAILABLE',
      reason: 'PRODUCTION_ROUTE_AMBIGUOUS',
      product_id: product.id
    };
  }

  const recipe = repo.findRecipeByProductionItemId(routes[0].id);
  if (!recipe || recipe.status !== 'ACTIVE') {
    return {
      status: 'UNAVAILABLE',
      reason: 'RECIPE_NOT_ACTIVE',
      product_id: product.id
    };
  }

  const version = repo.findPublishedRecipeVersion(recipe.id);
  if (!version) {
    return {
      status: 'UNAVAILABLE',
      reason: 'RECIPE_VERSION_NOT_PUBLISHED',
      product_id: product.id
    };
  }

  const productUom = repo.findUom(product.product_stock_uom_id);
  const yieldUom = repo.findUom(version.yield_uom_id);
  if (!productUom || Number(productUom.is_active) !== 1 || !yieldUom || Number(yieldUom.is_active) !== 1) {
    return {
      status: 'UNAVAILABLE',
      reason: 'OUTPUT_UOM_UNRESOLVED',
      product_id: product.id
    };
  }

  let outputYield;
  try {
    outputYield = UomConversionService.convertQuantity({
      quantity: version.planned_yield_quantity,
      sourceUomId: yieldUom.id,
      targetUomId: productUom.id,
      repository: {
        findById: (id) => repo.findUom(id)
      }
    }).target_quantity;
  } catch (error) {
    return {
      status: 'UNAVAILABLE',
      reason: error.code || 'OUTPUT_YIELD_UOM_INVALID',
      product_id: product.id
    };
  }

  if (!Number.isFinite(outputYield) || outputYield <= 0) {
    return {
      status: 'UNAVAILABLE',
      reason: 'OUTPUT_YIELD_INVALID',
      product_id: product.id
    };
  }

  const components = repo.findRecipeComponents(version.id);
  if (components.length === 0) {
    return {
      status: 'UNAVAILABLE',
      reason: 'RECIPE_COMPONENTS_REQUIRED',
      product_id: product.id
    };
  }

  let materialCost = 0;
  let currency = null;
  const componentCosts = [];

  for (const component of components) {
    const material = repo.findMaterial(component.material_id);
    if (!material || material.status !== 'ACTIVE') {
      return {
        status: 'UNAVAILABLE',
        reason: 'MATERIAL_NOT_AVAILABLE',
        product_id: product.id,
        material_id: component.material_id
      };
    }

    let normalizedQuantity;
    try {
      normalizedQuantity = UomConversionService.resolveBaseQuantity({
        materialId: material.id,
        sourceUomId: component.planned_uom_id,
        quantity: component.planned_quantity,
        repository: {
          db: repo.db,
          findById: (id) => repo.findUom(id)
        }
      });
    } catch (error) {
      return {
        status: 'UNAVAILABLE',
        reason: error.code || 'MATERIAL_UOM_INVALID',
        product_id: product.id,
        material_id: material.id
      };
    }

    const balance = repo.findMaterialBalance({
      stockLocationId,
      materialId: material.id
    });
    const movement = repo.findLatestMaterialMovement({
      stockLocationId,
      materialId: material.id
    });

    if (
      !balance ||
      balance.cost_availability_status !== 'AVAILABLE' ||
      Number(balance.quantity_base) <= 0 ||
      !movement ||
      !movement.currency_code
    ) {
      return {
        status: 'UNAVAILABLE',
        reason: 'MATERIAL_CURRENT_COST_UNAVAILABLE',
        product_id: product.id,
        material_id: material.id
      };
    }

    const componentCurrency = normalizeCurrency(movement.currency_code);
    if (currency && currency !== componentCurrency) {
      return {
        status: 'UNAVAILABLE',
        reason: 'COST_CURRENCY_MISMATCH',
        product_id: product.id,
        material_id: material.id
      };
    }
    currency = componentCurrency;

    const unitCost = finiteNonNegative(
      balance.moving_average_unit_cost,
      'MATERIAL_COST_INVALID'
    );
    const totalCost = normalizedQuantity.target_quantity * unitCost;
    materialCost += totalCost;

    componentCosts.push({
      material_id: material.id,
      quantity_base: normalizedQuantity.target_quantity,
      unit_cost: unitCost,
      total_cost: totalCost,
      currency_code: componentCurrency,
      valuation_version: Number(balance.valuation_version)
    });
  }

  return {
    status: 'AVAILABLE',
    source: 'THEORETICAL_RECIPE',
    product_id: product.id,
    unit_cost: materialCost / outputYield,
    currency_code: currency,
    production_item_id: routes[0].id,
    recipe_id: recipe.id,
    recipe_version_id: version.id,
    planned_yield_quantity: outputYield,
    component_costs: componentCosts
  };
}

class MenuCompositionCostService {
  static resolveProductUnitCost({
    productId,
    stockLocationId,
    basis,
    repository: repo = repository
  }) {
    const product = repo.findProduct(productId);
    if (!product || Number(product.is_active) !== 1) {
      return {
        status: 'UNAVAILABLE',
        reason: 'PRODUCT_NOT_FOUND',
        product_id: productId
      };
    }

    const costBasis = text(basis, 'MENU_COST_BASIS_REQUIRED').toUpperCase();
    if (!COST_BASES.has(costBasis)) throw fail('MENU_COST_BASIS_INVALID');

    const routes = repo.findProductionRoute({
      productId,
      stockLocationId
    });

    if (routes.length > 1) {
      return {
        status: 'UNAVAILABLE',
        reason: 'PRODUCTION_ROUTE_AMBIGUOUS',
        product_id: productId
      };
    }

    if (routes.length === 0) {
      const purchased = resolvePurchasedProductCost({ product, stockLocationId, repo });
      return purchased;
    }

    if (costBasis === 'ACTUAL_OUTPUT') {
      return resolveActualProductionCost({ product, stockLocationId, repo });
    }

    return resolveTheoreticalProductionCost({ product, stockLocationId, repo });
  }

  static calculateMenuCompositionCost({
    brandId,
    menuId,
    stockLocationId,
    basis,
    repository: repo = repository
  }) {
    const costBasis = text(basis, 'MENU_COST_BASIS_REQUIRED').toUpperCase();
    if (!COST_BASES.has(costBasis)) throw fail('MENU_COST_BASIS_INVALID');

    const menu = repo.findMenu({ brandId, menuId });
    if (!menu) throw fail('MENU_NOT_FOUND');

    const items = repo.listMenuItems({ brandId, menuId });
    if (items.length === 0) {
      return {
        status: 'UNAVAILABLE',
        reason: 'MENU_COMPOSITION_INVALID',
        brand_id: brandId,
        menu_id: menuId,
        basis: costBasis,
        total_cost: null,
        currency_code: null,
        components: []
      };
    }

    let totalCost = 0;
    let currency = null;
    let estimated = false;
    const components = [];

    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw fail('MENU_COMPOSITION_INVALID');

      const productCost = this.resolveProductUnitCost({
        productId: item.product_id,
        stockLocationId,
        basis: costBasis,
        repository: repo
      });

      if (productCost.status === 'UNAVAILABLE') {
        return {
          status: 'UNAVAILABLE',
          reason: productCost.reason,
          brand_id: brandId,
          menu_id: menuId,
          basis: costBasis,
          total_cost: null,
          currency_code: null,
          components: components.concat([{
            menu_item_product_id: item.product_id,
            quantity,
            cost_status: productCost.status,
            cost_reason: productCost.reason
          }])
        };
      }

      const componentCurrency = productCost.currency_code;
      if (componentCurrency) {
        if (currency && currency !== componentCurrency) {
          return {
            status: 'UNAVAILABLE',
            reason: 'COST_CURRENCY_MISMATCH',
            brand_id: brandId,
            menu_id: menuId,
            basis: costBasis,
            total_cost: null,
            currency_code: null,
            components
          };
        }
        currency = componentCurrency;
      }

      if (productCost.status === 'ESTIMATED') estimated = true;

      const lineTotal = Number(productCost.unit_cost) * quantity;
      totalCost += lineTotal;

      components.push({
        menu_item_product_id: item.product_id,
        product_name: item.product_name,
        quantity,
        unit_cost: Number(productCost.unit_cost),
        total_cost: lineTotal,
        currency_code: componentCurrency || null,
        source: productCost.source,
        source_reference: productCost.snapshot_id || productCost.production_batch_id || null
      });
    }

    return {
      status: estimated ? 'ESTIMATED' : 'AVAILABLE',
      basis: costBasis,
      valuation_method: 'MOVING_AVERAGE',
      brand_id: brandId,
      menu_id: menuId,
      stock_location_id: stockLocationId,
      total_cost: totalCost,
      currency_code: currency,
      components
    };
  }
}

module.exports = MenuCompositionCostService;
