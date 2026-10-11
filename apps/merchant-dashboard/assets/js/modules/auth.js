/**
 * XENTRA OWNER DASHBOARD — AUTH & SESSION MODULE
 * Standalone modular controller for role-based UI, mobile account sheet/slider, and logout.
 */
(function (window, document) {
  'use strict';

  var S = window.XentraShared || {};
  var $ = S.$ || function (id) { return document.getElementById(id); };
  var TOKEN_KEY = S.TOKEN_KEY || 'xentra_merchant_token';
  var USER_KEY = S.USER_KEY || 'xentra_merchant_user';

  var getStoredUser = S.getStoredUser || function () {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  };

  var isBranchManager = (S && typeof S.isBranchManager === 'function' ? S.isBranchManager : null) ||
    function () {
      var u = (typeof getStoredUser === 'function' ? getStoredUser() : null);
      return !!(u && (u.role === 'branch_manager' || u.role === 'manager'));
    };

  var checkAuth = S.checkAuth || function () { return true; };
  var handleHandoffExchange = S.handleHandoffExchange || async function () {};
  var validateServerSession = S.validateServerSession || async function () { return true; };
  var enforceSurface = S.enforceSurface || function () {};

  function confirmFeatureAction(id, title, msg, btnText) {
    if (typeof window.confirmFeatureAction === 'function') {
      return window.confirmFeatureAction(id, title, msg, btnText);
    }
    return Promise.resolve(confirm(msg || 'Apakah Anda yakin?'));
  }

  /**
   * Hides/shows UI panels depending on the logged-in user's role.
   * - branch_manager → redirects to /merchant/
   * - cashier / kitchen → hides management tabs
   * - owner / brand_manager → displays full controls
   */
  function applyRoleBasedUI() {
    var user = getStoredUser();
    if (!user) return;

    var role = user.role;
    var isBM = role === 'branch_manager';

    // Catalog tab panels
    var ownerPanel = $('panel-owner-catalog');
    var branchPanel = $('panel-branch-catalog');
    if (ownerPanel) ownerPanel.style.display = isBM ? 'none' : '';
    if (branchPanel) branchPanel.style.display = isBM ? '' : 'none';

    if (isBM) {
      window.location.replace('/merchant/' + window.location.hash);
      return;
    } else {
      var isStaff = role === 'cashier' || role === 'kitchen';
      document.querySelectorAll('.x-nav-item').forEach(function (btn) {
        var target = btn.dataset.route || btn.dataset.tab;
        if (isStaff && (target === 'team' || target === 'settings' || target === 'branches' || target === 'customers' || target === 'marketing' || target === 'finance')) {
          btn.style.display = 'none';
        }
      });
    }

    // Marketing campaign builder button is exclusive to Owner
    var btnCreatePromo = $('btn-mkt-create-promo');
    if (btnCreatePromo) {
      btnCreatePromo.style.display = (role === 'owner') ? 'inline-flex' : 'none';
    }

    // Role-Aware Portal Label in sidebar badge
    var portalBadge = document.querySelector('.x-dash-badge-pro');
    if (portalBadge) {
      if (role === 'owner') {
        portalBadge.textContent = 'Owner Portal';
      } else if (role === 'brand_manager') {
        portalBadge.textContent = 'Brand Portal';
      } else if (role === 'branch_manager') {
        portalBadge.textContent = 'Branch Portal';
      } else if (role === 'cashier') {
        portalBadge.textContent = 'Cashier Portal';
      } else {
        portalBadge.textContent = (role ? role.replace(/_/g, ' ') : 'Merchant') + ' Portal';
      }
    }

    // Topbar brand badge: hide for branch_manager (redundant with sidebar), show for owner/brand_manager
    var topbarBrandBadge = $('topbar-brand-badge');
    if (topbarBrandBadge) {
      topbarBrandBadge.style.display = isBM ? 'none' : 'flex';
    }

    // Global search affordance: hide non-functional affordance to avoid misleading placeholder
    var searchBtn = $('btn-global-search');
    if (searchBtn) {
      searchBtn.style.display = 'none';
    }

    // Set branch context visibility and locking
    var branchSelectorWrap = $('x-branch-selector');
    var bmBranchBadge = $('dash-bm-branch-badge');
    var branchSelector = $('dash-branch-context');

    if (isBM) {
      if (branchSelectorWrap) branchSelectorWrap.style.display = 'none';
      if (bmBranchBadge) bmBranchBadge.style.display = 'flex';
      if (user.branch_id) {
        if (window.XentraOwnerBranchCatalog) {
          window.XentraOwnerBranchCatalog.state.branchId = user.branch_id;
        }
        if (window._branchContextState) {
          window._branchContextState.selected = user.branch_id;
        }
        if (branchSelector) {
          branchSelector.value = user.branch_id;
          branchSelector.disabled = true;
        }
      }
    } else if (role === 'cashier' || role === 'kitchen') {
      if (branchSelectorWrap) branchSelectorWrap.style.display = 'none';
      if (bmBranchBadge) bmBranchBadge.style.display = 'none';
      if (branchSelector) {
        branchSelector.disabled = true;
      }
    } else {
      // owner or brand_manager
      if (branchSelectorWrap) branchSelectorWrap.style.display = 'flex';
      if (bmBranchBadge) bmBranchBadge.style.display = 'none';
      if (branchSelector) {
        branchSelector.disabled = false;
      }
    }

    // Update user profile info in top bar
    var nameEl = $('dash-user-name');
    var roleEl = $('dash-user-role');
    var avatarEl = $('dash-user-avatar');
    var displayName = user.full_name || user.name || user.username || 'Pemilik Toko';
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = role === 'owner' ? 'Owner' : (role === 'brand_manager' ? 'Brand Manager' : 'Staff');
    if (avatarEl) {
      if (!avatarEl.querySelector('svg')) {
        avatarEl.innerHTML = '<svg class="x-topbar-user-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
      }
    }
  }

  async function handleLogout() {
    if (!await confirmFeatureAction('logout-dashboard', 'Keluar Dashboard', 'Apakah Anda ingin keluar dari Dashboard?', 'Keluar')) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (typeof window.checkAppRoute === 'function') {
      window.checkAppRoute();
    } else {
      window.location.href = '/login';
    }
  }

  function populateMobileAccount() {
    var user = (typeof getStoredUser === 'function' ? getStoredUser() : null) || {};
    var name = user.full_name || user.name || user.username || 'Pemilik Toko';
    var role = user.role === 'owner' ? 'Owner' : (user.role === 'brand_manager' ? 'Brand Manager' : 'Staff');
    var st = window.state || {};
    var brandName = (st.brand && st.brand.name) ? st.brand.name : 'Bangjo Resto';

    var nameEl = $('mobile-account-name');
    var roleEl = $('mobile-account-role');
    var emailEl = $('mobile-account-email');
    var brandEl = $('mobile-account-brand');
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;
    if (emailEl) emailEl.textContent = user.email || '-';
    if (brandEl) brandEl.textContent = brandName;
  }

  function closeMobileAccount() {
    var skipHistory = arguments[0];
    var page = $('x-mobile-account-page');
    if (page) {
      page.setAttribute('aria-hidden', 'true');
      page.style.transform = '';
      page.style.transition = '';
    }
    document.body.classList.remove('x-mobile-account-open');
    if (!skipHistory && window.history.state && window.history.state.mobileAccountOpen) {
      window.history.back();
    }
  }

  function openMobileAccount() {
    populateMobileAccount();
    var page = $('x-mobile-account-page');
    if (page) {
      page.setAttribute('aria-hidden', 'false');
      page.style.transform = '';
      page.style.transition = '';
    }
    document.body.classList.add('x-mobile-account-open');
    try {
      if (!window.history.state || !window.history.state.mobileAccountOpen) {
        window.history.pushState({ mobileAccountOpen: true }, '');
      }
    } catch (_) {}
  }

  function initMobileAccountSwipeBack() {
    var page = $('x-mobile-account-page');
    if (!page) return;

    var startX = 0;
    var startY = 0;
    var touchStartTime = 0;
    var isSwiping = false;
    var isHorizontalLocked = false;

    page.addEventListener('touchstart', function (e) {
      if (!document.body.classList.contains('x-mobile-account-open')) return;
      if (e.touches.length !== 1) return;

      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      touchStartTime = Date.now();
      isSwiping = false;
      isHorizontalLocked = false;
      page.style.transition = 'none';
    }, { passive: true });

    page.addEventListener('touchmove', function (e) {
      if (!document.body.classList.contains('x-mobile-account-open')) return;
      if (e.touches.length !== 1) return;

      var currentX = e.touches[0].clientX;
      var currentY = e.touches[0].clientY;
      var deltaX = currentX - startX;
      var deltaY = currentY - startY;

      if (!isHorizontalLocked) {
        if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
          isSwiping = false;
          return;
        }
        if (deltaX > 8 && deltaX > Math.abs(deltaY) * 1.1) {
          isHorizontalLocked = true;
          isSwiping = true;
        }
      }

      if (isSwiping && deltaX > 0) {
        if (e.cancelable) e.preventDefault();
        page.style.transform = 'translateX(' + deltaX + 'px)';
      }
    }, { passive: false });

    function handleTouchEnd(e) {
      if (!isSwiping) {
        page.style.transform = '';
        page.style.transition = '';
        return;
      }
      isSwiping = false;
      isHorizontalLocked = false;

      var endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : startX;
      var deltaX = endX - startX;
      var duration = Math.max(1, Date.now() - touchStartTime);
      var velocity = deltaX / duration;

      if (deltaX > 70 || (deltaX > 30 && velocity > 0.25)) {
        var layout = document.querySelector('.x-dash-layout');
        if (layout) layout.style.display = 'flex';
        var bottomNav = document.querySelector('.x-owner-bottom-nav');
        if (bottomNav) bottomNav.style.display = 'flex';

        page.style.transition = 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        page.style.transform = 'translateX(100%)';
        setTimeout(function () {
          if (layout) layout.style.display = '';
          if (bottomNav) bottomNav.style.display = '';
          closeMobileAccount();
        }, 200);
      } else {
        page.style.transition = 'transform 0.2s ease-out';
        page.style.transform = 'translateX(0px)';
        setTimeout(function () {
          page.style.transform = '';
          page.style.transition = '';
        }, 200);
      }
    }

    page.addEventListener('touchend', handleTouchEnd, { passive: true });
    page.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    window.addEventListener('popstate', function () {
      if (document.body.classList.contains('x-mobile-account-open')) {
        closeMobileAccount(true);
      }
    });
  }

  function initAuthListeners() {
    var btnLogout = $('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', handleLogout);
    }
    var btnMobileLogout = $('btn-mobile-account-logout');
    if (btnMobileLogout) {
      btnMobileLogout.addEventListener('click', handleLogout);
    }
    var btnBack = $('btn-mobile-account-back');
    if (btnBack) {
      btnBack.addEventListener('click', closeMobileAccount);
    }
    var profileBtn = $('dash-user-profile');
    if (profileBtn) {
      profileBtn.addEventListener('click', function (e) {
        if (e.target.closest('#btn-logout')) return;
        openMobileAccount();
      });
    }
    initMobileAccountSwipeBack();
  }

  var moduleApi = {
    applyRoleBasedUI: applyRoleBasedUI,
    handleLogout: handleLogout,
    populateMobileAccount: populateMobileAccount,
    openMobileAccount: openMobileAccount,
    closeMobileAccount: closeMobileAccount,
    initAuthListeners: initAuthListeners,
    getStoredUser: getStoredUser,
    isBranchManager: isBranchManager
  };

  window.XentraAuthModule = moduleApi;
  window.openMobileAccount = openMobileAccount;
  window.closeMobileAccount = closeMobileAccount;
  window.applyRoleBasedUI = applyRoleBasedUI;
  window.handleLogout = handleLogout;
  window.initAuthListeners = initAuthListeners;

})(window, document);
