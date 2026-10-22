import React, { useState, useEffect, useCallback } from 'react';
import { OverviewData, OverviewPeriod } from '../types';

interface OverviewPageProps {
  onNavigate?: (route: string) => void;
}

const formatMoney = (val: number): string => {
  return 'Rp ' + Number(val || 0).toLocaleString('id-ID');
};

const toYMD = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const OverviewPage: React.FC<OverviewPageProps> = ({ onNavigate }) => {
  const [period, setPeriod] = useState<OverviewPeriod>('today');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isCustomOpen, setIsCustomOpen] = useState<boolean>(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);

  // Compute dates for preset
  const computeDatesForPreset = useCallback((preset: OverviewPeriod) => {
    const now = new Date();
    if (preset === 'today') {
      const todayStr = toYMD(now);
      return { start: todayStr, end: todayStr };
    }
    if (preset === '7d') {
      const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start: toYMD(past7), end: toYMD(now) };
    }
    if (preset === '30d') {
      const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { start: toYMD(past30), end: toYMD(now) };
    }
    return { start: startDate, end: endDate };
  }, [startDate, endDate]);

  const fetchOverview = useCallback(async (start?: string, end?: string) => {
    setLoading(true);
    setError(null);

    try {
      let branchId = '';
      if (typeof window !== 'undefined') {
        const bState = (window as any)._branchContextState;
        if (bState && bState.selected && bState.selected !== 'all') {
          branchId = String(bState.selected);
        }
      }

      const params = new URLSearchParams();
      if (branchId) params.append('branch_id', branchId);
      if (start) params.append('start_date', start);
      if (end) params.append('end_date', end);

      const token = typeof localStorage !== 'undefined'
        ? localStorage.getItem('xentra_merchant_token')
        : null;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const queryString = params.toString();
      const url = `/api/v1/admin/overview${queryString ? '?' + queryString : ''}`;

      const res = await fetch(url, { headers });
      const json = await res.json();

      if (json && json.success && json.data) {
        setData(json.data);
      } else {
        setData(null);
      }
    } catch (err: any) {
      console.error('[OverviewPage] fetch error:', err);
      setError('Gagal memuat data ringkasan bisnis. Periksa koneksi Anda.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load with 'today'
  useEffect(() => {
    const { start, end } = computeDatesForPreset('today');
    setStartDate(start);
    setEndDate(end);
    fetchOverview(start, end);
  }, []);

  const handleSelectPreset = (newPreset: OverviewPeriod) => {
    setPeriod(newPreset);
    setIsDropdownOpen(false);

    if (newPreset === 'custom') {
      setIsCustomOpen(true);
    } else {
      setIsCustomOpen(false);
      const { start, end } = computeDatesForPreset(newPreset);
      setStartDate(start);
      setEndDate(end);
      fetchOverview(start, end);
    }
  };

  const handleApplyCustomDates = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) return;
    setIsCustomOpen(false);
    fetchOverview(startDate, endDate);
  };

  const handleNav = (route: string) => {
    if (typeof onNavigate === 'function') {
      onNavigate(route);
    } else if (typeof window !== 'undefined') {
      window.location.hash = '#' + route;
    }
  };

  const kpis = data?.kpis || {
    net_sales: 0,
    orders: 0,
    customers: 0,
    aov: 0
  };

  const branchPerf = data?.branch_performance || [];
  const ordersSummary = data?.orders_summary || {
    total: kpis.orders || 0,
    completed: 0,
    in_progress: 0,
    cancelled: 0
  };
  const topProducts = data?.top_products || [];
  const needsAttention = data?.needs_attention || {};

  // Compute alerts
  const alerts: Array<{ text: string; link: string }> = [];
  if (needsAttention.low_stock_items && needsAttention.low_stock_items.length > 0) {
    alerts.push({
      text: `${needsAttention.low_stock_items.length} item produk stok menipis di bawah batas minimum`,
      link: 'reports'
    });
  }
  if (needsAttention.pending_payments_count && needsAttention.pending_payments_count > 0) {
    alerts.push({
      text: `${needsAttention.pending_payments_count} transaksi pembayaran perlu verifikasi`,
      link: 'finance'
    });
  }

  const periodLabelMap: Record<OverviewPeriod, string> = {
    today: 'Hari ini',
    '7d': '7 hari',
    '30d': '30 hari',
    custom: 'Kustom'
  };

  return (
    <div
      id="overview-page-body"
      style={{
        boxSizing: 'border-box'
      }}
      className="w-full flex flex-col gap-4 pb-12 max-w-lg md:mx-auto select-none"
    >
      {/* 1. Period Selector & Filter Header */}
      <div className="flex items-center justify-between gap-2 pt-1 relative">
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200/90 rounded-xl shadow-xs text-xs font-bold text-slate-800 hover:bg-slate-50 active:scale-98 transition-all cursor-pointer"
          >
            <svg
              className="w-4 h-4 text-slate-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{periodLabelMap[period]}</span>
            <svg
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                isDropdownOpen ? 'rotate-180' : ''
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Period Dropdown Menu */}
          {isDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsDropdownOpen(false)}
              />
              <div className="absolute left-0 mt-1.5 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden animate-in fade-in duration-150">
                {(['today', '7d', '30d', 'custom'] as OverviewPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleSelectPreset(p)}
                    className={`w-full px-3.5 py-2 text-left text-xs font-semibold flex items-center justify-between transition-colors ${
                      period === p
                        ? 'bg-emerald-50 text-emerald-700 font-bold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{periodLabelMap[p]}</span>
                    {period === p && (
                      <svg
                        className="w-3.5 h-3.5 text-emerald-600"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsCustomOpen((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 border rounded-xl shadow-xs text-xs font-semibold transition-all cursor-pointer ${
            isCustomOpen
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200/90 hover:bg-slate-50'
          }`}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>Pilih Tanggal</span>
        </button>
      </div>

      {/* Custom Date Range Card (Collapsible) */}
      {isCustomOpen && (
        <form
          onSubmit={handleApplyCustomDates}
          className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs flex flex-col gap-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Mulai
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-xs font-semibold px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Sampai
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-xs font-semibold px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-2 bg-[#00A637] hover:bg-emerald-600 active:scale-98 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
          >
            Terapkan Filter Tanggal
          </button>
        </form>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl p-3.5 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => fetchOverview(startDate, endDate)}
            className="text-rose-900 font-bold underline cursor-pointer ml-2"
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* 2. Hero KPI Card */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white rounded-2xl p-5 shadow-sm border border-slate-800">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">
            Penjualan
          </span>
          {kpis.trend && typeof kpis.trend.percent === 'number' ? (
            <div
              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                kpis.trend.direction === 'up'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/20 text-rose-400'
              }`}
            >
              <span>{kpis.trend.direction === 'up' ? '↑' : '↓'}</span>
              <span>
                {kpis.trend.percent}% {kpis.trend.label || 'vs kemarin'}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center text-[11px] font-medium text-slate-400 px-2 py-0.5 rounded-full bg-slate-800/80">
              Periode ini
            </div>
          )}
        </div>

        <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight my-2">
          {loading ? (
            <span className="inline-block w-36 h-7 bg-slate-800 animate-pulse rounded" />
          ) : (
            formatMoney(kpis.net_sales || 0)
          )}
        </div>

        <div className="border-t border-white/10 pt-3.5 mt-2 grid grid-cols-3 gap-2">
          <div className="flex flex-col">
            <span className="text-sm sm:text-base font-bold text-slate-100">
              {loading ? '—' : (kpis.orders || 0).toLocaleString('id-ID')}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Pesanan</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm sm:text-base font-bold text-slate-100 truncate">
              {loading ? '—' : formatMoney(kpis.aov || 0)}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Avg Order</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm sm:text-base font-bold text-slate-100">
              {loading ? '—' : (kpis.customers || 0).toLocaleString('id-ID')}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Pelanggan</span>
          </div>
        </div>
      </div>

      {/* 3. Quick Access (Akses Cepat) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Quick Access
          </h3>
          <button
            type="button"
            onClick={() => handleNav('business')}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>Lihat semua</span>
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2.5">
          {[
            { label: 'Menu', icon: '/owner/assets/icons/quick-access/menu.png', route: 'catalog/menus' },
            { label: 'Stok', icon: '/owner/assets/icons/quick-access/stock.png', route: 'stock' },
            { label: 'Cabang', icon: '/owner/assets/icons/quick-access/cabang.png', route: 'branches' },
            { label: 'Promo', icon: '/owner/assets/icons/quick-access/promo.png', route: 'marketing/promotions' },
            { label: 'Laporan', icon: '/owner/assets/icons/quick-access/laporan.png', route: 'reports' },
            { label: 'Metode Bayar', icon: '/owner/assets/icons/quick-access/metode bayar.png', route: 'finance/payment-methods' },
            { label: 'Pelanggan', icon: '/owner/assets/icons/quick-access/pelanggan.png', route: 'customers' },
            { label: 'Tim & Akses', icon: '/owner/assets/icons/quick-access/tim & akses.png', route: 'team' }
          ].map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleNav(item.route)}
              className="flex flex-col items-center justify-center p-2 rounded-xl bg-slate-50/80 hover:bg-slate-100/90 border border-slate-100 hover:border-slate-200 transition-all cursor-pointer active:scale-95 group"
            >
              <div className="w-10 h-10 flex items-center justify-center mb-1 group-hover:scale-105 transition-transform">
                <img
                  src={item.icon}
                  alt={item.label}
                  className="w-8 h-8 object-contain"
                  loading="eager"
                />
              </div>
              <span className="text-[10.5px] font-bold text-slate-700 text-center leading-tight line-clamp-1">
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 4. Ringkasan Pesanan (Orders Summary) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Ringkasan Pesanan
          </h3>
          <button
            type="button"
            onClick={() => handleNav('orders')}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>Lihat pesanan</span>
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <div className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <span className="text-base font-extrabold text-slate-900 leading-tight">
              {loading ? '—' : ordersSummary.total || 0}
            </span>
            <span className="text-[10.5px] font-semibold text-slate-500 mt-1">
              Total
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100 text-center">
            <span className="text-base font-extrabold text-emerald-600 leading-tight">
              {loading ? '—' : ordersSummary.completed || 0}
            </span>
            <span className="text-[10.5px] font-semibold text-emerald-700 mt-1">
              Selesai
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-blue-50/60 border border-blue-100 text-center">
            <span className="text-base font-extrabold text-blue-600 leading-tight">
              {loading ? '—' : ordersSummary.in_progress || 0}
            </span>
            <span className="text-[10.5px] font-semibold text-blue-700 mt-1">
              Diproses
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-rose-50/60 border border-rose-100 text-center">
            <span className="text-base font-extrabold text-rose-600 leading-tight">
              {loading ? '—' : ordersSummary.cancelled || 0}
            </span>
            <span className="text-[10.5px] font-semibold text-rose-700 mt-1">
              Dibatalkan
            </span>
          </div>
        </div>
      </div>

      {/* 5. Performa Cabang (Branch Performance) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Performa Cabang
          </h3>
          <button
            type="button"
            onClick={() => handleNav('reports')}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>Lihat semua</span>
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2 py-2">
            <div className="w-full h-8 bg-slate-100 animate-pulse rounded-lg" />
            <div className="w-full h-8 bg-slate-100 animate-pulse rounded-lg" />
          </div>
        ) : branchPerf.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-4 font-medium">
            Belum ada data transaksi cabang.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {branchPerf.map((b, idx) => (
              <div
                key={b.branch_id || idx}
                onClick={() => handleNav('branches')}
                className="py-2.5 flex items-center justify-between hover:bg-slate-50/70 cursor-pointer rounded-lg px-1 transition-colors"
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="text-xs font-bold text-slate-800 truncate">
                    {b.branch_name}
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">
                    {(b.total_orders || 0).toLocaleString('id-ID')} pesanan
                  </span>
                </div>
                <div className="text-xs font-extrabold text-emerald-600 whitespace-nowrap">
                  {formatMoney(b.total_revenue || 0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6. Produk Terlaris (Top Products) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Produk Terlaris
          </h3>
          <button
            type="button"
            onClick={() => handleNav('business/catalog')}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>Katalog</span>
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2 py-2">
            <div className="w-full h-8 bg-slate-100 animate-pulse rounded-lg" />
            <div className="w-full h-8 bg-slate-100 animate-pulse rounded-lg" />
          </div>
        ) : topProducts.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-4 font-medium">
            Belum ada produk yang terjual pada periode ini.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {topProducts.slice(0, 5).map((p, idx) => {
              const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
              return (
                <div
                  key={p.product_id || idx}
                  className="py-2.5 flex items-center gap-2.5 hover:bg-slate-50/70 rounded-lg px-1 transition-colors"
                >
                  <span className="text-sm font-bold w-6 text-center text-slate-500 shrink-0">
                    {medals[idx] || `${idx + 1}.`}
                  </span>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-bold text-slate-800 truncate">
                      {p.product_name}
                    </span>
                    <span className="text-[11px] text-slate-500 font-medium">
                      {(p.total_units_sold || 0).toLocaleString('id-ID')} terjual
                    </span>
                  </div>
                  <div className="text-xs font-extrabold text-slate-900 whitespace-nowrap">
                    {formatMoney(p.total_gross_sales || 0)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 7. Perhatian (Needs Attention) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Perhatian
          </h3>
        </div>

        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 py-1 text-xs font-bold text-emerald-700">
            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-extrabold">
              ✓
            </span>
            <span>Semua berjalan normal</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {alerts.map((alt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleNav(alt.link)}
                className="w-full text-left p-2.5 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 rounded-xl flex items-center justify-between gap-2 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm">⚠️</span>
                  <span className="text-xs font-bold text-amber-900 leading-tight">
                    {alt.text}
                  </span>
                </div>
                <svg
                  className="w-3.5 h-3.5 text-amber-700 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OverviewPage;
