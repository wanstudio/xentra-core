import React, { useState, useEffect, useCallback } from 'react';

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}
  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function formatMoney(amount) {
  const num = parseFloat(amount) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return dateStr;
  }
}

export default function OrdersPage({ onNavigate }) {
  const [filter, setFilter] = useState('ACTIVE');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      const token = getAuthToken();
      const headers = { Accept: 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let branchId = '';
      if (typeof window !== 'undefined' && window._branchContextState) {
        const b = window._branchContextState;
        if (b.selected && b.selected !== 'all') branchId = b.selected;
      }

      const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}&_t=${Date.now()}` : `?_t=${Date.now()}`;
      const res = await fetch(`/api/v1/admin/orders${qs}`, { headers, cache: 'no-store' });
      if (!res.ok) throw new Error('Gagal memuat pesanan');
      const data = await res.json();
      if (data && data.success && Array.isArray(data.orders)) {
        setOrders(data.orders);
      } else if (Array.isArray(data)) {
        setOrders(data);
      }
    } catch (err) {
      console.warn('[OrdersPage] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 15000); // 15s auto-poll
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOrders();
  };

  const filteredOrders = orders.filter((o) => {
    const status = String(o.status || '').toLowerCase();
    if (filter === 'ACTIVE') {
      return ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(status);
    }
    if (filter === 'COMPLETED') {
      return status === 'completed';
    }
    if (filter === 'CANCELLED') {
      return status === 'cancelled';
    }
    return true;
  });

  const activeCount = orders.filter((o) =>
    ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(String(o.status || '').toLowerCase())
  ).length;

  const getStatusBadge = (status) => {
    const s = String(status || '').toLowerCase();
    switch (s) {
      case 'pending':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">Menunggu</span>;
      case 'confirmed':
      case 'preparing':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">Diproses</span>;
      case 'ready':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">Siap</span>;
      case 'completed':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Selesai</span>;
      case 'cancelled':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">Batal</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">{s}</span>;
    }
  };

  return (
    <div
      id="modern-orders-page-root"
      style={{ boxSizing: 'border-box', paddingBottom: '8px' }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 m-0">Antrean Pesanan</h1>
            {activeCount > 0 && (
              <span className="bg-emerald-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                {activeCount} Aktif
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 m-0 mt-0.5">Kelola pesanan masuk lintas cabang real-time</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all cursor-pointer active:scale-95 shadow-xs"
          title="Segarkan data"
        >
          <svg className={`w-4 h-4 ${refreshing ? 'animate-spin text-emerald-600' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
        {[
          { key: 'ACTIVE', label: 'Perlu Diproses' },
          { key: 'ALL', label: 'Semua' },
          { key: 'COMPLETED', label: 'Selesai' },
          { key: 'CANCELLED', label: 'Dibatalkan' }
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer shrink-0 border ${
              filter === f.key
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="flex flex-col gap-3 py-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 bg-white rounded-2xl border border-slate-200 animate-pulse flex flex-col gap-2">
              <div className="h-4 bg-slate-100 rounded w-1/3" />
              <div className="h-3 bg-slate-100 rounded w-2/3" />
              <div className="h-4 bg-slate-100 rounded w-1/4 mt-2" />
            </div>
          ))}
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="py-16 text-center flex flex-col items-center justify-center gap-2">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <span className="text-sm font-bold text-slate-700">Tidak ada antrean pesanan</span>
          <span className="text-xs text-slate-400">Pesanan baru yang masuk akan muncul di sini secara otomatis.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredOrders.map((o) => {
            const items = Array.isArray(o.items) ? o.items : [];
            const itemsDesc = items.map((it) => `${it.quantity || 1}x ${it.name || it.product_name}`).join(', ');
            return (
              <div
                key={o.id}
                className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex flex-col gap-2.5 transition-all hover:border-slate-300"
              >
                {/* Header card */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-900">
                      #{String(o.order_number || o.id).slice(-6).toUpperCase()}
                    </span>
                    {o.branch_name && (
                      <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                        {o.branch_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-400">{formatTime(o.created_at)}</span>
                    {getStatusBadge(o.status)}
                  </div>
                </div>

                {/* Customer info */}
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">{o.customer_name || 'Pelanggan'}</span>
                  <span className="text-slate-500">{o.fulfillment_type || o.channel || 'Dine-in'}</span>
                </div>

                {/* Items preview */}
                {itemsDesc && (
                  <p className="text-xs text-slate-600 line-clamp-2 bg-slate-50 p-2 rounded-lg m-0 border border-slate-100">
                    {itemsDesc}
                  </p>
                )}

                {/* Footer card */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                  <span className="text-[11px] text-slate-400 font-medium">Total Pembayaran</span>
                  <span className="text-sm font-extrabold text-slate-900">{formatMoney(o.total || o.final_amount)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
