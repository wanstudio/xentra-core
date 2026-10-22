import React, { useState, useEffect } from 'react';

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
  return 'Rp ' + num.toLocaleString('id-ID');
}

export default function ItemMasterPage({ onBack, onNavigate }) {
  const [filter, setFilter] = useState('ACTIVE');
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);
  const [leavingId, setLeavingId] = useState(null);

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

      const res = await fetch('/api/v1/admin/composed/products?active_only=0', { headers });
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
    window.location.hash = '#business/catalog';
  };

  const handleAddProduct = () => {
    if (typeof window.openAddProduct === 'function') {
      window.openAddProduct();
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/products/new');
    } else {
      window.location.hash = '#catalog/products/new';
    }
  };

  const handleCardClick = (prod) => {
    if (typeof window.openEditProduct === 'function') {
      window.openEditProduct(prod.id);
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo(`catalog/products/${encodeURIComponent(prod.id)}/edit`);
    } else {
      window.location.hash = `#catalog/products/${encodeURIComponent(prod.id)}/edit`;
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

    // Keep item visible briefly so user sees the toggle switch colors (green <-> red)
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
      style={{ boxSizing: 'border-box' }}
      className="w-full flex flex-col gap-4 pb-12 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow and Title (Identical spacing and sizing to CatalogSubHub & CategoriesPage) */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali ke Katalog & Menu"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain"
          />
        </button>
        <h1 className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0">
          Item Master
        </h1>
      </div>

      {/* 2. Main Card Container (358px wide, rounded 14px, outline #CBD5E1) */}
      <div className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke flex flex-col gap-4">
        {/* Search Input Bar (Matching Figma Mockup) */}
        <div className="w-full h-11 flex items-center px-3.5 gap-3 rounded-xl overflow-hidden bg-white hub-inset-stroke hub-search transition-all">
          <div className="w-[17px] h-[17px] relative flex items-center justify-center shrink-0">
            <svg
              className="w-[17px] h-[17px] text-[#94A3B8]"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8.75" cy="8.75" r="6.25" />
              <line x1="13.23" y1="13.23" x2="16.77" y2="16.77" />
            </svg>
          </div>
          <input
            type="search"
            aria-label="Cari nama atau kode bahan"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onSearch={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama atau kode bahan"
            className="w-full bg-transparent border-none outline-none font-medium text-slate-800 text-[13px] tracking-[0] leading-[normal] placeholder:text-[#94A3B8]"
          />
        </div>

        {/* Control Row: Filter Pills (Aktif/Nonaktif) + Add Button (+) */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('ACTIVE')}
              className={`w-[75px] h-[30px] rounded-[20px] text-[11px] font-bold cursor-pointer transition-all flex items-center justify-center border-none ${
                filter === 'ACTIVE'
                  ? 'bg-[#0F172A] text-white shadow-xs'
                  : 'bg-white text-[#94A3B8] hub-inset-stroke'
              }`}
            >
              Aktif
            </button>
            <button
              type="button"
              onClick={() => setFilter('INACTIVE')}
              className={`w-[75px] h-[30px] rounded-[20px] text-[11px] font-bold cursor-pointer transition-all flex items-center justify-center border-none ${
                filter === 'INACTIVE'
                  ? 'bg-[#0F172A] text-white shadow-xs'
                  : 'bg-white text-[#94A3B8] hub-inset-stroke'
              }`}
            >
              Nonaktif
            </button>
          </div>

          {filter === 'ACTIVE' && (
            <button
              type="button"
              onClick={handleAddProduct}
              aria-label="Tambah Item Baru"
              className="w-[30px] h-[30px] rounded-full bg-[#0F172A] hover:bg-slate-800 active:scale-95 text-white flex items-center justify-center cursor-pointer transition-all border-none shrink-0 p-0"
            >
              <img
                src="/owner/assets/icons/at-icons_plus.svg"
                alt="Tambah"
                className="w-[14px] h-[13px] shrink-0"
              />
            </button>
          )}
        </div>

        {/* Products List */}
        {loading ? (
          <div className="py-10 text-center text-sm text-[#94A3B8]">Memuat item master...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#94A3B8]">
            {searchQuery
              ? `Tidak ada item yang sesuai dengan "${searchQuery}"`
              : filter === 'ACTIVE'
              ? 'Belum ada item aktif'
              : 'Belum ada item nonaktif'}
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full">
            {filteredProducts.map((prod) => {
              const isProdActive = prod.is_active !== 0 && prod.is_active !== null;
              const isDirect = prod.inventory_type === 'DIRECT';
              const iconBg = isDirect ? '#EA4335' : '#4285F4';
              const iconSrc = isDirect
                ? '/owner/assets/icons/reicon_food-tray-filled.svg'
                : '/owner/assets/icons/lucide-extended_cooking-pot-filled.svg';
              const iconAlt = isDirect ? 'Siap Jual' : 'Pakai Resep';
              const skuText = prod.sku ? prod.sku : (prod.description || 'Belum ada SKU');
              const costText = formatMoney(prod.cost_price || 0);

              return (
                <div
                  key={prod.id}
                  onClick={() => handleCardClick(prod)}
                  className="w-full p-4 rounded-[12px] bg-white hub-inset-stroke hub-card flex items-center gap-4 active:scale-[0.99] transition-all cursor-pointer"
                >
                  {/* Left Icon: 45x45 with colored background or image */}
                  <div
                    className="w-[45px] h-[45px] rounded-[10px] flex items-center justify-center shrink-0 overflow-hidden relative"
                    style={{ backgroundColor: iconBg }}
                  >
                    {prod.image_url || prod.image ? (
                      <img
                        src={prod.image_url || prod.image}
                        alt={prod.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={iconSrc}
                        alt={iconAlt}
                        className="w-[22px] h-[22px] object-contain filter brightness-0 invert block"
                      />
                    )}
                  </div>

                  {/* Middle Text: 3 lines (Name, SKU, Cost Price) */}
                  <div className="flex-1 min-w-0 flex flex-col items-start gap-0.5">
                    <span className="font-bold text-[#0F172A] text-base leading-snug truncate w-full text-left">
                      {prod.name}
                    </span>
                    <span className="font-medium text-[#94A3B8] text-[12px] leading-snug truncate w-full text-left">
                      {skuText}
                    </span>
                    <span className="font-bold text-[#0F172A] text-[12px] leading-snug truncate w-full text-left">
                      {costText}
                    </span>
                  </div>

                  {/* Toggle SVG Button (Green/Red toggle SVG uploaded by user) */}
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
                    className="p-0 border-none bg-transparent cursor-pointer shrink-0 flex items-center justify-center transition-transform active:scale-95"
                  >
                    <img
                      src={isProdActive ? '/owner/assets/icons/green-toggle.svg' : '/owner/assets/icons/red-toggle.svg'}
                      alt={isProdActive ? 'Status Aktif (Hijau)' : 'Status Nonaktif (Merah)'}
                      className="w-[45px] h-[31px] object-contain select-none pointer-events-none block"
                    />
                  </button>

                  {/* Chevron Right */}
                  <div className="w-[13px] h-[13px] flex items-center justify-center shrink-0 -mr-1">
                    <img
                      src="/owner/assets/icons/akar-icons_chevron-right-small.svg"
                      alt=""
                      aria-hidden="true"
                      className="w-[13px] h-[13px] block"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
