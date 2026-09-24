/* XENTRA POS — standalone cashier execution surface */
(function () {
  'use strict';

  var API = '/api/v1';
  var TOKEN_KEY = 'xentra_merchant_token';
  var USER_KEY = 'xentra_merchant_user';
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
    terminalId: localStorage.getItem('xentra_pos_terminal_id') || ('pos_' + Math.random().toString(36).slice(2, 10))
  };

  localStorage.setItem('xentra_pos_terminal_id', state.terminalId);

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
    if (btn) btn.disabled=!state.cart.length || !state.shift;
    if (!box) return;
    if (!state.cart.length) { box.innerHTML='<div class="pos-empty">Belum ada item.</div>'; return; }
    box.innerHTML=state.cart.map(function(it,idx){
      return '<div class="pos-cart-item"><div><div class="pos-cart-item-name">'+esc(it.name)+'</div><div class="pos-cart-item-meta">'+money(it.unit_price)+'</div></div>' +
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

  function addProduct(p){
    if (p.is_available === 0 || p.is_available === false) return toast('Menu sedang tidak tersedia.');
    var hit=state.cart.find(function(i){return String(i.product_id)===String(p.id);});
    if(hit) hit.quantity += 1;
    else state.cart.push({product_id:p.id,name:p.name || p.product_name || 'Produk',unit_price:Number(p.price || p.sale_price || p.regular_price || 0),quantity:1});
    renderCart();
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
    var products=(state.menu.products||[]).filter(function(p){
      var okCat=state.category==='all' || String(state.category)===String(p.category_id) || (Array.isArray(p.category_ids)&&p.category_ids.map(String).indexOf(String(state.category))!==-1);
      var okQ=!q || String(p.name||'').toLowerCase().indexOf(q)!==-1;
      return okCat && okQ;
    });
    if(grid){
      grid.innerHTML=products.length?products.map(function(p){
        var unavailable=p.is_available===0 || p.is_available===false;
        return '<button type="button" class="pos-product '+(unavailable?'disabled':'')+'" data-product-id="'+esc(p.id)+'">'+
          '<div><div class="pos-product-name">'+esc(p.name || p.product_name)+'</div><div class="pos-product-meta">'+(unavailable?'Tidak tersedia':'Siap dijual')+'</div></div>'+
          '<div class="pos-product-price">'+money(p.price || p.sale_price || p.regular_price)+'</div></button>';
      }).join(''):'<div class="pos-empty">Menu tidak ditemukan.</div>';
      grid.querySelectorAll('.pos-product').forEach(function(b){
        b.onclick=function(){ var p=(state.menu.products||[]).find(function(x){return String(x.id)===String(b.dataset.productId);}); if(p)addProduct(p); };
      });
    }
  }

  async function loadMenu(){
    if(!state.branchId)return;
    try{
      var data=await request('/catalog/menu?branch_id='+encodeURIComponent(state.branchId),{headers:headers()});
      state.menu={categories:data.categories||[],products:data.products||[]};
      renderMenu();
      setConnection(true);
    }catch(e){ setConnection(false); if($('pos-product-grid'))$('pos-product-grid').innerHTML='<div class="pos-empty">Menu tidak dapat dimuat. Periksa koneksi.</div>'; }
  }

  async function ensureSession(){
    if(!token()){window.location.replace('/login');return false;}
    var me=await request('/auth/merchant/me',{headers:headers()});
    state.user=me.user;
    if(state.user.role!=='cashier'){ window.location.replace(me.landing || '/merchant/'); return false; }
    state.branchId=state.user.branch_id || state.user.branchId;
    if(!state.branchId){ toast('Akun kasir belum memiliki cabang.'); return false; }
    if($('pos-branch-name')) $('pos-branch-name').textContent=state.user.branch_name || state.branchId;
    if($('pos-cashier-name')) $('pos-cashier-name').textContent=state.user.full_name || state.user.username || 'Kasir';
    return true;
  }

  async function loadShift(){
    try{
      var d=await request('/pos/shifts/current',{headers:headers()});
      state.shift=d.shift||null;
    }catch(e){state.shift=null;}
    renderShift(); renderCart();
  }

  function renderShift(){
    var box=$('pos-shift-card'); if(!box)return;
    if(!state.shift){
      box.innerHTML='<h3>Belum ada shift aktif</h3><p>Kasir harus membuka shift sebelum penjualan dapat diselesaikan.</p>'+
        '<div class="pos-form-row"><label>Modal Kas Awal</label><input id="pos-starting-float" type="number" min="0" value="0"></div>'+
        '<div class="pos-shift-actions"><button class="pos-btn" id="btn-pos-open-shift">Buka Shift</button></div>';
      $('btn-pos-open-shift').onclick=openShift;
      return;
    }
    var s=state.shift;
    box.innerHTML='<h3>Shift Aktif</h3><p>'+esc(s.id)+' · dibuka '+esc(s.opened_at || '')+'</p>'+
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
    try{var d=await request('/pos/shifts/open',{method:'POST',headers:headers(),body:JSON.stringify({branch_id:state.branchId,starting_float:amount})});state.shift=d.shift;renderShift();renderCart();toast('Shift dibuka.');}
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

  async function closeShift(){
    if(!state.shift)return;
    var actual=prompt('Masukkan uang fisik aktual di laci'); if(actual===null)return;
    actual=Number(actual); if(!Number.isFinite(actual)||actual<0)return toast('Nominal tidak valid.');
    try{var d=await request('/pos/shifts/'+encodeURIComponent(state.shift.id)+'/close',{method:'POST',headers:headers(),body:JSON.stringify({actual_cash:actual})});state.shift=null;renderShift();renderCart();toast('Shift ditutup. Variance: '+money(d.shift && d.shift.variance));}
    catch(e){toast(e.message);}
  }

  function openPayModal(){
    if(!state.cart.length)return;
    var t=total();
    showModal('<h3>Bayar</h3><p>POS menyelesaikan Sale lalu mencatat payment dan cash settlement sesuai shift aktif.</p>'+
      '<div class="pos-payment-total">'+money(t)+'</div>'+
      '<div class="pos-form-row"><label>Metode Pembayaran</label><select id="pos-payment-method"><option value="cash">Tunai</option><option value="qris" disabled>QRIS (belum tersedia di endpoint POS)</option></select></div>'+
      '<div class="pos-form-row"><label>Uang Diterima</label><input id="pos-amount-tendered" type="number" min="'+t+'" value="'+t+'"></div>'+
      '<div id="pos-change-preview" class="pos-change">Kembalian: '+money(0)+'</div>'+
      '<div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-pay-cancel">Batal</button><button class="pos-btn" id="pos-pay-confirm">Konfirmasi Bayar</button></div>');
    var amt=$('pos-amount-tendered'); var preview=$('pos-change-preview');
    amt.oninput=function(){preview.textContent='Kembalian: '+money(Math.max(0,Number(amt.value||0)-t));};
    $('pos-pay-cancel').onclick=hideModal; $('pos-pay-confirm').onclick=function(){submitSale(Number(amt.value||0));};
  }

  async function submitSale(amountTendered){
    if(!state.shift)return toast('Buka shift terlebih dahulu.');
    if(state.orderType==='dine_in' && !state.selectedTable)return toast('Pilih meja untuk transaksi dine-in.');
    var payload={
      branch_id:state.branchId, shift_id:state.shift.id, order_type:state.orderType, payment_method:'cash',
      amount_tendered:amountTendered, customer:{name:$('pos-customer-name').value.trim(),phone:'',table_number:state.selectedTable ? state.selectedTable.table_number : null},
      notes:$('pos-order-note').value.trim(),items:state.cart.map(function(i){return {product_id:i.product_id,name:i.name,quantity:i.quantity,unit_price:i.unit_price};}),
      client_transaction_id:'pos_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)
    };
    try{
      var d=await request('/pos/sales',{method:'POST',headers:headers(),body:JSON.stringify(payload)});
      hideModal(); var order=d.order||{}; var change=Number(order.change||0);
      showModal('<h3>Pembayaran Berhasil</h3><p>Sale '+esc(order.order_number||order.id||'')+' selesai.</p><div class="pos-payment-total">'+money(order.grand_total||total())+'</div><div class="pos-change">Kembalian: '+money(change)+'</div><div class="pos-modal-actions"><button class="pos-btn ghost" id="pos-sale-close">Selesai</button><button class="pos-btn" id="pos-sale-print">Cetak Struk</button></div>');
      $('pos-sale-close').onclick=function(){hideModal();resetSale();}; $('pos-sale-print').onclick=function(){printReceipt(order.id);};
      loadShift(); loadSales();
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
    $('btn-pos-logout').onclick=function(){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);window.location.replace('/login');};
    $('pos-modal').onclick=function(e){if(e.target===this)hideModal();};
  }

  async function boot(){
    bind();
    try{
      if(!await ensureSession())return;
      await loadShift();
      await loadMenu();
      setView('kasir');
      window.addEventListener('online',function(){setConnection(true);loadMenu();});
      window.addEventListener('offline',function(){setConnection(false);});
      setConnection(navigator.onLine);
    }catch(e){toast(e.message||'Gagal memuat POS.');}
  }

  boot();
})();