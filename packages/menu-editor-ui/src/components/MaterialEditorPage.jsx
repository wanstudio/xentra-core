import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import DeleteConfirmationModal from './DeleteConfirmationModal';
import { generateMaterialCode } from '../utils/materialCode';

const FONT = "'Plus Jakarta Sans', sans-serif";

function formatMoney(amount) {
  const num = Number(amount) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (_) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function MaterialEditorPage({ materialId = null, onBack, onSaved }) {
  const isEdit = !!materialId;

  const [name, setName] = useState('');
  const [priceRaw, setPriceRaw] = useState('');
  const [priceDisplay, setPriceDisplay] = useState('');
  const [selectedUomId, setSelectedUomId] = useState(isEdit ? '' : 'uom_kg');
  const [selectedUom, setSelectedUom] = useState(
    isEdit ? null : { id: 'uom_kg', name: 'Kilogram', code: 'kg' }
  );
  const [isActive, setIsActive] = useState(true);

  const handlePriceChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    setPriceRaw(raw);
    setPriceDisplay(raw ? Number(raw).toLocaleString('id-ID') : '');
  };

  const [uoms, setUoms] = useState([
    { id: 'uom_pcs', name: 'Pieces', code: 'pcs' },
    { id: 'uom_kg', name: 'Kilogram', code: 'kg' },
    { id: 'uom_g', name: 'Gram', code: 'g' },
    { id: 'uom_l', name: 'Liter', code: 'L' },
    { id: 'uom_ml', name: 'Milliliter', code: 'ml' },
    { id: 'uom_mg', name: 'Milligram', code: 'mg' },
    { id: 'uom_dozen', name: 'Dozen', code: 'dozen' },
    { id: 'uom_galon', name: 'Galon', code: 'galon' }
  ]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [usageCount, setUsageCount] = useState(0);

  // Inline Dropdown Popover state (1:1 Figma Spec)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // 1. Fetch active UOMs from backend
  useEffect(() => {
    let isMounted = true;
    async function fetchUoms() {
      try {
        const token = getAuthToken();
        const headers = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/admin/uoms', { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.uoms) && data.uoms.length > 0 && isMounted) {
            setUoms(data.uoms);
            if (!isEdit && !selectedUomId) {
              const defaultUom = data.uoms.find((u) => u.id === 'uom_kg') || data.uoms[0];
              if (defaultUom) {
                setSelectedUomId(defaultUom.id);
                setSelectedUom(defaultUom);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[MaterialEditorPage] Failed to fetch /admin/uoms, using default fallback list', err);
      }
    }
    fetchUoms();
    return () => {
      isMounted = false;
    };
  }, []);

  const isLoadedRef = useRef(false);

  // 2. If editing, load existing material data
  useEffect(() => {
    if (!isEdit) {
      setName('');
      setSelectedUomId('uom_kg');
      setSelectedUom({ id: 'uom_kg', name: 'Kilogram', code: 'kg' });
      setPriceRaw('');
      setPriceDisplay('');
      setIsActive(true);
      setErrorMessage('');
      isLoadedRef.current = true;
      return;
    }

    let isMounted = true;
    isLoadedRef.current = false;

    async function loadMaterial() {
      try {
        if (typeof window !== 'undefined' && Array.isArray(window._ownerMaterials)) {
          const cached = window._ownerMaterials.find((m) => String(m.id) === String(materialId));
          if (cached && isMounted && !isLoadedRef.current) {
            setName(cached.name || '');
            setSelectedUomId(cached.base_uom_id || '');
            const cost = Number(cached.unit_cost || cached.moving_average_unit_cost) || 0;
            setPriceRaw(cost > 0 ? String(cost) : '');
            setPriceDisplay(cost > 0 ? Number(cost).toLocaleString('id-ID') : '');
            setIsActive(cached.status !== 'ARCHIVED' && cached.status !== 'archived');
            setUsageCount(Number(cached.menu_count) || 0);
            isLoadedRef.current = true;
          }
        }

        const token = getAuthToken();
        const headers = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let found = null;
        // Dedicated endpoint fetch
        try {
          const singleRes = await fetch(`/admin/materials/${encodeURIComponent(materialId)}`, { headers });
          if (singleRes.ok) {
            const singleData = await singleRes.json();
            if (singleData.success && singleData.material) {
              found = singleData.material;
            }
          }
        } catch (_) {}

        // Fallback list fetch if dedicated endpoint didn't return
        if (!found) {
          const res = await fetch('/admin/materials?include_archived=true', { headers });
          if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.materials)) {
              found = data.materials.find((m) => String(m.id) === String(materialId));
            }
          }
        }

        if (found && isMounted) {
          setName(found.name || '');
          setSelectedUomId(found.base_uom_id || '');
          const cost = Number(found.unit_cost || found.moving_average_unit_cost || found.estimated_unit_cost) || 0;
          setPriceRaw(cost > 0 ? String(cost) : '');
          setPriceDisplay(cost > 0 ? Number(cost).toLocaleString('id-ID') : '');
          setIsActive(found.status !== 'ARCHIVED' && found.status !== 'archived');
          setUsageCount(Number(found.menu_count) || 0);
          isLoadedRef.current = true;
        }
      } catch (err) {
        console.error('[MaterialEditorPage] Load error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadMaterial();
    return () => {
      isMounted = false;
    };
  }, [isEdit, materialId]);

  // Sync selectedUom object when uoms or selectedUomId changes
  useEffect(() => {
    if (selectedUomId && uoms.length > 0) {
      const match = uoms.find((u) => String(u.id) === String(selectedUomId));
      if (match) setSelectedUom(match);
    }
  }, [selectedUomId, uoms]);

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof window.goBackFromChildPage === 'function') {
      window.goBackFromChildPage();
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('business/materials');
      return;
    }
    if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
      window.history.back();
    }
  };

  const isValid =
    name.trim().length > 0 &&
    !!selectedUomId &&
    priceRaw.trim().length > 0 &&
    !isNaN(Number(priceRaw));

  const handleSave = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (saving) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      const msg = '⚠️ Nama bahan wajib diisi.';
      setErrorMessage(msg);
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(msg, 'error');
      }
      return;
    }

    if (priceRaw.trim() === '' || isNaN(Number(priceRaw))) {
      const msg = '⚠️ Harga wajib diisi.';
      setErrorMessage(msg);
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(msg, 'error');
      }
      return;
    }

    if (!selectedUomId) {
      const msg = '⚠️ Satuan wajib dipilih.';
      setErrorMessage(msg);
      setIsDropdownOpen(true);
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(msg, 'error');
      }
      return;
    }

    setSaving(true);
    setErrorMessage('');

    try {
      const token = getAuthToken();
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const targetStatus = isActive ? 'ACTIVE' : 'ARCHIVED';
      const unitCost = Math.max(0, Number(priceRaw) || 0);
      let savedResult = null;

      if (isEdit) {
        const res = await fetch(`/admin/materials/${encodeURIComponent(materialId)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            name: trimmedName,
            base_uom_id: selectedUomId,
            unit_cost: unitCost,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || errData.message || 'Gagal memperbarui bahan baku');
        }

        const editData = await res.json().catch(() => ({}));
        savedResult = editData.material || {
          id: materialId,
          name: trimmedName,
          base_uom_id: selectedUomId,
          unit_cost: unitCost,
          status: targetStatus,
        };

        await fetch(`/admin/materials/${encodeURIComponent(materialId)}/status`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status: targetStatus }),
        }).catch(() => {});
      } else {
        const currentList = Array.isArray(window._ownerMaterials) ? window._ownerMaterials : [];
        const autoCode = generateMaterialCode(trimmedName, currentList);

        const res = await fetch('/admin/materials', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            material_code: autoCode,
            name: trimmedName,
            base_uom_id: selectedUomId,
            unit_cost: unitCost,
            status: targetStatus,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || errData.message || 'Gagal menyimpan bahan baku baru');
        }

        const createData = await res.json().catch(() => ({}));
        savedResult = createData.material || {
          id: 'mat_' + Date.now(),
          material_code: autoCode,
          name: trimmedName,
          base_uom_id: selectedUomId,
          unit_cost: unitCost,
          status: targetStatus,
        };
      }

      if (savedResult) {
        const uomName = selectedUom ? selectedUom.name : (savedResult.base_uom_name || savedResult.uom_name || '');
        const uomCode = selectedUom ? selectedUom.code : (savedResult.base_uom_code || savedResult.uom_code || '');
        savedResult.name = trimmedName;
        savedResult.base_uom_id = selectedUomId;
        savedResult.base_uom_name = uomName;
        savedResult.base_uom_code = uomCode;
        savedResult.uom_name = uomName;
        savedResult.uom_code = uomCode;
        savedResult.unit_cost = unitCost;
        savedResult.moving_average_unit_cost = unitCost;
        savedResult.estimated_unit_cost = unitCost;
        savedResult.cost_display = `${formatMoney(unitCost)}/${uomCode || uomName || 'Kg'}`;
        savedResult.status = targetStatus;
        savedResult.created_at = savedResult.created_at || new Date().toISOString();
        savedResult.updated_at = new Date().toISOString();
      }

      if (typeof window !== 'undefined') {
        const currentList = Array.isArray(window._ownerMaterials) ? window._ownerMaterials : [];
        if (savedResult) {
          if (isEdit) {
            const idx = currentList.findIndex((m) => String(m.id) === String(materialId));
            if (idx >= 0) {
              currentList[idx] = { ...currentList[idx], ...savedResult };
              window._ownerMaterials = [...currentList];
            } else {
              window._ownerMaterials = [savedResult, ...currentList];
            }
          } else {
            window._ownerMaterials = [
              savedResult,
              ...currentList.filter((m) => String(m.id) !== String(savedResult.id))
            ];
          }
        }

        window.dispatchEvent(new CustomEvent('materials-updated', { detail: savedResult }));
        if (typeof window.loadOwnerMaterials === 'function') {
          try { window.loadOwnerMaterials(); } catch (_) {}
        }
        if (typeof window.showToast === 'function') {
          const toastName = savedResult.name || trimmedName;
          window.showToast(isEdit ? `Bahan baku "${toastName}" berhasil diperbarui` : `Bahan baku "${toastName}" berhasil ditambahkan`, 'success');
        }
      }

      if (typeof onSaved === 'function') {
        onSaved(savedResult);
      } else {
        handleBack();
      }
    } catch (err) {
      console.error('[MaterialEditorPage] Save error:', err);
      const msg = err.message || 'Terjadi kesalahan saat menyimpan';
      setErrorMessage(msg);
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('❌ ' + msg, 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting || !materialId) return;
    setDeleting(true);
    try {
      const token = getAuthToken();
      const headers = { Accept: 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/admin/materials/${encodeURIComponent(materialId)}`, {
        method: 'DELETE',
        headers,
      });

      if (!res.ok) {
        await fetch(`/admin/materials/${encodeURIComponent(materialId)}/archive`, {
          method: 'PUT',
          headers,
        });
      }

      if (typeof window !== 'undefined') {
        const currentList = Array.isArray(window._ownerMaterials) ? window._ownerMaterials : [];
        window._ownerMaterials = currentList.filter((m) => String(m.id) !== String(materialId));
        window.dispatchEvent(
          new CustomEvent('materials-updated', { detail: { id: materialId, deleted: true } })
        );
        if (typeof window.loadOwnerMaterials === 'function') {
          try {
            window.loadOwnerMaterials();
          } catch (_) {}
        }
        if (typeof window.showToast === 'function') {
          window.showToast(`Bahan baku "${name}" berhasil dihapus`, 'success');
        }
      }

      setShowDeleteModal(false);
      handleBack();
    } catch (err) {
      console.error('[MaterialEditorPage] Delete error:', err);
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Gagal menghapus bahan: ' + (err.message || 'Kesalahan sistem'), 'error');
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      id="modern-material-editor-page-root"
      style={{ boxSizing: 'border-box', fontFamily: FONT, paddingBottom: '96px' }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto select-none font-sans"
    >
      {/* 1. Header with Back Arrow and Title (EXACT Template from ItemMasterPage) */}
      <div className="flex items-center gap-3 mb-6" style={{ marginBottom: '24px' }}>
        <button
          type="button"
          onClick={handleBack}
          aria-label="Kembali"
          className="w-9 h-9 flex items-center justify-center -ml-2 rounded-full text-slate-900 hover:bg-slate-100 active:scale-95 transition-all border-none bg-transparent cursor-pointer shrink-0"
        >
          <img
            src="/owner/assets/icons/ci_arrow-left-sm.svg"
            alt="Kembali"
            className="w-[22px] h-[19px] object-contain block"
          />
        </button>
        <h1
          style={{ color: '#0F172A', fontSize: '18px', fontFamily: FONT, fontWeight: 700, lineHeight: '18px' }}
          className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0 text-left truncate flex-1"
        >
          {isEdit ? `Bahan:${name ? name : 'Nama bahan yang di edit'}` : 'Tambah bahan'}
        </h1>
      </div>

      {/* Error alert if any */}
      {errorMessage && (
        <div
          style={{
            backgroundColor: '#FEF2F2',
            borderColor: '#F87171',
            borderRadius: '12px',
            padding: '12px 16px',
            color: '#991B1B',
            fontSize: '13px',
            fontWeight: 500,
          }}
          className="w-full flex items-center gap-2 border"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="flex-1">{errorMessage}</span>
        </div>
      )}

      {/* Form container for Enter key support and semantic form handling */}
      <form onSubmit={handleSave} className="w-full flex flex-col gap-4">
        {/* Card 1: Nama bahan * (1:1 Figma Spec) */}
        <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          outline: '0.50px #D9D9D9 solid',
          outlineOffset: '-0.50px',
          boxShadow: '0px 2px 5px 0px rgba(0, 0, 0, 0.20)',
          padding: '16px',
        }}
        className="h-36 p-4 bg-white rounded-2xl shadow-[0px_2px_5px_0px_rgba(0,0,0,0.20)] outline outline-[0.50px] outline-offset-[-0.50px] outline-zinc-300 flex flex-col justify-between items-end"
      >
        <div className="w-full flex flex-col justify-start items-start gap-4">
          <div className="self-stretch justify-start">
            <span className="text-slate-900 text-base font-bold font-['Plus_Jakarta_Sans']">
              Nama bahan{' '}
            </span>
            <span className="text-red-500 text-base font-bold font-['Plus_Jakarta_Sans']">
              *
            </span>
          </div>
          <div
            style={{
              height: '48px',
              borderRadius: '16px',
              outline: '1px #CBD5E1 solid',
              outlineOffset: '-1px',
            }}
            className="w-full relative rounded-2xl outline outline-1 outline-offset-[-1px] outline-slate-300 overflow-hidden flex items-center px-4 bg-white focus-within:outline-[#0F172A] focus-within:outline-2 transition-all"
          >
            <input
              type="text"
              value={name}
              maxLength={150}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cth. bawang merah"
              style={{
                fontFamily: FONT,
                fontSize: '12px',
                color: '#0F172A',
                fontWeight: 500,
              }}
              className="w-full h-full bg-transparent border-none outline-none text-slate-900 placeholder:text-slate-400 font-medium text-xs font-['Plus_Jakarta_Sans']"
            />
          </div>
        </div>
        <div className="justify-start text-slate-400 text-[10px] font-normal font-['Plus_Jakarta_Sans']">
          {name.length}/150
        </div>
      </div>

      {/* Card 2: Harga & satuan * (1:1 Figma Spec with Price Input & Inline Dropdown Popover) */}
      <div
        ref={dropdownRef}
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          outline: '0.50px #D9D9D9 solid',
          outlineOffset: '-0.50px',
          boxShadow: '0px 2px 5px 0px rgba(0, 0, 0, 0.20)',
          padding: '16px',
        }}
        className="p-4 bg-white rounded-2xl shadow-[0px_2px_5px_0px_rgba(0,0,0,0.20)] outline outline-[0.50px] outline-offset-[-0.50px] outline-zinc-300 flex flex-col justify-start items-start gap-4"
      >
        <div className="self-stretch justify-start">
          <span className="text-slate-900 text-base font-bold font-['Plus_Jakarta_Sans']">
            Harga &amp; satuan{' '}
          </span>
          <span className="text-red-500 text-base font-bold font-['Plus_Jakarta_Sans']">
            *
          </span>
        </div>

        {/* Input 1: Harga (Rp) */}
        <div
          style={{
            height: '48px',
            borderRadius: '16px',
            outline: '1px #CBD5E1 solid',
            outlineOffset: '-1px',
          }}
          className="w-full relative rounded-2xl outline outline-1 outline-offset-[-1px] outline-slate-300 overflow-hidden flex items-center px-4 bg-white focus-within:outline-[#0F172A] focus-within:outline-2 transition-all"
        >
          <div className="w-full flex items-center gap-1.5 h-full">
            {priceDisplay && (
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: '12px',
                  color: '#0F172A',
                  fontWeight: 600,
                }}
                className="text-slate-900 font-semibold text-xs select-none"
              >
                Rp
              </span>
            )}
            <input
              type="text"
              inputMode="numeric"
              value={priceDisplay}
              onChange={handlePriceChange}
              placeholder="Harga (Rp)"
              style={{
                fontFamily: FONT,
                fontSize: '12px',
                color: '#0F172A',
                fontWeight: 500,
              }}
              className="w-full h-full bg-transparent border-none outline-none text-slate-900 placeholder:text-slate-400 font-medium text-xs font-['Plus_Jakarta_Sans']"
            />
          </div>
        </div>

        {/* Dropdown Trigger Box (Figma Spec) */}
        <div
          id="trigger-uom-picker"
          data-testid="uom-picker-trigger"
          onClick={() => setIsDropdownOpen((prev) => !prev)}
          style={{
            height: '48px',
            borderRadius: '16px',
            outline: '1px #CBD5E1 solid',
            outlineOffset: '-1px',
            cursor: 'pointer',
          }}
          className="self-stretch h-12 relative bg-white rounded-2xl outline outline-1 outline-offset-[-1px] outline-slate-300 overflow-hidden flex items-center justify-between px-4 hover:bg-slate-50 transition-colors active:scale-[0.99]"
        >
          <div
            className={`justify-start text-xs font-medium font-['Plus_Jakarta_Sans'] truncate ${
              selectedUom ? 'text-slate-900 font-bold' : 'text-slate-400'
            }`}
          >
            {selectedUom ? `${selectedUom.name} (${selectedUom.code})` : 'Pilih satuan dasar'}
          </div>
          {/* Chevron Arrow Icon */}
          <div
            className={`w-3 h-3 flex items-center justify-center shrink-0 transition-transform duration-200 ${
              isDropdownOpen ? 'rotate-180' : ''
            }`}
            style={{ width: '12px', height: '12px' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 4.5L6 8L9.5 4.5"
                stroke="#27272A"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Dropdown Menu Popover Box (1:1 Figma Spec) */}
        {isDropdownOpen && (
          <div
            id="uom-dropdown-menu"
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '10px',
              boxShadow: '0px 4px 4px 1px rgba(0, 0, 0, 0.15)',
              outline: '0.50px #F5F3FF solid',
              outlineOffset: '-0.50px',
              padding: '10px',
              maxHeight: '256px',
              overflowY: 'auto',
            }}
            className="w-full h-64 p-2.5 bg-white rounded-[10px] shadow-[0px_4px_4px_1px_rgba(0,0,0,0.15)] outline outline-[0.50px] outline-offset-[-0.50px] outline-violet-50 flex flex-col justify-start items-start gap-2.5 overflow-y-auto"
          >
            {uoms.map((uom) => {
              const isSelected = String(selectedUomId) === String(uom.id);
              return (
                <div
                  key={uom.id}
                  data-uom-id={uom.id}
                  onClick={() => {
                    setSelectedUomId(uom.id);
                    setSelectedUom(uom);
                    setIsDropdownOpen(false);
                  }}
                  style={{
                    borderRadius: '8px',
                    backgroundColor: isSelected ? '#F5F3FF' : 'transparent',
                    padding: isSelected ? '10px' : '6px 12px',
                  }}
                  className={`self-stretch inline-flex justify-between items-center cursor-pointer transition-colors ${
                    isSelected
                      ? 'p-2.5 bg-violet-50 rounded-lg'
                      : 'px-3 py-1.5 rounded-lg hover:bg-slate-50'
                  }`}
                >
                  <div className="flex justify-start items-center gap-3.5">
                    <div className="justify-start text-slate-900 text-xs font-bold font-['Plus_Jakarta_Sans']">
                      {uom.name} ({uom.code})
                    </div>
                  </div>
                  {isSelected && (
                    <div
                      className="size-3 relative overflow-hidden flex items-center justify-center shrink-0"
                      style={{ width: '12px', height: '12px' }}
                    >
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path
                          d="M1 4L3.5 6.5L9 1"
                          stroke="#27272A"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Card 3: Switch "Aktifkan bahan" (1:1 Figma Spec: HIJAU saat aktif, MERAH saat nonaktif) */}
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          outline: '0.50px #D9D9D9 solid',
          outlineOffset: '-0.50px',
          boxShadow: '0px 2px 5px 0px rgba(0, 0, 0, 0.20)',
          padding: '16px',
        }}
        className="self-stretch p-4 bg-white rounded-2xl shadow-[0px_2px_5px_0px_rgba(0,0,0,0.20)] outline outline-[0.50px] outline-offset-[-0.50px] outline-zinc-300 inline-flex justify-between items-center overflow-hidden"
      >
        <div className="w-60 inline-flex flex-col justify-start items-start gap-1">
          <div className="self-stretch justify-start text-black text-base font-bold font-['Plus_Jakarta_Sans']">
            Aktifkan bahan
          </div>
          <div className="self-stretch justify-start text-slate-400 text-xs font-medium font-['Plus_Jakarta_Sans']">
            Status bahan baku aktif akan terlihat dan siap digunakan dalam resep
          </div>
        </div>

        {/* Toggle Switch: HIJAU saat ON, MERAH saat OFF (bukan abu-abu!) */}
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          aria-label="Aktifkan bahan"
          onClick={() => setIsActive((prev) => !prev)}
          style={{
            width: '36px',
            height: '20px',
            backgroundColor: isActive ? '#16A34A' : '#EF4444',
            outline: isActive ? '0.50px #16A34A solid' : '0.50px #EF4444 solid',
            outlineOffset: '-0.50px',
            borderRadius: '100px',
            boxShadow: '-1px 2px 5px 0px rgba(0, 0, 0, 0.15)',
            position: 'relative',
            cursor: 'pointer',
            border: 'none',
            padding: 0,
            flexShrink: 0,
            overflow: 'hidden',
            transition: 'background-color 0.2s ease, outline 0.2s ease',
          }}
          className={`w-9 h-5 relative rounded-[100px] shadow-[-1px_2px_5px_0px_rgba(0,0,0,0.15)] outline outline-[0.50px] outline-offset-[-0.50px] overflow-hidden ${
            isActive ? 'bg-green-600 outline-green-600' : 'bg-red-500 outline-red-500'
          }`}
        >
          <div
            style={{
              width: '20px',
              height: '20px',
              backgroundColor: '#FFFFFF',
              borderRadius: '9999px',
              boxShadow: '0px 4px 15px 0px rgba(0, 0, 0, 0.15)',
              position: 'absolute',
              top: 0,
              left: isActive ? '16px' : '0px',
              transition: 'left 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            className="size-5 absolute bg-white rounded-full shadow-[0px_4px_15px_0px_rgba(0,0,0,0.15)] top-0"
          />
          {isActive && (
            <div
              style={{
                width: '6px',
                height: '0px',
                position: 'absolute',
                left: '6px',
                top: '7px',
                transform: 'rotate(90deg)',
                transformOrigin: 'top left',
                outline: '1px white solid',
                outlineOffset: '-0.50px',
              }}
              className="w-1.5 h-0 left-[6px] top-[7px] absolute origin-top-left rotate-90 outline outline-1 outline-offset-[-0.50px] outline-white"
            />
          )}
        </button>
      </div>

      {/* Card 4: Hapus bahan baku (1:1 Figma Spec - Only in Edit Mode) */}
      {isEdit && (
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '16px',
            outline: '0.50px #D9D9D9 solid',
            outlineOffset: '-0.50px',
            boxShadow: '0px 2px 5px 0px rgba(0, 0, 0, 0.20)',
            padding: '16px',
          }}
          className="self-stretch p-4 bg-white rounded-2xl shadow-[0px_2px_5px_0px_rgba(0,0,0,0.20)] outline outline-[0.50px] outline-offset-[-0.50px] outline-zinc-300 inline-flex justify-between items-center overflow-hidden"
        >
          <div className="w-60 inline-flex flex-col justify-start items-start gap-1">
            <div className="self-stretch justify-start text-black text-base font-bold font-['Plus_Jakarta_Sans']">
              Hapus bahan baku
            </div>
            <div className="self-stretch justify-start text-slate-400 text-xs font-medium font-['Plus_Jakarta_Sans']">
              Pastikan bahan baku yang ingin di hapus sudah tidak digunakan dalam resep
            </div>
          </div>
          <button
            type="button"
            data-testid="btn-delete-material"
            onClick={() => setShowDeleteModal(true)}
            style={{
              width: '64px',
              height: '28px',
              borderRadius: '20px',
              boxShadow: '0px 3px 10px 0px rgba(0, 0, 0, 0.20)',
              outline: '1px #EF4444 solid',
              outlineOffset: '-1px',
              cursor: 'pointer',
              backgroundColor: '#FFFFFF',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            className="w-16 h-7 relative rounded-[20px] shadow-[0px_3px_10px_0px_rgba(0,0,0,0.20)] outline outline-1 outline-offset-[-1px] outline-red-500 overflow-hidden flex items-center justify-center bg-white hover:bg-red-50 active:scale-95 transition-all"
          >
            <span className="text-center text-red-500 text-xs font-bold font-['Plus_Jakarta_Sans']">
              Hapus
            </span>
          </button>
        </div>
      )}
      </form>

      {/* Delete Confirmation Modal with Usage Guardrails */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        isDeleting={deleting}
        title="Hapus Bahan Baku?"
        description={
          usageCount > 0
            ? `⚠️ Perhatian: Bahan baku "${name}" saat ini digunakan dalam ${usageCount} resep menu aktif. Menghapusnya akan mempengaruhi resep dan kalkulasi HPP menu terkait. Yakin ingin menghapus?`
            : `Bahan baku "${name}" akan dihapus dari daftar bahan. Aksi ini tidak dapat dibatalkan.`
        }
      />

      {/* 4. Bottom Sticky Action Bar (1:1 Figma Spec) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            id="modern-material-editor-bottom-bar"
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              width: '100vw',
              maxWidth: '100vw',
              height: '110px',
              backgroundColor: '#FFFFFF',
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              boxShadow: '0px 0px 15px 0px rgba(0, 0, 0, 0.15)',
              zIndex: 200,
              paddingTop: '24px',
              paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
              paddingLeft: '16px',
              paddingRight: '16px',
              boxSizing: 'border-box',
            }}
            className="w-full bg-white rounded-tl-[20px] rounded-tr-[20px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] z-[200]"
          >
            <div className="w-full max-w-lg mx-auto">
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                style={{
                  width: '100%',
                  height: '48px',
                  borderRadius: '9999px',
                  backgroundColor: isValid ? '#16A34A' : '#F4F4F5',
                  outline: isValid ? '1px #16A34A solid' : '1px #CBD5E1 solid',
                  outlineOffset: '-1px',
                  border: 'none',
                  color: isValid ? '#FFFFFF' : '#A1A1AA',
                  fontSize: '14px',
                  fontFamily: FONT,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                }}
                className={`w-full h-12 rounded-full font-['Plus_Jakarta_Sans'] text-sm font-bold flex items-center justify-center transition-all ${
                  isValid && !saving
                    ? 'bg-green-600 hover:bg-emerald-600 text-white shadow-sm active:scale-[0.98]'
                    : 'bg-zinc-100 text-neutral-400 active:scale-[0.99]'
                }`}
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
