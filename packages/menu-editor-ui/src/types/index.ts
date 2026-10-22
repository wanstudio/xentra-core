export type MainTab = 'overview' | 'business' | 'orders' | 'reports' | 'account';

export type SubRoute =
  | 'overview'
  | 'business'
  | 'business/catalog'
  | 'catalog/categories'
  | 'catalog/categories/new'
  | 'catalog/categories/edit'
  | 'catalog/products'
  | 'catalog/menus'
  | 'orders'
  | 'reports'
  | 'account';

export interface Branch {
  id: string;
  name: string;
  address?: string;
  is_active?: boolean | number;
}

export interface Category {
  id: string | number;
  name: string;
  description?: string;
  is_active?: boolean | number;
  sequence_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface MenuItem {
  id: string | number;
  category_id?: string | number;
  title_name?: string;
  package_name?: string;
  title?: string;
  name?: string;
  price?: number;
  is_active?: boolean | number;
  image_url?: string;
}

export interface ComposedProduct {
  id: string | number;
  name: string;
  sku?: string;
  description?: string;
  price?: number;
  is_active?: boolean | number;
}
