/**
 * Xentra POS Hardware Router
 * Generates neutral print payloads and ESC/POS byte sequences for:
 * 1. Customer Receipts (with Cash Drawer kick pulse trigger)
 * 2. Kitchen / Station Tickets
 */
class PosHardwareRouter {
  /**
   * Builds customer receipt print payload formatted for thermal ESC/POS printers.
   * 
   * @param {Object} params
   * @param {string} params.branch_name
   * @param {Object} params.order
   * @param {boolean} [params.open_cash_drawer=false]
   * @returns {Object} Print payload compatible with HardwarePrinterAdapter
   */
  static buildCustomerReceipt({ branch_name = 'Xentra Resto', order, open_cash_drawer = false }) {
    const lines = [];
    lines.push({ text: branch_name, align: 'center', bold: true, size: 'double' });
    lines.push({ text: `No: ${order.order_number || order.id}`, align: 'left' });
    lines.push({ text: `Tgl: ${new Date(order.created_at || Date.now()).toLocaleString('id-ID')}`, align: 'left' });
    lines.push({ text: '--------------------------------', align: 'center' });

    for (const item of (order.items || [])) {
      const qty = item.quantity || 1;
      const price = (item.unit_price || 0).toLocaleString('id-ID');
      const sub = (item.subtotal || 0).toLocaleString('id-ID');
      lines.push({ text: `${item.name}`, align: 'left' });
      lines.push({ text: `  ${qty} x Rp ${price} = Rp ${sub}`, align: 'right' });
    }

    lines.push({ text: '--------------------------------', align: 'center' });
    lines.push({ text: `TOTAL : Rp ${(order.grand_total || 0).toLocaleString('id-ID')}`, align: 'right', bold: true });

    if (order.payment_method === 'cash') {
      lines.push({ text: `TUNAI : Rp ${(order.amount_tendered || order.grand_total || 0).toLocaleString('id-ID')}`, align: 'right' });
      lines.push({ text: `KEMBALI: Rp ${(order.change || 0).toLocaleString('id-ID')}`, align: 'right' });
    } else {
      lines.push({ text: `BAYAR : ${String(order.payment_method).toUpperCase()}`, align: 'right' });
    }

    lines.push({ text: 'Terima Kasih Atas Kunjungan Anda', align: 'center' });

    return {
      action: 'print_receipt',
      lines,
      open_cash_drawer: Boolean(open_cash_drawer || order.payment_method === 'cash'),
      raw_content: lines.map(l => l.text).join('\n')
    };
  }

  /**
   * Builds kitchen ticket print payload for food preparation stations.
   * 
   * @param {Object} params
   * @param {Object} params.order
   * @param {string} [params.table_number]
   * @returns {Object} Kitchen ticket payload
   */
  static buildKitchenTicket({ order, table_number = '' }) {
    const lines = [];
    lines.push({ text: `*** TIKET DAPUR ***`, align: 'center', bold: true });
    lines.push({ text: `Order: ${order.order_number || order.id}`, align: 'left' });
    if (table_number) {
      lines.push({ text: `MEJA : ${table_number}`, align: 'left', bold: true, size: 'double' });
    }
    lines.push({ text: '================================', align: 'center' });

    for (const item of (order.items || [])) {
      lines.push({ text: `[ ] ${item.quantity}x ${item.name}`, align: 'left', bold: true });
      if (item.note) {
        lines.push({ text: `    Note: ${item.note}`, align: 'left' });
      }
    }
    lines.push({ text: '================================', align: 'center' });

    return {
      action: 'print_kitchen_ticket',
      lines,
      raw_content: lines.map(l => l.text).join('\n')
    };
  }
}

module.exports = PosHardwareRouter;
