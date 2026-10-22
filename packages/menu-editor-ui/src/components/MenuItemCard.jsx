import React from 'react';

function TrashSvg() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="pointer-events-none block"
    >
      <path
        d="M2.125 4.25H3.54167H14.875"
        stroke="#FA3E3E"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.66666 4.25008V2.83341C5.66666 2.45769 5.81591 2.09736 6.08159 1.83168C6.34727 1.566 6.7076 1.41675 7.08332 1.41675H9.91666C10.2924 1.41675 10.6527 1.566 10.9184 1.83168C11.1841 2.09736 11.3333 2.45769 11.3333 2.83341V4.25008M13.4583 4.25008V14.1667C13.4583 14.5425 13.3091 14.9028 13.0434 15.1685C12.7777 15.4342 12.4174 15.5834 12.0417 15.5834H4.95832C4.5826 15.5834 4.22227 15.4342 3.95659 15.1685C3.69091 14.9028 3.54166 14.5425 3.54166 14.1667V4.25008H13.4583Z"
        stroke="#FA3E3E"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.08334 7.79175V12.0417"
        stroke="#FA3E3E"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.91666 7.79175V12.0417"
        stroke="#FA3E3E"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

  const activeVariants =
    optConfig && Array.isArray(optConfig.variants)
      ? optConfig.variants.filter((v) => !!v.active)
      : [];

  const modeLabel = optConfig?.mode === 'MERCHANT' ? 'Kamu mengatur' : 'Pelanggan memilih';

  return (
    <div
      style={{
        boxShadow: 'inset 0 0 0 1px #D9D9D9',
        borderRadius: '15px',
        backgroundColor: '#FFFFFF',
      }}
      className="w-full p-4 flex flex-col gap-4 transition-all"
    >
      {/* 1. Main Row: Left (Title + Ganti item) | Middle (Stepper 75x40) | Right (Trash 40x40) */}
      <div className="flex items-center justify-between gap-3 w-full">
        {/* Left Column */}
        <div
          className="flex-1 min-w-0 cursor-pointer text-left flex flex-col items-start gap-[5px]"
          onClick={() => onOpenPickSheet(index)}
          title="Klik untuk ganti item"
        >
          <div className="text-[13px] font-bold text-[#0F172A] leading-snug break-words w-full">
            {item.name || 'Pilih Item'}
          </div>
          <div className="text-[10px] text-[#1E5EB2] font-semibold inline-flex items-center gap-[5px]">
            <span>Ganti item</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="shrink-0"
            >
              <path
                d="M3.75 2.5L6.25 5L3.75 7.5"
                stroke="#1E5EB2"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Right Controls: Stepper + Trash */}
        <div className="flex items-center justify-end gap-3 shrink-0">
          {/* Stepper (75x40px, rounded 10px, outline 1px #979797) */}
          <div
            style={{
              width: '75px',
              height: '40px',
              borderRadius: '10px',
              boxShadow: 'inset 0 0 0 1px #979797',
              backgroundColor: '#FFFFFF',
            }}
            className="inline-flex items-center justify-between px-2 shrink-0"
          >
            <button
              type="button"
              onClick={() => onQtyChange(index, qty - 1)}
              aria-label="Kurangi Jumlah"
              className="w-5 h-7 flex items-center justify-center text-[#303030] border-none bg-transparent hover:bg-slate-100 rounded cursor-pointer transition-colors p-0"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="2.95" y="5.91" width="7.1" height="1.3" rx="0.65" fill="#303030" />
              </svg>
            </button>
            <span className="text-center text-[15px] font-bold text-[#0F172A] select-none leading-none">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => onQtyChange(index, qty + 1)}
              aria-label="Tambah Jumlah"
              className="w-5 h-7 flex items-center justify-center text-[#303030] border-none bg-transparent hover:bg-slate-100 rounded cursor-pointer transition-colors p-0"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path
                  d="M5.5 1.65V9.35M1.65 5.5H9.35"
                  stroke="#303030"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Delete Button (40x40px, rounded 10px, outline 1px rgba(250, 62, 62, 0.30)) */}
          <button
            type="button"
            onClick={() => onRemoveItem(index)}
            aria-label="Hapus Item"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              boxShadow: 'inset 0 0 0 1px rgba(250, 62, 62, 0.30)',
              backgroundColor: '#FFFFFF',
            }}
            className="flex items-center justify-center border-none text-[#FA3E3E] hover:bg-red-50 active:scale-95 cursor-pointer transition-all shrink-0 p-0"
          >
            <TrashSvg />
          </button>
        </div>
      </div>

      {/* 2. Variant Section (Matching Figma: Pedas 5 chips or Rasa choices box) */}
      {activeVariants.length > 0 &&
        activeVariants.map((v, vIdx) => {
          const isPedas = v.name === 'Pedas' || v.type === 'level';

          if (isPedas) {
            const selectedLvl = Number(v.level) || 4;
            const chipColors = [
              { bg: 'rgba(250, 62, 62, 0.20)', border: 'rgba(250, 62, 62, 0.30)' },
              { bg: 'rgba(250, 62, 62, 0.40)', border: 'rgba(250, 62, 62, 0.30)' },
              { bg: 'rgba(250, 62, 62, 0.60)', border: 'rgba(250, 62, 62, 0.30)' },
              { bg: 'rgba(250, 62, 62, 0.80)', border: 'rgba(250, 62, 62, 0.30)' },
              { bg: '#FA3E3E', border: 'rgba(250, 62, 62, 0.30)' },
            ];

            return (
              <div key={vIdx} className="w-full flex flex-col gap-4">
                {/* Divider Line */}
                <div className="w-full h-[1px] bg-[#D9D9D9]" />

                {/* Left: Title + 5 Level Chips | Right: Delete Trash */}
                <div className="flex items-start justify-between gap-3 w-full">
                  <div className="flex flex-col items-start gap-3 flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-[#0F172A] text-left w-full">
                      {modeLabel}: Pedas
                    </div>

                    <div className="flex gap-2 items-center flex-wrap">
                      {[1, 2, 3, 4, 5].map((lvl) => {
                        const isFilled = lvl <= selectedLvl;
                        return (
                          <div
                            key={lvl}
                            style={{
                              width: '30px',
                              height: '30px',
                              borderRadius: '5px',
                              backgroundColor: isFilled ? chipColors[lvl - 1].bg : '#FFFFFF',
                              border: `1px solid ${isFilled ? chipColors[lvl - 1].border : '#D9D9D9'}`,
                            }}
                            className="shrink-0"
                          />
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveVariant(index, vIdx)}
                    aria-label="Hapus Varian"
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      boxShadow: 'inset 0 0 0 1px rgba(250, 62, 62, 0.30)',
                      backgroundColor: '#FFFFFF',
                    }}
                    className="flex items-center justify-center border-none text-[#FA3E3E] hover:bg-red-50 active:scale-95 cursor-pointer transition-all shrink-0 p-0"
                  >
                    <TrashSvg />
                  </button>
                </div>

                {/* Full Width 'Atur item' button */}
                <button
                  type="button"
                  onClick={() => onOpenAturModal(index)}
                  style={{
                    height: '40px',
                    borderRadius: '10px',
                    backgroundColor: '#F3F6FD',
                    boxShadow: 'inset 0 0 0 1px #E1E1E1',
                  }}
                  className="w-full border-none text-black font-bold text-[14px] cursor-pointer inline-flex items-center justify-center gap-1.5 transition-all hover:brightness-98 active:scale-[0.99]"
                >
                  <span>Atur item</span>
                </button>
              </div>
            );
          }

          // Radio Choices (e.g. Rasa: Manis / Tawar)
          const choices = v.choices || ['Manis', 'Tawar'];

          return (
            <div key={vIdx} className="w-full flex flex-col gap-4">
              {/* Divider Line */}
              <div className="w-full h-[1px] bg-[#D9D9D9]" />

              {/* Left: Title + Choices box | Right: Delete Trash (aligned bottom) */}
              <div className="flex items-end justify-between gap-3 w-full">
                <div className="flex flex-col items-start gap-3 flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-[#0F172A] text-left w-full">
                    {modeLabel}: {v.name}
                  </div>

                  <div
                    style={{
                      width: '200px',
                      maxWidth: '100%',
                      borderRadius: '10px',
                      boxShadow: 'inset 0 0 0 1px #979797',
                      backgroundColor: '#FFFFFF',
                    }}
                    className="px-4 py-2.5 flex flex-col gap-2.5"
                  >
                    {choices.map((c, cIdx) => (
                      <div
                        key={cIdx}
                        className="flex items-center justify-between text-[15px] font-bold text-[#303030]"
                      >
                        <span>{c}</span>
                        <span
                          style={{
                            width: '18px',
                            height: '18px',
                            borderRadius: '9999px',
                            border: '2px solid #979797',
                          }}
                          className="inline-block shrink-0"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onRemoveVariant(index, vIdx)}
                  aria-label="Hapus Varian"
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    boxShadow: 'inset 0 0 0 1px rgba(250, 62, 62, 0.30)',
                    backgroundColor: '#FFFFFF',
                  }}
                  className="flex items-center justify-center border-none text-[#FA3E3E] hover:bg-red-50 active:scale-95 cursor-pointer transition-all shrink-0 p-0"
                >
                  <TrashSvg />
                </button>
              </div>

              {/* Full Width 'Atur item' button */}
              <button
                type="button"
                onClick={() => onOpenAturModal(index)}
                style={{
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: '#F3F6FD',
                  boxShadow: 'inset 0 0 0 1px #E1E1E1',
                }}
                className="w-full border-none text-black font-bold text-[14px] cursor-pointer inline-flex items-center justify-center gap-1.5 transition-all hover:brightness-98 active:scale-[0.99]"
              >
                <span>Atur item</span>
              </button>
            </div>
          );
        })}
    </div>
  );
}
