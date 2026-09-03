<!-- SNAPSHOT FROM NOTION — source page: 03-business-flow; fetched 2026-09-04 -->

# Product Flow
1. Owner membuat product pada master catalog.
2. Owner menentukan branch yang menjual produk.
3. Branch menerima notice produk baru.
4. Branch memasukkan stok awal.
5. Produk digunakan sesuai status dan aturan harga.
# Price Flow
1. Owner memilih Lock atau Range.
2. Branch melihat aturan pada field harga.
3. Lock: field tidak editable.
4. Range: branch mengisi nilai dalam batas minimum–maksimum.
5. Nilai di luar range ditolak.
# Deactivation Flow
1. Branch menonaktifkan produk.
2. Produk tidak aktif pada branch tersebut.
3. Business Log mencatat tindakan.
4. Owner dapat melihat branch yang melakukan perubahan.
# Governance Flow
1. Branch membutuhkan perubahan kebijakan.
2. Branch mengajukan request.
3. Owner approve atau reject.
4. Jika approve, owner melakukan perubahan.
# Payment / Delivery
Commerce dapat meminta tarif delivery. Delivery menghasilkan informasi ongkir. Payment memproses pembayaran. Kontrak API detail belum dikunci.
# POS Flow (Point of Sale Kasir)
## 1. Shift & Cash Control Flow
-
	1. Kasir login memilih cabang tugas sesuai kredensial RBAC (cashier).
- **Locked Decision — Cash Settlement & Active Shift:** `shift_id` boleh **tidak dikirim oleh client**. Untuk role `cashier`, server wajib melakukan **Auto-Attach Active Shift** berdasarkan authenticated cashier + `order.branch_id`, dengan syarat shift berstatus `open`. Jika tidak ada active shift, cash settlement ditolak (fail-closed). Client tidak boleh menentukan atau mengarahkan settlement ke `shift_id` milik kasir/cabang lain.
- Untuk `owner` / `brand_manager` yang memiliki kewenangan override, settlement darurat dapat dilakukan tanpa shift kasir sesuai policy RBAC. Ini adalah exception operasional yang harus tetap tercatat di audit trail.
- **Invariant:** cashier cash settlement → `cashier_id = authenticated user` + `shift.branch_id = order.branch_id` + `shift.status = open` → settlement dan pencatatan expected cash terjadi dalam transaction yang konsisten.
### Cash Payment Lifecycle (Business Decision)
- Cash/COD/POS order dapat memiliki `orders.status = confirmed` sementara `order_payments.payment_status = pending`. Ini **VALID**, karena order lifecycle (kitchen/fulfillment/inventory) terpisah dari financial lifecycle (uang fisik belum diterima).
- Setelah uang benar-benar diterima oleh kasir/actor yang berwenang, payment berubah menjadi `settlement`.
- Payment cash yang masih `pending` tidak dihitung sebagai cash revenue yang sudah diterima.
- Cash settlement adalah **financial mutation** dan wajib melewati authorization + scope validation + idempotency.
- Server harus memverifikasi bahwa order memang menggunakan metode cash sebelum cash settlement. Cash settlement tidak boleh menjadi side-door untuk mengubah order Midtrans/non-cash menjadi cash atau menghidupkan kembali order yang sudah cancelled.
-
	1. Kasir wajib membuka Shift Kasir (Open Shift) dengan memasukkan modal kas awal (Starting Float Cash).
-
	1. Selama shift berjalan: Kasir mencatat kas masuk (Cash In) atau kas keluar (Cash Out) operasional beserta alasan bisnis. Sistem mencatat seluruh penerimaan kas & non-kas.
-
	1. Kasir menutup Shift (Close Shift): Kasir menghitung dan menginput total uang fisik aktual di laci (Actual Cash Count). Sistem menghitung selisih kas (Cash Variance: Over/Short) terhadap perhitungan sistem (Expected Cash). Event pos.shift.closed dipancarkan dan terekam di Business Evidence / Audit Log.
## 2. Order Taking & Bill State Lifecycle
-
	1. Kasir memilih tipe order resmi Xentra: dinein, pickup, atau delivery.
-
	1. Untuk pesanan dinein: Kasir dapat mengalokasikan nomor meja / Identifier, menahan tagihan sementara (Hold / Open Bill), dan menambah item pesanan sebelum pelunasan.
-
	1. Kasir mendukung alur Split Bill (pemisahan tagihan) dan Merge Bill (penggabungan tagihan).
## 3. Multiple Payment Settlement & Hardware Output
-
	1. Kasir melayani penyelesaian transaksi dengan metode pembayaran: Tunai (cash dengan kalkulasi kembalian otomatis), QRIS, EDC / Kartu, Transfer, dan Split Payment.
-
	1. Otoritas mutasi stok didelegasikan ke Commerce/Inventory via event contract (pos.order.placed) tanpa manipulasi langsung tabel stok oleh POS.
-
	1. Saat pesanan diselesaikan (Paid / Settled): Perintah cetak struk dikirim ke Printer Kasir (dan membuka Cash Drawer via printer trigger), serta perintah cetak tiket dapur dikirim ke Kitchen Ticket Printer / KDS.
## 4. Offline Operational Continuity & Risk Limits
-
	1. Kasir mendukung operasional pencatatan pesanan dan pembayaran tunai secara lokal saat koneksi internet terputus (Local-First Continuity).
-
	1. Transaksi offline menggunakan client_transaction_id (Idempotency Key) untuk mencegah duplikasi saat sinkronisasi kembali online. Transaksi tunai offline yang sah dan struknya telah dicetak diperlakukan sebagai Authoritative Historical Capture oleh server saat rekonsiliasi.
-
	1. Offline Risk Limit Policy (Fail-Fast Rule): Owner menetapkan batas atas risiko offline global (Global Safety Ceiling). Branch Manager mengonfigurasi batas operasional cabang di dashboard. Jika konfigurasi Branch \<= Safety Ceiling Owner: Diterima & Aktif. Jika konfigurasi Branch \> Safety Ceiling Owner: Ditolak seketika (Validation Error) dengan pesan batas maksimum yang diizinkan (Dilarang auto-clamp diam-diam).
-
	1. Jika device rusak total sebelum sync, rekonsiliasi finansial diselesaikan melalui Cash Variance & Physical Receipt Audit Trail.
