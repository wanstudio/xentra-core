/**
 * XENTRA NOTIFICATION SERVICE
 *
 * Implements authoritative domain logic according to
 * docs/decisions/internal-client-notification-domain-v1.md:
 * - Isolation per recipient user & role/scope
 * - Support for direct user, role-in-scope, and branch/brand broadcasts
 * - Read state persistence per recipient
 */
const { v4: uuidv4 } = require('crypto');
const WebPushService = require('./WebPushService');

class NotificationService {
  constructor(db, webPushService = null) {
    this.db = db;
    this.webPushService = webPushService || (db ? new WebPushService(db) : null);
  }

  /**
   * Helper to generate unique ID
   */
  _id() {
    return 'notif_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
  }

  /**
   * Create a notification and resolve target recipients according to scope
   */
  createNotification({
    brand_id = null,
    branch_id = null,
    source_type, // 'order', 'delivery', 'payment', 'system', 'announcement'
    source_actor_id = null,
    title,
    body,
    priority = 'normal',
    target_role = null, // 'owner', 'branch_manager', 'cashier', 'driver', etc.
    target_user_id = null,
    target_scope = null, // 'branch', 'brand', 'organization', 'user'
    related_entity_type = null, // 'order', 'delivery', 'payment'
    related_entity_id = null,
    action_url = null
  }) {
    if (!source_type || !title || !body) {
      throw new Error('[NotificationService] source_type, title, and body are required.');
    }

    const notifId = this._id();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO notifications (
        id, brand_id, branch_id, source_type, source_actor_id,
        title, body, priority, target_role, target_user_id,
        target_scope, related_entity_type, related_entity_id, action_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      notifId, brand_id, branch_id, source_type, source_actor_id,
      title, body, priority, target_role, target_user_id,
      target_scope, related_entity_type, related_entity_id, action_url, now
    );

    // Resolve eligible recipient user IDs
    let recipientUserIds = [];

    if (target_user_id) {
      recipientUserIds.push(target_user_id);
    } else {
      let query = 'SELECT id FROM users WHERE status != "deleted"';
      const params = [];

      if (brand_id) {
        query += ' AND (brand_id = ? OR role = "owner")';
        params.push(brand_id);
      }
      if (branch_id) {
        query += ' AND (branch_id = ? OR role IN ("owner", "brand_manager"))';
        params.push(branch_id);
      }
      if (target_role) {
        query += ' AND role = ?';
        params.push(target_role);
      }

      const users = this.db.prepare(query).all(...params);
      recipientUserIds = (users || []).map(u => u.id);
    }

    // Insert recipient rows
    if (recipientUserIds.length > 0) {
      const insertRecipient = this.db.prepare(`
        INSERT OR IGNORE INTO notification_recipients (id, notification_id, user_id, read_at, created_at)
        VALUES (?, ?, ?, NULL, ?)
      `);
      for (const uid of recipientUserIds) {
        insertRecipient.run('rcp_' + Math.random().toString(36).substring(2, 10), notifId, uid, now);
      }

      // Dispatch background Web Push (reaches device when locked/closed)
      if (this.webPushService) {
        const pushPayload = {
          title: title,
          body: body,
          icon: '/merchant-app/assets/icons/icon-192.png',
          badge: '/merchant-app/assets/icons/icon-192.png',
          tag: 'order-pending-' + (related_entity_id || notifId),
          url: action_url || '/merchant-app/#pesanan',
          data: {
            notificationId: notifId,
            orderId: related_entity_id,
            entityType: related_entity_type,
            url: action_url || '/merchant-app/#pesanan'
          }
        };
        this.webPushService.sendPushToUsers(recipientUserIds, pushPayload).catch(err => {
          console.warn('[NotificationService] Push dispatch warning:', err && err.message);
        });
      }
    }

    return { id: notifId, recipient_count: recipientUserIds.length };
  }

  /**
   * List notifications for a specific authenticated user
   */
  listForUser({ userId, role, branchId = null, brandId = null, limit = 30, unreadOnly = false }) {
    if (!userId) return [];

    let query = `
      SELECT n.*, nr.read_at, nr.id as recipient_id
      FROM notification_recipients nr
      JOIN notifications n ON nr.notification_id = n.id
      WHERE nr.user_id = ?
    `;
    const params = [userId];

    if (unreadOnly) {
      query += ' AND nr.read_at IS NULL';
    }

    query += ' ORDER BY n.created_at DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(query).all(...params) || [];
  }

  /**
   * Get unread count for an authenticated user
   */
  getUnreadCount({ userId }) {
    if (!userId) return 0;
    const row = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM notification_recipients
      WHERE user_id = ? AND read_at IS NULL
    `).get(userId);
    return (row && row.count) || 0;
  }

  /**
   * Mark a notification as read for a specific user
   */
  markAsRead({ notificationId, userId }) {
    if (!userId || !notificationId) return false;
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE notification_recipients
      SET read_at = ?
      WHERE notification_id = ? AND user_id = ? AND read_at IS NULL
    `).run(now, notificationId, userId);
    return result.changes > 0;
  }

  /**
   * Mark all notifications as read for a user
   */
  markAllAsRead({ userId }) {
    if (!userId) return 0;
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE notification_recipients
      SET read_at = ?
      WHERE user_id = ? AND read_at IS NULL
    `).run(now, userId);
    return result.changes;
  }
}

module.exports = NotificationService;
