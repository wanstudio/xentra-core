/**
 * XENTRA NATIVE THERMAL PRINTER CLIENT (ESC/POS SPP)
 *
 * Integrates Native Android Bluetooth printer bridge with Web UI.
 * Supports auto-connect, 58mm/80mm receipt generation, and auto-print on order acceptance.
 */
(function () {
  'use strict';

  var STORAGE_KEY_MAC = 'xentra_native_printer_mac';
  var STORAGE_KEY_AUTOPRINT = 'xentra_native_autoprint_enabled';

  var XentraPrinter = {
    isNative: function () {
      return !!(window.XentraNative && typeof window.XentraNative.printReceipt === 'function');
    },

    getPairedPrinters: function () {
      if (!this.isNative()) return [];
      try {
        var jsonStr = window.XentraNative.getPairedPrinters();
        return JSON.parse(jsonStr || '[]');
      } catch (e) {
        console.warn('[Printer Bridge] getPairedPrinters error:', e);
        return [];
      }
    },

    getSavedPrinter: function () {
      return localStorage.getItem(STORAGE_KEY_MAC) || '';
    },

    savePrinter: function (mac) {
      if (mac) {
        localStorage.setItem(STORAGE_KEY_MAC, mac);
      } else {
        localStorage.removeItem(STORAGE_KEY_MAC);
      }
    },

    isAutoPrintEnabled: function () {
      return localStorage.getItem(STORAGE_KEY_AUTOPRINT) === 'true';
    },

    setAutoPrint: function (enabled) {
      localStorage.setItem(STORAGE_KEY_AUTOPRINT, enabled ? 'true' : 'false');
    },

    connect: function (macAddress) {
      if (!this.isNative()) return false;
      var mac = macAddress || this.getSavedPrinter();
      if (!mac) return false;
      try {
        var ok = window.XentraNative.connectPrinter(mac);
        if (ok) {
          this.savePrinter(mac);
        }
        return ok;
      } catch (e) {
        console.warn('[Printer Bridge] Connect error:', e);
        return false;
      }
    },

    isConnected: function () {
      if (!this.isNative()) return false;
      try {
        return window.XentraNative.isPrinterConnected();
      } catch (_) {
        return false;
      }
    },

    printText: function (text) {
      if (!this.isNative()) {
        window.print();
        return true;
      }
      try {
        if (!this.isConnected()) {
          var saved = this.getSavedPrinter();
          if (saved) this.connect(saved);
        }
        return window.XentraNative.printReceipt(text);
      } catch (e) {
        console.warn('[Printer Bridge] Print text error:', e);
        return false;
      }
    },

    testPrint: function () {
      var lines = [];
      lines.push('================================');
      lines.push('       TES PRINTER BLUETOOTH    ');
      lines.push('         MYBANGJO MERCHANT      ');
      lines.push('================================');
      lines.push('Status     : Terhubung Normal   ');
      lines.push('Tanggal    : ' + new Date().toLocaleString('id-ID'));
      lines.push('--------------------------------');
      lines.push('Direct ESC/POS Thermal Printing ');
      lines.push('Siap mencetak pesanan kasir &   ');
      lines.push('dapur otomatis tanpa dialog.    ');
      lines.push('================================');
      lines.push('      Sistem Kasir Berhasil!    ');
      lines.push('================================\n\n');
      return this.printText(lines.join('\n'));
    },

    formatReceipt: function (order, storeInfo) {
      order = order || {};
      storeInfo = storeInfo || {};
      var storeName = storeInfo.name || 'MYBANGJO RESTO';
      var orderNum = order.order_number || '';
      if (!orderNum && order.id) {
        var digits = String(order.id).replace(/\D/g, '');
        var num = digits.length >= 3 ? digits.slice(-3) : '100';
        var pfx = (order.order_type === 'dine_in' ? 'DI' : (order.order_type === 'reservation' ? 'RS' : (order.order_type === 'takeaway' ? 'TK' : 'OD')));
        orderNum = pfx + '-' + num;
      }
      if (orderNum && !orderNum.startsWith('#')) orderNum = '#' + orderNum;
      if (!orderNum) orderNum = 'Pesanan';
      var orderType = orderTypeMap[order.order_type] || 'Pesanan';
      var customer = order.customer_name || 'Pelanggan';
      var table = (order.table_name || order.table_number) ? ('Meja ' + (order.table_name || order.table_number)) : '';
      var timeStr = (order.created_at || '').substring(0, 16).replace('T', ' ');

      var pad = function (left, right, width) {
        width = width || 32;
        left = String(left || '');
        right = String(right || '');
        var space = width - left.length - right.length;
        if (space < 1) space = 1;
        return left + ' '.repeat(space) + right;
      };

      var lines = [];
      lines.push('================================');
      lines.push(storeName.toUpperCase().padStart((32 + storeName.length) / 2));
      lines.push(branchName.padStart((32 + branchName.length) / 2));
      lines.push('================================');
      lines.push('No. Pesanan : #' + orderNum);
      lines.push('Waktu       : ' + (timeStr || new Date().toLocaleString('id-ID')));
      lines.push('Tipe        : ' + orderType + (table ? ' (' + table + ')' : ''));
      lines.push('Pelanggan   : ' + customer);
      if (order.customer_phone) lines.push('Telepon     : ' + order.customer_phone);
      lines.push('--------------------------------');

      var items = order.items || [];
      items.forEach(function (it) {
        var qty = it.quantity || 1;
        var name = it.product_name || it.item_name || 'Menu';
        var total = (it.item_subtotal != null ? it.item_subtotal : ((it.unit_price || 0) * qty));
        var totalStr = 'Rp' + Number(total).toLocaleString('id-ID');

        lines.push(pad(qty + 'x ' + name, totalStr, 32));
        if (it.note) {
          lines.push('   Catatan: ' + it.note);
        }
      });

      lines.push('--------------------------------');
      var subtotalStr = 'Rp' + Number(order.subtotal || order.grand_total || 0).toLocaleString('id-ID');
      lines.push(pad('Subtotal', subtotalStr, 32));

      if (order.delivery_fee) {
        lines.push(pad('Ongkir', 'Rp' + Number(order.delivery_fee).toLocaleString('id-ID'), 32));
      }
      if (order.discount_amount) {
        lines.push(pad('Diskon', '-Rp' + Number(order.discount_amount).toLocaleString('id-ID'), 32));
      }

      var grandTotalStr = 'Rp' + Number(order.grand_total || 0).toLocaleString('id-ID');
      lines.push(pad('TOTAL', grandTotalStr, 32));
      lines.push('================================');
      lines.push('       Terima Kasih Atas        ');
      lines.push('        Pesanan Anda!           ');
      lines.push('================================\n\n');

      return lines.join('\n');
    },

    printOrder: function (order, storeInfo) {
      var receiptText = this.formatReceipt(order, storeInfo);
      return this.printText(receiptText);
    }
  };

  window.XentraPrinter = XentraPrinter;
})();
