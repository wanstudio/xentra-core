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

const posOperationalRepository = new PosOperationalRepository();
const inventoryRepository = new InventoryRepository();
const orderRepository = new OrderRepository();
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

    // Calculate subtotal
    let subtotal = 0;
    const verifiedItems = items.map(it => {
      const qty = Number(it.quantity) || 1;
      const price = Number(it.unit_price ?? it.expected_price ?? it.price ?? 0);
      const itemSub = qty * price;
      subtotal += itemSub;
      return {
        product_id: it.product_id,
        name: it.name || it.product_name || 'Item POS',
        unit_price: price,
        quantity: qty,
        subtotal: itemSub,
        note: it.note || it.notes || '',
        options: Array.isArray(it.options) ? it.options : []
      };
    });

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

      // 2. Insert items & deduct inventory
      for (const item of verifiedItems) {
        const itemId = `item_${crypto.randomBytes(6).toString('hex')}`;
        orderRepository.insertItem({
          id: itemId,
          orderId,
          productId: item.product_id,
          productName: item.name,
          unitPrice: item.unit_price,
          quantity: item.quantity,
          itemSubtotal: item.subtotal,
          note: item.note,
          modifiersSnapshot: JSON.stringify(item.options || [])
        });

        // Deduct local branch stock
        const bpBefore = inventoryRepository.findBranchProduct(branch_id, item.product_id);
        const prevStock = bpBefore ? Number(bpBefore.stock || 0) : 0;
        const deductResult = inventoryRepository.deductBranchProduct({
          quantity: item.quantity,
          branchId: branch_id,
          productId: item.product_id
        });

        if (!deductResult || deductResult.changes === 0) {
          throw new Error(`[INSUFFICIENT_LOCAL_STOCK] Stok lokal produk "${item.name}" tidak mencukupi untuk penjualan offline.`);
        }

        const currentStock = prevStock - item.quantity;
        inventoryRepository.insertSaleDeduction({
          id: `mov_${crypto.randomBytes(6).toString('hex')}`,
          branchId: branch_id,
          productId: item.product_id,
          quantity: item.quantity,
          previousStock: prevStock,
          currentStock,
          referenceId: orderNumber,
          actorId: terminal_id,
          notes: `Pemotongan stok offline lokal ${orderNumber} (${terminal_id})`,
          createdAt: now
        });
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
    const bp = inventoryRepository.findBranchProduct(branch_id, product_id);
    const stock = bp ? Number(bp.stock || 0) : 0;
    const threshold = custom_threshold != null ? Number(custom_threshold) : 5;

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
    product_id,
    is_available,
    actor_id = 'branch_manager'
  }) {
    this.assertTerminalAuthorized(terminal_id, branch_id);

    const clientTxId = `tx_avail_${crypto.randomBytes(8).toString('hex')}`;
    const queueId = `queue_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    const payload = {
      client_transaction_id: clientTxId,
      terminal_id,
      branch_id,
      product_id,
      is_available: is_available ? 1 : 0,
      actor_id,
      mutated_at: now
    };

    posOperationalRepository.beginTransaction();
    try {
      // Update local product availability
      inventoryRepository.db.execute(
        'UPDATE branch_products SET is_available = ?, updated_at = ? WHERE branch_id = ? AND product_id = ?',
        [is_available ? 1 : 0, now, branch_id, product_id]
      );

      // Enqueue sync operation
      posOperationalRepository.insertQueueEntry({
        id: queueId,
        terminalId: terminal_id,
        branchId: branch_id,
        clientTransactionId: clientTxId,
        operationType: 'product_availability',
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
      product_id,
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
          let hasStockDeficit = false;
          let deficitItem = null;
          let currentAvailableStock = 0;

          if (Array.isArray(payload.items)) {
            for (const it of payload.items) {
              const bp = inventoryRepository.findBranchProduct(branch_id, it.product_id);
              const available = bp ? Number(bp.stock || 0) : 0;
              const demanded = Number(it.quantity) || 1;
              if (available < demanded) {
                hasStockDeficit = true;
                deficitItem = it;
                currentAvailableStock = available;
                break;
              }
            }
          }

          if (hasStockDeficit && deficitItem) {
            const conflictId = `conf_${crypto.randomBytes(6).toString('hex')}`;
            posOperationalRepository.insertConflict({
              id: conflictId,
              branchId: branch_id,
              productId: deficitItem.product_id,
              terminalId: terminal_id,
              clientTransactionId: payload.client_transaction_id,
              posSaleReference: item.id,
              affectedOrderIds: [],
              posDemandQuantity: deficitItem.quantity || 1,
              onlineDemandQuantity: 0,
              availableStockAtReconciliation: currentAvailableStock
            });

            posOperationalRepository.updateQueueStatus({
              queueId: item.id,
              status: 'conflict',
              conflictId,
              lastError: `Konflik stok multi-channel: stok pusat (${currentAvailableStock}) tidak mencukupi permintaan offline POS (${deficitItem.quantity}).`
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
        } else if (item.operation_type === 'product_availability') {
          // Apply availability to server authoritative branch_products
          inventoryRepository.db.execute(
            'UPDATE branch_products SET is_available = ?, updated_at = ? WHERE branch_id = ? AND product_id = ?',
            [payload.is_available, new Date().toISOString(), branch_id, payload.product_id]
          );
          posOperationalRepository.updateQueueStatus({
            queueId: item.id,
            status: 'synced',
            syncedAt: new Date().toISOString()
          });
          syncedCount++;
          results.push({ queue_id: item.id, status: 'SYNCED' });
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
          const firstItem = payload.items?.[0] || {};
          const bp = inventoryRepository.findBranchProduct(branch_id, firstItem.product_id);
          const currentStock = bp ? Number(bp.stock || 0) : 0;

          // Record business conflict for Branch Manager review
          posOperationalRepository.insertConflict({
            id: conflictId,
            branchId: branch_id,
            productId: firstItem.product_id || '',
            terminalId: terminal_id,
            clientTransactionId: payload.client_transaction_id,
            posSaleReference: item.id,
            affectedOrderIds: [],
            posDemandQuantity: firstItem.quantity || 1,
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
