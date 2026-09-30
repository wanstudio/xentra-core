/**
 * XENTRA OWNER NAVIGATION ENGINE
 * Centralized SPA navigation stack + History API synchronization.
 *
 * Contract:
 *   - root navigation replaces the current app stack with one root route
 *   - child navigation pushes onto the current stack
 *   - sibling/ancestor navigation is resolved from the route tree
 *   - Back/Forward are driven by the same stack persisted in history.state
 *   - direct/deep links are normalized into a deterministic parent chain
 *   - presentation overlays (modal/bottom-sheet) are intentionally out of scope
 */
(function (window) {
  'use strict';

  var STATE_KEY = '__xentraNavigation';
  var STATE_VERSION = 1;

  var config = null;
  var configured = false;
  var initialized = false;
  var suppressNextHashChange = false;

  function canonicalize(route) {
    if (!route) return '';
    if (config && typeof config.canonicalize === 'function') {
      return config.canonicalize(route);
    }
    return route;
  }

  function isRootRoute(route) {
    return !!(config && typeof config.isRootRoute === 'function' && config.isRootRoute(route));
  }

  function parentRoute(route) {
    if (config && typeof config.parentRoute === 'function') {
      return config.parentRoute(route);
    }
    return null;
  }

  function defaultRoute() {
    if (config && typeof config.defaultRoute === 'function') {
      return config.defaultRoute();
    }
    return (config && config.defaultRoute) || 'overview';
  }

  function getRouteFromLocation() {
    if (config && typeof config.getRoute === 'function') {
      return canonicalize(config.getRoute());
    }
    return canonicalize((window.location.hash || '').replace(/^#\/?/, '').trim()) || canonicalize(defaultRoute());
  }

  function render(route) {
    if (config && typeof config.renderRoute === 'function') {
      config.renderRoute(canonicalize(route));
    }
  }

  function makeState(stack) {
    var safeStack = Array.isArray(stack) ? stack.slice() : [];
    return {
      __xentraNavigation: STATE_VERSION,
      route: safeStack.length ? safeStack[safeStack.length - 1] : null,
      stack: safeStack
    };
  }

  function readState() {
    var state = window.history && window.history.state;
    if (!state || state[STATE_KEY] !== STATE_VERSION) return null;
    if (!Array.isArray(state.stack) || state.stack.length === 0) return null;
    var normalizedStack = state.stack.map(canonicalize);
    var normalizedRoute = canonicalize(state.route || normalizedStack[normalizedStack.length - 1]);
    if (!normalizedRoute || normalizedStack[normalizedStack.length - 1] !== normalizedRoute) {
      return null;
    }
    return {
      route: normalizedRoute,
      stack: normalizedStack
    };
  }

  function isPrefix(prefix, full) {
    if (!Array.isArray(prefix) || !Array.isArray(full) || prefix.length > full.length) return false;
    for (var i = 0; i < prefix.length; i++) {
      if (prefix[i] !== full[i]) return false;
    }
    return true;
  }

  function buildRouteChain(route) {
    var current = canonicalize(route || defaultRoute());
    var chain = [];
    var seen = Object.create(null);

    while (current && !seen[current]) {
      seen[current] = true;
      chain.unshift(current);

      if (isRootRoute(current)) break;

      var parent = canonicalize(parentRoute(current));
      if (!parent || parent === current) break;
      current = parent;
    }

    if (!chain.length) {
      chain.push(canonicalize(defaultRoute()));
    }

    // Every known Owner child route must resolve to a root. Unknown routes are
    // still rendered safely as a root-like single entry rather than inventing
    // a parent chain.
    if (!isRootRoute(chain[0])) {
      chain = [canonicalize(defaultRoute()), current];
    }

    return chain;
  }

  function writeState(stack, mode) {
    var nextStack = stack.slice();
    var nextState = makeState(nextStack);
    var url = '#' + nextState.route;

    if (mode === 'push') {
      window.history.pushState(nextState, '', url);
    } else {
      window.history.replaceState(nextState, '', url);
    }
  }

  function establishFromRoute(route) {
    var target = canonicalize(route || getRouteFromLocation() || defaultRoute());
    var chain = buildRouteChain(target);

    // Normalize the current browser entry to the root, then create the
    // deterministic child entries required for a deep-linked Back chain.
    writeState([chain[0]], 'replace');

    for (var i = 1; i < chain.length; i++) {
      writeState(chain.slice(0, i + 1), 'push');
    }

    initialized = true;
    render(target);
  }

  function currentStack() {
    var state = readState();
    if (state) return state.stack.slice();

    var route = getRouteFromLocation();
    var chain = buildRouteChain(route);
    writeState([chain[0]], 'replace');
    for (var i = 1; i < chain.length; i++) {
      writeState(chain.slice(0, i + 1), 'push');
    }
    initialized = true;
    return chain;
  }

  function initialize() {
    if (!configured) return;
    var route = getRouteFromLocation();
    var state = readState();

    if (state && state.route === route) {
      initialized = true;
      render(route);
      return;
    }

    establishFromRoute(route);
  }

  function navigate(route, options) {
    if (!configured) return;
    var target = canonicalize(route);
    if (!target) return;

    var opts = options || {};
    var stack = currentStack();
    var current = stack[stack.length - 1];

    if (target === current) {
      render(target);
      return;
    }

    // Explicit root navigation is a tab/root transition, not a child push.
    if (opts.history === 'root' || (!opts.history && isRootRoute(target))) {
      writeState([target], 'replace');
      initialized = true;
      render(target);
      return;
    }

    var targetChain = buildRouteChain(target);

    // Explicit push always adds the target on top. When called from a root
    // shortcut that targets a deeper child, materialize the missing chain so
    // Back can still unwind one native page at a time.
    if (opts.history === 'push') {
      if (isPrefix(stack, targetChain) && targetChain.length > stack.length) {
        for (var p = stack.length; p < targetChain.length; p++) {
          writeState(targetChain.slice(0, p + 1), 'push');
        }
      } else {
        writeState(stack.concat([target]), 'push');
      }
      initialized = true;
      render(target);
      return;
    }

    // If target is already in our stack, pop the exact number of levels.
    var existingIndex = stack.lastIndexOf(target);
    if (existingIndex >= 0 && existingIndex < stack.length - 1) {
      window.history.go(existingIndex - (stack.length - 1));
      return;
    }

    // An ancestor route is a pop operation. Never replace the current browser
    // entry with its parent: doing that leaves a duplicate entry behind.
    if (isPrefix(targetChain, stack) && targetChain.length < stack.length) {
      window.history.go(targetChain.length - stack.length);
      return;
    }

    // Child of the current route: one normal push.
    var currentParent = canonicalize(parentRoute(target));
    if (currentParent === current) {
      writeState(stack.concat([target]), 'push');
      initialized = true;
      render(target);
      return;
    }

    // Target chain extends the current stack (e.g. Business -> Add Product
    // through a shortcut): push each missing hierarchy level.
    if (isPrefix(stack, targetChain) && targetChain.length > stack.length) {
      for (var i = stack.length; i < targetChain.length; i++) {
        writeState(targetChain.slice(0, i + 1), 'push');
      }
      initialized = true;
      render(target);
      return;
    }

    // Sibling/different branch: replace the current page with its canonical
    // chain. This keeps Back at the shared parent instead of creating a
    // sibling-to-sibling bounce.
    if (opts.history === 'replace' || targetChain.length > 0) {
      writeState(targetChain, 'replace');
      initialized = true;
      render(target);
    }
  }

  function back() {
    if (!configured) return;

    var stack = currentStack();
    if (stack.length > 1) {
      window.history.back();
      return;
    }

    // Safety fallback for a child call with no managed parent.
    navigate(defaultRoute(), { history: 'root' });
  }

  function syncFromLocation() {
    if (!configured) return;

    var route = getRouteFromLocation();
    var state = readState();

    if (state && state.route === route) {
      initialized = true;
      render(route);
      return;
    }

    // Manual hash edits / legacy entries are normalized into the same route
    // tree as normal navigation.
    establishFromRoute(route);
  }

  function getSnapshot() {
    var state = readState();
    return state ? {
      route: state.route,
      stack: state.stack.slice()
    } : null;
  }

  function configure(options) {
    config = options || {};
    configured = true;

    if (!window.__xentraNavigationListenersBound) {
      window.__xentraNavigationListenersBound = true;

      window.addEventListener('popstate', function () {
        suppressNextHashChange = true;
        var state = readState();
        var route = state ? state.route : getRouteFromLocation();
        initialized = true;
        render(route);
      });

      window.addEventListener('hashchange', function () {
        if (suppressNextHashChange) {
          suppressNextHashChange = false;
          return;
        }
        syncFromLocation();
      });
    }
  }

  window.XentraNavigationController = {
    configure: configure,
    initialize: initialize,
    navigate: navigate,
    back: back,
    sync: syncFromLocation,
    getSnapshot: getSnapshot,
    getStateKey: function () { return STATE_KEY; },
    isInitialized: function () { return initialized; }
  };
})(window);
