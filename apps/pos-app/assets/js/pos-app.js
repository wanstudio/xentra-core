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
    coreConnection: null
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
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function(){ el.classList.remove('show'); }, 2200);
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
      subtitle.textContent='Perangkat POS ini belum diaktifkan. Owner atau Manager harus masuk dengan akun Xentra untuk menghubungkan perangkat ini ke cabang.';
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

  async function clearPosSessionAndReturnToPin(){
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
    document.querySelectorAll('.pos-product[data-product-id]').forEach(function(card){
      var pid=card.dataset.productId;
      var qty=menuCart.reduce(function(acc,item){
        return String(item.product_id)===String(pid)?acc+(Number(item.quantity)||0):acc;
      },0);
      var badge=card.querySelector('.pos-product-cart-badge');
      var stepper=card.querySelector('.pos-card-stepper');
      var addBtn=card.querySelector('.pos-product-add-btn');
      var qtyVal=card.querySelector('.pos-card-qty-val');

      if(qty>0){
        card.classList.add('in-cart');
        if(badge) badge.textContent=qty;
        else{
          var b=document.createElement('span'); b.className='pos-product-cart-badge'; b.textContent=qty; card.appendChild(b);
        }
        if(stepper){
          stepper.classList.remove('hidden');
          if(qtyVal) qtyVal.textContent=qty;
        }
        if(addBtn) addBtn.classList.add('hidden');
      }else{
        card.classList.remove('in-cart');
        if(badge) badge.remove();
        if(stepper) stepper.classList.add('hidden');
        if(addBtn) addBtn.classList.remove('hidden');
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
    var orderTypeLabel=isDineIn ? tableLabel : (tx.getOrderType()==='pickup'?'Pickup':'Delivery');
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

    if(isDineIn){
      html+='<div class="pos-order-modal-table-row"><span><strong>Meja:</strong> '+esc(tableLabel)+'</span>'+
        (additionMode||locked?'':'<button type="button" class="pos-btn small ghost" id="pos-order-modal-change-table">Ubah Meja</button>')+
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
      html+='<div class="pos-form-row"><label>Nama Tamu (opsional)</label><input type="text" id="pos-modal-cust-name" value="'+esc(custVal)+'" placeholder="Nama tamu"'+(locked?' readonly':'')+'></div>';
      html+='<div class="pos-form-row"><label>Catatan Order (opsional)</label><input type="text" id="pos-modal-order-note" value="'+esc(noteVal)+'" placeholder="Catatan untuk dapur/bar"'+(locked?' readonly':'')+'></div>';
    }

    html+='<div class="pos-order-modal-totals"><div class="pos-order-modal-subtotal"><span>Subtotal</span><strong>'+money(t)+'</strong></div>'+
      '<div class="pos-order-modal-grand"><span>'+ (additionMode?'Total Tambahan':'Total Tagihan') +'</span><strong>'+money(t)+'</strong></div></div>';

    var heldCount=(state.held&&state.held.length)?state.held.length:($('pos-held-count')?(Number($('pos-held-count').textContent)||0):0);
    html+='<div class="pos-order-modal-actions"><div class="pos-order-modal-btn-row">';
    if(!additionMode){
      html+='<button type="button" class="pos-btn ghost small" id="pos-order-modal-open-held">Ditahan (<span id="pos-order-modal-held-count">'+heldCount+'</span>)</button>';
    } else {
      html+='<button type="button" class="pos-btn ghost small" id="pos-order-modal-addition-cancel">Batal Tambahan</button>';
    }
    html+='</div><button type="button" class="pos-order-modal-pay-btn" id="pos-order-modal-pay"><span>'+(additionMode?'Kirim Tambahan':'Bayar '+money(t))+'</span>'+
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></button></div>';

    showModal(html);

    $('pos-order-modal-close').onclick=hideModal;
    if($('pos-order-modal-change-table')) $('pos-order-modal-change-table').onclick=function(){openTableSelector();};
    if($('pos-order-modal-open-held')) $('pos-order-modal-open-held').onclick=function(){openHeld();};
    if($('pos-order-modal-addition-cancel')) $('pos-order-modal-addition-cancel').onclick=function(){cancelAdditionalOrderMode();};

    $('pos-order-modal-pay').onclick=function(){
      if(additionMode){
        submitAdditionalOrder();
        return;
      }
      var cn=$('pos-modal-cust-name'), on=$('pos-modal-order-note');
      if(cn&&$('pos-customer-name')&&!locked) $('pos-customer-name').value=cn.value;
      if(on&&$('pos-order-note')&&!locked) $('pos-order-note').value=on.value;
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
    if (tableCtx) tableCtx.classList.toggle('hidden', !isDineIn);

    var box=$('pos-cart-items'), meta=$('pos-cart-meta'), subtotal=$('pos-subtotal'), grand=$('pos-total'), pay=$('pos-pay-total'), btn=$('btn-pos-pay'), payManyBtn=$('btn-pos-pay-many'), additionBtn=$('btn-pos-additional-order');
    if (meta) meta.textContent=displayCart.reduce(function(n,i){return n+(Number(i.quantity)||0);},0)+' item';
    if (subtotal) subtotal.textContent=money(displayTotal);
    if (grand) grand.textContent=money(displayTotal);
    if (pay) pay.textContent=money(displayTotal);

    if (btn) {
      btn.innerHTML = isAddition
        ? 'Kirim Tambahan <span>'+money(displayTotal)+'</span>'
        : 'Bayar <span>'+money(displayTotal)+'</span>';
      btn.disabled=!displayCart.length || !state.shift || !!state.shift.active_break;
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
    }

    var holdBtn=$('btn-pos-hold'), clearBtn=$('btn-pos-clear');
    if (holdBtn) holdBtn.hidden=isExisting || isAddition;
    if (clearBtn) clearBtn.hidden=isExisting;

    var tableLabel=$('pos-selected-table'),tableBtn=$('btn-pos-select-table');
    if(tableLabel) tableLabel.textContent=formatTableLabel(tx.getTable());
    if(tableBtn) {
      tableBtn.textContent=tx.getTable()?'Ubah':'Pilih Meja';
      tableBtn.hidden=isExisting || isAddition;
    }

    var cartTableLabel=$('pos-cart-selected-table'), cartTableBtn=$('btn-pos-cart-select-table');
    if(cartTableLabel) cartTableLabel.textContent=formatTableLabel(tx.getTable());
    if(cartTableBtn) {
      cartTableBtn.textContent=tx.getTable()?'Ubah':'Pilih Meja';
      cartTableBtn.hidden=isExisting || isAddition;
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
          var mLabel=isAddition?'Kirim Tambahan':'Bayar Sekarang';
          var mSpan=mBtn.querySelector('span'); if(mSpan)mSpan.textContent=mLabel;
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

  function decrementProduct(p, e){
    if(e&&e.stopPropagation)e.stopPropagation();
    try{
      var items=composer().getDisplayItems();
      for(var i=items.length-1;i>=0;i--){
        if(String(items[i].product_id)===String(p.id)){
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
      var items=composer().getDisplayItems();
      if(optionGroups(p).length>0){
        for(var i=items.length-1;i>=0;i--){
          if(String(items[i].product_id)===String(p.id)){
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
    try{
      composer().addItem({
        product_id:p.id,
        name:p.name || p.product_name || 'Produk',
        unit_price:unitPrice,
        quantity:1,
        options:cleanSelections,
        note:note||''
      });
      renderCart();
    }catch(e){
      showOrderLockedWarning();
    }
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
        var unavailable=p.is_available===0||p.is_available===false;
        var pName=p.name||p.product_name||'Produk';
        var cat=cats.find(function(c){return String(c.id)===String(p.category_id);});
        var catIndex=cat?cats.indexOf(cat):-1;
        var color=getCategoryColor(p.category_id,catIndex);
        var hasOpts=optionGroups(p).length>0;

        var composerCart=composer().getDisplayItems();
        var cartQty=composerCart.reduce(function(acc,item){
          return String(item.product_id)===String(p.id)?acc+(Number(item.quantity)||0):acc;
        },0);
        var orderLocked=isOrderLockedForEditing();

        var initials=(pName||'').split(' ').slice(0,2).map(function(w){return w.charAt(0);}).join('').toUpperCase()||'P';
        var mediaHtml='';
        var imgUrl=p.image_url||p.image_override;
        if(imgUrl){
          mediaHtml='<div class="pos-product-media"><img src="'+esc(imgUrl)+'" alt="'+esc(pName)+'" loading="lazy" class="pos-product-img" onerror="this.style.display=\'none\';if(this.nextElementSibling)this.nextElementSibling.style.display=\'flex\';"><span class="pos-product-avatar" style="display:none;background:'+color.bg+';color:'+color.text+';border-color:'+color.border+'">'+esc(initials)+'</span></div>';
        }else{
          mediaHtml='<div class="pos-product-media"><span class="pos-product-avatar" style="background:'+color.bg+';color:'+color.text+';border-color:'+color.border+'">'+esc(initials)+'</span></div>';
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

        return '<div role="button" tabindex="0" class="pos-product '+(unavailable?'disabled ':'')+(orderLocked?'order-locked ':'')+(cartQty>0?'in-cart':'')+'" data-product-id="'+esc(p.id)+'" aria-disabled="'+(orderLocked?'true':'false')+'">'+
          (cartQty>0?'<span class="pos-product-cart-badge">'+cartQty+'</span>':'')+
          mediaHtml+
          '<div class="pos-product-body">'+
            '<div class="pos-product-meta-row">'+
              (cat?'<span class="pos-product-cat-tag" style="background:'+color.bg+';color:'+color.text+'">'+esc(cat.name||cat.title)+'</span>':'<span class="pos-product-cat-tag" style="background:#f1f5f9;color:#475569">Menu</span>')+
              badgeHtml+
            '</div>'+
            '<div class="pos-product-name">'+esc(pName)+'</div>'+
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

        card.onclick = function(e){
          if(e.target.closest('button')) return;
          addProduct(p);
        };
        card.onkeydown = function(e){
          if((e.key==='Enter'||e.key===' ') && !e.target.closest('button')){
            e.preventDefault();
            addProduct(p);
          }
        };
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
    var setupRequested=isTerminalSetupRequested();
    if(!token()){
      var hasTerminalContext=!!(state.terminalId && (state.branchId || localStorage.getItem('xentra_pos_branch_id')));
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
        window.location.replace(me.landing || (me.user.role==='branch_manager'?'/merchant/':'/owner/'));
        return false;
      }

      applyCashierUser(me.user);
      if(state.user.role!=='cashier'){ window.location.replace(me.landing || '/merchant/'); return false; }
      if(!state.branchId){ toast('Akun kasir belum memiliki cabang.'); return false; }
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
      if(state.terminalId) localStorage.setItem('xentra_pos_terminal_id',state.terminalId);
      return !!state.terminalId;
    }catch(e){
      state.coreConnection=false;
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
        '<button type="button" class="pos-btn ghost" id="btn-pos-modal-cash-in">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
          '<span>Cash In</span>' +
        '</button>' +
        '<button type="button" class="pos-btn ghost" id="btn-pos-modal-cash-out">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
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
    $('btn-pos-modal-cash-in').onclick = function(){ openCashMoveModal('in'); };
    $('btn-pos-modal-cash-out').onclick = function(){ openCashMoveModal('out'); };
    $('btn-pos-modal-close-shift').onclick = function(){ openCloseShiftModal(); };
  }

  function openCashMoveModal(type){
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
      '<button type="button" class="pos-modal-close-icon" id="pos-cash-move-close" title="Kembali" aria-label="Kembali">✕</button>' +
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
      '</div>' +
    '</div>';

    html += '<div class="pos-modal-actions">' +
      '<button type="button" class="pos-btn ghost" id="pos-cash-move-cancel">Batal</button>' +
      '<button type="button" class="pos-btn" id="btn-pos-cash-move-submit">Simpan ' + (isCashIn ? 'Cash In' : 'Cash Out') + '</button>' +
    '</div>';

    showModal(html);
    $('pos-cash-move-close').onclick = openShiftModal;
    $('pos-cash-move-cancel').onclick = openShiftModal;

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
      '<button type="button" class="pos-btn danger" id="btn-pos-confirm-close-shift">Konfirmasi & Tutup Shift</button>' +
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
          showPaymentSuccess({id:orderId,order_number:existing.order_number||orderId,grand_total:existing.grand_total||total()},Number(existing.change||0));
          resetSale();loadShift();loadSales();updateHeldCount();
          return;
        }
        return toast((existing&&existing.error)||'Gagal melunasi Order.');
      }catch(e){return toast(e.message);}
    }

    var table=tx.getTable();
    var orderType=tx.getOrderType();
    var items=tx.getDisplayItems();
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
      items:items.map(function(i){return {product_id:i.product_id,name:i.name,quantity:i.quantity,unit_price:i.unit_price,expected_price:i.unit_price,options:i.options||[],note:i.note||''};}),
      client_transaction_id:'pos_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)
    };

    try{
      var d;
      if(!navigator.onLine){
        if(!state.terminalId)return toast('POS offline belum siap: terminal cabang belum terdaftar.');
        await request('/pos/local/sale',{method:'POST',headers:headers(),body:JSON.stringify({terminal_id:state.terminalId,branch_id:state.branchId,shift_id:state.shift.id,order_type:orderType,payment_method:'cash',amount_tendered:amountTendered,customer:payload.customer,items:payload.items,client_transaction_id:payload.client_transaction_id,offline_created_at:new Date().toISOString(),config_version:1})});
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
      return {
        product_id:it.product_id,
        name:it.product_name||it.name||'Produk',
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
      pendingAdditions:(data.additions||[]).filter(function(a){return a.status==='pending_acceptance';})
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
    var card = $('pos-modal-card');
    if (card) card.innerHTML = html;
    var modal = $('pos-modal');
    if (modal) {
      modal.className = 'pos-modal' + (extraClass ? ' ' + extraClass : '');
      modal.classList.remove('hidden');
    }
  }
  function hideModal(){
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

    var labelInfo=(restoredType==='dine_in'&&restoredTable)?('Meja '+restoredTable.table_number):(h.customer_name||(restoredType==='pickup'?'Pickup':restoredType==='delivery'?'Delivery':'Pesanan'));
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
        var remaining=Number(check.remaining_amount||0);
        var total=checkTotal(check);
        var payments=renderPayments(check);
        var isPaid=remaining<=0;
        var label=checks.length===1 ? 'Tagihan' : 'Bagian '+(index+1);
        return '<div class="pos-check-card pos-simple-check-card">' +
          '<div class="pos-check-head"><div><strong>'+label+'</strong><small>'+(isPaid?'LUNAS':('Sisa '+money(remaining)))+'</small></div><strong>'+money(total)+'</strong></div>' +
          '<div class="pos-check-balance"><span>Sudah dibayar</span><strong>'+money(paid)+'</strong></div>' +
          (payments ? '<div class="pos-check-payments">'+payments+'</div>' : '') +
          (isPaid ? '<div class="pos-check-paid">✓ Lunas</div>' : '<div class="pos-check-actions"><button type="button" class="pos-btn" data-pay-check="'+esc(check.id)+'">Bayar '+money(remaining)+'</button></div>') +
        '</div>';
      }

      var total=Number(data.order.grand_total||0);
      var paidOrder=checks.reduce(function(sum,check){return sum+Number(check.paid_amount||0);},0);
      var remainingOrder=Math.max(0,total-paidOrder);
      var hasSplit=checks.length>1;
      var allUnpaid=checks.every(function(check){return Number(check.paid_amount||0)===0 && check.status==='open';});
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
          '<div class="pos-simple-summary">Sudah dibayar <strong>'+money(paidOrder)+'</strong><span>Sisa '+money(remainingOrder)+'</span></div>' +
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
        await request('/pos/orders/'+encodeURIComponent(orderId)+'/checks/'+encodeURIComponent(check.id)+'/pay',{
          method:'POST',headers:headers(),
          body:JSON.stringify({amount:amount,payment_method:'cash',payer_name:$('pos-pay-payer').value.trim()||null,amount_tendered:tendered})
        });
        toast('Pembayaran tercatat.');
        openCheckManager(orderId);
      }catch(e){submitBtn.disabled=false;toast(e.message);}
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
      var typeTitle = (oType === 'dine_in') ? ('Meja ' + esc(h.table_number || '—')) : (oType === 'pickup' ? 'Pickup' : oType === 'delivery' ? 'Delivery' : esc(oType));
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
      var isNotCancelled = st !== 'cancelled' && st !== 'rejected' && st !== 'void';
      return t >= startTime && isPaid && isNotCancelled;
    }).length;
    badge.textContent = count + ' Transaksi';
  }

  async function loadSales(){
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
      return '<div class="pos-sale-row"><div class="pos-sale-main"><strong>#'+esc(s.order_number||s.id)+'</strong><small>'+esc(s.created_at||'')+'</small></div><div>'+esc((s.order_type||'').toUpperCase())+'</div><div><span class="pos-badge ok">'+esc(s.payment_status||'paid')+'</span></div><div class="pos-sale-total">'+money(s.grand_total)+'</div><div><button class="pos-btn small ghost" data-print="'+esc(s.id)+'">Struk</button></div></div>';
    }).join('');
    box.querySelectorAll('[data-print]').forEach(function(b){b.onclick=function(){printReceipt(b.dataset.print);};});
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
      var typeTitle = (oType === 'dine_in') ? ('Meja ' + esc(h.table_number || '—')) : (oType === 'pickup' ? 'Pickup' : oType === 'delivery' ? 'Delivery' : esc(oType));
       return '<div class="pos-held-row"><div class="pos-held-main"><strong>' + typeTitle + '</strong><small>Tamu: '+esc(h.customer_name||'Tamu')+' · '+esc(h.created_at||'')+'</small></div><div class="pos-held-items">'+esc(itemSummary||'—')+'</div><div class="pos-held-total">'+money(subtotal)+'</div><div class="pos-held-actions"><button type="button" class="pos-btn small ghost danger" data-cancel-held-row="'+esc(h.id)+'">Batal</button><button type="button" class="pos-btn small" data-resume-held-row="'+esc(h.id)+'">Buka di Kasir</button></div></div>';
    }).join('');
    box.querySelectorAll('[data-resume-held-row]').forEach(function(b){b.onclick=function(){resumeHeld(b.dataset.resumeHeldRow);};});
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

  function openTableSelector(){
    if(!state.branchId)return toast('Cabang POS belum tersedia.');
    request('/dine-in/layout?branch_id='+encodeURIComponent(state.branchId),{headers:headers()}).then(function(d){
      var tables=(d.layout&&d.layout.tables)||[];
      var html='<h3>Pilih Meja</h3><p>Pilih meja yang menjadi konteks transaksi Dine-in. Cart yang sudah dibuat tetap dipertahankan.</p><div class="pos-table-picker">';
      if(!tables.length) html+='<div class="pos-empty">Belum ada meja aktif di cabang ini.</div>';
      tables.forEach(function(t){
        var st=t.operational_state||t.status||'available';
        var can=st==='available';
        var selected=state.selectedTable&&String(state.selectedTable.id)===String(t.id);
        html+='<button type="button" class="pos-table-pick '+(can?'':'disabled')+(selected?' selected':'')+'" '+(can?'':'disabled')+' data-table-pick="'+esc(t.id)+'"><span><strong>'+esc(t.label||('Meja '+t.table_number))+'</strong><small>'+esc(String(t.capacity||4))+' kursi · '+esc(tableStateLabel(st))+'</small></span><b>'+(selected?'✓':can?'Pilih':'Tidak tersedia')+'</b></button>';
      });
      html+='</div><div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-table-picker-cancel">Batal</button></div>';
      showModal(html);
      $('pos-table-picker-cancel').onclick=function(){
        state.autoPayAfterTable=false;
        hideModal();
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
        (isAvailable ? '<button type="button" class="pos-action-sheet-btn" id="btn-table-use-sale"><span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Pilih untuk Transaksi Kasir</span><small>Gunakan meja ini sebagai konteks dine-in</small></button>' : '') +
      '</div>' +
      '<div class="pos-modal-actions"><button type="button" class="pos-btn ghost" id="btn-table-action-close">Tutup</button></div>' +
    '</div>';

    showModal(html);
    if($('btn-table-action-close')) $('btn-table-action-close').onclick = hideModal;

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

  async function loadTables(){
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
    $('btn-pos-refresh-menu').onclick=loadMenu;
    $('btn-pos-pay').onclick=function(){ if(state.activeAdditionalMode) submitAdditionalOrder(); else openPayModal(); };
    if($('btn-pos-pay-many')) $('btn-pos-pay-many').onclick=openManyPaymentFromCart;
    if($('btn-pos-additional-order')) $('btn-pos-additional-order').onclick=enterAdditionalOrderMode;
    $('btn-pos-clear').onclick=function(){resetSale();};
    $('btn-pos-hold').onclick=holdSale;
    if($('btn-pos-open-held')) $('btn-pos-open-held').onclick=openHeld;
    if($('tab-transaksi-sales')) $('tab-transaksi-sales').onclick=function(){switchTransaksiTab('sales');};
    if($('tab-transaksi-held')) $('tab-transaksi-held').onclick=function(){switchTransaksiTab('held');};
    $('btn-pos-select-table').onclick=function(){openTableSelector();};
    $('btn-pos-load-sales').onclick=loadSales;
    if($('btn-pos-refresh-tables')) $('btn-pos-refresh-tables').onclick=loadTables;
    if($('btn-pos-refresh-shift')) $('btn-pos-refresh-shift').onclick=function(){ renderShift(); openShiftModal(); };
    $('btn-pos-shift-status').onclick=openShiftModal;
    $('btn-pos-close-shift-top').onclick=openCloseShiftModal;
    $('btn-pos-logout').onclick=function(){clearPosSessionAndReturnToPin();};
    bindPosStatus();
    bindPosStatus();
    $('pos-modal').onclick=function(e){if(e.target===this)hideModal();};
    if($('pos-mcart-trigger-order')){
      $('pos-mcart-trigger-order').onclick=function(e){
        e.stopPropagation();
        openMobileCartOverlay();
      };
    }
    if($('btn-pos-mcart-checkout')){
      $('btn-pos-mcart-checkout').onclick=function(e){
        e.stopPropagation();
        if(state.activeAdditionalMode) submitAdditionalOrder(); else openPayModal();
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
      await loadShift();
      await loadMenu();
      await updateHeldCount();
      loadSales().catch(function(){});
      loadTables().catch(function(){});
      setView('kasir');
      window.addEventListener('online',function(){
        setPosStatus('caution','Menghubungkan kembali…','POS sedang mencoba menyambungkan kembali ke sistem.');
        if(state.offlineMode && token()) state.offlineMode=false;
        loadTerminal();
        loadShift();
        loadMenu();
        if(token()) {
          request('/pos/local/sync-outbox',{method:'POST',headers:headers(),body:JSON.stringify({terminal_id:state.terminalId,branch_id:state.branchId})}).catch(function(){});
        }
      });
      window.addEventListener('offline',function(){state.coreConnection=false;
      updatePosReadiness();});
      updatePosReadiness();
    }catch(e){toast(e.message||'Gagal memuat POS.');}
  }

  boot();
})();