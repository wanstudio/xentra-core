# Xentra Client Media Requirements

**Status:** LOCKED  
**Added:** 2026-09-11

## Purpose
Client/merchant-managed media must be uploaded through Xentra-managed media handling so the Merchant Dashboard can safely provide assets used by the Customer PWA and other client runtime surfaces.

## Required Model

```text
Merchant Dashboard
      ↓
Media Upload
      ↓
Xentra Media Storage
      ↓
Media ID + ownership + metadata
      ↓
Client Runtime / Customer PWA
```

## Rules

- Client-editable media includes, where applicable, brand logos, product images, category images, banners/hero images, avatars/profile images, and other configured media slots.
- Normal client media input must be an upload, not an arbitrary external image URL.
- Store a stable `media_id` / storage reference and metadata in the database; do not store image binaries in the application database.
- Do not hardcode vendor-specific media URLs as source-of-truth values. Delivery URLs are resolved by the media layer/runtime.
- Media ownership and access are tenant/brand scoped and enforced by RBAC.
- Validate actual file type/signature, not only filename extension.
- Initial formats: JPEG, PNG, WebP. SVG is allowed only for explicitly permitted asset types such as logos and must be sanitized.

## Initial Upload Limits

| Asset | Max Size | Max Dimensions |
|---|---:|---:|
| Logo | 5 MB | 2048×2048 |
| Product image | 5 MB | 4096×4096 |
| Banner | 8 MB | 4096×2048 |
| Avatar | 3 MB | 1024×1024 |

Aspect ratio is slot-specific. Use recommended/allowed ratios per media slot rather than one global ratio.

## Optimization

Image optimization/compression is a required media capability. The implementation should support resized/optimized derivatives so the runtime can request appropriate sizes instead of always serving the original upload. WebP/AVIF delivery may be used where supported.

The original upload may be retained as the source asset, while frontend/runtime delivery should prefer optimized derivatives. Upload-size and dimension limits are guardrails, not substitutes for optimization.

This requirement does not authorize building a Cloudinary-like platform in one step. Establish a clean media boundary and evolve it incrementally.

## Minimum Metadata

`media_id`, `tenant_id`, `brand_id`, `uploaded_by`, `storage_key`, `mime_type`, `original_filename`, `width`, `height`, `size_bytes`, `created_at`.

## Scope Guardrail

This requirement is a platform prerequisite for future Merchant Dashboard media management and Customer PWA presentation. It does not block unrelated dashboard work unless the task specifically requires media upload.