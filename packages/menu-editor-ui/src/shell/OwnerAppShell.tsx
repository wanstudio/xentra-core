import React, { useState, useEffect, useCallback } from 'react';
import OverviewPage from '../components/OverviewPage';
import CategoriesPage from '../components/CategoriesPage';
import CategoryEditorPage from '../components/CategoryEditorPage';
import CategorySortPage from '../components/CategorySortPage';
import CategoryDetailPage from '../components/CategoryDetailPage';
import CategoryMenuSortPage from '../components/CategoryMenuSortPage';
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

  // Sync initialRoute prop if updated from host
  useEffect(() => {
    if (initialRoute) {
      setCurrentRoute(initialRoute.replace(/^#\/?/, ''));
    }
  }, [initialRoute]);

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
    if (typeof (window as any).navigateTo === 'function') {
      try {
        (window as any).navigateTo(cleanRoute);
      } catch (_) {}
    }
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
    if (currentRoute.startsWith('finance')) return 'finance';
    if (currentRoute.startsWith('more') || currentRoute.startsWith('account')) return 'more';
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
            <button
              type="button"
              aria-label="Akun Saya"
              onClick={() => {
                if (typeof (window as any).openMobileAccount === 'function') {
                  (window as any).openMobileAccount();
                } else {
                  navigateTo('more');
                }
              }}
              className="w-9 h-9 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center border border-slate-200 cursor-pointer transition-colors active:scale-95"
            >
              <img src="/owner/assets/icons/flowbite_user-solid.svg" alt="" className="w-4 h-4 text-slate-700" />
            </button>
          </div>
        </header>
      )}

      {/* 2. Main Scrollable Content Area */}
      <main
        className={`w-full flex-1 flex flex-col ${
          !isChildPage ? 'pt-[76px] pb-[116px]' : 'pt-2 pb-6'
        }`}
      >
        {(currentRoute === 'overview' || currentRoute === '') && (
          <OverviewPage
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {currentRoute === 'catalog/categories' && (
          <CategoriesPage
            onBack={() => navigateTo('business/catalog')}
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {(currentRoute === 'catalog/categories/new' ||
          currentRoute === 'catalog/categories/edit' ||
          /^catalog\/categories\/[^/]+\/edit$/.test(currentRoute)) && (
          <CategoryEditorPage
            categoryId={
              /^catalog\/categories\/[^/]+\/edit$/.test(currentRoute)
                ? decodeURIComponent(currentRoute.split('catalog/categories/')[1].split('/edit')[0])
                : null
            }
            onBack={() =>
              /^catalog\/categories\/[^/]+\/edit$/.test(currentRoute)
                ? navigateTo('catalog/categories/' + currentRoute.split('catalog/categories/')[1].split('/edit')[0])
                : navigateTo('catalog/categories')
            }
            onSaved={() =>
              /^catalog\/categories\/[^/]+\/edit$/.test(currentRoute)
                ? navigateTo('catalog/categories/' + currentRoute.split('catalog/categories/')[1].split('/edit')[0])
                : navigateTo('catalog/categories')
            }
          />
        )}

        {(currentRoute === 'catalog/categories/sort' || currentRoute === 'catalog/categories/reorder') && (
          <CategorySortPage
            onBack={() => navigateTo('catalog/categories')}
            onSaved={() => navigateTo('catalog/categories')}
          />
        )}

        {/^catalog\/categories\/[^/]+$/.test(currentRoute) &&
          currentRoute !== 'catalog/categories/new' &&
          currentRoute !== 'catalog/categories/edit' &&
          currentRoute !== 'catalog/categories/sort' &&
          currentRoute !== 'catalog/categories/reorder' && (
            <CategoryDetailPage
              categoryId={decodeURIComponent(currentRoute.split('catalog/categories/')[1])}
              onBack={() => navigateTo('catalog/categories')}
              onEditCategory={(id: string) => navigateTo(`catalog/categories/${encodeURIComponent(id)}/edit`)}
              onAddMenu={() => navigateTo('catalog/master-menus/new')}
              onEditMenu={(mId: string) => navigateTo(`catalog/master-menus/${encodeURIComponent(mId)}/edit`)}
              onSortMenus={(id: string) => navigateTo(`catalog/categories/${encodeURIComponent(id)}/sort-menus`)}
            />
          )}

        {/^catalog\/categories\/[^/]+\/(?:sort-menus|sort)$/.test(currentRoute) && (
          <CategoryMenuSortPage
            categoryId={decodeURIComponent(
              currentRoute.replace(/^catalog\/categories\//, '').replace(/\/(?:sort-menus|sort)$/, '')
            )}
            onBack={() =>
              navigateTo(
                'catalog/categories/' +
                  currentRoute.replace(/^catalog\/categories\//, '').replace(/\/(?:sort-menus|sort)$/, '')
              )
            }
            onSaved={() =>
              navigateTo(
                'catalog/categories/' +
                  currentRoute.replace(/^catalog\/categories\//, '').replace(/\/(?:sort-menus|sort)$/, '')
              )
            }
          />
        )}

        {currentRoute === 'catalog/products' && (
          <ItemMasterPage
            onBack={() => navigateTo('business/catalog')}
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {(currentRoute === 'catalog/menus' ||
          currentRoute === 'catalog/master-menus/new' ||
          /^catalog\/master-menus\/[^/]+\/edit$/.test(currentRoute)) && (
          <MenuEditor
            menuId={
              /^catalog\/master-menus\/[^/]+\/edit$/.test(currentRoute)
                ? decodeURIComponent(
                    currentRoute.split('catalog/master-menus/')[1].split('/edit')[0]
                  )
                : null
            }
            onBack={(catId?: string) =>
              catId
                ? navigateTo(`catalog/categories/${encodeURIComponent(catId)}`)
                : navigateTo('catalog/categories')
            }
            onSaveSuccess={(_data: any, catId?: string) =>
              catId
                ? navigateTo(`catalog/categories/${encodeURIComponent(catId)}`)
                : navigateTo('catalog/categories')
            }
            onNavigate={(r: string) => navigateTo(r)}
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
          style={{
            paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
            paddingTop: '8px',
            boxSizing: 'border-box'
          }}
          className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200/90 shadow-[0_-2px_12px_rgba(0,0,0,0.04)] z-[150] grid grid-cols-5 items-center px-1"
        >
          <button
            type="button"
            onClick={() => navigateTo('overview')}
            className={`flex flex-col items-center justify-center gap-1.5 py-1.5 h-full cursor-pointer transition-all active:scale-95 ${
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
            className={`flex flex-col items-center justify-center gap-1.5 py-1.5 h-full cursor-pointer transition-all active:scale-95 ${
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
            className={`flex flex-col items-center justify-center gap-1.5 py-1.5 h-full cursor-pointer transition-all active:scale-95 ${
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
            onClick={() => navigateTo('finance')}
            className={`flex flex-col items-center justify-center gap-1.5 py-1.5 h-full cursor-pointer transition-all active:scale-95 ${
              activeTab === 'finance' ? 'text-slate-900 font-bold' : 'text-slate-400 font-medium'
            }`}
          >
            <img
              src="/owner/assets/icons/reicon_wallet-money-filled.svg"
              alt=""
              className={`w-5 h-5 transition-opacity ${activeTab === 'finance' ? 'opacity-100' : 'opacity-40'}`}
            />
            <span className="text-[10px] leading-none">Keuangan</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo('more')}
            className={`flex flex-col items-center justify-center gap-1.5 py-1.5 h-full cursor-pointer transition-all active:scale-95 ${
              activeTab === 'more' ? 'text-slate-900 font-bold' : 'text-slate-400 font-medium'
            }`}
          >
            <img
              src="/owner/assets/icons/reicon_menu-board-filled.svg"
              alt=""
              className={`w-5 h-5 transition-opacity ${activeTab === 'more' ? 'opacity-100' : 'opacity-40'}`}
            />
            <span className="text-[10px] leading-none">Lainnya</span>
          </button>
        </nav>
      )}
    </div>
  );
};

export default OwnerAppShell;
