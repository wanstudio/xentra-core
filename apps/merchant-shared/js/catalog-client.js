/**
 * XENTRA CORE — MERCHANT SHARED CATALOG CLIENT
 *
 * Transport/data-access boundary for Branch Catalog operations shared by
 * Owner Dashboard and Merchant App.
 *
 * No DOM manipulation, rendering, modal logic, or surface-specific state.
 * Must be loaded after merchant-shared/js/shared.js.
 */
(function (window) {
  'use strict';

  var S = window.XentraShared;
  if (!S) {
    throw new Error('[XentraCatalogClient] XentraShared must be loaded first.');
  }

  var API_BASE = S.API_BASE || '';
  var adminFetch = S.adminFetch;
  var getAuthHeaders = S.getAuthHeaders;

  async function request(url, options) {
    var opts = options ? Object.assign({}, options) : {};
    var headers = Object.assign({}, getAuthHeaders(), opts.headers || {});
    opts.headers = headers;

    var target = String(url || '');
    if (!/^https?:\/\//i.test(target)) {
      target = API_BASE + target;
    }

    return adminFetch(target, opts);
  }

  window.XentraCatalogClient = {
    request: request
  };
})(window);
