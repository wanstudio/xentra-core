/**
 * Xentra Commerce — Branch/Product Eligibility Service (C3 / Phase D)
 *
 * Canonical, deterministic decision layer answering:
 *
 *   "Can this Branch currently satisfy a requested product / cart requirement?"
 *
 * It consumes authoritative operational facts only and NEVER decides:
 *   - which branch to select (nearest / best / cheapest)      -> later Matching
 *   - routing / ETA / delivery pricing                        -> later Routing
 *   - stock mutation / reservation                            -> Inventory (C2)
 *   - split fulfillment (Core v1 = 1 cart -> 1 fulfillment branch)
 *
 * Facts consumed (all read server-side, never from the client):
 *   branches.is_active / is_open_override           (B1 branch operational state)
 *   products.is_active + brand scope                (C1 product master)
 *   branch_products row = assignment                (C1 product <-> branch)
 *   branch_products.is_available                    (C1 operational availability flag)
 *   branch_products.stock                           (C2 branch inventory)
 *   branch_delivery_settings.is_delivery_active /
 *       is_pickup_active                            (B1 fulfillment capability)
 *
 * One canonical source of eligibility logic. Consumers must not re-implement
 * these rules:
 *   - BranchMatcher (server/services/BranchMatcher.js) narrows delivery
 *     candidates through evaluateCart().
 *   - PrePaymentVerificationGate keeps its own STRONGER final checks executed
 *     at the exact Pay/commit moment (assignment, active, availability, stock,
 *     pricing, promotion). Those checks operate on the same facts with the
 *     same semantics, so the gate is a superset, not a second eligibility rule.
 *   - CatalogService exposes only presentation availability (is_available),
 *     not cart eligibility — intentional layering (menu vs commitment).
 *
 * Reported gaps — deliberately NOT invented here:
 *   - dine_in / reservation fulfillment capability has no schema
 *     representation (only delivery/pickup flags exist). This service does not
 *     enforce a capability flag for those order types and never substitutes a
 *     delivery/pickup flag for them.
 *   - Operating schedule / opening hours are not implemented (B1 gap); the
 *     only authoritative open/close fact is branches.is_open_override.
 *   - Unrecorded inventory (stock NULL) is treated as 0, matching the locked
 *     consumer semantics established in C1/C2 (CatalogService reports 0,
 *     InventoryStockService starts adjustments from 0, PrePaymentVerificationGate
 *     resolves NULL stock to 0).
 *
 * Result contract: deterministic `reasons` codes (one per blocking check,
 * evaluated in the fixed order below). Cross-brand / cross-organization inputs
 * fail closed with BRANCH_NOT_FOUND / PRODUCT_NOT_FOUND so existence is never
 * leaked across tenant boundaries.
 */
const db = require('../../../core/data/DataAccess');

// order types whose fulfillment capability IS represented in the schema
const CAPABILITY_REPRESENTED = { delivery: 'is_delivery_active', pickup: 'is_pickup_active' };
const KNOWN_ORDER_TYPES = new Set(['delivery', 'pickup', 'dine_in', 'reservation']);

class EligibilityService {
  static REASONS = {
    BRANCH_NOT_FOUND: 'BRANCH_NOT_FOUND',
    BRANCH_NOT_ACTIVE: 'BRANCH_NOT_ACTIVE',
    BRANCH_CLOSED: 'BRANCH_CLOSED',
    FULFILLMENT_NOT_SUPPORTED: 'FULFILLMENT_NOT_SUPPORTED',
    PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
    PRODUCT_INACTIVE: 'PRODUCT_INACTIVE',
    PRODUCT_NOT_ASSIGNED: 'PRODUCT_NOT_ASSIGNED',
    PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
    INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
    INVALID_QUANTITY: 'INVALID_QUANTITY',
    INVALID_CART: 'INVALID_CART'
  };

  static _resolveBranch({ brand_id, branch_id, order_type }) {
    const branch = db.prepare(`
      SELECT b.id, b.brand_id, b.name, b.is_active, b.is_open_override,
             s.is_delivery_active, s.is_pickup_active
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.id = ? AND b.brand_id = ?
    `).get(branch_id, brand_id);

    if (!branch) return { ok: false, reason: EligibilityService.REASONS.BRANCH_NOT_FOUND };
    if (branch.is_active !== 1) return { ok: false, reason: EligibilityService.REASONS.BRANCH_NOT_ACTIVE };
    if (branch.is_open_override !== 1) return { ok: false, reason: EligibilityService.REASONS.BRANCH_CLOSED };

    if (order_type) {
      if (CAPABILITY_REPRESENTED[order_type]) {
        const flagValue = branch[CAPABILITY_REPRESENTED[order_type]];
        if (flagValue !== 1) return { ok: false, reason: EligibilityService.REASONS.FULFILLMENT_NOT_SUPPORTED };
      } else if (!KNOWN_ORDER_TYPES.has(order_type)) {
        return { ok: false, reason: EligibilityService.REASONS.FULFILLMENT_NOT_SUPPORTED };
      }
    }

    return { ok: true, branch };
  }

  static evaluateBranch({ brand_id, branch_id, order_type = null }) {
    const gate = EligibilityService._resolveBranch({ brand_id, branch_id, order_type });
    return {
      eligible: gate.ok,
      reasons: gate.ok ? [] : [gate.reason],
      branch_id,
      brand_id,
      branch: gate.ok ? gate.branch : null
    };
  }

  static evaluateProduct({ brand_id, branch_id, product_id, quantity = 1, order_type = null }) {
    const qty = Number(quantity);

    if (!branch_id || !product_id) {
      return {
        eligible: false,
        reasons: [EligibilityService.REASONS.PRODUCT_NOT_FOUND],
        branch_id: branch_id || null,
        brand_id: brand_id || null,
        product_id: product_id || null,
        quantity: qty
      };
    }

    const branchGate = EligibilityService._resolveBranch({ brand_id, branch_id, order_type });
    if (!branchGate.ok) {
      return { eligible: false, reasons: [branchGate.reason], branch_id, brand_id, product_id, quantity: qty };
    }

    if (!Number.isInteger(qty) || qty <= 0) {
      return { eligible: false, reasons: [EligibilityService.REASONS.INVALID_QUANTITY], branch_id, brand_id, product_id, quantity: qty };
    }

    const product = db.prepare(
      'SELECT id, name, is_active FROM products WHERE id = ? AND brand_id = ?'
    ).get(product_id, brand_id);

    if (!product) {
      return { eligible: false, reasons: [EligibilityService.REASONS.PRODUCT_NOT_FOUND], branch_id, brand_id, product_id, quantity: qty };
    }
    if (product.is_active !== 1) {
      return { eligible: false, reasons: [EligibilityService.REASONS.PRODUCT_INACTIVE], branch_id, brand_id, product_id, quantity: qty };
    }

    const bp = db.prepare(
      'SELECT stock, is_available FROM branch_products WHERE branch_id = ? AND product_id = ?'
    ).get(branch_id, product_id);

    if (!bp) {
      return { eligible: false, reasons: [EligibilityService.REASONS.PRODUCT_NOT_ASSIGNED], branch_id, brand_id, product_id, quantity: qty };
    }
    if (bp.is_available !== 1) {
      return { eligible: false, reasons: [EligibilityService.REASONS.PRODUCT_UNAVAILABLE], branch_id, brand_id, product_id, quantity: qty };
    }

    const stock = bp.stock != null ? Number(bp.stock) : 0;
    if (stock < qty) {
      return { eligible: false, reasons: [EligibilityService.REASONS.INSUFFICIENT_STOCK], branch_id, brand_id, product_id, quantity: qty };
    }

    return { eligible: true, reasons: [], branch_id, brand_id, product_id, quantity: qty };
  }

  static evaluateCart({ brand_id, branch_id, items, order_type = null }) {
    if (!Array.isArray(items) || items.length === 0) {
      return { eligible: false, reasons: [EligibilityService.REASONS.INVALID_CART], branch_id: branch_id || null, brand_id: brand_id || null, items: [] };
    }

    const branchGate = EligibilityService._resolveBranch({ brand_id, branch_id, order_type });
    if (!branchGate.ok) {
      const reasons = [branchGate.reason];
      return {
        eligible: false,
        reasons,
        branch_id,
        brand_id,
        items: items.map((item) => ({
          product_id: item.product_id != null ? item.product_id : item.id,
          quantity: item.quantity != null ? Number(item.quantity) : Number(item.qty != null ? item.qty : 1),
          eligible: false,
          reasons
        }))
      };
    }

    const evaluatedItems = items.map((item) => {
      const productId = item.product_id != null ? item.product_id : item.id;
      const quantity = item.quantity != null ? Number(item.quantity) : Number(item.qty != null ? item.qty : 1);
      const single = EligibilityService.evaluateProduct({ brand_id, branch_id, product_id: productId, quantity, order_type });
      return { product_id: productId, quantity, eligible: single.eligible, reasons: single.reasons };
    });

    const eligible = evaluatedItems.every((it) => it.eligible);
    const reasons = [];
    if (!eligible) {
      for (const item of evaluatedItems) {
        if (!item.eligible) {
          for (const reason of item.reasons) {
            if (reason && !reasons.includes(reason)) reasons.push(reason);
          }
        }
      }
    }

    return { eligible, reasons, branch_id, brand_id, items: evaluatedItems };
  }
}

module.exports = EligibilityService;
