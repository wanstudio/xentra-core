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
      payment: db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(ord.id)
    }));

    res.json({ success: true, branch_id: req.params.id, orders: enriched });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/orders]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});



};
