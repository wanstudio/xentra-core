'use strict';

const crypto = require('crypto');
const { events } = require('../../../core');
const { OrderRepository, PosBillRepository, OrderAdditionRepository } = require('../../../core/data/repositories');
const PrePaymentVerificationGate = require('./PrePaymentVerificationGate');
const OrderPlacementService = require('./OrderPlacementService');

const orderRepository = new OrderRepository();
const additionRepository = new OrderAdditionRepository();
const posBillRepository = new PosBillRepository();

const ALLOWED_PARENT_STATUSES = ['confirmed', 'preparing', 'ready'];

class OrderAdditionService {
  static _loadParent({ order_id, brand_id, branch_id, allowInactiveRead = false }) {
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[OrderAdditionService] Order tidak ditemukan.');
    if (String(order.brand_id) !== String(brand_id) || String(order.branch_id) !== String(branch_id)) {
      throw new Error('[OrderAdditionService] Order bukan milik cabang ini.');
    }
    if (order.order_type !== 'dine_in') {
      throw new Error('[OrderAdditionService] Additional Order hanya tersedia untuk Dine-in.');
    }
    if (!ALLOWED_PARENT_STATUSES.includes(order.status)) {
      if (!allowInactiveRead) {
        throw new Error('[OrderAdditionService] Order Dine-in sudah tidak menerima tambahan.');
      }
    }
    if (!order.dining_session_id) {
      throw new Error('[OrderAdditionService] Dining Session aktif tidak ditemukan.');
    }
    return order;
  }

  static _verifiedItems({ brand_id, branch_id, order, items }) {
    if (!Array.isArray(items) || !items.length) {
      throw new Error('[OrderAdditionService] Minimal satu item tambahan harus dipilih.');
    }

    const verification = PrePaymentVerificationGate.verify({
      branch_id,
      brand_id,
      items,
      customer: { name: order.customer_name || 'Tamu', phone: order.customer_phone || '' },
      is_pwa_installed: false
    });

    if (!verification.is_valid) {
      throw new Error((verification.errors || ['Item tambahan tidak dapat diverifikasi.']).join(' '));
    }
    return verification.verified_items || [];
  }

  static listForOrder({ order_id, brand_id, branch_id }) {
    const order = this._loadParent({ order_id, brand_id, branch_id, allowInactiveRead: true });
    const items = orderRepository.findItems(order_id);
    const additions = additionRepository.findByOrderId(order_id).map(addition => ({
      ...addition,
      items: JSON.parse(addition.items_payload || '[]')
    }));
    return { order, items, additions };
  }

  static async submit({ order_id, brand_id, branch_id, items, source_channel = 'pos_cashier', created_by = null, client_transaction_id = null }) {
    const order = this._loadParent({ order_id, brand_id, branch_id });
    const existing = additionRepository.findByClientTransactionId(order.id, client_transaction_id);
    if (existing) {
      return {
        success: true,
        idempotent: true,
        status: existing.status === 'pending_acceptance' ? 'PENDING_ACCEPTANCE' : existing.status,
        addition: existing,
        items: JSON.parse(existing.items_payload || '[]')
      };
    }

    const verifiedItems = this._verifiedItems({ brand_id, branch_id, order, items });
    const subtotal = verifiedItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const now = new Date().toISOString();
    const additionId = 'add_' + crypto.randomBytes(8).toString('hex');

    orderRepository.beginTransaction();
    try {
      const lockedOrder = this._loadParent({ order_id, brand_id, branch_id });
      const lockedExisting = additionRepository.findByClientTransactionId(lockedOrder.id, client_transaction_id);
      if (lockedExisting) {
        orderRepository.rollbackTransaction();
        return {
          success: true,
          idempotent: true,
          status: lockedExisting.status === 'pending_acceptance' ? 'PENDING_ACCEPTANCE' : lockedExisting.status,
          addition: lockedExisting,
          items: JSON.parse(lockedExisting.items_payload || '[]')
        };
      }

      const sequenceNo = additionRepository.nextSequence(lockedOrder.id);
      additionRepository.insertBatch({
        id: additionId,
        orderId: lockedOrder.id,
        branchId: lockedOrder.branch_id,
        diningSessionId: lockedOrder.dining_session_id,
        sequenceNo,
        sourceChannel: source_channel,
        createdBy: created_by,
        clientTransactionId: client_transaction_id,
        itemsPayload: JSON.stringify(verifiedItems),
        subtotal,
        createdAt: now,
        updatedAt: now
      });

      orderRepository.commitTransaction();
    } catch (err) {
      try { orderRepository.rollbackTransaction(); } catch (_) {}
      if (client_transaction_id && (String(err.message || '').includes('idx_order_addition_batches_client_tx') || String(err.message || '').includes('order_id, client_transaction_id'))) {
        const duplicate = additionRepository.findByClientTransactionId(order.id, client_transaction_id);
        if (duplicate) {
          return {
            success: true,
            idempotent: true,
            status: duplicate.status === 'pending_acceptance' ? 'PENDING_ACCEPTANCE' : duplicate.status,
            addition: duplicate,
            items: JSON.parse(duplicate.items_payload || '[]')
          };
        }
      }
      throw err;
    }

    await events.EventBus.publish({
      type: 'commerce.order.addition.created',
      producer: 'commerce',
      payload: { order_id: order.id, order_number: order.order_number, addition_id: additionId, sequence_no: additionRepository.findById(additionId).sequence_no, branch_id: order.branch_id, dining_session_id: order.dining_session_id, source_channel, items: verifiedItems, subtotal }
    }).catch(() => {});

    return { success: true, status: 'PENDING_ACCEPTANCE', addition: additionRepository.findById(additionId), items: verifiedItems };
  }

  static async decide({ order_id, addition_id, brand_id, branch_id, decision, actor_id = null, reason = '' }) {
    const order = this._loadParent({ order_id, brand_id, branch_id });
    const addition = additionRepository.findById(addition_id);
    if (!addition || String(addition.order_id) !== String(order.id)) {
      throw new Error('[OrderAdditionService] Additional Order tidak ditemukan.');
    }

    if (addition.status !== 'pending_acceptance') {
      return { success: true, idempotent: true, order_id: order.id, addition_id: addition.id, status: addition.status };
    }

    if (decision === 'reject') {
      const trimmedReason = String(reason || '').trim();
      if (!trimmedReason) throw new Error('[OrderAdditionService] Alasan penolakan tambahan wajib diisi untuk audit.');
      const now = new Date().toISOString();
      const result = additionRepository.markRejected({ id: addition.id, reason: trimmedReason, rejectedAt: now, updatedAt: now });
      if (!result || result.changes === 0) {
        const current = additionRepository.findById(addition.id);
        return { success: true, idempotent: true, order_id: order.id, addition_id: addition.id, status: current?.status || 'rejected' };
      }
      events.EventBus.publish({
        type: 'commerce.order.addition.rejected',
        producer: 'commerce',
        payload: { order_id: order.id, addition_id: addition.id, actor_id, reason: trimmedReason }
      }).catch(() => {});
      return { success: true, decision: 'reject', order_id: order.id, addition_id: addition.id, status: 'rejected' };
    }

    if (decision !== 'accept') throw new Error('[OrderAdditionService] Decision harus accept atau reject.');

    const rawItems = JSON.parse(addition.items_payload || '[]');
    const verifiedItems = this._verifiedItems({ brand_id, branch_id, order, items: rawItems });
    const additionSubtotal = verifiedItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const now = new Date().toISOString();

    orderRepository.beginTransaction();
    try {
      const lockedOrder = orderRepository.findById(order.id);
      const lockedAddition = additionRepository.findById(addition.id);

      if (!lockedOrder || !lockedAddition || lockedAddition.status !== 'pending_acceptance') {
        const current = additionRepository.findById(addition.id);
        orderRepository.rollbackTransaction();
        return { success: true, idempotent: true, order_id: order.id, addition_id: addition.id, status: current?.status || 'accepted' };
      }

      if (!ALLOWED_PARENT_STATUSES.includes(lockedOrder.status) || !lockedOrder.dining_session_id) {
        throw new Error('[OrderAdditionService] Order Dine-in sudah tidak dapat menerima tambahan.');
      }

      const insertedItems = [];
      for (const item of verifiedItems) {
        const itemId = 'item_' + crypto.randomBytes(6).toString('hex');
        const formattedNote = item.promo_id
          ? ('[PROMO:' + item.promo_id + '] ' + (item.notes || item.note || '')).trim()
          : (item.notes || item.note || '');
        orderRepository.insertItem({
          id: itemId,
          orderId: lockedOrder.id,
          productId: item.product_id,
          productName: item.name,
          unitPrice: item.unit_price,
          quantity: item.quantity,
          itemSubtotal: item.subtotal,
          note: formattedNote,
          modifiersSnapshot: JSON.stringify(item.modifiers_snapshot || item.options || []),
          additionBatchId: addition.id
        });
        insertedItems.push({
          id: itemId,
          product_id: item.product_id,
          product_name: item.name,
          unit_price: Number(item.unit_price || 0),
          quantity: Number(item.quantity || 0),
          item_subtotal: Number(item.subtotal || 0),
          note: formattedNote
        });
      }

      const newSubtotal = Number(lockedOrder.subtotal || 0) + additionSubtotal;
      const newGrandTotal = Math.max(0, newSubtotal + Number(lockedOrder.delivery_fee || 0) - Number(lockedOrder.discount_amount || 0));
      orderRepository.updateOrderFinancialSnapshot({ orderId: lockedOrder.id, subtotal: newSubtotal, grandTotal: newGrandTotal, updatedAt: now });

      OrderPlacementService.deductStockForItems({
        order_id: lockedOrder.id,
        items: verifiedItems,
        reference_id: lockedOrder.order_number + ':addition:' + addition.id,
        actor_id: actor_id || 'merchant_acceptance',
        notes: 'Pemotongan stok Additional Order [' + lockedOrder.order_number + ' / ' + addition.id + ']',
        dbTransactionProvided: true
      });

      const checks = posBillRepository.findChecks(lockedOrder.id);
      if (checks.length === 1) {
        const onlyCheck = checks[0];
        const paidAmount = posBillRepository.findCheckPaidAmount(onlyCheck.id);
        if (paidAmount <= 0 && onlyCheck.status === 'open') {
          posBillRepository.updateCheckAmount(onlyCheck.id, Number(onlyCheck.allocated_amount || 0) + additionSubtotal, now);
          for (const item of insertedItems) {
            posBillRepository.upsertCheckItem({ id: 'check_item_' + crypto.randomBytes(8).toString('hex'), checkId: onlyCheck.id, orderItemId: item.id, quantity: item.quantity, now });
          }
        } else {
          this._createAdditionCheck({ order_id: lockedOrder.id, additionSubtotal, insertedItems, checks, now });
        }
      } else if (checks.length > 1) {
        this._createAdditionCheck({ order_id: lockedOrder.id, additionSubtotal, insertedItems, checks, now });
      }

      const marked = additionRepository.markAccepted({ id: addition.id, acceptedAt: now, updatedAt: now });
      if (!marked || marked.changes === 0) {
        throw new Error('[OrderAdditionService] Additional Order gagal di-commit karena status berubah bersamaan.');
      }

      orderRepository.commitTransaction();

      await events.EventBus.publish({
        type: 'commerce.order.addition.accepted',
        producer: 'commerce',
        payload: {
          order_id: lockedOrder.id,
          order_number: lockedOrder.order_number,
          addition_id: addition.id,
          sequence_no: addition.sequence_no,
          branch_id: lockedOrder.branch_id,
          dining_session_id: lockedOrder.dining_session_id,
          actor_id,
          items: insertedItems,
          subtotal: additionSubtotal,
          new_grand_total: newGrandTotal
        }
      }).catch(() => {});

      return { success: true, decision: 'accept', order_id: lockedOrder.id, addition_id: addition.id, status: 'accepted', subtotal: additionSubtotal, order_grand_total: newGrandTotal, items: insertedItems };
    } catch (err) {
      try { orderRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }
  }

  static _createAdditionCheck({ order_id, additionSubtotal, insertedItems, checks, now }) {
    const nextNumber = checks.reduce((max, c) => Math.max(max, Number(c.check_number) || 0), 0) + 1;
    const checkId = 'check_' + crypto.randomBytes(8).toString('hex');
    posBillRepository.createCheck({ id: checkId, orderId: order_id, checkNumber: nextNumber, allocatedAmount: additionSubtotal, now });
    for (const item of insertedItems) {
      posBillRepository.upsertCheckItem({ id: 'check_item_' + crypto.randomBytes(8).toString('hex'), checkId, orderItemId: item.id, quantity: item.quantity, now });
    }
  }
}

module.exports = OrderAdditionService;
