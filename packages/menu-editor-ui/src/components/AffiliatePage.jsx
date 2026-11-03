import React, { useState, useEffect, useMemo, useRef } from 'react';

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function formatRupiah(num) {
  return 'Rp ' + (Number(num) || 0).toLocaleString('id-ID');
}

export default function AffiliatePage({ onBack, onNavigate }) {
  const [activeTab, setActiveTab] = useState('config'); // 'config' | 'payouts' | 'members'
  const [loading, setLoading] = useState(true);

  // 1. Program Config State
  const [program, setProgram] = useState({
    is_active: 1,
    commission_type: 'FIXED_PER_ITEM', // 'FIXED_PER_ITEM' | 'PERCENTAGE'
    commission_rate: 1000,
    cookie_days: 14,
    min_payout_amount: 50000,
    featured_product_id: '',
    featured_product: null
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Products & Categories for Hero Dish Picker
  const [availableProducts, setAvailableProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');
  const [tempSelectedProductId, setTempSelectedProductId] = useState('');

  // 2. Payouts State
  const [payouts, setPayouts] = useState([]);
  const [payoutFilter, setPayoutFilter] = useState('ALL'); // 'ALL' | 'REQUESTED' | 'PAID' | 'REJECTED'
  const [selectedPayout, setSelectedPayout] = useState(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [transferRefInput, setTransferRefInput] = useState('');
  const [transferNoteInput, setTransferNoteInput] = useState('');
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [isProcessingPayout, setIsProcessingPayout] = useState(false);

  // 3. Members State
  const [members, setMembers] = useState([]);
  const [memberFilter, setMemberFilter] = useState('ALL'); // 'ALL' | 'ACTIVE' | 'PENDING'

  // Fetch all initial data
  const loadData = async () => {
    setLoading(true);
    try {
      const token = getAuthToken();
      const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [progRes, payRes, memRes, menuRes, catRes] = await Promise.all([
        fetch(`/api/v1/admin/affiliate/program?_t=${Date.now()}`, { headers }).catch(() => null),
        fetch(`/api/v1/admin/affiliate/payouts?_t=${Date.now()}`, { headers }).catch(() => null),
        fetch(`/api/v1/admin/affiliate/members?_t=${Date.now()}`, { headers }).catch(() => null),
        fetch(`/api/v1/admin/menus?_t=${Date.now()}`, { headers }).catch(() => null),
        fetch(`/api/v1/admin/categories?_t=${Date.now()}`, { headers }).catch(() => null)
      ]);

      let loadedProducts = [];
      if (menuRes && menuRes.ok) {
        const menuData = await menuRes.json();
        if (menuData.success && Array.isArray(menuData.menus)) {
          loadedProducts = menuData.menus
            .filter((m) => m && m.status !== 'ARCHIVED')
            .map((m) => ({
              id: String(m.id),
              name: m.package_name || m.title_name || m.name || m.id,
              price: Number(m.selling_price ?? m.price ?? 0),
              image_url: m.image_url || m.image || null,
              image: m.image || m.image_url || null,
              description: m.description || '',
              category_id: String(m.category_id || ''),
              category_name: m.category_name || '',
              sku: m.sku || m.id
            }));
          setAvailableProducts(loadedProducts);
        }
      }

      if (catRes && catRes.ok) {
        const catData = await catRes.json();
        if (catData.success && Array.isArray(catData.categories)) {
          setCategories(catData.categories);
        }
      }

      if (progRes && progRes.ok) {
        const pData = await progRes.json();
        if (pData.success && pData.program) {
          const featuredId = pData.program.featured_product_id ? String(pData.program.featured_product_id) : '';
          let matchedProduct = pData.program.featured_product || null;

          if (!matchedProduct && featuredId && loadedProducts.length > 0) {
            matchedProduct = loadedProducts.find((p) => String(p.id) === featuredId) || null;
          }

          setProgram({
            is_active: pData.program.is_active !== undefined ? (pData.program.is_active ? 1 : 0) : 1,
            commission_type: pData.program.commission_type || 'FIXED_PER_ITEM',
            commission_rate: pData.program.commission_rate || 1000,
            cookie_days: pData.program.cookie_days || 14,
            min_payout_amount: pData.program.min_payout_amount || 50000,
            featured_product_id: featuredId,
            featured_product: matchedProduct
          });
          setTempSelectedProductId(featuredId);
        }
      }

      if (payRes && payRes.ok) {
        const payData = await payRes.json();
        if (payData.success && Array.isArray(payData.payouts)) {
          setPayouts(payData.payouts);
        }
      }

      if (memRes && memRes.ok) {
        const memData = await memRes.json();
        if (memData.success && Array.isArray(memData.members)) {
          setMembers(memData.members);
        }
      }
    } catch (err) {
      console.error('[AffiliatePage] Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Category map for rapid lookup
  const categoryMap = useMemo(() => {
    const map = {};
    categories.forEach((c) => {
      map[String(c.id)] = c.name;
    });
    return map;
  }, [categories]);

  // Save Program Configuration
  const handleSaveProgram = async () => {
    setIsSavingConfig(true);
    try {
      const token = getAuthToken();
      const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const payload = {
        is_active: program.is_active,
        commission_type: program.commission_type,
        commission_rate: Number(program.commission_rate) || 0,
        commission_per_item: Number(program.commission_rate) || 0,
        cookie_days: Number(program.cookie_days) || 14,
        min_payout_amount: Number(program.min_payout_amount) || 50000,
        featured_product_id: program.featured_product_id || null
      };

      const res = await fetch('/api/v1/admin/affiliate/program', {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan konfigurasi program');
      }

      if (typeof window.showToast === 'function') {
        window.showToast('✓ Pengaturan program affiliate berhasil disimpan!');
      }
      loadData();
    } catch (err) {
      console.error('[AffiliatePage] Save config error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Gagal menyimpan: ' + err.message);
      }
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Open Product Picker Bottom Sheet
  const openProductPicker = () => {
    setTempSelectedProductId(program.featured_product_id || '');
    setPickerSearch('');
    setSelectedCategoryFilter('ALL');
    setShowProductPicker(true);
  };

  // Confirm Product Selection from Bottom Sheet
  const handleConfirmProductPick = () => {
    const chosen = availableProducts.find((p) => String(p.id) === String(tempSelectedProductId));
    if (chosen) {
      setProgram((prev) => ({
        ...prev,
        featured_product_id: String(chosen.id),
        featured_product: chosen
      }));
      if (typeof window.showToast === 'function') {
        window.showToast(`✓ Menu unggulan "${chosen.name}" dipilih!`);
      }
    } else {
      setProgram((prev) => ({
        ...prev,
        featured_product_id: '',
        featured_product: null
      }));
    }
    setShowProductPicker(false);
  };

  // Remove Selected Hero Dish
  const handleClearFeaturedProduct = () => {
    setProgram((prev) => ({
      ...prev,
      featured_product_id: '',
      featured_product: null
    }));
    setTempSelectedProductId('');
    if (typeof window.showToast === 'function') {
      window.showToast('Menu unggulan story dihapus.');
    }
  };

  // Filtered Products for Picker Sheet
  const filteredProductsForPicker = useMemo(() => {
    return availableProducts.filter((p) => {
      const matchCat =
        selectedCategoryFilter === 'ALL' ||
        String(p.category_id) === String(selectedCategoryFilter);
      const searchLower = pickerSearch.trim().toLowerCase();
      const matchSearch =
        !searchLower ||
        String(p.name || '').toLowerCase().includes(searchLower) ||
        String(p.description || '').toLowerCase().includes(searchLower) ||
        String(p.sku || '').toLowerCase().includes(searchLower);
      return matchCat && matchSearch;
    });
  }, [availableProducts, selectedCategoryFilter, pickerSearch]);

  // Copy Account Number
  const copyToClipboard = (text, label) => {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(text));
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = String(text);
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      if (typeof window.showToast === 'function') {
        window.showToast(`✓ ${label || 'No. Rekening'} berhasil disalin!`);
      }
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  // Open WhatsApp Link
  const openWhatsApp = (phone, name, amount) => {
    if (!phone) {
      if (typeof window.showToast === 'function') window.showToast('Nomor HP tidak tersedia');
      return;
    }
    const cleanPhone = phone.replace(/^0/, '62').replace(/\D/g, '');
    const message = encodeURIComponent(
      `Halo ${name || 'Mitra'},\n\nKami dari manajemen restoran mengonfirmasi penarikan saldo affiliate Anda sebesar ${formatRupiah(amount)}. Terima kasih!`
    );
    window.open(`https://wa.me/${cleanPhone}?text=${message}`, '_blank');
  };

  // Process Payout (Approve)
  const handleApprovePayout = async () => {
    if (!selectedPayout) return;
    setIsProcessingPayout(true);
    try {
      const token = getAuthToken();
      const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/affiliate/payouts/${selectedPayout.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          action: 'APPROVE',
          transfer_reference: transferRefInput.trim() || 'TRF-MANUAL',
          notes: transferNoteInput.trim() || null
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyetujui transfer');
      }

      if (typeof window.showToast === 'function') {
        window.showToast('✓ Penarikan dana berhasil ditandai telah ditransfer!');
      }
      setShowApproveModal(false);
      setSelectedPayout(null);
      setTransferRefInput('');
      setTransferNoteInput('');
      loadData();
    } catch (err) {
      console.error('[AffiliatePage] Approve error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Gagal memproses: ' + err.message);
      }
    } finally {
      setIsProcessingPayout(false);
    }
  };

  // Process Payout (Reject & Refund)
  const handleRejectPayout = async () => {
    if (!selectedPayout) return;
    if (!rejectReasonInput.trim()) {
      if (typeof window.showToast === 'function') {
        window.showToast('Mohon masukkan alasan penolakan!');
      }
      return;
    }

    setIsProcessingPayout(true);
    try {
      const token = getAuthToken();
      const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/affiliate/payouts/${selectedPayout.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          action: 'REJECT',
          rejection_reason: rejectReasonInput.trim()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal membatalkan penarikan');
      }

      if (typeof window.showToast === 'function') {
        window.showToast('✓ Penarikan ditolak dan saldo telah di-refund otomatis!');
      }
      setShowRejectModal(false);
      setSelectedPayout(null);
      setRejectReasonInput('');
      loadData();
    } catch (err) {
      console.error('[AffiliatePage] Reject error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Gagal membatalkan: ' + err.message);
      }
    } finally {
      setIsProcessingPayout(false);
    }
  };

  // Member Action: Approve / Reject
  const handleMemberAction = async (profileId, action) => {
    try {
      const token = getAuthToken();
      const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const endpoint = action === 'approve'
        ? `/api/v1/admin/affiliate/members/${profileId}/approve`
        : `/api/v1/admin/affiliate/members/${profileId}/reject`;

      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal memproses anggota');
      }
      if (typeof window.showToast === 'function') {
        window.showToast(action === 'approve' ? '✓ Mitra berhasil disetujui!' : '✓ Mitra telah ditolak.');
      }
      loadData();
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('Gagal: ' + err.message);
      }
    }
  };

  // Computed values
  const pendingPayoutCount = useMemo(() => {
    return payouts.filter((p) => String(p.status).toUpperCase() === 'REQUESTED').length;
  }, [payouts]);

  const filteredPayouts = useMemo(() => {
    if (payoutFilter === 'ALL') return payouts;
    return payouts.filter((p) => String(p.status).toUpperCase() === payoutFilter);
  }, [payouts, payoutFilter]);

  const filteredMembers = useMemo(() => {
    if (memberFilter === 'ALL') return members;
    return members.filter((m) => String(m.status).toUpperCase() === memberFilter);
  }, [members, memberFilter]);

  // Current featured product object
  const currentFeaturedProduct = useMemo(() => {
    if (program.featured_product) return program.featured_product;
    if (program.featured_product_id) {
      return availableProducts.find((p) => String(p.id) === String(program.featured_product_id)) || null;
    }
    return null;
  }, [program.featured_product, program.featured_product_id, availableProducts]);

  return (
    <div
      id="modern-affiliate-page-root"
      style={{
        width: '100%',
        maxWidth: '390px',
        margin: '0 auto',
        paddingBottom: '8px',
        boxSizing: 'border-box',
        backgroundColor: '#F9FAFC',
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        display: 'flex',
        flexDirection: 'column'
      }}
      className="w-full flex flex-col font-sans select-none"
    >
      {/* 1. Header with Back Button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
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
          <div>
            <h1 className="font-bold text-slate-900 text-lg tracking-[0] leading-[22px] m-0">
              Program Kemitraan (Affiliate)
            </h1>
            <p className="text-xs text-slate-500 m-0 mt-0.5">
              Komisi penjualan, pencairan dana, &amp; mitra
            </p>
          </div>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
            program.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
          }`}
        >
          {program.is_active ? 'Aktif' : 'Nonaktif'}
        </span>
      </div>

      {/* 2. Subnav Tabs (3 Pill Navigation) */}
      <div className="flex items-center justify-between w-full bg-slate-200/80 p-1 rounded-xl mb-4 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('config')}
          className={`flex-1 py-2 text-center rounded-lg transition-all border-none cursor-pointer ${
            activeTab === 'config'
              ? 'bg-white text-slate-900 font-bold shadow-xs'
              : 'bg-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          ⚙️ Pengaturan
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('payouts')}
          className={`flex-1 py-2 text-center rounded-lg transition-all border-none cursor-pointer relative ${
            activeTab === 'payouts'
              ? 'bg-white text-slate-900 font-bold shadow-xs'
              : 'bg-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          💸 Pencairan Saldo
          {pendingPayoutCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black">
              {pendingPayoutCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('members')}
          className={`flex-1 py-2 text-center rounded-lg transition-all border-none cursor-pointer ${
            activeTab === 'members'
              ? 'bg-white text-slate-900 font-bold shadow-xs'
              : 'bg-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          👥 Mitra ({members.length})
        </button>
      </div>

      {/* 3. Loading Indicator */}
      {loading && (
        <div className="py-12 text-center text-sm text-slate-400">
          Memuat data affiliate...
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB 1: PENGATURAN PROGRAM                                      */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {!loading && activeTab === 'config' && (
        <div className="flex flex-col gap-4">
          {/* Card: Status Program */}
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">Aktifkan Program Affiliate</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Izinkan pelanggan mendaftar &amp; membagikan link promosi
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(program.is_active)}
                onChange={(e) => setProgram((p) => ({ ...p, is_active: e.target.checked ? 1 : 0 }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Card: Skema Komisi */}
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900">Skema &amp; Nominal Komisi</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Pilih metode perhitungan komisi yang diperoleh affiliator saat terjadi pesanan
              </div>
            </div>

            {/* Commission Type Selector */}
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={() => setProgram((p) => ({ ...p, commission_type: 'FIXED_PER_ITEM' }))}
                className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                  program.commission_type === 'FIXED_PER_ITEM'
                    ? 'border-emerald-600 bg-emerald-50/70 text-slate-900 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold">🍜 Per Menu (Item)</span>
                  {program.commission_type === 'FIXED_PER_ITEM' && (
                    <span className="text-emerald-600 font-bold text-xs">✓</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  Komisi tetap per porsi/item terjual (misal: Rp 1.000/menu).
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProgram((p) => ({ ...p, commission_type: 'PERCENTAGE' }))}
                className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                  program.commission_type === 'PERCENTAGE'
                    ? 'border-emerald-600 bg-emerald-50/70 text-slate-900 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold">% Persentase</span>
                  {program.commission_type === 'PERCENTAGE' && (
                    <span className="text-emerald-600 font-bold text-xs">✓</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  Dihitung dari subtotal keranjang belanja pelanggan.
                </div>
              </button>
            </div>

            {/* Input Nominal Komisi */}
            <div className="flex flex-col gap-1.5 mt-2">
              <label className="text-xs font-semibold text-slate-700">
                {program.commission_type === 'FIXED_PER_ITEM'
                  ? 'Nominal Komisi per Item Menu (Rp)'
                  : 'Persentase Komisi (%)'}
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-bold text-slate-400">
                  {program.commission_type === 'FIXED_PER_ITEM' ? 'Rp' : '%'}
                </span>
                <input
                  type="number"
                  value={program.commission_rate}
                  onChange={(e) => setProgram((p) => ({ ...p, commission_rate: e.target.value }))}
                  placeholder={program.commission_type === 'FIXED_PER_ITEM' ? '1000' : '10'}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-emerald-600 focus:bg-white"
                />
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[11px] text-slate-400">Pilihan cepat:</span>
                {program.commission_type === 'FIXED_PER_ITEM' ? (
                  [1000, 1500, 2000, 3000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setProgram((p) => ({ ...p, commission_rate: amt }))}
                      className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold border-none cursor-pointer"
                    >
                      {formatRupiah(amt)}
                    </button>
                  ))
                ) : (
                  [5, 10, 15, 20].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setProgram((p) => ({ ...p, commission_rate: pct }))}
                      className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold border-none cursor-pointer"
                    >
                      {pct}%
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Card: Syarat Penarikan & Cookie */}
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3">
            <div className="text-sm font-bold text-slate-900">Ketentuan Penarikan &amp; Atribusi</div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Minimal Penarikan Saldo (Payout)
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-bold text-slate-400">Rp</span>
                <input
                  type="number"
                  value={program.min_payout_amount}
                  onChange={(e) => setProgram((p) => ({ ...p, min_payout_amount: e.target.value }))}
                  placeholder="50000"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-emerald-600 focus:bg-white"
                />
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[11px] text-slate-400">Standar:</span>
                {[25000, 50000, 100000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setProgram((p) => ({ ...p, min_payout_amount: amt }))}
                    className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold border-none cursor-pointer"
                  >
                    {formatRupiah(amt)}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-slate-400 mt-1">
                Mitra baru dapat meminta pencairan bila saldo telah mencapai nominal ini (standar: Rp 50.000).
              </span>
            </div>

            <div className="flex flex-col gap-1.5 mt-2">
              <label className="text-xs font-semibold text-slate-700">
                Masa Berlaku Link / Cookie Atribusi (Hari)
              </label>
              <input
                type="number"
                value={program.cookie_days}
                onChange={(e) => setProgram((p) => ({ ...p, cookie_days: e.target.value }))}
                placeholder="14"
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-emerald-600 focus:bg-white"
              />
              <span className="text-[11px] text-slate-400">
                Lama atribusi komisi tetap diakui setelah calon pembeli mengklik tautan affiliator.
              </span>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════ */}
          {/* CARD: MENU UNGGULAN STORY (HERO DISH)                      */}
          {/* ══════════════════════════════════════════════════════════ */}
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <span>📸</span>
                  <span>Menu Unggulan Story (Hero Dish)</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Poster otomatis untuk WhatsApp Story &amp; Instagram mitra
                </div>
              </div>
              {currentFeaturedProduct && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                  ★ Terpilih
                </span>
              )}
            </div>

            {/* State A: Product Already Selected */}
            {currentFeaturedProduct ? (
              <div className="flex flex-col gap-3">
                {/* Highlight Card */}
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-3.5 relative overflow-hidden">
                  {/* Photo */}
                  {currentFeaturedProduct.image_url || currentFeaturedProduct.image ? (
                    <img
                      src={currentFeaturedProduct.image_url || currentFeaturedProduct.image}
                      alt={currentFeaturedProduct.name}
                      className="w-16 h-16 object-cover rounded-xl border border-slate-200 shrink-0 shadow-xs"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-16 h-16 bg-amber-100 text-amber-800 rounded-xl flex items-center justify-center text-2xl shrink-0 font-bold">
                      🍜
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 truncate">
                        {currentFeaturedProduct.name}
                      </span>
                    </div>
                    <div className="text-xs font-extrabold text-emerald-600 mt-0.5">
                      {formatRupiah(currentFeaturedProduct.price || currentFeaturedProduct.selling_price)}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {currentFeaturedProduct.description || 'Menu andalan resto untuk promosi affiliate'}
                    </div>
                  </div>
                </div>

                {/* Action Buttons for Selected Product */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={openProductPicker}
                    className="py-2.5 px-3 bg-white border border-slate-300 hover:bg-slate-50 active:scale-95 text-slate-800 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-xs"
                  >
                    🔄 Ganti Menu
                  </button>
                  <button
                    type="button"
                    onClick={handleClearFeaturedProduct}
                    className="py-2.5 px-3 bg-white border border-rose-200 hover:bg-rose-50 active:scale-95 text-rose-600 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                  >
                    🗑️ Hapus Pilihan
                  </button>
                </div>

                {/* Live Story Mockup Preview (9:16 frame simulation) */}
                <div className="mt-1 p-3.5 bg-gradient-to-b from-slate-900 to-slate-800 rounded-2xl text-white flex flex-col gap-2.5 relative overflow-hidden shadow-md">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📱</span>
                      <span className="text-xs font-bold text-white tracking-wide">
                        Pratinjau Story Mitra (WhatsApp &amp; IG)
                      </span>
                    </div>
                    <span className="text-[10px] bg-emerald-500/30 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-400/30">
                      Rasio 9:16
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {currentFeaturedProduct.image_url || currentFeaturedProduct.image ? (
                      <img
                        src={currentFeaturedProduct.image_url || currentFeaturedProduct.image}
                        alt=""
                        className="w-14 h-14 object-cover rounded-xl border border-white/20 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-white/10 rounded-xl flex items-center justify-center text-xl shrink-0">
                        🍜
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-amber-300 font-bold uppercase tracking-wider">
                        ★ Rekomendasi Hari Ini
                      </div>
                      <div className="text-xs font-bold text-white truncate mt-0.5">
                        {currentFeaturedProduct.name}
                      </div>
                      <div className="text-[11px] font-semibold text-emerald-400 mt-0.5">
                        {formatRupiah(currentFeaturedProduct.price || currentFeaturedProduct.selling_price)}
                      </div>
                    </div>
                  </div>

                  <div className="p-2 bg-white/10 rounded-xl backdrop-blur-xs flex items-center justify-between text-[11px]">
                    <span className="text-white/80">
                      Scan QR / Klik Link di Story Affiliator
                    </span>
                    <span className="font-bold text-amber-300 bg-amber-400/20 px-2 py-0.5 rounded-md">
                      Pesan Cepat
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-400 leading-tight">
                    Poster ini otomatis diproduksi oleh aplikasi saat affiliator menekan tombol "Bagikan ke Story WhatsApp / Instagram".
                  </div>
                </div>
              </div>
            ) : (
              /* State B: Empty - Prompt to Select Product */
              <div className="p-5 border-2 border-dashed border-slate-300 bg-slate-50/70 rounded-2xl flex flex-col items-center justify-center text-center gap-2">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl">
                  🍜
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-800">
                    Belum Ada Menu Unggulan yang Dipilih
                  </div>
                  <div className="text-[11px] text-slate-500 max-w-[260px] mx-auto mt-0.5">
                    Pilih 1 menu terlaris atau menu andalan resto Anda untuk dijadikan poster promosi affiliator.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openProductPicker}
                  className="mt-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl border-none cursor-pointer flex items-center gap-1.5 shadow-xs transition-all"
                >
                  <span>+</span>
                  <span>Pilih Menu dari Katalog ({availableProducts.length} Menu)</span>
                </button>
              </div>
            )}
          </div>

          {/* Button Save */}
          <button
            type="button"
            disabled={isSavingConfig}
            onClick={handleSaveProgram}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-sm rounded-xl border-none shadow-md cursor-pointer transition-all flex items-center justify-center gap-2 mt-2"
          >
            {isSavingConfig ? 'Menyimpan...' : '✓ Simpan Pengaturan Affiliate'}
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB 2: PENCAIRAN SALDO (PAYOUT TICKETS)                         */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {!loading && activeTab === 'payouts' && (
        <div className="flex flex-col gap-3">
          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {[
              { id: 'ALL', label: 'Semua' },
              { id: 'REQUESTED', label: 'Menunggu Review' },
              { id: 'PAID', label: 'Ditransfer' },
              { id: 'REJECTED', label: 'Ditolak' }
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setPayoutFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer whitespace-nowrap transition-all ${
                  payoutFilter === f.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Payout Ticket Cards */}
          {filteredPayouts.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400 bg-white rounded-2xl border border-slate-200">
              Tidak ada permintaan pencairan dana pada filter ini.
            </div>
          ) : (
            filteredPayouts.map((p) => {
              const isPending = String(p.status).toUpperCase() === 'REQUESTED';
              const isPaid = String(p.status).toUpperCase() === 'PAID';
              const isRejected = String(p.status).toUpperCase() === 'REJECTED';

              return (
                <div
                  key={p.id}
                  className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-3"
                >
                  {/* Top: Status & Date */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-slate-400 truncate max-w-[170px]">
                      {p.id}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isPending
                          ? 'bg-amber-100 text-amber-800'
                          : isPaid
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {isPending ? 'Menunggu Review' : isPaid ? 'Ditransfer' : 'Ditolak & Refund'}
                    </span>
                  </div>

                  {/* Nominal & Affiliator Name */}
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-lg font-black text-slate-900">
                        {formatRupiah(p.amount)}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {p.customer_name || 'Mitra Affiliator'} ({p.referral_code || 'REF'})
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {p.requested_at ? p.requested_at.split(' ')[0] : ''}
                    </div>
                  </div>

                  {/* Bank & E-Wallet Destination Box */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500 uppercase">
                        Tujuan Pencairan
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-xs font-black text-slate-800">
                        {p.bank_name || 'E-Wallet / Bank'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-1">
                      <div>
                        <div className="text-sm font-black text-slate-900 tracking-wide font-mono">
                          {p.bank_account_number || '-'}
                        </div>
                        <div className="text-xs font-medium text-slate-600">
                          a.n. {p.bank_account_holder || '-'}
                        </div>
                      </div>

                      {/* Copy Button */}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(p.bank_account_number, `No. ${p.bank_name || 'Rekening'}`)}
                        className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer transition-all"
                      >
                        📋 Salin
                      </button>
                    </div>
                  </div>

                  {/* Action Buttons for Pending Payouts */}
                  {isPending && (
                    <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPayout(p);
                            setShowApproveModal(true);
                          }}
                          className="py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl border-none cursor-pointer flex items-center justify-center gap-1 shadow-xs"
                        >
                          ✓ Tandai Ditransfer
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPayout(p);
                            setShowRejectModal(true);
                          }}
                          className="py-2.5 bg-white hover:bg-rose-50 text-rose-600 border border-rose-300 font-bold text-xs rounded-xl cursor-pointer flex items-center justify-center gap-1"
                        >
                          ✕ Tolak &amp; Refund
                        </button>
                      </div>

                      {/* WhatsApp Hubungi Button */}
                      {p.customer_phone && (
                        <button
                          type="button"
                          onClick={() => openWhatsApp(p.customer_phone, p.customer_name, p.amount)}
                          className="w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          💬 Konfirmasi via WhatsApp
                        </button>
                      )}
                    </div>
                  )}

                  {/* Transferred Metadata */}
                  {isPaid && (
                    <div className="text-[11px] text-emerald-700 bg-emerald-50 p-2 rounded-lg font-medium">
                      ✓ Telah ditransfer • Ref: {p.transfer_receipt_url || 'TRF-OK'}
                    </div>
                  )}

                  {/* Rejected Metadata */}
                  {isRejected && (
                    <div className="text-[11px] text-rose-700 bg-rose-50 p-2 rounded-lg font-medium">
                      ✕ Ditolak: "{p.rejection_reason || 'Data rekening tidak sesuai'}" (Saldo Rp {p.amount ? p.amount.toLocaleString('id-ID') : 0} otomatis di-refund ke akun affiliator).
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* TAB 3: DAFTAR MITRA AFFILIATOR                                 */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {!loading && activeTab === 'members' && (
        <div className="flex flex-col gap-3">
          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {[
              { id: 'ALL', label: `Semua (${members.length})` },
              { id: 'ACTIVE', label: 'Aktif' },
              { id: 'PENDING', label: 'Menunggu Persetujuan' }
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setMemberFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border cursor-pointer whitespace-nowrap transition-all ${
                  memberFilter === f.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredMembers.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400 bg-white rounded-2xl border border-slate-200">
              Tidak ada mitra affiliator pada filter ini.
            </div>
          ) : (
            filteredMembers.map((m) => {
              const isPending = String(m.status).toUpperCase() === 'PENDING';
              return (
                <div
                  key={m.id}
                  className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {m.customer_name || 'Pelanggan Xentra'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {m.customer_phone || '-'} • Kode: <span className="font-bold text-slate-800">{m.referral_code}</span>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isPending ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {isPending ? 'Pending' : 'Aktif'}
                    </span>
                  </div>

                  {/* Financial Stats Bar */}
                  <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-xl text-center">
                    <div>
                      <div className="text-[10px] text-slate-400">Total Komisi</div>
                      <div className="text-xs font-bold text-slate-800">
                        {formatRupiah(m.total_earnings)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Saldo Payable</div>
                      <div className="text-xs font-bold text-emerald-600">
                        {formatRupiah(m.balance_payable)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">Total Ditarik</div>
                      <div className="text-xs font-bold text-slate-600">
                        {formatRupiah(m.total_withdrawn)}
                      </div>
                    </div>
                  </div>

                  {/* Action for Pending Applicants */}
                  {isPending && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => handleMemberAction(m.id, 'approve')}
                        className="py-2 bg-emerald-600 text-white font-bold text-xs rounded-lg border-none cursor-pointer"
                      >
                        ✓ Setujui Mitra
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMemberAction(m.id, 'reject')}
                        className="py-2 bg-rose-50 text-rose-600 font-bold text-xs rounded-lg border border-rose-200 cursor-pointer"
                      >
                        ✕ Tolak
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* BOTTOM SHEET: PRODUCT PICKER FOR HERO DISH (F&B MERCHANT UX)  */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showProductPicker && (
        <div
          className="fixed inset-0 z-[99999] flex flex-col justify-end bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowProductPicker(false);
          }}
        >
          <div
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            className="w-full max-w-[430px] mx-auto bg-white rounded-t-[24px] max-h-[85vh] flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. Drag Handle Bar */}
            <div className="w-full flex justify-center pt-3 pb-2 shrink-0">
              <div className="w-10 h-1.5 bg-slate-300 rounded-full"></div>
            </div>

            {/* 2. Sheet Header */}
            <div className="flex items-center justify-between px-4 pb-3 shrink-0 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 m-0">
                  Pilih Menu Unggulan
                </h3>
                <p className="text-xs text-slate-500 m-0 mt-0.5">
                  Tersedia {availableProducts.length} pilihan menu di katalog restoran
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowProductPicker(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 border-none bg-transparent cursor-pointer transition-colors"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>

            {/* 3. Search Bar */}
            <div className="p-3 shrink-0 bg-white">
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-slate-400 text-sm pointer-events-none">
                  🔍
                </span>
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Cari menu (misal: Mie, Kopi, Ayam)..."
                  className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-emerald-600 focus:bg-white"
                />
                {pickerSearch && (
                  <button
                    type="button"
                    onClick={() => setPickerSearch('')}
                    className="absolute right-3 text-slate-400 hover:text-slate-600 border-none bg-transparent cursor-pointer text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Category Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pt-2 pb-1 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setSelectedCategoryFilter('ALL')}
                  className={`px-3 py-1 rounded-full whitespace-nowrap cursor-pointer transition-all border-none ${
                    selectedCategoryFilter === 'ALL'
                      ? 'bg-slate-900 text-white font-bold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Semua ({availableProducts.length})
                </button>
                {categories.map((c) => {
                  const count = availableProducts.filter((p) => String(p.category_id) === String(c.id)).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCategoryFilter(String(c.id))}
                      className={`px-3 py-1 rounded-full whitespace-nowrap cursor-pointer transition-all border-none ${
                        selectedCategoryFilter === String(c.id)
                          ? 'bg-slate-900 text-white font-bold'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {c.name} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Product List (Scrollable Area) */}
            <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-2 overscroll-contain">
              {filteredProductsForPicker.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  Tidak ada menu yang sesuai pencarian "{pickerSearch}".
                </div>
              ) : (
                filteredProductsForPicker.map((prod) => {
                  const isSelected = String(tempSelectedProductId) === String(prod.id);
                  const catName = categoryMap[String(prod.category_id)] || 'Menu Resto';
                  const img = prod.image_url || prod.image;

                  return (
                    <div
                      key={prod.id}
                      data-picker-item-id={String(prod.id)}
                      onClick={() => setTempSelectedProductId(String(prod.id))}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none active:scale-[0.99] ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50/70 shadow-xs ring-1 ring-emerald-500'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      {/* Image & Details */}
                      <div className="flex items-center gap-3 min-w-0">
                        {img ? (
                          <img
                            src={img}
                            alt={prod.name}
                            className="w-12 h-12 object-cover rounded-xl border border-slate-200 shrink-0"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center text-xl shrink-0">
                            🍜
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate">
                            {prod.name}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-extrabold text-emerald-600">
                              {formatRupiah(prod.price || prod.selling_price)}
                            </span>
                            <span className="text-[10px] text-slate-400 px-1.5 py-0.2 bg-slate-100 rounded-md">
                              {catName}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Radio Selection Indicator */}
                      <div className="shrink-0 flex items-center justify-center">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            isSelected
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {isSelected && <span className="text-[10px] font-black">✓</span>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 5. Sticky Bottom Apply Button */}
            <div className="p-3 bg-white border-t border-slate-100 shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowProductPicker(false)}
                className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border-none cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!tempSelectedProductId}
                onClick={handleConfirmProductPick}
                className={`flex-1 py-3 text-center rounded-xl font-bold text-xs border-none cursor-pointer transition-all shadow-xs ${
                  tempSelectedProductId
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                {tempSelectedProductId
                  ? '✓ Terapkan Sebagai Menu Unggulan'
                  : 'Pilih Satu Menu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MODAL: KONFIRMASI APPROVE / TRANSFER                           */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showApproveModal && selectedPayout && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-2xl flex flex-col gap-4 animate-in fade-in duration-150">
            <div>
              <h3 className="text-base font-bold text-slate-900 m-0">
                Konfirmasi Transfer Dana
              </h3>
              <p className="text-xs text-slate-500 mt-1 m-0">
                Pastikan Anda telah melakukan transfer ke rekening affiliator berikut:
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Nominal:</span>
                <span className="font-bold text-slate-900">{formatRupiah(selectedPayout.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Bank / E-Wallet:</span>
                <span className="font-bold text-slate-900">{selectedPayout.bank_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">No. Rekening:</span>
                <span className="font-mono font-bold text-slate-900">{selectedPayout.bank_account_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Atas Nama:</span>
                <span className="font-bold text-slate-900">{selectedPayout.bank_account_holder}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Nomor Referensi Transfer m-Banking (Opsional)
              </label>
              <input
                type="text"
                value={transferRefInput}
                onChange={(e) => setTransferRefInput(e.target.value)}
                placeholder="Contoh: TRF-BCA-982341"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={() => {
                  setShowApproveModal(false);
                  setSelectedPayout(null);
                }}
                className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border-none cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isProcessingPayout}
                onClick={handleApprovePayout}
                className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl border-none cursor-pointer shadow-xs"
              >
                {isProcessingPayout ? 'Memproses...' : 'Ya, Sudah Ditransfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MODAL: TOLAK & REFUND PAYOUT                                  */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {showRejectModal && selectedPayout && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-2xl flex flex-col gap-4 animate-in fade-in duration-150">
            <div>
              <h3 className="text-base font-bold text-rose-700 m-0">
                Tolak Permintaan Pencairan
              </h3>
              <p className="text-xs text-slate-500 mt-1 m-0">
                Saldo sebesar <span className="font-bold text-slate-800">{formatRupiah(selectedPayout.amount)}</span> akan{' '}
                <span className="font-bold text-emerald-700">otomatis di-refund</span> kembali ke saldo payable affiliator.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Alasan Penolakan (Wajib)
              </label>
              <textarea
                rows={3}
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                placeholder="Contoh: Nomor rekening BCA tidak terdaftar / Nama pemilik salah. Silakan perbarui di menu profil affiliate."
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-rose-500 focus:bg-white resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={() => {
                  setShowRejectModal(false);
                  setSelectedPayout(null);
                }}
                className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border-none cursor-pointer"
              >
                Kembali
              </button>
              <button
                type="button"
                disabled={isProcessingPayout}
                onClick={handleRejectPayout}
                className="py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl border-none cursor-pointer shadow-xs"
              >
                {isProcessingPayout ? 'Memproses...' : 'Tolak & Kembalikan Saldo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
