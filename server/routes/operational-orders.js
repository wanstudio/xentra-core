/**
 * XENTRA CORE — OPERATIONAL ORDER ROUTES
 *
 * Kitchen queue, operational status transitions and branch acceptance.
 * These routes own HTTP authorization; lifecycle invariants remain in Core
 * services/state machines.
 */
'use strict';

module.exports = function registerOperationalOrderRoutes(router, deps) {
  const {
    db,
    requireAuth,
    OrderStateMachine,
    AcceptanceTimeoutService
  } = deps;

  const { OrderAdditionService } = require('../../domains/commerce/services/OrderAdditionService');

// Kitchen Display Queue (Strictly Tenant-Scoped & Branch-Scoped for Operator Roles)
router.get('/kitchen/queue', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  // If user is a branch-level operator, strictly enforce their assigned branch
  const effectiveBranchId = (['branch_manager', 'cashier', 'kitchen'].includes(req.user.role) && req.user.branchId)
    ? req.user.branchId
    : req.query.branch_id;

  let sql = `
    SELECT o.*, b.name as branch_name, b.brand_id
    FROM orders o
    JOIN branches b ON b.id = o.branch_id
    WHERE b.brand_id = ? AND o.status IN ('confirmed', 'preparing', 'ready')
  `;
  const params = [req.brand_id];

  if (effectiveBranchId) {
    sql += ' AND o.branch_id = ?';
    params.push(effectiveBranchId);
  }

  sql += ' ORDER BY o.created_at ASC';

  const orders = db.prepare(sql).all(...params);

  const enriched = orders.map((ord) => ({
    ...ord,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
    delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id)
  }));

  res.json({ success: true, orders: enriched });
});

// 9. Update Order Status (Kitchen / Operator with Auth Binding, Branch Guard & Role-Based Status Transitions)
router.patch('/kitchen/orders/:id/status', requireAuth(['owner', 'brand_manager', 'branch_manager', 'kitchen']), (req, res) => {
  try {
    const { status, note = '' } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: 'Status target wajib diisi.' });
    }

    // P1 ROLE-BASED TRANSITION AUTHORITY (FINDING-02A)
    // Kitchen role can ONLY advance operational cooking stages ('preparing', 'ready').
    // Manager/Owner can advance the operational fulfillment lifecycle
    // ('preparing' → 'ready' → 'out_for_delivery' → 'completed').
    // R5 BOUNDARY (CHECK-1/CHECK-4): ACCEPT ('confirmed') is EXCLUSIVELY served
    // by POST /orders/:id/branch-acceptance (branch_manager | brand_manager |
    // owner, audited [ACCEPT by <actor>], idempotent); this generic PATCH must
    // NOT offer 'confirmed' — payment/kitchen/generic flows must never silently
    // become Branch operational acceptance. 'cancelled' is likewise removed:
    // after ACCEPT, cancellation is NOT a generic normal operation — it is a
    // Branch Exception / recovery path (R8, later task) or payment-driven
    // failure. Customer cancellation is served by POST /orders/:id/cancel
    // (pending only). Financial/Refund state is EXCLUSIVELY handled via a
    // dedicated recovery flow.
    const ROLE_ALLOWED_TARGET_STATUSES = {
      kitchen: ['preparing', 'ready'],
      branch_manager: ['preparing', 'ready', 'out_for_delivery', 'completed'],
      brand_manager: ['preparing', 'ready', 'out_for_delivery', 'completed'],
      owner: ['preparing', 'ready', 'out_for_delivery', 'completed']
    };

    const allowedTargetStatuses = ROLE_ALLOWED_TARGET_STATUSES[req.user.role] || [];
    if (!allowedTargetStatuses.includes(status)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_ROLE_AUTHORITY',
        message: `Role "${req.user.role}" tidak memiliki wewenang untuk mengubah status pesanan menjadi "${status}".`
      });
    }

    // P1 AUTH BINDING: Use authoritative actor identity from authenticated session
    const actor_type = req.user.role === 'kitchen' ? 'kitchen' : 'staff';
    const actor_id = req.user.userId || req.user.username;

    // Verify order exists and belongs to current brand before transition
    let verifySql = `
      SELECT o.id, o.branch_id, b.brand_id 
      FROM orders o
      JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND b.brand_id = ?
    `;
    const verifyParams = [req.params.id, req.brand_id];

    // If branch operator, ensure order belongs to their assigned branch
    if (['branch_manager', 'cashier', 'kitchen'].includes(req.user.role) && req.user.branchId) {
      verifySql += ' AND o.branch_id = ?';
      verifyParams.push(req.user.branchId);
    }

    const existingOrder = db.prepare(verifySql).get(...verifyParams);

    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada kewenangan cabang Anda.' });
    }

    // ROLE CONTRACT (docs/ORDER_LIFECYCLE_AND_ROLE_CONTRACT.md):
    // - Delivery with an assigned registered driver: only the Driver App may
    //   execute ready -> out_for_delivery -> completed.
    // - Pickup: handover (ready -> completed) requires payment settled at POS.
    // - Dine-in unpaid: serving does not complete the order; POS settlement /
    //   table release completes it.
    const guardOrder = db.prepare('SELECT order_type, status, grand_total FROM orders WHERE id = ?').get(req.params.id);
    if (guardOrder) {
      if (guardOrder.order_type === 'delivery' && ['out_for_delivery', 'completed'].includes(status)) {
        const dlvGuard = db.prepare('SELECT driver_id FROM order_deliveries WHERE order_id = ?').get(req.params.id);
        if (dlvGuard && dlvGuard.driver_id) {
          return res.status(403).json({
            success: false,
            error: 'DRIVER_APP_ONLY',
            message: 'Untuk pesanan Delivery, pengambilan dan penyelesaian pengantaran hanya dieksekusi oleh Kurir melalui Driver App.'
          });
        }
      }
      if (['pickup', 'dine_in'].includes(guardOrder.order_type) && status === 'completed' && guardOrder.status === 'ready') {
        const paidRow = db.prepare(`SELECT MAX(
            COALESCE((SELECT MAX(amount) FROM order_payments WHERE order_id = ? AND payment_status = 'settlement'), 0),
            COALESCE((SELECT SUM(amount) FROM pos_check_payments WHERE order_id = ? AND payment_status = 'settlement'), 0)
          ) AS paid`).get(req.params.id, req.params.id);
        const hasPaymentRow = db.prepare('SELECT 1 FROM order_payments WHERE order_id = ?').get(req.params.id);
        const unpaid = hasPaymentRow && Number(guardOrder.grand_total || 0) > 0 && Number(paidRow.paid || 0) + 0.000001 < Number(guardOrder.grand_total || 0);
        if (unpaid) {
          if (guardOrder.order_type === 'pickup') {
            return res.status(400).json({ success: false, error: 'PAYMENT_REQUIRED', message: 'Pesanan Takeaway belum dibayar lunas di Kasir POS.' });
          }
          // Dine-in: record served, keep status 'ready' until POS settles.
          const crypto = require('crypto');
          db.prepare(`INSERT INTO order_status_logs (id, order_id, previous_status, new_status, actor_type, actor_id, note) VALUES (?, ?, 'ready', 'ready', ?, ?, ?)`)
            .run('log_' + crypto.randomBytes(8).toString('hex'), req.params.id, actor_type, actor_id, '[SERVED_TO_TABLE] Disajikan ke meja — menunggu pembayaran di Kasir POS.');
          return res.json({ success: true, served: true, previous_status: 'ready', new_status: 'ready', message: 'Disajikan ke meja. Pesanan selesai otomatis setelah dibayar di Kasir POS.' });
        }
      }
    }

    const result = OrderStateMachine.transition({
      order_id: req.params.id,
      target_status: status,
      actor_type,
      actor_id,
      note
    });

    if (status === 'ready') {
      try {
        const fullOrd = db.prepare('SELECT order_type, branch_id FROM orders WHERE id = ?').get(req.params.id);
        if (fullOrd && fullOrd.order_type === 'delivery') {
          const dlv = db.prepare('SELECT status, driver_id FROM order_deliveries WHERE order_id = ?').get(req.params.id);
          if (!dlv || dlv.status === 'unassigned' || !dlv.driver_id) {
            const { DeliveryDispatchService } = require('../../domains/delivery');
            DeliveryDispatchService.autoAssign({ order_id: req.params.id, branch_id: fullOrd.branch_id });
          }
        }
      } catch (autoAssignErr) {
        console.warn('[AutoAssign on Ready Warning]:', autoAssignErr.message);
      }
    }

    if (status === 'out_for_delivery') {
      try {
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE order_deliveries
          SET status = 'on_delivery', updated_at = ?
          WHERE order_id = ? AND status IN ('unassigned', 'assigned', 'picked_up')
        `).run(now, req.params.id);

        const dlvRow = db.prepare('SELECT driver_id FROM order_deliveries WHERE order_id = ?').get(req.params.id);
        if (dlvRow && dlvRow.driver_id) {
          db.prepare(`
            UPDATE driver_locations
            SET active_order_id = ?, updated_at = datetime('now')
            WHERE driver_id = ?
          `).run(req.params.id, dlvRow.driver_id);
        }
      } catch (outSyncErr) {
        console.warn('[Delivery Sync On Out For Delivery Warning]:', outSyncErr.message);
      }
    }

    if (status === 'completed') {
      try {
        const now = new Date().toISOString();
        const ordRow = db.prepare('SELECT order_type, payment_method, grand_total FROM orders WHERE id = ?').get(req.params.id);
        if (ordRow && ordRow.order_type === 'delivery') {
          const dlv = db.prepare('SELECT id, status, cod_collection_status FROM order_deliveries WHERE order_id = ?').get(req.params.id);
          if (dlv && dlv.status !== 'delivered') {
            if (ordRow.payment_method === 'cash') {
              db.prepare(`
                UPDATE order_deliveries
                SET status = 'delivered',
                    cod_collection_status = COALESCE(cod_collection_status, 'collected'),
                    cod_cash_custody = COALESCE(cod_cash_custody, 'driver'),
                    cod_collected_amount = COALESCE(cod_collected_amount, ?),
                    updated_at = ?
                WHERE order_id = ?
              `).run(ordRow.grand_total, now, req.params.id);
            } else {
              db.prepare(`
                UPDATE order_deliveries
                SET status = 'delivered', updated_at = ?
                WHERE order_id = ?
              `).run(now, req.params.id);
            }
          }
        }
        try {
          db.prepare("UPDATE driver_locations SET active_order_id = NULL WHERE active_order_id = ?").run(req.params.id);
        } catch (_) {}
      } catch (delivSyncErr) {
        console.warn('[Delivery Sync On Complete Warning]:', delivSyncErr.message);
      }
    }

    if (status === 'cancelled') {
      try {
        const now = new Date().toISOString();
        db.prepare("UPDATE order_deliveries SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status != 'delivered'").run(now, req.params.id);
        db.prepare("UPDATE driver_locations SET active_order_id = NULL WHERE active_order_id = ?").run(req.params.id);
        db.prepare("UPDATE pos_held_orders SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'held'").run(now, req.params.id);

        const ordRow = db.prepare('SELECT branch_id, order_type, dining_session_id FROM orders WHERE id = ?').get(req.params.id);
        if (ordRow) {
          const { DiningTableService } = require('../../domains/dining');
          try {
            DiningTableService.releaseHold({
              branch_id: ordRow.branch_id,
              hold_reference_id: req.params.id,
              reason: 'cancelled'
            });
          } catch (relErr) {
            db.prepare("UPDATE branch_table_holds SET status = 'cancelled', updated_at = ? WHERE hold_reference_id = ? AND status = 'active'").run(now, req.params.id);
          }
          if (ordRow.dining_session_id) {
            try {
              DiningTableService.completeDiningSession(ordRow.dining_session_id, actor_id);
            } catch (_) {
              db.prepare("UPDATE dining_sessions SET status = 'completed', closed_at = ?, updated_at = ? WHERE id = ?").run(now, now, ordRow.dining_session_id);
            }
          }
        }
      } catch (cancelSyncErr) {
        console.warn('[Cancel Cleanup Warning]:', cancelSyncErr.message);
      }
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.0 R5 BRANCH ACCEPTANCE — operational acceptance boundary for an order
// awaiting branch acceptance (orders.status = 'pending').
//   ACCEPT → 'confirmed' (ACCEPTED — the locked operational acceptance state:
//           order valid, kitchen/fulfillment may proceed, inventory deducts)
//   REJECT → 'rejected' (REJECTED — terminal, DISTINCT from customer
//           cancellation 'cancelled')
// TIMEOUT is reserved for a separate timeout-worker task (not implemented).
// Decisions are server-authoritative, branch/brand-scoped, atomic
// (OrderStateMachine: BEGIN IMMEDIATE + compare-and-swap + audit log),
// auditable (order_status_logs: order, actor, previous/new state, decision,
// reason, timestamp), and idempotent for repeated identical decisions.
// A rejected branch is NEVER silently rematched to another branch, and an
// order with a settled payment cannot be branch-rejected (refund flow first).
// Additional Order Acceptance: same Branch/Dining authority as the parent Dine-in Order.
router.post('/orders/:id/additions/:additionId/branch-acceptance', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { decision, reason = '' } = req.body || {};
    if (!decision || !['accept', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'decision wajib bernilai "accept" atau "reject".' });
    }

    const scopeSql = `
      SELECT o.id, o.branch_id
      FROM orders o
      JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND b.brand_id = ?
      ${req.user.role === 'branch_manager' && (req.user.branch_id || req.user.branchId) ? ' AND o.branch_id = ?' : ''}
    `;
    const scopeParams = [req.params.id, req.brand_id];
    if (req.user.role === 'branch_manager' && (req.user.branch_id || req.user.branchId)) scopeParams.push(req.user.branch_id || req.user.branchId);
    const parent = db.prepare(scopeSql).get(...scopeParams);
    if (!parent) return res.status(404).json({ success: false, error: 'Order tidak ditemukan pada kewenangan cabang Anda.' });

    const result = await OrderAdditionService.decide({
      order_id: parent.id,
      addition_id: req.params.additionId,
      brand_id: req.brand_id,
      branch_id: parent.branch_id,
      decision,
      actor_id: req.user.userId || req.user.username || 'branch_actor',
      reason
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/orders/:id/branch-acceptance', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { decision, reason = '', note = '' } = req.body;
    if (!decision || !['accept', 'reject'].includes(decision)) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_DECISION',
        error: 'decision wajib bernilai "accept" atau "reject".'
      });
    }

    const targetStatus = decision === 'accept' ? 'confirmed' : 'rejected';
    if (decision === 'reject' && !String(reason || '').trim()) {
      return res.status(400).json({
        success: false,
        status: 'REASON_REQUIRED',
        error: 'Alasan penolakan cabang (reason) wajib diisi untuk audit.'
      });
    }

    // Branch scope: branch_manager acts ONLY on their assigned branch;
    // brand_manager/owner are brand-wide. Never trust a client branch_id.
    const verifySql = `
      SELECT o.id, o.branch_id, o.status, b.brand_id
      FROM orders o
      JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND b.brand_id = ?
      ${(req.user.role === 'branch_manager' && req.user.branchId) ? ' AND o.branch_id = ?' : ''}
    `;
    const verifyParams = [req.params.id, req.brand_id];
    if (req.user.role === 'branch_manager' && req.user.branchId) verifyParams.push(req.user.branchId);

    const order = db.prepare(verifySql).get(...verifyParams);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada kewenangan cabang Anda.' });
    }

    // Idempotency: repeating the SAME decision on an order already in the
    // target state is a safe no-op (no state change, no duplicate audit).
    if (order.status === targetStatus) {
      return res.json({
        success: true,
        order_id: order.id,
        decision,
        previous_status: order.status,
        new_status: order.status,
        idempotent: true
      });
    }

    const actorLabel = req.user.role + ':' + (req.user.username || req.user.userId || 'actor');
    const actorNote = decision === 'accept'
      ? `[ACCEPT by ${actorLabel}] ${note ? note : ''}`.trim()
      : `[REJECT by ${actorLabel}] ${String(reason).trim()}`;

    const { OrderRepository } = require('../../core/data/repositories');
    const orderRepo = new OrderRepository();

    // Unified database transaction: ensures table activation, stock deduction, and status transition
    // are truly atomic at the SQLite database level. Concurrently arriving duplicate accept requests
    // will be serialized by SQLite's write lock and safely resolve via the authoritative idempotency check.
    orderRepo.beginTransaction();
    let fullOrder = null;
    try {
      fullOrder = orderRepo.findById(order.id);
      if (!fullOrder) {
        orderRepo.rollbackTransaction();
        return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan.' });
      }

      // 1. Idempotency: if already in targetStatus, return success directly without duplicating side-effects
      if (fullOrder.status === targetStatus) {
        orderRepo.commitTransaction();
        return res.json({
          success: true,
          order_id: fullOrder.id,
          decision,
          previous_status: fullOrder.status,
          new_status: fullOrder.status,
          already_in_state: true,
          idempotent: true
        });
      }

      // 2. Validate state transition capability before running operational side-effects
      if (!OrderStateMachine.canTransition(fullOrder.status, targetStatus)) {
        orderRepo.rollbackTransaction();
        return res.status(400).json({
          success: false,
          error: `Perubahan status pesanan tidak valid: dari "${fullOrder.status}" ke "${targetStatus}".`
        });
      }

      if (decision === 'accept') {
        // Online payment gate (Gojek/Grab): kitchen never starts before the
        // customer's online payment is settled.
        if (fullOrder.payment_method && fullOrder.payment_method !== 'cash' && fullOrder.order_type !== 'reservation') {
          const payRow = db.prepare('SELECT payment_status FROM order_payments WHERE order_id = ?').get(fullOrder.id);
          if (payRow && payRow.payment_status !== 'settlement') {
            orderRepo.rollbackTransaction();
            return res.status(400).json({
              success: false,
              status: 'PAYMENT_PENDING',
              error: 'Pembayaran online pelanggan belum lunas. Pesanan baru dapat diterima setelah pembayaran selesai.'
            });
          }
        }
        let sessionResult = null;

        // 1. If dine-in, validate table and activate dining session atomically
        // Invariant: An order CANNOT be confirmed if its Dining Session fails to activate.
        if (fullOrder.order_type === 'dine_in') {
          const { DiningTableService } = require('../../domains/dining');
          const { DiningTableRepository } = require('../../core/data/repositories');
          const diningRepo = new DiningTableRepository();

          let tableIds = [];
          const activeHolds = diningRepo.findActiveHolds(fullOrder.id);
          if (activeHolds && activeHolds.length > 0) {
            tableIds = activeHolds.map(h => h.table_id);
          } else if (fullOrder.table_number) {
            const tbl = diningRepo.findTableIdByNumberOrLabel(fullOrder.branch_id, fullOrder.table_number);
            if (tbl) tableIds = [tbl.id];
          } else if (fullOrder.dining_session_id) {
            const sessTables = diningRepo.findSessionTables(fullOrder.dining_session_id);
            if (sessTables && sessTables.length > 0) tableIds = sessTables.map(t => t.table_id);
          }

          if (tableIds.length === 0) {
            orderRepo.rollbackTransaction();
            return res.status(400).json({
              success: false,
              status: 'TABLE_REQUIRED',
              error: 'Gagal menerima pesanan: meja tidak ditemukan atau hold telah kedaluwarsa.'
            });
          }

          // createOrAttachDiningSession enforces table availability atomically inside unified transaction.
          // If table is already occupied/blocked/mismatched, it throws and stops acceptance.
          sessionResult = DiningTableService.createOrAttachDiningSession({
            branch_id: fullOrder.branch_id,
            table_ids: tableIds,
            order_id: fullOrder.id,
            customer_name: fullOrder.customer_name,
            customer_phone: fullOrder.customer_phone,
            guest_count: fullOrder.guest_count || 1,
            hold_reference_id: fullOrder.id,
            channel: fullOrder.order_channel || 'customer_app',
            session_id: fullOrder.dining_session_id || null
          }, { dbTransactionProvided: true });
        }

        // 2. Deduct inventory stock for the accepted order (idempotent, inside unified transaction)
        // For cash orders, stock was not deducted while pending. If stock is insufficient, abort accept.
        const OrderPlacementService = require('../../domains/commerce/services/OrderPlacementService');
        OrderPlacementService.deductStockForSettledOrder(order.id, { dbTransactionProvided: true });

        // 3. Record promo redemptions for accepted order atomically
        const PromotionEngineService = require('../../domains/promotion/services/PromotionEngineService');
        PromotionEngineService.recordOrderRedemptions(fullOrder);

        // 4. Transition order status from pending -> confirmed (ACCEPTED)
        const result = OrderStateMachine.transition({
          order_id: order.id,
          target_status: 'confirmed',
          actor_type: 'branch_actor',
          actor_id: req.user.userId || req.user.username,
          note: actorNote
        }, { dbTransactionProvided: true });

        if (sessionResult) {
          result.dining_session_id = sessionResult.session_id;
        }

        const estimatedMinutes = Math.max(5, Math.min(180, Number(req.body && (req.body.prep_time_minutes || req.body.prepTimeMinutes || req.body.estimated_minutes || req.body.estimatedMinutes)) || 20));
        if (fullOrder.fulfillment_schedule_type !== 'scheduled') {
          const slotEnd = new Date(Date.now() + estimatedMinutes * 60 * 1000).toISOString();
          db.prepare("UPDATE orders SET scheduled_slot_end = ?, updated_at = ? WHERE id = ?")
            .run(slotEnd, new Date().toISOString(), order.id);
        }

        orderRepo.commitTransaction();
        return res.json({ success: true, decision, ...result });
      }

      if (decision === 'reject') {
        const result = OrderStateMachine.transition({
          order_id: order.id,
          target_status: 'rejected',
          actor_type: 'branch_actor',
          actor_id: req.user.userId || req.user.username,
          note: actorNote
        }, { dbTransactionProvided: true });

        if (fullOrder.order_type === 'dine_in') {
          const { DiningTableService } = require('../../domains/dining');
          DiningTableService.releaseHold({
            branch_id: fullOrder.branch_id,
            hold_reference_id: fullOrder.id,
            reason: 'rejected'
          }, { dbTransactionProvided: true });
        }

        // Close the POS-side Hold Bill pointer as well so the cashier does not
        // keep a stale bill after Merchant rejects the canonical order.
        try {
          db.prepare("UPDATE pos_held_orders SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'held'")
            .run(new Date().toISOString(), fullOrder.id);
        } catch (_) {}

        orderRepo.commitTransaction();

        // Broadcast authoritative notification
        try {
          const { NotificationService } = require('../../core');
          const notifService = new NotificationService(db);
          const rawCode = fullOrder.order_number || '';
          const displayCode = rawCode ? (rawCode.startsWith('#') ? rawCode : ('#' + rawCode)) : ('#' + fullOrder.id.slice(-3));
          notifService.createNotification({
            brand_id: fullOrder.brand_id,
            branch_id: fullOrder.branch_id,
            source_type: 'order',
            title: 'Pesanan Ditolak',
            body: `Pesanan ${displayCode} telah ditolak: ${String(reason).trim()}`,
            priority: 'high',
            target_role: null, // Broadcast to owner, branch manager, cashier
            target_scope: 'branch',
            related_entity_type: 'order',
            related_entity_id: fullOrder.id,
            action_url: `/merchant/orders/${fullOrder.id}`
          });
        } catch (_) {}

        return res.json({ success: true, decision, order_number: fullOrder.order_number, order: fullOrder, ...result });
      }
    } catch (err) {
      try { orderRepo.rollbackTransaction(); } catch (_) {}
      const isConcurrencyException = err.message && (err.message.includes('[OUT_OF_STOCK_RACE]') || err.message.includes('[PROMO_LIMIT_EXCEEDED_RACE]'));
      if (isConcurrencyException) {
        const { PaymentRepository } = require('../../core/data/repositories');
        const paymentRepo = new PaymentRepository();
        const payRecord = paymentRepo.findPaymentByOrderId(fullOrder.id);
        if (payRecord && payRecord.payment_status === 'settlement') {
          try {
            orderRepo.beginTransaction();
            const now = new Date().toISOString();
            const notePrefix = err.message.includes('[PROMO_LIMIT_EXCEEDED_RACE]')
              ? `[Kendala Promo / Perlu Penyesuaian/Refund]: ${err.message}`
              : `[Kendala Stok / Perlu Refund]: ${err.message}`;
            paymentRepo.markFulfillmentException({ orderId: fullOrder.id, note: notePrefix, updatedAt: now });
            orderRepo.commitTransaction();
            const { events } = require('../../core');
            events.EventBus.publish({
              type: 'payment.fulfillment_exception',
              producer: 'commerce',
              payload: {
                payment_id: payRecord.id,
                order_id: fullOrder.id,
                branch_id: fullOrder.branch_id,
                brand_id: fullOrder.brand_id,
                error: err.message,
                settled_at: now
              }
            }).catch(() => {});
            return res.status(400).json({
              success: false,
              order_status: 'fulfillment_exception',
              error: notePrefix
            });
          } catch (_) {
            try { orderRepo.rollbackTransaction(); } catch (_) {}
          }
        }
      }
      return res.status(400).json({ success: false, error: err.message });
    }
  } catch (outerErr) {
    return res.status(400).json({ success: false, error: outerErr.message });
  }
});

// ==============================================================================
// BRANCH MANAGER DELIVERY DISPATCH APIS
// ==============================================================================

// GET /api/v1/admin/branches/:branchId/drivers
// List active branch drivers for operational dispatch assignment
router.get('/admin/branches/:branchId/drivers', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { branchId } = req.params;
    if (!branchId) {
      return res.status(400).json({ success: false, error: 'branchId wajib diisi.' });
    }

    // Branch scoping guard for branch_manager
    if (req.user.role === 'branch_manager' && req.user.branchId && String(req.user.branchId) !== String(branchId)) {
      return res.status(403).json({ success: false, error: 'Akses ditolak: di luar cabang wewenang Anda.' });
    }

    const drivers = db.prepare(
      `SELECT id, username, full_name, phone, status, branch_id, avatar_url, updated_at
       FROM users
       WHERE brand_id = ? AND branch_id = ? AND role = 'driver' AND status = 'active'
       ORDER BY full_name ASC, username ASC`
    ).all(req.brand_id, branchId);

    // Enrich with active delivery task count
    const enriched = drivers.map(d => {
      const activeTaskCount = db.prepare(
        `SELECT COUNT(*) as count
         FROM order_deliveries dlv
         JOIN orders o ON o.id = dlv.order_id
         WHERE dlv.driver_id = ? AND o.branch_id = ? AND dlv.status IN ('assigned', 'picked_up', 'on_delivery')`
      ).get(d.id, branchId);
      return {
        id: d.id,
        name: d.full_name || d.username,
        phone: d.phone || '',
        status: d.status,
        active_tasks: activeTaskCount ? Number(activeTaskCount.count || 0) : 0,
        avatar_url: d.avatar_url || null
      };
    });

    return res.json({ success: true, drivers: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/admin/orders/:id/assign-driver
// Assign driver to a ready delivery order
router.post('/admin/orders/:id/assign-driver', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const orderId = req.params.id;
    const { driver_id, driver_name, driver_phone } = req.body || {};

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND brand_id = ?').get(orderId, req.brand_id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan.' });
    }

    if (req.user.role === 'branch_manager' && req.user.branchId && String(req.user.branchId) !== String(order.branch_id)) {
      return res.status(403).json({ success: false, error: 'Akses ditolak: Pesanan berada di luar cabang wewenang Anda.' });
    }

    if (order.order_type !== 'delivery') {
      return res.status(400).json({ success: false, error: 'Penugasan driver hanya berlaku untuk pesanan delivery.' });
    }

    if (!['confirmed', 'preparing', 'ready'].includes(order.status)) {
      return res.status(400).json({ success: false, error: 'Driver hanya dapat ditugaskan saat pesanan berstatus confirmed, preparing, atau ready.' });
    }

    if (!driver_id) {
      return res.status(400).json({ success: false, error: 'Kurir wajib dipilih dari daftar akun Driver aktif cabang (driver non-aplikasi tidak didukung).' });
    }

    let resolvedDriverName = driver_name ? String(driver_name).trim() : '';
    let resolvedDriverPhone = driver_phone ? String(driver_phone).trim() : '';
    let resolvedDriverId = driver_id ? String(driver_id).trim() : null;

    if (resolvedDriverId) {
      const driver = db.prepare(
        `SELECT id, full_name, username, phone, role, status, branch_id, brand_id
         FROM users WHERE id = ? AND brand_id = ? LIMIT 1`
      ).get(resolvedDriverId, req.brand_id);

      if (!driver || driver.role !== 'driver' || driver.status !== 'active') {
        return res.status(400).json({ success: false, error: 'Driver tidak valid atau tidak aktif.' });
      }

      if (String(driver.branch_id) !== String(order.branch_id)) {
        return res.status(400).json({ success: false, error: 'Driver harus berasal dari cabang yang sama dengan pesanan.' });
      }

      resolvedDriverName = driver.full_name || driver.username;
      if (resolvedDriverPhone && resolvedDriverPhone !== (driver.phone || '')) {
        db.prepare(`UPDATE users SET phone = ?, updated_at = datetime('now') WHERE id = ? AND brand_id = ?`)
          .run(resolvedDriverPhone, resolvedDriverId, req.brand_id);
      } else {
        resolvedDriverPhone = driver.phone || resolvedDriverPhone || '';
      }
    }

    if (!resolvedDriverName) {
      return res.status(400).json({ success: false, error: 'Nama driver wajib diisi.' });
    }

    if (!resolvedDriverId && !resolvedDriverPhone) {
      return res.status(400).json({ success: false, error: 'Nomor telepon driver wajib diisi.' });
    }

    const { DeliveryDispatchService } = require('../../domains/delivery');
    const result = DeliveryDispatchService.assign({
      order_id: order.id,
      driver_id: resolvedDriverId,
      driver_name: resolvedDriverName,
      driver_phone: resolvedDriverPhone,
      assigned_by: req.user.id || req.user.userId
    });

    const deliveryRecord = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);

    return res.json({
      success: true,
      order_id: order.id,
      order_number: order.order_number,
      delivery: deliveryRecord,
      ...result
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/admin/orders/:id/auto-dispatch
// Trigger automatic/hybrid driver dispatch manually for an order
router.post('/admin/orders/:id/auto-dispatch', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const orderId = req.params.id;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND brand_id = ?').get(orderId, req.brand_id);
    if (!order) return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan.' });

    if (req.user.role === 'branch_manager' && req.user.branchId && String(req.user.branchId) !== String(order.branch_id)) {
      return res.status(403).json({ success: false, error: 'Akses ditolak: Pesanan berada di luar cabang wewenang Anda.' });
    }

    const { DeliveryDispatchService } = require('../../domains/delivery');
    const result = DeliveryDispatchService.autoAssign({ order_id: order.id, branch_id: order.branch_id });
    const deliveryRecord = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);

    return res.json({
      success: result.success,
      order_id: order.id,
      order_number: order.order_number,
      delivery: deliveryRecord,
      ...result
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/admin/orders/check-hybrid-timeouts
// Watchdog endpoint to process hybrid dispatch timeouts and trigger BM manual fallback
router.post('/admin/orders/check-hybrid-timeouts', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { DeliveryDispatchService } = require('../../domains/delivery');
    const branchId = req.user.role === 'branch_manager' ? (req.user.branchId || req.user.branch_id) : (req.query.branch_id || null);
    const timedOut = DeliveryDispatchService.checkHybridTimeouts({ branch_id: branchId });
    return res.json({ success: true, timed_out_count: timedOut.length, timed_out_orders: timedOut });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

};
