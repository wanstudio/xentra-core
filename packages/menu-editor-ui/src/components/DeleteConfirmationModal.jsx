import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Standard Delete Confirmation Modal for Xentra Suite
 * Reusable modal matching the canonical "Hapus Item?" design token standard:
 * - Centered circular red badge on top (w-12 h-12 bg-red-100 text-red-600)
 * - Bold center-aligned title & relaxed explanatory text
 * - Pill action buttons (Batal in slate-100, Ya, Hapus in solid red #FA3E3E)
 * - 100vw x 100vh viewport-centered portal to document.body (zIndex 999999)
 * - Automatic body scroll locking & Escape / Back key handlers
 */
export default function DeleteConfirmationModal({
  isOpen = false,
  onClose,
  onConfirm,
  isDeleting = false,
  title = 'Hapus Item?',
  description = 'Item akan dihapus permanen. Aksi ini tidak dapat dibatalkan.',
  cancelLabel = 'Batal',
  confirmLabel = 'Ya, Hapus',
  deletingLabel = 'Menghapus...',
}) {
  // Lock body scroll and close on Escape key when modal is open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isDeleting && typeof onClose === 'function') {
        e.preventDefault();
        onClose();
      }
    };
    const handlePop = () => {
      if (!isDeleting && typeof onClose === 'function') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePop);
    window.addEventListener('hashchange', handlePop);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePop);
      window.removeEventListener('hashchange', handlePop);
    };
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      id="modern-menu-portal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="standard-delete-modal-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        boxSizing: 'border-box',
      }}
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={() => {
        if (!isDeleting && typeof onClose === 'function') onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '350px',
          borderRadius: '20px',
          backgroundColor: '#FFFFFF',
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}
        className="w-full bg-white p-6 shadow-2xl flex flex-col gap-4 text-center animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Red circular badge icon */}
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto text-red-600">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-1.5">
          <h3 id="standard-delete-modal-title" className="m-0 text-slate-900 text-lg font-bold">
            {title}
          </h3>
          <p className="m-0 text-slate-500 text-xs leading-relaxed">
            {description}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 py-3 rounded-full text-slate-700 bg-slate-100 font-bold text-sm border-none cursor-pointer hover:bg-slate-200 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-3 rounded-full text-white bg-[#FA3E3E] font-bold text-sm border-none cursor-pointer hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {isDeleting ? deletingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
