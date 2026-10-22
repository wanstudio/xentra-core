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
  const [initialName, setInitialName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [initialIsActive, setInitialIsActive] = useState(true);
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
          const foundName = found.name || '';
          const foundActive = found.is_active !== 0 && found.is_active !== false && found.is_active !== '0';
          setName(foundName);
          setInitialName(foundName);
          setDescription(found.description || '');
          setIsActive(foundActive);
          setInitialIsActive(foundActive);
        }
      }

      try {
        const token = getAuthToken();
        const headers = { 'Accept': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const catRes = await fetch('/api/v1/admin/categories', { headers }).catch(() => null);

        if (catRes && catRes.ok) {
          const catData = await catRes.json().catch(() => null);
          if (catData && catData.success && Array.isArray(catData.categories)) {
            if (window.state) window.state.categories = catData.categories;
            if (isEdit) {
              const found = catData.categories.find((c) => c && String(c.id) === String(categoryId));
              if (found && isMounted) {
                const foundName = found.name || '';
                const foundActive = found.is_active !== 0 && found.is_active !== false && found.is_active !== '0';
                setName(foundName);
                setInitialName(foundName);
                setDescription(found.description || '');
                setIsActive(foundActive);
                setInitialIsActive(foundActive);
              }
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
    const fallbackRoute = isEdit
      ? `catalog/categories/${encodeURIComponent(categoryId)}`
      : 'catalog/categories';
    if (typeof window.navigateTo === 'function') {
      window.navigateTo(fallbackRoute);
      return;
    }
    window.location.hash = `#${fallbackRoute}`;
  };

  const trimmedName = name.trim();
  const canSubmit = isEdit
    ? Boolean(trimmedName) && (trimmedName !== initialName.trim() || isActive !== initialIsActive)
    : Boolean(trimmedName);

  const handleSave = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!trimmedName || saving) return;

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
          is_active: isActive ? 1 : 0,
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
    if (!isEdit || deleting) return;
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

      if (typeof window.navigateTo === 'function') {
        window.navigateTo('catalog/categories');
      } else {
        window.location.hash = '#catalog/categories';
      }
    } catch (err) {
      console.error('[CategoryEditorPage] Delete error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('❌ ' + (err.message || 'Gagal menghapus kategori.'));
      }
    } finally {
      setDeleting(false);
    }
  };

  const titleText = isEdit ? 'Edit kategori' : 'Tambah kategori';

  return (
    <div
      id="modern-category-editor-page-root"
      style={{
        boxSizing: 'border-box',
        paddingBottom: '150px'
      }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow and Title (Identical spacing and sizing to CatalogSubHub & CategoriesPage) */}
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

      {/* 2. Form Cards Stack (gap-4 = 16px) */}
      {loading ? (
        <div className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke py-10 text-center text-sm text-[#94A3B8]">
          Memuat data kategori...
        </div>
      ) : (
        <form onSubmit={handleSave} className="w-full flex flex-col gap-4 m-0 p-0">
          {/* Card 1: Nama kategori */}
          <div className="w-full p-4 bg-white rounded-[14px] hub-inset-stroke flex flex-col items-end gap-3.5">
            <div className="w-full flex flex-col items-start gap-1 text-left">
              <label htmlFor="cat-name-input" className="w-full text-base font-bold text-[#0F172A] leading-snug">
                Nama kategori <span className="text-[#FA3E3E] font-bold">*</span>
              </label>
              <p className="w-full text-[13px] font-medium text-[#94A3B8] leading-snug m-0">
                Berikan nama kategori yang singkat, nama kategori bisa sangat membantu dalam mencari menu sesuai kelompok atau jenisnya
              </p>
            </div>

            <div className="w-full h-12 relative rounded-[14px] bg-white hub-inset-stroke hub-search overflow-hidden flex items-center transition-all">
              <input
                id="cat-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 150))}
                placeholder="Cth. Makanan Berat"
                maxLength={150}
                required
                className="w-full h-full px-4 bg-transparent border-none outline-none font-medium text-[#0F172A] text-[13px] placeholder:text-[#94A3B8]"
              />
            </div>

            <div className="text-[#94A3B8] text-[10px] font-normal leading-none">
              {name.length}/150
            </div>
          </div>

          {/* Card 2: Aktifkan kategori */}
          <div className="w-full p-4 bg-white rounded-[14px] hub-inset-stroke flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0 flex flex-col items-start gap-1 text-left">
              <span className="w-full text-base font-bold text-black leading-snug">
                Aktifkan kategori
              </span>
              <span className="w-full text-[13px] font-medium text-[#94A3B8] leading-snug">
                Kategori menu yang aktif akan terlihat
              </span>
            </div>

            {/* Toggle Button */}
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              aria-label="Aktifkan kategori"
              onClick={() => setIsActive((prev) => !prev)}
              className="p-0 border-none bg-transparent cursor-pointer shrink-0 flex items-center justify-center transition-transform active:scale-95"
            >
              <img
                src={isActive ? '/owner/assets/icons/green-toggle.svg' : '/owner/assets/icons/red-toggle.svg'}
                alt={isActive ? 'Aktif' : 'Nonaktif'}
                className="w-[45px] h-[31px] object-contain select-none pointer-events-none block"
              />
            </button>
          </div>

          {/* Optional Delete Button when in Edit Mode */}
          {isEdit && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="w-full h-11 rounded-[14px] border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs cursor-pointer transition-all active:scale-98 flex items-center justify-center disabled:opacity-50"
            >
              {deleting ? 'Menghapus kategori...' : 'Hapus kategori'}
            </button>
          )}
        </form>
      )}

      {/* 3. Fixed Bottom Action Bar (Matching Figma Mockup: rounded-t-[20px], top shadow, 48px pill button) */}
      <div
        id="modern-category-editor-bottom-bar"
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
          boxSizing: 'border-box'
        }}
        className="w-full bg-white rounded-t-[20px] z-[200]"
      >
        <div className="w-full max-w-lg mx-auto">
          <button
            type="button"
            disabled={saving || !canSubmit}
            onClick={handleSave}
            style={{
              width: '100%',
              height: '48px',
              borderRadius: '9999px',
              border: 'none',
              outline: 'none',
              backgroundColor: canSubmit ? '#00A637' : '#F2F2F2',
              color: canSubmit ? '#FFFFFF' : '#979797',
              fontWeight: 700,
              fontSize: '14px',
              cursor: canSubmit && !saving ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease'
            }}
            className={canSubmit ? 'active:scale-98 hover:bg-emerald-600' : ''}
          >
            {saving ? 'Menyimpan...' : (isEdit ? 'Simpan' : 'Buat kategori')}
          </button>
        </div>
      </div>
    </div>
  );
}
