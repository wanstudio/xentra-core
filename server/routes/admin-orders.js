/**
 * XENTRA CORE — ADMIN BRANCH ORDER ROUTES
 *
 * Branch-scoped operational order feed, including reservation visibility
 * ordering and enriched operational data.
 */
module.exports = function registerAdminOrderRoutes(router, deps) {
  const { db, requireAuth, AcceptanceTimeoutService } = deps;

router.get('/admin/branches/:id/orders', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_ACCESS',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id, timezone FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    // Reservation schedule is stored in branch-local time. Resolve "now" in the
    // branch timezone so the API can protect upcoming reservations from being
    // pushed out of the default page by newer historical orders.
    let branchLocalNow;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: branch.timezone || 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date()).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});
      branchLocalNow = parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second;
    } catch (_) {
      branchLocalNow = new Date().toISOString().slice(0, 19);
    }

    const statusFilter = req.query.status;
    let query = `
      SELECT o.*, b.name as branch_name 
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.brand_id = ? AND o.branch_id = ?
    `;
    // Keep the same operational precedence as the Merchant App:
    // pending → upcoming confirmed reservation → everything else.
    // This is a visibility safeguard at the API boundary; the client may still
    // apply its own presentation sort without changing server business state.
    const params = [req.brand_id, req.params.id];

    if (statusFilter && statusFilter !== 'all') {
      query += ' AND o.status = ?';
      params.push(statusFilter);
    }

    // ORDER BY placeholders come after the optional status filter placeholder.
    params.push(branchLocalNow, branchLocalNow);

    query += `
      ORDER BY
        CASE
          WHEN o.status = 'pending' THEN 0
          WHEN o.order_type = 'reservation'
               AND o.status = 'confirmed'
               AND o.scheduled_slot_start IS NOT NULL
               AND o.scheduled_slot_start >= ? THEN 1
          ELSE 2
        END ASC,
        CASE
          WHEN o.order_type = 'reservation'
               AND o.status = 'confirmed'
               AND o.scheduled_slot_start IS NOT NULL
               AND o.scheduled_slot_start >= ? THEN o.scheduled_slot_start
          ELSE NULL
        END ASC,
        o.created_at DESC
    `;

    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 200) : 100;
    query += ` LIMIT ${limit}`;

    if (req.query.offset) {
      query += ` OFFSET ${parseInt(req.query.offset, 10)}`;
    }

    const orders = db.prepare(query).all(...params);

    const enriched = orders.map(ord => ({
      ...ord,
      acceptance_deadline_at: ord.acceptance_deadline_at || AcceptanceTimeoutService.computeAcceptanceDeadlineAt(ord),
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
      delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id),
      payment: db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(ord.id),
      pending_additions_count: Number((db.prepare("SELECT COUNT(*) AS count FROM order_addition_batches WHERE order_id = ? AND status = 'pending_acceptance'").get(ord.id) || {}).count || 0)
    }));

    res.json({ success: true, branch_id: req.params.id, orders: enriched });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/orders]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});




// 15. Admin Orders List & Analytics Summary
router.get('/admin/orders', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const {
      branch_id,
      status,
      order_channel,
      fulfillment_type,
      start_date,
      end_date,
      search,
      limit,
      offset
    } = req.query;

    let query = `
      SELECT o.*, b.name as branch_name 
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.brand_id = ?
    `;
    const params = [req.brand_id];

    // Branch manager is strictly scoped to their assigned branch
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId) {
        query += ' AND o.branch_id = ?';
        params.push(assignedBranchId);
      }
    } else if (branch_id && branch_id !== 'all') {
      query += ' AND o.branch_id = ?';
      params.push(branch_id);
    }

    if (status && status !== 'all') {
      query += ' AND o.status = ?';
      params.push(status);
    }

    if (order_channel && order_channel !== 'all') {
      query += ' AND o.order_channel = ?';
      params.push(order_channel);
    }

    if (fulfillment_type && fulfillment_type !== 'all') {
      query += ' AND o.fulfillment_type = ?';
      params.push(fulfillment_type);
    }

    if (start_date) {
      query += ' AND o.created_at >= ?';
      params.push(start_date.includes(' ') || start_date.includes('T') ? start_date : start_date + ' 00:00:00');
    }

    if (end_date) {
      query += ' AND o.created_at <= ?';
      params.push(end_date.includes(' ') || end_date.includes('T') ? end_date : end_date + ' 23:59:59');
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      query += ' AND (o.order_number LIKE ? OR o.id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)';
      params.push(q, q, q, q);
    }

    query += ' ORDER BY o.created_at DESC';

    const maxLimit = limit ? Math.min(parseInt(limit, 10), 200) : 100;
    query += ` LIMIT ${maxLimit}`;

    if (offset) {
      query += ` OFFSET ${parseInt(offset, 10)}`;
    }

    const orders = db.prepare(query).all(...params);

    const enriched = orders.map(ord => ({
      ...ord,
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
      delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id),
      payment: db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(ord.id),
      pending_additions_count: Number((db.prepare("SELECT COUNT(*) AS count FROM order_addition_batches WHERE order_id = ? AND status = 'pending_acceptance'").get(ord.id) || {}).count || 0)
    }));

    res.json({ success: true, orders: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15.1 Admin Single Order Detail
router.get('/admin/orders/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const order = db.prepare(`
      SELECT o.*, b.name as branch_name
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND o.brand_id = ?
    `).get(req.params.id, req.brand_id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'ORDER_NOT_FOUND',
        message: 'Pesanan tidak ditemukan pada brand ini.'
      });
    }

    // Branch manager scope guard
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== order.branch_id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya dapat mengakses pesanan cabang yang ditugaskan.'
        });
      }
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const delivery = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);
    const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order.id);
    const logs = db.prepare('SELECT previous_status, new_status, note, created_at FROM order_status_logs WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

    // If dine-in order with dining_session_id, retrieve all session additions
    let sessionOrders = [];
    if (order.dining_session_id) {
      sessionOrders = db.prepare(`
        SELECT id, order_number, order_channel, fulfillment_type, status, grand_total, payment_status, created_at
        FROM orders
        WHERE dining_session_id = ? AND brand_id = ? AND id != ?
        ORDER BY created_at ASC
      `).all(order.dining_session_id, req.brand_id, order.id);
    }

    res.json({
      success: true,
      order: {
        ...order,
        acceptance_deadline_at: order.acceptance_deadline_at || AcceptanceTimeoutService.computeAcceptanceDeadlineAt(order),
        items: items || [],
        delivery: delivery || null,
        payment: payment || null,
        status_logs: logs || [],
        session_orders: sessionOrders
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

};
