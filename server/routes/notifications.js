/**
 * Notification API Routes
 *
 * Implements endpoints for notification fetching, unread count, and read state:
 * - GET  /api/v1/notifications
 * - GET  /api/v1/notifications/unread-count
 * - POST /api/v1/notifications/:id/read
 * - POST /api/v1/notifications/read-all
 */
const express = require('express');

function registerNotificationRoutes(router, { notificationService, requireAuth }) {
  // 1. List user notifications
  router.get('/notifications', requireAuth(), (req, res) => {
    try {
      const userId = req.user && req.user.id;
      const role = req.user && req.user.role;
      const branchId = req.user && req.user.branch_id;
      const brandId = req.user && req.user.brand_id;
      const limit = parseInt(req.query.limit, 10) || 30;
      const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';

      const items = notificationService.listForUser({
        userId,
        role,
        branchId,
        brandId,
        limit,
        unreadOnly
      });

      const unreadCount = notificationService.getUnreadCount({ userId });

      res.json({
        success: true,
        notifications: items,
        unread_count: unreadCount
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Get unread count quickly
  router.get('/notifications/unread-count', requireAuth(), (req, res) => {
    try {
      const userId = req.user && req.user.id;
      const unreadCount = notificationService.getUnreadCount({ userId });
      res.json({ success: true, unread_count: unreadCount });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Mark single notification as read
  router.post('/notifications/:id/read', requireAuth(), (req, res) => {
    try {
      const userId = req.user && req.user.id;
      const success = notificationService.markAsRead({
        notificationId: req.params.id,
        userId
      });
      res.json({ success: true, updated: success });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Mark all as read
  router.post('/notifications/read-all', requireAuth(), (req, res) => {
    try {
      const userId = req.user && req.user.id;
      const count = notificationService.markAllAsRead({ userId });
      res.json({ success: true, marked_count: count });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. Get VAPID public key for browser PushManager subscription
  router.get('/notifications/vapid-public-key', (req, res) => {
    try {
      const webPushService = notificationService && notificationService.webPushService;
      const publicKey = webPushService ? webPushService.getPublicKey() : null;
      if (!publicKey) {
        return res.status(503).json({ success: false, error: 'WebPush service not initialized' });
      }
      res.json({ success: true, public_key: publicKey });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. Subscribe device to Web Push
  router.post('/notifications/subscribe', requireAuth(), (req, res) => {
    try {
      const userId = req.user && req.user.id;
      const subscription = req.body && req.body.subscription;
      const userAgent = req.headers['user-agent'] || '';

      const webPushService = notificationService && notificationService.webPushService;
      if (!webPushService) {
        return res.status(503).json({ success: false, error: 'WebPush service not initialized' });
      }

      webPushService.saveSubscription({
        userId,
        subscription,
        userAgent
      });

      res.json({ success: true, message: 'WebPush subscription saved' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 7. Unsubscribe device from Web Push
  router.post('/notifications/unsubscribe', requireAuth(), (req, res) => {
    try {
      const userId = req.user && req.user.id;
      const endpoint = req.body && req.body.endpoint;

      const webPushService = notificationService && notificationService.webPushService;
      if (!webPushService) {
        return res.status(503).json({ success: false, error: 'WebPush service not initialized' });
      }

      webPushService.removeSubscription({
        endpoint,
        userId
      });

      res.json({ success: true, message: 'WebPush subscription removed' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = registerNotificationRoutes;
