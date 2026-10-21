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

  const handleCardClick = (cat) => {
    if (typeof window.openEditCategory === 'function') {
      window.openEditCategory(cat.id);
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo(`catalog/categories/${encodeURIComponent(cat.id)}/edit`);
    } else {
      window.location.hash = `#catalog/categories/${encodeURIComponent(cat.id)}/edit`;
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

      const res = await fetch(`/api/v1/admin/categories/${encodeURIComponent(cat.id)}/toggle`, {
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
          if (idx >= 0) window.state.categories[idx] = data.category;
        }
      }
    } catch (err) {
      console.error('[CategoriesPage] Toggle error:', err);
      // Revert optimistic update
      setCategories((prev) =>
        prev.map((c) => (String(c.id) === String(cat.id) ? { ...c, is_active: prevActive ? 1 : 0 } : c))
      );
      if (typeof window.showToast === 'function') {
        window.showToast('❌ ' + err.message);
      }
    } finally {
      setTogglingId(null);
    }
  };

  const getCategoryDescription = (cat) => {
    const catMenus = menus.filter((m) => {
      const menuCatId = m.category_id || (m.category && m.category.id);
      return String(menuCatId || '') === String(cat.id);
    });
    if (catMenus.length > 0) {
      const names = catMenus
        .map((m) => m.title_name || m.package_name || m.title || m.name || '')
        .filter(Boolean);
      if (names.length > 0) {
        return names.join(', ');
      }
    }
    return cat.description || 'Belum ada menu';
  };

  const filteredCategories = categories.filter((cat) => {
    if (leavingId === cat.id) return true;
    const isAct = cat.is_active !== 0 && cat.is_active !== null;
    return filter === 'ACTIVE' ? isAct : !isAct;
  });

  return (
    <div id="modern-categories-page-root" className="w-full max-w-[390px] mx-auto px-4 py-2 font-sans">
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
          Kategori
        </h1>
      </div>

      {/* 2. Main Card Container (358px wide, rounded 14px, outline #CBD5E1) */}
      <div className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-4">
        {/* Control Row: Filter Pills (Aktif/Nonaktif) + Add Button (+) */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5">
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

          {filter === 'ACTIVE' && (
            <button
              type="button"
              onClick={handleAddCategory}
              aria-label="Tambah Kategori"
              className="w-[30px] h-[30px] rounded-full bg-[#0F172A] hover:bg-slate-800 active:scale-95 text-white flex items-center justify-center cursor-pointer transition-all border-none shrink-0 p-0"
            >
              <img
                src="/owner/assets/icons/at-icons_plus.svg"
                alt="Tambah"
                className="w-[14px] h-[13px] shrink-0"
              />
            </button>
          )}
        </div>

        {/* Category List */}
        {loading ? (
          <div className="py-10 text-center text-sm text-[#94A3B8]">Memuat kategori...</div>
        ) : filteredCategories.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#94A3B8]">
            {filter === 'ACTIVE' ? 'Belum ada kategori aktif' : 'Belum ada kategori nonaktif'}
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full">
            {filteredCategories.map((cat) => {
              const isCatActive = cat.is_active !== 0 && cat.is_active !== null;
              return (
                <div
                  key={cat.id}
                  onClick={() => handleCardClick(cat)}
                  className="w-full p-4 rounded-[12px] bg-white hub-inset-stroke hub-card flex items-center gap-4 active:scale-[0.99] transition-all cursor-pointer"
                >
                  {/* Icon 45x45 green */}
                  <div className="w-[45px] h-[45px] rounded-[10px] bg-[#34A853] flex items-center justify-center shrink-0 overflow-hidden relative">
                    {cat.image_url || cat.image ? (
                      <img src={cat.image_url || cat.image} alt={cat.name} className="w-full h-full object-cover" />
                    ) : (
                      <img
                        src="/owner/assets/icons/bxs_category.svg"
                        alt=""
                        className="w-[22px] h-[22px] filter brightness-0 invert block"
                      />
                    )}
                  </div>

                  {/* Title & Description */}
                  <div className="flex-1 min-w-0 flex flex-col items-start gap-1">
                    <span className="font-bold text-[#0F172A] text-base leading-snug truncate w-full text-left">
                      {cat.name}
                    </span>
                    <span className="font-medium text-[#94A3B8] text-[13px] leading-snug truncate w-full text-left">
                      {getCategoryDescription(cat)}
                    </span>
                  </div>

                  {/* Toggle SVG Button (Red / Green Toggle SVG uploaded by user) */}
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
                      className="w-[13px] h-[13px] block"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
