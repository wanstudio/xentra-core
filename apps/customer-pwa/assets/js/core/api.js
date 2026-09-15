/**
 * Xentra API Client
 * Centralized fetch wrapper with timeout, error handling, auth headers, brand slug, and base URL.
 */
(function () {
  'use strict';

  var BASE = '/api/v1';
  var TIMEOUT = 10000;

  /**
   * Make an API request.
   * @param {string} method - HTTP method
   * @param {string} path - API path (e.g. '/catalog/menu')
   * @param {string} method - HTTP method
   * @param {string} path - Endpoint path
   * @param {object} [body] - Request body for POST/PUT
   * @param {object} [options] - Additional options (e.g. { signal, headers })
   * @returns {Promise<object>} - Parsed JSON response
   */
  function request(method, path, body, options) {
    options = options || {};
    var url = BASE + path;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () {
      try {
        controller.abort(new DOMException('Request timeout', 'TimeoutError'));
      } catch (_) {
        controller.abort();
      }
    }, TIMEOUT) : null;

    // If caller provided an external AbortSignal, forward its abort event
    var externalSignal = options.signal;
    var onExternalAbort = null;
    if (externalSignal && controller) {
      if (externalSignal.aborted) {
        try {
          controller.abort(externalSignal.reason);
        } catch (_) {
          controller.abort();
        }
      } else {
        onExternalAbort = function () {
          try {
            controller.abort(externalSignal.reason);
          } catch (_) {
            controller.abort();
          }
        };
        if (typeof externalSignal.addEventListener === 'function') {
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }
    }

    function cleanup() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (externalSignal && onExternalAbort && typeof externalSignal.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', onExternalAbort);
        onExternalAbort = null;
      }
    }

    var headers = {
      'Content-Type': 'application/json',
      'x-brand-slug': 'bangjo'
    };

    if (options.headers && typeof options.headers === 'object') {
      for (var hKey in options.headers) {
        if (Object.prototype.hasOwnProperty.call(options.headers, hKey)) {
          headers[hKey] = options.headers[hKey];
        }
      }
    }

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
      headers: headers
    };

    if (controller) {
      opts.signal = controller.signal;
    } else if (externalSignal) {
      opts.signal = externalSignal;
    }

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      opts.body = JSON.stringify(body);
    }

    return fetch(url, opts)
      .then(function (res) {
        cleanup();
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
        cleanup();
        // Don't log expected aborts as errors to keep console clean
        if (!isAbortError(err)) {
          console.error('[API] ' + method + ' ' + path, err);
        }
        throw err;
      });
  }

  function isAbortError(err) {
    if (!err) return false;
    return (
      err.name === 'AbortError' ||
      err.code === 20 || // DOMException.ABORT_ERR
      (typeof err.message === 'string' && /aborted|abort/i.test(err.message))
    );
  }

  // ── Convenience Methods ──
  function get(path, options)        { return request('GET', path, null, options); }
  function post(path, body, options) { return request('POST', path, body, options); }
  function put(path, body, options)  { return request('PUT', path, body, options); }
  function del(path, options)        { return request('DELETE', path, null, options); }

  // ── Export ──
  window.Xentra = window.Xentra || {};
  window.Xentra.API = {
    get: get,
    post: post,
    put: put,
    del: del,
    request: request,
    isAbortError: isAbortError
  };
})();
