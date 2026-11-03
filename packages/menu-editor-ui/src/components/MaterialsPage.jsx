import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FONT = "'Plus Jakarta Sans', sans-serif";

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (_) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function formatMoney(amount) {
  const num = parseFloat(amount) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

const COLOR_PALETTE = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#7B3DEC', '#007189'];

function getMaterialColor(id, index) {
  if (typeof id === 'string') {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }
    return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
  }
  return COLOR_PALETTE[(index || 0) % COLOR_PALETTE.length];
}

export default function MaterialsPage({ onBack, onNavigate }) {
  const [filter, setFilter] = useState('ACTIVE'); // 'ACTIVE' | 'ARCHIVED'
  const [searchQuery, setSearchQuery] = useState('');
  const [materials, setMaterials] = useState(() => {
    if (typeof window !== 'undefined' && Array.isArray(window._ownerMaterials) && window._ownerMaterials.length > 0) {
      return window._ownerMaterials;
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    return !(typeof window !== 'undefined' && Array.isArray(window._ownerMaterials) && window._ownerMaterials.length > 0);
  });
  const [togglingId, setTogglingId] = useState(null);

  // Fetch materials from API
  const fetchMaterials = async () => {
    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/admin/materials?include_archived=true&_t=${Date.now()}`, {
        headers,
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.materials)) {
          // Sort alphabetically by name (consistent with ItemMasterPage and category catalog)
          const sorted = [...data.materials].sort((a, b) => {
            return String(a.name || '').localeCompare(String(b.name || ''), 'id', { sensitivity: 'base' });
          });
          setMaterials(sorted);
          if (typeof window !== 'undefined') {
            window._ownerMaterials = sorted;
          }
        }
      }
    } catch (err) {
      console.error('[MaterialsPage] Fetch error:', err);
      if (typeof window !== 'undefined' && Array.isArray(window._ownerMaterials)) {
        setMaterials(window._ownerMaterials);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMaterials();
    const handleMaterialsUpdated = (event) => {
      if (event && event.detail && typeof event.detail === 'object') {
        const newMat = event.detail;
        setMaterials((prev) => {
          const exists = prev.some((m) => String(m.id) === String(newMat.id));
          const updated = exists
            ? prev.map((m) => (String(m.id) === String(newMat.id) ? { ...m, ...newMat } : m))
            : [...prev, newMat];
          return updated.sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''), 'id', { sensitivity: 'base' })
          );
        });
      }
      fetchMaterials();
    };
    window.addEventListener('materials-updated', handleMaterialsUpdated);
    return () => {
      window.removeEventListener('materials-updated', handleMaterialsUpdated);
    };
  }, []);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof window.goBackFromChildPage === 'function') {
      window.goBackFromChildPage();
      return;
    }
    if (window.XentraNavigationController && typeof window.XentraNavigationController.back === 'function') {
      const snap = window.XentraNavigationController.getSnapshot ? window.XentraNavigationController.getSnapshot() : null;
      if (snap && snap.stack && snap.stack.length > 1) {
        window.XentraNavigationController.back();
        return;
      }
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('business');
    }
  };

  const handleToggleStatus = async (materialId, currentStatus, event) => {
    if (event) {
      event.stopPropagation();
    }
    if (togglingId) return;

    const newStatus = (currentStatus === 'ACTIVE' || currentStatus === 'active') ? 'ARCHIVED' : 'ACTIVE';
    setTogglingId(materialId);

    // Optimistic UI update
    setMaterials((prev) =>
      prev.map((m) => (String(m.id) === String(materialId) ? { ...m, status: newStatus } : m))
    );

    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/admin/materials/${encodeURIComponent(materialId)}/status`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengubah status');
      }

      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(newStatus === 'ACTIVE' ? '🟢 Bahan baku diaktifkan' : '⚪ Bahan baku dinonaktifkan', 'success');
      }
    } catch (err) {
      console.error('[MaterialsPage] Toggle error:', err);
      // Rollback optimistic update
      setMaterials((prev) =>
        prev.map((m) => (String(m.id) === String(materialId) ? { ...m, status: currentStatus } : m))
      );
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('❌ Gagal: ' + err.message, 'error');
      }
    } finally {
      setTogglingId(null);
    }
  };

  const handleCardClick = (materialId) => {
    if (typeof onNavigate === 'function') {
      onNavigate(`business/materials/${encodeURIComponent(materialId)}/edit`);
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo(`business/materials/${encodeURIComponent(materialId)}/edit`);
      return;
    }
    if (typeof window.openEditMaterialModal === 'function') {
      window.openEditMaterialModal(materialId);
    }
  };

  const handleAddClick = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('business/materials/new');
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('business/materials/new');
      return;
    }
    if (typeof window.openAddMaterialModal === 'function') {
      window.openAddMaterialModal();
    }
  };

  // Filter materials based on search query and status pill
  const filteredMaterials = materials.filter((m) => {
    const isArchived = m.status === 'ARCHIVED' || m.status === 'archived';
    const matchesStatus = filter === 'ACTIVE' ? !isArchived : isArchived;
    if (!matchesStatus) return false;

    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim().toLowerCase();
    const nameMatch = String(m.name || '').toLowerCase().includes(query);
    const codeMatch = String(m.material_code || '').toLowerCase().includes(query);
    return nameMatch || codeMatch;
  });

  return (
    <div
      id="modern-materials-page-root"
      style={{ boxSizing: 'border-box', fontFamily: FONT, paddingBottom: '96px' }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto select-none font-sans"
    >
      {/* 1. Header with Back Arrow and Title (Identical to ItemMasterPage) */}
      <div
        className="flex items-center gap-3 mb-6"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '24px',
          width: '100%'
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
          style={{
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: '-8px',
            borderRadius: '9999px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            flexShrink: 0,
            padding: 0
          }}
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain block"
            style={{ width: '22px', height: '19px', display: 'block', objectFit: 'contain' }}
          />
        </button>
        <h1
          style={{
            color: '#0F172A',
            fontSize: '18px',
            fontFamily: FONT,
            fontWeight: 700,
            lineHeight: '18px',
            margin: 0,
            textAlign: 'left'
          }}
          className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0 text-left"
        >
          Bahan baku
        </h1>
      </div>

      {/* 2. Main Card Container (Identical to ItemMasterPage: width 100%, no extra outer margin) */}
      <div
        style={{
          borderRadius: '14px',
          outline: '0.50px #D9D9D9 solid',
          outlineOffset: '-0.50px',
          padding: '16px',
          backgroundColor: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxSizing: 'border-box',
          width: '100%',
        }}
        className="w-full bg-white flex flex-col"
      >
        {/* A. Search Bar (Figma: height 48px, radius 14px, outline 1px #CBD5E1) */}
        <div
          className="w-full h-12 relative rounded-2xl outline outline-1 outline-offset-[-1px] outline-slate-300 bg-white flex items-center px-4 gap-3.5 overflow-hidden box-border"
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
            gap: '15px',
          }}
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
            aria-label="Cari nama atau kode item"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama atau kode item"
            className="w-full bg-transparent border-none outline-none text-slate-900 placeholder:text-slate-400 text-xs font-medium font-['Plus_Jakarta_Sans']"
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
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* B. Status Filter Pills (Aktif / Nonaktif) */}
        <div
          className="self-stretch flex justify-start items-start gap-24"
          style={{
            alignSelf: 'stretch',
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'flex-start',
          }}
        >
          <div className="w-40 h-7 relative flex gap-[6px]" style={{ display: 'flex', gap: '6px' }}>
            {/* Pill Aktif */}
            <button
              type="button"
              onClick={() => setFilter('ACTIVE')}
              className={`w-20 h-7 rounded-[20px] shadow-[0px_3px_10px_0px_rgba(0,0,0,0.20)] outline outline-1 outline-offset-[-1px] font-['Plus_Jakarta_Sans'] text-xs font-bold flex items-center justify-center transition-all cursor-pointer ${
                filter === 'ACTIVE'
                  ? 'bg-slate-900 text-white outline-slate-900'
                  : 'bg-white text-slate-400 outline-slate-300'
              }`}
              style={{
                width: '75px',
                height: '30px',
                borderRadius: '20px',
                border: 'none',
                cursor: 'pointer',
                fontFamily: FONT,
                fontSize: '11px',
                fontWeight: 700,
                textAlign: 'center',
                backgroundColor: filter === 'ACTIVE' ? '#0F172A' : '#FFFFFF',
                color: filter === 'ACTIVE' ? '#FFFFFF' : '#94A3B8',
                outline: filter === 'ACTIVE' ? '1px #0F172A solid' : '1px #CBD5E1 solid',
                outlineOffset: '-1px',
                boxShadow: '0px 3px 10px 0px rgba(0,0,0,0.20)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
            >
              Aktif
            </button>

            {/* Pill Nonaktif */}
            <button
              type="button"
              onClick={() => setFilter('ARCHIVED')}
              className={`w-20 h-7 rounded-[20px] shadow-[0px_3px_10px_0px_rgba(0,0,0,0.20)] outline outline-1 outline-offset-[-1px] font-['Plus_Jakarta_Sans'] text-xs font-bold flex items-center justify-center transition-all cursor-pointer ${
                filter === 'ARCHIVED'
                  ? 'bg-slate-900 text-white outline-slate-900'
                  : 'bg-white text-slate-400 outline-slate-300'
              }`}
              style={{
                width: '75px',
                height: '30px',
                borderRadius: '20px',
                border: 'none',
                cursor: 'pointer',
                fontFamily: FONT,
                fontSize: '11px',
                fontWeight: 700,
                textAlign: 'center',
                backgroundColor: filter === 'ARCHIVED' ? '#0F172A' : '#FFFFFF',
                color: filter === 'ARCHIVED' ? '#FFFFFF' : '#94A3B8',
                outline: filter === 'ARCHIVED' ? '1px #0F172A solid' : '1px #CBD5E1 solid',
                outlineOffset: '-1px',
                boxShadow: '0px 3px 10px 0px rgba(0,0,0,0.20)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
            >
              Nonaktif
            </button>
          </div>
        </div>

        {/* C. Material Cards List */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {loading ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>
              Memuat data bahan baku...
            </div>
          ) : filteredMaterials.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>
              {searchQuery ? `Tidak ada bahan yang cocok dengan "${searchQuery}"` : 'Belum ada bahan baku'}
            </div>
          ) : (
            filteredMaterials.map((m, index) => {
              const isItemActive = m.status === 'ACTIVE' || m.status === 'active';
              const cost = m.moving_average_unit_cost || m.unit_cost || 0;
              const uomLabel = m.base_uom_code || m.base_uom_name || 'Kg';
              const priceText = `${formatMoney(cost)}/${uomLabel}`;
              const codeText = m.material_code || 'KODE-SKU-0001';
              const colorBg = getMaterialColor(m.id, index);

              return (
                <div
                  key={m.id}
                  onClick={() => handleCardClick(m.id)}
                  className="w-full p-4 rounded-xl outline outline-1 outline-offset-[-1px] outline-slate-300 bg-white inline-flex justify-start items-center gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors box-border"
                  style={{
                    width: '100%',
                    padding: '16px',
                    borderRadius: '12px',
                    outline: '1px #CBD5E1 solid',
                    outlineOffset: '-1px',
                    backgroundColor: '#FFFFFF',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* Left: Thumbnail or Colored Icon Box (45x45, radius 10) */}
                  {m.image_url ? (
                    <img
                      src={m.image_url}
                      alt={m.name}
                      className="size-11 relative rounded-[10px] object-cover shrink-0"
                      style={{
                        width: '45px',
                        height: '45px',
                        borderRadius: '10px',
                        objectFit: 'cover',
                        flexShrink: 0,
                      }}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      className="size-11 relative rounded-[10px] flex items-center justify-center shrink-0"
                      style={{
                        width: '45px',
                        height: '45px',
                        borderRadius: '10px',
                        backgroundColor: colorBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                        <line x1="12" y1="22.08" x2="12" y2="12" />
                      </svg>
                    </div>
                  )}

                  {/* Center: Title + SKU Code + Price/UOM */}
                  <div
                    className="w-40 flex-1 min-w-0 inline-flex flex-col justify-start items-start"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '2px',
                    }}
                  >
                    <div
                      className="text-slate-900 text-base font-bold font-['Plus_Jakarta_Sans'] leading-tight break-words"
                      style={{
                        color: '#0F172A',
                        fontSize: '16px',
                        fontFamily: FONT,
                        fontWeight: 700,
                        lineHeight: '1.25',
                        wordBreak: 'break-word',
                      }}
                    >
                      {m.name}
                    </div>
                    <div
                      className="text-neutral-400 text-[10px] font-medium font-['Plus_Jakarta_Sans']"
                      style={{
                        color: '#979797',
                        fontSize: '10px',
                        fontFamily: FONT,
                        fontWeight: 500,
                        lineHeight: '14px',
                      }}
                    >
                      {codeText}
                    </div>
                    <div
                      className="text-green-600 text-xs font-bold font-['Plus_Jakarta_Sans']"
                      style={{
                        color: '#00A637',
                        fontSize: '12px',
                        fontFamily: FONT,
                        fontWeight: 700,
                        lineHeight: '16px',
                      }}
                    >
                      {priceText}
                    </div>
                  </div>

                  {/* Right: Toggle Switch (Green #00A637 when active, Red #EF4444 when inactive) */}
                  <div
                    onClick={(e) => handleToggleStatus(m.id, m.status, e)}
                    className={`w-9 h-5 relative rounded-[100px] shadow-[-1px_2px_5px_0px_rgba(0,0,0,0.15)] outline outline-[0.50px] outline-offset-[-0.50px] overflow-hidden shrink-0 cursor-pointer transition-colors ${
                      isItemActive ? 'bg-green-600 outline-green-600' : 'bg-red-500 outline-red-500'
                    }`}
                    style={{
                      width: '35px',
                      height: '21px',
                      position: 'relative',
                      backgroundColor: isItemActive ? '#00A637' : '#EF4444',
                      borderRadius: '100px',
                      outline: isItemActive ? '0.50px #009A33 solid' : '0.50px #EF4444 solid',
                      outlineOffset: '-0.50px',
                      boxShadow: '-1px 2px 5px rgba(0, 0, 0, 0.15)',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'background-color 0.2s ease',
                    }}
                  >
                    <div
                      className={`size-5 top-0 absolute bg-white rounded-full shadow-[0px_4px_15px_0px_rgba(0,0,0,0.15)] transition-all ${
                        isItemActive ? 'left-[14px]' : 'left-0'
                      }`}
                      style={{
                        width: '21px',
                        height: '21px',
                        position: 'absolute',
                        top: 0,
                        left: isItemActive ? '14px' : '0px',
                        backgroundColor: '#FFFFFF',
                        borderRadius: '9999px',
                        boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.15)',
                        transition: 'left 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    />
                    {isItemActive && (
                      <div
                        className="w-1.5 h-0 left-[6px] top-[7px] absolute origin-top-left rotate-90 outline outline-1 outline-offset-[-0.50px] outline-white"
                        style={{
                          width: '7px',
                          height: '0',
                          position: 'absolute',
                          left: '6px',
                          top: '7px',
                          transform: 'rotate(90deg)',
                          transformOrigin: 'top left',
                          outline: '1px white solid',
                          outlineOffset: '-0.50px',
                        }}
                      />
                    )}
                  </div>

                  {/* Rightmost: Chevron Icon (13x13) */}
                  <div
                    className="size-3 relative overflow-hidden flex items-center justify-center shrink-0"
                    style={{
                      width: '13px',
                      height: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <path
                        d="M4.5 2.5L8.5 6.5L4.5 10.5"
                        stroke="#303030"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 3. Bottom Floating Action Bar (Identical to ItemMasterPage createPortal) */}
      {typeof document !== 'undefined' && createPortal(
        <div
          id="modern-materials-bottom-bar"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            width: '100vw',
            maxWidth: '100vw',
            height: '110px',
            backgroundColor: '#ffffff',
            borderTopLeftRadius: '20px',
            borderTopRightRadius: '20px',
            boxShadow: '0px 0px 15px rgba(0, 0, 0, 0.15)',
            zIndex: 200,
            paddingTop: '24px',
            paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
            paddingLeft: '16px',
            paddingRight: '16px',
            boxSizing: 'border-box',
          }}
          className="w-full bg-white rounded-t-[20px] z-[200]"
        >
          <div className="w-full max-w-lg mx-auto">
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
              Tambah
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
