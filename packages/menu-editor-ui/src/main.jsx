import React from 'react';
import { createRoot } from 'react-dom/client';
import MenuEditor from './components/MenuEditor';
import BusinessHub from './components/BusinessHub';
import CatalogSubHub from './components/CatalogSubHub';
import CategoriesPage from './components/CategoriesPage';
import './index.css';

const roots = new WeakMap();

export function mountMenuEditor(container, props = {}) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(<MenuEditor {...props} />);
}

export function unmountMenuEditor(container) {
  if (!container) return;
  const root = roots.get(container);
  if (root) {
    root.unmount();
    roots.delete(container);
  }
}

export function mountBusinessHub(container, props = {}) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(<BusinessHub {...props} />);
}

export function unmountBusinessHub(container) {
  if (!container) return;
  const root = roots.get(container);
  if (root) {
    root.unmount();
    roots.delete(container);
  }
}

export function mountCatalogSubHub(container, props = {}) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(<CatalogSubHub {...props} />);
}

export function unmountCatalogSubHub(container) {
  if (!container) return;
  const root = roots.get(container);
  if (root) {
    root.unmount();
    roots.delete(container);
  }
}

export function mountCategoriesPage(container, props = {}) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(<CategoriesPage {...props} />);
}

export function unmountCategoriesPage(container) {
  if (!container) return;
  const root = roots.get(container);
  if (root) {
    root.unmount();
    roots.delete(container);
  }
}

// Attach to window for global access from host Vanilla JS app
if (typeof window !== 'undefined') {
  window.mountMenuEditor = mountMenuEditor;
  window.unmountMenuEditor = unmountMenuEditor;
  window.mountBusinessHub = mountBusinessHub;
  window.unmountBusinessHub = unmountBusinessHub;
  window.mountCatalogSubHub = mountCatalogSubHub;
  window.unmountCatalogSubHub = unmountCatalogSubHub;
  window.mountCategoriesPage = mountCategoriesPage;
  window.unmountCategoriesPage = unmountCategoriesPage;
}

