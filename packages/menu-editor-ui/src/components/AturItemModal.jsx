import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2 } from 'lucide-react';

export default function AturItemModal({ isOpen, onClose, item, onSaveConfig }) {
  if (!isOpen || !item) return null;

  // Extract config
  let initialConfig = {
    mode: 'MERCHANT',
    variants: [{ name: 'Pedas', type: 'level', level: 4, active: true }],
  };

  if (item.options_config) {
    if (typeof item.options_config === 'object') {
      initialConfig = JSON.parse(JSON.stringify(item.options_config));
    } else {
      try {
        initialConfig = JSON.parse(item.options_config);
      } catch (_) {}
    }
  }

  const [mode, setMode] = useState(initialConfig.mode || 'MERCHANT');
  const [variants, setVariants] = useState(initialConfig.variants || []);

  const handleLevelChange = (vIdx, lvl) => {
    const updated = [...variants];
    updated[vIdx] = { ...updated[vIdx], level: lvl };
    setVariants(updated);
  };

  const handleAddChoice = (vIdx) => {
    const choiceName = prompt('Masukkan nama pilihan varian baru (misal: Sedang, Dingin):');
    if (!choiceName || !choiceName.trim()) return;
    const updated = [...variants];
    const currentChoices = updated[vIdx].choices || [];
    updated[vIdx] = { ...updated[vIdx], choices: [...currentChoices, choiceName.trim()] };
    setVariants(updated);
  };

  const handleRemoveChoice = (vIdx, cIdx) => {
    const updated = [...variants];
    const currentChoices = [...(updated[vIdx].choices || [])];
    currentChoices.splice(cIdx, 1);
    updated[vIdx] = { ...updated[vIdx], choices: currentChoices };
    setVariants(updated);
  };

  const handleSave = () => {
    onSaveConfig({
      mode,
      variants,
    });
    onClose();
  };

  return createPortal(
    <div id="modern-menu-portal-root">
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
        <div
          className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 m-0">Atur Varian Item</h3>
            <div className="text-xs text-slate-500 mt-0.5">{item.name}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 border-none bg-transparent cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* Mode Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
              Siapa yang Menentukan?
            </label>
            <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setMode('MERCHANT')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border-none cursor-pointer ${
                  mode === 'MERCHANT'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Kamu Mengatur
              </button>
              <button
                type="button"
                onClick={() => setMode('CUSTOMER')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border-none cursor-pointer ${
                  mode === 'CUSTOMER'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Pelanggan Memilih
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-normal">
              {mode === 'MERCHANT'
                ? 'Pilihan varian ditetapkan langsung dari dapur/owner (default fix).'
                : 'Pilihan varian akan dimunculkan kepada pelanggan saat checkout.'}
            </p>
          </div>

          {/* Variants Configuration */}
          <div className="space-y-4">
            {variants.map((v, vIdx) => {
              const isPedas = v.name === 'Pedas' || v.type === 'level';

              if (isPedas) {
                const currentLevel = Number(v.level) || 4;
                const chipColors = [
                  { bg: '#FEE2E2', border: '#FECACA' },
                  { bg: '#FCA5A5', border: '#F87171' },
                  { bg: '#F87171', border: '#EF4444' },
                  { bg: '#EF4444', border: '#DC2626' },
                  { bg: '#EF4444', border: '#B91C1C' },
                ];

                return (
                  <div key={vIdx} className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-slate-900">{v.name}</span>
                      <span className="text-xs font-bold text-slate-600">Level {currentLevel}</span>
                    </div>

                    <div className="flex gap-1.5 mb-2">
                      {[1, 2, 3, 4, 5].map((lvl) => {
                        const isFilled = lvl <= currentLevel;
                        return (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => handleLevelChange(vIdx, lvl)}
                            className="flex-1 h-9 rounded-lg border cursor-pointer transition-transform active:scale-95"
                            style={{
                              backgroundColor: isFilled ? chipColors[lvl - 1].bg : '#FFFFFF',
                              borderColor: isFilled ? chipColors[lvl - 1].border : '#CBD5E1',
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Klik kotak untuk mengatur tingkat kepedasan default
                    </div>
                  </div>
                );
              }

              // Radio / Choices
              const choices = v.choices || ['Manis', 'Tawar'];
              return (
                <div key={vIdx} className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-slate-900">{v.name}</span>
                    <button
                      type="button"
                      onClick={() => handleAddChoice(vIdx)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-lg hover:bg-green-100 cursor-pointer"
                    >
                      <Plus size={14} /> Tambah Opsi
                    </button>
                  </div>

                  <div className="space-y-2">
                    {choices.map((c, cIdx) => (
                      <div
                        key={cIdx}
                        className="flex items-center justify-between bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs font-bold text-slate-800"
                      >
                        <span>{c}</span>
                        {choices.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveChoice(vIdx, cIdx)}
                            className="text-slate-400 hover:text-red-500 border-none bg-transparent cursor-pointer p-0.5"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
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
            onClick={handleSave}
            className="flex-1 py-3 px-4 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-sm border-none cursor-pointer shadow-sm transition-colors"
          >
            Simpan Pengaturan
          </button>
        </div>
      </div>
    </div>
    </div>,
    document.body
  );
}
