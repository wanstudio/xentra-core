/**
 * XENTRA — SHARED LIVE SEARCH (Owner Mobile)
 *
 * Satu kontrak untuk semua search input: search-as-you-type, tanpa tombol submit.
 * Page hanya menyediakan adapter-nya — dataset client-side (filter) atau loader
 * server-side (query ke API). Normalisasi query juga satu sumber di sini supaya
 * pencocokan case-insensitive dan spasi rapi di seluruh halaman.
 *
 * Kontrak perilaku:
 *   - trigger lewat event `input`, bukan klik tombol / Enter
 *   - query kosong  -> pemanggil mengembalikan default state (bukan "tidak ditemukan")
 *   - Enter         -> hanya mempercepat; bukan jalur utama, bukan requirement
 *   - debounce      -> 0 untuk filter client-side, > 0 untuk query server-side
 */
(function (window, document) {
  'use strict';

  // Default untuk search yang memanggil API: cukup untuk menahan request storm
  // tanpa terasa lag saat mengetik.
  var DEFAULT_DEBOUNCE = 250;

  /** '  Ikhwan   Jaya ' -> 'ikhwan jaya' */
  function normalize(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** Pencocokan substring case-insensitive. query harus sudah dinormalisasi. */
  function matches(haystack, query) {
    if (!query) return true;
    return normalize(haystack).indexOf(query) !== -1;
  }

  /** Cocok kalau SALAH SATU field relevan mengandung query. */
  function matchesAny(values, query) {
    if (!query) return true;
    var list = Array.isArray(values) ? values : [values];
    for (var i = 0; i < list.length; i++) {
      if (matches(list[i], query)) return true;
    }
    return false;
  }

  /**
   * Pasang live search pada sebuah input.
   *
   * @param {HTMLInputElement} input
   * @param {function({query: string, raw: string, empty: boolean})} onChange
   * @param {{debounce?: number}} [options]
   * @returns {function} unbind
   */
  function bind(input, onChange, options) {
    if (!input || typeof onChange !== 'function') return function () {};
    options = options || {};
    var wait = options.debounce == null ? DEFAULT_DEBOUNCE : Number(options.debounce) || 0;
    var timer = null;

    function emit() {
      timer = null;
      var raw = input.value;
      var query = normalize(raw);
      onChange({ query: query, raw: raw, empty: query === '' });
    }

    function onInput() {
      if (timer) clearTimeout(timer);
      if (wait <= 0) {
        emit();
        return;
      }
      timer = setTimeout(emit, wait);
    }

    function onKeydown(event) {
      // Enter hanya mempercepat; tanpa ini pun pencarian sudah berjalan.
      if (event.key !== 'Enter') return;
      if (timer) clearTimeout(timer);
      emit();
    }

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);

    return function unbind() {
      if (timer) clearTimeout(timer);
      timer = null;
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeydown);
    };
  }

  window.XentraLiveSearch = {
    DEFAULT_DEBOUNCE: DEFAULT_DEBOUNCE,
    normalize: normalize,
    matches: matches,
    matchesAny: matchesAny,
    bind: bind
  };
})(window, document);
