# 🤖 Xentra Core — Telegram AI Agent Runner

Daemon mandiri berbasis **Node.js** dan **Gemini Flash API** yang memungkinkan Anda mengontrol pengembangan, refactoring kode, pengujian otomatis, dan deployment **Xentra Core** langsung dari **aplikasi Telegram di HP Anda** tanpa memerlukan PC menyala.

---

## 🌟 Fitur Utama

1. **Remote Coding via Chat:**
   - Cukup kirim chat instruksi (misal: *"Ubah diskon ongkir jadi Rp 10.000 untuk minimal belanja Rp 50.000 lalu deploy"*).
   - Bot akan membaca kode, melakukan modifikasi file, menjalankan automated tests, lalu commit & push ke main; GitHub Actions (deploy-app.yml) otomatis mendeploy ke `app.mybangjo.com`.
2. **Whitelist Keamanan Ketat:**
   - Hanya akun Telegram dengan `TELEGRAM_ALLOWED_USER_ID` terdaftar yang dapat memberikan perintah.
3. **Zero Inbound Port / No Webhook Setup:**
   - Menggunakan *Long-Polling* resmi Telegram API, sehingga bot bisa berjalan di server manapun (cPanel Node App, VPS, Docker, dsb.) tanpa butuh port terbuka khusus atau domain HTTPS.
4. **Auto-Testing & Auto-Deploy:**
   - Bot otomatis memverifikasi perubahan dengan `node --test tests/**/*.test.js` sebelum melakukan git push; GitHub Actions (deploy-app.yml) otomatis mendeploy ke `app.mybangjo.com`.

---

## 🚀 Panduan Setup Singkat (3 Langkah)

### 1. Dapatkan Token & ID
1. Buat bot di Telegram via **`@BotFather`** ➡️ catat **`TELEGRAM_BOT_TOKEN`**.
2. Cek User ID Telegram Anda via **`@userinfobot`** ➡️ catat angka **`Id`** Anda.
3. Ambil API Key gratis di **[Google AI Studio](https://aistudio.google.com/app/apikey)** ➡️ catat **`GEMINI_API_KEY`**.

### 2. Isi File `.env`
Salin `.env.example` menjadi `.env`:
```bash
cp .env.example .env
nano .env
```
Isi ketiga nilai di atas:
```ini
TELEGRAM_BOT_TOKEN=123456789:ABCDefgh-your-token
TELEGRAM_ALLOWED_USER_ID=987654321
GEMINI_API_KEY=AIzaSyD...your-gemini-key
GEMINI_MODEL=gemini-2.5-flash
```

### 3. Jalankan Bot 24/7 di Server
Jalankan bot:
```bash
node bot.js
```
Atau gunakan **PM2** agar selalu restart otomatis di background server:
```bash
npm install -g pm2
pm2 start bot.js --name "xentra-telegram-bot"
pm2 save
```

---

## 📱 Contoh Perintah dari HP

- `/status` — Memeriksa status kesehatan bot dan koneksi workspace.
- `/test` — Menjalankan automated test suite Xentra Core.
- `/deploy` — Mendeploy perubahan codebase terbaru langsung ke cPanel.
- *"Tolong tambahkan kategori baru 'Paket Hemat' dengan 2 menu di seeder database dan jalankan test"*
- *"Ganti warna tema primer menjadi #b6ff00 dan perbarui tagline brand"*
