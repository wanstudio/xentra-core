import React, { useState, useEffect, useCallback } from 'react';
import CategoriesPage from '../components/CategoriesPage';
import CategoryEditorPage from '../components/CategoryEditorPage';
import ItemMasterPage from '../components/ItemMasterPage';
import CatalogSubHub from '../components/CatalogSubHub';
import BusinessHub from '../components/BusinessHub';
import MenuEditor from '../components/MenuEditor';
import { MainTab, SubRoute } from '../types';

interface OwnerAppShellProps {
  initialRoute?: string;
  onNavigate?: (route: string) => void;
}

export const OwnerAppShell: React.FC<OwnerAppShellProps> = ({
  initialRoute,
  onNavigate
}) => {
  const getHashRoute = (): string => {
    if (typeof window === 'undefined') return 'overview';
    const hash = window.location.hash.replace(/^#\/?/, '');
    return hash || 'overview';
  };

  const [currentRoute, setCurrentRoute] = useState<string>(initialRoute || getHashRoute());
  const [activeBranchName, setActiveBranchName] = useState<string>('Semua Cabang');

  // Sync hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const route = getHashRoute();
      setCurrentRoute(route);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Sync active branch name if present in localStorage or window
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('xentra_merchant_user');
      if (savedUser) {
        const u = JSON.parse(savedUser);
        if (u.branchName || u.branch_name) {
          setActiveBranchName(u.branchName || u.branch_name);
        }
      }
    } catch (e) {}
  }, []);

  const navigateTo = useCallback((route: string) => {
    const cleanRoute = route.replace(/^#\/?/, '');
    window.location.hash = '#' + cleanRoute;
    setCurrentRoute(cleanRoute);
    if (typeof onNavigate === 'function') {
      onNavigate(cleanRoute);
    }
  }, [onNavigate]);

  // Determine if current view is a child/subpage
  const isChildPage =
    currentRoute.includes('/') ||
    currentRoute.startsWith('catalog') ||
    currentRoute === 'production' ||
    currentRoute === 'branches';

  // Determine active main tab for bottom navigation
  const getActiveTab = (): MainTab => {
    if (currentRoute.startsWith('business') || currentRoute.startsWith('catalog')) {
      return 'business';
    }
    if (currentRoute.startsWith('orders')) return 'orders';
    if (currentRoute.startsWith('reports')) return 'reports';
    if (currentRoute.startsWith('more') || currentRoute.startsWith('account')) return 'account';
    return 'overview';
  };

  const activeTab = getActiveTab();

  return (
    <div
      id="xentra-owner-app-root"
      className="w-full min-h-screen bg-[#F8FAFC] text-slate-900 font-sans flex flex-col relative antialiased selection:bg-emerald-100"
    >
      {/* 1. Global Clean Mobile TopBar (Shown on main dashboard tabs) */}
      {!isChildPage && (
        <header className="fixed top-0 left-0 right-0 h-[68px] bg-white border-b border-slate-200 z-[120] px-4 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700">
              <img src="/owner/assets/icons/dashicons_store.svg" alt="" className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider leading-none">
                Lokasi Cabang
              </span>
              <span className="text-sm font-bold text-slate-900 leading-tight">
                {activeBranchName}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Notifikasi"
              className="w-9 h-9 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center border border-slate-200 cursor-pointer transition-colors active:scale-95"
            >
              <img src="/owner/assets/icons/bi_bell-fill.svg" alt="" className="w-4 h-4 opacity-75" />
            </button>
          </div>
        </header>
      )}

      {/* 2. Main Scrollable Content Area */}
      <main
        className={`w-full flex-1 flex flex-col ${
          !isChildPage ? 'pt-[76px] pb-[88px]' : 'pt-2 pb-6'
        }`}
      >
        {currentRoute === 'catalog/categories' && (
          <CategoriesPage
            onBack={() => navigateTo('business/catalog')}
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {(currentRoute === 'catalog/categories/new' || currentRoute === 'catalog/categories/edit') && (
          <CategoryEditorPage
            onBack={() => navigateTo('catalog/categories')}
            onSaved={() => navigateTo('catalog/categories')}
          />
        )}

        {currentRoute === 'catalog/products' && (
          <ItemMasterPage
            onBack={() => navigateTo('business/catalog')}
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {currentRoute === 'catalog/menus' && (
          <MenuEditor
            onBack={() => navigateTo('business/catalog')}
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {currentRoute === 'business/catalog' && (
          <CatalogSubHub
            onBack={() => navigateTo('business')}
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {currentRoute === 'business' && (
          <BusinessHub
            onBack={() => navigateTo('overview')}
            onNavigate={(r) => navigateTo(r)}
          />
        )}
      </main>

      {/* 3. Persistent Mobile Bottom Navigation (Shown on main tabs only) */}
      {!isChildPage && (
        <nav
          id="clean-owner-bottom-nav"
          className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200/90 shadow-[0_-2px_10px_rgba(0,0,0,0.03)] z-[150] grid grid-cols-5 items-center px-1"
        >
          <button
            type="button"
            onClick={() => navigateTo('overview')}
            className={`flex flex-col items-center justify-center gap-1 h-full cursor-pointer transition-all ${
              activeTab === 'overview' ? 'text-slate-900 font-bold' : 'text-slate-400 font-medium'
            }`}
          >
            <img
              src="/owner/assets/icons/fa7-solid_home.svg"
              alt=""
              className={`w-5 h-5 transition-opacity ${activeTab === 'overview' ? 'opacity-100' : 'opacity-40'}`}
            />
            <span className="text-[10px] leading-none">Beranda</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo('business')}
            className={`flex flex-col items-center justify-center gap-1 h-full cursor-pointer transition-all ${
              activeTab === 'business' ? 'text-slate-900 font-bold' : 'text-slate-400 font-medium'
            }`}
          >
            <img
              src="/owner/assets/icons/ic_round-business-center-new.svg"
              alt=""
              className={`w-5 h-5 transition-opacity ${activeTab === 'business' ? 'opacity-100' : 'opacity-40'}`}
            />
            <span className="text-[10px] leading-none">Bisnis</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo('orders')}
            className={`flex flex-col items-center justify-center gap-1 h-full cursor-pointer transition-all ${
              activeTab === 'orders' ? 'text-slate-900 font-bold' : 'text-slate-400 font-medium'
            }`}
          >
            <img
              src="/owner/assets/icons/fluent_task-list-rectangle-28-filled.svg"
              alt=""
              className={`w-5 h-5 transition-opacity ${activeTab === 'orders' ? 'opacity-100' : 'opacity-40'}`}
            />
            <span className="text-[10px] leading-none">Pesanan</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo('reports')}
            className={`flex flex-col items-center justify-center gap-1 h-full cursor-pointer transition-all ${
              activeTab === 'reports' ? 'text-slate-900 font-bold' : 'text-slate-400 font-medium'
            }`}
          >
            <img
              src="/owner/assets/icons/streamline-plump_graph-bar-increase-solid.svg"
              alt=""
              className={`w-5 h-5 transition-opacity ${activeTab === 'reports' ? 'opacity-100' : 'opacity-40'}`}
            />
            <span className="text-[10px] leading-none">Laporan</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo('more')}
            className={`flex flex-col items-center justify-center gap-1 h-full cursor-pointer transition-all ${
              activeTab === 'account' ? 'text-slate-900 font-bold' : 'text-slate-400 font-medium'
            }`}
          >
            <img
              src="/owner/assets/icons/flowbite_user-solid.svg"
              alt=""
              className={`w-5 h-5 transition-opacity ${activeTab === 'account' ? 'opacity-100' : 'opacity-40'}`}
            />
            <span className="text-[10px] leading-none">Akun</span>
          </button>
        </nav>
      )}
    </div>
  );
};

export default OwnerAppShell;
