import React from 'react';

const FONT = "'Plus Jakarta Sans', sans-serif";

/**
 * Canonical Page Header for Modern Owner Child Pages
 * Standard: 36x36 circular button with -ml-2, canonical ci_arrow-left-sm.svg icon,
 * H1 title (18px Bold #0F172A), and 24px bottom margin.
 */
export default function PageHeader({
  title,
  onBack,
  backAriaLabel = 'Kembali',
  rightAction = null,
  style = {},
  className = ''
}) {
  return (
    <div
      className={`flex items-center justify-between mb-6 ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '24px',
        width: '100%',
        ...style
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          minWidth: 0,
          flex: 1
        }}
        className="flex items-center gap-3 min-w-0 flex-1"
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backAriaLabel}
            className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
            style={{
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: '-8px',
              borderRadius: '9999px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0
            }}
          >
            <img
              src="/owner/assets/icons/ci_arrow-left-sm.svg"
              alt="Kembali"
              className="w-[22px] h-[19px] object-contain block"
              style={{ width: '22px', height: '19px', display: 'block', objectFit: 'contain' }}
            />
          </button>
        )}
        <h1
          style={{
            color: '#0F172A',
            fontSize: '18px',
            fontFamily: FONT,
            fontWeight: 700,
            lineHeight: '18px',
            margin: 0,
            textAlign: 'left'
          }}
          className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0 text-left truncate"
        >
          {title}
        </h1>
      </div>
      {rightAction && (
        <div className="shrink-0 flex items-center" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {rightAction}
        </div>
      )}
    </div>
  );
}
