/**
 * XENTRA CORE — DINE-IN ROUTES
 *
 * Customer table discovery plus staff/owner table, reservation and layout
 * operations. Domain invariants remain in POS/Dining services.
 */
'use strict';

module.exports = function registerDineInRoutes(router, deps) {
  const {
    db,
    crypto,
    requireAuth,
    TokenSessionStore,
    DiningTableService,
    TableRecommendationService,
    PosOrderService
  } = deps;

router.get('/dine-in/layout', (req, res) => {
  try {
    // If an authenticated staff token is presented, enforce branch scope
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();
    let session = null;
    if (token) {
      session = TokenSessionStore.getSession(token);
    }

    let branchId = req.query.branch_id || (req.query.branchId ? req.query.branchId : null);

    if (session && ['branch_manager', 'cashier', 'kitchen'].includes(session.role)) {
      const assignedBranchId = session.branchId || session.branch_id;
      if (branchId && branchId !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_ACCESS',
          message: 'Akses ditolak: Anda hanya memiliki izin untuk mengakses cabang yang ditugaskan.'
        });
      }
      branchId = assignedBranchId;
    }

    if (!branchId && req.brand_id) {
      const defaultBranch = db.prepare('SELECT b.id FROM branches b LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id WHERE b.brand_id = ? AND b.is_active = 1 ORDER BY COALESCE(s.is_delivery_active, 1) DESC, b.created_at ASC LIMIT 1').get(req.brand_id);
      if (defaultBranch) branchId = defaultBranch.id;
    }

    if (!branchId) {
      return res.status(400).json({ success: false, error: 'branch_id parameter wajib disertakan.' });
    }

    const layout = DiningTableService.getBranchLayout(branchId);
    res.json({ success: true, layout });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Customer: Recommend Table(s) based on Guest Count & Spatial Proximity
router.post('/dine-in/recommend-tables', (req, res) => {
  try {
    let { branch_id, guest_count } = req.body || {};
    if (!branch_id && req.brand_id) {
      const defaultBranch = db.prepare('SELECT b.id FROM branches b LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id WHERE b.brand_id = ? AND b.is_active = 1 ORDER BY COALESCE(s.is_delivery_active, 1) DESC, b.created_at ASC LIMIT 1').get(req.brand_id);
      if (defaultBranch) branch_id = defaultBranch.id;
    }

    if (!branch_id) {
      return res.status(400).json({ success: false, error: 'branch_id wajib diisi.' });
    }

    const layout = DiningTableService.getBranchLayout(branch_id);
    const recommendation = TableRecommendationService.recommendTables({
      tables: layout.tables,
      guest_count: Number(guest_count) || 1
    });

    res.json({ success: true, recommendation });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Customer: Resolve Branch & Table from scanned QR token
router.get('/dine-in/qr/:token', (req, res) => {
  try {
    const resolved = DiningTableService.resolveFromQr(req.params.token);
    if (!resolved) {
      return res.status(404).json({ success: false, error: 'QR Meja tidak valid atau telah dicabut.' });
    }
    res.json({ success: true, table: resolved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / Owner: Regenerate QR Token for a table
// Staff: QR meja untuk dicetak / dibagikan / dikirim ke printer.
//
// Isinya URL GABUNG, bukan token mentah: kamera bawaan HP mana pun bisa
// membacanya dan langsung membuka PWA, tanpa aplikasi kita dan tanpa izin apa
// pun. Tokennya TIDAK dirotasi di sini — QR yang sudah ditempel di meja harus
// tetap berlaku sampai staf sengaja mem-rotate-nya; token hanya dibuat kalau
// meja itu belum punya.
router.get('/dine-in/tables/:id/qr', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const table = db.prepare('SELECT id, branch_id, table_number, label, qr_token FROM branch_tables WHERE id = ?').get(req.params.id);
    if (!table) {
      return res.status(404).json({ success: false, error: 'MEJA_TIDAK_DITEMUKAN' });
    }

    if (['branch_manager', 'cashier'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (table.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada meja cabang yang ditugaskan.'
        });
      }
    }

    let token = table.qr_token;
    if (!token) {
      const { DiningTableService } = require('../../domains/dining');
      token = DiningTableService.regenerateQrToken(table.id).qr_token;
    }

    const joinUrl = 'https://' + req.headers.host + '/join?meja=' + encodeURIComponent(token);

    const qrcode = require('qrcode-generator');
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();

    res.json({
      success: true,
      table: { id: table.id, table_number: table.table_number, label: table.label },
      join_url: joinUrl,
      svg: qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true })
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/dine-in/tables/:id/regenerate-qr', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      const table = db.prepare('SELECT branch_id FROM branch_tables WHERE id = ?').get(req.params.id);
      if (!table || table.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada meja cabang yang ditugaskan.'
        });
      }
    }
    const result = DiningTableService.regenerateQrToken(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / POS: Block or Unblock a table (with strict branch scope guard)
router.post('/dine-in/tables/:id/block', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const { is_blocked, reason } = req.body;

    // Scope check: branch_manager or cashier can operate only on assigned branch
    if (['branch_manager', 'cashier'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      const table = db.prepare('SELECT branch_id FROM branch_tables WHERE id = ?').get(req.params.id);
      if (!table || table.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada meja cabang yang ditugaskan.'
        });
      }
    }

    const result = DiningTableService.setTableBlockedState(req.params.id, Boolean(is_blocked), reason);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / POS: Reservation operational lifecycle
router.post('/pos/reservations/:id/check-in', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const reservation = db.prepare(
      "SELECT id, brand_id, branch_id, order_type FROM orders WHERE id = ? AND brand_id = ?"
    ).get(req.params.id, req.brand_id);

    if (!reservation) {
      return res.status(404).json({ success: false, error: 'RESERVATION_NOT_FOUND' });
    }
    if (reservation.order_type !== 'reservation') {
      return res.status(400).json({ success: false, error: 'NOT_A_RESERVATION' });
    }

    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (!assignedBranchId || reservation.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya dapat check-in reservasi pada cabang yang ditugaskan.'
        });
      }
    }

    const tableNumber = String((req.body && (req.body.table_number || req.body.tableNumber)) || '').trim();
    if (!tableNumber) {
      return res.status(400).json({ success: false, error: 'TABLE_NUMBER_REQUIRED' });
    }

    const { PosOrderService } = require('../../domains/pos');
    const result = PosOrderService.checkInReservation({
      reservation_order_id: reservation.id,
      table_number: tableNumber
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const status = /FORBIDDEN_BRANCH_SCOPE/.test(err.message) ? 403 : 400;
    return res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/pos/reservations/:id/no-show', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const reservation = db.prepare(
      "SELECT id, brand_id, branch_id, order_type FROM orders WHERE id = ? AND brand_id = ?"
    ).get(req.params.id, req.brand_id);

    if (!reservation) {
      return res.status(404).json({ success: false, error: 'RESERVATION_NOT_FOUND' });
    }
    if (reservation.order_type !== 'reservation') {
      return res.status(400).json({ success: false, error: 'NOT_A_RESERVATION' });
    }

    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (!assignedBranchId || reservation.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya dapat membatalkan no-show reservasi pada cabang yang ditugaskan.'
        });
      }
    }

    const reason = String((req.body && (req.body.reason || req.body.note)) || '').trim();
    const { PosOrderService } = require('../../domains/pos');
    const result = PosOrderService.cancelNoShowReservation({
      reservation_order_id: reservation.id,
      actor_id: req.user.id || req.user.username || 'branch_manager',
      reason: reason || 'No-Show: Melewati batas toleransi kedatangan'
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const status = /FORBIDDEN_BRANCH_SCOPE/.test(err.message) ? 403 : 400;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// Staff / POS: Complete Active Dining Session (Releases tables)
router.post('/dine-in/sessions/:id/complete', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    if (['branch_manager', 'cashier'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      const session = db.prepare('SELECT branch_id FROM dining_sessions WHERE id = ?').get(req.params.id);
      if (!session || session.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada sesi cabang yang ditugaskan.'
        });
      }
    }
    const actorId = req.user ? (req.user.id || req.user.username) : 'staff';
    const result = DiningTableService.completeDiningSession(req.params.id, actorId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / POS: Operational Table Reassignment for Active Dining Session
router.post('/dine-in/sessions/:id/reassign-tables', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    if (['branch_manager', 'cashier'].includes(req.user.role)) {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      const session = db.prepare('SELECT branch_id FROM dining_sessions WHERE id = ?').get(req.params.id);
      if (!session || session.branch_id !== assignedBranchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada sesi cabang yang ditugaskan.'
        });
      }
    }
    const { table_ids } = req.body;
    const result = DiningTableService.reassignSessionTables({
      session_id: req.params.id,
      new_table_ids: table_ids,
      actor: req.user
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Owner / Brand Governance: Update Branch Dining Layout Configuration (Geometry / Physical Structure)
// Branch Manager operates daily table states only, does not modify physical floor layout geometry.
router.put('/dine-in/layout/:branch_id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const branchId = req.params.branch_id;
    const { canvas, sections, non_table_objects, tables } = req.body;

    const existingLayout = db.prepare('SELECT id FROM branch_dining_layouts WHERE branch_id = ?').get(branchId);
    const layoutId = existingLayout ? existingLayout.id : `layout_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`
        INSERT INTO branch_dining_layouts (
          id, branch_id, canvas_config, sections_config, non_table_objects_config, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(branch_id) DO UPDATE SET
          canvas_config = excluded.canvas_config,
          sections_config = excluded.sections_config,
          non_table_objects_config = excluded.non_table_objects_config,
          updated_at = excluded.updated_at
      `).run(
        layoutId,
        branchId,
        JSON.stringify(canvas || { width: 380, height: 620 }),
        JSON.stringify(sections || []),
        JSON.stringify(non_table_objects || []),
        now,
        now
      );

      if (Array.isArray(tables)) {
        for (const t of tables) {
          const tableId = t.id || `tbl_${branchId}_${t.table_number}`;
          const qrToken = t.qr_token || `qr_${crypto.randomBytes(8).toString('hex')}`;

          db.prepare(`
            INSERT INTO branch_tables (
              id, branch_id, table_number, label, capacity, section_id,
              x, y, width, height, shape, orientation, qr_token, is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(branch_id, table_number) DO UPDATE SET
              label = excluded.label,
              capacity = excluded.capacity,
              section_id = excluded.section_id,
              x = excluded.x,
              y = excluded.y,
              width = excluded.width,
              height = excluded.height,
              shape = excluded.shape,
              orientation = excluded.orientation,
              is_active = excluded.is_active,
              updated_at = excluded.updated_at
          `).run(
            tableId,
            branchId,
            String(t.table_number),
            t.label || `meja ${t.table_number}`,
            Number(t.capacity) || 4,
            t.section_id || null,
            Number(t.x) || 0,
            Number(t.y) || 0,
            Number(t.width) || 80,
            Number(t.height) || 60,
            t.shape || 'rectangle',
            t.orientation || 'horizontal',
            qrToken,
            t.is_active !== undefined ? (t.is_active ? 1 : 0) : 1,
            now,
            now
          );

          if (t.operational_state) {
            db.prepare(`
              INSERT INTO branch_table_states (table_id, operational_state, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(table_id) DO UPDATE SET
                operational_state = excluded.operational_state,
                updated_at = excluded.updated_at
            `).run(tableId, t.operational_state, now);
          }
        }
      }

      db.exec('COMMIT;');
    } catch (saveErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw saveErr;
    }

    res.json({ success: true, message: 'Tata letak meja berhasil diperbarui.' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

};
