import React from 'react';
import { Minus, Plus, Trash2, ChevronRight } from 'lucide-react';

export default function MenuItemCard({
  item,
  index,
  onQtyChange,
  onRemoveItem,
  onOpenPickSheet,
  onOpenAturModal,
  onRemoveVariant,
}) {
  const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

  // Parse options_config if present
  let optConfig = null;
  if (item.options_config) {
    if (typeof item.options_config === 'object') {
      optConfig = item.options_config;
    } else {
      try {
        optConfig = JSON.parse(item.options_config);
      } catch (_) {}
    }
  }

  const activeVariants = (optConfig && Array.isArray(optConfig.variants))
    ? optConfig.variants.filter((v) => !!v.active)
    : [];

  const modeLabel = optConfig?.mode === 'MERCHANT' ? 'Kamu mengatur' : 'Pelanggan memilih';

  return (
    <div className="w-full bg-white border border-slate-300 rounded-2xl p-3.5 sm:p-4 flex flex-col gap-3 transition-shadow shadow-xs hover:border-slate-400">
      {/* 1. Main Row: Left (Title + Ganti link) | Right (Stepper + Trash) */}
      <div className="flex items-center justify-between gap-3 w-full">
        {/* Left Column: Rata Kiri */}
        <div
          className="flex-1 min-w-0 cursor-pointer text-left"
          onClick={() => onOpenPickSheet(index)}
          title="Klik untuk ganti item"
        >
          <div className="text-sm font-bold text-slate-900 leading-snug break-words">
            {item.name || 'Pilih Item'}
          </div>
          <div className="text-xs text-sky-600 font-semibold mt-0.5 inline-flex items-center gap-0.5">
            <span>Ganti item</span>
            <ChevronRight size={12} className="stroke-[2.5]" />
          </div>
        </div>

        {/* Right Column: Rata Kanan */}
        <div className="flex items-center justify-end gap-2 flex-shrink-0">
          {/* Stepper */}
          <div className="inline-flex items-center border border-slate-300 rounded-xl bg-white h-9 px-0.5">
            <button
              type="button"
              onClick={() => onQtyChange(index, qty - 1)}
              aria-label="Kurangi Jumlah"
              className="w-7 h-8 flex items-center justify-center text-slate-900 border-none bg-transparent hover:bg-slate-100 rounded-lg cursor-pointer transition-colors p-0"
            >
              <Minus size={13} className="stroke-[2.5]" />
            </button>
            <span className="w-7 text-center text-sm font-bold text-slate-900 select-none">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => onQtyChange(index, qty + 1)}
              aria-label="Tambah Jumlah"
              className="w-7 h-8 flex items-center justify-center text-slate-900 border-none bg-transparent hover:bg-slate-100 rounded-lg cursor-pointer transition-colors p-0"
            >
              <Plus size={13} className="stroke-[2.5]" />
            </button>
          </div>

          {/* Delete Button */}
          <button
            type="button"
            onClick={() => onRemoveItem(index)}
            aria-label="Hapus Item"
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-red-200 bg-white text-red-500 hover:bg-red-50 hover:text-red-600 cursor-pointer transition-colors flex-shrink-0 p-0"
          >
            <Trash2 size={16} className="stroke-[1.8]" />
          </button>
        </div>
      </div>

      {/* 2. Variant Section (Matching Frame 164.png) */}
      {activeVariants.length > 0 &&
        activeVariants.map((v, vIdx) => {
          const isPedas = v.name === 'Pedas' || v.type === 'level';
          const isCustomerMode = optConfig?.mode === 'CUSTOMER';

          if (isPedas) {
            const selectedLvl = Number(v.level) || 4;
            const chipColors = [
              { bg: '#FEE2E2', border: '#FECACA' },
              { bg: '#FCA5A5', border: '#F87171' },
              { bg: '#F87171', border: '#EF4444' },
              { bg: '#EF4444', border: '#DC2626' },
              { bg: '#FFFFFF', border: '#CBD5E1' },
            ];

            return (
              <div
                key={vIdx}
                className="border-t border-slate-100 pt-3.5 w-full flex flex-col gap-2.5"
              >
                {/* Variant Mode Title */}
                <div className="text-xs font-bold text-slate-900 text-left w-full">
                  {modeLabel}: Pedas
                </div>

                {/* Left: 5 Level Chips | Right: Delete Trash */}
                <div className="flex items-center justify-between gap-3 w-full">
                  <div className="flex gap-1.5 items-center">
                    {[1, 2, 3, 4, 5].map((lvl) => {
                      const isFilled = lvl <= selectedLvl;
                      return (
                        <div
                          key={lvl}
                          className="w-8 h-8 rounded-lg flex-none border"
                          style={{
                            backgroundColor: isFilled ? chipColors[lvl - 1].bg : '#FFFFFF',
                            borderColor: isFilled ? chipColors[lvl - 1].border : '#CBD5E1',
                          }}
                        />
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveVariant(index, vIdx)}
                    aria-label="Hapus Varian"
                    className="w-9 h-9 flex items-center justify-center rounded-xl border border-red-200 bg-white text-red-500 hover:bg-red-50 cursor-pointer flex-shrink-0 p-0"
                  >
                    <Trash2 size={16} className="stroke-[1.8]" />
                  </button>
                </div>

                {/* Full Width 'Atur item' button */}
                <button
                  type="button"
                  onClick={() => onOpenAturModal(index)}
                  className="w-full h-9 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-900 font-bold text-xs cursor-pointer inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span>Atur item</span>
                </button>
              </div>
            );
          }

          // Radio Choices (e.g. Rasa: Manis / Tawar)
          const choices = v.choices || ['Manis', 'Tawar'];

          return (
            <div
              key={vIdx}
              className="border-t border-slate-100 pt-3.5 w-full flex flex-col gap-2"
            >
              <div className="text-xs font-bold text-slate-900 text-left w-full">
                {modeLabel}: {v.name}
              </div>

              {/* Left: Choices box | Right: Delete Trash */}
              <div className="flex items-start justify-between gap-3 w-full">
                <div className="w-44 bg-white border border-slate-300 rounded-xl p-2.5 flex flex-col gap-1.5">
                  {choices.map((c, cIdx) => (
                    <div
                      key={cIdx}
                      className="flex items-center justify-between py-1 text-xs font-bold text-slate-900"
                    >
                      <span>{c}</span>
                      <span className="w-4 h-4 rounded-full border-[1.5px] border-slate-400 inline-block" />
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => onRemoveVariant(index, vIdx)}
                  aria-label="Hapus Varian"
                  className="w-9 h-9 flex items-center justify-center rounded-xl border border-red-200 bg-white text-red-500 hover:bg-red-50 cursor-pointer flex-shrink-0 p-0"
                >
                  <Trash2 size={16} className="stroke-[1.8]" />
                </button>
              </div>

              {/* Subtext */}
              {isCustomerMode && (
                <div className="text-[11.5px] text-slate-500 leading-normal text-left w-full">
                  pilihan akan muncul pada saat checkout
                </div>
              )}

              {/* Full Width 'Atur item' button */}
              <button
                type="button"
                onClick={() => onOpenAturModal(index)}
                className="w-full h-9 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-900 font-bold text-xs cursor-pointer inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>Atur item</span>
              </button>
            </div>
          );
        })}
    </div>
  );
}
