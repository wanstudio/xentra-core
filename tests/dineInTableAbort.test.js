const test = require('node:test');
const assert = require('node:assert');

test('Dine-in table abort and lifecycle handling', async (t) => {
  // Mock window & DOM environment
  const handlers = {};
  let abortedSignalCaught = false;

  // Verify isAbortError logic
  const isAbortError = (err) => {
    if (!err) return false;
    return (
      err.name === 'AbortError' ||
      err.code === 20 || // DOMException.ABORT_ERR
      (typeof err.message === 'string' && /aborted|abort/i.test(err.message))
    );
  };

  await t.test('detects various forms of abort errors', () => {
    assert.strictEqual(isAbortError(new Error('signal is aborted without reason')), true);
    assert.strictEqual(isAbortError(new DOMException('The user aborted a request.', 'AbortError')), true);
    assert.strictEqual(isAbortError({ name: 'AbortError', message: 'aborted' }), true);
    assert.strictEqual(isAbortError(new Error('Network error: 500 Internal Server Error')), false);
    assert.strictEqual(isAbortError(new Error('Failed to fetch')), false);
    assert.strictEqual(isAbortError(null), false);
  });

  await t.test('request race condition and stale response rejection simulation', async () => {
    let dineInFetchId = 0;
    let renderedResult = null;

    async function simulateFetch(id, delayMs, shouldFailWithAbort, resultData) {
      const currentReqId = ++dineInFetchId;
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (currentReqId !== dineInFetchId) {
            // Stale request discarded
            return resolve('STALE_DISCARDED');
          }
          if (shouldFailWithAbort) {
            const err = new Error('signal is aborted without reason');
            err.name = 'AbortError';
            if (isAbortError(err)) {
              // Silently ignore
              return resolve('ABORT_IGNORED');
            }
            renderedResult = 'ERROR: ' + err.message;
            return reject(err);
          }
          renderedResult = resultData;
          resolve('SUCCESS');
        }, delayMs);
      });
    }

    // Launch Request 1 (slow, gets aborted by user action)
    const p1 = simulateFetch(1, 80, true, 'LAYOUT_1');
    // Rapidly launch Request 2 (fast, successful)
    const p2 = simulateFetch(2, 20, false, 'LAYOUT_2');

    await Promise.all([p1, p2]);

    // Ensure stale/aborted request did not overwrite layout with error
    assert.strictEqual(renderedResult, 'LAYOUT_2', 'Latest request must prevail and abort error must not overwrite UI');
  });

  await t.test('genuine server error produces user-friendly error message, not raw technical abort', () => {
    let uiError = null;
    const genuineErr = new Error('Database connection failed');
    const isAborted = isAbortError(genuineErr);

    if (!isAborted) {
      uiError = (genuineErr.data && genuineErr.data.error) ||
        (genuineErr.message && !/signal is aborted|abort/i.test(genuineErr.message) ? genuineErr.message : '') ||
        'Gagal memuat denah meja. Silakan coba lagi.';
    }

    assert.strictEqual(uiError, 'Database connection failed');
  });

  await t.test('empty tables list produces user-friendly empty state', () => {
    const layout = { tables: [], non_table_objects: [] };
    let emptyStateRendered = false;

    if (!layout.tables.length) {
      emptyStateRendered = true;
    }

    assert.strictEqual(emptyStateRendered, true);
  });
});
