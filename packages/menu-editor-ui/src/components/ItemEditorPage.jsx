import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import DeleteConfirmationModal from './DeleteConfirmationModal';
import { generateMaterialCode } from '../utils/materialCode';

function getAuthToken() {
  try {
    const local = localStorage.getItem('xentra_merchant_token');
    if (local) return local;
  } catch (e) {}

  const match = document.cookie.match(/(?:^|;\s*)xentra_merchant_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function formatMoney(amount) {
  const num = Number(amount) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

function ArrowLeftIcon({ className = 'w-[22px] h-[19px]' }) {
  return (
    <svg
      data-icon="ci_arrow-left-sm.svg"
      width="22"
      height="19"
      viewBox="0 0 22 19"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M20.6244 9.99984H2.29102M9.62435 2.6665L2.29102 9.99984L9.62435 17.3332"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        stroke="#0F172A"
      />
    </svg>
  );
}

function CookingPotIcon({ className = 'w-6 h-6' }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M22 11C22.2652 11 22.5196 11.1054 22.7071 11.2929C22.8946 11.4804 23 11.7348 23 12C23 12.2652 22.8946 12.5196 22.7071 12.7071C22.5196 12.8946 22.2652 13 22 13H21V20C21 20.7956 20.6839 21.5587 20.1213 22.1213C19.5587 22.6839 18.7956 23 18 23H6C5.20435 23 4.44129 22.6839 3.87868 22.1213C3.31607 21.5587 3 20.7956 3 20V13H2C1.73478 13 1.48043 12.8946 1.29289 12.7071C1.10536 12.5196 1 12.2652 1 12C1 11.7348 1.10536 11.4804 1.29289 11.2929C1.48043 11.1054 1.73478 11 2 11H22Z"
        fill="white"
      />
      <path
        d="M12.73 1.032C13.3179 1.11957 13.8665 1.37981 14.3063 1.77968C14.746 2.17956 15.0571 2.70105 15.2 3.278L15.41 4.118L19.758 3.03C19.8865 2.99475 20.0208 2.98556 20.1529 3.00294C20.2851 3.02033 20.4124 3.06395 20.5274 3.13125C20.6425 3.19854 20.7429 3.28815 20.8228 3.39481C20.9027 3.50147 20.9605 3.62302 20.9927 3.75233C21.025 3.88164 21.0311 4.01609 21.0106 4.14778C20.9902 4.27947 20.9436 4.40575 20.8737 4.5192C20.8037 4.63264 20.7118 4.73096 20.6034 4.80837C20.4949 4.88579 20.372 4.94074 20.242 4.97L4.242 8.97C4.11348 9.00525 3.9792 9.01444 3.84707 8.99706C3.71494 8.97967 3.58762 8.93605 3.47259 8.86875C3.35755 8.80146 3.25713 8.71185 3.17723 8.60519C3.09732 8.49853 3.03954 8.37698 3.00728 8.24767C2.97502 8.11836 2.96893 7.98391 2.98937 7.85222C3.00981 7.72052 3.05637 7.59425 3.12631 7.4808C3.19625 7.36736 3.28817 7.26904 3.39664 7.19163C3.50512 7.11421 3.62798 7.05926 3.758 7.03L7.65 6.057L7.44 5.212C7.24555 4.44123 7.36596 3.6248 7.773 2.942C7.97518 2.6038 8.242 2.30874 8.55823 2.07367C8.87445 1.83861 9.23389 1.66814 9.616 1.572L9.62 1.569L11.56 1.091C11.943 0.995 12.34 0.975 12.73 1.032ZM12.435 3.011C12.305 2.99197 12.1724 2.99877 12.045 3.031H12.041L10.101 3.511C9.9102 3.56017 9.73717 3.6646 9.60551 3.8112C9.47386 3.9578 9.38845 4.14003 9.36 4.335C9.34552 4.43246 9.34552 4.53154 9.36 4.629L9.38 4.726V4.73L9.59 5.571L13.47 4.601L13.26 3.763V3.76C13.2125 3.5672 13.1087 3.39292 12.9617 3.25935C12.8148 3.12578 12.6314 3.03998 12.435 3.011Z"
        fillRule="evenodd"
        clipRule="evenodd"
        fill="white"
      />
    </svg>
  );
}

function FoodTrayIcon({ className = 'w-[23px] h-[23px]' }) {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 23 23"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M13.4457 5.24492C13.6033 4.91623 13.6749 4.55296 13.654 4.18907C13.633 3.82518 13.5202 3.47253 13.326 3.16409C13.1317 2.85564 12.8625 2.60146 12.5434 2.4253C12.2243 2.24914 11.8658 2.15674 11.5013 2.15674C11.1368 2.15674 10.7782 2.24914 10.4591 2.4253C10.14 2.60146 9.87082 2.85564 9.67661 3.16409C9.4824 3.47253 9.36954 3.82518 9.3486 4.18907C9.32765 4.55296 9.39929 4.91623 9.55683 5.24492C5.59508 6.13138 2.63574 9.66859 2.63574 13.8958C2.63574 14.2925 2.95774 14.6145 3.35449 14.6145H19.6462C19.8368 14.6145 20.0196 14.5388 20.1544 14.404C20.2892 14.2692 20.3649 14.0864 20.3649 13.8958C20.3649 9.66859 17.4056 6.13138 13.4457 5.24492ZM11.5003 3.59371C11.3097 3.59371 11.1269 3.66944 10.9921 3.80423C10.8573 3.93902 10.7816 4.12184 10.7816 4.31246C10.7816 4.50309 10.8573 4.6859 10.9921 4.82069C11.1269 4.95549 11.3097 5.03121 11.5003 5.03121C11.6909 5.03121 11.8738 4.95549 12.0086 4.82069C12.1433 4.6859 12.2191 4.50309 12.2191 4.31246C12.2191 4.12184 12.1433 3.93902 12.0086 3.80423C11.8738 3.66944 11.6909 3.59371 11.5003 3.59371ZM13.7332 8.27709C13.7867 8.19923 13.8549 8.13266 13.934 8.08118C14.0132 8.0297 14.1017 7.99432 14.1945 7.97705C14.2873 7.95979 14.3826 7.96098 14.475 7.98056C14.5674 8.00014 14.655 8.03773 14.7328 8.09117C15.5058 8.62239 16.1332 9.33906 16.5575 10.1755C16.6382 10.3448 16.6496 10.5389 16.5892 10.7165C16.5288 10.894 16.4014 11.0409 16.2342 11.1258C16.067 11.2107 15.8732 11.2269 15.6942 11.171C15.5152 11.115 15.3652 10.9913 15.2762 10.8263C14.9608 10.2044 14.4946 9.67165 13.9201 9.27663C13.8423 9.22322 13.7757 9.15499 13.7242 9.07585C13.6727 8.99671 13.6373 8.9082 13.6201 8.81537C13.6028 8.72255 13.604 8.62724 13.6236 8.53488C13.6432 8.44252 13.6808 8.35492 13.7342 8.27709"
        fillRule="evenodd"
        clipRule="evenodd"
        fill="white"
      />
      <path
        d="M1.91667 15.8125C1.78958 15.8125 1.66771 15.863 1.57784 15.9528C1.48798 16.0427 1.4375 16.1646 1.4375 16.2917V16.5035C1.4375 16.9558 1.4375 17.3248 1.46242 17.6247C1.48733 17.9333 1.541 18.2102 1.67325 18.468C1.87929 18.8744 2.20992 19.204 2.61529 19.411C2.87308 19.5423 3.15004 19.596 3.45863 19.6219C3.75858 19.6458 4.12754 19.6458 4.57987 19.6458H18.4192C18.8715 19.6458 19.2405 19.6458 19.5404 19.6209C19.849 19.596 20.126 19.5423 20.3838 19.4101C20.7901 19.204 21.1198 18.8734 21.3267 18.468C21.458 18.2102 21.5117 17.9333 21.5376 17.6247C21.5615 17.3248 21.5615 16.9558 21.5615 16.5035V16.2917C21.5615 16.1646 21.5111 16.0427 21.4212 15.9528C21.3313 15.863 21.2095 15.8125 21.0824 15.8125H1.91667Z"
        fill="white"
      />
    </svg>
  );
}

// Chef Cat Vector Mascot (GoBiz style)
function ChefCatIcon({ className = 'w-[84px] h-[84px]' }) {
  return (
    <svg width="84" height="84" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <polygon points="20,40 10,12 38,24" fill="#FBBF24" stroke="#0F172A" strokeWidth="3" strokeLinejoin="round"/>
      <polygon points="18,34 14,18 32,24" fill="#F87171"/>
      <polygon points="80,40 90,12 62,24" fill="#FBBF24" stroke="#0F172A" strokeWidth="3" strokeLinejoin="round"/>
      <polygon points="82,34 86,18 68,24" fill="#F87171"/>
      <circle cx="50" cy="55" r="38" fill="#FBBF24" stroke="#0F172A" strokeWidth="3"/>
      <line x1="12" y1="52" x2="30" y2="54" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="10" y1="60" x2="30" y2="58" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="88" y1="52" x2="70" y2="54" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="90" y1="60" x2="70" y2="58" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M 32 50 Q 40 43 48 50" fill="none" stroke="#0F172A" strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M 52 50 Q 60 43 68 50" fill="none" stroke="#0F172A" strokeWidth="3.5" strokeLinecap="round"/>
      <polygon points="50,56 46,60 54,60" fill="#EF4444"/>
      <path d="M 50 60 Q 45 66 40 63" fill="none" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M 50 60 Q 55 66 60 63" fill="none" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M 30 25 C 20 18, 30 2, 45 6 C 50 -2, 65 -2, 70 8 C 80 4, 86 18, 75 25 Z" fill="#FFFFFF" stroke="#0F172A" strokeWidth="3" strokeLinejoin="round"/>
      <rect x="32" y="22" width="40" height="9" rx="2" fill="#FFFFFF" stroke="#0F172A" strokeWidth="3"/>
      <rect x="34" y="24" width="36" height="4" rx="1" fill="#EF4444"/>
      <circle cx="82" cy="74" r="8" fill="#F59E0B" stroke="#0F172A" strokeWidth="2.5"/>
      <line x1="82" y1="82" x2="86" y2="95" stroke="#92400E" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

function generateSkuFromName(rawName) {
  const words = (rawName || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  let initials = '';
  if (words.length === 1) {
    initials = words[0].slice(0, 3).toUpperCase();
  } else if (words.length === 2) {
    initials = (words[0].slice(0, 2) + words[1].slice(0, 2)).toUpperCase();
  } else {
    initials = words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  }
  return `${initials}-001`;
}

const STANDARD_UOM_LOOKUP = {
  uom_g: { id: 'uom_g', code: 'g', name: 'Gram', category: 'mass', factor: 0.001 },
  uom_kg: { id: 'uom_kg', code: 'kg', name: 'Kg', category: 'mass', factor: 1.0 },
  uom_mg: { id: 'uom_mg', code: 'mg', name: 'mg', category: 'mass', factor: 0.000001 },
  uom_ml: { id: 'uom_ml', code: 'ml', name: 'ml', category: 'volume', factor: 0.001 },
  uom_l: { id: 'uom_l', code: 'L', name: 'Liter', category: 'volume', factor: 1.0 },
  uom_galon: { id: 'uom_galon', code: 'galon', name: 'Galon', category: 'volume', factor: 19.0 },
  uom_pcs: { id: 'uom_pcs', code: 'pcs', name: 'Pcs', category: 'count', factor: 1.0 },
  uom_dozen: { id: 'uom_dozen', code: 'dozen', name: 'Lusin', category: 'count', factor: 12.0 },
};

function getUomCategory(uomId, uomName) {
  const normId = String(uomId || '').toLowerCase();
  const normName = String(uomName || '').toLowerCase();
  if (normId === 'uom_kg' || normId === 'uom_g' || normId === 'uom_mg' || /kilogram|gram|\bkg\b|\bgr\b|\bg\b/i.test(normName)) {
    return 'mass';
  }
  if (normId === 'uom_l' || normId === 'uom_ml' || normId === 'uom_galon' || /liter|milliliter|mililiter|\bl\b|\bml\b|galon/i.test(normName)) {
    return 'volume';
  }
  return 'count';
}

function getUomFactor(uomId, uomName) {
  const normId = String(uomId || '').toLowerCase();
  if (STANDARD_UOM_LOOKUP[normId]) return STANDARD_UOM_LOOKUP[normId].factor;
  const normName = String(uomName || '').toLowerCase();
  if (normName.includes('mili') || normName === 'ml' || normName === 'mg') return 0.001;
  if (normName.includes('gram') || normName === 'gr' || normName === 'g') return 0.001;
  if (normName.includes('galon')) return 19.0;
  if (normName.includes('dozen') || normName.includes('lusin')) return 12.0;
  return 1.0;
}

function getAvailableRecipeUoms(category) {
  if (category === 'mass') {
    return [
      { id: 'uom_g', name: 'Gram', factor: 0.001 },
      { id: 'uom_kg', name: 'Kg', factor: 1.0 },
    ];
  }
  if (category === 'volume') {
    return [
      { id: 'uom_ml', name: 'ml', factor: 0.001 },
      { id: 'uom_l', name: 'Liter', factor: 1.0 },
    ];
  }
  return [
    { id: 'uom_pcs', name: 'Pcs', factor: 1.0 },
  ];
}

function getComponentLineCost(comp) {
  const qty = Number(comp.planned_quantity) || 0;
  if (qty <= 0) return 0;
  const baseCost = Number(comp.unit_cost) || 0;
  if (baseCost <= 0) return 0;

  const plannedFactor = Number(comp.planned_uom_factor) || getUomFactor(comp.planned_uom_id, comp.uom_name);
  const baseFactor = Number(comp.base_uom_factor) || getUomFactor(comp.base_uom_id, comp.base_uom_name);

  const ratio = baseFactor > 0 ? (plannedFactor / baseFactor) : 1;
  return Math.round(qty * ratio * baseCost);
}

function getMaterialVisualBadge(name, category) {
  const n = String(name || '').toLowerCase();
  if (/ayam|bebek|unggas|poultry|chicken|duck/i.test(n)) {
    return { bg: '#FFF7ED', textColor: '#C2410C', icon: '🍗' };
  }
  if (/daging|sapi|kambing|beef|meat|lamb/i.test(n)) {
    return { bg: '#FEF2F2', textColor: '#B91C1C', icon: '🥩' };
  }
  if (/udang|ikan|cumi|teri|seafood|shrimp|fish/i.test(n)) {
    return { bg: '#F0F9FF', textColor: '#0369A1', icon: '🦐' };
  }
  if (/cabai|cabe|rawit|sambal|pedas|chili|pepper/i.test(n)) {
    return { bg: '#FEF2F2', textColor: '#DC2626', icon: '🌶️' };
  }
  if (/bawang merah|merah|shallot/i.test(n)) {
    return { bg: '#FAF5FF', textColor: '#7E22CE', icon: '🧅' };
  }
  if (/bawang putih|garlic|kating/i.test(n)) {
    return { bg: '#F8FAFC', textColor: '#475569', icon: '🧄' };
  }
  if (/jahe|kunyit|lengkuas|kencur|temulawak|ginger|turmeric/i.test(n)) {
    return { bg: '#FEF9C3', textColor: '#A16207', icon: '🫚' };
  }
  if (/telur|telor|egg/i.test(n)) {
    return { bg: '#FEF3C7', textColor: '#D97706', icon: '🥚' };
  }
  if (/beras|nasi|rice/i.test(n)) {
    return { bg: '#F8FAFC', textColor: '#334155', icon: '🍚' };
  }
  if (/mie|bihun|kwetiau|pasta|noodle/i.test(n)) {
    return { bg: '#FEF3C7', textColor: '#B45309', icon: '🍜' };
  }
  if (/kangkung|bayam|sawi|kol|timun|tomat|sayur|vegetable|salad|lalap/i.test(n)) {
    return { bg: '#ECFDF5', textColor: '#047857', icon: '🥬' };
  }
  if (/tahu|tempe|tofu|tempeh/i.test(n)) {
    return { bg: '#FFFBEB', textColor: '#B45309', icon: '🥢' };
  }
  if (/susu|santan|keju|milk|cheese|cream|dairy/i.test(n)) {
    return { bg: '#EFF6FF', textColor: '#1D4ED8', icon: '🥛' };
  }
  if (/minyak|oil|mentega|butter|margarin/i.test(n)) {
    return { bg: '#FEFCE8', textColor: '#CA8A04', icon: '🫗' };
  }
  if (/teh|tea|melati/i.test(n)) {
    return { bg: '#F0FDF4', textColor: '#15803D', icon: '🍵' };
  }
  if (/kopi|coffee|espresso|robusta|arabika/i.test(n)) {
    return { bg: '#FEF3C7', textColor: '#78350F', icon: '☕' };
  }
  if (/es|ice|air|water|soda/i.test(n)) {
    return { bg: '#F0F9FF', textColor: '#0284C7', icon: '🧊' };
  }
  if (/garam|gula|micin|msg|royco|lada|merica|bumbu|seasoning|saus|saos|kecap|salt|sugar/i.test(n)) {
    return { bg: '#F1F5F9', textColor: '#475569', icon: '🧂' };
  }
  if (/tepung|flour|maizena|tapioka/i.test(n)) {
    return { bg: '#FFFBEB', textColor: '#92400E', icon: '🌾' };
  }
  if (category === 'volume') {
    return { bg: '#EFF6FF', textColor: '#2563EB', icon: '💧' };
  }
  if (category === 'count') {
    return { bg: '#F8FAFC', textColor: '#475569', icon: '📦' };
  }
  return { bg: '#F1F5F9', textColor: '#334155', icon: '🍲' };
}

const DEFAULT_RAW_MATERIALS = [];

// 35x21 Switch Toggle component matching Figma spec
function SwitchToggle({ checked, onChange, activeBg = '#00A637', inactiveBg = '#FA3E3E' }) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      style={{
        width: '35px',
        height: '21px',
        borderRadius: '100px',
        backgroundColor: checked ? activeBg : inactiveBg,
        boxShadow: '-1px 2px 5px rgba(0, 0, 0, 0.15)',
        outline: checked ? '0.50px #009A33 solid' : '0.50px #FF0000 solid',
        outlineOffset: '-0.50px',
        position: 'relative',
        cursor: 'pointer',
        overflow: 'hidden',
        flexShrink: 0,
        transition: 'background-color 200ms ease',
      }}
    >
      <div
        style={{
          width: '21px',
          height: '21px',
          borderRadius: '9999px',
          backgroundColor: '#FFFFFF',
          boxShadow: '0px 4px 15px rgba(0, 0, 0, 0.15)',
          position: 'absolute',
          top: 0,
          left: checked ? '14px' : '0px',
          transition: 'left 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </div>
  );
}

export default function ItemEditorPage({ productId, onBack, onSaved }) {
  const isEdit = !!productId;

  // Retrieve cached product if available in memory
  const getCachedProduct = () => {
    if (!isEdit || typeof window === 'undefined') return null;
    const prods = (window.state && window.state.products) ||
      (window._ownerMasterMenuState && window._ownerMasterMenuState.products) ||
      [];
    return prods.find((p) => p && String(p.id) === String(productId)) || null;
  };

  const cached = getCachedProduct();

  // Form states initialized
  const [name, setName] = useState(cached ? cached.name || '' : '');
  const [inventoryType, setInventoryType] = useState(
    cached ? (cached.inventory_type === 'COOKED' ? 'COOKED' : 'DIRECT') : 'DIRECT'
  );
  const [costPrice, setCostPrice] = useState(
    cached && cached.cost_price != null && !isNaN(Number(cached.cost_price)) && Number(cached.cost_price) > 0
      ? Number(cached.cost_price).toLocaleString('id-ID')
      : ''
  );
  const [manageStock, setManageStock] = useState(
    cached ? !!(cached.sku && String(cached.sku).trim() !== '') : false
  );
  const [sku, setSku] = useState(cached ? cached.sku || '' : '');
  const [description, setDescription] = useState(cached ? cached.description || '' : '');
  const [recipe, setRecipe] = useState(cached ? cached.recipe || null : null);
  const [branchPrices, setBranchPrices] = useState([]);
  const [showBranchPricing, setShowBranchPricing] = useState(false);

  // Sub-view: 'item', 'recipe', or 'material-picker'
  const [activeView, setActiveView] = useState('item');

  // Recipe Draft states (when activeView === 'recipe')
  const [recipeDraftYield, setRecipeDraftYield] = useState(1);
  const [recipeDraftComponents, setRecipeDraftComponents] = useState([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState(new Set());
  const [materials, setMaterials] = useState(DEFAULT_RAW_MATERIALS);
  const [materialSearchQuery, setMaterialSearchQuery] = useState('');
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [internalToast, setInternalToast] = useState(null);

  const notify = (msg) => {
    setInternalToast(msg);
    setTimeout(() => setInternalToast(null), 3000);
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      try {
        window.showToast(msg);
      } catch (_) {}
    }
  };

  const [loading, setLoading] = useState(isEdit && !cached);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Close modals on browser back or hash change & clean up portal
  useEffect(() => {
    const handlePop = () => {
      setShowDeleteModal(false);
      setActiveView((curr) => (curr === 'material-picker' ? 'recipe' : curr === 'recipe' ? 'item' : curr));
    };
    window.addEventListener('popstate', handlePop);
    window.addEventListener('hashchange', handlePop);
    return () => {
      window.removeEventListener('popstate', handlePop);
      window.removeEventListener('hashchange', handlePop);
      const bar = document.getElementById('modern-item-editor-bottom-bar');
      if (bar && bar.parentNode) {
        bar.parentNode.removeChild(bar);
      }
    };
  }, []);

  // Lock body scroll and close on Escape key when Delete Modal is active
  useEffect(() => {
    if (!showDeleteModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !deleting) {
        e.preventDefault();
        setShowDeleteModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showDeleteModal, deleting]);

  // Fetch full composed product if in edit mode
  useEffect(() => {
    let isMounted = true;

    async function loadProductDetails() {
      if (!isEdit) {
        setLoading(false);
        return;
      }

      try {
        const token = getAuthToken();
        const headers = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        // Attempt direct product read if editing
        if (isEdit && productId) {
          const directRes = await fetch(`/api/v1/admin/composed/products/${encodeURIComponent(productId)}?_t=${Date.now()}`, {
            headers,
            cache: 'no-store'
          }).catch(() => null);

          if (directRes && directRes.ok) {
            const directData = await directRes.json().catch(() => null);
            if (isMounted && directData && directData.success && directData.product) {
              const p = directData.product;
              setName(p.name || '');
              const inv = p.inventory_type === 'COOKED' ? 'COOKED' : 'DIRECT';
              setInventoryType(inv);
              const formattedCost = p.cost_price != null && !isNaN(Number(p.cost_price)) && Number(p.cost_price) > 0
                ? Number(p.cost_price).toLocaleString('id-ID')
                : '';
              setCostPrice(formattedCost);
              const hasSku = !!(p.sku && String(p.sku).trim() !== '');
              setManageStock(hasSku);
              setSku(p.sku || '');
              setDescription(p.description || '');
              setRecipe(p.recipe || null);
              const branchAdopts = directData.branch_adoptions || p.branch_adoptions || [];
              if (Array.isArray(branchAdopts) && branchAdopts.length > 0) {
                setBranchPrices(branchAdopts.map((b) => ({
                  branch_id: b.branch_id,
                  branch_name: b.branch_name,
                  price: b.branch_price != null ? Number(b.branch_price).toLocaleString('id-ID') : '',
                  is_override: b.branch_price != null && b.branch_price !== ''
                })));
                if (branchAdopts.some(b => b.branch_price != null && b.branch_price !== '')) {
                  setShowBranchPricing(true);
                }
              }
              setLoading(false);
              return;
            }
          }
        }

        const res = await fetch(`/api/v1/admin/composed/products?active_only=0&_t=${Date.now()}`, {
          headers,
          cache: 'no-store'
        });
        const data = await res.json();

        if (isMounted && data && data.success && Array.isArray(data.products)) {
          const found = data.products.find((p) => p && String(p.id) === String(productId));
          if (found) {
            setName(found.name || '');
            const inv = found.inventory_type === 'COOKED' ? 'COOKED' : 'DIRECT';
            setInventoryType(inv);
            const formattedCost = found.cost_price != null && !isNaN(Number(found.cost_price)) && Number(found.cost_price) > 0
              ? Number(found.cost_price).toLocaleString('id-ID')
              : '';
            setCostPrice(formattedCost);
            const hasSku = !!(found.sku && String(found.sku).trim() !== '');
            setManageStock(hasSku);
            setSku(found.sku || '');
            setDescription(found.description || '');
            setRecipe(found.recipe || null);
          }
        }

        // Fetch branch list to populate LSP choices
        const bRes = await fetch(`/api/v1/admin/branches?_t=${Date.now()}`, { headers, cache: 'no-store' }).catch(() => null);
        if (bRes && bRes.ok) {
          const bData = await bRes.json().catch(() => null);
          if (bData && Array.isArray(bData.branches)) {
            setBranchPrices((prev) => {
              if (prev && prev.length > 0) return prev;
              return bData.branches.map((b) => ({
                branch_id: b.id,
                branch_name: b.name,
                price: '',
                is_override: false
              }));
            });
          }
        }
      } catch (err) {
        console.error('[ItemEditorPage] Load error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadProductDetails();
    return () => {
      isMounted = false;
    };
  }, [productId, isEdit]);

  // Load materials from API
  const loadMaterials = async () => {
    try {
      setLoadingMaterials(true);
      const token = getAuthToken();
      const headers = { Accept: 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/v1/admin/materials?_t=${Date.now()}`, { headers, cache: 'no-store' });
      const data = await res.json();
      if (data && data.success && Array.isArray(data.materials) && data.materials.length > 0) {
        setMaterials(
          data.materials.map((m) => {
            const baseUomId = m.base_uom_id || 'uom_kg';
            const baseUomName = m.base_uom_name || m.uom_name || 'Kg';
            const cat = m.base_uom_category_id
              ? (m.base_uom_category_id.includes('volume') ? 'volume' : m.base_uom_category_id.includes('count') ? 'count' : 'mass')
              : getUomCategory(baseUomId, baseUomName);
            const baseFactor = Number(m.base_uom_factor) || getUomFactor(baseUomId, baseUomName);
            const unitCost = Number(m.moving_average_unit_cost || m.unit_cost) || 0;
            return {
              id: m.id,
              material_code: m.material_code || m.code || `MAT-${String(m.id).slice(-4).toUpperCase()}`,
              name: m.name,
              category: cat,
              base_uom_id: baseUomId,
              base_uom_name: baseUomName,
              base_uom_factor: baseFactor,
              unit_cost: unitCost,
              cost_display: unitCost > 0
                ? formatMoney(unitCost) + '/' + baseUomName
                : 'Rp0/' + baseUomName,
            };
          })
        );
      }
    } catch (e) {
      console.warn('[ItemEditorPage] Materials fetch fallback to defaults:', e);
    } finally {
      setLoadingMaterials(false);
    }
  };

  // Open Recipe Builder Sub-view
  const openRecipeView = () => {
    if (!name.trim()) return;
    setRecipeDraftYield(recipe && recipe.yield_quantity ? recipe.yield_quantity : 1);
    setRecipeDraftComponents(
      recipe && Array.isArray(recipe.components) && recipe.components.length > 0
        ? recipe.components.map((c) => {
            const cat = c.category || getUomCategory(c.planned_uom_id || c.base_uom_id, c.uom_name || c.base_uom_name);
            const baseFactor = Number(c.base_uom_factor) || getUomFactor(c.base_uom_id, c.base_uom_name);
            const plannedFactor = Number(c.planned_uom_factor) || getUomFactor(c.planned_uom_id, c.uom_name);
            return {
              ...c,
              category: cat,
              base_uom_factor: baseFactor,
              planned_uom_factor: plannedFactor,
            };
          })
        : []
    );
    setActiveView('recipe');
    loadMaterials();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Live HPP calculation in recipe draft
  const calculateLiveDraftHpp = () => {
    let total = 0;
    recipeDraftComponents.forEach((c) => {
      total += getComponentLineCost(c);
    });
    const y = Math.max(1, Number(recipeDraftYield) || 1);
    return Math.round(total / y);
  };

  // Save recipe draft and return to item editor
  const handleSaveRecipeDraft = () => {
    if (recipeDraftComponents.length === 0) {
      notify('⚠️ Tambahkan minimal 1 bahan baku untuk menyimpan resep.');
      return;
    }
    const hpp = calculateLiveDraftHpp();
    const yieldNum = Math.max(1, Number(recipeDraftYield) || 1);
    let totalBatch = 0;
    recipeDraftComponents.forEach((c) => {
      totalBatch += getComponentLineCost(c);
    });

    setRecipe({
      name: `Resep ${name.trim()}`,
      yield_quantity: yieldNum,
      yield_uom_name: 'Porsi',
      cost_per_unit: hpp,
      total_batch_cost: Math.round(totalBatch),
      components: recipeDraftComponents,
    });
    setCostPrice(String(hpp));
    setManageStock(true);
    if (!sku.trim()) {
      setSku(generateSkuFromName(name));
    }
    setActiveView('item');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    notify('✓ Resep masakan berhasil terhubung.');
  };

  // Toggle material selection in multi-picker page
  const toggleMaterialSelection = (matId) => {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(matId)) {
        next.delete(matId);
      } else {
        next.add(matId);
      }
      return next;
    });
  };

  // Confirm and batch-add all selected materials to recipe draft
  const handleConfirmSelectedMaterials = () => {
    if (selectedMaterialIds.size === 0) return;

    const toAdd = materials.filter((m) => selectedMaterialIds.has(m.id));
    const newComponents = toAdd.map((mat) => {
      const cat = mat.category || getUomCategory(mat.base_uom_id, mat.base_uom_name);
      let defaultRecipeUom = { id: 'uom_g', name: 'Gram', factor: 0.001 };
      let defaultQty = 10;

      if (cat === 'mass') {
        defaultRecipeUom = { id: 'uom_g', name: 'Gram', factor: 0.001 };
        if (/ayam|daging|ikan|fillet|bebek/i.test(mat.name)) defaultQty = 150;
        else if (/telur|mie|kentang|beras/i.test(mat.name)) defaultQty = 100;
        else defaultQty = 10;
      } else if (cat === 'volume') {
        defaultRecipeUom = { id: 'uom_ml', name: 'ml', factor: 0.001 };
        if (/susu|air|teh|kopi|soda|sirup/i.test(mat.name)) defaultQty = 200;
        else defaultQty = 15;
      } else {
        defaultRecipeUom = { id: 'uom_pcs', name: 'Pcs', factor: 1.0 };
        defaultQty = 1;
      }

      return {
        material_id: mat.id,
        material_code: mat.material_code || '',
        material_name: mat.name,
        category: cat,
        planned_quantity: defaultQty,
        planned_uom_id: defaultRecipeUom.id,
        uom_name: defaultRecipeUom.name,
        planned_uom_factor: defaultRecipeUom.factor,
        base_uom_id: mat.base_uom_id || 'uom_kg',
        base_uom_name: mat.base_uom_name || 'Kg',
        base_uom_factor: mat.base_uom_factor || 1.0,
        unit_cost: mat.unit_cost || 0,
      };
    });

    setRecipeDraftComponents((prev) => [...prev, ...newComponents]);
    setSelectedMaterialIds(new Set());
    setActiveView('recipe');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    notify(`✓ ${newComponents.length} bahan berhasil ditambahkan ke resep.`);
  };

  // Quick add custom material
  const handleAddQuickCustomMaterial = (matName) => {
    if (!matName.trim()) return;
    const newId = 'mat_custom_' + Date.now();
    const autoCode = generateMaterialCode(matName.trim(), materials);
    const newMat = {
      id: newId,
      material_code: autoCode,
      name: matName.trim(),
      category: 'mass',
      base_uom_id: 'uom_kg',
      base_uom_name: 'Kg',
      base_uom_factor: 1.0,
      unit_cost: 30000,
      cost_display: 'Rp30.000/Kg (Estimasi)',
    };
    setMaterials((prev) => [newMat, ...prev]);
    setRecipeDraftComponents((prev) => [
      ...prev,
      {
        material_id: newMat.id,
        material_code: newMat.material_code,
        material_name: newMat.name,
        category: 'mass',
        planned_quantity: 150,
        planned_uom_id: 'uom_g',
        uom_name: 'Gram',
        planned_uom_factor: 0.001,
        base_uom_id: 'uom_kg',
        base_uom_name: 'Kg',
        base_uom_factor: 1.0,
        unit_cost: 30000,
      },
    ]);
    setActiveView('recipe');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    notify(`✓ Bahan "${newMat.name}" berhasil ditambahkan ke resep.`);
  };

  // Back navigation handler
  const handleBack = () => {
    if (activeView === 'material-picker') {
      setActiveView('recipe');
      setSelectedMaterialIds(new Set());
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (activeView === 'recipe') {
      setActiveView('item');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    if (typeof window.goBackFromItemEditor === 'function') {
      window.goBackFromItemEditor();
      return;
    }
    if (typeof window.navigateTo === 'function') {
      window.navigateTo('catalog/products');
      return;
    }
    window.history.back();
  };

  // Submit / Save handler
  const handleSave = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (saving) return;

    const cleanName = name.trim();
    if (!cleanName) {
      notify('⚠️ Nama item wajib diisi.');
      return;
    }

    if (manageStock && !sku.trim()) {
      notify('❌ SKU wajib diisi jika kelola stok diaktifkan.');
      return;
    }

    setSaving(true);
    try {
      const token = getAuthToken();
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let parsedCost = null;
      if (inventoryType === 'DIRECT') {
        const raw = String(costPrice).replace(/\D/g, '');
        parsedCost = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : null;
      } else if (inventoryType === 'COOKED' && recipe && recipe.cost_per_unit != null) {
        parsedCost = Number(recipe.cost_per_unit);
      }

      const payload = {
        name: cleanName,
        sku: manageStock ? sku.trim() : null,
        cost_price: parsedCost,
        costPrice: parsedCost,
        inventory_type: inventoryType,
        inventoryType: inventoryType,
        description: description.trim(),
        is_active: cached && cached.is_active !== undefined ? cached.is_active : true,
      };

      if (inventoryType === 'COOKED' && recipe && Array.isArray(recipe.components) && recipe.components.length > 0) {
        payload.recipe = {
          name: recipe.name || `Resep ${cleanName}`,
          planned_yield_quantity: recipe.yield_quantity || 1,
          yield_uom_name: recipe.yield_uom_name || 'Porsi',
          components: recipe.components.map((c) => ({
            material_id: c.material_id || c.materialId,
            material_name: c.material_name || c.name,
            planned_quantity: Number(c.planned_quantity || c.quantity) || 1,
            planned_uom_id: c.planned_uom_id || c.uom_id || 'uom_g',
          })),
        };
      }

      if (Array.isArray(branchPrices) && branchPrices.length > 0) {
        payload.branch_prices = branchPrices.map((bp) => ({
          branch_id: bp.branch_id,
          price: bp.is_override && bp.price ? Number(String(bp.price).replace(/\D/g, '')) : null
        }));
      }

      const url = isEdit
        ? `/api/v1/admin/composed/products/${encodeURIComponent(productId)}`
        : '/api/v1/admin/composed/products';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Gagal menyimpan item.');
      }

      notify(isEdit ? '✓ Perubahan item berhasil disimpan.' : '✓ Item berhasil ditambahkan.');

      // Update in-memory state if available
      if (window.state && Array.isArray(window.state.products)) {
        if (isEdit) {
          const idx = window.state.products.findIndex((p) => p && String(p.id) === String(productId));
          if (idx !== -1) window.state.products[idx] = data.product || { ...cached, ...payload };
        } else if (data.product) {
          window.state.products.push(data.product);
        }
      }

      const savedProd = data.product || { ...cached, ...payload, id: productId };

      // Modern Mobile: Dispatch reactive sync events
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('items-updated', { detail: savedProd }));
        window.dispatchEvent(new CustomEvent('products-updated', { detail: savedProd }));
      }

      if (typeof onSaved === 'function') {
        onSaved(savedProd);
      } else {
        handleBack();
      }
    } catch (err) {
      console.error('[ItemEditorPage] Save error:', err);
      notify('❌ ' + (err.message || 'Gagal menyimpan item.'));
    } finally {
      setSaving(false);
    }
  };

  // Delete product handler
  const handleDelete = async () => {
    if (!isEdit || deleting) return;
    setDeleting(true);
    try {
      const token = getAuthToken();
      const headers = { Accept: 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/admin/products/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
        headers,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (res.status === 409 && data.menus && data.menus.length > 0) {
          notify(`❌ Item tidak dapat dihapus karena masih digunakan di ${data.menus.length} menu.`);
        } else {
          throw new Error(data.message || data.error || 'Gagal menghapus item.');
        }
        setShowDeleteModal(false);
        return;
      }

      notify('✓ Item berhasil dihapus.');

      // Remove from memory
      if (window.state && Array.isArray(window.state.products)) {
        window.state.products = window.state.products.filter(
          (p) => p && String(p.id) !== String(productId)
        );
      }

      // Modern Mobile: Dispatch delete sync events
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('items-updated', { detail: { id: productId, _deleted: true } }));
        window.dispatchEvent(new CustomEvent('products-updated', { detail: { id: productId, _deleted: true } }));
      }

      setShowDeleteModal(false);
      handleBack();
    } catch (err) {
      console.error('[ItemEditorPage] Delete error:', err);
      notify('❌ ' + (err.message || 'Gagal menghapus item.'));
    } finally {
      setDeleting(false);
    }
  };

  // Recipe calculation helpers
  const hasRecipe = Boolean(
    recipe &&
    (recipe.id || recipe.recipe_id || recipe.recipe_version_id || (Array.isArray(recipe.components) && recipe.components.length > 0))
  );

  const getCleanRecipeDisplayName = (rec, fallbackItemName) => {
    let raw = '';
    if (rec && (rec.recipe_name || rec.name)) {
      raw = String(rec.recipe_name || rec.name).trim();
    }
    // Clean off any leading "resep:" or "resep : " with colons if any
    raw = raw.replace(/^resep\s*:\s*/i, '').trim();

    if (raw) {
      if (/^resep\b/i.test(raw)) return raw;
      return `Resep ${raw}`;
    }
    if (fallbackItemName) {
      const cleanItem = String(fallbackItemName).trim().replace(/^resep\s*:\s*/i, '').trim();
      if (/^resep\b/i.test(cleanItem)) return cleanItem;
      return `Resep ${cleanItem}`;
    }
    return 'Resep Terhubung';
  };

  const recipeDisplayName = hasRecipe ? getCleanRecipeDisplayName(recipe, name) : '';
  const recipeName = recipeDisplayName;

  const recipeYield = hasRecipe
    ? (recipe.yield_quantity != null ? recipe.yield_quantity : (recipe.planned_yield_quantity != null ? recipe.planned_yield_quantity : 1))
    : 1;

  const recipeYieldUom = hasRecipe
    ? (recipe.yield_uom_name || 'Porsi')
    : 'Porsi';

  const recipeCost = hasRecipe && recipe.cost_per_unit != null
    ? formatMoney(recipe.cost_per_unit)
    : 'Rp0';

  // Format currency display for input
  const handleCostChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      setCostPrice('');
      return;
    }
    const num = Number(raw);
    setCostPrice(num.toLocaleString('id-ID'));
  };

  // Gating condition: for new item, name must have >= 1 char to unlock cards below
  const isGated = !isEdit && name.trim().length === 0;
  const isFormValid = name.trim().length > 0 && (!manageStock || sku.trim().length > 0) && !isGated;

  const headerTitle = activeView === 'material-picker'
    ? 'Pilih bahan mentah'
    : activeView === 'recipe'
    ? 'Buat resep'
    : isEdit
    ? `Item: ${name.trim() || (cached ? cached.name : 'Nama Item Yang Di Edit')}`
    : 'Tambah item';

  // Filter materials for 'material-picker' page:
  // Auto-hide materials already in recipe draft to eliminate duplicates
  const selectedInRecipeIds = new Set(
    recipeDraftComponents.map((c) => String(c.material_id || c.id))
  );

  const availableMaterials = materials.filter(
    (m) => !selectedInRecipeIds.has(String(m.id))
  );

  const cleanSearch = materialSearchQuery.trim().toLowerCase();
  const filteredMaterials = availableMaterials.filter(
    (m) =>
      m.name.toLowerCase().includes(cleanSearch) ||
      String(m.material_code || '').toLowerCase().includes(cleanSearch)
  );

  return (
    <div
      id="modern-item-editor-page-root"
      style={{
        boxSizing: 'border-box',
        paddingBottom: '96px',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
      className="w-full flex flex-col gap-4 max-w-lg md:mx-auto font-sans select-none relative"
    >
      {/* Toast Notification Banner (Rendered via React Portal outside parent containers) */}
      {internalToast && typeof document !== 'undefined' && createPortal(
        <div
          id="modern-menu-portal-root"
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999999,
            backgroundColor: '#0F172A',
            color: '#FFFFFF',
            padding: '10px 20px',
            borderRadius: '9999px',
            fontSize: '13px',
            fontWeight: 700,
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
          className="animate-fadeIn"
        >
          {internalToast}
        </div>,
        document.body
      )}

      {/* 1. Header with Back Arrow and Title */}
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
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const svg = e.currentTarget.nextElementSibling;
              if (svg) svg.style.display = 'block';
            }}
          />
          <ArrowLeftIcon className="w-[22px] h-[19px] hidden" />
        </button>
        <h1
          style={{
            color: '#0F172A',
            fontSize: '18px',
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 700,
            lineHeight: '18px',
          }}
          className="font-bold text-slate-900 text-lg tracking-[0] leading-[18px] m-0 text-left truncate flex-1"
        >
          {headerTitle}
        </h1>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-[#94A3B8] font-medium">
          Memuat data item...
        </div>
      ) : activeView === 'material-picker' ? (
        /* ========================================================
           PAGE / VIEW 3: PILIH BAHAN MENTAH (1:1 FIGMA SPEC)
           ======================================================== */
        <div className="flex flex-col gap-4 w-full animate-fadeIn">
          {/* Search Bar matching Figma: 100% width, height 48px, radius 14px, outline 1px #CBD5E1 */}
          <div
            style={{
              width: '100%',
              height: '48px',
              borderRadius: '14px',
              outline: '1px #CBD5E1 solid',
              outlineOffset: '-1px',
              backgroundColor: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '16px',
              paddingRight: '16px',
              gap: '12px',
              boxSizing: 'border-box',
            }}
            className="focus-within:outline-[#0F172A] focus-within:outline-2 transition-all"
          >
            <div style={{ width: '17px', height: '17px', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <input
              type="text"
              value={materialSearchQuery}
              onChange={(e) => setMaterialSearchQuery(e.target.value)}
              placeholder="Cari bahan mentah (Ayam, Cabai, Bawang...)"
              style={{
                border: 'none',
                outline: 'none',
                backgroundColor: 'transparent',
                width: '100%',
                fontSize: '13px',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontWeight: 500,
                color: '#0F172A',
              }}
            />
            {materialSearchQuery && (
              <button
                type="button"
                onClick={() => setMaterialSearchQuery('')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#94A3B8',
                  cursor: 'pointer',
                  padding: '4px',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Material Cards List matching Figma */}
          <div className="flex flex-col gap-3 w-full">
            {loadingMaterials ? (
              <div className="py-16 text-center text-xs text-slate-400 font-medium">
                Memuat daftar bahan mentah...
              </div>
            ) : filteredMaterials.length === 0 ? (
              <div className="py-12 px-4 text-center bg-white rounded-2xl border border-slate-200 flex flex-col items-center gap-3">
                <div style={{ fontSize: '32px' }}>🔍</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0F172A' }}>
                  {availableMaterials.length === 0
                    ? 'Semua bahan mentah sudah dimasukkan ke resep'
                    : `Tidak ditemukan bahan "${materialSearchQuery}"`}
                </div>
                <div style={{ fontSize: '12px', color: '#64748B', maxWidth: '280px' }}>
                  {availableMaterials.length === 0
                    ? 'Seluruh bahan baku yang tersedia di gudang telah terpasang pada resep ini.'
                    : 'Anda dapat menambahkan bahan ini sebagai bahan baku baru ke sistem.'}
                </div>
                {materialSearchQuery.trim() && (
                  <button
                    type="button"
                    onClick={() => handleAddQuickCustomMaterial(materialSearchQuery)}
                    style={{
                      marginTop: '8px',
                      padding: '10px 18px',
                      backgroundColor: '#00A637',
                      color: '#FFFFFF',
                      borderRadius: '12px',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    + Tambah &quot;{materialSearchQuery}&quot; Sebagai Bahan Baru
                  </button>
                )}
              </div>
            ) : (
              filteredMaterials.map((mat) => {
                const isSelected = selectedMaterialIds.has(mat.id);
                const badge = getMaterialVisualBadge(mat.name, mat.category);

                return (
                  <div
                    key={mat.id}
                    onClick={() => toggleMaterialSelection(mat.id)}
                    style={{
                      width: '100%',
                      padding: '16px',
                      backgroundColor: '#FFFFFF',
                      overflow: 'hidden',
                      borderRadius: '10px',
                      outline: isSelected ? '1.5px #1CA24B solid' : '1px #D1D3D9 solid',
                      outlineOffset: '-1px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      boxSizing: 'border-box',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    className="hover:bg-slate-50 active:scale-[0.99]"
                  >
                    {/* 45x45 Smart Visual Avatar */}
                    <div
                      style={{
                        width: '45px',
                        height: '45px',
                        position: 'relative',
                        backgroundColor: badge.bg,
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '22px',
                        flexShrink: 0,
                        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)',
                      }}
                    >
                      {badge.icon}
                    </div>

                    {/* Middle: Material Details (Name, SKU, Price) */}
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '2px',
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          color: '#0F172A',
                          fontSize: '13px',
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                          fontWeight: 700,
                          wordWrap: 'break-word',
                          lineHeight: '16px',
                        }}
                        className="truncate w-full text-left"
                      >
                        {mat.name}
                      </div>
                      <div
                        style={{
                          color: '#979797',
                          fontSize: '10px',
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                          fontWeight: 500,
                          wordWrap: 'break-word',
                          lineHeight: '12px',
                        }}
                        className="truncate w-full text-left"
                      >
                        {mat.material_code || 'KODE-001'}
                      </div>
                      <div
                        style={{
                          color: '#00A637',
                          fontSize: '12px',
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                          fontWeight: 700,
                          wordWrap: 'break-word',
                          lineHeight: '16px',
                        }}
                        className="truncate w-full text-left"
                      >
                        {mat.cost_display || 'Rp0/Kg'}
                      </div>
                    </div>

                    {/* 20x20 Checkbox matching Figma */}
                    {isSelected ? (
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '4px',
                          backgroundColor: '#1CA24B',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    ) : (
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '4px',
                          outline: '1px #303030 solid',
                          outlineOffset: '-1px',
                          backgroundColor: '#FFFFFF',
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : activeView === 'recipe' ? (
        /* ========================================================
           PAGE / VIEW 2: BUAT RESEP (1:1 FIGMA SPEC)
           ======================================================== */
        <div className="flex flex-col gap-4 w-full animate-fadeIn">
          {/* Card 1: Nama resep */}
          <div
            style={{
              alignSelf: 'stretch',
              padding: '16px',
              overflow: 'hidden',
              borderRadius: '14px',
              outline: '0.50px #D9D9D9 solid',
              outlineOffset: '-0.50px',
              backgroundColor: '#FFFFFF',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
              gap: '10px',
              display: 'flex',
            }}
            className="w-full"
          >
            <div
              style={{
                width: '100%',
                color: '#0F172A',
                fontSize: '16px',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontWeight: 700,
                wordWrap: 'break-word',
                textAlign: 'left',
              }}
            >
              Nama resep
            </div>
            <div
              style={{
                width: '100%',
                padding: '17px',
                overflow: 'hidden',
                borderRadius: '14px',
                outline: '1px #CBD5E1 solid',
                outlineOffset: '-1px',
                justifyContent: 'space-between',
                alignItems: 'center',
                display: 'inline-flex',
                boxSizing: 'border-box',
                backgroundColor: '#FFFFFF',
              }}
            >
              <div
                style={{
                  color: name.trim() ? '#0F172A' : '#94A3B8',
                  fontSize: '13px',
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontWeight: 700,
                  wordWrap: 'break-word',
                }}
                className="truncate"
              >
                {name.trim() || 'Nama item'}
              </div>
              <div
                style={{ width: '15px', height: '15px', position: 'relative', overflow: 'hidden', flexShrink: 0 }}
                title="Terkunci mengikuti nama item"
              >
                <img
                  src="/owner/assets/icons/fxemoji_lock.svg"
                  alt="Terkunci"
                  style={{ width: '15px', height: '15px', display: 'block' }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = e.currentTarget.nextElementSibling;
                    if (fallback) fallback.style.display = 'block';
                  }}
                />
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'none' }}>
                  <path d="M11.0383 10.2276C10.6418 10.2276 10.3205 9.90622 10.3205 9.5098V5.33017C10.3205 3.92148 9.17442 2.77539 7.76571 2.77539C6.35703 2.77539 5.21094 3.92145 5.21094 5.33017V7.76113C5.21094 8.15755 4.88958 8.47891 4.49316 8.47891C4.09675 8.47891 3.77539 8.15755 3.77539 7.76113V5.33017C3.77539 3.12988 5.56543 1.33984 7.76571 1.33984C9.966 1.33984 11.756 3.12988 11.756 5.33017V9.5098C11.756 9.90622 11.4347 10.2276 11.0383 10.2276Z" fill="#B1B4B5"/>
                  <path d="M12.1329 14.5743H3.39844C2.58296 14.5743 1.92188 13.9132 1.92188 13.0977V8.04785C1.92188 7.23237 2.58296 6.57129 3.39844 6.57129H12.1329C12.9484 6.57129 13.6095 7.23237 13.6095 8.04785V13.0977C13.6095 13.9132 12.9484 14.5743 12.1329 14.5743Z" fill="#FFB636"/>
                  <path d="M3.20288 13.3837H3.12891C2.89591 13.3837 2.70703 13.1949 2.70703 12.9619V8.18262C2.70703 7.94962 2.89591 7.76074 3.12891 7.76074H3.20288C3.43588 7.76074 3.62476 7.94962 3.62476 8.18262V12.9619C3.62476 13.1949 3.43588 13.3837 3.20288 13.3837Z" fill="#FFD469"/>
                </svg>
              </div>
            </div>
          </div>

          {/* Card 2: Hasil porsi */}
          <div
            style={{
              alignSelf: 'stretch',
              padding: '16px',
              overflow: 'hidden',
              borderRadius: '14px',
              outline: '0.50px #D9D9D9 solid',
              outlineOffset: '-0.50px',
              backgroundColor: '#FFFFFF',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
              gap: '10px',
              display: 'flex',
            }}
            className="w-full"
          >
            <div
              style={{
                width: '100%',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                gap: '10px',
                display: 'inline-flex',
              }}
            >
              <div
                style={{
                  flex: 1,
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  alignItems: 'flex-start',
                  gap: '8px',
                  display: 'inline-flex',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    alignSelf: 'stretch',
                    color: '#0F172A',
                    fontSize: '16px',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontWeight: 700,
                    wordWrap: 'break-word',
                  }}
                >
                  Hasil porsi
                </div>
                <div
                  style={{
                    alignSelf: 'stretch',
                    color: '#94A3B8',
                    fontSize: '13px',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontWeight: 500,
                    wordWrap: 'break-word',
                  }}
                >
                  Berapa porsi yang dihasilkan oleh resep ini?
                </div>
              </div>
              <div
                style={{
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  gap: '15px',
                  display: 'flex',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: '101px',
                    height: '52px',
                    position: 'relative',
                    overflow: 'hidden',
                    borderRadius: '14px',
                    outline: '1px #CBD5E1 solid',
                    outlineOffset: '-1px',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  <input
                    type="number"
                    min="1"
                    value={recipeDraftYield}
                    onChange={(e) => setRecipeDraftYield(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 1))}
                    onBlur={() => { if (!recipeDraftYield || Number(recipeDraftYield) < 1) setRecipeDraftYield(1); }}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      textAlign: 'center',
                      color: '#0F172A',
                      fontSize: '13px',
                      fontFamily: "'Plus Jakarta Sans', sans-serif",
                      fontWeight: 700,
                    }}
                  />
                </div>
                <div
                  style={{
                    color: '#0F172A',
                    fontSize: '13px',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontWeight: 700,
                    wordWrap: 'break-word',
                  }}
                >
                  Porsi
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Komponen bahan baku */}
          <div
            style={{
              alignSelf: 'stretch',
              padding: '16px',
              overflow: 'hidden',
              borderRadius: '14px',
              outline: '0.50px #D9D9D9 solid',
              outlineOffset: '-0.50px',
              backgroundColor: '#FFFFFF',
              flexDirection: 'column',
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
              gap: '10px',
              display: 'flex',
            }}
            className="w-full"
          >
            <div
              style={{
                width: '100%',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                alignItems: 'flex-start',
                gap: '20px',
                display: 'flex',
              }}
            >
              <div
                style={{
                  alignSelf: 'stretch',
                  paddingTop: '2px',
                  paddingBottom: '2px',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  display: 'inline-flex',
                }}
              >
                <div
                  style={{
                    color: '#0F172A',
                    fontSize: '16px',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontWeight: 700,
                    lineHeight: '16px',
                    wordWrap: 'break-word',
                  }}
                >
                  Komponen bahan baku
                </div>
                <div
                  style={{
                    width: '70px',
                    height: '30px',
                    position: 'relative',
                    background: 'linear-gradient(0deg, #F2F2F2 0%, #F2F2F2 100%), white',
                    overflow: 'hidden',
                    borderRadius: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      textAlign: 'center',
                      color: '#0F172A',
                      fontSize: '11px',
                      fontFamily: "'Plus Jakarta Sans', sans-serif",
                      fontWeight: 700,
                      wordWrap: 'break-word',
                    }}
                  >
                    {recipeDraftComponents.length} Bahan
                  </div>
                </div>
              </div>

              {recipeDraftComponents.length === 0 ? (
                <div
                  style={{
                    alignSelf: 'stretch',
                    padding: '16px',
                    borderRadius: '14px',
                    outline: '0.50px #D9D9D9 solid',
                    outlineOffset: '-0.50px',
                    flexDirection: 'column',
                    justifyContent: 'flex-start',
                    alignItems: 'flex-start',
                    gap: '10px',
                    display: 'flex',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  <div
                    style={{
                      alignSelf: 'stretch',
                      color: '#94A3B8',
                      fontSize: '13px',
                      fontFamily: "'Plus Jakarta Sans', sans-serif",
                      fontWeight: 500,
                      wordWrap: 'break-word',
                      textAlign: 'left',
                    }}
                  >
                    Belum ada bahan dalam resep ini
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    alignSelf: 'stretch',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  {recipeDraftComponents.map((comp, idx) => {
                    const lineCost = getComponentLineCost(comp);
                    const cat = comp.category || getUomCategory(comp.planned_uom_id || comp.base_uom_id, comp.uom_name || comp.base_uom_name);
                    const baseUoms = getAvailableRecipeUoms(cat);
                    const hasCurrent = baseUoms.some((u) => u.id === comp.planned_uom_id);
                    const availableUoms = hasCurrent
                      ? baseUoms
                      : [
                          ...baseUoms,
                          {
                            id: comp.planned_uom_id || 'uom_custom',
                            name: comp.uom_name || 'Satuan',
                            factor: Number(comp.planned_uom_factor) || 1.0,
                          },
                        ];

                    return (
                      <div
                        key={idx}
                        style={{
                          alignSelf: 'stretch',
                          padding: '12px 14px',
                          borderRadius: '14px',
                          outline: '0.50px #D9D9D9 solid',
                          outlineOffset: '-0.50px',
                          backgroundColor: '#FFFFFF',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          boxSizing: 'border-box',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <span
                            style={{
                              color: '#0F172A',
                              fontSize: '13px',
                              fontFamily: "'Plus Jakarta Sans', sans-serif",
                              fontWeight: 700,
                            }}
                            className="truncate"
                          >
                            🍲 {comp.material_name}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setRecipeDraftComponents((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            style={{
                              color: '#EF4444',
                              fontSize: '13px',
                              fontWeight: 700,
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              padding: '2px 4px',
                            }}
                            title="Hapus bahan"
                          >
                            ✕
                          </button>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                          <input
                            type="number"
                            step="any"
                            min="0.001"
                            value={comp.planned_quantity}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setRecipeDraftComponents((prev) =>
                                prev.map((c, i) => (i === idx ? { ...c, planned_quantity: val } : c))
                              );
                            }}
                            style={{
                              width: '75px',
                              height: '36px',
                              borderRadius: '10px',
                              outline: '1px #CBD5E1 solid',
                              outlineOffset: '-1px',
                              border: 'none',
                              textAlign: 'center',
                              color: '#0F172A',
                              fontSize: '13px',
                              fontFamily: "'Plus Jakarta Sans', sans-serif",
                              fontWeight: 700,
                              backgroundColor: '#FFFFFF',
                            }}
                          />

                          <select
                            value={comp.planned_uom_id || availableUoms[0]?.id}
                            onChange={(e) => {
                              const newUomId = e.target.value;
                              const selectedUom = availableUoms.find((u) => u.id === newUomId);
                              if (!selectedUom) return;
                              const currentFactor = Number(comp.planned_uom_factor) || getUomFactor(comp.planned_uom_id, comp.uom_name);
                              const newFactor = selectedUom.factor;
                              const factorRatio = currentFactor / newFactor;
                              let convertedQty = (Number(comp.planned_quantity) || 0) * factorRatio;
                              convertedQty = Math.round(convertedQty * 1000) / 1000;
                              setRecipeDraftComponents((prev) =>
                                prev.map((c, i) =>
                                  i === idx
                                    ? {
                                        ...c,
                                        planned_quantity: convertedQty,
                                        planned_uom_id: selectedUom.id,
                                        uom_name: selectedUom.name,
                                        planned_uom_factor: selectedUom.factor,
                                      }
                                    : c
                                )
                              );
                            }}
                            style={{
                              height: '36px',
                              padding: '0 8px',
                              borderRadius: '10px',
                              outline: '1px #CBD5E1 solid',
                              outlineOffset: '-1px',
                              border: 'none',
                              backgroundColor: '#F8FAFC',
                              color: '#0F172A',
                              fontSize: '12px',
                              fontFamily: "'Plus Jakarta Sans', sans-serif",
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {availableUoms.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>

                          <span
                            style={{
                              flex: 1,
                              textAlign: 'right',
                              color: '#0F172A',
                              fontSize: '13px',
                              fontFamily: "'Plus Jakarta Sans', sans-serif",
                              fontWeight: 700,
                            }}
                          >
                            {formatMoney(lineCost)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setActiveView('material-picker');
                setSelectedMaterialIds(new Set());
                setMaterialSearchQuery('');
                loadMaterials();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              style={{
                alignSelf: 'stretch',
                width: '100%',
                paddingTop: '13px',
                paddingBottom: '13px',
                backgroundColor: '#FFFFFF',
                overflow: 'hidden',
                borderRadius: '20px',
                outline: '1px #00A637 solid',
                outlineOffset: '-1px',
                border: 'none',
                cursor: 'pointer',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '10px',
                display: 'inline-flex',
                boxSizing: 'border-box',
                transition: 'background-color 0.15s ease',
              }}
              className="hover:bg-slate-50 active:bg-slate-100"
            >
              <div
                style={{
                  textAlign: 'center',
                  color: '#00A637',
                  fontSize: '13px',
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontWeight: 700,
                  wordWrap: 'break-word',
                }}
              >
                Tambah bahan
              </div>
            </button>
          </div>

          {/* Card 4: Estimasi HPP (Padding top & bottom exactly balanced at 16px) */}
          <div
            style={{
              alignSelf: 'stretch',
              padding: '16px',
              borderRadius: '14px',
              outline: '0.50px #D9D9D9 solid',
              outlineOffset: '-0.50px',
              backgroundColor: '#FFFFFF',
              boxSizing: 'border-box',
            }}
            className="w-full"
          >
            <div
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '6px',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    color: '#0F172A',
                    fontSize: '16px',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontWeight: 700,
                    lineHeight: '20px',
                    wordWrap: 'break-word',
                  }}
                >
                  Estimasi HPP
                </div>
                <div
                  style={{
                    color: '#94A3B8',
                    fontSize: '13px',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontWeight: 500,
                    lineHeight: '18px',
                    wordWrap: 'break-word',
                  }}
                >
                  Akumulasi biaya bahan baku per porsi
                </div>
              </div>
              <div
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: '6px',
                  textAlign: 'right',
                }}
              >
                <div
                  style={{
                    textAlign: 'right',
                    color: '#00A637',
                    fontSize: '16px',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontWeight: 700,
                    lineHeight: '20px',
                    wordWrap: 'break-word',
                  }}
                >
                  {formatMoney(calculateLiveDraftHpp())}
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    color: '#94A3B8',
                    fontSize: '11px',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontWeight: 500,
                    lineHeight: '14px',
                    wordWrap: 'break-word',
                  }}
                >
                  per porsi
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ========================================================
           PAGE / VIEW 1: FORM UTAMA ITEM EDITOR
           ======================================================== */
        <form onSubmit={handleSave} className="flex flex-col gap-4 w-full">
          {/* Card 1: Nama Item */}
          <div
            style={{
              padding: '16px',
              borderRadius: '14px',
              outline: '0.50px #D9D9D9 solid',
              outlineOffset: '-0.50px',
              backgroundColor: '#FFFFFF',
            }}
            className="w-full flex flex-col gap-2.5"
          >
            <label
              htmlFor="item-name-input"
              className="text-left w-full cursor-pointer flex items-center"
            >
              <span
                style={{
                  color: '#0F172A',
                  fontSize: '16px',
                  fontWeight: 700,
                }}
              >
                Nama
              </span>
              <span style={{ color: '#303030', fontSize: '14px', fontWeight: 700 }}>&nbsp;&nbsp;</span>
              <span style={{ color: '#FA3E3E', fontSize: '14px', fontWeight: 700 }}>*</span>
            </label>

            <div
              style={{
                height: '50px',
                borderRadius: '14px',
                outline: '1px #CBD5E1 solid',
                outlineOffset: '-1px',
              }}
              className="w-full px-4 flex items-center bg-white focus-within:outline-[#0F172A] focus-within:outline-2 transition-all"
            >
              <input
                id="item-name-input"
                type="text"
                value={name}
                onChange={(e) => {
                  const val = e.target.value;
                  setName(val);
                  if (!isEdit && (!sku || sku.endsWith('-001'))) {
                    setSku(generateSkuFromName(val));
                  }
                }}
                placeholder="Nama item"
                required
                maxLength={160}
                style={{
                  color: '#0F172A',
                  fontSize: '13px',
                  fontWeight: 700,
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
                className="w-full h-full bg-transparent border-none outline-none text-[#0F172A] placeholder-[#94A3B8]"
              />
            </div>
          </div>

          {/* Gating Lock Container: Disabled if Name is empty in Tambah Item */}
          <div
            className={`w-full flex flex-col gap-4 transition-all duration-300 ${
              isGated ? 'opacity-40 pointer-events-none select-none' : ''
            }`}
          >
            {/* Gating Banner (shown when name is empty) */}
            {isGated && (
              <div
                style={{
                  background: '#EFF6FF',
                  border: '1px dashed #93C5FD',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  fontSize: '12px',
                  color: '#1E40AF',
                  fontWeight: 600,
                }}
                className="w-full flex items-center gap-2 text-left animate-fadeIn"
              >
                <span>🔒</span>
                <span>Ketik <strong>Nama item</strong> di atas terlebih dahulu untuk membuka pengaturan tipe stok & resep.</span>
              </div>
            )}

            {/* Card 2: Tipe Stok */}
            <div
              style={{
                padding: '16px',
                borderRadius: '14px',
                outline: '0.50px #D9D9D9 solid',
                outlineOffset: '-0.50px',
                backgroundColor: '#FFFFFF',
              }}
              className="w-full flex flex-col gap-5"
            >
              <div
                style={{
                  color: '#0F172A',
                  fontSize: '16px',
                  fontWeight: 700,
                  lineHeight: '16px',
                }}
                className="text-left w-full"
              >
                Tipe stok
              </div>

              <div className="w-full flex flex-col gap-3">
                {/* Option 1: Pakai Resep */}
                <div
                  onClick={() => setInventoryType('COOKED')}
                  className="w-full flex items-center justify-between gap-3.5 cursor-pointer select-none"
                >
                  <div
                    style={{
                      width: '45px',
                      height: '45px',
                      borderRadius: '10px',
                      backgroundColor: '#4285F4',
                    }}
                    className="flex items-center justify-center shrink-0"
                  >
                    <CookingPotIcon />
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col items-start gap-2 text-left">
                    <div
                      style={{
                        color: '#0F172A',
                        fontSize: '16px',
                        fontWeight: 700,
                      }}
                      className="w-full truncate"
                    >
                      Pakai Resep
                    </div>
                    <div
                      style={{
                        color: '#94A3B8',
                        fontSize: '13px',
                        fontWeight: 500,
                      }}
                      className="w-full leading-snug"
                    >
                      Dimasak dari bahan-bahan mentah seperti ayam ungkep berbumbu untuk stok, dsb
                    </div>
                  </div>

                  <SwitchToggle
                    checked={inventoryType === 'COOKED'}
                    onChange={() => setInventoryType('COOKED')}
                  />
                </div>

                {/* Divider */}
                <div
                  style={{
                    width: '100%',
                    height: '0px',
                    outline: '1px #D9D9D9 solid',
                    outlineOffset: '-0.50px',
                  }}
                />

                {/* Option 2: Siap Jual (Non-Resep) - DEFAULT */}
                <div
                  onClick={() => setInventoryType('DIRECT')}
                  className="w-full flex items-center justify-between gap-3.5 cursor-pointer select-none"
                >
                  <div
                    style={{
                      width: '45px',
                      height: '45px',
                      borderRadius: '10px',
                      backgroundColor: '#EA4335',
                    }}
                    className="flex items-center justify-center shrink-0"
                  >
                    <FoodTrayIcon />
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col items-start gap-2 text-left">
                    <div
                      style={{
                        color: '#0F172A',
                        fontSize: '16px',
                        fontWeight: 700,
                      }}
                      className="w-full truncate"
                    >
                      Siap Jual (Non-Resep)
                    </div>
                    <div
                      style={{
                        color: '#94A3B8',
                        fontSize: '13px',
                        fontWeight: 500,
                      }}
                      className="w-full leading-snug"
                    >
                      Item yang tidak butuh proses masak seperti air kemasan, lalapan, kerupuk kemasan, dll
                    </div>
                  </div>

                  <SwitchToggle
                    checked={inventoryType === 'DIRECT'}
                    onChange={() => setInventoryType('DIRECT')}
                  />
                </div>
              </div>
            </div>

            {/* Card 3: Resep / Buat Resep (Shown when inventoryType === 'COOKED') */}
            {inventoryType === 'COOKED' && (
              <div
                style={{
                  padding: '16px',
                  borderRadius: '14px',
                  outline: '0.50px #D9D9D9 solid',
                  outlineOffset: '-0.50px',
                  backgroundColor: '#FFFFFF',
                }}
                className="w-full flex flex-col gap-2.5 animate-fadeIn"
              >
                {hasRecipe && (
                  <div
                    style={{
                      color: '#0F172A',
                      fontSize: '16px',
                      fontWeight: 700,
                      lineHeight: '16px',
                    }}
                    className="text-left w-full"
                  >
                    HPP bahan
                  </div>
                )}

                {hasRecipe ? (
                  /* Condition A: Has Recipe Configured */
                  <div
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      outline: '1px #D1D3D9 solid',
                      outlineOffset: '-1px',
                      backgroundColor: '#FFFFFF',
                    }}
                    className="w-full flex flex-col gap-3"
                  >
                    {/* Top Row: Resep name + HPP cost */}
                    <div className="w-full flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 flex flex-col text-left">
                        <div
                          style={{
                            color: '#0F172A',
                            fontSize: '13px',
                            fontWeight: 700,
                          }}
                          className="truncate w-full"
                        >
                          {recipeDisplayName || 'Resep Terhubung'}
                        </div>
                        <div
                          style={{
                            color: '#94A3B8',
                            fontSize: '11px',
                            fontWeight: 500,
                          }}
                          className="mt-1"
                        >
                          Hasil: {recipeYield} {recipeYieldUom}
                        </div>
                      </div>

                      <div className="shrink-0 flex flex-col items-end text-right">
                        <div
                          style={{
                            color: '#1CA24B',
                            fontSize: '16px',
                            fontWeight: 800,
                          }}
                        >
                          {recipeCost}
                        </div>
                        <div
                          style={{
                            color: '#94A3B8',
                            fontSize: '11px',
                            fontWeight: 500,
                          }}
                          className="mt-1"
                        >
                          HPP per {recipeYieldUom.toLowerCase()}
                        </div>
                      </div>
                    </div>

                    {/* Inner Divider */}
                    <div
                      style={{
                        width: '100%',
                        height: '0px',
                        outline: '1px #D9D9D9 solid',
                        outlineOffset: '-0.50px',
                      }}
                    />

                    {/* Ingredients snippet */}
                    <div
                      style={{
                        color: '#64748B',
                        fontSize: '13px',
                        fontWeight: 500,
                        lineHeight: '18px',
                      }}
                      className="w-full text-left flex flex-col gap-1"
                    >
                      {Array.isArray(recipe.components) && recipe.components.length > 0 ? (
                        <>
                          {recipe.components.slice(0, 3).map((comp, idx) => (
                            <div key={idx} className="truncate">
                              {comp.material_name} ({comp.planned_quantity} {comp.uom_name || ''})
                            </div>
                          ))}
                          {recipe.components.length > 3 && (
                            <span style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '14px' }}>
                              dan {recipe.components.length - 3} bahan lainnya...
                            </span>
                          )}
                        </>
                      ) : (
                        <div style={{ color: '#94A3B8', fontSize: '12px', fontStyle: 'italic' }}>
                          Belum ada rincian bahan baku dalam formula resep ini.
                        </div>
                      )}
                    </div>

                    {/* Action Link: Lihat resep */}
                    <div className="w-full flex justify-end items-center pt-1">
                      <a
                        href="javascript:void(0)"
                        onClick={openRecipeView}
                        style={{
                          color: '#1E5EB2',
                          fontSize: '11px',
                          fontWeight: 700,
                          textDecoration: 'none',
                        }}
                        className="hover:underline cursor-pointer"
                      >
                        Lihat resep? →
                      </a>
                    </div>
                  </div>
                ) : (
                  /* Condition B: No Recipe yet -> 1:1 Figma Spec with Cat Chef Mascot Image */
                  <div
                    style={{
                      width: '100%',
                      flexDirection: 'column',
                      justifyContent: 'flex-start',
                      alignItems: 'flex-start',
                      gap: '20px',
                      display: 'flex',
                    }}
                    className="w-full flex flex-col gap-5"
                  >
                    <div
                      style={{
                        alignSelf: 'stretch',
                        flexDirection: 'column',
                        justifyContent: 'flex-start',
                        alignItems: 'flex-start',
                        gap: '12px',
                        display: 'flex',
                      }}
                      className="w-full flex flex-col gap-3"
                    >
                      <div
                        style={{
                          color: '#0F172A',
                          fontSize: '16px',
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                          fontWeight: 700,
                          wordWrap: 'break-word',
                        }}
                        className="text-left w-full"
                      >
                        Buat resepnya dulu yuk!
                      </div>
                      <img
                        style={{
                          width: '100%',
                          height: '189px',
                          aspectRatio: '321 / 189',
                          borderRadius: '20px',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                        src="/owner/assets/img/cat-chef-recipe.png"
                        alt="Buat resepnya dulu yuk!"
                        onError={(e) => {
                          if (!e.currentTarget.dataset.retried) {
                            e.currentTarget.dataset.retried = '1';
                            e.currentTarget.src = '/merchant-shared/img/cat-chef-recipe.png';
                          }
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={openRecipeView}
                      style={{
                        width: '100%',
                        paddingTop: '13px',
                        paddingBottom: '13px',
                        background: 'linear-gradient(0deg, #00A637 0%, #00A637 100%), white',
                        overflow: 'hidden',
                        borderRadius: '20px',
                        outline: '1px #00A637 solid',
                        outlineOffset: '-1px',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: '10px',
                        boxShadow: '0 4px 14px rgba(0, 166, 55, 0.2)',
                      }}
                      className="active:scale-98 transition-all hover:brightness-105"
                    >
                      <span
                        style={{
                          textAlign: 'center',
                          color: 'white',
                          fontSize: '13px',
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                          fontWeight: 700,
                          wordWrap: 'break-word',
                        }}
                      >
                        Buat resep
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Card 4: Harga modal (Rp)/pcs (Shown when inventoryType === 'DIRECT') */}
            {inventoryType === 'DIRECT' && (
              <div
                style={{
                  padding: '16px',
                  borderRadius: '14px',
                  outline: '0.50px #D9D9D9 solid',
                  outlineOffset: '-0.50px',
                  backgroundColor: '#FFFFFF',
                }}
                className="w-full flex flex-col gap-2.5 animate-fadeIn"
              >
                <label
                  htmlFor="item-cost-price-input"
                  style={{
                    color: '#0F172A',
                    fontSize: '16px',
                    fontWeight: 700,
                  }}
                  className="text-left w-full cursor-pointer"
                >
                  Harga modal (Rp)/pcs
                </label>

                <div
                  style={{
                    height: '50px',
                    borderRadius: '14px',
                    outline: '1px #CBD5E1 solid',
                    outlineOffset: '-1px',
                  }}
                  className="w-full px-4 flex items-center bg-white focus-within:outline-[#0F172A] focus-within:outline-2 transition-all"
                >
                  <input
                    id="item-cost-price-input"
                    type="text"
                    inputMode="numeric"
                    value={costPrice}
                    onChange={handleCostChange}
                    placeholder="20.000"
                    style={{
                      color: '#0F172A',
                      fontSize: '13px',
                      fontWeight: 700,
                      fontFamily: "'Plus Jakarta Sans', sans-serif",
                    }}
                    className="w-full h-full bg-transparent border-none outline-none text-[#0F172A] placeholder-[#94A3B8]"
                  />
                </div>
              </div>
            )}

            {/* Card 4B: Harga Khusus Cabang (LSP - Location-Specific Pricing) */}
            <div
              style={{
                padding: '16px',
                borderRadius: '14px',
                outline: '0.50px #D9D9D9 solid',
                outlineOffset: '-0.50px',
                backgroundColor: '#FFFFFF',
              }}
              className="w-full flex flex-col gap-3"
            >
              <div
                className="flex items-center justify-between cursor-pointer select-none"
                onClick={() => setShowBranchPricing((prev) => !prev)}
              >
                <div className="flex items-center gap-2">
                  <span style={{ color: '#0F172A', fontSize: '15px', fontWeight: 700 }}>
                    Harga Khusus Cabang (LSP)
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    Opsional
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform ${showBranchPricing ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              <p className="text-xs text-slate-500 m-0">
                Atur harga jual khusus untuk cabang tertentu. Cabang tanpa harga khusus akan menggunakan harga master.
              </p>

              {showBranchPricing && (
                <div className="flex flex-col gap-3 pt-2 border-t border-slate-100">
                  {branchPrices.length === 0 ? (
                    <div className="text-xs text-slate-400 py-2">Memuat daftar cabang...</div>
                  ) : (
                    branchPrices.map((bp, bIdx) => (
                      <div key={bp.branch_id} className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800">{bp.branch_name}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const next = [...branchPrices];
                              next[bIdx].is_override = !next[bIdx].is_override;
                              if (!next[bIdx].is_override) next[bIdx].price = '';
                              setBranchPrices(next);
                            }}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer transition-all border ${
                              bp.is_override
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white text-slate-500 border-slate-300'
                            }`}
                          >
                            {bp.is_override ? 'Harga Khusus' : 'Ikuti Master'}
                          </button>
                        </div>
                        {bp.is_override && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-300">
                              <span className="text-xs font-bold text-slate-400">Rp</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="25.000"
                                value={bp.price}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/\D/g, '');
                                  const val = raw ? Number(raw).toLocaleString('id-ID') : '';
                                  const next = [...branchPrices];
                                  next[bIdx].price = val;
                                  setBranchPrices(next);
                                }}
                                className="w-full text-xs font-bold text-slate-900 border-none outline-none bg-transparent"
                              />
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => {
                                  const base = Number(String(price).replace(/\D/g, '')) || 0;
                                  if (base > 0) {
                                    const calculated = Math.round((base * 1.15) / 500) * 500;
                                    const next = [...branchPrices];
                                    next[bIdx].price = calculated.toLocaleString('id-ID');
                                    setBranchPrices(next);
                                  }
                                }}
                                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 cursor-pointer"
                              >
                                +15% (Mall)
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const base = Number(String(price).replace(/\D/g, '')) || 0;
                                  if (base > 0) {
                                    const calculated = Math.round((base * 1.25) / 500) * 500;
                                    const next = [...branchPrices];
                                    next[bIdx].price = calculated.toLocaleString('id-ID');
                                    setBranchPrices(next);
                                  }
                                }}
                                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 cursor-pointer"
                              >
                                +25% (Bandara)
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const base = Number(String(price).replace(/\D/g, '')) || 0;
                                  if (base > 0) {
                                    const next = [...branchPrices];
                                    next[bIdx].price = base.toLocaleString('id-ID');
                                    setBranchPrices(next);
                                  }
                                }}
                                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 cursor-pointer"
                              >
                                Sama Master
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Card 5: Kelola stok (SKU) */}
            <div
              style={{
                padding: '16px',
                borderRadius: '14px',
                outline: '0.50px #D9D9D9 solid',
                outlineOffset: '-0.50px',
                backgroundColor: '#FFFFFF',
              }}
              className="w-full flex flex-col gap-4"
            >
              <div className="w-full flex items-center justify-between">
                <div
                  style={{
                    color: '#0F172A',
                    fontSize: '16px',
                    fontWeight: 700,
                  }}
                  className="text-left"
                >
                  Kelola stok (SKU)
                </div>

                <SwitchToggle
                  checked={manageStock}
                  onChange={(next) => setManageStock(next)}
                />
              </div>

              <div
                style={{
                  color: '#94A3B8',
                  fontSize: '11px',
                  fontWeight: 500,
                  lineHeight: '1.4',
                }}
                className="text-left w-full"
              >
                Aktifkan agar item tercatat di stok, akan berkurang otomatis ketika terjual. Data item ini digunakan sebagai acuan inventaris di tiap cabang
              </div>

              {manageStock && (
                <div className="w-full flex flex-col gap-2.5 animate-fadeIn">
                  <div className="flex items-center justify-between w-full">
                    <label
                      htmlFor="item-sku-input"
                      className="text-left cursor-pointer flex items-center"
                    >
                      <span
                        style={{
                          color: '#94A3B8',
                          fontSize: '13px',
                          fontWeight: 500,
                        }}
                      >
                        SKU&nbsp;
                      </span>
                      <span style={{ color: '#FA3E3E', fontSize: '13px', fontWeight: 500 }}>*</span>
                    </label>

                    {!isEdit && (
                      <span className="text-[11px] font-bold text-[#00A637] bg-[#DCFCE7] px-2 py-0.5 rounded">
                        ✓ Auto-generated
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      height: '50px',
                      borderRadius: '14px',
                      outline: '1px #CBD5E1 solid',
                      outlineOffset: '-1px',
                    }}
                    className="w-full px-4 flex items-center bg-white focus-within:outline-[#0F172A] focus-within:outline-2 transition-all"
                  >
                    <input
                      id="item-sku-input"
                      type="text"
                      value={sku}
                      onChange={(e) => setSku(e.target.value.toUpperCase())}
                      placeholder="KODE-SKUNYA-0230"
                      maxLength={120}
                      style={{
                        color: '#0F172A',
                        fontSize: '13px',
                        fontWeight: 700,
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                      }}
                      className="w-full h-full bg-transparent border-none outline-none text-[#0F172A] placeholder-[#94A3B8]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Card 6: Catatan */}
            <div
              style={{
                padding: '16px',
                borderRadius: '14px',
                outline: '0.50px #D9D9D9 solid',
                outlineOffset: '-0.50px',
                backgroundColor: '#FFFFFF',
              }}
              className="w-full flex flex-col gap-2.5"
            >
              <div
                style={{
                  color: '#0F172A',
                  fontSize: '16px',
                  fontWeight: 700,
                }}
                className="text-left w-full"
              >
                Catatan
              </div>

              <div
                style={{
                  height: '111px',
                  borderRadius: '14px',
                  outline: '1px #CBD5E1 solid',
                  outlineOffset: '-1px',
                }}
                className="w-full p-4 bg-white focus-within:outline-[#0F172A] focus-within:outline-2 transition-all relative"
              >
                <textarea
                  id="item-note-textarea"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 250))}
                  placeholder="Catatan..."
                  style={{
                    color: '#0F172A',
                    fontSize: '13px',
                    fontWeight: 500,
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    resize: 'none',
                  }}
                  className="w-full h-full bg-transparent border-none outline-none text-[#0F172A] placeholder-[#94A3B8]"
                />
              </div>

              <div
                style={{
                  color: '#94A3B8',
                  fontSize: '10px',
                  fontWeight: 400,
                }}
                className="text-right w-full"
              >
                {description.length}/250
              </div>
            </div>

            {/* Card 7: Hapus Item (Only shown in Edit mode) */}
            {isEdit && (
              <div
                style={{
                  padding: '16px',
                  borderRadius: '14px',
                  outline: '0.50px #D9D9D9 solid',
                  outlineOffset: '-0.50px',
                  backgroundColor: '#FFFFFF',
                }}
                className="w-full flex flex-col gap-6"
              >
                <div className="w-full flex flex-col gap-1 text-left">
                  <div
                    style={{
                      color: 'black',
                      fontSize: '16px',
                      fontWeight: 700,
                    }}
                  >
                    Hapus item
                  </div>
                  <div
                    style={{
                      color: '#94A3B8',
                      fontSize: '13px',
                      fontWeight: 500,
                    }}
                  >
                    Item yang sudah dihapus tidak akan bisa di kembalikan
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowDeleteModal(true)}
                  style={{
                    padding: '13px 16px',
                    borderRadius: '20px',
                    outline: '1px #FA3E3E solid',
                    outlineOffset: '-1px',
                    background: 'white',
                  }}
                  className="w-full flex items-center justify-center cursor-pointer border-none active:scale-[0.99] hover:bg-red-50/50 transition-all"
                >
                  <span
                    style={{
                      color: '#FA3E3E',
                      fontSize: '13px',
                      fontWeight: 700,
                    }}
                  >
                    Hapus item
                  </span>
                </button>
              </div>
            )}
          </div>
        </form>
      )}

      {/* Standard Confirmation Modal for Delete Item */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        isDeleting={deleting}
        title="Hapus Item?"
        description={`Item "${name}" akan dihapus permanen. Aksi ini tidak dapat dibatalkan.`}
      />

      {/* Fixed Bottom Action Bar */}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            id="modern-item-editor-bottom-bar"
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              width: '100vw',
              maxWidth: '100vw',
              backgroundColor: '#FFFFFF',
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              boxShadow: '0px 0px 15px rgba(0, 0, 0, 0.15)',
              zIndex: 9999,
              paddingTop: '20px',
              paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
              paddingLeft: '16px',
              paddingRight: '16px',
              boxSizing: 'border-box',
            }}
            className="w-full bg-white rounded-t-[20px] z-[9999]"
          >
            <div className="w-full max-w-lg mx-auto">
              {activeView === 'material-picker' ? (
                <button
                  type="button"
                  onClick={handleConfirmSelectedMaterials}
                  disabled={selectedMaterialIds.size === 0}
                  style={{
                    width: '100%',
                    height: '48px',
                    position: 'relative',
                    background: selectedMaterialIds.size === 0 ? '#CBD5E1' : '#00A637',
                    overflow: 'hidden',
                    borderRadius: '9999px',
                    outline: selectedMaterialIds.size === 0 ? 'none' : '1px #00A637 solid',
                    outlineOffset: '-1px',
                    border: 'none',
                    cursor: selectedMaterialIds.size === 0 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: selectedMaterialIds.size === 0 ? 'none' : '0 4px 14px rgba(0, 166, 55, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                  className={selectedMaterialIds.size > 0 ? 'active:scale-98 hover:bg-emerald-600 transition-all' : ''}
                >
                  <div
                    style={{
                      textAlign: 'center',
                      color: 'white',
                      fontSize: '14px',
                      fontFamily: "'Plus Jakarta Sans', sans-serif",
                      fontWeight: 700,
                      wordWrap: 'break-word',
                    }}
                  >
                    {selectedMaterialIds.size > 0 ? `Pilih (${selectedMaterialIds.size})` : 'Pilih'}
                  </div>
                </button>
              ) : activeView === 'recipe' ? (
                <button
                  type="button"
                  onClick={handleSaveRecipeDraft}
                  style={{
                    width: '100%',
                    height: '48px',
                    position: 'relative',
                    background: '#00A637',
                    overflow: 'hidden',
                    borderRadius: '9999px',
                    outline: '1px #00A637 solid',
                    outlineOffset: '-1px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 14px rgba(0, 166, 55, 0.25)',
                  }}
                  className="active:scale-98 hover:bg-emerald-600 transition-all"
                >
                  <div
                    style={{
                      textAlign: 'center',
                      color: 'white',
                      fontSize: '14px',
                      fontFamily: "'Plus Jakarta Sans', sans-serif",
                      fontWeight: 700,
                      wordWrap: 'break-word',
                    }}
                  >
                    Simpan
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    width: '100%',
                    height: '48px',
                    borderRadius: '9999px',
                    border: 'none',
                    outline: 'none',
                    backgroundColor: isFormValid ? '#00A637' : '#F2F2F2',
                    color: isFormValid ? '#FFFFFF' : '#979797',
                    fontWeight: 700,
                    fontSize: '14px',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    cursor: saving ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease',
                  }}
                  className={isFormValid && !saving ? 'active:scale-98 hover:bg-emerald-600' : 'active:scale-[0.99]'}
                >
                  {saving ? 'Menyimpan...' : isEdit ? 'Simpan' : 'Tambah'}
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
