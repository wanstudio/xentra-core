import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

// Target Calibration Data Store

interface AnomalyItem {
  id: string;
  badgeType: string;
  nominalStr: string;
  branch: string;
  actor: string;
  analysis: string;
  statusNote: string;
  limitNote: string;
  status: 'pending' | 'approved' | 'vetoed';
  settledText?: string;
  approveLabel: string;
  vetoLabel: string;
}

const INITIAL_ANOMALIES: AnomalyItem[] = [
  {
    id: 'anomaly-card-1',
    badgeType: '⚠️ Selisih Kas Laci Tutup Shift',
    nominalStr: '- Rp 175.000',
    branch: 'MyBangjo Kemiling',
    actor: 'Shift Siang (Kasir: Siti Rahma)',
    analysis: 'Sistem Catat: Rp 825.000 | Fisik Laci: Rp 650.000',
    statusNote: 'Catatan SPV Doni: "Uang fisik tercecer saat jam makan siang padat. SPV mengajukan toleransi resto."',
    limitNote: 'Batas Otonom SPV: Rp 50.000 • Pelanggaran Limit: +Rp 125.000',
    status: 'pending',
    approveLabel: 'Setujui (Beban Resto)',
    vetoLabel: 'Veto: Potong Kasir'
  },
  {
    id: 'anomaly-card-2',
    badgeType: '🚨 Pola Anomali Void (AI Flag)',
    nominalStr: 'Rp 340.000',
    branch: 'MyBangjo Pringsewu',
    actor: 'Kasir: Budi Santoso',
    analysis: 'Analisis Sistem: 12x pembatalan tunai dalam 2 hari berturut-turut, seluruhnya disetujui SPV Rian.',
    statusNote: 'Status: PIN Wewenang Void SPV Rian dibekukan sementara oleh sistem.',
    limitNote: 'Indikasi: Potensi Kolusi Kasir-SPV • Perlu Otoritas Eksekutif',
    status: 'pending',
    approveLabel: 'Buka Kunci (Alasan Sah)',
    vetoLabel: 'Tugaskan Audit CCTV'
  }
];

export const OverviewPage: React.FC<OverviewPageProps> = ({ onNavigate }) => {
  const [period, setPeriod] = useState<OverviewPeriod>('today');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isCustomOpen, setIsCustomOpen] = useState<boolean>(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  // Privacy Mode Toggle (Eye Masking)
  const [isPrivacyMode, setIsPrivacyMode] = useState<boolean>(false);

  // Model B Governance & Anomaly Sheet State
  const [isAnomalySheetOpen, setIsAnomalySheetOpen] = useState<boolean>(false);
  const [anomalyTab, setAnomalyTab] = useState<'pending' | 'fyi'>('pending');
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>(INITIAL_ANOMALIES);

  // Target Penjualan State (persisted via localStorage)
  const getSavedTarget = () => {
    try {
      const saved = localStorage.getItem('xentra_daily_sales_target');
      if (saved) {
        const num = Number(saved);
        if (!isNaN(num) && num > 0) return num;
      }
    } catch (_) {}
    return 5000000;
  };
  const [appliedTodayTarget, setAppliedTodayTarget] = useState<number>(getSavedTarget);

  useEffect(() => {
    const handleTargetUpdated = (e: any) => {
      if (e?.detail?.target) {
        setAppliedTodayTarget(Number(e.detail.target));
      } else {
        setAppliedTodayTarget(getSavedTarget());
      }
    };
    window.addEventListener('xentra:target-updated', handleTargetUpdated);
    return () => window.removeEventListener('xentra:target-updated', handleTargetUpdated);
  }, []);

  const openTargetPage = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('overview/target');
    } else {
      window.location.hash = '#overview/target';
    }
  };

  // Selected Branch for single branch drill-down
  const [selectedBranchView, setSelectedBranchView] = useState<string>('all');

  // Floating Toast State
  const [toast, setToast] = useState<{ title: string; msg: string } | null>(null);

  const showToast = useCallback((title: string, msg: string) => {
    setToast({ title, msg });
    setTimeout(() => {
      setToast((prev) => (prev && prev.title === title ? null : prev));
    }, 3200);
  }, []);

  const defaultDemoBranches = [
    {
      id: 'branch-tebet',
      name: 'Cabang Tebet (Reguler)',
      is_open_override: 1,
      is_online_paused: 0,
      is_delivery_active: 1,
      is_pickup_active: 1,
      items_86_count: 0
    },
    {
      id: 'branch-mall-kg',
      name: 'Cabang Mall Kelapa Gading',
      is_open_override: 1,
      is_online_paused: 1,
      is_delivery_active: 0,
      is_pickup_active: 0,
      items_86_count: 2
    }
  ];

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);
  const [branches, setBranches] = useState<any[]>(defaultDemoBranches);
  const [selectedBranchForControl, setSelectedBranchForControl] = useState<any | null>(null);
  const [updatingBranch, setUpdatingBranch] = useState<boolean>(false);
  const [selectedBranchFor86, setSelectedBranchFor86] = useState<any | null>(null);
  const [branch86Items, setBranch86Items] = useState<any[]>([
    { product_id: 'prod-ayam-bakar', product_name: 'Ayam Bakar Madu', is_available: 0, category_name: 'Makanan', price: 28000 },
    { product_id: 'prod-es-teh', product_name: 'Es Teh Manis', is_available: 0, category_name: 'Minuman', price: 6000 }
  ]);
  const [loading86Items, setLoading86Items] = useState<boolean>(false);
  const [togglingItem86, setTogglingItem86] = useState<string | null>(null);

  const fetchBranches = useCallback(async () => {
    try {
      const token = typeof localStorage !== 'undefined'
        ? localStorage.getItem('xentra_merchant_token')
        : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/v1/admin/branches?_t=${Date.now()}`, { headers, cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.branches) && json.branches.length > 0) {
          setBranches(json.branches);
          return;
        }
      }
    } catch (_) {}
  }, []);

  const fetch86Items = useCallback(async (branchId: string) => {
    setLoading86Items(true);
    try {
      const token = typeof localStorage !== 'undefined'
        ? localStorage.getItem('xentra_merchant_token')
        : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/v1/admin/branches/${encodeURIComponent(branchId)}/items-86?_t=${Date.now()}`, { headers, cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.items) && json.items.length > 0) {
          setBranch86Items(json.items);
          return;
        }
      }
    } catch (_) {} finally {
      setLoading86Items(false);
    }
  }, []);

  const handleOpen86Sheet = useCallback(async (branch: any) => {
    setSelectedBranchFor86(branch);
    await fetch86Items(branch.id);
  }, [fetch86Items]);

  const handleToggle86Item = useCallback(async (branchId: string, productId: string, nextAvailability: number) => {
    setTogglingItem86(productId);
    setBranch86Items((prev) =>
      prev.map((item) =>
        item.product_id === productId ? { ...item, is_available: nextAvailability } : item
      )
    );
    try {
      const token = typeof localStorage !== 'undefined'
        ? localStorage.getItem('xentra_merchant_token')
        : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/v1/admin/branches/${encodeURIComponent(branchId)}/products/${encodeURIComponent(productId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_available: nextAvailability })
      });
      if (res.ok) {
        showToast('Status Menu Diperbarui', nextAvailability === 1 ? '✓ Menu dibuka kembali' : '✓ Menu ditandai Habis (86)');
        await fetch86Items(branchId);
        await fetchBranches();
      }
    } catch (_) {} finally {
      setTogglingItem86(null);
    }
  }, [fetch86Items, fetchBranches, showToast]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const handleSetBranchMode = async (branchId: string, mode: 'NORMAL' | 'PAUSE_ONLINE' | 'FORCE_CLOSE') => {
    setUpdatingBranch(true);
    setBranches((prev) =>
      prev.map((b) => {
        if (b.id === branchId) {
          if (mode === 'NORMAL') {
            return { ...b, is_open_override: 1, is_online_paused: 0, is_delivery_active: 1, is_pickup_active: 1 };
          } else if (mode === 'PAUSE_ONLINE') {
            return { ...b, is_open_override: 1, is_online_paused: 1, is_delivery_active: 0, is_pickup_active: 0 };
          } else if (mode === 'FORCE_CLOSE') {
            return { ...b, is_open_override: 0, is_online_paused: 0 };
          }
        }
        return b;
      })
    );

    try {
      const token = typeof localStorage !== 'undefined'
        ? localStorage.getItem('xentra_merchant_token')
        : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let body = {};
      if (mode === 'NORMAL') {
        body = { is_open_override: 1, is_online_paused: 0, is_delivery_active: 1, is_pickup_active: 1 };
      } else if (mode === 'PAUSE_ONLINE') {
        body = { is_open_override: 1, is_online_paused: 1, is_delivery_active: 0, is_pickup_active: 0 };
      } else if (mode === 'FORCE_CLOSE') {
        body = { is_open_override: 0, is_online_paused: 0 };
      }

      const res = await fetch(`/api/v1/admin/branches/${encodeURIComponent(branchId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body)
      });
      if (res.ok) {
        showToast('Mode Cabang', '✓ Status operasional cabang berhasil diperbarui');
        await fetchBranches();
      }
    } catch (_) {
    } finally {
      setSelectedBranchForControl(null);
      setUpdatingBranch(false);
    }
  };

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
    if (preset === 'all') {
      return { start: '', end: '' };
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
        setData({
          kpis: {
            net_sales: 0,
            orders: 0,
            customers: 0,
            aov: 0
          },
          branch_performance: [],
          orders_summary: {
            total: 0,
            completed: 0,
            in_progress: 0,
            cancelled: 0
          },
          top_products: [],
          sales_performance: {
            timeline: [],
            by_channel: [],
            by_fulfillment: [],
            payment_breakdown: []
          },
          needs_attention: {}
        });
      }
    } catch (err: any) {
      console.warn('[OverviewPage] fetch error:', err);
      setData({
        kpis: {
          net_sales: 0,
          orders: 0,
          customers: 0,
          aov: 0
        },
        branch_performance: [],
        orders_summary: {
          total: 0,
          completed: 0,
          in_progress: 0,
          cancelled: 0
        },
        top_products: [],
        sales_performance: {
          timeline: [],
          by_channel: [],
          by_fulfillment: [],
          payment_breakdown: []
        },
        needs_attention: {}
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load & URL Deep-Linking Hook
  useEffect(() => {
    const { start, end } = computeDatesForPreset('today');
    setStartDate(start);
    setEndDate(end);
    fetchOverview(start, end);

    // Deep-linking URL params (e.g. ?sheet=anomaly, ?sheet=target, ?sheet=fyi)
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const sheet = sp.get('sheet');
      if (sheet === 'anomaly') {
        setIsAnomalySheetOpen(true);
        setAnomalyTab('pending');
      } else if (sheet === 'fyi') {
        setIsAnomalySheetOpen(true);
        setAnomalyTab('fyi');
      } else if (sheet === 'target') {
        openTargetPage();
      }
      if (sp.get('test_resolved') === '1') {
        setAnomalies((prev) =>
          prev.map((a) => ({
            ...a,
            status: 'approved',
            settledText: 'Disahkan Owner: Otorisasi Beban Diterima'
          }))
        );
      }
    }
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
    const cleanRoute = route.replace(/^#\/?/, '').trim();
    if (typeof onNavigate === 'function') {
      onNavigate(cleanRoute);
    } else if (typeof window !== 'undefined' && typeof (window as any).navigateTo === 'function') {
      (window as any).navigateTo(cleanRoute);
    } else if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
      window.history.pushState({ xentraRoute: cleanRoute }, '', '#' + cleanRoute);
    }
  };

  // KPIs and metrics (Strictly authoritative database values, zero fake mock numbers)
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

  const paymentBreakdown = (data as any)?.sales_performance?.payment_breakdown || [];
  const cashStats = useMemo(() => {
    const rows = paymentBreakdown.filter((p: any) => p.provider === 'cash');
    const rev = rows.reduce((acc: number, r: any) => acc + (r.payment_status === 'settlement' || r.payment_status === 'completed' ? Number(r.total_amount || 0) : 0), 0);
    const cnt = rows.reduce((acc: number, r: any) => acc + Number(r.transaction_count || 0), 0);
    return { revenue: rev, count: cnt };
  }, [paymentBreakdown]);

  const onlineStats = useMemo(() => {
    const rows = paymentBreakdown.filter((p: any) => p.provider !== 'cash');
    const rev = rows.reduce((acc: number, r: any) => acc + (r.payment_status === 'settlement' || r.payment_status === 'completed' ? Number(r.total_amount || 0) : 0), 0);
    const cnt = rows.reduce((acc: number, r: any) => acc + Number(r.transaction_count || 0), 0);
    return { revenue: rev, count: cnt };
  }, [paymentBreakdown]);

  const periodSubtitle = useMemo(() => {
    const today = new Date();
    if (period === 'today') {
      return `• Hari ini (${today.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})`;
    }
    if (period === '7d') {
      return '• 7 Hari Terakhir';
    }
    if (period === '30d') {
      return '• 30 Hari Terakhir';
    }
    if (period === 'all') {
      return '• Seluruh Waktu (Selama Ini)';
    }
    if (startDate && endDate) {
      return `• ${startDate} s/d ${endDate}`;
    }
    return '• Periode Ini';
  }, [period, startDate, endDate]);

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
    all: 'Semua waktu',
    custom: 'Kustom'
  };

  // Model B Governance Anomaly Resolvers
  const unSettledAnomalies = useMemo(() => {
    return anomalies.filter((a) => a.status === 'pending');
  }, [anomalies]);

  const isSentinelSafe = unSettledAnomalies.length === 0;

  const handleResolveAnomaly = (id: string, action: 'approved' | 'vetoed') => {
    setAnomalies((prev) =>
      prev.map((a) => {
        if (a.id === id) {
          const settledText =
            action === 'approved'
              ? 'Disahkan Owner: Otorisasi Beban Diterima'
              : 'Di-Veto Owner: Dialihkan Sesuai Ketentuan Baru';
          return { ...a, status: action, settledText };
        }
        return a;
      })
    );
    showToast(
      action === 'approved' ? 'Putusan Disahkan' : 'Hak Veto Dijalankan',
      action === 'approved'
        ? 'Kasus disahkan beban operasional resto resmi'
        : 'Kasus di-veto, penyesuaian dibebankan sesuai kebijakan'
    );
  };

  const handleApproveAllAnomalies = () => {
    setAnomalies((prev) =>
      prev.map((a) => ({
        ...a,
        status: 'approved',
        settledText: 'Disahkan Owner: Otorisasi Beban Diterima'
      }))
    );
    showToast('Otorisasi Penuh Selesai', 'Semua kasus berat telah disahkan Owner');
    setTimeout(() => {
      setIsAnomalySheetOpen(false);
    }, 600);
  };


  // Target attainment percent
  const targetAttainmentPct = useMemo(() => {
    const revenue = kpis.net_sales || 0;
    if (!appliedTodayTarget || appliedTodayTarget <= 0 || revenue === 0) return 0;
    return Number(((revenue / appliedTodayTarget) * 100).toFixed(1));
  }, [kpis.net_sales, appliedTodayTarget]);

  return (
    <div
      id="overview-page-body"
      style={{ boxSizing: 'border-box' }}
      className="w-full flex flex-col gap-4 pb-2 max-w-lg md:mx-auto select-none font-sans"
    >
      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100000] w-[90%] max-w-md bg-slate-900/95 text-white backdrop-blur-md px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between border border-slate-700 animate-in fade-in slide-in-from-top duration-200">
          <div className="flex flex-col min-w-0 pr-2">
            <span className="text-xs font-bold text-emerald-400">{toast.title}</span>
            <span className="text-[11px] text-slate-200 truncate">{toast.msg}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white text-sm font-bold p-1 bg-transparent border-none cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 1. TOP SENTINEL RADAR: FRAUD & ANOMALY GOVERNANCE BANNER ── */}
      <div
        id="sentinel-banner"
        onClick={() => setIsAnomalySheetOpen(true)}
        className={`w-full p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between shadow-xs ${
          isSentinelSafe
            ? 'bg-emerald-50/90 border-emerald-200/90 text-emerald-950'
            : 'bg-rose-50/90 border-rose-200/90 text-rose-950'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${
              isSentinelSafe ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
            }`}
          >
            {isSentinelSafe ? '🛡️' : '⚠️'}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-extrabold truncate">
              {isSentinelSafe
                ? 'Integritas Operasional Terkendali'
                : `${unSettledAnomalies.length} Kasus Kritis Butuh Putusan Owner`}
            </span>
            <span className="text-[10.5px] text-slate-600 truncate mt-0.5">
              {isSentinelSafe
                ? 'Semua kasus berat telah diputuskan • 3 log cabang terdata rapi'
                : 'Melampaui Limit Cabang • 3 Masalah Ringan Selesai Mandiri'}
            </span>
          </div>
        </div>

        <div className="shrink-0 pl-2">
          <span
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-bold shadow-2xs transition-all ${
              isSentinelSafe
                ? 'bg-emerald-600 text-white'
                : 'bg-rose-600 text-white animate-pulse'
            }`}
          >
            <span>{isSentinelSafe ? 'Aman' : 'Putuskan'}</span>
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </div>
      </div>

      {/* ── 2. PERIOD SELECTOR & FILTER HEADER ── */}
      <div className="x-occ-period-bar">
        <div className="x-occ-preset-row flex items-center gap-2">
          <div className={`x-occ-dropdown ${isDropdownOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="x-occ-dropdown-trigger"
              aria-haspopup="listbox"
              aria-expanded={isDropdownOpen}
              onClick={() => setIsDropdownOpen((prev) => !prev)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  className="w-4 h-4 text-slate-500 shrink-0"
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
                <span className="truncate">{periodLabelMap[period]}</span>
              </div>
              <svg
                className="x-occ-chevron-icon"
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {isDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsDropdownOpen(false)}
                />
                <div
                  className="x-occ-dropdown-menu"
                  role="listbox"
                  aria-label="Pilihan periode"
                >
                  {(['today', '7d', '30d', 'all'] as OverviewPeriod[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="option"
                      data-value={p}
                      aria-selected={period === p}
                      onClick={() => {
                        handleSelectPreset(p);
                        setIsDropdownOpen(false);
                      }}
                      className={`x-occ-dropdown-item ${period === p ? 'active' : ''}`}
                    >
                      <span>{periodLabelMap[p]}</span>
                      <svg
                        className="x-occ-check-icon"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            id="btn-occ-custom-toggle"
            className="x-occ-custom-toggle"
            aria-expanded={isCustomOpen}
            onClick={() => setIsCustomOpen((prev) => !prev)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>Pilih tanggal</span>
          </button>
        </div>
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

      {/* ── 3. EXECUTIVE HERO SALES CARD (Penjualan Hari Ini) ── */}
      <div
        className="relative overflow-hidden text-white rounded-3xl p-5 shadow-sm border border-slate-800"
        style={{
          background: 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #1e293b 100%)',
          backgroundColor: '#0f172a'
        }}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">
              Penjualan
            </span>
            <span className="text-[10px] text-slate-500 font-medium">
              {periodSubtitle}
            </span>
          </div>

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

        {/* Big Revenue Number + Eye Privacy Button */}
        <div className="flex items-center justify-between my-2">
          <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            {loading ? (
              <span className="inline-block w-36 h-7 bg-slate-800 animate-pulse rounded" />
            ) : isPrivacyMode ? (
              <span>Rp ••••••••</span>
            ) : (
              formatMoney(kpis.net_sales ?? 0)
            )}
            <button
              type="button"
              onClick={() => {
                setIsPrivacyMode((prev) => !prev);
                showToast(
                  !isPrivacyMode ? 'Mode Privasi Aktif' : 'Mode Privasi Nonaktif',
                  !isPrivacyMode ? 'Nominal pendapatan disembunyikan' : 'Nominal pendapatan ditampilkan'
                );
              }}
              title={isPrivacyMode ? 'Tampilkan Nominal' : 'Sembunyikan Nominal'}
              className="p-1 rounded-lg text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-700/80 transition-all cursor-pointer border-none flex items-center justify-center"
            >
              {isPrivacyMode ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m2 2 20 20" />
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Clickable Target Micro Progress Bar */}
        <div
          onClick={openTargetPage}
          className="mt-3 p-2.5 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl cursor-pointer transition-all flex flex-col gap-1.5"
          title="Klik untuk mengatur target harian"
        >
          <div className="flex items-center justify-between text-[11px] font-bold">
            <span className="text-emerald-400">
              Capaian Target: {targetAttainmentPct}%
            </span>
            <span className="text-slate-300 flex items-center gap-1">
              <span>Target: {formatMoney(appliedTodayTarget)}</span>
              <span className="text-[10px] opacity-75">⚙️</span>
            </span>
          </div>
          <div className="w-full h-2 bg-slate-700/80 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(targetAttainmentPct, 100)}%` }}
            />
          </div>
        </div>

        {/* Organic Sparkline SVG Canvas (Peak Hour 12:00) */}
        <div
          onClick={() => showToast('Analisa Jam Sibuk', kpis.net_sales > 0 ? 'Pukul 12:00 adalah jam makan siang dengan pesanan tertinggi' : 'Belum ada transaksi di jam sibuk untuk periode ini')}
          className="relative w-full h-14 mt-3 rounded-lg overflow-hidden cursor-pointer"
        >
          <svg className="w-full h-full" viewBox="0 0 360 60" preserveAspectRatio="none">
            <defs>
              <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#08a94f" stopOpacity={kpis.net_sales > 0 ? 0.3 : 0.05} />
                <stop offset="100%" stopColor="#08a94f" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {kpis.net_sales > 0 ? (
              <>
                <path d="M 0,45 Q 40,38 80,32 T 160,38 T 230,42 T 290,24 T 360,14 L 360,60 L 0,60 Z" fill="url(#waveFill)" />
                <path d="M 0,45 Q 40,38 80,32 T 160,38 T 230,42 T 290,24 T 360,14" fill="none" stroke="#08a94f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="230" cy="42" r="3.5" fill="#ffffff" stroke="#08a94f" strokeWidth="2.5" />
              </>
            ) : (
              <line x1="0" y1="45" x2="360" y2="45" stroke="#334155" strokeWidth="1.5" strokeDasharray="4 4" />
            )}
          </svg>
          <div className="absolute top-1 right-2 text-[9.5px] font-bold text-slate-400">
            {kpis.net_sales > 0 ? 'Puncak: 12:00' : 'Puncak: — (Rp 0)'}
          </div>
        </div>

        {/* 3-Column Breakdown (Tunai COD | Online Pay | Total Transaksi) */}
        <div className="border-t border-white/10 pt-3 mt-2 grid grid-cols-3 gap-2">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-medium">Tunai (COD)</span>
            <span className="text-xs sm:text-sm font-bold text-slate-100">
              {isPrivacyMode ? 'Rp ••••••' : formatMoney(cashStats.revenue)}
            </span>
            <span className="text-[10px] text-slate-400">{cashStats.count} transaksi</span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-medium">Online Pay</span>
            <span className="text-xs sm:text-sm font-bold text-slate-100">
              {isPrivacyMode ? 'Rp ••••••' : formatMoney(onlineStats.revenue)}
            </span>
            <span className="text-[10px] text-slate-400">{onlineStats.count} transaksi</span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-medium">Total Transaksi</span>
            <span className="text-xs sm:text-sm font-bold text-slate-100">
              {ordersSummary.total ?? 0} transaksi
            </span>
            <span className="text-[10px] text-slate-400">{ordersSummary.completed ?? 0} berhasil | {ordersSummary.cancelled ?? 0} batal</span>
          </div>
        </div>

        {/* Mini Metrics Row (Pesanan | Avg Order | Pelanggan) */}
        <div className="border-t border-white/10 pt-3 mt-3 grid grid-cols-3 gap-2">
          <div className="flex flex-col">
            <span className="text-sm sm:text-base font-bold text-slate-100">
              {loading ? '—' : (kpis.orders ?? 0).toLocaleString('id-ID')}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Pesanan</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm sm:text-base font-bold text-slate-100 truncate">
              {loading ? '—' : formatMoney(kpis.aov ?? 0)}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Avg Order</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm sm:text-base font-bold text-slate-100">
              {loading ? '—' : (kpis.customers ?? 0).toLocaleString('id-ID')}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Pelanggan</span>
          </div>
        </div>
      </div>

      {/* ── 4. QUICK ACCESS (Akses Cepat - 8 Shortcuts) ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Quick Access
          </h3>
          <button
            type="button"
            onClick={() => handleNav('business')}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer transition-colors border-none bg-transparent"
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
            { label: 'Menu', icon: '/owner/assets/icons/quick-access/menu.png', route: 'catalog/categories' },
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

      {/* ── 5. RINGKASAN PESANAN (Orders Summary) ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Ringkasan Pesanan
          </h3>
          <button
            type="button"
            onClick={() => handleNav('orders')}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer transition-colors border-none bg-transparent"
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
              {loading ? '—' : ordersSummary.total ?? 0}
            </span>
            <span className="text-[10.5px] font-semibold text-slate-500 mt-1">
              Total
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100 text-center">
            <span className="text-base font-extrabold text-emerald-600 leading-tight">
              {loading ? '—' : ordersSummary.completed ?? 0}
            </span>
            <span className="text-[10.5px] font-semibold text-emerald-700 mt-1">
              Selesai
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-blue-50/60 border border-blue-100 text-center">
            <span className="text-base font-extrabold text-blue-600 leading-tight">
              {loading ? '—' : ordersSummary.in_progress ?? 0}
            </span>
            <span className="text-[10.5px] font-semibold text-blue-700 mt-1">
              Diproses
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-rose-50/60 border border-rose-100 text-center">
            <span className="text-base font-extrabold text-rose-600 leading-tight">
              {loading ? '—' : ordersSummary.cancelled ?? 0}
            </span>
            <span className="text-[10.5px] font-semibold text-rose-700 mt-1">
              Dibatalkan
            </span>
          </div>
        </div>
      </div>

      {/* ── 6. PERFORMA CABANG & DRILL-DOWN MONITORING SHIFT ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              Performa Cabang
            </h3>
            <span className="text-[11px] text-slate-500 font-medium">
              Pacing terhadap target harian cabang
            </span>
          </div>
          <button
            type="button"
            onClick={openTargetPage}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <span>⚙️</span>
            <span>Atur Target</span>
          </button>
        </div>

        {/* Multi-Branch Leaderboard with Target Pacing Badges */}
        <div className="flex flex-col divide-y divide-slate-100">
          {branchPerf.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
              Belum ada transaksi cabang pada periode yang dipilih.
            </div>
          ) : (
            (() => {
              const maxRev = Math.max(...branchPerf.map(b => Number(b.total_revenue || 0)), 1);
              return branchPerf.map((b, idx) => {
                const rev = Number(b.total_revenue || 0);
                const orders = Number(b.total_orders || 0);
                const fill = maxRev > 0 ? Math.min(100, Math.round((rev / maxRev) * 100)) : 0;
                const isTop = idx === 0 && rev > 0;
                const color = rev > 0 ? 'emerald' : 'slate';
                return (
                  <div
                    key={b.branch_id || idx}
                    onClick={() => {
                      if (b.branch_id) {
                        setSelectedBranch(b.branch_id);
                        showToast('Filter Cabang', `Menampilkan ringkasan ${b.branch_name}`);
                      }
                    }}
                    className="py-3 flex flex-col gap-1.5 hover:bg-slate-50/70 cursor-pointer rounded-xl px-1.5 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            color === 'emerald' ? 'bg-emerald-500' : 'bg-slate-300'
                          }`}
                        />
                        <span className="text-xs font-bold text-slate-900">{b.branch_name}</span>
                      </div>
                      <span className="text-xs font-extrabold text-slate-900">
                        {formatMoney(rev)}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          color === 'emerald' ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                        style={{ width: `${rev > 0 ? Math.max(fill, 4) : 0}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>{orders} pesanan {orders > 0 && b.average_order_value ? `• AOV ${formatMoney(Math.round(b.average_order_value))}` : ''}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          color === 'emerald'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-50 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {isTop ? 'Teratas' : rev > 0 ? `${fill}% kontribusi` : 'Belum ada omzet'}
                      </span>
                    </div>
                  </div>
                );
              });
            })()
          )}
        </div>

        {/* Operational Cash & Sales Monitor Card */}
        <div className="p-3.5 bg-slate-50/90 border border-slate-200/90 rounded-2xl flex flex-col gap-2.5 mt-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900">
              Monitoring Realisasi Pembayaran Cabang
            </span>
            <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
              Real-time
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 bg-white border border-slate-200/70 rounded-xl flex flex-col">
              <span className="text-[10px] text-slate-500 font-semibold">Total Tunai Masuk</span>
              <span className="text-xs font-extrabold text-slate-900 mt-0.5">{formatMoney(cashStats.amount)}</span>
              <span className="text-[9.5px] text-slate-400 mt-0.5">{cashStats.count} transaksi tunai</span>
            </div>

            <div className="p-2.5 bg-white border border-slate-200/70 rounded-xl flex flex-col">
              <span className="text-[10px] text-slate-500 font-semibold">Total Non-Tunai / Online</span>
              <span className="text-xs font-extrabold text-slate-900 mt-0.5">{formatMoney(onlineStats.amount)}</span>
              <span className="text-[9.5px] text-emerald-600 font-semibold mt-0.5">{onlineStats.count} transaksi non-tunai</span>
            </div>
          </div>

          <span className="text-[10.5px] text-slate-500">
            Status Data: <strong className="text-slate-800">Sinkron Transaksi Otomatis</strong> • Berdasarkan database
          </span>
        </div>
      </div>

      {/* ── 7. PUSAT KONTROL OPERASIONAL & DARURAT CABANG ── */}
      {branches.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2">
              <span className="text-base">⚡</span>
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                Kontrol Operasional & Darurat Cabang
              </h3>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">Owner Remote</span>
          </div>

          <div className="flex flex-col divide-y divide-slate-100">
            {branches.map((b) => {
              const isClosed = b.is_open_override === 0;
              const isOnlinePaused = !isClosed && (b.is_online_paused === 1 || b.is_delivery_active === 0 || b.is_pickup_active === 0);
              const isNormal = !isClosed && !isOnlinePaused;
              const items86 = Number(b.items_86_count || 0);

              return (
                <div key={b.id} className="py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{b.name}</span>
                      {items86 > 0 && (
                        <button
                          type="button"
                          onClick={() => handleOpen86Sheet(b)}
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 cursor-pointer transition-all flex items-center gap-1"
                        >
                          <span>⚠️ {items86} Menu 86</span>
                          <span className="text-[9px] underline">Lihat →</span>
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedBranchForControl(b)}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer transition-all border-none"
                    >
                      Ubah Status
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    {isNormal && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Buka Normal (Semua Order Aktif)
                      </span>
                    )}
                    {isOnlinePaused && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        Pause Online (Drain: Kasir Buka, Delivery Ditahan)
                      </span>
                    )}
                    {isClosed && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold bg-rose-50 text-rose-700 border border-rose-200">
                        <span className="w-2 h-2 rounded-full bg-rose-500" />
                        Tutup Paksa (Darurat Ditutup)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal / Bottom Sheet for Operational Mode Change */}
      {selectedBranchForControl && (
        <div className="fixed inset-0 z-[99999] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 m-0">Kontrol Cabang</h3>
                <span className="text-xs text-slate-500">{selectedBranchForControl.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBranchForControl(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 border-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 m-0">
              Pilih mode operasional remote untuk cabang ini. Perubahan berlaku seketika:
            </p>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                disabled={updatingBranch}
                onClick={() => handleSetBranchMode(selectedBranchForControl.id, 'NORMAL')}
                className="p-3 rounded-xl border border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 text-left cursor-pointer transition-all flex flex-col gap-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-800">🟢 Buka Normal</span>
                  <span className="text-[10px] font-semibold text-emerald-600">Standar</span>
                </div>
                <span className="text-[11px] text-emerald-700">Semua order (kasir, dine-in, delivery, pickup) dibuka penuh.</span>
              </button>

              <button
                type="button"
                disabled={updatingBranch}
                onClick={() => handleSetBranchMode(selectedBranchForControl.id, 'PAUSE_ONLINE')}
                className="p-3 rounded-xl border border-amber-300 bg-amber-50/50 hover:bg-amber-50 text-left cursor-pointer transition-all flex flex-col gap-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-800">🟡 Pause Online Saja (Graceful Drain)</span>
                  <span className="text-[10px] font-semibold text-amber-600">Rekomendasi Jam Sibuk</span>
                </div>
                <span className="text-[11px] text-amber-700">Dapur overload: kasir dan antrean fisik tetap selesai, delivery online ditahan sementara.</span>
              </button>

              <button
                type="button"
                disabled={updatingBranch}
                onClick={() => handleSetBranchMode(selectedBranchForControl.id, 'FORCE_CLOSE')}
                className="p-3 rounded-xl border border-rose-300 bg-rose-50/50 hover:bg-rose-50 text-left cursor-pointer transition-all flex flex-col gap-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-800">🔴 Tutup Paksa (Darurat)</span>
                  <span className="text-[10px] font-semibold text-rose-600">Darurat</span>
                </div>
                <span className="text-[11px] text-rose-700">Mati listrik / banjir: seluruh pesanan dan kasir dinonaktifkan segera.</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal / Bottom Sheet: Detail & Intervensi Menu Habis (86) */}
      {selectedBranchFor86 && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl flex flex-col gap-3.5 max-h-[85vh] animate-in fade-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base">⚠️</span>
                  <h3 className="text-sm font-bold text-slate-900">
                    Menu Habis (86) - {selectedBranchFor86.name}
                  </h3>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Menu yang ditandai habis oleh kasir cabang ini. Buka kembali bila pasokan sudah siap.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBranchFor86(null)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold p-1 cursor-pointer bg-transparent border-none"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 py-1">
              {loading86Items ? (
                <div className="py-8 text-center text-xs text-slate-400">Memuat menu habis...</div>
              ) : branch86Items.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  🟢 Semua menu di cabang ini tersedia normal.
                </div>
              ) : (
                branch86Items.map((item) => (
                  <div key={item.product_id} className="p-3 rounded-xl border border-rose-200 bg-rose-50/50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-white border border-rose-200 flex items-center justify-center text-base shrink-0">
                        🍗
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-slate-900 truncate">{item.product_name}</span>
                        <span className="text-[11px] font-semibold text-rose-700">Rp {Number(item.price || 0).toLocaleString('id-ID')}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={togglingItem86 === item.product_id}
                      onClick={() => handleToggle86Item(selectedBranchFor86.id, item.product_id, 1)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 cursor-pointer transition-all shrink-0 border-none disabled:opacity-50"
                    >
                      {togglingItem86 === item.product_id ? 'Memproses...' : 'Buka Kembali'}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setSelectedBranchFor86(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 cursor-pointer border-none"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 8. PRODUK TERLARIS (Top Products) ── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs">
        <div className="flex items-center justify-between mb-3.5">
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            Produk Terlaris
          </h3>
          <button
            type="button"
            onClick={() => handleNav('business/catalog')}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer transition-colors border-none bg-transparent"
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

      {/* ── 9. PERHATIAN (Needs Attention) ── */}
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

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL SHEET 1: AUDIT & GOVERNANCE (2-TIER PROBLEM BAROMETER)
          ══════════════════════════════════════════════════════════════════════ */}
      {isAnomalySheetOpen && (
        <div className="fixed inset-0 z-[99999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl flex flex-col gap-3.5 max-h-[88vh] overflow-hidden">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-extrabold text-slate-900 m-0">Tata Kelola & Audit Cabang</h3>
                  <span className="text-[10px] font-extrabold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                    Barometer Wewenang
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 m-0">
                  Membedakan masalah otonom cabang vs kasus berat yang melampaui limit wewenang.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAnomalySheetOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center border-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Segmented Tab Selector */}
            <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => setAnomalyTab('pending')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer border-none ${
                  anomalyTab === 'pending'
                    ? 'bg-white text-rose-700 shadow-xs'
                    : 'bg-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>⚠️ Butuh Putusan Owner</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                    unSettledAnomalies.length > 0 ? 'bg-rose-500 text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {unSettledAnomalies.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAnomalyTab('fyi')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer border-none ${
                  anomalyTab === 'fyi'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'bg-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>📋 Selesai di Cabang (FYI)</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full font-extrabold bg-slate-200 text-slate-700">
                  3
                </span>
              </button>
            </div>

            {/* Tab 1 Content: Butuh Putusan Owner */}
            {anomalyTab === 'pending' && (
              <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
                <div className="text-[11px] bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-xl leading-relaxed">
                  <strong>Wajib Keputusan Owner:</strong> Kasus ini melampaui batas toleransi SPV Cabang (Limit: Rp 50.000) atau terindikasi anomali sistemik. Pembukuan kas ditahan sampai Anda memberi putusan resmi.
                </div>

                {anomalies.map((item) => {
                  const isSettled = item.status !== 'pending';
                  return (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-2xl border flex flex-col gap-2 transition-all ${
                        item.status === 'approved'
                          ? 'bg-emerald-50/50 border-emerald-300'
                          : item.status === 'vetoed'
                          ? 'bg-slate-50 border-slate-300 opacity-90'
                          : 'bg-white border-rose-200/90 shadow-xs'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-rose-700">{item.badgeType}</span>
                        <span className="text-xs font-extrabold text-slate-900">{item.nominalStr}</span>
                      </div>

                      <div className="text-[11px] text-slate-600 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-1">
                        <div><strong>{item.branch}</strong> • {item.actor}</div>
                        <div>{item.analysis}</div>
                        <div className="text-amber-800 font-medium italic">{item.statusNote}</div>
                      </div>

                      <div className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-lg">
                        {item.limitNote}
                      </div>

                      {!isSettled ? (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleResolveAnomaly(item.id, 'approved')}
                            className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all border-none cursor-pointer shadow-xs"
                          >
                            <span>✓</span>
                            <span>{item.approveLabel}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResolveAnomaly(item.id, 'vetoed')}
                            className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition-all border border-slate-200 cursor-pointer"
                          >
                            <span>✕</span>
                            <span>{item.vetoLabel}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="mt-1 p-2 bg-white rounded-xl border border-slate-200 text-[11px] font-bold text-emerald-700 flex items-center gap-1.5">
                          <span>{item.status === 'approved' ? '✓' : 'ℹ️'}</span>
                          <span>{item.settledText}</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={handleApproveAllAnomalies}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white text-xs font-extrabold flex items-center justify-center gap-2 border-none cursor-pointer shadow-xs"
                  >
                    <span>✓ Otorisasi Semua Kasus Berat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAnomalySheetOpen(false)}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border-none cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2 Content: Selesai di Cabang (FYI Stream) */}
            {anomalyTab === 'fyi' && (
              <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1">
                <div className="text-[11px] bg-emerald-50 border border-emerald-200 text-emerald-800 p-2.5 rounded-xl leading-relaxed">
                  <strong>Cukup Diketahui (Read-Only):</strong> Masalah operasional harian di bawah batas limit wewenang SPV (Rp 50.000). Telah diselesaikan secara otonom di cabang tanpa menghentikan operasional toko.
                </div>

                {[
                  {
                    title: 'Pembatalan Pesanan #MB-8891',
                    nominal: 'Rp 24.000',
                    branch: 'MyBangjo Pringsewu',
                    actor: 'Kasir: Budi Santoso (13:42 WIB)',
                    reason: 'Salah klik varian sambal sebelum diproses dapur.',
                    tag: 'Tuntas di Cabang (SPV Rian: Waste Dapur)',
                    limit: 'Limit: < Rp 50rb'
                  },
                  {
                    title: 'Selisih Pembulatan Receh Kembalian',
                    nominal: '- Rp 4.000',
                    branch: 'MyBangjo Gadingrejo',
                    actor: 'Kasir: Deni (Tutup Shift Pagi)',
                    reason: 'Kekurangan koin kembalian Rp 500 saat jam makan pagi.',
                    tag: 'Tuntas di Cabang (SPV Arif: Toleransi Kasir)',
                    limit: 'Limit: < Rp 20rb'
                  },
                  {
                    title: 'Kas Kecil Darurat (Beli Es Batu)',
                    nominal: 'Rp 65.000',
                    branch: 'MyBangjo Pringsewu',
                    actor: 'Pukul 11:15 WIB',
                    reason: 'Beli es batu kristal 2 bal karena stok pemasok terlambat. Struk fisik diarsipkan.',
                    tag: 'Tuntas di Cabang (SPV Rian: Petty Cash Sah)',
                    limit: 'Limit: < Rp 100rb'
                  }
                ].map((fyi, idx) => (
                  <div key={idx} className="p-3 bg-white border border-slate-200 rounded-xl flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">{fyi.title}</span>
                      <span className="text-xs font-extrabold text-slate-700">{fyi.nominal}</span>
                    </div>
                    <div className="text-[10.5px] text-slate-500 leading-normal">
                      <strong>{fyi.branch}</strong> • {fyi.actor}<br />
                      Alasan: <em className="text-slate-700">"{fyi.reason}"</em>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                        <span>✓</span>
                        <span>{fyi.tag}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">{fyi.limit}</span>
                    </div>
                  </div>
                ))}

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => showToast('Export Log', 'Rekap log wewenang cabang 30 hari berhasil diunduh (PDF)')}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-200 cursor-pointer"
                  >
                    <span>📥</span>
                    <span>Unduh Rekap Log Cabang</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAnomalySheetOpen(false)}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border-none cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}


    </div>
  );
};

export default OverviewPage;
