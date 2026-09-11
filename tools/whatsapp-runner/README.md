# Xentra Core WhatsApp Runner

Daemon mandiri berbasis **Node.js** dan **Baileys (WhatsApp Web Multi-Device)** yang memungkinkan Anda menjalankan pengujian otomatis dan deployment **Xentra Core** langsung dari **aplikasi WhatsApp di HP Anda** tanpa memerlukan PC menyala.

---

## Fitur

- ✅ **Jalankan Unit Test** — Eksekusi test suite Xentra Core via perintah `!test`
- ✅ **Deployment Otomatis** — Commit & push ke main; GitHub Actions mendeploy ke app.mybangjo.com via `!deploy`
- ✅ **Cek Status** — Monitoring kesehatan bot via `!status`
- ✅ **Keamanan** — Whitelist nomor WhatsApp (`ALLOWED_WHATSAPP_NUMBERS`)
- ✅ **Session Persistensi** — Otomatis menyimpan sesi autentikasi WhatsApp (multi-file auth state)

---

## Prasyarat

- Node.js **>= 20.20.2**
- Nomor WhatsApp untuk scan QR Code (hanya sekali saat pertama kali setup)
- Repository Xentra Core sudah terhubung ke GitHub dengan GitHub Actions workflow `deploy-app.yml`

---

## Instalasi & Setup

```bash
# 1. Masuk ke direktori runner
cd xentra-core/tools/whatsapp-runner

# 2. Install dependencies
npm install

# 3. Salin file konfigurasi contoh
cp .env.example .env

# 4. Isi whitelist nomor WhatsApp:
#    ALLOWED_WHATSAPP_NUMBERS=628xxxxxxxxxx
#    (Bisa multi nomor dipisahkan koma: 628xxxx,628yyyy)

# 5. Jalankan bot
npm start
```

Saat pertama kali dijalankan, bot akan menampilkan **QR Code** di terminal. Scan dengan WhatsApp di HP Anda:
> Buka WA → Titik tiga (⋮) → Perangkat tertaut → Tautkan perangkat

Setelah scan berhasil, bot akan otomatis terhubung dan siap menerima perintah.

---

## Perintah Bot

| Perintah | Deskripsi |
|----------|-----------|
| `!start` / `!help` | Tampilkan bantuan |
| `!status` | Cek status bot (online, workspace, deploy target) |
| `!test` | Jalankan full unit test suite Xentra Core |
| `!deploy` | Commit semua perubahan & push ke main (trigger GitHub Actions deploy) |

*Format fleksibel: `!test`, `! test`, `/test`, `/ test` semuanya valid.*

---

## Keamanan

- Hanya nomor yang terdaftar di `ALLOWED_WHATSAPP_NUMBERS` yang bisa mengontrol bot
- Jika kosong, **semua nomor diizinkan** (mode development)
- Sesuai WhatsApp Web Multi-Device, session disimpan lokal di folder `auth_session/`

---

## Deployment Otomatis

Perintah `!deploy` melakukan:
1. `git add -A` — stage semua perubahan
2. `git commit -m "<pesan>"` — commit dengan pesan default atau custom
3. `git push origin main` — push ke GitHub

GitHub Actions workflow `deploy-app.yml` akan otomatis mendeploy ke **app.mybangjo.com**.

---

## Logs & Debugging

- Semua aktivitas dicetak ke console (stdout/stderr)
- Error koneksi WhatsApp akan trigger reconnect otomatis
- Gunakan `pino` untuk logging terstruktur (level: silent default)

---

## Catatan Penting

- Bot ini **bukan AI agent** — hanya mengeksekusi perintah terstruktur
- Untuk modifikasi kode kompleks, gunakan workflow development standar (IDE + Git)
- Pastikan repository sudah clean (no uncommitted secrets) sebelum `!deploy`