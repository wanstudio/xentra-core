(function(){
  'use strict';
  if (window.XentraNav) return;

  var stack = [];
  var ignoreNextPop = false;

  function push(entry){
    stack.push(entry);
    history.pushState({xentraNav:true, depth:stack.length}, '');
  }

  function popAndClose(){
    if (!stack.length) return;
    var entry = stack.pop();
    if (entry.type === 'fn') {
      try { entry.fn(); } catch(e) { console.error('[XentraNav]', e); }
    } else if (entry.type === 'node' && entry.node && entry.node.parentNode) {
      /*
       * If the overlay registered its own animated close (see
       * closeDynamicOverlay() in checkout.js), use it so Back/hardware
       * back/gesture navigation dismiss with the same swipe-down
       * language as a tap-outside or swipe close - one shared overlay
       * behavior system, per the state/overlay architecture decision.
       * Falls back to immediate removal for overlays that never opted in.
       */
      if (typeof entry.node.__xentraClose === 'function') {
        try { entry.node.__xentraClose(); } catch(e) { entry.node.remove(); }
      } else {
        entry.node.remove();
      }
    }
  }

  window.XentraNav = {
    pushClose: function(fn){
      push({type:'fn', fn: fn});
    },
    close: function(){
      if (!stack.length) return;
      history.back();
    },
    hasOpen: function(){
      return stack.length > 0;
    }
  };

  window.addEventListener('popstate', function(){
    if (ignoreNextPop) { ignoreNextPop = false; return; }
    if (!stack.length) return;
    popAndClose();
  });

  var OVERLAY_SELECTOR = '.x-overlay,.xentra-dynamic-overlay,.x-del-overlay';

  var observer = new MutationObserver(function(mutations){
    mutations.forEach(function(m){

      m.addedNodes && m.addedNodes.forEach(function(node){
        if (node.nodeType !== 1) return;
        if (node.parentNode !== document.body) return;
        if (!node.matches || !node.matches(OVERLAY_SELECTOR)) return;
        stack.push({type:'node', node: node});
        history.pushState({xentraNav:true, depth:stack.length}, '');
      });

      m.removedNodes && m.removedNodes.forEach(function(node){
        if (node.nodeType !== 1) return;
        var idx = -1;
        for (var i = stack.length - 1; i >= 0; i--) {
          if (stack[i].type === 'node' && stack[i].node === node) { idx = i; break; }
        }
        if (idx === -1) return;
        stack.splice(idx, 1);
        ignoreNextPop = true;
        history.back();
      });

    });
  });

  observer.observe(document.body, { childList: true });

})();

(function(){
'use strict';
if(window.__XENTRA_MENU_V4)return;
window.__XENTRA_MENU_V4=true;

const API=window.location.origin+'/api/v1';
const P='xentra_mvp_v5_';
const HOME_CACHE=P+'home', CART_CACHE=P+'cart', NOTES_CACHE=P+'notes';
const PROD_CACHE=P+'products_', MENU_TTL=10*60*1000, CART_TTL=30*24*60*60*1000, NOTES_TTL=30*24*60*60*1000;
const API_TIMEOUT=6500;

const state={
  categories:[],products:[],category:null,
  cart:{items:[]},promo:{enabled:false,target:0,discount:0},
  checkoutUrl:'/checkout/',notes:{},noteProduct:null,
  minusIcon:'',plusIcon:'',cartIcon:'',fileIcon:'',writeIcon:'',trashIcon:'',bikeIcon:'',rightIcon:'',discountIcon:'', couponIcon:'',
  deliveryFee:null,
  syncing:false
};
window.__xentraHomeState = state;

let checkoutStateActive = false;

const $=id=>document.getElementById(id);

function money(v){return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0,maximumFractionDigits:0}).format(Number(v)||0)}
function moneyPlain(v){return new Intl.NumberFormat('id-ID',{minimumFractionDigits:0,maximumFractionDigits:0}).format(Number(v)||0)}
function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
function plain(v){const d=document.createElement('div');d.innerHTML=v||'';return d.textContent.trim()}
function readCache(k){try{const r=localStorage.getItem(k);if(!r)return null;const p=JSON.parse(r);if(p.expires&&Date.now()>p.expires){localStorage.removeItem(k);return null}return p.data??null}catch(_){return null}}
function writeCache(k,data,ttl){try{localStorage.setItem(k,JSON.stringify({savedAt:Date.now(),expires:Date.now()+ttl,data}))}catch(_){}}

/* =========================================================
   LIVE CLOCK & CAROUSEL ENGINES
   ========================================================= */

function initLiveClock() {
  function updateClock() {
    const timeEl = document.getElementById('x-hero-time');
    const dateEl = document.getElementById('x-hero-date');
    if (!timeEl || !dateEl) return;
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    timeEl.textContent = hours + '.' + minutes;

    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    dateEl.textContent = days[now.getDay()] + ', ' + now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
  }
  updateClock();
  setInterval(updateClock, 1000);
}

let carouselInterval = null;
let currentSlideIndex = 0;
let carouselBanners = [];

function renderCarousel(banners) {
  carouselBanners = (Array.isArray(banners) && banners.length > 0) ? banners : [
    {
      id: 'b1',
      image_url: 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-1.png',
      title: 'slalu ada sensasi di setiap gigitan'
    }
  ];

  const track = document.getElementById('x-carousel-track');
  const dotsContainer = document.getElementById('x-carousel-dots');
  if (!track || !dotsContainer) return;

  track.innerHTML = carouselBanners.map(function(b, idx){
    return [
      '<div class="x-carousel-slide" data-index="' + idx + '">',
        '<img src="' + esc(b.image_url) + '" alt="' + esc(b.title || 'Promo Banner') + '" class="x-carousel-img" loading="lazy">',
      '</div>'
    ].join('');
  }).join('');

  dotsContainer.innerHTML = carouselBanners.map(function(_, idx){
    return '<span class="x-carousel-dot ' + (idx === 0 ? 'active' : '') + '" data-index="' + idx + '"></span>';
  }).join('');

  dotsContainer.querySelectorAll('.x-carousel-dot').forEach(function(dot){
    dot.addEventListener('click', function(){
      var idx = Number(dot.getAttribute('data-index') || 0);
      goToSlide(idx);
    });
  });

  startCarouselAutoPlay();
}

function goToSlide(index) {
  if (index < 0) index = carouselBanners.length - 1;
  if (index >= carouselBanners.length) index = 0;
  currentSlideIndex = index;

  var track = document.getElementById('x-carousel-track');
  if (track) {
    track.style.transform = 'translateX(-' + (currentSlideIndex * 100) + '%)';
  }

  var dots = document.querySelectorAll('#x-carousel-dots .x-carousel-dot');
  dots.forEach(function(dot, idx){
    if (idx === currentSlideIndex) dot.classList.add('active');
    else dot.classList.remove('active');
  });
}

function startCarouselAutoPlay() {
  if (carouselInterval) clearInterval(carouselInterval);
  if (carouselBanners.length <= 1) return;
  carouselInterval = setInterval(function(){
    goToSlide(currentSlideIndex + 1);
  }, 5000);
}

function normalizeProduct(p){
  if(!p)return null;
  const price=Number(p.price??p.prices?.price??0);
  const reg=Number(p.regular_price??p.prices?.regular_price??price);
  const sale=Number(p.sale_price??p.prices?.sale_price??0);
  const image=p.image||p.image_url||p.images?.[0]?.src||p.images?.[0]?.thumbnail||'';
  const description=plain(p.description||p.short_description||'');
  return {...p,id:Number(p.id),name:String(p.name||''),price,regular_price:reg,sale_price:sale,image,description,short_description:description,
    prices:{price:String(price),regular_price:String(reg),sale_price:String(sale)},
    images:image?[{src:image,thumbnail:image}]:[]};
}
function normalizeCategories(c){
  return Array.isArray(c)?c.map(x=>({...x,id:Number(x.id),name:String(x.name||''),slug:String(x.slug||''),image:x.image||x.image_url||'',count:Number(x.count||0)})):[];
}
function normalizeCart(c){
  const items=Array.isArray(c?.items)?c.items.map(i=>({
    id:Number(i.id),name:String(i.name||''),quantity:Math.max(0,Number(i.quantity??i.qty??0)),
    price:Number(i.price||0),regular_price:Number(i.regular_price||i.price||0),sale_price:Number(i.sale_price||0),
    image:i.image||'',description:plain(i.description||''),note:i.note||''
  })).filter(i=>i.id>0&&i.quantity>0):[];
  return {items};
}
function saveCart(){writeCache(CART_CACHE,state.cart,CART_TTL)}
function loadLocalCart(){const c=readCache(CART_CACHE);if(c)state.cart=normalizeCart(c)}
function saveNotes(){writeCache(NOTES_CACHE,state.notes,NOTES_TTL)}
function loadLocalNotes(){const c=readCache(NOTES_CACHE);if(c&&typeof c==='object')state.notes=c}

function cartItem(id){return state.cart.items.find(i=>Number(i.id)===Number(id))}
function cartCount(){return state.cart.items.reduce((s,i)=>s+Number(i.quantity||0),0)}
function cartTotal(){return state.cart.items.reduce((s,i)=>s+Number(i.price||0)*Number(i.quantity||0),0)}
function mergeProductIntoCart(product,delta){
  const id=Number(product.id),idx=state.cart.items.findIndex(i=>Number(i.id)===id);
  if(idx===-1&&delta>0){
    state.cart.items.push({
    id,
    name:product.name,
    quantity:delta,
    price:Number(product.price||0),
    regular_price:Number(product.regular_price||product.price||0),
    sale_price:Number(product.sale_price||0),
    image:product.image||'',
    description:plain(product.description||''),
    note:''
});
    return;
  }
  if(idx===-1)return;
  const next=state.cart.items[idx].quantity+delta;
  if(next<=0){state.cart.items.splice(idx,1);delete state.notes[id]}else state.cart.items[idx].quantity=next;
}
function setCartQuantity(id,q){
  id=Number(id);const idx=state.cart.items.findIndex(i=>Number(i.id)===id);if(idx===-1)return;
  q=Math.max(0,Number(q)||0);
  if(q===0){state.cart.items.splice(idx,1);delete state.notes[id]}else state.cart.items[idx].quantity=q;
}

async function xapi(endpoint,options={}){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),API_TIMEOUT);
  try{
    const method=String(options.method||'GET').toUpperCase();
    const res=await fetch(API+endpoint,{credentials:'same-origin',cache:method==='GET'?'default':'no-store',signal:ctrl.signal,...options,headers:{Accept:'application/json',...(options.headers||{})}});
    const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch(_){}
    if(!res.ok)throw new Error(data?.message||data?.code||'Xentra MVP API error');
    return data;
  }finally{clearTimeout(timer)}
}

function applyConfig(data){
  if(!data)return;
  if (data.brand && data.brand.primary_color) {
    document.documentElement.style.setProperty('--brand-color', data.brand.primary_color);
    document.documentElement.style.setProperty('--lime', data.brand.primary_color);
  }
  if (data.brand?.banners || data.banners) {
    renderCarousel(data.brand?.banners || data.banners);
  } else {
    renderCarousel();
  }

  state.promo={enabled:Boolean(data.promo?.enabled),target:Number(data.promo?.target||0),discount:Number(data.promo?.discount||0)};
  state.checkoutUrl=data.checkout_url||'/checkout/';
  state.minusIcon=data.icons?.minus||state.minusIcon;
  state.plusIcon=data.icons?.plus||state.plusIcon;
  state.cartIcon=data.icons?.cart||state.cartIcon;
  state.fileIcon=data.icons?.file||state.fileIcon;
  state.writeIcon=data.icons?.write||state.writeIcon;
  state.trashIcon=data.icons?.trash||state.trashIcon;
  state.bikeIcon=data.icons?.bike||state.bikeIcon;
  state.rightIcon=data.icons?.right1||state.rightIcon;
  state.discountIcon=data.icons?.diskon||state.discountIcon;
  state.couponIcon=data.icons?.coupon||state.couponIcon;
  const link=$('x-cart-checkout-link');if(link)link.href=state.checkoutUrl;
}

async function findMedia(filename){
  try{
    const name=filename.replace(/\.svg$/i,'');
    const res=await fetch(window.location.origin+'/wp-json/wp/v2/media?search='+encodeURIComponent(name)+'&per_page=20',{credentials:'same-origin',cache:'default'});
    if(!res.ok)return '';
    const media=await res.json();
    const exact=media.find(i=>(i?.source_url||'').split('/').pop().toLowerCase()===filename.toLowerCase());
    return exact?.source_url||media[0]?.source_url||'';
  }catch(_){return ''}
}
async function loadSheetIconsFallback(){
  const missing = [];
  if(!state.fileIcon)missing.push(['file.svg','fileIcon']);
  if(!state.writeIcon)missing.push(['write.svg','writeIcon']);
  if(!state.trashIcon)missing.push(['trash.svg','trashIcon']);
  if(!state.bikeIcon)missing.push(['bike.svg','bikeIcon']);
  if(!state.rightIcon)missing.push(['right1.svg','rightIcon']);
  if(!state.discountIcon)missing.push(['diskon.svg','discountIcon']);
  if(!state.couponIcon)missing.push(['coupon.svg','couponIcon']);
  if(!missing.length)return;

  const results=await Promise.all(
    missing.map(async ([filename,key])=>[key,await findMedia(filename)])
  );

  results.forEach(([key,url])=>{if(url)state[key]=url});
  if(state.products.length)renderProducts();
  if(cartCount())renderSheet();
}

function productCacheKey(cat){return PROD_CACHE+String(cat||'all')+'_1_12'}

function getRequestedCategorySlug(){
  try{
    const params=new URLSearchParams(window.location.search);
    return String(params.get('xentra_cat')||'').trim().toLowerCase();
  }catch(_){return ''}
}
function pickInitialCategory(){
  if(!state.categories.length)return null;
  const requestedSlug=getRequestedCategorySlug();
  if(requestedSlug){
    const match=state.categories.find(c=>String(c.slug||'').toLowerCase()===requestedSlug);
    if(match)return match;
  }
  return state.categories.find(c=>String(c.name).trim().toLowerCase()==='rekom')||state.categories[0];
}

function applyHomeData(data){
  if(!data||typeof data!=='object')return false;
  state.categories=normalizeCategories(data.categories);
  const items = Array.isArray(data.products?.items) 
    ? data.products.items 
    : (Array.isArray(data.all_products) ? data.all_products : (Array.isArray(data.products) ? data.products : []));
  state.products = items.map(normalizeProduct).filter(Boolean);

  applyConfig(data);
  const requestedSlug=getRequestedCategorySlug();
  if(!state.category&&state.categories.length){
    const first=pickInitialCategory();
    if(first)state.category=Number(first.id);
  }

  if(!state.products.length && state.categories.length && state.category){
    const activeCat = state.categories.find(c => Number(c.id) === Number(state.category));
    if(activeCat && Array.isArray(activeCat.products)){
      state.products = activeCat.products.map(normalizeProduct).filter(Boolean);
    }
  }

  renderCategories(false);
  if(requestedSlug && state.category){
    loadProducts(state.category);
  } else {
    renderProducts();
  }
  renderCart();
  return true;
}

async function fetchHomeFresh(){
  const data=await xapi('/home?per_page=12&page=1');
  writeCache(HOME_CACHE,data,MENU_TTL);
  return data;
}
function refreshHome(){fetchHomeFresh().then(applyHomeData).catch(e=>console.warn('[XENTRA HOME BG]',e))}
async function fallbackLegacyHome(){
  try{
    const res=await fetch(window.location.origin+'/wp-json/wc/store/v1/products/categories?per_page=100&hide_empty=true',{credentials:'same-origin',cache:'default'});
    if(!res.ok)throw new Error('Legacy categories failed');
    const cats=await res.json();
    state.categories=cats.filter(x=>Number(x.parent)===0).map(x=>({id:Number(x.id),name:x.name,slug:x.slug,image:x.image?.src||x.image?.thumbnail||'',count:Number(x.count||0)}));
    if(!state.category&&state.categories.length){
      const first=pickInitialCategory();
      if(first)state.category=Number(first.id);
    }
    renderCategories(false);await loadLegacyProducts(state.category);
  }catch(e){console.error('[XENTRA FALLBACK]',e);$('x-products').innerHTML='<div class="x-error">Menu gagal dimuat. Coba refresh halaman.</div>'}
}
async function loadLegacyProducts(category){
  try{
    const res=await fetch(window.location.origin+'/wp-json/wc/store/v1/products?per_page=12&status=publish&category='+encodeURIComponent(category),{credentials:'same-origin',cache:'default'});
    if(!res.ok)throw new Error('Legacy products failed');
    state.products=(await res.json()).map(normalizeProduct).filter(Boolean);renderProducts();
  }catch(e){console.error('[XENTRA LEGACY PRODUCTS]',e);$('x-products').innerHTML='<div class="x-error">Menu gagal dimuat. Coba refresh halaman.</div>'}
}

async function loadHome(){
  const cached=readCache(HOME_CACHE);
  if(cached){applyHomeData(cached);setTimeout(refreshHome,0);return}
  try{applyHomeData(await fetchHomeFresh())}
  catch(e){console.warn('[XENTRA HOME]',e);await fallbackLegacyHome()}
}

async function refreshProducts(category,renderAfter){
  const data=await xapi('/products?category='+encodeURIComponent(String(category||''))+'&page=1&per_page=12');
  writeCache(productCacheKey(category),data,MENU_TTL);
  const items=Array.isArray(data?.items)?data.items.map(normalizeProduct).filter(Boolean):[];
  if(Number(state.category)===Number(category)){state.products=items;if(renderAfter||items.length)renderProducts()}
}
async function loadProducts(category){
  const cached=readCache(productCacheKey(category));
  if(cached?.items){
    state.products=cached.items.map(normalizeProduct).filter(Boolean);renderProducts();setTimeout(()=>refreshProducts(category,false).catch(e=>console.warn('[XENTRA CAT BG]',e)),0);return;
  }
  $('x-products').innerHTML='<div class="x-loading">Memuat menu...</div>';
  try{await refreshProducts(category,true)}catch(e){console.warn('[XENTRA PRODUCTS]',e);await loadLegacyProducts(category)}
}

function defaultCategoryImage(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('rekom') || n.includes('semar') || n.includes('spesial')) {
    return 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png';
  }
  if (n.includes('ayam') || n.includes('bebek') || n.includes('utama')) {
    return 'https://app.mybangjo.com/wp-content/uploads/2026/08/New-Project.png';
  }
  if (n.includes('mie') || n.includes('bakso') || n.includes('nasi')) {
    return 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-11_28_14-AM.png';
  }
  if (n.includes('terlaris')) {
    return 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-Aug-3-2026-11_28_14-AM.png';
  }
  if (n.includes('minum') || n.includes('teh') || n.includes('jeruk') || n.includes('kopi')) {
    return 'https://app.mybangjo.com/wp-content/uploads/2026/08/kopijo.png';
  }
  if (n.includes('udang')) {
    return 'https://app.mybangjo.com/wp-content/uploads/2026/08/ChatGPT-Image-May-25-2026-01_57_13-PM.png';
  }
  return 'https://app.mybangjo.com/wp-content/uploads/2026/08/unnamed-7-2.png';
}

function renderCategories(loadSelected){
  const track=$('x-cat-track');if(!track)return;track.innerHTML='';
  if(!state.categories.length){track.innerHTML='<div class="x-empty">Kategori kosong.</div>';return}
  if(!state.category){
    const first=pickInitialCategory();
    if(first)state.category=Number(first.id)
  }
  state.categories.forEach(category=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='x-cat'+(Number(category.id)===Number(state.category)?' active':'');
    b.setAttribute('data-cat-id', String(category.id));
    b.setAttribute('data-cat-slug', String(category.slug || ''));
    const image=category.image || defaultCategoryImage(category.name);
    b.innerHTML=`<span class="x-cat-image">${image?`<img src="${esc(image)}" alt="${esc(category.name)}" loading="lazy">`:''}</span><span class="x-cat-name">${esc(category.name)}</span><span class="x-cat-line"></span>`;
    b.onclick=()=>{
      state.category=Number(category.id);
      document.querySelectorAll('.x-cat').forEach(el=>el.classList.remove('active'));
      b.classList.add('active');
      loadProducts(state.category);
    };
    track.appendChild(b);
  });
  if(loadSelected&&state.category)loadProducts(state.category);
}

function selectCategory(catIdOrSlug){
  if(!catIdOrSlug) return;
  const numId = Number(catIdOrSlug);
  const found = state.categories.find(c => {
    if (!isNaN(numId) && numId > 0 && Number(c.id) === numId) return true;
    const str = String(catIdOrSlug).toLowerCase().trim();
    return String(c.slug || '').toLowerCase() === str || String(c.name || '').toLowerCase() === str;
  });

  if(found){
    state.category = Number(found.id);
    renderCategories(false);
    loadProducts(state.category);
    setTimeout(()=>{
      const track = $('x-cat-track');
      if(track){
        const targetBtn = track.querySelector(`.x-cat[data-cat-id="${found.id}"]`) || track.querySelector(`.x-cat[data-cat-slug="${found.slug}"]`);
        if(targetBtn){
          track.querySelectorAll('.x-cat').forEach(el => el.classList.remove('active'));
          targetBtn.classList.add('active');
          targetBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
        const yOffset = -70;
        const y = track.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    }, 100);
  }
}
window.XentraSelectCategory = selectCategory;

function productPrices(p){return{current:Number(p?.price||p?.prices?.price||0),regular:Number(p?.regular_price||p?.prices?.regular_price||p?.price||0),sale:Number(p?.sale_price||p?.prices?.sale_price||0)}}

function renderProducts(){
  const container=$('x-products');if(!container)return;container.innerHTML='';
  if(!state.products.length){container.innerHTML='<div class="x-empty">Tidak ada menu di kategori ini.</div>';return}
  state.products.forEach(product=>{
    const prices=productPrices(product),image=product.image||product.images?.[0]?.src||'',description=plain(product.description||product.short_description||'');
    const item=cartItem(product.id),quantity=item?Number(item.quantity):0,note=state.notes[product.id]||'';
    const discountEligible =
    state.promo.enabled &&
    state.promo.target > 0 &&
    state.promo.discount > 0 &&
    item &&
    (Number(item.price) * Number(item.quantity)) >= state.promo.target;
    const card=document.createElement('article');card.className='x-product';
    const oldPrice=prices.sale>0&&prices.regular>prices.sale?`<div class="x-old-price">${money(prices.regular)}</div>`:'';
    let controls='';
    if(quantity>0){
      const noteIcon=note?(state.writeIcon||state.fileIcon):(state.fileIcon||state.writeIcon);
      controls=`<div class="x-quantity">
        <button type="button" data-minus="${product.id}">${state.minusIcon?`<img src="${esc(state.minusIcon)}" alt="minus">`:'−'}</button>
        <span class="x-quantity-value">${quantity}</span>
        <button type="button" data-plus="${product.id}">${state.plusIcon?`<img src="${esc(state.plusIcon)}" alt="plus">`:'＋'}</button>
      </div>
      <button type="button" class="x-note-button ${note?'has-note':''}" data-note="${product.id}">
        ${noteIcon?`<img src="${esc(noteIcon)}" alt="Catatan" class="x-note-icon">`:''}
        Catatan
      </button>`;
    }else controls=`<button type="button" class="x-add" data-add="${product.id}">Tambah</button>`;
    card.innerHTML=`<div class="x-product-info"><div class="x-product-name">${esc(product.name)}</div><div class="x-product-description">${esc(description)}</div><div class="x-price">${oldPrice}<div class="x-current-price">${money(prices.current)}</div></div>${discountEligible ? `
<div class="x-product-discount">
  ${state.discountIcon ? `
    <img 
      src="${esc(state.discountIcon)}"
      alt="Diskon"
      class="x-product-discount-icon"
    >
  ` : ''}

  <span>
    Discount ongkir ${shortDiscount(state.promo.discount)}
  </span>
</div>
` : ''}</div>
    <div class="x-product-right">${image?`<img class="x-product-image" src="${esc(image)}" alt="${esc(product.name)}" loading="lazy">`:''}${controls}</div>`;
    container.appendChild(card);
  });
  bindProductEvents();
}

function bindProductEvents(){
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const p=state.products.find(x=>Number(x.id)===Number(b.dataset.add));if(!p)return;mergeProductIntoCart(p,1);saveCart();renderProducts();renderCart()});
  document.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{const i=cartItem(b.dataset.plus);if(!i)return;i.quantity+=1;saveCart();renderProducts();renderCart()});
  document.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{const id=Number(b.dataset.minus);const i=cartItem(id);if(!i)return;setCartQuantity(id,Number(i.quantity)-1);saveCart();saveNotes();renderProducts();renderCart()});
  document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>openNote(b.dataset.note));
}

function renderCart(){
  const count=cartCount(),total=cartTotal();
  if(count<=0){$('x-cart-dock').classList.remove('visible');closeSheet();return}
  $('x-cart-dock').classList.add('visible');$('x-cart-count').textContent=`${count} Item`;$('x-cart-total').textContent=moneyPlain(total);$('x-cart-badge').textContent=count;
  if($('x-cart-icon')&&state.cartIcon)$('x-cart-icon').src=state.cartIcon;
  
  if($('x-promo-icon-img')){
  $('x-promo-icon-img').src =
  '/wp-content/plugins/xentra-mvp/assets/icons/coupon.svg';
}
  if(state.promo.enabled&&state.promo.target>0){
    $('x-promo').style.display='';
    $('x-progress-fill').style.width=Math.min(100,total/state.promo.target*100)+'%';
    $('x-promo-text').innerHTML=total<state.promo.target?`Tambah <strong>${money(state.promo.target-total)}</strong> lagi biar diskon <strong>${money(state.promo.discount)}</strong>!`:'🎉 Selamat, kamu berhasil dapatkan diskon!';
  }else $('x-promo').style.display='none';
  renderSheet()
}
function shortDiscount(v){
  const n=Number(v)||0;
  if(n>=1000 && n%1000===0)return `${n/1000}rb`;
  return moneyPlain(n);
}

function summaryDiscount(){
  if(!state.promo.enabled || state.promo.target<=0 || state.promo.discount<=0)return 0;
  return cartTotal()>=state.promo.target ? Math.min(state.promo.discount,cartTotal()) : 0;
}

function renderSheet(){
  const c=$('x-sheet-items');if(!c)return;c.innerHTML='';
  const items=state.cart.items||[];
  items.forEach(item=>{
    const note=state.notes[item.id]||'';
    const lineTotal=Number(item.price||0)*Number(item.quantity||0);
    const row=document.createElement('div');
    row.className='x-sheet-item';
    const image=item.image||'';
    const noteHtml=note && state.writeIcon ? `<div class="x-sheet-item-note" data-edit-note="${item.id}"><img src="${esc(state.writeIcon)}" alt="Edit catatan"><span>: ${esc(note)}</span></div>` : '';
    const cardPromoEligible=
      state.promo.enabled &&
      state.promo.target>0 &&
      state.promo.discount>0 &&
      lineTotal>=state.promo.target;

    const promoHtml=cardPromoEligible
      ? `<div class="x-sheet-item-discount"><img src="${esc(state.discountIcon||'')}" alt=""><span>Discount ongkir ${esc(shortDiscount(state.promo.discount))}</span></div>`
      : '';
    row.innerHTML=`
      <div class="x-sheet-item-main">
        ${image?`<img class="x-sheet-item-image" src="${esc(image)}" alt="${esc(item.name)}">`:`<div class="x-sheet-item-image"></div>`}
        <div class="x-sheet-item-body">
          <div class="x-sheet-item-name">${esc(item.name)}</div>
          ${noteHtml}
          ${promoHtml}
          <div class="x-sheet-item-qty-price">${item.quantity} × ${money(item.price||0)}</div>
        </div>
        <button type="button" class="x-sheet-item-delete" data-delete="${item.id}" aria-label="Hapus ${esc(item.name)}">
          ${state.trashIcon?`<img src="${esc(state.trashIcon)}" alt="Hapus">`:''}
        </button>
      </div>
      <div class="x-sheet-item-footer" data-single-checkout="${item.id}">
        <div class="x-sheet-item-footer-left">
          ${state.bikeIcon?`<img class="x-bike-icon" src="${esc(state.bikeIcon)}" alt="">`:''}
          <span>${item.quantity} item</span>
        </div>
        <div class="x-sheet-item-footer-right">
          <strong>${moneyPlain(lineTotal)}</strong>
          ${state.rightIcon?`<img class="x-arrow-icon" src="${esc(state.rightIcon)}" alt=">">`:''}
        </div>
      </div>`;
    c.appendChild(row);
  });

  const subtotal=cartTotal();
  const discount=summaryDiscount();
  const deliveryKnown=Number.isFinite(Number(state.deliveryFee));
  const delivery=deliveryKnown?Number(state.deliveryFee):0;
  const total=subtotal+delivery-discount;
  const summary = document.querySelector('.x-sheet-total');
  if (summary) summary.innerHTML=`
    <div class="x-sheet-summary-title">Ringkasan Pembayaran</div>
    <div class="x-sheet-summary-card">
      <div class="x-sheet-summary-row"><span class="label">Harga</span><span class="value">${moneyPlain(subtotal)}</span></div>
      <div class="x-sheet-summary-row"><span class="label">Biaya Penanganan dan Pengiriman</span><span class="value" id="x-delivery-summary-value" style="color:${deliveryKnown?'#999':'#ff4040'}">${deliveryKnown?moneyPlain(delivery):'Belum dihitung'}</span></div>
      <div class="x-sheet-summary-row discount"><span class="label">Diskon</span><span class="value">-${moneyPlain(discount)}</span></div>
      <div class="x-sheet-summary-divider"></div>
      <div class="x-sheet-summary-total"><span class="label">Total pembayaran</span><span class="value">${moneyPlain(total)}</span></div>
    </div>
    <button id="x-checkout" class="x-sheet-checkout">Lanjut Checkout</button>`;

  c.querySelectorAll('[data-delete]').forEach(btn=>{
    btn.onclick=(e)=>{
      e.stopPropagation();
      const id=Number(btn.dataset.delete);
      const item=cartItem(id);
      if(!item)return;
      //if(!window.confirm('Hapus belanjaan ini dari keranjang Bangjo?'))return;
      //setCartQuantity(id,0);saveCart();saveNotes();renderProducts();renderCart();
    
        openDeleteConfirm(id);
return;
        
    };
  });
  c.querySelectorAll('[data-edit-note]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      openNote(Number(el.dataset.editNote));
    };
  });
  c.querySelectorAll('[data-single-checkout]').forEach(el=>{
    el.onclick=()=>goSingleCheckout(Number(el.dataset.singleCheckout));
  });
  $('x-checkout').onclick=goCheckout;
  if($('x-sheet-total-value'))$('x-sheet-total-value').textContent=moneyPlain(total);
}


function openDeleteConfirm(id){

  const old=document.getElementById('x-delete-confirm');
  if(old) old.remove();

  const box=document.createElement('div');

  box.id='x-delete-confirm';

  box.innerHTML=`
    <div class="x-delete-backdrop"></div>

    <div class="x-delete-sheet">

      <button class="x-delete-close">×</button>

      <div class="x-delete-title">
        Hapus belanjaan ini dari keranjang?
      </div>

      <button class="x-delete-btn">
        Iya, hapus
      </button>

    </div>
  `;


  document.body.appendChild(box);


  box.querySelector('.x-delete-btn').onclick=()=>{

    setCartQuantity(id,0);
    saveCart();
    saveNotes();
    renderProducts();
    renderCart();

    box.remove();

  };


  box.querySelector('.x-delete-close').onclick=()=>{
    box.remove();
  };


  box.querySelector('.x-delete-backdrop').onclick=()=>{
    box.remove();
  };

}


function openSheet(){

  if(cartCount()<=0)return;

  $('x-sheet').classList.add('open');
  $('x-backdrop').classList.add('open');

  window.XentraNav.pushClose(closeSheet);

  document.body.style.overflow = 'hidden';
}


function closeSheet(){

  $('x-sheet').classList.remove('open');
  $('x-backdrop').classList.remove('open');

  document.body.style.overflow = '';
}

$('x-cart-button').onclick=openSheet;
$('x-backdrop').onclick=()=>window.XentraNav.close();


document.addEventListener('click', function(e){

  const closeButton =
    e.target.closest('[data-close="1"]');

  if(!closeButton) return;

  window.XentraNav.close();

});


let sheetTouchStartY = 0;
let sheetTouchEndY = 0;


$('x-sheet').addEventListener('touchstart', e=>{
  sheetTouchStartY = e.touches[0].clientY;
},{passive:true});


$('x-sheet').addEventListener('touchend', e=>{

  sheetTouchEndY = e.changedTouches[0].clientY;

  const distance = sheetTouchStartY - sheetTouchEndY;


  // swipe turun tutup sheet
  if(distance < -60){
    window.XentraNav.close();
  }


},{passive:true});

let noteStartY=0,noteCurrentY=0;
function portalNoteSheet(){const o=$('x-note-overlay');if(o&&o.parentElement!==document.body)document.body.appendChild(o)}
function updateNoteViewport(){
  const o=$('x-note-overlay'),s=$('x-note-sheet');if(!o||!s)return;
  const v=window.visualViewport;if(!v){s.style.setProperty('--x-note-keyboard','0px');s.style.setProperty('--x-note-visible-height','75vh');return}
  const kh=Math.max(0,window.innerHeight-(v.offsetTop+v.height));s.style.setProperty('--x-note-keyboard',kh+'px');s.style.setProperty('--x-note-visible-height',v.height+'px')
}
function updateNoteCounter(){$('x-note-counter').textContent=`${$('x-note-input').value.length}/200`}
function openNote(productId){
  portalNoteSheet();
  const numId = Number(productId);
  state.noteProduct = numId;
  window.xentraActiveNoteProductId = numId;
  $('x-note-input').value = state.notes[numId] || '';
  updateNoteCounter();

  const o = $('x-note-overlay');
  const s = $('x-note-sheet');
  if(s){
    s.style.setProperty('--x-note-keyboard','0px');
    s.style.setProperty('--x-note-visible-height','75dvh');
  }

  window.XentraNav.pushClose(closeNote);
  void (s || o).offsetHeight;
  requestAnimationFrame(()=>{
    o.classList.add('open');
  });
  setTimeout(()=>{
    $('x-note-input').focus();
    updateNoteViewport();
  },350);
}
window.openHomeNote = openNote;

function closeNote(){
  const o = $('x-note-overlay');
  const s = $('x-note-sheet');
  const input = $('x-note-input');
  if(!o) return;
  if(input) input.blur();
  o.classList.remove('open');
  setTimeout(()=>{
    if(s){
      s.style.setProperty('--x-note-keyboard','0px');
      s.style.setProperty('--x-note-visible-height','75dvh');
    }
  },380);
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',updateNoteViewport);
  window.visualViewport.addEventListener('scroll',updateNoteViewport);
}
window.addEventListener('resize',updateNoteViewport);
$('x-note-input').addEventListener('input',updateNoteCounter);

function handleNoteSave(){
  const id = Number(state.noteProduct || window.xentraActiveNoteProductId || 0);
  if(!id) {
    window.XentraNav.close();
    return;
  }
  const input = $('x-note-input');
  const v = input ? input.value.trim() : '';

  if(v) state.notes[id] = v;
  else delete state.notes[id];
  saveNotes();

  const item = cartItem(id);
  if(item) {
    item.note = v;
    saveCart();
  }

  if(typeof window.xentraOnNoteSaved === 'function'){
    try { window.xentraOnNoteSaved(id, v); } catch(e){ console.warn(e); }
  }

  window.XentraNav.close();
  renderProducts();
  renderSheet();
}

$('x-note-save').onclick = handleNoteSave;
$('x-note-overlay').addEventListener('click',e=>{if(e.target===$('x-note-overlay'))window.XentraNav.close()});
$('x-note-sheet').addEventListener('touchstart',e=>{noteStartY=e.touches[0].clientY;noteCurrentY=noteStartY},{passive:true});
$('x-note-sheet').addEventListener('touchmove',e=>{noteCurrentY=e.touches[0].clientY},{passive:true});
$('x-note-sheet').addEventListener('touchend',()=>{if(noteCurrentY-noteStartY>60)window.XentraNav.close()},{passive:true});
portalNoteSheet();

let _xentraCheckoutAssetsPromise = null;

function loadCheckoutAssets(){

  _xentraCheckoutAssetsPromise = null;

  const urls =
    (window.XentraConfig && window.XentraConfig.checkoutAssets) || {};

  _xentraCheckoutAssetsPromise = new Promise((resolve, reject)=>{

    if(urls.css){
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = urls.css;
      document.head.appendChild(link);
    }

    if(typeof window.XentraMountCheckout === 'function'){
  window.XentraMountCheckout = undefined;
}

    const loadScript = (src)=>new Promise((res, rej)=>{
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = ()=>rej(new Error('Gagal memuat komponen checkout.'));
      document.head.appendChild(s);
    });

    (urls.locationJs ? loadScript(urls.locationJs) : Promise.resolve())
      .then(()=> urls.checkoutJs ? loadScript(urls.checkoutJs) : Promise.resolve())
      .then(resolve)
      .catch(reject);
  });

  return _xentraCheckoutAssetsPromise;
}

async function prepareCheckout(mode, items){
  if(state.syncing)return false;
  if(!items || !items.length)return false;

  state.syncing=true;

  try{

    /*
     * LOCKED SXP ARCHITECTURE
     *
     * HomeV owns the browser cart.
     * Xentra /checkout/prepare is the single server call that:
     * - validates live product availability
     * - validates stock
     * - resolves live price
     * - creates the Xentra checkout session
     *
     * WooCommerce add_to_cart is intentionally NOT called here.
     * WooCommerce remains the final order/payment engine at submit time.
     */
    const session = await fetch(
      '/wp-json/xentra/v1/checkout/prepare',
      {
        method:'POST',
        credentials:'same-origin',
        headers:{
          'Content-Type':'application/json',
          'Accept':'application/json'
        },
        body:JSON.stringify({
          mode:mode,
          items:items
        })
      }
    );


    let data = null;

    try{
      data = await session.json();
    }catch(_){
      throw new Error('Respons server tidak valid.');
    }


    if(!session.ok || !data || !data.success){

      const errors =
        Array.isArray(data?.errors)
          ? data.errors
          : [];

      const message =
        errors.length
          ? errors.map(e=>e.message).filter(Boolean).join('\n')
          : (
              data?.message ||
              'Pesanan tidak dapat diproses.'
            );

      throw new Error(message);
    }



    async function mountCheckoutState(checkoutUrl){

      const host = $('xentra-checkout-state');
      const homeApp = $('xentra-menu-app');

      if(!host || !homeApp){
        throw new Error('Checkout shell tidak ditemukan.');
      }

      host.innerHTML =
        '<div style="min-height:100%;display:flex;align-items:center;justify-content:center;font-family:Plus Jakarta Sans,sans-serif;color:#777;">Memuat checkout...</div>';

      host.style.display = 'block';
      homeApp.style.display = 'none';
      document.body.style.overflow = 'hidden';

      try{

        /*
         * Fetch the checkout markup/session AND lazy-load checkout.js
         * (~93KB, previously loaded on every single Home visit) at the
         * same time - opening Checkout is the only moment either is
         * needed, and running them in parallel costs nothing extra.
         */
        const [response] = await Promise.all([
          fetch(
            checkoutUrl,
            {
              credentials:'same-origin',
              headers:{Accept:'text/html'}
            }
          ),
          loadCheckoutAssets()
        ]);

        if(!response.ok){
          throw new Error('Checkout gagal dimuat.');
        }

        const html = await response.text();

        const doc =
          new DOMParser().parseFromString(
            html,
            'text/html'
          );

        const app =
          doc.getElementById(
            'xentra-checkout-app'
          );

        if(!app){
          throw new Error(
            'Tampilan checkout tidak ditemukan.'
          );
        }

        const sessionScript =
          Array.from(
            doc.querySelectorAll('script')
          ).find(function(script){
            return String(
              script.textContent || ''
            ).indexOf(
              'window.XentraCheckoutSession'
            ) !== -1;
          });

        if(!sessionScript){
          throw new Error(
            'Session checkout tidak ditemukan.'
          );
        }

        const match =
          String(sessionScript.textContent || '')
            .match(
              /window\.XentraCheckoutSession\s*=\s*(\{[\s\S]*\});?/
            );

        if(!match || !match[1]){
          throw new Error(
            'Data session checkout tidak valid.'
          );
        }

        let checkoutSession;

        try{
          checkoutSession =
            JSON.parse(match[1]);
        }catch(_){
          throw new Error(
            'Data session checkout tidak valid.'
          );
        }

        checkoutStateActive = true;

        /*
         * Checkout is one top-level HomeV overlay/state, tracked by the
         * shared XentraNav stack - exactly one history entry per layer,
         * closed the same way whether by gesture, hardware Back, or the
         * in-app arrow (all funnel through history.back()).
         */
        window.XentraNav.pushClose(returnToHomeState);

        host.innerHTML =
          app.outerHTML;

        if(
          typeof window.XentraMountCheckout !==
          'function'
        ){
          throw new Error(
            'Checkout runtime belum siap.'
          );
        }

        window.XentraMountCheckout(
          checkoutSession
        );

        /*
         * Checkout header back is a state action, not browser
         * navigation. Use delegation so it works regardless of
         * whether the fetched Checkout HTML uses an <a> or <button>.
         */
        host.addEventListener(
          'click',
          function(event){

            const target =
              event.target.closest(
                '.x-header a, .x-header button, [aria-label="Kembali"]'
              );

            if(!target){
              return;
            }

            const label =
              (
                target.getAttribute('aria-label') ||
                target.textContent ||
                ''
              )
                .replace(/\s+/g,' ')
                .trim()
                .toLowerCase();

            if(
              label !== 'kembali' &&
              !target.closest('.x-header')
            ){
              return;
            }

            event.preventDefault();
            event.stopPropagation();

            var openOverlays = document.querySelectorAll('.x-overlay,.xentra-dynamic-overlay,.x-del-overlay');
            if(openOverlays && openOverlays.length){
              openOverlays.forEach(function(o){
                if(typeof o.__xentraClose === 'function'){
                  o.__xentraClose();
                } else {
                  o.remove();
                }
              });
            }

            returnToHomeState();

          },
          true
        );

      }catch(error){

        if(checkoutStateActive){

          checkoutStateActive =
            false;

          history.back();
        }

        host.style.display =
          'none';

        host.innerHTML =
          '';

        homeApp.style.display =
          '';

        document.body.style.overflow =
          '';

        throw error;
      }
    }

    /*
     * Close Checkout as a top-level HomeV overlay.
     */
    function returnToHomeState(){

      const host =
        $('xentra-checkout-state');

      const homeApp =
        $('xentra-menu-app');

      if(!host || !homeApp){
        return;
      }

      host.style.display =
        'none';

      host.innerHTML =
        '';

      homeApp.style.display =
        '';

      document.body.style.overflow =
        '';

      checkoutStateActive =
        false;

      renderCart();

      var pendingCat = window.__xentraPendingCategory;
      if(pendingCat){
        window.__xentraPendingCategory = null;
        setTimeout(function(){
          selectCategory(pendingCat);
        }, 50);
      }
    }

    /*
     * Browser Back / gesture / hardware key, and every in-app close
     * control, all funnel through the shared XentraNav stack now -
     * no bespoke popstate handling needed here any more. Whatever was
     * opened last (a Checkout dynamic sheet, the order-note sheet, or
     * the Checkout state itself) is exactly what gets closed first.
     */

    await mountCheckoutState(
      data.checkout_url
    );

    return true;

  }catch(error){

    console.error(
      '[XENTRA SXP]',
      error
    );

    alert(
      error.message ||
      'Gagal menyiapkan checkout.'
    );

    return false;

  }finally{

    state.syncing=false;
  }
}

async function goCheckout(){
  if(cartCount()<=0||state.syncing)return;
  return prepareCheckout('all',state.cart.items);
}
async function goSingleCheckout(productId){
  const item=cartItem(productId);
  if(!item||state.syncing)return;
  return prepareCheckout('single',[item]);
}
$('x-cart-checkout-link').addEventListener('click',e=>{e.preventDefault();goCheckout()});

/* =========================================================
   PWA INSTALLER (ANDROID & IOS)
   ========================================================= */
function initPwaInstaller() {
  // Floating info install banner temporarily hidden as requested
  return;
}

async function init(){
  initLiveClock();
  loadLocalCart();
  loadLocalNotes();
  renderCart();

  await loadHome();

  renderCart();
  loadSheetIconsFallback();
  initPwaInstaller();
}
init();

window.addEventListener('pageshow', function () {
  loadLocalCart();
  loadLocalNotes();
  renderProducts();
  renderCart();
});

})();
