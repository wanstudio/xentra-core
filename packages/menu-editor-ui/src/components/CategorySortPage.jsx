import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

function getAuthToken() {
  try {
    const t = localStorage.getItem('xentra_merchant_token');
    if (t) return t;
  } catch (_) {}
  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function triggerHaptic(ms = 8) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch (_) {}
}

function ArrowLeftIcon({ className = "w-[22px] h-[19px]" }) {
  // ci_arrow-left-sm.svg
  return (
    <svg data-icon="ci_arrow-left-sm.svg" width="22" height="19" viewBox="0 0 22 19" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M20.6244 9.99984H2.29102M9.62435 2.6665L2.29102 9.99984L9.62435 17.3332" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="#0F172A"/>
    </svg>
  );
}

function InfoCircleIcon({ className = "w-[25px] h-[25px]" }) {
  // mage_information-circle-fill.svg
  return (
    <svg data-icon="mage_information-circle-fill.svg" width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M12.4994 1.82275C10.3876 1.82275 8.32332 2.44895 6.56748 3.62217C4.81165 4.79538 3.44314 6.46291 2.63502 8.41389C1.82689 10.3649 1.61545 12.5117 2.02743 14.5828C2.43941 16.654 3.4563 18.5565 4.94952 20.0497C6.44273 21.5429 8.34521 22.5598 10.4164 22.9718C12.4875 23.3837 14.6343 23.1723 16.5853 22.3642C18.5363 21.5561 20.2038 20.1875 21.377 18.4317C22.5502 16.6759 23.1764 14.6116 23.1764 12.4998C23.1737 9.66895 22.0479 6.95479 20.0461 4.95305C18.0444 2.9513 15.3302 1.82551 12.4994 1.82275ZM12.4994 6.70817C12.7742 6.71229 13.0363 6.82492 13.2285 7.02148C13.4207 7.21805 13.5274 7.48263 13.5254 7.75753C13.5233 8.03244 13.4127 8.29538 13.2175 8.48905C13.0224 8.68271 12.7586 8.79139 12.4837 8.79139C12.2088 8.79139 11.945 8.68271 11.7499 8.48905C11.5548 8.29538 11.4442 8.03244 11.4421 7.75753C11.44 7.48263 11.5467 7.21805 11.7389 7.02148C11.9311 6.82492 12.1932 6.71229 12.4681 6.70817H12.4994ZM13.541 17.9894C13.541 18.2657 13.4313 18.5306 13.2359 18.726C13.0406 18.9213 12.7756 19.0311 12.4994 19.0311C12.2231 19.0311 11.9581 18.9213 11.7628 18.726C11.5674 18.5306 11.4577 18.2657 11.4577 17.9894V11.3957C11.4577 11.1194 11.5674 10.8545 11.7628 10.6591C11.9581 10.4638 12.2231 10.354 12.4994 10.354C12.7756 10.354 13.0406 10.4638 13.2359 10.6591C13.4313 10.8545 13.541 11.1194 13.541 11.3957V17.9894Z" fill="#0F172A"/>
    </svg>
  );
}

function DragHandleIcon({ className = "w-[13px] h-[13px]" }) {
  // gravity-ui_equal.svg
  return (
    <svg data-icon="gravity-ui_equal.svg" width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M10.9688 8.9375C11.1304 8.9375 11.2854 8.8733 11.3996 8.75902C11.5139 8.64474 11.5781 8.48974 11.5781 8.32812C11.5781 8.16651 11.5139 8.01151 11.3996 7.89723C11.2854 7.78295 11.1304 7.71875 10.9688 7.71875H2.03125C1.86963 7.71875 1.71464 7.78295 1.60036 7.89723C1.48608 8.01151 1.42188 8.16651 1.42188 8.32812C1.42188 8.48974 1.48608 8.64474 1.60036 8.75902C1.71464 8.8733 1.86963 8.9375 2.03125 8.9375H10.9688ZM10.9688 5.28125C11.1304 5.28125 11.2854 5.21705 11.3996 5.10277C11.5139 4.98849 11.5781 4.83349 11.5781 4.67188C11.5781 4.51026 11.5139 4.35526 11.3996 4.24098C11.2854 4.1267 11.1304 4.0625 10.9688 4.0625H2.03125C1.86963 4.0625 1.71464 4.1267 1.60036 4.24098C1.48608 4.35526 1.42188 4.51026 1.42188 4.67188C1.42188 4.83349 1.48608 4.98849 1.60036 5.10277C1.71464 5.21705 1.86963 5.28125 2.03125 5.28125H10.9688Z" fillRule="evenodd" clipRule="evenodd" fill="#303030"/>
    </svg>
  );
}

export default function CategorySortPage({ onBack, onSaved }) {
  const [categories, setCategories] = useState(() => {
    if (typeof window !== 'undefined' && window.state && Array.isArray(window.state.categories) && window.state.categories.length > 0) {
      return [...window.state.categories].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
    }
    return [];
  });
  const [initialOrder, setInitialOrder] = useState(() => {
    if (typeof window !== 'undefined' && window.state && Array.isArray(window.state.categories) && window.state.categories.length > 0) {
      return [...window.state.categories]
        .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
        .map((c) => String(c.id));
    }
    return [];
  });
  const [menus, setMenus] = useState(() => {
    if (typeof window !== 'undefined' && window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.menus)) {
      return window._ownerMasterMenuState.menus;
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    return !(typeof window !== 'undefined' && window.state && Array.isArray(window.state.categories) && window.state.categories.length > 0);
  });
  const [isSaving, setIsSaving] = useState(false);

  // Interactive Pointer / Touch Drag & FLIP State
  const [activeId, setActiveId] = useState(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [isSettling, setIsSettling] = useState(false);

  const listContainerRef = useRef(null);
  const cardRefs = useRef(new Map());
  const prevTopsRef = useRef(new Map());
  const dragSessionRef = useRef(null);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/categories');
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      // Seed from existing cache if available
      if (window.state && Array.isArray(window.state.categories) && window.state.categories.length > 0) {
        const sorted = [...window.state.categories].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
        setCategories(sorted);
        setInitialOrder(sorted.map(c => String(c.id)));
        setLoading(false);
      }
      if (window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.menus)) {
        setMenus(window._ownerMasterMenuState.menus);
      }

      try {
        const token = getAuthToken();
        const headers = { 'Accept': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const [catRes, menuRes] = await Promise.all([
          fetch('/api/v1/admin/categories', { headers }),
          fetch('/api/v1/admin/menus', { headers }).catch(() => null)
        ]);

        if (catRes && catRes.ok) {
          const catData = await catRes.json();
          if (catData.success && Array.isArray(catData.categories) && isMounted) {
            const sorted = [...catData.categories].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
            setCategories(sorted);
            setInitialOrder(sorted.map(c => String(c.id)));
            if (window.state) {
              window.state.categories = catData.categories;
            }
          }
        }

        if (menuRes && menuRes.ok) {
          const menuData = await menuRes.json();
          if (menuData.success && Array.isArray(menuData.menus) && isMounted) {
            setMenus(menuData.menus);
            if (window._ownerMasterMenuState) {
              window._ownerMasterMenuState.menus = menuData.menus;
            }
          }
        }
      } catch (err) {
        console.error('[CategorySortPage] Load error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => { isMounted = false; };
  }, []);

  // Compute menu preview snippet for category
  const getCategorySnippet = (cat) => {
    if (!cat) return '';
    const catMenus = menus.filter(m => {
      if (!m) return false;
      const cId = m.category_id || (m.category && m.category.id);
      return String(cId || '') === String(cat.id || '');
    });
    if (catMenus.length > 0) {
      const names = catMenus.map(m => m.title_name || m.package_name || m.title || m.name || '').filter(Boolean);
      if (names.length > 0) {
        return names.slice(0, 3).join(', ') + (names.length > 3 ? '...' : '');
      }
    }
    return cat.description || 'Belum ada menu';
  };

  // Check if order has changed
  const currentOrderIds = categories.map(c => String(c.id));
  const hasChanged = currentOrderIds.length > 0 && currentOrderIds.some((id, idx) => id !== initialOrder[idx]);

  // Capture current card positions before reorder for FLIP animation
  const capturePositions = useCallback(() => {
    const map = new Map();
    cardRefs.current.forEach((node, id) => {
      if (node) {
        map.set(String(id), node.getBoundingClientRect().top);
      }
    });
    prevTopsRef.current = map;
  }, []);

  // FLIP animation: smoothly animate non-dragged sibling cards when they swap slots
  useLayoutEffect(() => {
    const prevTops = prevTopsRef.current;
    if (!prevTops || prevTops.size === 0) return;

    cardRefs.current.forEach((node, id) => {
      const key = String(id);
      if (!node || key === String(activeId)) return;
      const prevTop = prevTops.get(key);
      if (typeof prevTop !== 'number') return;
      const newTop = node.getBoundingClientRect().top;
      const deltaY = prevTop - newTop;
      if (Math.abs(deltaY) > 1) {
        node.style.transition = 'none';
        node.style.transform = `translate3d(0, ${deltaY}px, 0)`;
        // Force reflow
        void node.offsetHeight;
        node.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
        node.style.transform = 'translate3d(0, 0, 0)';
      }
    });

    prevTopsRef.current = new Map();
  }, [categories, activeId]);

  // Pointer-based smooth drag & drop
  const startPointerDrag = (clientY, catId, index) => {
    const node = cardRefs.current.get(String(catId));
    const rect = node ? node.getBoundingClientRect() : { height: 74 };
    // Step pitch = card height + 16px gap
    const pitch = (rect.height || 74) + 16;

    dragSessionRef.current = {
      id: String(catId),
      currentIndex: index,
      anchorY: clientY,
      pitch,
    };

    setIsSettling(false);
    setActiveId(String(catId));
    setDragOffsetY(0);
    triggerHaptic(10);
  };

  const updatePointerDrag = useCallback((clientY) => {
    const session = dragSessionRef.current;
    if (!session) return;

    let dy = clientY - session.anchorY;
    const threshold = session.pitch * 0.52;

    if (dy > threshold && session.currentIndex < categories.length - 1) {
      const fromIdx = session.currentIndex;
      const toIdx = fromIdx + 1;
      capturePositions();
      session.currentIndex = toIdx;
      session.anchorY += session.pitch;
      dy = clientY - session.anchorY;
      setCategories((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
      triggerHaptic(6);
    } else if (dy < -threshold && session.currentIndex > 0) {
      const fromIdx = session.currentIndex;
      const toIdx = fromIdx - 1;
      capturePositions();
      session.currentIndex = toIdx;
      session.anchorY -= session.pitch;
      dy = clientY - session.anchorY;
      setCategories((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
      triggerHaptic(6);
    }

    setDragOffsetY(dy);
  }, [categories.length, capturePositions]);

  const finishPointerDrag = useCallback(() => {
    if (!dragSessionRef.current) return;
    dragSessionRef.current = null;
    setIsSettling(true);
    setDragOffsetY(0);
    setTimeout(() => {
      setActiveId(null);
      setIsSettling(false);
    }, 220);
  }, []);

  useEffect(() => {
    if (!activeId) return;

    const onPointerMove = (e) => {
      if (!dragSessionRef.current) return;
      if (e.cancelable) e.preventDefault();
      const clientY = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
      if (typeof clientY === 'number') {
        updatePointerDrag(clientY);
      }
    };

    const onPointerUp = () => {
      finishPointerDrag();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
    window.addEventListener('touchcancel', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
      window.removeEventListener('touchcancel', onPointerUp);
    };
  }, [activeId, updatePointerDrag, finishPointerDrag]);

  // Save reordered categories
  const handleSaveOrder = async () => {
    if (isSaving) return;
    if (!hasChanged) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('ℹ️ Urutan kategori belum diubah', 'info');
      }
      return;
    }
    setIsSaving(true);
    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const orderedIds = categories.map(c => c.id);
      const res = await fetch('/api/v1/admin/categories/reorder', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ order: orderedIds })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Gagal menyimpan urutan kategori.');
      }

      if (window.showToast) {
        window.showToast('✓ Urutan kategori berhasil disimpan.');
      }

      if (window.state) {
        window.state.categories = data.categories || categories;
      }

      setInitialOrder(orderedIds.map(String));

      if (typeof onSaved === 'function') {
        onSaved(data.categories || categories);
      } else {
        handleBack();
      }
    } catch (err) {
      console.error('[CategorySortPage] Save order error:', err);
      if (window.showToast) {
        window.showToast('❌ ' + (err.message || 'Gagal menyimpan urutan kategori.'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      id="modern-category-sort-page-root"
      style={{
        boxSizing: 'border-box'
      }}
      className="w-full flex flex-col gap-4 pb-36 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow and Title */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali ke Kategori"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <ArrowLeftIcon />
        </button>
        <h1 className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0 truncate">
          Urutkan kategori
        </h1>
      </div>

      {/* 2. Main Card Panel with Outline / Inset Stroke */}
      <div
        ref={listContainerRef}
        className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-4"
      >
        {/* Instruction Header Row */}
        <div className="w-full flex items-center justify-start gap-2">
          <InfoCircleIcon />
          <span className="text-[#94A3B8] text-[11px] font-bold leading-snug text-left">
            Tekan dan geser untuk mengatur urutan kategori
          </span>
        </div>

        {/* Categories List */}
        {loading ? (
          <div className="py-12 text-center text-sm text-[#94A3B8] font-medium">
            Memuat kategori...
          </div>
        ) : categories.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#94A3B8] font-medium">
            Belum ada kategori untuk diurutkan.
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full relative">
            {categories.map((cat, index) => {
              const isDragging = String(activeId) === String(cat.id);
              const snippet = getCategorySnippet(cat);

              return (
                <div
                  key={cat.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(String(cat.id), el);
                    else cardRefs.current.delete(String(cat.id));
                  }}
                  data-sort-index={index}
                  onPointerDown={(e) => {
                    if (e.button !== undefined && e.button !== 0) return;
                    e.preventDefault();
                    startPointerDrag(e.clientY, cat.id, index);
                  }}
                  style={{
                    touchAction: 'none',
                    zIndex: isDragging ? 30 : 1,
                    transform: isDragging
                      ? `translate3d(0, ${dragOffsetY}px, 0) scale(${isSettling ? 1 : 1.025})`
                      : undefined,
                    transition: isDragging
                      ? (isSettling
                        ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease'
                        : 'box-shadow 150ms ease')
                      : undefined,
                    willChange: 'transform',
                  }}
                  className={`w-full p-4 rounded-[12px] bg-white flex items-center justify-between gap-4 select-none cursor-grab active:cursor-grabbing ${
                    isDragging
                      ? 'hub-card-dragging'
                      : 'hub-inset-stroke hub-card'
                  }`}
                >
                  {/* Category Info */}
                  <div className="flex-1 min-w-0 flex flex-col justify-start items-start gap-1 pointer-events-none">
                    <div className="text-[#0F172A] text-base font-bold leading-snug truncate w-full text-left">
                      {cat.name}
                    </div>
                    <div className="text-[#94A3B8] text-[13px] font-medium leading-snug truncate w-full max-w-[160px] text-left">
                      {snippet}
                    </div>
                  </div>

                  {/* Drag Handle Grip Icon (13x13 gravity-ui_equal.svg) */}
                  <div
                    className="w-7 h-7 -mr-1.5 flex items-center justify-center shrink-0 rounded-lg pointer-events-none"
                    title="Geser untuk mengatur urutan"
                  >
                    <DragHandleIcon />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Fixed Bottom Action Bar rendered outside body via React Portal */}
      {typeof document !== 'undefined' && createPortal(
        <div
          id="modern-categories-sort-bottom-bar"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            width: '100vw',
            maxWidth: '100vw',
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
              disabled={isSaving}
              onClick={handleSaveOrder}
              style={{
                width: '100%',
                height: '48px',
                borderRadius: '9999px',
                border: 'none',
                outline: 'none',
                backgroundColor: hasChanged ? '#00A637' : '#F2F2F2',
                color: hasChanged ? '#FFFFFF' : '#979797',
                fontWeight: 700,
                fontSize: '14px',
                cursor: isSaving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
              className={hasChanged && !isSaving ? 'active:scale-98 hover:bg-emerald-600' : 'active:scale-[0.99]'}
            >
              {isSaving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
