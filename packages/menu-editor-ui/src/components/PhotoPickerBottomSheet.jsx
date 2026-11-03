import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function PhotoPickerBottomSheet({
  isOpen = false,
  onClose,
  recentPhotoUrl = null,
  onPhotoSelected,
}) {
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Mobile Back Navigation & Escape handler
  useEffect(() => {
    if (!isOpen) return;

    const handleDismiss = () => {
      if (typeof onCloseRef.current === 'function') {
        onCloseRef.current();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };

    window.addEventListener('popstate', handleDismiss);
    window.addEventListener('hashchange', handleDismiss);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('popstate', handleDismiss);
      window.removeEventListener('hashchange', handleDismiss);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Lock body scroll when bottom sheet is open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (typeof onPhotoSelected === 'function') {
        onPhotoSelected(file);
      }
      if (typeof onClose === 'function') {
        onClose();
      }
    }
    // Reset input so taking another picture or re-selecting triggers onChange
    if (e.target) {
      e.target.value = '';
    }
  };

  const sheetContent = (
    <div id="modern-menu-portal-root">
      {/* Backdrop */}
      <div
        id="photo-picker-backdrop"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: 'center',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
        className="fixed inset-0 z-[99999] flex flex-col justify-end items-center bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={(e) => {
          if (e.target === e.currentTarget && typeof onClose === 'function') {
            onClose();
          }
        }}
      >
        {/* Hidden File Inputs — direct native triggers without synthetic JS activation restrictions */}
        <input
          id="menu-photo-camera-input"
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: 0,
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
            border: 0,
            opacity: 0,
            pointerEvents: 'none',
          }}
          onChange={handleFileChange}
        />
        <input
          id="menu-photo-gallery-input"
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: 0,
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
            border: 0,
            opacity: 0,
            pointerEvents: 'none',
          }}
          onChange={handleFileChange}
        />

        {/* Modal Container */}
        <div
          id="photo-picker-sheet-container"
          style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            width: '100%',
            maxWidth: '447px',
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: '20px',
            borderTopRightRadius: '20px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 -4px 25px rgba(0, 0, 0, 0.15)',
          }}
          className="w-full max-w-[447px] sm:max-w-md bg-white rounded-t-[20px] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl transition-transform animate-sticky-swipe-up"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle bar (40px x 5px #D9D9D9 centered) */}
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              paddingTop: '24px',
              paddingBottom: '16px',
              flexShrink: 0,
            }}
            className="w-full flex justify-center pt-6 pb-4 shrink-0"
          >
            <div
              style={{
                width: '40px',
                height: '5px',
                backgroundColor: '#D9D9D9',
                borderRadius: '9999px',
              }}
            />
          </div>

          {/* Content Body */}
          <div
            style={{
              width: '100%',
              paddingLeft: '16px',
              paddingRight: '16px',
              paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              overflowY: 'auto',
              boxSizing: 'border-box',
            }}
            className="w-full px-4 flex flex-col items-center gap-4 overflow-y-auto overscroll-contain"
          >
            {/* 1. Recent Photo (if available) */}
            {Boolean(recentPhotoUrl) && (
              <div
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  maxHeight: '358px',
                  borderRadius: '20px',
                  overflow: 'hidden',
                  backgroundColor: '#F8FAFC',
                }}
                className="w-full relative shrink-0 shadow-sm"
              >
                <img
                  src={recentPhotoUrl}
                  alt="Recent Photo"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '20px',
                  }}
                  className="block select-none pointer-events-none"
                />
              </div>
            )}

            {/* 2. Button 1: Ambil dari kamera (Direct native label trigger with capture="environment") */}
            <label
              htmlFor="menu-photo-camera-input"
              id="btn-photo-pick-camera"
              style={{
                width: '100%',
                padding: '16px',
                backgroundColor: '#FFFFFF',
                borderRadius: '10px',
                outline: '1px #D1D3D9 solid',
                outlineOffset: '-1px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                cursor: 'pointer',
                margin: 0,
              }}
              className="w-full flex items-center justify-between gap-4 cursor-pointer transition-all active:scale-[0.99] hover:bg-slate-50/80 select-none"
            >
              {/* Camera Icon Container (45x45) with emojione_camera.png */}
              <div
                style={{
                  width: '45px',
                  height: '45px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="shrink-0 flex items-center justify-center overflow-hidden"
              >
                <img
                  src="/owner/assets/icons/emojione_camera.png"
                  alt="Kamera"
                  style={{ width: '35px', height: '35px', objectFit: 'contain' }}
                  className="pointer-events-none select-none block"
                />
              </div>

              {/* Title */}
              <div className="flex-1 min-w-0 text-left">
                <span
                  style={{
                    color: '#0F172A',
                    fontSize: '16px',
                    fontWeight: 700,
                    lineHeight: '1.2',
                  }}
                  className="truncate block"
                >
                  Ambil dari kamera
                </span>
              </div>

              {/* Right Chevron */}
              <div
                style={{ width: '13px', height: '13px' }}
                className="shrink-0 flex items-center justify-center"
              >
                <svg width="6" height="10" viewBox="0 0 6 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1L5 5L1 9" stroke="#303030" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </label>

            {/* 3. Button 2: Pilih dari galeri (Direct native label trigger for gallery) */}
            <label
              htmlFor="menu-photo-gallery-input"
              id="btn-photo-pick-gallery"
              style={{
                width: '100%',
                padding: '16px',
                backgroundColor: '#FFFFFF',
                borderRadius: '10px',
                outline: '1px #D1D3D9 solid',
                outlineOffset: '-1px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                cursor: 'pointer',
                margin: 0,
              }}
              className="w-full flex items-center justify-between gap-4 cursor-pointer transition-all active:scale-[0.99] hover:bg-slate-50/80 select-none"
            >
              {/* Gallery Icon Container (45x45) with flat-color-icons_gallery.png */}
              <div
                style={{
                  width: '45px',
                  height: '45px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="shrink-0 flex items-center justify-center overflow-hidden"
              >
                <img
                  src="/owner/assets/icons/flat-color-icons_gallery.png"
                  alt="Galeri"
                  style={{ width: '45px', height: '45px', objectFit: 'contain' }}
                  className="pointer-events-none select-none block"
                />
              </div>

              {/* Title */}
              <div className="flex-1 min-w-0 text-left">
                <span
                  style={{
                    color: '#0F172A',
                    fontSize: '16px',
                    fontWeight: 700,
                    lineHeight: '1.2',
                  }}
                  className="truncate block"
                >
                  Pilih dari galeri
                </span>
              </div>

              {/* Right Chevron */}
              <div
                style={{ width: '13px', height: '13px' }}
                className="shrink-0 flex items-center justify-center"
              >
                <svg width="6" height="10" viewBox="0 0 6 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1L5 5L1 9" stroke="#303030" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(sheetContent, document.body)
    : sheetContent;
}
