# 💬 Xentra Core — WhatsApp AI Agent Runner

Daemon mandiri berbasis **Node.js**, **Baileys (WhatsApp Web Multi-Device)**, dan **Gemini Flash API** yang memungkinkan Anda mengontrol pengembangan, modifikasi kode, automated testing, dan deployment **Xentra Core** langsung dari **aplikasi WhatsApp di HP Anda** tanpa memerlukan PC menyala.

---

## 🌟 Fitur Unggulan

1. **100% Gratis & Tanpa Bayar:**
   - Menggunakan koneksi WhatsApp Web Multi-Device resmi (gratis selamanya).
   - Menggunakan Gemini Flash API (tier gratis dari Google AI Studio).
2. **Kirim Instruksi via Chat WA Sehari-hari:**
   - Cukup kirim chat biasa dari HP Anda (misal: *"Ubah diskon ongkir jadi 10rb untuk minimal belanja 50rb di cabang Surabaya Barat, jalankan test, lalu deploy ke cPanel"*).
3. **Whitelist Keamanan Nomor HP:**
   - Hanya nomor WhatsApp operator yang terdaftar di `ALLOWED_WHATSAPP_NUMBERS` yang dapat memerintah bot. Pesan dari orang lain otomatis diabaikan.
4. **Automated Testing & Auto-Deploy:**
   - Bot otomatis memverifikasi kode dengan `node --test tests/**/*.test.js` sebelum melakukan `git push`; GitHub Actions (deploy-app.yml) otomatis mendeploy ke `app.mybangjo.com`.

---

## 🚀 Panduan Setup Singkat (3 Langkah)

### 1. Buat File `.env`
Di folder `xentra-core/tools/whatsapp-runner/`:
```bash
cp .env.example .env
nano .env
```
Isi whitelist nomor WhatsApp dan Gemini API Key:
```ini
ALLOWED_WHATSAPP_NUMBERS=628xxxxxxxxxx

GEMINI_API_KEY=AIzaSyD...your-gemini-key
GEMINI_MODEL=gemini-2.5-flash
```

### 2. Install Dependensi & Jalankan Bot Pertama Kali
```bash
cd xentra-core/tools/whatsapp-runner
npm install
node bot.js
```

### 3. Scan QR Code dari WhatsApp HP Anda
1. Di terminal akan muncul **QR Code**.
2. Buka WhatsApp di HP ➡️ Tekan **Titik Tiga** di kanan atas (atau Pengaturan) ➡️ Pilih **Perangkat Tertaut (Linked Devices)** ➡️ Tekan **Tautkan Perangkat (Link a Device)**.
3. Scan QR Code di layar terminal.
4. 🎉 **Selesai!** Bot langsung online dan sesi tersimpan di folder `auth_session/`. Anda tidak perlu scan lagi saat restart.

### 4. Jalankan 24/7 di Background Server
Agar bot tetap berjalan di server saat PC Anda dimatikan:
```bash
npm install -g pm2
pm2 start bot.js --name "xentra-wa-bot"
pm2 save
```

---

## 📱 Contoh Perintah dari HP

- `!status` — Memeriksa status bot dan server.
- `!test` — Menjalankan automated test suite.
- `!deploy` — Mendeploy perubahan codebase terbaru langsung ke cPanel.
- *"Tolong tambahkan kategori baru 'Paket Hemat' dengan 2 menu di seeder database dan jalankan test"*
- *"Ganti warna tema primer menjadi #b6ff00 dan perbarui tagline brand"*
