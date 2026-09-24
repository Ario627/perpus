# Katalog Buku Perpustakaan

Aplikasi web client-side untuk mengelola katalog dan inventaris buku perpustakaan sekolah.
Tanpa backend, tanpa build step, tanpa framework. Data disimpan di `localStorage` perangkat.

## Menjalankan

Semua berkas memakai ES module, jadi harus dibuka lewat server lokal.

    python3 -m http.server 8000

Lalu buka `http://localhost:8000`.

Membuka `index.html` langsung lewat `file://` akan memunculkan peringatan di halaman dan
seluruh JavaScript tidak akan jalan, karena browser memblokir modul pada protokol itu.

## Berkas

| Berkas | Isi |
| --- | --- |
| `index.html` | Struktur halaman, formulir, daftar buku, dialog pemindai, bilah aksi mobile |
| `style.css` | Token desain dan komponen di luar utility Tailwind |
| `config.js` | Preferensi kamera yang tersimpan di perangkat |
| `app.js` | CRUD, render, penyimpanan, ekspor/impor, orkestrasi alur pemindaian |
| `isbn-validate.js` | Normalisasi, checksum ISBN-10 dan ISBN-13, konversi ISBN-10 ke ISBN-13 |
| `isbn-map.js` | Pemetaan respons Google Books dan Open Library, saran kategori |
| `isbn-api.js` | Pencarian data buku dari sisi browser, dengan proxy sebagai jalur utama |
| `scanner.js` | Pembungkus `html5-qrcode` dengan state machine dan enumerasi kamera |
| `api/isbn.js` | Fungsi serverless Vercel: pencarian data buku dari sisi server |
| `api/cover.js` | Fungsi serverless Vercel: pengambilan sampul dengan penyaringan placeholder |
| `package.json` | Menandai project sebagai ESM untuk runtime Node di Vercel |

## Alur pemakaian

Di layar kecil, bilah aksi tetap di bawah menempatkan **Pindai ISBN** sebagai tombol utama dan
**Tambah manual** sebagai jalur cadangan di bawahnya. Di layar besar, formulir selalu terlihat
di kolom kiri.

1. **Pindai ISBN** membuka kamera, membaca barcode EAN-13, memvalidasi checksum sebelum
   menyentuh jaringan, lalu mencari data buku.
2. Kalau data ketemu, formulir terisi otomatis dan kategori dari API muncul sebagai saran
   yang bisa dipakai atau diabaikan.
3. Kalau data tidak ketemu, ISBN tetap terisi dan sisanya diisi manual.
4. Simpan. Buku masuk ke katalog.

Pencarian data juga bisa dipicu tanpa kamera: ketik ISBN lalu tekan **Cari**. Hasilnya
muncul sebagai catatan kecil di bawah kolom ISBN, bukan di dalam dialog kamera.

Barcode yang terbaca tapi tidak lolos checksum tidak menutup kamera. Pemindai tetap hidup
dan menampilkan penanda peringatan, jadi petugas cukup menggeser posisi tanpa membuka ulang
dialog.

## Sampul buku

Sampul diambil dari tiga sumber berurutan: URL sampul dari respons API, proxy `/api/cover`
berdasarkan ISBN, lalu sampul Open Library langsung dari browser. Sumber pertama dipakai saat
pencarian berhasil. Sumber kedua dan ketiga membuat buku yang diisi manual tetap punya
peluang mendapat sampul, selama ISBN-nya diisi.

Kalau ketiganya tidak ada, sampul diganti inisial judul dengan warna yang diturunkan dari
judul itu sendiri, jadi setiap baris tetap punya penanda visual yang berbeda.

### Kenapa ada proxy sampul

Google Books tidak mengembalikan 404 saat sampul tidak ada. Yang dikembalikan adalah
**HTTP 200 berisi gambar placeholder abu-abu**, sehingga browser menganggapnya gambar yang
sah dan tidak pernah menjalankan penanganan galat. Akibatnya rantai fallback berhenti di
titik itu dan yang terlihat di katalog adalah kotak abu-abu kosong.

Sampul tidak bisa diperiksa dari browser karena membaca piksel gambar dari domain lain
diblokir oleh kebijakan lintas asal. Proxy ini memindahkan pemeriksaan itu ke server, tempat
byte gambar bisa dibaca langsung. Sebuah gambar ditolak kalau:

- Ukurannya di bawah 3 KB, karena placeholder Google hanya sekitar 1,3 KB
- Bertipe PNG berskala kelabu, karena placeholder Google grayscale sedangkan sampul asli JPEG
- Dimensinya persis sama dengan templat placeholder penyedia

Hasil yang lolos di-cache di edge selama 30 hari, jadi satu ISBN hanya diambil sekali.

Menekan sampul membuka halaman buku tersebut di Google Books. Tautan hanya aktif kalau buku
punya ISBN, karena alamatnya dibentuk dari ISBN. Buku tanpa ISBN tetap menampilkan sampul
inisial, tapi tidak bisa ditekan.

## Kunci Google Books API

**Petugas perpustakaan tidak perlu mengurus kunci API sama sekali.** Aplikasi tetap berjalan
tanpa konfigurasi apa pun. Kunci hanya relevan kalau kamu ingin kuota Google Books yang lebih
besar, dan kunci itu dipasang sekali oleh yang men-deploy, bukan oleh pemakai.

### Kenapa kunci tidak boleh ada di berkas front-end

Apa pun yang dikirim ke browser bisa dibaca siapa saja lewat alat pengembang. Menaruh kunci di
berkas JavaScript, di `localStorage`, atau di variabel apa pun di sisi klien tidak
menyembunyikannya. Karena itu kunci **tidak pernah** menyentuh browser di aplikasi ini.

### Cara memasang kunci di Vercel

1. Buat kunci di Google Cloud Console, bagian Kredensial, lalu aktifkan Books API.
2. Batasi kunci tersebut. Pada pembatasan API, pilih hanya **Books API**. Pada pembatasan
   aplikasi, pilih **None** — karena kunci ini hanya dipakai dari server, bukan dari browser,
   jadi pembatasan perujuk HTTP justru akan memblokirnya.
3. Di dashboard Vercel, buka project, masuk ke **Settings → Environment Variables**.
4. Tambahkan `GOOGLE_BOOKS_API_KEY` dengan nilai kunci tersebut.
5. Tambahkan juga `OPEN_LIBRARY_CONTACT` berisi alamat email atau nomor kontak kamu. Ini
   dipakai sebagai `User-Agent` saat memanggil Open Library, sesuai etika pemakaian API
   publik mereka, dan menaikkan batas dari 1 menjadi 3 permintaan per detik.
6. Redeploy supaya variabel lingkungan terbaca.

Kedua variabel bersifat opsional. Kalau `GOOGLE_BOOKS_API_KEY` tidak diisi, pencarian
melewati Google Books dan langsung memakai Open Library.

## Deploy ke Vercel

Project ini tidak butuh konfigurasi build. Vercel menyajikan berkas statis dari root dan
menjalankan berkas di dalam `api/` sebagai fungsi serverless secara otomatis.

    npx vercel

Untuk mencoba lengkap dengan fungsi serverless dan variabel lingkungan di komputer sendiri:

    npx vercel dev

Perlu diketahui: `python3 -m http.server` tidak menjalankan fungsi serverless, jadi saat
dites dengan cara itu aplikasi otomatis memakai jalur pencarian langsung dari browser. Ini
memang disengaja supaya pengembangan lokal tetap jalan tanpa konfigurasi. Konsekuensinya
kuota yang dipakai adalah kuota anonim yang lebih terbatas, dan tidak ada cache di edge.

### Cara kerja pencarian

    Browser
       |
       +-- GET /api/isbn?isbn=9780136021212
       |      |
       |      +-- Google Books (dengan kunci dari env, kalau ada)
       |      +-- Open Library  (dengan User-Agent yang benar)
       |      +-- hasil di-cache di edge Vercel
       |
       +-- GET /api/cover?isbn=9780136021212
       |      |
       |      +-- Open Library Covers
       |      +-- Google Books content
       |      +-- placeholder ditolak, gambar sah di-cache di edge
       |
       +-- kalau /api tidak tersedia (server statis biasa)
              |
              +-- Google Books tanpa kunci
              +-- Open Library langsung dari browser

Kedua jalur mengembalikan bentuk data yang sama, jadi antarmuka tidak perlu tahu sedang
lewat jalur mana. Logika pemetaan respons berada di satu tempat, `isbn-map.js`, dan dipakai
oleh browser maupun server.

Caching di edge adalah alasan utama proxy ini ada. Satu ISBN yang sama hanya dipanggil sekali
ke penyedia API, berapa pun jumlah pengunjungnya.

## Penyimpanan dan cadangan

Data hanya ada di browser perangkat yang dipakai. Membersihkan data browsing, berganti
perangkat, atau memasang ulang sistem operasi akan menghilangkan katalog.

Tombol **Ekspor JSON** dan **Impor JSON** ada di bagian bawah halaman. Impor bersifat
menggabungkan, bukan menimpa: buku dengan `id` yang sama akan diperbarui, sisanya ditambahkan.
Data yang sudah ada tidak pernah dihapus oleh proses impor.

## Kebutuhan browser dan kamera

- Kamera hanya bisa diakses lewat HTTPS atau `localhost`. Kalau diuji di jaringan sekolah
  memakai alamat IP biasa, tombol unggah foto barcode jadi jalur satu-satunya.
- Status izin dibaca lewat Permissions API sebelum kamera diminta, supaya pesan yang muncul
  bisa membedakan antara "belum diizinkan" dan "diblokir permanen".
- `BarcodeDetector` bawaan browser dipakai otomatis kalau tersedia (Chrome, Edge, Android).
  Sisanya jatuh ke ZXing di dalam `html5-qrcode`.
- Kamera dipilih lewat `deviceId`, bukan `facingMode`. Ini menghindari kegagalan di laptop
  yang hanya punya satu kamera depan. Kalau perangkat punya lebih dari satu kamera, muncul
  pemilih kamera di dialog pemindai, dan pilihan terakhir diingat.
- Tombol lampu muncul hanya kalau kamera yang sedang jalan melaporkan dukungan `torch`.
- iOS Safari mendukung akses kamera web sejak versi 15.1. Versi di bawah itu hanya bisa
  memakai unggah foto.
- Kamera otomatis dijeda saat tab berpindah ke latar belakang.

## Pemeriksaan manual

| Skenario | ISBN uji | Harapan |
| --- | --- | --- |
| Ketemu di Google Books | `9780132350884` | Formulir terisi, sumber tertulis Google Books |
| Ketemu di Open Library | `9780547928227` | Formulir terisi, sumber tertulis Open Library |
| Buku terbitan lokal | ISBN asli berawalan `978-602-` atau `978-623-` | Tidak ketemu, formulir lanjut manual |
| Checksum rusak | Ubah satu digit dari ISBN valid mana pun | Ditolak sebelum ada permintaan jaringan, kamera tetap hidup |
| ISBN-10 lama | `0132350882` | Dikonversi ke `9780132350884`, hasil sama dengan versi ISBN-13 |
| Koneksi mati | ISBN mana pun | Pesan koneksi gagal, bukan pesan buku tidak ditemukan |
| Fungsi serverless mati | Ganti nama folder `api`, muat ulang | Pencarian tetap jalan lewat jalur browser langsung |
| Duplikat | ISBN yang sudah ada di katalog | Peringatan eksemplar, penyimpanan tetap boleh |
| Impor | Berkas hasil ekspor | Buku bertambah, tidak ada yang hilang |

## Batasan yang disengaja

- Satu perangkat saja. Tidak ada sinkronisasi antar komputer atau tablet.
- Tidak ada autentikasi. Siapa pun yang membuka halaman bisa mengubah katalog.
- Tidak ada fitur peminjaman. Ini murni katalog dan inventaris.
- Cakupan API terbatas untuk buku Indonesia. Pengisian otomatis adalah percepatan input,
  bukan jaminan. Perpusnas tidak menyediakan API publik untuk lookup ISBN.
- `localStorage` dibatasi sekitar 5 sampai 10 MB per origin. Sampul disimpan sebagai URL,
  bukan data base64, supaya batas ini tidak cepat tercapai.
