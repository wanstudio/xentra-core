/**
 * XENTRA CORE — POS ROUTES
 *
 * Cash settlement, shifts, offline sync, terminal registration, local sales
 * and inventory conflict resolution. Business logic remains in injected Core
 * services; this module owns HTTP transport and RBAC bindings.
 */
module.exports = function registerPosRoutes(router, deps) {
  const {
    db,
    requireAuth,
    PaymentService,
    CashSettlementService,
    PosShiftService,
    OfflineReconciliationService,
    PosLocalOperationService
  } = deps;

router.post('/pos/orders/:id/settle-cash', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const orderId = req.params.id;
    const { amount_tendered, shift_id } = req.body;

    // Canonical Session Identity Resolution
    const cashierId = req.user ? (req.user.id || req.user.userId) : null;
    const userBranchId = req.user ? (req.user.branch_id || req.user.branchId) : null;

    // Scope & Branch Boundary Enforcement
    let verifySql = 'SELECT * FROM orders WHERE id = ? AND brand_id = ?';
    const verifyParams = [orderId, req.brand_id];

    if (req.user && ['branch_manager', 'cashier'].includes(req.user.role) && userBranchId) {
      verifySql += ' AND branch_id = ?';
      verifyParams.push(userBranchId);
    }

    const order = db.prepare(verifySql).get(...verifyParams);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Pesanan tidak ditemukan atau berada di luar kewenangan cabang Anda.'
      });
    }

    let effectiveShiftId = null;

    // P1 SHIFT RESOLUTION & OVERRIDE POLICY (NEW-04):
    // Cashier MUST use their own active shift on the order's branch.
    // Branch manager / Owner can supply explicit shift_id if it belongs to the same branch.
    if (req.user.role === 'cashier') {
      const activeShift = db.prepare(`
        SELECT id FROM pos_shifts 
        WHERE cashier_id = ? AND branch_id = ? AND status = 'open' 
        ORDER BY opened_at DESC LIMIT 1
      `).get(cashierId, order.branch_id);

      if (activeShift) {
        effectiveShiftId = activeShift.id;
      } else {
        return res.status(400).json({
          success: false,
          error: 'Kasir belum membuka shift aktif. Harap buka shift kasir terlebih dahulu sebelum menerima pembayaran tunai.'
        });
      }
    } else {
      if (shift_id) {
        const checkShift = db.prepare('SELECT id, branch_id FROM pos_shifts WHERE id = ?').get(shift_id);
        if (!checkShift || checkShift.branch_id !== order.branch_id) {
          return res.status(400).json({
            success: false,
            error: 'Shift yang ditentukan tidak valid atau tidak cocok dengan cabang pesanan ini.'
          });
        }
        effectiveShiftId = shift_id;
      }
    }

    // P1 EXPLICIT CASHIER ASSERTION: amount_tendered is strictly required (no silent inference)
    if (amount_tendered === undefined || amount_tendered === null || !Number.isFinite(Number(amount_tendered)) || Number(amount_tendered) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Nominal uang yang diterima (amount_tendered) wajib diisi dengan angka positif yang valid.'
      });
    }

    // Authoritative Domain Settlement Execution (Single Source of Truth)
    const { CashSettlementService } = require('../../domains/payment');
    const result = CashSettlementService.settleCashPayment({
      order_id: orderId,
      amount: Number(order.grand_total),
      amount_tendered: Number(amount_tendered),
      cashier_id: cashierId,
      shift_id: effectiveShiftId
    });

    res.json({
      success: true,
      message: result.message || 'Pembayaran tunai berhasil diselesaikan.',
      idempotent: !!result.idempotent,
      payment: result
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.2 POS Shift Management Endpoints (Strictly Authorized Cashiers, Branch Managers & Owners)
router.get('/pos/shifts/current', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const cashierId = req.user.id || req.user.userId;
    const userRole = req.user.role;
    const userBranchId = (['cashier', 'branch_manager'].includes(userRole))
      ? (req.user.branch_id || req.user.branchId)
      : (req.user.branch_id || req.user.branchId || req.query.branch_id);
    const targetCashierId = (['owner', 'brand_manager', 'branch_manager'].includes(userRole) && req.query.cashier_id)
      ? req.query.cashier_id
      : cashierId;

    if (!userBranchId) {
      return res.status(400).json({ success: false, error: 'Parameter branch_id wajib disertakan.' });
    }

    const shift = db.prepare(`
      SELECT * FROM pos_shifts 
      WHERE cashier_id = ? AND branch_id = ? AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1
    `).get(targetCashierId, userBranchId);

    res.json({
      success: true,
      has_active_shift: !!shift,
      shift: shift || null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/pos/shifts/open', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const cashierId = req.user.id || req.user.userId;
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    const { starting_float = 0, branch_id: requestedBranchId, cashier_id: requestedCashierId } = req.body;

    let targetBranchId = userBranchId || requestedBranchId;
    let targetCashierId = cashierId;

    // P1 ROLE-BASED BRANCH ENFORCEMENT (NEW-03)
    if (userRole === 'cashier') {
      if (userBranchId && requestedBranchId && requestedBranchId !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Kasir hanya berwenang membuka shift di cabang yang ditugaskan (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId || requestedBranchId;
      targetCashierId = cashierId; // Cashier cannot open shift on behalf of other cashiers
    } else if (userRole === 'branch_manager') {
      if (userBranchId && requestedBranchId && requestedBranchId !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Manajer cabang hanya berwenang membuka shift di cabang yang ditugaskan (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId || requestedBranchId;
      if (requestedCashierId) {
        targetCashierId = requestedCashierId;
      } else {
        const branchCashier = db.prepare('SELECT id FROM users WHERE branch_id = ? AND role = "cashier" LIMIT 1').get(targetBranchId);
        if (!branchCashier) {
          return res.status(400).json({ success: false, error: 'Parameter cashier_id (user dengan role "cashier") wajib disertakan untuk membuka shift.' });
        }
        targetCashierId = branchCashier.id;
      }
    } else if (['owner', 'brand_manager'].includes(userRole)) {
      targetBranchId = requestedBranchId || userBranchId;
      if (requestedCashierId) {
        targetCashierId = requestedCashierId;
      } else {
        const branchCashier = db.prepare('SELECT id FROM users WHERE branch_id = ? AND role = "cashier" LIMIT 1').get(targetBranchId);
        if (!branchCashier) {
          return res.status(400).json({ success: false, error: 'Parameter cashier_id (user dengan role "cashier") wajib disertakan untuk membuka shift.' });
        }
        targetCashierId = branchCashier.id;
      }
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'Cabang (branch_id) wajib disertakan untuk membuka shift.' });
    }

    // Verify branch belongs to authenticated brand
    const branchCheck = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(targetBranchId, req.brand_id);
    if (!branchCheck) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const { PosShiftService } = require('../../domains/pos');
    const shift = PosShiftService.openShift({
      branch_id: targetBranchId,
      cashier_id: targetCashierId,
      starting_float: Number(starting_float) || 0
    });

    res.status(201).json({
      success: true,
      message: 'Shift kasir berhasil dibuka.',
      shift
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/shifts/:id/cash-movement', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const shiftId = req.params.id;
    const { type, amount, reason = '' } = req.body;

    const cashierId = req.user.id || req.user.userId;
    const userBranchId = req.user.branch_id || req.user.branchId;

    // Strict Shift Tenant & Ownership Verification
    const shift = db.prepare(`
      SELECT s.*, b.brand_id 
      FROM pos_shifts s
      JOIN branches b ON b.id = s.branch_id
      WHERE s.id = ? AND b.brand_id = ?
    `).get(shiftId, req.brand_id);

    if (!shift) {
      return res.status(404).json({ success: false, error: 'Shift tidak ditemukan pada brand ini.' });
    }

    // P1 SHIFT MUTATION RBAC & OWNERSHIP GUARD (NEW-01)
    if (req.user.role === 'cashier') {
      if (shift.cashier_id !== cashierId || (userBranchId && shift.branch_id !== userBranchId)) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Kasir hanya berwenang mencatat mutasi kas pada shift miliknya sendiri.'
        });
      }
    } else if (req.user.role === 'branch_manager') {
      if (userBranchId && shift.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Manajer cabang hanya berwenang mengelola shift di cabang yang ditugaskan.'
        });
      }
    }

    if (!type || !['in', 'out'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Tipe mutasi kas wajib "in" atau "out".' });
    }
    if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Jumlah uang (amount) harus berupa angka positif.' });
    }

    const { PosShiftService } = require('../../domains/pos');
    const updatedShift = PosShiftService.recordCashMovement({
      shift_id: shiftId,
      type,
      amount: Number(amount),
      reason: String(reason),
      actor_id: cashierId,
      actor_role: req.user.role
    });

    res.json({
      success: true,
      message: `Mutasi kas (${type === 'in' ? 'Cash In' : 'Cash Out'}) berhasil dicatat.`,
      shift: updatedShift
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/shifts/:id/close', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const shiftId = req.params.id;
    const { actual_cash } = req.body;

    const cashierId = req.user.id || req.user.userId;
    const userBranchId = req.user.branch_id || req.user.branchId;

    // Strict Shift Tenant & Ownership Verification
    const shift = db.prepare(`
      SELECT s.*, b.brand_id 
      FROM pos_shifts s
      JOIN branches b ON b.id = s.branch_id
      WHERE s.id = ? AND b.brand_id = ?
    `).get(shiftId, req.brand_id);

    if (!shift) {
      return res.status(404).json({ success: false, error: 'Shift tidak ditemukan pada brand ini.' });
    }

    // P1 SHIFT CLOSING RBAC & OWNERSHIP GUARD (NEW-01 & NEW-02)
    if (req.user.role === 'cashier') {
      if (shift.cashier_id !== cashierId || (userBranchId && shift.branch_id !== userBranchId)) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Kasir hanya berwenang menutup shift miliknya sendiri.'
        });
      }
    } else if (req.user.role === 'branch_manager') {
      if (userBranchId && shift.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Manajer cabang hanya berwenang menutup shift di cabang yang ditugaskan.'
        });
      }
    }

    if (actual_cash === undefined || actual_cash === null || !Number.isFinite(Number(actual_cash)) || Number(actual_cash) < 0) {
      return res.status(400).json({
        success: false,
        error: 'Nominal kas fisik aktual (actual_cash) wajib diisi dengan angka valid.'
      });
    }

    const { PosShiftService } = require('../../domains/pos');
    const closedShift = PosShiftService.closeShift({
      shift_id: shiftId,
      actual_cash: Number(actual_cash),
      actor_id: cashierId,
      actor_role: req.user.role
    });

    res.json({
      success: true,
      message: 'Shift kasir berhasil ditutup.',
      shift: closedShift
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.3 POS Offline Synchronization Endpoints (F05)
router.post('/pos/offline-sync', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    // F05 Security Invariant: authorized branch scope cannot be bypassed by client-supplied branch_id
    if (['cashier', 'branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang melakukan sinkronisasi untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'Cabang (branch_id) wajib ditentukan.' });
    }

    const { OfflineReconciliationService } = require('../../domains/pos');
    const result = await OfflineReconciliationService.reconcileOfflineTransaction({
      ...req.body,
      brand_id: req.brand_id,
      branch_id: targetBranchId
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/offline-sync/batch', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    if (['cashier', 'branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang melakukan sinkronisasi untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'Cabang (branch_id) wajib ditentukan.' });
    }

    const { OfflineReconciliationService } = require('../../domains/pos');
    const result = await OfflineReconciliationService.processBatchSync({
      branch_id: targetBranchId,
      transactions: req.body.transactions || []
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.4 POS Phase 1: Local Operational Foundation Endpoints
router.post('/pos/terminal/register', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    if (['branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang mendaftarkan terminal untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'Cabang (branch_id) wajib ditentukan.' });
    }

    const { PosLocalOperationService } = require('../../domains/pos');
    const terminal = PosLocalOperationService.registerTerminal({
      branch_id: targetBranchId,
      device_name: req.body.device_name,
      device_identifier: req.body.device_identifier,
      config_version: req.body.config_version || 1
    });

    res.json({ success: true, terminal });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/local/sale', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    if (['cashier', 'branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang mencatat penjualan untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    const { PosLocalOperationService } = require('../../domains/pos');
    const result = PosLocalOperationService.recordOfflineSale({
      ...req.body,
      brand_id: req.brand_id,
      branch_id: targetBranchId
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/local/sync-outbox', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    let targetBranchId = req.body.branch_id || userBranchId;

    if (['cashier', 'branch_manager'].includes(userRole)) {
      if (userBranchId && req.body.branch_id && req.body.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Anda hanya berwenang menyinkronkan antrean untuk cabang Anda (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId;
    }

    const { PosLocalOperationService } = require('../../domains/pos');
    const result = await PosLocalOperationService.syncOutboxQueue({
      terminal_id: req.body.terminal_id,
      branch_id: targetBranchId
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/inventory-conflicts/:id/resolve', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { PosLocalOperationService } = require('../../domains/pos');
    const result = PosLocalOperationService.resolveInventoryConflict({
      conflict_id: req.params.id,
      resolution_decision: req.body.resolution_decision,
      resolved_by: req.user.id || req.user.username || 'manager',
      reason: req.body.reason
    });

    res.json({ success: true, conflict: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});


};
