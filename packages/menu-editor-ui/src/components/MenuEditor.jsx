import React, { useState, useEffect, useMemo, useRef } from 'react';
import MenuItemCard from './MenuItemCard';
import PickItemSheet from './PickItemSheet';
import AturItemModal from './AturItemModal';

function getAuthToken(fallbackToken) {
  if (fallbackToken) return fallbackToken;
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (_) {}
  if (typeof document !== 'undefined') {
    const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return '';
}

function formatRupiah(amount) {
  const num = Number(amount) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

function formatThousands(amount) {
  if (amount === '' || amount === null || amount === undefined) return '';
  const num = Number(amount);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString('id-ID');
}

export default function MenuEditor({
  menuId = null,
  onSaveSuccess,
  onCancel,
  onBack,
  onNavigate,
  apiBase = '/api/v1',
  token = null,
}) {
  const isEdit = Boolean(menuId);

  // Loading & initial data states
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [categories, setCategories] = useState([]);
  const [availableProducts, setAvailableProducts] = useState([]);

  // Form states
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [imageRemoved, setImageRemoved] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [originCategoryId, setOriginCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [menuItems, setMenuItems] = useState([]);
  const [pricingType, setPricingType] = useState('FIXED'); // FIXED | RANGE
  const [priceFixed, setPriceFixed] = useState(0);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);
  const [isActive, setIsActive] = useState(true);

  // Sheets and Modals
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef(null);
  const [isPickSheetOpen, setIsPickSheetOpen] = useState(false);
  const [pickItemTargetIndex, setPickItemTargetIndex] = useState(null); // null means adding new item
  const [isAturModalOpen, setIsAturModalOpen] = useState(false);
  const [aturTargetIndex, setAturTargetIndex] = useState(null);

  const authToken = getAuthToken(token);

  // Auth fetch helper
  const authFetch = async (url, options = {}) => {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
  };

  // 1. Load Initial Lookups (Categories & Available Products) + Menu Data
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      // Seed categories from memory if available
      if (typeof window !== 'undefined' && window.state && Array.isArray(window.state.categories)) {
        setCategories(window.state.categories);
      }

      // Seed menu from memory if available for instant render
      if (
        menuId &&
        typeof window !== 'undefined' &&
        window._ownerMasterMenuState &&
        Array.isArray(window._ownerMasterMenuState.menus)
      ) {
        const cachedMenu = window._ownerMasterMenuState.menus.find(
          (m) => m && String(m.id) === String(menuId)
        );
        if (cachedMenu && isMounted) {
          const cachedCatId =
            cachedMenu.category_id || (cachedMenu.category && cachedMenu.category.id) || '';
          setTitle(
            cachedMenu.title_name ||
              cachedMenu.package_name ||
              cachedMenu.title ||
              cachedMenu.name ||
              ''
          );
          if (cachedCatId) {
            setCategoryId(String(cachedCatId));
            setOriginCategoryId(String(cachedCatId));
          }
          const activeFlag =
            typeof cachedMenu.status === 'string'
              ? cachedMenu.status.toUpperCase() === 'ACTIVE'
              : cachedMenu.is_active !== 0 && cachedMenu.is_active !== false;
          setIsActive(activeFlag);
          if (cachedMenu.image_url || cachedMenu.image) {
            setImagePreview(cachedMenu.image_url || cachedMenu.image);
          }
          const sellPrice =
            cachedMenu.selling_price !== undefined
              ? cachedMenu.selling_price
              : cachedMenu.price || 0;
          setPriceFixed(Number(sellPrice) || 0);
        }
      }

      setIsLoading(true);
      try {
        const [catRes, prodRes] = await Promise.all([
          authFetch(`${apiBase}/admin/categories`).catch(() => null),
          authFetch(`${apiBase}/admin/composed/products?active_only=1`).catch(() => null),
        ]);

        let loadedProducts = [];
        if (catRes && catRes.ok) {
          const catData = await catRes.json().catch(() => null);
          if (catData && Array.isArray(catData.categories) && isMounted) {
            setCategories(catData.categories);
            if (typeof window !== 'undefined' && window.state) {
              window.state.categories = catData.categories;
            }
          }
        }

        if (prodRes && prodRes.ok) {
          const prodData = await prodRes.json().catch(() => null);
          if (prodData && Array.isArray(prodData.products) && isMounted) {
            loadedProducts = prodData.products;
            setAvailableProducts(prodData.products);
          }
        }

        if (
          !menuId &&
          typeof window !== 'undefined' &&
          window._ownerMasterMenuState &&
          window._ownerMasterMenuState.preselectedCategoryId
        ) {
          const preCatId = String(window._ownerMasterMenuState.preselectedCategoryId);
          if (isMounted) {
            setCategoryId(preCatId);
            setOriginCategoryId(preCatId);
          }
          delete window._ownerMasterMenuState.preselectedCategoryId;
        }

        // If editing existing menu
        if (menuId) {
          const menuRes = await authFetch(`${apiBase}/admin/menus/${encodeURIComponent(menuId)}`);
          const menuData = await menuRes.json().catch(() => null);
          if (menuData && menuData.menu && isMounted) {
            const m = menuData.menu;
            const resolvedTitle =
              m.title_name || m.package_name || m.title || m.name || '';
            const resolvedCatId =
              m.category_id || (m.category && m.category.id) || '';

            setTitle(resolvedTitle);
            setCategoryId(resolvedCatId ? String(resolvedCatId) : '');
            if (resolvedCatId) {
              setOriginCategoryId(String(resolvedCatId));
            }

            const activeFlag =
              typeof m.status === 'string'
                ? m.status.toUpperCase() === 'ACTIVE'
                : m.is_active !== 0 && m.is_active !== false;
            setIsActive(activeFlag);

            if (m.image_url || m.image) {
              setImagePreview(m.image_url || m.image);
            }

            if (m.pricing_type === 'RANGE') {
              setPricingType('RANGE');
              setPriceMin(Number(m.price_min ?? m.min_price) || 0);
              setPriceMax(Number(m.price_max ?? m.max_price) || 0);
            } else {
              setPricingType('FIXED');
              const sp =
                m.selling_price !== undefined
                  ? m.selling_price
                  : m.price !== undefined
                  ? m.price
                  : 0;
              setPriceFixed(Number(sp) || 0);
            }

            const rawComponents = Array.isArray(m.components)
              ? m.components
              : Array.isArray(m.items)
              ? m.items
              : [];

            if (rawComponents.length > 0) {
              setMenuItems(
                rawComponents.map((it) => {
                  const matchedProd = loadedProducts.find(
                    (p) => String(p.id) === String(it.product_id)
                  );
                  return {
                    product_id: it.product_id,
                    name:
                      it.name ||
                      it.product_name ||
                      (matchedProd ? matchedProd.name : '') ||
                      'Item',
                    quantity: Number(it.quantity) || 1,
                    options_config:
                      it.options_config !== undefined
                        ? it.options_config
                        : matchedProd?.options_config || null,
                    cogs:
                      Number(
                        it.cost_price ??
                          it.cogs ??
                          matchedProd?.cost_price ??
                          matchedProd?.cogs ??
                          0
                      ) || 0,
                  };
                })
              );
            }
          }
        }
      } catch (err) {
        console.error('Failed to load menu editor data:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [menuId]);

  // Selected Category Object & Name
  const selectedCategory = useMemo(() => {
    if (!categoryId) return null;
    return categories.find((c) => c && String(c.id) === String(categoryId)) || null;
  }, [categories, categoryId]);

  const categoryDisplayName = selectedCategory?.name || '';

  useEffect(() => {
    if (!isCategoryDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target)) {
        setIsCategoryDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isCategoryDropdownOpen]);

  // Navigation Back Handler
  const handleBack = () => {
    const targetCatId = categoryId || originCategoryId;
    if (typeof onBack === 'function') {
      onBack(targetCatId);
      return;
    }
    if (typeof onCancel === 'function') {
      onCancel(targetCatId);
      return;
    }
    const fallbackRoute = targetCatId
      ? `catalog/categories/${encodeURIComponent(targetCatId)}`
      : 'catalog/categories';
    if (typeof onNavigate === 'function') {
      onNavigate(fallbackRoute);
      return;
    }
    if (typeof window !== 'undefined' && typeof window.navigateTo === 'function') {
      window.navigateTo(fallbackRoute);
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.hash = `#${fallbackRoute}`;
    }
  };

  // 2. Calculations: HPP (modal menu)
  const hppBreakdown = useMemo(() => {
    let total = 0;
    const items = menuItems.map((item, idx) => {
      const prod = availableProducts.find((p) => String(p.id) === String(item.product_id));
      const unitCost = Number(
        prod?.cost_price ?? prod?.cogs ?? item.cost_price ?? item.cogs ?? 0
      ) || 0;
      const qty = Math.max(1, Number(item.quantity) || 1);
      const subtotal = unitCost * qty;
      total += subtotal;
      return {
        name: item.name || prod?.name || `Item ${idx + 1}`,
        subtotal,
      };
    });
    return { items, total };
  }, [menuItems, availableProducts]);

  // Handle Photo Picker
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImageRemoved(false);
    const reader = new FileReader();
    reader.onload = (re) => {
      setImagePreview(re.target?.result || '');
    };
    reader.readAsDataURL(file);
  };

  // Handlers for Items
  const handleOpenPickSheet = (index = null) => {
    setPickItemTargetIndex(index);
    setIsPickSheetOpen(true);
  };

  const handleSelectProduct = (product) => {
    const prodCost = Number(product.cost_price ?? product.cogs ?? 0) || 0;
    if (pickItemTargetIndex !== null) {
      // Replace existing item
      const updated = [...menuItems];
      updated[pickItemTargetIndex] = {
        ...updated[pickItemTargetIndex],
        product_id: product.id,
        name: product.name,
        options_config: product.options_config,
        cogs: prodCost,
      };
      setMenuItems(updated);
    } else {
      // If product already exists in menuItems, increment quantity instead of duplicate product error
      const existingIdx = menuItems.findIndex(
        (it) => String(it.product_id) === String(product.id)
      );
      if (existingIdx >= 0) {
        const updated = [...menuItems];
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: (Number(updated[existingIdx].quantity) || 1) + 1,
        };
        setMenuItems(updated);
      } else {
        setMenuItems((prev) => [
          ...prev,
          {
            product_id: product.id,
            name: product.name,
            quantity: 1,
            options_config: product.options_config,
            cogs: prodCost,
          },
        ]);
      }
    }
  };

  const handleQtyChange = (index, newQty) => {
    if (newQty < 1) return;
    const updated = [...menuItems];
    updated[index] = { ...updated[index], quantity: newQty };
    setMenuItems(updated);
  };

  const handleRemoveItem = (index) => {
    setMenuItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveVariant = (itemIndex, variantIndex) => {
    const updated = [...menuItems];
    const targetItem = updated[itemIndex];
    if (targetItem && targetItem.options_config) {
      let cfg = targetItem.options_config;
      if (typeof cfg === 'string') {
        try {
          cfg = JSON.parse(cfg);
        } catch (_) {}
      }
      if (cfg && Array.isArray(cfg.variants)) {
        const nextVariants = [...cfg.variants];
        nextVariants.splice(variantIndex, 1);
        targetItem.options_config = { ...cfg, variants: nextVariants };
        setMenuItems(updated);
      }
    }
  };

  const handleOpenAturModal = (index) => {
    setAturTargetIndex(index);
    setIsAturModalOpen(true);
  };

  const handleSaveVariantConfig = (newConfig) => {
    if (aturTargetIndex !== null) {
      const updated = [...menuItems];
      updated[aturTargetIndex] = {
        ...updated[aturTargetIndex],
        options_config: newConfig,
      };
      setMenuItems(updated);
    }
  };

  // Add Category Inline
  const handleAddCategoryQuick = () => {
    const name = prompt('Masukkan nama kategori baru:');
    if (name && name.trim()) {
      authFetch(`${apiBase}/admin/categories`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), is_active: 1 }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (res && res.success && res.category) {
            setCategories((prev) => [...prev, res.category]);
            setCategoryId(String(res.category.id));
            if (typeof window !== 'undefined' && window.state && Array.isArray(window.state.categories)) {
              window.state.categories.push(res.category);
            }
          }
        })
        .catch(() => {});
    }
  };

  // 3. Save Menu
  const handleSaveMenu = async () => {
    if (isSaving) return;
    if (!title.trim()) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('⚠️ Nama menu wajib diisi.');
      } else {
        alert('Nama menu wajib diisi.');
      }
      return;
    }
    if (!categoryId) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('⚠️ Silakan pilih kategori menu.');
      } else {
        alert('Silakan pilih kategori menu.');
      }
      return;
    }
    if (menuItems.length === 0) {
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('⚠️ Pilih minimal 1 item penyusun menu.');
      } else {
        alert('Pilih minimal 1 item penyusun menu.');
      }
      return;
    }

    setIsSaving(true);
    try {
      const sellingPriceVal =
        pricingType === 'FIXED' ? Number(priceFixed) || 0 : Number(priceMin) || 0;

      const payload = {
        name: title.trim(),
        title_name: title.trim(),
        package_name: title.trim(),
        category_id: categoryId,
        is_active: isActive ? 1 : 0,
        status: isActive ? 'ACTIVE' : 'DRAFT',
        pricing_type: pricingType,
        price: sellingPriceVal,
        selling_price: sellingPriceVal,
        cost_price: Number(hppBreakdown.total) || 0,
        price_min: pricingType === 'RANGE' ? Number(priceMin) || 0 : undefined,
        price_max: pricingType === 'RANGE' ? Number(priceMax) || 0 : undefined,
        items: menuItems.map((it) => ({
          product_id: it.product_id,
          name: it.name,
          quantity: Number(it.quantity) || 1,
          options_config: it.options_config,
        })),
      };

      const endpoint = menuId
        ? `${apiBase}/admin/menus/${encodeURIComponent(menuId)}`
        : `${apiBase}/admin/menus`;
      const method = menuId ? 'PUT' : 'POST';

      const res = await authFetch(endpoint, {
        method,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Gagal menyimpan menu.');
      }

      const savedMenu = data.menu || {};
      const savedMenuId = savedMenu.id || data.menu_id || data.id || menuId;

      // Handle Image Upload / Removal if modified
      if (imageFile && savedMenuId) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await fetch(
          `${apiBase}/admin/media/entity/menus/${encodeURIComponent(savedMenuId)}/image`,
          {
            method: 'POST',
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
            body: formData,
          }
        ).catch(() => null);
      } else if (imageRemoved && savedMenuId) {
        await authFetch(
          `${apiBase}/admin/media/entity/menus/${encodeURIComponent(savedMenuId)}/image`,
          {
            method: 'DELETE',
          }
        ).catch(() => null);
      }

      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(
          isEdit ? '✅ Menu berhasil diperbarui.' : '✅ Menu baru berhasil disimpan.'
        );
      }

      if (typeof onSaveSuccess === 'function') {
        onSaveSuccess(data, categoryId);
      } else {
        handleBack();
      }
    } catch (err) {
      console.error('Save error:', err);
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('❌ ' + (err.message || 'Terjadi kesalahan saat menyimpan menu.'));
      } else {
        alert(err.message || 'Terjadi kesalahan saat menyimpan menu.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // 4. Delete Menu
  const handleConfirmDelete = async () => {
    if (!isEdit || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await authFetch(`${apiBase}/admin/menus/${encodeURIComponent(menuId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Gagal menghapus menu.');
      }

      setShowDeleteModal(false);

      if (typeof window !== 'undefined') {
        if (
          window._ownerMasterMenuState &&
          Array.isArray(window._ownerMasterMenuState.menus)
        ) {
          window._ownerMasterMenuState.menus = window._ownerMasterMenuState.menus.filter(
            (m) => m && String(m.id) !== String(menuId)
          );
        }
        if (typeof window.showToast === 'function') {
          window.showToast(`✅ Menu "${title || 'Menu'}" berhasil dihapus.`);
        }
      }

      handleBack();
    } catch (err) {
      console.error('[MenuEditor] Delete error:', err);
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('❌ ' + (err.message || 'Gagal menghapus menu.'));
      } else {
        alert(err.message || 'Gagal menghapus menu.');
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Price input change helpers (thousand separator friendly)
  const handleFixedPriceInput = (rawValue) => {
    const digits = String(rawValue || '').replace(/\D+/g, '');
    setPriceFixed(digits ? Number(digits) : 0);
  };

  const handleMinPriceInput = (rawValue) => {
    const digits = String(rawValue || '').replace(/\D+/g, '');
    setPriceMin(digits ? Number(digits) : 0);
  };

  const handleMaxPriceInput = (rawValue) => {
    const digits = String(rawValue || '').replace(/\D+/g, '');
    setPriceMax(digits ? Number(digits) : 0);
  };

  const formattedPreviewPrice = useMemo(() => {
    if (pricingType === 'RANGE') {
      if (priceMin && priceMax && priceMax > priceMin) {
        return `${formatRupiah(priceMin)} - ${formatRupiah(priceMax)}`;
      }
      return formatRupiah(priceMin || priceMax || 0);
    }
    return formatRupiah(priceFixed || 0);
  }, [pricingType, priceFixed, priceMin, priceMax]);

  const previewCompositionText = useMemo(() => {
    const names = menuItems
      .map((m) => (m && m.name ? String(m.name).trim() : ''))
      .filter(Boolean);
    return names.length > 0 ? names.join(' + ') : 'Daftar item dalam menu';
  }, [menuItems]);

  return (
    <div
      id="modern-menu-editor-root"
      style={{
        boxSizing: 'border-box',
        paddingBottom: '150px',
      }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Header with Back Arrow, "Ubah menu" / "Tambah menu", and Subtitle "Kategori: ..." */}
      <div className="flex items-center gap-3 mb-6 pt-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain"
          />
        </button>

        <div className="flex flex-col justify-center items-start gap-1 min-w-0 flex-1">
          <h1 className="font-bold text-[#0F172A] text-lg tracking-[0] leading-[18px] m-0 truncate w-full text-left">
            {isEdit ? 'Ubah menu' : 'Tambah menu'}
          </h1>
          {categoryDisplayName && (
            <div className="text-[#94A3B8] text-[11px] font-medium leading-tight truncate w-full text-left">
              Kategori: {categoryDisplayName}
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="w-full rounded-[14px] p-4 bg-white hub-inset-stroke py-12 text-center text-sm text-[#94A3B8] font-medium">
          Memuat data menu...
        </div>
      ) : (
        <div className="w-full flex flex-col gap-4">
          {/* CARD 1: FOTO */}
          <div className="w-full p-4 bg-white rounded-[12px] hub-inset-stroke flex flex-col items-start gap-4">
            <div className="w-full flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0 flex flex-col items-start gap-2 text-left">
                <h4 className="text-[16px] font-bold text-[#0F172A] leading-tight m-0">
                  Foto
                </h4>
                <p className="text-[13px] font-medium text-[#94A3B8] leading-snug m-0">
                  Upload foto yang menarik dan menggugah selera, supaya pelangganmu tertarik
                </p>
              </div>

              <div
                style={{
                  width: '120px',
                  height: '120px',
                  borderRadius: '10px',
                }}
                className="bg-slate-100 flex items-center justify-center overflow-hidden shrink-0"
              >
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt={title || 'Foto Menu'}
                    className="w-full h-full object-cover block"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-[#94A3B8] gap-1 px-2 text-center">
                    <svg
                      width="24"
                      height="22"
                      viewBox="0 0 24 22"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M20 4H16.83L15 2H9L7.17 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7C14.76 7 17 9.24 17 12C17 14.76 14.76 17 12 17Z"
                        fill="#CBD5E1"
                      />
                    </svg>
                    <span className="text-[10px] font-medium leading-tight">Belum ada foto</span>
                  </div>
                )}
              </div>
            </div>

            <label
              style={{
                height: '40px',
                borderRadius: '20px',
                boxShadow: 'inset 0 0 0 1px #00A637',
                backgroundColor: '#FFFFFF',
              }}
              className="w-full flex items-center justify-center gap-2 cursor-pointer transition-all hover:bg-emerald-50/40 active:scale-[0.99]"
            >
              <svg
                width="13"
                height="11"
                viewBox="0 0 13 11"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="shrink-0"
              >
                <path
                  d="M11.375 2.0625H9.63625L8.62875 0.9625C8.52666 0.850592 8.40174 0.761139 8.26237 0.699961C8.123 0.638782 7.97241 0.607279 7.82 0.6075H5.18C4.86583 0.6075 4.56875 0.7395 4.37125 0.9625L3.36375 2.0625H1.625C1.02771 2.0625 0.541667 2.52513 0.541667 3.09375V9.28125C0.541667 9.84987 1.02771 10.3125 1.625 10.3125H11.375C11.9723 10.3125 12.4583 9.84987 12.4583 9.28125V3.09375C12.4583 2.52513 11.9723 2.0625 11.375 2.0625ZM6.5 8.59375C4.99958 8.59375 3.79167 7.43875 3.79167 6.01562C3.79167 4.5925 4.99958 3.4375 6.5 3.4375C8.00042 3.4375 9.20833 4.5925 9.20833 6.01562C9.20833 7.43875 8.00042 8.59375 6.5 8.59375Z"
                  fill="#00A637"
                />
              </svg>
              <span className="text-[11px] font-bold text-[#00A637] leading-none">
                {imagePreview ? 'Ganti foto' : 'Pilih foto'}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handlePhotoSelect}
              />
            </label>
          </div>

          {/* CARD 2: KATEGORI */}
          <div className="w-full p-4 bg-white rounded-[12px] hub-inset-stroke flex flex-col items-start gap-4">
            <div className="w-full flex flex-col items-start gap-2 text-left">
              <h4 className="text-[16px] font-bold text-[#0F172A] leading-tight m-0">
                Kategori
              </h4>
              <p className="text-[13px] font-medium text-[#94A3B8] leading-snug m-0">
                Pilih, atau tambahkan kategori sesuai menu yang ingin kamu buat
              </p>
            </div>

            <div className="w-full flex items-center gap-4">
              <div ref={categoryDropdownRef} className="flex-1 relative">
                <button
                  type="button"
                  onClick={() => setIsCategoryDropdownOpen((prev) => !prev)}
                  aria-haspopup="listbox"
                  aria-expanded={isCategoryDropdownOpen}
                  style={{
                    height: '40px',
                    borderRadius: '10px',
                    boxShadow: 'inset 0 0 0 1px #979797',
                    backgroundColor: '#FFFFFF',
                  }}
                  className="w-full pl-[17px] pr-9 flex items-center justify-between border-none outline-none cursor-pointer text-left transition-all"
                >
                  <span
                    className={`text-[13px] font-bold truncate ${
                      categoryDisplayName ? 'text-[#0F172A]' : 'text-[#94A3B8]'
                    }`}
                  >
                    {categoryDisplayName || 'Pilih Kategori'}
                  </span>
                  <svg
                    width="12"
                    height="8"
                    viewBox="0 0 12 8"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className={`absolute right-3.5 pointer-events-none transition-transform duration-150 ${
                      isCategoryDropdownOpen ? 'rotate-180' : ''
                    }`}
                  >
                    <path
                      d="M2.5 2.5L6 6L9.5 2.5"
                      stroke="#303030"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                {isCategoryDropdownOpen && (
                  <div
                    role="listbox"
                    style={{
                      top: '45px',
                      maxHeight: '251px',
                      padding: '10px',
                      borderRadius: '10px',
                      backgroundColor: '#FFFFFF',
                      boxShadow: '0px 4px 4px 1px rgba(0, 0, 0, 0.15)',
                      outline: '0.5px solid #F3F6FD',
                      outlineOffset: '-0.5px',
                      zIndex: 60,
                    }}
                    className="absolute left-0 right-0 flex flex-col items-start gap-[10px] overflow-y-auto"
                  >
                    {categories.length === 0 ? (
                      <div className="w-full px-3 py-2 text-[13px] font-medium text-[#94A3B8] text-left">
                        Belum ada kategori
                      </div>
                    ) : (
                      categories.map((cat) => {
                        const isSelected = String(cat.id) === String(categoryId);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => {
                              setCategoryId(String(cat.id));
                              setIsCategoryDropdownOpen(false);
                            }}
                            style={{
                              borderRadius: '8px',
                              padding: isSelected ? '10px' : '6px 12px',
                              backgroundColor: isSelected ? '#F3F6FD' : 'transparent',
                            }}
                            className="w-full flex items-center justify-between border-none outline-none cursor-pointer text-left transition-colors hover:bg-[#F3F6FD]/70"
                          >
                            <span className="text-[13px] font-bold text-[#0F172A] truncate">
                              {cat.name}
                            </span>
                            {isSelected && (
                              <svg
                                width="13"
                                height="13"
                                viewBox="0 0 13 13"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className="shrink-0 ml-2"
                              >
                                <path
                                  d="M2.17 6.5L5.42 9.75L10.84 3.25"
                                  stroke="#303030"
                                  strokeWidth="1.3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleAddCategoryQuick}
                aria-label="Tambah Kategori Baru"
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  boxShadow: 'inset 0 0 0 1px #979797',
                  backgroundColor: '#FFFFFF',
                }}
                className="flex items-center justify-center border-none text-[#303030] hover:bg-slate-50 active:scale-95 cursor-pointer transition-all shrink-0 p-0"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path
                    d="M5.5 1.2V9.8M1.2 5.5H9.8"
                    stroke="#303030"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* CARD 3: NAMA MENU */}
          <div className="w-full p-4 bg-white rounded-[12px] hub-inset-stroke flex flex-col items-start gap-4">
            <div className="w-full flex flex-col items-start gap-2 text-left">
              <label
                htmlFor="modern-menu-title-input"
                className="text-[16px] font-bold text-[#0F172A] leading-none m-0"
              >
                Nama menu
              </label>
              <p className="text-[13px] font-medium text-[#94A3B8] leading-snug m-0">
                Nama yang jelas, singkat dan menarik akan sangat membantu pelanggan kamu untuk memilih menu
              </p>
            </div>

            <div className="w-full rounded-[14px] bg-white hub-inset-stroke hub-search overflow-hidden flex items-center">
              <input
                id="modern-menu-title-input"
                type="text"
                maxLength={150}
                value={title}
                placeholder="Ayam Tulang Lunak Geprek + Nasi + Es Teh"
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-4 bg-transparent border-none outline-none text-[13px] font-bold text-[#0F172A] placeholder:text-[#94A3B8] placeholder:font-medium"
              />
            </div>
          </div>

          {/* CARD 4: MENU ITEMS */}
          <div className="w-full p-4 bg-white rounded-[12px] hub-inset-stroke flex flex-col items-start gap-4">
            <div className="w-full flex flex-col items-start gap-3 text-left">
              <h4 className="text-[16px] font-bold text-[#0F172A] leading-none m-0">
                Menu items
              </h4>
              <p className="text-[13px] font-medium text-[#94A3B8] leading-snug m-0">
                Masukkan item yang akan dijual, sesuaikan dengan judul menu yang sedang kamu buat
              </p>

              {/* List of Item Cards */}
              {menuItems.length > 0 && (
                <div className="w-full flex flex-col gap-3">
                  {menuItems.map((item, idx) => (
                    <MenuItemCard
                      key={`${item.product_id}-${idx}`}
                      item={item}
                      index={idx}
                      onQtyChange={handleQtyChange}
                      onRemoveItem={handleRemoveItem}
                      onOpenPickSheet={handleOpenPickSheet}
                      onOpenAturModal={handleOpenAturModal}
                      onRemoveVariant={handleRemoveVariant}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* + Tambah item Button */}
            <button
              type="button"
              onClick={() => handleOpenPickSheet(null)}
              style={{
                height: '40px',
                borderRadius: '10px',
                backgroundColor: '#F0F0F0',
                boxShadow: 'inset 0 0 0 1px #E1E1E1',
              }}
              className="w-full border-none text-black font-bold text-[14px] flex items-center justify-center gap-[7px] cursor-pointer transition-all hover:bg-slate-200/80 active:scale-[0.99]"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path
                  d="M6.5 1.5V11.5M1.5 6.5H11.5"
                  stroke="#000000"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
              <span>Tambah item</span>
            </button>
          </div>

          {/* CARD 5: HPP (MODAL MENU) */}
          <div className="w-full p-4 bg-white rounded-[12px] hub-inset-stroke flex flex-col items-start gap-4">
            <h4 className="w-full text-[16px] font-bold text-[#303030] leading-none m-0 text-left">
              HPP (modal menu)
            </h4>
            <p className="w-full text-[13px] font-medium text-[#94A3B8] leading-snug m-0 text-left">
              Jumlah total modal yang digunakan untuk menu
            </p>

            <div
              style={{
                borderRadius: '10px',
                backgroundColor: '#F3F6FD',
                boxShadow: 'inset 0 0 0 1px #E1E1E1',
              }}
              className="w-full px-[14px] py-[12px] flex flex-col gap-[10px]"
            >
              {hppBreakdown.items.length === 0 ? (
                <div className="text-[11px] text-[#94A3B8] italic text-left">
                  Belum ada item dipilih
                </div>
              ) : (
                hppBreakdown.items.map((it, i) => (
                  <div
                    key={i}
                    className="w-full flex items-center justify-between gap-2 text-[11px] font-normal text-[#303030] leading-tight"
                  >
                    <span className="truncate text-left">{it.name}</span>
                    <span className="shrink-0 text-right">{formatRupiah(it.subtotal)}</span>
                  </div>
                ))
              )}

              <div className="w-full h-[1px] bg-[#D7D7D7]" />

              <div className="w-full flex items-center justify-between text-[14px] font-bold text-[#303030] leading-tight">
                <span>Total HPP</span>
                <span className="text-right">{formatRupiah(hppBreakdown.total)}</span>
              </div>
            </div>
          </div>

          {/* CARD 6: HARGA JUAL (Rp) */}
          <div className="w-full p-4 bg-white rounded-[12px] hub-inset-stroke flex flex-col items-start gap-4">
            <h4 className="w-full text-[16px] font-bold text-[#303030] leading-none m-0 text-left">
              Harga jual (Rp)
            </h4>
            <p className="w-full text-[13px] font-medium text-[#94A3B8] leading-snug m-0 text-left">
              Tentukan harga jual menu ini, kamu bisa pilih harga tetap (Fixed) atau rentang harga (Range) sesuai kebutuhanmu
            </p>

            {/* Tabs: Fixed vs Range */}
            <div className="w-full flex items-start justify-center gap-5">
              <button
                type="button"
                onClick={() => setPricingType('FIXED')}
                className="flex-1 flex flex-col items-center gap-[11px] bg-transparent border-none p-0 cursor-pointer"
              >
                <span
                  className={`text-[16px] font-bold leading-tight ${
                    pricingType === 'FIXED' ? 'text-[#303030]' : 'text-[#D9D9D9]'
                  }`}
                >
                  Fixed
                </span>
                <div
                  className={`w-full h-[1px] ${
                    pricingType === 'FIXED' ? 'bg-[#979797]' : 'bg-transparent'
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => setPricingType('RANGE')}
                className="flex-1 flex flex-col items-center gap-[11px] bg-transparent border-none p-0 cursor-pointer"
              >
                <span
                  className={`text-[16px] font-bold leading-tight ${
                    pricingType === 'RANGE' ? 'text-[#303030]' : 'text-[#D9D9D9]'
                  }`}
                >
                  Range
                </span>
                <div
                  className={`w-full h-[1px] ${
                    pricingType === 'RANGE' ? 'bg-[#979797]' : 'bg-transparent'
                  }`}
                />
              </button>
            </div>

            {pricingType === 'FIXED' ? (
              <div className="w-full rounded-[14px] bg-white hub-inset-stroke hub-search overflow-hidden flex items-center">
                <input
                  type="text"
                  inputMode="numeric"
                  value={priceFixed ? formatThousands(priceFixed) : ''}
                  placeholder="0"
                  onChange={(e) => handleFixedPriceInput(e.target.value)}
                  className="w-full p-4 bg-transparent border-none outline-none text-[13px] font-bold text-[#0F172A] placeholder:text-[#94A3B8]"
                />
              </div>
            ) : (
              <div className="w-full flex items-center gap-3">
                <div className="flex-1 rounded-[14px] bg-white hub-inset-stroke hub-search overflow-hidden flex items-center">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Harga Min"
                    value={priceMin ? formatThousands(priceMin) : ''}
                    onChange={(e) => handleMinPriceInput(e.target.value)}
                    className="w-full p-4 bg-transparent border-none outline-none text-[13px] font-bold text-[#0F172A] placeholder:text-[#94A3B8]"
                  />
                </div>
                <span className="text-[#94A3B8] font-bold">-</span>
                <div className="flex-1 rounded-[14px] bg-white hub-inset-stroke hub-search overflow-hidden flex items-center">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Harga Max"
                    value={priceMax ? formatThousands(priceMax) : ''}
                    onChange={(e) => handleMaxPriceInput(e.target.value)}
                    className="w-full p-4 bg-transparent border-none outline-none text-[13px] font-bold text-[#0F172A] placeholder:text-[#94A3B8]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* CARD 7: PREVIEW */}
          <div className="w-full p-4 bg-white rounded-[12px] hub-inset-stroke flex flex-col items-start gap-4">
            <h4 className="w-full text-[16px] font-bold text-[#303030] leading-none m-0 text-left">
              Preview
            </h4>
            <p className="w-full text-[13px] font-medium text-[#94A3B8] leading-snug m-0 text-left">
              Seperti inilah yang akan pelanggan kamu lihat, cek kembali apakah sudah sesuai dengan menu yang ingin kamu jual
            </p>

            <div
              style={{
                borderRadius: '10px',
                boxShadow: 'inset 0 0 0 1px #E1E1E1',
                backgroundColor: '#FFFFFF',
              }}
              className="w-full p-3.5 flex items-start justify-between gap-3"
            >
              <div className="flex-1 min-w-0 flex flex-col items-start gap-2.5 text-left">
                <div className="w-full text-[15px] font-bold text-black leading-snug break-words">
                  {title || 'Nama Menu'}
                </div>
                <div className="w-full text-[11px] font-normal text-[#303030] leading-snug break-words">
                  {previewCompositionText}
                </div>
                <div className="text-[14px] font-bold text-black leading-tight">
                  {formattedPreviewPrice}
                </div>
              </div>

              <div
                style={{
                  width: '80px',
                  height: '79px',
                  borderRadius: '10px',
                }}
                className="bg-slate-100 flex items-center justify-center overflow-hidden shrink-0"
              >
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt={title || 'Preview'}
                    className="w-full h-full object-cover block"
                  />
                ) : (
                  <svg
                    width="22"
                    height="20"
                    viewBox="0 0 24 22"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M20 4H16.83L15 2H9L7.17 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7C14.76 7 17 9.24 17 12C17 14.76 14.76 17 12 17Z"
                      fill="#CBD5E1"
                    />
                  </svg>
                )}
              </div>
            </div>
          </div>

          {/* CARD 8: AKTIFKAN MENU */}
          <div className="w-full p-4 bg-white rounded-[14px] hub-inset-stroke flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0 flex flex-col items-start gap-1 text-left">
              <span className="w-full text-[16px] font-bold text-black leading-snug">
                Aktifkan menu
              </span>
              <span className="w-full text-[13px] font-medium text-[#94A3B8] leading-snug">
                Menu aktif akan muncul di aplikasi customer dan bisa langsung dipesan oleh pelanggan
              </span>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              aria-label="Aktifkan menu"
              onClick={() => setIsActive((prev) => !prev)}
              className="p-0 border-none bg-transparent cursor-pointer shrink-0 flex items-center justify-center transition-transform active:scale-95"
            >
              <img
                src={
                  isActive
                    ? '/owner/assets/icons/green-toggle.svg'
                    : '/owner/assets/icons/red-toggle.svg'
                }
                alt={isActive ? 'Aktif' : 'Nonaktif'}
                className="w-[45px] h-[31px] object-contain select-none pointer-events-none block"
              />
            </button>
          </div>

          {/* CARD 9: HAPUS MENU (Shown in Edit mode) */}
          {isEdit && (
            <div className="w-full p-4 bg-white rounded-[14px] hub-inset-stroke flex flex-col items-start gap-6">
              <div className="w-full flex flex-col items-start gap-1 text-left">
                <span className="w-full text-[16px] font-bold text-black leading-snug">
                  Hapus menu
                </span>
                <span className="w-full text-[13px] font-medium text-[#94A3B8] leading-snug">
                  Menu yang sudah dihapus tidak akan bisa di kembalikan
                </span>
              </div>

              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowDeleteModal(true)}
                style={{
                  borderRadius: '20px',
                  boxShadow: 'inset 0 0 0 1px #FA3E3E',
                  backgroundColor: '#FFFFFF',
                  paddingTop: '13px',
                  paddingBottom: '13px',
                }}
                className="w-full border-none text-[#FA3E3E] text-[11px] font-bold flex items-center justify-center cursor-pointer transition-all hover:bg-red-50/50 active:scale-[0.99] disabled:opacity-50"
              >
                {isDeleting ? 'Menghapus...' : 'Hapus menu'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Custom Delete Menu Confirmation Modal */}
      {showDeleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-menu-modal-title"
          onClick={() => {
            if (!isDeleting) setShowDeleteModal(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.35)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '353px',
              minHeight: '170px',
              paddingLeft: '17px',
              paddingRight: '17px',
              paddingTop: '18px',
              paddingBottom: '18px',
              backgroundColor: '#FFFFFF',
              boxShadow: '0px 2px 10px rgba(0, 0, 0, 0.20)',
              borderRadius: '16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
              gap: '17px',
              boxSizing: 'border-box',
            }}
          >
            <div
              id="delete-menu-modal-title"
              style={{
                color: '#0F172A',
                fontSize: '18px',
                fontWeight: 700,
                lineHeight: '18px',
              }}
            >
              Hapus menu
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: '12px',
                width: '100%',
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  boxShadow: 'inset 0 0 0 1px rgba(250, 62, 62, 0.30)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 17 17"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M2.125 4.25H3.54167H14.875"
                    stroke="#FA3E3E"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5.66666 4.25008V2.83341C5.66666 2.45769 5.81591 2.09736 6.08159 1.83168C6.34727 1.566 6.7076 1.41675 7.08332 1.41675H9.91666C10.2924 1.41675 10.6527 1.566 10.9184 1.83168C11.1841 2.09736 11.3333 2.45769 11.3333 2.83341V4.25008M13.4583 4.25008V14.1667C13.4583 14.5425 13.3091 14.9028 13.0434 15.1685C12.7777 15.4342 12.4174 15.5834 12.0417 15.5834H4.95832C4.5826 15.5834 4.22227 15.4342 3.95659 15.1685C3.69091 14.9028 3.54166 14.5425 3.54166 14.1667V4.25008H13.4583Z"
                    stroke="#FA3E3E"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7.08334 7.79175V12.0417"
                    stroke="#FA3E3E"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9.91666 7.79175V12.0417"
                    stroke="#FA3E3E"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <div
                style={{
                  color: '#737373',
                  fontSize: '13px',
                  fontWeight: 500,
                  lineHeight: '1.35',
                  textAlign: 'left',
                  wordBreak: 'break-word',
                }}
              >
                <div>Hapus menu “{title || 'ini'}”?</div>
                <div>Tindakan ini tidak dapat dibatalkan.</div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: '10px',
                width: '100%',
              }}
            >
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowDeleteModal(false)}
                style={{
                  flex: '1 1 0',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: '#F3F6FD',
                  boxShadow: 'inset 0 0 0 1px #D9D9D9',
                  border: 'none',
                  outline: 'none',
                  color: '#979797',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="active:scale-[0.98] transition-transform"
              >
                Batal
              </button>

              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                style={{
                  flex: '1 1 0',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(250, 62, 62, 0.10)',
                  boxShadow: 'inset 0 0 0 1px #FA3E3E',
                  border: 'none',
                  outline: 'none',
                  color: '#FA3E3E',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="active:scale-[0.98] transition-transform"
              >
                {isDeleting ? 'Menghapus...' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fixed Bottom Action Bar (Matching Figma Mockup: rounded-t-[20px], top shadow, 48px #00A637 pill button "Simpan") */}
      <div
        id="modern-menu-editor-bottom-bar"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          width: '100%',
          backgroundColor: '#ffffff',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          boxShadow: '0px 0px 15px rgba(0, 0, 0, 0.15)',
          zIndex: 200,
          paddingTop: '24px',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
          paddingLeft: '16px',
          paddingRight: '16px',
          boxSizing: 'border-box',
        }}
        className="w-full bg-white rounded-t-[20px] z-[200]"
      >
        <div className="w-full max-w-lg mx-auto">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveMenu}
            style={{
              width: '100%',
              height: '48px',
              borderRadius: '9999px',
              border: 'none',
              outline: 'none',
              backgroundColor: isSaving ? '#94A3B8' : '#00A637',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '14px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            className="active:scale-[0.98] hover:bg-[#009230]"
          >
            {isSaving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>

      {/* Modals & Sheets */}
      <PickItemSheet
        isOpen={isPickSheetOpen}
        onClose={() => setIsPickSheetOpen(false)}
        products={availableProducts}
        categories={categories}
        onSelectProduct={handleSelectProduct}
        initialSelectedId={
          pickItemTargetIndex !== null ? menuItems[pickItemTargetIndex]?.product_id : null
        }
      />

      <AturItemModal
        isOpen={isAturModalOpen}
        onClose={() => setIsAturModalOpen(false)}
        item={aturTargetIndex !== null ? menuItems[aturTargetIndex] : null}
        onSaveConfig={handleSaveVariantConfig}
      />
    </div>
  );
}
