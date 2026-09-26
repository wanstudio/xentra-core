# 🔒 Xentra POS Readiness Indicator — UX Contract v1

**Status:** LOCKED / AUTHORITATIVE  
**Decision date:** 2026-09-26  
**Scope:** POS header status indicator, cashier-facing readiness semantics, desktop/mobile disclosure, and mapping of internal system conditions to a single human-facing signal.

## 1. Decision

Xentra POS exposes **one small traffic-light indicator** for cashier-facing readiness.

The indicator is intentionally **not labeled ONLINE/OFFLINE** and is not a direct representation of one technical condition.

Its meaning follows ordinary human traffic-light perception:

- **GREEN = GO** — POS is ready; cashier may proceed with transaction work.
- **YELLOW = CAUTION** — something is changing, needs attention, or is temporarily not ideal; it does not automatically mean “stop”.
- **RED = STOP** — the POS is not ready for the affected transaction workflow; the cashier should not proceed until the condition is resolved or the appropriate operator/admin intervenes.

The color is determined by the **operational effect on the cashier**, not by the raw backend cause.

## 2. Internal causes stay separate

The readiness indicator may be derived from multiple authoritative/runtime inputs, including:

- device/network connectivity;
- reachability/health of Xentra Core;
- Branch operational state;
- terminal registration/validity;
- authentication/session validity;
- cashier shift state;
- maintenance/service state;
- permitted offline capability;
- synchronization/recovery state.

These remain separate system conditions. POS must not expose them as a row of technical status badges.

**Conceptual mapping:** internal conditions → operational impact → GREEN / YELLOW / RED

Examples:

- Internet unavailable + permitted offline operation → **YELLOW**
- Core unavailable + transaction cannot be performed → **RED**
- Merchant/Branch closed for POS operation → **RED**
- Shift not opened but cashier can simply open it → **YELLOW**
- Temporary reconnect/synchronization → **YELLOW**
- All required conditions satisfied → **GREEN**

## 3. GREEN / GO

Green means the cashier does not need to reason about system state.

Human interpretation:

> **Aman. Bisa kerja.**

Default detail when opened: **Siap digunakan**.

## 4. YELLOW / CAUTION

Yellow means:

> **Ada sesuatu yang perlu diperhatikan, tetapi belum tentu harus berhenti.**

Typical messages:

- **Menghubungkan…**
- **Menghubungkan kembali…**
- **Sedang sinkronisasi**
- **Mode offline**
- **Shift belum dibuka**

Yellow is not a generic “partial error” bucket. It is for conditions where waiting, observing, or a straightforward action may resolve the situation without declaring the POS unusable.

## 5. RED / STOP

Red means:

> **Jangan lanjut transaksi sekarang.**

Typical human-facing messages:

- **Merchant sedang tutup**
- **Terjadi gangguan sistem**
- **Terminal belum siap**
- **Login diperlukan**
- **Hubungi admin/operator**

Messages must use human language, not HTTP status, service names, database errors, or network exception codes.

## 6. Desktop presentation

On desktop/wide layouts, the header shows **only the lamp**.

Hover or keyboard focus reveals a small tooltip containing a concise title and one short explanation/action. The tooltip does not permanently consume header space.

## 7. Mobile presentation

On mobile/small layouts, hover is not relied upon.

Tap the same lamp to open a **contextual status card/popover**, following Xentra’s existing warning/error treatment:

- green → success/info treatment;
- yellow → warning treatment;
- red → error/stop treatment.

The semantic content is the same as desktop; only the presentation changes.

## 8. One classifier, multiple presentations

There is one readiness classification:

`READY / CAUTION / STOP`

Responsive presentation:

`Desktop → hover/focus tooltip`  
`Mobile → tap contextual card`

Desktop and mobile must not implement different business readiness rules.

## 9. Naming and authority boundary

The indicator is **not**:

- an internet-status badge;
- a “Core connected” badge;
- a Branch-open/closed badge;
- a Shift badge;
- a technical server-health dashboard.

Those conditions can be inputs. The user-facing meaning is **“how ready is this POS for the cashier’s next operation?”**

This does not create a second authority or a second state machine. Xentra-Core remains the authority for branch, workforce, order, payment, and operational rules.

## 10. Accessibility

The lamp is a real interactive control on touch devices and carries an accessible label with the current human-readable state.

Color is supplemented by text when the indicator is inspected/activated; users are not required to distinguish color alone.

## 11. Implementation status

The POS frontend now removes the visible ONLINE/OFFLINE label, uses semantic `READY / CAUTION / STOP` classes, and supports the same status detail through desktop hover/focus and mobile tap.

The current frontend wiring uses authoritative/runtime signals including Branch operational state, Core reachability, terminal state, shift state, connectivity/offline mode, and synchronization/recovery conditions. Branch closure is a RED/STOP condition for the cashier readiness signal. Online-order pause remains a separate Branch capability and does not directly turn the POS lamp RED.

**Any change to the GREEN / YELLOW / RED meaning or the desktop/mobile interaction model requires a new explicit decision/revision.**
