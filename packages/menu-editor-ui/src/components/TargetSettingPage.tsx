import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface BranchItem {
  id: string;
  name: string;
  code?: string;
  address?: string;
}

interface TargetSettingPageProps {
  onBack: () => void;
  onSaved?: (newTarget: number) => void;
}

function getAuthToken(): string {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (_) {}

  if (typeof document !== 'undefined') {
    const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
  return '';
}

function formatRupiahInput(value: number): string {
  if (!value || isNaN(value)) return '';
  return new Intl.NumberFormat('id-ID').format(value);
}

function parseRupiahInput(str: string): number {
  const digits = str.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

const PRESET_AMOUNTS = [
  { label: 'Rp 1 Juta', value: 1000000 },
  { label: 'Rp 2,5 Juta', value: 2500000 },
  { label: 'Rp 5 Juta', value: 5000000 },
  { label: 'Rp 7,5 Juta', value: 7500000 },
  { label: 'Rp 10 Juta', value: 10000000 }
];

export const TargetSettingPage: React.FC<TargetSettingPageProps> = ({ onBack, onSaved }) => {
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [dailyTarget, setDailyTarget] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('xentra_daily_sales_target');
      if (saved) {
        const val = Number(saved);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch (_) {}
    return 5000000;
  });
  const [saving, setSaving] = useState<boolean>(false);
  const [isBranchOpen, setIsBranchOpen] = useState<boolean>(false);

  // Fetch branches on mount
  useEffect(() => {
    let isMounted = true;
    async function loadBranches() {
      try {
        const token = getAuthToken();
        const headers: Record<string, string> = {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/v1/admin/branches?_t=${Date.now()}`, {
          headers,
          cache: 'no-store'
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.branches) && isMounted) {
            setBranches(data.branches);
          }
        }
      } catch (err) {
        console.warn('[TargetSettingPage] Failed to fetch branches:', err);
      }
    }
    loadBranches();
    return () => {
      isMounted = false;
    };
  }, []);

  // Update target when branch selection changes
  const handleBranchChange = (branchId: string) => {
    setSelectedBranchId(branchId);
    try {
      const key = branchId === 'all' ? 'xentra_daily_sales_target' : `xentra_target_branch_${branchId}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        const val = Number(saved);
        if (!isNaN(val) && val > 0) {
          setDailyTarget(val);
          return;
        }
      }
    } catch (_) {}
    setDailyTarget(5000000);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseRupiahInput(e.target.value);
    setDailyTarget(parsed);
  };

  const handleSave = () => {
    if (saving) return;
    setSaving(true);

    try {
      const targetVal = dailyTarget > 0 ? dailyTarget : 5000000;

      // Persist global & branch target
      if (selectedBranchId === 'all') {
        localStorage.setItem('xentra_daily_sales_target', String(targetVal));
      } else {
        localStorage.setItem(`xentra_target_branch_${selectedBranchId}`, String(targetVal));
        localStorage.setItem('xentra_daily_sales_target', String(targetVal));
      }

      // Notify other components
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('xentra:target-updated', {
            detail: { branchId: selectedBranchId, target: targetVal }
          })
        );
        if (typeof (window as any).showToast === 'function') {
          (window as any).showToast('Target penjualan berhasil disimpan', 'success');
        }
      }

      if (typeof onSaved === 'function') {
        onSaved(targetVal);
      } else {
        onBack();
      }
    } catch (err) {
      console.error('[TargetSettingPage] Error saving target:', err);
      onBack();
    } finally {
      setSaving(false);
    }
  };

  const monthlyTarget = dailyTarget * 30;

  return (
    <div
      id="modern-target-page-root"
      style={{
        boxSizing: 'border-box',
        paddingBottom: '120px'
      }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow and Title */}
      <div className="flex items-start gap-3 pt-1 pb-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Kembali"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain"
          />
        </button>
        <div className="min-w-0">
          <h1 className="font-bold text-slate-900 text-lg leading-9 m-0">
            Atur Target Penjualan
          </h1>
          <p className="text-xs text-slate-500 m-0">
            Tentukan target omzet harian untuk memantau performa penjualan
          </p>
        </div>
      </div>

      {/* 2. Card: Pilih Cabang */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-2.5">
        <label className="text-sm font-bold text-slate-900">
          Cakupan Cabang
        </label>
        <div className={`x-occ-dropdown ${isBranchOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="x-occ-dropdown-trigger"
            aria-haspopup="listbox"
            aria-expanded={isBranchOpen}
            onClick={() => setIsBranchOpen((v) => !v)}
          >
            <span className="truncate">
              {selectedBranchId === 'all'
                ? 'Semua Cabang'
                : branches.find((b) => b.id === selectedBranchId)?.name || 'Pilih cabang'}
            </span>
            <svg className="x-occ-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {isBranchOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsBranchOpen(false)} />
              <div className="x-occ-dropdown-menu" role="listbox">
                {[{ id: 'all', name: 'Semua Cabang' }, ...branches].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="option"
                    aria-selected={selectedBranchId === b.id}
                    className={`x-occ-dropdown-item ${selectedBranchId === b.id ? 'active' : ''}`}
                    onClick={() => {
                      handleBranchChange(b.id);
                      setIsBranchOpen(false);
                    }}
                  >
                    <span className="truncate">{b.name}</span>
                    <svg className="x-occ-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <span className="text-xs text-slate-500">
          Pilih semua cabang untuk target gabungan, atau satu cabang tertentu.
        </span>
      </div>

      {/* 3. Card: Nominal Target Harian */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-3">
        <label className="text-sm font-bold text-slate-900">
          Target Omzet per Hari
        </label>

        {/* Rupiah Input */}
        <div style={{ border: '1px solid #cbd5e1' }} className="flex items-center h-12 bg-white rounded-xl overflow-hidden focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100 transition-all">
          <span style={{ borderRight: '1px solid #cbd5e1' }} className="h-full flex items-center px-3.5 bg-slate-50 text-sm font-bold text-slate-500 shrink-0">
            Rp
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={formatRupiahInput(dailyTarget)}
            onChange={handleInputChange}
            placeholder="0"
            style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
            className="flex-1 min-w-0 h-full px-3 bg-transparent text-base font-bold text-slate-900 leading-none"
          />
        </div>

        {/* Quick Amount Chips */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-500">
            Pilihan cepat
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_AMOUNTS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setDailyTarget(preset.value)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  dailyTarget === preset.value
                    ? 'bg-emerald-600 text-white border border-emerald-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Card: Ringkasan & Estimasi Bulanan */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-3">
        <h3 className="text-sm font-bold text-slate-900 m-0">
          Ringkasan Target Penjualan
        </h3>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3 bg-slate-50 border border-slate-200/70 rounded-xl flex flex-col">
            <span className="text-xs text-slate-500 font-medium">
              Target per Hari
            </span>
            <strong className="text-sm font-extrabold text-slate-900 mt-0.5">
              Rp {formatRupiahInput(dailyTarget) || '0'}
            </strong>
          </div>

          <div className="p-3 bg-emerald-50/70 border border-emerald-200/70 rounded-xl flex flex-col">
            <span className="text-xs text-emerald-800 font-medium">
              Estimasi 30 Hari
            </span>
            <strong className="text-sm font-extrabold text-emerald-900 mt-0.5">
              Rp {formatRupiahInput(monthlyTarget) || '0'}
            </strong>
          </div>
        </div>

        <p className="text-xs text-slate-500 leading-relaxed m-0">
          Dipakai untuk menghitung capaian target di Beranda.
        </p>
      </div>

      {/* 5. Fixed Floating Bottom Action Bar (Identical to Category & Item Editor) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            id="modern-target-bottom-bar"
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              width: '100vw',
              maxWidth: '100vw',
              backgroundColor: '#ffffff',
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              boxShadow: '0px 0px 15px rgba(0, 0, 0, 0.15)',
              zIndex: 9999,
              paddingTop: '16px',
              paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
              paddingLeft: '16px',
              paddingRight: '16px',
              boxSizing: 'border-box'
            }}
            className="w-full bg-white rounded-t-[20px] z-[9999]"
          >
            <div className="w-full max-w-lg mx-auto flex items-center gap-3">
              <button
                type="button"
                onClick={onBack}
                style={{
                  height: '48px',
                  borderRadius: '9999px',
                  border: '1px solid #E2E8F0',
                  outline: 'none',
                  backgroundColor: '#F8FAFC',
                  color: '#475569',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 24px',
                  transition: 'all 0.15s ease'
                }}
                className="hover:bg-slate-100 active:scale-98"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                style={{
                  flex: 1,
                  height: '48px',
                  borderRadius: '9999px',
                  border: 'none',
                  outline: 'none',
                  backgroundColor: '#00A637',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease'
                }}
                className="active:scale-98 hover:bg-emerald-600"
              >
                {saving ? 'Menyimpan...' : 'Simpan Target'}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default TargetSettingPage;
