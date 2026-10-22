import React, { useState, useEffect } from 'react';

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function CategoriesPage({ onBack, onNavigate }) {
  const [filter, setFilter] = useState('ACTIVE');
  const [categories, setCategories] = useState([]);
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);
  const [leavingId, setLeavingId] = useState(null);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [isSorting, setIsSorting] = useState(false);

  const fetchCategoriesAndMenus = async () => {
    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const [catRes, menuRes] = await Promise.all([
        fetch('/api/v1/admin/categories', { headers }),
        fetch('/api/v1/admin/menus', { headers }).catch(() => null)
      ]);

      if (catRes.ok) {
        const catData = await catRes.json();
        if (catData.success && Array.isArray(catData.categories)) {
          setCategories(catData.categories);
          if (window.state) {
            window.state.categories = catData.categories;
          }
        }
      }

      if (menuRes && menuRes.ok) {
        const menuData = await menuRes.json();
        if (menuData.success && Array.isArray(menuData.menus)) {
          setMenus(menuData.menus);
          if (window._ownerMasterMenuState) {
            window._ownerMasterMenuState.menus = menuData.menus;
          }
        }
      }
    } catch (err) {
      console.error('[CategoriesPage] Fetch error:', err);
      if (window.state && Array.isArray(window.state.categories)) {
        setCategories(window.state.categories);
      }
      if (window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.menus)) {
        setMenus(window._ownerMasterMenuState.menus);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (window.state && Array.isArray(window.state.categories) && window.state.categories.length > 0) {
      setCategories(window.state.categories);
      setLoading(false);
    }
    if (window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.menus)) {
      setMenus(window._ownerMasterMenuState.menus);
    }
    fetchCategoriesAndMenus();

    try {
      if (window.XentraNative && typeof window.XentraNative.setNavigationBarColor === 'function') {
        window.XentraNative.setNavigationBarColor('#ffffff', true);
      } else if (window.XentraOwnerBridge && typeof window.XentraOwnerBridge.setNavigationBarColor === 'function') {
        window.XentraOwnerBridge.setNavigationBarColor('#ffffff', true);
      }
      if (window.XentraNative && typeof window.XentraNative.setStatusBarColor === 'function') {
        window.XentraNative.setStatusBarColor('#ffffff', true);
      } else if (window.XentraOwnerBridge && typeof window.XentraOwnerBridge.setStatusBarColor === 'function') {
        window.XentraOwnerBridge.setStatusBarColor('#ffffff', true);
      }
    } catch (e) {}
  }, []);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof window.goBackFromCategory === 'function') {
      window.goBackFromCategory();
      return;
    }
    if (window.XentraNavigationController && typeof window.XentraNavigationController.back === 'function') {
      const snap = window.XentraNavigationController.getSnapshot ? window.XentraNavigationController.getSnapshot() : null;
      if (snap && snap.stack && snap.stack.length > 1) {
        window.XentraNavigationController.back();
        return;
      }
    }
    window.location.hash = '#business/catalog';
  };

  const handleAddCategory = () => {
    if (typeof window.openNewCategory === 'function') {
      window.openNewCategory();
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/categories/new');
    } else {
      window.location.hash = '#catalog/categories/new';
    }
  };

  const handleAddMenu = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('catalog/master-menus/new');
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/master-menus/new');
    } else {
      window.location.hash = '#catalog/master-menus/new';
    }
  };

  const handleSortClick = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('catalog/categories/sort');
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/categories/sort');
    } else {
      window.location.hash = '#catalog/categories/sort';
    }
  };

  const handleCardClick = (cat) => {
    const targetRoute = `catalog/categories/${encodeURIComponent(cat.id)}`;
    if (typeof onNavigate === 'function') {
      onNavigate(targetRoute);
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo(targetRoute);
    } else {
      window.location.hash = `#${targetRoute}`;
    }
  };

  const handleToggle = async (cat) => {
    if (togglingId === cat.id) return;
    const prevActive = cat.is_active !== 0 && cat.is_active !== null;
    const nextActive = !prevActive;

    setTogglingId(cat.id);
    setLeavingId(cat.id);

    // Immediate visual update to the new toggle state
    setCategories((prev) =>
      prev.map((c) => (String(c.id) === String(cat.id) ? { ...c, is_active: nextActive ? 1 : 0 } : c))
    );

    // Keep item visible briefly so the user sees the toggle switch colors (green <-> red)
    setTimeout(() => {
      setLeavingId((current) => (current === cat.id ? null : current));
    }, 350);

    try {
      const token = getAuthToken();
      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/categories/${encodeURIComponent(cat.id)}/status`, {
        method: 'PATCH',
        headers
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengubah status kategori');
      }

      if (data.category) {
        setCategories((prev) =>
          prev.map((c) => (String(c.id) === String(data.category.id) ? data.category : c))
        );
        if (window.state && Array.isArray(window.state.categories)) {
          const idx = window.state.categories.findIndex((c) => String(c.id) === String(data.category.id));
          if (idx !== -1) window.state.categories[idx] = data.category;
        }
      }

      if (typeof window.showToast === 'function') {
        window.showToast(`✓ Kategori diubah jadi ${nextActive ? 'Aktif' : 'Nonaktif'}.`);
      }
    } catch (err) {
      console.error('[CategoriesPage] Toggle error:', err);
      // Revert optimistic update
      setCategories((prev) =>
        prev.map((c) => (String(c.id) === String(cat.id) ? { ...c, is_active: prevActive ? 1 : 0 } : c))
      );
      if (typeof window.showToast === 'function') {
        window.showToast('❌ Gagal mengubah status kategori');
      }
    } finally {
      setTogglingId(null);
    }
  };

  const getCategoryDescription = (cat) => {
    const catMenus = menus.filter((m) => {
      if (!m) return false;
      const menuCatId = m.category_id || (m.category && m.category.id);
      return String(menuCatId || '') === String(cat.id);
    });
    if (catMenus.length > 0) {
      const names = catMenus
        .map((m) => m.title_name || m.package_name || m.title || m.name || '')
        .filter(Boolean);
      if (names.length > 0) {
        return names.slice(0, 3).join(', ') + (names.length > 3 ? '...' : '');
      }
    }
    return cat.description || 'Belum ada menu';
  };

  const filteredCategories = categories.filter((cat) => {
    const isActive = cat.is_active !== 0 && cat.is_active !== null;
    if (filter === 'ACTIVE') {
      return isActive || leavingId === cat.id;
    }
    return !isActive || leavingId === cat.id;
  });

  return (
    <div
      id="modern-categories-page-root"
      style={{
        boxSizing: 'border-box',
        paddingBottom: '160px'
      }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow and Title (Identical spacing and sizing to CatalogSubHub) */}
      <div className="flex items-center gap-3 mb-6 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali ke Katalog & Menu"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain"
          />
        </button>
        <h1 className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0">
          Kategori &amp; Menu
        </h1>
      </div>

      {/* 2. Main Inset Card Container */}
      <div
        id="categories-page-body"
        style={{
          width: '100%',
          boxSizing: 'border-box'
        }}
        className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-4 shadow-xs"
      >
        {/* Top Control Bar: Filter Pills (Aktif / Nonaktif) */}
        <div className="flex items-center justify-start w-full gap-1.5">
          <button
            type="button"
            onClick={() => setFilter('ACTIVE')}
            className={`w-[75px] h-[30px] rounded-[20px] text-[11px] font-bold cursor-pointer transition-all flex items-center justify-center border-none ${
              filter === 'ACTIVE'
                ? 'bg-[#0F172A] text-white shadow-xs'
                : 'bg-white text-[#94A3B8] hub-inset-stroke'
            }`}
          >
            Aktif
          </button>
          <button
            type="button"
            onClick={() => setFilter('INACTIVE')}
            className={`w-[75px] h-[30px] rounded-[20px] text-[11px] font-bold cursor-pointer transition-all flex items-center justify-center border-none ${
              filter === 'INACTIVE'
                ? 'bg-[#0F172A] text-white shadow-xs'
                : 'bg-white text-[#94A3B8] hub-inset-stroke'
            }`}
          >
            Nonaktif
          </button>
        </div>

        {/* Category List */}
        {loading ? (
          <div className="py-10 text-center text-sm text-[#94A3B8]">Memuat kategori &amp; menu...</div>
        ) : filteredCategories.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#94A3B8]">
            {filter === 'ACTIVE' ? 'Belum ada kategori aktif' : 'Belum ada kategori nonaktif'}
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-full">
            {filteredCategories.map((cat, idx) => {
              const isCatActive = cat.is_active !== 0 && cat.is_active !== null;
              return (
                <div
                  key={cat.id}
                  onClick={() => handleCardClick(cat)}
                  className="w-full p-4 rounded-[12px] bg-white hub-inset-stroke hub-card flex items-center justify-between gap-3 active:scale-[0.99] transition-all cursor-pointer"
                >
                  {/* Sorting Order Badge if in Sort Mode */}
                  {isSorting && (
                    <div className="w-6 h-6 rounded-md bg-emerald-50 border border-emerald-300 text-[#00A637] font-bold text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </div>
                  )}

                  {/* Title & Subtitle (Clean layout matching new mockup without left image box) */}
                  <div className="flex-1 min-w-0 flex flex-col items-start gap-1">
                    <span className="font-bold text-[#0F172A] text-base leading-snug truncate w-full text-left">
                      {cat.name}
                    </span>
                    <span className="font-medium text-[#94A3B8] text-[13px] leading-snug truncate w-full text-left">
                      {getCategoryDescription(cat)}
                    </span>
                  </div>

                  {/* Toggle SVG Button (Identical size w-[45px] h-[31px] matching Item Master) */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isCatActive}
                    aria-label={`Ubah status ${cat.name}`}
                    disabled={togglingId === cat.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(cat);
                    }}
                    className="p-0 border-none bg-transparent cursor-pointer shrink-0 flex items-center justify-center transition-transform active:scale-95"
                  >
                    <img
                      src={isCatActive ? '/owner/assets/icons/green-toggle.svg' : '/owner/assets/icons/red-toggle.svg'}
                      alt={isCatActive ? 'Status Aktif (Hijau)' : 'Status Nonaktif (Merah)'}
                      className="w-[45px] h-[31px] object-contain select-none pointer-events-none block"
                    />
                  </button>

                  {/* Chevron Right */}
                  <div className="w-[13px] h-[13px] flex items-center justify-center shrink-0 -mr-1">
                    <img
                      src="/owner/assets/icons/akar-icons_chevron-right-small.svg"
                      alt=""
                      aria-hidden="true"
                      className="w-[13px] h-[13px] block opacity-70"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Dedicated Bottom Action Bar (Exclusive to Kategori & Menu only, full screen width, rounded-t-[20px], margin-x: 16px, top-to-button: 24px, solid pure green stroke on Urutkan) */}
      <div
        id="modern-categories-bottom-bar"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          width: '100%',
          backgroundColor: '#ffffff',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          borderTop: '1px solid rgba(203, 213, 225, 0.9)',
          boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.08)',
          zIndex: 200,
          paddingTop: '24px',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
          paddingLeft: '16px',
          paddingRight: '16px',
          boxSizing: 'border-box'
        }}
        className="w-full bg-white rounded-t-[20px] border-t border-slate-200/90 z-[200]"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box'
          }}
        >
          <button
            type="button"
            onClick={handleSortClick}
            style={{
              flex: 1,
              height: '48px',
              borderRadius: '9999px',
              border: '1.5px solid #00A637',
              outline: 'none',
              boxShadow: 'none',
              backgroundColor: '#ffffff',
              color: '#00A637',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease'
            }}
          >
            Urutkan
          </button>
          <button
            type="button"
            onClick={() => setShowAddSheet(true)}
            style={{
              flex: 1,
              height: '48px',
              borderRadius: '9999px',
              border: 'none',
              outline: 'none',
              backgroundColor: '#00A637',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              transition: 'all 0.15s ease'
            }}
          >
            Tambah
          </button>
        </div>
      </div>

      {/* 4. Action Sheet Modal when "Tambah" clicked (Figma 1:1 spec) */}
      {showAddSheet && (
        <div className="fixed inset-0 z-[250] flex items-end justify-center font-sans">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 transition-opacity"
            onClick={() => setShowAddSheet(false)}
          />
          {/* Bottom Sheet Container */}
          <div
            style={{
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              paddingLeft: '27px',
              paddingRight: '27px',
              paddingTop: '24px',
              paddingBottom: 'max(40px, env(safe-area-inset-bottom, 40px))',
              boxSizing: 'border-box',
            }}
            className="relative w-full max-w-[447px] mx-auto bg-white overflow-hidden flex flex-col items-start z-10 animate-sticky-swipe-up"
          >
            {/* Drag Handle Pill (40px wide, 5px thick, #D9D9D9, centered) */}
            <div
              style={{
                width: '40px',
                height: '5px',
                backgroundColor: '#D9D9D9',
                borderRadius: '9999px',
                marginBottom: '18px',
              }}
              className="mx-auto shrink-0"
            />

            {/* Header Title */}
            <div
              style={{
                color: '#0F172A',
                fontSize: '18px',
                fontWeight: 700,
                lineHeight: '18px',
                marginBottom: '25px',
              }}
              className="w-full text-left"
            >
              Pilih yang ingin di tambahkan
            </div>

            {/* Cards Stack (gap: 20px) */}
            <div
              style={{
                gap: '20px',
                marginBottom: '42px',
              }}
              className="w-full flex flex-col items-stretch"
            >
              {/* Card 1: Tambah kategori baru */}
              <button
                type="button"
                onClick={() => {
                  setShowAddSheet(false);
                  handleAddCategory();
                }}
                style={{
                  minHeight: '102px',
                  borderRadius: '20px',
                  backgroundColor: '#FFFFFF',
                  boxShadow: '0px 3px 10px rgba(0, 0, 0, 0.20)',
                  paddingLeft: '17px',
                  paddingRight: '14px',
                  paddingTop: '24px',
                  paddingBottom: '24px',
                  border: 'none',
                }}
                className="w-full flex items-center justify-between gap-[23px] cursor-pointer text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-[23px] min-w-0 flex-1">
                  {/* Green Icon Box (45x45, #34A853, radius 10) */}
                  <div
                    style={{
                      width: '45px',
                      height: '45px',
                      borderRadius: '10px',
                      backgroundColor: '#34A853',
                    }}
                    className="flex items-center justify-center shrink-0"
                  >
                    <img
                      src="/owner/assets/icons/bxs_category.svg"
                      alt=""
                      style={{ width: '25px', height: '25px' }}
                      className="object-contain block"
                    />
                  </div>

                  {/* Text Column */}
                  <div className="flex flex-col items-start justify-center gap-[10px] min-w-0 flex-1">
                    <span
                      style={{
                        color: '#0F172A',
                        fontSize: '16px',
                        fontWeight: 700,
                        lineHeight: '1.2',
                      }}
                      className="truncate w-full text-left"
                    >
                      Tambah kategori baru
                    </span>
                    <span
                      style={{
                        color: '#94A3B8',
                        fontSize: '13px',
                        fontWeight: 500,
                        lineHeight: '1.3',
                      }}
                      className="w-full text-left"
                    >
                      Buat kategori untuk menu Anda
                    </span>
                  </div>
                </div>

                {/* Right Chevron (20x20 container, 5x10 stroke #979797) */}
                <div
                  style={{ width: '20px', height: '20px' }}
                  className="flex items-center justify-center shrink-0"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M7.5 5L12.5 10L7.5 15"
                      stroke="#979797"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </button>

              {/* Card 2: Tambah menu baru */}
              <button
                type="button"
                onClick={() => {
                  setShowAddSheet(false);
                  handleAddMenu();
                }}
                style={{
                  minHeight: '102px',
                  borderRadius: '20px',
                  backgroundColor: '#FFFFFF',
                  boxShadow: '0px 3px 10px rgba(0, 0, 0, 0.20)',
                  paddingLeft: '17px',
                  paddingRight: '14px',
                  paddingTop: '24px',
                  paddingBottom: '24px',
                  border: 'none',
                }}
                className="w-full flex items-center justify-between gap-[23px] cursor-pointer text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-[23px] min-w-0 flex-1">
                  {/* Red Icon Box (45x45, #EA4335, radius 10) */}
                  <div
                    style={{
                      width: '45px',
                      height: '45px',
                      borderRadius: '10px',
                      backgroundColor: '#EA4335',
                    }}
                    className="flex items-center justify-center shrink-0"
                  >
                    <img
                      src="/owner/assets/icons/reicon_food-tray-filled.svg"
                      alt=""
                      style={{ width: '23px', height: '23px' }}
                      className="object-contain block"
                    />
                  </div>

                  {/* Text Column */}
                  <div className="flex flex-col items-start justify-center gap-[10px] min-w-0 flex-1">
                    <span
                      style={{
                        color: '#0F172A',
                        fontSize: '16px',
                        fontWeight: 700,
                        lineHeight: '1.2',
                      }}
                      className="truncate w-full text-left"
                    >
                      Tambah menu baru
                    </span>
                    <span
                      style={{
                        color: '#94A3B8',
                        fontSize: '13px',
                        fontWeight: 500,
                        lineHeight: '1.3',
                      }}
                      className="w-full text-left"
                    >
                      Buat menu baru yang siap dijual
                    </span>
                  </div>
                </div>

                {/* Right Chevron (20x20 container, 5x10 stroke #979797) */}
                <div
                  style={{ width: '20px', height: '20px' }}
                  className="flex items-center justify-center shrink-0"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M7.5 5L12.5 10L7.5 15"
                      stroke="#979797"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </button>
            </div>

            {/* Batal Button (height: 48px, #F2F2F2, rounded-full, #979797 14px bold) */}
            <button
              type="button"
              onClick={() => setShowAddSheet(false)}
              style={{
                height: '48px',
                borderRadius: '9999px',
                backgroundColor: '#F2F2F2',
                color: '#979797',
                fontSize: '14px',
                fontWeight: 700,
                border: 'none',
              }}
              className="w-full flex items-center justify-center cursor-pointer active:scale-[0.99] transition-all"
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
