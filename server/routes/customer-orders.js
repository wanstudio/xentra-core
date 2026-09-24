/**
 * XENTRA CORE — CUSTOMER ORDER ROUTES
 *
 * Order detail, customer history and customer cancellation routes.
 * Authorization and business rules are unchanged; dependencies are injected
 * from the canonical API router to keep this module isolated.
 */

module.exports = function registerCustomerOrderRoutes(router, deps) {
  const {
    db,
    TokenSessionStore,
    AcceptanceTimeoutService,
    OrderStateMachine,
    requireCustomerAuth,
    DiningTableService
  } = deps;

router.get('/orders/:id', (req, res) => {
  // P1 TENANT ISOLATION: Join branches to strictly verify brand ownership.
  // branch_name is included for P7.1 Branch Acceptance Waiting surface.
  const order = db.prepare(`
    SELECT o.*, b.brand_id, b.name AS branch_name
    FROM orders o
    JOIN branches b ON b.id = o.branch_id
    WHERE o.id = ? AND b.brand_id = ?
  `).get(req.params.id, req.brand_id);

  if (!order) {
    return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada brand ini.' });
  }

  // P1 HORIZONTAL & BRANCH AUTHORIZATION (IDOR Guard - NEW-01 & NEW-02):
  // Check if caller is authenticated staff/operator (with strict branch isolation) or authenticated customer
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();
  const session = token ? TokenSessionStore.getSession(token) : null;
  
  let isAuthorized = false;

  if (session) {
    if (session.type === 'customer' || session.role === 'customer') {
      // Customer must own the order by canonical customer_id and match tenant organization
      const custId = session.customerId || session.customer_id;
      const orderCustId = order.customer_id;
      const reqOrgId = req.organization_id || (req.brand && req.brand.organization_id);
      const sessionOrgId = session.organization_id || session.organizationId;
      const isOrgMatch = sessionOrgId && reqOrgId && String(sessionOrgId) === String(reqOrgId);

      if (isOrgMatch && order.brand_id === req.brand_id) {
        if (custId && orderCustId && String(custId) === String(orderCustId)) {
          isAuthorized = true;
        } else if (!orderCustId && !custId && session.phone && order.customer_phone && session.phone === order.customer_phone) {
          // Controlled legacy compatibility only when order has no customer_id and session is legacy unmigrated
          isAuthorized = true;
        }
      }
    } else if (['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'].includes(session.role)) {
      // Operator must match tenant brand
      let isBrandMatch = session.brandId === req.brand_id;
      if (!isBrandMatch && session.role === 'owner' && session.organizationId && req.brand?.organization_id) {
        isBrandMatch = session.organizationId === req.brand.organization_id;
      }

      if (isBrandMatch) {
        // Branch-scoped operator roles (branch_manager, cashier, kitchen) MUST match order's branch
        const branchScopedRoles = ['branch_manager', 'cashier', 'kitchen'];
        if (branchScopedRoles.includes(session.role)) {
          if (session.branchId === order.branch_id) {
            isAuthorized = true;
          }
        } else {
          // Brand-level roles (owner, brand_manager) can view all branches in the brand
          isAuthorized = true;
        }
      }
    }
  }

  if (!isAuthorized) {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN_ORDER_ACCESS',
      message: 'Akses ditolak: Anda tidak memiliki sesi terotentikasi yang sah untuk melihat detail pesanan ini.'
    });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const delivery = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);
  const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order.id);
  const logs = db.prepare('SELECT previous_status, new_status, note, created_at FROM order_status_logs WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

  // P1 INFORMATION HIDING & PRIVACY (NEW-01 & NEW-09):
  // Return clean DTO projection to prevent internal data/GPS leakage.
  // P7.2 BRANCH ACCEPTANCE SURFACE: branch_name, branch_id, acceptance_deadline_at
  // are exposed to support the awaiting-acceptance waiting screen.
  // acceptance_deadline_at is server-computed via AcceptanceTimeoutService (3-minute platform policy).
  // It is a DISPLAY timestamp only — the client countdown reaching zero never
  // transitions order state. Status is always fetched from server.
  const acceptanceDeadlineAt = AcceptanceTimeoutService.computeAcceptanceDeadlineAt(order);
  const isReservationOrder = order.order_type === 'reservation';
  const reservationDate = isReservationOrder
    ? String(order.reservation_date || (order.scheduled_slot_start || '').substring(0, 10) || '')
    : null;
  const reservationTime = isReservationOrder
    ? String(order.reservation_time || (order.scheduled_slot_start || '').substring(11, 16) || '')
    : null;
  let reservationGuestCount = null;
  if (isReservationOrder) {
    const guestMatch = /Reservasi\s*\(\s*(\d+)\s*Tamu/i.exec(String(order.order_note || ''));
    reservationGuestCount = guestMatch ? Number(guestMatch[1]) : null;
  }

  const safeOrder = {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    order_type: order.order_type,
    order_channel: order.order_channel,
    reservation_date: reservationDate,
    reservation_time: reservationTime,
    guest_count: reservationGuestCount,
    table_number: order.table_number,
    subtotal: order.subtotal,
    delivery_fee: order.delivery_fee,
    discount_amount: order.discount_amount,
    grand_total: order.grand_total,
    payment_method: order.payment_method,
    payment_status: order.payment_status || (payment ? payment.payment_status : 'pending'),
    cash_tendered: order.cash_tendered !== null && order.cash_tendered !== undefined ? Number(order.cash_tendered) : null,
    expected_change: (order.payment_method === 'cash' && order.cash_tendered !== null && order.cash_tendered !== undefined)
      ? Math.max(0, Number(order.cash_tendered) - Number(order.grand_total))
      : null,
    order_note: order.order_note,
    created_at: order.created_at,
    updated_at: order.updated_at,
    // P7.2: branch context for awaiting-acceptance surface
    branch_id: order.branch_id,
    branch_name: order.branch_name || null,
    // Recipient Identity Layer: order-level snapshot (projection only — the
    // columns are written at placement; later profile edits never mutate them).
    recipient_type: order.recipient_type || 'self',
    recipient_name: order.recipient_name || '',
    recipient_phone: order.recipient_phone || '',
    // Buyer identity as display fallback for pre-snapshot legacy orders only.
    customer_name: order.customer_name || '',
    customer_phone: order.customer_phone || '',
    // P7.2: server-authoritative acceptance deadline (display only, null when not pending)
    acceptance_deadline_at: acceptanceDeadlineAt
  };

  const safeItems = (items || []).map(it => ({
    id: it.id,
    product_id: it.product_id,
    product_name: it.product_name || it.name,
    unit_price: it.unit_price,
    quantity: it.quantity,
    item_subtotal: it.item_subtotal,
    note: it.note || '',
    // Reorder support: catalog image is not stored on order_items, so resolve
    // it live (branch override first, then canonical product). Read-only.
    image_url: (() => {
      try {
        const bp = order.branch_id && it.product_id
          ? db.prepare('SELECT product_image_url, image_override FROM branch_products WHERE branch_id = ? AND product_id = ?').get(order.branch_id, String(it.product_id))
          : null;
        if (bp && (bp.image_override || bp.product_image_url)) return bp.image_override || bp.product_image_url;
        const prod = it.product_id
          ? db.prepare('SELECT image_url, image FROM products WHERE id = ?').get(String(it.product_id))
          : null;
        if (prod && (prod.image_url || prod.image)) return prod.image_url || prod.image;
      } catch (_) {}
      return '';
    })()
  }));

  const safeDelivery = delivery ? {
    destination_address: delivery.destination_address,
    actual_road_distance_meters: delivery.actual_road_distance_meters,
    delivery_fee_calculated: delivery.delivery_fee_calculated,
    driver_name: delivery.driver_name || null,
    driver_phone: delivery.driver_phone || null,
    tracking_url: delivery.tracking_url || null,
    status: delivery.status || null
  } : null;

  const safePayment = payment ? {
    payment_method: payment.payment_method || payment.provider,
    payment_status: payment.payment_status,
    cash_tendered: order.cash_tendered !== null && order.cash_tendered !== undefined ? Number(order.cash_tendered) : null,
    expected_change: (order.payment_method === 'cash' && order.cash_tendered !== null && order.cash_tendered !== undefined)
      ? Math.max(0, Number(order.cash_tendered) - Number(order.grand_total))
      : null,
    snap_token: payment.snap_token || null,
    amount: payment.amount,
    settled_at: payment.settled_at,
    created_at: payment.created_at
  } : null;

  res.json({
    success: true,
    order: safeOrder,
    items: safeItems,
    delivery: safeDelivery,
    payment: safePayment,
    logs
  });
});



router.get('/customer/orders', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    let orders;
    if (customerId) {
      // Canonical ownership: customer only sees orders explicitly belonging to their customer_id
      orders = db.prepare(`
        SELECT o.id, o.order_number, o.status, o.order_type, o.subtotal, o.delivery_fee, o.discount_amount,
               o.grand_total, o.payment_method, o.order_note, o.scheduled_slot_start, o.created_at, b.name as branch_name
        FROM orders o
        JOIN branches b ON b.id = o.branch_id
        WHERE b.brand_id = ? AND o.customer_id = ?
        ORDER BY o.created_at DESC
        LIMIT 50
      `).all(req.brand_id, customerId);
    } else {
      // Legacy session without customer_id: only access unlinked legacy orders with no customer_id
      orders = db.prepare(`
        SELECT o.id, o.order_number, o.status, o.order_type, o.subtotal, o.delivery_fee, o.discount_amount,
               o.grand_total, o.payment_method, o.created_at, b.name as branch_name
        FROM orders o
        JOIN branches b ON b.id = o.branch_id
        WHERE b.brand_id = ? AND o.customer_id IS NULL AND o.customer_phone = ?
        ORDER BY o.created_at DESC
        LIMIT 50
      `).all(req.brand_id, customerPhone);
    }

    const enriched = orders.map(ord => {
      let reservationDate = null;
      let reservationTime = null;
      let guestCount = null;

      if (ord.order_type === 'reservation') {
        const scheduled = String(ord.scheduled_slot_start || '');
        reservationDate = scheduled.substring(0, 10) || null;
        reservationTime = scheduled.substring(11, 16) || null;
        const guestMatch = /Reservasi\s*\(\s*(\d+)\s*Tamu/i.exec(String(ord.order_note || ''));
        guestCount = guestMatch ? Number(guestMatch[1]) : null;
      }

      return {
        ...ord,
        reservation_date: reservationDate,
        reservation_time: reservationTime,
        guest_count: guestCount,
        items: db.prepare('SELECT id, product_name, quantity, unit_price, item_subtotal FROM order_items WHERE order_id = ?').all(ord.id)
      };
    });

    res.json({ success: true, orders: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});



router.post('/orders/:id/cancel', requireCustomerAuth(), (req, res) => {
  try {
    const reason = String(req.body.reason || req.body.note || '').trim();
    const order = db.prepare('SELECT id, status, customer_id, customer_phone FROM orders WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan.' });
    }
    const custId = req.customer.customerId || req.customer.customer_id;
    const isOwner = (custId && order.customer_id && String(custId) === String(order.customer_id)) ||
                    (!custId && !order.customer_id && req.customer.phone && order.customer_phone && String(req.customer.phone) === String(order.customer_phone));
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_ORDER_OWNERSHIP',
        message: 'Anda hanya dapat membatalkan pesanan milik Anda sendiri.'
      });
    }

    if (order.status !== 'pending') {
      const hint = order.status === 'confirmed'
        ? 'Pesanan sudah diterima cabang dan tidak dapat dibatalkan oleh customer pada tahap ini.'
        : `Pesanan sudah berstatus "${order.status}" dan tidak dapat dibatalkan lagi.`;
      return res.status(400).json({
        success: false,
        status: 'CUSTOMER_CANCEL_NOT_ALLOWED',
        error: hint
      });
    }

    const result = OrderStateMachine.transition({
      order_id: order.id,
      target_status: 'cancelled',
      actor_type: 'customer',
      actor_id: req.customer.phone,
      note: `[CUSTOMER_CANCEL]${reason ? ' ' + reason : ''}`,
      // R11 TOCTOU GUARD: re-validated INSIDE the machine transaction — if a
      // branch ACCEPT (or timeout) committed between the pre-check above and
      // this transaction, the order is no longer pending and the cancel must
      // fail ([STATE_CHANGED]) instead of cancelling an ACCEPTED order.
      expected_current_status: 'pending'
    });

    const fullOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    if (fullOrder && fullOrder.order_type === 'dine_in') {
      const { DiningTableService } = require('../../domains/pos');
      try {
        DiningTableService.releaseHold({
          branch_id: fullOrder.branch_id,
          hold_reference_id: fullOrder.id,
          reason: 'cancelled'
        });
      } catch (relErr) {
        console.error('[CustomerCancel Release Hold Warning]:', relErr.message);
      }
    }

    res.json({ success: true, decision: 'customer_cancel', ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});


};
