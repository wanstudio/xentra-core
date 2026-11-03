import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import MenuEditor from './components/MenuEditor';
import BusinessHub from './components/BusinessHub';
import CatalogSubHub from './components/CatalogSubHub';
import CategoriesPage from './components/CategoriesPage';
import ItemMasterPage from './components/ItemMasterPage';
import CategoryEditorPage from './components/CategoryEditorPage';
import ItemEditorPage from './components/ItemEditorPage';
import CategorySortPage from './components/CategorySortPage';
import CategoryDetailPage from './components/CategoryDetailPage';
import CategoryMenuSortPage from './components/CategoryMenuSortPage';
import MaterialsPage from './components/MaterialsPage';
import MaterialEditorPage from './components/MaterialEditorPage';
import AffiliatePage from './components/AffiliatePage';
import OwnerAppShell from './shell/OwnerAppShell';
import './index.css';

const roots = new Map();

function syncRun(fn) {
  try {
    flushSync(fn);
  } catch (_) {
    fn();
  }
}

function unmountContainerRoot(container) {
  if (!container) return;
  const root = roots.get(container);
  if (root) {
    syncRun(() => {
      try {
        root.unmount();
      } catch (_) {}
    });
    roots.delete(container);
  }
}

function unmountOtherPageRoots(activeContainer) {
  for (const [container] of Array.from(roots.entries())) {
    if (container === activeContainer) continue;
    if (container && container.id === 'xentra-owner-app-root') continue;
    unmountContainerRoot(container);
    if (container && container.style) {
      container.style.display = 'none';
    }
  }
}

function mountPageComponent(container, element) {
  if (!container) return;
  unmountOtherPageRoots(container);
  if (container.style) {
    container.style.display = 'block';
  }
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  syncRun(() => {
    root.render(element);
  });
}

export function unmountAllModernPages(exceptContainer = null) {
  unmountOtherPageRoots(exceptContainer);
}

export function mountMenuEditor(container, props = {}) {
  mountPageComponent(container, <MenuEditor {...props} />);
}

export function unmountMenuEditor(container) {
  unmountContainerRoot(container);
}

export function mountBusinessHub(container, props = {}) {
  mountPageComponent(container, <BusinessHub {...props} />);
}

export function unmountBusinessHub(container) {
  unmountContainerRoot(container);
}

export function mountCatalogSubHub(container, props = {}) {
  mountPageComponent(container, <CatalogSubHub {...props} />);
}

export function unmountCatalogSubHub(container) {
  unmountContainerRoot(container);
}

export function mountCategoriesPage(container, props = {}) {
  mountPageComponent(container, <CategoriesPage {...props} />);
}

export function unmountCategoriesPage(container) {
  unmountContainerRoot(container);
}

export function mountItemMasterPage(container, props = {}) {
  mountPageComponent(container, <ItemMasterPage {...props} />);
}

export function unmountItemMasterPage(container) {
  unmountContainerRoot(container);
}

export function mountItemEditorPage(container, props = {}) {
  mountPageComponent(container, <ItemEditorPage {...props} />);
}

export function unmountItemEditorPage(container) {
  unmountContainerRoot(container);
}

export function mountCategoryEditorPage(container, props = {}) {
  mountPageComponent(container, <CategoryEditorPage {...props} />);
}

export function unmountCategoryEditorPage(container) {
  unmountContainerRoot(container);
}

export function mountCategorySortPage(container, props = {}) {
  mountPageComponent(container, <CategorySortPage {...props} />);
}

export function unmountCategorySortPage(container) {
  unmountContainerRoot(container);
}

export function mountCategoryDetailPage(container, props = {}) {
  mountPageComponent(container, <CategoryDetailPage {...props} />);
}

export function unmountCategoryDetailPage(container) {
  unmountContainerRoot(container);
}

export function mountCategoryMenuSortPage(container, props = {}) {
  mountPageComponent(container, <CategoryMenuSortPage {...props} />);
}

export function unmountCategoryMenuSortPage(container) {
  unmountContainerRoot(container);
}

export function mountMaterialsPage(container, props = {}) {
  mountPageComponent(container, <MaterialsPage {...props} />);
}

export function unmountMaterialsPage(container) {
  unmountContainerRoot(container);
}

export function mountMaterialEditorPage(container, props = {}) {
  mountPageComponent(container, <MaterialEditorPage key={props.materialId || 'new'} {...props} />);
}

export function unmountMaterialEditorPage(container) {
  unmountContainerRoot(container);
}

export function mountAffiliatePage(container, props = {}) {
  mountPageComponent(container, <AffiliatePage {...props} />);
}

export function unmountAffiliatePage(container) {
  unmountContainerRoot(container);
}

export function mountOwnerAppShell(container, props = {}) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  syncRun(() => {
    root.render(<OwnerAppShell {...props} />);
  });
}

export function unmountOwnerAppShell(container) {
  unmountContainerRoot(container);
}

// Attach to window for global access from host Vanilla JS app
if (typeof window !== 'undefined') {
  window.unmountAllModernPages = unmountAllModernPages;
  window.mountMenuEditor = mountMenuEditor;
  window.unmountMenuEditor = unmountMenuEditor;
  window.mountBusinessHub = mountBusinessHub;
  window.unmountBusinessHub = unmountBusinessHub;
  window.mountCatalogSubHub = mountCatalogSubHub;
  window.unmountCatalogSubHub = unmountCatalogSubHub;
  window.mountCategoriesPage = mountCategoriesPage;
  window.unmountCategoriesPage = unmountCategoriesPage;
  window.mountItemMasterPage = mountItemMasterPage;
  window.unmountItemMasterPage = unmountItemMasterPage;
  window.mountItemEditorPage = mountItemEditorPage;
  window.unmountItemEditorPage = unmountItemEditorPage;
  window.mountCategoryEditorPage = mountCategoryEditorPage;
  window.unmountCategoryEditorPage = unmountCategoryEditorPage;
  window.mountCategorySortPage = mountCategorySortPage;
  window.unmountCategorySortPage = unmountCategorySortPage;
  window.mountCategoryDetailPage = mountCategoryDetailPage;
  window.unmountCategoryDetailPage = unmountCategoryDetailPage;
  window.mountCategoryMenuSortPage = mountCategoryMenuSortPage;
  window.unmountCategoryMenuSortPage = unmountCategoryMenuSortPage;
  window.mountMaterialsPage = mountMaterialsPage;
  window.unmountMaterialsPage = unmountMaterialsPage;
  window.mountMaterialEditorPage = mountMaterialEditorPage;
  window.unmountMaterialEditorPage = unmountMaterialEditorPage;
  window.mountAffiliatePage = mountAffiliatePage;
  window.unmountAffiliatePage = unmountAffiliatePage;
  window.mountOwnerAppShell = mountOwnerAppShell;
  window.unmountOwnerAppShell = unmountOwnerAppShell;
}

