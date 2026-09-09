/**
 * Xentra POS Offline Reconciliation Service
 * 
 * Implements locked Notion specifications for POS Offline Continuity:
 * 1. Idempotency Key Deduplication: Ensures transactions with same client_transaction_id are processed exactly once.
 * 2. Authoritative Historical Cash Capture: Honored as immutable offline cash sales upon server sync.
 * 3. Batch Offline Sync: Ingests queue of transactions processed while cashier was disconnected.
 * 4. Disaster Recovery Reconciliation: Resolves cash variance & un-synced paper receipt trails when cashier device is lost/damaged.
 */
const crypto = require('crypto');
const { events } = require('../../../core');
const { OrderRepository, PosShiftRepository } = require('../../../core/data/repositories');
const { OrderPlacementService } = require('../../commerce');

const orderRepository = new OrderRepository();
const posShiftRepository = new PosShiftRepository();

class OfflineReconciliationService {
  static async reconcileOfflineTransaction({
    client_transaction_id,
    brand_id,
    branch_id,
    shift_id = null,
    order_type = 'dinein',
    payment_method = 'cash',
    amount_tendered = null,
    items = [],
    offline_created_at = null,
    customer = {}
  }) {
    if (!client_transaction_id || typeof client_transaction_id !== 'string' || client_transaction_id.trim().length < 8 || client_transaction_id.trim().length > 64) {
      throw new Error('[OfflineReconciliation] "client_transaction_id" tidak valid (wajib berupa string berkarakter 8-64).');
    }

    const existingOrder = orderRepository.findByBranchTransactionId(branch_id, client_transaction_id);

    if (existingOrder) {
      return {
        status: 'DUPLICATE_IGNORED',
        order: existingOrder,
        message: 'Transaksi offline sudah pernah disinkronkan sebelumnya (Idempotent Deduplicated).'
      };
    }

    const noteWithTxId = `POS Offline Sync [TX_ID:${client_transaction_id}] [DeviceTime:${offline_created_at || 'unknown'}]`;
    let placementResult;

    try {
      placementResult = await OrderPlacementService.submitOrder({
        brand_id,
        branch_id,
        customer: {
          name: customer.name || 'Pelanggan POS (Offline)',
          phone: customer.phone || ''
        },
        items,
        delivery_fee: 0,
        payment_method,
        order_channel: 'pos_cashier',
        order_type,
        table_number: customer.table_number || null,
        client_transaction_id,
        shift_id,
        notes: noteWithTxId,
        trace_context: {
          correlation_id: client_transaction_id,
          causation_id: `offline_sync_${Date.now()}`
        }
      });
    } catch (err) {
      if (err.message && (err.message.includes('idx_orders_branch_client_tx') || err.message.includes('UNIQUE constraint failed: orders.branch_id, orders.client_transaction_id'))) {
        const deduplicated = orderRepository.findByBranchTransactionId(branch_id, client_transaction_id);
        if (deduplicated) {
          return {
            status: 'DUPLICATE_IGNORED',
            order: deduplicated,
            message: 'Transaksi offline sudah pernah disinkronkan sebelumnya (Idempotent Deduplicated).'
          };
        }
      }
      throw err;
    }

    if (!placementResult.success) {
      return {
        status: 'ERROR',
        errors: placementResult.errors,
        message: 'Gagal menempatkan order offline ke database.'
      };
    }

    const order = placementResult.order;
    const grandTotal = order.grand_total;

    events.EventBus.publish({
      type: 'pos.offline.reconciled',
      producer: 'pos',
      payload: {
        order_id: order.id,
        client_transaction_id,
        branch_id,
        shift_id,
        grand_total: grandTotal,
        payment_method
      }
    }).catch(() => {});

    return {
      status: 'PROCESSED',
      order: {
        ...order,
        client_transaction_id,
        is_offline_sync: true
      }
    };
  }

  static async processBatchSync({ branch_id, transactions = [] }) {
    if (!Array.isArray(transactions)) {
      throw new Error('[OfflineReconciliation] "transactions" must be an array.');
    }

    const results = [];
    let processedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    for (const tx of transactions) {
      try {
        const res = await OfflineReconciliationService.reconcileOfflineTransaction({
          ...tx,
          branch_id
        });
        results.push(res);
        if (res.status === 'PROCESSED') processedCount++;
        else if (res.status === 'DUPLICATE_IGNORED') duplicateCount++;
        else failedCount++;
      } catch (err) {
        failedCount++;
        results.push({
          status: 'ERROR',
          client_transaction_id: tx.client_transaction_id,
          message: err.message
        });
      }
    }

    return {
      total: transactions.length,
      processed: processedCount,
      duplicates: duplicateCount,
      failed: failedCount,
      results
    };
  }

  static recordDisasterRecoveryReconciliation({
    shift_id,
    actual_physical_cash,
    paper_receipts_total,
    incident_notes = ''
  }) {
    const initialShift = posShiftRepository.findById(shift_id);
    if (!initialShift) {
      throw new Error('[OfflineReconciliation] Shift record not found for disaster recovery.');
    }
    if (initialShift.status !== 'open') {
      throw new Error('[OfflineReconciliation] Shift tidak ditemukan atau sudah ditutup.');
    }

    const physicalCash = Number(actual_physical_cash) || 0;
    const paperTotal = Number(paper_receipts_total) || 0;
    const now = new Date().toISOString();
    let disasterVariance = 0;
    let reconciledShift = null;

    posShiftRepository.beginTransaction();
    try {
      const currentShift = posShiftRepository.findById(shift_id);
      if (!currentShift || currentShift.status !== 'open') {
        throw new Error('[OfflineReconciliation] Shift tidak ditemukan atau sudah ditutup oleh proses lain.');
      }

      const systemExpected = Number(currentShift.expected_cash) || 0;
      disasterVariance = physicalCash - (systemExpected + paperTotal);

      const closeRes = posShiftRepository.closeDisasterRecovery({
        shiftId: shift_id,
        actualCash: physicalCash,
        variance: disasterVariance,
        closedAt: now
      });

      if (closeRes.changes !== 1) {
        throw new Error('[OfflineReconciliation] Gagal menutup shift: status shift telah berubah.');
      }

      reconciledShift = currentShift;
      posShiftRepository.commitTransaction();
    } catch (err) {
      try { posShiftRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    events.EventBus.publish({
      type: 'pos.disaster_recovery.reconciled',
      producer: 'pos',
      payload: {
        shift_id,
        branch_id: reconciledShift.branch_id,
        cashier_id: reconciledShift.cashier_id,
        physical_cash: physicalCash,
        paper_receipts_total: paperTotal,
        disaster_variance: disasterVariance,
        incident_notes,
        closed_at: now
      }
    }).catch(() => {});

    return {
      shift_id,
      branch_id: reconciledShift.branch_id,
      status: 'closed_via_disaster_recovery',
      actual_physical_cash: physicalCash,
      paper_receipts_total: paperTotal,
      variance: disasterVariance,
      incident_notes,
      closed_at: now
    };
  }
}

module.exports = OfflineReconciliationService;
