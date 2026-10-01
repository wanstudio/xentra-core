/**
 * XENTRA — SHARED CURRENCY INPUT (Owner Mobile)
 *
 * Source of truth untuk field nominal uang: Rupiah, bilangan bulat, pemisah
 * ribuan titik. Dipakai lewat atribut `data-input-type="currency"` di markup,
 * jadi tidak ada formatter per halaman.
 *
 * Kontrak:
 *   - Yang DILIHAT user  : '1.232.342' (titik = pemisah ribuan)
 *   - Yang DIKIRIM ke API: 1232342     (integer murni, tanpa titik)
 *   - Tanpa simbol 'Rp' di dalam value input; label "Harga Jual (Rp)" tetap
 *     terpisah di markup (formatMoney() milik shared.js hanya untuk tampilan).
 *   - Kosong tetap kosong (tidak otomatis 0).
 *   - Keyboard angka: inputmode numeric + type text (type number tidak bisa
 *     menampilkan pemisah ribuan).
 *
 * Bukan untuk kuantitas/stok/KM/persen/telepon/ID/lat-lng — itu angka biasa.
 */
(function (window, document) {
  'use strict';

  var ATTR = 'data-input-type';
  var TYPE = 'currency';

  function digitsOnly(value) {
    return String(value == null ? '' : value).replace(/\D+/g, '');
  }

  /** 1232342 -> '1.232.342' ; '' / null -> '' */
  function format(value) {
    var digits = digitsOnly(value);
    if (digits === '') return '';
    // parseInt membuang leading zero: '007' -> 7 (kecuali '0' -> 0).
    var n = parseInt(digits, 10);
    if (!isFinite(n)) return '';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /** '1.232.342' -> 1232342 ; '' -> 0 */
  function parse(value) {
    var digits = digitsOnly(value);
    if (digits === '') return 0;
    var n = parseInt(digits, 10);
    return isFinite(n) ? n : 0;
  }

  /** '1.232.342' -> 1232342 ; '' -> null (untuk field opsional) */
  function parseOrNull(value) {
    return digitsOnly(value) === '' ? null : parse(value);
  }

  /** Nilai numerik dari sebuah input currency. */
  function getValue(el) {
    return parse(el && el.value);
  }

  /** Tulis nilai numerik ke input currency (null/'' -> kosong). */
  function setValue(el, value) {
    if (!el) return;
    el.value = (value === null || value === undefined || value === '') ? '' : format(value);
  }

  /** Posisi caret setelah digit ke-n, supaya kursor tidak melompat saat format. */
  function caretForDigitIndex(text, digitIndex) {
    if (digitIndex <= 0) return 0;
    var seen = 0;
    for (var i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) {
        seen += 1;
        if (seen === digitIndex) return i + 1;
      }
    }
    return text.length;
  }

  /** Format ulang isi input sambil mempertahankan posisi caret. */
  function applyInput(el) {
    var raw = el.value;
    var caret = el.selectionStart == null ? raw.length : el.selectionStart;
    var digitsBeforeCaret = digitsOnly(raw.slice(0, caret)).length;
    var formatted = format(raw);
    if (formatted === raw) return;
    el.value = formatted;
    var pos = caretForDigitIndex(formatted, digitsBeforeCaret);
    try {
      el.setSelectionRange(pos, pos);
    } catch (e) { /* input tanpa dukungan selection */ }
  }

  /** Pasang perilaku currency pada satu elemen. */
  function enhance(el) {
    if (!el || el.getAttribute(ATTR) !== TYPE || el.__xCurrencyReady) return el;
    el.__xCurrencyReady = true;

    // Keyboard angka di mobile, tanpa keyboard teks biasa.
    if (!el.getAttribute('inputmode')) el.setAttribute('inputmode', 'numeric');
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('type', 'text');

    el.addEventListener('input', function () { applyInput(el); });
    el.addEventListener('blur', function () { el.value = format(el.value); });

    setValue(el, el.value); // nilai awal dari server ikut diformat
    return el;
  }

  function enhanceAll(root) {
    var scope = root || document;
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll('[' + ATTR + '="' + TYPE + '"]').forEach(enhance);
  }

  function init() {
    enhanceAll(document);
    // Field yang dirender belakangan: bottom sheet, modal, editor dinamis.
    if (typeof MutationObserver !== 'function') return;
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.prototype.forEach.call(mutation.addedNodes || [], function (node) {
          if (!node || node.nodeType !== 1) return;
          if (node.matches && node.matches('[' + ATTR + '="' + TYPE + '"]')) enhance(node);
          enhanceAll(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.XentraCurrencyInput = {
    ATTRIBUTE: ATTR,
    TYPE: TYPE,
    format: format,
    parse: parse,
    parseOrNull: parseOrNull,
    digitsOnly: digitsOnly,
    getValue: getValue,
    setValue: setValue,
    enhance: enhance,
    enhanceAll: enhanceAll
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window, document);
