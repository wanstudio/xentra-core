/**
 * XENTRA CORE — PAYMENT WEBHOOK ROUTES
 *
 * Isolated provider webhook adapters. Payment lifecycle logic remains inside
 * PaymentService; this module only normalizes provider-specific transport input.
 */
module.exports = function registerPaymentWebhooks(router, deps) {
  const { PaymentService } = deps;

  router.post('/webhooks/midtrans', (req, res) => {
    try {
      const result = PaymentService.handleWebhook(req.body, {
        provider: 'midtrans',
        headers: req.headers
      });
      res.json(result);
    } catch (err) {
      console.error('[Webhook] Midtrans error:', err);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/webhooks/doku', (req, res) => {
    try {
      const result = PaymentService.handleWebhook(req.body, {
        provider: 'doku',
        headers: {
          'client-id': req.headers['client-id'] || req.headers['Client-Id'],
          'request-id': req.headers['request-id'] || req.headers['Request-Id'],
          'request-timestamp': req.headers['request-timestamp'] || req.headers['Request-Timestamp'],
          'signature': req.headers['signature'] || req.headers['Signature'],
          'digest': req.headers['digest'] || req.headers['Digest'],
          'request-target': req.headers['request-target'] || req.headers['Request-Target']
        },
        notificationPath: req.originalUrl ? req.originalUrl.split('?')[0] : '/webhooks/doku'
      });
      res.json(result);
    } catch (err) {
      console.error('[Webhook] DOKU error:', err);
      res.status(400).json({ success: false, error: err.message });
    }
  });
};
