// File: assets/js/checkout-fix.js
// Purpose: small helper to toggle disabled state for purchase-type tiles
// Include this script in checkout page or import into your component bundle

function setOptionDisabled(type, disabled = true) {
  const btn = document.querySelector(`.type-option[data-type="${type}"]`);
  if (!btn) return;
  if (disabled) {
    btn.classList.add('disabled');
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('tabindex', '-1');
    btn.setAttribute('aria-pressed', 'false');
  } else {
    btn.classList.remove('disabled');
    btn.removeAttribute('aria-disabled');
    btn.removeAttribute('tabindex');
  }
}

// Example: disable reservasi by default
document.addEventListener('DOMContentLoaded', function () {
  // Try to disable reservasi if present
  try { setOptionDisabled('reservasi', true); } catch (e) { /* noop */ }
});
