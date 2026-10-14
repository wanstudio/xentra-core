/**
 * XENTRA WEB PUSH NOTIFICATION ENGINE
 *
 * Implements standard VAPID Web Push protocol for delivering native background alerts
 * when merchant/cashier devices are asleep, closed, or locked in pocket.
 */
const webpush = require('web-push');

class WebPushService {
  constructor(db) {
    this.db = db;
    this._initVapid();
  }

  _initVapid() {
    try {
      // 1. Check environment variables first
      let publicKey = process.env.VAPID_PUBLIC_KEY;
      let privateKey = process.env.VAPID_PRIVATE_KEY;
      const subject = process.env.VAPID_SUBJECT || 'mailto:support@xentra.cloud';

      // 2. Fall back to persistent system_metadata in database
      if (!publicKey || !privateKey) {
        const pubRow = this.db.prepare("SELECT value FROM system_metadata WHERE key = 'vapid_public_key'").get();
        const privRow = this.db.prepare("SELECT value FROM system_metadata WHERE key = 'vapid_private_key'").get();

        if (pubRow && pubRow.value && privRow && privRow.value) {
          publicKey = pubRow.value;
          privateKey = privRow.value;
        } else {
          // 3. Generate once and persist
          const keys = webpush.generateVAPIDKeys();
          publicKey = keys.publicKey;
          privateKey = keys.privateKey;
          const now = new Date().toISOString();
          this.db.prepare(`
            INSERT OR REPLACE INTO system_metadata (key, value, created_at, updated_at)
            VALUES ('vapid_public_key', ?, ?, ?)
          `).run(publicKey, now, now);
          this.db.prepare(`
            INSERT OR REPLACE INTO system_metadata (key, value, created_at, updated_at)
            VALUES ('vapid_private_key', ?, ?, ?)
          `).run(privateKey, now, now);
        }
      }

      this.publicKey = publicKey;
      this.privateKey = privateKey;
      this.subject = subject;

      webpush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
      this.initialized = true;
    } catch (err) {
      console.error('[WebPushService] Failed to initialize VAPID:', err && err.message);
      this.initialized = false;
    }
  }

  getPublicKey() {
    return this.publicKey || null;
  }

  saveSubscription({ userId, subscription, userAgent = '' }) {
    if (!userId || !subscription || !subscription.endpoint || !subscription.keys) {
      throw new Error('[WebPushService] Invalid subscription payload');
    }
    const { endpoint, keys } = subscription;
    const { p256dh, auth } = keys;
    if (!p256dh || !auth) {
      throw new Error('[WebPushService] Subscription missing p256dh or auth keys');
    }

    const id = 'sub_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = excluded.updated_at
    `).run(id, userId, endpoint, p256dh, auth, userAgent || '', now, now);

    return { success: true };
  }

  removeSubscription({ endpoint, userId = null }) {
    if (!endpoint) return false;
    let query = 'DELETE FROM push_subscriptions WHERE endpoint = ?';
    const params = [endpoint];
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    const result = this.db.prepare(query).run(...params);
    return result.changes > 0;
  }

  async sendPushToUsers(userIds, payload) {
    if (!this.initialized || !Array.isArray(userIds) || userIds.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const placeholders = userIds.map(() => '?').join(',');
    const subscriptions = this.db.prepare(`
      SELECT id, endpoint, p256dh, auth, user_id
      FROM push_subscriptions
      WHERE user_id IN (${placeholders})
    `).all(...userIds);

    if (!subscriptions || subscriptions.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const stringPayload = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;

    const deadEndpoints = [];

    await Promise.allSettled(
      subscriptions.map(async sub => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };

        try {
          await webpush.sendNotification(pushSubscription, stringPayload, {
            TTL: 3600, // Keep in queue for 1 hour if device is temporarily offline
            urgency: 'high'
          });
          sent++;
        } catch (err) {
          failed++;
          // 410 Gone or 404 Not Found indicates subscription has expired or user revoked it
          if (err.statusCode === 410 || err.statusCode === 404) {
            deadEndpoints.push(sub.endpoint);
          } else {
            console.warn('[WebPush] Dispatch error for endpoint:', err.statusCode || err.message);
          }
        }
      })
    );

    // Prune dead subscriptions
    if (deadEndpoints.length > 0) {
      const delStmt = this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
      deadEndpoints.forEach(ep => {
        try { delStmt.run(ep); } catch (_) {}
      });
    }

    return { sent, failed };
  }
}

module.exports = WebPushService;
