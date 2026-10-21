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
        fetch('/admin/categories', { headers }),
        fetch('/admin/menus', { headers }).catch(() => null)
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
      // Fallback to window.state if available
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
    // Check if window already has cached state
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

    // Optimistic update
    setCategories((prev) =>
      prev.map((c) => (String(c.id) === String(cat.id) ? { ...c, is_active: nextActive ? 1 : 0 } : c))
    );
    setTogglingId(cat.id);

    try {
      const token = getAuthToken();
      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/admin/categories/${encodeURIComponent(cat.id)}/toggle`, {
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
      return catMenus.map((m) => m.title || m.name || '').filter(Boolean).join(', ');
    }
    return cat.description || 'Belum ada menu';
  };

  const filteredCategories = categories.filter((cat) => {
    const isAct = cat.is_active !== 0 && cat.is_active !== null;
    return filter === 'ACTIVE' ? isAct : !isAct;
  });

  return (
    <div id="modern-categories-page-root" className="w-full max-w-[390px] mx-auto px-4 py-2 font-sans">
      {/* 1. Header Row (Back Button + Title) */}
      <div className="flex items-center gap-4 mb-4 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali ke Katalog & Menu"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-[#0F172A] hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <svg width="22" height="19" viewBox="0 0 22 19" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M19 9.5H3M3 9.5L10.5 2M3 9.5L10.5 17"
              stroke="#0F172A"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h1 className="font-bold text-[#0F172A] text-lg tracking-[0] leading-[18px] whitespace-nowrap m-0">
          Kategori
        </h1>
      </div>

      {/* 2. Main Card Container (358px wide, rounded 14px, outline #CBD5E1) */}
      <div className="w-full rounded-[14px] p-4 bg-white border border-[#CBD5E1] flex flex-col gap-4">
        {/* Control Row: Filter Pills (Aktif/Nonaktif) + Add Button (+) */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('ACTIVE')}
              className={`w-[75px] h-[30px] rounded-[20px] text-[11px] font-bold cursor-pointer transition-all flex items-center justify-center border-none ${
                filter === 'ACTIVE'
                  ? 'bg-[#0F172A] text-white shadow-xs'
                  : 'bg-white text-[#94A3B8] border border-solid border-[#CBD5E1]'
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
                  : 'bg-white text-[#94A3B8] border border-solid border-[#CBD5E1]'
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
              className="w-[30px] h-[30px] rounded-full bg-[#0F172A] hover:bg-slate-800 active:scale-95 text-white flex items-center justify-center cursor-pointer transition-all border-none shrink-0"
            >
              <svg width="14" height="13" viewBox="0 0 14 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M7 0.8125C7.23206 0.8125 7.45462 0.898102 7.61872 1.05048C7.78281 1.20285 7.875 1.40951 7.875 1.625V5.6875H12.25C12.4821 5.6875 12.7046 5.7731 12.8687 5.92548C13.0328 6.07785 13.125 6.28451 13.125 6.5C13.125 6.71549 13.0328 6.92215 12.8687 7.07452C12.7046 7.2269 12.4821 7.3125 12.25 7.3125H7.875V11.375C7.875 11.5905 7.78281 11.7972 7.61872 11.9495C7.45462 12.1019 7.23206 12.1875 7 12.1875C6.76794 12.1875 6.54538 12.1019 6.38128 11.9495C6.21719 11.7972 6.125 11.5905 6.125 11.375V7.3125H1.75C1.51794 7.3125 1.29538 7.2269 1.13128 7.07452C0.967187 6.92215 0.875 6.71549 0.875 6.5C0.875 6.28451 0.967187 6.07785 1.13128 5.92548C1.29538 5.7731 1.51794 5.6875 1.75 5.6875H6.125V1.625C6.125 1.40951 6.21719 1.20285 6.38128 1.05048C6.54538 0.898102 6.76794 0.8125 7 0.8125Z"
                  fill="white"
                />
              </svg>
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
                  className="w-full p-4 rounded-[12px] border border-[#CBD5E1] flex items-center gap-4 bg-white hover:border-slate-400 active:scale-[0.99] transition-all cursor-pointer"
                >
                  {/* Icon 45x45 green */}
                  <div className="w-[45px] h-[45px] rounded-[10px] bg-[#34A853] flex items-center justify-center shrink-0 overflow-hidden relative">
                    {cat.image_url || cat.image ? (
                      <img src={cat.image_url || cat.image} alt={cat.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-[25px] h-[25px] flex items-center justify-center">
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="3" width="7" height="7"></rect>
                          <rect x="14" y="3" width="7" height="7"></rect>
                          <rect x="14" y="14" width="7" height="7"></rect>
                          <rect x="3" y="14" width="7" height="7"></rect>
                        </svg>
                      </div>
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

                  {/* Toggle Switch */}
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
                    className={`w-[35px] h-[21px] rounded-full p-0 relative transition-all cursor-pointer border-none shrink-0 ${
                      isCatActive
                        ? 'bg-[#00A637] shadow-[-1px_2px_5px_rgba(0,0,0,0.15)] outline outline-[0.5px] outline-[#009A33]'
                        : 'bg-slate-300 outline outline-[0.5px] outline-slate-400'
                    }`}
                  >
                    <span
                      className={`w-[21px] h-[21px] rounded-full bg-white shadow-[0px_4px_15px_rgba(0,0,0,0.15)] block transition-transform ${
                        isCatActive ? 'translate-x-[14px]' : 'translate-x-0'
                      }`}
                    />
                  </button>

                  {/* Chevron Right */}
                  <div className="w-[13px] h-[13px] flex items-center justify-center shrink-0 -mr-1">
                    <svg width="7" height="11" viewBox="0 0 7 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M1.5 1.5L5.5 5.5L1.5 9.5"
                        stroke="#303030"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
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
