/* XENTRA POS — standalone cashier execution surface */
(function () {
  'use strict';

  var API = '/api/v1';
  var TOKEN_KEY = 'xentra_merchant_token';
  var USER_KEY = 'xentra_merchant_user';
  var POS_PIN_CACHE_KEY = 'xentra_pos_pin_cache_v1';
  var POS_MENU_CACHE_PREFIX = 'xentra_pos_menu_cache_v1:';
  var POS_SHIFT_CACHE_PREFIX = 'xentra_pos_shift_cache_v1:';
  var state = {
    user: null,
    branchId: null,
    shift: null,
    menu: { categories: [], products: [] },
    category: 'all',
    search: '',
    orderType: 'dine_in',
    selectedTable: null,
    cart: [],
    held: [],
    sales: [],
    terminalId: localStorage.getItem('xentra_pos_terminal_id') || null,
    paymentModes: [],
    activePaymentMode: 'cash',
    offlineMode: false
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function money(n) { return 'Rp' + Number(n || 0).toLocaleString('id-ID'); }
  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function headers() {
    var h = { 'Content-Type': 'application/json' };
    if (token()) h.Authorization = 'Bearer ' + token();
    return h;
  }
  function user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (_) { return null; }
  }
  async function request(path, options) {
    var res = await fetch(API + path, options || { headers: headers() });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); window.location.replace('/login'); throw new Error('SESSION_EXPIRED');
    }
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) throw new Error(data.error || data.message || 'Permintaan gagal.');
    return data;
  }
  function toast(msg) {
    var el = $('pos-toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function(){ el.classList.remove('show'); }, 2200);
  }
  function setConnection(online) {
    var el=$('pos-connection-badge'); if(!el)return;
    el.textContent=online?'ONLINE':'OFFLINE'; el.className='pos-status '+(online?'online':'offline');
  }

  function renderShiftStatus() {
    var text=$('pos-shift-status-text'), dot=$('pos-shift-status-dot'), btn=$('btn-pos-shift-status');
    if(!text || !dot || !btn) return;
    if(!state.shift) {
      text.textContent='Shift belum dibuka';
      dot.className='pos-shift-dot';
      btn.className='pos-shift-status';
      btn.title='Buka shift';
      var closeBtn=$('btn-pos-close-shift-top');
      if(closeBtn) closeBtn.style.display='none';
      return;
    }
    var onBreak=!!state.shift.active_break;
    text.textContent=onBreak?'Istirahat':'Shift Aktif';
    dot.className='pos-shift-dot '+(onBreak?'break':'active');
    btn.className='pos-shift-status '+(onBreak?'break':'active');
    btn.title=onBreak?'Kembali bertugas':'Mulai istirahat';
    var closeBtn=$('btn-pos-close-shift-top');
    if(closeBtn) closeBtn.style.display='inline-flex';
  }

  function getPosPinProfiles() {
    try {
      var raw=JSON.parse(localStorage.getItem(POS_PIN_CACHE_KEY) || 'null');
      if (!raw) return {};
      // Migrate the first single-profile implementation to the multi-cashier cache.
      if (raw.user && raw.offline_credential) {
        var migrated={}; migrated[String(raw.user.id)]=raw; return migrated;
      }
      return raw.profiles && typeof raw.profiles==='object' ? raw.profiles : {};
    } catch (_) { return {}; }
  }

  function savePosPinCache(userData, credential, branchId) {
    if (!userData || !userData.id || !credential || !credential.salt || !credential.hash || !branchId) return;
    var profiles=getPosPinProfiles();
    profiles[String(userData.id)]={
      user:{
        id:userData.id,
        username:userData.username,
        email:userData.email || null,
        full_name:userData.full_name || userData.username || 'Kasir',
        role:'cashier',
        branch_id:branchId
      },
      branch_id:branchId,
      offline_credential:credential,
      cached_at:new Date().toISOString()
    };
    try { localStorage.setItem(POS_PIN_CACHE_KEY,JSON.stringify({version:1,profiles:profiles})); } catch (_) {}
    localStorage.setItem('xentra_pos_branch_id',String(branchId));
  }

  function getCachedPinProfilesForBranch(branchId) {
    var profiles=getPosPinProfiles();
    return Object.keys(profiles).map(function(id){return profiles[id];}).filter(function(profile){
      return profile && profile.branch_id && String(profile.branch_id)===String(branchId) && profile.offline_credential && profile.user;
    });
  }

  function savePosMenuCache() {
    if (!state.branchId || !state.menu) return;
    try { localStorage.setItem(POS_MENU_CACHE_PREFIX + state.branchId, JSON.stringify({ saved_at: new Date().toISOString(), menu: state.menu })); } catch (_) {}
  }

  function getPosMenuCache(branchId) {
    if (!branchId) return null;
    try {
      var entry=JSON.parse(localStorage.getItem(POS_MENU_CACHE_PREFIX + branchId) || 'null');
      return entry && entry.menu ? entry.menu : null;
    } catch (_) { return null; }
  }

  function savePosShiftCache() {
    if (!state.user || !state.user.id) return;
    try { localStorage.setItem(POS_SHIFT_CACHE_PREFIX + state.user.id, JSON.stringify({ saved_at: new Date().toISOString(), shift: state.shift || null })); } catch (_) {}
  }

  function getPosShiftCache(userId) {
    if (!userId) return null;
    try {
      var entry=JSON.parse(localStorage.getItem(POS_SHIFT_CACHE_PREFIX + userId) || 'null');
      return entry ? entry.shift : null;
    } catch (_) { return null; }
  }

  function base64FromBytes(bytes) {
    var binary='';
    for (var i=0;i<bytes.length;i++) binary+=String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function bytesFromBase64(value) {
    var binary=atob(value);
    var out=new Uint8Array(binary.length);
    for (var i=0;i<binary.length;i++) out[i]=binary.charCodeAt(i);
    return out;
  }

  async function verifyOfflinePin(pin, credential) {
    if (!credential || !window.crypto || !window.crypto.subtle || !window.TextEncoder) return false;
    if (!/^\d{6}$/.test(String(pin || ''))) return false;
    try {
      var key=await crypto.subtle.importKey('raw',new TextEncoder().encode(String(pin)),{name:'PBKDF2'},false,['deriveBits']);
      var bits=await crypto.subtle.deriveBits({
        name:'PBKDF2',
        salt:bytesFromBase64(credential.salt),
        iterations:Number(credential.iterations || 210000),
        hash:credential.digest || 'SHA-256'
      },key,Number(credential.key_length || 32)*8);
      return base64FromBytes(new Uint8Array(bits))===credential.hash;
    } catch (_) { return false; }
  }

  async function requestWithTimeout(path, options, timeoutMs) {
    var opts=options||{};
    var controller=window.AbortController ? new AbortController() : null;
    if (controller) opts.signal=controller.signal;
    var timer=null;
    try {
      var timeoutPromise=new Promise(function(_,reject){
        timer=setTimeout(function(){
          if (controller) controller.abort();
          var err=new Error('NETWORK_TIMEOUT'); err.code='NETWORK_TIMEOUT'; reject(err);
        },timeoutMs || 1800);
      });
      var fetchPromise=fetch(API+path,opts).then(async function(res){
        var data=await res.json().catch(function(){return {};});
        if (!res.ok) {
          var err=new Error(data.error || data.message || 'Permintaan gagal.');
          err.code=data.code || (res.status===401?'UNAUTHORIZED':'HTTP_ERROR');
          err.status=res.status;
          throw err;
        }
        return data;
      });
      return await Promise.race([fetchPromise,timeoutPromise]);
    } catch (err) {
      if (err && err.name==='AbortError') {
        var timeoutErr=new Error('NETWORK_TIMEOUT'); timeoutErr.code='NETWORK_TIMEOUT'; throw timeoutErr;
      }
      throw err;
    } finally { if (timer) clearTimeout(timer); }
  }

  function applyCashierUser(userData) {
    state.user=userData;
    state.branchId=userData.branch_id || userData.branchId || null;
    if(state.branchId) localStorage.setItem('xentra_pos_branch_id',String(state.branchId));
    if ($('pos-branch-name')) $('pos-branch-name').textContent=userData.branch_name || state.branchId || 'Cabang';
    if ($('pos-cashier-name')) $('pos-cashier-name').textContent=userData.full_name || userData.username || 'Kasir';
  }

  function showPosAuthGate(offlineReason) {
    var gate=$('pos-auth-gate'); if(!gate) return;
    var badge=$('pos-auth-badge'), subtitle=$('pos-auth-subtitle'), input=$('pos-login-pin'), error=$('pos-pin-login-error');
    if(offlineReason){
      badge.textContent='OFFLINE / PIN TERSIMPAN'; badge.className='pos-auth-badge offline';
      subtitle.textContent='Koneksi ke Core tidak tersedia atau terlalu lambat. Masukkan PIN POS untuk membuka salah satu kasir yang sudah pernah digunakan di terminal ini.';
    }else{
      badge.textContent='PIN Kasir'; badge.className='pos-auth-badge';
      subtitle.textContent='Masukkan PIN 6 digit untuk masuk cepat ke akun Kasir.';
    }
    if(error) error.textContent='';
    if(input){input.value='';setTimeout(function(){input.focus();},50);}
    gate.style.display='flex';
  }

  function hidePosAuthGate(){var gate=$('pos-auth-gate');if(gate)gate.style.display='none';}

  async function onlinePinLogin(pin) {
    var branchId=state.branchId || localStorage.getItem('xentra_pos_branch_id') || null;
    var terminalId=state.terminalId || localStorage.getItem('xentra_pos_terminal_id') || null;
    if(!branchId || !terminalId){
      var err=new Error('Terminal POS belum memiliki konteks cabang. Masuk menggunakan akun Xentra terlebih dahulu.'); err.code='POS_CONTEXT_REQUIRED'; throw err;
    }
    return requestWithTimeout('/auth/pos/pin',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({branch_id:branchId,terminal_id:terminalId,pin:String(pin||'')})
    },1800);
  }

  async function unlockWithPin(pin) {
    var branchId=state.branchId || localStorage.getItem('xentra_pos_branch_id') || null;
    if(!branchId){
      var contextErr=new Error('Konteks cabang POS belum tersimpan. Masuk menggunakan akun Xentra terlebih dahulu.'); contextErr.code='POS_CONTEXT_REQUIRED'; throw contextErr;
    }

    if(navigator.onLine){
      try{
        var online=await onlinePinLogin(pin);
        localStorage.setItem(TOKEN_KEY,online.token);
        localStorage.setItem(USER_KEY,JSON.stringify(online.user));
        state.offlineMode=false;
        applyCashierUser(online.user);
        if(online.offline_credential) savePosPinCache(online.user,online.offline_credential,branchId);
        return {online:true};
      }catch(err){
        // Only network/timeout failures may fall back to the locally cached verifier.
        if(err && err.status) throw err;
        if(err && err.code && err.code!=='NETWORK_TIMEOUT') throw err;
      }
    }

    var profiles=getCachedPinProfilesForBranch(branchId);
    for(var i=0;i<profiles.length;i++){
      var valid=await verifyOfflinePin(pin,profiles[i].offline_credential);
      if(!valid) continue;
      state.offlineMode=true;
      applyCashierUser(profiles[i].user);
      state.terminalId=localStorage.getItem('xentra_pos_terminal_id') || null;
      state.menu=getPosMenuCache(state.branchId) || {categories:[],products:[]};
      state.shift=getPosShiftCache(state.user.id);
      localStorage.setItem(USER_KEY,JSON.stringify(state.user));
      return {online:false};
    }

    var invalid=new Error('PIN Kasir salah atau belum pernah didaftarkan pada terminal ini.'); invalid.code='INVALID_OFFLINE_POS_PIN'; throw invalid;
  }

  function openPinUnlockGate(offlineReason) {
    return new Promise(function(resolve,reject){
      showPosAuthGate(offlineReason);
      var form=$('pos-pin-login-form'), input=$('pos-login-pin'), error=$('pos-pin-login-error'), btn=$('btn-pos-pin-login');
      if (!form) return reject(new Error('POS PIN form tidak tersedia.'));
      form.onsubmit=async function(e){
        e.preventDefault();
        var pin=(input ? input.value : '').trim();
        if (!/^\d{6}$/.test(pin)) { if(error) error.textContent='Masukkan PIN 6 digit.'; return; }
        if (btn) { btn.disabled=true; btn.textContent='Memverifikasi...'; }
        try {
          var result=await unlockWithPin(pin);
          hidePosAuthGate();
          if (btn) { btn.disabled=false; btn.textContent='Masuk dengan PIN'; }
          resolve(result);
        } catch (err) {
          if (error) error.textContent=err.message || 'PIN tidak valid.';
          if (input) { input.value=''; input.focus(); }
          if (btn) { btn.disabled=false; btn.textContent='Masuk dengan PIN'; }
        }
      };
      var googleBtn=$('btn-pos-google-login');
      if (googleBtn) googleBtn.onclick=function(){
        var returnUrl=window.location.origin + '/pos/';
        var brokerUrl='https://xentra.cloud/auth/broker?return_to=' + encodeURIComponent(returnUrl);
        window.location.href=brokerUrl;
      };
      var accountBtn=$('btn-pos-account-login');
      if (accountBtn) accountBtn.onclick=function(){ window.location.replace('/login'); };
    });
  }


  function setView(view) {
    document.querySelectorAll('.pos-view').forEach(function(v){ v.classList.toggle('active', v.id === 'pos-view-' + view); });
    document.querySelectorAll('.pos-bottom-nav button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-view') === view); });
    if (view === 'kasir') loadMenu();
    if (view === 'transaksi') loadSales();
    if (view === 'meja') loadTables();
    if (view === 'shift') renderShift();
  }

  function total() {
    return state.cart.reduce(function(sum,it){ return sum + (Number(it.unit_price)||0) * (Number(it.quantity)||0); }, 0);
  }

  function renderCart() {
    var box=$('pos-cart-items'), meta=$('pos-cart-meta'), subtotal=$('pos-subtotal'), grand=$('pos-total'), pay=$('pos-pay-total'), btn=$('btn-pos-pay');
    if (meta) meta.textContent=state.cart.reduce(function(n,i){return n+(Number(i.quantity)||0);},0)+' item';
    if (subtotal) subtotal.textContent=money(total());
    if (grand) grand.textContent=money(total());
    if (pay) pay.textContent=money(total());
    if (btn) btn.disabled=!state.cart.length || !state.shift || !!state.shift.active_break;
    if (!box) return;
    if (!state.cart.length) { box.innerHTML='<div class="pos-empty">Belum ada item.</div>'; return; }
    box.innerHTML=state.cart.map(function(it,idx){
      return '<div class="pos-cart-item"><div><div class="pos-cart-item-name">'+esc(it.name)+'</div><div class="pos-cart-item-meta">'+money(it.unit_price)+(it.options&&it.options.length?'<div class="pos-cart-item-options">'+esc(optionSummary(it.options))+'</div>':'')+(it.note?'<div class="pos-cart-item-note">Catatan: '+esc(it.note)+'</div>':'')+'</div></div>' +
        '<div class="pos-cart-item-actions"><button class="pos-qty" data-idx="'+idx+'" data-d="-1">−</button><span class="pos-qty-value">'+it.quantity+'</span><button class="pos-qty" data-idx="'+idx+'" data-d="1">+</button></div></div>';
    }).join('');
    box.querySelectorAll('.pos-qty').forEach(function(b){ b.onclick=function(){ changeQty(Number(b.dataset.idx), Number(b.dataset.d)); }; });
  }

  function changeQty(i,d){
    if(!state.cart[i])return;
    state.cart[i].quantity += d;
    if(state.cart[i].quantity<=0) state.cart.splice(i,1);
    renderCart();
  }

  function productOptions(p){
    var cfg=p && p.options_config;
    if(!cfg || !Array.isArray(cfg.groups)) return {version:1,groups:[]};
    return cfg;
  }

  function optionGroups(p){
    return productOptions(p).groups || [];
  }

  function optionSelectionKey(options){
    return (Array.isArray(options)?options:[]).map(function(o){
      return String(o.group_id)+':'+String(o.option_id);
    }).sort().join('|');
  }

  function clientOptionPrice(p, selections){
    var base=Number(p.price || p.sale_price || p.regular_price || 0);
    var adjustment=0;
    var groups=optionGroups(p);
    (Array.isArray(selections)?selections:[]).forEach(function(sel){
      var g=groups.find(function(x){return String(x.id)===String(sel.group_id);});
      var o=g && (g.options||[]).find(function(x){return String(x.id)===String(sel.option_id);});
      if(o) adjustment += Number(o.price_adjustment||0);
    });
    return base+adjustment;
  }

  function optionSummary(options){
    if(!Array.isArray(options)||!options.length) return '';
    return options.map(function(o){return o.group_name?o.group_name+': '+o.option_name:o.option_name;}).join(' · ');
  }

  function addConfiguredProduct(p,selections,note){
    if (p.is_available === 0 || p.is_available === false) return toast('Menu sedang tidak tersedia.');
    var cleanSelections=Array.isArray(selections)?selections:[];
    var lineKey=optionSelectionKey(cleanSelections);
    var hit=state.cart.find(function(i){
      return String(i.product_id)===String(p.id) && optionSelectionKey(i.options||[])===lineKey && String(i.note||'')===String(note||'');
    });
    var unitPrice=clientOptionPrice(p,cleanSelections);
    if(hit) hit.quantity += 1;
    else state.cart.push({
      product_id:p.id,
      name:p.name || p.product_name || 'Produk',
      unit_price:unitPrice,
      quantity:1,
      options:cleanSelections,
      note:note||''
    });
    renderCart();
  }

  function addProduct(p){
    if (optionGroups(p).length > 0) {
      return openProductOptions(p);
    }
    return addConfiguredProduct(p,[], '');
  }

  function openProductOptions(p){
    var groups=optionGroups(p);
    var title=p.name || p.product_name || 'Produk';
    var html='<h3>'+esc(title)+'</h3><p>Pilih opsi untuk item ini. Harga akhir akan diverifikasi oleh Core saat pembayaran.</p>';
    groups.forEach(function(g){
      var type=g.type==='addon'?'addon':'variant';
      var required=!!g.required;
      var inputType=type==='variant'?'radio':'checkbox';
      html+='<div class="pos-option-group" data-option-group="'+esc(g.id)+'"><div class="pos-option-group-head"><strong>'+esc(g.name)+'</strong><small>'+ (required?'Wajib':'Opsional') +'</small></div>';
      (g.options||[]).forEach(function(o){
        var price=Number(o.price_adjustment||0);
        var suffix=price===0?'':' '+(price>0?'+':'')+money(price);
        html+='<label class="pos-option-row"><input type="'+inputType+'" name="pos-opt-'+esc(g.id)+'" value="'+esc(o.id)+'" data-option-id="'+esc(o.id)+'" data-option-group="'+esc(g.id)+'"><span>'+esc(o.name)+'</span><em>'+esc(suffix)+'</em></label>';
      });
      html+='</div>';
    });
    html+='<div class="pos-form-row"><label>Catatan item (opsional)</label><input id="pos-item-note" type="text" maxlength="120" placeholder="Contoh: tanpa bawang"></div>';
    html+='<div id="pos-option-total" class="pos-payment-total">'+money(clientOptionPrice(p,[]))+'</div>';
    html+='<div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-option-cancel">Batal</button><button class="pos-btn" id="pos-option-add">Tambahkan</button></div>';
    showModal(html);

    function readSelections(){
      var out=[];
      document.querySelectorAll('[data-option-id][data-option-group]').forEach(function(input){
        if(!input.checked) return;
        var gid=String(input.getAttribute('data-option-group'));
        var g=groups.find(function(x){return String(x.id)===gid;});
        var opt=g && (g.options||[]).find(function(o){return String(o.id)===String(input.value);});
        if(opt) out.push({group_id:g.id,group_name:g.name,type:g.type==='addon'?'addon':'variant',option_id:opt.id,option_name:opt.name,price_adjustment:Number(opt.price_adjustment||0)});
      });
      return out;
    }

    function validateSelections(){
      for(var i=0;i<groups.length;i++){
        var g=groups[i], count=readSelections().filter(function(s){return String(s.group_id)===String(g.id);}).length;
        var min=g.type==='variant'?(g.required?1:0):Number(g.min||0);
        var max=g.type==='variant'?1:(g.max==null?null:Number(g.max));
        if(count<min) return 'Pilih minimal '+min+' pada "'+g.name+'".';
        if(max!=null&&count>max) return 'Maksimal '+max+' pilihan pada "'+g.name+'".';
      }
      return '';
    }

    document.querySelectorAll('[data-option-id]').forEach(function(inp){
      inp.onchange=function(){
        var selections=readSelections(), validation=validateSelections();
        var totalAmount=clientOptionPrice(p,selections);
        if($('pos-option-total'))$('pos-option-total').textContent=money(totalAmount);
      };
    });
    $('pos-option-cancel').onclick=hideModal;
    $('pos-option-add').onclick=function(){
      var validation=validateSelections();
      if(validation) return toast(validation);
      addConfiguredProduct(p,readSelections(),$('pos-item-note').value.trim());
      hideModal();
    };
  }

  function renderMenu(){
    var tabs=$('pos-category-tabs'), grid=$('pos-product-grid');
    var cats=state.menu.categories || [];
    if(tabs){
      tabs.innerHTML='<button class="'+(state.category==='all'?'active':'')+'" data-cat="all">Semua</button>'+cats.map(function(c){
        return '<button class="'+(String(state.category)===String(c.id)?'active':'')+'" data-cat="'+esc(c.id)+'">'+esc(c.name || c.title)+'</button>';
      }).join('');
      tabs.querySelectorAll('button').forEach(function(b){ b.onclick=function(){state.category=b.dataset.cat;renderMenu();}; });
    }
    var q=state.search.toLowerCase();
    var products=(Array.isArray(state.menu.products)?state.menu.products:[]).filter(function(p){
      var okCat=state.category==='all' || String(state.category)===String(p.category_id) || (Array.isArray(p.category_ids)&&p.category_ids.map(String).indexOf(String(state.category))!==-1);
      var okQ=!q || String(p.name||'').toLowerCase().indexOf(q)!==-1;
      return okCat && okQ;
    });
    if(grid){
      grid.innerHTML=products.length?products.map(function(p){
        var unavailable=p.is_available===0 || p.is_available===false;
        return '<button type="button" class="pos-product '+(unavailable?'disabled':'')+'" data-product-id="'+esc(p.id)+'">'+
          '<div><div class="pos-product-name">'+esc(p.name || p.product_name)+'</div><div class="pos-product-meta">'+(unavailable?'Tidak tersedia':(optionGroups(p).length?'Pilih opsi':'Siap dijual'))+'</div></div>'+
          '<div class="pos-product-price">'+money(p.price || p.sale_price || p.regular_price)+'</div></button>';
      }).join(''):'<div class="pos-empty">Menu tidak ditemukan.</div>';
      grid.querySelectorAll('.pos-product').forEach(function(b){
        b.onclick=function(){ var p=(Array.isArray(state.menu.products)?state.menu.products:[]).find(function(x){return String(x.id)===String(b.dataset.productId);}); if(p)addProduct(p); };
      });
    }
  }

  async function loadMenu(){
    if(!state.branchId)return;
    try{
      var data=await request('/catalog/menu?branch_id='+encodeURIComponent(state.branchId),{headers:headers()});
      var catalogProducts=Array.isArray(data.all_products)?data.all_products:(data.products&&Array.isArray(data.products.items)?data.products.items:[]);
      state.menu={categories:data.categories||[],products:catalogProducts};
      savePosMenuCache();
      renderMenu();
      setConnection(true);
    }catch(e){
      setConnection(false);
      var cachedMenu=getPosMenuCache(state.branchId);
      if(cachedMenu){ state.menu=cachedMenu; renderMenu(); return; }
      if($('pos-product-grid'))$('pos-product-grid').innerHTML='<div class="pos-empty">Menu tidak dapat dimuat. Periksa koneksi.</div>';
    }
  }

  async function ensurePosPinConfigured(){
    try {
      var d=await request('/auth/pos-pin',{headers:headers()});
      if(d && d.configured && d.offline_credential) {
        savePosPinCache(d.user || state.user,d.offline_credential,state.branchId);
        return true;
      }
      return await promptSetPosPin();
    } catch (err) {
      // A configured PIN may already exist in the terminal cache; only force setup
      // when the current authenticated session is healthy and no cache is available.
      var cached=getPosPinCache();
      if(cached && cached.offline_credential) return true;
      throw err;
    }
  }

  function promptSetPosPin(){
    return new Promise(function(resolve){
      showModal('<h3>Buat PIN POS</h3><p class="pos-pin-setup-note">PIN ini adalah credential tambahan untuk membuka POS dengan cepat. PIN tidak menggantikan login akun Xentra dan tidak dapat dipakai untuk Owner Dashboard atau Merchant App.</p>'+
        '<div class="pos-form-row"><label>PIN POS (6 digit)</label><input id="pos-setup-pin" class="pos-pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" minlength="6" autocomplete="new-password" placeholder="••••••"></div>'+
        '<div class="pos-form-row"><label>Konfirmasi PIN</label><input id="pos-setup-pin-confirm" class="pos-pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" minlength="6" autocomplete="new-password" placeholder="••••••"></div>'+
        '<div id="pos-pin-setup-error" class="pos-auth-error"></div>'+
        '<div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-pin-setup-cancel" type="button">Nanti</button><button class="pos-btn" id="pos-pin-setup-save" type="button">Simpan PIN</button></div>');
      $('pos-pin-setup-cancel').onclick=function(){
        hideModal();
        var err=new Error('POS PIN belum diset.'); err.code='POS_PIN_NOT_CONFIGURED'; resolve(false);
      };
      $('pos-pin-setup-save').onclick=async function(){
        var pin=($('pos-setup-pin').value||'').trim(), confirm=($('pos-setup-pin-confirm').value||'').trim(), error=$('pos-pin-setup-error'), btn=$('pos-pin-setup-save');
        if(!/^\d{6}$/.test(pin) || pin!==confirm) { error.textContent='PIN harus 6 digit dan kedua input harus sama.'; return; }
        btn.disabled=true; btn.textContent='Menyimpan...';
        try {
          var d=await request('/auth/pos-pin',{method:'PUT',headers:headers(),body:JSON.stringify({pin:pin})});
          if(d && d.offline_credential) savePosPinCache(d.user || state.user,d.offline_credential,state.branchId);
          hideModal();
          resolve(true);
        } catch(err) {
          error.textContent=err.message || 'PIN gagal disimpan.';
          btn.disabled=false; btn.textContent='Simpan PIN';
        }
      };
      setTimeout(function(){ if($('pos-setup-pin')) $('pos-setup-pin').focus(); },50);
    });
  }

  async function consumeGoogleHandoff(){
    var params=new URLSearchParams(window.location.search);
    var handoff=params.get('handoff');
    if(!handoff) return true;

    params.delete('handoff');
    var cleanQuery=params.toString();
    var cleanUrl=window.location.pathname + (cleanQuery ? '?' + cleanQuery : '') + window.location.hash;
    window.history.replaceState({},document.title,cleanUrl);

    try{
      var res=await fetch(API + '/auth/handoff/exchange',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ticket:handoff})
      });
      var data=await res.json().catch(function(){return {};});
      if(res.ok && data && data.success && data.token){
        localStorage.setItem(TOKEN_KEY,data.token);
        if(data.user) localStorage.setItem(USER_KEY,JSON.stringify(data.user));
        return true;
      }
      throw new Error((data && (data.error || data.message)) || 'Login Google gagal.');
    }catch(err){
      showPosAuthGate(false);
      var error=$('pos-pin-login-error');
      if(error) error.textContent=err.message || 'Login Google gagal.';
      return false;
    }
  }

  async function ensureSession(){
    if(!token()){
      await openPinUnlockGate(!navigator.onLine);
      return !!token() || !!state.user;
    }
    try {
      var me=await requestWithTimeout('/auth/merchant/me',{headers:headers()},1800);
      applyCashierUser(me.user);
      if(state.user.role!=='cashier'){ window.location.replace(me.landing || '/merchant/'); return false; }
      if(!state.branchId){ toast('Akun kasir belum memiliki cabang.'); return false; }
      await ensurePosPinConfigured();
      return true;
    } catch(err) {
      var cached=getPosPinCache();
      // Network/timeout may use local PIN; a real server-side 401 can also be
      // recovered through the cached POS credential without accepting the old token.
      if(cached && cached.offline_credential) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        await openPinUnlockGate(err && err.code==='NETWORK_TIMEOUT' ? true : true);
        return true;
      }
      window.location.replace('/login');
      return false;
    }
  }

  async function loadPaymentModes(){
    try{
      var d=await request('/pos/payment-methods',{headers:headers()});
      state.paymentModes=d.payment_modes||[];
    }catch(e){
      state.paymentModes=[{code:'cash',name:'Cash',enabled:true,offline_supported:true,provider:'cash'}];
    }
    return state.paymentModes;
  }

  async function loadTerminal(){
    try{
      var d=await request('/pos/terminal/current',{headers:headers()});
      state.terminalId=d.terminal ? d.terminal.id : (localStorage.getItem('xentra_pos_terminal_id') || null);
      if(state.terminalId) localStorage.setItem('xentra_pos_terminal_id',state.terminalId);
      return !!state.terminalId;
    }catch(e){
      state.terminalId=state.terminalId || localStorage.getItem('xentra_pos_terminal_id') || null;
      return !!state.terminalId;
    }
  }

  async function loadShift(){
    try{
      var d=await request('/pos/shifts/current',{headers:headers()});
      state.shift=d.shift||null;
      savePosShiftCache();
    }catch(e){
      state.shift=getPosShiftCache(state.user && state.user.id);
    }
    renderShiftStatus();
    renderShift();
    renderCart();
  }

  function renderShift(){
    renderShiftStatus();
    var box=$('pos-shift-card'); if(!box)return;
    if(!state.shift){
      box.innerHTML='<h3>Belum ada shift aktif</h3><p>Kasir harus membuka shift sebelum penjualan dapat diselesaikan.</p>'+
        '<div class="pos-form-row"><label>Modal Kas Awal</label><input id="pos-starting-float" type="number" min="0" value="0"></div>'+
        '<div class="pos-shift-actions"><button class="pos-btn" id="btn-pos-open-shift">Buka Shift</button></div>';
      $('btn-pos-open-shift').onclick=openShift;
      return;
    }
    var s=state.shift;
    box.innerHTML='<h3>'+ (s.active_break ? 'Sedang Istirahat' : 'Shift Aktif') +'</h3><p>'+esc(s.id)+' · dibuka '+esc(s.opened_at || '')+'</p>'+
      '<div class="pos-shift-grid">'+
      '<div class="pos-shift-metric"><span>Modal Awal</span><strong>'+money(s.starting_float)+'</strong></div>'+
      '<div class="pos-shift-metric"><span>Penjualan Tunai</span><strong>'+money(s.total_cash_sales)+'</strong></div>'+
      '<div class="pos-shift-metric"><span>Cash In</span><strong>'+money(s.total_cash_in)+'</strong></div>'+
      '<div class="pos-shift-metric"><span>Cash Out</span><strong>'+money(s.total_cash_out)+'</strong></div>'+
      '<div class="pos-shift-metric"><span>Kas Ekspektasi</span><strong>'+money(s.expected_cash)+'</strong></div>'+
      '</div>'+
      '<div class="pos-shift-actions"><button class="pos-btn ghost" id="btn-pos-cash-in">Cash In</button><button class="pos-btn ghost" id="btn-pos-cash-out">Cash Out</button><button class="pos-btn danger ghost" id="btn-pos-close-shift">Tutup Shift</button></div>';
    $('btn-pos-cash-in').onclick=function(){cashMove('in');}; $('btn-pos-cash-out').onclick=function(){cashMove('out');}; $('btn-pos-close-shift').onclick=closeShift;
  }

  async function openShift(){
    var amount=Number($('pos-starting-float').value||0);
    try{var d=await request('/pos/shifts/open',{method:'POST',headers:headers(),body:JSON.stringify({branch_id:state.branchId,starting_float:amount})});state.shift=d.shift;savePosShiftCache();renderShift();renderCart();toast('Shift dibuka.');}
    catch(e){toast(e.message);}
  }

  async function cashMove(type){
    if(!state.shift)return;
    var amount=prompt(type==='in'?'Nominal Cash In':'Nominal Cash Out'); if(amount===null)return;
    amount=Number(amount); if(!Number.isFinite(amount)||amount<=0)return toast('Nominal tidak valid.');
    var reason=prompt('Keterangan (opsional)')||'';
    try{var d=await request('/pos/shifts/'+encodeURIComponent(state.shift.id)+'/cash-movement',{method:'POST',headers:headers(),body:JSON.stringify({type:type,amount:amount,reason:reason})});state.shift=d.shift;renderShift();toast(type==='in'?'Cash In dicatat.':'Cash Out dicatat.');}
    catch(e){toast(e.message);}
  }

  async function toggleShiftBreak(){
    if(!state.shift)return;
    var endpoint=state.shift.active_break ? 'end' : 'start';
    try{
      var d=await request('/pos/shifts/'+encodeURIComponent(state.shift.id)+'/break/'+endpoint,{method:'POST',headers:headers()});
      state.shift.active_break=endpoint==='start'?d.break:null;
      savePosShiftCache(); renderShiftStatus(); renderCart(); renderShift();
      toast(endpoint==='start'?'Istirahat dimulai.':'Kembali bertugas.');
    }catch(e){toast(e.message);}
  }

  async function closeShift(){
    if(!state.shift)return;
    var actual=prompt('Masukkan uang fisik aktual di laci'); if(actual===null)return;
    actual=Number(actual); if(!Number.isFinite(actual)||actual<0)return toast('Nominal tidak valid.');
    try{var d=await request('/pos/shifts/'+encodeURIComponent(state.shift.id)+'/close',{method:'POST',headers:headers(),body:JSON.stringify({actual_cash:actual})});state.shift=null;savePosShiftCache();renderShift();renderCart();toast('Shift ditutup. Variance: '+money(d.shift && d.shift.variance));}
    catch(e){toast(e.message);}
  }

  function paymentModeInfo(mode){ return state.paymentModes.find(function(m){return m.code===mode;}) || {code:mode,name:mode,enabled:true}; }

  function paymentModeBody(mode,totalAmount){
    var info=paymentModeInfo(mode);
    if(mode==='cash') return '<div class="pos-form-row"><label>Uang Diterima</label><input id="pos-amount-tendered" type="number" min="'+totalAmount+'" value="'+totalAmount+'"></div><div id="pos-change-preview" class="pos-change">Kembalian: '+money(0)+'</div>';
    if(mode==='payment_gateway') return '<div class="pos-payment-pending"><strong>Payment Gateway</strong><span>Provider: '+esc(String(info.provider||'—').toUpperCase())+'</span><small>Pembayaran dibuat melalui gateway aktif dan POS menunggu status settlement.</small></div>';
    var q=info.qris_static||{};
    return '<div class="pos-qris-panel"><div class="pos-payment-total">'+money(totalAmount)+'</div>'+(q.merchant_name?'<div class="pos-qris-merchant">'+esc(q.merchant_name)+'</div>':'')+'<img class="pos-qris-image" src="'+esc(q.image_url||'')+'" alt="QRIS Statis"><p class="pos-qris-instructions">'+esc(q.instructions||'Verifikasi pembayaran pelanggan sebelum konfirmasi.')+'</p></div>';
  }

  function openPayModal(){
    if(!state.cart.length)return;
    var t=total();
    var modes=state.paymentModes.filter(function(m){return m.enabled;});
    if(!modes.some(function(m){return m.code==='cash';}))modes.unshift({code:'cash',name:'Cash',enabled:true,offline_supported:true,provider:'cash'});
    state.activePaymentMode=(modes.find(function(m){return m.code===state.activePaymentMode;})||modes[0]).code;
    showModal('<h3>Pembayaran</h3><div class="pos-payment-total">'+money(t)+'</div><div class="pos-form-row"><label>Mode Pembayaran</label><div class="pos-payment-mode-grid">'+modes.map(function(m){return '<button type="button" class="pos-payment-option '+(m.code===state.activePaymentMode?'active':'')+'" data-pay-mode="'+esc(m.code)+'"><strong>'+esc(m.name)+'</strong><small>'+(m.code==='payment_gateway'?esc(String(m.provider||'').toUpperCase()):m.code==='qris_static'?'Fallback manual':'Offline tersedia')+'</small></button>';}).join('')+'</div></div><div id="pos-payment-mode-body">'+paymentModeBody(state.activePaymentMode,t)+'</div><div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-pay-cancel">Batal</button><button class="pos-btn" id="pos-pay-confirm">Lanjutkan</button></div>');
    document.querySelectorAll('[data-pay-mode]').forEach(function(btn){btn.onclick=function(){state.activePaymentMode=btn.dataset.payMode;document.querySelectorAll('[data-pay-mode]').forEach(function(x){x.classList.toggle('active',x===btn);});$('pos-payment-mode-body').innerHTML=paymentModeBody(state.activePaymentMode,t);bindCashPreview();};});
    bindCashPreview();
    $('pos-pay-cancel').onclick=hideModal;
    $('pos-pay-confirm').onclick=function(){var amount=$('pos-amount-tendered');submitSale(state.activePaymentMode,amount?Number(amount.value||0):null);};
  }

  function bindCashPreview(){
    var amount=$('pos-amount-tendered'),preview=$('pos-change-preview');
    if(amount&&preview)amount.oninput=function(){preview.textContent='Kembalian: '+money(Math.max(0,Number(amount.value||0)-total()));};
  }

  function showPaymentSuccess(order,change){
    showModal('<h3>Pembayaran Berhasil</h3><p>Sale '+esc(order.order_number||order.id||'')+' selesai.</p><div class="pos-payment-total">'+money(order.grand_total||total())+'</div>'+(change!=null?'<div class="pos-change">Kembalian: '+money(change)+'</div>':'')+'<div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-sale-close">Selesai</button><button class="pos-btn" id="pos-sale-print">Cetak Struk</button></div>');
    $('pos-sale-close').onclick=function(){hideModal();resetSale();};
    $('pos-sale-print').onclick=function(){printReceipt(order.id);};
  }

  function showGatewayPending(d){
    var p=d.payment||{},oid=d.order_id||((d.order||{}).id)||'';
    showModal('<h3>Menunggu Pembayaran</h3><p>'+esc(d.order_number||oid)+' · '+money(d.grand_total||0)+'</p><div class="pos-payment-pending"><strong>'+esc(String(p.provider||'').toUpperCase())+'</strong>'+(p.redirect_url?'<button class="pos-btn" id="pos-open-gateway">Buka Pembayaran</button>':'')+'<button class="pos-btn ghost" id="pos-check-gateway">Cek Status Pembayaran</button><small id="pos-gateway-status-text">Menunggu settlement gateway…</small></div><div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-gateway-close">Tutup</button></div>');
    if($('pos-open-gateway'))$('pos-open-gateway').onclick=function(){window.open(p.redirect_url,'_blank','noopener');};
    $('pos-gateway-close').onclick=function(){hideModal();};
    function poll(){request('/pos/orders/'+encodeURIComponent(oid)+'/payment-status?refresh=1',{headers:headers()}).then(function(st){var ps=st.payment&&st.payment.payment_status,os=st.order&&st.order.status;if(ps==='settlement'){clearInterval(timer);showPaymentSuccess({id:oid,order_number:st.order.order_number,grand_total:st.order.grand_total},null);loadShift();loadSales();}else if(ps==='reconciliation_pending'){if($('pos-gateway-status-text'))$('pos-gateway-status-text').textContent='Status gateway belum dapat dipastikan. Jangan ulangi pembayaran untuk order ini.';}else if(['cancel','deny','expire'].indexOf(ps)>=0||['cancelled','rejected','timeout'].indexOf(os)>=0){clearInterval(timer);if($('pos-gateway-status-text'))$('pos-gateway-status-text').textContent='Pembayaran gagal/dibatalkan. Silakan pilih metode lain.';}}).catch(function(){});}
    var timer=setInterval(poll,3000);$('pos-check-gateway').onclick=poll;poll();
  }

  function showStaticQrisPending(d){
    var p=d.payment||{},oid=d.order_id||((d.order||{}).id)||'',q=p.qris_static||{};
    showModal('<h3>QRIS Statis</h3><p>Tagihan '+money(d.grand_total||0)+'</p>' +(q.merchant_name?'<div class="pos-qris-merchant">'+esc(q.merchant_name)+'</div>':'')+'<img class="pos-qris-image" src="'+esc(q.image_url||'')+'" alt="QRIS Statis"><p class="pos-qris-instructions">'+esc(q.instructions||'Verifikasi pembayaran pelanggan sebelum konfirmasi.')+'</p><div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-qris-cancel">Belum Bayar</button><button class="pos-btn" id="pos-qris-confirm">Saya Sudah Verifikasi</button></div>');
    $('pos-qris-cancel').onclick=function(){request('/pos/orders/'+encodeURIComponent(oid)+'/cancel-qris-static',{method:'POST',headers:headers(),body:JSON.stringify({reason:'QRIS statis belum dibayar.'})}).then(function(){hideModal();resetSale();loadSales();}).catch(function(e){toast(e.message);});};
    $('pos-qris-confirm').onclick=function(){var note=prompt('Referensi transaksi (opsional)')||'';request('/pos/orders/'+encodeURIComponent(oid)+'/confirm-qris-static',{method:'POST',headers:headers(),body:JSON.stringify({reference_note:note})}).then(function(result){if(result&&result.success){showPaymentSuccess({id:oid,order_number:result.order_number,grand_total:d.grand_total},null);loadSales();}}).catch(function(e){toast(e.message);});};
  }

  async function submitSale(paymentMode,amountTendered){
    if(!state.shift)return toast('Buka shift terlebih dahulu.');
    if(state.orderType==='dine_in'&&!state.selectedTable)return toast('Pilih meja untuk transaksi dine-in.');
    if(!navigator.onLine&&paymentMode!=='cash')return toast('Payment Gateway dan QRIS Statis membutuhkan koneksi internet pada POS.');
    var payload={branch_id:state.branchId,shift_id:state.shift.id,order_type:state.orderType,payment_mode:paymentMode,amount_tendered:paymentMode==='cash'?amountTendered:null,customer:{name:$('pos-customer-name').value.trim(),phone:'',table_number:state.selectedTable?state.selectedTable.table_number:null},items:state.cart.map(function(i){return {product_id:i.product_id,name:i.name,quantity:i.quantity,unit_price:i.unit_price,expected_price:i.unit_price,options:i.options||[],note:i.note||''};}),client_transaction_id:'pos_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)};
    try{
      var d;
      if(!navigator.onLine){
        if(!state.terminalId)return toast('POS offline belum siap: terminal cabang belum terdaftar.');
        await request('/pos/local/sale',{method:'POST',headers:headers(),body:JSON.stringify({terminal_id:state.terminalId,branch_id:state.branchId,shift_id:state.shift.id,order_type:state.orderType,payment_method:'cash',amount_tendered:amountTendered,customer:payload.customer,items:payload.items,client_transaction_id:payload.client_transaction_id,offline_created_at:new Date().toISOString(),config_version:1})});
        hideModal();resetSale();toast('Penjualan tersimpan lokal. Akan disinkronkan saat online.');return;
      }
      d=await request('/pos/sales',{method:'POST',headers:headers(),body:JSON.stringify(payload)});
      if(paymentMode==='cash'||d.status==='SETTLED'){hideModal();showPaymentSuccess(d.order||{},Number((d.order||{}).change||0));loadShift();loadSales();}
      else if(paymentMode==='payment_gateway'){hideModal();showGatewayPending(d);}
      else if(paymentMode==='qris_static'){hideModal();showStaticQrisPending(d);}
    }catch(e){toast(e.message);}
  }
  async function printReceipt(orderId){
    try{
      var d=await request('/pos/orders/'+encodeURIComponent(orderId)+'/receipt',{headers:headers()});
      var w=window.open('','_blank','width=420,height=700'); if(!w)throw new Error('Popup diblokir browser.');
      w.document.write('<!doctype html><html><head><title>Struk Xentra</title><style>body{font-family:monospace;width:300px;margin:20px auto;font-size:12px}pre{white-space:pre-wrap;line-height:1.35}</style></head><body><pre>'+esc(d.receipt.raw_content)+'</pre></body></html>');
      w.document.close(); w.focus(); w.print();
    }catch(e){toast(e.message);}
  }

  function resetSale(){state.cart=[];state.selectedTable=null;$('pos-selected-table').textContent='Belum dipilih';$('pos-customer-name').value='';$('pos-order-note').value='';renderCart();}

  function showModal(html){$('pos-modal-card').innerHTML=html;$('pos-modal').classList.remove('hidden');}
  function hideModal(){$('pos-modal').classList.add('hidden');$('pos-modal-card').innerHTML='';}

  async function holdSale(){
    if(!state.cart.length)return toast('Cart masih kosong.');
    if(state.orderType==='dine_in' && !state.selectedTable)return toast('Pilih meja sebelum menahan bill.');
    try{
      await request('/pos/held-orders',{method:'POST',headers:headers(),body:JSON.stringify({branch_id:state.branchId,table_number:state.selectedTable?state.selectedTable.table_number:'',customer_name:$('pos-customer-name').value.trim()||'Tamu',order_type:state.orderType,items:state.cart})});
      toast('Pesanan ditahan.'); resetSale();
    }catch(e){toast(e.message);}
  }

  async function loadHeld(){
    try{var d=await request('/pos/held-orders?branch_id='+encodeURIComponent(state.branchId),{headers:headers()});state.held=d.held_orders||[];return state.held;}catch(e){return [];}
  }

  async function openHeld(){
    var held=await loadHeld();
    if(!held.length){toast('Tidak ada pesanan yang ditahan.');return;}
    showModal('<h3>Pesanan Ditahan</h3><p>Pilih bill untuk dilanjutkan.</p><div>'+held.map(function(h){return '<button class="pos-btn ghost" data-held="'+esc(h.id)+'" style="display:block;width:100%;margin:7px 0;text-align:left;">Meja '+esc(h.table_number||'—')+' · '+esc(h.customer_name||'Tamu')+' · '+money(JSON.parse(h.items_payload||'[]').reduce(function(s,i){return s+(Number(i.unit_price)||0)*Number(i.quantity||0)},0))+'</button>';}).join('')+'</div>');
    $('pos-modal-card').querySelectorAll('[data-held]').forEach(function(b){b.onclick=function(){var h=held.find(function(x){return String(x.id)===String(b.dataset.held);});if(!h)return;state.orderType='dine_in';state.selectedTable={table_number:h.table_number};state.cart=JSON.parse(h.items_payload||'[]');hideModal();renderCart();};});
  }

  async function loadSales(){
    try{
      var d=await request('/pos/sales?branch_id='+encodeURIComponent(state.branchId),{headers:headers()});
      state.sales=d.sales||[]; renderSales();
    }catch(e){if($('pos-sales-list'))$('pos-sales-list').innerHTML='<div class="pos-empty">Riwayat transaksi tidak tersedia.</div>';}
  }

  function renderSales(){
    var box=$('pos-sales-list');if(!box)return;
    if(!state.sales.length){box.innerHTML='<div class="pos-empty">Belum ada transaksi POS.</div>';return;}
    box.innerHTML=state.sales.map(function(s){
      return '<div class="pos-sale-row"><div class="pos-sale-main"><strong>#'+esc(s.order_number||s.id)+'</strong><small>'+esc(s.created_at||'')+'</small></div><div>'+esc((s.order_type||'').toUpperCase())+'</div><div><span class="pos-badge ok">'+esc(s.payment_status||'paid')+'</span></div><div class="pos-sale-total">'+money(s.grand_total)+'</div><div><button class="pos-btn small ghost" data-print="'+esc(s.id)+'">Struk</button></div></div>';
    }).join('');
    box.querySelectorAll('[data-print]').forEach(function(b){b.onclick=function(){printReceipt(b.dataset.print);};});
  }

  async function loadTables(){
    try{
      var d=await request('/dine-in/layout?branch_id='+encodeURIComponent(state.branchId),{headers:headers()});
      var tables=(d.layout&&d.layout.tables)||[]; var box=$('pos-table-grid'); if(!box)return;
      box.innerHTML=tables.map(function(t){
        var st=t.operational_state||t.status||'available'; var can=st==='available';
        return '<div class="pos-table-card '+esc(st)+'"><h3>'+esc(t.label||('Meja '+t.table_number))+'</h3><p>'+esc(String(t.capacity||4))+' kursi · '+esc(st)+'</p>'+
          '<button type="button" class="pos-btn small '+(can?'':'ghost')+'" '+(can?'':'disabled')+' data-table="'+esc(t.id)+'">Gunakan untuk Sale</button></div>';
      }).join('');
      box.querySelectorAll('[data-table]').forEach(function(b){b.onclick=function(){var t=tables.find(function(x){return String(x.id)===String(b.dataset.table);});if(!t)return;state.selectedTable=t;$('pos-selected-table').textContent=t.label||('Meja '+t.table_number);state.orderType='dine_in';document.querySelectorAll('.pos-order-type button').forEach(function(x){x.classList.toggle('active',x.dataset.type==='dine_in');});setView('kasir');};});
    }catch(e){$('pos-table-grid').innerHTML='<div class="pos-empty">Layout meja tidak dapat dimuat.</div>';}
  }

  function bind(){
    document.querySelectorAll('.pos-bottom-nav button').forEach(function(b){b.onclick=function(){setView(b.dataset.view);};});
    document.querySelectorAll('.pos-order-type button').forEach(function(b){b.onclick=function(){state.orderType=b.dataset.type;document.querySelectorAll('.pos-order-type button').forEach(function(x){x.classList.toggle('active',x===b);});$('pos-table-context').classList.toggle('hidden',state.orderType!=='dine_in');if(state.orderType!=='dine_in')state.selectedTable=null;};});
    $('pos-menu-search').oninput=function(){state.search=this.value;renderMenu();};
    $('btn-pos-refresh-menu').onclick=loadMenu;
    $('btn-pos-pay').onclick=openPayModal;
    $('btn-pos-clear').onclick=function(){resetSale();};
    $('btn-pos-hold').onclick=holdSale;
    $('btn-pos-select-table').onclick=function(){setView('meja');};
    $('btn-pos-load-sales').onclick=loadSales;
    $('btn-pos-shift-status').onclick=function(){if(!state.shift){setView('shift');return;}toggleShiftBreak();};
    $('btn-pos-close-shift-top').onclick=closeShift;
    $('btn-pos-logout').onclick=function(){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);window.location.replace('/login');};
    $('pos-modal').onclick=function(e){if(e.target===this)hideModal();};
  }

  async function boot(){
    bind();
    renderShiftStatus();
    try{
      if(!await consumeGoogleHandoff())return;
      if(!await ensureSession())return;
      await loadPaymentModes();
      await loadTerminal();
      await loadShift();
      await loadMenu();
      setView('kasir');
      window.addEventListener('online',function(){
        setConnection(!state.offlineMode);
        if(state.offlineMode && token()) state.offlineMode=false;
        loadTerminal();
        loadMenu();
        if(token()) {
          request('/pos/local/sync-outbox',{method:'POST',headers:headers(),body:JSON.stringify({terminal_id:state.terminalId,branch_id:state.branchId})}).catch(function(){});
        }
      });
      window.addEventListener('offline',function(){setConnection(false);});
      setConnection(!state.offlineMode && navigator.onLine);
    }catch(e){toast(e.message||'Gagal memuat POS.');}
  }

  boot();
})();