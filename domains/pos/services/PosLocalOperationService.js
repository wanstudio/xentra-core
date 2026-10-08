'use strict';

/**
 * POS Local Operation Service (Phase 1)
 *
 * Implements authoritative technical foundation for POS Local Operational Model:
 * 1. Device binding: 1 Branch = exactly 1 POS device.
 * 2. Atomic offline sales: Sale + items + local inventory deduction + sync queue insertion.
 * 3. Durable offline state: Survives restarts, reboots, and crashes.
 * 4. Sync queue outbox: PENDING -> SYNCING -> SYNCED / CONFLICT.
 * 5. Configuration version snapshot & divergence tracking.
 * 6. Payment boundary enforcement: Cash supported offline; external payment confirmation strictly prohibited.
 * 7. Multi-channel conflict surfacing: Records conflict when offline sales exceed central stock.
 */
const crypto = require('crypto');
const { events } = require('../../../core');
const {
  PosOperationalRepository,
  InventoryRepository,
  OrderRepository,
  PosShiftRepository
} = require('../../../core/data/repositories');
const OfflineReconciliationService = require('./OfflineReconciliationService');
const { InventorySalePostingService } = require('../../inventory');
const { CostOfSalesService } = require('../../costing');
const { ensureComposedMenuSchema } = require('../../catalog/schema/ComposedMenuSchema');

const posOperationalRepository = new PosOperationalRepository();
const inventoryRepository = new InventoryRepository();
const orderRepository = new OrderRepository();
function buildOfflineStockRequirements(items) {
  const requirements = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const menuId = item && item.menu_id ? String(item.menu_id).trim() : '';
    if (menuId) {
      const components = Array.isArray(item.component_snapshot) ? item.component_snapshot : [];
      for (const component of components) {
        const sku = component && component.sku != null ? String(component.sku).trim() : '';
        if (!sku) continue;
        const productId = String(component.product_id || '').trim();
        const componentQty = Number(component.quantity);
        const menuQty = Number(item.quantity);
        if (!productId || !Number.isSafeInteger(componentQty) || componentQty <= 0 || !Number.isSafeInteger(menuQty) || menuQty <= 0) continue;
        const required = menuQty * componentQty;
        const existing = requirements.get(productId);
        if (existing) existing.quantity += required;
        else requirements.set(productId, { product_id: productId, product_name: component.product_name || productId, quantity: required });
      }
      continue;
    }
    const productId = String(item && item.product_id || '').trim();
    const quantity = Number(item && item.quantity);
    if (!productId || !Number.isSafeInteger(quantity) || quantity <= 0) continue;
    const existing = requirements.get(productId);
    if (existing) existing.quantity += quantity;
    else requirements.set(productId, { product_id: productId, product_name: (item && (item.name || item.product_name)) || productId, quantity });
  }
  return Array.from(requirements.values());
}

function itemRequiresCanonicalInventory(items, canonicalRequirements) {
  if (canonicalRequirements.size > 0) {
    return Array.from(canonicalRequirements.values()).map(requirement => ({
      product_id: requirement.product_id,
      product_name: requirement.product_name,
      quantity: requirement.quantity
    }));
  }

  return (Array.isArray(items) ? items : [])
    .map(item => {
      const productId = String(item && item.product_id || '').trim();
      const product = productId
        ? inventoryRepository.findProductForValuation(productId)
        : null;
      const sku = product && product.sku != null ? String(product.sku).trim() : '';
      if (!productId || !sku) return null;
      return {
        product_id: productId,
        product_name: item.name || item.product_name || productId,
        quantity: Number(item.quantity),
        source_item_reference: item.id || productId
      };
    })
    .filter(Boolean);
}

function findFirstOfflineStockDeficit(branchId, items) {
  const requirements = buildOfflineStockRequirements(items);
  if (!requirements.length) return null;

  const rows = inventoryRepository.findProductStockStatesByBranch({
    branchId,
    productIds: requirements.map(item => item.product_id)
  });
  const rowMap = new Map(rows.map(row => [String(row.product_id), row]));

  for (const requirement of requirements) {
    const row = rowMap.get(String(requirement.product_id));
    const available = row
      ? Number(row.stock)
      : Number((inventoryRepository.findBranchProduct(branchId, requirement.product_id) || {}).stock || 0);
    if (available < requirement.quantity) return { requirement, available };
  }
  return null;
}

const posShiftRepository = new PosShiftRepository();

class PosLocalOperationService {
  /**
   * Registers / binds a POS terminal to a branch.
   * Locked Rule: 1 Branch = exactly 1 active POS device.
   */
  static registerTerminal({ branch_id, device_name, device_identifier, config_version = 1 }) {
    if (!branch_id || typeof branch_id !== 'string') {
      throw new Error('[PosLocalOperation] "branch_id" is required and must be a valid string.');
    }
    if (!device_name || !device_identifier) {
      throw new Error('[PosLocalOperation] "device_name" and "device_identifier" are required.');
    }

    const existingActive = posOperationalRepository.findActiveTerminalByBranch(branch_id);
    if (existingActive) {
      if (existingActive.device_identifier === device_identifier) {
        return existingActive;
      }
      throw new Error(`[PosLocalOperation] Branch "${branch_id}" already has an active POS terminal ("${existingActive.device_name}" / ID: ${existingActive.id}). Exactly 1 POS device per Branch is permitted.`);
    }

    const terminalId = `pos_term_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    posOperationalRepository.insertTerminal({
      id: terminalId,
      branchId: branch_id,
      deviceName: device_name,
      deviceIdentifier: device_identifier,
      configVersion: config_version,
      createdAt: now,
      updatedAt: now
    });

    events.EventBus.publish({
      type: 'pos.terminal.registered',
      producer: 'pos',
      payload: {
        terminal_id: terminalId,
        branch_id,
        device_name,
        device_identifier,
        config_version
      }
    }).catch(() => {});

    return posOperationalRepository.findTerminalById(terminalId);
  }

  /**
   * Retrieves active terminal for a branch.
   */
  static getActiveTerminal(branch_id) {
    return posOperationalRepository.findActiveTerminalByBranch(branch_id);
  }

  /**
   * Validates terminal authorization against a branch.
   */
  static assertTerminalAuthorized(terminal_id, branch_id) {
    const terminal = posOperationalRepository.findTerminalById(terminal_id);
    if (!terminal || terminal.status !== 'active') {
      throw new Error(`[PosLocalOperation] POS terminal "${terminal_id}" not found or deactivated.`);
    }
    if (terminal.branch_id !== branch_id) {
      throw new Error(`[PosLocalOperation] POS terminal "${terminal_id}" is bound to branch "${terminal.branch_id}", not authorized for branch "${branch_id}".`);
    }
    return terminal;
  }

  /**
   * Records a local operational offline sale atomically.
   * Invariant:
   * - Atomic transaction: local order + items + local inventory deduction + sync queue entry.
   * - Cash is supported operationally offline.
   * - Online / external gateway payment methods CANNOT be confirmed offline.
   */
  static recordOfflineSale({
    terminal_id,
    branch_id,
    brand_id,
    client_transaction_id,
    shift_id = null,
    items = [],
    payment_method = 'cash',
    amount_tendered = null,
    customer = {},
    order_type = 'dine_in',
    offline_created_at = null,
    config_version = null
  }) {
    if (!client_transaction_id || typeof client_transaction_id !== 'string' || client_transaction_id.trim().length < 8 || client_transaction_id.trim().length > 64) {
      throw new Error('[PosLocalOperation] "client_transaction_id" tidak valid (wajib berupa string berkarakter 8-64).');
    }
    if (!branch_id || !terminal_id) {
      throw new Error('[PosLocalOperation] "branch_id" and "terminal_id" are required.');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('[PosLocalOperation] "items" must be a non-empty array.');
    }

    // Payment boundary invariant (Rule 15):
    if (payment_method !== 'cash') {
      throw new Error(`[PosLocalOperation Payment Boundary] Metode pembayaran "${payment_method}" tidak dapat dikonfirmasi dalam mode offline. Hanya pembayaran fisik tunai (cash) yang didukung saat offline.`);
    }

    // Verify terminal binding
    const terminal = this.assertTerminalAuthorized(terminal_id, branch_id);

    // Check if client_transaction_id already exists in queue (Idempotent check)
    const existingQueue = posOperationalRepository.findQueueEntryByClientTxId(branch_id, client_transaction_id);
    if (existingQueue) {
      return {
        idempotent: true,
        status: 'DUPLICATE_IGNORED',
        queue_entry: existingQueue,
        message: 'Transaksi offline sudah tercatat di antrean sinkronisasi.'
      };
    }

    const now = offline_created_at || new Date().toISOString();
    const orderId = `ord_${crypto.randomBytes(6).toString('hex')}`;
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = `${Math.floor(1000 + Math.random() * 9000)}-${crypto.randomBytes(3).toString('hex')}`;
    const orderNumber = `POS-${today}-${randSuffix}`;

    // Offline POS operates from its locally cached canonical Menu snapshot.
    // It may not call the online resolver while disconnected, but the sale still
    // preserves Menu identity and fixed Product composition for later reconciliation.
    ensureComposedMenuSchema();

    const normalizedItems = items.map(it => {
      const qty = Number(it.quantity);
      if (!Number.isSafeInteger(qty) || qty <= 0) {
        throw new Error('[PosLocalOperation] Quantity POS offline harus berupa integer positif.');
      }

      const price = Number(it.unit_price ?? it.expected_price ?? it.price ?? 0);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error('[PosLocalOperation] Harga POS offline tidak valid.');
      }

      const menuId = it.menu_id ? String(it.menu_id).trim() : null;
      const menuType = menuId ? String(it.menu_type || '').trim().toUpperCase() : null;
      const componentSnapshot = Array.isArray(it.component_snapshot)
        ? it.component_snapshot
        : (Array.isArray(it.components) ? it.components : null);

      if (menuId) {
        if (!['SINGLE', 'PACKAGE'].includes(menuType)) {
          throw new Error('[PosLocalOperation] Canonical Menu offline memiliki menu_type tidak valid.');
        }
        if (!componentSnapshot || componentSnapshot.length === 0) {
          throw new Error('[PosLocalOperation] Canonical Menu offline wajib membawa component_snapshot.');
        }
        if (!it.menu_snapshot || typeof it.menu_snapshot !== 'object' || Array.isArray(it.menu_snapshot)) {
          throw new Error('[PosLocalOperation] Canonical Menu offline wajib membawa menu_snapshot immutable.');
        }

        let totalUnits = 0;
        for (const component of componentSnapshot) {
          const componentQty = Number(component && component.quantity);
          const productId = String(component && component.product_id || '').trim();
          if (!productId || !Number.isSafeInteger(componentQty) || componentQty <= 0) {
            throw new Error('[INVALID_MENU_COMPOSITION] Komponen Menu offline tidak valid.');
          }
          totalUnits += componentQty;
        }

        if (menuType === 'SINGLE' && (componentSnapshot.length !== 1 || Number(componentSnapshot[0].quantity) !== 1)) {
          throw new Error('[INVALID_MENU_COMPOSITION] Menu Satuan offline wajib memiliki tepat 1 Product x1.');
        }
        if (menuType === 'PACKAGE' && totalUnits < 2) {
          throw new Error('[INVALID_MENU_COMPOSITION] Menu Paket offline wajib memiliki minimal 2 unit Product.');
        }
      }

      return {
        product_id: menuId ? (menuType === 'SINGLE'
          ? (it.product_id || (componentSnapshot[0] && componentSnapshot[0].product_id) || null)
          : null) : it.product_id,
        menu_id: menuId,
        menu_type: menuId ? menuType : null,
        menu_snapshot: menuId ? it.menu_snapshot : null,
        component_snapshot: menuId ? componentSnapshot : null,
        name: it.name || it.product_name || it.title || 'Item POS',
        unit_price: price,
        quantity: qty,
        subtotal: qty * price,
        note: it.note || it.notes || '',
        options: Array.isArray(it.options) ? it.options : []
      };
    });

    const hasCanonical = normalizedItems.some(item => item.menu_id);
    const hasLegacy = normalizedItems.some(item => !item.menu_id);
    if (hasCanonical && hasLegacy) {
      throw new Error('[PosLocalOperation] Canonical Menu dan Product legacy tidak boleh dicampur dalam satu transaksi offline.');
    }

    const verifiedItems = normalizedItems;
    const subtotal = verifiedItems.reduce((sum, item) => sum + item.subtotal, 0);
    const grandTotal = subtotal;

    if (amount_tendered != null && Number(amount_tendered) < grandTotal) {
      throw new Error(`[PosLocalOperation] Uang tunai yang diterima (Rp ${Number(amount_tendered).toLocaleString('id-ID')}) kurang dari total tagihan (Rp ${grandTotal.toLocaleString('id-ID')}).`);
    }

    const queueId = `queue_${crypto.randomBytes(6).toString('hex')}`;
    const queuePayload = {
      client_transaction_id,
      terminal_id,
      brand_id,
      branch_id,
      shift_id,
      order_type,
      payment_method,
      amount_tendered: amount_tendered ? Number(amount_tendered) : grandTotal,
      items: verifiedItems,
      offline_created_at: now,
      config_version: config_version || terminal.config_version,
      customer
    };

    // ATOMIC TRANSACTION:
    // Insert order + items + deduct local stock + insert movement + insert sync queue
    posOperationalRepository.beginTransaction();
    try {
      // 1. Insert local order
      orderRepository.insertOrder({
        id: orderId,
        orderNumber,
        clientTransactionId: client_transaction_id,
        brandId: brand_id || '',
        branchId: branch_id,
        customerName: customer.name || 'Pelanggan POS (Offline)',
        customerPhone: customer.phone || '',
        orderType: order_type,
        orderChannel: 'pos_cashier',
        selectionMode: 'CUSTOMER_SELECTED',
        tableNumber: customer.table_number || null,
        fulfillmentScheduleType: 'asap',
        scheduledSlotStart: null,
        scheduledSlotEnd: null,
        subtotal,
        discountAmount: 0,
        deliveryFee: 0,
        grandTotal,
        paymentMethod: 'cash',
        status: 'confirmed', // Cash order locally confirmed
        orderNote: `POS Local Offline Sale [TX_ID:${client_transaction_id}] [Terminal:${terminal_id}]`,
        diningSessionId: null,
        createdAt: now,
        updatedAt: now
      });

      // 2. Insert items & deduct inventory.
      // Canonical Menu components are aggregated first so one Product shared by
      // several Menu lines is deducted exactly once for the total requirement.
      const canonicalRequirements = new Map();

      for (const item of verifiedItems) {
        const itemId = 'item_' + crypto.randomBytes(6).toString('hex');
        orderRepository.insertItem({
          id: itemId,
          orderId,
          productId: item.product_id,
          productName: item.name,
          unitPrice: item.unit_price,
          quantity: item.quantity,
          itemSubtotal: item.subtotal,
          note: item.note,
          modifiersSnapshot: JSON.stringify(item.options || []),
          menuSnapshot: item.menu_snapshot ? JSON.stringify(item.menu_snapshot) : null,
          menuId: item.menu_id || null,
          menuType: item.menu_type || null,
          componentSnapshot: item.component_snapshot ? JSON.stringify(item.component_snapshot) : null
        });

        if (item.menu_id) {
          for (const component of item.component_snapshot || []) {
            const componentQty = Number(component.quantity);
            if (!Number.isSafeInteger(componentQty) || componentQty <= 0) {
              throw new Error('[INVALID_MENU_COMPOSITION] Komponen Menu offline memiliki quantity tidak valid.');
            }

            const productId = String(component.product_id || '').trim();
            if (!productId) throw new Error('[INVALID_MENU_COMPOSITION] Product ID komponen Menu offline tidak ditemukan.');

            const sku = component.sku == null ? '' : String(component.sku).trim();
            if (!sku) continue;

            const required = item.quantity * componentQty;
            if (!canonicalRequirements.has(productId)) {
              canonicalRequirements.set(productId, {
                product_id: productId,
                product_name: component.product_name || productId,
                quantity: 0
              });
            }
            canonicalRequirements.get(productId).quantity += required;
          }
          continue;
        }

        const canonicalSaleRequirements = itemRequiresCanonicalInventory(verifiedItems, canonicalRequirements);

        let canonicalSalePosted = false;
        if (canonicalSaleRequirements.length > 0) {
          const canonicalSale = InventorySalePostingService.postCanonicalSale({
            branchId: branch_id,
            requirements: canonicalSaleRequirements,
            sourceType: 'ORDER',
            sourceReference: orderNumber,
            actorId: terminal_id,
            postingTimestamp: now,
            dbTransactionProvided: true
          });

          if (canonicalSale.status === 'AVAILABLE') {
            canonicalSalePosted = true;

            CostOfSalesService.capture({
              sourceType: 'ORDER',
              sourceReference: orderNumber,
              orderId,
              totalCost: canonicalSale.total_cost,
              currencyCode: canonicalSale.currency_code,
              costLines: canonicalSale.cost_lines
            });
          }
        }

        if (!canonicalSalePosted) {
          // Migration seam only: until the canonical Product Stock balance exists
          // for this branch/product set, preserve existing offline local stock.
          if (canonicalRequirements.size > 0) {
            for (const requirement of canonicalRequirements.values()) {
              const before = inventoryRepository.findBranchProduct(branch_id, requirement.product_id);
              const prevStock = before ? Number(before.stock || 0) : 0;
              const deductResult = inventoryRepository.deductBranchProduct({
                quantity: requirement.quantity,
                branchId: branch_id,
                productId: requirement.product_id
              });

              if (!deductResult || deductResult.changes === 0) {
                throw new Error('[INSUFFICIENT_LOCAL_STOCK] Stok lokal komponen ' + requirement.product_name + ' tidak mencukupi untuk penjualan offline (tersisa ' + prevStock + ', diminta ' + requirement.quantity + ').');
              }

              const currentStock = prevStock - requirement.quantity;
              inventoryRepository.insertSaleDeduction({
                id: 'mov_' + crypto.randomBytes(6).toString('hex'),
                branchId: branch_id,
                productId: requirement.product_id,
                quantity: requirement.quantity,
                previousStock: prevStock,
                currentStock,
                referenceId: orderNumber,
                actorId: terminal_id,
                notes: 'Pemotongan stok offline komponen Menu ' + orderNumber + ' (' + terminal_id + ')',
                createdAt: now
              });
            }
          } else {
            for (const item of verifiedItems) {
              const before = inventoryRepository.findBranchProduct(branch_id, item.product_id);
              const prevStock = before ? Number(before.stock || 0) : 0;
              const deductResult = inventoryRepository.deductBranchProduct({
                quantity: item.quantity,
                branchId: branch_id,
                productId: item.product_id
              });

              if (!deductResult || deductResult.changes === 0) {
                throw new Error('[INSUFFICIENT_LOCAL_STOCK] Stok lokal produk ' + item.name + ' tidak mencukupi untuk penjualan offline.');
              }

              const currentStock = prevStock - item.quantity;
              inventoryRepository.insertSaleDeduction({
                id: 'mov_' + crypto.randomBytes(6).toString('hex'),
                branchId: branch_id,
                productId: item.product_id,
                quantity: item.quantity,
                previousStock: prevStock,
                currentStock,
                referenceId: orderNumber,
                actorId: terminal_id,
                notes: 'Pemotongan stok offline lokal ' + orderNumber + ' (' + terminal_id + ')',
                createdAt: now
              });
            }
          }
        }

      // 3. Shift cash effect (if shift_id provided)
      if (shift_id) {
        const shiftRes = posShiftRepository.incrementCashSales({
          shiftId: shift_id,
          branchId: branch_id,
          amount: grandTotal
        });
        if (!shiftRes || shiftRes.changes !== 1) {
          throw new Error(`[SHIFT_UPDATE_FAILED] POS shift "${shift_id}" tidak ditemukan, bukan milik cabang "${branch_id}", atau sudah ditutup.`);
        }
      }

      // 4. Ensure payment record
      orderRepository.ensurePendingPayment({
        paymentId: `pay_${crypto.randomBytes(6).toString('hex')}`,
        orderId,
        provider: 'cash',
        paymentMethod: 'cash',
        merchantId: 'cash',
        amount: grandTotal,
        createdAt: now,
        updatedAt: now
      });

      // 5. Insert into durable sync queue outbox
      posOperationalRepository.insertQueueEntry({
        id: queueId,
        terminalId: terminal_id,
        branchId: branch_id,
        clientTransactionId: client_transaction_id,
        operationType: 'sale',
        payload: queuePayload,
        status: 'pending',
        createdAt: now
      });

      posOperationalRepository.commitTransaction();
    } catch (err) {
      try { posOperationalRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    events.EventBus.publish({
      type: 'pos.offline.sale_recorded',
      producer: 'pos',
      payload: {
        order_id: orderId,
        order_number: orderNumber,
        client_transaction_id,
        terminal_id,
        branch_id,
        grand_total: grandTotal,
        queue_id: queueId
      }
    }).catch(() => {});

    return {
      success: true,
      status: 'COMMITTED_LOCALLY',
      order: {
        id: orderId,
        order_number: orderNumber,
        client_transaction_id,
        grand_total: grandTotal,
        branch_id,
        status: 'confirmed'
      },
      queue_entry: {
        id: queueId,
        status: 'pending',
        client_transaction_id
      }
    };
  }

  /**
   * Evaluates local stock against configured low-stock threshold.
   * Locked Rule 4 & 5: Alert only, does NOT automatically mutate stock or disable product.
   */
  static evaluateLocalStock({ branch_id, product_id, custom_threshold = null }) {
    const rows = inventoryRepository.findProductStockStatesByBranch({
      branchId: branch_id,
      productIds: [product_id]
    });
    const state = rows[0] || null;
    const stock = state
      ? Number(state.stock)
      : Number((inventoryRepository.findBranchProduct(branch_id, product_id) || {}).stock || 0);
    const threshold = custom_threshold != null
      ? Number(custom_threshold)
      : (state && state.low_stock_threshold != null ? Number(state.low_stock_threshold) : 5);

    const isLow = stock <= threshold && stock > 0;
    const isOutOfStock = stock <= 0;

    return {
      branch_id,
      product_id,
      stock,
      threshold,
      is_low: isLow,
      is_out_of_stock: isOutOfStock,
      requires_attention: isLow || isOutOfStock
    };
  }

  /**
   * Records a local product availability mutation (e.g. temporary disable by manager while offline).
   * Locked Rule 5: Mutates local availability and queues for sync to Core.
   */
  static mutateProductAvailabilityOffline({
    terminal_id,
    branch_id,
    product_id = null,
    menu_id = null,
    is_available,
    actor_id = 'branch_manager'
  }) {
    this.assertTerminalAuthorized(terminal_id, branch_id);

    const clientTxId = `tx_avail_${crypto.randomBytes(8).toString('hex')}`;
    const queueId = `queue_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    const canonicalMenu = Boolean(menu_id);
    const payload = {
      client_transaction_id: clientTxId,
      terminal_id,
      branch_id,
      product_id: canonicalMenu ? null : product_id,
      menu_id: canonicalMenu ? String(menu_id) : null,
      is_available: is_available ? 1 : 0,
      actor_id,
      mutated_at: now
    };

    posOperationalRepository.beginTransaction();
    try {
      // Canonical offline availability belongs to Branch Menu.
      // Legacy Product availability remains as a compatibility path.
      if (canonicalMenu) {
        const updateResult = inventoryRepository.db.execute(
          'UPDATE branch_menus SET is_available = ?, updated_at = ? WHERE branch_id = ? AND menu_id = ?',
          [is_available ? 1 : 0, now, branch_id, String(menu_id)]
        );
        if (!updateResult || updateResult.changes !== 1) {
          throw new Error('BRANCH_MENU_NOT_FOUND');
        }
      } else {
        const updateResult = inventoryRepository.db.execute(
          'UPDATE branch_products SET is_available = ?, updated_at = ? WHERE branch_id = ? AND product_id = ?',
          [is_available ? 1 : 0, now, branch_id, product_id]
        );
        if (!updateResult || updateResult.changes !== 1) {
          throw new Error('LEGACY_PRODUCT_AVAILABILITY_TARGET_NOT_FOUND');
        }
      }

      // Enqueue sync operation
      posOperationalRepository.insertQueueEntry({
        id: queueId,
        terminalId: terminal_id,
        branchId: branch_id,
        clientTransactionId: clientTxId,
        operationType: canonicalMenu ? 'menu_availability' : 'product_availability',
        payload,
        status: 'pending',
        createdAt: now
      });

      posOperationalRepository.commitTransaction();
    } catch (err) {
      try { posOperationalRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return {
      success: true,
      branch_id,
      product_id: canonicalMenu ? null : product_id,
      menu_id: canonicalMenu ? String(menu_id) : null,
      is_available: is_available ? 1 : 0,
      queue_id: queueId
    };
  }

  /**
   * Synchronizes pending outbox queue with Core reconciliation.
   * Handles idempotency, conflict detection, and queue lifecycle:
   * PENDING -> SYNCING -> SYNCED / CONFLICT / FAILED
   */
  static async syncOutboxQueue({ terminal_id, branch_id }) {
    this.assertTerminalAuthorized(terminal_id, branch_id);

    const pending = posOperationalRepository.findPendingQueueEntries(terminal_id);
    const results = [];
    let syncedCount = 0;
    let conflictCount = 0;
    let failedCount = 0;

    for (const item of pending) {
      // Mark SYNCING
      posOperationalRepository.updateQueueStatus({
        queueId: item.id,
        status: 'syncing'
      });

      const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;

      try {
        if (item.operation_type === 'sale') {
          // Check for cross-channel inventory conflict:
          // In a shared branch inventory pool, if online orders depleted the stock while POS was offline,
          // the central branch product stock cannot fulfill the offline sale.
          // According to contract: DO NOT silently prioritize. Surface conflict to Branch Manager.
          const stockDeficit = findFirstOfflineStockDeficit(branch_id, payload.items);
          if (stockDeficit) {
            const conflictId = 'conf_' + crypto.randomBytes(6).toString('hex');
            const requirement = stockDeficit.requirement;

            posOperationalRepository.insertConflict({
              id: conflictId,
              branchId: branch_id,
              productId: requirement.product_id,
              terminalId: terminal_id,
              clientTransactionId: payload.client_transaction_id,
              posSaleReference: item.id,
              affectedOrderIds: [],
              posDemandQuantity: requirement.quantity,
              onlineDemandQuantity: 0,
              availableStockAtReconciliation: stockDeficit.available
            });

            posOperationalRepository.updateQueueStatus({
              queueId: item.id,
              status: 'conflict',
              conflictId,
              lastError: 'Konflik stok multi-channel: stok pusat (' +
                stockDeficit.available +
                ') tidak mencukupi permintaan offline POS (' +
                requirement.quantity +
                ') untuk ' +
                requirement.product_name +
                '.'
            });

            conflictCount++;
            results.push({
              queue_id: item.id,
              status: 'CONFLICT',
              conflict_id: conflictId,
              message: 'Stok tidak mencukupi di cabang pusat karena pesanan multi-channel.'
            });
            continue;
          }

          // If no deficit, proceed with standard reconciliation
          const reconResult = await OfflineReconciliationService.reconcileOfflineTransaction({
            ...payload,
            branch_id
          });

          if (reconResult.status === 'PROCESSED' || reconResult.status === 'DUPLICATE_IGNORED') {
            const serverOrderId = reconResult.order?.id;
            posOperationalRepository.updateQueueStatus({
              queueId: item.id,
              status: 'synced',
              reconciledReferenceId: serverOrderId,
              syncedAt: new Date().toISOString()
            });
            syncedCount++;
            results.push({ queue_id: item.id, status: 'SYNCED', result: reconResult });
          } else {
            // Error from placement
            posOperationalRepository.incrementQueueRetry({
              queueId: item.id,
              lastError: reconResult.message || 'Placement error'
            });
            failedCount++;
            results.push({ queue_id: item.id, status: 'FAILED', result: reconResult });
          }
        } else if (item.operation_type === 'menu_availability') {
          const updateResult = inventoryRepository.db.execute(
            'UPDATE branch_menus SET is_available = ?, updated_at = ? WHERE branch_id = ? AND menu_id = ?',
            [payload.is_available, new Date().toISOString(), branch_id, payload.menu_id]
          );
          if (!updateResult || updateResult.changes !== 1) {
            throw new Error('BRANCH_MENU_NOT_FOUND');
          }
          posOperationalRepository.updateQueueStatus({
            queueId: item.id,
            status: 'synced',
            syncedAt: new Date().toISOString()
          });
          syncedCount++;
          results.push({ queue_id: item.id, status: 'SYNCED', operation: 'menu_availability' });
        } else if (item.operation_type === 'product_availability') {
          // Legacy compatibility operation only. New POS availability uses Branch Menu.
          const updateResult = inventoryRepository.db.execute(
            'UPDATE branch_products SET is_available = ?, updated_at = ? WHERE branch_id = ? AND product_id = ?',
            [payload.is_available, new Date().toISOString(), branch_id, payload.product_id]
          );
          if (!updateResult || updateResult.changes !== 1) {
            throw new Error('LEGACY_PRODUCT_AVAILABILITY_TARGET_NOT_FOUND');
          }
          posOperationalRepository.updateQueueStatus({
            queueId: item.id,
            status: 'synced',
            syncedAt: new Date().toISOString()
          });
          syncedCount++;
          results.push({ queue_id: item.id, status: 'SYNCED', operation: 'product_availability' });
        }
      } catch (err) {
        // Detect cross-channel inventory conflict
        const isStockConflict = err.message && (
          err.message.includes('CONCURRENCY_RACE') ||
          err.message.includes('Stok untuk produk') ||
          err.message.includes('tidak mencukupi') ||
          err.message.includes('NEGATIVE_STOCK_REJECTED')
        );

        if (isStockConflict) {
          const conflictId = `conf_${crypto.randomBytes(6).toString('hex')}`;
          const stockDeficit = findFirstOfflineStockDeficit(branch_id, payload.items);
          const requirement = stockDeficit
            ? stockDeficit.requirement
            : (buildOfflineStockRequirements(payload.items)[0] || {
              product_id: '',
              product_name: 'Item POS',
              quantity: 1
            });
          const currentStock = stockDeficit ? stockDeficit.available : 0;

          // Record business conflict for Branch Manager review
          posOperationalRepository.insertConflict({
            id: conflictId,
            branchId: branch_id,
            productId: requirement.product_id,
            terminalId: terminal_id,
            clientTransactionId: payload.client_transaction_id,
            posSaleReference: item.id,
            affectedOrderIds: [],
            posDemandQuantity: requirement.quantity,
            onlineDemandQuantity: 0,
            availableStockAtReconciliation: currentStock
          });

          posOperationalRepository.updateQueueStatus({
            queueId: item.id,
            status: 'conflict',
            conflictId,
            lastError: `Stok tidak mencukupi saat rekonsiliasi: ${err.message}`
          });

          conflictCount++;
          results.push({ queue_id: item.id, status: 'CONFLICT', conflict_id: conflictId, error: err.message });
        } else {
          posOperationalRepository.incrementQueueRetry({
            queueId: item.id,
            lastError: err.message
          });
          failedCount++;
          results.push({ queue_id: item.id, status: 'FAILED', error: err.message });
        }
      }
    }

    // Update terminal last_sync_at
    posOperationalRepository.updateTerminalLastSync({
      terminalId: terminal_id,
      lastSyncAt: new Date().toISOString()
    });

    return {
      total: pending.length,
      synced: syncedCount,
      conflicts: conflictCount,
      failed: failedCount,
      results
    };
  }

  /**
   * Surface and resolve inventory conflict by authorized Branch Manager.
   * Locked Rule 9, 10, 11: Manager makes business decision; records business log; never rewrites history.
   */
  static resolveInventoryConflict({
    conflict_id,
    resolution_decision,
    resolved_by,
    reason = null
  }) {
    if (!conflict_id || !resolution_decision || !resolved_by) {
      throw new Error('[PosLocalOperation] "conflict_id", "resolution_decision", and "resolved_by" are required.');
    }

    const conflict = posOperationalRepository.findConflictById(conflict_id);
    if (!conflict) {
      throw new Error(`[PosLocalOperation] Conflict record "${conflict_id}" not found.`);
    }
    if (conflict.status === 'resolved') {
      throw new Error(`[PosLocalOperation] Conflict "${conflict_id}" has already been resolved.`);
    }

    const validDecisions = ['prioritize_pos', 'prioritize_online', 'manual_adjustment'];
    if (!validDecisions.includes(resolution_decision)) {
      throw new Error(`[PosLocalOperation] Invalid resolution decision "${resolution_decision}". Allowed: ${validDecisions.join(', ')}.`);
    }

    const now = new Date().toISOString();
    posOperationalRepository.resolveConflict({
      conflictId: conflict_id,
      resolutionDecision: resolution_decision,
      resolvedBy: resolved_by,
      resolutionReason: reason,
      resolvedAt: now
    });

    // Business log & event emission
    events.EventBus.publish({
      type: 'pos.inventory_conflict.resolved',
      producer: 'pos',
      payload: {
        conflict_id,
        branch_id: conflict.branch_id,
        product_id: conflict.product_id,
        resolution_decision,
        resolved_by,
        reason,
        resolved_at: now
      }
    }).catch(() => {});

    return posOperationalRepository.findConflictById(conflict_id);
  }
}

module.exports = PosLocalOperationService;
