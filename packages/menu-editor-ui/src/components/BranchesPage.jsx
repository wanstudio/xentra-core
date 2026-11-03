import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

const FONT = "'Plus Jakarta Sans', sans-serif";

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function BranchesPage({ onBack, onNavigate }) {
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'OPEN' | 'CLOSED'
  const [searchQuery, setSearchQuery] = useState('');
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);

  const fetchBranches = async () => {
    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/branches?_t=${Date.now()}`, {
        headers,
        cache: 'no-store',
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.branches)) {
          setBranches(data.branches);
          if (window.state) {
            window.state.branches = data.branches;
          }
        }
      }
    } catch (err) {
      console.error('[BranchesPage] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof onNavigate === 'function') {
      onNavigate('overview', { history: 'replace' });
      return;
    }
    try {
      window.history.replaceState({ xentraRoute: 'overview' }, '', '#overview');
      window.dispatchEvent(new Event('hashchange'));
    } catch (_) {
      window.location.hash = '#overview';
    }
  };

  const handleCardClick = (branch) => {
    if (typeof onNavigate === 'function') {
      onNavigate(`branches/${encodeURIComponent(branch.id)}/edit`);
    } else {
      window.location.hash = `#branches/${encodeURIComponent(branch.id)}/edit`;
    }
  };

  const handleAddClick = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('branches/new');
    } else {
      window.location.hash = '#branches/new';
    }
  };

  // Toggle Buka/Tutup Operasional Toko (Emergency Switch)
  const handleToggleStoreOpen = async (e, branch) => {
    e.stopPropagation();
    if (togglingId === branch.id) return;

    const currentOpen = branch.is_open_override === 1 || branch.is_open_override === true || branch.is_open_override == null;
    const nextOpen = !currentOpen;

    setTogglingId(branch.id);

    // Optimistic UI update
    setBranches((prev) =>
      prev.map((b) => (String(b.id) === String(branch.id) ? { ...b, is_open_override: nextOpen ? 1 : 0 } : b))
    );

    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/branches/${encodeURIComponent(branch.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_open_override: nextOpen ? 1 : 0 }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengubah status operasional cabang');
      }

      if (typeof window.showToast === 'function') {
        window.showToast(`✓ ${branch.name}: ${nextOpen ? 'Buka Operasional' : 'Tutup Sementara'}`);
      }
    } catch (err) {
      console.error('[BranchesPage] Toggle store open error:', err);
      // Rollback
      setBranches((prev) =>
        prev.map((b) => (String(b.id) === String(branch.id) ? { ...b, is_open_override: currentOpen ? 1 : 0 } : b))
      );
      if (typeof window.showToast === 'function') {
        window.showToast('Gagal mengubah status cabang: ' + (err.message || 'Error'));
      }
    } finally {
      setTogglingId(null);
    }
  };

  // Toggle Online Delivery Pause
  const handleToggleOnlinePaused = async (e, branch) => {
    e.stopPropagation();
    if (togglingId === branch.id) return;

    const currentPaused = branch.is_online_paused === 1 || branch.is_online_paused === true;
    const nextPaused = !currentPaused;

    setTogglingId(branch.id);

    // Optimistic UI update
    setBranches((prev) =>
      prev.map((b) => (String(b.id) === String(branch.id) ? { ...b, is_online_paused: nextPaused ? 1 : 0 } : b))
    );

    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/branches/${encodeURIComponent(branch.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_online_paused: nextPaused ? 1 : 0 }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengubah status pesanan online');
      }

      if (typeof window.showToast === 'function') {
        window.showToast(`✓ Pesanan Online ${branch.name}: ${nextPaused ? 'Dijeda' : 'Aktif'}`);
      }
    } catch (err) {
      console.error('[BranchesPage] Toggle online paused error:', err);
      // Rollback
      setBranches((prev) =>
        prev.map((b) => (String(b.id) === String(branch.id) ? { ...b, is_online_paused: currentPaused ? 1 : 0 } : b))
      );
      if (typeof window.showToast === 'function') {
        window.showToast('Gagal mengubah status pesanan online: ' + (err.message || 'Error'));
      }
    } finally {
      setTogglingId(null);
    }
  };

  // Filtered branches list
  const filteredBranches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return branches.filter((b) => {
      // Search query filter
      if (q) {
        const nameMatch = String(b.name || '').toLowerCase().includes(q);
        const addrMatch = String(b.address_text || '').toLowerCase().includes(q);
        const waMatch = String(b.whatsapp_number || b.phone || '').toLowerCase().includes(q);
        if (!nameMatch && !addrMatch && !waMatch) return false;
      }

      // Status filter
      const isOpen = b.is_open_override === 1 || b.is_open_override === true || b.is_open_override == null;
      if (filter === 'OPEN' && !isOpen) return false;
      if (filter === 'CLOSED' && isOpen) return false;

      return true;
    });
  }, [branches, searchQuery, filter]);

  return (
    <div
      id="branches-page-container"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        paddingBottom: '120px',
      }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow and Title */}
      <div className="flex items-center gap-3 mb-2">
        <button
          type="button"
          onClick={handleBack}
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
          <h1 className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0">
            Cabang Restoran
          </h1>
          <p className="text-xs text-slate-500 m-0 mt-0.5">
            Pilih cabang untuk mengedit data, alamat, atau menghapus cabang
          </p>
        </div>
      </div>

      {/* 2. Main Inset Card Container */}
      <div
        id="branches-page-body"
        style={{
          width: '100%',
          boxSizing: 'border-box',
        }}
        className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-4 shadow-xs"
      >
        {/* Canonical Figma Search Bar (48px height, 14px radius, #CBD5E1 outline) */}
        <div
          style={{
            width: '100%',
            height: '48px',
            position: 'relative',
            borderRadius: '14px',
            outline: '1px #CBD5E1 solid',
            outlineOffset: '-1px',
            backgroundColor: '#FFFFFF',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            gap: '12px',
          }}
          className="focus-within:outline-[#0F172A] focus-within:outline-2 transition-all"
        >
          <div style={{ width: '17px', height: '17px', position: 'relative', flexShrink: 0 }}>
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#94A3B8"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <input
            type="search"
            aria-label="Cari nama cabang atau alamat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama cabang atau alamat..."
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              backgroundColor: 'transparent',
              fontFamily: FONT,
              fontSize: '13px',
              fontWeight: 500,
              color: '#0F172A',
            }}
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              aria-label="Hapus pencarian"
              onClick={() => setSearchQuery('')}
              style={{
                background: '#F1F5F9',
                border: 'none',
                borderRadius: '50%',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#64748B',
                padding: 0,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Pills with canonical stroke */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            style={{
              height: '30px',
              padding: '0 14px',
              borderRadius: '20px',
              border: 'none',
              cursor: 'pointer',
              fontFamily: FONT,
              fontSize: '11px',
              fontWeight: 700,
              textAlign: 'center',
              backgroundColor: filter === 'ALL' ? '#0F172A' : '#FFFFFF',
              color: filter === 'ALL' ? '#FFFFFF' : '#94A3B8',
              outline: filter === 'ALL' ? '1px #0F172A solid' : '1px #CBD5E1 solid',
              outlineOffset: '-1px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            Semua ({branches.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('OPEN')}
            style={{
              height: '30px',
              padding: '0 14px',
              borderRadius: '20px',
              border: 'none',
              cursor: 'pointer',
              fontFamily: FONT,
              fontSize: '11px',
              fontWeight: 700,
              textAlign: 'center',
              backgroundColor: filter === 'OPEN' ? '#0F172A' : '#FFFFFF',
              color: filter === 'OPEN' ? '#FFFFFF' : '#94A3B8',
              outline: filter === 'OPEN' ? '1px #0F172A solid' : '1px #CBD5E1 solid',
              outlineOffset: '-1px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            Buka ({branches.filter((b) => b.is_open_override === 1 || b.is_open_override == null).length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('CLOSED')}
            style={{
              height: '30px',
              padding: '0 14px',
              borderRadius: '20px',
              border: 'none',
              cursor: 'pointer',
              fontFamily: FONT,
              fontSize: '11px',
              fontWeight: 700,
              textAlign: 'center',
              backgroundColor: filter === 'CLOSED' ? '#0F172A' : '#FFFFFF',
              color: filter === 'CLOSED' ? '#FFFFFF' : '#94A3B8',
              outline: filter === 'CLOSED' ? '1px #0F172A solid' : '1px #CBD5E1 solid',
              outlineOffset: '-1px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            Tutup ({branches.filter((b) => b.is_open_override === 0).length})
          </button>
        </div>

        {/* Branch Cards List with Canonical Card Stroke (outline: 1px #CBD5E1 solid) */}
        {loading ? (
          <div className="flex flex-col gap-3 py-10 items-center justify-center text-slate-400 text-xs">
            <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-800 rounded-full animate-spin"></div>
            <span>Memuat data cabang...</span>
          </div>
        ) : filteredBranches.length === 0 ? (
          <div className="py-12 px-4 text-center flex flex-col items-center justify-center gap-2">
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: '#F8FAFC',
                outline: '1px #E2E8F0 solid',
                outlineOffset: '-1px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src="/owner/assets/icons/quick-access/cabang.png"
                alt="Cabang"
                style={{ width: '28px', height: '28px', objectFit: 'contain' }}
              />
            </div>
            <div className="text-sm font-bold text-slate-700">Tidak ada cabang</div>
            <div className="text-xs text-slate-400 max-w-[240px]">
              {searchQuery
                ? `Tidak ditemukan cabang dengan kata kunci "${searchQuery}".`
                : 'Belum ada data cabang pada brand ini.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
            {filteredBranches.map((branch) => {
              const isOpen = branch.is_open_override === 1 || branch.is_open_override === true || branch.is_open_override == null;
              const isPaused = branch.is_online_paused === 1 || branch.is_online_paused === true;
              const isDeliveryActive = branch.is_delivery_active === 1 || branch.is_delivery_active === true;
              const isPickupActive = branch.is_pickup_active === 1 || branch.is_pickup_active === true;
              const isToggling = togglingId === branch.id;

              return (
                <div
                  key={branch.id}
                  data-branch-card-id={branch.id}
                  onClick={() => handleCardClick(branch)}
                  style={{
                    width: '100%',
                    padding: '16px',
                    borderRadius: '12px',
                    outline: '1px #CBD5E1 solid',
                    outlineOffset: '-1px',
                    backgroundColor: '#FFFFFF',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  className="hover:outline-[#94A3B8] active:scale-[0.99] select-none group shadow-xs"
                >
                  {/* Branch Top Info Row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {/* Icon Box with Card Stroke */}
                      <div
                        style={{
                          width: '45px',
                          height: '45px',
                          borderRadius: '10px',
                          backgroundColor: '#F8FAFC',
                          outline: '1px #E2E8F0 solid',
                          outlineOffset: '-1px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                        className="group-hover:bg-slate-100 transition-colors"
                      >
                        <img
                          src="/owner/assets/icons/quick-access/cabang.png"
                          alt="Cabang"
                          style={{ width: '26px', height: '26px', objectFit: 'contain' }}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3
                            style={{
                              fontFamily: FONT,
                              fontSize: '15px',
                              fontWeight: 700,
                              color: '#0F172A',
                              margin: 0,
                            }}
                            className="group-hover:text-emerald-700 transition-colors"
                          >
                            {branch.name}
                          </h3>
                          {/* Open / Closed Status Pill */}
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              backgroundColor: isOpen ? '#ECFDF5' : '#FEF2F2',
                              color: isOpen ? '#059669' : '#DC2626',
                              outline: isOpen ? '1px #A7F3D0 solid' : '1px #FECACA solid',
                              outlineOffset: '-1px',
                            }}
                          >
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor: isOpen ? '#10B981' : '#EF4444',
                              }}
                            ></span>
                            {isOpen ? 'Buka Operasional' : 'Tutup Sementara'}
                          </span>
                        </div>

                        {branch.address_text && (
                          <p
                            style={{
                              fontFamily: FONT,
                              fontSize: '12px',
                              color: '#64748B',
                              margin: '4px 0 0',
                              lineHeight: '1.4',
                            }}
                            className="line-clamp-2"
                          >
                            {branch.address_text}
                          </p>
                        )}

                        {branch.whatsapp_number && (
                          <div
                            style={{
                              fontFamily: FONT,
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#059669',
                              marginTop: '4px',
                            }}
                            className="inline-flex items-center gap-1"
                          >
                            <span>💬 WA: {branch.whatsapp_number}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Chevron Indicator */}
                    <div
                      style={{
                        padding: '4px',
                        color: '#94A3B8',
                        flexShrink: 0,
                      }}
                      className="group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </div>
                  </div>

                  {/* Operational Tags / Metrics Row */}
                  <div
                    style={{
                      paddingTop: '8px',
                      borderTop: '1px #F1F5F9 solid',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                      fontSize: '11px',
                    }}
                  >
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '6px',
                        backgroundColor: '#F1F5F9',
                        color: '#334155',
                        fontWeight: 500,
                      }}
                    >
                      Pesanan: <strong>{branch.total_orders || 0}</strong> ({branch.active_orders || 0} aktif)
                    </span>
                    {Number(branch.items_86_count) > 0 ? (
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#FEF3C7',
                          color: '#B45309',
                          outline: '1px #FDE68A solid',
                          outlineOffset: '-1px',
                          fontWeight: 500,
                        }}
                      >
                        Menu Habis (86): <strong>{branch.items_86_count}</strong>
                      </span>
                    ) : (
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#F8FAFC',
                          color: '#64748B',
                          fontWeight: 500,
                        }}
                      >
                        Menu Habis: 0
                      </span>
                    )}
                    {isDeliveryActive && (
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#F0F9FF',
                          color: '#0369A1',
                          fontWeight: 500,
                        }}
                      >
                        🚚 Delivery
                      </span>
                    )}
                    {isPickupActive && (
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#EEF2FF',
                          color: '#4338CA',
                          fontWeight: 500,
                        }}
                      >
                        🛍️ Pickup
                      </span>
                    )}
                  </div>

                  {/* Remote Emergency Switch Actions */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: '8px',
                      paddingTop: '8px',
                      borderTop: '1px #F1F5F9 solid',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* 1. Buka / Tutup Toko Toggle Button */}
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={(e) => handleToggleStoreOpen(e, branch)}
                      style={{
                        height: '32px',
                        padding: '0 10px',
                        borderRadius: '8px',
                        fontSize: '11px',
                        fontFamily: FONT,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        cursor: isToggling ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s ease',
                        backgroundColor: isOpen ? '#FEF2F2' : '#00A637',
                        color: isOpen ? '#DC2626' : '#FFFFFF',
                        border: isOpen ? '1px #FECACA solid' : '1px #00A637 solid',
                      }}
                      className="active:scale-98"
                    >
                      <span>{isOpen ? '🔴 Tutup Toko' : '🟢 Buka Toko'}</span>
                    </button>

                    {/* 2. Jeda / Lanjut Online Delivery Toggle Button */}
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={(e) => handleToggleOnlinePaused(e, branch)}
                      style={{
                        height: '32px',
                        padding: '0 10px',
                        borderRadius: '8px',
                        fontSize: '11px',
                        fontFamily: FONT,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        cursor: isToggling ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s ease',
                        backgroundColor: isPaused ? '#D97706' : '#F1F5F9',
                        color: isPaused ? '#FFFFFF' : '#334155',
                        border: isPaused ? '1px #D97706 solid' : '1px #E2E8F0 solid',
                      }}
                      className="active:scale-98"
                    >
                      <span>{isPaused ? '▶ Lanjut Online' : '⏸ Jeda Online'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Floating Bottom Action Bar with Green Button */}
      {createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '430px',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.08)',
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              padding: '16px 20px',
              pointerEvents: 'auto',
              boxSizing: 'border-box',
            }}
          >
            <button
              type="button"
              onClick={handleAddClick}
              style={{
                width: '100%',
                height: '48px',
                borderRadius: '9999px',
                backgroundColor: '#00A637',
                outline: '1px #00A637 solid',
                outlineOffset: '-1px',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '14px',
                fontFamily: FONT,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              className="active:scale-[0.98] hover:bg-emerald-600 shadow-sm"
            >
              Tambah Cabang
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
