/**
 * XENTRA CORE — PAYMENT CONFIG ROUTES
 *
 * Browser-safe payment gateway configuration. Server credentials never leave
 * the API; provider selection and publishable client metadata remain derived
 * from the canonical PaymentRepository.
 */
module.exports = function registerPaymentConfigRoutes(router, deps) {
  const { corePaymentRepo } = deps;

  router.get('/payment/config', (req, res) => {
    try {
      const brandRow = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
      let cfg = {};
      if (brandRow && brandRow.default_payment_config) {
        try {
          cfg = JSON.parse(brandRow.default_payment_config) || {};
        } catch (parseErr) {
          return res.status(500).json({
            success: false,
            error: 'CONFIG_PARSE_ERROR',
            message: 'Konfigurasi payment gateway brand gagal dibaca (format JSON tidak valid).'
          });
        }
      }

      let activeProvider = '';
      if (Object.prototype.hasOwnProperty.call(cfg, 'provider')) {
        activeProvider = cfg.provider || '';
      } else if (cfg.client_id || cfg.secret_key || cfg.doku_methods) {
        activeProvider = 'doku';
      } else if (cfg.server_key || cfg.client_key || cfg.midtrans_methods) {
        activeProvider = 'midtrans';
      } else if (!brandRow && process.env.MIDTRANS_SERVER_KEY) {
        activeProvider = 'midtrans';
      } else {
        activeProvider = '';
      }
      const isProduction = cfg.is_production === true;

      res.json({
        success: true,
        payment_gateway: {
          active_provider: activeProvider,
          active_provider_configured: activeProvider === 'doku'
            ? Boolean(cfg.client_id && cfg.secret_key)
            : (activeProvider === 'midtrans'
              ? Boolean(cfg.server_key || (!brandRow && process.env.MIDTRANS_SERVER_KEY))
              : false),
          midtrans_client_key: activeProvider === 'midtrans' ? (cfg.client_key || '') : '',
          midtrans_is_production: isProduction,
          snap_script_url: activeProvider === 'midtrans'
            ? (isProduction
              ? 'https://app.midtrans.com/snap/snap.js'
              : 'https://app.sandbox.midtrans.com/snap/snap.js')
            : null
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
};
