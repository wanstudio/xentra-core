import React, { useState, useEffect } from 'react';

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function CategoryEditorPage({ categoryId, onBack, onSaved }) {
  const isEdit = !!categoryId;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryMenus, setCategoryMenus] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      // Pre-fill from memory if available
      if (isEdit && window.state && Array.isArray(window.state.categories)) {
        const found = window.state.categories.find((c) => c && String(c.id) === String(categoryId));
        if (found && isMounted) {
          setName(found.name || '');
          setDescription(found.description || '');
        }
      }

      if (isEdit && window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.menus)) {
        const related = window._ownerMasterMenuState.menus.filter((m) => {
          if (!m) return false;
          const mCatId = m.category_id || (m.category && m.category.id);
          return String(mCatId || '') === String(categoryId || '');
        });
        if (isMounted) setCategoryMenus(related);
      }

      try {
        const token = getAuthToken();
        const headers = { 'Accept': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const [catRes, menuRes] = await Promise.all([
          fetch('/api/v1/admin/categories', { headers }).catch(() => null),
          fetch('/api/v1/admin/menus', { headers }).catch(() => null),
        ]);

        if (catRes && catRes.ok) {
          const catData = await catRes.json().catch(() => null);
          if (catData && catData.success && Array.isArray(catData.categories)) {
            if (window.state) window.state.categories = catData.categories;
            if (isEdit) {
              const found = catData.categories.find((c) => c && String(c.id) === String(categoryId));
              if (found && isMounted) {
                setName(found.name || '');
                setDescription(found.description || '');
              }
            }
          }
        }

        if (menuRes && menuRes.ok) {
          const menuData = await menuRes.json().catch(() => null);
          if (menuData && menuData.success && Array.isArray(menuData.menus)) {
            if (window._ownerMasterMenuState) window._ownerMasterMenuState.menus = menuData.menus;
            if (isMounted) {
              const related = isEdit ? menuData.menus.filter((m) => {
                if (!m) return false;
                const mCatId = m.category_id || (m.category && m.category.id);
                return String(mCatId || '') === String(categoryId || '');
              }) : [];
              setCategoryMenus(related);
            }
          }
        }
      } catch (err) {
        console.error('[CategoryEditorPage] Load error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [categoryId, isEdit]);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof window.goBackFromCategoryEditor === 'function') {
      window.goBackFromCategoryEditor();
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/categories');
      return;
    }
    window.location.hash = '#catalog/categories';
  };

  const handleSave = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      if (typeof window.showToast === 'function') {
        window.showToast('❌ Nama kategori wajib diisi.');
      }
      return;
    }

    setSaving(true);
    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const endpoint = isEdit
        ? `/api/v1/admin/categories/${encodeURIComponent(categoryId)}`
        : '/api/v1/admin/categories';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers,
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan kategori.');
      }

      if (typeof window.showToast === 'function') {
        window.showToast(isEdit ? '✅ Kategori berhasil diperbarui.' : '✅ Kategori baru berhasil ditambahkan.');
      }

      // Update state in window if available
      if (window.state && Array.isArray(window.state.categories)) {
        if (isEdit) {
          const idx = window.state.categories.findIndex((c) => String(c.id) === String(categoryId));
          if (idx >= 0 && data.category) {
            window.state.categories[idx] = data.category;
          }
        } else if (data.category) {
          window.state.categories.push(data.category);
        }
      }

      if (typeof onSaved === 'function') {
        onSaved(data.category);
      } else {
        handleBack();
      }
    } catch (err) {
      console.error('[CategoryEditorPage] Save error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('❌ ' + (err.message || 'Gagal menyimpan kategori.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    const confirmDelete = window.confirm(`Hapus kategori "${name}"?\nTindakan ini tidak dapat dibatalkan.`);
    if (!confirmDelete) return;

    setDeleting(true);
    try {
      const token = getAuthToken();
      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/categories/${encodeURIComponent(categoryId)}`, {
        method: 'DELETE',
        headers,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menghapus kategori.');
      }

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Kategori "${name}" berhasil dihapus.`);
      }

      if (window.state && Array.isArray(window.state.categories)) {
        window.state.categories = window.state.categories.filter((c) => String(c.id) !== String(categoryId));
      }

      handleBack();
    } catch (err) {
      console.error('[CategoryEditorPage] Delete error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('❌ ' + (err.message || 'Gagal menghapus kategori.'));
      }
    } finally {
      setDeleting(false);
    }
  };

  const titleText = isEdit
    ? (name ? `Kategori: ${name}` : 'Edit Kategori')
    : 'Tambah Kategori';

  return (
    <div id="modern-category-editor-page-root" className="w-full max-w-[390px] mx-auto px-4 py-2 font-sans">
      {/* 1. Header with Back Arrow and Title (Identical spacing and sizing to CategoriesPage & CatalogSubHub) */}
      <div className="flex items-center gap-3 mb-6 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali ke Kategori"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain"
          />
        </button>
        <h1 className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0 truncate">
          {titleText}
        </h1>
      </div>

      {/* 2. Main Card Container (358px wide, rounded 14px, outline #CBD5E1) */}
      <div className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-5">
        {loading ? (
          <div className="py-10 text-center text-sm text-[#94A3B8]">Memuat data kategori...</div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-5 w-full m-0 p-0">
            {/* Field: Nama Kategori */}
            <div className="flex flex-col gap-1.5 w-full text-left">
              <label htmlFor="cat-name-input" className="font-bold text-[#0F172A] text-sm flex items-center gap-1">
                Nama Kategori <span className="text-red-500">*</span>
              </label>
              <input
                id="cat-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="contoh: Makanan Berat"
                maxLength={120}
                required
                className="w-full h-11 px-3.5 rounded-xl bg-white border border-[#CBD5E1] font-semibold text-slate-900 text-sm focus:outline-none focus:border-slate-800 placeholder:text-[#94A3B8] transition-colors"
              />
              <span className="text-[11px] text-[#94A3B8] mt-0.5">
                contohnya; Makanan Berat, Minuman Segar, Camilan, dsb
              </span>
            </div>

            {/* Field: Menu dalam Kategori Ini */}
            <div className="flex flex-col gap-1.5 w-full text-left">
              <label className="font-bold text-[#0F172A] text-sm">
                Menu dalam kategori ini
              </label>
              {categoryMenus && categoryMenus.length > 0 ? (
                <div className="flex flex-col gap-2 w-full max-h-48 overflow-y-auto pr-1">
                  {categoryMenus.map((m, idx) => {
                    if (!m) return null;
                    const mTitle = m.title_name || m.package_name || m.title || m.name || `Menu ${idx + 1}`;
                    return (
                      <div
                        key={m.id || idx}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-[#34A853] flex items-center justify-center shrink-0 overflow-hidden">
                            {m.image_url || m.image ? (
                              <img src={m.image_url || m.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <img
                                src="/owner/assets/icons/bxs_category.svg"
                                alt=""
                                className="w-4 h-4 filter brightness-0 invert block"
                              />
                            )}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold text-slate-900 text-xs truncate text-left">{mTitle}</span>
                            <span className="text-[10px] text-slate-400 font-medium text-left">Menu Komersial</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#94A3B8] leading-relaxed text-left">
                  {isEdit
                    ? 'Belum ada menu dalam kategori ini.'
                    : 'Kategori baru belum memiliki menu. Menu dapat ditambahkan melalui Menu Master setelah kategori disimpan.'}
                </div>
              )}
            </div>

            {/* Field: Catatan */}
            <div className="flex flex-col gap-1.5 w-full text-left">
              <label htmlFor="cat-desc-input" className="font-bold text-[#0F172A] text-sm">
                Catatan
              </label>
              <textarea
                id="cat-desc-input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tambahkan catatan untuk kategori ini..."
                className="w-full p-3 rounded-xl bg-white border border-[#CBD5E1] font-medium text-slate-800 text-sm focus:outline-none focus:border-slate-800 placeholder:text-[#94A3B8] resize-none transition-colors"
              />
            </div>

            {/* Bottom Actions (Matching Figma Editor Button Mockup) */}
            <div className="flex flex-col gap-2.5 w-full pt-1">
              {/* Row 1: Batal & Hapus (if edit) */}
              <div className="flex items-center gap-3 w-full">
                <button
                  type="button"
                  onClick={handleBack}
                  className={`${
                    isEdit ? 'flex-1' : 'w-full'
                  } h-11 rounded-xl border border-[#CBD5E1] bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm cursor-pointer transition-all active:scale-95 flex items-center justify-center`}
                >
                  Batal
                </button>
                {isEdit && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 h-11 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm cursor-pointer transition-all active:scale-95 flex items-center justify-center disabled:opacity-50"
                  >
                    {deleting ? 'Menghapus...' : 'Hapus'}
                  </button>
                )}
              </div>

              {/* Row 2: Simpan Kategori (Full width green button) */}
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="w-full h-11 rounded-xl bg-[#00A84F] hover:bg-[#009244] text-white font-bold text-sm cursor-pointer transition-all active:scale-95 flex items-center justify-center border-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Menyimpan...' : 'Simpan Kategori'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
