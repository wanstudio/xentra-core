/*
 * XENTRA — OWNER MASTER MENU
 * Locked Menu Domain v2
 * Category + Judul + optional Rasa + Product composition.
 */
(function(){'use strict';
var S=window.XentraShared||{},API_BASE=S.API_BASE||'/api/v1';
function $(id){return document.getElementById(id)}
function esc(v){return S.esc?S.esc(v):String(v==null?'':v).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]})}
function fetcher(url,opt){return typeof S.adminFetch==='function'?S.adminFetch(url,opt||{}):fetch(url,opt||{})}
function headers(){return typeof S.getAuthHeaders==='function'?S.getAuthHeaders({'Content-Type':'application/json'}):{'Content-Type':'application/json'}}
async function api(path,opt){var r=await fetcher(API_BASE+path,Object.assign({headers:headers()},opt||{}));var d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||d.message||'Request gagal');return d}
function toast(m){if(S.showToast)S.showToast(m);else if(window.showToast)window.showToast(m)}
var state={categories:[],titles:[],rasas:[],levels:[],products:[],menus:[],components:[],editingId:null};

function optionRows(rows,selected,placeholder){var h='<option value="">'+esc(placeholder||'Pilih')+'</option>';(rows||[]).forEach(function(r){h+='<option value="'+esc(r.id)+'"'+(String(r.id)===String(selected||'')?' selected':'')+'>'+esc(r.name)+'</option>'});return h}
async function loadMasters(){
 var rs=await Promise.all([
   api('/admin/categories?active_only=1'),api('/admin/titles?active_only=1'),api('/admin/rasas?active_only=1'),
   api('/admin/levels?active_only=1'),api('/admin/composed/products?active_only=1')
 ]);
 state.categories=rs[0].categories||[];state.titles=rs[1].titles||[];state.rasas=rs[2].rasas||[];state.levels=rs[3].levels||[];state.products=rs[4].products||[];
 renderMasterSelects();
}
function renderMasterSelects(){
 var c=$('cm-category'),t=$('cm-sub-category'),r=$('cm-rasa'),l=$('cm-level');
 if(c)c.innerHTML=optionRows(state.categories,c.value,'Pilih Kategori');
 if(t)t.innerHTML=optionRows(state.titles,t.value,'Pilih Judul');
 if(r)r.innerHTML=optionRows(state.rasas,r.value,'Tidak ada rasa');
 if(l)l.innerHTML=optionRows(state.levels,l.value,'Tidak ada level');
 renderComponents();
}
function productOptions(selected){return optionRows(state.products,selected,'Pilih Product')}
function renderComponents(){
 var wrap=$('cm-package-components');if(!wrap)return;
 if(!state.components.length)state.components=[{product_id:'',quantity:1}];
 wrap.innerHTML='';
 state.components.forEach(function(x,i){
   var row=document.createElement('div');row.className='x-composed-menu-component-row';row.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:8px';
   row.innerHTML='<select class="x-input cm-component-product" data-i="'+i+'">'+productOptions(x.product_id)+'</select><input class="x-input cm-component-qty" data-i="'+i+'" type="number" min="1" step="1" value="'+esc(x.quantity||1)+'" style="max-width:90px"><button type="button" class="x-btn-secondary cm-component-remove" data-i="'+i+'">Hapus</button>';
   wrap.appendChild(row);
 });
 Array.prototype.forEach.call(wrap.querySelectorAll('.cm-component-product'),function(e){e.addEventListener('change',function(){state.components[Number(e.dataset.i)].product_id=e.value;updatePreview()})});
 Array.prototype.forEach.call(wrap.querySelectorAll('.cm-component-qty'),function(e){e.addEventListener('input',function(){state.components[Number(e.dataset.i)].quantity=Number(e.value||1);})});
 Array.prototype.forEach.call(wrap.querySelectorAll('.cm-component-remove'),function(e){e.addEventListener('click',function(){if(state.components.length<=1)return;state.components.splice(Number(e.dataset.i),1);renderComponents()})});
 updatePreview();
}
function resetEditor(){state.editingId=null;state.components=[{product_id:'',quantity:1}];['cm-category','cm-sub-category','cm-rasa','cm-level'].forEach(function(id){if($(id))$(id).value=''});if($('cm-price'))$('cm-price').value='';if($('cm-status'))$('cm-status').value='DRAFT';renderComponents();updatePreview();var t=$('master-menu-editor-title');if(t)t.textContent='Tambah Menu';var mt=$('master-menu-editor-mobile-title');if(mt)mt.textContent='Tambah Menu'}
function readComponents(){return state.components.filter(function(x){return x.product_id}).map(function(x){return{product_id:String(x.product_id),quantity:Number(x.quantity||1)}})}
function updatePreview(){
 var c=$('cm-category'),t=$('cm-sub-category'),r=$('cm-rasa'),p=$('cm-price');
 var cn=c&&c.selectedOptions[0]?c.selectedOptions[0].textContent:'',tn=t&&t.selectedOptions[0]?t.selectedOptions[0].textContent:'',rn=r&&r.value&&r.selectedOptions[0]?r.selectedOptions[0].textContent:'';
 var title=tn+(rn?' '+rn:'');
 if($('cm-preview-title'))$('cm-preview-title').textContent=title||'Pilih kategori dan judul';
 if($('cm-preview-subtitle'))$('cm-preview-subtitle').textContent=rn||'';
 if($('cm-preview-detail'))$('cm-preview-detail').textContent=cn?('Kategori: '+cn):'';
 if($('cm-preview-price'))$('cm-preview-price').textContent='Rp'+Number(p&&p.value||0).toLocaleString('id-ID');
}
async function save(status){
 var categoryId=$('cm-category')&&$('cm-category').value,titleId=$('cm-sub-category')&&$('cm-sub-category').value;
 var components=readComponents();
 if(!categoryId)return toast('❌ Kategori wajib dipilih.');
 if(!titleId)return toast('❌ Judul wajib dipilih.');
 if(!components.length)return toast('❌ Minimal satu Product wajib dimasukkan.');
 if(components.some(function(x){return !Number.isSafeInteger(x.quantity)||x.quantity<1}))return toast('❌ Quantity Product tidak valid.');
 var body={category_id:categoryId,title_id:titleId,rasa_id:$('cm-rasa').value||null,level_id:$('cm-level').value||null,selling_price:Number($('cm-price').value||0),status:status,components:components};
 try{
   var d=await api(state.editingId?('/admin/menus/'+encodeURIComponent(state.editingId)):('/admin/menus'),{method:state.editingId?'PUT':'POST',body:JSON.stringify(body)});
   toast('✓ Menu tersimpan');state.editingId=(d.menu||{}).id||state.editingId;await loadMenus();showList();
 }catch(e){toast('❌ '+e.message)}
}
async function loadMenus(){
 var d=await api('/admin/menus?status=ACTIVE');state.menus=d.menus||[];renderList();
}
function renderList(){
 var wrap=$('master-menu-list');if(!wrap)return;
 if(!state.menus.length){wrap.innerHTML='<div class="x-empty-state text-center py-6 text-muted">Belum ada Menu Master.</div>';return}
 wrap.innerHTML=state.menus.map(function(m){var title=(m.title_name||'Menu')+(m.rasa_name?' '+m.rasa_name:'');return '<button type="button" class="x-master-menu-card" data-menu-id="'+esc(m.id)+'"><strong>'+esc(title)+'</strong><span>'+esc(m.category_name||'')+'</span><span>Rp'+Number(m.selling_price||0).toLocaleString('id-ID')+'</span></button>'}).join('');
 Array.prototype.forEach.call(wrap.querySelectorAll('[data-menu-id]'),function(e){e.addEventListener('click',function(){editMenu(e.dataset.menuId)})});
}
async function editMenu(id){
 try{
  var d=await api('/admin/menus/'+encodeURIComponent(id));var m=d.menu||{};state.editingId=id;
  $('cm-category').value=m.category_id||'';$('cm-sub-category').value=m.title_id||'';$('cm-rasa').value=m.rasa_id||'';$('cm-level').value=m.level_id||'';$('cm-price').value=m.selling_price||0;$('cm-status').value=m.status||'DRAFT';
  state.components=(m.components||[]).map(function(x){return{product_id:x.product_id,quantity:Number(x.quantity||1)}});if(!state.components.length)state.components=[{product_id:'',quantity:1}];renderComponents();
  var t=$('master-menu-editor-title');if(t)t.textContent='Edit Menu';var mt=$('master-menu-editor-mobile-title');if(mt)mt.textContent='Edit Menu';showEditor();
 }catch(e){toast('❌ '+e.message)}
}
function showEditor(){var a=$('master-menu-editor-view'),b=$('master-menu-list');if(a)a.style.display='';if(b)b.style.display='none'}
function showList(){var a=$('master-menu-editor-view'),b=$('master-menu-list');if(a)a.style.display='none';if(b)b.style.display='';resetEditor()}
function bind(){
 if($('btn-add-master-menu'))$('btn-add-master-menu').addEventListener('click',function(){resetEditor();showEditor()});
 if($('btn-cm-add-component'))$('btn-cm-add-component').addEventListener('click',function(){state.components.push({product_id:'',quantity:1});renderComponents()});
 if($('btn-save-master-menu-draft'))$('btn-save-master-menu-draft').addEventListener('click',function(){save('DRAFT')});
 if($('btn-save-master-menu-active'))$('btn-save-master-menu-active').addEventListener('click',function(){save('ACTIVE')});
 if($('btn-cancel-master-menu'))$('btn-cancel-master-menu').addEventListener('click',showList);
 if($('btn-master-menu-editor-back'))$('btn-master-menu-editor-back').addEventListener('click',showList);
 ['cm-category','cm-sub-category','cm-rasa','cm-level','cm-price'].forEach(function(id){if($(id))$(id).addEventListener('change',updatePreview);});
 loadMasters().then(loadMenus).catch(function(e){console.error(e);toast('❌ Gagal memuat Master Menu')});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
window.XentraMenuFirstUI={reload:function(){return Promise.all([loadMasters(),loadMenus()])}};
})();