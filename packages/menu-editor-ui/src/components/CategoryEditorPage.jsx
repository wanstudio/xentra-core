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
  const [showDeleteModal, setShowDeleteModal] = useState(false);

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

  const handleDeleteClick = () => {
    if (!isEdit || deleting) return;
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!isEdit || deleting) return;

    setDeleting(true);
    try {
      const token = getAuthToken();
      const headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/categories/${encodeURIComponent(categoryId)}?cascade=1`, {
        method: 'DELETE',
        headers,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menghapus kategori.');
      }

      setShowDeleteModal(false);

      if (typeof window.showToast === 'function') {
        window.showToast(`✅ Kategori "${name}" berhasil dihapus.`);
      }

      if (window.state && Array.isArray(window.state.categories)) {
        window.state.categories = window.state.categories.filter((c) => String(c.id) !== String(categoryId));
      }
      if (window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.menus)) {
        window._ownerMasterMenuState.menus = window._ownerMasterMenuState.menus.filter((m) => {
          const cId = m && (m.category_id || (m.category && m.category.id));
          return String(cId || '') !== String(categoryId);
        });
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

  const titleText = isEdit ? 'Ubah kategori' : 'Tambah kategori';

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
      <div className="flex items-center gap-3 mb-6">
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
                className={`w-full h-full px-4 bg-transparent border-none outline-none text-[#0F172A] placeholder:text-[#94A3B8] placeholder:font-medium placeholder:text-[13px] ${
                  name.length > 0 ? 'font-bold text-base' : 'font-medium text-[13px]'
                }`}
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

          {/* Card 3: Hapus kategori (Only shown when in Edit Mode) */}
          {isEdit && (
            <div className="w-full p-4 bg-white rounded-[14px] hub-inset-stroke flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0 flex flex-col items-start gap-1 text-left">
                <span className="w-full text-base font-bold text-black leading-snug">
                  Hapus kategori
                </span>
                <span className="w-full text-[13px] font-medium text-[#94A3B8] leading-snug">
                  Jika dihapus, kategori dan seluruh isi menunya akan ikut terhapus
                </span>
              </div>

              <button
                type="button"
                onClick={handleDeleteClick}
                disabled={deleting}
                style={{
                  width: '70px',
                  height: '30px',
                  borderRadius: '20px',
                  backgroundColor: 'transparent',
                  boxShadow: 'inset 0 0 0 1px #FA3E3E',
                  border: 'none',
                  outline: 'none',
                  color: '#FA3E3E',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="active:scale-95 transition-transform shrink-0 disabled:opacity-50"
              >
                {deleting ? '...' : 'Hapus'}
              </button>
            </div>
          )}
        </form>
      )}

      {/* 2b. Custom Delete Confirmation Modal (Matching Figma Mockup: 353x170px, rounded 16px, trash icon badge, Batal & Hapus buttons) */}
      {showDeleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-cat-modal-title"
          onClick={() => {
            if (!deleting) setShowDeleteModal(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.35)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '353px',
              minHeight: '170px',
              paddingLeft: '17px',
              paddingRight: '17px',
              paddingTop: '18px',
              paddingBottom: '18px',
              backgroundColor: '#FFFFFF',
              boxShadow: '0px 2px 10px rgba(0, 0, 0, 0.20)',
              borderRadius: '16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
              gap: '17px',
              boxSizing: 'border-box',
            }}
          >
            {/* Title */}
            <div
              id="delete-cat-modal-title"
              style={{
                color: '#0F172A',
                fontSize: '18px',
                fontWeight: 700,
                lineHeight: '18px',
              }}
            >
              Hapus kategori
            </div>

            {/* Body Row: 40x40 Trash Icon Box + Message */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: '12px',
                width: '100%',
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  boxShadow: 'inset 0 0 0 1px rgba(250, 62, 62, 0.30)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 17 17"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M2.125 4.25H3.54167H14.875"
                    stroke="#FA3E3E"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5.66666 4.25008V2.83341C5.66666 2.45769 5.81591 2.09736 6.08159 1.83168C6.34727 1.566 6.7076 1.41675 7.08332 1.41675H9.91666C10.2924 1.41675 10.6527 1.566 10.9184 1.83168C11.1841 2.09736 11.3333 2.45769 11.3333 2.83341V4.25008M13.4583 4.25008V14.1667C13.4583 14.5425 13.3091 14.9028 13.0434 15.1685C12.7777 15.4342 12.4174 15.5834 12.0417 15.5834H4.95832C4.5826 15.5834 4.22227 15.4342 3.95659 15.1685C3.69091 14.9028 3.54166 14.5425 3.54166 14.1667V4.25008H13.4583Z"
                    stroke="#FA3E3E"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7.08334 7.79175V12.0417"
                    stroke="#FA3E3E"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9.91666 7.79175V12.0417"
                    stroke="#FA3E3E"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <div
                style={{
                  color: '#737373',
                  fontSize: '13px',
                  fontWeight: 500,
                  lineHeight: '1.35',
                  textAlign: 'left',
                  wordBreak: 'break-word',
                }}
              >
                <div>Hapus kategori “{name || initialName}”?</div>
                <div>Tindakan ini tidak dapat dibatalkan.</div>
              </div>
            </div>

            {/* Action Buttons Row: Batal & Hapus */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: '10px',
                width: '100%',
              }}
            >
              <button
                type="button"
                disabled={deleting}
                onClick={() => setShowDeleteModal(false)}
                style={{
                  flex: '1 1 0',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: '#F3F6FD',
                  boxShadow: 'inset 0 0 0 1px #D9D9D9',
                  border: 'none',
                  outline: 'none',
                  color: '#979797',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="active:scale-[0.98] transition-transform"
              >
                Batal
              </button>

              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                style={{
                  flex: '1 1 0',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(250, 62, 62, 0.10)',
                  boxShadow: 'inset 0 0 0 1px #FA3E3E',
                  border: 'none',
                  outline: 'none',
                  color: '#FA3E3E',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="active:scale-[0.98] transition-transform"
              >
                {deleting ? 'Menghapus...' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
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
