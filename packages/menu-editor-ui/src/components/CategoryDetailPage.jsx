import React, { useState, useEffect } from 'react';

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function formatRupiah(amount) {
  const num = Number(amount) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

export default function CategoryDetailPage({
  categoryId,
  onBack,
  onEditCategory,
  onAddMenu,
  onEditMenu,
  onSortMenus,
}) {
  const [category, setCategory] = useState(null);
  const [menus, setMenus] = useState([]);
  const [filter, setFilter] = useState('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);
  const [leavingId, setLeavingId] = useState(null);

  const loadData = async () => {
    try {
      // Seed from memory if available
      if (window.state && Array.isArray(window.state.categories)) {
        const found = window.state.categories.find((c) => c && String(c.id) === String(categoryId));
        if (found) setCategory(found);
      }
      if (window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.menus)) {
        const related = window._ownerMasterMenuState.menus
          .filter((m) => {
            if (!m) return false;
            const mCatId = m.category_id || (m.category && m.category.id);
            return String(mCatId || '') === String(categoryId || '');
          })
          .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
        if (related.length > 0) {
          setMenus(related);
          setLoading(false);
        }
      }

      const token = getAuthToken();
      const headers = { Accept: 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [catRes, menuRes] = await Promise.all([
        fetch('/api/v1/admin/categories', { headers }).catch(() => null),
        fetch('/api/v1/admin/menus', { headers }).catch(() => null),
      ]);

      if (catRes && catRes.ok) {
        const catData = await catRes.json().catch(() => null);
        if (catData && catData.success && Array.isArray(catData.categories)) {
          if (window.state) window.state.categories = catData.categories;
          const found = catData.categories.find((c) => c && String(c.id) === String(categoryId));
          if (found) setCategory(found);
        }
      }

      if (menuRes && menuRes.ok) {
        const menuData = await menuRes.json().catch(() => null);
        if (menuData && menuData.success && Array.isArray(menuData.menus)) {
          if (window._ownerMasterMenuState) window._ownerMasterMenuState.menus = menuData.menus;
          const related = menuData.menus
            .filter((m) => {
              if (!m) return false;
              const mCatId = m.category_id || (m.category && m.category.id);
              return String(mCatId || '') === String(categoryId || '');
            })
            .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
          setMenus(related);
        }
      }
    } catch (err) {
      console.error('[CategoryDetailPage] Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [categoryId]);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/categories');
      return;
    }
    window.location.hash = '#catalog/categories';
  };

  const handleEditCategoryClick = () => {
    if (typeof onEditCategory === 'function') {
      onEditCategory(categoryId);
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo(`catalog/categories/${encodeURIComponent(categoryId)}/edit`);
      return;
    }
    window.location.hash = `#catalog/categories/${encodeURIComponent(categoryId)}/edit`;
  };

  const handleAddMenuClick = () => {
    if (window._ownerMasterMenuState) {
      window._ownerMasterMenuState.preselectedCategoryId = categoryId;
      if (category && category.name) {
        window._ownerMasterMenuState.preselectedCategoryName = category.name;
      }
    }
    if (typeof onAddMenu === 'function') {
      onAddMenu(categoryId);
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/master-menus/new');
      return;
    }
    window.location.hash = '#catalog/master-menus/new';
  };

  const handleMenuCardClick = (menu) => {
    if (!menu || !menu.id) return;
    if (window._ownerMasterMenuState) {
      window._ownerMasterMenuState.preselectedCategoryId = categoryId;
      if (category && category.name) {
        window._ownerMasterMenuState.preselectedCategoryName = category.name;
      }
    }
    if (typeof onEditMenu === 'function') {
      onEditMenu(menu.id);
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo(`catalog/master-menus/${encodeURIComponent(menu.id)}/edit`);
      return;
    }
    window.location.hash = `#catalog/master-menus/${encodeURIComponent(menu.id)}/edit`;
  };

  const handleSortClick = () => {
    if (typeof onSortMenus === 'function') {
      onSortMenus(categoryId);
      return;
    }
    const targetRoute = `catalog/categories/${encodeURIComponent(categoryId)}/sort-menus`;
    if (typeof window.navigateTo === 'function') {
      window.navigateTo(targetRoute);
      return;
    }
    window.location.hash = `#${targetRoute}`;
  };

  const isMenuActive = (m) => {
    if (!m) return false;
    if (typeof m.status === 'string') {
      return m.status.toUpperCase() === 'ACTIVE';
    }
    return m.is_active !== 0 && m.is_active !== false && m.is_active !== null;
  };

  const getMenuTitle = (m) => {
    if (!m) return 'Menu';
    return m.title_name || m.package_name || m.title || m.name || 'Menu Tanpa Judul';
  };

  const getMenuCompositionSubtitle = (m) => {
    if (!m) return '';
    if (m.description && String(m.description).trim()) {
      return String(m.description).trim();
    }
    const list = Array.isArray(m.components)
      ? m.components
      : Array.isArray(m.items)
      ? m.items
      : [];
    if (list.length > 0) {
      const names = list
        .map((c) => c && (c.product_name || c.name || c.title))
        .filter(Boolean);
      if (names.length > 0) {
        return names.join(' + ');
      }
    }
    return m.sub_category_name || 'Menu komersial';
  };

  const getMenuPrice = (m) => {
    if (!m) return 'Rp0';
    const price =
      m.selling_price !== undefined
        ? m.selling_price
        : m.price !== undefined
        ? m.price
        : m.min_price || 0;
    return formatRupiah(price);
  };

  const getMenuImage = (m) => {
    if (!m) return '';
    return m.image_url || m.image || '';
  };

  const handleToggleMenu = async (menu) => {
    if (!menu || togglingId === menu.id) return;
    const prevActive = isMenuActive(menu);
    const nextActive = !prevActive;
    const nextStatus = nextActive ? 'ACTIVE' : 'ARCHIVED';

    setTogglingId(menu.id);
    setLeavingId(menu.id);

    // Optimistic UI update
    setMenus((prev) =>
      prev.map((m) =>
        m.id === menu.id
          ? { ...m, status: nextStatus, is_active: nextActive ? 1 : 0 }
          : m
      )
    );

    try {
      const token = getAuthToken();
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/menus/${encodeURIComponent(menu.id)}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengubah status menu.');
      }

      if (typeof window.showToast === 'function') {
        window.showToast(
          nextActive
            ? `✅ Menu "${getMenuTitle(menu)}" diaktifkan.`
            : `✅ Menu "${getMenuTitle(menu)}" dinonaktifkan.`
        );
      }

      if (window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.menus)) {
        window._ownerMasterMenuState.menus = window._ownerMasterMenuState.menus.map((m) =>
          m && String(m.id) === String(menu.id)
            ? { ...m, status: nextStatus, is_active: nextActive ? 1 : 0 }
            : m
        );
      }

      setTimeout(() => {
        setLeavingId((current) => (current === menu.id ? null : current));
        setTogglingId((current) => (current === menu.id ? null : current));
      }, 280);
    } catch (err) {
      console.error('[CategoryDetailPage] Toggle menu error:', err);
      setMenus((prev) =>
        prev.map((m) =>
          m.id === menu.id
            ? { ...m, status: prevActive ? 'ACTIVE' : 'ARCHIVED', is_active: prevActive ? 1 : 0 }
            : m
        )
      );
      setLeavingId(null);
      setTogglingId(null);
      if (typeof window.showToast === 'function') {
        window.showToast('❌ ' + (err.message || 'Gagal mengubah status menu.'));
      }
    }
  };

  const filteredMenus = menus.filter((m) => {
    const active = isMenuActive(m);
    if (filter === 'ACTIVE') {
      return active || leavingId === m.id;
    }
    return !active || leavingId === m.id;
  });

  const headerTitle = category && category.name ? category.name : 'Detail kategori';

  return (
    <div
      id="modern-category-detail-page-root"
      style={{
        boxSizing: 'border-box',
        paddingBottom: '150px',
      }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow and Category Name (Identical spacing and sizing to CatalogSubHub & CategoriesPage) */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali ke Kategori & Menu"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain"
          />
        </button>
        <h1 className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0 truncate">
          {headerTitle}
        </h1>
      </div>

      {/* 2. Main Card Container (358px wide, rounded 14px, inset stroke) */}
      <div className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-4">
        {/* Top Control Row: Filter Pills (Aktif / Nonaktif) + "Ubah" Category Button */}
        <div className="w-full flex items-center justify-between gap-2">
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

          {/* "Ubah" Button to open CategoryEditorPage */}
          <button
            type="button"
            onClick={handleEditCategoryClick}
            style={{
              width: '70px',
              height: '30px',
              borderRadius: '20px',
              backgroundColor: 'rgba(0, 166, 55, 0.10)',
              boxShadow: 'inset 0 0 0 1px #00A637',
              border: 'none',
              outline: 'none',
              color: '#00A637',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            className="active:scale-95 transition-transform shrink-0"
          >
            Ubah
          </button>
        </div>

        {/* Menus List inside this Category */}
        {loading ? (
          <div className="py-12 text-center text-sm text-[#94A3B8] font-medium">
            Memuat daftar menu...
          </div>
        ) : filteredMenus.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#94A3B8] font-medium">
            {filter === 'ACTIVE'
              ? 'Belum ada menu aktif dalam kategori ini'
              : 'Belum ada menu nonaktif dalam kategori ini'}
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full">
            {filteredMenus.map((menu) => {
              const active = isMenuActive(menu);
              const imgUrl = getMenuImage(menu);
              const titleText = getMenuTitle(menu);
              const subtitleText = getMenuCompositionSubtitle(menu);
              const priceText = getMenuPrice(menu);

              return (
                <div
                  key={menu.id}
                  onClick={() => handleMenuCardClick(menu)}
                  className="w-full p-4 rounded-[12px] bg-white hub-inset-stroke hub-card flex items-center justify-between gap-[15px] active:scale-[0.99] transition-all cursor-pointer"
                >
                  {/* Left: 71x71 Thumbnail + Text Column */}
                  <div className="flex items-start gap-[15px] flex-1 min-w-0">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={titleText}
                        className="w-[71px] h-[71px] rounded-[10px] object-cover shrink-0 bg-slate-100 block"
                      />
                    ) : (
                      <div className="w-[71px] h-[71px] rounded-[10px] bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
                        <img
                          src="/owner/assets/icons/reicon_food-tray-filled.svg"
                          alt=""
                          className="w-7 h-7 opacity-30 object-contain"
                        />
                      </div>
                    )}

                    <div className="flex-1 min-w-0 flex flex-col items-start gap-2 text-left">
                      <div className="w-full text-[#0F172A] text-base font-bold leading-snug break-words">
                        {titleText}
                      </div>
                      <div className="w-full text-[#94A3B8] text-[13px] font-medium leading-snug break-words">
                        {subtitleText}
                      </div>
                      <div className="text-[#0F172A] text-[13px] font-bold leading-snug">
                        {priceText}
                      </div>
                    </div>
                  </div>

                  {/* Right: Toggle Switch */}
                  <div className="flex flex-col items-end justify-center shrink-0">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      aria-label={`Ubah status ${titleText}`}
                      disabled={togglingId === menu.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleMenu(menu);
                      }}
                      className="p-0 border-none bg-transparent cursor-pointer shrink-0 flex items-center justify-center transition-transform active:scale-95"
                    >
                      <img
                        src={
                          active
                            ? '/owner/assets/icons/green-toggle.svg'
                            : '/owner/assets/icons/red-toggle.svg'
                        }
                        alt={active ? 'Status Aktif' : 'Status Nonaktif'}
                        className="w-[45px] h-[31px] object-contain select-none pointer-events-none block"
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Fixed Bottom Action Bar: Urutkan & Tambah */}
      <div
        id="modern-category-detail-bottom-bar"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          width: '100%',
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          <button
            type="button"
            onClick={handleSortClick}
            style={{
              flex: 1,
              height: '48px',
              borderRadius: '9999px',
              border: '1px solid #00A637',
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
              transition: 'all 0.15s ease',
            }}
            className="active:scale-98"
          >
            Urutkan
          </button>
          <button
            type="button"
            onClick={handleAddMenuClick}
            style={{
              flex: 1,
              height: '48px',
              borderRadius: '9999px',
              border: '1px solid #00A637',
              outline: 'none',
              backgroundColor: '#00A637',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            className="active:scale-98"
          >
            Tambah
          </button>
        </div>
      </div>
    </div>
  );
}
