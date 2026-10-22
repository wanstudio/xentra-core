import React from 'react';

const catalogItems = [
  {
    id: 'categories',
    title: 'Kategori & Menu',
    description: 'Kelola kategori dan daftar menu untuk seluruh cabang restoran Anda',
    color: 'bg-[#34A853]',
    icon: '/owner/assets/icons/bxs_category.svg',
    iconAlt: 'Ikon Kategori & Menu',
    iconClassName: 'w-[25px] h-[25px] object-contain filter brightness-0 invert',
    route: '#catalog/categories',
  },
  {
    id: 'products',
    title: 'Item Master',
    description: 'Product yang sama dapat digunakan berulang untuk menyusun menu',
    color: 'bg-[#EA4335]',
    icon: '/owner/assets/icons/mdi_food-drumstick.svg',
    iconAlt: 'Ikon Item Master',
    iconClassName: 'w-[24px] h-[24px] object-contain filter brightness-0 invert',
    route: '#catalog/products',
  },
];

export default function CatalogSubHub({ onBack, onNavigate }) {
  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
    }
    if (window.XentraNavigationController && typeof window.XentraNavigationController.back === 'function') {
      const snap = window.XentraNavigationController.getSnapshot ? window.XentraNavigationController.getSnapshot() : null;
      if (snap && snap.stack && snap.stack.length > 1) {
        window.XentraNavigationController.back();
        return;
      }
    }
    window.location.hash = '#business';
  };

  const handleItemClick = (item) => {
    if (typeof onNavigate === 'function') {
      onNavigate(item.route, item.id);
    } else {
      window.location.hash = item.route;
    }
  };

  return (
    <div
      id="modern-catalog-subhub-root"
      style={{
        boxSizing: 'border-box'
      }}
      className="w-full flex flex-col gap-4 pb-12 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow and Title */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali ke Kelola Bisnis"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain"
          />
        </button>
        <h1 className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0">
          Katalog &amp; Menu
        </h1>
      </div>

      {/* 2. The 2 Sub-Hub Cards */}
      <div className="flex flex-col w-full items-start gap-4">
        {catalogItems.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={`Buka ${item.title}`}
            onClick={() => handleItemClick(item)}
            className="flex w-full items-center gap-4 p-4 relative rounded-[14px] bg-white hub-inset-stroke hub-card active:scale-[0.99] transition-all cursor-pointer text-left"
          >
            {/* Colored Icon Badge */}
            <span
              className={`relative w-[45px] h-[45px] ${item.color} rounded-[10px] aspect-[1] shrink-0 flex items-center justify-center`}
            >
              <img
                src={item.icon}
                alt={item.iconAlt}
                className={item.iconClassName || 'w-6 h-6 object-contain filter brightness-0 invert'}
              />
            </span>

            {/* Title & Description */}
            <span className="flex flex-col flex-1 min-w-0 items-start gap-1 relative">
              <span className="relative w-fit mt-[-1.00px] font-bold text-[#0F172A] text-base tracking-[0] leading-[normal]">
                {item.title}
              </span>
              <span className="relative self-stretch font-medium text-[#94A3B8] text-[13px] tracking-[0] leading-snug">
                {item.description}
              </span>
            </span>

            {/* Chevron Arrow */}
            <img
              src="/owner/assets/icons/akar-icons_chevron-right-small.svg"
              alt=""
              aria-hidden="true"
              className="relative w-[13px] h-[13px] mr-[-5.00px] aspect-[1] shrink-0"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
