/* ==========================================================================
   XENTRA MERCHANT HOME — PRESENTATION BOOT v1
   Home-specific UI only. Core/business authority remains in existing modules.
   ========================================================================== */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function getStoredUserSafe() {
    try {
      return typeof getStoredUser === 'function' ? (getStoredUser() || {}) : {};
    } catch (_) {
      return {};
    }
  }

  function updateGreeting() {
    var user = getStoredUserSafe();
    var hour = new Date().getHours();
    var greeting = hour < 11 ? 'Selamat pagi' : (hour < 15 ? 'Selamat siang' : (hour < 18 ? 'Selamat sore' : 'Selamat malam'));
    var name = user.full_name || user.username || '';
    var branch = user.branch_name || '';
    var title = $('bm-home-greeting-title');
    var date = $('bm-home-greeting-date');

    if (title) {
      title.textContent = greeting + (name ? ', ' + name.split(' ')[0] : '') + ' 👋';
    }

    if (date) {
      var days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      var months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      var now = new Date();
      date.textContent = days[now.getDay()] + ', ' + now.getDate() + ' ' + months[now.getMonth()] + ' • ' + (branch || 'Operasional Cabang');
    }
  }

  function formatCompactMoney(value) {
    if (typeof formatMoney === 'function') return formatMoney(value);
    return 'Rp' + (Number(value) || 0).toLocaleString('id-ID');
  }

  function syncSalesPresentation() {
    var sales = $('bm-stat-net-sales-today');
    var completed = $('bm-stat-completed-orders');
    var average = $('bm-stat-average-order');

    if (!sales) return;

    // Nominal sekarang ditulis sebagai dua bagian (angka + "Rp" di bawahnya), jadi
    // angkanya dibaca dari bagiannya sendiri. Menulis ulang sales.textContent di sini
    // akan menghapus kedua bagian itu — jadi tidak dilakukan lagi.
    var amountEl = sales.querySelector('.x-home-sales-amount');
    var rawText = amountEl ? (amountEl.textContent || '') : (sales.textContent || '');
    var digits = rawText.replace(/[^\d]/g, '');

    var completedCount = completed ? Number(completed.textContent || 0) : 0;
    var numericSales = digits ? Number(digits) : 0;
    if (average) {
      average.textContent = completedCount > 0
        ? formatCompactMoney(Math.round(numericSales / completedCount))
        : 'Rp0';
    }
  }

  function init() {
    updateGreeting();
    syncSalesPresentation();
  }

  window.addEventListener('DOMContentLoaded', init);
  window.addEventListener('merchant:home-ready', init);

  window.XentraMerchantHome = {
    refreshPresentation: init
  };
})();
