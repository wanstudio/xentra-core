import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FONT = "'Plus Jakarta Sans', sans-serif";

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function formatMoney(amount) {
  const num = parseFloat(amount) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

export default function ItemMasterPage({ onBack, onNavigate }) {
  const [filter, setFilter] = useState('ACTIVE');
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState(() => {
    if (typeof window !== 'undefined' && window.state && Array.isArray(window.state.products) && window.state.products.length > 0) {
      return window.state.products;
    }
    if (typeof window !== 'undefined' && window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.products) && window._ownerMasterMenuState.products.length > 0) {
      return window._ownerMasterMenuState.products;
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    const hasProds = (typeof window !== 'undefined' && window.state && Array.isArray(window.state.products) && window.state.products.length > 0) ||
      (typeof window !== 'undefined' && window._ownerMasterMenuState && Array.isArray(window._ownerMasterMenuState.products) && window._ownerMasterMenuState.products.length > 0);
    return !hasProds;
  });
  const [togglingId, setTogglingId] = useState(null);
  const [leavingId, setLeavingId] = useState(null);
  const searchHistoryPushedRef = useRef(false);

  // Guard mobile back gesture when searchQuery is non-empty so back swipe clears search instead of leaving page
  useEffect(() => {
    const isApk = !!(
      (window.OwnerApp && typeof window.OwnerApp.isApk === 'function' && window.OwnerApp.isApk()) ||
      window.XentraOwnerBridge ||
      window.XentraNative
    );
    if (isApk) return;
    const hasSearch = searchQuery.trim().length > 0;
    if (hasSearch && !searchHistoryPushedRef.current) {
      try {
        const currentState = window.history.state || {};
        window.history.pushState(
          { ...currentState, __xentraSearchActive: 'item-master' },
          '',
          window.location.hash || '#catalog/products'
        );
        searchHistoryPushedRef.current = true;
      } catch (_) {}
    } else if (!hasSearch && searchHistoryPushedRef.current) {
      searchHistoryPushedRef.current = false;
      try {
        if (window.history.state && window.history.state.__xentraSearchActive === 'item-master') {
          const cleanState = { ...window.history.state };
          delete cleanState.__xentraSearchActive;
          window.history.replaceState(cleanState, '', window.location.hash || '#catalog/products');
        }
      } catch (_) {}
    }
  }, [searchQuery]);

  useEffect(() => {
    const handlePopState = () => {
      if (searchHistoryPushedRef.current) {
        searchHistoryPushedRef.current = false;
        setSearchQuery('');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const fetchProducts = async () => {
    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/v1/admin/composed/products?active_only=0&_t=${Date.now()}`, {
        headers,
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.products)) {
          setProducts(data.products);
          if (window.state) {
            window.state.products = data.products;
          }
          if (window._ownerMasterMenuState) {
            window._ownerMasterMenuState.products = data.products;
          }
        }
      }
    } catch (err) {
      console.error('[ItemMasterPage] Fetch error:', err);
      if (window.state && Array.isArray(window.state.products)) {
        setProducts(window.state.products);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (window.state && Array.isArray(window.state.products) && window.state.products.length > 0) {
      setProducts(window.state.products);
      setLoading(false);
    }
    fetchProducts();

    // Reactive State Synchronizer (Modern Mobile Pattern)
    const handleProductsUpdated = (event) => {
      if (event && event.detail && typeof event.detail === 'object') {
        const updatedItem = event.detail;
        if (updatedItem._deleted) {
          setProducts((prev) => prev.filter((p) => String(p.id) !== String(updatedItem.id)));
          if (window.state && Array.isArray(window.state.products)) {
            window.state.products = window.state.products.filter((p) => String(p.id) !== String(updatedItem.id));
          }
        } else {
          setProducts((prev) => {
            const exists = prev.some((p) => String(p.id) === String(updatedItem.id));
            return exists
              ? prev.map((p) => (String(p.id) === String(updatedItem.id) ? { ...p, ...updatedItem } : p))
              : [...prev, updatedItem];
          });
          if (window.state && Array.isArray(window.state.products)) {
            const exists = window.state.products.some((p) => String(p.id) === String(updatedItem.id));
            window.state.products = exists
              ? window.state.products.map((p) => (String(p.id) === String(updatedItem.id) ? { ...p, ...updatedItem } : p))
              : [...window.state.products, updatedItem];
          }
        }
      }
      fetchProducts();
    };

    const handleVisibilityOrResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchProducts();
      }
    };

    window.addEventListener('items-updated', handleProductsUpdated);
    window.addEventListener('products-updated', handleProductsUpdated);
    window.addEventListener('visibilitychange', handleVisibilityOrResume);
    window.addEventListener('popstate', handleVisibilityOrResume);

    return () => {
      window.removeEventListener('items-updated', handleProductsUpdated);
      window.removeEventListener('products-updated', handleProductsUpdated);
      window.removeEventListener('visibilitychange', handleVisibilityOrResume);
      window.removeEventListener('popstate', handleVisibilityOrResume);
    };
  }, []);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof window.goBackFromMasterProducts === 'function') {
      window.goBackFromMasterProducts();
      return;
    }
    if (typeof window.goBackFromChildPage === 'function') {
      window.goBackFromChildPage();
      return;
    }
    if (window.XentraNavigationController && typeof window.XentraNavigationController.back === 'function') {
      const snap = window.XentraNavigationController.getSnapshot ? window.XentraNavigationController.getSnapshot() : null;
      if (snap && snap.stack && snap.stack.length > 1) {
        window.XentraNavigationController.back();
        return;
      }
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('business');
    }
  };

  const handleAddProduct = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('catalog/products/new');
    } else if (typeof window.openAddProduct === 'function') {
      window.openAddProduct();
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/products/new');
    }
  };

  const handleCardClick = (prod) => {
    if (typeof onNavigate === 'function') {
      onNavigate(`catalog/products/${encodeURIComponent(prod.id)}/edit`);
    } else if (typeof window.openEditProduct === 'function') {
      window.openEditProduct(prod.id);
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo(`catalog/products/${encodeURIComponent(prod.id)}/edit`);
    }
  };

  const handleToggle = async (prod) => {
    if (togglingId === prod.id) return;
    const prevActive = prod.is_active !== 0 && prod.is_active !== null;
    const nextActive = !prevActive;

    setTogglingId(prod.id);
    setLeavingId(prod.id);

    // Immediate visual update to the new toggle state
    setProducts((prev) =>
      prev.map((p) => (String(p.id) === String(prod.id) ? { ...p, is_active: nextActive ? 1 : 0 } : p))
    );

    // Keep item visible briefly so user sees the toggle switch animation
    setTimeout(() => {
      setLeavingId((current) => (current === prod.id ? null : current));
    }, 350);

    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/composed/products/${encodeURIComponent(prod.id)}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_active: nextActive })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengubah status item');
      }

      if (data.product) {
        setProducts((prev) =>
          prev.map((p) => (String(p.id) === String(data.product.id) ? data.product : p))
        );
        if (window.state && Array.isArray(window.state.products)) {
          const idx = window.state.products.findIndex((p) => String(p.id) === String(data.product.id));
          if (idx >= 0) window.state.products[idx] = data.product;
        }
      }
    } catch (err) {
      console.error('[ItemMasterPage] Toggle error:', err);
      // Revert optimistic update
      setProducts((prev) =>
        prev.map((p) => (String(p.id) === String(prod.id) ? { ...p, is_active: prevActive ? 1 : 0 } : p))
      );
      if (typeof window.showToast === 'function') {
        window.showToast('❌ ' + err.message);
      }
    } finally {
      setTogglingId(null);
    }
  };

  const filteredProducts = products.filter((prod) => {
    if (leavingId === prod.id) return true;
    const isAct = prod.is_active !== 0 && prod.is_active !== null;
    const matchesStatus = filter === 'ACTIVE' ? isAct : !isAct;
    if (!matchesStatus) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      String(prod.name || '').toLowerCase().includes(q) ||
      String(prod.sku || '').toLowerCase().includes(q) ||
      String(prod.description || '').toLowerCase().includes(q)
    );
  });

  return (
    <div
      id="modern-item-master-page-root"
      style={{ boxSizing: 'border-box', fontFamily: FONT, paddingBottom: '96px' }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto select-none font-sans"
    >
      {/* 1. Header with Back Arrow and Title (Identical spacing and sizing to CategoriesPage & CatalogSubHub) */}
      <div className="flex items-center gap-3 mb-6" style={{ marginBottom: '24px' }}>
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain block"
          />
        </button>
        <h1
          style={{ color: '#0F172A', fontSize: '18px', fontFamily: FONT, fontWeight: 700, lineHeight: '18px' }}
          className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0 text-left"
        >
          Item Master
        </h1>
      </div>

      {/* 2. Main Card Container (Figma: padding 16, radius 14, outline 0.5px #D9D9D9, gap 16) */}
      <div
        style={{
          borderRadius: '14px',
          outline: '0.50px #D9D9D9 solid',
          outlineOffset: '-0.50px',
          padding: '16px',
          backgroundColor: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxSizing: 'border-box',
          width: '100%',
        }}
        className="w-full bg-white flex flex-col"
      >
        {/* Search Input Bar (Figma: height 48, radius 14, outline 1px #CBD5E1, placeholder 'Cari nama atau kode item' #94A3B8, font 13/500) */}
        <div
          style={{
            height: '48px',
            borderRadius: '14px',
            outline: '1px #CBD5E1 solid',
            outlineOffset: '-1px',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: '16px',
            paddingRight: '16px',
            backgroundColor: '#FFFFFF',
            boxSizing: 'border-box',
            width: '100%',
          }}
          className="w-full relative overflow-hidden flex items-center bg-white focus-within:[outline-color:#0F172A] transition-all"
        >
          <div style={{ width: '17px', height: '17px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: '15px' }}>
            <svg
              width="17"
              height="17"
              viewBox="0 0 18 18"
              fill="none"
              stroke="#94A3B8"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="5.5" />
              <line x1="12" y1="12" x2="16" y2="16" />
            </svg>
          </div>
          <input
            type="search"
            aria-label="Cari nama atau kode item"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onSearch={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama atau kode item"
            style={{
              fontSize: '13px',
              fontFamily: FONT,
              fontWeight: 500,
              color: '#0F172A',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              width: '100%',
              height: '100%',
              padding: 0,
              boxSizing: 'border-box',
            }}
            className="w-full bg-transparent border-none outline-none placeholder-[#94A3B8]"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              aria-label="Bersihkan pencarian"
              onClick={() => setSearchQuery('')}
              className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 flex items-center justify-center text-slate-500 border-none cursor-pointer shrink-0 p-0 transition-all ml-2"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
                <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
              </svg>
            </button>
          )}
        </div>

        {/* Filter Pills: Aktif / Nonaktif (Figma: width 75, height 30, radius 20, font 11/700) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', alignSelf: 'stretch' }}>
          <button
            type="button"
            onClick={() => setFilter('ACTIVE')}
            style={{
              width: '75px',
              height: '30px',
              borderRadius: '20px',
              backgroundColor: filter === 'ACTIVE' ? '#0F172A' : '#FFFFFF',
              color: filter === 'ACTIVE' ? '#FFFFFF' : '#94A3B8',
              outline: filter === 'ACTIVE' ? '1px #0F172A solid' : '1px #CBD5E1 solid',
              outlineOffset: '-1px',
              fontSize: '11px',
              fontFamily: FONT,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              border: 'none',
              padding: 0,
              transition: 'all 0.15s ease',
            }}
            className="active:scale-95"
          >
            Aktif
          </button>
          <button
            type="button"
            onClick={() => setFilter('INACTIVE')}
            style={{
              width: '75px',
              height: '30px',
              borderRadius: '20px',
              backgroundColor: filter === 'INACTIVE' ? '#0F172A' : '#FFFFFF',
              color: filter === 'INACTIVE' ? '#FFFFFF' : '#94A3B8',
              outline: filter === 'INACTIVE' ? '1px #0F172A solid' : '1px #CBD5E1 solid',
              outlineOffset: '-1px',
              fontSize: '11px',
              fontFamily: FONT,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              border: 'none',
              padding: 0,
              transition: 'all 0.15s ease',
            }}
            className="active:scale-95"
          >
            Nonaktif
          </button>
        </div>

        {/* Products List */}
        {loading ? (
          <div className="py-12 text-center text-[13px] font-medium text-[#94A3B8]">Memuat item master...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="py-12 text-center text-[13px] font-medium text-[#94A3B8]">
            {searchQuery
              ? `Tidak ada item yang sesuai dengan "${searchQuery}"`
              : filter === 'ACTIVE'
              ? 'Belum ada item aktif'
              : 'Belum ada item nonaktif'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
            {filteredProducts.map((prod) => {
              const isProdActive = prod.is_active !== 0 && prod.is_active !== null;
              const isDirect = prod.inventory_type === 'DIRECT';
              const iconBg = isDirect ? '#EA4335' : '#4285F4';
              const iconSrc = isDirect
                ? '/owner/assets/icons/reicon_food-tray-filled.svg'
                : '/owner/assets/icons/lucide-extended_cooking-pot-filled.svg';
              const iconAlt = isDirect ? 'Siap Jual' : 'Pakai Resep';
              const skuText = prod.sku ? prod.sku : (prod.description || 'KODE-SKU-0001');
              const priceText = formatMoney(prod.cost_price ?? prod.price ?? 0);

              return (
                <div
                  key={prod.id}
                  onClick={() => handleCardClick(prod)}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    outline: '1px #CBD5E1 solid',
                    outlineOffset: '-1px',
                    backgroundColor: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    width: '100%',
                    boxSizing: 'border-box',
                    cursor: 'pointer',
                  }}
                  className="w-full active:scale-[0.99] transition-all hover:bg-slate-50/50"
                >
                  {/* Left Icon/Image: 45x45 radius 10 */}
                  <div
                    style={{
                      width: '45px',
                      height: '45px',
                      borderRadius: '10px',
                      backgroundColor: iconBg,
                      position: 'relative',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {prod.image_url || prod.image ? (
                      <img
                        src={prod.image_url || prod.image}
                        alt={prod.name}
                        style={{ width: '45px', height: '45px', borderRadius: '10px', objectFit: 'cover' }}
                      />
                    ) : (
                      <img
                        src={iconSrc}
                        alt={iconAlt}
                        style={{ width: '22px', height: '22px', objectFit: 'contain', filter: 'brightness(0) invert(1)', display: 'block' }}
                      />
                    )}
                  </div>

                  {/* Middle Info Column: Name (16/700 #0F172A), SKU (10/500 #979797), Price (10/700 #0F172A) */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-start',
                      alignItems: 'flex-start',
                      gap: '2px',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        color: '#0F172A',
                        fontSize: '16px',
                        fontFamily: FONT,
                        fontWeight: 700,
                        wordWrap: 'break-word',
                        lineHeight: '1.25',
                      }}
                      className="truncate w-full"
                    >
                      {prod.name}
                    </div>
                    <div
                      style={{
                        color: '#979797',
                        fontSize: '10px',
                        fontFamily: FONT,
                        fontWeight: 500,
                        wordWrap: 'break-word',
                        lineHeight: '1.2',
                      }}
                      className="truncate w-full"
                    >
                      {skuText}
                    </div>
                    <div
                      style={{
                        color: '#0F172A',
                        fontSize: '10px',
                        fontFamily: FONT,
                        fontWeight: 700,
                        wordWrap: 'break-word',
                        lineHeight: '1.2',
                      }}
                      className="truncate w-full"
                    >
                      {priceText}
                    </div>
                  </div>

                  {/* Right Toggle Switch (Figma: 35x21, radius 100, green #00A637 / #E2E8F0, thumb 21x21, 90deg tick) */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isProdActive}
                    aria-label={`Ubah status ${prod.name}`}
                    disabled={togglingId === prod.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(prod);
                    }}
                    style={{
                      width: '35px',
                      height: '21px',
                      borderRadius: '100px',
                      backgroundColor: isProdActive ? '#00A637' : '#EF4444',
                      outline: isProdActive ? '0.50px #009A33 solid' : '0.50px #EF4444 solid',
                      outlineOffset: '-0.50px',
                      boxShadow: '-1px 2px 5px rgba(0, 0, 0, 0.15)',
                      border: 'none',
                      cursor: togglingId === prod.id ? 'not-allowed' : 'pointer',
                      position: 'relative',
                      overflow: 'hidden',
                      padding: 0,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      transition: 'background-color 200ms ease, box-shadow 200ms ease',
                    }}
                    className="active:scale-95 transition-transform"
                  >
                    <div
                      style={{
                        width: '21px',
                        height: '21px',
                        backgroundColor: '#FFFFFF',
                        borderRadius: '9999px',
                        boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.15)',
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        transform: isProdActive ? 'translateX(14px)' : 'translateX(0px)',
                        transition: 'transform 200ms ease-out',
                      }}
                    />
                    <div
                      aria-hidden="true"
                      style={{
                        width: '7px',
                        height: '0px',
                        left: '6px',
                        top: '7px',
                        position: 'absolute',
                        transform: 'rotate(90deg)',
                        transformOrigin: 'top left',
                        outline: '1px white solid',
                        outlineOffset: '-0.50px',
                        opacity: isProdActive ? 1 : 0,
                        transition: 'opacity 150ms ease-out',
                      }}
                    />
                  </button>

                  {/* Chevron Right (Figma: 13x13 with 1.08px #303030) */}
                  <div
                    style={{
                      width: '13px',
                      height: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <path
                        d="M4.88 3.25L8.13 6.50L4.88 9.75"
                        stroke="#303030"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Fixed Bottom Action Bar rendered via React Portal (Figma: 390x110 top radius 20, shadow, button #00A637 'Tambah') */}
      {typeof document !== 'undefined' && createPortal(
        <div
          id="modern-item-master-bottom-bar"
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
            boxSizing: 'border-box',
          }}
          className="w-full bg-white rounded-t-[20px] z-[200]"
        >
          <div className="w-full max-w-lg mx-auto">
            <button
              type="button"
              onClick={handleAddProduct}
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
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              className="active:scale-[0.98] hover:bg-emerald-600 shadow-sm"
            >
              Tambah
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
