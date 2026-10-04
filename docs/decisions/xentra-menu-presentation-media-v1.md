# Xentra — Menu Presentation Media v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-10-04  
**Scope:** Customer-facing presentation media for Menu Satuan and Menu Paket  
**Revises:** Customer presentation mapping in `xentra-master-menu-composition-branch-adoption-contract-v1.md`  
**Media slot:** extends the locked slot table in `xentra-canonical-media-engine-boundary-v1.md`

## 1. Decision

Product and Menu own different things, so they own different media:

- **Product** is the atomic inventory identity. `products.image_url` / `products.media_id` remain Product/stock master
  media (identification for the Owner/merchant working surface).
- **Menu** (Satuan and Paket) owns its own **customer-facing presentation media**, alongside its customer-facing title,
  taxonomy and selling price.

A Menu's customer-facing image is therefore **data owned by the Menu**, stored on the Menu row, attached through the
Canonical Media Engine.

## 2. No runtime fallback

**A Menu's customer-facing image must never be derived from a component Product image.**

- A Menu Paket sold as "Ayam + Nasi + Lalapan" has one presentation image of its own. Choosing one of three component
  Product images is semantically wrong and is not an allowed behavior.
- Presentation media for a Menu is either:
  1. the Menu's own attached media, or
  2. an explicit neutral placeholder.
- Serializers, resolvers, admin enrichment routes, and client surfaces must not implement "Menu image else first
  component Product image". Component Product images remain allowed **inside a composition listing** (they describe the
  contents of the Menu, not its presentation).

## 3. Media slot

| Slot | Max input | Canonical output |
|---|---:|---|
| Menu (Satuan & Paket) | 20 MB | 1:1 WebP derivatives |

- Supported input: JPEG, PNG, WebP. HEIC/HEIF remains unsupported. SVG remains disabled.
- The 20 MP safety ceiling, no-upscaling rule, WebP q82 delivery derivatives, and all processing invariants of
  `xentra-canonical-media-engine-boundary-v1.md` apply unchanged.
- Menu media **reuses** the Canonical Media Engine (`MediaService`, `ImageValidator`, `ImageProcessor`,
  `MediaReferenceResolver`) and the shared crop editor (`window.XentraCropEditor`, `assetType: 'menu'`, 1:1).
  No menu-specific upload, compressor, validator, or filesystem pipeline may be introduced.
- Entity attachment is registered as `menu` → `menu` in the Media Engine entity contract, so media assets attached to a
  Menu participate in reference protection and garbage collection like every other entity slot.

## 4. Storage

The Menu row carries the canonical media reference plus legacy-compatible delivery columns:

- `menus.media_id` → `media_assets(id)` (canonical identity, `ON DELETE SET NULL`)
- `menus.image_url`, `menus.image` → delivery/legacy-compatible URL columns, kept in sync by the entity media route

`media_id` is the canonical identity. `image_url`/`image` exist so existing readers keep working; canonical READY
derivatives (`preview_url`, `srcset_variants`) take precedence over them, exactly as documented for other entities.

## 5. Read precedence (customer-facing)

For every menu object returned to a client:

1. If the Menu has a canonical `media_id` with READY derivatives → use `preview_url` / `srcset_variants`.
2. Else if the Menu has its own legacy `image_url` / `image` → use it.
3. Else → neutral placeholder.

Step 3 is a **placeholder**, never a Product image. Menu serialization must not read a component Product's image field
for presentation purposes.

## 6. Migration policy for existing Menus

Runtime fallback is not the migration mechanism. Migration is explicit and one-time:

- **Menu Satuan** with no presentation media: a backfill tool may copy the media reference of its single component
  Product onto the Menu row (a Satuan Menu is that Product sold). Every copy is recorded as migration evidence.
- **Menu Paket** with no presentation media: **never** auto-copied. It displays the neutral placeholder until the Owner
  sets its presentation image.
- Backfill is idempotent (Menus that already have media are skipped) and never deletes legacy data.
- After migration, the Menu is the single source of truth. No fallback is reinstated.

## 7. Consequences

- Owner Master Menu editor provides a Menu photo control (pick → shared crop editor 1:1 → canonical entity upload),
  independent from the Product photo control.
- Product photo changes no longer affect any Menu presentation.
- Merchant/branch surfaces display the Menu's presentation media; the composition listing may still show component
  Product thumbnails.
- Changing the Menu presentation mapping again requires a further contract revision, per
  `xentra-master-menu-composition-branch-adoption-contract-v1.md` (contract gate on Customer presentation mapping).
