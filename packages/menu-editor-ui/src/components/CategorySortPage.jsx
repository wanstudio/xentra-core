import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';

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

export default function CategorySortPage({ onBack, onSaved }) {
  const [categories, setCategories] = useState([]);
  const [initialOrder, setInitialOrder] = useState([]);
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
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
      return;
    }
    window.location.hash = '#catalog/categories';
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
    if (!hasChanged || isSaving) return;
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
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain"
          />
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
          <img
            src="/owner/assets/icons/mage_information-circle-fill.svg"
            alt="Info"
            className="w-[25px] h-[25px] object-contain shrink-0 block"
          />
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
                    <img
                      src="/owner/assets/icons/gravity-ui_equal.svg"
                      alt="Geser"
                      className="w-[13px] h-[13px] object-contain pointer-events-none select-none block"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Fixed Bottom Action Bar with Simpan Button */}
      <div
        id="modern-categories-sort-bottom-bar"
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
            disabled={isSaving || !hasChanged}
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
              cursor: hasChanged && !isSaving ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease'
            }}
            className={hasChanged ? 'active:scale-98 hover:bg-emerald-600' : ''}
          >
            {isSaving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
