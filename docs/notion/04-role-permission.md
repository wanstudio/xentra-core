<!-- SNAPSHOT FROM NOTION — source page: 04-role-permission; fetched 2026-09-04 -->

Permission dikelola oleh Xentra-Core menggunakan Role-Based Access Control.
## Role yang sudah dibahas
- Owner
- Manager/operasional branch
- Kasir
## Kasir
- Fokus pada transaksi yang menjadi kewenangannya.
- Dapat melakukan absensi sesuai kewenangan.
- Tidak dapat mengubah stok.
- Tidak dapat melihat data karyawan lain di luar kewenangan.
## Rule
Domain bisnis tidak membuat permission system sendiri. Semua domain membaca authorization dari Core.
## Belum Dikunci
Daftar role final, permission matrix lengkap, delegation, approval authority per action, dan emergency access.
