# PWA Installability Signal Contract

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-09-20

## Purpose

Define the authoritative Customer PWA install-promotion lifecycle for browsers that support `beforeinstallprompt`.

## Core decision

The Xentra Floating Install CTA is **browser-capability-driven**, not timer-driven and not triggered by a race against `beforeinstallprompt`.

The native flow is:

1. The browser determines that the PWA is installable.
2. The browser emits `beforeinstallprompt`.
3. Xentra captures the event early, calls `preventDefault()`, and stores the deferred prompt.
4. Xentra may expose the native Floating Install CTA only after the deferred prompt is ready.
5. When the user clicks the Xentra CTA, `prompt()` is called directly from that user gesture.
6. Installation is verified separately through the existing `appinstalled` and/or verified standalone mechanisms.

## Prohibited flow

This flow is prohibited:

`user click -> waitForPrompt(timeout) -> beforeinstallprompt arrives -> delayed prompt()`

Do not use a timeout, polling loop, retry, or delayed callback to preserve or reuse user activation from an earlier click.

If `beforeinstallprompt` is not ready at the moment of a click, that click must not later be converted into a native install prompt. The event may make the native prompt ready for a subsequent user gesture.

## Fallback

If `beforeinstallprompt` is unavailable, Xentra must not pretend that the native install prompt is available. Platform-specific/manual installation guidance may be used where appropriate, including the iOS Add to Home Screen flow.

## State contract

- `beforeinstallprompt` READY means native install capability is available for the next user gesture.
- Native-install CTA visibility follows that capability signal.
- `accepted != installed` remains authoritative for Xentra installation verification.
- `appinstalled` and/or verified standalone detection remain the installation verification mechanisms.
- After verified installation, the Floating Install CTA is hidden.

## Architecture principle

Browser capability is the source of truth for native-install CTA availability. Browser-name or user-agent detection is not the source of truth.

## Implementation scope

This contract governs:

- `apps/customer-pwa/assets/js/core/pwa-runtime.js`
- `apps/customer-pwa/assets/js/pages/home.js`
- `apps/customer-pwa/assets/js/pages/checkout.js`
- early `beforeinstallprompt` listeners in Customer PWA HTML entry points
- related PWA install-flow tests

It does not change promotion eligibility, reward mechanics, branch scope, payment behavior, or installation verification semantics.

## Reference model

The expected lifecycle follows the platform pattern documented by MDN for `beforeinstallprompt`: capture the event, suppress default promotion UI when appropriate, present an application-owned install affordance, and call `prompt()` from the subsequent user gesture.
