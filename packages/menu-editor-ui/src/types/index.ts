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

export type OverviewPeriod = 'today' | '7d' | '30d' | 'custom';

export interface OverviewKPIs {
  net_sales: number;
  orders: number;
  customers: number;
  aov: number;
  trend?: {
    percent: number;
    direction: 'up' | 'down';
    label?: string;
  };
}

export interface BranchPerformance {
  branch_id?: string | number;
  branch_name: string;
  total_orders: number;
  average_order_value: number;
  total_revenue: number;
}

export interface OrdersSummary {
  total: number;
  completed: number;
  in_progress: number;
  cancelled: number;
}

export interface TopProduct {
  product_id?: string | number;
  product_name: string;
  category_name?: string;
  total_units_sold: number;
  total_gross_sales: number;
}

export interface NeedsAttention {
  low_stock_items?: Array<{ id: string | number; name: string; stock: number; min_stock?: number }>;
  pending_payments_count?: number;
}

export interface OverviewData {
  kpis: OverviewKPIs;
  sales_performance?: any;
  branch_performance?: BranchPerformance[];
  orders_summary?: OrdersSummary;
  top_products?: TopProduct[];
  needs_attention?: NeedsAttention;
}
