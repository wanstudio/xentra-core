'use strict';

/** Builds the customer receipt and kitchen ticket from canonical order/payment rows. */
class ReceiptDocumentService {
  static _clean(value) {
    return String(value == null ? '' : value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
  }

  static _money(value) {
    return 'Rp ' + Math.round(Number(value) || 0).toLocaleString('id-ID');
  }

  static _date(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date) + ' WIB';
  }

  static _parseJson(value) {
    try { return value ? JSON.parse(value) : {}; } catch (_) { return {}; }
  }

  static _paymentRow(row, source) {
    const raw = ReceiptDocumentService._parseJson(row.raw_payment || row.raw_webhook_response);
    const amount = Number(row.amount) || 0;
    const tendered = raw.amount_tendered == null ? null : Number(raw.amount_tendered);
    return {
      method: row.payment_method || row.provider || 'pembayaran',
      amount,
      tendered: Number.isFinite(tendered) ? tendered : null,
      change: raw.change == null ? (Number.isFinite(tendered) ? Math.max(0, tendered - amount) : null) : Number(raw.change),
      settled_at: row.settled_at || row.created_at || null,
      payer_name: row.payer_name || null,
      source
    };
  }

  static _loadContext(db, order) {
    const itemRows = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid ASC').all(order.id);
    const items = itemRows.map((item) => {
      const modifiers = ReceiptDocumentService._parseJson(item.modifiers_snapshot);
      const optionText = Array.isArray(modifiers) ? modifiers.map((option) => {
        const group = ReceiptDocumentService._clean(option.group_name);
        const name = ReceiptDocumentService._clean(option.option_name || option.name);
        return name ? (group ? group + ': ' + name : name) : '';
      }).filter(Boolean).join(' · ') : '';
      return {
        name: item.product_name || item.name || item.product_id || 'Menu',
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price || item.price) || 0,
        subtotal: Number(item.item_subtotal == null ? item.subtotal : item.item_subtotal) || 0,
        note: [optionText, ReceiptDocumentService._clean(item.note)].filter(Boolean).join(' · ')
      };
    });

    const orderPayment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order.id);
    const checkPayments = db.prepare("SELECT * FROM pos_check_payments WHERE order_id = ? AND payment_status = 'settlement' ORDER BY settled_at, created_at").all(order.id);
    const realCheckPayments = checkPayments.filter((row) => {
      const raw = ReceiptDocumentService._parseJson(row.raw_payment);
      return raw.source !== 'existing_order_payment';
    });

    let payments = [];
    let paidAmount = 0;
    let groupInfo = null;
    const groupRow = db.prepare(`
      SELECT g.id, g.group_number, g.status, go.allocated_amount,
             gp.payment_method, gp.amount_tendered, gp.change_amount, gp.settled_at
      FROM pos_payment_group_orders go
      JOIN pos_payment_groups g ON g.id = go.group_id
      LEFT JOIN pos_payment_group_payments gp ON gp.group_id = g.id AND gp.payment_status = 'settlement'
      WHERE go.order_id = ? AND g.status = 'settled'
      ORDER BY gp.settled_at DESC LIMIT 1
    `).get(order.id);

    if (groupRow) {
      groupInfo = { id: groupRow.id, number: groupRow.group_number };
      paidAmount = Number(groupRow.allocated_amount) || 0;
      payments = [{
        method: groupRow.payment_method || 'pembayaran gabungan',
        amount: paidAmount,
        // Tender/change belongs to the whole payment group and must not be
        // repeated as if it applied to this order's allocation alone.
        tendered: null,
        change: null,
        settled_at: groupRow.settled_at || null,
        group_number: groupRow.group_number
      }];
    } else if (realCheckPayments.length) {
      payments = realCheckPayments.map((row) => ReceiptDocumentService._paymentRow(row, 'check'));
      paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);
    } else if (orderPayment && orderPayment.payment_status === 'settlement') {
      payments = [ReceiptDocumentService._paymentRow(orderPayment, 'order')];
      paidAmount = Number(orderPayment.amount) || 0;
    } else if (order.payment_status === 'settlement' || order.payment_status === 'paid') {
      paidAmount = Number(order.grand_total) || 0;
    }

    return {
      items,
      payments,
      paid_amount: Math.min(Number(order.grand_total) || 0, paidAmount),
      payment_group: groupInfo
    };
  }

  static buildOrderDocument({ db, order, branch_name = 'Xentra Resto', type = 'customer', open_cash_drawer = false }) {
    if (!db || !order) throw new Error('Data order untuk dokumen cetak tidak lengkap.');
    const context = ReceiptDocumentService._loadContext(db, order);
    const document = type === 'kitchen'
      ? ReceiptDocumentService.buildKitchenTicket({ order, branch_name, items: context.items })
      : ReceiptDocumentService.buildCustomerReceipt({ order, branch_name, ...context, open_cash_drawer });
    return document;
  }

  static buildCustomerReceipt({ order, branch_name = 'Xentra Resto', items = [], payments = [], paid_amount = 0, payment_group = null, open_cash_drawer = false }) {
    const total = Math.max(0, Number(order.grand_total) || 0);
    const paid = Math.min(total, Math.max(0, Number(paid_amount) || 0));
    const due = Math.max(0, total - paid);
    const settled = due <= 0.000001;
    const isCod = order.order_type === 'delivery' && String(order.payment_method || '').toLowerCase() === 'cash' && !settled;
    const status = settled ? 'LUNAS' : (isCod ? 'COD · BAYAR KE DRIVER' : (paid > 0 ? 'PEMBAYARAN SEBAGIAN' : 'BELUM DIBAYAR'));
    const typeMap = { dine_in: 'DINE IN', pickup: 'TAKEAWAY', takeaway: 'TAKEAWAY', delivery: 'DELIVERY', reservation: 'RESERVASI' };
    const lines = [];
    const add = (text, align = 'left', bold = false, size = 'normal') => lines.push({ text: ReceiptDocumentService._clean(text), align, bold, size });

    add(branch_name || 'Xentra Resto', 'center', true, 'double');
    if (order.branch_address) add(order.branch_address, 'center');
    if (order.branch_phone) add(order.branch_phone, 'center');
    add('================================', 'center');
    add(settled ? 'STRUK PEMBAYARAN' : 'TAGIHAN / BUKTI PESANAN', 'center', true);
    add('No. Order : ' + (order.order_number || order.id));
    add('Waktu     : ' + ReceiptDocumentService._date(order.created_at));
    add('Tipe      : ' + (typeMap[order.order_type] || String(order.order_type || 'PESANAN').toUpperCase()));
    if (order.table_number) add('Meja      : ' + order.table_number, 'left', true);
    if (order.customer_name) add('Pelanggan : ' + order.customer_name);
    if (order.order_channel) add('Kanal     : ' + String(order.order_channel).toUpperCase());
    add('--------------------------------', 'center');

    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      const name = ReceiptDocumentService._clean(item.name || item.product_name || 'Menu');
      const subtotal = Number(item.subtotal) || (Number(item.unit_price) || 0) * qty;
      add(qty + 'x ' + name);
      add('  ' + ReceiptDocumentService._money(item.unit_price) + ' × ' + qty + ' = ' + ReceiptDocumentService._money(subtotal));
      if (item.note) add('  Opsi/Catatan: ' + item.note);
    }

    add('--------------------------------', 'center');
    add('Subtotal  : ' + ReceiptDocumentService._money(order.subtotal));
    if (Number(order.discount_amount) > 0) add('Diskon    : -' + ReceiptDocumentService._money(order.discount_amount));
    if (Number(order.delivery_fee) > 0) add('Ongkir    : ' + ReceiptDocumentService._money(order.delivery_fee));
    add('TOTAL     : ' + ReceiptDocumentService._money(total), 'left', true, 'double');
    add('Status    : ' + status, 'left', true);
    if (paid > 0) add('Dibayar   : ' + ReceiptDocumentService._money(paid));
    if (due > 0 && !isCod) add('Sisa      : ' + ReceiptDocumentService._money(due));

    if (payments.length) {
      const methods = Array.from(new Set(payments.map((payment) => String(payment.method || 'pembayaran').toUpperCase())));
      add('Metode    : ' + methods.join(' + '));
      if (payment_group) add('Gabungan  : ' + payment_group.number);
      for (const payment of payments) {
        if (payment.tendered != null && payment.change != null && !payment.group_number) {
          add('Tunai diterima : ' + ReceiptDocumentService._money(payment.tendered));
          add('Kembalian      : ' + ReceiptDocumentService._money(payment.change));
        }
      }
    } else if (order.payment_method && !isCod) {
      add('Metode    : ' + String(order.payment_method).toUpperCase());
    }
    add('--------------------------------', 'center');
    add('Terima kasih atas pesanan Anda', 'center');
    if (!settled) add('Simpan bukti ini sampai pembayaran selesai', 'center');
    add('\n\n');

    return {
      action: 'print_receipt',
      document_type: settled ? 'customer_receipt' : 'order_bill',
      order_id: order.id,
      order_number: order.order_number,
      payment_status: settled ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'),
      total,
      paid_amount: paid,
      due_amount: due,
      payments,
      lines,
      open_cash_drawer: Boolean(open_cash_drawer),
      raw_content: lines.map((line) => line.text).join('\n')
    };
  }

  static buildKitchenTicket({ order, branch_name = '', items = [] }) {
    const typeMap = { dine_in: 'DINE IN', pickup: 'TAKEAWAY', takeaway: 'TAKEAWAY', delivery: 'DELIVERY', reservation: 'RESERVASI' };
    const lines = [];
    const add = (text, align = 'left', bold = false, size = 'normal') => lines.push({ text: ReceiptDocumentService._clean(text), align, bold, size });
    add('TIKET DAPUR', 'center', true, 'double');
    if (branch_name) add(branch_name, 'center');
    add('================================', 'center');
    add('Order : ' + (order.order_number || order.id), 'left', true, 'double');
    add('Tipe  : ' + (typeMap[order.order_type] || String(order.order_type || 'PESANAN').toUpperCase()));
    if (order.table_number) add('MEJA  : ' + order.table_number, 'left', true, 'double');
    add('Waktu : ' + ReceiptDocumentService._date(order.created_at));
    if (order.customer_name) add('Nama  : ' + order.customer_name);
    if (order.order_note) add('CATATAN ORDER: ' + order.order_note, 'left', true);
    add('--------------------------------', 'center');
    for (const item of items) {
      add('[' + (Number(item.quantity) || 1) + 'x] ' + (item.name || item.product_name || 'Menu'), 'left', true);
      if (item.note) add('  Opsi/Catatan: ' + item.note);
    }
    add('================================', 'center');
    add('SEGERA DIPROSES', 'center', true);
    add('\n\n');
    return {
      action: 'print_kitchen_ticket',
      document_type: 'kitchen_ticket',
      order_id: order.id,
      order_number: order.order_number,
      lines,
      open_cash_drawer: false,
      raw_content: lines.map((line) => line.text).join('\n')
    };
  }
}

module.exports = ReceiptDocumentService;
