/**
 * Xentra API Client
 * Centralized fetch wrapper with timeout, error handling, auth headers, and base URL.
 */
(function () {
  'use strict';

  var BASE = window.location.origin + '/api/v1';
  var TIMEOUT = 8000;

  /**
   * Make an API request.
   * @param {string} method - HTTP method
   * @param {string} path - API path (e.g. '/catalog/menu')
   * @param {object} [body] - Request body for POST/PUT
   * @returns {Promise<object>} - Parsed JSON response
   */
  function request(method, path, body) {
    var url = BASE + path;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT);

    var headers = { 'Content-Type': 'application/json' };

    // Attach Customer Session Token if available
    try {
      var session = window.Xentra && window.Xentra.Store && window.Xentra.Store.getState().customerSession;
      if (!session) {
        var raw = localStorage.getItem('xentra_v2_customer_session');
        session = raw ? JSON.parse(raw) : null;
      }
      if (session && session.token) {
        headers['Authorization'] = 'Bearer ' + session.token;
        headers['x-customer-token'] = session.token;
      }
    } catch (_) {}

    var opts = {
      method: method,
      headers: headers,
      signal: controller.signal
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      opts.body = JSON.stringify(body);
    }

    return fetch(url, opts)
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) {
          return res.json().catch(function () { return { error: 'HTTP ' + res.status }; }).then(function (errBody) {
            var err = new Error(errBody.error || errBody.message || ('HTTP ' + res.status));
            err.status = res.status;
            err.data = errBody;
            throw err;
          });
        }
        return res.json();
      })
      .catch(function (err) {
        clearTimeout(timer);
        console.error('[API] ' + method + ' ' + path, err);
        throw err;
      });
  }

  // ── Convenience Methods ──
  function get(path)        { return request('GET', path); }
  function post(path, body) { return request('POST', path, body); }
  function put(path, body)  { return request('PUT', path, body); }
  function del(path)        { return request('DELETE', path); }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.API = {
    get: get,
    post: post,
    put: put,
    del: del,
    request: request
  };
})();
