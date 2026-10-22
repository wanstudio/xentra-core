import React, { useState, useEffect, useMemo } from 'react';
import { Camera, ChevronLeft, Plus } from 'lucide-react';
import MenuItemCard from './MenuItemCard';
import PickItemSheet from './PickItemSheet';
import AturItemModal from './AturItemModal';

export default function MenuEditor({
  menuId = null,
  onSaveSuccess,
  onCancel,
  apiBase = '/api/v1',
  token = null,
}) {
  // Loading & initial data states
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [availableProducts, setAvailableProducts] = useState([]);

  // Form states
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [imageRemoved, setImageRemoved] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [menuItems, setMenuItems] = useState([]);
  const [pricingType, setPricingType] = useState('FIXED'); // FIXED | RANGE
  const [priceFixed, setPriceFixed] = useState(0);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);
  const [isActive, setIsActive] = useState(true);

  // Sheets and Modals
  const [isPickSheetOpen, setIsPickSheetOpen] = useState(false);
  const [pickItemTargetIndex, setPickItemTargetIndex] = useState(null); // null means adding new item
  const [isAturModalOpen, setIsAturModalOpen] = useState(false);
  const [aturTargetIndex, setAturTargetIndex] = useState(null);

  const authToken = token || localStorage.getItem('xentra_merchant_token') || '';

  // Auth fetch helper
  const authFetch = async (url, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: authToken ? `Bearer ${authToken}` : '',
      ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
  };

  // 1. Load Initial Lookups (Categories & Available Products)
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const [catRes, prodRes] = await Promise.all([
          authFetch(`${apiBase}/admin/categories`),
          authFetch(`${apiBase}/admin/composed/products?active_only=1`),
        ]);

        const catData = await catRes.json();
        const prodData = await prodRes.json();

        if (catData && catData.categories) {
          setCategories(catData.categories);
        }
        if (prodData && prodData.products) {
          setAvailableProducts(prodData.products);
        }

        if (!menuId && typeof window !== 'undefined' && window._ownerMasterMenuState && window._ownerMasterMenuState.preselectedCategoryId) {
          setCategoryId(String(window._ownerMasterMenuState.preselectedCategoryId));
          delete window._ownerMasterMenuState.preselectedCategoryId;
        }

        // If editing existing menu
        if (menuId) {
          const menuRes = await authFetch(`${apiBase}/admin/menus/${encodeURIComponent(menuId)}`);
          const menuData = await menuRes.json();
          if (menuData && menuData.menu) {
            const m = menuData.menu;
            setTitle(m.name || m.title || '');
            setCategoryId(m.category_id || '');
            setIsActive(m.is_active !== 0 && m.is_active !== false);

            if (m.image_url) {
              setImagePreview(m.image_url);
            }

            if (m.pricing_type === 'RANGE') {
              setPricingType('RANGE');
              setPriceMin(m.price_min || 0);
              setPriceMax(m.price_max || 0);
            } else {
              setPricingType('FIXED');
              setPriceFixed(m.price || 0);
            }

            if (Array.isArray(m.items) && m.items.length > 0) {
              setMenuItems(
                m.items.map((it) => ({
                  product_id: it.product_id,
                  name: it.name || it.product_name,
                  quantity: it.quantity || 1,
                  options_config: it.options_config,
                  cogs: it.cogs || 0,
                }))
              );
            }
          }
        }
      } catch (err) {
        console.error('Failed to load menu editor data:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [menuId]);

  // 2. Calculations: HPP
  const hppBreakdown = useMemo(() => {
    let total = 0;
    const items = menuItems.map((item, idx) => {
      const prod = availableProducts.find((p) => String(p.id) === String(item.product_id));
      const cogs = prod?.cogs || item.cogs || 0;
      const subtotal = cogs * (item.quantity || 1);
      total += subtotal;
      return {
        name: item.name || `Item ${idx + 1}`,
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
      setImagePreview(re.target?.result);
    };
    reader.readAsDataURL(file);
  };

  // Handlers for Items
  const handleOpenPickSheet = (index = null) => {
    setPickItemTargetIndex(index);
    setIsPickSheetOpen(true);
  };

  const handleSelectProduct = (product) => {
    if (pickItemTargetIndex !== null) {
      // Replace existing item
      const updated = [...menuItems];
      updated[pickItemTargetIndex] = {
        ...updated[pickItemTargetIndex],
        product_id: product.id,
        name: product.name,
        options_config: product.options_config,
        cogs: product.cogs || 0,
      };
      setMenuItems(updated);
    } else {
      // Add new item
      setMenuItems((prev) => [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          quantity: 1,
          options_config: product.options_config,
          cogs: product.cogs || 0,
        },
      ]);
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
        cfg.variants.splice(variantIndex, 1);
        targetItem.options_config = { ...cfg };
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

  // 3. Save Menu
  const handleSaveMenu = async () => {
    if (!title.trim()) {
      alert('Nama judul menu wajib diisi.');
      return;
    }
    if (!categoryId) {
      alert('Silakan pilih kategori menu.');
      return;
    }
    if (menuItems.length === 0) {
      alert('Pilih minimal 1 item penyusun menu.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: title.trim(),
        category_id: categoryId,
        is_active: isActive ? 1 : 0,
        pricing_type: pricingType,
        price: pricingType === 'FIXED' ? Number(priceFixed) || 0 : undefined,
        price_min: pricingType === 'RANGE' ? Number(priceMin) || 0 : undefined,
        price_max: pricingType === 'RANGE' ? Number(priceMax) || 0 : undefined,
        items: menuItems.map((it) => ({
          product_id: it.product_id,
          name: it.name,
          quantity: it.quantity || 1,
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
        throw new Error(data.message || data.error || 'Gagal menyimpan menu');
      }

      const savedMenuId = data.menu_id || data.id || menuId;

      // Handle Image Upload / Removal if modified
      if (imageFile && savedMenuId) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await fetch(`${apiBase}/admin/media/entity/menus/${encodeURIComponent(savedMenuId)}/image`, {
          method: 'POST',
          headers: {
            Authorization: authToken ? `Bearer ${authToken}` : '',
          },
          body: formData,
        });
      } else if (imageRemoved && savedMenuId) {
        await authFetch(`${apiBase}/admin/media/entity/menus/${encodeURIComponent(savedMenuId)}/image`, {
          method: 'DELETE',
        });
      }

      if (typeof onSaveSuccess === 'function') {
        onSaveSuccess(data);
      } else {
        alert('Menu berhasil disimpan!');
        window.location.hash = '#catalog/master-menus';
      }
    } catch (err) {
      console.error('Save error:', err);
      alert(err.message || 'Terjadi kesalahan saat menyimpan menu.');
    } finally {
      setIsSaving(false);
    }
  };

  const formattedPrice = useMemo(() => {
    const val = pricingType === 'FIXED' ? priceFixed : priceMin;
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(val || 0);
  }, [pricingType, priceFixed, priceMin]);

  return (
    <div id="modern-menu-editor-root" className="w-full max-w-[540px] mx-auto pb-12 font-sans">
      {/* CARD 1: FOTO */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-3.5 shadow-xs">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h4 className="text-sm font-bold text-slate-900 m-0 mb-1">Foto</h4>
            <p className="text-xs text-slate-500 m-0 leading-relaxed">
              Upload foto yang menarik dan menggugah selera, supaya pelangganmu tertarik.
            </p>
            <div className="text-[11px] text-slate-400 mt-1">
              JPG, PNG, atau WebP · Maks. 20 MB · Rasio 1:1
            </div>
          </div>

          <div className="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0 text-center">
            {imagePreview ? (
              <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[11px] text-slate-400 leading-tight px-1 font-medium">
                Belum ada foto
              </span>
            )}
          </div>
        </div>

        <label className="mt-4 w-full h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-2xs">
          <Camera size={16} className="text-slate-600" />
          <span>Pilih foto</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handlePhotoSelect}
          />
        </label>
      </div>

      {/* CARD 2: KATEGORI */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-3.5 shadow-xs">
        <h4 className="text-sm font-bold text-slate-900 m-0 mb-1">Kategori</h4>
        <p className="text-xs text-slate-500 m-0 mb-3 leading-relaxed">
          Pilih, atau tambahkan kategori sesuai dengan menu yang ingin kamu buat.
        </p>

        <div className="flex gap-2">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="flex-1 h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-green-600 transition-colors"
          >
            <option value="">Pilih Kategori</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const name = prompt('Masukkan nama kategori baru:');
              if (name && name.trim()) {
                authFetch(`${apiBase}/admin/categories`, {
                  method: 'POST',
                  body: JSON.stringify({ name: name.trim() }),
                })
                  .then((r) => r.json())
                  .then((res) => {
                    if (res.success && res.category) {
                      setCategories((prev) => [...prev, res.category]);
                      setCategoryId(res.category.id);
                    }
                  });
              }
            }}
            className="w-11 h-11 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 cursor-pointer transition-colors flex-shrink-0"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* CARD 3: JUDUL */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-3.5 shadow-xs">
        <h4 className="text-sm font-bold text-slate-900 m-0 mb-1">Judul</h4>
        <p className="text-xs text-slate-500 m-0 mb-3 leading-relaxed">
          Nama yang jelas, singkat dan menarik akan sangat membantu pelanggan kamu untuk memilih menu.
        </p>

        <input
          type="text"
          maxLength={150}
          value={title}
          placeholder="Ayam Tulang Lunak Geprek + Nasi + Es Teh"
          onChange={(e) => setTitle(e.target.value)}
          className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-green-600 transition-colors"
        />
        <div className="text-right text-[11px] text-slate-400 mt-1.5 font-medium">
          {title.length}/150
        </div>
      </div>

      {/* CARD 4: MENU ITEMS (THE CORE PRISTINE 2-COLUMN SECTION) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-3.5 shadow-xs">
        <h4 className="text-sm font-bold text-slate-900 m-0 mb-1">Menu items</h4>
        <p className="text-xs text-slate-500 m-0 mb-3.5 leading-relaxed">
          Masukkan item yang akan dijual, sesuaikan dengan judul menu yang sedang kamu buat.
        </p>

        {/* List of Item Cards */}
        <div className="flex flex-col gap-3 mb-3">
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

        {/* + Tambah item Button */}
        <button
          type="button"
          onClick={() => handleOpenPickSheet(null)}
          className="w-full h-11 rounded-xl border-none bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
        >
          <Plus size={16} className="stroke-[2.5]" />
          <span>Tambah item</span>
        </button>
      </div>

      {/* CARD 5: HPP (MODAL MENU) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-3.5 shadow-xs">
        <h4 className="text-sm font-bold text-slate-900 m-0 mb-1">HPP (modal menu)</h4>
        <p className="text-xs text-slate-500 m-0 mb-3.5 leading-relaxed">
          Jumlah total modal yang digunakan untuk menu ini.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="flex flex-col gap-2 mb-3">
            {hppBreakdown.items.length === 0 ? (
              <div className="text-xs text-slate-400 italic">Belum ada item dipilih</div>
            ) : (
              hppBreakdown.items.map((it, i) => (
                <div key={i} className="flex justify-between text-xs text-slate-600 font-medium">
                  <span>{it.name}</span>
                  <span>
                    {new Intl.NumberFormat('id-ID', {
                      style: 'currency',
                      currency: 'IDR',
                      minimumFractionDigits: 0,
                    }).format(it.subtotal)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-slate-200 pt-3 flex justify-between items-center text-sm font-bold text-slate-900">
            <span>Total HPP</span>
            <span>
              {new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0,
              }).format(hppBreakdown.total)}
            </span>
          </div>
        </div>
      </div>

      {/* CARD 6: HARGA JUAL */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-3.5 shadow-xs">
        <h4 className="text-sm font-bold text-slate-900 m-0 mb-1">
          Harga jual (Rp) <span className="font-normal text-slate-500 text-xs">termasuk pajak</span>
        </h4>
        <p className="text-xs text-slate-500 m-0 mb-3.5 leading-relaxed">
          Tentukan harga jual menu ini, kamu bisa pilih harga tetap (Fixed) atau rentang harga (Range) sesuai kebutuhanmu.
        </p>

        {/* Tabs: Fixed vs Range */}
        <div className="flex border-b border-slate-200 mb-3">
          <button
            type="button"
            onClick={() => setPricingType('FIXED')}
            className={`flex-1 py-2 text-xs font-bold transition-colors border-none bg-transparent cursor-pointer ${
              pricingType === 'FIXED'
                ? 'text-slate-900 border-b-2 border-slate-900 font-extrabold'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Fixed
          </button>
          <button
            type="button"
            onClick={() => setPricingType('RANGE')}
            className={`flex-1 py-2 text-xs font-bold transition-colors border-none bg-transparent cursor-pointer ${
              pricingType === 'RANGE'
                ? 'text-slate-900 border-b-2 border-slate-900 font-extrabold'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Range
          </button>
        </div>

        {pricingType === 'FIXED' ? (
          <input
            type="number"
            min={0}
            value={priceFixed}
            onChange={(e) => setPriceFixed(Number(e.target.value) || 0)}
            className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-green-600 transition-colors"
          />
        ) : (
          <div className="flex items-center gap-3">
            <input
              type="number"
              placeholder="Min"
              min={0}
              value={priceMin}
              onChange={(e) => setPriceMin(Number(e.target.value) || 0)}
              className="flex-1 h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-green-600"
            />
            <span className="text-slate-400 font-bold">-</span>
            <input
              type="number"
              placeholder="Max"
              min={0}
              value={priceMax}
              onChange={(e) => setPriceMax(Number(e.target.value) || 0)}
              className="flex-1 h-11 px-3.5 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-green-600"
            />
          </div>
        )}
      </div>

      {/* CARD 7: PREVIEW */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-3.5 shadow-xs">
        <h4 className="text-sm font-bold text-slate-900 m-0 mb-1">Preview</h4>
        <p className="text-xs text-slate-500 m-0 mb-3.5 leading-relaxed">
          Seperti inilah yang akan pelanggan kamu lihat, cek kembali apakah sudah sesuai dengan menu yang ingin kamu jual.
        </p>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">
              {title || 'Judul Menu'}
            </div>
            <div className="text-xs text-slate-500 truncate mt-0.5">
              {menuItems.map((m) => m.name).join(' + ') || 'list item dalam menu'}
            </div>
            <div className="text-sm font-bold text-slate-900 mt-2">{formattedPrice}</div>
          </div>

          <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
            {imagePreview ? (
              <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <Camera size={20} className="text-slate-300" />
            )}
          </div>
        </div>
      </div>

      {/* CARD 8: AKTIFKAN MENU TOGGLE */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-5 shadow-xs flex items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-bold text-slate-900 m-0 mb-0.5">Aktifkan menu</h4>
          <p className="text-xs text-slate-500 m-0 leading-relaxed">
            Menu aktif akan muncul di aplikasi customer kamu dan bisa langsung dipesan oleh pelanggan.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsActive(!isActive)}
          className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors border-none flex-shrink-0 ${
            isActive ? 'bg-green-600' : 'bg-slate-300'
          }`}
        >
          <div
            className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
              isActive ? 'translate-x-6' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* BOTTOM ACTIONS */}
      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onCancel || (() => (window.location.hash = '#catalog/master-menus'))}
          className="w-full h-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm cursor-pointer transition-colors"
        >
          Batal
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={handleSaveMenu}
          className={`w-full h-11 rounded-xl border-none text-white font-bold text-sm cursor-pointer transition-colors shadow-sm ${
            isSaving
              ? 'bg-slate-400 cursor-not-allowed'
              : 'bg-[#00A637] hover:bg-[#009230] active:scale-[0.99]'
          }`}
        >
          {isSaving ? 'Menyimpan...' : 'Simpan'}
        </button>
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
