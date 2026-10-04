(function (window) {
  'use strict';

  /*
   * XENTRA OWNER — MASTER MENU INLINE DEPENDENCY CREATION
   *
   * UX boundary:
   * - Item, Category, Judul and Rasa remain separate Master entities.
   * - Owner can create a missing dependency without leaving Menu Master.
   * - Creation immediately selects the newly-created entity in the current Menu draft.
   * - No legacy Product commercial fields are introduced.
   *
   * This controller is intentionally additive to the existing canonical Menu
   * editor in dashboard.js.
   */

  var API_BASE = (window.XentraShared && window.XentraShared.API_BASE) || '/api/v1';
  var shared = window.XentraShared || {};
  var createdItems = [];

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
      wrap.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
          fields.map(function(field, index) {
            return '<div data-inline-field-wrap="' + esc(field.name) + '">' +
              (field.kind === 'checkbox' ?
                '<label class="x-checkbox-label" style="display:flex;align-items:center;gap:8px;">' +
                  '<input id="' + id + '-field-' + index + '" type="checkbox"' + (field.checked ? ' checked' : '') + '>' +
                  '<span>' + esc(field.label || field.name) + '</span>' +
                '</label>' :
                '<label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;">' +
                  esc(field.label || field.name) + (field.required === false ? ' <span style="font-weight:400;color:#94a3b8;">(opsional)</span>' : ' <span style="color:#ef4444;">*</span>') +
                '</label>' +
                '<input id="' + id + '-field-' + index + '" class="x-input" type="' + esc(field.type || 'text') + '"' +
                  ' value="' + esc(field.value || '') + '"' +
                  ' placeholder="' + esc(field.placeholder || '') + '"' +
                  (field.required === false ? '' : ' required') +
                  (field.inputmode ? ' inputmode="' + esc(field.inputmode) + '"' : '') +
                '>') +
            '</div>';
          }).join('') +
          '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">' +
            '<button type="button" class="x-btn-secondary" data-inline-cancel>Batal</button>' +
            '<button type="button" class="x-btn-primary" data-inline-save>' + esc(options.saveLabel || 'Simpan') + '</button>' +
          '</div>' +
        '</div>';

      var done = false;
      function finish(result) {
        if (done) return;
        done = true;
        closeSheet(id);
        resolve(result);
      }

      wrap.querySelector('[data-inline-cancel]').addEventListener('click', function() {
        finish(null);
      });

      wrap.querySelector('[data-inline-save]').addEventListener('click', function() {
        var values = {};
        var invalid = false;
        fields.forEach(function(field, index) {
          var el = wrap.querySelector('#' + id + '-field-' + index);
          var value = field.kind === 'checkbox' ? !!(el && el.checked) : (el ? String(el.value || '').trim() : '');
          if (field.kind !== 'checkbox' && field.required !== false && !value) {
            invalid = true;
            if (el) el.focus();
          }
          values[field.name] = value;
        });
        if (invalid) {
          toast('❌ Lengkapi field yang wajib diisi.');
          return;
        }
        finish(values);
      });

      openSheet({
        id: id,
        type: 'bottom-sheet',
        title: options.title || 'Tambah',
        content: wrap.firstElementChild,
        dismissible: true,
        onClose: function() {
          if (!done) {
            done = true;
            resolve(null);
          }
        }
      });

      fields.forEach(function(field, index) {
        if (!field.showWhen) return;
        var sourceIndex = fields.findIndex(function(candidate) { return candidate.name === field.showWhen.field; });
        var source = sourceIndex >= 0 ? wrap.querySelector('#' + id + '-field-' + sourceIndex) : null;
        var target = wrap.querySelector('[data-inline-field-wrap="' + field.name + '"]');
        if (!source || !target) return;
        function syncVisibility() {
          var visible = source.type === 'checkbox' ? source.checked : String(source.value || '') === String(field.showWhen.equals);
          target.style.display = visible ? '' : 'none';
          if (!visible) {
            var input = wrap.querySelector('#' + id + '-field-' + index);
            if (input) input.value = '';
          }
        }
        source.addEventListener('change', syncVisibility);
        syncVisibility();
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

  async function createItemInline() {
    var result = await requestFieldsSheet({
      id: 'master-menu-inline-item',
      title: 'Buat Item',
      saveLabel: 'Simpan & Pilih Item',
      fields: [
        { name: 'name', label: 'Nama Item', placeholder: 'Contoh: Nasi', required: true },
        { name: 'stock_managed', label: 'Kelola di Stock', kind: 'checkbox', checked: false },
        { name: 'sku', label: 'SKU', placeholder: 'Contoh: NASI-001', required: false, showWhen: { field: 'stock_managed', equals: true } }
      ]
    });
    if (!result) return;
    if (result.stock_managed && !result.sku) {
      toast('❌ SKU wajib diisi jika Kelola di Stock dicentang.');
      return;
    }

    var data = await requestJson('/admin/composed/products', {
      method: 'POST',
      body: JSON.stringify({
        name: result.name,
        sku: result.stock_managed ? result.sku : null,
        is_active: true
      })
    });

    var item = data.product;
    createdItems.push(item);
    var label = item.name + (item.sku ? ' · SKU ' + item.sku : '');
    document.querySelectorAll('[data-cm-product], .cm-component-product').forEach(function(select) {
      if (select.options.length && !Array.from(select.options).some(function(o) { return String(o.value) === String(item.id); })) {
        addOption(select, item.id, label, false);
      }
    });
    toast('✅ Item dibuat dan tersedia di komposisi Menu.');
  }

  async function createCategoryInline() {
    var result = await requestFieldsSheet({
      id: 'master-menu-inline-category',
      title: 'Buat Kategori',
      saveLabel: 'Simpan & Pilih Kategori',
      fields: [
        { name: 'name', label: 'Nama Kategori', placeholder: 'Contoh: Makanan', required: true }
      ]
    });
    if (!result) return;

    var data = await requestJson('/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ name: result.name })
    });
    var category = data.category;
    addOption(document.getElementById('cm-category'), category.id, category.name, true);
    toast('✅ Kategori dibuat dan langsung dipilih.');
  }

  async function createRasaInline() {
    var result = await requestFieldsSheet({
      id: 'master-menu-inline-rasa',
      title: 'Buat Master Rasa',
      saveLabel: 'Simpan & Pilih Rasa',
      fields: [
        { name: 'name', label: 'Nama Rasa', placeholder: 'Contoh: Sambal Matah', required: true }
      ]
    });
    if (!result) return;

    var data = await requestJson('/admin/rasas', {
      method: 'POST',
      body: JSON.stringify({ name: result.name })
    });
    var rasa = data.rasa;

    var select = document.getElementById('cm-rasa');
    if (select) {
      addOption(select, rasa.id, rasa.name, true);
    }

    toast('✅ Rasa dibuat dan langsung dipilih.');
  }

  function addButtonAfter(target, config) {
    if (!target || !target.parentNode) return;
    if (document.querySelector('[data-inline-master-action="' + config.action + '"]')) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'x-btn-secondary';
    button.setAttribute('data-inline-master-action', config.action);
    button.textContent = '+ ' + config.label;
    button.style.cssText = 'white-space:nowrap;padding:8px 12px;font-size:12px;';
    button.addEventListener('click', function() {
      config.handler().catch(function(err) {
        console.error('[Master Menu Inline]', err);
        toast('❌ ' + (err.message || 'Gagal membuat data.'));
      });
    });

    if (config.wrap) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;';
      target.parentNode.insertBefore(wrap, target);
      wrap.appendChild(target);
      wrap.appendChild(button);
    } else {
      target.parentNode.insertBefore(button, target.nextSibling);
    }
  }

  function addButtonToFormGroup(selectId, action, label, handler) {
    var select = document.getElementById(selectId);
    if (!select) return;
    var group = select.closest('.x-form-group');
    if (!group || group.querySelector('[data-inline-master-action="' + action + '"]')) return;

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
    select.parentNode.insertBefore(row, select);
    row.appendChild(select);

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'x-btn-secondary';
    button.setAttribute('data-inline-master-action', action);
    button.textContent = '+ ' + label;
    button.style.cssText = 'white-space:nowrap;padding:8px 12px;font-size:12px;';
    button.addEventListener('click', function() {
      handler().catch(function(err) {
        console.error('[Master Menu Inline]', err);
        toast('❌ ' + (err.message || 'Gagal membuat data.'));
      });
    });
    row.appendChild(button);
  }

  function syncCreatedProductOptions() {
    document.querySelectorAll('[data-cm-product]').forEach(function(select) {
      createdItems.forEach(function(item) {
        var id = String(item.id || '');
        if (!id || Array.from(select.options).some(function(option) { return String(option.value) === id; })) return;
        addOption(select, id, item.name + (item.sku ? ' · SKU ' + item.sku : ''), false);
      });
    });
  }

  function injectQuickCreateControls() {
    addButtonToFormGroup('cm-product', 'item', 'Item', createItemInline);
    addButtonToFormGroup('cm-category', 'category', 'Kategori', createCategoryInline);
    addButtonToFormGroup('cm-rasa', 'rasa', 'Rasa', createRasaInline);
    syncCreatedProductOptions();

    var packageAdd = document.getElementById('btn-cm-add-component');
    if (packageAdd && !document.querySelector('[data-inline-master-action="package-product"]')) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'x-btn-secondary';
      button.setAttribute('data-inline-master-action', 'package-product');
      button.textContent = '+ Buat Item';
      button.style.cssText = 'margin-top:8px;padding:8px 12px;font-size:12px;';
      button.addEventListener('click', function() {
        createItemInline().catch(function(err) {
          console.error('[Master Menu Inline]', err);
          toast('❌ ' + (err.message || 'Gagal membuat Item.'));
        });
      });
      packageAdd.parentNode.appendChild(button);
    }
  }

  function enhanceMasterMenuEditor() {
    var form = document.getElementById('form-master-menu');
    if (!form) return;
    injectQuickCreateControls();

        var observer = new MutationObserver(function() {
      injectQuickCreateControls();
    });
    observer.observe(form, { subtree: true, childList: true });

    /*
     * Existing dashboard.js initializes the canonical editor and navigation.
     * This layer only adds dependency creation affordances; it never replaces
     * the save flow or changes Menu/Item ownership.
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
    createItem: createItemInline,
    createCategory: createCategoryInline,
    createRasa: createRasaInline
  };

  init();
})(window);
