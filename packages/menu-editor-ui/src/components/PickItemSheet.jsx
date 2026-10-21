import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Search } from 'lucide-react';

export default function PickItemSheet({
  isOpen,
  onClose,
  products = [],
  categories = [],
  onSelectProduct,
  initialSelectedId = null,
}) {
  const [selectedCatId, setSelectedCatId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [tempSelectedId, setTempSelectedId] = useState(initialSelectedId);

  // Filter products by category and search
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Category filter
      if (selectedCatId !== 'all') {
        if (String(p.category_id) !== String(selectedCatId)) {
          return false;
        }
      }
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (p.name || '').toLowerCase().includes(q);
        const matchCat = (p.category_name || '').toLowerCase().includes(q);
        if (!matchName && !matchCat) return false;
      }
      return true;
    });
  }, [products, selectedCatId, searchQuery]);

  if (!isOpen) return null;

  return createPortal(
    <div id="modern-menu-portal-root">
      <div className="fixed inset-0 z-[99999] flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-fade-in">
        <div
          className="w-full bg-white rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl transition-transform"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Handle bar */}
        <div className="w-full flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900 m-0">Pilih Item</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 border-none bg-transparent cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search Input */}
        <div className="px-5 pt-3 pb-2">
          <div className="relative flex items-center">
            <Search size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari nama item..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-green-500 focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex gap-2 px-5 py-2 overflow-x-auto no-scrollbar border-b border-slate-100">
          <button
            type="button"
            onClick={() => setSelectedCatId('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors border ${
              selectedCatId === 'all'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Semua
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCatId(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors border ${
                String(selectedCatId) === String(cat.id)
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Products List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 divide-y divide-slate-100">
          {filteredProducts.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Tidak ada item yang sesuai
            </div>
          ) : (
            filteredProducts.map((p) => {
              const isSelected = String(tempSelectedId) === String(p.id);
              const priceFormatted = new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0,
              }).format(p.price || p.cogs || 0);

              return (
                <div
                  key={p.id}
                  data-product-pick-id={p.id}
                  onClick={() => setTempSelectedId(p.id)}
                  className="flex items-center justify-between py-3.5 cursor-pointer hover:bg-slate-50/80 -mx-2 px-2 rounded-xl transition-colors"
                >
                  <div className="flex-1 pr-3">
                    <div className="text-sm font-bold text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {p.category_name || 'Item'} · {priceFormatted}
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'border-green-600 bg-green-600'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 bg-white flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold text-sm cursor-pointer hover:bg-slate-50 transition-colors"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={!tempSelectedId}
            onClick={() => {
              const found = products.find((p) => String(p.id) === String(tempSelectedId));
              if (found) onSelectProduct(found);
              onClose();
            }}
            className={`flex-1 py-3 px-4 rounded-xl text-white font-bold text-sm border-none cursor-pointer transition-colors ${
              tempSelectedId
                ? 'bg-green-600 hover:bg-green-700 shadow-sm'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            Pilih Item
          </button>
        </div>
      </div>
    </div>
    </div>,
    document.body
  );
}
