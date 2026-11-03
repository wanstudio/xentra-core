(function (window) {
  'use strict';

  /*
   * XENTRA OWNER — MASTER MENU INLINE DEPENDENCY CREATION
   *
   * UX boundary:
   * - Product, Category, Judul and Rasa remain separate Master entities.
   * - Owner can create a missing dependency without leaving Menu Master.
   * - Creation immediately selects the newly-created entity in the current Menu draft.
   * - No legacy Product commercial fields are introduced.
   *
   * This controller is intentionally additive to the existing canonical Menu
   * editor in dashboard.js.
   */

  var API_BASE = (window.XentraShared && window.XentraShared.API_BASE) || '/api/v1';
  var shared = window.XentraShared || {};
  var createdProducts = [];

  function adminFetch(url, options) {
    if (typeof shared.adminFetch === 'function') return shared.adminFetch(url, options);
    return fetch(url, options);
  }

  function getAuthHeaders(extra) {
    if (typeof shared.getAuthHeaders === 'function') return shared.getAuthHeaders(extra);
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    var token = localStorage.getItem('xentra_merchant_token');
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  function esc(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
    else if (window.XentraShared && typeof window.XentraShared.showToast === 'function') window.XentraShared.showToast(message);
  }

  function openSheet(options) {
    if (window.XentraPresentation && typeof window.XentraPresentation.open === 'function') {
      return window.XentraPresentation.open(options);
    }
    return null;
  }

  function closeSheet(id) {
    if (window.XentraPresentation && typeof window.XentraPresentation.close === 'function') {
      window.XentraPresentation.close(id);
    }
  }

  function requestFieldsSheet(options) {
    options = options || {};
    return new Promise(function(resolve) {
      var id = options.id || ('master-inline-' + Date.now());
      var fields = options.fields || [];
      var wrap = document.createElement('div');
      wrap.className = 'x-master-inline-sheet-content';
      wrap.innerHTML =
        '<div class="x-master-inline-sheet">' +
          '<div class="x-master-inline-sheet-intro">' +
            '<strong>' + esc(options.eyebrow || 'Master Data') + '</strong>' +
            '<p>' + esc(options.description || 'Buat data baru tanpa meninggalkan editor Menu Master.') + '</p>' +
          '</div>' +
          '<div class="x-master-inline-sheet-fields">' +
            fields.map(function(field, index) {
              return '<div class="x-master-inline-field">' +
                '<label for="' + id + '-field-' + index + '">' +
                  esc(field.label || field.name) + (field.required === false ? ' <span class="x-master-inline-optional">Opsional</span>' : ' <span class="x-required-mark">*</span>') +
                '</label>' +
                '<input id="' + id + '-field-' + index + '" class="x-input" type="' + esc(field.type || 'text') + '"' +
                  ' value="' + esc(field.value || '') + '"' +
                  ' placeholder="' + esc(field.placeholder || '') + '"' +
                  (field.required === false ? '' : ' required') +
                  (field.inputmode ? ' inputmode="' + esc(field.inputmode) + '"' : '') +
                '>' +
                (field.help ? '<small>' + esc(field.help) + '</small>' : '') +
              '</div>';
            }).join('') +
          '</div>' +
          '<div class="x-master-inline-sheet-actions">' +
            '<button type="button" class="x-btn-secondary" data-inline-cancel>Batal</button>' +
            '<button type="button" class="x-btn-primary" data-inline-save>' + esc(options.saveLabel || 'Simpan & Pilih') + '</button>' +
          '</div>' +
        '</div>';

      var done = false;
      function finish(result) {
        if (done) return;
        done = true;
        closeSheet(id);
        resolve(result);
      }

      wrap.querySelector('[data-inline-cancel]').addEventListener('click', function() { finish(null); });
      wrap.querySelector('[data-inline-save]').addEventListener('click', function() {
        var values = {};
        var invalid = false;
        fields.forEach(function(field, index) {
          var el = wrap.querySelector('#' + id + '-field-' + index);
          var value = el ? String(el.value || '').trim() : '';
          if (field.required !== false && !value) {
            invalid = true;
            if (el) el.focus();
          }
          values[field.name] = value;
        });
        if (invalid) {
          toast('Lengkapi field yang wajib diisi.');
          return;
        }
        finish(values);
      });

      openSheet({
        id: id,
        type: 'bottom-sheet',
        title: options.title || 'Tambah',
        content: wrap,
        dismissible: true,
        onClose: function() {
          if (!done) {
            done = true;
            resolve(null);
          }
        }
      });

      setTimeout(function() {
        var first = wrap.querySelector('input');
        if (first) {
          first.focus();
          first.select();
        }
      }, 0);
    });
  }

  async function requestJson(path, options) {
    var res = await adminFetch(API_BASE + path, Object.assign({
      headers: getAuthHeaders()
    }, options || {}));
    var data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || data.message || 'Gagal menyimpan data.');
    }
    return data;
  }

  function addOption(select, id, label, selectIt) {
    if (!select || !id) return;
    var option = document.createElement('option');
    option.value = String(id);
    option.textContent = label;
    select.appendChild(option);
    if (selectIt) select.value = String(id);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function createProductInline(options) {
    options = options || {};
    var packageContext = options.packageContext === true;
    var result = await requestFieldsSheet({
      id: 'master-menu-inline-product',
      title: packageContext ? 'Buat Product untuk Paket' : 'Buat Product',
      eyebrow: 'Product',
      description: packageContext
        ? 'Product baru akan langsung ditambahkan sebagai komponen pertama yang belum ada di Menu Paket ini.'
        : 'Product adalah identitas dasar yang dapat dipakai oleh beberapa Menu. Harga dan taxonomy diatur di Menu.',
      saveLabel: packageContext ? 'Simpan & Tambahkan ke Paket' : 'Simpan & Pilih Product',
      fields: [
        { name: 'name', label: 'Nama Product', placeholder: 'Contoh: Ayam Geprek', required: true },
        { name: 'sku', label: 'SKU', placeholder: 'Contoh: AYAM-GEP-001', required: false, help: 'Isi jika Product ini dikelola sebagai item stok.' }
      ]
    });
    if (!result) return;
    var data = await requestJson('/admin/composed/products', {
      method: 'POST',
      body: JSON.stringify({ name: result.name, sku: result.sku || null, is_active: true })
    });
    var product = data.product;
    createdProducts.push(product);
    // Label dropdown komposisi = nama Product saja; SKU tetap identity internal.
    var label = product.name;
    var menuApi = window.XentraOwnerMasterMenu;
    if (packageContext && menuApi && typeof menuApi.addPackageProduct === 'function') {
      menuApi.addPackageProduct(product);
      syncCreatedProductOptions();
      showCreatedState('package-product', 'Product dibuat dan langsung ditambahkan ke paket.');
      return product;
    }
    if (menuApi && typeof menuApi.upsertDependency === 'function') {
      menuApi.upsertDependency('product', product, { selectId: 'cm-product' });
    } else {
      addOption(document.getElementById('cm-product'), product.id, label, true);
    }
    syncCreatedProductOptions();
    showCreatedState('product', 'Product dibuat dan dipilih untuk Menu ini.');
    return product;
  }

  function openAddCategoryModal() {
    return new Promise(function(resolve) {
      var existing = document.getElementById('xentra-add-category-modal-backdrop');
      if (existing) existing.remove();

      var backdrop = document.createElement('div');
      backdrop.id = 'xentra-add-category-modal-backdrop';
      backdrop.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;');

      var card = document.createElement('div');
      card.setAttribute('style', 'width:353px;max-width:calc(100vw - 32px);max-height:90vh;overflow-y:auto;background:white;box-shadow:0px 2px 10px rgba(0,0,0,0.20);border-radius:16px;padding:18px 17px;display:flex;flex-direction:column;gap:17px;box-sizing:border-box;font-family:\'Plus Jakarta Sans\',sans-serif;');

      var title = document.createElement('div');
      title.setAttribute('style', 'color:#0F172A;font-size:18px;font-family:\'Plus Jakarta Sans\',sans-serif;font-weight:700;line-height:18px;text-align:left;');
      title.textContent = 'Tambah kategori';

      var formBody = document.createElement('div');
      formBody.setAttribute('style', 'align-self:stretch;display:flex;flex-direction:column;gap:16px;width:100%;box-sizing:border-box;');

      // Card 1: Nama Kategori
      var card1 = document.createElement('div');
      card1.setAttribute('style', 'align-self:stretch;min-height:123px;padding:16px;background:white;border-radius:14px;outline:0.50px #D9D9D9 solid;outline-offset:-0.50px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;width:100%;');

      var card1Inner = document.createElement('div');
      card1Inner.setAttribute('style', 'width:100%;display:flex;flex-direction:column;gap:4px;');

      var label = document.createElement('div');
      label.setAttribute('style', 'align-self:stretch;text-align:left;');
      label.innerHTML = '<span style="color:#0F172A;font-size:16px;font-weight:700;">Nama kategori </span><span style="color:#FA3E3E;font-size:16px;font-weight:700;">*</span>';

      var inputWrapper = document.createElement('div');
      inputWrapper.setAttribute('style', 'align-self:stretch;height:48px;position:relative;overflow:hidden;border-radius:14px;outline:1px #CBD5E1 solid;outline-offset:-1px;display:flex;align-items:center;background:white;box-sizing:border-box;');

      var input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 150;
      input.placeholder = 'Cth. Makanan Berat';
      input.setAttribute('style', 'width:100%;height:100%;border:none;outline:none;background:transparent;padding:0 16px;font-size:13px;font-weight:500;color:#0F172A;font-family:\'Plus Jakarta Sans\',sans-serif;box-sizing:border-box;');

      inputWrapper.appendChild(input);

      var counter = document.createElement('div');
      counter.setAttribute('style', 'align-self:stretch;text-align:right;color:#94A3B8;font-size:10px;font-weight:400;');
      counter.textContent = '0/150';

      card1Inner.appendChild(label);
      card1Inner.appendChild(inputWrapper);
      card1Inner.appendChild(counter);
      card1.appendChild(card1Inner);

      // Card 2: Aktifkan Kategori
      var card2 = document.createElement('div');
      card2.setAttribute('style', 'align-self:stretch;padding:16px;background:white;border-radius:14px;outline:0.50px #D9D9D9 solid;outline-offset:-0.50px;display:flex;justify-content:space-between;align-items:center;box-sizing:border-box;width:100%;');

      var card2Text = document.createElement('div');
      card2Text.setAttribute('style', 'display:flex;flex-direction:column;gap:4px;text-align:left;max-width:248px;');
      card2Text.innerHTML = '<div style="color:black;font-size:16px;font-weight:700;">Aktifkan kategori</div><div style="color:#94A3B8;font-size:13px;font-weight:500;">Kategori menu yang aktif akan terlihat</div>';

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      var isActive = true;
      function renderToggle() {
        toggleBtn.setAttribute('style', 'width:35px;height:21px;padding:2px;border-radius:100px;background:' + (isActive ? '#00A637' : '#E2E8F0') + ';outline:0.50px ' + (isActive ? '#009A33' : '#CBD5E1') + ' solid;outline-offset:-0.50px;box-shadow:' + (isActive ? '-1px 2px 5px rgba(0,0,0,0.15)' : 'none') + ';display:flex;align-items:center;justify-content:' + (isActive ? 'flex-end' : 'flex-start') + ';border:none;cursor:pointer;position:relative;box-sizing:border-box;transition:all 0.2s;');
        toggleBtn.innerHTML = '<div style="width:21px;height:21px;background:white;border-radius:9999px;box-shadow:0px 4px 15px rgba(0,0,0,0.15);position:relative;' + (isActive ? 'transform:translateX(14px);' : 'transform:translateX(0px);') + 'transition:transform 0.2s ease-out;"><div style="width:7px;height:0px;left:6px;top:7px;position:absolute;transform:rotate(90deg);outline:1px white solid;outline-offset:-0.50px;opacity:' + (isActive ? '1' : '0') + ';"></div></div>';
      }
      renderToggle();
      toggleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        isActive = !isActive;
        renderToggle();
      });

      card2.appendChild(card2Text);
      card2.appendChild(toggleBtn);

      formBody.appendChild(card1);
      formBody.appendChild(card2);

      // Card 3: Submit Button
      var submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.setAttribute('style', 'align-self:stretch;height:48px;padding:12px 24px;background:#F2F2F2;color:#979797;border-radius:9999px;border:none;font-size:14px;font-weight:700;font-family:\'Plus Jakarta Sans\',sans-serif;display:flex;justify-content:center;align-items:center;cursor:not-allowed;width:100%;box-sizing:border-box;');
      submitBtn.textContent = 'Buat kategori';

      function updateSubmitState() {
        var val = input.value.trim();
        counter.textContent = input.value.length + '/150';
        if (val.length > 0) {
          submitBtn.style.background = '#0F172A';
          submitBtn.style.color = '#FFFFFF';
          submitBtn.style.cursor = 'pointer';
        } else {
          submitBtn.style.background = '#F2F2F2';
          submitBtn.style.color = '#979797';
          submitBtn.style.cursor = 'not-allowed';
        }
      }

      input.addEventListener('input', updateSubmitState);

      function closeModal() {
        backdrop.remove();
        document.removeEventListener('keydown', onEsc);
      }

      function onEsc(e) {
        if (e.key === 'Escape') {
          closeModal();
          resolve(null);
        }
      }
      document.addEventListener('keydown', onEsc);

      backdrop.addEventListener('click', function(e) {
        if (e.target === backdrop) {
          closeModal();
          resolve(null);
        }
      });

      submitBtn.addEventListener('click', function(e) {
        e.preventDefault();
        var val = input.value.trim();
        if (!val) return;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan...';
        closeModal();
        resolve({ name: val, is_active: isActive ? 1 : 0 });
      });

      card.appendChild(title);
      card.appendChild(formBody);
      card.appendChild(submitBtn);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      setTimeout(function() {
        input.focus();
      }, 50);
    });
  }

  async function createCategoryInline() {
    var result = await openAddCategoryModal();
    if (!result) return;
    var data = await requestJson('/admin/categories', { method: 'POST', body: JSON.stringify({ name: result.name, is_active: result.is_active }) });
    var category = data.category;
    var menuApi = window.XentraOwnerMasterMenu;
    if (menuApi && typeof menuApi.upsertDependency === 'function') {
      menuApi.upsertDependency('category', category, { selectId: 'cm-category' });
    } else {
      addOption(document.getElementById('cm-category'), category.id, category.name, true);
    }
    showCreatedState('category', 'Kategori dibuat dan dipilih.');
  }

  async function createRasaInline() {
    var result = await requestFieldsSheet({
      id: 'master-menu-inline-rasa',
      title: 'Buat Master Rasa',
      eyebrow: 'Master Data',
      description: 'Rasa bersifat reusable dan dapat dipakai oleh banyak Menu.',
      saveLabel: 'Simpan & Pilih Rasa',
      fields: [{ name: 'name', label: 'Nama Rasa', placeholder: 'Contoh: Sambal Matah', required: true }]
    });
    if (!result) return;
    var data = await requestJson('/admin/rasas', { method: 'POST', body: JSON.stringify({ name: result.name }) });
    var rasa = data.rasa;
    var select = document.getElementById('cm-rasa');
    var menuApi = window.XentraOwnerMasterMenu;
    if (menuApi && typeof menuApi.upsertDependency === 'function') {
      menuApi.upsertDependency('rasa', rasa, { selectId: 'cm-rasa' });
    } else if (select) {
      addOption(select, rasa.id, rasa.name, true);
    }
    showCreatedState('rasa', 'Rasa dibuat dan dipilih.');
  }

  function addButtonToFormGroup(selectId, action, label, handler, options) {
    var select = document.getElementById(selectId);
    if (!select) return;
    var group = select.closest('.x-form-group');
    if (!group || group.querySelector('[data-inline-master-action="' + action + '"]')) return;
    options = options || {};

    // Jika select sudah di-enhance oleh XentraDropdown, elemen host-nya berada tepat sebelum select.
    var host = (select.previousElementSibling && select.previousElementSibling.classList.contains('x-owner-select-dropdown'))
      ? select.previousElementSibling
      : null;

    var row = document.createElement('div');
    row.className = 'x-master-inline-select-row';
    var insertTarget = host || select;
    insertTarget.parentNode.insertBefore(row, insertTarget);
    if (host) row.appendChild(host);
    row.appendChild(select);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'x-master-inline-link';
    button.setAttribute('data-inline-master-action', action);
    button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    button.title = 'Tambah ' + label + ' Baru';
    button.setAttribute('aria-label', 'Tambah ' + label + ' Baru');
    button.addEventListener('click', function() {
      handler().catch(function(err) {
        console.error('[Master Menu Inline]', err);
        toast(err.message || 'Gagal membuat data.');
      });
    });
    row.appendChild(button);
    if (options.helper) {
      var helper = document.createElement('small');
      helper.className = 'x-master-inline-dependency-hint';
      helper.setAttribute('data-inline-dependency-hint', action);
      helper.textContent = options.helper;
      group.appendChild(helper);
    }
  }

  function showCreatedState(action, message) {
    var trigger = document.querySelector('[data-inline-master-action="' + action + '"]');
    if (!trigger) return;
    var formGroup = trigger.closest('.x-form-group');
    if (!formGroup) return;
    var old = formGroup.querySelector('.x-master-inline-created');
    if (old) old.remove();
    var state = document.createElement('div');
    state.className = 'x-master-inline-created';
    state.textContent = '✓ ' + message;
    formGroup.appendChild(state);
  }

  function syncCreatedProductOptions() {
    document.querySelectorAll('[data-cm-product]').forEach(function(select) {
      createdProducts.forEach(function(product) {
        var id = String(product.id || '');
        if (!id || Array.from(select.options).some(function(option) { return String(option.value) === id; })) return;
        addOption(select, id, product.name, false);
      });
    });
  }

  function injectQuickCreateControls() {
    addButtonToFormGroup('cm-product', 'product', 'Buat Product', createProductInline, {
      helper: 'Product adalah identitas dasar; harga dan taxonomy diatur di Menu.'
    });
    addButtonToFormGroup('cm-category', 'category', 'Buat Kategori', createCategoryInline);
    syncCreatedProductOptions();

    var packageAdd = document.getElementById('btn-cm-add-component');
    if (packageAdd && !document.querySelector('[data-inline-master-action="package-product"]')) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'x-master-inline-link';
      button.setAttribute('data-inline-master-action', 'package-product');
      button.textContent = '+ Buat Product';
      button.style.marginTop = '8px';
      var helper = document.createElement('small');
      helper.className = 'x-master-inline-dependency-hint';
      helper.textContent = 'Tidak menemukan Product?';
      packageAdd.parentNode.appendChild(helper);
      button.addEventListener('click', function() {
        createProductInline({ packageContext: true }).catch(function(err) {
          console.error('[Master Menu Inline]', err);
          toast(err.message || 'Gagal membuat Product.');
        });
      });
      packageAdd.parentNode.appendChild(button);
    }
  }

  function enhanceMasterMenuEditor() {
    var form = document.getElementById('form-master-menu');
    if (!form) return;
    injectQuickCreateControls();

    var observer;
    var injecting = false;
    var scheduled = false;
    function scheduleInject() {
      if (injecting || scheduled) return;
      scheduled = true;
      setTimeout(function() {
        scheduled = false;
        injecting = true;
        injectQuickCreateControls();
        injecting = false;
      }, 0);
    }
    observer = new MutationObserver(scheduleInject);
    observer.observe(form, { subtree: true, childList: true });

    /*
     * Existing dashboard.js initializes the canonical editor and navigation.
     * This layer only adds dependency creation affordances; it never replaces
     * the save flow or changes Menu/Product ownership.
     */
  }

  function init() {
    if (document.documentElement.hasAttribute('data-master-menu-inline-init')) return;
    document.documentElement.setAttribute('data-master-menu-inline-init', '1');

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', enhanceMasterMenuEditor, { once: true });
    } else {
      enhanceMasterMenuEditor();
    }
  }

  window.XentraOwnerMasterMenuInline = {
    init: enhanceMasterMenuEditor,
    createProduct: createProductInline,
    createCategory: createCategoryInline,
    createRasa: createRasaInline
  };

  init();
})(window);
