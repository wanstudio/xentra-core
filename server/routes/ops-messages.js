'use strict';

/**
 * XENTRA CORE — OPERATIONAL MESSAGING ROUTES (OPS-MESSAGES v3)
 *
 * Full-Screen "One Task, One Layer" Multi-Branch Operational Communication
 * with WhatsApp-grade Message Lifecycle Semantics:
 * - Dedicated Division Channels per Branch (`channel:<branch_id>:<role>`)
 * - 1-Way Branch / Brand Announcement Bulletin (`broadcast:<branch_id|all>`)
 * - Contextual Work-Object Threads (`order:<id>`, `delivery:<id>`, `purchasing:<id>`)
 * - Per-User Clear Chat (`DELETE /api/v1/messages/thread` -> records `cleared_at` in `ops_thread_clears`
 *   ONLY for the requesting user; other participants' chat history & audit trail remain 100% intact)
 * - Sender-Only Unsend / Delete for Everyone (`DELETE /api/v1/messages/:id` -> only `sender_user_id`
 *   may retract their own non-receipt message, leaving a transparent `🚫 Pesan ini telah ditarik` tombstone)
 * - Per-message Delivery & Read Status (`✓` Terkirim vs `✓✓` Dibaca)
 */
const crypto = require('crypto');
const sharp = require('sharp');

const ALLOWED_STAFF_ROLES = [
  'owner',
  'brand_manager',
  'branch_manager',
  'cashier',
  'kitchen',
  'driver',
  'purchasing'
];

const CHANNEL_DEFINITIONS = {
  branch_manager: {
    key: 'branch_manager',
    icon: '👔',
    title: 'Kepala Cabang',
    subtitle: 'Koordinasi langsung Owner & Kepala Cabang',
    allowedViewRoles: ['owner', 'brand_manager', 'branch_manager'],
    allowedSendRoles: ['owner', 'brand_manager', 'branch_manager'],
    notifyRoles: ['owner', 'branch_manager']
  },
  cashier: {
    key: 'cashier',
    icon: '🖥️',
    title: 'Kasir & Dapur',
    subtitle: 'Operasional harian kasir, dapur & pelayanan toko',
    allowedViewRoles: ['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'],
    allowedSendRoles: ['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'],
    notifyRoles: ['branch_manager', 'cashier', 'kitchen']
  },
  purchasing: {
    key: 'purchasing',
    icon: '🛒',
    title: 'Tim Belanja Pasar',
    subtitle: 'Koordinasi belanja bahan baku & foto struk harian',
    allowedViewRoles: ['owner', 'brand_manager', 'branch_manager', 'purchasing'],
    allowedSendRoles: ['owner', 'brand_manager', 'branch_manager', 'purchasing'],
    notifyRoles: ['owner', 'branch_manager', 'purchasing']
  },
  driver: {
    key: 'driver',
    icon: '🛵',
    title: 'Koordinasi Kurir Cabang',
    subtitle: 'Komunikasi Kasir / Kepala Cabang & Kurir (Owner: Audit)',
    allowedViewRoles: ['owner', 'brand_manager', 'branch_manager', 'cashier', 'driver'],
    allowedSendRoles: ['branch_manager', 'cashier', 'driver'],
    notifyRoles: ['branch_manager', 'cashier', 'driver']
  }
};

function registerOpsMessageRoutes(router, deps = {}) {
  const { db, requireAuth, notificationService, mediaService } = deps;
  const staffAuth = requireAuth(ALLOWED_STAFF_ROLES);

  function actorId(req) {
    return (req.user && (req.user.userId || req.user.id)) || null;
  }

  function actorBranchId(req) {
    return (req.user && (req.user.branchId || req.user.branch_id)) || null;
  }

  function actorRole(req) {
    return (req.user && req.user.role) || '';
  }

  function isBrandLevelRole(role) {
    return role === 'owner' || role === 'brand_manager';
  }

  function resolveActorName(userId) {
    if (!userId) return 'Staf';
    try {
      const row = db.prepare('SELECT full_name, username, role FROM users WHERE id = ? LIMIT 1').get(userId);
      if (row) return row.full_name || row.username || row.role || 'Staf';
    } catch (_) {}
    return 'Staf';
  }

  function getActiveBranches(brandId) {
    try {
      return db.prepare(`
        SELECT id, name, slug, address_text, is_active
        FROM branches
        WHERE brand_id = ? AND (is_archived IS NULL OR is_archived = 0)
        ORDER BY is_active DESC, name ASC
      `).all(brandId) || [];
    } catch (_) {
      return [];
    }
  }

  function resolveBranchName(brandId, branchId) {
    if (!branchId || branchId === 'all') return 'Semua Cabang';
    try {
      const row = db.prepare('SELECT name FROM branches WHERE id = ? AND brand_id = ? LIMIT 1').get(branchId, brandId);
      if (row && row.name) return row.name;
    } catch (_) {}
    return 'Cabang';
  }

  function resolveDefaultBranchId(brandId, preferredBranchId) {
    const branches = getActiveBranches(brandId);
    if (preferredBranchId && branches.some(b => String(b.id) === String(preferredBranchId))) {
      return preferredBranchId;
    }
    return branches.length ? branches[0].id : null;
  }

  function resolveMediaUrl(storageKey) {
    if (!storageKey) return null;
    if (mediaService && mediaService.storage && typeof mediaService.storage.resolveUrl === 'function') {
      return mediaService.storage.resolveUrl(storageKey);
    }
    return '/assets/uploads/' + String(storageKey).replace(/^\/+/, '');
  }

  /**
   * Look up per-user `cleared_at` timestamp for a given room (`ops_thread_clears`).
   */
  function getUserThreadClearedAt(userId, threadType, canonicalRefId, rawRefId) {
    if (!userId || !threadType) return null;
    try {
      const row = db.prepare(`
        SELECT cleared_at
        FROM ops_thread_clears
        WHERE user_id = ?
          AND thread_type = ?
          AND (thread_ref_id = ? OR thread_ref_id = ?)
        ORDER BY datetime(cleared_at) DESC
        LIMIT 1
      `).get(userId, threadType, canonicalRefId || '', rawRefId || canonicalRefId || '');
      return (row && row.cleared_at) || null;
    } catch (_) {
      return null;
    }
  }

  // Lazy 90-day retention purge for non-receipt chat images (runs at most once per 6 hours)
  let _lastPurgeAt = 0;
  async function maybePurgeExpiredChatMedia() {
    const now = Date.now();
    if (now - _lastPurgeAt < 6 * 3600 * 1000) return;
    _lastPurgeAt = now;
    try {
      const expired = db.prepare(`
        SELECT id, image_full_key, image_thumb_key
        FROM ops_messages
        WHERE is_receipt = 0
          AND media_purged_at IS NULL
          AND (image_full_key IS NOT NULL OR image_thumb_key IS NOT NULL)
          AND datetime(created_at) < datetime('now', '-90 days')
        LIMIT 50
      `).all();

      if (!expired || !expired.length) return;
      for (const row of expired) {
        if (mediaService && mediaService.storage) {
          if (row.image_full_key) {
            try { await mediaService.storage.delete(row.image_full_key); } catch (_) {}
          }
          if (row.image_thumb_key) {
            try { await mediaService.storage.delete(row.image_thumb_key); } catch (_) {}
          }
        }
        db.prepare(`
          UPDATE ops_messages
          SET image_full_key = NULL, image_thumb_key = NULL, media_purged_at = datetime('now')
          WHERE id = ?
        `).run(row.id);
      }
    } catch (_) {}
  }

  /**
   * Parse `channel` refId format: `<branch_id>:<channel_key>` or `<channel_key>`
   */
  function parseChannelRef(brandId, rawRefId, fallbackBranchId) {
    const str = String(rawRefId || '').trim();
    let branchId = fallbackBranchId || null;
    let channelKey = str;

    if (str.includes(':')) {
      const idx = str.lastIndexOf(':');
      branchId = str.slice(0, idx).trim();
      channelKey = str.slice(idx + 1).trim();
    }

    if (!branchId || branchId === 'default' || branchId === 'all') {
      branchId = resolveDefaultBranchId(brandId, fallbackBranchId);
    }

    return {
      branchId,
      channelKey,
      canonicalRefId: branchId ? `${branchId}:${channelKey}` : channelKey
    };
  }

  /**
   * Resolve context metadata, branch ownership, and access rules for a thread.
   */
  function resolveThreadContext({ brandId, threadType, refId, req }) {
    const role = actorRole(req);
    const userBranchId = actorBranchId(req);
    const uid = actorId(req);

    // 1. DIVISION CHANNEL PER BRANCH (`channel`)
    if (threadType === 'channel') {
      const requestedBranch = (req.query && req.query.branch_id) || (req.body && req.body.branch_id) || userBranchId;
      const parsed = parseChannelRef(brandId, refId, requestedBranch);
      const def = CHANNEL_DEFINITIONS[parsed.channelKey];

      if (!def) {
        return { ok: false, status: 400, error: 'Saluran divisi tidak dikenali.' };
      }

      if (!isBrandLevelRole(role) && userBranchId && parsed.branchId && String(parsed.branchId) !== String(userBranchId)) {
        return { ok: false, status: 403, error: 'FORBIDDEN_BRANCH_SCOPE: Anda hanya dapat mengakses saluran cabang Anda sendiri.' };
      }

      if (!def.allowedViewRoles.includes(role)) {
        return { ok: false, status: 403, error: 'Peran Anda tidak memiliki akses ke saluran divisi ini.' };
      }

      const branchName = resolveBranchName(brandId, parsed.branchId);
      const canSend = def.allowedSendRoles.includes(role);

      return {
        ok: true,
        canonicalRefId: parsed.canonicalRefId,
        channelKey: parsed.channelKey,
        branchId: parsed.branchId,
        branchName,
        icon: def.icon,
        title: `${def.icon} ${def.title}`,
        subtitle: def.subtitle,
        readOnly: !canSend,
        readOnlyReason: !canSend
          ? 'Mode Audit Owner: Koordinasi kurir dilakukan langsung oleh Kasir / Kepala Cabang.'
          : null,
        canClearForMe: true
      };
    }

    // 2. BRANCH / BRAND ANNOUNCEMENT BULLETIN (`broadcast`)
    if (threadType === 'broadcast') {
      const requestedBranch = (req.query && req.query.branch_id) || (req.body && req.body.branch_id) || null;
      let targetBranchId = refId && refId !== 'all' ? refId : (requestedBranch || userBranchId || resolveDefaultBranchId(brandId, null));
      if (!isBrandLevelRole(role) && userBranchId) {
        targetBranchId = userBranchId;
      }
      const canonicalRefId = targetBranchId || 'all';
      const branchName = resolveBranchName(brandId, canonicalRefId);
      const canPost = ['owner', 'brand_manager', 'branch_manager'].includes(role);

      return {
        ok: true,
        canonicalRefId,
        branchId: canonicalRefId === 'all' ? null : canonicalRefId,
        branchName,
        icon: '📢',
        title: '📢 Papan Pengumuman Cabang',
        subtitle: 'Instruksi resmi manajemen ke seluruh staf cabang',
        readOnly: !canPost,
        readOnlyReason: 'Hanya Owner / Kepala Cabang yang dapat menulis di Papan Pengumuman.',
        canClearForMe: true
      };
    }

    // 3. ORDER / DELIVERY CONTEXT THREAD (`order` | `delivery`)
    if (threadType === 'delivery' || threadType === 'order') {
      if (!refId) {
        return { ok: false, status: 400, error: 'ID Pesanan / Pengantaran wajib diisi.' };
      }
      const order = db.prepare(`
        SELECT o.id, o.order_number, o.brand_id, o.branch_id, o.status AS order_status,
               o.customer_name, o.recipient_name,
               d.driver_id, d.driver_name, d.status AS delivery_status
        FROM orders o
        LEFT JOIN order_deliveries d ON d.order_id = o.id
        WHERE (o.id = ? OR o.order_number = ?) AND o.brand_id = ?
        LIMIT 1
      `).get(refId, refId, brandId);

      if (!order) {
        const existingMsg = db.prepare(`
          SELECT branch_id FROM ops_messages
          WHERE brand_id = ? AND thread_type = ? AND thread_ref_id = ?
          LIMIT 1
        `).get(brandId, threadType, refId);
        if (!existingMsg) {
          return { ok: false, status: 404, error: 'Data pesanan atau pengantaran tidak ditemukan.' };
        }
        const bName = resolveBranchName(brandId, existingMsg.branch_id);
        return {
          ok: true,
          canonicalRefId: refId,
          branchId: existingMsg.branch_id,
          branchName: bName,
          icon: threadType === 'delivery' ? '🛵' : '🧾',
          title: (threadType === 'delivery' ? 'Pengantaran ' : 'Pesanan ') + refId,
          subtitle: 'Riwayat percakapan pesanan',
          readOnly: true,
          readOnlyReason: 'Data pesanan sudah diarsipkan.',
          canClearForMe: true
        };
      }

      if (!isBrandLevelRole(role) && userBranchId && order.branch_id && String(order.branch_id) !== String(userBranchId)) {
        return { ok: false, status: 403, error: 'FORBIDDEN_BRANCH_SCOPE: Anda tidak memiliki akses ke cabang pesanan ini.' };
      }

      if (role === 'driver') {
        if (threadType !== 'delivery') {
          return { ok: false, status: 403, error: 'Driver hanya dapat mengakses percakapan pengantaran.' };
        }
        if (order.driver_id && String(order.driver_id) !== String(uid)) {
          return { ok: false, status: 403, error: 'Tugas pengantaran ini bukan milik Anda.' };
        }
      }

      const isCompleted = (threadType === 'delivery' && order.delivery_status === 'delivered') ||
                          (threadType === 'order' && ['completed', 'cancelled', 'rejected'].includes(order.order_status));
      const isOwnerViewingDelivery = (threadType === 'delivery' && isBrandLevelRole(role));
      const isReadOnly = Boolean(isCompleted || isOwnerViewingDelivery);

      let readOnlyReason = null;
      if (isCompleted) {
        readOnlyReason = 'Pengantaran/pesanan telah selesai (hanya baca).';
      } else if (isOwnerViewingDelivery) {
        readOnlyReason = 'Mode Audit Owner: Koordinasi pengantaran dilakukan antara Kurir & Kasir/Kepala Cabang.';
      }

      const branchName = resolveBranchName(brandId, order.branch_id);

      return {
        ok: true,
        canonicalRefId: order.id,
        branchId: order.branch_id,
        branchName,
        icon: threadType === 'delivery' ? '🛵' : '🧾',
        title: (threadType === 'delivery' ? 'Pengantaran ' : 'Pesanan ') + (order.order_number || order.id),
        subtitle: (order.recipient_name || order.customer_name || 'Pelanggan') +
                  (order.driver_name ? ' • Kurir: ' + order.driver_name : ''),
        order,
        readOnly: isReadOnly,
        readOnlyReason,
        canClearForMe: true
      };
    }

    // 4. PURCHASING / MANDATE CONTEXT THREAD (`purchasing`)
    if (threadType === 'purchasing') {
      if (!refId) {
        return { ok: false, status: 400, error: 'ID Mandat Belanja / PO wajib diisi.' };
      }
      if (role === 'driver') {
        return { ok: false, status: 403, error: 'Driver tidak memiliki akses ke percakapan belanja.' };
      }

      if (refId === 'daily' || refId.startsWith('daily:')) {
        const requestedBranch = (req.query && req.query.branch_id) || (req.body && req.body.branch_id) || userBranchId;
        const targetBranch = resolveDefaultBranchId(brandId, requestedBranch);
        const bName = resolveBranchName(brandId, targetBranch);
        return {
          ok: true,
          canonicalRefId: targetBranch ? `daily_${targetBranch}` : 'daily',
          branchId: targetBranch,
          branchName: bName,
          icon: '🛒',
          title: '🛒 Belanja Pasar & Foto Struk',
          subtitle: 'Koordinasi belanja harian & lampiran nota permanen',
          readOnly: false,
          readOnlyReason: null,
          canClearForMe: true
        };
      }

      let branchId = userBranchId || resolveDefaultBranchId(brandId, null);
      let label = refId;
      let subtitle = 'Koordinasi Belanja & Bukti Struk';

      const mandate = db.prepare(`
        SELECT id, mandate_number, branch_id, status, total_planned_budget
        FROM purchasing_mandates
        WHERE id = ? OR mandate_number = ?
        LIMIT 1
      `).get(refId, refId);

      if (mandate) {
        branchId = mandate.branch_id || branchId;
        label = mandate.mandate_number || ('#' + String(mandate.id).slice(-6));
        subtitle = 'Mandat Belanja Pasar • Status: ' + (mandate.status || 'AKTIF');
      } else {
        const ipo = db.prepare(`
          SELECT id, po_number, branch_id, supplier_name, status
          FROM inventory_purchase_orders
          WHERE (id = ? OR po_number = ?) AND brand_id = ?
          LIMIT 1
        `).get(refId, refId, brandId);
        if (ipo) {
          branchId = ipo.branch_id || branchId;
          label = ipo.po_number || ipo.id;
          subtitle = 'PO Supplier: ' + (ipo.supplier_name || '-') + ' • ' + (ipo.status || '');
        }
      }

      if (!isBrandLevelRole(role) && userBranchId && branchId && String(branchId) !== String(userBranchId)) {
        return { ok: false, status: 403, error: 'FORBIDDEN_BRANCH_SCOPE: Anda tidak memiliki akses ke cabang belanja ini.' };
      }

      const branchName = resolveBranchName(brandId, branchId);

      return {
        ok: true,
        canonicalRefId: mandate ? mandate.id : refId,
        branchId: branchId || null,
        branchName,
        icon: '🛒',
        title: 'Mandat Belanja ' + label,
        subtitle,
        readOnly: false,
        readOnlyReason,
        canClearForMe: true
      };
    }

    return { ok: false, status: 400, error: 'Tipe percakapan (thread_type) tidak valid.' };
  }

  /**
   * Process and compress base64 image via sharp into WebP full (max 1600px) + thumb (320px).
   */
  async function processChatImage({ brandId, messageId, imageBase64 }) {
    const cleaned = String(imageBase64 || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    const inputBuffer = Buffer.from(cleaned, 'base64');
    if (!inputBuffer.length || inputBuffer.length > 10 * 1024 * 1024) {
      throw new Error('Ukuran gambar tidak valid atau melebihi batas 10 MB.');
    }

    const fullBuffer = await sharp(inputBuffer, { failOnError: false })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const thumbBuffer = await sharp(fullBuffer, { failOnError: false })
      .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();

    const fullKey = `derivatives/${brandId}/chat/${messageId}_full.webp`;
    const thumbKey = `derivatives/${brandId}/chat/${messageId}_thumb.webp`;

    if (mediaService && mediaService.storage) {
      await mediaService.storage.write(fullKey, fullBuffer);
      await mediaService.storage.write(thumbKey, thumbBuffer);
    }

    return { fullKey, thumbKey };
  }

  function formatMessageRow(row, brandId, currentUserId, latestPeerReadIso) {
    if (!row) return null;
    const isRetracted = Boolean(row.retracted_at);
    const isMine = Boolean(currentUserId && String(row.sender_user_id) === String(currentUserId));
    // A sent message is considered read by peers if any peer read notification at or after message creation
    const isReadByPeer = Boolean(isMine && latestPeerReadIso && row.created_at && String(latestPeerReadIso) >= String(row.created_at));
    // Sender can unsend their own non-retracted, non-receipt message within 60 minutes (WhatsApp rule)
    let canRetract = false;
    if (isMine && !isRetracted && !row.is_receipt && row.created_at) {
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (!isNaN(ageMs) && ageMs <= 60 * 60 * 1000) {
        canRetract = true;
      }
    }

    return {
      id: row.id,
      brand_id: row.brand_id,
      branch_id: row.branch_id,
      branch_name: row.branch_id ? resolveBranchName(brandId || row.brand_id, row.branch_id) : 'Semua Cabang',
      thread_type: row.thread_type,
      thread_ref_id: row.thread_ref_id,
      sender_user_id: row.sender_user_id,
      sender_role: row.sender_role,
      sender_name: row.sender_name || 'Staf',
      target_role: row.target_role || null,
      body: isRetracted ? '🚫 Pesan ini telah ditarik' : (row.body || ''),
      quick_code: isRetracted ? null : (row.quick_code || null),
      image_url: isRetracted ? null : resolveMediaUrl(row.image_full_key),
      thumb_url: isRetracted ? null : resolveMediaUrl(row.image_thumb_key || row.image_full_key),
      is_receipt: isRetracted ? false : Boolean(row.is_receipt),
      media_purged: Boolean(row.media_purged_at),
      retracted: isRetracted,
      can_retract: canRetract,
      delivery_status: isMine ? (isReadByPeer ? 'read' : 'sent') : null,
      created_at: row.created_at
    };
  }

  // 1. GET /api/v1/messages — Fetch messages for a specific room/thread (respecting per-user cleared_at cutoff!)
  router.get('/messages', staffAuth, (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      maybePurgeExpiredChatMedia();

      const brandId = req.brand_id || (req.user && req.user.brand_id);
      const userId = actorId(req);
      const threadType = String(req.query.thread_type || '').trim();
      const refId = String(req.query.ref_id || '').trim();
      const since = String(req.query.since || '').trim();

      const ctx = resolveThreadContext({ brandId, threadType, refId, req });
      if (!ctx.ok) {
        return res.status(ctx.status || 400).json({ success: false, error: ctx.error });
      }

      // Per-user Clear Chat cutoff (WhatsApp "Clear Chat for Me" behavior)
      const clearedAt = getUserThreadClearedAt(userId, threadType, ctx.canonicalRefId, refId);

      let sql = `
        SELECT *
        FROM ops_messages
        WHERE brand_id = ? AND thread_type = ?
      `;
      const params = [brandId, threadType];

      if (threadType === 'broadcast') {
        if (ctx.branchId) {
          sql += ` AND (branch_id = ? OR branch_id IS NULL OR branch_id = '' OR thread_ref_id = ?)`;
          params.push(ctx.branchId, ctx.canonicalRefId);
        }
      } else {
        sql += ` AND (thread_ref_id = ? OR thread_ref_id = ?)`;
        params.push(ctx.canonicalRefId, refId);
      }

      if (clearedAt) {
        sql += ` AND datetime(created_at) > datetime(?)`;
        params.push(clearedAt);
      }

      if (since) {
        sql += ` AND datetime(created_at) > datetime(?)`;
        params.push(since);
      }

      sql += ` ORDER BY datetime(created_at) ASC, rowid ASC LIMIT 150`;

      const rows = db.prepare(sql).all(...params) || [];

      // Compute latest peer read timestamp for `✓✓` read status on sender's messages
      let latestPeerReadIso = null;
      try {
        const peerReadRow = db.prepare(`
          SELECT MAX(nr.read_at) AS max_read_at
          FROM notification_recipients nr
          JOIN notifications n ON n.id = nr.notification_id
          WHERE n.brand_id = ?
            AND n.related_entity_type = ?
            AND (n.related_entity_id = ? OR n.related_entity_id = ?)
            AND nr.user_id != ?
            AND nr.read_at IS NOT NULL
        `).get(brandId, threadType, ctx.canonicalRefId, refId, userId);
        if (peerReadRow && peerReadRow.max_read_at) {
          latestPeerReadIso = peerReadRow.max_read_at;
        }
      } catch (_) {}

      const messages = rows.map(r => formatMessageRow(r, brandId, userId, latestPeerReadIso));

      // Attach read-receipt summary for broadcast bulletin
      let broadcastReceipts = null;
      if (threadType === 'broadcast') {
        try {
          broadcastReceipts = db.prepare(`
            SELECT n.id AS notification_id,
                   n.title,
                   COUNT(nr.id) AS total_recipients,
                   SUM(CASE WHEN nr.read_at IS NOT NULL THEN 1 ELSE 0 END) AS read_count
            FROM notifications n
            JOIN notification_recipients nr ON nr.notification_id = n.id
            WHERE n.brand_id = ? AND n.source_type = 'ops_broadcast'
            GROUP BY n.id
            ORDER BY datetime(n.created_at) DESC
            LIMIT 50
          `).all(brandId);
        } catch (_) {}
      }

      res.json({
        success: true,
        thread: {
          thread_type: threadType,
          ref_id: ctx.canonicalRefId,
          branch_id: ctx.branchId,
          branch_name: ctx.branchName,
          icon: ctx.icon,
          title: ctx.title,
          subtitle: ctx.subtitle,
          read_only: ctx.readOnly,
          read_only_reason: ctx.readOnlyReason,
          can_clear: messages.length > 0
        },
        messages,
        broadcast_receipts: broadcastReceipts
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. POST /api/v1/messages — Send message to a specific room/channel/thread
  router.post('/messages', staffAuth, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const brandId = req.brand_id || (req.user && req.user.brand_id);
      const userId = actorId(req);
      const role = actorRole(req);
      const bodyObj = req.body || {};

      const threadType = String(bodyObj.thread_type || '').trim();
      const refId = String(bodyObj.ref_id || bodyObj.thread_ref_id || '').trim();
      const textBody = String(bodyObj.body || '').trim();
      const quickCode = bodyObj.quick_code ? String(bodyObj.quick_code).trim() : null;
      const imageBase64 = bodyObj.image_base64 || null;

      if (!textBody && !imageBase64) {
        return res.status(400).json({ success: false, error: 'Pesan teks atau foto wajib diisi.' });
      }
      if (textBody.length > 500) {
        return res.status(400).json({ success: false, error: 'Pesan maksimal 500 karakter.' });
      }

      const ctx = resolveThreadContext({ brandId, threadType, refId, req });
      if (!ctx.ok) {
        return res.status(ctx.status || 400).json({ success: false, error: ctx.error });
      }
      if (ctx.readOnly) {
        return res.status(409).json({
          success: false,
          code: 'THREAD_READ_ONLY',
          error: ctx.readOnlyReason || 'Ruang percakapan ini hanya baca.'
        });
      }

      const isPurchasingRoom = threadType === 'purchasing' || (threadType === 'channel' && ctx.channelKey === 'purchasing');
      const isReceipt = (isPurchasingRoom && (bodyObj.is_receipt === true || bodyObj.is_receipt === 1 || Boolean(imageBase64))) ? 1 : 0;

      const msgId = 'msg_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
      const senderName = resolveActorName(userId);
      const nowIso = new Date().toISOString();

      let imageFullKey = null;
      let imageThumbKey = null;
      if (imageBase64) {
        const processed = await processChatImage({
          brandId,
          messageId: msgId,
          imageBase64
        });
        imageFullKey = processed.fullKey;
        imageThumbKey = processed.thumbKey;
      }

      const effectiveRefId = ctx.canonicalRefId;
      const targetRole = threadType === 'channel' ? ctx.channelKey : null;

      db.prepare(`
        INSERT INTO ops_messages (
          id, brand_id, branch_id, thread_type, thread_ref_id,
          sender_user_id, sender_role, sender_name, target_role,
          body, quick_code, image_full_key, image_thumb_key, is_receipt, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        msgId,
        brandId,
        ctx.branchId,
        threadType,
        effectiveRefId,
        userId,
        role,
        senderName,
        targetRole,
        textBody || (isReceipt ? '📷 Foto Struk Belanja' : '📷 Mengirim foto'),
        quickCode,
        imageFullKey,
        imageThumbKey,
        isReceipt,
        nowIso
      );

      // Fan-out notification via NotificationService
      if (notificationService) {
        try {
          const previewText = textBody || (isReceipt ? '📷 Mengunggah foto struk belanja' : '📷 Mengirim foto');
          const branchBadge = ctx.branchName ? `[${ctx.branchName}] ` : '';

          if (threadType === 'broadcast') {
            const notif = notificationService.createNotification({
              brand_id: brandId,
              branch_id: ctx.branchId,
              source_type: 'ops_broadcast',
              source_actor_id: userId,
              title: `📢 ${branchBadge}Pengumuman dari ${senderName}`,
              body: previewText,
              priority: 'high',
              target_role: null,
              related_entity_type: 'broadcast',
              related_entity_id: effectiveRefId,
              action_url: '/merchant-app/#hari-ini'
            });
            if (notif && notif.id) {
              db.prepare('UPDATE notification_recipients SET read_at = ? WHERE notification_id = ? AND user_id = ?').run(nowIso, notif.id, userId);
            }
          } else if (threadType === 'channel') {
            const def = CHANNEL_DEFINITIONS[ctx.channelKey];
            const rolesToNotify = def ? def.notifyRoles.filter(r => r !== role) : ['branch_manager'];
            for (const tr of rolesToNotify) {
              const n = notificationService.createNotification({
                brand_id: brandId,
                branch_id: ctx.branchId,
                source_type: 'ops_message',
                source_actor_id: userId,
                title: `${ctx.icon} ${branchBadge}${senderName}`,
                body: previewText,
                priority: 'normal',
                target_role: tr,
                related_entity_type: 'channel',
                related_entity_id: effectiveRefId,
                action_url: tr === 'purchasing' ? '/belanja/' : (tr === 'driver' ? '/driver/' : '/merchant-app/#hari-ini')
              });
              if (n && n.id) {
                db.prepare('UPDATE notification_recipients SET read_at = ? WHERE notification_id = ? AND user_id = ?').run(nowIso, n.id, userId);
                if (ctx.channelKey === 'driver') {
                  db.prepare(`
                    DELETE FROM notification_recipients
                    WHERE notification_id = ?
                      AND user_id IN (SELECT id FROM users WHERE role IN ('owner', 'brand_manager'))
                  `).run(n.id);
                }
              }
            }
          } else if (threadType === 'delivery') {
            if (role === 'driver') {
              for (const r of ['cashier', 'branch_manager']) {
                const n = notificationService.createNotification({
                  brand_id: brandId,
                  branch_id: ctx.branchId,
                  source_type: 'ops_message',
                  source_actor_id: userId,
                  title: `🛵 ${branchBadge}Kurir (${senderName}) • ${ctx.title}`,
                  body: previewText,
                  priority: 'high',
                  target_role: r,
                  related_entity_type: 'delivery',
                  related_entity_id: effectiveRefId,
                  action_url: '/merchant-app/#pesanan'
                });
                if (n && n.id) {
                  db.prepare(`
                    DELETE FROM notification_recipients
                    WHERE notification_id = ?
                      AND user_id IN (SELECT id FROM users WHERE role IN ('owner', 'brand_manager'))
                  `).run(n.id);
                }
              }
            } else if (ctx.order && ctx.order.driver_id) {
              notificationService.createNotification({
                brand_id: brandId,
                branch_id: ctx.branchId,
                source_type: 'ops_message',
                source_actor_id: userId,
                title: `💬 ${branchBadge}Toko (${senderName}) • ${ctx.title}`,
                body: previewText,
                priority: 'high',
                target_user_id: ctx.order.driver_id,
                related_entity_type: 'delivery',
                related_entity_id: effectiveRefId,
                action_url: '/driver/'
              });
            }
          } else if (threadType === 'purchasing') {
            const targetRoles = role === 'purchasing' ? ['branch_manager', 'owner'] : ['purchasing'];
            for (const tr of targetRoles) {
              const n = notificationService.createNotification({
                brand_id: brandId,
                branch_id: ctx.branchId,
                source_type: 'ops_message',
                source_actor_id: userId,
                title: `🛒 ${branchBadge}${senderName} • ${ctx.title}`,
                body: previewText,
                priority: 'normal',
                target_role: tr,
                related_entity_type: 'purchasing',
                related_entity_id: effectiveRefId,
                action_url: tr === 'purchasing' ? '/belanja/' : '/merchant-app/#belanja'
              });
              if (n && n.id) {
                db.prepare('UPDATE notification_recipients SET read_at = ? WHERE notification_id = ? AND user_id = ?').run(nowIso, n.id, userId);
              }
            }
          } else if (threadType === 'order') {
            const targetRoles = ['cashier', 'branch_manager'];
            for (const tr of targetRoles) {
              const n = notificationService.createNotification({
                brand_id: brandId,
                branch_id: ctx.branchId,
                source_type: 'ops_message',
                source_actor_id: userId,
                title: `🧾 ${branchBadge}${senderName} • ${ctx.title}`,
                body: previewText,
                priority: 'normal',
                target_role: tr,
                related_entity_type: 'order',
                related_entity_id: effectiveRefId,
                action_url: '/merchant-app/#pesanan'
              });
              if (n && n.id) {
                db.prepare('UPDATE notification_recipients SET read_at = ? WHERE notification_id = ? AND user_id = ?').run(nowIso, n.id, userId);
              }
            }
          }
        } catch (notifErr) {
          console.warn('[OpsMessages] Notification fan-out warning:', notifErr && notifErr.message);
        }
      }

      const saved = db.prepare('SELECT * FROM ops_messages WHERE id = ?').get(msgId);
      res.status(201).json({
        success: true,
        message: formatMessageRow(saved, brandId, userId, null)
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. GET /api/v1/messages/inbox — Structured Multi-Branch Inbox (respecting per-user cleared_at!)
  router.get('/messages/inbox', staffAuth, (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const brandId = req.brand_id || (req.user && req.user.brand_id);
      const userId = actorId(req);
      const role = actorRole(req);
      const userBranchId = actorBranchId(req);

      const allBranches = getActiveBranches(brandId);
      const visibleBranches = isBrandLevelRole(role)
        ? allBranches
        : allBranches.filter(b => !userBranchId || String(b.id) === String(userBranchId));

      const requestedBranchId = String(req.query.branch_id || '').trim();
      const activeBranchId = isBrandLevelRole(role)
        ? resolveDefaultBranchId(brandId, requestedBranchId)
        : (userBranchId || resolveDefaultBranchId(brandId, null));
      const activeBranchName = resolveBranchName(brandId, activeBranchId);

      // Load all per-user clear cutoffs into a fast map
      const clearRows = db.prepare(`
        SELECT thread_type, thread_ref_id, cleared_at
        FROM ops_thread_clears
        WHERE user_id = ?
      `).all(userId) || [];
      const clearMap = new Map();
      for (const c of clearRows) {
        clearMap.set(`${c.thread_type}:${c.thread_ref_id}`, c.cleared_at);
      }

      // Unread counts per thread_type + thread_ref_id
      const unreadRows = db.prepare(`
        SELECT n.related_entity_type AS thread_type,
               n.related_entity_id AS thread_ref_id,
               COUNT(nr.id) AS unread_count
        FROM notification_recipients nr
        JOIN notifications n ON n.id = nr.notification_id
        WHERE nr.user_id = ?
          AND nr.read_at IS NULL
          AND n.source_type IN ('ops_message', 'ops_broadcast')
        GROUP BY n.related_entity_type, n.related_entity_id
      `).all(userId) || [];

      const unreadMap = new Map();
      let totalUnread = 0;
      for (const u of unreadRows) {
        const key = `${u.thread_type || ''}:${u.thread_ref_id || ''}`;
        const c = Number(u.unread_count || 0);
        unreadMap.set(key, c);
        totalUnread += c;
      }

      // Build Dedicated Division Channels for activeBranchId
      const divisionChannels = [];
      if (activeBranchId) {
        for (const key of Object.keys(CHANNEL_DEFINITIONS)) {
          const def = CHANNEL_DEFINITIONS[key];
          if (!def.allowedViewRoles.includes(role)) continue;

          const canonicalRef = `${activeBranchId}:${def.key}`;
          const clearedAt = clearMap.get(`channel:${canonicalRef}`) || null;

          let lastRow = null;
          let visibleCount = 0;
          if (clearedAt) {
            lastRow = db.prepare(`
              SELECT *
              FROM ops_messages
              WHERE brand_id = ? AND thread_type = 'channel' AND thread_ref_id = ?
                AND datetime(created_at) > datetime(?)
              ORDER BY datetime(created_at) DESC, rowid DESC
              LIMIT 1
            `).get(brandId, canonicalRef, clearedAt);
            const cntRow = db.prepare(`
              SELECT COUNT(*) AS cnt
              FROM ops_messages
              WHERE brand_id = ? AND thread_type = 'channel' AND thread_ref_id = ?
                AND datetime(created_at) > datetime(?)
            `).get(brandId, canonicalRef, clearedAt);
            visibleCount = Number((cntRow && cntRow.cnt) || 0);
          } else {
            lastRow = db.prepare(`
              SELECT *
              FROM ops_messages
              WHERE brand_id = ? AND thread_type = 'channel' AND thread_ref_id = ?
              ORDER BY datetime(created_at) DESC, rowid DESC
              LIMIT 1
            `).get(brandId, canonicalRef);
            const cntRow = db.prepare(`
              SELECT COUNT(*) AS cnt
              FROM ops_messages
              WHERE brand_id = ? AND thread_type = 'channel' AND thread_ref_id = ?
            `).get(brandId, canonicalRef);
            visibleCount = Number((cntRow && cntRow.cnt) || 0);
          }

          divisionChannels.push({
            thread_type: 'channel',
            ref_id: canonicalRef,
            channel_key: def.key,
            branch_id: activeBranchId,
            branch_name: activeBranchName,
            icon: def.icon,
            title: `${def.icon} ${def.title}`,
            subtitle: def.subtitle,
            read_only: !def.allowedSendRoles.includes(role),
            can_clear: visibleCount > 0,
            message_count: visibleCount,
            last_message: formatMessageRow(lastRow, brandId, userId, null),
            unread_count: unreadMap.get(`channel:${canonicalRef}`) || 0
          });
        }
      }

      // Build Branch Announcement Bulletin item for activeBranchId
      const bulletinRef = activeBranchId || 'all';
      const bulletinClearedAt = clearMap.get(`broadcast:${bulletinRef}`) || clearMap.get('broadcast:all') || null;

      let lastBulletinRow = null;
      let bulletinVisibleCount = 0;
      if (bulletinClearedAt) {
        lastBulletinRow = db.prepare(`
          SELECT *
          FROM ops_messages
          WHERE brand_id = ?
            AND thread_type = 'broadcast'
            AND (branch_id = ? OR branch_id IS NULL OR branch_id = '' OR thread_ref_id = ?)
            AND datetime(created_at) > datetime(?)
          ORDER BY datetime(created_at) DESC, rowid DESC
          LIMIT 1
        `).get(brandId, activeBranchId, bulletinRef, bulletinClearedAt);
        const bCnt = db.prepare(`
          SELECT COUNT(*) AS cnt
          FROM ops_messages
          WHERE brand_id = ?
            AND thread_type = 'broadcast'
            AND (branch_id = ? OR branch_id IS NULL OR branch_id = '' OR thread_ref_id = ?)
            AND datetime(created_at) > datetime(?)
        `).get(brandId, activeBranchId, bulletinRef, bulletinClearedAt);
        bulletinVisibleCount = Number((bCnt && bCnt.cnt) || 0);
      } else {
        lastBulletinRow = db.prepare(`
          SELECT *
          FROM ops_messages
          WHERE brand_id = ?
            AND thread_type = 'broadcast'
            AND (branch_id = ? OR branch_id IS NULL OR branch_id = '' OR thread_ref_id = ?)
          ORDER BY datetime(created_at) DESC, rowid DESC
          LIMIT 1
        `).get(brandId, activeBranchId, bulletinRef);
        const bCnt = db.prepare(`
          SELECT COUNT(*) AS cnt
          FROM ops_messages
          WHERE brand_id = ?
            AND thread_type = 'broadcast'
            AND (branch_id = ? OR branch_id IS NULL OR branch_id = '' OR thread_ref_id = ?)
        `).get(brandId, activeBranchId, bulletinRef);
        bulletinVisibleCount = Number((bCnt && bCnt.cnt) || 0);
      }

      const bulletinUnread = (unreadMap.get(`broadcast:${bulletinRef}`) || 0) + (unreadMap.get('broadcast:all') || 0);
      const bulletin = {
        thread_type: 'broadcast',
        ref_id: bulletinRef,
        branch_id: activeBranchId,
        branch_name: activeBranchName,
        icon: '📢',
        title: '📢 Papan Pengumuman Cabang',
        subtitle: ['owner', 'brand_manager', 'branch_manager'].includes(role)
          ? 'Kirim instruksi resmi 1 arah & pantau staf yang sudah membaca'
          : 'Instruksi & pengumuman resmi dari Manajemen / Owner',
        read_only: !['owner', 'brand_manager', 'branch_manager'].includes(role),
        can_clear: bulletinVisibleCount > 0,
        message_count: bulletinVisibleCount,
        last_message: formatMessageRow(lastBulletinRow, brandId, userId, null),
        unread_count: bulletinUnread
      };

      // Build Contextual Task Threads (`order`, `delivery`, `purchasing`) for activeBranchId
      let taskWhere = `WHERE m.brand_id = ? AND m.thread_type IN ('order', 'delivery', 'purchasing')`;
      const taskParams = [brandId];

      if (activeBranchId) {
        taskWhere += ` AND (m.branch_id = ? OR m.branch_id IS NULL)`;
        taskParams.push(activeBranchId);
      }
      if (role === 'driver') {
        taskWhere += ` AND m.thread_type = 'delivery'`;
      } else if (role === 'purchasing') {
        taskWhere += ` AND m.thread_type = 'purchasing'`;
      }

      const latestTaskRows = db.prepare(`
        SELECT m.*
        FROM ops_messages m
        JOIN (
          SELECT thread_type, thread_ref_id, MAX(rowid) AS max_rowid
          FROM ops_messages
          WHERE brand_id = ? AND thread_type IN ('order', 'delivery', 'purchasing')
          GROUP BY thread_type, thread_ref_id
        ) latest ON m.rowid = latest.max_rowid
        ${taskWhere}
        ORDER BY datetime(m.created_at) DESC, m.rowid DESC
        LIMIT 30
      `).all(brandId, ...taskParams) || [];

      const taskThreads = [];
      for (const row of latestTaskRows) {
        const ctx = resolveThreadContext({
          brandId,
          threadType: row.thread_type,
          refId: row.thread_ref_id,
          req
        });
        if (!ctx.ok) continue;

        const key = `${row.thread_type}:${ctx.canonicalRefId}`;
        const clearedAt = clearMap.get(key) || clearMap.get(`${row.thread_type}:${row.thread_ref_id}`) || null;

        // If user cleared this task thread and no newer message has arrived since `clearedAt`, hide it from their list!
        if (clearedAt && row.created_at && String(row.created_at) <= String(clearedAt)) {
          continue;
        }

        taskThreads.push({
          thread_type: row.thread_type,
          ref_id: ctx.canonicalRefId,
          branch_id: ctx.branchId || activeBranchId,
          branch_name: ctx.branchName || activeBranchName,
          icon: ctx.icon || '💬',
          title: ctx.title,
          subtitle: ctx.subtitle,
          read_only: ctx.readOnly,
          can_clear: true,
          last_message: formatMessageRow(row, brandId, userId, null),
          unread_count: unreadMap.get(key) || unreadMap.get(`${row.thread_type}:${row.thread_ref_id}`) || 0
        });
      }

      res.json({
        success: true,
        total_unread: totalUnread,
        can_select_branch: isBrandLevelRole(role),
        active_branch: {
          id: activeBranchId,
          name: activeBranchName
        },
        branches: visibleBranches.map(b => ({
          id: b.id,
          name: b.name,
          is_active: Boolean(b.is_active)
        })),
        division_channels: divisionChannels,
        bulletin,
        threads: taskThreads
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. POST /api/v1/messages/read — Mark notifications for a room/thread as read
  router.post('/messages/read', staffAuth, (req, res) => {
    try {
      const brandId = req.brand_id || (req.user && req.user.brand_id);
      const userId = actorId(req);
      const threadType = String((req.body && req.body.thread_type) || '').trim();
      const refId = String((req.body && (req.body.ref_id || req.body.thread_ref_id)) || '').trim();
      const nowIso = new Date().toISOString();

      if (threadType === 'broadcast') {
        db.prepare(`
          UPDATE notification_recipients
          SET read_at = ?
          WHERE user_id = ?
            AND read_at IS NULL
            AND notification_id IN (
              SELECT id FROM notifications WHERE source_type = 'ops_broadcast'
            )
        `).run(nowIso, userId);
      } else if (threadType && refId) {
        const ctx = resolveThreadContext({ brandId, threadType, refId, req });
        const canonicalId = ctx && ctx.canonicalRefId ? ctx.canonicalRefId : refId;

        db.prepare(`
          UPDATE notification_recipients
          SET read_at = ?
          WHERE user_id = ?
            AND read_at IS NULL
            AND notification_id IN (
              SELECT id FROM notifications
              WHERE source_type = 'ops_message'
                AND related_entity_type = ?
                AND (related_entity_id = ? OR related_entity_id = ?)
            )
        `).run(nowIso, userId, threadType, canonicalId, refId);
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. DELETE /api/v1/messages/thread — Per-User "Clear Chat for Me" (WhatsApp UX flow)
  // NEVER deletes messages from other participants' screens or audit database!
  router.delete('/messages/thread', staffAuth, (req, res) => {
    try {
      const brandId = req.brand_id || (req.user && req.user.brand_id);
      const userId = actorId(req);
      const bodyObj = Object.assign({}, req.query || {}, req.body || {});
      const threadType = String(bodyObj.thread_type || '').trim();
      const refId = String(bodyObj.ref_id || bodyObj.thread_ref_id || '').trim();

      if (!threadType || !refId) {
        return res.status(400).json({
          success: false,
          error: 'Parameter thread_type dan ref_id wajib diisi.'
        });
      }

      const ctx = resolveThreadContext({ brandId, threadType, refId, req });
      const canonicalRef = ctx.ok ? ctx.canonicalRefId : refId;
      const nowIso = new Date().toISOString();

      // Record per-user clear cutoff in `ops_thread_clears`
      db.prepare(`
        INSERT OR REPLACE INTO ops_thread_clears (user_id, brand_id, thread_type, thread_ref_id, cleared_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, brandId, threadType, canonicalRef, nowIso);

      // Also mark this user's own unread notifications for this thread as read
      try {
        if (threadType === 'broadcast') {
          db.prepare(`
            UPDATE notification_recipients
            SET read_at = ?
            WHERE user_id = ?
              AND read_at IS NULL
              AND notification_id IN (
                SELECT id FROM notifications WHERE brand_id = ? AND source_type = 'ops_broadcast'
              )
          `).run(nowIso, userId, brandId);
        } else {
          db.prepare(`
            UPDATE notification_recipients
            SET read_at = ?
            WHERE user_id = ?
              AND read_at IS NULL
              AND notification_id IN (
                SELECT id FROM notifications
                WHERE brand_id = ?
                  AND source_type = 'ops_message'
                  AND related_entity_type = ?
                  AND (related_entity_id = ? OR related_entity_id = ?)
              )
          `).run(nowIso, userId, brandId, threadType, canonicalRef, refId);
        }
      } catch (_) {}

      res.json({
        success: true,
        scope: 'self_only',
        cleared_at: nowIso
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. DELETE /api/v1/messages/:id — Sender-Only "Unsend / Tarik Pesan" (WhatsApp Delete for Everyone)
  // ONLY the original sender (`sender_user_id === userId`) can retract their own message!
  router.delete('/messages/:id', staffAuth, async (req, res) => {
    try {
      const brandId = req.brand_id || (req.user && req.user.brand_id);
      const userId = actorId(req);
      const msgId = String(req.params.id || '').trim();

      if (!msgId) {
        return res.status(400).json({ success: false, error: 'ID pesan wajib diisi.' });
      }

      const msg = db.prepare(`
        SELECT * FROM ops_messages WHERE id = ? AND brand_id = ? LIMIT 1
      `).get(msgId, brandId);

      if (!msg) {
        return res.status(404).json({ success: false, error: 'Pesan tidak ditemukan.' });
      }

      if (String(msg.sender_user_id) !== String(userId)) {
        return res.status(403).json({
          success: false,
          error: 'Anda hanya dapat menarik pesan yang Anda kirim sendiri.'
        });
      }

      if (msg.is_receipt) {
        return res.status(409).json({
          success: false,
          error: 'Bukti foto struk belanja tidak dapat ditarik demi keutuhan audit keuangan.'
        });
      }

      const nowIso = new Date().toISOString();
      if (mediaService && mediaService.storage) {
        if (msg.image_full_key) {
          try { await mediaService.storage.delete(msg.image_full_key); } catch (_) {}
        }
        if (msg.image_thumb_key) {
          try { await mediaService.storage.delete(msg.image_thumb_key); } catch (_) {}
        }
      }

      db.prepare(`
        UPDATE ops_messages
        SET body = '🚫 Pesan ini telah ditarik',
            quick_code = NULL,
            image_full_key = NULL,
            image_thumb_key = NULL,
            retracted_at = ?
        WHERE id = ? AND sender_user_id = ?
      `).run(nowIso, msgId, userId);

      const updated = db.prepare('SELECT * FROM ops_messages WHERE id = ?').get(msgId);
      res.json({
        success: true,
        message: formatMessageRow(updated, brandId, userId, null)
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = registerOpsMessageRoutes;
