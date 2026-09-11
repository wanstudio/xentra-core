# Xentra Core Telegram Runner

Daemon mandiri berbasis **Node.js** yang memungkinkan Anda menjalankan pengujian otomatis dan deployment **Xentra Core** langsung dari **aplikasi Telegram di HP Anda** tanpa memerlukan PC menyala.

---

## Fitur

- ✅ **Jalankan Unit Test** — Eksekusi test suite Xentra Core via perintah `/test`
- ✅ **Deployment Otomatis** — Commit & push ke main; GitHub Actions mendeploy ke infrastruktur Xentra via `/deploy`
- ✅ **Cek Status** — Monitoring kesehatan bot via `/status`
- ✅ **Keamanan** — Whitelist User ID Telegram (`TELEGRAM_ALLOWED_USER_ID`)

---

## Prasyarat

- Node.js **>= 20.20.2**
- Telegram Bot Token dari [@BotFather](https://t.me/BotFather)
- Telegram User ID Anda (dapatkan via [@userinfobot](https://t.me/userinfobot))
- Repository Xentra Core sudah terhubung ke GitHub dengan GitHub Actions workflow deployment

---

## Instalasi & Setup

```bash
# 1. Masuk ke direktori runner
cd xentra-core/tools/telegram-runner

# 2. Install dependencies
npm install

# 3. Salin file konfigurasi contoh
cp .env.example .env

# 4. Isi konfigurasi:
#    TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
#    TELEGRAM_ALLOWED_USER_ID=123456789

# 5. Jalankan bot
npm start
```

---

## Perintah Bot

| Perintah | Deskripsi |
|----------|-----------|
| `/start` / `/help` | Tampilkan bantuan |
| `/status` | Cek status bot (online, workspace, deploy target) |
| `/test` | Jalankan full unit test suite Xentra Core |
| `/deploy` | Commit semua perubahan & push ke main (trigger GitHub Actions deploy) |

---

## Keamanan

- Hanya User ID yang terdaftar di `TELEGRAM_ALLOWED_USER_ID` yang bisa mengontrol bot
- Jika kosong, **semua user diizinkan** (mode development)

---

## Deployment Otomatis

Perintah `/deploy` melakukan:
1. `git add -A` — stage semua perubahan
2. `git commit -m "<pesan>"` — commit dengan pesan default atau custom
3. `git push origin main` — push ke GitHub

GitHub Actions akan otomatis mendeploy ke infrastruktur runtime Xentra yang dikonfigurasi.

---

## Logs & Debugging

- Semua aktivitas dicetak ke console (stdout/stderr)
- Error polling Telegram akan retry otomatis setiap 2 detik

---

## Catatan Penting

- Bot ini **bukan AI agent** — hanya mengeksekusi perintah terstruktur
- Untuk modifikasi kode kompleks, gunakan workflow development standar (IDE + Git)
- Pastikan repository sudah clean (no uncommitted secrets) sebelum `/deploy`