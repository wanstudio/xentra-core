import React, { useState, useEffect, useCallback } from 'react';
import OverviewPage from '../components/OverviewPage';
import CategoriesPage from '../components/CategoriesPage';
import CategoryEditorPage from '../components/CategoryEditorPage';
import CategorySortPage from '../components/CategorySortPage';
import CategoryDetailPage from '../components/CategoryDetailPage';
import CategoryMenuSortPage from '../components/CategoryMenuSortPage';
import ItemMasterPage from '../components/ItemMasterPage';
import ItemEditorPage from '../components/ItemEditorPage';
import CatalogSubHub from '../components/CatalogSubHub';
import BusinessHub from '../components/BusinessHub';
import MenuEditor from '../components/MenuEditor';
import MaterialsPage from '../components/MaterialsPage';
import MaterialEditorPage from '../components/MaterialEditorPage';
import OrdersPage from '../components/OrdersPage';
import FinancePage from '../components/FinancePage';
import MorePage from '../components/MorePage';
import AffiliatePage from '../components/AffiliatePage';
import BranchesPage from '../components/BranchesPage';
import BranchEditorPage from '../components/BranchEditorPage';
import TargetSettingPage from '../components/TargetSettingPage';
import { MainTab, SubRoute } from '../types';

const OWNER_ROUTE_STACK_KEY = '__xentraOwnerRouteStack';
const OWNER_ROOT_ROUTES = new Set(['overview', 'business', 'orders', 'finance', 'more']);

function ownerRouteParent(route: string, stack: string[] = []): string | null {
  if (OWNER_ROOT_ROUTES.has(route) || !route) return null;
  if (route === 'catalog/categories') return 'business';
  if (/^catalog\/categories\/[^/]+\/(?:edit|sort-menus|sort)$/.test(route)) {
    return route.replace(/\/(?:edit|sort-menus|sort)$/, '');
  }
  if (/^catalog\/categories\/[^/]+$/.test(route)) return 'catalog/categories';
  if (/^catalog\/master-menus\/(?:new|[^/]+\/edit)$/.test(route)) {
    const categoryRoute = [...stack].reverse().find((entry) => /^catalog\/categories\/[^/]+$/.test(entry));
    return categoryRoute || 'catalog/master-menus';
  }
  if (route === 'catalog/master-menus' || route === 'catalog/products' || route === 'catalog/menus') return 'business';
  if (route === 'business/catalog' || route === 'business/materials-production' || route === 'business/materials') return 'business';
  if (route === 'business') return 'overview';
  const slash = route.lastIndexOf('/');
  return slash > 0 ? route.slice(0, slash) : 'overview';
}

function ownerRouteChain(route: string, stack: string[] = []): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null = route;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.unshift(current);
    current = ownerRouteParent(current, stack);
  }
  return chain.length ? chain : ['overview'];
}

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
    const hash = window.location.hash.replace(/^#\/?/, '').trim();
    if (hash) return hash;
    try {
      const saved = (sessionStorage.getItem('xentra_owner_last_route') || '').replace(/^#\/?/, '').trim();
      // Only restore main hub routes from session storage on cold boot, never deep edit/transient subpages
      if (saved && !saved.includes('/edit') && saved !== 'branches/new' && !saved.startsWith('branches')) return saved;
    } catch (_) {}
    return 'overview';
  };

  const [currentRoute, setCurrentRoute] = useState<string>(initialRoute || getHashRoute());
  const currentRouteRef = React.useRef(currentRoute);
  useEffect(() => {
    currentRouteRef.current = currentRoute;
  }, [currentRoute]);
  const [activeBranchName, setActiveBranchName] = useState<string>('Semua Cabang');
  const [activeBranchId, setActiveBranchId] = useState<string>('all');
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState<boolean>(false);
  const [branchList, setBranchList] = useState<Array<{ id: string; name: string }>>([]);
  const [isSessionExpired, setIsSessionExpired] = useState<boolean>(false);

  useEffect(() => {
    const handleExpired = () => {
      setIsSessionExpired(true);
    };
    window.addEventListener('xentra:session-expired', handleExpired);
    return () => window.removeEventListener('xentra:session-expired', handleExpired);
  }, []);

  // Fetch branches and handle click outside
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('xentra_merchant_token') : null;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`/api/v1/admin/branches?_t=${Date.now()}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.branches) && data.branches.length > 0) {
            setBranchList(data.branches);
          }
        }
      } catch (_) {}
    };
    loadBranches();

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#x-branch-selector-wrap')) {
        setIsBranchDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleSelectBranch = (branchId: string, branchName: string) => {
    setActiveBranchId(branchId);
    setActiveBranchName(branchName);
    setIsBranchDropdownOpen(false);
    try {
      localStorage.setItem('xentra_branch_context', branchId);
      const nativeSel = document.getElementById('dash-branch-context') as HTMLSelectElement | null;
      if (nativeSel) {
        nativeSel.value = branchId;
        nativeSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      window.dispatchEvent(new CustomEvent('xentra:branch-change', {
        detail: { branchId, branchName }
      }));
    } catch (_) {}
  };

  // Sync initialRoute prop if updated from host
  useEffect(() => {
    if (initialRoute) {
      setCurrentRoute(initialRoute.replace(/^#\/?/, ''));
    }
  }, [initialRoute]);

  // Sync hash changes and popstate with anti-loop guard for swipe-back navigation
  useEffect(() => {
    const handleRouteSync = (event: PopStateEvent | HashChangeEvent) => {
      const prevRoute = currentRouteRef.current || '';
      const state = event && 'state' in event ? (event as PopStateEvent).state : window.history.state;
      const savedStack = state && Array.isArray(state[OWNER_ROUTE_STACK_KEY]) ? state[OWNER_ROUTE_STACK_KEY] as string[] : null;
      const rawHash = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#\/?/, '').trim();
      let nextRoute = (savedStack && savedStack.length ? savedStack[savedStack.length - 1] : '') || rawHash || 'overview';

      // ── Anti-Loop Guard for Branches Navigation ──
      // Scenario 1: User is on Branches list ('branches') and swipes back to exit to menu.
      // If history pops into a child branch route ('branches/...'), intercept and redirect to overview/menu.
      if (prevRoute === 'branches' && nextRoute.startsWith('branches/')) {
        nextRoute = 'overview';
        try {
          window.history.replaceState({ xentraRoute: 'overview' }, '', '#overview');
        } catch (_) {}
      }
      // Scenario 2: User is on Branches list ('branches') and a popstate fires, but history was a duplicate 'branches' entry.
      // Break the duplicate chain and exit to overview/menu.
      else if (prevRoute === 'branches' && nextRoute === 'branches' && event && event.type === 'popstate') {
        nextRoute = 'overview';
        try {
          window.history.replaceState({ xentraRoute: 'overview' }, '', '#overview');
        } catch (_) {}
      }
      // Scenario 3: User is on a Branch child route ('branches/...') and swipes back, but pops into another branch child route.
      // Intercept and land on 'branches'.
      else if (prevRoute.startsWith('branches/') && nextRoute.startsWith('branches/')) {
        nextRoute = 'branches';
        try {
          window.history.replaceState({ xentraRoute: 'branches' }, '', '#branches');
        } catch (_) {}
      }

      try {
        sessionStorage.setItem('xentra_owner_last_route', nextRoute);
      } catch (_) {}

      setCurrentRoute(nextRoute);
    };

    window.addEventListener('hashchange', handleRouteSync);
    window.addEventListener('popstate', handleRouteSync);
    return () => {
      window.removeEventListener('hashchange', handleRouteSync);
      window.removeEventListener('popstate', handleRouteSync);
    };
  }, []);

  // Hide splash screen once mounted
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).Xentra && typeof (window as any).Xentra.hideSplash === 'function') {
      (window as any).Xentra.hideSplash();
    }
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

  const navigateTo = useCallback((route: string, options?: any) => {
    const cleanRoute = route.replace(/^#\/?/, '').trim();
    if (!cleanRoute) return;
    try {
      if (cleanRoute) {
        sessionStorage.setItem('xentra_owner_last_route', cleanRoute);
      }
    } catch (_) {}

    const state = typeof window !== 'undefined' ? window.history.state : null;
    const savedStack = state && Array.isArray(state[OWNER_ROUTE_STACK_KEY])
      ? state[OWNER_ROUTE_STACK_KEY] as string[]
      : ownerRouteChain(currentRouteRef.current || currentRoute);
    const stack = savedStack.length ? savedStack : ['overview'];
    const current = stack[stack.length - 1];

    if (cleanRoute === current) return;

    // Returning to an already visited parent must unwind browser history. A
    // push here leaves the editor/list pages behind and makes Back reopen them.
    const existingIndex = stack.lastIndexOf(cleanRoute);
    if (existingIndex >= 0 && existingIndex < stack.length - 1 && window.history && typeof window.history.go === 'function') {
      window.history.go(existingIndex - stack.length + 1);
      return;
    }

    const rootNavigation = (options && options.history === 'root') || (!(options && options.history) && OWNER_ROOT_ROUTES.has(cleanRoute));
    let nextStack: string[];
    let historyMode: 'push' | 'replace' = 'push';
    if (rootNavigation) {
      nextStack = [cleanRoute];
      historyMode = 'replace';
    } else if (options && options.history === 'replace') {
      nextStack = stack.slice(0, -1).concat(cleanRoute);
      historyMode = 'replace';
    } else if (options && options.history === 'push') {
      nextStack = stack.concat(cleanRoute);
    } else {
      const targetChain = ownerRouteChain(cleanRoute, stack);
      const isCurrentPrefix = targetChain.length > stack.length && stack.every((entry, index) => targetChain[index] === entry);
      if (isCurrentPrefix) {
        nextStack = targetChain;
      } else {
        nextStack = stack.concat(cleanRoute);
      }
    }

    if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
      const nextState = Object.assign({}, window.history.state || {}, {
        xentraRoute: cleanRoute,
        [OWNER_ROUTE_STACK_KEY]: nextStack
      });
      if (historyMode === 'replace') {
        window.history.replaceState(nextState, '', '#' + cleanRoute);
      } else {
        window.history.pushState(nextState, '', '#' + cleanRoute);
      }
    } else {
      if (options && options.history === 'replace') {
        window.location.replace('#' + cleanRoute);
      } else {
        window.location.hash = '#' + cleanRoute;
      }
    }
    setCurrentRoute(cleanRoute);
    if (typeof onNavigate === 'function') {
      onNavigate(cleanRoute);
    }
  }, [onNavigate]);

  useEffect(() => {
    const route = currentRouteRef.current || 'overview';
    const state = window.history && window.history.state;
    const savedStack = state && Array.isArray(state[OWNER_ROUTE_STACK_KEY]) ? state[OWNER_ROUTE_STACK_KEY] as string[] : null;
    if (savedStack && savedStack[savedStack.length - 1] === route) return;

    const chain = ownerRouteChain(route);
    const baseState = Object.assign({}, state || {});
    if (!window.history || typeof window.history.pushState !== 'function') return;
    window.history.replaceState(Object.assign({}, baseState, {
      xentraRoute: chain[0],
      [OWNER_ROUTE_STACK_KEY]: [chain[0]]
    }), '', '#' + chain[0]);
    for (let index = 1; index < chain.length; index += 1) {
      const partial = chain.slice(0, index + 1);
      window.history.pushState(Object.assign({}, baseState, {
        xentraRoute: partial[partial.length - 1],
        [OWNER_ROUTE_STACK_KEY]: partial
      }), '', '#' + partial[partial.length - 1]);
    }
  }, []);

  useEffect(() => {
    const previousNavigateTo = (window as any).navigateTo;
    (window as any).navigateTo = navigateTo;
    return () => {
      if ((window as any).navigateTo === navigateTo) {
        if (previousNavigateTo) (window as any).navigateTo = previousNavigateTo;
        else delete (window as any).navigateTo;
      }
    };
  }, [navigateTo]);

  // Determine if current view is a child/subpage
  const isChildPage =
    currentRoute.includes('/') ||
    currentRoute.startsWith('catalog') ||
    currentRoute === 'production' ||
    currentRoute.startsWith('branches') ||
    currentRoute === 'materials';

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
      className="w-full max-w-[430px] mx-auto min-h-screen bg-[#F8FAFC] text-slate-900 font-sans flex flex-col relative antialiased selection:bg-emerald-100"
    >
      {/* 1. Global Clean Mobile TopBar (1:1 with Original x-dash-topbar) */}
      {!isChildPage && (
        <header
          style={{
            paddingTop: 'max(8px, env(safe-area-inset-top, 0px))',
            boxSizing: 'border-box'
          }}
          className="sticky top-0 left-0 right-0 w-full max-w-[430px] mx-auto h-[56px] min-h-[56px] bg-white border-b border-slate-200 z-[120] px-4 flex items-center justify-between shadow-xs"
        >
          {/* Left: Branch context selector pill (x-branch-selector) */}
          <div id="x-branch-selector-wrap" className="relative">
            <div
              id="x-branch-selector"
              className={`x-branch-selector x-branch-dropdown flex items-center gap-2 bg-white border border-[#475569] rounded-full h-[38px] px-3 max-w-[210px] cursor-pointer shadow-xs select-none hover:bg-slate-50 transition-all ${
                isBranchDropdownOpen ? 'open' : ''
              }`}
              onClick={() => setIsBranchDropdownOpen(!isBranchDropdownOpen)}
              role="button"
              tabIndex={0}
              aria-haspopup="listbox"
              aria-expanded={isBranchDropdownOpen}
              aria-label="Pilih cabang"
            >
              <svg className="x-branch-pin-icon text-emerald-600 flex-shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span id="branch-current-label" className="x-branch-current-label text-[13.5px] font-semibold text-slate-800 truncate max-w-[125px]">
                {activeBranchName}
              </span>
              <svg className={`x-branch-chevron-icon text-slate-500 flex-shrink-0 transition-transform duration-200 ${isBranchDropdownOpen ? 'rotate-180' : ''}`} aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>

            {/* Custom Inline Dropdown Menu */}
            {isBranchDropdownOpen && (
              <div
                id="branch-dropdown-menu"
                className="x-branch-dropdown-menu absolute top-[calc(100%+6px)] left-0 min-w-[200px] bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 z-[150] flex flex-col gap-1 max-h-[260px] overflow-y-auto animate-in fade-in duration-100"
                role="listbox"
                aria-label="Pilih cabang"
              >
                <button
                  type="button"
                  className={`x-branch-dropdown-item w-full flex items-center justify-between px-3 py-2 text-[13px] font-medium rounded-lg text-left transition-colors ${
                    activeBranchId === 'all' ? 'active bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  role="option"
                  aria-selected={activeBranchId === 'all'}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectBranch('all', 'Semua Cabang');
                  }}
                >
                  <span>Semua Cabang</span>
                  {activeBranchId === 'all' && (
                    <svg className="x-branch-check-icon text-emerald-600 w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  )}
                </button>
                {branchList.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`x-branch-dropdown-item w-full flex items-center justify-between px-3 py-2 text-[13px] font-medium rounded-lg text-left transition-colors ${
                      activeBranchId === String(b.id) ? 'active bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                    role="option"
                    aria-selected={activeBranchId === String(b.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectBranch(String(b.id), b.name);
                    }}
                  >
                    <span className="truncate pr-2">{b.name}</span>
                    {activeBranchId === String(b.id) && (
                      <svg className="x-branch-check-icon text-emerald-600 w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Messages, Notifications, Profile (Twin circular stroke icon buttons) */}
          <div className="flex items-center gap-2 ml-auto">
            {/* 1. Direct Messages / Ops Chat Button */}
            <button
              type="button"
              id="btn-messages"
              aria-label="Pesan & Broadcast"
              title="Kotak Pesan & Pengumuman"
              data-ops-chat-inbox="1"
              onClick={() => {
                if (typeof (window as any).openOpsChat === 'function') {
                  (window as any).openOpsChat();
                } else if (typeof (window as any).showToast === 'function') {
                  (window as any).showToast('Kotak Pesan & Pengumuman');
                }
              }}
              className="x-topbar-icon-btn x-topbar-icon-btn-round w-[38px] h-[38px] rounded-full bg-white border border-[#cbd5e1] flex items-center justify-center text-[#334155] hover:border-slate-400 hover:bg-slate-50 active:scale-95 transition-all relative cursor-pointer"
            >
              <img src="/owner/assets/icons/reicon_plane-filled.svg" alt="" className="w-[18px] h-[18px]" />
              <span
                data-ops-chat-badge
                style={{ display: 'none' }}
                className="absolute -top-[3px] -right-[3px] min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-extrabold leading-[16px] text-center"
              >
                0
              </span>
            </button>

            {/* 2. Notifications Button */}
            <button
              type="button"
              id="btn-notifications"
              aria-label="Notifikasi"
              title="Notifikasi"
              onClick={() => {
                if (typeof (window as any).openNotifications === 'function') {
                  (window as any).openNotifications();
                } else if (typeof (window as any).showToast === 'function') {
                  (window as any).showToast('Tidak ada notifikasi baru');
                }
              }}
              className="x-topbar-icon-btn x-topbar-icon-btn-round w-[38px] h-[38px] rounded-full bg-white border border-[#cbd5e1] flex items-center justify-center text-[#334155] hover:border-slate-400 hover:bg-slate-50 active:scale-95 transition-all relative cursor-pointer"
            >
              <img src="/owner/assets/icons/bi_bell-fill.svg" alt="" className="w-[17px] h-[17px] opacity-80" />
            </button>

            {/* 3. User Avatar Profile Button */}
            <div
              id="dash-user-profile"
              role="button"
              tabIndex={0}
              aria-label="Profil Akun"
              onClick={() => {
                if (typeof (window as any).openMobileAccount === 'function') {
                  (window as any).openMobileAccount();
                } else {
                  navigateTo('more');
                }
              }}
              className="x-admin-profile w-[38px] h-[38px] rounded-full bg-white border border-[#cbd5e1] flex items-center justify-center text-[#334155] hover:border-slate-400 hover:bg-slate-50 active:scale-95 transition-all cursor-pointer overflow-hidden"
            >
              <div className="x-avatar x-avatar-stroke-round w-full h-full flex items-center justify-center">
                <img src="/owner/assets/icons/flowbite_user-solid.svg" alt="" className="w-[17px] h-[17px] text-slate-700" />
              </div>
            </div>
          </div>
        </header>
      )}

      {/* 2. Main Scrollable Content Area */}
      <main
        className={`w-full flex-1 flex flex-col px-4 ${
          !isChildPage ? 'pt-3 pb-[78px]' : 'pt-3 pb-3'
        }`}
      >
        {(currentRoute === 'overview' || currentRoute === '') && (
          <OverviewPage
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {currentRoute === 'overview/target' && (
          <TargetSettingPage
            onBack={() => navigateTo('overview')}
            onSaved={() => navigateTo('overview')}
          />
        )}

        {currentRoute === 'catalog/categories' && (
          <CategoriesPage
            onBack={() => navigateTo('business')}
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
              onAddMenu={() => navigateTo('catalog/master-menus/new', { history: 'push' })}
              onEditMenu={(mId: string) => navigateTo(`catalog/master-menus/${encodeURIComponent(mId)}/edit`, { history: 'push' })}
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
            onBack={() => navigateTo('business')}
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {(currentRoute === 'catalog/products/new' ||
          /^catalog\/products\/[^/]+\/edit$/.test(currentRoute)) && (
          <ItemEditorPage
            productId={
              /^catalog\/products\/[^/]+\/edit$/.test(currentRoute)
                ? decodeURIComponent(
                    currentRoute.split('catalog/products/')[1].split('/edit')[0]
                  )
                : null
            }
            onBack={() => navigateTo('catalog/products')}
            onSaved={() => navigateTo('catalog/products')}
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

        {(currentRoute === 'business/affiliate' ||
          currentRoute === 'marketing/affiliate' ||
          currentRoute === 'affiliate') && (
          <AffiliatePage
            onBack={() => navigateTo('business')}
            onNavigate={(r: string) => navigateTo(r)}
          />
        )}

        {(currentRoute === 'business/materials' || currentRoute === 'materials') && (
          <MaterialsPage
            onBack={() => navigateTo('business')}
            onNavigate={(r) => navigateTo(r)}
          />
        )}

        {(currentRoute === 'business/materials/new' ||
          currentRoute === 'materials/new' ||
          /^business\/materials\/[^/]+(?:\/edit)?$/.test(currentRoute) ||
          /^materials\/[^/]+(?:\/edit)?$/.test(currentRoute)) && (
          <MaterialEditorPage
            key={currentRoute}
            materialId={
              /^business\/materials\/[^/]+(?:\/edit)?$/.test(currentRoute) && currentRoute !== 'business/materials/new'
                ? decodeURIComponent(currentRoute.split('business/materials/')[1].replace(/\/edit$/, ''))
                : /^materials\/[^/]+(?:\/edit)?$/.test(currentRoute) && currentRoute !== 'materials/new'
                ? decodeURIComponent(currentRoute.split('materials/')[1].replace(/\/edit$/, ''))
                : null
            }
            onBack={() => navigateTo('business/materials')}
            onSaved={() => navigateTo('business/materials')}
          />
        )}

        {currentRoute === 'orders' && (
          <OrdersPage
            onNavigate={(r: string) => navigateTo(r)}
          />
        )}

        {currentRoute === 'branches' && (
          <BranchesPage
            onBack={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('overview', { history: 'replace' });
              }
            }}
            onNavigate={(r: string, opts?: any) => navigateTo(r, opts)}
          />
        )}

        {currentRoute === 'branches/new' && (
          <BranchEditorPage
            onBack={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('branches', { history: 'replace' });
              }
            }}
            onSaved={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('branches', { history: 'replace' });
              }
            }}
            onNavigate={(r: string, opts?: any) => navigateTo(r, opts)}
          />
        )}

        {(/^branches\/[^/]+(?:\/edit)?$/.test(currentRoute) && currentRoute !== 'branches/new') && (
          <BranchEditorPage
            branchId={decodeURIComponent(currentRoute.split('branches/')[1].replace(/\/edit$/, ''))}
            onBack={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('branches', { history: 'replace' });
              }
            }}
            onSaved={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigateTo('branches', { history: 'replace' });
              }
            }}
            onNavigate={(r: string, opts?: any) => navigateTo(r, opts)}
          />
        )}

        {currentRoute === 'finance' && (
          <FinancePage
            onNavigate={(r: string) => navigateTo(r)}
          />
        )}

        {(currentRoute === 'more' || currentRoute === 'account') && (
          <MorePage
            onNavigate={(r: string) => navigateTo(r)}
          />
        )}
      </main>

      {/* 3. Persistent Mobile Bottom Navigation (Shown on main tabs only - 1:1 Figma Tailwind Spec) */}
      {!isChildPage && (
        <nav
          id="clean-owner-bottom-nav"
          style={{
            paddingTop: '0px',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
            paddingLeft: '12px',
            paddingRight: '12px',
            boxSizing: 'border-box'
          }}
          className="fixed bottom-0 left-0 right-0 max-w-[430px] mx-auto bg-white rounded-tl-[20px] rounded-tr-[20px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] z-[150] grid grid-cols-5 items-center overflow-hidden"
        >
          {[
            { id: 'overview' as MainTab, label: 'Beranda', icon: '/owner/assets/icons/fa7-solid_home.svg', route: 'overview', mod: 'beranda' },
            { id: 'business' as MainTab, label: 'Bisnis', icon: '/owner/assets/icons/ic_round-business-center-new.svg', route: 'business', mod: 'bisnis' },
            { id: 'orders' as MainTab, label: 'Pesanan', icon: '/owner/assets/icons/fluent_task-list-rectangle-28-filled.svg', route: 'orders', mod: 'pesanan' },
            { id: 'finance' as MainTab, label: 'Keuangan', icon: '/owner/assets/icons/reicon_wallet-money-filled.svg', route: 'finance', mod: 'keuangan' },
            { id: 'more' as MainTab, label: 'Lainnya', icon: '/owner/assets/icons/reicon_menu-board-filled.svg', route: 'more', mod: 'lainnya' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-route={tab.route}
                data-tab-module={tab.mod}
                onClick={() => navigateTo(tab.route)}
                className="relative flex flex-col items-center justify-start h-full cursor-pointer transition-all active:scale-95 bg-transparent border-none outline-none shadow-none"
                style={{
                  paddingTop: '12px',
                  paddingBottom: '6px',
                  boxSizing: 'border-box'
                }}
              >
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '44px',
                      height: '3.5px',
                      backgroundColor: '#16A34A',
                      borderBottomLeftRadius: '4px',
                      borderBottomRightRadius: '4px',
                      pointerEvents: 'none'
                    }}
                  />
                )}
                <img
                  src={tab.icon}
                  alt=""
                  className={`w-[22px] h-[22px] transition-opacity ${isActive ? 'opacity-100' : 'opacity-85'}`}
                  style={isActive ? { filter: 'brightness(0) saturate(100%) invert(48%) sepia(97%) saturate(1451%) hue-rotate(116deg) brightness(92%) contrast(101%)' } : {}}
                />
                <span className="font-['Plus_Jakarta_Sans'] text-xs font-bold text-slate-900 leading-none mt-1.5">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Session Expired Bottom Sheet Modal */}
      {isSessionExpired && (
        <div id="xentra-session-expired-modal" className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="w-full max-w-[430px] bg-white rounded-t-[24px] sm:rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="text-lg font-extrabold text-slate-900 mb-2">Sesi Login Telah Berakhir</h3>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              Sesi login Pemilik Toko telah kedaluwarsa demi keamanan akun. Silakan masuk kembali untuk mengakses seluruh data toko.
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem('xentra_merchant_token');
                  localStorage.removeItem('xentra_merchant_user');
                  if ((window as any).XentraOwnerBridge && typeof (window as any).XentraOwnerBridge.clearAuth === 'function') {
                    (window as any).XentraOwnerBridge.clearAuth();
                  }
                } catch (_) {}
                window.location.href = '/login?target=owner';
              }}
              className="w-full py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-sm transition-all shadow-md active:scale-95"
            >
              Masuk Kembali
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OwnerAppShell;
