# Xentra — Canonical Media Engine Boundary v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-10-01  
**Scope:** All client/merchant-supplied image media

## 1. Decision

Xentra uses **one canonical Media Engine** for all user-supplied image media.

No image upload may become an active application asset through a page-specific, route-specific, repository-specific, or legacy filesystem-writing pipeline.

Canonical flow:

```text
Client file selection
  ↓
UI preflight
  ↓
MediaService.stageUpload()
  ↓
ImageValidator
  ↓
CropSpec / user crop intent
  ↓
ImageProcessor
  ├─ normalize EXIF orientation
  ├─ crop to canonical ratio
  ├─ resize without upscaling
  ├─ optimize/compress
  └─ encode WebP delivery derivatives
  ↓
READY media asset
  ↓
attach / replace entity reference
  ↓
delivery URL / srcset
```

UI preflight is a user-experience guardrail only. Server-side validation remains authoritative.

## 2. Locked media policy

| Asset | Max input | Canonical output |
|---|---:|---|
| Brand Logo | 10 MB | 1:1 WebP derivatives |
| Master Product | 20 MB | 1:1 WebP derivatives |
| Category | 15 MB | 1:1 WebP derivatives |
| Banner | 20 MB | ~1.94:1 WebP derivatives |
| Avatar | 10 MB | 1:1 WebP derivatives |
| Merchant/Owner PWA icon | 10 MB | 1:1 WebP derivatives |
| POS PWA icon | 10 MB | 1:1 WebP derivatives |
| Promotion icon | 10 MB | 1:1 WebP derivatives |

The 20 MP safety ceiling remains authoritative. Supported input formats remain JPEG, PNG, and WebP. HEIC/HEIF remains unsupported until actual runtime decode/process capability is proven. Arbitrary SVG uploads remain disabled.

## 3. Processing invariants

The server is authoritative for pixels and output.

Required processing rules:

1. Normalize EXIF orientation before interpreting crop coordinates.
2. Apply the validated CropSpec.
3. Enforce canonical crop ratio server-side.
4. Never upscale.
5. Resize using geometry-preserving cover behavior rather than stretching.
6. Produce optimized WebP delivery derivatives using the locked Media System configuration.
7. Strip EXIF/GPS metadata from delivery derivatives.
8. Retain source/original binaries only as internal Media System storage, never as the normal customer-facing delivery asset.

## 4. Crop UX contract

Crop is a reusable presentation primitive. The crop editor produces **intent**, not canonical processed pixels.

Canonical user semantics:

- Source image may have any aspect ratio.
- Product, Category, Logo, Avatar, PWA icons, and Promotion icons use 1:1 framing.
- Banner uses approximately 1.94:1 framing.
- User may pan and zoom before confirmation.
- **Gunakan Potongan** accepts the crop intent.
- **Batal** discards the newly selected file/crop and keeps the persisted asset unchanged.
- There is no hidden "Batal lalu upload original" bypass.
- Crop copy must explain that the area inside the frame becomes the final asset and that Xentra handles crop/resize/compression automatically.

## 5. Media mutation boundary

The following are prohibited outside the canonical Media Engine:

- direct filesystem writes from HTTP upload routes;
- page-specific image processors;
- storing arbitrary external image URLs as new uploaded media;
- generic profile/settings mutation of media references;
- treating a client-side preview data URL as the canonical image;
- silently creating a lower upload policy in a UI slot without an explicit architecture decision.

Canonical media mutation uses:

```text
MediaService
  → ImageValidator
  → CropSpec
  → ImageProcessor
  → MediaRepository / StorageProvider
```

Entity repositories may synchronize compatibility URL columns only after a READY Media asset exists.

## 6. Compatibility / legacy rules

Legacy endpoints may remain temporarily where migration requires them, but they are adapters into the canonical engine.

A compatibility endpoint that still writes an image binary directly is invalid.

Current policy:

- legacy Master Product image route delegates to MediaService;
- legacy Branch Category image route delegates to MediaService;
- legacy Brand Logo route delegates to MediaService;
- legacy Banner upload route delegates to MediaService;
- Branch Product Photo Override remains quarantined and returns an explicit 410 because the forward architecture does not authorize branch-owned product photo overrides.
- Branch catalog resolution always uses the Master Product photo; legacy `branch_products.image_override` is not an active customer-facing photo source.

## 7.5 Media slot and lifecycle boundary

Brand-owned media binding is transactionally paired with the owning Brand reference: attach/replace or unlink cannot commit half of the relationship. Post-processing publication remains a separate canonical transaction boundary.


Media Engine entity attachment is type-safe and lifecycle-safe:

- A media asset may only attach to an approved entity type whose slot matches the asset semantic `asset_type`.
- Canonical slot mappings include `logo`, `product`, `category`, `banner`, `avatar`, `pwa_icon`, and `promotion`.
- Generic media attach/replace HTTP mutations are manager-only compatibility boundaries; branch roles use slot-specific adapters instead.
- `READY` is a published state, not an upload shortcut. Direct lifecycle mutation to `READY` is forbidden; `MediaService.processMedia()` is the normal publication path after ImageProcessor completion.
- The historical `/admin/media/:id/ready` endpoint is retained only as a compatibility alias and delegates to the canonical processing pipeline.

## 7. Generic settings boundary

Generic Brand/Profile settings are not media mutation APIs.

These endpoints may update ordinary profile/configuration fields, but they must not accept image URL fields as a shortcut for media upload/replacement.

Logo, PWA icon, banner, product, and category image changes use their dedicated Media System mutation boundary.

## 8. Garbage collection / references

Every canonical image slot retains a stable media identity.

PWA icon media references are persisted explicitly and are also protected by the MediaReferenceResolver so referenced icons cannot be garbage-collected accidentally.

Replacement follows:

```text
process new → READY → attach new → orphan old
```

Media replacement is transactional at the media metadata boundary: attaching the new asset and orphaning the old asset commit together, and orphan state clears stale attachment metadata so garbage collection can reason from authoritative references. When a higher-level service already owns the SQLite transaction, MediaService must participate without opening a nested transaction.

Processing uses an isolated derivative run. Existing published variants remain intact until the new variant set is fully written and the metadata transaction commits. A failed run removes only its own temporary artifacts and leaves the previous published variants available for recovery.

Failed processing must not destroy the currently active asset. Post-publish storage cleanup is best-effort; a cleanup failure must not downgrade a successfully published asset to FAILED.

## 9. Governance

This decision supersedes page-local assumptions about image upload behavior.

Future image/media work must:

1. identify the asset type;
2. reuse the authoritative slot policy;
3. use the canonical Media Engine;
4. reuse the shared crop editor where cropping is applicable;
5. preserve server-side validation and processing authority;
6. add regression tests for the boundary;
7. update this decision and `docs/CLIENT_MEDIA_REQUIREMENTS.md` when the media contract itself changes.

A new image upload path is not considered implemented merely because a file appears in storage. It is implemented only when the full canonical Media Engine contract is preserved.

## 10. Implementation evidence — 2026-10-01

The current implementation includes:

- `core/domain/ImageValidator.js` — authoritative binary/size/pixel validation;
- `core/domain/CropSpec.js` — canonical ratio enforcement;
- `core/media/ImageProcessor.js` — EXIF orientation normalization, crop, resize, WebP optimization, metadata stripping;
- `core/media/MediaService.js` — staging, lifecycle, processing, attach/replace;
- `core/media/MediaReferenceResolver.js` — reference protection including PWA icon media;
- `server/routes/media-entities.js` — canonical entity media routes;
- `server/routes/media-upload.js` — compatibility adapters routed through the engine;
- `server/routes/admin-brand.js` — logo/PWA/banner adapters routed through the engine;
- generic brand/settings routes no longer mutate media URLs directly;
- Owner/Merchant UI copy updated to the authoritative upload limits;
- crop cancel semantics normalized to discard the new selection;
- `tests/mediaEngineContract.test.js` — boundary regression coverage.

## 11. Source of truth

Detailed locked media requirements:
`docs/CLIENT_MEDIA_REQUIREMENTS.md`

This decision:
`docs/decisions/xentra-canonical-media-engine-boundary-v1.md`
