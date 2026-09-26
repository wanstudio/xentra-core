# Xentra — POS Stepper UI Component v1

Status: LOCKED / ACTIVE

## Purpose

Standardize increment/decrement controls used by POS UI so every modal and quantity control uses the same visual component instead of ad-hoc plus/minus text buttons.

## Contract

- Use the shared POS Stepper component/classes whenever a POS UI needs to increase or decrease a numeric quantity.
- Increment/decrement controls use inline SVG icons, not text characters such as + or minus.
- The component keeps consistent button size, circular shape, spacing, icon stroke, hover state, active state, and quantity alignment.
- Buttons must expose an accessible aria-label such as Tambah or Kurangi.
- The quantity value remains a text value between the controls.
- New POS modals/components must reuse this component rather than creating a visually separate stepper.

## Current uses

- Product-card cart quantity control.
- POS split-bill Bayar Berdasarkan Menu quantity allocation.

## Implementation rule

Shared presentation lives under:
- apps/pos-app/assets/css/pos.css — .pos-stepper, .pos-stepper-btn, .pos-stepper-icon, .pos-stepper-value
- apps/pos-app/assets/js/pos-app.js — posStepperIcon()

Existing feature-specific classes may remain as compatibility hooks, but their visual treatment should inherit the shared POS Stepper rules.

## UX rule

Do not ask for a new visual treatment for each modal. If the interaction is increment/decrement quantity, apply the locked POS Stepper component automatically.