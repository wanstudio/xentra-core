# Xentra Client Media Requirements

**Status:** LOCKED / AUTHORITATIVE  
**Added:** 2026-09-11  
**M0 Locked:** 2026-09-13  
**M1 Locked:** 2026-09-13  
**M2 Locked:** 2026-09-13  
**M3 Locked:** 2026-09-13  
**M4 Locked:** 2026-09-13

## Purpose
Client/merchant-managed media must be uploaded through Xentra-managed media handling so the Merchant Dashboard can safely provide assets used by the Customer PWA and other client runtime surfaces.

## Required Model

```text
Merchant Dashboard
      ↓
Upload Session / Temporary Asset
      ↓
Validate
      ↓
Process
      ↓
READY Media Asset
      ↓
Attach to Entity
      ↓
Optimized Delivery Variants
```

## Rules

- Client-editable media includes, where applicable, brand logos, product images, category images, banners/hero images, avatars/profile images, and other configured media slots.
- Normal client media input must be an upload, not an arbitrary external image URL.
- Store a stable `media_id` / storage reference and metadata in the database; do not store image binaries in the application database.
- Do not hardcode vendor-specific media URLs as source-of-truth values. Delivery URLs are resolved by the media layer/runtime.
- Media ownership and access are tenant/brand scoped and enforced by RBAC for upload, read, list, attach, replace, and delete operations.
- Validate actual file type/signature, not only filename extension or client-provided MIME type.
- Initial supported input formats: JPEG, PNG, WebP.
- HEIC is not considered supported until decode/process capability is proven on the actual Xentra runtime/VPS.
- SVG is not enabled for arbitrary uploads; if a specific asset type later permits SVG, proper sanitization is required.

## Upload Policy

Upload limits are security guardrails. Merchants should be able to upload normal phone-camera originals without manually compressing them first.

**Locked M0 policy targets:**

| Asset | Max Upload | Max Dimensions / Safety |
|---|---:|---|
| Logo | 10 MB | 20 MP safety ceiling; canonical 1:1 |
| Product image | 20 MB | 20 MP safety ceiling; canonical 1:1 |
| Category image | 15 MB | 20 MP safety ceiling; canonical 1:1 |
| Banner | 20 MB | 20 MP safety ceiling; canonical ~1.94:1 |
| Avatar | 10 MB | 20 MP safety ceiling; canonical 1:1 |

These policy limits are the authoritative product limits. M1 implementation must not silently replace them with lower slot limits. If an implementation requires a stricter temporary/resource guard, that guard must be explicitly documented and must not redefine the product upload policy.

The architecture must remain compatible with future resumable/chunked uploads for unreliable mobile networks and large files. Resumable upload is not required for M1.

## Crop & Processing Contract

- Users may upload non-square/non-canonical source images.
- Product, Category, Logo and Avatar canonical crop is 1:1.
- Banner canonical crop is approximately 1.94:1.
- **Input uploads must not be rejected merely because their source aspect ratio is not canonical.** Non-canonical sources are expected and are handled by the crop/processing pipeline.
- Crop positioning is user-controlled; the user may reposition the crop before confirmation.
- Browser crop coordinates are presentation/input only. Server-side processing is authoritative.
- Canonical processing pipeline is server-side.
- Sharp/libvips is the selected Xentra image-processing engine.
- No upscaling.
- Processing order is effectively: validate → crop → resize → optimize/compress → generate derivatives.
- Delivery should prefer optimized derivatives, not the original upload.

## M1 Boundary — Upload Security & Validation

M1 establishes the secure media intake and lifecycle boundary. It does **not** constitute the image optimization/derivative-processing implementation.

M1 responsibilities:

- receive/stage the upload;
- verify binary format and intrinsic metadata;
- reject spoofed, malformed, unsupported, oversized, or unsafe input;
- enforce tenant/brand authorization;
- persist lifecycle state safely;
- support retry and atomic entity replacement semantics;
- make an asset eligible for attachment only when the implementation's readiness contract is satisfied.

M1 must not claim that an asset has been optimized, resized, converted to WebP, or had derivatives generated unless that processing actually occurred. Those responsibilities belong to M3.

### M1 Security Ceiling

- M1 enforces the locked **20 MP product-policy safety ceiling** unless a newer explicit architecture decision changes it.
- Maximum dimensions may be constrained by implementation for resource safety, but such constraints must be compatible with the locked slot policy and must not silently redefine it.
- A lower test fixture limit is permitted only when it is clearly test-only and is not exposed as the production policy.

## Derivatives

Product / Category / Logo / Avatar square variants target:

- 320 px
- 640 px
- 1024 px
- 1600 px
- 2048 px

Banner variants target approximately 1.94:1:

- 640×330
- 1200×619
- 1920×990

Only generate variants that do not exceed the source dimensions; never upscale.

WebP is the default optimized delivery format. AVIF may be added later where operationally justified.

Exact compression quality is selected by benchmark rather than an arbitrary fixed value.

Delivery derivatives must strip EXIF/GPS metadata. If originals are retained internally, they are not customer-facing delivery assets.

## Canonical Media Model

Binary media is stored outside the application database.

The canonical model consists of:

- `media_assets` — identity, ownership, source metadata and lifecycle state.
- `media_variants` — optimized derivative metadata and storage references.
- External/local storage — original and derivative binaries.

Typical entity references may include:

- Brand → `logo_media_id`
- Product → `media_id`
- Category → `media_id`
- Banner → `media_id`

The exact physical schema/API names remain implementation details as long as the contract above is preserved.

Minimum media metadata:

`media_id`, `tenant_id`, `brand_id`, `uploaded_by`, `storage_key`, `mime_type`, `original_filename`, `width`, `height`, `size_bytes`, `status`, `created_at`.

Storage keys must not expose the original filename as the authoritative object identity.

## Lifecycle Contract

Canonical lifecycle:

```text
UPLOADING / TEMPORARY
        ↓
UPLOADED
        ↓
PROCESSING
        ↓
READY
        ↓
ACTIVE / REFERENCED
        ↓
ORPHAN (replaced/deleted/unreferenced)
        ↓
RECONCILE
        ↓
HARD DELETE
```

Failure paths:

```text
UPLOADING / UPLOADED / PROCESSING
        ↓
FAILED
        ↓
RETRY
        ↓
PROCESSING
```

Rules:

- An asset may only be attached to a business entity after it reaches `READY`.
- Processing must be retryable and must not leave a partially published asset.
- If replacement processing fails, the currently active asset remains intact.
- Replacement is atomic: process new asset → new asset reaches `READY` → switch entity reference → old asset becomes `ORPHAN`.
- Failed/abandoned temporary assets are eligible for cleanup within 24 hours.
- Replaced/deleted/unreferenced assets receive a 30-day orphan grace period before permanent deletion.
- Garbage collection must re-check actual entity references before permanent deletion.
- Never permanently delete an asset based only on age or a stale lifecycle flag.
- Referenced assets are protected regardless of age.
- Old cached delivery URLs are not treated as storage garbage; immutable/versioned URLs allow cache expiration independently.

## Concurrency & Idempotency

- Media operations must be safe against duplicate/retry requests where practical.
- Concurrent replacement must not accidentally detach a newer active asset.
- Entity reference changes must be transactional/atomic at the domain boundary.
- Media processing completion must not publish stale results over a newer replacement.

## Security & Tenant Isolation

All media operations are tenant/brand scoped.

The server must prevent a caller from using a known `media_id` to cross tenant boundaries.

Authorization applies to:

- upload
- list
- metadata/read
- delivery access where protected
- attach
- replace
- delete

Errors must not expose filesystem paths, internal storage keys, or sensitive implementation details.

## Delivery & Cache

- Delivery URLs must be immutable/versioned and derived from `media_id`/variant identity rather than mutable entity URLs.
- Replacing an asset creates a new media identity and therefore a new delivery URL.
- Do not require broad cache purges for normal media replacement.
- Browser/CDN caching and media garbage collection are separate lifecycle concerns.

## Storage Lifecycle & Garbage Collection

Target operational policy:

| State | Policy |
|---|---|
| Temporary / failed | Cleanup within 24h |
| Active / referenced | Retain |
| Replaced / deleted / orphan | Keep for 30-day grace period |
| Orphan ≥30 days | Reconcile references, then permanently delete |

A scheduled Media Garbage Collector may run daily. Before hard deletion it must verify that the asset is still unreferenced. If a reference exists, deletion must be aborted/protected.

Storage quota is architecture-ready but is not an M0/M1 enforcement feature. Future quota accounting should distinguish original bytes, derivative bytes, and asset count.

## Backup & Recovery

Database and media storage together form the logical media dataset.

A backup strategy is incomplete if database references are backed up without the corresponding binary media, or vice versa.

Restore procedures must preserve the relationship between media records and stored binaries.

## Scope / Phasing

Media System is intentionally phased:

```text
M0 Architecture & Contract                 COMPLETE / LOCKED
 ↓
M1 Upload Security & Validation             COMPLETE / LOCKED
 ↓
M2 Crop / Image Editor UI                   COMPLETE / LOCKED
 ↓
M3 Image Processing Pipeline                COMPLETE / LOCKED
 ↓
M4 Media Storage & Asset Lifecycle          COMPLETE / LOCKED
 ↓
M5 Dashboard Integration                    NEXT
 ↓
M6 Customer PWA Integration
 ↓
M7 Migration / Cleanup / Regression
```

M0 locks the architecture and contracts above. M1 implements secure upload intake and validation against those contracts. M2 and M3 provide the interactive crop and canonical server-side optimization pipeline.

This requirement does not authorize building a Cloudinary-like platform in one step. Establish a clean media boundary and evolve it incrementally.

## Scope Guardrail

This requirement is a platform prerequisite for future Merchant Dashboard media management and Customer PWA presentation. It does not block unrelated dashboard work unless the task specifically requires media upload.
