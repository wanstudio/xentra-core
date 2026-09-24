/**
 * XENTRA CORE — ADMIN BRANCH MANAGEMENT ROUTES
 *
 * Branch CRUD, operational toggles and branch activity logs. Branch catalog
 * adoption/product/category routes live in branch-catalog.js.
 */
module.exports = function registerAdminBranchRoutes(router, deps) {
  const { db, crypto, requireAuth } = deps;

router.get('/admin/branches', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const branches = db.prepare(`
      SELECT 
        b.id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone, b.whatsapp_number, b.is_active, b.is_open_override, b.is_archived, b.timezone,
        s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order,
        (SELECT COUNT(*) FROM orders o WHERE o.branch_id = b.id) AS total_orders,
        (SELECT COUNT(*) FROM orders o WHERE o.branch_id = b.id AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery')) AS active_orders
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.brand_id = ? AND (b.is_archived = 0 OR b.is_archived IS NULL)
    `).all(req.brand_id);

    res.json({ success: true, branches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14.1 Create Branch (Mandatory Branch WhatsApp Business Number - FINDING-03)
router.post('/admin/branches', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const {
      name,
      address_text,
      latitude,
      longitude,
      phone,
      whatsapp_number,
      free_delivery_km,
      price_per_km,
      max_radius_km,
      promo_min_order,
      promo_delivery_discount,
      timezone
    } = req.body;

    const rawWa = (whatsapp_number || phone || '').trim();

    // P1 BUSINESS INVARIANT (FINDING-03): Branch WhatsApp Business identity is mandatory & must be a valid mobile WA number
    if (!rawWa) {
      return res.status(400).json({
        success: false,
        error: 'Nomor WhatsApp Business cabang wajib diisi saat pendaftaran cabang.'
      });
    }

    // Validate standard Indonesian WhatsApp mobile format (e.g. 08..., 628..., +628...)
    const cleanDigits = rawWa.replace(/[^0-9]/g, '');
    const isIndoMobile = cleanDigits.startsWith('08') || cleanDigits.startsWith('628') || cleanDigits.startsWith('8');
    if (!isIndoMobile || cleanDigits.length < 9 || cleanDigits.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Format nomor WhatsApp cabang tidak valid. Harap gunakan format nomor ponsel WhatsApp aktif (contoh: 081234567890 atau 6281234567890).'
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Nama cabang wajib diisi.'
      });
    }

    const branchId = 'branch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const branchPhone = (phone || rawWa).trim();
    const branchWa = rawWa;

    const isOpenOverride = req.body.is_open_override !== undefined ? (req.body.is_open_override ? 1 : 0) : 1;
    const branchTimezone = String(timezone || 'Asia/Jakarta').trim();
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: branchTimezone }).format(new Date());
    } catch (_) {
      return res.status(400).json({ success: false, error: 'Timezone cabang tidak valid. Gunakan IANA timezone seperti Asia/Jakarta.' });
    }

    db.prepare(`
      INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, whatsapp_number, is_active, is_open_override, timezone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      branchId,
      req.brand_id,
      name.trim(),
      slug,
      address_text ? address_text.trim() : '',
      latitude !== undefined ? latitude : 0,
      longitude !== undefined ? longitude : 0,
      branchPhone,
      branchWa,
      isOpenOverride,
      branchTimezone
    );

    const deliverySettingsId = 'bds_' + branchId;
    db.prepare(`
      INSERT OR REPLACE INTO branch_delivery_settings (id, branch_id, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      deliverySettingsId,
      branchId,
      free_delivery_km !== undefined ? free_delivery_km : 0,
      price_per_km !== undefined ? price_per_km : 3000,
      max_radius_km !== undefined ? max_radius_km : 10,
      promo_min_order !== undefined ? promo_min_order : 50000,
      promo_delivery_discount !== undefined ? promo_delivery_discount : 0
    );

    res.status(201).json({
      success: true,
      message: 'Cabang berhasil didaftarkan.',
      branch_id: branchId,
      branch: {
        id: branchId,
        brand_id: req.brand_id,
        name: name.trim(),
        slug,
        phone: branchPhone,
        whatsapp_number: branchWa,
        address_text: address_text || '',
        is_active: 1,
        is_open_override: isOpenOverride,
        timezone: branchTimezone
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14.1.1 Get Single Branch Detail
router.get('/admin/branches/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan untuk mengakses cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare(`
      SELECT 
        b.id, b.brand_id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone, b.whatsapp_number, b.is_active, b.is_open_override, b.is_archived, b.timezone,
        b.created_at, b.updated_at,
        s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order,
        (SELECT COUNT(*) FROM branch_products bp WHERE bp.branch_id = b.id) AS adopted_products_count,
        (SELECT COUNT(*) FROM branch_categories bc WHERE bc.branch_id = b.id) AS branch_categories_count,
        (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.brand_id = b.brand_id) AS staff_count,
        (SELECT COUNT(*) FROM orders o WHERE o.branch_id = b.id) AS total_orders,
        (SELECT COUNT(*) FROM orders o WHERE o.branch_id = b.id AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery')) AS active_orders
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.id = ? AND b.brand_id = ? AND (b.is_archived = 0 OR b.is_archived IS NULL)
    `).get(req.params.id, req.brand_id);

    if (!branch) {
      return res.status(404).json({
        success: false,
        error: 'BRANCH_NOT_FOUND',
        message: 'Cabang tidak ditemukan pada brand ini.'
      });
    }

    res.json({ success: true, branch });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/branches/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { name, address_text, latitude, longitude, phone, whatsapp_number, is_active, is_open_override, is_delivery_active, is_pickup_active, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount, timezone, reservation_max_guests } = req.body;
    const targetPhone = phone !== undefined ? phone : null;
    const targetWa = whatsapp_number !== undefined ? whatsapp_number : null;

    // B1 OPERATIONAL STATE VALIDATION (B1.3): authoritative branch operational booleans
    // (is_active lifecycle, is_open_override open/close switch) accept ONLY 0 or 1.
    // Rejects invalid transitions instead of silently persisting arbitrary client values.
    const normBoolField = (value) => {
      if (value === undefined || value === null) return null;
      if (value === true) return 1;
      if (value === false) return 0;
      const n = Number(value);
      if (n !== 0 && n !== 1) return undefined; // sentinel: invalid
      return n;
    };
    const providedIsActive = normBoolField(is_active);
    const providedIsOpenOverride = normBoolField(is_open_override);
    if (is_active !== undefined && providedIsActive === undefined) {
      return res.status(400).json({ success: false, error: 'Nilai is_active tidak valid. Gunakan 0 atau 1.' });
    }
    if (is_open_override !== undefined && providedIsOpenOverride === undefined) {
      return res.status(400).json({ success: false, error: 'Nilai is_open_override tidak valid. Gunakan 0 atau 1.' });
    }

    // P1 TENANT WRITE BOUNDARY GUARD (FINDING 01): Verify branch ownership before ANY mutation
    // B1: full pre-mutation snapshot is captured so every authorized change is auditable (B1.10).
    const existingBranch = db.prepare(`
      SELECT id, name, address_text, latitude, longitude, phone, whatsapp_number, is_active, is_open_override, timezone
      FROM branches WHERE id = ? AND brand_id = ?
    `).get(req.params.id, req.brand_id);
    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        error: 'Cabang tidak ditemukan pada brand ini.'
      });
    }

    let normalizedTimezone = timezone === undefined
      ? (existingBranch.timezone || 'Asia/Jakarta')
      : String(timezone || '').trim();

    if (!normalizedTimezone) normalizedTimezone = 'Asia/Jakarta';

    if (timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: normalizedTimezone }).format(new Date());
      } catch (_) {
        return res.status(400).json({
          success: false,
          error: 'Timezone cabang tidak valid. Gunakan IANA timezone seperti Asia/Jakarta.'
        });
      }
    }

    if (req.user.role === 'branch_manager' &&
        timezone !== undefined &&
        normalizedTimezone !== (existingBranch.timezone || 'Asia/Jakarta')) {
      return res.status(403).json({
        success: false,
        error: 'Branch Manager tidak berwenang mengubah timezone cabang.'
      });
    }

    const existingSettings = db.prepare(`
      SELECT free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount
      FROM branch_delivery_settings WHERE branch_id = ?
    `).get(req.params.id) || {};

    // P1 RBAC BRANCH SCOPE GUARD: Branch Manager can ONLY update their assigned branch profile
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan untuk memperbarui profil cabang yang ditugaskan.'
        });
      }
      // GLOBAL BRANCH ACTIVATION GUARD: Only Owner / Brand Manager can mutate is_active
      if (is_active !== undefined) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Hanya Pemilik Toko (Owner) atau Brand Manager yang berwenang mengubah status aktivasi global cabang.'
        });
      }
      // DELIVERY SETTINGS GUARD: Branch Manager cannot change delivery fee policy (ongkir formula)
      const deliveryFields = [free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount];
      const deliveryFieldNames = ['free_delivery_km', 'price_per_km', 'max_radius_km', 'promo_min_order', 'promo_delivery_discount'];
      const hasDeliveryChange = deliveryFields.some((v, i) => v !== undefined && v !== null && String(v) !== String(Object.values(existingSettings)[i] ?? ''));
      if (hasDeliveryChange) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Hanya Pemilik Toko (Owner) atau Brand Manager yang berwenang mengubah pengaturan ongkir dan promosi pengiriman.'
        });
      }
    }

    // Kapasitas reservasi: bilangan bulat 1..1000. 0 berarti DIKOSONGKAN lagi
    // (reservasi jadi mati di aplikasi konsumen). NULL/undefined = tidak diubah,
    // karena UPDATE memakai COALESCE.
    let normalizedMaxGuests = null;
    if (reservation_max_guests !== undefined && reservation_max_guests !== null && String(reservation_max_guests).trim() !== '') {
      const n = Number(reservation_max_guests);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1000) {
        return res.status(400).json({
          success: false,
          error: 'Kapasitas maksimal reservasi harus bilangan bulat antara 0 dan 1000. Isi 0 untuk mengosongkan.'
        });
      }
      normalizedMaxGuests = n;
    }

    if (targetWa !== null && targetWa !== undefined) {
      const cleanWaDigits = String(targetWa).replace(/[^0-9]/g, '');
      const isIndoMobile = cleanWaDigits.startsWith('08') || cleanWaDigits.startsWith('628') || cleanWaDigits.startsWith('8');
      if (String(targetWa).trim() === '' || !isIndoMobile || cleanWaDigits.length < 9) {
        return res.status(400).json({
          success: false,
          error: 'Format nomor WhatsApp cabang tidak valid. Harap gunakan format nomor ponsel WhatsApp aktif.'
        });
      }
    }

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        UPDATE branches 
        SET name = COALESCE(?, name),
            address_text = COALESCE(?, address_text),
            latitude = COALESCE(?, latitude),
            longitude = COALESCE(?, longitude),
            phone = COALESCE(?, phone),
            whatsapp_number = COALESCE(?, whatsapp_number),
            is_active = COALESCE(?, is_active),
            is_open_override = COALESCE(?, is_open_override),
            timezone = COALESCE(?, timezone),
            reservation_max_guests = COALESCE(?, reservation_max_guests),
            updated_at = datetime('now')
        WHERE id = ? AND brand_id = ?
      `).run(
        name !== undefined ? name : null,
        address_text !== undefined ? address_text : null,
        latitude !== undefined ? latitude : null,
        longitude !== undefined ? longitude : null,
        targetPhone !== undefined ? targetPhone : null,
        targetWa !== undefined ? targetWa : null,
        providedIsActive,
        providedIsOpenOverride,
        timezone !== undefined ? normalizedTimezone : null,
        normalizedMaxGuests,
        req.params.id,
        req.brand_id
      );

      // Scoped update with explicit tenant subquery guard
      const normToggle = (v) => {
        if (v === undefined || v === null) return null;
        if (v === true || v === 1 || v === '1') return 1;
        if (v === false || v === 0 || v === '0') return 0;
        return null;
      };
      const providedIsDelivery = normToggle(is_delivery_active);
      const providedIsPickup = normToggle(is_pickup_active);

      db.prepare(`
        INSERT INTO branch_delivery_settings (id, branch_id, is_delivery_active, is_pickup_active, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(branch_id) DO UPDATE SET
          is_delivery_active = COALESCE(excluded.is_delivery_active, branch_delivery_settings.is_delivery_active),
          is_pickup_active = COALESCE(excluded.is_pickup_active, branch_delivery_settings.is_pickup_active),
          free_delivery_km = COALESCE(excluded.free_delivery_km, branch_delivery_settings.free_delivery_km),
          price_per_km = COALESCE(excluded.price_per_km, branch_delivery_settings.price_per_km),
          max_radius_km = COALESCE(excluded.max_radius_km, branch_delivery_settings.max_radius_km),
          promo_min_order = COALESCE(excluded.promo_min_order, branch_delivery_settings.promo_min_order),
          promo_delivery_discount = COALESCE(excluded.promo_delivery_discount, branch_delivery_settings.promo_delivery_discount),
          updated_at = datetime('now')
      `).run(
        'bds_' + req.params.id,
        req.params.id,
        providedIsDelivery,
        providedIsPickup,
        free_delivery_km !== undefined ? free_delivery_km : null,
        price_per_km !== undefined ? price_per_km : null,
        max_radius_km !== undefined ? max_radius_km : null,
        promo_min_order !== undefined ? promo_min_order : null,
        promo_delivery_discount !== undefined ? promo_delivery_discount : null
      );

      // B1 OPERATIONAL AUDIT TRAIL (B1.10): append-only branch_operation_logs rows for every
      // field actually changed by this AUTHORIZED mutation. Records what changed, which branch,
      // who performed it (actor id + role), and that authorization/scope was satisfied.
      const stringifyScalar = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
      const normNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
      const scalarChanged = (prev, next, isNum) => {
        const p = prev === undefined ? null : prev;
        const n = next === undefined ? null : next;
        if (p === null && n === null) return false;
        if (p === null || n === null) return true;
        if (isNum) return Number(p) !== Number(n);
        return String(p) !== String(n);
      };

      const prevOpen = (existingBranch.is_open_override === null || existingBranch.is_open_override === undefined) ? 1 : existingBranch.is_open_override;
      const tracked = [
        { field: 'name', prev: existingBranch.name, next: name !== undefined ? String(name) : existingBranch.name, isNum: false },
        { field: 'address_text', prev: existingBranch.address_text, next: address_text !== undefined ? String(address_text) : existingBranch.address_text, isNum: false },
        { field: 'latitude', prev: existingBranch.latitude, next: latitude !== undefined ? normNum(latitude) : existingBranch.latitude, isNum: true },
        { field: 'longitude', prev: existingBranch.longitude, next: longitude !== undefined ? normNum(longitude) : existingBranch.longitude, isNum: true },
        { field: 'phone', prev: existingBranch.phone, next: targetPhone !== undefined ? String(targetPhone) : existingBranch.phone, isNum: false },
        { field: 'whatsapp_number', prev: existingBranch.whatsapp_number || null, next: targetWa !== undefined ? String(targetWa) : (existingBranch.whatsapp_number || null), isNum: false },
        { field: 'is_active', prev: existingBranch.is_active, next: providedIsActive !== null ? providedIsActive : existingBranch.is_active, isNum: true },
        { field: 'is_open_override', prev: prevOpen, next: providedIsOpenOverride !== null ? providedIsOpenOverride : prevOpen, isNum: true },
        { field: 'timezone', prev: existingBranch.timezone || 'Asia/Jakarta', next: timezone !== undefined ? normalizedTimezone : (existingBranch.timezone || 'Asia/Jakarta'), isNum: false }
      ];

      const hadSettingsRow = Boolean(db.prepare('SELECT 1 FROM branch_delivery_settings WHERE branch_id = ?').get(req.params.id));
      if (hadSettingsRow) {
        const sPrev = existingSettings;
        tracked.push(
          { field: 'free_delivery_km', prev: sPrev.free_delivery_km, next: free_delivery_km !== undefined ? normNum(free_delivery_km) : sPrev.free_delivery_km, isNum: true },
          { field: 'price_per_km', prev: sPrev.price_per_km, next: price_per_km !== undefined ? normNum(price_per_km) : sPrev.price_per_km, isNum: true },
          { field: 'max_radius_km', prev: sPrev.max_radius_km, next: max_radius_km !== undefined ? normNum(max_radius_km) : sPrev.max_radius_km, isNum: true },
          { field: 'promo_min_order', prev: sPrev.promo_min_order, next: promo_min_order !== undefined ? normNum(promo_min_order) : sPrev.promo_min_order, isNum: true },
          { field: 'promo_delivery_discount', prev: sPrev.promo_delivery_discount, next: promo_delivery_discount !== undefined ? normNum(promo_delivery_discount) : sPrev.promo_delivery_discount, isNum: true }
        );
      }

      const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
      const actorRole = req.user ? (req.user.role || 'system') : 'system';
      for (const t of tracked) {
        if (!scalarChanged(t.prev, t.next, t.isNum)) continue;
        db.prepare(`
          INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
          VALUES (?, ?, ?, ?, 'branch.update', ?, ?, ?, ?, ?, 1)
        `).run(
          'bol_' + crypto.randomUUID(),
          existingBranch.id,
          req.brand_id,
          req.organization_id || null,
          t.field,
          stringifyScalar(t.prev),
          stringifyScalar(t.next),
          actorId,
          actorRole
        );
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({
      success: true,
      message: 'Pengaturan cabang & ongkir berhasil disimpan.',
      branch: {
        id: existingBranch.id,
        is_active: providedIsActive !== null ? providedIsActive : existingBranch.is_active,
        is_open_override: providedIsOpenOverride !== null ? providedIsOpenOverride : (existingBranch.is_open_override == null ? 1 : existingBranch.is_open_override),
        timezone: timezone !== undefined ? normalizedTimezone : (existingBranch.timezone || 'Asia/Jakarta')
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/branches/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const existing = db.prepare('SELECT id, name, is_active, is_archived FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Cabang tidak ditemukan pada brand ini.'
      });
    }

    // Active orders in progress
    const activeOrderRow = db.prepare(`
      SELECT COUNT(*) as count FROM orders 
      WHERE branch_id = ? AND status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
    `).get(req.params.id);
    const activeOrders = (activeOrderRow && activeOrderRow.count) ? activeOrderRow.count : 0;

    // Total order history
    const totalOrderRow = db.prepare('SELECT COUNT(*) as count FROM orders WHERE branch_id = ?').get(req.params.id);
    const totalOrders = (totalOrderRow && totalOrderRow.count) ? totalOrderRow.count : 0;

    const isBranchActive = existing.is_active === 1 || existing.is_active === true;

    // Rule 1: Cabang aktif dengan pesanan aktif -> tidak boleh dihapus.
    if (isBranchActive && activeOrders > 0) {
      return res.status(400).json({
        success: false,
        error: `Cabang "${existing.name}" masih aktif dan sedang melayani ${activeOrders} pesanan aktif. Selesaikan atau batalkan pesanan terlebih dahulu sebelum memproses cabang ini.`
      });
    }

    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';

    // Rule 2: Cabang nonaktif yang memiliki riwayat transaksi -> jangan hard delete, gunakan Archive.
    if (totalOrders > 0) {
      db.exec('BEGIN TRANSACTION;');
      try {
        db.prepare('UPDATE branches SET is_archived = 1, updated_at = datetime(\'now\') WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);

        db.prepare(`
          INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
          VALUES (?, ?, ?, ?, 'branch.archive', 'is_archived', '0', '1', ?, ?, 1)
        `).run(
          'bol_' + crypto.randomUUID(),
          existing.id,
          req.brand_id,
          req.organization_id || null,
          actorId,
          actorRole
        );

        db.exec('COMMIT;');
      } catch (txErr) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
        throw txErr;
      }

      return res.json({
        success: true,
        archived: true,
        message: `Cabang "${existing.name}" berhasil diarsipkan karena memiliki riwayat transaksi. Data riwayat pesanan tetap tersimpan dengan aman.`,
        branch_id: req.params.id
      });
    }

    // Rule 3: Cabang nonaktif tanpa riwayat transaksi -> boleh dihapus permanen.
    db.exec('BEGIN TRANSACTION;');
    try {
      // Unlink users assigned to this branch
      db.prepare('UPDATE users SET branch_id = NULL WHERE branch_id = ?').run(req.params.id);

      // Clean up child tables
      db.prepare('DELETE FROM branch_delivery_settings WHERE branch_id = ?').run(req.params.id);
      db.prepare('DELETE FROM branch_products WHERE branch_id = ?').run(req.params.id);
      db.prepare('DELETE FROM branch_categories WHERE branch_id = ?').run(req.params.id);
      db.prepare('DELETE FROM branch_operation_logs WHERE branch_id = ?').run(req.params.id);

      // Delete the branch row
      db.prepare('DELETE FROM branches WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);

      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({
      success: true,
      archived: false,
      message: `Cabang "${existing.name}" berhasil dihapus permanen.`,
      branch_id: req.params.id
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14.1.3 Get Branch Operational Activity Logs
router.get('/admin/branches/:id/operation-logs', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan untuk melihat log cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        error: 'BRANCH_NOT_FOUND',
        message: 'Cabang tidak ditemukan pada brand ini.'
      });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const logs = db.prepare(`
      SELECT id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized, created_at
      FROM branch_operation_logs
      WHERE branch_id = ? AND brand_id = ?
      ORDER BY datetime(created_at) DESC, rowid DESC
      LIMIT ?
    `).all(req.params.id, req.brand_id, limit);

    res.json({
      success: true,
      logs: logs || []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================================
   C1 — PRODUCT → BRANCH ASSIGNMENT BOUNDARY
   Product Master stays brand-owned (products.brand_id). A branch_products row
   is the EXPLICIT assignment of a brand product to a branch of the SAME brand.
   - Assignment (create/list) = Owner / Brand authority.
   - Operational availability toggle (is_available) = Branch Manager within
     their own branch, or Owner / Brand.
   - Assignment NEVER mutates stock: physical stock belongs to the Inventory
     domain and is intentionally not fabricated here (stock stays NULL).
   ========================================================================= */

// C1 List assignments of one branch

};
