import React, { useState } from 'react';

export default function MorePage({ onNavigate }) {
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const handleLogout = () => {
    try {
      localStorage.removeItem('xentra_merchant_token');
      localStorage.removeItem('xentra_merchant_user');
      document.cookie = 'xentra_merchant_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    } catch (_) {}
    window.location.href = '/login';
  };

  const navTo = (r) => {
    if (typeof onNavigate === 'function') {
      onNavigate(r);
    } else if (typeof window !== 'undefined' && typeof window.navigateTo === 'function') {
      window.navigateTo(r);
    }
  };

  return (
    <div
      id="modern-more-page-root"
      style={{ boxSizing: 'border-box', paddingBottom: '8px' }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* Header */}
      <div className="pt-2">
        <h1 className="text-xl font-bold text-slate-900 m-0">Lainnya</h1>
        <p className="text-xs text-slate-500 m-0 mt-0.5">Pengaturan akun, operasional cabang, dan konfigurasi</p>
      </div>

      {/* Profile Card */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-lg">
            O
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-slate-900 text-base leading-tight">Bangjo Resto</span>
            <span className="text-xs font-semibold text-emerald-600">Owner / Pemilik Usaha</span>
            <span className="text-[11px] text-slate-400 mt-0.5">Akses penuh lintas seluruh cabang</span>
          </div>
        </div>
      </div>

      {/* Menu Groups */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">Operasional &amp; Bisnis</span>
        <div className="bg-white rounded-2xl border border-slate-200/90 divide-y divide-slate-100 overflow-hidden shadow-xs">
          {[
            { label: 'Katalog & Menu Master', desc: 'Atur kategori, resep, dan harga', route: 'business', icon: '🍽️' },
            { label: 'Kelola Cabang', desc: 'Lokasi cabang, jam buka & darurat', route: 'branches', icon: '🏪' },
            { label: 'Stok & Bahan Baku', desc: 'Bahan mentah, opname & waste', route: 'materials', icon: '📦' },
            { label: 'Laporan Penjualan', desc: 'Export excel, omset & profit', route: 'reports', icon: '📊' }
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => navTo(item.route)}
              className="w-full p-3.5 flex items-center justify-between hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer text-left border-none bg-transparent"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{item.icon}</span>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-800">{item.label}</span>
                  <span className="text-[11px] text-slate-400">{item.desc}</span>
                </div>
              </div>
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">Sistem &amp; Akun</span>
        <div className="bg-white rounded-2xl border border-slate-200/90 divide-y divide-slate-100 overflow-hidden shadow-xs">
          {[
            { label: 'Metode Pembayaran', desc: 'QRIS Statis/Dinamis, Tunai, EDC', route: 'finance', icon: '💳' },
            { label: 'Pusat Bantuan', desc: 'Panduan Xentra & live support WhatsApp', route: 'support', icon: '💬' }
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => navTo(item.route)}
              className="w-full p-3.5 flex items-center justify-between hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer text-left border-none bg-transparent"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{item.icon}</span>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-800">{item.label}</span>
                  <span className="text-[11px] text-slate-400">{item.desc}</span>
                </div>
              </div>
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* Logout Action */}
      <button
        type="button"
        onClick={() => setShowLogoutModal(true)}
        className="w-full py-3.5 px-4 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-sm transition-all cursor-pointer border border-rose-200/80 active:scale-98 flex items-center justify-center gap-2 mt-2"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        <span>Keluar dari Akun</span>
      </button>

      {/* App Version Footer */}
      <div className="text-center pt-2 pb-6">
        <p className="text-[11px] text-slate-400 m-0">Xentra Owner Mobile v1.8.90</p>
        <p className="text-[10px] text-slate-400/80 m-0">Mobile-First Standalone Runtime</p>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-[99999] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full shadow-2xl flex flex-col gap-3">
            <h3 className="text-base font-bold text-slate-900 m-0">Konfirmasi Keluar</h3>
            <p className="text-xs text-slate-500 m-0">Apakah Anda yakin ingin keluar dari aplikasi Owner?</p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer border-none"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex-1 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl cursor-pointer border-none shadow-xs"
              >
                Ya, Keluar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
