/**
 * Xentra Home Page Controller
 * Orchestrates: Hero clock, carousel, category tabs, product grid, cart dock.
 * Pixel-perfect replication of production app.mybangjo.com home page.
 */
(function () {
  'use strict';
  if (window.__XENTRA_HOME_V2) return;
  window.__XENTRA_HOME_V2 = true;

  var API = window.Xentra.API;
  var Store = window.Xentra.Store;
  var UI = window.Xentra.UI;
  // M6: XentraMedia — canonical media delivery consumer
  var Media = (window.Xentra && window.Xentra.Media) || null;

  // ── State ──
  var categories = [];
  var products = [];
  var activeCategory = null;

  // ── P2 Fast Branch Discovery state ──
  // Home is DISCOVERY only: it presents nearby branches and records the
  // customer's branch context. It never resolves the authoritative fulfillment
  // branch (that happens at Checkout/Core with fresh validation).
  var branches = [];
  var branchListError = false;
  var activeBranch = null;          // customer-selected (or sole) branch context
  var discoveryOrigin = null;       // { latitude, longitude } discovery signal
  var gpsAttempted = false;         // GPS is a lightweight signal, tried at most once per load
  var DISCOVERY_CACHE_KEY = 'xentra_branches_cache';
  // ── P3 Product/Catalog ──
  // Stale-response guards: a branch-menu request (catalogLoadSeq) OR a
  // per-category product request (productLoadSeq) that arrives after a newer one
  // superseded it must never overwrite the visible state (branch identity held).
  // catalogBranchId is the branch the currently shown catalog belongs to
  // (null = brand-wide). It is used to keep category/product fallbacks branch-safe.
  var catalogLoadSeq = 0;
  var productLoadSeq = 0;
  var catalogBranchId = null;

  var ICONS = {
    minus: '/assets/icons/minus.svg',
    plus: '/assets/icons/plus.svg',
    cart: '/assets/icons/cart.svg',
    file: '/assets/icons/file.svg',
    write: '/assets/icons/write.svg',
    trash: '/assets/icons/trash.svg',
    bike: '/assets/icons/bike.svg',
    right: '/assets/icons/right1.svg',
    diskon: '/assets/icons/diskon.svg',
    coupon: '/assets/icons/coupon.svg'
  };

  // ── DOM cache ──
  var $ = function (id) { return document.getElementById(id); };

  // ======================================================================
  //  PWA INSTALL PROMO
  //  Home must expose the install incentive to anonymous browser guests.
  //  Eligibility stays authoritative on the Promotion Engine; we only render
  //  the banner when the server says the install incentive is discoverable.
  // ======================================================================
  function initInstallPromo() {
    var banner = $('x-pwa-banner');
    if (!banner) return;

    // Users whose promotion install requirement is satisfied (VERIFIED install:
    // appinstalled / standalone marker, never mere prompt acceptance) must not
    // see the acquisition banner. The marker is UI-only; entitlement and
    // redemption stay authoritative on the server.
    var requirementSatisfied = false;
    try {
      var pwaCtx = (window.Xentra && window.Xentra.PwaRuntime && window.Xentra.PwaRuntime.getPwaRuntimeContext)
        ? window.Xentra.PwaRuntime.getPwaRuntimeContext()
        : null;
      requirementSatisfied = Boolean(pwaCtx ? pwaCtx.install_requirement_satisfied : (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
    } catch (_) {}

    if (requirementSatisfied) {
      banner.classList.remove('x-pwa-banner-show');
      return;
    }

    // Hide the acquisition banner the moment the install completes, including
    // in this same browser tab (marker written by PwaRuntime on appinstalled,
    // which broadcasts the xentra:pwa-installed event).
    document.addEventListener('xentra:pwa-installed', function () {
      banner.classList.remove('x-pwa-banner-show');
    });

    // Dismissal is session-scoped, not an entitlement/identity flag.
    try {
      if (sessionStorage.getItem('xentra_install_promo_dismissed') === '1') return;
    } catch (_) {}

    var installBtn = $('x-pwa-install');
    var dismissBtn = $('x-pwa-dismiss');
    var titleEl = banner.querySelector('.x-pwa-banner-text strong');
    var subtitleEl = banner.querySelector('.x-pwa-banner-text span');

    if (dismissBtn && !dismissBtn.__xentraBound) {
      dismissBtn.__xentraBound = true;
      dismissBtn.addEventListener('click', function () {
        banner.classList.remove('x-pwa-banner-show');
        try { sessionStorage.setItem('xentra_install_promo_dismissed', '1'); } catch (_) {}
      });
    }

    // Do not require login/WhatsApp registration to discover this promo.
    API.get('/promotions/active?is_pwa=0&phone=')
      .then(function (res) {
        if (!res || !res.success) return;
        var promo = (Array.isArray(res.promotions) ? res.promotions : []).find(function (p) {
          return p && p.should_show_banner === true;
        });

        if (!promo || !promo.display) {
          banner.classList.remove('x-pwa-banner-show');
          return;
        }

        var display = promo.display;
        if (titleEl) titleEl.textContent = display.banner_title || 'Install & dapatkan promo spesial';
        if (subtitleEl) subtitleEl.textContent = display.banner_subtitle || 'Gratis untuk pesanan pertama • S&K berlaku';
        if (installBtn) installBtn.textContent = 'Install';

        banner.classList.add('x-pwa-banner-show');
      })
      .catch(function (err) {
        // Network/API failure must not fabricate an entitlement.
        banner.classList.remove('x-pwa-banner-show');
        console.warn('[Home] Install promo discovery warn:', err);
      });
  }

  // ======================================================================
  //  HERO CLOCK
  // ======================================================================
  var DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  function updateClock() {
    var now = new Date();
    var timeEl = $('x-hero-time');
    var dateEl = $('x-hero-date');
    if (timeEl) {
      timeEl.textContent = String(now.getHours()).padStart(2, '0') + '.' +
        String(now.getMinutes()).padStart(2, '0');
    }
    if (dateEl) {
      dateEl.textContent = DAYS[now.getDay()] + ', ' +
        now.getDate() + ' ' + MONTHS[now.getMonth()] + ' ' + now.getFullYear();
    }
  }

  // ======================================================================
  //  CAROUSEL BANNER (M6: dynamic banner rendering with canonical media)
  // ======================================================================

  /**
   * M6: Load banners from /brand/info and render canonical media slides.
   * First slide gets loading="eager" (above-the-fold); subsequent get lazy.
   * Falls back gracefully to whatever static slides exist in the HTML.
   * After rendering, re-initializes the carousel behavior.
   */
  function loadBanners() {
    var track = $('x-carousel-track');
    if (!track) return;

    API.get('/brand/info')
      .then(function (data) {
        var banners = data && data.brand && Array.isArray(data.brand.banners) ? data.brand.banners : [];
        if (!banners.length) {
          initCarousel();
          return;
        }

        // Clear static placeholder slides
        // Remove existing .x-carousel-slide elements (but preserve clones too)
        Array.from(track.querySelectorAll('.x-carousel-slide')).forEach(function (s) {
          s.parentNode && s.parentNode.removeChild(s);
        });

        // Render banner slides using canonical media
        banners.forEach(function (banner, idx) {
          var slide = document.createElement('div');
          slide.className = 'x-carousel-slide';

          var imgHtml = '';
          if (Media && typeof Media.buildBannerImg === 'function') {
            // First slide: eager (above the fold); rest: lazy
            imgHtml = Media.buildBannerImg(banner, idx === 0);
          } else {
            // Fallback if XentraMedia is unavailable
            var src = banner.image_url || banner.preview_url || '';
            if (src) {
              imgHtml = '<img src="' + src + '" alt="' + (banner.title || 'Promo') + '"' +
                (idx === 0 ? ' loading="eager"' : ' loading="lazy"') +
                ' style="width:100%;height:auto;border-radius:20px;display:block;">';
            }
          }

          if (imgHtml) {
            slide.innerHTML = imgHtml;
            track.appendChild(slide);
          }
        });

        // Re-initialize carousel with the new slides
        initCarousel();
      })
      .catch(function () {
        // Network failure: use whatever static slides are already in the DOM
        initCarousel();
      });
  }

  function initCarousel() {

    var track = $('x-carousel-track');
    var dots = $('x-carousel-dots');
    var container = track ? track.closest('.x-carousel-container') : null;
    if (!track || !dots) return;

    var slides = track.querySelectorAll('.x-carousel-slide');
    if (slides.length <= 1) {
      dots.style.display = 'none';
      return;
    }

    function setupInfiniteLoop() {
      // Clone first and last slides for seamless forward looping
      var originalSlides = Array.from(track.querySelectorAll('.x-carousel-slide'));
      var numOriginals = originalSlides.length;
      if (numOriginals <= 1) return;

      var firstClone = originalSlides[0].cloneNode(true);
      firstClone.classList.add('x-clone-slide');
      var lastClone = originalSlides[numOriginals - 1].cloneNode(true);
      lastClone.classList.add('x-clone-slide');

      track.insertBefore(lastClone, originalSlides[0]);
      track.appendChild(firstClone);

      var allSlides = track.querySelectorAll('.x-carousel-slide');
      var currentIndex = 1; // start at the first real slide

      // Set initial scroll position to the first real slide without animation
      function setInitialPosition() {
        if (!track || !allSlides[currentIndex]) return;
        var s = allSlides[currentIndex];
        track.scrollLeft = s.offsetLeft;
      }
      setTimeout(setInitialPosition, 50);

      // Create dot buttons only for original slides
      dots.innerHTML = '';
      for (var i = 0; i < numOriginals; i++) {
        var dot = document.createElement('button');
        dot.className = 'x-carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('data-slide', String(i));
        dot.onclick = (function (origIdx) {
          return function () {
            currentIndex = origIdx + 1;
            scrollToIndex(currentIndex, true);
            updateDots(origIdx);
          };
        })(i);
        dots.appendChild(dot);
      }

      function updateDots(realIdx) {
        var dotBtns = dots.querySelectorAll('.x-carousel-dot');
        dotBtns.forEach(function (d, j) {
          d.classList.toggle('active', j === realIdx);
        });
      }

      var isAnimating = false;
      function scrollToIndex(idx, smooth) {
        if (!allSlides[idx]) return;
        var s = allSlides[idx];
        track.scrollTo({
          left: s.offsetLeft,
          behavior: smooth ? 'smooth' : 'auto'
        });
      }

      // Handle continuous forward progression
      function nextSlide() {
        if (isAnimating || !isCarouselInViewport || isUserInteracting) return;
        currentIndex++;
        scrollToIndex(currentIndex, true);

        var realDotIdx = (currentIndex - 1) % numOriginals;
        if (realDotIdx < 0) realDotIdx += numOriginals;
        updateDots(realDotIdx);

        // When reaching the cloned first slide, seamlessly reset to real first slide
        if (currentIndex >= allSlides.length - 1) {
          isAnimating = true;
          setTimeout(function () {
            currentIndex = 1;
            scrollToIndex(currentIndex, false);
            isAnimating = false;
          }, 600); // 600ms corresponds to the smooth scroll duration
        }
      }

      // Track manual scroll snap
      var scrollEndTimer = null;
      track.addEventListener('scroll', function () {
        clearTimeout(scrollEndTimer);
        scrollEndTimer = setTimeout(function () {
          if (isAnimating) return;
          var curLeft = track.scrollLeft;
          var closestIdx = 1;
          var minDiff = Infinity;
          allSlides.forEach(function (s, idx) {
            var diff = Math.abs(s.offsetLeft - curLeft);
            if (diff < minDiff) {
              minDiff = diff;
              closestIdx = idx;
            }
          });

          currentIndex = closestIdx;
          if (currentIndex === 0) {
            // Snapped to last clone -> jump instantly to real last slide
            currentIndex = numOriginals;
            scrollToIndex(currentIndex, false);
          } else if (currentIndex === allSlides.length - 1) {
            // Snapped to first clone -> jump instantly to real first slide
            currentIndex = 1;
            scrollToIndex(currentIndex, false);
          }

          var realDotIdx = (currentIndex - 1) % numOriginals;
          if (realDotIdx < 0) realDotIdx += numOriginals;
          updateDots(realDotIdx);
        }, 120);
      }, { passive: true });

      // Auto-play state & viewport observer
      var isCarouselInViewport = true;
      var isUserInteracting = false;

      if ('IntersectionObserver' in window && container) {
        var vpObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            isCarouselInViewport = e.isIntersecting;
          });
        }, { threshold: 0.2 });
        vpObserver.observe(container);
      }

      // Pause autoplay when user interacts
      track.addEventListener('touchstart', function () { isUserInteracting = true; }, { passive: true });
      track.addEventListener('touchend', function () {
        setTimeout(function () { isUserInteracting = false; }, 3000);
      }, { passive: true });
      track.addEventListener('pointerenter', function () { isUserInteracting = true; });
      track.addEventListener('pointerleave', function () { isUserInteracting = false; });

      // Always slide to the left continuously (forward direction)
      setInterval(nextSlide, 4000);
    }

    setupInfiniteLoop();
  }

  // ======================================================================
  //  P2 FAST BRANCH DISCOVERY
  //  Home renders instantly, then resolves discovery in the background:
  //  cached branches first → destination context → cheap proximity ordering →
  //  fresh API data replaces it. No road routing, ETA, delivery-cost, payment,
  //  stock, eligibility, or acceptance calls are made from Home.
  // ======================================================================
  function branchContextOf(branch) {
    return {
      branch_id: (branch && branch.id) || null,
      branch_name: (branch && branch.name) || null
    };
  }

  function saveDiscoveryCache(list) {
    try { localStorage.setItem(DISCOVERY_CACHE_KEY, JSON.stringify(list)); } catch (_) {}
  }

  function readDiscoveryCache() {
    try {
      var raw = localStorage.getItem(DISCOVERY_CACHE_KEY);
      var list = raw ? JSON.parse(raw) : null;
      return Array.isArray(list) ? list : null;
    } catch (_) {
      return null;
    }
  }

  // Destination context REUSES the existing single location state (Store
  // `location`, entered through the Checkout address sheet). Lightweight GPS
  // (location.js) is only a discovery SIGNAL when no destination is saved —
  // never delivery authority.
  function setDiscoveryOrigin(origin) {
    if (!origin) return;
    var lat = Number(origin.latitude);
    var lng = Number(origin.longitude);
    if (isNaN(lat) || isNaN(lng)) return;
    discoveryOrigin = { latitude: lat, longitude: lng };
    if (branches.length) {
      branches = (window.Xentra.Discovery || {}).orderBranches
        ? window.Xentra.Discovery.orderBranches(branches, discoveryOrigin)
        : branches;
      renderBranchDiscovery();
    }
  }

  function resolveDiscoveryContext() {
    // 1. Reuse existing destination context (one canonical Active Destination state).
    var dest = null;
    try {
      dest = (Store.getActiveDestination && Store.getActiveDestination()) || Store.getState().activeDestination || Store.getState().location;
    } catch (_) {}
    if (dest && dest.latitude != null && dest.longitude != null) {
      setDiscoveryOrigin({ latitude: dest.latitude, longitude: dest.longitude });
      return;
    }

    // 2. Lightweight GPS as a discovery signal (non-blocking, once per load).
    // GPS must NOT silently overwrite an explicitly selected Active Destination.
    if (gpsAttempted) return;
    gpsAttempted = true;
    if (!window.XentraLocation || typeof window.XentraLocation.getCurrentPosition !== 'function') return;
    if (window.XentraLocation.canUpdateFromGps && !window.XentraLocation.canUpdateFromGps(dest)) return;

    window.XentraLocation.getCurrentPosition().then(function (pos) {
      if (pos && pos.lat != null && pos.lng != null) {
        setDiscoveryOrigin({ latitude: pos.lat, longitude: pos.lng });
      }
    }).catch(function () {
      // Permission denied / unavailable → keep server order, never fabricate distances.
    });
  }

  function applyBranchDiscovery(raw) {
    var list = Array.isArray(raw) ? raw : [];
    list = list.filter(function (b) {
      return b && b.id && b.is_active !== 0;
    });
    branches = (window.Xentra.Discovery || {}).orderBranches
      ? window.Xentra.Discovery.orderBranches(list, discoveryOrigin || undefined)
      : list;
    branchListError = false;

    if (branches.length === 1) {
      // Exactly 1 relevant Branch → hide the discovery UI and directly render
      // the catalog for that Branch context; preserve the context internally
      // for catalog/Cart/Checkout later authoritative validation (contract).
      setActiveBranch(branches[0], true);
    } else if (branches.length > 1) {
      // Re-confirm the previous selection is still present; otherwise require
      // an explicit selection (the first displayed Branch is NOT an
      // authoritative fulfillment Branch).
      if (activeBranch) {
        var freshActive = branches.find(function (b) { return String(b.id) === String(activeBranch.id); });
        if (freshActive) {
          activeBranch = freshActive;
          try { Store.setBranchContext(branchContextOf(activeBranch)); } catch (_) {}
        } else {
          activeBranch = null;
          try { Store.setBranchContext(null); } catch (_) {}
          // Active branch was deleted or deactivated, reload catalog in brand-wide scope
          loadCatalog(null);
        }
      }
      renderBranchDiscovery();
    } else {
      if (activeBranch) {
        activeBranch = null;
        try { Store.setBranchContext(null); } catch (_) {}
        loadCatalog(null);
      }
      renderBranchDiscovery();
    }
  }

  function setActiveBranch(branch, quiet) {
    activeBranch = branch || null;
    try { Store.setBranchContext(activeBranch ? branchContextOf(activeBranch) : null); } catch (_) {}
    // The catalog MUST follow the new context immediately: the previous branch's
    // categories/products are cleared (never a stale/mixed catalog under the new
    // selection) and an honest loading state is shown until its menu arrives.
    clearCatalogForBranch('Memuat menu cabang...');
    // P3: the catalog follows the customer-visible branch selection (the same
    // branchContext that gates cart provenance). The brand-wide menu stays until
    // the branch-scoped menu arrives; the selection is never silently re-scoped
    // by the client.
    // Task A: Update active card in-place (no DOM destroy/rebuild) to preserve
    // horizontal scroll position. Full render only when the branch list changes.
    updateBranchActiveState();
    loadCatalog(activeBranch ? activeBranch.id : null);
    if (activeBranch && !quiet && UI && typeof UI.toast === 'function') {
      UI.toast('Kamu memesan dari ' + activeBranch.name);
    }
  }

  function formatDistance(km) {
    if (km == null || isNaN(km)) return '';
    if (km < 1) {
      return Math.max(50, Math.round(km * 1000 / 50) * 50).toLocaleString('id-ID') + ' m';
    }
    return (km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)).replace('.', ',') + ' km';
  }

  function renderBranchDiscovery() {
    var container = $('x-branch-discovery');
    if (!container) return;

    // Task A: Save scroll position before DOM rebuild to prevent bounce on
    // horizontal carousels when branch list data changes.
    var scrollEl = container.querySelector('.x-branch-scroll');
    var savedScrollLeft = scrollEl ? scrollEl.scrollLeft : 0;

    if (!branches.length) {
      if (branchListError) {
        container.hidden = false;
        container.innerHTML =
          '<div class="x-branch-card x-branch-card-error">' +
          '  <div class="x-branch-empty-title">Cabang tidak dapat dimuat</div>' +
          '  <div class="x-branch-empty-sub">Coba lagi nanti. Kamu tetap bisa melihat menu di bawah.</div>' +
          '</div>';
      } else {
        container.hidden = true;
        container.innerHTML = '';
      }
      return;
    }

    if (branches.length === 1) {
      // Hide discovery section + heading; catalog already renders for the sole
      // Branch context (contract: exactly 1 Branch → no discovery UI).
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    container.hidden = false;

    var noLocationNote = (discoveryOrigin == null)
      ? '<div class="x-branch-loc-note">Aktifkan lokasimu untuk mengurutkan cabang terdekat.</div>'
      : '';

    var html =
      '<div class="x-branch-head">Cabang terdekat dari tempatmu</div>' +
      noLocationNote +
      // Horizontal carousel: Home discovery stays compact; the active card only
      // expresses "you are browsing this branch's menu", never fulfillment.
      '<div class="x-branch-scroll x-scroll-hide">';

    branches.forEach(function (b) {
      var isActive = activeBranch && String(activeBranch.id) === String(b.id);

      // Branch photo: no image column exists in any branch view-model; when the
      // contract supplies an image we render it, otherwise a data-derived initials
      // monogram placeholder (never a product/brand image as branch identity).
      var photoHtml = b.image_url
        ? '<img class="x-branch-card-photo-img" src="' + UI.escape(b.image_url) + '" alt="' + UI.escape(b.name || '') + '" loading="lazy">'
        : '<span class="x-branch-card-photo-mono">' + UI.escape(branchMonogram(b.name)) + '</span>';

      // Category preview is only available for the already-loaded branch menu
      // (per-branch categories are NOT part of the /brand/branches contract);
      // it mirrors the categories rendered on this page for the active branch.
      var catHtml = isActive ? branchCategoryPreviewHtml() : '';

      html +=
        '<button type="button" class="x-branch-card' + (isActive ? ' is-active' : '') + '" data-branch-id="' + UI.escape(String(b.id)) + '">' +
        '  <span class="x-branch-card-photo">' + photoHtml + '</span>' +
        '  <span class="x-branch-card-body">' +
        '    <span class="x-branch-card-name">' + UI.escape(b.name || '') + '</span>' +
        catHtml +
        branchPromoHtml(b) +
        '  </span>' +
        '</button>';
    });

    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('[data-branch-id]').forEach(function (btn) {
      btn.onclick = function () {
        var found = branches.find(function (b) { return String(b.id) === String(btn.dataset.branchId); });
        // Selection is silent: no confirmation toast, no address/phone surfacing.
        if (found) setActiveBranch(found, true);
      };
    });

    // Task A: Restore horizontal scroll position after DOM rebuild.
    var newScrollEl = container.querySelector('.x-branch-scroll');
    if (newScrollEl && savedScrollLeft) newScrollEl.scrollLeft = savedScrollLeft;
  }

  // Task A: Update branch card active state in-place without destroying/rebuilding
  // the entire DOM. This prevents horizontal scroll position reset when the user
  // clicks a card that is scrolled into view (e.g. Card 3/4/5).
  function updateBranchActiveState() {
    var container = $('x-branch-discovery');
    if (!container) return;
    var scrollEl = container.querySelector('.x-branch-scroll');
    var savedScrollLeft = scrollEl ? scrollEl.scrollLeft : 0;

    container.querySelectorAll('[data-branch-id]').forEach(function (btn) {
      var isActive = activeBranch && String(activeBranch.id) === String(btn.dataset.branchId);
      if (isActive) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
      // Update category preview on the active card
      var catEl = btn.querySelector('.x-branch-cats-text');
      if (isActive) {
        var catText = branchCategoryPreviewHtml();
        if (catEl) {
          catEl.innerHTML = catText ? catText.replace(/^<span class="x-branch-cats-text">/, '').replace(/<\/span>$/, '') : '';
        } else if (catText) {
          var bodyEl = btn.querySelector('.x-branch-card-body');
          if (bodyEl) {
            var nameEl = bodyEl.querySelector('.x-branch-card-name');
            if (nameEl && nameEl.nextSibling) {
              nameEl.insertAdjacentHTML('afterend', catText);
            } else {
              bodyEl.insertAdjacentHTML('afterbegin', catText);
            }
          }
        }
      } else if (catEl) {
        catEl.remove();
      }
    });

    // Restore horizontal scroll position after any DOM class mutations
    if (scrollEl) scrollEl.scrollLeft = savedScrollLeft;
  }

  function branchMonogram(name) {
    var clean = String(name || '').trim();
    if (!clean) return '?';
    var parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return clean.slice(0, 2).toUpperCase();
  }

  function branchCategoryPreviewHtml() {
    var list = categories || [];
    if (!list.length) return '';
    var text = list.map(function (c) { return UI.escape(String(c.name || '')); }).join(', ');
    return '<span class="x-branch-cats-text">' + text + '</span>';
  }

  function toRupiah(n) {
    return (UI && typeof UI.money === 'function') ? UI.money(n) : (Number(n).toLocaleString('id-ID') + ' IDR');
  }

  function branchPromoHtml(b) {
    // Promo lines render EXISTING configured settings only (branch_delivery_settings);
    // amounts/conditions come from the API payload, never hardcoded values.
    var html = '';
    if (b.free_delivery_km && b.free_delivery_km > 0) {
      html += '<span class="x-branch-promo">🛵 Gratis ongkir · Maks ' + formatDistance(b.free_delivery_km) + '</span>';
    }
    if (b.promo_delivery_discount && b.promo_delivery_discount > 0) {
      html += '<span class="x-branch-promo">💸 Diskon ongkir ' + toRupiah(b.promo_delivery_discount) +
        (b.promo_min_order && b.promo_min_order > 0 ? ' · Min. belanja ' + toRupiah(b.promo_min_order) : '') +
        '</span>';
    }
    return html;
  }

  function initBranchDiscovery() {
    // 1. Fast first paint from cached branch data when available.
    var cached = readDiscoveryCache();
    if (Array.isArray(cached) && cached.length) {
      applyBranchDiscovery(cached);
    }

    // 2. Lightweight, non-blocking destination context.
    resolveDiscoveryContext();

    // 3. Background refresh with authoritative branch data (cheap DB query).
    API.get('/brand/branches')
      .then(function (res) {
        if (res && res.success && Array.isArray(res.branches)) {
          saveDiscoveryCache(res.branches);
          applyBranchDiscovery(res.branches);
        } else if (!branches.length) {
          branchListError = true;
          renderBranchDiscovery();
        }
      })
      .catch(function (err) {
        console.warn('[Home] Branch discovery network warn:', err);
        if (!branches.length) {
          branchListError = true;
          renderBranchDiscovery();
        }
      });
  }

  function refreshDiscovery() {
    resolveDiscoveryContext();
    if (branches.length) renderBranchDiscovery();
  }

  // ======================================================================
  //  P3 CATALOG LOADING (brand-wide fast path + branch-scoped when context set)
  //  The branch list / selection only ever forwards the customer's branch id to
  //  the existing backend; availability/stock/pricing stay server-canonical.
  // ======================================================================

  // Clears all catalog state before a branch-context change. The previous
  // branch's categories/products must not linger under the new selection, and
  // in-flight per-category loads are invalidated so a late response cannot land
  // on the wrong branch. `loading` (optional) renders an honest state while the
  // brand-new branch menu is being fetched.
  function clearCatalogForBranch(loading) {
    categories = [];
    products = [];
    activeCategory = null;
    catalogBranchId = null;
    ++productLoadSeq; // in-flight per-category loads must never mix branches

    var track = $('x-cat-track');
    if (track) track.innerHTML = loading ? '<div class="x-loading">' + loading + '</div>' : '';
    var productsEl = $('x-products');
    if (productsEl) productsEl.innerHTML = loading ? '<div class="x-loading">' + loading + '</div>' : '';
  }

  // Honest empty branch: a branch menu that is empty (or failed to load) shows
  // an empty state — it is NEVER substituted with brand-wide or static products.
  function renderEmptyBranchCatalog() {
    clearCatalogForBranch(null);
    renderCategories();
    renderProducts();
    if (branches.length > 1) renderBranchDiscovery();
  }

  function applyCatalog(data) {
    if (!data || !Array.isArray(data.categories) || !data.categories.length) return;
    categories = data.categories;

    // Retain activeCategory if it still exists in the newly loaded categories
    var catExists = categories.some(function (c) { return String(c.id) === String(activeCategory); });
    if (!catExists) {
      activeCategory = categories[0].id;
    }

    var currentCatObj = categories.find(function (c) { return String(c.id) === String(activeCategory); }) || categories[0];
    products = (currentCatObj.products && currentCatObj.products.length > 0) ? currentCatObj.products : [];

    renderCategories();

    if (products.length > 0) {
      renderProducts();
    } else {
      loadProducts(activeCategory);
    }

    // Update the active branch card's category preview to mirror the freshly
    // loaded branch menu. Use in-place update (no DOM rebuild) to preserve
    // horizontal scroll position in the branch carousel.
    if (branches.length > 1) updateBranchActiveState();
  }

  function loadCatalog(branchId) {
    var seq = ++catalogLoadSeq;
    catalogBranchId = branchId ? String(branchId) : null;
    var path = branchId ? '/catalog/menu?branch_id=' + encodeURIComponent(branchId) : '/catalog/menu';

    API.get(path)
      .then(function (data) {
        if (seq !== catalogLoadSeq) return; // superseded by a newer catalog load
        if (data && data.success && data.categories && data.categories.length > 0) {
          // Only the brand-wide menu (no branch context) is cached; branch menus
          // are never cached so a cache key can never cross branch identities.
          if (!catalogBranchId) {
            try { localStorage.setItem('xentra_catalog_cache', JSON.stringify(data)); } catch (_) {}
          }
          applyCatalog(data);
          return;
        }
        // With a branch context, an empty/failed menu must be honest — a branch
        // whose menu has no data is never filled with brand-wide/static content.
        if (catalogBranchId) {
          renderEmptyBranchCatalog();
        } else if (!categories.length) {
          renderEmptyBranchCatalog();
        }
      })
      .catch(function (err) {
        if (seq !== catalogLoadSeq) return; // superseded by a newer catalog load
        console.warn('[Home] Load catalog network warn:', err);
        if (catalogBranchId) {
          renderEmptyBranchCatalog();
        } else if (!categories.length) {
          renderEmptyBranchCatalog();
        }
      });
  }

  // ======================================================================
  //  CATEGORIES
  // ======================================================================
  function renderCategories() {
    var track = $('x-cat-track');
    if (!track) return;
    track.innerHTML = '';

    if (!categories.length) {
      track.innerHTML = '<div class="x-empty">Kategori kosong.</div>';
      return;
    }

    if (!activeCategory && categories[0]) {
      activeCategory = categories[0].id;
    }

    categories.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'x-cat' + (String(cat.id) === String(activeCategory) ? ' active' : '');
      btn.setAttribute('data-cat-id', String(cat.id));

      // M6: prefer canonical derivative via XentraMedia, fall back to legacy
      var catImg = (Media && Media.resolveCategoryImg(cat)) || cat.image_url || cat.image || cat.icon_url || '';
      var monogram = UI.escape(branchMonogram(cat.name));
      var imgHtml = catImg
        ? '<img src="' + UI.escape(catImg) + '" alt="' + UI.escape(cat.name) + '"' +
          ' width="92" height="92" loading="lazy" decoding="async"' +
          ' onerror="this.onerror=null;this.parentElement.innerHTML=\'<span class=\\\\'x-cat-image-mono\\\\'>' + monogram + '</span>\';">'
        : '<span class="x-cat-image-mono">' + monogram + '</span>';

      btn.innerHTML =
        '<span class="x-cat-image">' + imgHtml + '</span>' +
        '<span class="x-cat-name">' + UI.escape(cat.name) + '</span>' +
        '<span class="x-cat-line"></span>';

      btn.onclick = function () {
        activeCategory = cat.id;
        track.querySelectorAll('.x-cat').forEach(function (el) { el.classList.remove('active'); });
        btn.classList.add('active');
        var targetLeft = btn.offsetLeft - (track.clientWidth - btn.clientWidth) / 2;
        track.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        loadProducts(activeCategory);
      };

      track.appendChild(btn);
    });
  }

  // ======================================================================
  //  PRODUCTS
  // ======================================================================
  function loadProducts(categoryId) {
    var container = $('x-products');
    if (!container) return;

    var found = categories.find(function (c) { return String(c.id) === String(categoryId); });
    if (found && Array.isArray(found.products) && found.products.length > 0) {
      products = found.products;
      renderProducts();
      return;
    }

    // Stale per-category responses are invalidated by every newer load AND by
    // every branch switch (clearCatalogForBranch), so a late response can never
    // overwrite a newer selection with old-branch data.
    var seq = ++productLoadSeq;
    container.innerHTML = '<div class="x-loading">Memuat menu...</div>';

    // When inside a branch context, the catalog was already loaded by
    // loadCatalog() and products[] should already be populated from
    // categories[].products. A per-category API call is only legitimate in
    // brand-wide mode. In branch context, if the catalog didn't carry products
    // for this category, show an honest empty state — never fall back to a
    // brand-wide or hardcoded product list.
    if (catalogBranchId) {
      if (seq !== productLoadSeq) return;
      products = [];
      if (found) found.products = [];
      renderProducts();
      return;
    }

    API.get('/products?category=' + encodeURIComponent(categoryId))
      .then(function (data) {
        if (seq !== productLoadSeq) return;
        if (data.success && Array.isArray(data.items) && data.items.length > 0) {
          products = data.items;
          if (found) found.products = products;
        } else {
          products = [];
        }
        renderProducts();
      })
      .catch(function () {
        if (seq !== productLoadSeq) return;
        products = [];
        renderProducts();
      });
  }

  function renderProducts() {
    var container = $('x-products');
    if (!container) return;
    container.innerHTML = '';

    if (!products.length) {
      container.innerHTML = '<div class="x-empty">Tidak ada menu di kategori ini.</div>';
      return;
    }

    var state = Store.getState();

    products.forEach(function (product) {
      var item = Store.findCartItem(product.id, activeBranch ? String(activeBranch.id) : undefined);
      var qty = item ? item.quantity : 0;
      var note = (item && item.note) || state.notes[product.id] || '';

      var price = Number(product.price || 0);
      var regPrice = Number(product.regular_price || price);
      var desc = product.description || '';

      // P3: branch-level availability is a SERVER-computed flag (is_available is
      // only present on branch-scoped menus). The client merely presents it.
      var unavailable = !!activeBranch && product.is_available === false;

      var card = document.createElement('article');
      card.className = 'x-product' + (unavailable ? ' x-product-unavailable' : '');
      card.setAttribute('data-product-card', String(product.id));
      card.onclick = function () { openProductDetail(product); };

      var oldPriceHtml = regPrice > price
        ? '<div class="x-old-price">' + UI.money(regPrice) + '</div>'
        : '';

      var unavailableTag = unavailable
        ? '<div class="x-unavailable-tag">Habis</div>'
        : '';

      var controls = '';
      if (qty > 0) {
        var noteIcon = note ? ICONS.write : ICONS.file;
        controls =
          '<div class="x-quantity">' +
          '  <button type="button" data-minus="' + product.id + '"><img src="' + ICONS.minus + '" alt="minus"></button>' +
          '  <span class="x-quantity-value">' + qty + '</span>' +
          '  <button type="button" data-plus="' + product.id + '"><img src="' + ICONS.plus + '" alt="plus"></button>' +
          '</div>' +
          '<button type="button" class="x-note-button ' + (note ? 'has-note' : '') + '" data-note="' + product.id + '">' +
          '  <img src="' + noteIcon + '" alt="Catatan" class="x-note-icon">' +
          '  Catatan' +
          '</button>';
      } else if (unavailable) {
        controls = '<span class="x-unavailable-label">Habis</span>';
      } else {
        controls = '<button type="button" class="x-add" data-add="' + product.id + '">Tambah</button>';
      }

      // M6: Use XentraMedia for canonical image delivery (derivative, not original).
      // buildProductImg generates srcset + sizes + fixed width/height for layout stability.
      // Falls back to legacy image_url if no canonical media exists.
      var imgHtml = '';
      if (Media && typeof Media.buildProductImg === 'function') {
        imgHtml = Media.buildProductImg(product, { lazy: true });
      } else {
        var image = product.image_url || product.image || '';
        if (image) {
          imgHtml = '<img class="x-product-image" src="' + UI.escape(image) + '"' +
            ' alt="' + UI.escape(product.name) + '" width="105" height="105" loading="lazy" decoding="async">';
        }
      }

      card.innerHTML =
        '<div class="x-product-info">' +
        '  <div class="x-product-name">' + UI.escape(product.name) + '</div>' +
        '  <div class="x-product-description">' + UI.escape(desc) + '</div>' +
        unavailableTag +
        '  <div class="x-price">' + oldPriceHtml +
        '    <div class="x-current-price">' + UI.money(price) + '</div>' +
        '  </div>' +
        '</div>' +
        '<div class="x-product-right">' +
        imgHtml +
        controls +
        '</div>';

      container.appendChild(card);
    });

    bindProductEvents();
  }


  // Scroll presisi berbasis card: hanya scroll jika bagian bawah card tertutup/terpotong oleh cart bar
  function ensureCardVisible(productId) {
    setTimeout(function () {
      var cardEl = document.querySelector('[data-product-card="' + productId + '"]');
      if (!cardEl) return;

      var dock = $('x-cart-dock');
      var dockTop = window.innerHeight;
      if (dock) {
        var dockRect = dock.getBoundingClientRect();
        if (dockRect.top > 0 && dockRect.top < window.innerHeight) {
          dockTop = dockRect.top;
        } else {
          dockTop = window.innerHeight - 84;
        }
      }

      var cardRect = cardEl.getBoundingClientRect();
      var margin = 16;
      var requiredBottom = cardRect.bottom + margin;

      if (requiredBottom > dockTop) {
        var scrollAmount = requiredBottom - dockTop;
        window.scrollBy({
          top: scrollAmount,
          behavior: 'smooth'
        });
      }
    }, 60);
  }

  function bindProductEvents() {
    document.querySelectorAll('[data-add]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var pid = btn.dataset.add;
        var p = products.find(function (x) { return String(x.id) === String(pid); });
        if (p) {
          Store.addItem(p, 1, activeBranch ? branchContextOf(activeBranch) : undefined);
          ensureCardVisible(pid);
        }
      };
    });

    document.querySelectorAll('[data-plus]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var pid = btn.dataset.plus;
        var item = Store.findCartItem(pid, activeBranch ? String(activeBranch.id) : undefined);
        if (item) {
          Store.setQty(pid, item.quantity + 1, item.branch_id == null ? null : item.branch_id);
          ensureCardVisible(pid);
        }
      };
    });

    document.querySelectorAll('[data-minus]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var pid = btn.dataset.minus;
        var item = Store.findCartItem(pid, activeBranch ? String(activeBranch.id) : undefined);
        if (item) {
          Store.setQty(pid, item.quantity - 1, item.branch_id == null ? null : item.branch_id);
        }
      };
    });

    document.querySelectorAll('[data-note]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        openNote(btn.dataset.note);
      };
    });
  }

  // ======================================================================
  //  NOTE SHEET (Dynamic makeOverlay execution + Compact Height + Green Simpan)
  // ======================================================================
  function openNote(productId) {
    var numId = Number(productId);
    var item = Store.findCartItem(numId);
    var curNote = (item && item.note) || Store.getState().notes[numId] || '';

    var overlay = document.createElement('div');
    overlay.className = 'x-overlay x-note-overlay';
    overlay.innerHTML =
      '<div class="x-sheet x-note-sheet" style="height:min(52dvh, 360px) !important;max-height:52dvh !important;display:flex !important;flex-direction:column;">' +
      '  <div class="x-note-handle"></div>' +
      '  <div class="x-note-header">' +
      '    <h3 style="margin:0;font-size:16px;font-weight:700;color:#111;">Tambah catatan untuk pembelian</h3>' +
      '  </div>' +
      '  <textarea id="x-note-input" maxlength="200" placeholder="Tambahkan catatan..." style="flex:1 1 auto;width:100%;min-height:0;padding:12px 0;border:0;outline:0;resize:none;background:transparent;color:#333;font-family:inherit;font-size:14px;line-height:21px;">' + UI.escape(curNote) + '</textarea>' +
      '  <div class="x-note-footer" style="display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid #dedede;flex:0 0 auto;">' +
      '    <span id="x-note-counter" style="font-size:12px;color:#777;">' + curNote.length + '/200</span>' +
      '    <button id="x-note-save" type="button" style="width:86px;height:34px;border:0;border-radius:18px;background:#b6ff00;color:#111;font-size:13px;font-weight:600;cursor:pointer;">Simpan</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);

    var sheet = overlay.querySelector('.x-note-sheet');
    var input = overlay.querySelector('#x-note-input');
    var counter = overlay.querySelector('#x-note-counter');
    var saveBtn = overlay.querySelector('#x-note-save');

    if (input && counter) {
      input.addEventListener('input', function () {
        counter.textContent = input.value.length + '/200';
      });
    }

    void overlay.offsetHeight;
    requestAnimationFrame(function () {
      overlay.classList.add('open');
    });

    setTimeout(function () {
      if (input) input.focus();
    }, 350);

    var isClosing = false;
    function close() {
      if (isClosing) return;
      isClosing = true;
      if (input) input.blur();
      overlay.classList.remove('open');
      setTimeout(function () {
        if (overlay.parentNode) overlay.remove();
      }, 380);
    }

    if (window.XentraNav && typeof window.XentraNav.pushClose === 'function') {
      window.XentraNav.pushClose(close);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        if (window.XentraNav && typeof window.XentraNav.close === 'function') {
          window.XentraNav.close();
        } else {
          close();
        }
      }
    });

    if (saveBtn) {
      saveBtn.onclick = function () {
        var noteVal = (input ? input.value : '').trim();
        Store.setNote(numId, noteVal);
        if (window.XentraNav && typeof window.XentraNav.close === 'function') {
          window.XentraNav.close();
        } else {
          close();
        }
        renderProducts();
      };
    }
  }
  var openNoteSheet = openNote;

  // ======================================================================
  //  P3 PRODUCT DETAIL SHEET
  //  Bottom-sheet presentation of product identity + the ACTIVE branch context.
  //  It only ever re-uses the existing store's add-to-cart path (same
  //  provenance rules); it never resolves fulfillment/eligibility/payment and
  //  never creates an order or a fulfillment_branch_id from this page. Close
  //  is registered on the shared navigation stack so Back closes it first
  //  (same contract as the note sheet).
  // ======================================================================
  function openProductDetail(product) {
    if (!product || !product.id) return;

    var branchCtx = activeBranch ? branchContextOf(activeBranch) : null;
    var unavailable = !!activeBranch && product.is_available === false;
    var price = Number(product.price || 0);
    var regPrice = Number(product.regular_price || price);
    // M6: Resolve best image for the detail view (200px tall, full-width).
    // For the detail sheet we want at least 640px wide (md quality) for crisp display.
    var imgHtml = '';
    var detailImgSrc = '';
    if (Media && typeof Media.resolveProductImg === 'function') {
      // Temporarily scale up requested size for detail view (200px height → need wider derivative)
      var detailVariants = product.srcset_variants;
      if (Array.isArray(detailVariants) && detailVariants.length > 0) {
        var detailV = Media.selectVariant(detailVariants, 640, 'square');
        if (detailV) detailImgSrc = detailV.url;
      }
      if (!detailImgSrc) detailImgSrc = Media.resolveProductImg(product);
    }
    if (!detailImgSrc) detailImgSrc = product.image_url || product.image || '';

    if (detailImgSrc) {
      imgHtml = '<div class="x-detail-image-wrap"><img src="' + UI.escape(detailImgSrc) + '" alt="' + UI.escape(product.name) + '" loading="eager" decoding="async"></div>';
    }

    var scopedQty = 0;
    try {
      if (branchCtx) {
        scopedQty = Store.getCartItemsForBranch(branchCtx.branch_id)
          .filter(function (i) { return String(i.id) === String(product.id); })
          .reduce(function (sum, i) { return sum + Number(i.quantity || 0); }, 0);
      } else {
        var existing = Store.findCartItem(product.id);
        scopedQty = existing ? Number(existing.quantity || 0) : 0;
      }
    } catch (_) {}

    var oldPriceHtml = regPrice > price
      ? '<span class="x-detail-old-price">' + UI.money(regPrice) + '</span>'
      : '';
    var availabilityHtml = unavailable
      ? '<div class="x-unavailable-tag">Habis</div>'
      : '';
    var branchLabelHtml = branchCtx
      ? '<div class="x-detail-branch">' + UI.escape(branchCtx.branch_name || '') + '</div>'
      : '';
    var cartHint = scopedQty > 0
      ? '<div class="x-detail-cart-hint">Sudah ada <strong>' + scopedQty + '</strong> di keranjang untuk cabang ini.</div>'
      : '';


    var overlay = document.createElement('div');
    overlay.className = 'x-overlay x-note-overlay x-detail-overlay';
    overlay.innerHTML =
      '<div class="x-sheet x-note-sheet x-detail-sheet">' +
      '  <div class="x-note-handle"></div>' +
      '  <button type="button" class="x-detail-close" aria-label="Tutup">&times;</button>' +
      imgHtml +
      '  <div class="x-detail-body">' +
      '    <h3 class="x-detail-name">' + UI.escape(product.name) + '</h3>' +
      branchLabelHtml +
      '    <div class="x-detail-desc">' + UI.escape(product.description || '') + '</div>' +
      availabilityHtml +
      '    <div class="x-detail-price">' + oldPriceHtml + '<span class="x-detail-current">' + UI.money(price) + '</span></div>' +
      '    <div class="x-detail-add-area">' +
      (unavailable
        ? '<button type="button" class="x-detail-add" disabled>Habis</button>'
        : '<button type="button" class="x-detail-add">' + (scopedQty > 0 ? 'Tambah lagi' : 'Masukkan ke keranjang') + '</button>') +
      cartHint +
      '    </div>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);
    void overlay.offsetHeight;
    requestAnimationFrame(function () {
      overlay.classList.add('open');
    });

    var isClosing = false;
    function close() {
      if (isClosing) return;
      isClosing = true;
      overlay.classList.remove('open');
      setTimeout(function () {
        if (overlay.parentNode) overlay.remove();
      }, 380);
    }

    if (window.XentraNav && typeof window.XentraNav.pushClose === 'function') {
      window.XentraNav.pushClose(close);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        if (window.XentraNav && typeof window.XentraNav.close === 'function') {
          window.XentraNav.close();
        } else {
          close();
        }
      }
    });

    var closeBtn = overlay.querySelector('.x-detail-close');
    if (closeBtn) closeBtn.onclick = function () {
      if (window.XentraNav && typeof window.XentraNav.close === 'function') {
        window.XentraNav.close();
      } else {
        close();
      }
    };

    var addBtn = overlay.querySelector('.x-detail-add');
    if (addBtn && !addBtn.disabled) {
      addBtn.onclick = function () {
        Store.addItem(product, 1, branchCtx || undefined);
        if (window.XentraNav && typeof window.XentraNav.close === 'function') {
          window.XentraNav.close();
        } else {
          close();
        }
        if (UI && typeof UI.toast === 'function') {
          UI.toast('Ditambahkan ke keranjang');
        }
      };
    }
  }

  // ======================================================================
  //  CART DOCK
  // ======================================================================
  function renderCartDock() {
    var count = Store.getCartCount();
    var total = Store.getCartSubtotal();
    var dock = $('x-cart-dock');
    if (!dock) return;

    if (count <= 0) {
      dock.classList.remove('visible');
      return;
    }

    dock.classList.add('visible');

    var countEl = $('x-cart-count');
    var totalEl = $('x-cart-total');
    var badgeEl = $('x-cart-badge');

    // R1 CART SHEET: >1 branch scopes → the dock labels the multi-branch state
    // (N Pesanan · dari N cabang) and its CTA routes through the Branch Order
    // Switcher instead of a (rejected, mixed-scope) merged #checkout.
    var groups = Store.getCartBranchGroups();
    var multi = groups.length > 1;

    if (countEl) countEl.textContent = multi ? groups.length + ' Pesanan' : count + ' Item';
    if (totalEl) totalEl.textContent = UI.money(total).replace('Rp', '');
    if (badgeEl) {
      badgeEl.textContent = count;
      badgeEl.style.display = count > 0 ? 'flex' : 'none';
    }

    var dockSub = countEl && countEl.parentNode ? countEl.parentNode.querySelector('span') : null;
    if (dockSub) dockSub.textContent = multi ? 'dari ' + groups.length + ' cabang' : 'Lihat pesanan kamu';

    if ($('x-promo-icon-img')) {
      $('x-promo-icon-img').src = ICONS.coupon;
    }

    // Promo bar
    var promoState = Store.getState().promo;
    var promoEl = $('x-promo');
    if (promoEl) {
      if (promoState.enabled && promoState.target > 0) {
        promoEl.style.display = '';
        var fill = $('x-progress-fill');
        var text = $('x-promo-text');
        if (fill) fill.style.width = Math.min(100, total / promoState.target * 100) + '%';
        if (text) {
          text.innerHTML = total < promoState.target
            ? 'Tambah <strong>' + UI.money(promoState.target - total) + '</strong> lagi biar diskon <strong>' + UI.money(promoState.discount) + '</strong>!'
            : '🎉 Selamat, kamu berhasil dapatkan diskon!';
        }
      } else {
        promoEl.style.display = 'none';
      }
    }
  }

  // ======================================================================
  //  CART SHEET (Bottom Sheet with item list)
  // ======================================================================
  // R1 CART SHEET back-navigation: the sheet registers a stack close so browser
  // back closes the topmost overlay (cart sheet first, then the page). The flag
  // prevents duplicate stack entries across repeated opens.
  var sheetNavRegistered = false;

  function openCartSheet() {
    var backdrop = $('x-backdrop');
    var sheet = $('x-sheet');
    if (backdrop) backdrop.classList.add('open');
    if (sheet) sheet.classList.add('open');
    if (!sheetNavRegistered && window.XentraNav && typeof window.XentraNav.pushClose === 'function') {
      sheetNavRegistered = true;
      window.XentraNav.pushClose(closeSheet);
    }
    renderCartSheetItems();
  }

  function closeSheet() {
    sheetNavRegistered = false;
    var backdrop = $('x-backdrop');
    var sheet = $('x-sheet');
    if (backdrop) backdrop.classList.remove('open');
    if (sheet) sheet.classList.remove('open');
  }

  function branchLabel(group, index) {
    if (group && group.branch_name) return String(group.branch_name);
    return 'Pesanan ' + (index + 1);
  }

  // R1 CART SHEET grouping: a single branch scope keeps the flat list +
  // Ringkasan Pesanan + single checkout CTA (existing single-branch flow). More
  // than one branch scope renders one section per branch separated by a subtle
  // 1px divider, with NO global summary and NO merged checkout CTA — each
  // branch checks out independently via the Branch Order Switcher.
  function renderCartSheetItems() {
    var container = $('x-sheet-items');
    if (!container) return;
    container.innerHTML = '';

    var state = Store.getState();
    var groups = Store.getCartBranchGroups();

    if (!groups.length) {
      container.innerHTML = '<div class="x-empty">Keranjang kosong.</div>';
      setSheetSummaryVisible(false);
      setMultiCta(false);
      return;
    }

    var multi = groups.length > 1;

    groups.forEach(function (group, gi) {
      if (gi > 0) {
        var divider = document.createElement('div');
        divider.className = 'x-sheet-group-divider';
        container.appendChild(divider);
      }

      if (multi) {
        var heading = document.createElement('div');
        heading.className = 'x-sheet-branch';
        var gcount = group.items.reduce(function (s, it) { return s + Number(it.quantity || 0); }, 0);
        heading.innerHTML =
          '<span class="x-sheet-branch-name">' + UI.escape(branchLabel(group, gi)) + '</span>' +
          '<span class="x-sheet-branch-count">' + gcount + ' item</span>';
        container.appendChild(heading);
      }

      group.items.forEach(function (item) {
        container.appendChild(buildSheetItemRow(item, state));
      });
    });

    if (multi) {
      setSheetSummaryVisible(false);
      setMultiCta(true);
    } else {
      renderCartSummary();
      setSheetSummaryVisible(true);
      setMultiCta(false);
    }

    bindSheetItemEvents(container);
  }

  function buildSheetItemRow(item, state) {
    var note = state.notes[item.id] || item.note || '';
    var lineTotal = Number(item.price || 0) * Number(item.quantity || 0);

    var row = document.createElement('div');
    row.className = 'x-sheet-item';

    var image = item.image_url || item.image || '';
    var noteHtml = note
      ? '<div class="x-sheet-item-note" data-edit-note="' + item.id + '"><img src="' + ICONS.write + '" alt="Edit catatan"><span>: ' + UI.escape(note) + '</span></div>'
      : '';

    row.innerHTML =
      '<div class="x-sheet-item-main">' +
      (image
        ? '<img class="x-sheet-item-image" src="' + UI.escape(image) + '" alt="' + UI.escape(item.name) + '">'
        : '<div class="x-sheet-item-image"></div>') +
      '  <div class="x-sheet-item-body">' +
      '    <div class="x-sheet-item-name">' + UI.escape(item.name) + '</div>' +
      noteHtml +
      '    <div class="x-sheet-item-qty-price">' + item.quantity + ' × ' + UI.money(item.price) + '</div>' +
      '  </div>' +
      '  <button type="button" class="x-sheet-item-delete" data-delete="' + item.id + '" data-delete-branch="' + (item.branch_id || '') + '" aria-label="Hapus ' + UI.escape(item.name) + '">' +
      '    <img src="' + ICONS.trash + '" alt="Hapus">' +
      '  </button>' +
      '</div>' +
      '<div class="x-sheet-item-footer" data-checkout-single-item="' + item.id + '" role="button" aria-label="Beli ' + UI.escape(item.name) + ' sekarang">' +
      '  <div class="x-sheet-item-footer-left">' +
      '    <img class="x-bike-icon" src="' + ICONS.bike + '" alt="">' +
      '    <span>' + item.quantity + ' item</span>' +
      '  </div>' +
      '  <div class="x-sheet-item-footer-right">' +
      '    <strong>' + UI.money(lineTotal).replace('Rp', '') + '</strong>' +
      '    <img class="x-arrow-icon" src="' + ICONS.right + '" alt=">">' +
      '  </div>' +
      '</div>';

    return row;
  }

  function bindSheetItemEvents(container) {
    // Bind delete buttons (branch-scoped: a row only ever removes its own branch
    // scope's line, never the same SKU in another branch section)
    container.querySelectorAll('[data-delete]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var branchId = btn.dataset.deleteBranch || null;
        Store.removeCartItem(btn.dataset.delete, branchId);
        if (Store.getCartCount() <= 0) closeSheet();
      };
    });

    // Bind note edit
    container.querySelectorAll('[data-edit-note]').forEach(function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        closeSheet();
        setTimeout(function () { openNoteSheet(el.dataset.editNote); }, 400);
      };
    });

    // Bind single-item checkout clicks on the footer (icon motor -> arrow)
    container.querySelectorAll('[data-checkout-single-item]').forEach(function (footerEl) {
      footerEl.onclick = function () {
        var pid = footerEl.dataset.checkoutSingleItem;
        closeSheet();
        if (window.Xentra && window.Xentra.Router) {
          window.Xentra.Router.navigate('checkout', { itemId: pid });
        } else {
          window.location.href = '/checkout/?item=' + encodeURIComponent(pid);
        }
      };
    });
  }

  function setSheetSummaryVisible(show) {
    var totalEl = document.querySelector('.x-sheet-total');
    if (totalEl) totalEl.style.display = show ? '' : 'none';
    var btn = $('x-sheet-checkout');
    if (btn) btn.style.display = show ? '' : 'none';
  }

  // R1 multi-branch bottom CTA inside the sheet: "N Pesanan · dari N cabang" +
  // aggregate total. Tapping it opens the Branch Order Switcher — it never
  // submits a merged multi-branch checkout.
  var multiCtaEl = null;
  function setMultiCta(show) {
    if (multiCtaEl) {
      multiCtaEl.remove();
      multiCtaEl = null;
    }
    var sheetContent = document.querySelector('#x-sheet .x-sheet-content');
    if (!show || !sheetContent) return;

    var groups = Store.getCartBranchGroups();
    var count = groups.length;
    var total = groups.reduce(function (sum, g) {
      return sum + g.items.reduce(function (s, it) { return s + Number(it.price || 0) * Number(it.quantity || 0); }, 0);
    }, 0);

    multiCtaEl = document.createElement('div');
    multiCtaEl.className = 'x-sheet-multi-cta';
    multiCtaEl.setAttribute('role', 'button');
    multiCtaEl.innerHTML =
      '<div class="x-sheet-multi-cta-left">' +
      '  <strong>' + count + ' Pesanan</strong>' +
      '  <span>dari ' + count + ' cabang</span>' +
      '</div>' +
      '<div class="x-sheet-multi-cta-total">' + UI.money(total).replace('Rp', '') + '</div>';

    multiCtaEl.onclick = function () {
      closeSheet();
      openBranchSwitcher();
    };

    sheetContent.appendChild(multiCtaEl);
  }

  // Branch-scoped checkout route: single-branch flows go straight to that
  // branch's #checkout (legacy/unassigned group keeps the plain #checkout).
  function goToCheckout(branchId) {
    closeSheet();
    if (window.Xentra && window.Xentra.Router) {
      window.Xentra.Router.navigate('checkout', { branchId: branchId || undefined });
    } else {
      var q = branchId ? '?branch_id=' + encodeURIComponent(branchId) : '';
      window.location.href = '/checkout/' + q;
    }
  }

  // R1 CART SHEET §5B: bottom checkout CTA (dock link + sheet CTA). One branch
  // scope → that branch's #checkout directly. More than one scope → Branch
  // Order Switcher (no silent-select, no merged checkout).
  function openCheckoutFlow() {
    var groups = Store.getCartBranchGroups();
    closeSheet();
    if (groups.length > 1) {
      openBranchSwitcher();
    } else {
      goToCheckout(groups[0] ? groups[0].branch_id : null);
    }
  }

  // Branch Order Switcher: the multi-branch gateway. The customer explicitly
  // picks ONE branch order; each row carries its own single-branch checkout.
  function openBranchSwitcher() {
    var groups = Store.getCartBranchGroups();
    if (!groups.length) return;

    var existing = document.querySelector('.x-branch-switcher-overlay');
    if (existing) existing.remove();

    var rowsHtml = groups.map(function (g, idx) {
      var count = g.items.reduce(function (s, it) { return s + Number(it.quantity || 0); }, 0);
      var sub = g.items.reduce(function (s, it) { return s + Number(it.price || 0) * Number(it.quantity || 0); }, 0);
      var key = g.branch_id ? String(g.branch_id) : '__unassigned__';
      return '' +
        '<div class="x-branch-switcher-row">' +
        '  <div class="x-branch-switcher-header-line">' +
        '    <div class="x-branch-switcher-name">' + UI.escape(branchLabel(g, idx)) + '</div>' +
        '  </div>' +
        '  <div class="x-branch-switcher-body-line">' +
        '    <div class="x-branch-switcher-meta">' + count + ' item</div>' +
        '    <div class="x-branch-switcher-total">' + UI.money(sub) + '</div>' +
        '  </div>' +
        '  <div class="x-branch-switcher-action-line">' +
        '    <button type="button" class="x-branch-switcher-btn" data-switch-branch="' + key + '">' +
        '      Checkout &rarr;' +
        '    </button>' +
        '  </div>' +
        '</div>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.className = 'x-overlay x-branch-switcher-overlay';
    overlay.innerHTML =
      '<div class="x-sheet x-branch-switcher-sheet">' +
      '  <div class="x-sheet-handle"></div>' +
      '  <div class="x-branch-switcher-head">' +
      '    <h3 class="x-branch-switcher-title">Pesanan kamu</h3>' +
      '  </div>' +
      '  <div class="x-branch-switcher-list">' + rowsHtml + '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    void overlay.offsetHeight;
    requestAnimationFrame(function () {
      overlay.classList.add('open');
    });

    var isClosing = false;
    function closeSwitcher() {
      if (isClosing) return;
      isClosing = true;
      overlay.classList.remove('open');
      setTimeout(function () {
        if (overlay.parentNode) overlay.remove();
      }, 380);
    }

    if (window.XentraNav && typeof window.XentraNav.pushClose === 'function') {
      window.XentraNav.pushClose(closeSwitcher);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        if (window.XentraNav && typeof window.XentraNav.close === 'function') {
          window.XentraNav.close();
        } else {
          closeSwitcher();
        }
      }
    });

    overlay.querySelectorAll('[data-switch-branch]').forEach(function (row) {
      row.onclick = function () {
        var key = row.dataset.switchBranch;
        if (window.XentraNav && typeof window.XentraNav.close === 'function') {
          window.XentraNav.close();
        } else {
          closeSwitcher();
        }
        goToCheckout(key === '__unassigned__' ? '__unassigned__' : key);
      };
    });
  }

  function renderCartSummary() {
    var summaryEl = $('x-sheet-summary');
    if (!summaryEl) return;

    var subtotal = Store.getCartSubtotal();
    var count = Store.getCartCount();
    var promoState = Store.getState().promo;
    var discount = 0;

    if (promoState.enabled && promoState.target > 0 && promoState.discount > 0 && subtotal >= promoState.target) {
      discount = Math.min(promoState.discount, subtotal);
    }

    var grandTotal = subtotal - discount;

    summaryEl.innerHTML =
      '<div class="x-sheet-summary-card">' +
      '  <div class="x-sheet-summary-row"><span class="label">Subtotal (' + count + ' item)</span><span class="value">' + UI.money(subtotal) + '</span></div>' +
      (discount > 0
        ? '<div class="x-sheet-summary-row discount"><span class="label">Diskon Ongkir</span><span class="value">−' + UI.money(discount) + '</span></div>'
        : '') +
      '  <div class="x-sheet-summary-divider"></div>' +
      '  <div class="x-sheet-summary-total"><span class="label">Total</span><span class="value">' + UI.money(grandTotal) + '</span></div>' +
      '</div>';
  }

  // ======================================================================
  //  INITIALIZATION
  // ======================================================================
  function init() {
    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // M6: Load canonical banner media from /brand/info, then init carousel.
    // Falls back to static HTML slides if the API is unavailable.
    loadBanners();

    // 1. First paint without a "wrong branch" flash: when a branch context survived
    // a reload, show an honest loading state (never a brand-wide catalog inside
    // a branch context). Without one, the brand-wide menu is the legitimate
    // first paint and comes from the cache/first-paint fallback.
    var bootBranchId = null;
    try {
      var persistedCtx = Store.getState().branchContext;
      if (persistedCtx && persistedCtx.branch_id != null) bootBranchId = String(persistedCtx.branch_id);
    } catch (_) {}

    if (bootBranchId) {
      clearCatalogForBranch('Memuat menu cabang...');
    } else {
      try {
        var rawCached = localStorage.getItem('xentra_catalog_cache');
        if (rawCached) {
          var parsed = JSON.parse(rawCached);
          applyCatalog(parsed);
        }
      } catch (_) {}
    }

    // 2. Fetch fresh catalog in background. When a branch context survived a
    // reload, the catalog follows that same context (server-scoped menu).
    loadCatalog(bootBranchId);

    // P2: Branch discovery (fast, non-blocking — presentation only).
    initBranchDiscovery();

    // Discover install incentive for anonymous browser guests.
    initInstallPromo();

    // Render initial cart state
    renderCartDock();

    // Home Location Pill (Header) → open "Pilih lokasi" sheet
    function handleOpenLocationPicker() {
      if (window.XentraLocationPicker && typeof window.XentraLocationPicker.open === 'function') {
        window.XentraLocationPicker.open({
          onSelect: function () {
            refreshDiscovery();
          }
        });
      }
    }

    var heroLocPill = $('x-hero-loc-pill');
    if (heroLocPill) heroLocPill.onclick = handleOpenLocationPicker;

    var locBar = $('x-home-loc-bar');
    if (locBar) locBar.onclick = handleOpenLocationPicker;

    // Header Navigation buttons: Join (Affiliate), Library (History), Profile
    var btnJoin = $('x-btn-join');
    if (btnJoin) {
      btnJoin.onclick = function () {
        if (window.Xentra && window.Xentra.Router) {
          window.Xentra.Router.navigate('affiliate');
        }
      };
    }

    var btnLibrary = $('x-btn-library');
    if (btnLibrary) {
      btnLibrary.onclick = function () {
        if (window.Xentra && window.Xentra.Router) {
          window.Xentra.Router.navigate('history');
        }
      };
    }

    var btnProfile = $('x-btn-profile');
    if (btnProfile) {
      btnProfile.onclick = function () {
        if (window.Xentra && window.Xentra.Router) {
          window.Xentra.Router.navigate('profile');
        }
      };
    }

    if (window.XentraLocationPicker && typeof window.XentraLocationPicker.updateBar === 'function') {
      window.XentraLocationPicker.updateBar();
    }

    // Cart button → open sheet
    var cartBtn = $('x-cart-button');
    if (cartBtn) cartBtn.onclick = openCartSheet;

    // Backdrop → close sheet
    var backdrop = $('x-backdrop');
    if (backdrop) backdrop.onclick = closeSheet;
    // Green bottom checkout CTA link (fast path to completing an order).
    // State A (1 branch): direct to #checkout for that branch.
    // State B (>1 branches): open Branch Order Switcher bottom sheet.
    var checkoutLink = $('x-cart-checkout-link');
    if (checkoutLink) {
      checkoutLink.onclick = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        openCheckoutFlow();
      };
    }

    // Checkout button in sheet (single-branch flow; multi-branch hides this
    // button and shows the Branch Order Switcher CTA instead)
    var sheetCheckout = $('x-sheet-checkout');
    if (sheetCheckout) {
      sheetCheckout.onclick = function () {
        openCheckoutFlow();
      };
    }

    // Subscribe to store changes (2-Way Realtime Reactive Sync)
    // The home DOM exists on every page (checkout/order-received share the SPA
    // shell), so this MUST skip when home is not the active view — rebuilding
    // the hidden catalog grid per checkout keystroke was pure wasted work.
    Store.subscribe(function () {
      if (window.Xentra && window.Xentra.Router && window.Xentra.Router.getCurrentView &&
          window.Xentra.Router.getCurrentView() !== 'home') return;
      renderProducts();
      renderCartDock();
      if ($('x-sheet') && $('x-sheet').classList.contains('open')) {
        renderCartSheetItems();
      }
    });
  }

  // Run when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for external use
  window.XentraHome = {
    selectCategory: function (catId) {
      activeCategory = Number(catId);
      renderCategories();
      loadProducts(activeCategory);
    },
    refresh: function () {
      renderProducts();
      renderCartDock();
      if ($('x-sheet') && $('x-sheet').classList.contains('open')) {
        renderCartSheetItems();
      }
      refreshDiscovery();
      if (window.XentraLocationPicker && typeof window.XentraLocationPicker.updateBar === 'function') {
        window.XentraLocationPicker.updateBar();
      }
    },
    selectBranch: function (branchId) {
      var found = branches.find(function (b) { return String(b.id) === String(branchId); });
      if (found) setActiveBranch(found, true);
    },
    openCheckoutFlow: function () {
      openCheckoutFlow();
    },
    openBranchSwitcher: function () {
      openBranchSwitcher();
    },
    getBranches: function () {
      return branches;
    }
  };
})();
