import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import DeleteConfirmationModal from './DeleteConfirmationModal';

const FONT = "'Plus Jakarta Sans', sans-serif";

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function BranchEditorPage({ branchId = null, onBack, onSaved, onNavigate }) {
  const isEdit = Boolean(branchId);

  // Form Fields
  const [name, setName] = useState('');
  const [addressText, setAddressText] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [isOpenOverride, setIsOpenOverride] = useState(true);
  const [isOnlinePaused, setIsOnlinePaused] = useState(false);
  const [isDeliveryActive, setIsDeliveryActive] = useState(true);
  const [isPickupActive, setIsPickupActive] = useState(true);

  // Delivery Settings
  const [maxRadiusKm, setMaxRadiusKm] = useState('10');
  const [pricePerKm, setPricePerKm] = useState('3000');
  const [freeDeliveryKm, setFreeDeliveryKm] = useState('1');

  // Loading & Action states
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch branch details if in Edit Mode
  useEffect(() => {
    let isMounted = true;

    async function fetchBranchDetail() {
      if (!isEdit) return;

      try {
        const token = getAuthToken();
        const headers = { 'Accept': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/v1/admin/branches/${encodeURIComponent(branchId)}?_t=${Date.now()}`, {
          headers,
          cache: 'no-store',
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.success && data.branch && isMounted) {
            const b = data.branch;
            setName(b.name || '');
            setAddressText(b.address_text || '');
            setWhatsappNumber(b.whatsapp_number || '');
            setPhone(b.phone || '');
            setIsOpenOverride(b.is_open_override === 1 || b.is_open_override == null);
            setIsOnlinePaused(b.is_online_paused === 1);
            setIsDeliveryActive(b.is_delivery_active === 1 || b.is_delivery_active == null);
            setIsPickupActive(b.is_pickup_active === 1 || b.is_pickup_active == null);

            setMaxRadiusKm(String(b.max_radius_km ?? 10));
            setPricePerKm(String(b.price_per_km ?? 3000));
            setFreeDeliveryKm(String(b.free_delivery_km ?? 1));
          }
        }
      } catch (err) {
        console.error('[BranchEditorPage] Fetch error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchBranchDetail();

    return () => {
      isMounted = false;
    };
  }, [isEdit, branchId]);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof onNavigate === 'function') {
      onNavigate('branches', { history: 'replace' });
      return;
    }
    try {
      window.history.replaceState({ xentraRoute: 'branches' }, '', '#branches');
      window.dispatchEvent(new Event('hashchange'));
    } catch (_) {
      window.location.hash = '#branches';
    }
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setErrorMessage('');

    const cleanName = name.trim();
    const cleanWa = whatsappNumber.trim();

    if (!cleanName) {
      setErrorMessage('Nama cabang wajib diisi.');
      return;
    }

    if (!cleanWa) {
      setErrorMessage('Nomor WhatsApp Business wajib diisi (misal: 081234567890).');
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

      const payload = {
        name: cleanName,
        address_text: addressText.trim(),
        whatsapp_number: cleanWa,
        phone: phone.trim() || cleanWa,
        is_open_override: isOpenOverride ? 1 : 0,
        is_online_paused: isOnlinePaused ? 1 : 0,
        is_delivery_active: isDeliveryActive ? 1 : 0,
        is_pickup_active: isPickupActive ? 1 : 0,
        max_radius_km: Number(maxRadiusKm) || 10,
        price_per_km: Number(pricePerKm) || 3000,
        free_delivery_km: Number(freeDeliveryKm) || 0,
      };

      const url = isEdit
        ? `/api/v1/admin/branches/${encodeURIComponent(branchId)}`
        : '/api/v1/admin/branches';
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan data cabang.');
      }

      if (typeof window.showToast === 'function') {
        window.showToast(isEdit ? '✓ Perubahan cabang berhasil disimpan' : '✓ Cabang baru berhasil didaftarkan');
      }

      if (typeof onSaved === 'function') {
        onSaved();
      } else {
        handleBack();
      }
    } catch (err) {
      console.error('[BranchEditorPage] Save error:', err);
      setErrorMessage(err.message || 'Terjadi kesalahan saat menyimpan cabang.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!isEdit || deleting) return;
    setDeleting(true);

    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/branches/${encodeURIComponent(branchId)}`, {
        method: 'DELETE',
        headers,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menghapus cabang.');
      }

      setShowDeleteModal(false);

      if (typeof window.showToast === 'function') {
        window.showToast('✓ Cabang berhasil dihapus');
      }

      if (typeof onSaved === 'function') {
        onSaved();
      } else {
        handleBack();
      }
    } catch (err) {
      console.error('[BranchEditorPage] Delete error:', err);
      alert(err.message || 'Gagal menghapus cabang.');
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
    }
  };

  return (
    <div
      id="branch-editor-page-container"
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
            {isEdit ? 'Ubah Cabang' : 'Tambah Cabang'}
          </h1>
          <p className="text-xs text-slate-500 m-0 mt-0.5">
            {isEdit ? 'Perbarui data outlet, jam buka, dan ongkir' : 'Daftarkan outlet baru untuk brand Anda'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3 py-16 items-center justify-center text-slate-400 text-xs">
          <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-800 rounded-full animate-spin"></div>
          <span>Memuat detail cabang...</span>
        </div>
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {errorMessage}
            </div>
          )}

          {/* Card 1: Informasi Utama Cabang */}
          <div className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-3.5 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 m-0">Informasi Cabang</h2>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Nama Cabang <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Cabang Tebet"
                className="w-full h-10 px-3 text-xs rounded-xl border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Nomor WhatsApp Business <span className="text-rose-500">*</span>
              </label>
              <input
                type="tel"
                required
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="Contoh: 081234567890"
                className="w-full h-10 px-3 text-xs rounded-xl border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Nomor kontak resmi untuk pesanan online dan koordinasi operasional.
              </span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Nomor Telepon Kasir / Toko (Opsional)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Nomor telepon darat atau hotline"
                className="w-full h-10 px-3 text-xs rounded-xl border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Alamat Lengkap
              </label>
              <textarea
                rows={3}
                value={addressText}
                onChange={(e) => setAddressText(e.target.value)}
                placeholder="Alamat jalan, nomor ruko, kelurahan, kecamatan..."
                className="w-full p-3 text-xs rounded-xl border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 resize-none font-sans"
              />
            </div>
          </div>

          {/* Card 2: Status Operasional & Layanan */}
          <div className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-3.5 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 m-0">Status &amp; Layanan Gerai</h2>

            {/* Toggle 1: Status Buka / Tutup */}
            <div className="flex items-center justify-between py-1">
              <div>
                <span className="block text-xs font-bold text-slate-800">
                  Status Operasional Toko
                </span>
                <span className="text-[11px] text-slate-400">
                  {isOpenOverride ? '🟢 Toko Buka dan menerima order' : '🔴 Toko Tutup Sementara'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isOpenOverride}
                onClick={() => setIsOpenOverride((prev) => !prev)}
                className="p-0 border-none bg-transparent cursor-pointer shrink-0 transition-transform active:scale-95"
              >
                <img
                  src={isOpenOverride ? '/owner/assets/icons/green-toggle.svg' : '/owner/assets/icons/red-toggle.svg'}
                  alt={isOpenOverride ? 'Buka' : 'Tutup'}
                  className="w-[45px] h-[31px] object-contain block"
                />
              </button>
            </div>

            {/* Toggle 2: Jeda Pesanan Online */}
            <div className="flex items-center justify-between py-1 border-t border-slate-100">
              <div>
                <span className="block text-xs font-bold text-slate-800">
                  Jeda Pesanan Online
                </span>
                <span className="text-[11px] text-slate-400">
                  {isOnlinePaused ? '⏸ Pesanan online dijeda (dapur sibuk)' : '▶ Pesanan online aktif normal'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isOnlinePaused}
                onClick={() => setIsOnlinePaused((prev) => !prev)}
                className="p-0 border-none bg-transparent cursor-pointer shrink-0 transition-transform active:scale-95"
              >
                <img
                  src={isOnlinePaused ? '/owner/assets/icons/green-toggle.svg' : '/owner/assets/icons/red-toggle.svg'}
                  alt={isOnlinePaused ? 'Dijeda' : 'Normal'}
                  className="w-[45px] h-[31px] object-contain block"
                />
              </button>
            </div>

            {/* Toggle 3: Layanan Delivery */}
            <div className="flex items-center justify-between py-1 border-t border-slate-100">
              <div>
                <span className="block text-xs font-bold text-slate-800">
                  Layanan Pengantaran (Delivery)
                </span>
                <span className="text-[11px] text-slate-400">
                  {isDeliveryActive ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isDeliveryActive}
                onClick={() => setIsDeliveryActive((prev) => !prev)}
                className="p-0 border-none bg-transparent cursor-pointer shrink-0 transition-transform active:scale-95"
              >
                <img
                  src={isDeliveryActive ? '/owner/assets/icons/green-toggle.svg' : '/owner/assets/icons/red-toggle.svg'}
                  alt={isDeliveryActive ? 'Aktif' : 'Nonaktif'}
                  className="w-[45px] h-[31px] object-contain block"
                />
              </button>
            </div>

            {/* Toggle 4: Layanan Pickup */}
            <div className="flex items-center justify-between py-1 border-t border-slate-100">
              <div>
                <span className="block text-xs font-bold text-slate-800">
                  Layanan Ambil di Toko (Pickup)
                </span>
                <span className="text-[11px] text-slate-400">
                  {isPickupActive ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isPickupActive}
                onClick={() => setIsPickupActive((prev) => !prev)}
                className="p-0 border-none bg-transparent cursor-pointer shrink-0 transition-transform active:scale-95"
              >
                <img
                  src={isPickupActive ? '/owner/assets/icons/green-toggle.svg' : '/owner/assets/icons/red-toggle.svg'}
                  alt={isPickupActive ? 'Aktif' : 'Nonaktif'}
                  className="w-[45px] h-[31px] object-contain block"
                />
              </button>
            </div>
          </div>

          {/* Card 3: Konfigurasi Tarif Ongkir Cabang */}
          <div className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-3.5 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 m-0">Pengaturan Ongkos Kirim</h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Tarif per KM (Rp)
                </label>
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={pricePerKm}
                  onChange={(e) => setPricePerKm(e.target.value)}
                  placeholder="3000"
                  className="w-full h-10 px-3 text-xs rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Radius Maksimal (KM)
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={maxRadiusKm}
                  onChange={(e) => setMaxRadiusKm(e.target.value)}
                  placeholder="10"
                  className="w-full h-10 px-3 text-xs rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Gratis Ongkir untuk Jarak (KM Pertama)
              </label>
              <input
                type="number"
                min="0"
                max="10"
                value={freeDeliveryKm}
                onChange={(e) => setFreeDeliveryKm(e.target.value)}
                placeholder="0"
                className="w-full h-10 px-3 text-xs rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:border-slate-900"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Jika diisi 1, maka 1 km pertama bebas ongkir bagi pelanggan.
              </span>
            </div>
          </div>

          {/* Card 4: Hapus Cabang (Khusus Mode Edit) */}
          {isEdit && (
            <div className="w-full p-4 bg-white rounded-[14px] hub-inset-stroke flex items-center justify-between gap-4 shadow-xs">
              <div className="flex-1 min-w-0 flex flex-col items-start gap-1 text-left">
                <span className="w-full text-sm font-bold text-rose-600 leading-snug">
                  Hapus Cabang
                </span>
                <span className="w-full text-[11px] font-medium text-slate-400 leading-snug">
                  Pastikan tidak ada pesanan aktif. Riwayat pesanan lama akan diarsipkan dengan aman.
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                disabled={deleting}
                className="h-8 px-3.5 rounded-full border border-rose-400 text-rose-600 text-xs font-bold bg-rose-50 hover:bg-rose-100 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-50"
              >
                {deleting ? '...' : 'Hapus'}
              </button>
            </div>
          )}
        </form>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        isDeleting={deleting}
        title={`Hapus Cabang "${name}"?`}
        description="Sistem akan memeriksa apakah cabang masih memiliki pesanan aktif. Jika bersih, cabang akan dihapus atau diarsipkan dengan aman. Lanjutkan?"
        confirmLabel="Ya, Hapus Cabang"
        cancelLabel="Batal"
      />

      {/* Fixed Bottom Action Bar with Green Save Button */}
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
              disabled={saving}
              onClick={handleSave}
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
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
              className="active:scale-[0.98] hover:bg-emerald-600 shadow-sm disabled:opacity-60"
            >
              {saving ? 'Menyimpan...' : isEdit ? 'Simpan Perubahan' : 'Daftarkan Cabang'}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
