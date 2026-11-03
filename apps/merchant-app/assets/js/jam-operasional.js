/**
 * XENTRA CORE — MERCHANT APP OPERATIONAL HOURS
 *
 * Branch Manager operational status panel & GoBiz-style weekly schedule configuration.
 */
(function () {
  'use strict';

  var S = window.XentraShared || {};
  var API_BASE = S.API_BASE || '/api/v1';
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var adminFetch = S.adminFetch || window.fetch;
  var getAuthHeaders = S.getAuthHeaders || function () { return {}; };
  var getStoredUser = S.getStoredUser || function () { return null; };
  var showToast = S.showToast || window.showToast || function (m) { alert(m); };

  var DAYS = [
    { key: 'monday', label: 'Senin', defaultOpen: '10:00', defaultClose: '22:00' },
    { key: 'tuesday', label: 'Selasa', defaultOpen: '10:00', defaultClose: '22:00' },
    { key: 'wednesday', label: 'Rabu', defaultOpen: '10:00', defaultClose: '22:00' },
    { key: 'thursday', label: 'Kamis', defaultOpen: '10:00', defaultClose: '22:00' },
    { key: 'friday', label: 'Jumat', defaultOpen: '10:00', defaultClose: '22:00' },
    { key: 'saturday', label: 'Sabtu', defaultOpen: '09:00', defaultClose: '23:00' },
    { key: 'sunday', label: 'Minggu', defaultOpen: '09:00', defaultClose: '23:00' }
  ];

  var _currentOperatingHours = null;

  function getDefaultOperatingHours() {
    var out = {};
    for (var i = 0; i < DAYS.length; i++) {
      var d = DAYS[i];
      out[d.key] = {
        is_open: true,
        open: d.defaultOpen,
        close: d.defaultClose,
        is_24_hours: false
      };
    }
    return out;
  }

  function parseOperatingHours(raw) {
    var def = getDefaultOperatingHours();
    if (!raw) return def;
    var parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return def;
      }
    }
    if (!parsed || typeof parsed !== 'object') return def;
    var out = {};
    for (var i = 0; i < DAYS.length; i++) {
      var k = DAYS[i].key;
      var cur = parsed[k];
      if (cur && typeof cur === 'object') {
        out[k] = {
          is_open: cur.is_open !== false && cur.is_open !== 0,
          open: cur.open || DAYS[i].defaultOpen,
          close: cur.close || DAYS[i].defaultClose,
          is_24_hours: cur.is_24_hours === true || cur.is_24_hours === 1
        };
      } else {
        out[k] = def[k];
      }
    }
    return out;
  }

  function renderJamScheduleList(hours) {
    var container = $('bm-jam-schedule-list');
    if (!container) return;
    var html = '';
    for (var i = 0; i < DAYS.length; i++) {
      var d = DAYS[i];
      var item = (hours && hours[d.key]) ? hours[d.key] : { is_open: true, open: d.defaultOpen, close: d.defaultClose, is_24_hours: false };
      var isLast = i === DAYS.length - 1;
      var borderStyle = isLast ? '' : 'border-bottom:1px solid #f1f5f9;';
      
      var statusHtml = '';
      if (!item.is_open) {
        statusHtml = '<span class="x-badge x-badge-danger" style="font-size:11px; padding:3px 8px; border-radius:6px; font-weight:700;">Tutup (Libur)</span>';
      } else if (item.is_24_hours) {
        statusHtml = '<span class="x-badge x-badge-success" style="font-size:11px; padding:3px 8px; border-radius:6px; font-weight:700;">Buka 24 Jam</span>';
      } else {
        statusHtml = '<span style="color:#0f172a; font-weight:700;">' + (item.open || d.defaultOpen) + ' – ' + (item.close || d.defaultClose) + ' WIB</span>';
      }

      html += '<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; ' + borderStyle + '">' +
        '<span style="font-weight:600; color:#334155;">' + d.label + '</span>' +
        statusHtml +
        '</div>';
    }
    container.innerHTML = html;
  }

  function renderJamEditorForm(hours) {
    var container = $('bm-jam-editor-form-list');
    if (!container) return;
    var activeHours = hours || _currentOperatingHours || getDefaultOperatingHours();
    var html = '';
    for (var i = 0; i < DAYS.length; i++) {
      var d = DAYS[i];
      var item = (activeHours && activeHours[d.key]) ? activeHours[d.key] : { is_open: true, open: d.defaultOpen, close: d.defaultClose, is_24_hours: false };
      var isOpen = item.is_open !== false;
      var is24h = item.is_24_hours === true;

      html += '<div class="x-jam-day-card" id="jam-card-' + d.key + '" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
          '<strong style="font-size:13.5px; color:#0f172a;">' + d.label + '</strong>' +
          '<label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:12.5px; font-weight:700; color:' + (isOpen ? '#059669' : '#dc2626') + ';" id="jam-label-status-' + d.key + '">' +
            '<input type="checkbox" id="jam-open-' + d.key + '" ' + (isOpen ? 'checked' : '') + ' onchange="onJamDayStatusChange(\'' + d.key + '\')" style="accent-color:#059669; width:16px; height:16px;">' +
            '<span>' + (isOpen ? 'Buka' : 'Libur (Tutup)') + '</span>' +
          '</label>' +
        '</div>' +
        '<div id="jam-times-wrap-' + d.key + '" style="' + (isOpen ? 'display:flex;' : 'display:none;') + ' flex-direction:column; gap:8px;">' +
          '<label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#64748b; cursor:pointer;">' +
            '<input type="checkbox" id="jam-24h-' + d.key + '" ' + (is24h ? 'checked' : '') + ' onchange="onJam24hChange(\'' + d.key + '\')" style="accent-color:#059669; width:15px; height:15px;">' +
            '<span>Buka 24 Jam Penuh</span>' +
          '</label>' +
          '<div id="jam-inputs-' + d.key + '" style="' + (is24h ? 'display:none;' : 'display:flex;') + ' align-items:center; gap:8px;">' +
            '<div style="flex:1;">' +
              '<span style="display:block; font-size:11px; color:#64748b; margin-bottom:3px;">Jam Buka</span>' +
              '<input type="time" id="jam-start-' + d.key + '" value="' + (item.open || d.defaultOpen) + '" class="x-input" style="width:100%; font-size:13px; padding:6px 8px; border-radius:8px;">' +
            '</div>' +
            '<span style="color:#94a3b8; font-weight:700; margin-top:14px;">–</span>' +
            '<div style="flex:1;">' +
              '<span style="display:block; font-size:11px; color:#64748b; margin-bottom:3px;">Jam Tutup</span>' +
              '<input type="time" id="jam-end-' + d.key + '" value="' + (item.close || d.defaultClose) + '" class="x-input" style="width:100%; font-size:13px; padding:6px 8px; border-radius:8px;">' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="jam-closed-msg-' + d.key + '" style="' + (isOpen ? 'display:none;' : 'display:block;') + ' color:#dc2626; font-size:12px; font-weight:600; padding:4px 0;">' +
          '🛑 Toko Libur / Tidak Beroperasi Pada Hari Ini' +
        '</div>' +
      '</div>';
    }
    container.innerHTML = html;
  }

  function onJamDayStatusChange(key) {
    var openCb = $('jam-open-' + key);
    var isOpen = openCb ? openCb.checked : true;
    var timesWrap = $('jam-times-wrap-' + key);
    var closedMsg = $('jam-closed-msg-' + key);
    var labelStatus = $('jam-label-status-' + key);
    if (timesWrap) timesWrap.style.display = isOpen ? 'flex' : 'none';
    if (closedMsg) closedMsg.style.display = isOpen ? 'none' : 'block';
    if (labelStatus) {
      labelStatus.style.color = isOpen ? '#059669' : '#dc2626';
      var span = labelStatus.querySelector('span');
      if (span) span.textContent = isOpen ? 'Buka' : 'Libur (Tutup)';
    }
  }

  function onJam24hChange(key) {
    var cb = $('jam-24h-' + key);
    var is24h = cb ? cb.checked : false;
    var inputs = $('jam-inputs-' + key);
    if (inputs) inputs.style.display = is24h ? 'none' : 'flex';
  }

  function applyJamToAllDays() {
    var mondayOpen = $('jam-open-monday') ? $('jam-open-monday').checked : true;
    var monday24h = $('jam-24h-monday') ? $('jam-24h-monday').checked : false;
    var mondayStart = $('jam-start-monday') ? $('jam-start-monday').value : '10:00';
    var mondayEnd = $('jam-end-monday') ? $('jam-end-monday').value : '22:00';

    for (var i = 1; i < DAYS.length; i++) {
      var k = DAYS[i].key;
      var openCb = $('jam-open-' + k);
      var cb24h = $('jam-24h-' + k);
      var startInput = $('jam-start-' + k);
      var endInput = $('jam-end-' + k);
      if (openCb) openCb.checked = mondayOpen;
      if (cb24h) cb24h.checked = monday24h;
      if (startInput) startInput.value = mondayStart;
      if (endInput) endInput.value = mondayEnd;
      onJamDayStatusChange(k);
      onJam24hChange(k);
    }
    if (typeof showToast === 'function') showToast('Jadwal Senin berhasil diterapkan ke semua hari!', 'info');
  }

  function applyJamToWeekdays() {
    var mondayOpen = $('jam-open-monday') ? $('jam-open-monday').checked : true;
    var monday24h = $('jam-24h-monday') ? $('jam-24h-monday').checked : false;
    var mondayStart = $('jam-start-monday') ? $('jam-start-monday').value : '10:00';
    var mondayEnd = $('jam-end-monday') ? $('jam-end-monday').value : '22:00';

    var weekdays = ['tuesday', 'wednesday', 'thursday', 'friday'];
    for (var i = 0; i < weekdays.length; i++) {
      var k = weekdays[i];
      var openCb = $('jam-open-' + k);
      var cb24h = $('jam-24h-' + k);
      var startInput = $('jam-start-' + k);
      var endInput = $('jam-end-' + k);
      if (openCb) openCb.checked = mondayOpen;
      if (cb24h) cb24h.checked = monday24h;
      if (startInput) startInput.value = mondayStart;
      if (endInput) endInput.value = mondayEnd;
      onJamDayStatusChange(k);
      onJam24hChange(k);
    }
    if (typeof showToast === 'function') showToast('Jadwal Senin berhasil diterapkan ke Senin–Jumat!', 'info');
  }

  function openBMJamEditorPage() {
    renderJamEditorForm(_currentOperatingHours);
    if (typeof navigateTo === 'function') {
      navigateTo('edit-jam-operasional');
    }
  }

  function openBMJamEditorModal() {
    openBMJamEditorPage();
  }

  function closeBMJamEditorModal() {
    if (typeof navigateBackFromSubpage === 'function') {
      navigateBackFromSubpage();
    } else if (typeof navigateTo === 'function') {
      navigateTo('jam-operasional');
    }
    var modal = $('modal-bm-edit-jam');
    if (modal) modal.style.display = 'none';
  }

  async function saveBMJamOperasional() {
    var user = getStoredUser();
    var branchId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
    if (!branchId) {
      if (typeof showToast === 'function') showToast('Cabang tidak valid.', 'error');
      return;
    }

    var schedule = {};
    for (var i = 0; i < DAYS.length; i++) {
      var k = DAYS[i].key;
      var openCb = $('jam-open-' + k);
      var cb24h = $('jam-24h-' + k);
      var startInput = $('jam-start-' + k);
      var endInput = $('jam-end-' + k);

      var isOpen = openCb ? openCb.checked : true;
      var is24h = cb24h ? cb24h.checked : false;
      var startVal = startInput ? startInput.value : DAYS[i].defaultOpen;
      var endVal = endInput ? endInput.value : DAYS[i].defaultClose;

      schedule[k] = {
        is_open: isOpen,
        is_24_hours: is24h,
        open: startVal || DAYS[i].defaultOpen,
        close: endVal || DAYS[i].defaultClose
      };
    }

    var saveBtn = $('btn-bm-save-jam');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Menyimpan...';
    }

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ operating_hours: schedule })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        _currentOperatingHours = schedule;
        renderJamScheduleList(schedule);
        if (typeof showToast === 'function') showToast('Jadwal operasional berhasil disimpan.', 'success');
        if (typeof navigateTo === 'function') {
          navigateTo('jam-operasional');
        } else {
          closeBMJamEditorModal();
        }
      } else {
        if (typeof showToast === 'function') showToast('Gagal menyimpan jadwal: ' + (data.error || 'Terjadi kesalahan'), 'error');
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast('Kesalahan jaringan.', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan Jadwal';
      }
    }
  }

  async function loadBMJamOperasional() {
    var user = getStoredUser();
    var branchId = (typeof window.getBMTargetBranchId === 'function' ? window.getBMTargetBranchId() : null) || (user ? (user.branch_id || user.branchId) : null);
    if (!branchId) return;

    try {
      var res = await adminFetch(API_BASE + '/admin/branches/' + encodeURIComponent(branchId), {
        headers: getAuthHeaders()
      });
      var data = await res.json();
      if (res.ok && data.success && data.branch) {
        var b = data.branch;
        var isOpen = b.is_open_override === 1 || b.is_open_override === true;
        var isDeliveryActive = b.is_delivery_active !== 0 && b.is_delivery_active !== false;

        var statusText = $('bm-jam-status-text');
        var toggleOpenBtn = $('btn-bm-jam-toggle-open');
        if (statusText) {
          statusText.innerHTML = isOpen
            ? '<span class="x-badge x-badge-success" style="font-size:11.5px; font-weight:700; padding:3px 10px; border-radius:6px;">BUKA</span>'
            : '<span class="x-badge x-badge-danger" style="font-size:11.5px; font-weight:700; padding:3px 10px; border-radius:6px;">TUTUP</span>';
        }
        if (toggleOpenBtn) {
          toggleOpenBtn.textContent = isOpen ? 'Tutup Toko' : 'Buka Toko';
          toggleOpenBtn.className = isOpen ? 'x-btn-secondary' : 'x-btn-primary';
        }

        var deliveryText = $('bm-jam-delivery-text');
        var toggleDeliveryBtn = $('btn-bm-jam-toggle-delivery');
        if (deliveryText) {
          deliveryText.innerHTML = isDeliveryActive
            ? '<span class="x-badge x-badge-success" style="font-size:11.5px; font-weight:700; padding:3px 10px; border-radius:6px;">AKTIF</span>'
            : '<span class="x-badge x-badge-warning" style="font-size:11.5px; font-weight:700; padding:3px 10px; border-radius:6px;">DIJEDA</span>';
        }
        if (toggleDeliveryBtn) {
          toggleDeliveryBtn.textContent = isDeliveryActive ? 'Jeda Pesanan Online' : 'Aktifkan Layanan Online';
          toggleDeliveryBtn.className = isDeliveryActive ? 'x-btn-secondary' : 'x-btn-primary';
        }

        _currentOperatingHours = parseOperatingHours(b.operating_hours);
        renderJamScheduleList(_currentOperatingHours);
      }
    } catch (err) {
      console.warn('[BM Jam Operasional Load Error]:', err);
    }
  }

  window.loadBMJamOperasional = loadBMJamOperasional;
  window.openBMJamEditorPage = openBMJamEditorPage;
  window.openBMJamEditorModal = openBMJamEditorModal;
  window.closeBMJamEditorModal = closeBMJamEditorModal;
  window.renderJamEditorForm = renderJamEditorForm;
  window.onJamDayStatusChange = onJamDayStatusChange;
  window.onJam24hChange = onJam24hChange;
  window.applyJamToAllDays = applyJamToAllDays;
  window.applyJamToWeekdays = applyJamToWeekdays;
  window.saveBMJamOperasional = saveBMJamOperasional;

})();
