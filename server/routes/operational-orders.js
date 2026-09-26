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

    const result = OrderStateMachine.transition({
      order_id: req.params.id,
      target_status: status,
      actor_type,
      actor_id,
      note
    });

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
router.post('/orders/:id/additions/:additionId/branch-acceptance', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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

    const result = OrderAdditionService.decide({
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
    try {
      const fullOrder = orderRepo.findById(order.id);
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
        return res.json({ success: true, decision, ...result });
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

};
