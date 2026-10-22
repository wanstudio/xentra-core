import React, { useState } from 'react';
import CatalogSubHub from './CatalogSubHub';

const businessItems = [
  {
    id: 'catalog',
    title: 'Katalog & Menu',
    description: 'Master menu, kategori, item penyusun, dan pilihan item',
    color: 'bg-[#34a853]',
    icon: '/owner/assets/icons/ion_fast-food.svg',
    iconAlt: 'Ikon katalog dan menu',
    iconClassName:
      'absolute top-[calc(50.00%_-_12px)] left-[calc(50.00%_-_12px)] w-[25px] h-[25px] aspect-[1]',
    chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
    route: '#catalog/master-menus',
  },
  {
    id: 'materials-production',
    title: 'Bahan & Produksi',
    description:
      'Standar baku, resep, hasil produksi, dan hubungan bahan dengan hasil produksi',
    color: 'bg-[#4285f4]',
    icon: '/owner/assets/icons/si_inventory-fill.svg',
    iconAlt: 'Ikon bahan dan produksi',
    iconClassName:
      'absolute top-[calc(50.00%_-_12px)] left-[calc(50.00%_-_12px)] w-[23px] h-[23px] aspect-[1]',
    chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
    route: '#production',
  },
  {
    id: 'branches',
    title: 'Cabang & Kesehatan Cabang',
    description:
      'Konfigurasi, penanggung jawab, performa, dan operasional yang perlu perhatian',
    color: 'bg-[#fbbc05]',
    icon: '/owner/assets/icons/dashicons_store.svg',
    iconAlt: 'Ikon cabang dan kesehatan cabang',
    iconClassName:
      'absolute top-[calc(50.00%_-_12px)] left-[calc(50.00%_-_12px)] w-6 h-6 aspect-[1]',
    chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
    route: '#branches',
  },
  {
    id: 'customers-marketing',
    title: 'Pelanggan & Pemasaran',
    description: 'Data pelanggan, promosi, dan kampanye pemasaran',
    color: 'bg-[#ea4335]',
    icon: '/owner/assets/icons/basil_bullhorn-solid.svg',
    iconAlt: 'Ikon pelanggan dan pemasaran',
    iconClassName:
      'absolute top-[calc(50.00%_-_13px)] left-[calc(50.00%_-_13px)] w-[26px] h-[26px] aspect-[1]',
    chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
    route: '#customers',
  },
  {
    id: 'reports',
    title: 'Kinerja & Laporan',
    description:
      'Performa, biaya produksi & margin, efisiensi persediaan & pembelian',
    color: 'bg-[#7b3dec]',
    icon: '/owner/assets/icons/streamline-plump_graph-bar-increase-solid.svg',
    iconAlt: 'Ikon kinerja dan laporan',
    iconClassName:
      'absolute top-[calc(50.00%_-_12px)] left-[calc(50.00%_-_12px)] w-[23px] h-[23px] aspect-[1]',
    chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
    route: '#reports',
  },
  {
    id: 'team',
    title: 'Tim & Akses',
    description:
      'Anggota, pendaftaran anggota, jabatan, hak akses, dan cakupan cabang',
    color: 'bg-[#455a64]',
    icon: '/owner/assets/icons/fluent_people-team-add-20-filled.svg',
    iconAlt: 'Ikon tim dan akses',
    iconClassName:
      'absolute top-[calc(50.00%_-_12px)] left-[calc(50.00%_-_12px)] w-6 h-6 aspect-[1]',
    chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
    route: '#team',
  },
  {
    id: 'brand',
    title: 'Brand & Kanal Digital',
    description:
      'Identitas brand, tampilan toko, dan konfigurasi kanal penjualan milik brand',
    color: 'bg-[#007189]',
    icon: '/owner/assets/icons/bi_palette-fill.svg',
    iconAlt: 'Ikon brand dan kanal digital',
    iconClassName:
      'absolute top-[calc(50.00%_-_12px)] left-[calc(50.00%_-_12px)] w-6 h-6 aspect-[1]',
    chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
    route: '#brand',
  },
];

export default function BusinessHub({ onNavigate, initialSubHub = null }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBusiness, setSelectedBusiness] = useState('');
  const [activeSubHub, setActiveSubHub] = useState(initialSubHub);
  const searchHistoryPushedRef = React.useRef(false);

  React.useEffect(() => {
    setActiveSubHub(initialSubHub);
  }, [initialSubHub]);

  // Guard mobile back gesture when searchTerm is non-empty so back swipe clears search instead of exiting
  React.useEffect(() => {
    const hasSearch = searchTerm.trim().length > 0;
    if (hasSearch && !searchHistoryPushedRef.current) {
      try {
        const currentState = window.history.state || {};
        window.history.pushState(
          { ...currentState, __xentraSearchActive: 'business' },
          '',
          window.location.hash || '#business'
        );
        searchHistoryPushedRef.current = true;
      } catch (_) {}
    } else if (!hasSearch && searchHistoryPushedRef.current) {
      searchHistoryPushedRef.current = false;
      try {
        if (window.history.state && window.history.state.__xentraSearchActive === 'business') {
          const cleanState = { ...window.history.state };
          delete cleanState.__xentraSearchActive;
          window.history.replaceState(cleanState, '', window.location.hash || '#business');
        }
      } catch (_) {}
    }
  }, [searchTerm]);

  React.useEffect(() => {
    const handlePopState = () => {
      if (searchHistoryPushedRef.current) {
        searchHistoryPushedRef.current = false;
        setSearchTerm('');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  React.useEffect(() => {
    const syncRouteFromHash = () => {
      const hash = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
      if (hash === 'business/catalog') {
        setActiveSubHub('catalog');
      } else if (hash === 'business' || hash === '' || hash === 'bisnis') {
        setActiveSubHub(null);
      }
    };
    window.addEventListener('hashchange', syncRouteFromHash);
    window.addEventListener('popstate', syncRouteFromHash);
    syncRouteFromHash();
    return () => {
      window.removeEventListener('hashchange', syncRouteFromHash);
      window.removeEventListener('popstate', syncRouteFromHash);
    };
  }, []);

  if (activeSubHub === 'catalog') {
    return (
      <CatalogSubHub
        onBack={() => {
          setActiveSubHub(null);
        }}
        onNavigate={(route, id) => {
          if (typeof onNavigate === 'function') {
            onNavigate(route, id);
          } else {
            window.location.hash = route;
          }
        }}
      />
    );
  }

  const filteredBusinessItems = businessItems.filter((item) => {
    const searchValue = searchTerm.trim().toLowerCase();
    if (!searchValue) return true;
    return `${item.title} ${item.description}`
      .toLowerCase()
      .includes(searchValue);
  });

  const handleCardClick = (item) => {
    setSelectedBusiness(item.title);
    if (typeof onNavigate === 'function') {
      onNavigate(item.route, item.id);
    } else if (item.id === 'catalog') {
      if (typeof window.openBusinessSubHub === 'function') {
        window.openBusinessSubHub('catalog');
      } else if (typeof window.navigateTo === 'function') {
        window.navigateTo('business/catalog');
      } else {
        setActiveSubHub('catalog');
        window.location.hash = '#business/catalog';
      }
    } else if (item.id === 'materials-production' && typeof window.openBusinessSubHub === 'function') {
      window.openBusinessSubHub('materials-production');
    } else {
      window.location.hash = item.route;
    }
  };

  return (
    <div
      id="modern-business-hub-root"
      style={{
        boxSizing: 'border-box'
      }}
      className="w-full flex flex-col gap-4 pb-12 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Search Bar */}
      <form
        className="w-full h-12 flex items-center px-4 gap-[15px] rounded-[14px] overflow-hidden bg-white hub-inset-stroke hub-search transition-all mb-6"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="w-[17px] h-[17px] relative flex items-center justify-center shrink-0">
          <svg
            className="w-[17px] h-[17px] text-[#94A3B8]"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="8.75" cy="8.75" r="6.25" />
            <line x1="13.23" y1="13.23" x2="16.77" y2="16.77" />
          </svg>
        </div>
        <input
          type="search"
          aria-label="Cari menu atau pengaturan bisnis"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          onSearch={(event) => setSearchTerm(event.target.value)}
          placeholder="Cari menu atau pengaturan bisnis"
          className="w-full bg-transparent border-none outline-none font-medium text-slate-800 text-[13px] tracking-[0] leading-[normal] placeholder:text-[#94A3B8]"
        />
        {searchTerm.length > 0 && (
          <button
            type="button"
            aria-label="Bersihkan pencarian"
            onClick={() => setSearchTerm('')}
            className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 flex items-center justify-center text-slate-500 border-none cursor-pointer shrink-0 p-0 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
              <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
            </svg>
          </button>
        )}
      </form>

      {/* 2. Heading */}
      <div className="mb-4">
        <h1 className="flex items-center font-bold text-slate-900 text-lg tracking-[0] leading-[18px] whitespace-nowrap m-0">
          Kelola bisnis
        </h1>
      </div>

      {/* 3. The Business Cards */}
      <div className="flex flex-col w-full items-start gap-4">
        {filteredBusinessItems.length === 0 ? (
          <div className="w-full py-10 text-center text-sm text-slate-400 bg-white rounded-[14px] border border-solid border-slate-300">
            Tidak ada modul bisnis yang sesuai dengan pencarian "{searchTerm}"
          </div>
        ) : (
          filteredBusinessItems.map((item) => (
            <button
              key={item.title}
              type="button"
              aria-label={`Buka ${item.title}`}
              aria-pressed={selectedBusiness === item.title}
              onClick={() => handleCardClick(item)}
              className="flex w-full items-center gap-4 p-4 relative rounded-[14px] bg-white hub-inset-stroke hub-card active:scale-[0.99] transition-all cursor-pointer text-left"
            >
              <span
                className={`relative w-[45px] h-[45px] ${item.color} rounded-[10px] aspect-[1] shrink-0`}
              >
                <img
                  className={`${item.iconClassName} filter brightness-0 invert`}
                  alt={item.iconAlt}
                  src={item.icon}
                />
              </span>
              <span className="flex flex-col flex-1 min-w-0 items-start gap-1 relative">
                <span className="relative w-fit mt-[-1.00px] font-bold text-slate-900 text-base tracking-[0] leading-[normal]">
                  {item.title}
                </span>
                <span className="relative self-stretch font-medium text-slate-400 text-[13px] tracking-[0] leading-snug line-clamp-2">
                  {item.description}
                </span>
              </span>
              <img
                className="relative w-[13px] h-[13px] mr-[-5.00px] aspect-[1] shrink-0"
                alt=""
                aria-hidden="true"
                src={item.chevron}
              />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
