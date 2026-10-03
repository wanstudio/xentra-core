# 🔒 Xentra — Cashier Invitation & Mandatory Identity Onboarding Contract v1

**Status:** LOCKED  
**Scope:** Cashier invitation, invitation acceptance, PIN setup, cashier identity data, POS access gating, mandatory onboarding state, and security UX.

## 1. Core Decision

Cashier yang menerima invitation dari Xentra **tidak boleh langsung menggunakan POS**.

Cashier wajib menyelesaikan seluruh onboarding secara berurutan:

```text
Cashier Invitation
      ↓
Accept Invitation
      ↓
Set PIN
      ↓
Set Cashier Identity
      ├── Nama Lengkap
      └── NIK / Nomor KTP
      ↓
Onboarding Complete
      ↓
POS Access Allowed
```

Tidak ada tahap yang boleh dilewati.

Onboarding adalah **mandatory security state**, bukan sekadar wizard UI.

## 2. Cashier Identity

Email invitation **bukan nama kasir**.

Email hanya berfungsi sebagai:
- alamat tujuan invitation;
- identifier akun/authentication sesuai identity system Xentra;
- alat komunikasi/invitation lifecycle.

Nama kasir harus berasal dari input kasir sendiri.

Canonical cashier identity data:

```text
email
name
nik
pin
```

Jangan menggunakan email address, username, atau email local-part sebagai sumber nama kasir.

## 3. Mandatory Onboarding Order

### Step 1 — Accept Invitation

Cashier membuka invitation email dan menerima invitation.

Sistem memvalidasi:
- invitation masih aktif;
- invitation belum accepted;
- invitation belum expired;
- invitation ditujukan kepada identity/email yang benar;
- invitation mempunyai tenant/organization/branch scope yang authoritative.

Setelah berhasil accept, cashier masuk ke onboarding.

Cashier **belum boleh menggunakan POS**.

### Step 2 — Set PIN

Cashier wajib membuat PIN dan mengonfirmasi PIN.

Rules:
- PIN wajib diisi.
- Konfirmasi PIN wajib cocok.
- Validasi harus dilakukan server-side.
- PIN tidak boleh disimpan plaintext.
- PIN tidak boleh ditulis ke log.
- PIN tidak boleh dikembalikan dalam API response.
- PIN tidak boleh dianggap sebagai password identity account.
- PIN adalah credential operasional Cashier/POS sesuai contract POS.

Ketika PIN belum valid, button **MERAH / DISABLED**. Ketika valid, button **HIJAU / ENABLED**.

### Step 3 — Cashier Identity

Setelah PIN berhasil dibuat, cashier wajib mengisi **satu layer identity form** yang berisi:
- **Nama Lengkap**
- **NIK / Nomor KTP**

Nama harus berasal dari input form, bukan email atau username.

Rules nama:
- wajib diisi;
- bukan berasal dari email;
- bukan otomatis berasal dari username;
- validasi whitespace dan nilai kosong wajib dilakukan;
- nilai yang disimpan adalah nama canonical cashier.

Rules NIK:
- wajib diisi;
- hanya angka;
- panjang tepat **16 digit**;
- leading zero harus dipertahankan;
- karakter non-digit harus ditolak atau dibersihkan secara eksplisit sesuai formatter;
- validasi dilakukan di frontend dan server;
- sistem hanya menyatakan **format NIK Indonesia** valid pada tahap ini.

Sistem **tidak boleh mengklaim telah melakukan verifikasi Dukcapil/KTP eksternal** bila integrasi tersebut belum tersedia.

## 4. Button State

Jika nama kosong atau NIK tidak valid 16 digit:
- **MERAH / DISABLED**

Jika nama valid dan NIK valid 16 digit:
- **HIJAU / ENABLED**

Cashier hanya dapat melanjutkan ketika state valid.

## 5. Non-Dismissible Security UX

Seluruh mandatory onboarding step bersifat **non-dismissible**.

Tidak boleh ada mekanisme untuk melewati step melalui:
- tombol X / close;
- klik atau tap di luar modal;
- Escape;
- close gesture;
- swipe-to-dismiss;
- arbitrary back navigation yang melewati step;
- browser back untuk bypass;
- direct navigation ke POS;
- refresh yang mengubah state menjadi completed.

Pada mobile modal/bottom sheet:
- backdrop click tidak menutup;
- swipe-down tidak menutup;
- close icon tidak ditampilkan;
- accidental dismissal harus dicegah.

## 6. Refresh / Re-entry

Mandatory onboarding harus tetap berlaku setelah refresh atau membuka kembali aplikasi.

Backend harus menjadi authority untuk onboarding state.

Canonical state minimal:

```text
INVITED
ACCEPTED
PIN_SET
IDENTITY_COMPLETED
```

Frontend membaca state authoritative dari server dan mengarahkan cashier ke step yang masih wajib.

LocalStorage, URL, atau UI state tidak boleh menjadi sumber kebenaran untuk completion.

## 7. Backend POS Access Gate

POS access harus mempunyai server-side gate.

Minimal:

```text
Authenticated Cashier
AND
Invitation Accepted
AND
PIN Set
AND
Identity Completed
    =
POS Access Allowed
```

Jika salah satu belum selesai, POS access harus ditolak.

Direct request ke route/API POS tidak boleh menjadi cara bypass onboarding.

## 8. State Machine

Canonical state progression:

```text
INVITED
   ↓
ACCEPTED
   ↓
PIN_SET
   ↓
IDENTITY_COMPLETED
   ↓
POS_ACCESS_ALLOWED
```

State transition dilakukan server berdasarkan keberhasilan setiap step.

Frontend hanya merepresentasikan state tersebut.

## 9. Failure Handling

Jika save PIN gagal:
- tetap di PIN step.

Jika save identity gagal:
- tetap di Identity step.

Persistence failure tidak boleh menghasilkan onboarding completed.

Tidak boleh terjadi:

```text
request gagal
↓
frontend menganggap selesai
↓
cashier masuk POS
```

## 10. Security & Privacy

NIK adalah data identitas pribadi.

Rules:
- Jangan log NIK.
- Jangan log payload identity lengkap.
- Jangan menampilkan NIK penuh setelah onboarding kecuali diperlukan.
- Gunakan masking saat identity ditampilkan kembali.
- Batasi akses membaca NIK berdasarkan authorization.
- Jangan mengirim NIK ke API/frontend yang tidak membutuhkannya.
- Jangan menyimpan PIN plaintext.
- Jangan memasukkan PIN ke audit log.
- Jangan memasukkan credential/secret ke URL atau query string.
- Jangan membuat identity verification berdasarkan frontend state.

Audit event dapat berupa:
- `CASHIER_INVITATION_ACCEPTED`
- `CASHIER_PIN_SET`
- `CASHIER_IDENTITY_COMPLETED`
- `CASHIER_ONBOARDING_FAILED`

Audit event tidak boleh berisi nilai PIN atau NIK.

## 11. Relationship With Xentra Identity

Cashier tetap merupakan Xentra User/Workforce identity sesuai identity architecture.

Invitation menentukan:
- identity/email;
- Organization;
- Brand;
- Branch;
- role = cashier;
- scope yang diberikan.

Accepting invitation **tidak membuat identity kedua**.

PIN dan identity data melengkapi onboarding cashier dan akses operasional POS.

## 12. POS Access Principle

POS adalah operational surface, bukan tempat menyelesaikan onboarding security.

Jangan membuat:

```text
Masuk POS
  ↓
Lengkapi profil nanti
```

Yang benar:

```text
Invitation
  ↓
Mandatory Onboarding
  ↓
Complete
  ↓
POS
```

## 13. Implementation Boundary

Implementasi harus dilakukan sebagai **Cashier Onboarding / Identity Gate**, bukan sekumpulan conditional/tambalan di halaman POS.

Pisahkan concern:

```text
Invitation
    ↓
Workforce / Identity
    ↓
Cashier Onboarding State
    ↓
PIN Credential
    ↓
Cashier Identity
    ↓
POS Authorization Gate
    ↓
POS
```

Jika sudah ada invitation/onboarding implementation, audit dan integrasikan dengan state existing daripada membuat state parallel.

## 14. Acceptance Criteria

Contract dianggap terimplementasi apabila:

1. Cashier menerima invitation email.
2. Cashier accept invitation.
3. Cashier wajib set PIN.
4. Setelah PIN berhasil, cashier wajib mengisi Nama Lengkap + NIK.
5. Nama berasal dari input form, bukan email.
6. Nama + NIK berada pada satu identity layer.
7. NIK tepat 16 digit angka.
8. Button merah saat invalid.
9. Button hijau saat valid.
10. Button hanya dapat ditekan saat valid.
11. Tidak ada close button pada mandatory step.
12. Klik/tap luar tidak menutup.
13. Escape tidak menutup.
14. Back/swipe tidak boleh melewati onboarding.
15. Refresh/re-entry tidak membypass onboarding.
16. Direct access ke POS tidak membypass onboarding.
17. Backend menolak POS access sebelum `IDENTITY_COMPLETED`.
18. Identity berhasil disimpan → onboarding complete.
19. Setelah complete, cashier dapat masuk POS.
20. PIN/NIK tidak bocor ke log atau response yang tidak diperlukan.

## 15. Definition of Done

Flow canonical:

```text
Email Invitation
      ↓
Accept Invitation
      ↓
Set PIN
      ↓
Nama Lengkap + NIK
      ↓
Submit
      ↓
Onboarding Complete
      ↓
POS
```

Seorang cashier **tidak mempunyai jalur UI, browser navigation, API request langsung, refresh, atau route manipulation** yang dapat membuatnya menggunakan POS sebelum seluruh mandatory onboarding selesai.

**Final locked rule:**

> Cashier yang diundang wajib menyelesaikan Accept Invitation → Set PIN → Nama Lengkap + NIK secara berurutan. Seluruh proses mandatory dan non-dismissible. POS baru boleh digunakan setelah backend menyatakan onboarding cashier `IDENTITY_COMPLETED`.
