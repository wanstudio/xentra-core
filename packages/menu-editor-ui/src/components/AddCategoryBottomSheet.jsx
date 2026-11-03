import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * AddCategoryBottomSheet — centered popup modal "Tambah kategori" (Figma 353 x 353).
 * (File name kept for integration compatibility with MenuEditor.)
 *
 * Behaviour contract:
 *  - Enter: backdrop fade + card fade/scale (0.96 -> 1). Exit animates BEFORE unmount.
 *  - Dismiss: backdrop tap, Escape, Back (popstate / hashchange). Locked while submitting.
 *  - Soft keyboard: modal stays centered inside the visible viewport (visualViewport),
 *    so the submit pill is never hidden behind the keyboard.
 */

const DURATION = 200;
const FONT = "'Plus Jakarta Sans', sans-serif";

function getFallbackAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}

  const match = typeof document !== 'undefined'
    ? document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/)
    : null;
  return match ? decodeURIComponent(match[1]) : '';
}

export default function AddCategoryBottomSheet({
  isOpen = false,
  onClose,
  onCreated,
  apiBase = '/api/v1',
  authToken = null,
}) {
  const [mounted, setMounted] = useState(isOpen);
  const [shown, setShown] = useState(isOpen);
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [keyboardInset, setKeyboardInset] = useState(0);
  const inputRef = useRef(null);

  // Latest callbacks/flags in refs so listeners bind exactly once per open.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isSubmittingRef = useRef(false);
  isSubmittingRef.current = isSubmitting;

  const resolvedToken = authToken || getFallbackAuthToken();
  const maxLength = 150;
  const isFormValid = name.trim().length > 0;
  const canSubmit = isFormValid && !isSubmitting;

  const requestClose = () => {
    if (isSubmittingRef.current) return;
    if (typeof onCloseRef.current === 'function') onCloseRef.current();
  };

  // Mount / unmount with enter + exit animation.
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setName('');
      setIsActive(true);
      setIsSubmitting(false);
      setErrorMessage('');
      setShown(true);
      return;
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), DURATION);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Autofocus once shown.
  useEffect(() => {
    if (!shown || !mounted) return;
    const t = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearTimeout(t);
  }, [shown, mounted]);

  // Lifecycle: Back (popstate/hashchange) and Escape.
  useEffect(() => {
    if (!isOpen) return;

    const handleBack = () => {
      if (typeof onCloseRef.current === 'function') onCloseRef.current();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
    };

    window.addEventListener('popstate', handleBack);
    window.addEventListener('hashchange', handleBack);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handleBack);
      window.removeEventListener('hashchange', handleBack);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // Soft keyboard inset via visualViewport (adjustPan / overlays-content WebViews).
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        setKeyboardInset((prev) => (prev === inset ? prev : inset));
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setKeyboardInset(0);
    };
  }, [isOpen]);

  // Background scroll lock.
  useEffect(() => {
    if (!mounted || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  if (!mounted && !isOpen) return null;

  const handleSubmit = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage('⚠️ Nama kategori wajib diisi.');
      if (inputRef.current) inputRef.current.focus();
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
      if (resolvedToken) headers.Authorization = `Bearer ${resolvedToken}`;

      const res = await fetch(`${apiBase}/admin/categories`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: trimmedName, is_active: isActive ? 1 : 0 }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Gagal menambahkan kategori.');
      }

      setIsSubmitting(false);
      isSubmittingRef.current = false;

      // Modern Mobile: Dispatch reactive sync event
      if (typeof window !== 'undefined' && data.category) {
        window.dispatchEvent(new CustomEvent('categories-updated', { detail: data.category }));
        window.dispatchEvent(new CustomEvent('category-updated', { detail: data.category }));
      }

      if (typeof onCreated === 'function') onCreated(data.category);
      if (typeof onCloseRef.current === 'function') onCloseRef.current();
    } catch (err) {
      setErrorMessage(err.message || 'Terjadi kesalahan sistem.');
      setIsSubmitting(false);
    }
  };

  const modal = (
    <div id="modern-menu-portal-root">
      <div
        className="fixed inset-0 z-[99999] flex items-center justify-center"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '16px 20px',
          paddingBottom: keyboardInset ? `${keyboardInset + 16}px` : '16px',
          boxSizing: 'border-box',
          width: '100vw',
          height: '100vh',
          transition: 'padding-bottom 150ms ease-out',
        }}
        role="presentation"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            opacity: shown ? 1 : 0,
            transition: `opacity ${DURATION}ms ease`,
          }}
          onClick={requestClose}
        />

        {/* Card (Figma: 353 wide, padding 18/17, radius 16, gap 17) */}
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-category-modal-title"
          onSubmit={handleSubmit}
          className="relative w-full max-w-[353px] bg-white flex flex-col items-stretch"
          style={{
            position: 'relative',
            width: '353px',
            maxWidth: 'calc(100vw - 32px)',
            boxSizing: 'border-box',
            fontFamily: FONT,
            padding: '18px 17px',
            gap: '17px',
            borderRadius: '16px',
            backgroundColor: '#FFFFFF',
            boxShadow: '0px 2px 10px rgba(0, 0, 0, 0.20)',
            maxHeight: '90vh',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            opacity: shown ? 1 : 0,
            transform: shown ? 'scale(1)' : 'scale(0.96)',
            transition: `opacity ${DURATION}ms ease, transform ${DURATION}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            id="add-category-modal-title"
            style={{ color: '#0F172A', fontSize: '18px', fontFamily: FONT, fontWeight: 700, lineHeight: '18px' }}
            className="text-left"
          >
            Tambah kategori
          </div>

          <div
            style={{
              alignSelf: 'stretch',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
              gap: '16px',
              display: 'flex',
              width: '100%',
            }}
            className="w-full flex flex-col items-stretch"
          >
            {/* Card 1: Nama kategori (Figma h 123) */}
            <div
              style={{
                alignSelf: 'stretch',
                minHeight: '123px',
                padding: '16px',
                backgroundColor: '#FFFFFF',
                borderRadius: '14px',
                outline: '0.50px #D9D9D9 solid',
                outlineOffset: '-0.50px',
                flexDirection: 'column',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                display: 'flex',
                boxSizing: 'border-box',
                width: '100%',
              }}
              className="w-full bg-white flex flex-col"
            >
              <div
                style={{
                  width: '100%',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  alignItems: 'flex-start',
                  gap: '4px',
                  display: 'flex',
                }}
                className="w-full flex flex-col items-stretch"
              >
                <label htmlFor="input-add-category-name" style={{ alignSelf: 'stretch', textAlign: 'left', wordWrap: 'break-word' }}>
                  <span style={{ color: '#0F172A', fontSize: '16px', fontFamily: FONT, fontWeight: 700 }}>Nama kategori </span>
                  <span style={{ color: '#FA3E3E', fontSize: '16px', fontFamily: FONT, fontWeight: 700 }}>*</span>
                </label>

                <div
                  style={{
                    alignSelf: 'stretch',
                    height: '48px',
                    position: 'relative',
                    overflow: 'hidden',
                    borderRadius: '14px',
                    outline: '1px #CBD5E1 solid',
                    outlineOffset: '-1px',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    backgroundColor: '#FFFFFF',
                    width: '100%',
                  }}
                  className="w-full relative overflow-hidden flex items-center bg-white focus-within:[outline-color:#0F172A]"
                >
                  <input
                    id="input-add-category-name"
                    ref={inputRef}
                    type="text"
                    value={name}
                    maxLength={maxLength}
                    disabled={isSubmitting}
                    autoComplete="off"
                    enterKeyHint="done"
                    onChange={(e) => {
                      setName(e.target.value);
                      if (errorMessage) setErrorMessage('');
                    }}
                    placeholder="Cth. Makanan Berat"
                    style={{
                      width: '100%',
                      height: '100%',
                      fontSize: '13px',
                      fontWeight: 500,
                      fontFamily: FONT,
                      padding: '0 16px',
                      color: '#0F172A',
                      backgroundColor: 'transparent',
                      border: 'none',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                    className="w-full h-full bg-transparent border-none outline-none placeholder-[#94A3B8]"
                  />
                </div>

                <div
                  style={{
                    alignSelf: 'stretch',
                    textAlign: 'right',
                    color: '#94A3B8',
                    fontSize: '10px',
                    fontFamily: FONT,
                    fontWeight: 400,
                    width: '100%',
                  }}
                  className="w-full text-right tabular-nums"
                >
                  {name.length}/{maxLength}
                </div>
              </div>
            </div>

            {/* Card 2: Aktifkan kategori */}
            <div
              style={{
                alignSelf: 'stretch',
                padding: '16px',
                backgroundColor: '#FFFFFF',
                overflow: 'hidden',
                borderRadius: '14px',
                outline: '0.50px #D9D9D9 solid',
                outlineOffset: '-0.50px',
                justifyContent: 'space-between',
                alignItems: 'center',
                display: 'flex',
                boxSizing: 'border-box',
                width: '100%',
              }}
              className="w-full bg-white flex justify-between items-center"
            >
              <div
                style={{
                  width: '248px',
                  maxWidth: '248px',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  alignItems: 'flex-start',
                  gap: '4px',
                  display: 'inline-flex',
                  textAlign: 'left',
                }}
                className="flex flex-col items-start flex-1 pr-3 text-left"
              >
                <div style={{ alignSelf: 'stretch', color: 'black', fontSize: '16px', fontFamily: FONT, fontWeight: 700, wordWrap: 'break-word' }}>
                  Aktifkan kategori
                </div>
                <div style={{ alignSelf: 'stretch', color: '#94A3B8', fontSize: '13px', fontFamily: FONT, fontWeight: 500, wordWrap: 'break-word' }}>
                  Kategori menu yang aktif akan terlihat
                </div>
              </div>

              {/* Toggle Button */}
              <button
                type="button"
                role="switch"
                aria-checked={isActive}
                aria-label="Aktifkan kategori"
                disabled={isSubmitting}
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

            {errorMessage && (
              <div
                className="w-full text-left px-1"
                style={{ fontSize: '12px', fontWeight: 500, color: '#FA3E3E', fontFamily: FONT }}
              >
                {errorMessage}
              </div>
            )}

            {/* Pill button 48px */}
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                alignSelf: 'stretch',
                height: '48px',
                paddingLeft: '24px',
                paddingRight: '24px',
                paddingTop: '12px',
                paddingBottom: '12px',
                borderRadius: '9999px',
                backgroundColor: canSubmit ? '#00A637' : '#F2F2F2',
                color: canSubmit ? '#FFFFFF' : '#979797',
                fontSize: '14px',
                fontFamily: FONT,
                fontWeight: 700,
                wordWrap: 'break-word',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '10px',
                display: 'inline-flex',
                border: 'none',
                boxSizing: 'border-box',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                transition: 'background-color 150ms ease, color 150ms ease, transform 100ms ease',
              }}
              className={`w-full shrink-0 flex items-center justify-center border-none ${
                canSubmit && !isSubmitting ? 'cursor-pointer active:scale-[0.98] hover:bg-[#009230]' : 'active:scale-[0.99]'
              }`}
            >
              {isSubmitting ? 'Menyimpan...' : 'Buat kategori'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}
