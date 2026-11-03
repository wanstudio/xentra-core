import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search } from 'lucide-react';

function formatRupiah(amount) {
  const num = Number(amount) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

// Color palette for fallback icon badges when product has no image
const BADGE_COLORS = ['#EA4335', '#4285F4', '#34A853', '#FBBC05', '#8E44AD'];

function getBadgeColor(id, index) {
  if (typeof id === 'string') {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }
    return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
  }
  return BADGE_COLORS[(index || 0) % BADGE_COLORS.length];
}

export default function PickItemSheet({
  isOpen,
  onClose,
  products = [],
  categories = [],
  onSelectProduct,
  initialSelectedId = null,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tempSelectedId, setTempSelectedId] = useState(initialSelectedId);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Sync initialSelectedId when sheet opens
  useEffect(() => {
    if (isOpen) {
      setTempSelectedId(initialSelectedId);
      setSearchQuery('');
    }
  }, [isOpen, initialSelectedId]);

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

  // Lock body scroll when picker sheet is open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // Filter products by search query (name, sku, or category)
  const filteredProducts = useMemo(() => {
    if (!Array.isArray(products)) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;

    return products.filter((p) => {
      const matchName = String(p.name || '').toLowerCase().includes(q);
      const matchSku = String(p.sku || p.barcode || '').toLowerCase().includes(q);
      const matchCat = String(p.category_name || '').toLowerCase().includes(q);
      return matchName || matchSku || matchCat;
    });
  }, [products, searchQuery]);

  if (!isOpen) return null;

  const canSubmit = Boolean(tempSelectedId);

  const handleItemClick = (p) => {
    setTempSelectedId(p.id);
  };

  const handleConfirm = () => {
    if (!canSubmit) return;
    const found = products.find((p) => String(p.id) === String(tempSelectedId));
    if (found && typeof onSelectProduct === 'function') {
      onSelectProduct(found);
    }
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  const sheetContent = (
    <div id="modern-menu-portal-root">
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[99999] flex flex-col justify-end items-center bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={(e) => {
          if (e.target === e.currentTarget && typeof onClose === 'function') {
            onClose();
          }
        }}
      >
        {/* Modal Container */}
        <div
          style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
          className="w-full max-w-[447px] sm:max-w-md bg-white rounded-t-[20px] max-h-[85vh] flex flex-col overflow-hidden shadow-2xl transition-transform animate-sticky-swipe-up"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle bar (40px x 5px #D9D9D9 centered) */}
          <div className="w-full flex justify-center pt-6 pb-4 shrink-0">
            <div
              style={{
                width: '40px',
                height: '5px',
                backgroundColor: '#D9D9D9',
                borderRadius: '9999px',
              }}
            />
          </div>

          {/* Header (Title: Pilih item + Close X button) */}
          <div className="flex items-center justify-between px-4 pb-3 shrink-0">
            <h3
              style={{
                color: '#0F172A',
                fontSize: '18px',
                fontWeight: 700,
                lineHeight: '18px',
              }}
              className="m-0 text-left"
            >
              Pilih item
            </h3>
            <button
              type="button"
              aria-label="Tutup"
              onClick={onClose}
              className="p-1 rounded-full text-[#94A3B8] hover:text-[#0F172A] hover:bg-slate-100 border-none bg-transparent cursor-pointer transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Search Bar Input */}
          <div className="px-4 pb-4 shrink-0">
            <div
              style={{
                height: '48px',
                borderRadius: '14px',
                outline: '1px #CBD5E1 solid',
                outlineOffset: '-1px',
              }}
              className="w-full relative overflow-hidden flex items-center px-4 gap-3 bg-white focus-within:outline-[#0F172A] focus-within:outline-2 transition-all"
            >
              <Search size={17} className="text-[#94A3B8] shrink-0 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari menu atau pengaturan bisnis"
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
                className="w-full h-full bg-transparent border-none outline-none text-[#0F172A] placeholder-[#94A3B8]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-1 text-[#94A3B8] hover:text-[#0F172A] border-none bg-transparent cursor-pointer"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>

          {/* Scrollable Products List */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-3 overscroll-contain">
            {filteredProducts.length === 0 ? (
              <div className="py-12 text-center text-[13px] font-medium text-[#94A3B8]">
                Tidak ada item yang sesuai
              </div>
            ) : (
              filteredProducts.map((p, idx) => {
                const isSelected =
                  String(tempSelectedId) === String(p.id) ||
                  String(initialSelectedId) === String(p.id);
                const availablePrice = [
                  p.price,
                  p.selling_price,
                  p.regular_price,
                  p.cogs,
                  p.cost_price,
                ].find((value) => value !== null && value !== undefined && value !== '' && Number(value) > 0);
                const priceFormatted = formatRupiah(availablePrice ?? 0);
                const skuDisplay = p.sku || p.barcode || 'KODE-SKU-0001';
                const imageSrc = p.image_url || p.image || p.photo;
                const badgeBg = getBadgeColor(p.id, idx);

                return (
                  <div
                    key={p.id || idx}
                    data-product-pick-id={p.id}
                    onClick={() => handleItemClick(p)}
                    style={{
                      padding: '16px',
                      backgroundColor: '#FFFFFF',
                      borderRadius: '10px',
                      outline: '1px #D1D3D9 solid',
                      outlineOffset: '-1px',
                    }}
                    className={`w-full flex items-center justify-between gap-4 cursor-pointer transition-all active:scale-[0.99] hover:bg-slate-50/80 select-none ${
                      isSelected ? 'bg-[#F8FAF9]' : 'bg-white'
                    }`}
                  >
                    {/* Left: Thumbnail (45x45, radius 10) */}
                    {imageSrc ? (
                      <img
                        src={imageSrc}
                        alt={p.name}
                        style={{ width: '45px', height: '45px', borderRadius: '10px' }}
                        className="object-cover shrink-0 select-none pointer-events-none"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '45px',
                          height: '45px',
                          borderRadius: '10px',
                          backgroundColor: badgeBg,
                        }}
                        className="flex items-center justify-center shrink-0 relative overflow-hidden"
                      >
                        {/* Cloche / Dish Icon */}
                        <svg
                          width="23"
                          height="23"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="text-white"
                        >
                          <path
                            d="M12 4C12.5523 4 13 4.44772 13 5V5.1C16.9247 5.56831 20 8.92211 20 13H4C4 8.92211 7.07529 5.56831 11 5.1V5C11 4.44772 11.4477 4 12 4Z"
                            fill="white"
                          />
                          <rect x="3" y="15" width="18" height="2.5" rx="1" fill="white" />
                        </svg>
                      </div>
                    )}

                    {/* Middle: Title, SKU, Price */}
                    <div className="flex-1 min-w-0 flex flex-col items-start gap-0.5 text-left">
                      <div
                        style={{
                          color: '#0F172A',
                          fontSize: '13px',
                          fontWeight: 700,
                          lineHeight: '1.25',
                        }}
                        className="truncate w-full"
                      >
                        {p.name}
                      </div>
                      <div
                        style={{
                          color: '#979797',
                          fontSize: '10px',
                          fontWeight: 500,
                          lineHeight: '1.2',
                        }}
                        className="truncate w-full"
                      >
                        {skuDisplay}
                      </div>
                      <div
                        style={{
                          color: '#0F172A',
                          fontSize: '10px',
                          fontWeight: 700,
                          lineHeight: '1.2',
                        }}
                        className="truncate w-full"
                      >
                        {priceFormatted}
                      </div>
                    </div>

                    {/* Right: Radio Selection Indicator (20x20) */}
                    <div
                      style={{ width: '20px', height: '20px' }}
                      className="relative shrink-0 flex items-center justify-center"
                    >
                      {isSelected ? (
                        <div
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '9999px',
                            border: '1.5px solid #00A637',
                          }}
                          className="flex items-center justify-center bg-white"
                        >
                          <div
                            style={{
                              width: '9px',
                              height: '9px',
                              backgroundColor: '#00A637',
                              borderRadius: '9999px',
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '9999px',
                            border: '1.5px solid #CBD5E1',
                          }}
                          className="bg-white"
                        />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Bar Keputusan */}
          <div
            style={{
              width: '100%',
              backgroundColor: '#FFFFFF',
              boxShadow: '0px 0px 15px rgba(0, 0, 0, 0.15)',
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              paddingTop: '24px',
              paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
              paddingLeft: '16px',
              paddingRight: '16px',
              boxSizing: 'border-box',
            }}
            className="w-full shrink-0 z-10"
          >
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleConfirm}
              style={{
                width: '100%',
                height: '48px',
                borderRadius: '9999px',
                backgroundColor: canSubmit ? '#00A637' : '#F2F2F2',
                color: canSubmit ? '#FFFFFF' : '#979797',
                fontSize: '14px',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontWeight: 700,
                border: 'none',
                outline: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                transition: 'background-color 150ms ease, color 150ms ease, transform 100ms ease',
              }}
              className={canSubmit ? 'active:scale-[0.98] hover:bg-[#009230]' : ''}
            >
              Tambah
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(sheetContent, document.body)
    : sheetContent;
}
