# Commit: fix/reservasi-icon-overlay

This commit adds placeholder assets, CSS and JS for the "reservasi" icon and disabled-overlay
behavior for purchase-type tiles used in the checkout UI.

Files added:
- assets/icons/reservasi.svg  (placeholder icon — replace with PNG if you prefer)
- assets/images/overlay-disabled.svg (placeholder overlay graphic)
- assets/css/checkout-fix.css  (styles for .purchase-types, .type-option, disabled overlay)
- assets/js/checkout-fix.js    (small helper to toggle disabled state for tiles)

Quick integration notes:
- If your checkout page/component already bundles CSS/JS, import the new files into the
  appropriate entry point, or include them directly in the checkout page template:

  <link rel="stylesheet" href="/assets/css/checkout-fix.css">
  <script src="/assets/js/checkout-fix.js" defer></script>

- The placeholder images are SVGs. If you prefer PNG, replace them at these paths:
  - /assets/icons/reservasi.png
  - /assets/images/overlay-disabled.png

- Markup example for purchase types (place in your checkout template/component):

<div id="purchase-types" class="purchase-types">
  <button class="type-option" data-type="delivery" aria-pressed="false">
    <img class="icon" src="/assets/icons/delivery.png" alt="Delivery">
    <span class="label">Delivery</span>
  </button>

  <button class="type-option" data-type="pickup" aria-pressed="false">
    <img class="icon" src="/assets/icons/pickup.png" alt="Pick-up">
    <span class="label">Pick-up</span>
  </button>

  <button class="type-option" data-type="dinein" aria-pressed="false">
    <img class="icon" src="/assets/icons/dinein.png" alt="Dine-in">
    <span class="label">Dine-in</span>
  </button>

  <button class="type-option reservasi" data-type="reservasi" aria-pressed="false">
    <img class="icon" src="/assets/icons/reservasi.svg" alt="Reservasi">
    <span class="label">Reservasi</span>
  </button>
</div>

- To toggle disabled state programmatically: call setOptionDisabled('reservasi', true|false).

If you want, I can:
- Replace the SVG placeholders with your original PNGs (upload them if you provide),
- Update an existing CSS/JS file instead of adding new standalone files,
- Or create a PR instead of committing directly.
