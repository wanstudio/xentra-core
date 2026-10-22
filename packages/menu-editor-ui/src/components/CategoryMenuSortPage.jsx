import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';

function getAuthToken() {
  try {
    const t = localStorage.getItem('xentra_merchant_token');
    if (t) return t;
  } catch (_) {}
  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function formatRupiah(amount) {
  const num = Number(amount) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

function triggerHaptic(ms = 8) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch (_) {}
}

export default function CategoryMenuSortPage({ categoryId, onBack, onSaved }) {
  const [category, setCategory] = useState(null);
  const [menus, setMenus] = useState([]);
  const [initialOrder, setInitialOrder] = useState([]);
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
    const targetRoute = categoryId
      ? `catalog/categories/${encodeURIComponent(categoryId)}`
      : 'catalog/categories';
    if (typeof window.navigateTo === 'function') {
      window.navigateTo(targetRoute);
      return;
    }
    window.location.hash = `#${targetRoute}`;
  };

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      // Seed from existing cache if available
      if (window.state && Array.isArray(window.state.categories)) {
        const found = window.state.categories.find((c) => c && String(c.id) === String(categoryId));
        if (found) setCategory(found);
      }

      if (window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.menus)) {
        const related = window._ownerMasterMenuState.menus
          .filter((m) => {
            if (!m) return false;
            const cId = m.category_id || (m.category && m.category.id);
            return String(cId || '') === String(categoryId || '');
          })
          .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

        if (related.length > 0) {
          setMenus(related);
          setInitialOrder(related.map((m) => String(m.id)));
          setLoading(false);
        }
      }

      try {
        const token = getAuthToken();
        const headers = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const [catRes, menuRes] = await Promise.all([
          fetch('/api/v1/admin/categories', { headers }).catch(() => null),
          fetch('/api/v1/admin/menus', { headers }).catch(() => null),
        ]);

        if (catRes && catRes.ok) {
          const catData = await catRes.json().catch(() => null);
          if (catData && catData.success && Array.isArray(catData.categories) && isMounted) {
            if (window.state) window.state.categories = catData.categories;
            const found = catData.categories.find((c) => c && String(c.id) === String(categoryId));
            if (found) setCategory(found);
          }
        }

        if (menuRes && menuRes.ok) {
          const menuData = await menuRes.json().catch(() => null);
          if (menuData && menuData.success && Array.isArray(menuData.menus) && isMounted) {
            if (window._ownerMasterMenuState) {
              window._ownerMasterMenuState.menus = menuData.menus;
            }
            const related = menuData.menus
              .filter((m) => {
                if (!m) return false;
                const cId = m.category_id || (m.category && m.category.id);
                return String(cId || '') === String(categoryId || '');
              })
              .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

            setMenus(related);
            setInitialOrder(related.map((m) => String(m.id)));
          }
        }
      } catch (err) {
        console.error('[CategoryMenuSortPage] Load error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [categoryId]);

  const getMenuTitle = (m) => {
    if (!m) return 'Menu';
    return m.title_name || m.package_name || m.title || m.name || 'Menu Tanpa Judul';
  };

  const getMenuCompositionSubtitle = (m) => {
    if (!m) return '';
    if (m.description && String(m.description).trim()) {
      return String(m.description).trim();
    }
    const list = Array.isArray(m.components)
      ? m.components
      : Array.isArray(m.items)
      ? m.items
      : [];
    if (list.length > 0) {
      const names = list
        .map((c) => c && (c.product_name || c.name || c.title))
        .filter(Boolean);
      if (names.length > 0) {
        return names.join(' + ');
      }
    }
    return m.sub_category_name || 'Menu komersial';
  };

  const getMenuPrice = (m) => {
    if (!m) return 'Rp0';
    const price =
      m.selling_price !== undefined
        ? m.selling_price
        : m.price !== undefined
        ? m.price
        : m.min_price || 0;
    return formatRupiah(price);
  };

  const getMenuImage = (m) => {
    if (!m) return '';
    return m.image_url || m.image || '';
  };

  // Check if order has changed
  const currentOrderIds = menus.map((m) => String(m.id));
  const hasChanged =
    currentOrderIds.length > 0 &&
    currentOrderIds.some((id, idx) => id !== initialOrder[idx]);

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
        void node.offsetHeight;
        node.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
        node.style.transform = 'translate3d(0, 0, 0)';
      }
    });

    prevTopsRef.current = new Map();
  }, [menus, activeId]);

  // Pointer-based smooth drag & drop
  const startPointerDrag = (clientY, menuId, index) => {
    const node = cardRefs.current.get(String(menuId));
    const rect = node ? node.getBoundingClientRect() : { height: 120 };
    const pitch = (rect.height || 120) + 16;

    dragSessionRef.current = {
      id: String(menuId),
      currentIndex: index,
      anchorY: clientY,
      pitch,
    };

    setIsSettling(false);
    setActiveId(String(menuId));
    setDragOffsetY(0);
    triggerHaptic(10);
  };

  const updatePointerDrag = useCallback(
    (clientY) => {
      const session = dragSessionRef.current;
      if (!session) return;

      let dy = clientY - session.anchorY;
      const threshold = session.pitch * 0.52;

      if (dy > threshold && session.currentIndex < menus.length - 1) {
        const fromIdx = session.currentIndex;
        const toIdx = fromIdx + 1;
        const targetItem = menus[toIdx];
        const targetNode = targetItem ? cardRefs.current.get(String(targetItem.id)) : null;
        const stepPitch = targetNode
          ? targetNode.getBoundingClientRect().height + 16
          : session.pitch;

        capturePositions();
        session.currentIndex = toIdx;
        session.anchorY += stepPitch;
        dy = clientY - session.anchorY;
        setMenus((prev) => {
          const next = [...prev];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return next;
        });
        triggerHaptic(6);
      } else if (dy < -threshold && session.currentIndex > 0) {
        const fromIdx = session.currentIndex;
        const toIdx = fromIdx - 1;
        const targetItem = menus[toIdx];
        const targetNode = targetItem ? cardRefs.current.get(String(targetItem.id)) : null;
        const stepPitch = targetNode
          ? targetNode.getBoundingClientRect().height + 16
          : session.pitch;

        capturePositions();
        session.currentIndex = toIdx;
        session.anchorY -= stepPitch;
        dy = clientY - session.anchorY;
        setMenus((prev) => {
          const next = [...prev];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return next;
        });
        triggerHaptic(6);
      }

      setDragOffsetY(dy);
    },
    [menus, capturePositions]
  );

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

  // Save reordered menus
  const handleSaveOrder = async () => {
    if (!hasChanged || isSaving) return;
    setIsSaving(true);
    try {
      const token = getAuthToken();
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const orderedIds = menus.map((m) => m.id);
      const res = await fetch('/api/v1/admin/menus/reorder', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          category_id: categoryId,
          order: orderedIds,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Gagal menyimpan urutan menu.');
      }

      if (window.showToast) {
        window.showToast('✓ Urutan menu berhasil disimpan.');
      }

      if (window._ownerMasterMenuState && Array.isArray(data.menus)) {
        window._ownerMasterMenuState.menus = data.menus;
      }

      setInitialOrder(orderedIds.map(String));

      if (typeof onSaved === 'function') {
        onSaved(data.menus || menus);
      } else {
        handleBack();
      }
    } catch (err) {
      console.error('[CategoryMenuSortPage] Save order error:', err);
      if (window.showToast) {
        window.showToast('❌ ' + (err.message || 'Gagal menyimpan urutan menu.'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const categoryName = category && category.name ? category.name : 'Kategori';

  return (
    <div
      id="modern-category-menu-sort-page-root"
      style={{
        boxSizing: 'border-box',
      }}
      className="w-full flex flex-col gap-4 pb-36 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow, "Urutkan menu", and Subtitle "Kategori: ..." */}
      <div className="flex items-center gap-3 mb-6 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali ke Detail Kategori"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain"
          />
        </button>
        <div className="flex flex-col justify-center items-start gap-1 min-w-0 flex-1">
          <h1 className="font-bold text-[#0F172A] text-lg tracking-[0] leading-[18px] m-0 truncate w-full text-left">
            Urutkan menu
          </h1>
          <div className="text-[#94A3B8] text-[11px] font-medium leading-tight truncate w-full text-left">
            Kategori: {categoryName}
          </div>
        </div>
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
            Tekan dan geser untuk mengatur urutan menu
          </span>
        </div>

        {/* Menus List */}
        {loading ? (
          <div className="py-12 text-center text-sm text-[#94A3B8] font-medium">
            Memuat daftar menu...
          </div>
        ) : menus.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#94A3B8] font-medium">
            Belum ada menu untuk diurutkan dalam kategori ini.
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full relative">
            {menus.map((menu, index) => {
              const isDragging = String(activeId) === String(menu.id);
              const imgUrl = getMenuImage(menu);
              const titleText = getMenuTitle(menu);
              const subtitleText = getMenuCompositionSubtitle(menu);
              const priceText = getMenuPrice(menu);

              return (
                <div
                  key={menu.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(String(menu.id), el);
                    else cardRefs.current.delete(String(menu.id));
                  }}
                  data-sort-index={index}
                  onPointerDown={(e) => {
                    if (e.button !== undefined && e.button !== 0) return;
                    e.preventDefault();
                    startPointerDrag(e.clientY, menu.id, index);
                  }}
                  style={{
                    touchAction: 'none',
                    zIndex: isDragging ? 30 : 1,
                    transform: isDragging
                      ? `translate3d(0, ${dragOffsetY}px, 0) scale(${isSettling ? 1 : 1.025})`
                      : undefined,
                    transition: isDragging
                      ? isSettling
                        ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease'
                        : 'box-shadow 150ms ease'
                      : undefined,
                    willChange: 'transform',
                  }}
                  className={`w-full p-4 rounded-[12px] bg-white flex items-center justify-between gap-[15px] select-none cursor-grab active:cursor-grabbing ${
                    isDragging ? 'hub-card-dragging' : 'hub-inset-stroke hub-card'
                  }`}
                >
                  {/* Left: 71x71 Thumbnail + Text Column */}
                  <div className="flex items-start gap-[15px] flex-1 min-w-0 pointer-events-none">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={titleText}
                        className="w-[71px] h-[71px] rounded-[10px] object-cover shrink-0 bg-slate-100 block"
                      />
                    ) : (
                      <div className="w-[71px] h-[71px] rounded-[10px] bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
                        <img
                          src="/owner/assets/icons/reicon_food-tray-filled.svg"
                          alt=""
                          className="w-7 h-7 opacity-30 object-contain"
                        />
                      </div>
                    )}

                    <div className="flex-1 min-w-0 flex flex-col items-start gap-2 text-left">
                      <div className="w-full text-[#0F172A] text-base font-bold leading-snug break-words">
                        {titleText}
                      </div>
                      <div className="w-full text-[#94A3B8] text-[13px] font-medium leading-snug break-words">
                        {subtitleText}
                      </div>
                      <div className="text-[#0F172A] text-[13px] font-bold leading-snug">
                        {priceText}
                      </div>
                    </div>
                  </div>

                  {/* Right: Drag Handle Grip Icon (13x13 gravity-ui_equal.svg) */}
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
        id="modern-category-menu-sort-bottom-bar"
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
          boxSizing: 'border-box',
        }}
        className="animate-sticky-swipe-up"
      >
        <div
          style={{
            maxWidth: '512px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <button
            type="button"
            disabled={!hasChanged || isSaving}
            onClick={handleSaveOrder}
            style={{
              width: '100%',
              height: '48px',
              borderRadius: '9999px',
              backgroundColor: hasChanged ? '#00A637' : '#F2F2F2',
              border: 'none',
              outline: 'none',
              color: hasChanged ? '#ffffff' : '#979797',
              fontSize: '14px',
              fontWeight: 700,
              cursor: hasChanged && !isSaving ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
            }}
            className={hasChanged && !isSaving ? 'active:scale-[0.98]' : ''}
          >
            {isSaving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
