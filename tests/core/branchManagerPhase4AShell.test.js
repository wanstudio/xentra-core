'use strict';

/**
 * BM Phase 4A — Dashboard Shell & Context UX Reconciliation Test Suite
 *
 * Requirements Matrix (P4A-01 through P4A-12):
 * - P4A-01: Role-aware portal label: Owner -> "Owner Portal", Brand Manager -> "Brand Portal", Branch Manager -> "Branch Portal", Cashier -> "Cashier Portal".
 * - P4A-02: Brand context deduplication: Topbar brand badge is hidden for branch_manager (redundant with sidebar header).
 * - P4A-03: Topbar brand badge remains visible for Owner and Brand Manager.
 * - P4A-04: Branch context selector is hidden for branch_manager; locked context badge (#dash-bm-branch-badge) is displayed.
 * - P4A-05: Branch context selector is visible for Owner, with "All Branches" and all brand branches selectable.
 * - P4A-06: Branch context selector is scoped to authorized brand branches for brand_manager.
 * - P4A-07: Branch context selector is hidden/disabled for Cashier.
 * - P4A-08: Deceptive/empty global search affordance (#btn-global-search) is hidden/removed so user is not misled.
 * - P4A-09: Notification bell entry point (#btn-notifications) is present and accessible.
 * - P4A-10: Branch Manager sidebar navigation retains Menu (data-route="menu") as required by operational contract.
 * - P4A-11: Portal badge styling (.x-dash-badge-pro) maintains accessible contrast and avoids fluorescent lime on bright background.
 * - P4A-12: Responsive topbar CSS rules support locked branch badge on compact viewports without layout distortion.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('BM Phase 4A — Merchant Dashboard Shell & Context UX Reconciliation', () => {
  const htmlPath = path.join(__dirname, '../../apps/merchant-dashboard/index.html');
  const jsPath = path.join(__dirname, '../../apps/merchant-dashboard/assets/js/dashboard.js');
  const cssPath = path.join(__dirname, '../../apps/merchant-dashboard/assets/css/dashboard.css');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  it('P4A-01: dashboard.js maps user roles to authoritative portal labels', () => {
    assert.ok(js.includes("'Owner Portal'"), 'Missing Owner Portal label in JS');
    assert.ok(js.includes("'Brand Portal'"), 'Missing Brand Portal label in JS');
    assert.ok(js.includes("'Branch Portal'"), 'Missing Branch Portal label in JS');
    assert.ok(js.includes("'Cashier Portal'"), 'Missing Cashier Portal label in JS');

    // In applyRoleBasedUI, portalBadge must be updated from role
    assert.ok(js.includes('portalBadge.textContent ='), 'Missing portalBadge textContent assignment');
  });

  it('P4A-02 & P4A-03: dashboard.js toggles topbar brand badge based on role (hidden for BM, flex for Owner/Brand Manager)', () => {
    assert.ok(js.includes("topbarBrandBadge.style.display = isBM ? 'none' : 'flex'"), 'Missing role-based toggle for topbarBrandBadge in applyRoleBasedUI');
    // Also in applyBrandToUI: ensure BM does not get topbar brand badge revived
    assert.ok(js.includes("user.role === 'branch_manager' && $('topbar-brand-badge')"), 'Missing BM protection in applyBrandToUI');
  });

  it('P4A-04 & P4A-05: dashboard.js enforces branch selector rules (hidden for BM, displayed for Owner)', () => {
    // For BM: branchSelectorWrap hidden, bmBranchBadge flex, branchSelector disabled
    assert.ok(js.includes("if (isBM) {"), 'Missing isBM branch context check');
    assert.ok(js.includes("if (bmBranchBadge) bmBranchBadge.style.display = 'flex'"), 'Missing bmBranchBadge show');
    assert.ok(js.includes("if (branchSelectorWrap) branchSelectorWrap.style.display = 'none'"), 'Missing branchSelectorWrap hide for BM');

    // For Owner/Brand Manager: branchSelectorWrap flex, bmBranchBadge none, branchSelector enabled
    assert.ok(js.includes("if (branchSelectorWrap) branchSelectorWrap.style.display = 'flex'"), 'Missing branchSelectorWrap flex for owner');
    assert.ok(js.includes("if (bmBranchBadge) bmBranchBadge.style.display = 'none'"), 'Missing bmBranchBadge hide for owner');
  });

  it('P4A-06: populateBranchSelector scopes branch options by brand_id for brand_manager', () => {
    assert.ok(js.includes("user.role === 'brand_manager' && user.brand_id"), 'Missing brand_manager scoping in populateBranchSelector');
    assert.ok(js.includes("String(b.brand_id) === String(user.brand_id)"), 'Missing brand_id comparison in populateBranchSelector');
  });

  it('P4A-07: Branch context is hidden/disabled for Cashier role', () => {
    assert.ok(js.includes("role === 'cashier' || role === 'kitchen'"), 'Missing cashier role branch context check');
  });

  it('P4A-08: Deceptive empty search affordance is hidden in HTML and JS', () => {
    // HTML has search button hidden or disabled
    assert.ok(html.includes('id="btn-global-search"'), 'btn-global-search element missing in HTML');
    assert.ok(html.includes('id="btn-global-search" style="display: none;"'), 'btn-global-search must be styled display: none in HTML');

    // JS also ensures searchBtn.style.display = 'none'
    assert.ok(js.includes("searchBtn.style.display = 'none'"), 'Missing searchBtn hide in applyRoleBasedUI');
  });

  it('P4A-09: Notification bell entry point is present in HTML and accessible', () => {
    assert.ok(html.includes('id="btn-notifications"'), 'Missing btn-notifications in index.html');
    assert.ok(html.includes('aria-label="Notifikasi"'), 'Missing aria-label for notifications');
  });

  it('P4A-10: Branch Manager navigation explicitly includes Menu (data-route="menu")', () => {
    assert.ok(js.includes('data-route=\\"menu\\"'), 'Missing data-route="menu" in renderBranchManagerNavigation');
    assert.ok(js.includes('<span>Menu</span>'), 'Missing Menu text in renderBranchManagerNavigation');
  });

  it('P4A-11: CSS .x-dash-badge-pro provides accessible contrast', () => {
    assert.ok(css.includes('.x-dash-badge-pro {'), 'Missing .x-dash-badge-pro selector in CSS');
    // Ensure readable text color
    assert.ok(css.includes('color: #f1f5f9;') || css.includes('color: #ffffff;'), 'Missing high-contrast text color for portal badge');
  });

  it('P4A-12: CSS supports responsive branch context badge on mobile viewports', () => {
    assert.ok(css.includes('.x-branch-context-badge {'), 'Missing .x-branch-context-badge selector in CSS');
    assert.ok(css.includes('@media (max-width: 1023px)'), 'Missing 1023px media query');
    // Verify mobile rule contains .x-branch-context-badge
    const mobileIndex = css.indexOf('@media (max-width: 1023px)');
    const mobileCss = css.slice(mobileIndex, mobileIndex + 3500);
    assert.ok(mobileCss.includes('.x-branch-context-badge'), 'Missing responsive styling for x-branch-context-badge in mobile query');
  });
});
