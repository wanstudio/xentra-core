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
    held: [],
    composer: new window.XentraPos.TransactionComposer({ orderType: 'dine_in' }),
    sales: [],
    terminalId: localStorage.getItem('xentra_pos_terminal_id') || null,
    paymentModes: [],
    activePaymentMode: 'cash',
    offlineMode: false,
    coreConnection: null,
    branchOperationalOpen: null,
    branchStatusReason: null,
    branchReadinessRefreshTimer: null,
    offlineStoreReady: false,
    offlineSyncInFlight: false
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function money(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
  function formatNominal(num) {
    if (num == null || num === '') return '';
    var clean = String(num).replace(/\D/g, '');
    if (!clean) return '';
    clean = clean.replace(/^0+(?=\d)/, '');
    return clean.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function parseNominal(val) {
    if (val == null) return 0;
    var clean = String(val).replace(/\D/g, '');
    return clean ? Number(clean) : 0;
  }
  function posStepperIcon(type) {
    if (type === 'plus') return '<svg class="pos-stepper-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    return '<svg class="pos-stepper-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  }

  function bindNominalInput(input, onValueChange) {
    if (!input) return;
    input.addEventListener('input', function() {
      var raw = this.value;
      var cursor = this.selectionEnd;
      var prevLen = raw.length;
      var formatted = formatNominal(raw);
      this.value = formatted;
      if (cursor != null && formatted.length !== prevLen) {
        var diff = formatted.length - prevLen;
        var newPos = Math.max(0, cursor + diff);
        this.setSelectionRange(newPos, newPos);
      }
      if (typeof onValueChange === 'function') {
        onValueChange(parseNominal(formatted), formatted);
      }
    });
  }

  function bindModalEnter(input, actionOrNext) {
    if (!input) return;
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (typeof actionOrNext === 'function') {
          actionOrNext();
        } else if (actionOrNext && typeof actionOrNext.focus === 'function' && (actionOrNext.tagName === 'INPUT' || actionOrNext.tagName === 'TEXTAREA')) {
          actionOrNext.focus();
        } else if (actionOrNext && typeof actionOrNext.click === 'function') {
          actionOrNext.click();
        }
      }
    });
  }

  function getShiftCashierName(s) {
    var rawName = (s && (s.cashier_name || s.cashier_username)) || '';
    if (!rawName) {
      var u = user() || {};
      rawName = u.full_name || u.name || u.username || '';
    }
    if (!rawName) return 'Kasir';
    var name = String(rawName).trim();
    if (name.indexOf('@') > 0) name = name.split('@')[0];
    if (/^[a-z0-9_.-]+$/.test(name)) {
      name = name.charAt(0).toUpperCase() + name.slice(1);
    }
    return name;
  }

  function formatShiftDateTime(isoString) {
    if (!isoString) return '';
    try {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) return String(isoString);
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sept', 'Okt', 'Nov', 'Des'];
      var day = d.getDate();
      var month = months[d.getMonth()] || '';
      var year = d.getFullYear();
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return 'open ' + day + ' ' + month + ' ' + year + ' · ' + hh + '.' + mm + ' WIB';
    } catch (_) {
      return '';
    }
  }

  function formatShiftSubtitle(s) {
    if (!s) return 'Operasional';
    var cashier = getShiftCashierName(s);
    var dt = formatShiftDateTime(s.opened_at);
    if (dt) {
      return cashier + ' · ' + dt;
    }
    return cashier;
  }
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
    var isLong = (msg || '').length > 25;
    var dur = isLong ? 3000 : 2200;
    var iconSvg = '<span class="pos-toast-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></span>';
    el.innerHTML = '<div class="pos-toast-inner">' + iconSvg + '<span>' + esc(msg) + '</span></div>';
    el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function(){ el.classList.remove('show'); }, dur);
  }

  function setPosStatus(level,title,detail){
    var el=$('pos-connection-badge'); if(!el)return;
    var normalized=['ready','caution','stop'].indexOf(level)!==-1 ? level : 'caution';
    el.className='pos-status '+normalized;
    el.dataset.status=normalized;
    el.setAttribute('aria-label','Status POS: '+title);
    var titleEl=el.querySelector('.pos-status-tooltip-title');
    var detailEl=el.querySelector('.pos-status-tooltip-detail');
    if(titleEl) titleEl.textContent=title;
    if(detailEl) detailEl.textContent=detail || '';
  }

  function updatePosReadiness(){
    if(navigator.onLine===false || state.offlineMode){
      setPosStatus('caution','Koneksi terputus','POS sedang mencoba menyambungkan kembali. Operasi offline yang diizinkan tetap dapat digunakan.');
      return;
    }
    if(state.coreConnection===false){
      setPosStatus('stop','Terjadi gangguan sistem','POS belum dapat terhubung ke sistem. Periksa koneksi atau hubungi operator/admin.');
      return;
    }
    if(state.coreConnection!==true){
      setPosStatus('caution','Menghubungkan…','POS sedang memeriksa koneksi dan kesiapan sistem.');
      return;
    }
    if(!state.terminalId){
      setPosStatus('stop','Terminal belum siap','Terminal POS belum terdaftar. Hubungi operator/admin.');
      return;
    }
    if(state.branchOperationalOpen === false){
      if(state.branchStatusReason === 'inactive'){
        setPosStatus('stop','Cabang tidak aktif','Cabang tidak aktif. Hubungi admin/operator.');
      }else{
        setPosStatus('stop','Merchant sedang tutup','Cabang sedang ditutup. Buka cabang kembali sebelum memulai transaksi baru.');
      }
      return;
    }
    if(state.branchOperationalOpen === null){
      setPosStatus('caution','Status cabang belum diketahui','POS sedang memeriksa status operasional cabang.');
      return;
    }
    if(!state.shift){
      setPosStatus('caution','Shift belum dibuka','Buka shift kasir untuk mulai transaksi.');
      return;
    }
    setPosStatus('ready','Siap digunakan','POS siap untuk transaksi.');
  }

  function bindPosStatus(){
    var el=$('pos-connection-badge'); if(!el || el.dataset.bound==='1')return;
    el.dataset.bound='1';
    el.onclick=function(e){
      e.stopPropagation();
      var isOpen=el.classList.toggle('is-open');
      el.setAttribute('aria-expanded',isOpen?'true':'false');
    };
    document.addEventListener('click',function(e){
      if(!el.contains(e.target)){
        el.classList.remove('is-open');
        el.setAttribute('aria-expanded','false');
      }
    });
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

  function getPosPinCache(userId) {
    var profiles=getPosPinProfiles();
    if (userId && profiles[String(userId)]) return profiles[String(userId)];
    if (state.user && state.user.id && profiles[String(state.user.id)]) return profiles[String(state.user.id)];
    var u = user();
    if (u && u.id && profiles[String(u.id)]) return profiles[String(u.id)];
    var keys = Object.keys(profiles);
    if (keys.length > 0) return profiles[keys[0]];
    return null;
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

  function getOfflineStore() {
    return window.XentraPos && window.XentraPos.PosOfflineStore
      ? window.XentraPos.PosOfflineStore
      : null;
  }

  function getOfflineScope() {
    return {
      branch_id: state.branchId,
      terminal_id: state.terminalId
    };
  }

  async function ensureOfflineStore() {
    var store = getOfflineStore();
    if (!store || !store.isSupported()) {
      throw new Error('Penyimpanan offline perangkat tidak tersedia. Transaksi offline tidak dapat dipastikan tersimpan.');
    }
    if (!state.branchId || !state.terminalId) {
      throw new Error('POS offline belum siap: cabang atau terminal belum diketahui.');
    }
    if (!state.offlineStoreReady) {
      await store.initialize();
      await store.recover(getOfflineScope());
      state.offlineStoreReady = true;
    }
    return store;
  }

  function isCoreUnreachableError(err) {
    if (!err) return false;
    if (err.status) return false;
    if (err.code === 'NETWORK_TIMEOUT') return true;
    if (err.name === 'TypeError') return true;
    return /failed to fetch|networkerror|load failed|network request failed/i.test(String(err.message || ''));
  }

  async function persistOfflineSale(payload, offlineCreatedAt) {
    var store = await ensureOfflineStore();
    return store.createOfflineSale({
      branch_id: payload.branch_id,
      terminal_id: state.terminalId,
      shift_id: payload.shift_id,
      cashier_id: state.user && state.user.id ? state.user.id : null,
      order_type: payload.order_type,
      payment_method: 'cash',
      amount_tendered: payload.amount_tendered,
      customer: payload.customer,
      items: payload.items,
      client_transaction_id: payload.client_transaction_id,
      offline_created_at: offlineCreatedAt,
      config_version: 1
    });
  }

  async function syncBrowserOfflineOutbox() {
    if (state.offlineSyncInFlight || !navigator.onLine || !token() || !state.branchId || !state.terminalId) return;
    var store;
    try {
      store = await ensureOfflineStore();
    } catch (_) {
      return;
    }

    var pending = await store.listPending(getOfflineScope());
    if (!pending.length) return;

    state.offlineSyncInFlight = true;
    try {
      for (var idx = 0; idx < pending.length; idx++) {
        var operation = pending[idx];
        await store.markSyncing(operation.operation_id);
        try {
          var result = await request('/pos/local/sale', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(operation.payload)
          });
          var serverOrderId = result && (
            result.order_id ||
            (result.order && result.order.id) ||
            (result.order && result.order_id)
          );
          await store.markSynced(operation.operation_id, { server_order_id: serverOrderId || null });
        } catch (err) {
          if (err && err.status === 409) {
            await store.markConflict(operation.operation_id, { message: err.message });
          } else if (err && err.status >= 400 && err.status < 500) {
            await store.markFailed(operation.operation_id, { message: err.message });
          } else {
            await store.requeue(operation.operation_id, err.message || 'Koneksi terputus saat sinkronisasi.');
            break;
          }
        }
      }
    } finally {
      state.offlineSyncInFlight = false;
    }

    request('/pos/local/sync-outbox', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        terminal_id: state.terminalId,
        branch_id: state.branchId
      })
    }).catch(function () {});
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

  function applyBrandInfo(brandData) {
    if(!brandData) return;
    state.brand=brandData;
    var logoImg=$('pos-client-logo-img');
    var rawUrl=brandData.logo_url;
    if(!rawUrl || rawUrl.includes('logo-test') || rawUrl.includes('med_f354dbe8da0bea01')){
      rawUrl='/assets/pwa/icon-192.png';
    }
    if(logoImg){
      logoImg.src=rawUrl;
    }
    if($('pos-brand-name') && brandData.name){
      $('pos-brand-name').textContent=brandData.name;
    }
  }

  async function loadBrandInfo() {
    try{
      var cached=JSON.parse(localStorage.getItem('xentra_pos_brand_info')||'null');
      if(cached && cached.logo_url && (cached.logo_url.includes('logo-test') || cached.logo_url.includes('med_f354dbe8da0bea01'))){
        localStorage.removeItem('xentra_pos_brand_info');
        cached=null;
      }
      if(cached) applyBrandInfo(cached);
      var d=await request('/brand/info');
      if(d && d.brand){
        applyBrandInfo(d.brand);
        try{ localStorage.setItem('xentra_pos_brand_info',JSON.stringify(d.brand)); }catch(_){}
      }
    }catch(_){}
  }

  function applyCashierUser(userData) {
    state.user=userData;
    state.branchId=userData.branch_id || userData.branchId || null;
    if(state.branchId) localStorage.setItem('xentra_pos_branch_id',String(state.branchId));
    var cleanBranchName=userData.branch_name || (state.brand && state.brand.name) || 'Bangjo Pringsewu';
    if ($('pos-branch-name')) $('pos-branch-name').textContent=cleanBranchName;
    if ($('pos-branch-name-desktop')) $('pos-branch-name-desktop').textContent=cleanBranchName;
    if (userData.brand_name && $('pos-brand-name')) $('pos-brand-name').textContent=userData.brand_name;
    if ($('pos-cashier-name')) $('pos-cashier-name').textContent=userData.full_name || userData.username || 'Kasir';
    var userIcon = document.querySelector('#pos-user-profile-btn .pos-user-icon');
    if (userIcon) {
      if (userData.avatar_url) {
        userIcon.innerHTML = '<img src="' + esc(userData.avatar_url) + '" alt="' + esc(userData.full_name || 'Kasir') + '">';
      } else {
        userIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>' +
          '<circle cx="12" cy="7" r="4"></circle>' +
        '</svg>';
      }
    }
    loadBrandInfo();
    updateHeldCount();
  }

  function showPosAuthGate(offlineReason, setupMode) {
    var gate=$('pos-auth-gate'); if(!gate) return;
    var badge=$('pos-auth-badge'), subtitle=$('pos-auth-subtitle'), input=$('pos-login-pin'), error=$('pos-pin-login-error');
    var form=$('pos-pin-login-form'), divider=document.querySelector('.pos-auth-divider');
    var googleBtn=$('btn-pos-google-login'), accountBtn=$('btn-pos-account-login');
    setupMode=!!setupMode;
    if(setupMode){
      badge.textContent='AKTIVASI TERMINAL'; badge.className='pos-auth-badge';
      subtitle.textContent='Perangkat POS ini belum dihubungkan ke cabang. Masuk dengan akun kasir atau pengelola untuk mengaktifkan terminal di perangkat ini.';
      if(form) form.style.display='none';
      if(divider) divider.style.display='none';
      if(googleBtn) googleBtn.style.display='flex';
      if(accountBtn){
        accountBtn.textContent='Masuk dengan akun Xentra untuk aktivasi';
        accountBtn.style.display='block';
      }
    }else{
      if(form) form.style.display='';
      if(divider) divider.style.display='';
      if(googleBtn) googleBtn.style.display='flex';
      if(accountBtn){
        accountBtn.textContent='Gunakan email / password';
        accountBtn.style.display='block';
      }
      if(offlineReason){
        badge.textContent='OFFLINE / PIN TERSIMPAN'; badge.className='pos-auth-badge offline';
        subtitle.textContent='Koneksi ke Core tidak tersedia atau terlalu lambat. Masukkan PIN POS untuk membuka salah satu kasir yang sudah pernah digunakan di terminal ini.';
      }else{
        badge.textContent='PIN Kasir'; badge.className='pos-auth-badge';
        subtitle.textContent='Masukkan PIN 6 digit untuk masuk cepat ke akun Kasir.';
      }
    }
    if(error) error.textContent='';
    if(input){
      input.value='';
      if(!setupMode) setTimeout(function(){input.focus();},50);
    }
    gate.style.display='flex';
  }

  function hidePosAuthGate(){var gate=$('pos-auth-gate');if(gate)gate.style.display='none';}

  function isTerminalManagerRole(role){
    return ['owner','brand_manager','branch_manager'].includes(role);
  }

  function isTerminalSetupRequested(){
    try{
      var params=new URLSearchParams(window.location.search);
      if(params.get('terminal_setup')==='1') return true;
      return sessionStorage.getItem('xentra_pos_terminal_setup_requested')==='1';
    }catch(_){ return false; }
  }

  function clearTerminalSetupMarker(){
    try{sessionStorage.removeItem('xentra_pos_terminal_setup_requested');}catch(_){}
    try{
      var params=new URLSearchParams(window.location.search);
      if(params.has('terminal_setup')){
        params.delete('terminal_setup');
        var cleanQuery=params.toString();
        var cleanUrl=window.location.pathname+(cleanQuery?'?'+cleanQuery:'')+window.location.hash;
        window.history.replaceState({},document.title,cleanUrl);
      }
    }catch(_){}
  }

  function getPosDeviceIdentifier(){
    var key='xentra_pos_device_identifier_v1';
    var current=localStorage.getItem(key);
    if(current) return current;
    var raw='';
    try{
      if(window.crypto && typeof window.crypto.randomUUID==='function') raw=window.crypto.randomUUID();
    }catch(_){}
    if(!raw) raw='posweb_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12);
    try{localStorage.setItem(key,raw);}catch(_){}
    return raw;
  }

  async function getTerminalBranchesForManager(managerUser){
    if(managerUser && managerUser.role==='branch_manager'){
      if(!managerUser.branch_id) throw new Error('Manager cabang belum memiliki cabang.');
      return [{id:managerUser.branch_id,name:managerUser.branch_name||'Cabang terdaftar'}];
    }
    var d=await request('/admin/branches',{headers:headers()});
    var branches=(d.branches||[]).filter(function(b){
      return b && b.id && !b.is_archived && Number(b.is_active)!==0;
    });
    return branches;
  }

  async function bootstrapTerminalForManager(managerUser){
    if(!isTerminalManagerRole(managerUser && managerUser.role)){
      return false;
    }

    var branches;
    try{
      branches=await getTerminalBranchesForManager(managerUser);
    }catch(err){
      clearTerminalSetupMarker();
      window.location.replace((managerUser && managerUser.role==='branch_manager')?'/merchant/':'/owner/');
      return false;
    }

    if(!branches.length){
      clearTerminalSetupMarker();
      throw new Error('Belum ada cabang aktif yang dapat digunakan untuk terminal POS.');
    }

    return await new Promise(function(resolve){
      var defaultBranchId=(managerUser && managerUser.branch_id) || branches[0].id;
      var options=branches.map(function(b){
        return '<option value="'+esc(b.id)+'"'+(String(b.id)===String(defaultBranchId)?' selected':'')+'>'+esc(b.name||b.id)+'</option>';
      }).join('');
      var initialName='Terminal POS - '+String((branches.find(function(b){return String(b.id)===String(defaultBranchId);})||branches[0]).name||'Kasir');
      var html=
        '<div class="pos-modal-head-row">'+
          '<div class="pos-modal-head-title"><h3>Aktifkan Terminal POS</h3><p>Otorisasi Owner / Manager</p></div>'+
          '<button type="button" class="pos-modal-close-icon" id="pos-terminal-bootstrap-close" title="Tutup" aria-label="Tutup">✕</button>'+
        '</div>'+
        '<div class="pos-shift-modal-body">'+
          '<div class="pos-shift-open-notice">'+
            '<div class="pos-shift-notice-icon">🖥️</div>'+
            '<div class="pos-shift-notice-text"><strong>Hubungkan perangkat ini ke cabang</strong><span>Terminal tetap milik cabang dan setelah diaktifkan dapat dipakai bergantian oleh kasir.</span></div>'+
          '</div>'+
          '<div class="pos-form-row"><label for="pos-terminal-branch">Cabang</label><select id="pos-terminal-branch" class="pos-input">'+options+'</select></div>'+
          '<div class="pos-form-row"><label for="pos-terminal-name">Nama terminal</label><input id="pos-terminal-name" class="pos-input" type="text" value="'+esc(initialName)+'" maxlength="80" autocomplete="off"></div>'+
          '<div id="pos-terminal-bootstrap-error" class="pos-auth-error"></div>'+
          '<div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-terminal-bootstrap-cancel" type="button">Batal</button><button class="pos-btn" id="pos-terminal-bootstrap-save" type="button">Aktifkan Terminal</button></div>'+
        '</div>';
      showModal(html);

      var closeBtn=$('pos-terminal-bootstrap-close');
      var cancelBtn=$('pos-terminal-bootstrap-cancel');
      var saveBtn=$('pos-terminal-bootstrap-save');
      var branchInput=$('pos-terminal-branch');
      var nameInput=$('pos-terminal-name');
      var errorEl=$('pos-terminal-bootstrap-error');

      function abortSetup(){
        hideModal();
        clearTerminalSetupMarker();
        window.location.replace((managerUser.role==='branch_manager')?'/merchant/':'/owner/');
        resolve(false);
      }

      if(closeBtn) closeBtn.onclick=abortSetup;
      if(cancelBtn) cancelBtn.onclick=abortSetup;

      if(saveBtn) saveBtn.onclick=async function(){
        var branchId=branchInput && branchInput.value;
        var deviceName=(nameInput && nameInput.value || '').trim() || initialName;
        if(!branchId){
          if(errorEl) errorEl.textContent='Cabang wajib dipilih.';
          return;
        }
        saveBtn.disabled=true;
        saveBtn.textContent='Memeriksa...';
        if(errorEl) errorEl.textContent='';
        try{
          var current=await request('/pos/terminal/current?branch_id='+encodeURIComponent(branchId),{headers:headers()});
          var terminal=current && current.terminal ? current.terminal : null;
          if(!terminal){
            saveBtn.textContent='Mengaktifkan...';
            var registered=await request('/pos/terminal/register',{
              method:'POST',
              headers:headers(),
              body:JSON.stringify({
                branch_id:branchId,
                device_name:deviceName,
                device_identifier:getPosDeviceIdentifier(),
                config_version:1
              })
            });
            terminal=registered && registered.terminal;
          }
          if(!terminal || !terminal.id) throw new Error('Terminal tidak berhasil didaftarkan.');
          state.terminalId=terminal.id;
          state.branchId=terminal.branch_id || branchId;
          localStorage.setItem('xentra_pos_terminal_id',String(state.terminalId));
          localStorage.setItem('xentra_pos_branch_id',String(state.branchId));
          clearTerminalSetupMarker();
          hideModal();

          // Manager authentication was only used to perform terminal administration.
          // Do not leave the Manager session active on the cashier execution surface.
          var managerToken=token();
          if(managerToken){
            fetch(API+'/auth/logout',{
              method:'POST',
              headers:{'Content-Type':'application/json','Authorization':'Bearer '+managerToken}
            }).catch(function(){});
          }
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          state.user=null;
          state.shift=null;

          var unlocked=await openPinUnlockGate(false,false);
          resolve(!!unlocked || !!token());
        }catch(err){
          if(errorEl) errorEl.textContent=err.message || 'Gagal mengaktifkan terminal.';
          saveBtn.disabled=false;
          saveBtn.textContent='Aktifkan Terminal';
        }
      };
    });
  }

  async function ensureTerminalForCashier(cashierUser){
    var branchId = (cashierUser && (cashierUser.branch_id || cashierUser.branchId)) || state.branchId;
    if(!branchId) return false;

    var currentTerminalId = state.terminalId || localStorage.getItem('xentra_pos_terminal_id');
    var currentBranchId = state.branchId || localStorage.getItem('xentra_pos_branch_id');

    // If we already have terminal ID and matching branch, check validity
    if(currentTerminalId && currentBranchId === branchId){
      try{
        var cur = await request('/pos/terminal/current?branch_id=' + encodeURIComponent(branchId), { headers: headers() });
        if(cur && cur.terminal && cur.terminal.id === currentTerminalId && cur.terminal.status === 'active'){
          return true;
        }
      }catch(_){
        // If offline or network check fails but we have cached terminal ID, trust local context
        if(!navigator.onLine) return true;
      }
    }

    // New device or replaced device detected for this cashier's branch:
    // Prompt cashier to connect/replace terminal for their branch seamlessly
    var branchName = (cashierUser && cashierUser.branch_name) || (state.brand && state.brand.name) || 'Cabang Terdaftar';
    var defaultDeviceName = 'Terminal Kasir - ' + branchName;

    return await new Promise(function(resolve){
      var html =
        '<div class="pos-modal-head-row">' +
          '<div class="pos-modal-head-title"><h3>Hubungkan Perangkat POS</h3><p>Pendaftaran Perangkat Kasir</p></div>' +
        '</div>' +
        '<div class="pos-shift-modal-body">' +
          '<div class="pos-shift-open-notice">' +
            '<div class="pos-shift-notice-icon">📱</div>' +
            '<div class="pos-shift-notice-text"><strong>Perangkat Baru Terdeteksi</strong><span>Hubungkan perangkat ini sebagai terminal aktif untuk cabang <b>' + esc(branchName) + '</b>. Jika sebelumnya ada perangkat lain untuk cabang ini, perangkat lama akan digantikan secara otomatis.</span></div>' +
          '</div>' +
          '<div class="pos-form-row"><label for="pos-cashier-terminal-name">Nama Perangkat</label><input id="pos-cashier-terminal-name" class="pos-input" type="text" value="' + esc(defaultDeviceName) + '" maxlength="80" autocomplete="off"></div>' +
          '<div id="pos-cashier-terminal-error" class="pos-auth-error"></div>' +
          '<div class="pos-modal-actions"><button class="pos-btn" id="pos-cashier-terminal-save" type="button" style="width:100%;">Aktifkan Perangkat Ini</button></div>' +
        '</div>';
      showModal(html);

      var saveBtn = $('pos-cashier-terminal-save');
      var nameInput = $('pos-cashier-terminal-name');
      var errorEl = $('pos-cashier-terminal-error');

      if(saveBtn){
        saveBtn.onclick = async function(){
          var deviceName = (nameInput && nameInput.value || '').trim() || defaultDeviceName;
          saveBtn.disabled = true;
          saveBtn.textContent = 'Menghubungkan Perangkat...';
          if(errorEl) errorEl.textContent = '';
          try{
            var res = await request('/pos/terminal/replace', {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify({
                branch_id: branchId,
                device_name: deviceName,
                device_identifier: getPosDeviceIdentifier(),
                config_version: 1
              })
            });
            var terminal = res && res.terminal;
            if(!terminal || !terminal.id) throw new Error('Gagal menghubungkan perangkat terminal.');

            state.terminalId = terminal.id;
            state.branchId = terminal.branch_id || branchId;
            localStorage.setItem('xentra_pos_terminal_id', String(state.terminalId));
            localStorage.setItem('xentra_pos_branch_id', String(state.branchId));
            clearTerminalSetupMarker();
            hideModal();
            toast('Perangkat berhasil terhubung ke cabang ' + branchName);
            resolve(true);
          }catch(err){
            if(errorEl) errorEl.textContent = err.message || 'Gagal mengaktifkan perangkat.';
            saveBtn.disabled = false;
            saveBtn.textContent = 'Aktifkan Perangkat Ini';
          }
        };
      }
    });
  }

  async function clearPosSessionAndReturnToPin(){
    clearNativeAuth();
    var currentToken=token();
    if(currentToken){
      fetch(API+'/auth/logout',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+currentToken}
      }).catch(function(){});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    state.user=null;
    state.shift=null;
    state.offlineMode=false;
    window.location.replace('/pos/');
  }

  function confirmCashierLogout(onCancel){
    // The shared POS modal is also closed by unrelated flows. Keep this
    // confirmation in its own overlay so background updates cannot dismiss it.
    var overlay=document.createElement('div');
    overlay.className='pos-modal pos-modal-logout-confirm';
    overlay.setAttribute('role','presentation');
    overlay.style.zIndex='200';
    overlay.innerHTML=
      '<div class="pos-modal-card" role="dialog" aria-modal="true" aria-labelledby="pos-logout-title">' +
        '<h3 id="pos-logout-title">Keluar dari POS?</h3>' +
        '<p>Sesi kasir di perangkat ini akan diakhiri. Anda perlu masuk kembali untuk menggunakan POS.</p>' +
        '<div class="pos-modal-actions">' +
          '<button type="button" class="pos-btn ghost" id="pos-logout-cancel">Tidak</button>' +
          '<button type="button" class="pos-btn" id="pos-logout-confirm">Ya, keluar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    function closeConfirmation(){
      document.removeEventListener('keydown',onKeyDown,true);
      overlay.remove();
    }
    function cancelLogout(){
      closeConfirmation();
      if(typeof onCancel==='function') onCancel();
    }
    function onKeyDown(event){
      if(event.key==='Escape'){
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelLogout();
      }
    }
    document.addEventListener('keydown',onKeyDown,true);
    overlay.addEventListener('click',function(event){
      if(event.target===overlay) event.preventDefault();
    });
    overlay.querySelector('#pos-logout-cancel').onclick=cancelLogout;
    overlay.querySelector('#pos-logout-confirm').onclick=function(){
      closeConfirmation();
      clearPosSessionAndReturnToPin();
    };
    overlay.querySelector('#pos-logout-cancel').focus();
  }

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
        syncNativeAuth();
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

  function openPinUnlockGate(offlineReason, setupMode) {
    return new Promise(function(resolve,reject){
      showPosAuthGate(offlineReason, setupMode);
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
        var returnUrl=window.location.origin + '/pos/' + (setupMode ? '?terminal_setup=1' : '');
        var brokerUrl='https://xentra.cloud/auth/broker?return_to=' + encodeURIComponent(returnUrl);
        window.location.href=brokerUrl;
      };
      var accountBtn=$('btn-pos-account-login');
      if (accountBtn) accountBtn.onclick=function(){
        if(setupMode){
          try{sessionStorage.setItem('xentra_pos_terminal_setup_requested','1');}catch(_){}
          window.location.replace('/login?pos_terminal_setup=1');
          return;
        }
        window.location.replace('/login');
      };
    });
  }


  function composer() {
    return state.composer;
  }

  function currentOrderType() {
    return composer().getOrderType();
  }

  function currentTable() {
    return composer().getTable();
  }

  function currentOrderId() {
    return composer().getOrderId();
  }

  function currentHeldBillId() {
    return composer().getHeldBillId();
  }

  function currentItems() {
    return composer().getDisplayItems();
  }

  function updateNativeStatusBar(hexColor, darkIcons) {
    var nativeBridge = window.XentraPos || window.XentraNative;
    if (nativeBridge && typeof nativeBridge.setStatusBarColor === 'function') {
      try {
        nativeBridge.setStatusBarColor(hexColor || '#ffffff', darkIcons !== false);
      } catch (_) {}
    }
  }

  function syncNativeAuth() {
    var nativeBridge = window.XentraPos || window.XentraNative;
    if (nativeBridge && typeof nativeBridge.syncAuth === 'function') {
      try {
        var t = token();
        var b = state.branchId || (state.terminal && state.terminal.branch_id) || localStorage.getItem('xentra_pos_branch_id') || '';
        if (t && b) nativeBridge.syncAuth(t, b);
      } catch (_) {}
    }
  }

  function clearNativeAuth() {
    var nativeBridge = window.XentraPos || window.XentraNative;
    if (nativeBridge && typeof nativeBridge.clearAuth === 'function') {
      try { nativeBridge.clearAuth(); } catch (_) {}
    }
  }

  function setView(view) {
    document.querySelectorAll('.pos-view').forEach(function(v){ v.classList.toggle('active', v.id === 'pos-view-' + view); });
    document.querySelectorAll('.pos-bottom-nav button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-view') === view); });
    var mCartBar = $('pos-mobile-cart-bar');
    if (mCartBar) {
      if (view !== 'kasir' || !composer().hasItems()) {
        mCartBar.classList.add('hidden');
        closeMobileCartOverlay();
      } else {
        mCartBar.classList.remove('hidden');
      }
    }
    // Dynamic adaptive status bar matching view background
    updateNativeStatusBar('#ffffff', true);
    if (view === 'kasir') loadMenu();
    if (view === 'transaksi') loadSales();
    if (view === 'meja') loadTables();
    if (view === 'shift') { renderShift(); openShiftModal(); }
  }

  function total() {
    return composer().total();
  }

  function updateMenuCardBadges(){
    var menuCart=composer().getDisplayItems();
    var allProducts = Array.isArray(state.menu && state.menu.products) ? state.menu.products : [];
    document.querySelectorAll('.pos-product[data-product-id]').forEach(function(card){
      var pid=card.dataset.productId;
      var cardIdentity=card.dataset.identity || '';
      if(!cardIdentity){
        var p=allProducts.find(function(x){return String(x.id)===String(pid) || String(x.menu_id)===String(pid);});
        cardIdentity = p && p.menu_id ? 'menu:' + String(p.menu_id) : (p ? 'product:' + String(p.id) : ('product:' + String(pid)));
        card.dataset.identity = cardIdentity;
      }
      var qty=menuCart.reduce(function(acc,item){
        var matches = menuCartIdentity(item) === cardIdentity ||
                      (item.menu_id && String(item.menu_id) === String(pid)) ||
                      (item.product_id != null && String(item.product_id) === String(pid));
        return matches ? acc+(Number(item.quantity)||0) : acc;
      },0);
      var badge=card.querySelector('.pos-product-cart-badge');
      var stepper=card.querySelector('.pos-card-stepper');
      var addBtn=card.querySelector('.pos-product-add-btn');
      var qtyVal=card.querySelector('.pos-card-qty-val');

      if(qty>0){
        card.classList.add('in-cart');
        if(badge){
          badge.textContent=qty;
          badge.classList.remove('pos-badge-pop');
          void badge.offsetWidth;
          badge.classList.add('pos-badge-pop');
        }else{
          var b=document.createElement('span');
          b.className='pos-product-cart-badge pos-badge-pop';
          b.textContent=qty;
          card.appendChild(b);
        }
        if(stepper){
          var wasHidden = stepper.classList.contains('hidden');
          stepper.classList.remove('hidden');
          if(wasHidden){
            stepper.classList.remove('pos-stepper-pop');
            void stepper.offsetWidth;
            stepper.classList.add('pos-stepper-pop');
          }
          if(qtyVal){
            qtyVal.textContent=qty;
            qtyVal.classList.remove('pos-val-bump');
            void qtyVal.offsetWidth;
            qtyVal.classList.add('pos-val-bump');
          }
        }
        if(addBtn) addBtn.classList.add('hidden');
      }else{
        card.classList.remove('in-cart');
        if(badge) badge.remove();
        if(stepper) stepper.classList.add('hidden');
        if(addBtn){
          var wasHidden = addBtn.classList.contains('hidden');
          addBtn.classList.remove('hidden');
          if(wasHidden){
            addBtn.classList.remove('pos-btn-pop');
            void addBtn.offsetWidth;
            addBtn.classList.add('pos-btn-pop');
          }
        }
      }
    });
  }

  function formatTableLabel(t) {
    if (!t) return 'Belum dipilih';
    var lbl = (t.label || '').trim();
    var num = t.table_number != null ? String(t.table_number).trim() : '';
    if (lbl) {
      if (/^meja\b/i.test(lbl)) {
        return 'Meja ' + lbl.replace(/^meja\s*/i, '').trim();
      }
      return lbl;
    }
    return num ? ('Meja ' + num) : 'Belum dipilih';
  }

  function openMobileCartOverlay() {
    openOrderDetailsModal();
  }

  function closeMobileCartOverlay() {
    hideModal();
  }

  function confirmClearSale(onCancel) {
    var tx=composer();
    var items=tx.getDisplayItems();
    if (!items.length) { resetSale(); return; }
    var qty=items.reduce(function(n,i){return n+(Number(i.quantity)||0);},0);
    showModal('<div class="pos-modal-head-row"><div class="pos-modal-head-title"><h3>Hapus Pesanan?</h3>'+
      '<p>Semua item ('+qty+' item · '+money(tx.total())+') akan dihapus dari pesanan.</p></div></div>'+
      '<div class="pos-order-modal-actions"><div class="pos-order-modal-action-row">'+
      '<button type="button" class="pos-btn ghost pos-order-modal-secondary-btn" id="pos-clear-confirm-no">Batal</button>'+
      '<button type="button" class="pos-btn danger pos-order-modal-secondary-btn" id="pos-clear-confirm-yes">Ya, Hapus</button>'+
      '</div></div>');
    $('pos-clear-confirm-no').onclick = function(){ if (onCancel) onCancel(); else hideModal(); };
    $('pos-clear-confirm-yes').onclick = function(){ hideModal(); resetSale(); };
  }

  function openOrderDetailsModal() {
    var tx=composer();
    var displayCart=tx.getDisplayItems();
    if (!displayCart.length) {
      return toast(tx.isAddition() ? 'Belum ada item tambahan.' : 'Keranjang pesanan masih kosong.');
    }
    var t=tx.total();
    var totalQty=displayCart.reduce(function(n,i){return n+(Number(i.quantity)||0);},0);
    var isDineIn=tx.getOrderType()==='dine_in';
    var tableLabel=formatTableLabel(tx.getTable());
    var orderTypeLabel=isDineIn ? tableLabel : (tx.getOrderType()==='pickup'?'Takeaway':'Delivery');
    var locked=tx.isExisting();
    var additionMode=tx.isAddition();

    var html='<div class="pos-modal-head-row">'+
      '<div class="pos-modal-head-title">'+
        '<h3>'+(additionMode?'Tambah Pesanan':'Rincian Pesanan')+'</h3>'+
        '<p>'+totalQty+' item · '+esc(orderTypeLabel)+'</p>'+
      '</div>'+
      '<button type="button" class="pos-modal-close-icon" id="pos-order-modal-close" title="Tutup" aria-label="Tutup">✕</button>'+
    '</div>';

    if(additionMode){
      html+='<div class="pos-order-addition-banner">Tambahan ini akan masuk ke Order yang sama setelah Merchant menerima pesanan.</div>';
    } else if(locked){
      html+='<div class="pos-order-locked-note">🔒 Pesanan sudah diproses Merchant. Menu lama tidak dapat diubah.</div>';
    }

    if (locked && !additionMode) {
      var memberBatches=tx.getPendingAdditions();
      if(memberBatches.length){
        html+='<section style="margin:10px 0;padding:11px 12px;border:1px solid #dbeafe;border-radius:12px;background:#eff6ff;">'+
          '<strong style="display:block;font-size:13px;color:#1e3a8a;margin-bottom:7px;">Kiriman dari Customer PWA</strong>';
        memberBatches.forEach(function(batch){
          var pending=batch.status==='pending_acceptance';
          var rejected=batch.status==='rejected';
          var cancelled=batch.status==='cancelled';
          var label=pending?'Menunggu Merchant':(rejected?'Ditolak':(cancelled?'Dibatalkan':'Diterima'));
          var color=pending?'#b45309':(rejected?'#be123c':(cancelled?'#475569':'#047857'));
          var batchItems=Array.isArray(batch.items)?batch.items:[];
          var summary=batchItems.map(function(item){
            return esc(item.name||item.product_name||'Menu')+' × '+esc(String(item.quantity||1));
          }).join(', ');
          html+='<div style="padding:8px 0;border-top:1px solid #dbeafe;font-size:11px;color:#334155;">'+
            '<div style="display:flex;justify-content:space-between;gap:8px;"><b>'+esc(batch.created_by_name||'Pelanggan aplikasi')+'</b><b style="color:'+color+';">'+label+'</b></div>'+
            '<div style="margin-top:3px;">'+(summary||'Tidak ada rincian item')+'</div>'+
            '<div style="display:flex;justify-content:space-between;margin-top:3px;"><span>'+money(Number(batch.subtotal)||0)+'</span>'+(batch.rejection_reason?'<span style="color:'+(cancelled?'#475569':'#9f1239')+';">'+esc(batch.rejection_reason)+'</span>':'')+'</div>'+
            '</div>';
        });
        html+='</section>';
      }
    }

    if (isDineIn) {
      var tableSelectedClass = currentTable() ? 'pos-table-selected' : 'pos-table-unselected';
      html += '<div class="pos-order-modal-table-row ' + tableSelectedClass + '">' +
        '<span><strong>Meja:</strong> ' + esc(tableLabel) + '</span>' +
        (additionMode || locked ? '' : '<button type="button" class="pos-btn small" id="pos-order-modal-change-table">' + (currentTable() ? 'Ubah Meja' : 'Pilih Meja') + '</button>') +
      '</div>';
    }

    html+='<div class="pos-order-modal-items">';
    displayCart.forEach(function(it,idx){
      var optSummary=(it.options&&it.options.length)?optionSummary(it.options):'';
      html+='<div class="pos-order-modal-item">'+
        '<div style="min-width:0;flex:1">'+
          '<div class="pos-order-modal-item-name">'+esc(it.name)+'</div>'+
          '<div class="pos-order-modal-item-meta">'+money(it.unit_price)+(optSummary?'<div class="pos-order-modal-item-options">'+esc(optSummary)+'</div>':'')+(it.note?'<div class="pos-order-modal-item-note">Catatan: '+esc(it.note)+'</div>':'')+'</div>'+
        '</div>'+
        '<div class="pos-cart-item-actions">'+
          '<button type="button" class="pos-qty minus" data-order-modal-idx="'+idx+'" data-order-modal-d="-1" aria-label="Kurangi"'+(locked?' aria-disabled="true"':'')+'>'+
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>'+
          '</button>'+
          '<span class="pos-qty-value">'+it.quantity+'</span>'+
          '<button type="button" class="pos-qty plus" data-order-modal-idx="'+idx+'" data-order-modal-d="1" aria-label="Tambah"'+(locked?' aria-disabled="true"':'')+'>'+
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'+
          '</button>'+
        '</div>'+
      '</div>';
    });
    html+='</div>';

    if(!additionMode){
      var custVal=$('pos-customer-name')?$('pos-customer-name').value:'';
      var noteVal=$('pos-order-note')?$('pos-order-note').value:'';
      html+='<div class="pos-form-row"><label>Nama Customer</label><input type="text" id="pos-modal-cust-name" value="'+esc(custVal)+'"'+(locked?' readonly':'')+'></div>';
      html+='<div class="pos-form-row"><label>Catatan Order</label><input type="text" id="pos-modal-order-note" value="'+esc(noteVal)+'"'+(locked?' readonly':'')+'></div>';
    }

    html+='<div class="pos-order-modal-totals"><div class="pos-order-modal-subtotal"><span>Subtotal</span><strong>'+money(t)+'</strong></div>'+
      '<div class="pos-order-modal-grand"><span>'+ (additionMode?'Total Tambahan':'Total Tagihan') +'</span><strong>'+money(t)+'</strong></div></div>';

    // Footer:
    // Takeaway (pickup): [ Hold Bill ] [ Hapus ] on one row, full-width [ Bayar Rp… ] below.
    // Dine-In: [ Hold Bill ] [ Hapus ] on row 1, full-width [ Kirim Pesanan ] below (or [ Kirim Tambahan ] in addition mode).
    // Held list lives in Transaksi → Pesanan Ditahan (N), not here.
    html+='<div class="pos-order-modal-actions"><div class="pos-order-modal-action-row">';
    if(!additionMode){
      html+='<button type="button" class="pos-btn ghost pos-order-modal-secondary-btn" id="pos-order-modal-hold"'+(locked?' disabled':'')+'>Hold Bill</button>';
      html+='<button type="button" class="pos-btn danger ghost pos-order-modal-secondary-btn" id="pos-order-modal-clear">Hapus</button>';
    } else {
      html+='<button type="button" class="pos-btn ghost pos-order-modal-secondary-btn" id="pos-order-modal-addition-cancel">Batal Tambahan</button>';
    }
    html+='</div>';

    var payLabel = additionMode ? 'Kirim Tambahan' : (isDineIn ? 'Kirim Pesanan' : 'Bayar ' + money(t));
    html+='<button type="button" class="pos-order-modal-pay-btn" id="pos-order-modal-pay"><span>'+payLabel+'</span>'+
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></button>';
    html+='</div>';

    showModal(html);

    $('pos-order-modal-close').onclick = hideModal;
    if ($('pos-order-modal-change-table')) {
      $('pos-order-modal-change-table').onclick = function(){
        openTableSelector(function(){
          openOrderDetailsModal();
        }, function(){
          openOrderDetailsModal();
        });
      };
    }
    if ($('pos-order-modal-hold')) $('pos-order-modal-hold').onclick = function(){
      var cn = $('pos-modal-cust-name'), on = $('pos-modal-order-note');
      if (cn && $('pos-customer-name') && !locked) $('pos-customer-name').value = cn.value;
      if (on && $('pos-order-note') && !locked) $('pos-order-note').value = on.value;
      hideModal();
      holdSale();
    };
    if ($('pos-order-modal-clear')) $('pos-order-modal-clear').onclick = function(){ confirmClearSale(openOrderDetailsModal); };
    if ($('pos-order-modal-addition-cancel')) $('pos-order-modal-addition-cancel').onclick = function(){ cancelAdditionalOrderMode(); };

    $('pos-order-modal-pay').onclick = function(){
      if (additionMode) {
        submitAdditionalOrder();
        return;
      }
      var cn = $('pos-modal-cust-name'), on = $('pos-modal-order-note');
      if (cn && $('pos-customer-name') && !locked) $('pos-customer-name').value = cn.value;
      if (on && $('pos-order-note') && !locked) $('pos-order-note').value = on.value;
      if (isDineIn) {
        if (!currentTable()) {
          openTableSelector(function(){
            hideModal();
            holdSale();
          }, function(){
            openOrderDetailsModal();
          });
          return;
        }
        hideModal();
        holdSale();
        return;
      }
      openPayModal();
    };

    var cnInput=$('pos-modal-cust-name');
    if(cnInput){
      cnInput.oninput=function(){if($('pos-customer-name')&&!locked)$('pos-customer-name').value=cnInput.value;};
      bindModalEnter(cnInput,function(){var on=$('pos-modal-order-note');if(on)on.focus();});
    }
    var onInput=$('pos-modal-order-note');
    if(onInput){
      onInput.oninput=function(){if($('pos-order-note')&&!locked)$('pos-order-note').value=onInput.value;};
      bindModalEnter(onInput,function(){var payBtn=$('pos-order-modal-pay');if(payBtn)payBtn.click();});
    }

    document.querySelectorAll('[data-order-modal-idx]').forEach(function(btn){
      btn.onclick=function(e){
        e.stopPropagation();
        var idx=Number(btn.getAttribute('data-order-modal-idx'));
        var d=Number(btn.getAttribute('data-order-modal-d'));
        changeQty(idx,d);
        if(!composer().getDisplayItems().length) hideModal();
        else openOrderDetailsModal();
      };
    });
  }

  function showOrderLockedWarning() {
    toast('Pesanan sudah diproses Merchant dan tidak dapat diubah. Gunakan + Tambah Pesanan untuk menambah menu.');
  }


  function renderCart() {
    var tx=composer();
    var mode=tx.getMode();
    var isDineIn = tx.getOrderType() === 'dine_in';
    var isAddition = tx.isAddition();
    var isExisting = tx.isExisting();
    var displayCart = tx.getDisplayItems();
    var displayTotal = tx.total();
    var tableCtx = $('pos-table-context');
    var hasTable = Boolean(currentTable());
    if (tableCtx) {
      tableCtx.classList.toggle('hidden', !isDineIn);
      tableCtx.classList.toggle('pos-table-selected', isDineIn && hasTable);
      tableCtx.classList.toggle('pos-table-unselected', isDineIn && !hasTable);
    }

    var box=$('pos-cart-items'), meta=$('pos-cart-meta'), subtotal=$('pos-subtotal'), grand=$('pos-total'), pay=$('pos-pay-total'), btn=$('btn-pos-pay'), payManyBtn=$('btn-pos-pay-many'), additionBtn=$('btn-pos-additional-order');
    if (meta) meta.textContent=displayCart.reduce(function(n,i){return n+(Number(i.quantity)||0);},0)+' item';
    if (subtotal) subtotal.textContent=money(displayTotal);
    if (grand) grand.textContent=money(displayTotal);
    if (pay) pay.textContent=money(displayTotal);

    if (btn) {
      if (!isExisting && state.branchOperationalOpen === false) {
        btn.innerHTML = 'Merchant Tutup <span>'+money(displayTotal)+'</span>';
        btn.disabled = true;
      } else {
        btn.innerHTML = isAddition
          ? 'Kirim Tambahan <span>'+money(displayTotal)+'</span>'
          : 'Bayar <span>'+money(displayTotal)+'</span>';
        btn.disabled=!displayCart.length || !state.shift || !!state.shift.active_break;
      }
      btn.classList.toggle('pos-btn-additional-submit', isAddition);
    }

    if (payManyBtn) {
      var canManyPay=isDineIn && isExisting && !!tx.getOrderId() && !!displayCart.length && !!state.shift && !state.shift.active_break;
      payManyBtn.classList.toggle('hidden',!canManyPay);
      payManyBtn.disabled=!canManyPay;
    }

    if (additionBtn) {
      var canAdd=isDineIn && tx.canAdd();
      additionBtn.hidden=!canAdd;
      additionBtn.classList.toggle('hidden', !canAdd);
    }

    var holdBtn=$('btn-pos-hold'), clearBtn=$('btn-pos-clear');
    if (holdBtn) {
      var canHold = !isExisting && !isAddition && state.branchOperationalOpen !== false;
      holdBtn.hidden=isExisting || isAddition;
      holdBtn.classList.toggle('hidden', isExisting || isAddition);
      holdBtn.disabled = !canHold;
    }
    if (clearBtn) {
      clearBtn.hidden=isExisting;
      clearBtn.classList.toggle('hidden', isExisting);
    }

    var tableLabel=$('pos-selected-table'),tableBtn=$('btn-pos-select-table');
    if(tableLabel) tableLabel.textContent=formatTableLabel(tx.getTable());
    if(tableBtn) {
      tableBtn.textContent=tx.getTable()?'Ubah':'Pilih Meja';
      tableBtn.hidden=isExisting || isAddition;
      tableBtn.classList.toggle('hidden', isExisting || isAddition);
    }

    var cartTableLabel=$('pos-cart-selected-table'), cartTableBtn=$('btn-pos-cart-select-table');
    if(cartTableLabel) cartTableLabel.textContent=formatTableLabel(tx.getTable());
    if(cartTableBtn) {
      cartTableBtn.textContent=tx.getTable()?'Ubah':'Pilih Meja';
      cartTableBtn.hidden=isExisting || isAddition;
      cartTableBtn.classList.toggle('hidden', isExisting || isAddition);
    }

    var custInput=$('pos-customer-name'), noteInput=$('pos-order-note');
    if(custInput){
      custInput.readOnly=isExisting || isAddition;
      custInput.classList.toggle('pos-input-locked', custInput.readOnly);
    }
    if(noteInput){
      noteInput.readOnly=isExisting || isAddition;
      noteInput.classList.toggle('pos-input-locked', noteInput.readOnly);
    }

    var additionBanner=$('pos-order-addition-banner');
    if(additionBanner){
      additionBanner.classList.toggle('hidden',!isAddition);
      additionBanner.textContent=isAddition ? 'Tambah Pesanan — item ini akan masuk ke order Meja ' + (tx.getTable() ? (tx.getTable().table_number || '') : '') : '';
    }

    var totalQty=displayCart.reduce(function(n,i){return n+(Number(i.quantity)||0);},0);
    var mCartBar=$('pos-mobile-cart-bar');
    if(mCartBar){
      var activeView=document.querySelector('.pos-view.active');
      var isKasir=!activeView||activeView.id==='pos-view-kasir';
      if(totalQty>0&&isKasir){
        mCartBar.classList.remove('hidden');
        var mQty=$('pos-mcart-qty'),mTotal=$('pos-mcart-total'),mBtn=$('btn-pos-mcart-checkout');
        if(mQty)mQty.textContent=totalQty;
        if(mTotal)mTotal.textContent=money(displayTotal);
        if(mBtn){
          var isClosed = !isExisting && state.branchOperationalOpen === false;
          var mLabel = isClosed ? 'Merchant Tutup' : (isAddition ? 'Kirim Tambahan' : 'Bayar Sekarang');
          var mSpan = mBtn.querySelector('span'); if(mSpan) mSpan.textContent = mLabel;
          mBtn.disabled = isClosed;
        }
      }else{
        mCartBar.classList.add('hidden');
        closeMobileCartOverlay();
      }
    }

    updateMenuCardBadges();
    if(!box)return;
    if(!displayCart.length){
      box.innerHTML=isAddition
        ? '<div class="pos-empty">Belum ada item tambahan.</div>'
        : '<div class="pos-empty">Belum ada item.</div>';
      return;
    }

    box.innerHTML=displayCart.map(function(it,idx){
      var locked=isExisting;
      return '<div class="pos-cart-item'+(locked?' pos-cart-item-locked':'')+'">'+
        '<div><div class="pos-cart-item-name">'+esc(it.name)+'</div>'+
        '<div class="pos-cart-item-meta">'+money(it.unit_price)+
        (it.options&&it.options.length?'<div class="pos-cart-item-options">'+esc(optionSummary(it.options))+'</div>':'')+
        (it.note?'<div class="pos-cart-item-note">Catatan: '+esc(it.note)+'</div>':'')+
        '</div></div>'+
        '<div class="pos-cart-item-actions">'+
          '<button type="button" class="pos-qty minus" data-idx="'+idx+'" data-d="-1" aria-label="Kurangi"'+(locked?' aria-disabled="true"':'')+'>'+
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>'+
          '</button>'+
          '<span class="pos-qty-value">'+it.quantity+'</span>'+
          '<button type="button" class="pos-qty plus" data-idx="'+idx+'" data-d="1" aria-label="Tambah"'+(locked?' aria-disabled="true"':'')+'>'+
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'+
          '</button>'+
        '</div>'+
      '</div>';
    }).join('');

    box.querySelectorAll('.pos-qty').forEach(function(b){
      b.onclick=function(e){
        e.stopPropagation();
        changeQty(Number(b.dataset.idx),Number(b.dataset.d));
      };
    });
  }

  function changeQty(i,d){
    try{
      composer().changeQty(i,d);
      renderCart();
    }catch(e){
      showOrderLockedWarning();
    }
  }

  function menuCartIdentity(item){
    if (item && item.menu_id) return 'menu:' + String(item.menu_id);
    return 'product:' + String(item && item.product_id != null ? item.product_id : '');
  }

  function decrementProduct(p, e){
    if(e&&e.stopPropagation)e.stopPropagation();
    try{
      var targetIdentity = p && p.menu_id ? 'menu:' + String(p.menu_id) : 'product:' + String(p.id);
      var items=composer().getDisplayItems();
      for(var i=items.length-1;i>=0;i--){
        if(menuCartIdentity(items[i])===targetIdentity){
          composer().changeQty(i,-1);
          renderCart();
          return;
        }
      }
    }catch(err){
      showOrderLockedWarning();
    }
  }

  function incrementProduct(p,e){
    if(e&&e.stopPropagation)e.stopPropagation();
    try{
      var targetIdentity = p && p.menu_id ? 'menu:' + String(p.menu_id) : 'product:' + String(p.id);
      var items=composer().getDisplayItems();
      if(optionGroups(p).length>0){
        for(var i=items.length-1;i>=0;i--){
          if(menuCartIdentity(items[i])===targetIdentity){
            composer().changeQty(i,1);
            renderCart();
            return;
          }
        }
        return openProductOptions(p);
      }
      return addConfiguredProduct(p,[], '');
    }catch(err){
      showOrderLockedWarning();
    }
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
    var unitPrice=clientOptionPrice(p,cleanSelections);
    var payload={
      product_id:p.menu_id ? (p.product_id || null) : p.id,
      name:p.name || p.product_name || p.title || 'Menu',
      unit_price:unitPrice,
      quantity:1,
      options:cleanSelections,
      note:note||''
    };

    if (p.menu_id) {
      payload.menu_id=p.menu_id;
      payload.menu_type=p.menu_type || 'SINGLE';
      payload.component_snapshot=Array.isArray(p.components) ? p.components : (Array.isArray(p.component_snapshot) ? p.component_snapshot : []);
      payload.menu_snapshot=p.menu_snapshot || {
        menu_id:p.menu_id,
        menu_type:p.menu_type || 'SINGLE',
        title:p.name || p.title || '',
        subtitle:p.subtitle || null,
        price:Number(p.price || 0),
        category:p.category || null,
        sub_category:p.sub_category || null,
        rasa:p.rasa || null,
        level:p.level || null,
        status:p.status || 'ACTIVE'
      };
    }

    try{
      composer().addItem(payload);
      renderCart();
    }catch(e){
      showOrderLockedWarning();
    }
  }

  function addProduct(p){
    if(state.branchOperationalOpen === false) {
      toast('Merchant sedang tutup. Buka cabang terlebih dahulu.', 'error');
      return;
    }
    if(!p || p.is_available === 0 || p.is_available === false || (p.inventory && p.inventory.stock_estimate <= 0 && p.blocking_reason === 'OUT_OF_STOCK')) {
      toast('Stok produk habis', 'error');
      return;
    }
    if(composer().isExisting()) return showOrderLockedWarning();
    if(optionGroups(p).length > 0) {
      return openProductOptions(p);
    }
    return addConfiguredProduct(p,[], '');
  }

  function openProductOptions(p){
    if(state.branchOperationalOpen === false) {
      toast('Merchant sedang tutup. Buka cabang terlebih dahulu.', 'error');
      return;
    }
    if(composer().isExisting()) return showOrderLockedWarning();
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
    bindModalEnter($('pos-item-note'), function(){
      var btn = $('pos-option-add');
      if (btn) btn.click();
    });
  }

  var CATEGORY_PALETTES = [
    { border: '#3b82f6', bg: '#eff6ff', text: '#1d4ed8' },
    { border: '#f59e0b', bg: '#fffbeb', text: '#b45309' },
    { border: '#10b981', bg: '#ecfdf5', text: '#047857' },
    { border: '#8b5cf6', bg: '#f5f3ff', text: '#6d28d9' },
    { border: '#f97316', bg: '#fff7ed', text: '#c2410c' },
    { border: '#06b6d4', bg: '#ecfeff', text: '#0e7490' },
    { border: '#ec4899', bg: '#fdf2f8', text: '#be185d' },
    { border: '#6366f1', bg: '#eef2ff', text: '#4338ca' }
  ];

  function getCategoryColor(catId, index) {
    if (!catId) return { border: '#9ca3af', bg: '#f3f4f6', text: '#374151' };
    var idx = typeof index === 'number' && index >= 0 ? index : 0;
    if (typeof index !== 'number' || index < 0) {
      var s = String(catId), h = 0;
      for (var i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
      idx = Math.abs(h);
    }
    return CATEGORY_PALETTES[idx % CATEGORY_PALETTES.length];
  }

  function renderMenu(){
    var tabs=$('pos-category-tabs'), grid=$('pos-product-grid');
    var cats=state.menu.categories || [];
    var allProducts=Array.isArray(state.menu.products)?state.menu.products:[];

    var stats=$('pos-menu-stats');
    if (stats) stats.textContent=allProducts.length?(allProducts.length+' menu'):'Katalog';

    if(tabs){
      var totalCount=allProducts.length;
      var popularProducts=allProducts.filter(function(p){
        return p.is_popular===1||p.is_popular===true||p.is_featured===1||p.is_featured===true;
      });
      if(!popularProducts.length && allProducts.length>0) popularProducts=allProducts.slice(0,6);

      var html='<button class="pos-cat-tab '+(state.category==='all'?'active':'')+'" data-cat="all"><span>Semua</span><small class="pos-cat-count">'+totalCount+'</small></button>';
      if(popularProducts.length>0){
        html+='<button class="pos-cat-tab pos-cat-popular '+(state.category==='popular'?'active':'')+'" data-cat="popular"><span>★ Populer</span><small class="pos-cat-count">'+popularProducts.length+'</small></button>';
      }
      cats.forEach(function(c,idx){
        var col=getCategoryColor(c.id,idx);
        var cCount=allProducts.filter(function(p){
          return String(p.category_id)===String(c.id)||(Array.isArray(p.category_ids)&&p.category_ids.map(String).indexOf(String(c.id))!==-1);
        }).length;
        var isActive=String(state.category)===String(c.id);
        html+='<button class="pos-cat-tab '+(isActive?'active':'')+'" data-cat="'+esc(c.id)+'" style="--cat-color:'+col.border+'"><span>'+esc(c.name||c.title)+'</span><small class="pos-cat-count">'+cCount+'</small></button>';
      });

      tabs.innerHTML=html;
      tabs.querySelectorAll('button').forEach(function(b){ b.onclick=function(){state.category=b.dataset.cat;renderMenu();}; });
    }

    var q=(state.search||'').trim().toLowerCase();
    var filtered=allProducts.filter(function(p){
      var okCat=true;
      if(state.category==='popular'){
        okCat=p.is_popular===1||p.is_popular===true||p.is_featured===1||p.is_featured===true||allProducts.slice(0,6).some(function(x){return String(x.id)===String(p.id);});
      }else if(state.category!=='all'){
        okCat=String(state.category)===String(p.category_id)||(Array.isArray(p.category_ids)&&p.category_ids.map(String).indexOf(String(state.category))!==-1);
      }
      var okQ=!q||String(p.name||p.product_name||'').toLowerCase().indexOf(q)!==-1;
      return okCat&&okQ;
    });

    if(grid){
      if(!filtered.length){
        grid.innerHTML='<div class="pos-empty">Menu tidak ditemukan'+(q?' untuk pencarian "'+esc(q)+'"':'')+'.</div>';
        return;
      }

      grid.innerHTML=filtered.map(function(p){
        var unavailable=p.is_available===0||p.is_available===false||(p.inventory && p.inventory.stock_estimate<=0 && p.blocking_reason==='OUT_OF_STOCK');
        var pName=p.name||p.product_name||'Produk';
        var cat=cats.find(function(c){return String(c.id)===String(p.category_id);});
        var catIndex=cat?cats.indexOf(cat):-1;
        var color=getCategoryColor(p.category_id,catIndex);
        var hasOpts=optionGroups(p).length>0;

        var composerCart=composer().getDisplayItems();
        var targetIdentity = p.menu_id ? 'menu:' + String(p.menu_id) : 'product:' + String(p.id);
        var cartQty=composerCart.reduce(function(acc,item){
          return menuCartIdentity(item)===targetIdentity?acc+(Number(item.quantity)||0):acc;
        },0);
        var orderLocked=composer().isExisting();

        var initials=(pName||'').split(' ').slice(0,2).map(function(w){return w.charAt(0);}).join('').toUpperCase()||'P';
        var mediaHtml='';
        var imgUrl=p.image_url || p.image || '';
        var overlayHabis=unavailable?'<span class="pos-photo-overlay-habis">Habis</span>':'';
        if(imgUrl){
          mediaHtml='<div class="pos-product-media"><img src="'+esc(imgUrl)+'" alt="'+esc(pName)+'" loading="lazy" class="pos-product-img" onerror="this.style.display=\'none\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'flex\';"><span class="pos-product-avatar" style="display:none;background:'+color.bg+';color:'+color.text+';border-color:'+color.border+'">'+esc(initials)+'</span>'+overlayHabis+'</div>';
        }else{
          mediaHtml='<div class="pos-product-media"><span class="pos-product-avatar" style="background:'+color.bg+';color:'+color.text+';border-color:'+color.border+'">'+esc(initials)+'</span>'+overlayHabis+'</div>';
        }

        var badgeHtml = '';
        if (unavailable) {
          badgeHtml = '<span class="pos-product-status pos-badge-out">Habis</span>';
        } else if (hasOpts) {
          badgeHtml = '<span class="pos-product-status pos-badge-opts">✦ Opsi</span>';
        }

        var stepperHtml = !unavailable ? (
          '<div class="pos-card-stepper pos-stepper '+(cartQty>0?'':'hidden')+'">' +
            '<button type="button" class="pos-card-qty-btn pos-stepper-btn minus" data-action="minus" aria-label="Kurangi">' + posStepperIcon('minus') + '</button>' +
            '<span class="pos-card-qty-val pos-stepper-value">' + (cartQty||0) + '</span>' +
            '<button type="button" class="pos-card-qty-btn pos-stepper-btn plus" data-action="plus" aria-label="Tambah">' + posStepperIcon('plus') + '</button>' +
          '</div>' +
          '<button type="button" class="pos-product-add-btn '+(cartQty>0?'hidden':'')+'" data-action="add" aria-label="Tambah ke pesanan">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
          '</button>'
        ) : '';

        return '<div role="button" tabindex="0" class="pos-product '+(unavailable?'disabled ':'')+(orderLocked?'order-locked ':'')+(cartQty>0?'in-cart':'')+'" data-product-id="'+esc(p.id)+'" data-identity="'+esc(targetIdentity)+'" aria-disabled="'+(orderLocked?'true':'false')+'">'+
          (cartQty>0?'<span class="pos-product-cart-badge">'+cartQty+'</span>':'')+
          mediaHtml+
          '<div class="pos-product-body">'+
            '<div class="pos-product-meta-row">'+
              (cat?'<span class="pos-product-cat-tag" style="background:'+color.bg+';color:'+color.text+'">'+esc(cat.name||cat.title)+'</span>':'<span class="pos-product-cat-tag" style="background:#f1f5f9;color:#475569">Menu</span>')+
              badgeHtml+
            '</div>'+
            '<div class="pos-product-name">'+esc(pName)+'</div>'+
            (p.description ? '<div class="pos-product-desc" style="font-size:11px;color:#64748B;line-height:1.2;margin:2px 0 4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+esc(p.description)+'">'+esc(p.description)+'</div>' : '')+
            '<div class="pos-product-footer">'+
              '<div class="pos-product-price">'+money(p.price||p.sale_price||p.regular_price)+'</div>'+
              stepperHtml+
            '</div>'+
          '</div>'+
        '</div>';
      }).join('');

      grid.querySelectorAll('.pos-product').forEach(function(card){
        var p=(Array.isArray(state.menu.products)?state.menu.products:[]).find(function(x){return String(x.id)===String(card.dataset.productId);});
        if(!p) return;

        var minusBtn = card.querySelector('.pos-card-qty-btn.minus');
        var plusBtn = card.querySelector('.pos-card-qty-btn.plus');
        var addBtn = card.querySelector('.pos-product-add-btn');

        if(minusBtn) minusBtn.onclick = function(e){ decrementProduct(p, e); };
        if(plusBtn) plusBtn.onclick = function(e){ incrementProduct(p, e); };
        if(addBtn) addBtn.onclick = function(e){ incrementProduct(p, e); };

        var isUnavailable = p.is_available === 0 || p.is_available === false || (p.inventory && p.inventory.stock_estimate <= 0 && p.blocking_reason === 'OUT_OF_STOCK');
        card.onclick = function(e){
          if(e.target.closest('button')) return;
          if(isUnavailable){
            toast('Stok produk habis', 'error');
            return;
          }
          addProduct(p);
        };
        card.onkeydown = function(e){
          if((e.key==='Enter'||e.key===' ') && !e.target.closest('button')){
            e.preventDefault();
            if(isUnavailable){
              toast('Stok produk habis', 'error');
              return;
            }
            addProduct(p);
          }
        };
      });
    }
  }

  function adaptCanonicalPosCatalog(data){
    var menus=Array.isArray(data && data.menus)?data.menus:[];
    var sourceCategories=Array.isArray(data && data.categories)?data.categories:[];
    var categoryMap={};
    var categories=[];

    sourceCategories.forEach(function(cat){
      var c={id:cat.id,name:cat.name||cat.title||'Menu',slug:cat.slug||'',products:[]};
      categoryMap[String(c.id)]=c;
      categories.push(c);
    });

    var products=[];
    menus.forEach(function(menu){
      var branchCategories=Array.isArray(menu.branch_categories)?menu.branch_categories:[];
      var categoryRefs=branchCategories.length
        ? branchCategories
        : (menu.category ? [menu.category] : []);

      var primaryCategory=categoryRefs[0] || menu.category || null;
      var product=Object.assign({},menu,{
        id:menu.menu_id || menu.id,
        menu_id:menu.menu_id || menu.id,
        product_id:menu.menu_type==='SINGLE' && Array.isArray(menu.components) && menu.components[0]
          ? menu.components[0].product_id
          : null,
        name:menu.title || menu.package_name || 'Menu',
        product_name:menu.title || menu.package_name || 'Menu',
        subtitle:menu.subtitle || null,
        price:Number(menu.price || 0),
        regular_price:Number(menu.price || 0),
        is_available:menu.is_available !== false,
        components:Array.isArray(menu.components)?menu.components:[],
        component_snapshot:Array.isArray(menu.components)?menu.components:[],
        category_id:primaryCategory ? primaryCategory.id : null,
        category_ids:categoryRefs.map(function(c){return c.id;}),
        category:primaryCategory,
        options_config:{version:1,groups:[]}
      });

      if(!products.some(function(existing){return String(existing.id)===String(product.id);})){
        products.push(product);
      }

      categoryRefs.forEach(function(refCat){
        var key=String(refCat.id);
        if(!categoryMap[key]){
          categoryMap[key]={id:refCat.id,name:refCat.name||'Menu',slug:refCat.slug||'',products:[]};
          categories.push(categoryMap[key]);
        }
        categoryMap[key].products.push(product);
      });
    });

    return {categories:categories,products:products};
  }

  async function loadMenu(){
    if(!state.branchId && state.user && state.user.branch_id) state.branchId = state.user.branch_id;
    if(!state.branchId)return;
    try{
      // Canonical Menu is the sole forward POS catalog source. A canonical
      // failure must not silently revive the legacy Product catalog.
      var data=await request('/catalog/composed-menu?branch_id='+encodeURIComponent(state.branchId),{headers:headers()});
      state.menu=adaptCanonicalPosCatalog(data);
      savePosMenuCache();
      renderMenu();
      state.coreConnection=true;
      updatePosReadiness();
    }catch(e){
      state.coreConnection=false;
      updatePosReadiness();
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

  async function openCashierProfileModal(){
    var u = state.user || user() || {};
    var onb = null;
    try {
      onb = await requestWithTimeout('/auth/cashier-onboarding/status', { headers: headers() }, 5000);
    } catch (_) {}

    var fullName = (onb && onb.name) || u.full_name || u.name || '';
    var email = (onb && onb.email) || u.email || 'kasir@xentra.cloud';
    var branchName = (onb && onb.branch_name) || u.branch_name || (state.brand && state.brand.name) || 'Cabang POS';
    var avatarUrl = (onb && onb.avatar_url) || u.avatar_url || '';
    var hasNik = Boolean(onb && onb.has_nik);
    var maskedNik = (onb && onb.nik_masked) || '';

    var nikHtml = '';
    if (hasNik) {
      nikHtml = '<div class="pos-profile-nik-status">' +
        '<span class="pos-profile-nik-val">' + esc(maskedNik) + '</span>' +
        '<span class="pos-profile-nik-badge">Terdaftar</span>' +
      '</div>';
    } else {
      nikHtml = '<input id="pos-profile-input-nik" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="16" placeholder="Ketik 16 digit NIK / KTP" autocomplete="off">' +
        '<small>Wajib 16 digit angka sesuai identitas KTP asli.</small>';
    }

    var avatarImgHtml = avatarUrl
      ? '<img src="' + esc(avatarUrl) + '" alt="' + esc(fullName || 'Kasir') + '" class="pos-profile-avatar-img" id="pos-profile-avatar-preview">'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="pos-profile-avatar-placeholder"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';

    var html = '<div class="pos-modal-head-row">' +
      '<div class="pos-modal-head-title">' +
        '<h3>Profil &amp; Setting</h3>' +
        '<p>Kelola identitas kasir, perangkat cetak, dan suara POS</p>' +
      '</div>' +
      '<button type="button" class="pos-modal-close-icon" id="btn-close-profile-modal" title="Tutup" aria-label="Tutup">✕</button>' +
    '</div>' +
    '<div class="pos-settings-tabs" role="tablist" aria-label="Profil dan pengaturan POS">' +
      '<button type="button" class="active" id="pos-settings-tab-profile" role="tab" aria-selected="true">Profil &amp; Identitas</button>' +
      '<button type="button" id="pos-settings-tab-devices" role="tab" aria-selected="false">Printer &amp; Suara</button>' +
    '</div>' +
    '<div class="pos-settings-scroll">' +
    '<section id="pos-settings-profile-panel" class="pos-settings-panel">' +
    '<div class="pos-profile-card">' +
      '<div class="pos-profile-avatar" id="pos-profile-avatar-btn" title="Klik untuk ubah foto profil">' +
        avatarImgHtml +
        '<div class="pos-profile-avatar-badge" title="Ubah Foto">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>' +
        '</div>' +
      '</div>' +
      '<input type="file" id="pos-profile-avatar-input" accept="image/jpeg,image/png,image/webp" style="display:none;" aria-hidden="true">' +
      '<div class="pos-profile-info">' +
        '<div class="pos-profile-name">' + esc(fullName || 'Kasir Bertugas') + '</div>' +
        '<div class="pos-profile-badge">Kasir · ' + esc(branchName) + '</div>' +
        '<div class="pos-profile-email">' + esc(email) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="pos-profile-section-title">Data Identitas Operator</div>' +
    '<div class="pos-profile-group">' +
      '<div class="pos-profile-row">' +
        '<label for="pos-profile-input-name">Nama Lengkap (Sesuai KTP)</label>' +
        '<input id="pos-profile-input-name" type="text" placeholder="Masukkan nama lengkap" value="' + esc(fullName) + '" autocomplete="name">' +
      '</div>' +
      '<div class="pos-profile-row">' +
        '<label>Nomor Induk Kependudukan (NIK)</label>' +
        nikHtml +
      '</div>' +
    '</div>' +
    '<div class="pos-profile-section-title">PIN Operasional POS</div>' +
    '<div class="pos-profile-group">' +
      '<div class="pos-profile-row">' +
        '<label for="pos-profile-input-pin">Ubah PIN POS (Kosongkan jika tidak ingin diubah)</label>' +
        '<input id="pos-profile-input-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="Ketik 6 digit PIN baru" autocomplete="new-password">' +
      '</div>' +
      '<div class="pos-profile-row" id="pos-profile-row-confirm-pin" style="display:none;">' +
        '<label for="pos-profile-input-pin-confirm">Konfirmasi PIN Baru</label>' +
        '<input id="pos-profile-input-pin-confirm" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="Ketik ulang 6 digit PIN baru" autocomplete="new-password">' +
      '</div>' +
    '</div>' +
    '<div id="pos-profile-error" class="pos-auth-error" style="margin-bottom:8px;"></div>' +
    '<div class="pos-profile-actions">' +
      '<button type="button" class="pos-btn-save-profile" id="btn-save-cashier-profile">Simpan Perubahan</button>' +
      '<button type="button" class="pos-btn-logout-profile" id="btn-profile-logout">Keluar dari Kasir</button>' +
    '</div>' +
    '</section>' +
    '<section id="pos-settings-devices-panel" class="pos-settings-panel" style="display:none;">' +
      '<div class="pos-settings-card">' +
      '<div class="pos-settings-card-head"><span class="pos-settings-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/></svg></span><div><h4>Printer struk</h4><p>Hubungkan printer kasir dan pastikan hasil cetak terbaca.</p></div></div>' +
        '<div class="pos-settings-status" id="pos-settings-printer-status">Memeriksa printer…</div>' +
        '<div id="pos-settings-printer-native">' +
          '<label class="pos-settings-label" for="pos-settings-printer-select">Printer Bluetooth yang sudah dipasangkan</label>' +
          '<select id="pos-settings-printer-select" class="pos-settings-select"></select>' +
          '<div class="pos-settings-actions"><button type="button" class="pos-btn ghost" id="pos-settings-printer-test">Tes cetak</button><button type="button" class="pos-btn" id="pos-settings-printer-connect">Hubungkan</button></div>' +
        '</div>' +
        '<div id="pos-settings-printer-browser" style="display:none;"><p class="pos-settings-note">POS browser akan membuka dialog cetak perangkat. Pasang printer di pengaturan cetak Android/komputer, lalu pilih printer saat dialog muncul.</p><button type="button" class="pos-btn ghost" id="pos-settings-browser-print-test">Tes dialog cetak</button></div>' +
      '</div>' +
      '<div class="pos-settings-card">' +
      '<div class="pos-settings-card-head"><span class="pos-settings-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10 21h4"/></svg></span><div><h4>Suara kasir</h4><p>Atur bunyi konfirmasi pembayaran pada perangkat ini.</p></div></div>' +
        '<label class="pos-settings-toggle"><span><strong>Bunyi konfirmasi pembayaran</strong><small>Berbunyi setelah pembayaran berhasil tercatat.</small></span><input type="checkbox" id="pos-settings-sound-enabled"></label>' +
        '<label class="pos-settings-label" for="pos-settings-sound-volume">Volume bunyi</label>' +
        '<div class="pos-settings-volume"><input id="pos-settings-sound-volume" type="range" min="0" max="100" step="5"><strong id="pos-settings-sound-volume-value">75%</strong></div>' +
        '<button type="button" class="pos-btn ghost" id="pos-settings-sound-test">Tes suara</button>' +
        '<p class="pos-settings-note">Volume utama juga mengikuti tombol volume perangkat Android.</p>' +
      '</div>' +
    '</section>' +
    '</div>';

    showModal(html, 'pos-modal-profile-settings');
    bindPosSettingsTabs();
    bindPosDeviceSettings();

    if ($('btn-close-profile-modal')) {
      $('btn-close-profile-modal').onclick = hideModal;
    }

    if ($('btn-profile-logout')) {
      $('btn-profile-logout').onclick = function () {
        confirmCashierLogout(openCashierProfileModal);
      };
    }

    // Avatar upload handling via Xentra Media Engine
    var avatarBtn = $('pos-profile-avatar-btn');
    var avatarInput = $('pos-profile-avatar-input');
    if (avatarBtn && avatarInput) {
      avatarBtn.onclick = function () {
        avatarInput.click();
      };

      avatarInput.onchange = function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;

        // Basic client validation
        var validTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
          toast('Format gambar harus JPG, PNG, atau WebP.');
          avatarInput.value = '';
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          toast('Ukuran foto profil maksimal 10 MB.');
          avatarInput.value = '';
          return;
        }

        async function doUploadAvatar(cropSpec, previewDataUrl) {
          avatarBtn.classList.add('pos-profile-avatar-uploading');
          try {
            var base64Data = await new Promise(function (resolve, reject) {
              var r = new FileReader();
              r.onload = function () { resolve(r.result); };
              r.onerror = function () { reject(new Error('Gagal membaca berkas gambar.')); };
              r.readAsDataURL(file);
            });

            var payload = {
              image_base64: base64Data,
              mime_type: file.type,
              original_filename: file.name
            };
            if (cropSpec) {
              payload.crop_spec = cropSpec;
            }

            var res = await request('/auth/cashier-onboarding/avatar', {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify(payload)
            });

            if (res && res.success && res.avatar_url) {
              var newAvatarUrl = res.avatar_url;
              // Update state & stored user
              if (state.user) state.user.avatar_url = newAvatarUrl;
              var uStored = user();
              if (uStored) {
                uStored.avatar_url = newAvatarUrl;
                try { localStorage.setItem(USER_KEY, JSON.stringify(uStored)); } catch (_) {}
              }

              // Update avatar in modal
              var existingPreview = $('pos-profile-avatar-preview');
              if (existingPreview) {
                existingPreview.src = newAvatarUrl;
              } else {
                var placeholder = $('pos-profile-avatar-placeholder');
                if (placeholder) placeholder.remove();
                var newImg = document.createElement('img');
                newImg.src = newAvatarUrl;
                newImg.alt = fullName || 'Kasir';
                newImg.className = 'pos-profile-avatar-img';
                newImg.id = 'pos-profile-avatar-preview';
                avatarBtn.insertBefore(newImg, avatarBtn.firstChild);
              }

              // Update avatar in POS top header
              var userIcon = document.querySelector('#pos-user-profile-btn .pos-user-icon');
              if (userIcon) {
                userIcon.innerHTML = '<img src="' + esc(newAvatarUrl) + '" alt="' + esc(fullName || 'Kasir') + '">';
              }

              toast('Foto profil kasir berhasil diperbarui.');
            } else {
              throw new Error((res && (res.message || res.error)) || 'Gagal mengunggah foto profil.');
            }
          } catch (uploadErr) {
            toast(uploadErr.message || 'Gagal mengunggah foto profil.');
          } finally {
            avatarBtn.classList.remove('pos-profile-avatar-uploading');
            avatarInput.value = '';
          }
        }

        if (window.XentraCropEditor && typeof window.XentraCropEditor.open === 'function') {
          window.XentraCropEditor.open({
            source: file,
            assetType: 'avatar',
            aspectRatio: 1.0,
            title: 'Sesuaikan Potongan Foto Profil (1:1)',
            onConfirm: function (cropSpec, previewDataUrl) {
              doUploadAvatar(cropSpec, previewDataUrl);
            },
            onCancel: function () {
              avatarInput.value = '';
            }
          });
        } else {
          doUploadAvatar(null, null);
        }
      };
    }

    var pinInput = $('pos-profile-input-pin');
    var pinConfirmRow = $('pos-profile-row-confirm-pin');
    var pinConfirmInput = $('pos-profile-input-pin-confirm');
    var nikInput = $('pos-profile-input-nik');
    var nameInput = $('pos-profile-input-name');
    var errEl = $('pos-profile-error');
    var btnSave = $('btn-save-cashier-profile');

    if (pinInput && pinConfirmRow) {
      pinInput.oninput = function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 6);
        if (this.value.length > 0) {
          pinConfirmRow.style.display = 'flex';
        } else {
          pinConfirmRow.style.display = 'none';
        }
      };
    }
    if (pinConfirmInput) {
      pinConfirmInput.oninput = function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 6);
      };
    }
    if (nikInput) {
      nikInput.oninput = function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 16);
      };
    }

    if (btnSave) {
      btnSave.onclick = async function () {
        errEl.textContent = '';
        var newName = (nameInput ? nameInput.value : '').trim();
        var newNik = nikInput ? nikInput.value.trim() : null;
        var newPin = pinInput ? pinInput.value.trim() : '';
        var confirmPin = pinConfirmInput ? pinConfirmInput.value.trim() : '';

        if (!newName || newName.length < 2) {
          errEl.textContent = 'Nama lengkap wajib diisi minimal 2 karakter.';
          return;
        }

        if (nikInput && (!newNik || !/^\d{16}$/.test(newNik))) {
          errEl.textContent = 'NIK wajib terdiri dari tepat 16 digit angka.';
          return;
        }

        if (newPin) {
          if (!/^\d{6}$/.test(newPin)) {
            errEl.textContent = 'PIN harus terdiri dari 6 digit angka.';
            return;
          }
          if (newPin !== confirmPin) {
            errEl.textContent = 'Konfirmasi PIN tidak cocok dengan PIN baru.';
            return;
          }
        }

        btnSave.disabled = true;
        btnSave.textContent = 'Menyimpan...';

        try {
          // 1. If PIN was modified, save PIN first
          if (newPin) {
            await request('/auth/cashier-onboarding/pin', {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify({ pin: newPin, pin_confirmation: confirmPin })
            });
            // Update offline PIN cache
            var updatedCred = await request('/auth/pos-pin', { headers: headers() });
            if (updatedCred && updatedCred.offline_credential) {
              savePosPinCache(updatedCred.user || state.user, updatedCred.offline_credential, state.branchId);
            }
          }

          // 2. Save identity
          var idPayload = { name: newName };
          if (newNik) idPayload.nik = newNik;

          var idRes = await request('/auth/cashier-onboarding/identity', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(idPayload)
          });

          if (idRes && idRes.success) {
            if (state.user) state.user.full_name = newName;
            var uStored = user();
            if (uStored) {
              uStored.full_name = newName;
              try { localStorage.setItem(USER_KEY, JSON.stringify(uStored)); } catch (_) {}
            }
            if ($('pos-cashier-name')) $('pos-cashier-name').textContent = newName;
            toast('Profil kasir berhasil diperbarui.');
            hideModal();
          } else {
            throw new Error((idRes && (idRes.message || idRes.error)) || 'Gagal menyimpan profil.');
          }
        } catch (saveErr) {
          errEl.textContent = saveErr.message || 'Gagal menyimpan data identitas.';
          btnSave.disabled = false;
          btnSave.textContent = 'Simpan Perubahan';
        }
      };
    }
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

  // Perangkat yang belum punya binding lokal (storage bersih / origin atau
  // domain baru) bisa meminta konteks terminalnya ke server. Server hanya
  // menjawab kalau brand di domain ini punya TEPAT SATU terminal aktif; kalau
  // tidak, perangkat tetap harus diaktivasi lewat akun manager.
  async function resolveTerminalContextFromServer(){
    if(!navigator.onLine) return false;
    try{
      var d=await requestWithTimeout('/pos/terminal/resolve',{},2500);
      if(!d || !d.success || !d.terminal || !d.terminal.id || !d.terminal.branch_id) return false;
      state.terminalId=d.terminal.id;
      state.branchId=d.terminal.branch_id;
      try{
        localStorage.setItem('xentra_pos_terminal_id',String(state.terminalId));
        localStorage.setItem('xentra_pos_branch_id',String(state.branchId));
      }catch(_){}
      return true;
    }catch(_){ return false; }
  }

  async function ensureSession(){
    var setupRequested=isTerminalSetupRequested();
    if(!token()){
      var hasTerminalContext=!!(state.terminalId && (state.branchId || localStorage.getItem('xentra_pos_branch_id')));
      if(!hasTerminalContext && !setupRequested){
        // Kasir tidak perlu aktivasi manager kalau terminalnya sudah terdaftar dan
        // cabangnya tidak ambigu.
        hasTerminalContext=await resolveTerminalContextFromServer();
      }
      await openPinUnlockGate(!navigator.onLine, !hasTerminalContext || setupRequested);
      return !!token() || !!state.user;
    }
    try {
      var me=await requestWithTimeout('/auth/merchant/me',{headers:headers()},5000);
      if(me && me.brand) applyBrandInfo(me.brand);

      if(me && me.user && isTerminalManagerRole(me.user.role)){
        if(setupRequested){
          return await bootstrapTerminalForManager(me.user);
        }
        var curH = window.location.hostname;
        var matchH = curH.match(/^(?:m|merchant|owner|dashboard|pos|kasir|admin|app|customer)\.(.+)$/);
        if (matchH) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          window.location.replace('/login?error=ROLE_MISMATCH&target=m');
          return false;
        }
        window.location.replace(me.landing || (me.user.role==='branch_manager'?'/merchant/':'/owner/'));
        return false;
      }

      applyCashierUser(me.user);
      if(state.user.role!=='cashier'){
        var curH = window.location.hostname;
        var matchH = curH.match(/^(?:m|merchant|owner|dashboard|pos|kasir|admin|app|customer)\.(.+)$/);
        if (matchH) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          window.location.replace('/login?error=ROLE_MISMATCH&target=m');
          return false;
        }
        window.location.replace(me.landing || '/merchant/');
        return false;
      }
      if(!state.branchId){ toast('Akun kasir belum memiliki cabang.'); return false; }

      // Mandatory Cashier Identity Onboarding Gate (Contract v1)
      try {
        var onb = await requestWithTimeout('/auth/cashier-onboarding/status', { headers: headers() }, 5000);
        if (onb && !onb.can_access_pos) {
          toast('Onboarding kasir belum selesai. Silakan lengkapi PIN dan identitas.');
          window.location.replace('/login');
          return false;
        }
      } catch (onbErr) {
        if (onbErr && (onbErr.code === 'CASHIER_ONBOARDING_REQUIRED' || onbErr.status === 403)) {
          toast('Onboarding kasir belum selesai. Silakan lengkapi PIN dan identitas.');
          window.location.replace('/login');
          return false;
        }
      }

      // Ensure this cashier's device is enrolled / bound as active terminal for their branch
      var terminalOk = await ensureTerminalForCashier(me.user);
      if(!terminalOk){
        return false;
      }

      await ensurePosPinConfigured();
      return true;
    } catch(err) {
      var cached=getPosPinCache();
      // Network/timeout/offline or expired session can be unlocked via PIN gate
      if(cached && cached.offline_credential) {
        if (err && err.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
        await openPinUnlockGate(err && (err.code==='NETWORK_TIMEOUT' || !navigator.onLine), false);
        return true;
      }
      // If network error/timeout but we have user in memory/storage, don't immediately redirect to login
      if (err && (err.code==='NETWORK_TIMEOUT' || !navigator.onLine) && user()) {
        applyCashierUser(user());
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
      var d=await request('/pos/terminal/current',{
        headers:headers()
      });
      state.terminalId=d.terminal ? d.terminal.id : (localStorage.getItem('xentra_pos_terminal_id') || null);
      if(d && d.terminal && d.terminal.branch_id){
        state.branchId=d.terminal.branch_id;
        localStorage.setItem('xentra_pos_branch_id',String(state.branchId));
      }
      state.coreConnection=true;
      if(d && d.branch){
        state.branchOperationalOpen = (d.branch.is_open_override === true || d.branch.is_open_override === 1) && d.branch.is_active !== false && d.branch.is_active !== 0;
        state.branchStatusReason = state.branchOperationalOpen ? 'open' : ((d.branch.is_open_override === false || d.branch.is_open_override === 0) ? 'closed' : 'inactive');
      }else{
        // Never infer GO from missing branch state. The readiness classifier
        // must not become green when branch operational state is unknown.
        state.branchOperationalOpen = null;
        state.branchStatusReason = 'unknown';
      }
      if(state.terminalId) localStorage.setItem('xentra_pos_terminal_id',state.terminalId);
      updatePosReadiness();
      renderCart();
      return !!state.terminalId;
    }catch(e){
      state.coreConnection=false;
      state.branchOperationalOpen=null;
      state.branchStatusReason='unknown';
      state.terminalId=state.terminalId || localStorage.getItem('xentra_pos_terminal_id') || null;
      return !!state.terminalId;
    }
  }

  async function refreshBranchOperationalState(){
    if(!token() || state.coreConnection !== true) return;
    try{
      var d=await request('/pos/terminal/current',{headers:headers()});
      if(d && d.branch){
        state.branchOperationalOpen = (d.branch.is_open_override === true || d.branch.is_open_override === 1) && d.branch.is_active !== false && d.branch.is_active !== 0;
        state.branchStatusReason = state.branchOperationalOpen ? 'open' : ((d.branch.is_open_override === false || d.branch.is_open_override === 0) ? 'closed' : 'inactive');
      }else{
        state.branchOperationalOpen = null;
        state.branchStatusReason = 'unknown';
      }
      updatePosReadiness();
      renderCart();
    }catch(e){
      // Keep the last known branch state during a transient refresh failure,
      // while Core reachability remains independently represented.
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
    updateTransaksiStats();
    updatePosReadiness();
  }

  function openShiftModal(){
    renderShiftStatus();
    var s = state.shift;
    var html = '';

    if (!s) {
      html = '<div class="pos-modal-head-row">' +
        '<div class="pos-modal-head-title">' +
          '<h3>Shift Kasir</h3>' +
          '<p>Operasional · Buka shift baru</p>' +
        '</div>' +
        '<button type="button" class="pos-modal-close-icon" id="pos-shift-modal-close" title="Tutup" aria-label="Tutup">✕</button>' +
      '</div>';

      html += '<div class="pos-shift-modal-body">' +
        '<div class="pos-shift-open-notice">' +
          '<div class="pos-shift-notice-icon">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
              '<circle cx="12" cy="12" r="10"></circle>' +
              '<polyline points="12 6 12 12 16 14"></polyline>' +
            '</svg>' +
          '</div>' +
          '<div class="pos-shift-notice-text">' +
            '<strong>Shift Belum Dibuka</strong>' +
            '<span>Kasir harus membuka shift sebelum penjualan dapat diselesaikan.</span>' +
          '</div>' +
        '</div>' +

        '<div class="pos-form-row">' +
          '<label for="pos-starting-float">Modal Kas Awal di Laci (Rp)</label>' +
          '<div class="pos-input-nominal-wrap">' +
            '<span class="pos-input-prefix">Rp</span>' +
            '<input id="pos-starting-float" type="text" inputmode="numeric" pattern="[0-9]*" value="0" placeholder="0" class="pos-input-nominal" autocomplete="off">' +
          '</div>' +
          '<div class="pos-shift-float-chips">' +
            '<button type="button" class="pos-btn-quick-cash active" data-float-val="0">Rp0</button>' +
            '<button type="button" class="pos-btn-quick-cash" data-float-val="50000">50k</button>' +
            '<button type="button" class="pos-btn-quick-cash" data-float-val="100000">100k</button>' +
            '<button type="button" class="pos-btn-quick-cash" data-float-val="200000">200k</button>' +
            '<button type="button" class="pos-btn-quick-cash" data-float-val="500000">500k</button>' +
          '</div>' +
        '</div>' +
      '</div>';

      html += '<div class="pos-modal-actions">' +
        '<button type="button" class="pos-btn ghost" id="pos-shift-modal-cancel">Batal</button>' +
        '<button type="button" class="pos-btn" id="btn-pos-open-shift-modal">Buka Shift Sekarang</button>' +
      '</div>';

      showModal(html, 'pos-modal-shift-start');
      $('pos-shift-modal-close').onclick = hideModal;
      $('pos-shift-modal-cancel').onclick = hideModal;
      var floatInput = $('pos-starting-float');
      if (floatInput) {
        setTimeout(function(){ floatInput.focus(); floatInput.select(); }, 120);
        document.querySelectorAll('[data-float-val]').forEach(function(chip){
          chip.onclick = function(){
            document.querySelectorAll('[data-float-val]').forEach(function(c){ c.classList.remove('active'); });
            chip.classList.add('active');
            floatInput.value = formatNominal(chip.dataset.floatVal);
            floatInput.focus();
          };
        });
        bindNominalInput(floatInput, function(numVal){
          document.querySelectorAll('[data-float-val]').forEach(function(c){
            c.classList.toggle('active', parseNominal(c.dataset.floatVal) === numVal);
          });
        });
        bindModalEnter(floatInput, function(){
          var btn = $('btn-pos-open-shift-modal');
          if (btn) btn.click();
        });
      }
      $('btn-pos-open-shift-modal').onclick = async function(){
        var amount = parseNominal(floatInput ? floatInput.value : 0);
        if (!Number.isFinite(amount) || amount < 0) return toast('Nominal modal awal tidak valid.');
        try {
          var d = await request('/pos/shifts/open', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ branch_id: state.branchId, starting_float: amount })
          });
          state.shift = d.shift;
          savePosShiftCache();
          renderShiftStatus();
          renderShift();
          renderCart();
          toast('Shift kasir berhasil dibuka.');
          openShiftModal();
        } catch(e) {
          toast(e.message);
        }
      };
      return;
    }

    var subtitle = formatShiftSubtitle(s);
    html = '<div class="pos-modal-head-row">' +
      '<div class="pos-modal-head-title">' +
        '<h3>Shift Kasir</h3>' +
        '<p>' + esc(subtitle) + '</p>' +
      '</div>' +
      '<button type="button" class="pos-modal-close-icon" id="pos-shift-modal-close" title="Tutup" aria-label="Tutup">✕</button>' +
    '</div>';

    html += '<div class="pos-shift-modal-body">' +
      '<div class="pos-shift-status-strip ' + (s.active_break ? 'is-break' : 'is-active') + '">' +
        '<div class="pos-shift-badge-wrap">' +
          '<span class="pos-shift-status-dot-pulse"></span>' +
          '<span class="pos-shift-status-title">' + (s.active_break ? 'Sedang Istirahat' : 'Shift Sedang Aktif') + '</span>' +
        '</div>' +
        '<button type="button" class="pos-btn small ghost pos-btn-break-toggle" id="btn-pos-shift-break-toggle">' +
          (s.active_break ? '▶ Selesai Istirahat' : '☕ Mulai Istirahat') +
        '</button>' +
      '</div>' +

      '<div class="pos-shift-modal-grid">' +
        '<div class="pos-shift-metric-card">' +
          '<span class="pos-metric-label">Modal Kas Awal</span>' +
          '<strong class="pos-metric-val">' + money(s.starting_float) + '</strong>' +
        '</div>' +
        '<div class="pos-shift-metric-card">' +
          '<span class="pos-metric-label">Penjualan Tunai</span>' +
          '<strong class="pos-metric-val positive">+' + money(s.total_cash_sales) + '</strong>' +
        '</div>' +
        '<div class="pos-shift-metric-card">' +
          '<span class="pos-metric-label">Cash In (Masuk)</span>' +
          '<strong class="pos-metric-val positive">+' + money(s.total_cash_in) + '</strong>' +
        '</div>' +
        '<div class="pos-shift-metric-card">' +
          '<span class="pos-metric-label">Cash Out (Keluar)</span>' +
          '<strong class="pos-metric-val negative">-' + money(s.total_cash_out) + '</strong>' +
        '</div>' +
      '</div>' +

      '<div class="pos-shift-expected-card">' +
        '<div class="pos-expected-header">' +
          '<div class="pos-expected-title">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
              '<rect x="2" y="4" width="20" height="16" rx="2"></rect>' +
              '<line x1="2" y1="10" x2="22" y2="10"></line>' +
            '</svg>' +
            '<span>Kas Ekspektasi di Laci</span>' +
          '</div>' +
          '<small>Modal + Tunai + In - Out</small>' +
        '</div>' +
        '<div class="pos-expected-amount">' + money(s.expected_cash) + '</div>' +
      '</div>' +

      '<div class="pos-shift-modal-actions-row">' +
        '<button type="button" class="pos-btn pos-btn-shift-cashin" id="btn-pos-modal-cash-in">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
          '<span>Cash In</span>' +
        '</button>' +
        '<button type="button" class="pos-btn pos-btn-shift-cashout" id="btn-pos-modal-cash-out">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
          '<span>Cash Out</span>' +
        '</button>' +
        '<button type="button" class="pos-btn danger ghost" id="btn-pos-modal-close-shift">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>' +
          '<span>Tutup Shift</span>' +
        '</button>' +
      '</div>' +
    '</div>';

    showModal(html);
    $('pos-shift-modal-close').onclick = hideModal;
    $('btn-pos-shift-break-toggle').onclick = async function(){
      await toggleShiftBreak();
      if (state.shift) openShiftModal();
    };
    $('btn-pos-modal-cash-in').onclick = function(){ openCashMoveModal('in', true); };
    $('btn-pos-modal-cash-out').onclick = function(){ openCashMoveModal('out', true); };
    $('btn-pos-modal-close-shift').onclick = function(){ openCloseShiftModal(); };
  }

  function openCashMoveModal(type, returnToShift){
    if (!state.shift) return;
    var isCashIn = type === 'in';
    var title = isCashIn ? 'Cash In (Kas Masuk)' : 'Cash Out (Kas Keluar)';
    var subtitle = isCashIn
      ? 'Catat uang masuk ke laci kasir di luar transaksi penjualan'
      : 'Catat pengeluaran uang tunai dari laci kasir';

    var html = '<div class="pos-modal-head-row">' +
      '<div class="pos-modal-head-title">' +
        '<h3>' + title + '</h3>' +
        '<p>' + subtitle + '</p>' +
      '</div>' +
      '<button type="button" class="pos-modal-close-icon" id="pos-cash-move-close" title="Tutup" aria-label="Tutup">✕</button>' +
    '</div>';

    html += '<div class="pos-shift-modal-body">' +
      '<div class="pos-form-row">' +
        '<label for="pos-cash-move-amount">Nominal ' + (isCashIn ? 'Kas Masuk' : 'Kas Keluar') + ' (Rp)</label>' +
        '<div class="pos-input-nominal-wrap">' +
          '<span class="pos-input-prefix">Rp</span>' +
          '<input id="pos-cash-move-amount" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="0" class="pos-input-nominal" autocomplete="off">' +
        '</div>' +
        '<div class="pos-shift-float-chips">' +
          '<button type="button" class="pos-btn-quick-cash" data-cm-val="10000">10k</button>' +
          '<button type="button" class="pos-btn-quick-cash" data-cm-val="20000">20k</button>' +
          '<button type="button" class="pos-btn-quick-cash" data-cm-val="50000">50k</button>' +
          '<button type="button" class="pos-btn-quick-cash" data-cm-val="100000">100k</button>' +
          '<button type="button" class="pos-btn-quick-cash" data-cm-val="200000">200k</button>' +
        '</div>' +
      '</div>' +

      '<div class="pos-form-row">' +
        '<label for="pos-cash-move-reason">Keterangan / Alasan (Wajib)</label>' +
        '<input id="pos-cash-move-reason" type="text" placeholder="' + (isCashIn ? 'Contoh: Tambah modal kembalian' : 'Contoh: Beli es batu / operasional') + '">' +
        '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">' +
          (isCashIn
            ? '<button type="button" class="pos-btn-quick-reason" data-qr-reason="Pengembalian Modal Kurir" style="font-size:11px;padding:4px 8px;border-radius:6px;background:#f1f5f9;border:1px solid #cbd5e1;cursor:pointer;font-weight:600;">🛵 Pengembalian Modal Kurir</button>' +
              '<button type="button" class="pos-btn-quick-reason" data-qr-reason="Tambah Modal Kembalian Kasir" style="font-size:11px;padding:4px 8px;border-radius:6px;background:#f1f5f9;border:1px solid #cbd5e1;cursor:pointer;font-weight:600;">💵 Tambah Modal Kasir</button>'
            : '<button type="button" class="pos-btn-quick-reason" data-qr-reason="Modal Kembalian Kurir" data-qr-amount="50000" style="font-size:11px;padding:4px 8px;border-radius:6px;background:#f1f5f9;border:1px solid #cbd5e1;cursor:pointer;font-weight:600;">🛵 Modal Kurir 50k</button>' +
              '<button type="button" class="pos-btn-quick-reason" data-qr-reason="Modal Kembalian Kurir" data-qr-amount="100000" style="font-size:11px;padding:4px 8px;border-radius:6px;background:#f1f5f9;border:1px solid #cbd5e1;cursor:pointer;font-weight:600;">🛵 Modal Kurir 100k</button>' +
              '<button type="button" class="pos-btn-quick-reason" data-qr-reason="Beli Es Batu / Operasional" style="font-size:11px;padding:4px 8px;border-radius:6px;background:#f1f5f9;border:1px solid #cbd5e1;cursor:pointer;font-weight:600;">🧊 Operasional</button>') +
        '</div>' +
      '</div>' +
    '</div>';

    html += '<div class="pos-modal-actions">' +
      '<button type="button" class="pos-btn ghost" id="pos-cash-move-cancel">Batal</button>' +
      '<button type="button" class="pos-btn" id="btn-pos-cash-move-submit">Simpan ' + (isCashIn ? 'Cash In' : 'Cash Out') + '</button>' +
    '</div>';

    showModal(html);
    var onDismiss = function(){
      if (returnToShift) openShiftModal(); else hideModal();
    };
    $('pos-cash-move-close').onclick = onDismiss;
    $('pos-cash-move-cancel').onclick = onDismiss;

    var amtInput = $('pos-cash-move-amount');
    if (amtInput) {
      setTimeout(function(){ amtInput.focus(); }, 120);
      document.querySelectorAll('[data-cm-val]').forEach(function(btn){
        btn.onclick = function(){
          amtInput.value = formatNominal(btn.dataset.cmVal);
          amtInput.focus();
        };
      });
      bindNominalInput(amtInput);
      bindModalEnter(amtInput, function(){
        var r = $('pos-cash-move-reason');
        if (r) r.focus();
      });
    }

    var reasonInput = $('pos-cash-move-reason');
    if (reasonInput) {
      document.querySelectorAll('.pos-btn-quick-reason').forEach(function(btn){
        btn.onclick = function(){
          if (btn.dataset.qrReason) reasonInput.value = btn.dataset.qrReason;
          if (amtInput && btn.dataset.qrAmount) {
            amtInput.value = formatNominal(btn.dataset.qrAmount);
          }
          if (amtInput && !btn.dataset.qrAmount && (!amtInput.value || amtInput.value === '0')) {
            amtInput.focus();
          }
        };
      });
      bindModalEnter(reasonInput, function(){
        var btn = $('btn-pos-cash-move-submit');
        if (btn) btn.click();
      });
    }

    $('btn-pos-cash-move-submit').onclick = async function(){
      var amount = parseNominal(amtInput ? amtInput.value : 0);
      if (!Number.isFinite(amount) || amount <= 0) return toast('Nominal tidak valid.');
      var reason = ($('pos-cash-move-reason') ? $('pos-cash-move-reason').value : '').trim();
      if (!reason) {
        if ($('pos-cash-move-reason')) $('pos-cash-move-reason').focus();
        return toast('Keterangan / alasan ' + (isCashIn ? 'Cash In' : 'Cash Out') + ' wajib diisi.');
      }
      try {
        var d = await request('/pos/shifts/' + encodeURIComponent(state.shift.id) + '/cash-movement', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ type: type, amount: amount, reason: reason })
        });
        state.shift = d.shift;
        savePosShiftCache();
        renderShiftStatus();
        renderShift();
        renderCart();
        toast(isCashIn ? 'Cash In berhasil dicatat.' : 'Cash Out berhasil dicatat.');
        openShiftModal();
      } catch(e) {
        toast(e.message);
      }
    };
  }

  function openCloseShiftModal(){
    if (!state.shift) return;
    var s = state.shift;
    var expected = Number(s.expected_cash || 0);

    var html = '<div class="pos-modal-head-row">' +
      '<div class="pos-modal-head-title">' +
        '<h3>Tutup Shift Kasir</h3>' +
        '<p>Hitung dan masukkan uang fisik aktual di laci kasir saat ini</p>' +
      '</div>' +
      '<button type="button" class="pos-modal-close-icon" id="pos-close-shift-close" title="Tutup" aria-label="Tutup">✕</button>' +
    '</div>';

    html += '<div class="pos-shift-modal-body">' +
      '<div class="pos-shift-expected-card" style="margin-bottom:12px">' +
        '<div class="pos-expected-header">' +
          '<div class="pos-expected-title">' +
            '<span>Kas Ekspektasi Sistem</span>' +
          '</div>' +
          '<small>Total uang yang seharusnya ada di laci</small>' +
        '</div>' +
        '<div class="pos-expected-amount">' + money(expected) + '</div>' +
      '</div>' +

      '<div class="pos-form-row">' +
        '<label for="pos-close-actual-cash">Uang Fisik Aktual di Laci (Rp)</label>' +
        '<div class="pos-input-nominal-wrap">' +
          '<span class="pos-input-prefix">Rp</span>' +
          '<input id="pos-close-actual-cash" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="0" class="pos-input-nominal" autocomplete="off">' +
        '</div>' +
        '<div style="margin-top:6px">' +
          '<button type="button" class="pos-btn small ghost" id="btn-pos-exact-drawer">Uang Pas Sesuai Sistem (' + money(expected) + ')</button>' +
        '</div>' +
        '<div id="pos-close-variance-preview" class="pos-variance-preview match">Selisih Kas: Rp0 (Sesuai)</div>' +
      '</div>' +
    '</div>';

    html += '<div class="pos-modal-actions">' +
      '<button type="button" class="pos-btn ghost" id="pos-close-shift-cancel">Batal</button>' +
      '<button type="button" class="pos-btn pos-btn-confirm-close-shift" id="btn-pos-confirm-close-shift">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="10"></circle>' +
          '<line x1="15" y1="9" x2="9" y2="15"></line>' +
          '<line x1="9" y1="9" x2="15" y2="15"></line>' +
        '</svg>' +
        '<span>Konfirmasi &amp; Tutup Shift</span>' +
      '</button>' +
    '</div>';

    showModal(html);
    $('pos-close-shift-close').onclick = function(){
      if (state.shift) openShiftModal(); else hideModal();
    };
    $('pos-close-shift-cancel').onclick = function(){
      if (state.shift) openShiftModal(); else hideModal();
    };

    var actualInput = $('pos-close-actual-cash');
    var varPreview = $('pos-close-variance-preview');

    function updateVariance(overrideVal){
      if (!actualInput || !varPreview) return;
      var actualVal = overrideVal != null ? overrideVal : parseNominal(actualInput.value || 0);
      var diff = actualVal - expected;
      if (diff === 0) {
        varPreview.className = 'pos-variance-preview match';
        varPreview.textContent = '✅ Selisih Kas: Rp0 (Sesuai / Pas)';
      } else if (diff < 0) {
        varPreview.className = 'pos-variance-preview danger';
        varPreview.textContent = '⚠️ Selisih Kas: -' + money(Math.abs(diff)) + ' (Kurang / Defisit)';
      } else {
        varPreview.className = 'pos-variance-preview warning';
        varPreview.textContent = 'ℹ️ Selisih Kas: +' + money(diff) + ' (Lebih / Surplus)';
      }
    }

    if (actualInput) {
      setTimeout(function(){ actualInput.focus(); }, 120);
      bindNominalInput(actualInput, function(val){ updateVariance(val); });
      bindModalEnter(actualInput, function(){
        var btn = $('btn-pos-confirm-close-shift');
        if (btn) btn.click();
      });
      $('btn-pos-exact-drawer').onclick = function(){
        actualInput.value = formatNominal(expected);
        updateVariance(expected);
        actualInput.focus();
      };
    }

    $('btn-pos-confirm-close-shift').onclick = async function(){
      var actual = parseNominal(actualInput ? actualInput.value : 0);
      if (!Number.isFinite(actual) || actual < 0) return toast('Nominal uang fisik tidak valid.');
      try {
        var d = await request('/pos/shifts/' + encodeURIComponent(state.shift.id) + '/close', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ actual_cash: actual })
        });
        state.shift = null;
        savePosShiftCache();
        renderShiftStatus();
        renderShift();
        renderCart();
        updateTransaksiStats();
        hideModal();
        var variance = (d.shift && typeof d.shift.variance === 'number') ? d.shift.variance : 0;
        var varMsg = variance === 0 ? 'Kas pas.' : (variance < 0 ? 'Minus ' + money(Math.abs(variance)) : 'Lebih ' + money(variance));
        toast('Shift ditutup. ' + varMsg);
      } catch(e) {
        toast(e.message);
      }
    };
  }

  function renderShift(){
    renderShiftStatus();
    var box = $('pos-shift-card');
    if (!box) return;
    if (!state.shift) {
      box.innerHTML = '<div style="text-align:center;padding:24px 16px">' +
        '<h3 style="margin-bottom:6px">Belum Ada Shift Aktif</h3>' +
        '<p style="color:#64748b;font-size:13px;margin-bottom:16px">Kasir harus membuka shift sebelum penjualan dapat diselesaikan.</p>' +
        '<button type="button" class="pos-btn" id="btn-pos-open-shift-card">Buka Shift Sekarang</button>' +
      '</div>';
      if ($('btn-pos-open-shift-card')) $('btn-pos-open-shift-card').onclick = openShiftModal;
      return;
    }
    var s = state.shift;
    box.innerHTML = '<div class="pos-shift-card-header">' +
      '<h3>' + (s.active_break ? 'Sedang Istirahat' : 'Shift Aktif') + '</h3>' +
      '<p>' + esc(formatShiftSubtitle(s)) + '</p>' +
      '</div>' +
      '<div class="pos-shift-grid">' +
        '<div class="pos-shift-metric"><span>Modal Awal</span><strong>' + money(s.starting_float) + '</strong></div>' +
        '<div class="pos-shift-metric"><span>Penjualan Tunai</span><strong>' + money(s.total_cash_sales) + '</strong></div>' +
        '<div class="pos-shift-metric"><span>Cash In</span><strong>' + money(s.total_cash_in) + '</strong></div>' +
        '<div class="pos-shift-metric"><span>Cash Out</span><strong>' + money(s.total_cash_out) + '</strong></div>' +
        '<div class="pos-shift-metric"><span>Kas Ekspektasi</span><strong>' + money(s.expected_cash) + '</strong></div>' +
      '</div>' +
      '<div class="pos-shift-actions">' +
        '<button class="pos-btn ghost" id="btn-pos-cash-in">Cash In</button>' +
        '<button class="pos-btn ghost" id="btn-pos-cash-out">Cash Out</button>' +
        '<button class="pos-btn danger ghost" id="btn-pos-close-shift">Tutup Shift</button>' +
      '</div>';
    if ($('btn-pos-cash-in')) $('btn-pos-cash-in').onclick = function(){ openCashMoveModal('in'); };
    if ($('btn-pos-cash-out')) $('btn-pos-cash-out').onclick = function(){ openCashMoveModal('out'); };
    if ($('btn-pos-close-shift')) $('btn-pos-close-shift').onclick = openCloseShiftModal;
  }

  async function openShift(){
    openShiftModal();
  }

  async function cashMove(type){
    openCashMoveModal(type);
  }

  async function toggleShiftBreak(){
    if(!state.shift)return;
    var endpoint=state.shift.active_break ? 'end' : 'start';
    try{
      var d=await request('/pos/shifts/'+encodeURIComponent(state.shift.id)+'/break/'+endpoint,{method:'POST',headers:headers()});
      state.shift=d.shift||(endpoint==='start'?Object.assign({},state.shift,{active_break:d.break}):Object.assign({},state.shift,{active_break:null}));
      savePosShiftCache(); renderShiftStatus(); renderCart(); renderShift();
      toast(endpoint==='start'?'Istirahat dimulai.':'Kembali bertugas.');
    }catch(e){toast(e.message);}
  }

  async function closeShift(){
    openCloseShiftModal();
  }

  function paymentModeInfo(mode){ return state.paymentModes.find(function(m){return m.code===mode;}) || {code:mode,name:mode,enabled:true}; }

  function paymentModeBody(mode,totalAmount){
    var info=paymentModeInfo(mode);
    if(mode==='cash') {
      var denominations=[
        { val: 10000, label: '10k' },
        { val: 20000, label: '20k' },
        { val: 50000, label: '50k' },
        { val: 100000, label: '100k' }
      ];
      var buttonsHtml='<button type="button" class="pos-btn-quick-cash active" data-cash-val="exact">Uang Pas</button>' +
        denominations.map(function(d){
          var isDisabled=d.val < totalAmount;
          return '<button type="button" class="pos-btn-quick-cash" data-cash-val="'+d.val+'"'+(isDisabled?' disabled title="Nominal di bawah tagihan"':'')+'>'+d.label+'</button>';
        }).join('');

      return '<div class="pos-form-row">' +
        '<label>Uang Diterima (Pilih nominal atau ketik custom)</label>' +
        '<div class="pos-input-nominal-wrap">' +
          '<span class="pos-input-prefix">Rp</span>' +
          '<input id="pos-amount-tendered" type="text" inputmode="numeric" pattern="[0-9]*" value="'+formatNominal(totalAmount)+'" placeholder="0" class="pos-input-nominal" autocomplete="off">' +
        '</div>' +
        '<div class="pos-quick-cash-grid">' +
          buttonsHtml +
        '</div>' +
      '</div>' +
      '<div id="pos-change-preview" class="pos-change">Kembalian: '+money(0)+'</div>';
    }
    if(mode==='payment_gateway') return '<div class="pos-payment-pending"><strong>Payment Gateway</strong><span>Provider: '+esc(String(info.provider||'—').toUpperCase())+'</span><small>Pembayaran dibuat melalui gateway aktif dan POS menunggu status settlement.</small></div>';
    var q=info.qris_static||{};
    var qrisImgHtml = q.image_url
      ? '<img class="pos-qris-image" src="'+esc(q.image_url)+'" alt="QRIS Statis">'
      : '<div class="pos-qris-placeholder"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg><span>Scan QRIS Kasir di Meja / Counter</span></div>';
    return '<div class="pos-qris-panel"><div class="pos-payment-total">'+money(totalAmount)+'</div>'+(q.merchant_name?'<div class="pos-qris-merchant">'+esc(q.merchant_name)+'</div>':'')+qrisImgHtml+'<p class="pos-qris-instructions">'+esc(q.instructions||'Verifikasi pembayaran pelanggan sebelum konfirmasi.')+'</p></div>';
  }

  async function openPayModal(){
    var tx=composer();
    if(tx.isAddition()) return submitAdditionalOrder();
    if(!tx.hasItems())return;
    if(!tx.isExisting() && state.branchOperationalOpen === false) {
      return toast('Merchant sedang tutup. Buka cabang terlebih dahulu.', 'error');
    }
    if(!state.shift)return toast('Buka shift terlebih dahulu.');
    if(state.shift.active_break)return toast('Akhiri istirahat sebelum melanjutkan transaksi.');

    if(tx.isExisting()&&tx.getOrderId()){
      try{
        await refreshActiveOrderContext(tx.getOrderId());
      }catch(e){
        return toast(e.message);
      }
      if(!composer().hasItems()) return toast('Order aktif belum memiliki item.');
    }

    state.autoPayAfterTable=true;
    if(tx.getOrderType()==='dine_in'&&!tx.getTable()){openTableSelector();return;}
    state.autoPayAfterTable=false;
    closeMobileCartOverlay();
    var t=total();
    var modes=state.paymentModes.filter(function(m){return m.enabled;});
    if(!modes.some(function(m){return m.code==='cash';}))modes.unshift({code:'cash',name:'Cash',enabled:true,offline_supported:true,provider:'cash'});
    state.activePaymentMode=(modes.find(function(m){return m.code===state.activePaymentMode;})||modes[0]).code;
    showModal('<h3>Pembayaran</h3><div class="pos-payment-total">'+money(t)+'</div><div class="pos-form-row"><label>Mode Pembayaran</label><div class="pos-payment-mode-grid">'+modes.map(function(m){return '<button type="button" class="pos-payment-option '+(m.code===state.activePaymentMode?'active':'')+'" data-pay-mode="'+esc(m.code)+'"><strong>'+esc(m.name)+'</strong><small>'+(m.code==='payment_gateway'?esc(String(m.provider||'').toUpperCase()):m.code==='qris_static'?'Fallback manual':'Offline tersedia')+'</small></button>';}).join('')+'</div></div><div id="pos-payment-mode-body">'+paymentModeBody(state.activePaymentMode,t)+'</div><div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-pay-cancel">Batal</button><button class="pos-btn" id="pos-pay-confirm">Lanjutkan</button></div>');
    document.querySelectorAll('[data-pay-mode]').forEach(function(btn){btn.onclick=function(){state.activePaymentMode=btn.dataset.payMode;document.querySelectorAll('[data-pay-mode]').forEach(function(x){x.classList.toggle('active',x===btn);});$('pos-payment-mode-body').innerHTML=paymentModeBody(state.activePaymentMode,t);bindCashPreview();};});
    bindCashPreview();
    $('pos-pay-cancel').onclick=hideModal;
    $('pos-pay-confirm').onclick=function(){var amount=$('pos-amount-tendered');submitSale(state.activePaymentMode,amount?parseNominal(amount.value):null);};
  }

  function bindCashPreview(){
    var amount=$('pos-amount-tendered'),preview=$('pos-change-preview');
    if(!amount||!preview)return;
    var t=total();
    function updateChange(){
      var val=parseNominal(amount.value||0);
      var diff=val-t;
      var confirmBtn=$('pos-pay-confirm');
      if(diff>=0){
        preview.className='pos-change';
        preview.textContent='Kembalian: '+money(diff);
        if(confirmBtn) confirmBtn.disabled=false;
      } else {
        preview.className='pos-change danger';
        preview.textContent='Uang kurang: '+money(Math.abs(diff));
        if(confirmBtn) confirmBtn.disabled=true;
      }
      document.querySelectorAll('.pos-btn-quick-cash').forEach(function(b){
        var cv=b.dataset.cashVal;
        var isMatch=!b.disabled && ((cv==='exact' && val===t) || (Number(cv)===val));
        b.classList.toggle('active',isMatch);
      });
    }
    bindNominalInput(amount, updateChange);
    document.querySelectorAll('.pos-btn-quick-cash').forEach(function(btn){
      btn.onclick=function(){
        if(btn.disabled) return;
        var cv=btn.dataset.cashVal;
        if(cv==='exact') {
          amount.value=formatNominal(t);
        } else {
          var num=Number(cv);
          if(num < t) return;
          amount.value=formatNominal(num);
        }
        updateChange();
        amount.focus();
      };
    });
    bindModalEnter(amount, function(){
      var confirmBtn = $('pos-pay-confirm');
      if (confirmBtn && !confirmBtn.disabled) {
        confirmBtn.click();
      }
    });
    updateChange();
  }

  function getPosSoundSettings(){
    var settings={enabled:true,volume:75};
    try{settings=Object.assign(settings,JSON.parse(localStorage.getItem('xentra_pos_sound_settings')||'{}'));}catch(_){}
    settings.enabled=settings.enabled!==false;
    settings.volume=Math.max(0,Math.min(100,Number(settings.volume)||0));
    return settings;
  }

  function showPaymentSuccess(order,change,paymentMethod){
    if (window.XentraAudio && typeof window.XentraAudio.paymentReceived === 'function') {
      var soundSettings=getPosSoundSettings();
      window.XentraAudio.paymentReceived({ text: 'Pembayaran diterima!', enabled:soundSettings.enabled, volume:soundSettings.volume });
    }
    var nativeBridge = window.XentraPos || window.XentraNative;
    if (paymentMethod === 'cash' && nativeBridge && typeof nativeBridge.openCashDrawer === 'function') {
      try { nativeBridge.openCashDrawer(); } catch (_) {}
    }
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
    var qrisImgHtml = q.image_url
      ? '<img class="pos-qris-image" src="'+esc(q.image_url)+'" alt="QRIS Statis">'
      : '<div class="pos-qris-placeholder"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg><span>Scan QRIS Kasir di Meja / Counter</span></div>';
    showModal('<h3>QRIS Statis</h3><p>Tagihan '+money(d.grand_total||0)+'</p>' +(q.merchant_name?'<div class="pos-qris-merchant">'+esc(q.merchant_name)+'</div>':'')+qrisImgHtml+'<p class="pos-qris-instructions">'+esc(q.instructions||'Verifikasi pembayaran pelanggan sebelum konfirmasi.')+'</p><div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-qris-cancel">Belum Bayar</button><button class="pos-btn" id="pos-qris-confirm">Saya Sudah Verifikasi</button></div>');
    $('pos-qris-cancel').onclick=function(){request('/pos/orders/'+encodeURIComponent(oid)+'/cancel-qris-static',{method:'POST',headers:headers(),body:JSON.stringify({reason:'QRIS statis belum dibayar.'})}).then(function(){hideModal();resetSale();loadSales();}).catch(function(e){toast(e.message);});};
    $('pos-qris-confirm').onclick=function(){var note=prompt('Referensi transaksi (opsional)')||'';request('/pos/orders/'+encodeURIComponent(oid)+'/confirm-qris-static',{method:'POST',headers:headers(),body:JSON.stringify({reference_note:note})}).then(function(result){if(result&&result.success){showPaymentSuccess({id:oid,order_number:result.order_number,grand_total:d.grand_total},null);loadSales();}}).catch(function(e){toast(e.message);});};
  }

  async function submitSale(paymentMode,amountTendered){
    var tx=composer();
    if(tx.isAddition()) return submitAdditionalOrder();
    if(!tx.hasItems()) return toast('Cart masih kosong.');
    if(!tx.isExisting() && state.branchOperationalOpen === false) {
      return toast('Merchant sedang tutup. Buka cabang terlebih dahulu.', 'error');
    }
    if(!state.shift)return toast('Buka shift terlebih dahulu.');
    if(tx.getOrderType()==='dine_in'&&!tx.getTable()){hideModal();openTableSelector();return;}
    if(!navigator.onLine&&paymentMode!=='cash')return toast('Payment Gateway dan QRIS Statis membutuhkan koneksi internet pada POS.');

    if(paymentMode==='cash'){
      var numTendered=Number(amountTendered||0);
      if(!Number.isFinite(numTendered)||numTendered < total()){
        return toast('Uang yang diterima kurang dari total tagihan.');
      }
    }

    var orderId=tx.getOrderId();
    if(orderId){
      if(paymentMode!=='cash')return toast('Order yang sudah dibuka dari transaksi sebelumnya saat ini dilunasi melalui Cash.');
      try{
        var existing=await request('/pos/orders/'+encodeURIComponent(orderId)+'/settle-cash',{method:'POST',headers:headers(),body:JSON.stringify({amount_tendered:Number(amountTendered),shift_id:state.shift.id})});
        if(existing&&existing.success){
          hideModal();
          showPaymentSuccess({id:orderId,order_number:existing.order_number||orderId,grand_total:existing.grand_total||total()},Number(existing.change||0),'cash');
          resetSale();loadShift();loadSales();updateHeldCount();
          return;
        }
        return toast((existing&&existing.error)||'Gagal melunasi Order.');
      }catch(e){return toast(e.message);}
    }

    var confirmBtn=$('pos-pay-confirm');
    if(confirmBtn){
      if(confirmBtn.disabled) return;
      confirmBtn.disabled=true;
      confirmBtn.textContent='Memproses...';
    }

    var table=tx.getTable();
    var orderType=tx.getOrderType();
    var items=tx.getDisplayItems();
    var clientTxId=tx.getClientTransactionId() || ('pos_'+Date.now()+'_'+Math.random().toString(36).slice(2,8));
    var payload={
      branch_id:state.branchId,
      shift_id:state.shift.id,
      order_type:orderType,
      payment_mode:paymentMode,
      amount_tendered:paymentMode==='cash'?amountTendered:null,
      customer:{
        name:$('pos-customer-name').value.trim(),
        phone:'',
        table_number:table?table.table_number:null
      },
      items:items.map(function(i){return {product_id:i.menu_id ? (i.product_id || null) : i.product_id,name:i.name,quantity:i.quantity,unit_price:i.unit_price,expected_price:i.unit_price,menu_id:i.menu_id||null,menu_type:i.menu_type||null,component_snapshot:Array.isArray(i.component_snapshot)?i.component_snapshot:null,menu_snapshot:i.menu_snapshot||null,options:i.options||[],note:i.note||''};}),
      client_transaction_id:clientTxId
    };

    try{
      var d;
      if(!navigator.onLine || state.coreConnection===false){
        if(!state.terminalId)return toast('POS offline belum siap: terminal cabang belum terdaftar.');
        try{
          var offlineCreatedAt=new Date().toISOString();
          await persistOfflineSale(payload,offlineCreatedAt);
          hideModal();resetSale();toast('Penjualan tersimpan di perangkat. Akan disinkronkan saat sistem kembali tersedia.');return;
        }catch(offlineErr){
          return toast(offlineErr.message || 'Penjualan offline tidak dapat disimpan dengan aman.');
        }
      }
      d=await request('/pos/sales',{method:'POST',headers:headers(),body:JSON.stringify(payload)});
      if(paymentMode==='cash'||d.status==='SETTLED'){hideModal();showPaymentSuccess(d.order||{},Number((d.order||{}).change||0),paymentMode==='cash'?'cash':null);loadShift();loadSales();}
      else if(paymentMode==='payment_gateway'){hideModal();showGatewayPending(d);}
      else if(paymentMode==='qris_static'){hideModal();showStaticQrisPending(d);}
    }catch(e){
      if(confirmBtn){
        confirmBtn.disabled=false;
        confirmBtn.textContent='Lanjutkan';
      }
      if(paymentMode==='cash' && isCoreUnreachableError(e)){
        try{
          var fallbackCreatedAt=new Date().toISOString();
          await persistOfflineSale(payload,fallbackCreatedAt);
          hideModal();resetSale();
          toast('Sistem tidak terjangkau. Penjualan diamankan di perangkat dan akan disinkronkan saat kembali tersedia.');
          return;
        }catch(offlineErr){
          toast(offlineErr.message || e.message);
          return;
        }
      }
      toast(e.message);
    }
  }

  async function printReceipt(orderId){
    var nativeBridge = window.XentraPos || window.XentraNative;
    var useNativePrinter = !!(nativeBridge && typeof nativeBridge.printReceipt === 'function');
    var printWindow = null;
    // Open the browser print surface while the click still has user activation.
    // Opening it after awaiting the receipt API is blocked by Chrome/WebView.
    if(!useNativePrinter){
      printWindow=window.open('','_blank','width=420,height=700');
      if(!printWindow)return toast('Jendela cetak diblokir. Izinkan popup untuk POS, lalu tekan Cetak Struk lagi.');
      printWindow.document.write('<!doctype html><title>Menyiapkan struk…</title><p style="font:14px sans-serif">Menyiapkan struk untuk dicetak…</p>');
      printWindow.document.close();
    }
    try{
      var d=await request('/pos/orders/'+encodeURIComponent(orderId)+'/receipt',{headers:headers()});
      var raw = d && d.receipt && d.receipt.raw_content ? d.receipt.raw_content : '';
      if(!raw)throw new Error('Data struk kosong. Coba muat ulang transaksi.');
      if(useNativePrinter){
        var printed = false;
        try {
          if (typeof nativeBridge.isPrinterConnected === 'function' && !nativeBridge.isPrinterConnected()) {
            var savedMac = localStorage.getItem('xentra_pos_printer_mac');
            if(!savedMac && typeof nativeBridge.getPairedPrinters === 'function'){
              var paired=[];
              try{paired=JSON.parse(nativeBridge.getPairedPrinters()||'[]');}catch(_){}
              if(paired.length===1)savedMac=paired[0].address||paired[0].mac||'';
            }
            if (savedMac && typeof nativeBridge.connectPrinter === 'function') {
              if(nativeBridge.connectPrinter(savedMac))localStorage.setItem('xentra_pos_printer_mac',savedMac);
            }
          }
          printed = (!nativeBridge.isPrinterConnected || nativeBridge.isPrinterConnected()) && nativeBridge.printReceipt(raw);
        } catch (_) {}
        if (printed) {
          toast('Struk berhasil dicetak');
          return;
        }
        throw new Error('Printer belum terhubung atau gagal mencetak. Buka Profil & Setting → Printer & Suara, hubungkan printer, lalu coba lagi.');
      }

      printWindow.document.open();
      printWindow.document.write('<!doctype html><html><head><title>Struk Xentra</title><style>@page{size:80mm auto;margin:3mm}body{font-family:monospace;width:72mm;margin:0 auto;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.35}</style></head><body><pre>'+esc(raw)+'</pre></body></html>');
      printWindow.document.close(); printWindow.focus();
      printWindow.onafterprint=function(){try{printWindow.close();}catch(_){}};
      printWindow.print();
    }catch(e){
      if(printWindow&&!printWindow.closed)printWindow.close();
      toast(e.message);
    }
  }

  function bindPosSettingsTabs(){
    var profileTab=$('pos-settings-tab-profile'), devicesTab=$('pos-settings-tab-devices');
    var profilePanel=$('pos-settings-profile-panel'), devicesPanel=$('pos-settings-devices-panel');
    function selectTab(devices){
      profileTab.classList.toggle('active',!devices); devicesTab.classList.toggle('active',devices);
      profileTab.setAttribute('aria-selected',String(!devices)); devicesTab.setAttribute('aria-selected',String(devices));
      profilePanel.style.display=devices?'none':'block'; devicesPanel.style.display=devices?'block':'none';
    }
    profileTab.onclick=function(){selectTab(false);};
    devicesTab.onclick=function(){selectTab(true);};
  }

  function bindPosDeviceSettings(){
    var bridge=window.XentraPos||window.XentraNative;
    var nativeReady=!!(bridge&&typeof bridge.getPairedPrinters==='function'&&typeof bridge.printReceipt==='function');
    var nativePanel=$('pos-settings-printer-native'), browserPanel=$('pos-settings-printer-browser');
    var printerStatus=$('pos-settings-printer-status');
    if(nativeReady){
      var printers=[];
      try{printers=JSON.parse(bridge.getPairedPrinters()||'[]');}catch(_){}
      var saved=localStorage.getItem('xentra_pos_printer_mac')||'';
      var select=$('pos-settings-printer-select');
      select.innerHTML=printers.length?printers.map(function(p){
        var address=p.address||p.mac||'';
        return '<option value="'+esc(address)+'" '+(address===saved?'selected':'')+'>'+esc((p.name||'Printer Bluetooth')+' · '+address)+'</option>';
      }).join(''):'<option value="">Tidak ada printer paired di Android</option>';
      var connected=false;
      try{connected=bridge.isPrinterConnected();}catch(_){}
      printerStatus.textContent=connected?'Terhubung ke printer':'Belum terhubung';
      printerStatus.classList.toggle('connected',connected);
      $('pos-settings-printer-connect').onclick=function(){
        var mac=select.value;
        if(!mac)return toast('Pasangkan printer Bluetooth di pengaturan Android terlebih dahulu.');
        try{
          if(bridge.connectPrinter(mac)){
            localStorage.setItem('xentra_pos_printer_mac',mac);
            printerStatus.textContent='Terhubung ke '+(select.options[select.selectedIndex].text.split(' · ')[0]);
            printerStatus.classList.add('connected'); toast('Printer berhasil dihubungkan.');
          }else toast('Koneksi gagal. Pastikan printer menyala dan sudah dipasangkan.');
        }catch(e){toast('Koneksi printer gagal: '+e.message);}
      };
      $('pos-settings-printer-test').onclick=function(){
        var mac=select.value;
        try{
          if(!bridge.isPrinterConnected()&&(!mac||!bridge.connectPrinter(mac)))return toast('Hubungkan printer terlebih dahulu.');
          if(mac)localStorage.setItem('xentra_pos_printer_mac',mac);
          toast(bridge.printReceipt('XENTRA POS\nTES CETAK STRUK\nPrinter siap digunakan.\n\n\n')?'Tes cetak dikirim ke printer.':'Printer gagal mencetak.');
        }catch(e){toast('Tes cetak gagal: '+e.message);}
      };
    }else{
      nativePanel.style.display='none'; browserPanel.style.display='block';
      printerStatus.textContent='Cetak melalui dialog printer perangkat';
      $('pos-settings-browser-print-test').onclick=function(){
        var w=window.open('','_blank','width=420,height=700');
        if(!w)return toast('Popup diblokir. Izinkan popup untuk POS.');
        w.document.write('<!doctype html><html><head><title>Tes Cetak Xentra</title><style>@page{size:80mm auto;margin:3mm}body{font:12px monospace;width:72mm;margin:0 auto}</style></head><body><pre>XENTRA POS\nTES CETAK STRUK\nPilih printer pada dialog cetak.\n\n\n</pre></body></html>');
        w.document.close();w.focus();w.onafterprint=function(){try{w.close();}catch(_){}};w.print();
      };
    }

    var sound=getPosSoundSettings(), enabled=$('pos-settings-sound-enabled'), volume=$('pos-settings-sound-volume'), volumeValue=$('pos-settings-sound-volume-value');
    enabled.checked=sound.enabled!==false; volume.value=String(sound.volume); volumeValue.textContent=String(sound.volume)+'%';
    function saveSound(){
      var next={enabled:enabled.checked,volume:Number(volume.value)};
      try{localStorage.setItem('xentra_pos_sound_settings',JSON.stringify(next));}catch(_){}
      volumeValue.textContent=next.volume+'%';
    }
    enabled.onchange=saveSound;
    volume.oninput=saveSound;
    $('pos-settings-sound-test').onclick=function(){
      saveSound();
      if(!enabled.checked)return toast('Aktifkan bunyi kasir untuk mencoba suara.');
      if(window.XentraAudio&&typeof window.XentraAudio.testAlertSound==='function')window.XentraAudio.testAlertSound('bell',Number(volume.value));
      else toast('Fitur suara belum tersedia di perangkat ini.');
    };
  }

  async function openManyPaymentFromCart(){
    var orderId=composer().getOrderId();
    if(!orderId) return toast('Bayar masing-masing tersedia setelah pesanan dibuka kembali di kasir.');
    if(!composer().isExisting()) return toast('Split pembayaran hanya tersedia untuk Order yang sudah dibuka.');
    try{
      await openCheckManager(orderId);
    }catch(e){toast(e.message);}
  }
  function resetSale(){
    composer().reset();
    if($('pos-selected-table')) $('pos-selected-table').textContent='Belum dipilih';
    if($('pos-customer-name')) $('pos-customer-name').value='';
    if($('pos-order-note')) $('pos-order-note').value='';
    renderCart();
    renderMenu();
  }
  async function refreshActiveOrderContext(orderId){
    if(!orderId) return null;
    var data=await request('/pos/orders/'+encodeURIComponent(orderId)+'/additions',{headers:headers()});
    if(!data||!data.order) throw new Error('Order aktif tidak ditemukan.');

    var existing=composer().snapshot();
    var canonicalItems=(data.items||[]).map(function(it){
      var componentSnapshot=[];
      try {
        componentSnapshot = Array.isArray(it.component_snapshot)
          ? it.component_snapshot
          : JSON.parse(it.component_snapshot || '[]');
      } catch (_) { componentSnapshot=[]; }
      var menuSnapshot=null;
      try {
        menuSnapshot = it.menu_snapshot && typeof it.menu_snapshot === 'object'
          ? it.menu_snapshot
          : JSON.parse(it.menu_snapshot || 'null');
      } catch (_) { menuSnapshot=null; }
      return {
        product_id:it.menu_id ? (it.product_id || null) : it.product_id,
        menu_id:it.menu_id||null,
        menu_type:it.menu_type||null,
        component_snapshot:componentSnapshot,
        menu_snapshot:menuSnapshot,
        name:it.product_name||it.name||'Menu',
        unit_price:Number(it.unit_price||0),
        quantity:Number(it.quantity||0),
        note:it.note||'',
        options:(function(){try{return JSON.parse(it.modifiers_snapshot||'[]');}catch(_){return [];}})(),
        addition_batch_id:it.addition_batch_id||null
      };
    }).filter(function(it){return it.quantity>0;});

    composer().refreshExisting({
      orderId:orderId,
      heldBillId:existing.held_bill_id,
      orderType:existing.order_type,
      table:existing.table,
      order:data.order,
      items:canonicalItems,
      pendingAdditions:data.additions||[]
    });

    return data;
  }
  function enterAdditionalOrderMode(){
    try{
      composer().beginAddition();
    }catch(e){
      return toast(e.message);
    }
    if($('pos-order-note')) $('pos-order-note').value='';
    hideModal();
    renderCart();
    renderMenu();
    toast('Mode Tambah Pesanan aktif. Pilih menu tambahan lalu kirim.');
  }

  function cancelAdditionalOrderMode(){
    composer().cancelAddition();
    hideModal();
    renderCart();
    renderMenu();
  }

  async function submitAdditionalOrder(){
    var tx=composer();
    if(!tx.isAddition()) return;
    var orderId=tx.getOrderId();
    var items=tx.getAdditionItems();
    if(!orderId) return toast('Order aktif tidak ditemukan.');
    if(!items.length) return toast('Belum ada menu tambahan.');

    try{
      var btn=$('btn-pos-pay');
      if(btn) btn.disabled=true;
      var result=await request('/pos/orders/'+encodeURIComponent(orderId)+'/additions',{
        method:'POST',
        headers:headers(),
        body:JSON.stringify({
          items:items,
          client_transaction_id:tx.getClientTransactionId()
        })
      });

      composer().completeAdditionSubmission();
      hideModal();
      await refreshActiveOrderContext(orderId);
      renderCart();
      renderMenu();
      toast('Tambahan pesanan dikirim. Menunggu Merchant menerima.');
      return result;
    }catch(e){
      toast(e.message);
      renderCart();
    }
  }


  function showModal(html, extraClass){
    updateNativeStatusBar('#ffffff', true);
    var card = $('pos-modal-card');
    if (card) card.innerHTML = html;
    var modal = $('pos-modal');
    if (modal) {
      modal.className = 'pos-modal' + (extraClass ? ' ' + extraClass : '');
      modal.classList.remove('hidden');
    }
  }
  function hideModal(){
    updateNativeStatusBar('#ffffff', true);
    state.autoPayAfterTable = false;
    var modal = $('pos-modal');
    if (modal) {
      modal.className = 'pos-modal hidden';
    }
    var card = $('pos-modal-card');
    if (card) {
      card.innerHTML = '';
    }
  }

  async function updateHeldCount(){
    var held=await loadHeld();
    var count=held.length;
    if($('pos-held-count')) $('pos-held-count').textContent=String(count);
    if($('pos-transaksi-held-count')) $('pos-transaksi-held-count').textContent=String(count);
    return held;
  }

  async function holdSale(){
    var tx=composer();
    if(state.branchOperationalOpen === false) {
      return toast('Merchant sedang tutup. Buka cabang terlebih dahulu.', 'error');
    }
    if(tx.isExisting()) return showOrderLockedWarning();
    if(tx.isAddition()) return toast('Tambahan pesanan dikirim langsung, bukan melalui Hold Bill.');
    var items=tx.getDisplayItems();
    var orderType=tx.getOrderType();
    var table=tx.getTable();
    if(!items.length)return toast('Cart masih kosong.');
    if(orderType==='dine_in'&&!table)return toast('Pilih meja sebelum menahan bill.');

    try{
      var customerName=$('pos-customer-name').value.trim()||'Tamu';
      var heldBillId=tx.getHeldBillId();
      if(heldBillId){
        await request('/pos/held-orders/'+encodeURIComponent(heldBillId),{
          method:'PUT',
          headers:headers(),
          body:JSON.stringify({items:items,customer_name:customerName,customer_phone:''})
        });
        toast('Hold Bill diperbarui. Meja tetap dipesan.');
      }else{
        await request('/pos/held-orders',{
          method:'POST',
          headers:headers(),
          body:JSON.stringify({
            branch_id:state.branchId,
            table_number:table?table.table_number:'',
            customer_name:customerName,
            order_type:orderType,
            items:items
          })
        });
        toast('Pesanan ditahan (Hold Bill).');
      }
      resetSale();
      await updateHeldCount();
      if(state.transaksiTab==='held') renderHeldSales();
    }catch(e){toast(e.message);}
  }
  async function loadHeld(){
    try{var d=await request('/pos/held-orders?branch_id='+encodeURIComponent(state.branchId),{headers:headers()});state.held=d.held_orders||[];return state.held;}catch(e){return [];}
  }

  async function resumeHeld(heldId){
    var held=state.held||[];
    var h=held.find(function(x){return String(x.id)===String(heldId);});
    if(!h){
      held=await loadHeld();
      h=held.find(function(x){return String(x.id)===String(heldId);});
    }
    if(!h)return toast('Pesanan ditahan tidak ditemukan.');

    var restoredType=h.order_type||(h.table_number?'dine_in':'pickup');
    var restoredTable=h.table_number?{table_number:h.table_number}:null;
    var items=[];
    try{items=JSON.parse(h.items_payload||'[]');}catch(_){items=[];}

    composer().openExisting({
      orderId:h.order_id||null,
      heldBillId:h.id||null,
      orderType:restoredType,
      table:restoredTable,
      order:null,
      items:items,
      pendingAdditions:[]
    });

    document.querySelectorAll('.pos-order-type button').forEach(function(x){
      x.classList.toggle('active',x.dataset.type===restoredType);
    });

    if(restoredType==='dine_in'&&restoredTable&&$('pos-selected-table')){
      $('pos-selected-table').textContent='Meja '+restoredTable.table_number;
    }else if($('pos-selected-table')){
      $('pos-selected-table').textContent='Belum dipilih';
    }

    if($('pos-customer-name')) $('pos-customer-name').value=h.customer_name||'';
    var ctx=$('pos-table-context'); if(ctx)ctx.classList.toggle('hidden',restoredType!=='dine_in');

    if(h.order_id){
      try{
        await refreshActiveOrderContext(h.order_id);
      }catch(err){
        // Keep the Hold snapshot as the editable NEW composer only if the
        // canonical order cannot be refreshed.
        composer().startNew({orderType:restoredType,table:restoredTable});
        items.forEach(function(item){ composer().addItem(item); });
      }
    }else{
      composer().startNew({orderType:restoredType,table:restoredTable});
      items.forEach(function(item){ composer().addItem(item); });
    }

    hideModal();
    renderCart();
    renderMenu();
    await updateHeldCount();
    if(state.transaksiTab==='held') renderHeldSales();
    setView('kasir');

    var labelInfo=(restoredType==='dine_in'&&restoredTable)?('Meja '+restoredTable.table_number):(h.customer_name||(restoredType==='pickup'?'Takeaway':restoredType==='delivery'?'Delivery':'Pesanan'));
    if(composer().isExisting()){
      toast('Pesanan '+esc(labelInfo)+' dibuka. Pesanan lama sudah diproses Merchant; gunakan + Tambah Pesanan untuk menu baru.');
    }else{
      toast('Pesanan '+esc(labelInfo)+' dibuka. Tambah/ubah menu, lalu pilih Hold lagi.');
    }
  }
  async function cancelHeld(heldId){
    if(!confirm('Batalkan pesanan yang ditahan ini?')) return;
    try{
      await request('/pos/held-orders/'+encodeURIComponent(heldId),{method:'DELETE',headers:headers()});
      toast('Pesanan ditahan dibatalkan.');
      await updateHeldCount();
      if(state.transaksiTab==='held') renderHeldSales();
      else if(!$('pos-modal').classList.contains('hidden')) openHeld();
    }catch(e){toast(e.message);}
  }

  async function openCheckManager(orderId){
    if(!orderId){toast('Tagihan ini belum memiliki order.');return;}
    try{
      var data=await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks',{headers:headers()});
      var checks=data.checks||[];
      if(!checks.length){toast('Tagihan belum siap dibagi.');return;}

      function checkTotal(check){ return Number(check.allocated_amount||0); }
      function renderPayments(check){
        return (check.payments||[]).map(function(p){
          return '<div class="pos-check-payment"><span>'+esc(p.payer_name||'Pembayaran')+'</span><strong>'+money(p.amount)+'</strong></div>';
        }).join('');
      }
      function renderCheck(check, index){
        var paid=Number(check.paid_amount||0);
        var pending=Number(check.pending_payment_amount||0);
        var remaining=Number(check.remaining_amount||0);
        var total=checkTotal(check);
        var payments=renderPayments(check);
        var isPaid=paid>=total;
        var label=checks.length===1 ? 'Tagihan' : 'Bagian '+(index+1);
        return '<div class="pos-check-card pos-simple-check-card">' +
          '<div class="pos-check-head"><div><strong>'+label+'</strong><small>'+(isPaid?'LUNAS':(pending>0?'Menunggu konfirmasi '+money(pending):('Sisa '+money(Math.max(0,total-paid)))))+'</small></div><strong>'+money(total)+'</strong></div>' +
          '<div class="pos-check-balance"><span>Sudah dibayar</span><strong>'+money(paid)+'</strong></div>' +
          (payments ? '<div class="pos-check-payments">'+payments+'</div>' : '') +
          (isPaid ? '<div class="pos-check-paid">✓ Lunas</div>' : (remaining>0?'<div class="pos-check-actions"><button type="button" class="pos-btn" data-pay-check="'+esc(check.id)+'">Tunai '+money(remaining)+'</button><button type="button" class="pos-btn ghost" data-pay-check-online="'+esc(check.id)+'">Bayar Online</button></div>':'')) +
        '</div>';
      }

      var total=Number(data.order.grand_total||0);
      var paidOrder=checks.reduce(function(sum,check){return sum+Number(check.paid_amount||0);},0);
      var pendingOrder=checks.reduce(function(sum,check){return sum+Number(check.pending_payment_amount||0);},0);
      var remainingOrder=Math.max(0,total-paidOrder-pendingOrder);
      var hasSplit=checks.length>1;
      var allUnpaid=checks.every(function(check){return Number(check.paid_amount||0)===0 && Number(check.pending_payment_amount||0)===0 && check.status==='open';});
      var firstOpen=checks.find(function(check){return check.status==='open' && Number(check.remaining_amount||0)>0;});
      var mainActions='';

      if(!hasSplit){
        mainActions=
          '<div class="pos-simple-choice-title">Bagaimana pembayarannya?</div>' +
          '<div class="pos-simple-choice-list">' +
            '<button type="button" class="pos-simple-choice" id="pos-item-choice"><strong>Bayar Berdasarkan Menu</strong><small>Jika customer ingin membayar menu yang dipesannya saja.</small></button>' +
            '<button type="button" class="pos-simple-choice" id="pos-evenly-choice"><strong>Bagi Rata</strong><small>Jika pembayaran tagihan ingin dibagi rata antar customer.</small></button>' +
            '<button type="button" class="pos-simple-choice" id="pos-amount-choice"><strong>Atur Nominal</strong><small>Jika customer ingin membayar dengan nominal tertentu, lalu sisanya dibayarkan customer berikutnya sampai seluruh tagihan lunas, dalam satu transaksi.</small></button>' +
          '</div>' +
          '<div class="pos-simple-secondary-actions pos-payment-group-secondary"><button type="button" class="pos-btn ghost small" id="pos-payment-group">Gabungkan Tagihan</button></div>';
      }else{
        mainActions=
          '<div class="pos-simple-section-title">Pembayaran</div>' +
          '<div class="pos-simple-summary">Sudah dibayar <strong>'+money(paidOrder)+'</strong><span>'+(pendingOrder>0?'Menunggu konfirmasi '+money(pendingOrder)+' · ':'')+'Belum dibayar '+money(remainingOrder)+'</span></div>' +
          (firstOpen ? '<div class="pos-simple-secondary-actions"><button type="button" class="pos-btn ghost small" id="pos-add-amount">Atur Nominal</button><button type="button" class="pos-btn ghost small" id="pos-add-item">Bayar Berdasarkan Menu</button></div>' : '') +
          (allUnpaid ? '<button type="button" class="pos-btn ghost small danger" id="pos-reset-split">↩ Batalkan Pembagian</button>' : '');
      }

      showModal(
        '<div class="pos-simple-bill-head">' +
          '<div><h3>'+ (hasSplit ? 'Bayar' : 'Masing-masing') +'</h3><p>'+ (hasSplit ? 'Pilih bagian yang mau dibayar.' : 'Pilih cara pembayaran untuk tagihan ini.') +'</p></div>' +
          '<div class="pos-simple-bill-total">'+money(total)+'</div>' +
        '</div>' +
        mainActions +
        '<div class="pos-check-manager-list pos-simple-check-list">'+checks.map(renderCheck).join('')+'</div>' +
        '<div class="pos-modal-actions"><button type="button" class="pos-btn ghost" id="pos-check-manager-close">Tutup</button></div>'
      );

      function openEvenlyFlow(){
        var html='<h3>Bagi Rata</h3>' +
          '<p class="pos-form-help">Berapa orang yang mau bayar?</p>' +
          '<label class="pos-field"><span>Jumlah orang</span><input id="pos-evenly-parts" class="pos-input" type="number" min="2" max="99" value="2" inputmode="numeric"></label>' +
          '<div class="pos-modal-actions"><button id="pos-evenly-submit" class="pos-btn">Lanjut</button><button id="pos-evenly-cancel" class="pos-btn ghost">Batal</button></div>';
        showModal(html);
        $('pos-evenly-cancel').onclick=function(){openCheckManager(orderId);};
        $('pos-evenly-submit').onclick=async function(){
          var parts=Math.floor(Number($('pos-evenly-parts').value)||0);
          if(parts<2){toast('Minimal 2 orang.');return;}
          try{
            await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks/split-evenly',{
              method:'POST',headers:headers(),body:JSON.stringify({source_check_id:checks[0].id,parts:parts})
            });
            toast('Tagihan dibagi rata.');
            openCheckManager(orderId);
          }catch(e){toast(e.message);}
        };
      }

      function openAmountFlow(sourceId){
        var source=checks.find(function(c){return c.id===sourceId;}) || firstOpen;
        var sourceRemaining=source ? Number(source.remaining_amount||0) : remainingOrder;
        var html='<h3>Atur Nominal</h3>' +
          '<p class="pos-form-help">Masukkan berapa yang dibayar orang ini. Sisanya tetap menjadi tagihan berikutnya.</p>' +
          '<div class="pos-payment-summary"><span>Sisa tagihan</span><strong>'+money(sourceRemaining)+'</strong></div>' +
          '<label class="pos-field"><span>Nominal orang ini</span><div class="pos-input-nominal-wrap"><span class="pos-input-prefix">Rp</span><input id="pos-split-amount" class="pos-input-nominal" inputmode="numeric" pattern="[0-9.]*" type="text" placeholder="0" autocomplete="off"></div></label>' +
          '<div class="pos-modal-actions"><button id="pos-split-amount-submit" class="pos-btn">Tambahkan</button><button id="pos-split-amount-cancel" class="pos-btn ghost">Batal</button></div>';
        showModal(html);
        $('pos-split-amount-cancel').onclick=function(){openCheckManager(orderId);};
        var input=$('pos-split-amount');
        bindNominalInput(input);
        setTimeout(function(){if(input)input.focus();},80);
        $('pos-split-amount-submit').onclick=async function(){
          var amount=parseNominal(input ? input.value : 0);
          if(!amount){toast('Masukkan nominal.');return;}
          if(amount>=sourceRemaining){toast('Nominal harus lebih kecil dari sisa tagihan.');return;}
          var submit=this; submit.disabled=true;
          try{
            await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks/split-amount',{
              method:'POST',headers:headers(),body:JSON.stringify({source_check_id:source.id,amount:amount})
            });
            toast('Bagian tagihan ditambahkan.');
            openCheckManager(orderId);
          }catch(e){submit.disabled=false;toast(e.message);}
        };
        bindModalEnter(input,$('pos-split-amount-submit'));
      }

      function openItemFlow(sourceId){
        var source=checks.find(function(c){return c.id===sourceId;}) || firstOpen;
        if(!source || !(source.items||[]).length){toast('Belum ada menu yang bisa dipilih.');return;}
        var html='<h3>Bayar Berdasarkan Menu</h3>';
        (source.items||[]).forEach(function(it){
          var maxQty=Math.max(0,Number(it.quantity)||0);
          html+='<div class="pos-simple-item-row">' +
            '<span><strong>'+esc(it.product_name||'Item')+'</strong><small>'+money(it.unit_price)+' × '+it.quantity+'</small></span>' +
            '<div class="pos-item-stepper pos-stepper" role="group" aria-label="Jumlah yang dibayar">' +
              '<button type="button" class="pos-item-stepper-btn pos-stepper-btn" data-item-minus="'+esc(it.order_item_id)+'" aria-label="Kurangi">'+posStepperIcon('minus')+'</button>' +
              '<span class="pos-item-stepper-value pos-stepper-value" data-item-qty="'+esc(it.order_item_id)+'">0</span>' +
              '<button type="button" class="pos-item-stepper-btn pos-stepper-btn" data-item-plus="'+esc(it.order_item_id)+'" aria-label="Tambah">'+posStepperIcon('plus')+'</button>' +
            '</div>' +
            '<input data-check-item="'+esc(it.order_item_id)+'" type="hidden" value="0">';
        });
        html+='<div class="pos-modal-actions pos-modal-nav"><button type="button" id="pos-item-back" class="pos-btn ghost">Kembali</button><div class="pos-modal-nav-right"><button type="button" id="pos-item-submit" class="pos-btn">Tambahkan</button><button type="button" id="pos-item-close" class="pos-btn ghost">Tutup</button></div></div>';
        showModal(html);
        $('pos-item-back').onclick=function(){openCheckManager(orderId);};
        $('pos-item-close').onclick=hideModal;
        $('pos-modal-card').querySelectorAll('[data-item-minus],[data-item-plus]').forEach(function(btn){
          btn.onclick=function(){
            var id=btn.dataset.itemMinus||btn.dataset.itemPlus;
            var input=$('pos-modal-card').querySelector('[data-check-item="'+CSS.escape(id)+'"]');
            var valueEl=$('pos-modal-card').querySelector('[data-item-qty="'+CSS.escape(id)+'"]');
            if(!input||!valueEl)return;
            var item=(source.items||[]).find(function(x){return String(x.order_item_id)===String(id);});
            var maxQty=item?Math.max(0,Number(item.quantity)||0):0;
            var current=Math.floor(Number(input.value)||0);
            var next=btn.dataset.itemPlus!==undefined ? Math.min(maxQty,current+1) : Math.max(0,current-1);
            input.value=String(next);
            valueEl.textContent=String(next);
          };
        });
        $('pos-item-submit').onclick=async function(){
          var splitItems=[];
          $('pos-modal-card').querySelectorAll('[data-check-item]').forEach(function(input){
            var q=Math.floor(Number(input.value)||0);
            if(q>0)splitItems.push({order_item_id:input.dataset.checkItem,quantity:q});
          });
          if(!splitItems.length){toast('Pilih minimal satu menu.');return;}
          var submit=this; submit.disabled=true;
          try{
            await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks/split',{
              method:'POST',headers:headers(),body:JSON.stringify({source_check_id:source.id,split_items:splitItems})
            });
            toast('Bagian menu ditambahkan.');
            openCheckManager(orderId);
          }catch(e){submit.disabled=false;toast(e.message);}
        };
      }

      if($('pos-check-manager-close')) $('pos-check-manager-close').onclick=hideModal;

      if($('pos-add-amount')) $('pos-add-amount').onclick=function(){openAmountFlow(firstOpen && firstOpen.id);};
      if($('pos-add-item')) $('pos-add-item').onclick=function(){openItemFlow(firstOpen && firstOpen.id);};

      if($('pos-payment-group')) $('pos-payment-group').onclick=function(){openPaymentGroupFlow(orderId);};
      if($('pos-reset-split')){
        $('pos-reset-split').onclick=async function(){
          if(!confirm('Batalkan pembagian dan kembali menjadi satu tagihan? Semua bagian harus belum dibayar.'))return;
          var btn=this; btn.disabled=true;
          try{
            await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks/reset',{method:'POST',headers:headers()});
            toast('Pembagian dibatalkan.');
            openCheckManager(orderId);
          }catch(e){btn.disabled=false;toast(e.message);}
        };
      }

      $('pos-modal-card').querySelectorAll('[data-pay-check]').forEach(function(btn){
        var check=checks.find(function(x){return x.id===btn.dataset.payCheck;});
        btn.onclick=function(){if(check)openPayCheck(orderId,check);};
      });
      $('pos-modal-card').querySelectorAll('[data-pay-check-online]').forEach(function(btn){
        var check=checks.find(function(x){return x.id===btn.dataset.payCheckOnline;});
        btn.onclick=function(){if(check)openPayCheckOnline(orderId,check);};
      });
    }catch(e){toast(e.message);}
  }

  async function openPaymentGroupFlow(orderId){
    try{
      var data=await request('/pos/orders/'+encodeURIComponent(orderId)+'/payment-group/candidates',{headers:headers()});
      var current=data.order||{}, candidates=data.candidates||[];
      if(!candidates.length){toast('Tidak ada tagihan dine-in lain yang bisa digabung.');return;}
      var html='<h3>Gabungkan Tagihan</h3><p class="pos-form-help">Pilih tagihan dari meja lain yang masih menjadi satu rombongan.</p>' +
        '<div class="pos-payment-group-list">' +
          '<div class="pos-payment-group-row current"><div><strong>Meja '+esc(current.table_number||'—')+'</strong><small>#'+esc(current.order_number||current.id||'')+'</small></div><strong>'+money(current.grand_total||0)+'</strong><span class="pos-payment-group-check">✓</span></div>' +
          candidates.map(function(item){return '<label class="pos-payment-group-row"><div><strong>Meja '+esc(item.table_number||'—')+'</strong><small>#'+esc(item.order_number||item.id||'')+'</small></div><strong>'+money(item.grand_total||0)+'</strong><input type="checkbox" value="'+esc(item.id)+'" data-payment-group-order></label>';}).join('') +
        '</div>' +
        '<div class="pos-modal-actions pos-modal-nav"><button type="button" id="pos-payment-group-back" class="pos-btn ghost">Kembali</button><div class="pos-modal-nav-right"><button type="button" id="pos-payment-group-next" class="pos-btn">Lanjut</button><button type="button" id="pos-payment-group-close" class="pos-btn ghost">Tutup</button></div></div>';
      showModal(html);
      $('pos-payment-group-back').onclick=function(){openCheckManager(orderId);};
      $('pos-payment-group-close').onclick=hideModal;
      $('pos-payment-group-next').onclick=function(){
        var selected=[];
        $('pos-modal-card').querySelectorAll('[data-payment-group-order]:checked').forEach(function(input){selected.push(input.value);});
        if(!selected.length){toast('Pilih minimal satu tagihan lain.');return;}
        var selectedRows=candidates.filter(function(item){return selected.indexOf(String(item.id))>=0;});
        var total=Number(current.grand_total||0)+selectedRows.reduce(function(sum,item){return sum+Number(item.grand_total||0);},0);
        openPaymentGroupPay({sourceOrderId:orderId,orderIds:selected,orders:[current].concat(selectedRows),total:total});
      };
    }catch(e){toast(e.message);}
  }

  function openPaymentGroupPay(group){
    var total=Number(group.total||0);
    var html='<h3>Bayar Gabungan</h3><p class="pos-form-help">Beberapa tagihan, satu pembayaran.</p>' +
      '<div class="pos-payment-group-summary">'+group.orders.map(function(item){return '<div><span>Meja '+esc(item.table_number||'—')+' · #'+esc(item.order_number||item.id||'')+'</span><strong>'+money(item.grand_total||item.amount||0)+'</strong></div>';}).join('')+'</div>' +
      '<div class="pos-payment-summary"><span>Total gabungan</span><strong>'+money(total)+'</strong></div>' +
      '<label class="pos-field"><span>Uang diterima</span><div class="pos-input-nominal-wrap"><span class="pos-input-prefix">Rp</span><input id="pos-group-tendered" class="pos-input-nominal" inputmode="numeric" pattern="[0-9.]*" type="text" value="'+formatNominal(total)+'" autocomplete="off"></div></label>' +
      '<div id="pos-group-change" class="pos-payment-summary"><span>Kembalian</span><strong>'+money(0)+'</strong></div>' +
      '<div class="pos-modal-actions pos-modal-nav"><button type="button" id="pos-group-back" class="pos-btn ghost">Kembali</button><div class="pos-modal-nav-right"><button type="button" id="pos-group-submit" class="pos-btn">Bayar '+money(total)+'</button><button type="button" id="pos-group-close" class="pos-btn ghost">Tutup</button></div></div>';
    showModal(html);
    var input=$('pos-group-tendered'), change=$('pos-group-change'), submit=$('pos-group-submit');
    function updateChange(){var tendered=parseNominal(input?input.value:0);if(change)change.innerHTML='<span>Kembalian</span><strong>'+money(Math.max(0,tendered-total))+'</strong>';if(submit)submit.disabled=tendered<total;}
    bindNominalInput(input,updateChange); updateChange();
    $('pos-group-back').onclick=function(){openPaymentGroupFlow(group.sourceOrderId);};
    $('pos-group-close').onclick=hideModal;
    bindModalEnter(input,function(){if(submit&&!submit.disabled)submit.click();});
    submit.onclick=async function(){
      var tendered=parseNominal(input?input.value:0);
      if(tendered<total){toast('Uang diterima belum cukup.');return;}
      submit.disabled=true;
      try{
        await request('/pos/orders/'+encodeURIComponent(group.sourceOrderId)+'/payment-group/settle-cash',{
          method:'POST',headers:headers(),body:JSON.stringify({order_ids:group.orderIds,amount_tendered:tendered})
        });
        toast('Gabungan Tagihan berhasil dibayar.');hideModal();loadSales();
      }catch(e){submit.disabled=false;toast(e.message);}
    };
  }

  async function openPayCheck(orderId,check){
    // Always refresh the selected check before opening payment. The split
    // screen is an allocation editor, so its check balance may be stale if
    // another cashier/device has just changed the payment ledger.
    try {
      var latest=await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks',{headers:headers()});
      var latestCheck=(latest.checks||[]).find(function(c){return String(c.id)===String(check.id);});
      if(latestCheck) check=latestCheck;
    } catch(e) {
      // Keep the already-rendered check as fallback; payment is revalidated
      // transactionally by PosOrderService.
    }
    var remaining=Number(check.remaining_amount||0);
    if(remaining<=0){toast('Tagihan ini sudah lunas.');return;}
    var html='<h3>Bayar</h3>' +
      '<div class="pos-payment-summary"><span>Sisa tagihan</span><strong>'+money(remaining)+'</strong></div>' +
      '<label class="pos-field"><span>Nominal dibayar</span><div class="pos-input-nominal-wrap"><span class="pos-input-prefix">Rp</span><input id="pos-pay-amount" class="pos-input-nominal" inputmode="numeric" pattern="[0-9.]*" type="text" value="'+formatNominal(remaining)+'" autocomplete="off"></div></label>' +
      '<label class="pos-field"><span>Nama pembayar <small>(opsional)</small></span><input id="pos-pay-payer" class="pos-input" type="text" placeholder="Contoh: Budi"></label>' +
      '<label class="pos-field"><span>Uang diterima</span><div class="pos-input-nominal-wrap"><span class="pos-input-prefix">Rp</span><input id="pos-pay-tendered" class="pos-input-nominal" inputmode="numeric" pattern="[0-9.]*" type="text" value="'+formatNominal(remaining)+'" autocomplete="off"></div></label>' +
      '<div id="pos-pay-change" class="pos-payment-summary"><span>Kembalian</span><strong>'+money(0)+'</strong></div>' +
      '<div class="pos-modal-actions"><button id="pos-pay-submit" class="pos-btn">Bayar</button><button id="pos-pay-cancel" class="pos-btn ghost">Batal</button></div>';
    showModal(html);
    var amt=$('pos-pay-amount'), tend=$('pos-pay-tendered'), change=$('pos-pay-change');
    function updateChange(){
      var a=parseNominal(amt ? amt.value : 0),t=parseNominal(tend ? tend.value : 0);
      var valid=t>=a && a>0;
      if(change)change.innerHTML='<span>Kembalian</span><strong>'+money(Math.max(0,t-a))+'</strong>';
      var submitBtn=$('pos-pay-submit'); if(submitBtn)submitBtn.disabled=!valid;
    }
    bindNominalInput(amt,updateChange);
    bindNominalInput(tend,updateChange);
    bindModalEnter(amt,function(){var input=tend;if(input){input.focus();input.select();}});
    bindModalEnter(tend,function(){var submitBtn=$('pos-pay-submit');if(submitBtn&&!submitBtn.disabled)submitBtn.click();});
    updateChange();
    $('pos-pay-cancel').onclick=function(){openCheckManager(orderId);};
    $('pos-pay-submit').onclick=async function(){
      var amount=parseNominal(amt ? amt.value : 0),tendered=parseNominal(tend ? tend.value : 0);
      if(!amount||amount>remaining){toast('Nominal pembayaran tidak valid.');return;}
      if(tendered<amount){toast('Uang diterima belum cukup.');return;}
      var submitBtn=this; submitBtn.disabled=true;
      try{
        var res=await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks/'+encodeURIComponent(check.id)+'/pay',{
          method:'POST',headers:headers(),
          body:JSON.stringify({amount:amount,payment_method:'cash',payer_name:$('pos-pay-payer').value.trim()||null,amount_tendered:tendered})
        });
        toast('Pembayaran tercatat.');
        if(res && res.order_remaining != null && Number(res.order_remaining) <= 0){
          hideModal();
          showPaymentSuccess({ id: orderId, order_number: (res.payment && res.payment.order_number) || orderId, grand_total: (res.payment && res.payment.amount) || amount }, Number((res.payment && res.payment.change != null) ? res.payment.change : Math.max(0, tendered - amount)), 'cash');
          resetSale(); loadShift(); loadSales(); updateHeldCount();
          if(state.view === 'meja') loadTables();
        } else {
          openCheckManager(orderId);
        }
      }catch(e){submitBtn.disabled=false;toast(e.message);}
    };
  }

  async function openPayCheckOnline(orderId,check){
    var remaining=Number(check.remaining_amount||0);
    if(remaining<=0){toast('Tagihan ini sudah lunas atau sedang diproses.');return;}
    var html='<h3>Bayar Online</h3><div class="pos-payment-summary"><span>Sisa Check</span><strong>'+money(remaining)+'</strong></div>'+
      '<label class="pos-field"><span>Nominal pembayaran</span><div class="pos-input-nominal-wrap"><span class="pos-input-prefix">Rp</span><input id="pos-online-pay-amount" class="pos-input-nominal" inputmode="numeric" pattern="[0-9.]*" type="text" value="'+formatNominal(remaining)+'" autocomplete="off"></div></label>'+
      '<label class="pos-field"><span>Nama pembayar <small>(opsional)</small></span><input id="pos-online-pay-payer" class="pos-input" type="text" placeholder="Contoh: Budi"></label>'+
      '<div class="pos-modal-actions"><button id="pos-online-pay-submit" class="pos-btn">Buat Pembayaran</button><button id="pos-online-pay-cancel" class="pos-btn ghost">Batal</button></div>';
    showModal(html);
    var amountInput=$('pos-online-pay-amount');
    bindNominalInput(amountInput,function(){var value=parseNominal(amountInput.value);$('pos-online-pay-submit').disabled=value<=0||value>remaining;});
    $('pos-online-pay-cancel').onclick=function(){openCheckManager(orderId);};
    $('pos-online-pay-submit').onclick=async function(){
      var amount=parseNominal(amountInput.value);
      if(amount<=0||amount>remaining){toast('Nominal pembayaran melebihi sisa check.');return;}
      var button=this;button.disabled=true;
      var paymentWindow=window.open('about:blank','_blank');
      try{
        var result=await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks/'+encodeURIComponent(check.id)+'/pay-online',{method:'POST',headers:headers(),body:JSON.stringify({amount:amount,payer_name:$('pos-online-pay-payer').value.trim()||null})});
        var url=result.payment&&result.payment.redirect_url;
        if(!url)throw new Error('Gateway tidak memberikan tautan pembayaran.');
        if(paymentWindow)paymentWindow.location.href=url;else window.location.href=url;
        toast('Pembayaran online dibuat. Check akan diperbarui setelah callback gateway.');
        openCheckManager(orderId);
      }catch(e){if(paymentWindow)paymentWindow.close();button.disabled=false;toast(e.message);}
    };
  }

  async function openHeld(){
    var held=await updateHeldCount();
    if(!held.length){toast('Tidak ada pesanan yang ditahan.');return;}
    showModal('<h3>Pesanan Ditahan (Hold Bill)</h3><p>Pilih bill untuk dilanjutkan atau dibatalkan.</p><div class="pos-held-modal-list">'+held.map(function(h){
      var items=[]; try{items=JSON.parse(h.items_payload||'[]');}catch(_){}
      var subtotal=items.reduce(function(s,i){return s+(Number(i.unit_price)||0)*Number(i.quantity||0)},0);
      var itemSummary=items.map(function(i){return (i.quantity||1)+'x '+(i.name||'Item');}).join(', ');
      var oType = h.order_type || (h.table_number ? 'dine_in' : 'pickup');
      var typeTitle = (oType === 'dine_in') ? ('Meja ' + esc(h.table_number || '—')) : (oType === 'pickup' ? 'Takeaway' : oType === 'delivery' ? 'Delivery' : esc(oType));
      return '<div class="pos-held-modal-card">' +
        '<div class="pos-held-modal-main">' +
          '<strong>' + typeTitle + ' · ' + esc(h.customer_name || 'Tamu') + '</strong>' +
          '<div class="pos-held-modal-desc">'+esc(itemSummary||'Item')+'</div>' +
          '<div class="pos-held-modal-price">'+money(subtotal)+'</div>' +
        '</div>' +
        '<div class="pos-held-modal-actions">' +
          '<button type="button" class="pos-btn small ghost danger" data-cancel-held="'+esc(h.id)+'">Batal</button>' +

          '<button type="button" class="pos-btn small" data-resume-held="'+esc(h.id)+'">Buka</button>' +
        '</div>' +
      '</div>';
    }).join('')+'</div><div class="pos-modal-actions"><button type="button" class="pos-btn ghost" id="pos-held-modal-close">Tutup</button></div>');
    if($('pos-held-modal-close')) $('pos-held-modal-close').onclick=hideModal;
    $('pos-modal-card').querySelectorAll('[data-resume-held]').forEach(function(b){b.onclick=function(){resumeHeld(b.dataset.resumeHeld);};});
    $('pos-modal-card').querySelectorAll('[data-cancel-held]').forEach(function(b){b.onclick=function(){cancelHeld(b.dataset.cancelHeld);};});

  }

  function updateTransaksiStats(){
    var badge=$('pos-transaksi-stats');
    if(!badge)return;
    var shiftStart = (state.shift && state.shift.opened_at) ? new Date(state.shift.opened_at).getTime() : 0;
    var todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    var startTime = (shiftStart > 0) ? shiftStart : todayStart.getTime();
    var sales = state.sales || [];
    var count = sales.filter(function(s){
      var t = s.created_at ? new Date(s.created_at).getTime() : 0;
      var ps = (s.payment_status || '').toLowerCase();
      var isPaid = !ps || ps === 'paid' || ps === 'settled' || ps === 'settlement';
      var st = (s.status || '').toLowerCase();
      var isNotCancelled = !['cancelled','rejected','timeout','expired','fulfillment_exception','void'].includes(st);
      return t >= startTime && isPaid && isNotCancelled;
    }).length;
    badge.textContent = count + ' Transaksi';
  }

  async function loadSales(){
    if(!state.branchId && state.user && state.user.branch_id) state.branchId = state.user.branch_id;
    try{
      var d=await request('/pos/sales?branch_id='+encodeURIComponent(state.branchId),{headers:headers()});
      state.sales=d.sales||[]; renderSales();
    }catch(e){if($('pos-sales-list'))$('pos-sales-list').innerHTML='<div class="pos-empty">Riwayat transaksi tidak tersedia.</div>';}
    await updateHeldCount();
    updateTransaksiStats();
    if(state.transaksiTab==='held') renderHeldSales();
  }

  function renderSales(){
    updateTransaksiStats();
    var box=$('pos-sales-list');if(!box)return;
    if(!state.sales.length){box.innerHTML='<div class="pos-empty">Belum ada transaksi POS.</div>';return;}
    box.innerHTML=state.sales.map(function(s){
      var isOjol = s.order_channel === 'gofood' || s.order_channel === 'grabfood' || s.order_channel === 'shopeefood';
      var orderStatus = String(s.status || '').toLowerCase();
      var isTerminalOrder = ['cancelled','rejected','timeout','expired','fulfillment_exception'].includes(orderStatus);
      var isCodPending = !isOjol && s.order_type === 'delivery' && s.payment_method === 'cash' && s.payment_status !== 'settlement' && s.payment_status !== 'paid';
      var isPendingPayment = !isTerminalOrder && !isOjol && !isCodPending && s.payment_status !== 'settlement' && s.payment_status !== 'paid';
      var badgeCls = isOjol ? 'ok' : (isCodPending ? 'caution' : (isPendingPayment ? 'caution' : (s.payment_status === 'settlement' || s.payment_status === 'paid' ? 'ok' : 'pending')));
      var terminalLabels = {timeout:'KEDALUWARSA',expired:'KEDALUWARSA',cancelled:'DIBATALKAN',rejected:'DITOLAK',fulfillment_exception:'GAGAL DIPROSES'};
      var badgeLabel = isTerminalOrder ? (terminalLabels[orderStatus] || 'TIDAK AKTIF') : (isOjol ? (s.order_channel === 'gofood' ? 'GOFOOD' : (s.order_channel === 'grabfood' ? 'GRABFOOD' : 'SHOPEE')) : (isCodPending ? (s.cod_cash_custody === 'driver' ? 'COD (Di Driver)' : 'COD Pending') : (isPendingPayment ? 'BELUM BAYAR' : (s.payment_status === 'settlement' ? 'LUNAS' : (s.payment_status || 'paid').toUpperCase()))));
      var codActionBtn = isCodPending && !isTerminalOrder ? '<button type="button" class="pos-btn small" data-cod-settle="'+esc(s.id)+'" style="margin-left:6px;">Setor COD</button>' : '';
      var payActionBtn = isPendingPayment ? '<button type="button" class="pos-btn small primary" data-open-pay="'+esc(s.id)+'" style="margin-left:6px;">Bayar di Kasir</button>' : '';
      var oTypeDisplay = isOjol ? 'OJOL' : (s.order_type === 'pickup' ? 'TAKEAWAY' : (s.order_type === 'dine_in' ? 'DINE-IN' : (s.order_type || '').toUpperCase()));
      return '<div class="pos-sale-row" data-sale-id="'+esc(s.id)+'" role="button" tabindex="0" title="Klik untuk rincian transaksi">' +
        '<div class="pos-sale-main"><strong>#'+esc(s.order_number||s.id)+'</strong><small>'+esc(s.created_at||'')+'</small></div>' +
        '<div>'+esc(oTypeDisplay)+'</div>' +
        '<div><span class="pos-badge '+badgeCls+'">'+esc(badgeLabel)+'</span></div>' +
        '<div class="pos-sale-total">'+money(s.grand_total)+'</div>' +
        '<div class="pos-sale-actions" style="display:flex;gap:6px;align-items:center;">' +
          codActionBtn +
          payActionBtn +
          '<button type="button" class="pos-btn small ghost" data-print="'+esc(s.id)+'">Struk</button>' +
        '</div>' +
      '</div>';
    }).join('');
    box.querySelectorAll('.pos-sale-row').forEach(function(row){
      row.onclick = function(e){
        if(e.target.closest('button')) return;
        openSaleDetailModal(row.dataset.saleId);
      };
      row.onkeydown = function(e){
        if((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')){
          e.preventDefault();
          openSaleDetailModal(row.dataset.saleId);
        }
      };
    });
    box.querySelectorAll('[data-print]').forEach(function(b){b.onclick=function(e){e.stopPropagation();printReceipt(b.dataset.print);};});
    box.querySelectorAll('[data-cod-settle]').forEach(function(b){b.onclick=function(e){e.stopPropagation();openCodSettlementModal(b.dataset.codSettle);};});
    box.querySelectorAll('[data-open-pay]').forEach(function(b){b.onclick=function(e){e.stopPropagation();openDirectOrderPayModal(b.dataset.openPay);};});
  }

  async function openCodSettlementModal(orderId){
    try{
      var res = await request('/pos/orders/' + encodeURIComponent(orderId), { headers: headers() });
      var o = res.order;
      var d = res.delivery || {};
      var expectedAmount = Number(o.grand_total || 0);

      var html = '<div class="pos-cod-modal" style="padding:10px 0;">' +
        '<div class="pos-simple-bill-head" style="margin-bottom:16px;">' +
          '<div>' +
            '<h3 style="margin:0 0 4px 0;">Terima Setoran COD</h3>' +
            '<p style="margin:0;font-size:13px;color:var(--text-muted,#6b7280);">Pesanan #' + esc(o.order_number || o.id) + '</p>' +
          '</div>' +
          '<div class="pos-simple-bill-total" style="font-size:20px;font-weight:700;color:var(--brand-primary,#059669);">' + money(expectedAmount) + '</div>' +
        '</div>' +
        '<div style="background:var(--bg-subtle,#f9fafb);padding:14px;border-radius:10px;margin-bottom:16px;font-size:13px;line-height:1.6;">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Pelanggan:</span><strong>' + esc(o.customer_name || 'Pelanggan') + ' (' + esc(o.customer_phone || '-') + ')</strong></div>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Driver:</span><strong>' + esc(d.driver_name || 'Driver Cabang') + (d.driver_phone ? ' (' + esc(d.driver_phone) + ')' : '') + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Status Antar:</span><span class="pos-badge ok">' + esc((d.status || 'delivered').toUpperCase()) + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;"><span>Fisik Kas:</span><strong style="color:#d97706;">' + (d.cod_cash_custody === 'driver' ? 'Pegang oleh Driver' : 'Kasir') + '</strong></div>' +
        '</div>' +
        '<div class="pos-form-group" style="margin-bottom:16px;">' +
          '<label style="display:block;margin-bottom:6px;font-weight:600;font-size:13px;">Uang Diterima dari Driver (Rp)</label>' +
          '<input type="number" id="pos-cod-amount-tendered" class="pos-input" value="' + expectedAmount + '" min="' + expectedAmount + '" style="width:100%;font-size:16px;padding:10px 12px;border:1px solid var(--border,#d1d5db);border-radius:8px;" />' +
        '</div>' +
        '<div class="pos-modal-actions" style="display:flex;gap:10px;justify-content:flex-end;">' +
          '<button type="button" class="pos-btn ghost" id="pos-cod-modal-close">Batal</button>' +
          '<button type="button" class="pos-btn primary" id="pos-cod-modal-submit">Konfirmasi & Lunasi</button>' +
        '</div>' +
      '</div>';

      showModal(html);
      $('pos-cod-modal-close').onclick = hideModal;
      $('pos-cod-modal-submit').onclick = async function(){
        var btn = this;
        var tendered = Number($('pos-cod-amount-tendered').value || 0);
        if(!tendered || tendered < expectedAmount){
          toast('Nominal uang diterima kurang dari total tagihan.');
          return;
        }
        btn.disabled = true;
        try{
          await request('/pos/orders/' + encodeURIComponent(orderId) + '/cod-handover', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ received_amount: tendered })
          });
          hideModal();
          toast('Setoran COD berhasil diterima dan tercatat di kas shift.');
          await loadSales();
          await loadShift();
        }catch(e){
          btn.disabled = false;
          toast(e.message || 'Gagal menyelesaikan setoran COD.');
        }
      };
    }catch(e){
      toast(e.message || 'Gagal memuat detail pesanan.');
    }
  }

  async function openDirectOrderPayModal(orderId){
    if(!orderId) return toast('Tagihan ini belum memiliki order.');
    if(!state.shift) return toast('Buka shift kasir terlebih dahulu sebelum menerima pembayaran.');
    if(state.shift.active_break) return toast('Akhiri istirahat sebelum melanjutkan transaksi.');

    try{
      var [orderRes, checksRes, additionsRes] = await Promise.all([
        request('/pos/orders/' + encodeURIComponent(orderId), { headers: headers() }),
        request('/pos/orders/' + encodeURIComponent(orderId) + '/checks', { headers: headers() }).catch(function(){ return { checks: [] }; }),
        request('/pos/orders/' + encodeURIComponent(orderId) + '/additions', { headers: headers() }).catch(function(){ return { additions: [] }; })
      ]);

      var o = orderRes && orderRes.order;
      if(!o) return toast('Pesanan tidak ditemukan.');
      var items = (orderRes && orderRes.items) || [];
      var checks = (checksRes && checksRes.checks) || [];
      var additions = (additionsRes && additionsRes.additions) || [];

      // If already split into multiple checks (>1), route directly to check manager
      if(checks.length > 1){
        return openCheckManager(orderId);
      }

      var grandTotal = Number(o.grand_total || 0);
      var isAlreadySettled = o.payment_status === 'settlement' || o.payment_status === 'paid';
      if(isAlreadySettled){
        return toast('Pesanan ini sudah lunas.');
      }

      // Check pending additions
      var pendingAdditions = additions.filter(function(a){ return a.status === 'pending_acceptance'; });
      var pendingAdditionBanner = '';
      if(pendingAdditions.length > 0){
        pendingAdditionBanner = '<div class="pos-direct-pay-warning">' +
          '⚠️ <strong>Perhatian:</strong> Ada <strong>' + pendingAdditions.length + ' pesanan tambahan</strong> yang belum dikonfirmasi dapur. Konfirmasi di Merchant App sebelum pelunasan, atau tagihan saat ini belum mencakup menu tambahan tersebut.' +
        '</div>';
      }

      var typeTitle = (o.order_type === 'dine_in')
        ? (o.table_number ? ('Meja ' + esc(o.table_number)) : 'Dine-In')
        : (o.order_type === 'pickup' ? 'Takeaway' : (o.order_type === 'delivery' ? 'Delivery' : esc(o.order_type)));

      var itemsSummary = items.map(function(it){
        return (Number(it.quantity) || 1) + 'x ' + esc(it.product_name || it.name || 'Item');
      }).join(', ');

      function generateDenominations(val){
        var list = [val];
        var denoms = [10000, 20000, 50000, 100000, 200000, 500000];
        denoms.forEach(function(d){
          if(d > val && list.indexOf(d) === -1 && list.length < 5){
            list.push(d);
          }
        });
        var ceil50 = Math.ceil(val / 50000) * 50000;
        if(ceil50 > val && list.indexOf(ceil50) === -1 && list.length < 5){
          list.push(ceil50);
        }
        var ceil100 = Math.ceil(val / 100000) * 100000;
        if(ceil100 > val && list.indexOf(ceil100) === -1 && list.length < 5){
          list.push(ceil100);
        }
        return list.sort(function(a,b){ return a - b; });
      }

      var quickDenoms = generateDenominations(grandTotal);
      var quickButtonsHtml = quickDenoms.map(function(d){
        var isPas = d === grandTotal;
        var label = isPas ? 'Uang Pas' : money(d);
        var activeCls = isPas ? ' active' : '';
        return '<button type="button" class="pos-btn-quick-cash' + activeCls + '" data-denom="' + d + '">' + esc(label) + '</button>';
      }).join('');

      var itemsListHtml = items.map(function(it){
        var itPrice = (Number(it.unit_price) || 0) * (Number(it.quantity) || 1);
        return '<div class="pos-direct-item-row">' +
          '<div class="pos-direct-item-name"><strong>' + (it.quantity || 1) + 'x</strong> ' + esc(it.product_name || it.name || 'Item') + '</div>' +
          '<div class="pos-direct-item-price">' + (itPrice > 0 ? money(itPrice) : '') + '</div>' +
        '</div>';
      }).join('');

      var html = '<div class="pos-direct-pay-modal">' +
        '<div class="pos-direct-pay-head">' +
          '<div class="pos-direct-pay-title-wrap">' +
            '<div class="pos-direct-pay-tag-row">' +
              '<span class="pos-direct-pay-badge">Bayar ' + esc(typeTitle) + '</span>' +
              '<span class="pos-direct-pay-orderno">#' + esc(o.order_number || o.id) + '</span>' +
            '</div>' +
            '<div class="pos-direct-pay-customer">' + esc(o.customer_name || 'Pelanggan') + (o.customer_phone ? (' · ' + esc(o.customer_phone)) : '') + '</div>' +
          '</div>' +
          '<button type="button" class="pos-modal-close-icon" id="pos-direct-close-x" aria-label="Tutup">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
          '</button>' +
        '</div>' +
        '<div class="pos-direct-total-banner">' +
          '<div class="pos-direct-total-label">Total Tagihan</div>' +
          '<div class="pos-direct-total-amount">' + money(grandTotal) + '</div>' +
        '</div>' +
        pendingAdditionBanner +
        (items.length ? ('<div class="pos-direct-items-box">' +
          '<div class="pos-direct-items-header"><span>Rincian Menu</span><span class="pos-direct-items-count">' + items.length + ' menu</span></div>' +
          '<div class="pos-direct-items-list">' + itemsListHtml + '</div>' +
        '</div>') : '') +
        '<div class="pos-form-row" style="margin-top:6px;margin-bottom:0;">' +
          '<label class="pos-direct-input-label">Uang Diterima (Tunai)</label>' +
          '<div class="pos-input-nominal-wrap">' +
            '<span class="pos-direct-currency-prefix">Rp</span>' +
            '<input type="text" id="pos-direct-tendered" class="pos-input-nominal" inputmode="numeric" autocomplete="off" value="' + formatNominal(grandTotal) + '">' +
          '</div>' +
          '<div class="pos-direct-denom-grid">' + quickButtonsHtml + '</div>' +
        '</div>' +
        '<div id="pos-direct-change" class="pos-change">' +
          '<span>Kembalian</span><strong id="pos-direct-change-val">Rp 0</strong>' +
        '</div>' +
        '<div class="pos-direct-actions-row">' +
          '<button type="button" class="pos-btn ghost" id="pos-direct-cancel-btn">Batal</button>' +
          '<button type="button" class="pos-btn primary" id="pos-direct-submit-btn">Bayar</button>' +
        '</div>' +
        '<div class="pos-direct-split-wrap">' +
          '<button type="button" class="pos-btn-split-link" id="pos-direct-split-btn">Pisah Tagihan (Split)</button>' +
        '</div>' +
      '</div>';

      showModal(html);

      var inputTendered = $('pos-direct-tendered');
      var changeBox = $('pos-direct-change');
      var submitBtn = $('pos-direct-submit-btn');

      function updateChange(){
        var val = parseNominal(inputTendered ? inputTendered.value : 0);
        var diff = val - grandTotal;
        document.querySelectorAll('.pos-direct-denom-grid .pos-btn-quick-cash').forEach(function(b){
          b.classList.toggle('active', Number(b.dataset.denom || 0) === val);
        });
        if(diff >= 0){
          if(changeBox) {
            changeBox.className = 'pos-change';
            changeBox.innerHTML = '<span>Kembalian</span><strong id="pos-direct-change-val">' + money(diff) + '</strong>';
          }
          if(submitBtn) submitBtn.disabled = false;
        } else {
          if(changeBox) {
            changeBox.className = 'pos-change danger';
            changeBox.innerHTML = '<span>Uang Kurang</span><strong id="pos-direct-change-val">' + money(Math.abs(diff)) + '</strong>';
          }
          if(submitBtn) submitBtn.disabled = true;
        }
      }

      bindNominalInput(inputTendered, updateChange);
      bindModalEnter(inputTendered, function(){
        if(submitBtn && !submitBtn.disabled) submitBtn.click();
      });

      document.querySelectorAll('.pos-direct-denom-grid .pos-btn-quick-cash').forEach(function(btn){
        btn.onclick = function(){
          document.querySelectorAll('.pos-direct-denom-grid .pos-btn-quick-cash').forEach(function(b){ b.classList.remove('active'); });
          btn.classList.add('active');
          var d = Number(btn.dataset.denom || 0);
          if(inputTendered){
            inputTendered.value = formatNominal(d);
            updateChange();
          }
        };
      });

      if($('pos-direct-close-x')) $('pos-direct-close-x').onclick = hideModal;
      if($('pos-direct-cancel-btn')) $('pos-direct-cancel-btn').onclick = hideModal;

      if($('pos-direct-split-btn')){
        $('pos-direct-split-btn').onclick = function(){
          openCheckManager(orderId);
        };
      }

      if(submitBtn){
        submitBtn.onclick = async function(){
          var tendered = parseNominal(inputTendered ? inputTendered.value : 0);
          if(tendered < grandTotal){
            return toast('Uang yang diterima belum mencukupi total tagihan.');
          }
          submitBtn.disabled = true;
          submitBtn.textContent = 'Memproses...';

          try{
            var res = await request('/pos/orders/' + encodeURIComponent(orderId) + '/settle-cash', {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify({
                amount_tendered: Number(tendered),
                shift_id: state.shift.id
              })
            });

            if(res && res.success){
              hideModal();
              var changeAmt = Number((res.payment && res.payment.change != null) ? res.payment.change : Math.max(0, tendered - grandTotal));
              showPaymentSuccess({
                id: o.id,
                order_number: (res.payment && res.payment.order_number) || o.order_number || o.id,
                grand_total: grandTotal
              }, changeAmt, 'cash');

              resetSale();
              loadShift();
              loadSales();
              updateHeldCount();
              if(state.view === 'meja') loadTables();
              return;
            }
            submitBtn.disabled = false;
            submitBtn.textContent = 'Bayar';
            toast((res && res.error) || 'Gagal menyelesaikan pembayaran.');
          } catch(err){
            submitBtn.disabled = false;
            submitBtn.textContent = 'Bayar';
            toast(err.message || 'Gagal memproses pembayaran.');
          }
        };
      }

      updateChange();
    } catch(e){
      toast(e.message || 'Gagal memuat data pembayaran.');
    }
  }

  /* =========================================================================
     DRIVER QR SCANNER & COD SETTLEMENT SHORTCUT
     ========================================================================= */
  var _posScannerStream = null;
  var _posScannerRaf = null;

  function stopPosDriverScanner(){
    if(_posScannerRaf){
      if(typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_posScannerRaf);
      _posScannerRaf = null;
    }
    if(_posScannerStream){
      try{ _posScannerStream.getTracks().forEach(function(t){ t.stop(); }); }catch(_){}
      _posScannerStream = null;
    }
    var el = $('pos-driver-qr-scanner-overlay');
    if(el) el.remove();
  }

  function openDriverQrScanModal(){
    stopPosDriverScanner();

    var hasDetector = (typeof window.BarcodeDetector === 'function');
    var hasCamera = !!(window.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    var canScan = hasDetector && hasCamera;

    var overlay = document.createElement('div');
    overlay.id = 'pos-driver-qr-scanner-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.88);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:18px;padding:22px;max-width:380px;width:100%;text-align:center;box-shadow:0 20px 25px -5px rgba(0,0,0,0.3);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
          '<h3 style="margin:0;font-size:17px;font-weight:800;color:#0f172a;">Scan QR Kurir / Setor COD</h3>' +
          '<button type="button" id="pos-scan-close-btn" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;">✕</button>' +
        '</div>' +
        '<p style="margin:0 0 14px;font-size:12.5px;color:#64748b;line-height:1.4;">Arahkan kamera ke QR setoran pada HP kurir atau masukkan nomor pesanan.</p>' +
        '<div id="pos-qr-video-wrap" style="position:relative;width:100%;height:0;padding-bottom:80%;background:#0f172a;border-radius:12px;overflow:hidden;margin:0 auto 14px;display:' + (canScan ? 'block' : 'none') + ';">' +
          '<video id="pos-qr-video" playsinline autoplay muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"></video>' +
          '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">' +
            '<div style="width:70%;height:70%;border:3px solid #10b981;border-radius:14px;box-shadow:0 0 0 9999px rgba(15,23,42,.35);"></div>' +
          '</div>' +
        '</div>' +
        '<div id="pos-qr-status" style="font-size:12px;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:8px 10px;margin-bottom:12px;' + (!canScan ? 'display:block;' : 'display:none;') + '">' +
          (!hasCamera ? 'Kamera tidak terdeteksi pada perangkat ini. Silakan gunakan input manual / barcode scanner USB/Bluetooth.' : (!hasDetector ? 'WebView perangkat belum mendukung scanner otomatis. Silakan input nomor pesanan / barcode scanner.' : '')) +
        '</div>' +
        '<div style="text-align:left;margin-bottom:6px;font-size:12px;font-weight:700;color:#374151;">Input Manual / Barcode Scanner:</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:12px;">' +
          '<input id="pos-qr-manual-input" type="text" placeholder="No. Pesanan / Scan Barcode" style="flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13.5px;font-family:inherit;">' +
          '<button type="button" id="pos-qr-manual-btn" style="background:#059669;color:#fff;border:none;padding:0 14px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">Cari</button>' +
        '</div>' +
        '<button type="button" id="pos-scan-cancel-btn" style="width:100%;height:40px;border:1px solid #d1d5db;border-radius:10px;background:#f9fafb;color:#4b5563;font-weight:700;font-size:13px;cursor:pointer;">Tutup</button>' +
      '</div>';

    document.body.appendChild(overlay);

    function setStatus(msg, isError){
      var el = overlay.querySelector('#pos-qr-status');
      if(!el) return;
      el.textContent = msg;
      el.style.display = 'block';
      if(isError){
        el.style.color = '#b91c1c';
        el.style.background = '#fef2f2';
        el.style.borderColor = '#fecaca';
      } else {
        el.style.color = '#047857';
        el.style.background = '#ecfdf5';
        el.style.borderColor = '#a7f3d0';
      }
    }

    async function processCode(code){
      if(!code || !code.trim()) return;
      setStatus('Mencari data pesanan...', false);
      try {
        var res = await request('/pos/delivery/lookup-by-qr?code=' + encodeURIComponent(code.trim()), { headers: headers() });
        if(res && res.success && res.order){
          stopPosDriverScanner();
          if(!res.delivery.is_ready_for_handover){
            toast('Pesanan #' + (res.order.order_number || res.order.id) + ' (Status: ' + (res.delivery.status || 'selesai') + '). Kas COD: ' + (res.delivery.cod_collection_status === 'handed_over' ? 'Sudah disetor ke Kasir' : (res.delivery.cod_cash_custody || '')));
            return;
          }
          openCodSettlementModal(res.order.id);
        } else {
          setStatus('Pesanan tidak ditemukan atau bukan milik cabang ini.', true);
        }
      } catch(err){
        setStatus(err.message || 'Gagal mencari pesanan.', true);
      }
    }

    overlay.querySelector('#pos-scan-close-btn').onclick = stopPosDriverScanner;
    overlay.querySelector('#pos-scan-cancel-btn').onclick = stopPosDriverScanner;

    var manualInput = overlay.querySelector('#pos-qr-manual-input');
    var manualBtn = overlay.querySelector('#pos-qr-manual-btn');
    manualBtn.onclick = function(){ processCode(manualInput.value); };
    manualInput.onkeydown = function(e){ if(e.key === 'Enter'){ e.preventDefault(); processCode(manualInput.value); } };

    if(canScan){
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function(stream){
        _posScannerStream = stream;
        var video = overlay.querySelector('#pos-qr-video');
        if(!video){ stopPosDriverScanner(); return; }
        video.srcObject = stream;
        if(video.play) { var p = video.play(); if(p && p.catch) p.catch(function(){}); }

        var detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
        var scanning = true;
        var tick = function(){
          if(!scanning) return;
          detector.detect(video).then(function(codes){
            if(codes && codes.length && codes[0].rawValue){
              scanning = false;
              processCode(codes[0].rawValue);
            } else {
              _posScannerRaf = requestAnimationFrame(tick);
            }
          }).catch(function(){
            _posScannerRaf = requestAnimationFrame(tick);
          });
        };
        _posScannerRaf = requestAnimationFrame(tick);
      }).catch(function(err){
        var wrap = overlay.querySelector('#pos-qr-video-wrap');
        if(wrap) wrap.style.display = 'none';
        setStatus('Kamera tidak aktif atau izin ditolak. Silakan gunakan input manual / barcode scanner.', true);
      });
    }
  }
  window.openDriverQrScanModal = openDriverQrScanModal;

  async function openSaleDetailModal(orderId){
    try{
      var res = await request('/pos/orders/' + encodeURIComponent(orderId), { headers: headers() });
      var o = res.order;
      var d = res.delivery || null;
      var p = res.payment || {};
      var items = res.items || [];
      var isCodPending = o.order_type === 'delivery' && o.payment_method === 'cash' && p.payment_status !== 'settlement' && p.payment_status !== 'paid';
      var isUnpaid = !isCodPending && p.payment_status !== 'settlement' && p.payment_status !== 'paid' && o.payment_status !== 'settlement' && o.payment_status !== 'paid';

      var isOjol = o.order_channel === 'gofood' || o.order_channel === 'grabfood' || o.order_channel === 'shopeefood';
      var oChannelName = isOjol
        ? (o.order_channel === 'gofood' ? 'GoFood' : (o.order_channel === 'grabfood' ? 'GrabFood' : 'ShopeeFood'))
        : (o.order_channel === 'online' ? 'Web Pesan Online' : 'POS Kasir');

      var isPaid = p.payment_status === 'settlement' || p.payment_status === 'paid' || o.payment_status === 'settlement' || o.payment_status === 'paid';
      var statusBadgeCls = isPaid ? 'ok' : ((isCodPending || isUnpaid) ? 'caution' : 'pending');
      var statusBadgeLabel = isOjol
        ? oChannelName.toUpperCase()
        : (isCodPending
            ? (d && d.cod_cash_custody === 'driver' ? 'COD (DI DRIVER)' : 'COD PENDING')
            : (isUnpaid ? 'BELUM BAYAR' : (isPaid ? 'LUNAS' : (o.payment_status || 'PENDING').toUpperCase())));

      // Service type label
      var tableTxt = o.table_number ? ('Meja ' + o.table_number) : (o.table_id ? ('Meja ' + o.table_id) : 'Tanpa Meja');
      var typeLabel = 'Takeaway';
      if(o.order_type === 'dine_in'){
        typeLabel = 'Dine-In (' + tableTxt + ')';
      } else if(o.order_type === 'delivery'){
        typeLabel = isOjol ? ('Ojol (' + oChannelName + ')') : 'Delivery Toko';
      } else if(o.order_type === 'pickup'){
        typeLabel = 'Takeaway / Bungkus';
      }

      // Customer display
      var customerText = esc(o.customer_name || 'Pelanggan Walk-in');
      if(o.customer_phone) customerText += ' <small style="color:var(--muted);font-weight:normal;">(' + esc(o.customer_phone) + ')</small>';

      // Payment method label
      var payMethodLabel = 'Tunai (Cash)';
      var m = (p.payment_method || o.payment_method || '').toLowerCase();
      if(m === 'qris') payMethodLabel = 'QRIS';
      else if(m === 'transfer') payMethodLabel = 'Transfer Bank';
      else if(m === 'card' || m === 'debit' || m === 'edc') payMethodLabel = 'Kartu Debit/Kredit';
      else if(m === 'cod') payMethodLabel = 'Cash on Delivery (COD)';
      else if(isOjol) payMethodLabel = 'Saldo Online Ojol';

      var cashierName = o.cashier_name || (state.user && (state.user.name || state.user.full_name || state.user.username)) || 'Kasir';

      // Items list
      var itemsCount = items.reduce(function(acc, it){ return acc + (Number(it.quantity) || 1); }, 0);
      var itemsHtml = items.map(function(it){
        var qty = Number(it.quantity) || 1;
        var unitPrice = Number(it.unit_price || it.price || 0);
        var itemTotal = Number(it.item_subtotal || it.subtotal || it.total_price || (unitPrice * qty)) || 0;
        var note = (it.notes || it.note || '').trim();
        var optionsStr = '';
        if (it.options_json) {
          try {
            var opts = typeof it.options_json === 'string' ? JSON.parse(it.options_json) : it.options_json;
            if (Array.isArray(opts) && opts.length) {
              optionsStr = opts.map(function(op){ return typeof op === 'string' ? op : (op.name || op.option_name || ''); }).filter(Boolean).join(', ');
            }
          } catch(e){}
        }
        return '<div class="pos-sale-item-row">' +
          '<div class="pos-sale-item-col-qty"><span class="pos-sale-qty-pill">' + qty + 'x</span></div>' +
          '<div class="pos-sale-item-col-info">' +
            '<div class="pos-sale-item-name">' + esc(it.product_name || 'Item') + '</div>' +
            (unitPrice > 0 ? '<div class="pos-sale-item-unit">@ ' + money(unitPrice) + '</div>' : '') +
            (optionsStr ? '<div class="pos-sale-item-opt">' + esc(optionsStr) + '</div>' : '') +
            (note ? '<div class="pos-sale-item-note">📝 ' + esc(note) + '</div>' : '') +
          '</div>' +
          '<div class="pos-sale-item-col-price">' + money(itemTotal) + '</div>' +
        '</div>';
      }).join('');

      // Delivery info section
      var deliveryHtml = '';
      if(d){
        var isDelivered = d.status === 'completed' || d.status === 'delivered';
        var custodyText = d.cod_cash_custody === 'driver' ? 'Dipegang Driver' : (d.cod_cash_custody === 'cashier' ? 'Sudah Disetor ke Kasir' : 'Menunggu Serah Terima');
        var custodyColor = d.cod_cash_custody === 'cashier' ? 'var(--ok, #166534)' : '#d97706';
        deliveryHtml = '<div class="pos-sale-delivery-card">' +
          '<div class="pos-sale-delivery-header">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span style="font-size:16px;">🛵</span>' +
              '<strong>Info Pengantaran & Kurir</strong>' +
            '</div>' +
            '<span class="pos-badge ' + (isDelivered ? 'ok' : 'pending') + '">' + esc((d.status || '').toUpperCase()) + '</span>' +
          '</div>' +
          '<div class="pos-sale-delivery-grid">' +
            '<div><span>Kurir:</span> <strong>' + esc(d.driver_name || '—') + (d.driver_phone ? ' (' + esc(d.driver_phone) + ')' : '') + '</strong></div>' +
            (o.payment_method === 'cash' ? '<div><span>Fisik Kas COD:</span> <strong style="color:' + custodyColor + '">' + custodyText + '</strong></div>' : '') +
          '</div>' +
        '</div>';
      }

      // Financials
      var subtotal = Number(o.subtotal || 0);
      var discount = Number(o.discount || 0);
      var tax = Number(o.tax || 0);
      var deliveryFee = Number(o.delivery_fee || 0);
      var grandTotal = Number(o.grand_total || 0);
      var amountTendered = Number(o.amount_tendered || p.amount_tendered || 0);
      var changeAmount = Number(o.change_amount || p.change_amount || 0);

      var breakdownRows = '';
      if(subtotal > 0 && subtotal !== grandTotal){
        breakdownRows += '<div class="pos-sale-summary-row"><span>Subtotal Menu</span><span>' + money(subtotal) + '</span></div>';
      }
      if(discount > 0){
        breakdownRows += '<div class="pos-sale-summary-row pos-sale-discount"><span>Diskon</span><span>- ' + money(discount) + '</span></div>';
      }
      if(tax > 0){
        breakdownRows += '<div class="pos-sale-summary-row"><span>Pajak (PB1)</span><span>' + money(tax) + '</span></div>';
      }
      if(deliveryFee > 0){
        breakdownRows += '<div class="pos-sale-summary-row"><span>Ongkos Kirim</span><span>' + money(deliveryFee) + '</span></div>';
      }

      var cashTenderHtml = '';
      if(amountTendered > 0){
        cashTenderHtml = '<div class="pos-sale-cash-tender-row">' +
          '<div><span>Uang Diterima:</span> <strong>' + money(amountTendered) + '</strong></div>' +
          '<div><span>Kembalian:</span> <strong style="color:var(--ok,#166534);">' + money(changeAmount) + '</strong></div>' +
        '</div>';
      }

      var orderDateDisplay = o.created_at || '';
      try {
        var dt = new Date(o.created_at);
        if(!isNaN(dt.getTime())){
          orderDateDisplay = dt.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) + ' ' +
                             dt.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
        }
      } catch(_) {}

      var html = '<div class="pos-sale-detail-modal">' +
        // Header
        '<div class="pos-sale-detail-head">' +
          '<div class="pos-sale-detail-title-group">' +
            '<div class="pos-sale-detail-icon-wrap">' +
              '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' +
            '</div>' +
            '<div>' +
              '<div class="pos-sale-detail-number">Transaksi #' + esc(o.order_number || o.id) + '</div>' +
              '<div class="pos-sale-detail-sub">' + esc(orderDateDisplay) + ' · ' + (isOjol ? 'Online' : 'POS Kasir') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="pos-sale-detail-head-right">' +
            '<span class="pos-badge ' + statusBadgeCls + '">' + esc(statusBadgeLabel) + '</span>' +
            '<button type="button" class="pos-modal-close-icon" id="pos-sale-detail-x" aria-label="Tutup">✕</button>' +
          '</div>' +
        '</div>' +

        // Meta 4-card Grid
        '<div class="pos-sale-meta-grid">' +
          '<div class="pos-sale-meta-item">' +
            '<span class="pos-sale-meta-label">Layanan</span>' +
            '<strong class="pos-sale-meta-val">' + esc(typeLabel) + '</strong>' +
          '</div>' +
          '<div class="pos-sale-meta-item">' +
            '<span class="pos-sale-meta-label">Pelanggan</span>' +
            '<strong class="pos-sale-meta-val">' + customerText + '</strong>' +
          '</div>' +
          '<div class="pos-sale-meta-item">' +
            '<span class="pos-sale-meta-label">Metode Bayar</span>' +
            '<strong class="pos-sale-meta-val">' + esc(payMethodLabel) + '</strong>' +
          '</div>' +
          '<div class="pos-sale-meta-item">' +
            '<span class="pos-sale-meta-label">Kasir</span>' +
            '<strong class="pos-sale-meta-val">' + esc(cashierName) + '</strong>' +
          '</div>' +
        '</div>' +

        // Items Box
        '<div class="pos-sale-items-box">' +
          '<div class="pos-sale-items-head">' +
            '<span>Rincian Pesanan</span>' +
            '<small>' + itemsCount + ' item</small>' +
          '</div>' +
          '<div class="pos-sale-items-scroll">' + itemsHtml + '</div>' +
        '</div>' +

        // Delivery Card (if exists)
        deliveryHtml +

        // Summary Box
        '<div class="pos-sale-summary-box">' +
          breakdownRows +
          '<div class="pos-sale-grand-total-row">' +
            '<div>' +
              '<span class="pos-sale-grand-label">Total Transaksi</span>' +
              '<div class="pos-sale-payment-method-tag">' + (statusBadgeCls === 'ok' ? 'Lunas via ' : 'Metode: ') + esc(payMethodLabel) + '</div>' +
            '</div>' +
            '<div class="pos-sale-grand-amount">' + money(grandTotal) + '</div>' +
          '</div>' +
          cashTenderHtml +
        '</div>' +

        // Modal Action Buttons
        '<div class="pos-sale-detail-actions">' +
          '<button type="button" class="pos-btn ghost pos-sale-btn-print" id="pos-sale-detail-print">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
            '<span>Cetak Struk</span>' +
          '</button>' +
          '<div class="pos-sale-detail-actions-right">' +
            '<button type="button" class="pos-btn ghost" id="pos-sale-detail-close">Tutup</button>' +
            (isCodPending ? '<button type="button" class="pos-btn primary" id="pos-sale-detail-settle">Terima Setoran COD</button>' : '') +
            (isUnpaid ? '<button type="button" class="pos-btn primary" id="pos-sale-detail-pay">Bayar di Kasir</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';

      showModal(html, 'pos-modal-sale-detail');
      $('pos-sale-detail-close').onclick = hideModal;
      if($('pos-sale-detail-x')) $('pos-sale-detail-x').onclick = hideModal;
      $('pos-sale-detail-print').onclick = function(){ printReceipt(orderId); };
      if($('pos-sale-detail-settle')){
        $('pos-sale-detail-settle').onclick = function(){
          hideModal();
          openCodSettlementModal(orderId);
        };
      }
      if($('pos-sale-detail-pay')){
        $('pos-sale-detail-pay').onclick = function(){
          hideModal();
          openDirectOrderPayModal(orderId);
        };
      }
    }catch(e){
      toast(e.message || 'Gagal memuat detail transaksi.');
    }
  }

  async function openSplitMergeManager(orderId, heldId){
    if(!orderId){toast('Pesanan ini belum memiliki Order.');return;}
    try{
      var data=await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks',{headers:headers()});
      var checks=data.checks||[];
      if(!checks.length){toast('Tagihan belum siap dibagi.');return;}
      function checkTotal(check){return Number(check.allocated_amount||0);}
      function renderItems(check){
        var items=check.items||[];
        if(!items.length)return '<div class="pos-empty pos-check-empty">Belum ada item di bagian ini.</div>';
        return '<div class="pos-split-item-list">'+items.map(function(it){
          var qty=Math.max(0,Number(it.quantity)||0);
          return '<div class="pos-split-item-row"><div class="pos-split-item-info"><strong>'+esc(it.product_name||'Item')+'</strong><small>'+money(it.unit_price||0)+' · tersedia '+qty+'</small></div><div class="pos-split-stepper"><button type="button" class="pos-item-stepper-btn" data-split-minus="'+esc(it.order_item_id)+'" aria-label="Kurangi">−</button><span data-split-qty="'+esc(it.order_item_id)+'">0</span><button type="button" class="pos-item-stepper-btn" data-split-plus="'+esc(it.order_item_id)+'" data-max="'+qty+'" aria-label="Tambah">+</button></div></div>';
        }).join('')+'</div>';
      }
      function renderCheck(check,index){
        var paid=Number(check.paid_amount||0), remaining=Number(check.remaining_amount||0);
        var primary=index===0;
        var canMerge=!primary && check.status==='open' && paid===0;
        return '<div class="pos-split-check-card '+(primary?'primary':'')+'"><div class="pos-split-check-head"><div><strong>'+ (primary?'Tagihan Utama':'Tagihan '+(index+1)) +'</strong><small>'+(remaining<=0?'LUNAS':('Sisa '+money(remaining)))+'</small></div><strong>'+money(checkTotal(check))+'</strong></div>'+renderItems(check)+(canMerge?'<button type="button" class="pos-btn small ghost danger pos-split-merge-btn" data-merge-check="'+esc(check.id)+'">Gabungkan ke Tagihan Utama</button>':'')+'</div>';
      }
      var html='<div class="pos-split-manager"><div class="pos-simple-bill-head"><div><h3>Split / Gabungkan Tagihan</h3><p>Pesanan tetap <strong>1 Order</strong>. Meja dan Dining Session tidak berubah.</p></div><div class="pos-simple-bill-total">'+money(data.order&&data.order.grand_total||0)+'</div></div><div class="pos-split-contract-note">Pindahkan jumlah menu dari Tagihan Utama ke tagihan baru. Jangan buat order baru untuk rombongan yang sama.</div><div class="pos-check-manager-list pos-split-check-list">'+checks.map(renderCheck).join('')+'</div><div class="pos-modal-actions"><button type="button" class="pos-btn ghost" id="pos-split-manager-close">Tutup</button><button type="button" class="pos-btn" id="pos-split-create" disabled>Buat Tagihan Baru</button></div></div>';
      showModal(html);
      $('pos-split-manager-close').onclick=hideModal;
      var selected={};
      function sync(){
        var total=Object.keys(selected).reduce(function(sum,k){return sum+(Number(selected[k])||0);},0);
        $('pos-split-create').disabled=total<=0;
        document.querySelectorAll('[data-split-qty]').forEach(function(el){el.textContent=String(selected[el.dataset.splitQty]||0);});
      }
      function changeQty(id,delta,max){
        var next=Math.max(0,Math.min(max,(Number(selected[id])||0)+delta));
        selected[id]=next;
        if(next===0)delete selected[id];
        sync();
      }
      document.querySelectorAll('[data-split-plus]').forEach(function(btn){btn.onclick=function(){changeQty(btn.dataset.splitPlus,1,Number(btn.dataset.max)||0);};});
      document.querySelectorAll('[data-split-minus]').forEach(function(btn){btn.onclick=function(){changeQty(btn.dataset.splitMinus,-1,99);};});
      $('pos-split-create').onclick=async function(){
        var splitItems=Object.keys(selected).map(function(id){return {order_item_id:id,quantity:Number(selected[id])};}).filter(function(x){return x.quantity>0;});
        if(!splitItems.length)return;
        var btn=this; btn.disabled=true;
        try{
          await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks/split',{method:'POST',headers:headers(),body:JSON.stringify({source_check_id:checks[0].id,split_items:splitItems})});
          toast('Tagihan baru dibuat. Tetap 1 Order.');
          openSplitMergeManager(orderId,heldId);
        }catch(e){btn.disabled=false;toast(e.message);}
      };
      document.querySelectorAll('[data-merge-check]').forEach(function(btn){btn.onclick=async function(){
        if(!confirm('Gabungkan tagihan ini kembali ke Tagihan Utama?'))return;
        btn.disabled=true;
        try{
          await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks/merge',{method:'POST',headers:headers(),body:JSON.stringify({target_check_id:checks[0].id,source_check_id:btn.dataset.mergeCheck})});
          toast('Tagihan digabungkan kembali. Tetap 1 Order.');
          openSplitMergeManager(orderId,heldId);
        }catch(e){btn.disabled=false;toast(e.message);}
      };});
    }catch(e){toast(e.message);}
  }

  function renderHeldSales(){
    var box=$('pos-held-list'); if(!box)return;
    var held=state.held||[];
    if(!held.length){box.innerHTML='<div class="pos-empty">Tidak ada pesanan yang sedang ditahan.</div>';return;}
    box.innerHTML=held.map(function(h){
      var items=[]; try{items=JSON.parse(h.items_payload||'[]');}catch(_){}
      var subtotal=items.reduce(function(s,i){return s+(Number(i.unit_price)||0)*Number(i.quantity||0)},0);
      var itemSummary=items.map(function(i){return (i.quantity||1)+'x '+(i.name||'Item');}).join(', ');
      var oType = h.order_type || (h.table_number ? 'dine_in' : 'pickup');
      var typeTitle = (oType === 'dine_in') ? ('Meja ' + esc(h.table_number || '—')) : (oType === 'pickup' ? 'Takeaway' : oType === 'delivery' ? 'Delivery' : esc(oType));
       return '<div class="pos-held-row"><div class="pos-held-main"><strong>' + typeTitle + '</strong><small>Tamu: '+esc(h.customer_name||'Tamu')+' · '+esc(h.created_at||'')+'</small></div><div class="pos-held-items">'+esc(itemSummary||'—')+'</div><div class="pos-held-total">'+money(subtotal)+'</div><div class="pos-held-actions">'+(h.order_id?'<button type="button" class="pos-btn small ghost" data-split-held-row="'+esc(h.id)+'">Split</button>':'')+'<button type="button" class="pos-btn small ghost danger" data-cancel-held-row="'+esc(h.id)+'">Batal</button><button type="button" class="pos-btn small" data-resume-held-row="'+esc(h.id)+'">Buka di Kasir</button></div></div>';
    }).join('');
    box.querySelectorAll('[data-resume-held-row]').forEach(function(b){b.onclick=function(){resumeHeld(b.dataset.resumeHeldRow);};});
    box.querySelectorAll('[data-split-held-row]').forEach(function(b){b.onclick=function(){var h=held.find(function(x){return String(x.id)===String(b.dataset.splitHeldRow);});if(h&&h.order_id) openSplitMergeManager(h.order_id,h.id);};});
    box.querySelectorAll('[data-cancel-held-row]').forEach(function(b){b.onclick=function(){cancelHeld(b.dataset.cancelHeldRow);};});

  }

  function switchTransaksiTab(tab){
    state.transaksiTab=tab;
    var tabSales=$('tab-transaksi-sales'), tabHeld=$('tab-transaksi-held');
    var salesList=$('pos-sales-list'), heldList=$('pos-held-list');
    if(tabSales) tabSales.classList.toggle('active', tab==='sales');
    if(tabHeld) tabHeld.classList.toggle('active', tab==='held');
    if(salesList) salesList.classList.toggle('hidden', tab!=='sales');
    if(heldList) heldList.classList.toggle('hidden', tab!=='held');
    if(tab==='held') renderHeldSales();
    else renderSales();
  }

  function tableStateLabel(st){
    return ({available:'Tersedia',held:'Dipesan',reserved:'Reservasi',occupied:'Terisi',blocked:'Diblokir',out_of_service:'Tidak tersedia'})[st]||st;
  }

  function applySelectedTable(t){
    if(!t)return;
    try{
      composer().setTable(t);
    }catch(e){
      return toast(e.message);
    }
    document.querySelectorAll('.pos-order-type button').forEach(function(x){x.classList.toggle('active',x.dataset.type==='dine_in');});
    var ctx=$('pos-table-context'); if(ctx)ctx.classList.remove('hidden');
    renderCart();
  }

  function openTableSelector(onSelected, onCancel){
    if(!state.branchId)return toast('Cabang POS belum tersedia.');
    request('/dine-in/layout?branch_id='+encodeURIComponent(state.branchId),{headers:headers()}).then(function(d){
      var tables=(d.layout&&d.layout.tables)||[];
      var html='<h3>Pilih Meja</h3><p>Pilih meja yang menjadi konteks transaksi Dine-in. Cart yang sudah dibuat tetap dipertahankan.</p><div class="pos-table-picker">';
      if(!tables.length) html+='<div class="pos-empty">Belum ada meja aktif di cabang ini.</div>';
      tables.forEach(function(t){
        var st=t.operational_state||t.status||'available';
        var can=st==='available';
        var selected=currentTable()&&String(currentTable().id)===String(t.id);
        html+='<button type="button" class="pos-table-pick '+(can?'':'disabled')+(selected?' selected':'')+'" '+(can?'':'disabled')+' data-table-pick="'+esc(t.id)+'"><span><strong>'+esc(t.label||('Meja '+t.table_number))+'</strong><small>'+esc(String(t.capacity||4))+' kursi · '+esc(tableStateLabel(st))+'</small></span><b>'+(selected?'✓':can?'Pilih':'Tidak tersedia')+'</b></button>';
      });
      html+='</div><div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-table-picker-cancel">Batal</button></div>';
      showModal(html);
      $('pos-table-picker-cancel').onclick=function(){
        state.autoPayAfterTable=false;
        if(typeof onCancel==='function') onCancel(); else hideModal();
      };
      document.querySelectorAll('[data-table-pick]').forEach(function(btn){btn.onclick=function(){
        var t=tables.find(function(x){return String(x.id)===String(btn.dataset.tablePick);});
        if(!t||(t.operational_state||t.status||'available')!=='available')return;
        applySelectedTable(t);
        var autoPay = Boolean(state.autoPayAfterTable);
        state.autoPayAfterTable = false;
        hideModal();
        setView('kasir');
        if(autoPay){
          openPayModal();
        } else if(typeof onSelected==='function'){
          onSelected(t);
        }
      };});
    }).catch(function(e){toast(e.message||'Layout meja tidak dapat dimuat.');});
  }

  function openTableActionMenu(t, tables){
    var st = t.operational_state || t.status || 'available';
    var isApp = Boolean(t.is_app_order || (t.session_channel && t.session_channel !== 'pos'));
    var isAvailable = st === 'available';
    var tableName = t.label || ('Meja ' + t.table_number);

    var html = '<div class="pos-table-action-sheet">' +
      '<div class="pos-table-action-header">' +
        '<div class="pos-table-action-title">' +
          '<h3>' + esc(tableName) + '</h3>' +
          (isApp ? '<span class="pos-table-app-icon" title="Dipesan melalui Aplikasi / QR"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg> App</span>' : '') +
        '</div>' +
        '<span class="pos-badge ' + (isAvailable ? 'ok' : 'pending') + '">' + esc(tableStateLabel(st)) + '</span>' +
      '</div>' +
      '<p class="pos-table-action-desc">Kapasitas: ' + esc(String(t.capacity || 4)) + ' kursi' + (t.session_customer_name ? ' · Tamu: ' + esc(t.session_customer_name) : '') + (isApp ? ' · (Pesanan via Aplikasi / QR)' : '') + '</p>' +
      '<div class="pos-table-actions-list">' +
        (!isAvailable ? '<button type="button" class="pos-action-sheet-btn danger" id="btn-table-release"><span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Release Meja (Kosongkan)</span><small>Kembalikan status meja menjadi Tersedia</small></button>' : '') +
        (!isAvailable ? '<button type="button" class="pos-action-sheet-btn" id="btn-table-transfer"><span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg> Pindah Meja (Transfer Tamu)</span><small>Pindahkan pesanan tamu ke meja kosong lainnya</small></button>' : '') +
        '<button type="button" class="pos-action-sheet-btn" id="btn-table-toggle-block"><span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg> ' + (st === 'blocked' ? 'Buka Blokir Meja' : 'Blokir Meja') + '</span><small>' + (st === 'blocked' ? 'Meja kembali dapat dipakai untuk pesanan' : 'Tandai meja sedang rusak atau tidak dipakai') + '</small></button>' +
        (isAvailable ? '<button type="button" class="pos-action-sheet-btn" id="btn-table-open-session"><span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Buka Sesi Meja</span><small>Kunci meja untuk tamu dan aktifkan pesanan via QR</small></button>' : '') +
        (isAvailable ? '<button type="button" class="pos-action-sheet-btn" id="btn-table-use-sale"><span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Pilih untuk Transaksi Kasir</span><small>Gunakan meja ini sebagai konteks dine-in kasir</small></button>' : '') +
        '<button type="button" class="pos-action-sheet-btn" id="btn-table-qr"><span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg> Cetak / Lihat QR Meja</span><small>Cetak plakat nomor meja atau tampilkan QR Code</small></button>' +
      '</div>' +
      '<div class="pos-modal-actions"><button type="button" class="pos-btn ghost" id="btn-table-action-close">Tutup</button></div>' +
    '</div>';

    showModal(html);
    if($('btn-table-action-close')) $('btn-table-action-close').onclick = hideModal;

    if($('btn-table-open-session')) {
      $('btn-table-open-session').onclick = async function(){
        try {
          var result = await request('/dine-in/tables/' + encodeURIComponent(t.id) + '/open-session', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ guest_count: t.capacity || 1 })
          });
          toast('Sesi ' + tableName + ' dibuka. Letakkan plakat QR di meja.');
          hideModal();
          loadTables();
        } catch(e) {
          toast(e.message || 'Gagal membuka sesi meja.');
        }
      };
    }

    if($('btn-table-release')) {
      $('btn-table-release').onclick = async function(){
        if(!confirm('Kosongkan ' + tableName + ' dan kembalikan ke status Tersedia?')) return;
        try {
          var res = await request('/dine-in/tables/' + encodeURIComponent(t.id) + '/release', { method: 'POST', headers: headers() });
          toast(res.message || 'Meja berhasil dikosongkan.');
          hideModal();
          loadTables();
        } catch(e) {
          toast(e.message || 'Gagal me-release meja.');
        }
      };
    }

    if($('btn-table-transfer')) {
      $('btn-table-transfer').onclick = function(){
        openTableTransferPicker(t, tables);
      };
    }

    if($('btn-table-toggle-block')) {
      $('btn-table-toggle-block').onclick = async function(){
        var isBlocked = st !== 'blocked';
        try {
          var res = await request('/dine-in/tables/' + encodeURIComponent(t.id) + '/block', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ is_blocked: isBlocked, reason: isBlocked ? 'Manual block by cashier' : 'Unblocked' })
          });
          toast(isBlocked ? 'Meja telah diblokir.' : 'Blokir meja dibuka.');
          hideModal();
          loadTables();
        } catch(e) {
          toast(e.message || 'Gagal mengubah status blokir meja.');
        }
      };
    }

    if($('btn-table-use-sale')) {
      $('btn-table-use-sale').onclick = function(){
        applySelectedTable(t);
        hideModal();
        setView('kasir');
      };
    }

    if($('btn-table-qr')) {
      $('btn-table-qr').onclick = async function(){
        try {
          var res = await request('/dine-in/tables/' + encodeURIComponent(t.id) + '/qr', { headers: headers() });
          if (!res || !res.success || !res.svg) throw new Error((res && res.error) || 'Gagal memuat QR meja.');
          var title = (res.table && (res.table.label || res.table.table_number)) || tableName;
          var w = window.open('', '_blank');
          if (!w) {
            toast('Pop-up terblokir. Izinkan pop-up browser untuk mencetak QR.');
            return;
          }
          w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>QR ' + esc(title) + '</title>' +
            '<style>body{font-family:\'Plus Jakarta Sans\', sans-serif;text-align:center;padding:32px;}h1{font-size:22px;margin:0 0 6px;font-weight:800;}p{font-size:13px;color:#555;margin:0 0 20px;}svg{width:280px;height:280px;margin:0 auto;display:block;}</style>' +
            '</head><body><h1>' + esc(title) + '</h1><p>Scan untuk bergabung ke sesi meja dan memesan</p>' + (res.svg || '') + '</body></html>');
          w.document.close();
          w.focus();
          w.print();
        } catch(e) {
          toast(e.message || 'Gagal mencetak QR meja.');
        }
      };
    }
  }

  function openTableTransferPicker(sourceTable, allTables){
    var avail = allTables.filter(function(x){
      return String(x.id) !== String(sourceTable.id) && ((x.operational_state || x.status || 'available') === 'available');
    });

    var html = '<div class="pos-table-action-sheet">' +
      '<div class="pos-table-action-header">' +
        '<div class="pos-table-action-title">' +
          '<h3>Pindah dari ' + esc(sourceTable.label || ('Meja ' + sourceTable.table_number)) + '</h3>' +
        '</div>' +
      '</div>' +
      '<p class="pos-table-action-desc">Pilih meja tujuan yang sedang kosong untuk memindahkan tamu / pesanan:</p>' +
      '<div class="pos-table-picker">';

    if(!avail.length) {
      html += '<div class="pos-empty">Tidak ada meja kosong lain yang tersedia saat ini.</div>';
    } else {
      avail.forEach(function(tb){
        html += '<button type="button" class="pos-table-pick" data-transfer-target="' + esc(tb.id) + '">' +
          '<span><strong>' + esc(tb.label || ('Meja ' + tb.table_number)) + '</strong><small>' + esc(String(tb.capacity || 4)) + ' kursi · Tersedia</small></span>' +
          '<b>Pilih Meja</b></button>';
      });
    }

    html += '</div>' +
      '<div class="pos-modal-actions">' +
        '<button type="button" class="pos-btn ghost" id="btn-transfer-cancel">Batal</button>' +
      '</div>' +
    '</div>';

    showModal(html);
    if($('btn-transfer-cancel')) $('btn-transfer-cancel').onclick = function(){ openTableActionMenu(sourceTable, allTables); };

    document.querySelectorAll('[data-transfer-target]').forEach(function(btn){
      btn.onclick = async function(){
        var targetId = btn.dataset.transferTarget;
        var targetTb = allTables.find(function(x){ return String(x.id) === String(targetId); });
        var targetName = targetTb ? (targetTb.label || ('Meja ' + targetTb.table_number)) : 'meja tujuan';

        try {
          var res = await request('/dine-in/tables/' + encodeURIComponent(sourceTable.id) + '/transfer', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ target_table_id: targetId })
          });
          toast(res.message || ('Tamu berhasil dipindahkan ke ' + targetName + '.'));
          hideModal();
          loadTables();
        } catch(e) {
          toast(e.message || 'Gagal memindahkan meja.');
        }
      };
    });
  }

  async function openReservationsModal(){
    try {
      var d = await request('/pos/reservations?branch_id=' + encodeURIComponent(state.branchId), { headers: headers() });
      var reservations = d.reservations || [];

      var layoutRes = await request('/dine-in/layout?branch_id=' + encodeURIComponent(state.branchId), { headers: headers() });
      var allTables = (layoutRes.layout && layoutRes.layout.tables) || [];
      var availableTables = allTables.filter(function(t){
        return (t.operational_state || t.status || 'available') === 'available';
      });

      var rowsHtml = '';
      if (!reservations.length) {
        rowsHtml = '<div class="pos-empty">Tidak ada reservasi aktif.</div>';
      } else {
        rowsHtml = reservations.map(function(r){
          var slotTime = r.scheduled_slot_start ? new Date(r.scheduled_slot_start).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'Hari Ini';
          var slotDate = r.scheduled_slot_start ? new Date(r.scheduled_slot_start).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '';
          var timeLabel = slotDate ? (slotDate + ', ' + slotTime) : slotTime;
          return '<div class="pos-reservation-card">' +
            '<div class="pos-res-card-top">' +
              '<div>' +
                '<div class="pos-res-guest-name">' + esc(r.customer_name || 'Tamu') + '</div>' +
                '<div class="pos-res-meta">#' + esc(r.order_number || r.id) + ' • ' + esc(r.customer_phone || '-') + '</div>' +
              '</div>' +
              '<span class="pos-res-time-badge">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
                esc(timeLabel) +
              '</span>' +
            '</div>' +
            (r.order_note ? '<div class="pos-res-note"><strong>Catatan:</strong> ' + esc(r.order_note) + '</div>' : '') +
            '<div class="pos-res-actions">' +
              '<button type="button" class="pos-btn small ghost danger" data-reservation-noshow="' + esc(r.id) + '">No-Show</button>' +
              '<button type="button" class="pos-btn small primary" data-reservation-checkin="' + esc(r.id) + '">Check-In</button>' +
            '</div>' +
          '</div>';
        }).join('');
      }

      var html = '<div class="pos-reservations-modal">' +
        '<div class="pos-reservations-head">' +
          '<div class="pos-reservations-head-left">' +
            '<h3>Reservasi</h3>' +
            '<span class="pos-reservations-badge">' + availableTables.length + ' Meja Siap</span>' +
          '</div>' +
          '<button type="button" class="pos-modal-close-icon" id="pos-reservations-x-close" aria-label="Tutup" title="Tutup">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
          '</button>' +
        '</div>' +
        '<div class="pos-reservations-list">' + rowsHtml + '</div>' +
        '<div class="pos-modal-actions">' +
          '<button type="button" class="pos-btn ghost" id="pos-reservations-close">Tutup</button>' +
        '</div>' +
      '</div>';

      showModal(html);
      if ($('pos-reservations-close')) $('pos-reservations-close').onclick = hideModal;
      if ($('pos-reservations-x-close')) $('pos-reservations-x-close').onclick = hideModal;

      document.querySelectorAll('[data-reservation-noshow]').forEach(function(btn){
        btn.onclick = async function(){
          var resId = btn.dataset.reservationNoshow;
          if (!confirm('Tandai reservasi ini sebagai No-Show?')) return;
          try {
            await request('/pos/reservations/' + encodeURIComponent(resId) + '/no-show', {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify({ reason: 'Pelanggan tidak hadir di outlet' })
            });
            toast('Reservasi ditandai No-Show.');
            openReservationsModal();
          } catch(err) {
            toast(err.message || 'Gagal menandai No-Show.');
          }
        };
      });

      document.querySelectorAll('[data-reservation-checkin]').forEach(function(btn){
        btn.onclick = function(){
          var resId = btn.dataset.reservationCheckin;
          var r = reservations.find(function(x){ return String(x.id) === String(resId); });
          if (!availableTables.length) {
            return toast('Tidak ada meja kosong (available) untuk check-in.');
          }

          var tableOptions = availableTables.map(function(t){
            return '<option value="' + esc(t.table_number) + '">' + esc(t.label || ('Meja ' + t.table_number)) + ' (' + esc(String(t.capacity || 4)) + ' kursi)</option>';
          }).join('');

          var checkinHtml = '<div class="pos-reservations-modal">' +
            '<div class="pos-reservations-head">' +
              '<div class="pos-reservations-head-left">' +
                '<h3>Pilih Meja Check-In</h3>' +
              '</div>' +
              '<button type="button" class="pos-modal-close-icon" id="pos-checkin-x-close" aria-label="Kembali" title="Kembali">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
              '</button>' +
            '</div>' +
            '<div class="pos-checkin-guest-badge">' +
              '<span>Tamu: <strong>' + esc(r ? r.customer_name : 'Pelanggan') + '</strong></span>' +
              '<small>#' + esc(r ? (r.order_number || r.id) : '') + '</small>' +
            '</div>' +
            '<div class="pos-form-row">' +
              '<label>Pilih Meja</label>' +
              '<select id="pos-checkin-table-select" class="pos-input" style="font-size:14px;padding:9px 12px;border-radius:10px;">' + tableOptions + '</select>' +
            '</div>' +
            '<div class="pos-modal-actions">' +
              '<button type="button" class="pos-btn ghost" id="pos-checkin-cancel">Batal</button>' +
              '<button type="button" class="pos-btn primary" id="pos-checkin-submit">Check-In Meja</button>' +
            '</div>' +
          '</div>';

          showModal(checkinHtml);
          if ($('pos-checkin-cancel')) $('pos-checkin-cancel').onclick = openReservationsModal;
          if ($('pos-checkin-x-close')) $('pos-checkin-x-close').onclick = openReservationsModal;
          $('pos-checkin-submit').onclick = async function(){
            var tableNum = $('pos-checkin-table-select').value;
            if (!tableNum) return toast('Pilih meja terlebih dahulu.');
            var sBtn = this; sBtn.disabled = true;
            try {
              await request('/pos/reservations/' + encodeURIComponent(resId) + '/check-in', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({ table_number: tableNum })
              });
              toast('✓ Tamu reservasi berhasil check-in ke Meja ' + tableNum + '!');
              hideModal();
              loadTables();
            } catch(err) {
              sBtn.disabled = false;
              toast(err.message || 'Gagal check-in reservasi.');
            }
          };
        };
      });

    } catch(err) {
      toast(err.message || 'Gagal memuat daftar reservasi.');
    }
  }

  async function updatePosNotificationBadge(){
    try {
      var d = await request('/notifications/unread-count', { headers: headers() });
      var dot = $('pos-notif-badge-dot');
      if (dot) {
        var unread = Number(d && d.unread_count || 0);
        dot.style.display = unread > 0 ? 'block' : 'none';
        if (unread > 0) dot.setAttribute('title', unread + ' notifikasi baru');
      }
    } catch (_) {}
  }

  async function openPosNotificationsModal(){
    var initialHtml = '<div class="pos-modal-notifications">' +
      '<div class="pos-notif-head">' +
        '<div class="pos-notif-head-title">' +
          '<h3>Notifikasi</h3>' +
          '<span class="pos-notif-badge-pill" id="pos-notif-modal-pill">...</span>' +
        '</div>' +
        '<button type="button" class="pos-modal-close-icon" id="pos-notif-x-close" aria-label="Tutup" title="Tutup">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
        '</button>' +
      '</div>' +
      '<div class="pos-notif-toolbar">' +
        '<span class="pos-notif-sub">Aktivitas pesanan, pengantaran, &amp; cabang</span>' +
        '<button type="button" class="pos-btn-text-read" id="pos-notif-mark-all" style="display:none;">Tandai Semua Dibaca</button>' +
      '</div>' +
      '<div class="pos-notif-list" id="pos-notif-list-box">' +
        '<div class="pos-empty">Memuat notifikasi...</div>' +
      '</div>' +
      '<div class="pos-modal-actions" style="margin-top:14px;">' +
        '<button type="button" class="pos-btn ghost" id="pos-notif-close-btn" style="width:100%;">Tutup</button>' +
      '</div>' +
    '</div>';

    showModal(initialHtml);
    if ($('pos-notif-x-close')) $('pos-notif-x-close').onclick = hideModal;
    if ($('pos-notif-close-btn')) $('pos-notif-close-btn').onclick = hideModal;

    try {
      var res = await request('/notifications?limit=30', { headers: headers() });
      var notifications = (res && res.notifications) || [];
      var unreadCount = Number(res && res.unread_count != null ? res.unread_count : notifications.filter(function(n){ return !n.read_at; }).length);

      var pill = $('pos-notif-modal-pill');
      if (pill) {
        pill.textContent = unreadCount > 0 ? (unreadCount + ' Baru') : 'Semua Terbaca';
        pill.className = 'pos-notif-badge-pill' + (unreadCount > 0 ? '' : ' empty');
      }

      var markAllBtn = $('pos-notif-mark-all');
      if (markAllBtn) {
        markAllBtn.style.display = unreadCount > 0 ? 'inline-block' : 'none';
        markAllBtn.onclick = async function(){
          markAllBtn.disabled = true;
          markAllBtn.textContent = 'Menandai...';
          try {
            await request('/notifications/read-all', { method: 'POST', headers: headers() });
            toast('Semua notifikasi telah ditandai dibaca.');
            updatePosNotificationBadge();
            openPosNotificationsModal();
          } catch(err) {
            markAllBtn.disabled = false;
            markAllBtn.textContent = 'Tandai Semua Dibaca';
            toast(err.message || 'Gagal menandai notifikasi dibaca.');
          }
        };
      }

      var listBox = $('pos-notif-list-box');
      if (!listBox) return;

      if (!notifications.length) {
        listBox.innerHTML = '<div class="pos-empty pos-notif-empty">' +
          '<div style="font-size:32px;margin-bottom:8px;">🔔</div>' +
          '<strong>Belum ada notifikasi</strong>' +
          '<p style="color:#64748b;font-size:12px;margin:4px 0 0;">Notifikasi pesanan, pengantaran, dan operasional akan muncul di sini.</p>' +
        '</div>';
        return;
      }

      function getNotifIcon(type) {
        if (type === 'order') return '🛍️';
        if (type === 'delivery') return '🛵';
        if (type === 'payment') return '💵';
        if (type === 'ops_message' || type === 'broadcast' || type === 'announcement') return '📢';
        return '🔔';
      }

      function formatNotifTime(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        var time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        var date = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        return date + ', ' + time;
      }

      listBox.innerHTML = notifications.map(function(n){
        var isUnread = !n.read_at;
        return '<div class="pos-notif-card' + (isUnread ? ' unread' : '') + '" data-notif-id="' + esc(n.id) + '" data-action-url="' + esc(n.action_url || '') + '">' +
          '<div class="pos-notif-icon-box">' + getNotifIcon(n.source_type) + '</div>' +
          '<div class="pos-notif-body">' +
            '<div class="pos-notif-row-head">' +
              '<strong class="pos-notif-title">' + esc(n.title || 'Notifikasi') + '</strong>' +
              (isUnread ? '<span class="pos-notif-dot"></span>' : '') +
            '</div>' +
            '<p class="pos-notif-desc">' + esc(n.body || '') + '</p>' +
            '<span class="pos-notif-time">' + formatNotifTime(n.created_at) + '</span>' +
          '</div>' +
        '</div>';
      }).join('');

      listBox.querySelectorAll('.pos-notif-card').forEach(function(card){
        card.onclick = async function(){
          var nId = card.dataset.notifId;
          var actUrl = card.dataset.actionUrl || '';
          if (card.classList.contains('unread')) {
            card.classList.remove('unread');
            var dot = card.querySelector('.pos-notif-dot');
            if (dot) dot.remove();
            try {
              await request('/notifications/' + encodeURIComponent(nId) + '/read', { method: 'POST', headers: headers() });
              updatePosNotificationBadge();
            } catch (_) {}
          }
          if (actUrl) {
            hideModal();
            if (actUrl.includes('/pos/orders/') || actUrl.includes('/orders/')) {
              setView('transaksi');
            }
          }
        };
      });

    } catch (err) {
      var box = $('pos-notif-list-box');
      if (box) box.innerHTML = '<div class="pos-empty" style="color:#ef4444;">Gagal memuat notifikasi: ' + esc(err.message) + '</div>';
    }
  }

  async function loadTables(){
    if(!state.branchId && state.user && state.user.branch_id) state.branchId = state.user.branch_id;
    try{
      var d=await request('/dine-in/layout?branch_id='+encodeURIComponent(state.branchId),{headers:headers()});
      var tables=(d.layout&&d.layout.tables)||[];
      var availCount=tables.filter(function(t){return (t.operational_state||t.status||'available')==='available';}).length;
      if($('pos-table-stats')) $('pos-table-stats').textContent='Sisa '+availCount+' meja';
      var box=$('pos-table-grid'); if(!box)return;
      box.innerHTML=tables.map(function(t){
        var st=t.operational_state||t.status||'available'; var can=st==='available';
        var isApp=Boolean(t.is_app_order || (t.session_channel && t.session_channel !== 'pos'));
        return '<div class="pos-table-card '+esc(st)+'">'+
          '<div class="pos-table-card-header">'+
            '<div class="pos-table-title-group">'+
              '<h3>'+esc(t.label||('Meja '+t.table_number))+'</h3>'+
              (isApp ? '<span class="pos-table-app-icon" title="Dipesan melalui Aplikasi / QR" aria-label="Pesanan Aplikasi"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg></span>' : '')+
            '</div>'+
            '<button type="button" class="pos-btn-kebab" data-table-kebab="'+esc(t.id)+'" title="Opsi Meja" aria-label="Opsi Meja">'+
              '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.8125 8.90625C2.43954 8.90625 2.08185 8.75809 1.81813 8.49437C1.55441 8.23065 1.40625 7.87296 1.40625 7.5C1.40625 7.12704 1.55441 6.76935 1.81813 6.50563C2.08185 6.24191 2.43954 6.09375 2.8125 6.09375C3.18546 6.09375 3.54315 6.24191 3.80687 6.50563C4.07059 6.76935 4.21875 7.12704 4.21875 7.5C4.21875 7.87296 4.07059 8.23065 3.80687 8.49437C3.54315 8.75809 3.18546 8.90625 2.8125 8.90625ZM7.5 8.90625C7.12704 8.90625 6.76935 8.75809 6.50563 8.49437C6.24191 8.23065 6.09375 7.87296 6.09375 7.5C6.09375 7.12704 6.24191 6.76935 6.50563 6.50563C6.76935 6.24191 7.12704 6.09375 7.5 6.09375C7.87296 6.09375 8.23065 6.24191 8.49437 6.50563C8.75809 6.76935 8.90625 7.12704 8.90625 7.5C8.90625 7.87296 8.75809 8.23065 8.49437 8.49437C8.23065 8.75809 7.87296 8.90625 7.5 8.90625ZM12.1875 8.90625C11.8145 8.90625 11.4569 8.75809 11.1931 8.49437C10.9294 8.23065 10.7813 7.87296 10.7812 7.5C10.7812 7.12704 10.9294 6.76935 11.1931 6.50563C11.4569 6.24191 11.8145 6.09375 12.1875 6.09375C12.5605 6.09375 12.9181 6.24191 13.1819 6.50563C13.4456 6.76935 13.5937 7.12704 13.5938 7.5C13.5937 7.87296 13.4456 8.23065 13.1819 8.49437C12.9181 8.75809 12.5605 8.90625 12.1875 8.90625Z" fill="currentColor"/></svg>'+
            '</button>'+
          '</div>'+
          '<p>'+esc(String(t.capacity||4))+' kursi · '+esc(tableStateLabel(st))+'</p>'+
          '<button type="button" class="pos-btn small '+(can?'':'ghost')+'" '+(can?'':'disabled')+' data-table="'+esc(t.id)+'">'+(can?'Pilih meja':'Tidak tersedia')+'</button></div>';
      }).join('');
      box.querySelectorAll('[data-table]').forEach(function(btn){btn.onclick=function(){
        var t=tables.find(function(x){return String(x.id)===String(btn.dataset.table);});
        if(!t)return;
        applySelectedTable(t); setView('kasir');
      };});
      box.querySelectorAll('[data-table-kebab]').forEach(function(btn){btn.onclick=function(e){
        e.stopPropagation();
        var t=tables.find(function(x){return String(x.id)===String(btn.dataset.tableKebab);});
        if(t) openTableActionMenu(t, tables);
      };});
    }catch(e){
      if($('pos-table-stats')) $('pos-table-stats').textContent='0 meja';
      if($('pos-table-grid')) $('pos-table-grid').innerHTML='<div class="pos-empty">Layout meja tidak dapat dimuat.</div>';
    }
  }

  function attachRefreshAction(btnId, fn, successMsg) {
    var btn = $(btnId);
    if (!btn) return;
    btn.onclick = async function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (btn.classList.contains('is-spinning')) return;
      btn.classList.add('is-spinning');
      btn.setAttribute('disabled', 'disabled');
      var start = Date.now();
      try {
        await fn();
        var elapsed = Date.now() - start;
        if (elapsed < 450) {
          await new Promise(function (r) { setTimeout(r, 450 - elapsed); });
        }
        if (successMsg) toast(successMsg);
      } catch (err) {
        toast((err && err.message) || 'Gagal memuat ulang data.');
      } finally {
        btn.classList.remove('is-spinning');
        btn.removeAttribute('disabled');
      }
    };
  }

  function bind(){
    document.querySelectorAll('.pos-bottom-nav button').forEach(function(b){
      b.onclick=function(){
        if(b.dataset.view==='shift'){ openShiftModal(); return; }
        setView(b.dataset.view);
      };
    });
    document.querySelectorAll('.pos-order-type button').forEach(function(b){
      b.onclick=function(){
        try{
          composer().setOrderType(b.dataset.type);
        }catch(e){
          return toast(e.message);
        }
        document.querySelectorAll('.pos-order-type button').forEach(function(x){x.classList.toggle('active',x===b);});
        var ctx=$('pos-table-context');
        if(ctx)ctx.classList.toggle('hidden',composer().getOrderType()!=='dine_in');
        renderCart();
      };
    });
    var searchInput=$('pos-menu-search'), clearSearchBtn=$('btn-pos-clear-search');
    if(searchInput){
      searchInput.oninput=function(){
        state.search=this.value;
        if(clearSearchBtn) clearSearchBtn.classList.toggle('hidden',!this.value);
        renderMenu();
      };
    }
    if(clearSearchBtn){
      clearSearchBtn.onclick=function(){
        if(searchInput){
          searchInput.value=''; state.search='';
          clearSearchBtn.classList.add('hidden');
          renderMenu(); searchInput.focus();
        }
      };
    }
    window.addEventListener('keydown',function(e){
      if(e.key==='/' && document.activeElement!==searchInput && $('pos-modal').classList.contains('hidden')){
        if(state.currentView==='kasir' && searchInput){
          e.preventDefault(); searchInput.focus(); searchInput.select();
        }
      } else if(e.key==='Escape' && document.activeElement===searchInput){
        if(searchInput.value){
          searchInput.value=''; state.search='';
          if(clearSearchBtn) clearSearchBtn.classList.add('hidden');
          renderMenu();
        }
        searchInput.blur();
      }
    });
    attachRefreshAction('btn-pos-refresh-menu', loadMenu, 'Katalog menu diperbarui');
    $('btn-pos-pay').onclick=function(){ if(composer().isAddition()) submitAdditionalOrder(); else openPayModal(); };
    if($('btn-pos-pay-many')) $('btn-pos-pay-many').onclick=openManyPaymentFromCart;
    if($('btn-pos-additional-order')) $('btn-pos-additional-order').onclick=enterAdditionalOrderMode;
    $('btn-pos-clear').onclick=function(){confirmClearSale();};
    $('btn-pos-hold').onclick=holdSale;
    if($('tab-transaksi-sales')) $('tab-transaksi-sales').onclick=function(){switchTransaksiTab('sales');};
    if($('tab-transaksi-held')) $('tab-transaksi-held').onclick=function(){switchTransaksiTab('held');};
    $('btn-pos-select-table').onclick=function(){openTableSelector();};
    attachRefreshAction('btn-pos-load-sales', loadSales, 'Daftar transaksi diperbarui');
    if($('btn-pos-scan-driver')) $('btn-pos-scan-driver').onclick=openDriverQrScanModal;
    if($('btn-pos-scan-qr-top')) $('btn-pos-scan-qr-top').onclick=openDriverQrScanModal;
    attachRefreshAction('btn-pos-refresh-tables', loadTables, 'Status meja diperbarui');
    if($('btn-pos-reservations')) $('btn-pos-reservations').onclick=openReservationsModal;
    attachRefreshAction('btn-pos-refresh-shift', async function(){ await loadShift(); renderShift(); }, 'Data shift diperbarui');
    $('btn-pos-shift-status').onclick=openShiftModal;
    $('btn-pos-close-shift-top').onclick=openCloseShiftModal;
    if($('btn-pos-notif')) $('btn-pos-notif').onclick=openPosNotificationsModal;
    if($('pos-user-profile-btn')) $('pos-user-profile-btn').onclick=openCashierProfileModal;
    $('btn-pos-logout').onclick=function(){confirmCashierLogout();};
    bindPosStatus();
    $('pos-modal').onclick=function(e){
      if(e.target!==this)return;
      // Profile & settings contains device setup controls; on touch screens an
      // edge tap/scroll can land on the backdrop. Require an explicit close.
      if(this.classList.contains('pos-modal-profile-settings'))return;
      hideModal();
    };
    if($('pos-mcart-trigger-order')){
      $('pos-mcart-trigger-order').onclick=function(e){
        e.stopPropagation();
        openMobileCartOverlay();
      };
    }
    if($('btn-pos-mcart-checkout')){
      $('btn-pos-mcart-checkout').onclick=function(e){
        e.stopPropagation();
        if(composer().isAddition()) submitAdditionalOrder(); else openPayModal();
      };
    }
    if($('pos-mobile-cart-bar')){
      $('pos-mobile-cart-bar').onclick=function(e){
        if(e.target.closest('#btn-pos-mcart-checkout')){
          openPayModal();
        } else {
          openMobileCartOverlay();
        }
      };
    }
    if($('btn-pos-cart-close')){
      $('btn-pos-cart-close').onclick=function(e){
        e.stopPropagation();
        closeMobileCartOverlay();
      };
    }
    if($('btn-pos-cart-select-table')){
      $('btn-pos-cart-select-table').onclick=function(e){
        e.stopPropagation();
        openTableSelector();
      };
    }
    var cartPane=$('pos-cart-pane');
    if(cartPane){
      cartPane.onclick=function(e){
        if(e.target===cartPane){
          closeMobileCartOverlay();
        }
      };
    }
    window.addEventListener('keydown', function(e){
      if(e.key==='Escape'){
        closeMobileCartOverlay();
        hideModal();
      }
    });
  }

  async function boot(){
    bind();
    renderShiftStatus();
    try{
      if(!await consumeGoogleHandoff())return;
      if(!await ensureSession())return;
      await loadPaymentModes();
      await loadTerminal();
      syncNativeAuth();
      await loadShift();
      await loadMenu();
      await updateHeldCount();
      updatePosNotificationBadge().catch(function(){});
      setInterval(updatePosNotificationBadge, 45000);
      loadSales().catch(function(){});
      loadTables().catch(function(){});
      setView('kasir');
      await ensureOfflineStore().catch(function(err){
        state.offlineStoreReady=false;
        if(window.console && console.warn) console.warn('[Xentra POS] Offline store belum siap:',err.message);
      });
      syncBrowserOfflineOutbox().catch(function(){});
      window.addEventListener('online',function(){
        setPosStatus('caution','Menghubungkan kembali…','POS sedang mencoba menyambungkan kembali ke sistem.');
        if(state.offlineMode && token()) state.offlineMode=false;
        loadTerminal();
        loadShift();
        loadMenu();
        syncBrowserOfflineOutbox().catch(function(){});
      });
      window.addEventListener('offline',function(){state.coreConnection=false;
      updatePosReadiness();});
      updatePosReadiness();
      if(state.branchReadinessRefreshTimer) clearInterval(state.branchReadinessRefreshTimer);
      state.branchReadinessRefreshTimer=setInterval(refreshBranchOperationalState,30000);
      window.addEventListener('focus',function(){ refreshBranchOperationalState(); });
      if (window.Xentra && typeof window.Xentra.hideSplash === 'function') {
        window.Xentra.hideSplash();
      }
    }catch(e){
      toast(e.message||'Gagal memuat POS.');
      if (window.Xentra && typeof window.Xentra.hideSplash === 'function') {
        window.Xentra.hideSplash();
      }
    }
  }

  boot();
})();
