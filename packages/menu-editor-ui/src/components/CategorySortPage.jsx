import React, { useState, useEffect, useRef } from 'react';

function getAuthToken() {
  try {
    const t = localStorage.getItem('xentra_merchant_token');
    if (t) return t;
  } catch (_) {}
  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function CategorySortPage({ onBack, onSaved }) {
  const [categories, setCategories] = useState([]);
  const [initialOrder, setInitialOrder] = useState([]);
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Drag and Drop State
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const touchStartY = useRef(0);
  const touchCurrentIndex = useRef(null);
  const listContainerRef = useRef(null);

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

  // Reorder Helper
  const moveCategory = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= categories.length || toIdx >= categories.length) return;
    setCategories(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  // HTML5 Drag and Drop handlers (Mouse / Desktop)
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(index));
    } catch (_) {}
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      moveCategory(draggedIndex, dropIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Touch Drag and Drop handlers (Mobile touch gesture)
  const handleTouchStart = (e, index) => {
    touchStartY.current = e.touches[0].clientY;
    touchCurrentIndex.current = index;
    setDraggedIndex(index);
  };

  const handleTouchMove = (e) => {
    if (touchCurrentIndex.current === null) return;
    const touch = e.touches[0];
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!elemBelow) return;
    const cardElem = elemBelow.closest('[data-sort-index]');
    if (cardElem) {
      const targetIndex = Number(cardElem.getAttribute('data-sort-index'));
      if (!isNaN(targetIndex) && targetIndex !== touchCurrentIndex.current) {
        moveCategory(touchCurrentIndex.current, targetIndex);
        touchCurrentIndex.current = targetIndex;
        setDraggedIndex(targetIndex);
      }
    }
  };

  const handleTouchEnd = () => {
    touchCurrentIndex.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

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
        marginLeft: '16px',
        marginRight: '16px',
        boxSizing: 'border-box'
      }}
      className="mx-4 flex flex-col gap-4 pb-36 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow and Title */}
      <div className="flex items-center gap-3 mb-2 pt-1">
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
        className="w-full rounded-2xl p-4 bg-white hub-inset-stroke flex flex-col gap-3.5 border border-zinc-300 shadow-xs"
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Instruction Header Row */}
        <div className="flex items-center gap-2 pb-1">
          <div className="w-5 h-5 flex items-center justify-center shrink-0">
            {/* Gesture / Drag Hand Icon matching Figma */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0F172A"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="7 10 12 15 17 10" />
              <polyline points="7 14 12 9 17 14" />
            </svg>
          </div>
          <span className="text-slate-400 text-xs font-bold leading-none">
            Tekan dan geser untuk mengatur urutan kategori
          </span>
        </div>

        {/* Categories List */}
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400 font-medium">
            Memuat kategori...
          </div>
        ) : categories.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400 font-medium">
            Belum ada kategori untuk diurutkan.
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-full">
            {categories.map((cat, index) => {
              const isDragging = draggedIndex === index;
              const isOver = dragOverIndex === index && !isDragging;
              const snippet = getCategorySnippet(cat);

              return (
                <div
                  key={cat.id}
                  data-sort-index={index}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`w-full p-4 rounded-xl border border-slate-300 bg-white flex items-center justify-between gap-4 select-none transition-all ${
                    isDragging
                      ? 'opacity-60 shadow-md border-emerald-500 scale-[0.99] bg-slate-50'
                      : isOver
                      ? 'border-emerald-400 bg-emerald-50/40'
                      : 'hover:border-slate-400'
                  }`}
                >
                  {/* Category Info */}
                  <div className="flex-1 min-w-0 flex flex-col justify-start items-start gap-1">
                    <div className="text-slate-900 text-base font-bold leading-snug truncate w-full text-left">
                      {cat.name}
                    </div>
                    <div className="text-slate-400 text-xs font-medium truncate w-full max-w-[260px] text-left">
                      {snippet}
                    </div>
                  </div>

                  {/* Drag Handle Grip Icon */}
                  <div
                    onTouchStart={(e) => handleTouchStart(e, index)}
                    className="w-7 h-7 flex items-center justify-center shrink-0 text-zinc-800 cursor-grab active:cursor-grabbing hover:bg-slate-100 rounded-lg transition-colors p-1"
                    title="Geser untuk mengatur urutan"
                  >
                    <svg
                      width="18"
                      height="12"
                      viewBox="0 0 18 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="pointer-events-none select-none"
                    >
                      <path
                        d="M1 2.5H17M1 9.5H17"
                        stroke="#27272A"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
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
          borderTop: '1px solid rgba(203, 213, 225, 0.9)',
          boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.08)',
          zIndex: 200,
          paddingTop: '24px',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
          paddingLeft: '16px',
          paddingRight: '16px',
          boxSizing: 'border-box'
        }}
        className="w-full bg-white rounded-t-[20px] border-t border-slate-200/90 z-[200]"
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
              border: hasChanged ? 'none' : '1px solid #E4E4E7',
              outline: 'none',
              backgroundColor: hasChanged ? '#00A637' : '#F4F4F5',
              color: hasChanged ? '#FFFFFF' : '#A1A1AA',
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
