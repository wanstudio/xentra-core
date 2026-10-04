(function (window) {
  'use strict';

  /*
   * XENTRA OWNER — MASTER MENU INLINE DEPENDENCY CREATION
   *
   * UX boundary:
   * - Product, Category, Sub Category and Rasa remain separate Master entities.
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
    var label = product.name + (product.sku ? ' · SKU ' + product.sku : '');
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

  async function createCategoryInline() {
    var result = await requestFieldsSheet({
      id: 'master-menu-inline-category',
      title: 'Buat Kategori',
      eyebrow: 'Taxonomy',
      description: 'Kategori adalah parent taxonomy untuk mengelompokkan Sub Category.',
      saveLabel: 'Simpan & Pilih Kategori',
      fields: [{ name: 'name', label: 'Nama Kategori', placeholder: 'Contoh: Makanan', required: true }]
    });
    if (!result) return;
    var data = await requestJson('/admin/categories', { method: 'POST', body: JSON.stringify({ name: result.name }) });
    var category = data.category;
    var menuApi = window.XentraOwnerMasterMenu;
    if (menuApi && typeof menuApi.upsertDependency === 'function') {
      menuApi.upsertDependency('category', category, { selectId: 'cm-category' });
    } else {
      addOption(document.getElementById('cm-category'), category.id, category.name, true);
    }
    refreshSubCategoryDependencyState();
    showCreatedState('category', 'Kategori dibuat dan dipilih.');
  }

  async function createSubCategoryInline() {
    var category = document.getElementById('cm-category');
    var categoryId = category ? String(category.value || '') : '';
    if (!categoryId) {
      refreshSubCategoryDependencyState();
      return;
    }
    var result = await requestFieldsSheet({
      id: 'master-menu-inline-sub-category',
      title: 'Buat Sub Category',
      eyebrow: 'Taxonomy',
      description: 'Sub Category harus berada di dalam Kategori yang sedang dipilih.',
      saveLabel: 'Simpan & Pilih Sub Category',
      fields: [{ name: 'name', label: 'Nama Sub Category', placeholder: 'Contoh: Ayam Geprek', required: true }]
    });
    if (!result) return;
    var data = await requestJson('/admin/sub-categories', { method: 'POST', body: JSON.stringify({ category_id: categoryId, name: result.name }) });
    var sub = data.sub_category;
    var select = document.getElementById('cm-sub-category');
    var menuApi = window.XentraOwnerMasterMenu;
    if (menuApi && typeof menuApi.upsertDependency === 'function') {
      menuApi.upsertDependency('sub-category', sub, { selectId: 'cm-sub-category' });
    } else if (select) {
      addOption(select, sub.id, sub.name, true);
    }
    showCreatedState('sub-category', 'Sub Category dibuat dan dipilih.');
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
    var row = document.createElement('div');
    row.className = 'x-master-inline-select-row';
    select.parentNode.insertBefore(row, select);
    row.appendChild(select);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'x-master-inline-link';
    button.setAttribute('data-inline-master-action', action);
    button.textContent = '+ ' + label;
    button.setAttribute('aria-label', 'Buat ' + label + ' baru');
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

  function refreshSubCategoryDependencyState() {
    var category = document.getElementById('cm-category');
    var sub = document.getElementById('cm-sub-category');
    var action = document.querySelector('[data-inline-master-action="sub-category"]');
    var disabled = !(category && category.value);
    if (sub) sub.disabled = disabled;
    if (action) {
      action.disabled = disabled;
      action.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      action.title = disabled ? 'Pilih Kategori terlebih dahulu' : 'Buat Sub Category baru';
    }
  }

  function syncCreatedProductOptions() {
    document.querySelectorAll('[data-cm-product]').forEach(function(select) {
      createdProducts.forEach(function(product) {
        var id = String(product.id || '');
        if (!id || Array.from(select.options).some(function(option) { return String(option.value) === id; })) return;
        addOption(select, id, product.name + (product.sku ? ' · SKU ' + product.sku : ''), false);
      });
    });
  }

  function injectQuickCreateControls() {
    addButtonToFormGroup('cm-product', 'product', 'Buat Product', createProductInline, {
      helper: 'Product adalah identitas dasar; harga dan taxonomy diatur di Menu.'
    });
    addButtonToFormGroup('cm-category', 'category', 'Buat Kategori', createCategoryInline);
    addButtonToFormGroup('cm-sub-category', 'sub-category', 'Buat Sub Category', createSubCategoryInline, {
      helper: 'Pilih Kategori terlebih dahulu.'
    });
    addButtonToFormGroup('cm-rasa', 'rasa', 'Buat Rasa', createRasaInline);
    refreshSubCategoryDependencyState();
    syncCreatedProductOptions();

    var packageAdd = document.getElementById('btn-cm-add-component');
    if (packageAdd && !document.querySelector('[data-inline-master-action="package-product"]')) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'x-master-inline-link';
      button.setAttribute('data-inline-master-action', 'package-product');
      button.textContent = '+ Buat Product';
      button.style.marginTop = '8px';
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
    form.addEventListener('change', function(event) {
      if (event.target && event.target.id === 'cm-category') refreshSubCategoryDependencyState();
    });

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
    createSubCategory: createSubCategoryInline,
    createRasa: createRasaInline
  };

  init();
})(window);
