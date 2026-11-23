# YAPP — Tahap 0 sampai 4

*Let's Yapp for better English.*

Web app komunitas berbasis Google Apps Script (GAS).

- **Tahap 1:** login, registrasi, persetujuan akun, dashboard, direktori anggota, profil, pengaturan, dan Admin Panel.
- **Tahap 2:** chat pribadi, grup, lampiran file, status online/terbaca, dan notification center.
- **Tahap 3:** forum diskusi, materi pembelajaran, pengumuman, agenda kegiatan, dan dashboard lengkap.
- **Tahap 4:** lapor konten & halaman Moderasi, pencarian global, pengaturan aplikasi, privasi chat, bisukan percakapan, cache, metrik, dan alat uji beban.

## Isi folder

| File di folder ini | Nama file di editor Apps Script | Isi |
| --- | --- | --- |
| appsscript.json | appsscript.json | Manifest: zona waktu, runtime V8, pengaturan web app |
| Config.gs | Config | Pengaturan aplikasi, role, status, skema 20 tabel, matriks izin |
| Util.gs | Util | Error, ID, waktu, hash password, cache, rate limit, validasi |
| Db.gs | Db | Repository Spreadsheet (baca/tulis berdasarkan nama kolom, LockService) |
| Acl.gs | Acl | Sesi login, pemeriksaan akses, log audit |
| Auth.gs | Auth | Registrasi, login, logout, ganti/lupa/reset password |
| Users.gs | Users | Direktori anggota, profil, foto profil, status online |
| Admin.gs | Admin | Persetujuan pendaftaran, kelola pengguna & role, log, backup |
| Dashboard.gs | Dashboard | Ringkasan dashboard dan heartbeat |
| Code.gs | Code | doGet() dan router api() |
| Setup.gs | Setup | setup(), trigger harian, backup, pemulihan Super Admin |
| Chat.gs | Chat | Percakapan terpadu, sinkronisasi berbasis versi, kirim/hapus/balas, tanda baca, pencarian |
| Groups.gs | Groups | Buat/gabung/keluar grup, admin grup, tambah/keluarkan anggota, foto & info grup |
| Files.gs | Files | Unggah lampiran (validasi jenis & isi), gambar mini, unduh dengan pemeriksaan akses |
| Notifications.gs | Notifications | Notification center, termasuk notifikasi massal |
| Forum.gs | Forum | Topik, balasan & komentar, reaksi, sematkan/kunci/tandai penting, hapus dengan alasan |
| Resources.gs | Resources | Materi file/tautan, antrean persetujuan Moderator, hitungan unduhan |
| Announcements.gs | Announcements | Pengumuman berprioritas, target audiens, jadwal tayang & berakhir |
| Events.gs | Events | Agenda, pendaftaran & kuota, konfirmasi hadir, pengingat H-1 |
| Reports.gs | Reports | Laporan konten & antrean moderasi |
| Search.gs | Search | Pencarian global |
| Settings.gs | Settings | Pengaturan aplikasi (pendaftaran, persetujuan materi, banner) |
| Metrics.gs | Metrics | Metrik beban per menit untuk tab Sistem & metrik |
| UjiBeban.gs | UjiBeban | `buatAkunUji(20)` dan `nonaktifkanAkunUji()` untuk uji beban |
| index.html | index | Halaman utama |
| styles.html | styles | CSS: minimalis + glassmorphism, terang/gelap, responsif |
| logo.html | logo | Logo YAPP dalam bentuk vektor (SVG) |
| js_app.html | js_app | Inti frontend: API, sesi, router, tema, fullscreen, refresh |
| js_views.html | js_views | Halaman Tahap 1 |
| js_chat.html | js_chat | Halaman chat, grup, dan notifikasi |
| js_community.html | js_community | Halaman forum, materi, pengumuman, dan agenda |
| js_moderation.html | js_moderation | Lapor konten, halaman Moderasi, pencarian global (Ctrl+K) |
| .clasp.json.example | *(tidak di-push)* | Contoh konfigurasi `clasp` — salin jadi `.clasp.json` lalu isi Script ID Anda |
| package.json | *(tidak di-push)* | Skrip `npm run push/deploy/logs` memakai `clasp` |
| .gitignore | *(tidak di-push)* | Mencegah kredensial clasp & file sementara ikut di-commit |
| .github/workflows/deploy-gas.yml | *(tidak di-push)* | GitHub Actions: `clasp push` otomatis setiap push ke `main` |

## Cara memasang (sekali saja)

1. **Siapkan akun Gmail khusus aplikasi** (disarankan, bukan akun sehari-hari).
   Aktifkan verifikasi 2 langkah dan tambahkan email pemulihan milik pengurus.
2. Buka <https://script.google.com> → **New project**. Beri nama `YAPP`.
3. **Project Settings** (ikon roda gigi) → centang *Show "appsscript.json" manifest file in editor*.
   Lalu ganti isi `appsscript.json` dengan file dari folder ini.
4. Buat semua file lain (tombol **+** → *Script* untuk .gs, *HTML* untuk .html).
   Nama file di editor **tanpa ekstensi** dan harus sama persis, mis. `js_app`, bukan `js_app.html`.
   Salin isinya satu per satu. Hapus file bawaan `Code.gs` lalu ganti dengan `Code.gs` dari folder ini.
5. Buka `Setup.gs`, isi `SETUP_ADMIN.email` dengan email Super Admin. Ubah juga `full_name` bila perlu.
6. Pilih fungsi **setup** di toolbar → **Run**. Izinkan akses yang diminta.
   Jika muncul *"Google hasn't verified this app"*: klik **Advanced** → **Go to … (unsafe)**.
   Ini normal untuk script milik sendiri.
7. Buka **Execution log**, lalu salin baris `PASSWORD SEMENTARA: ...`.
8. Pilih fungsi **installTriggers** → **Run**. Ini memasang pembersihan harian (02.00), backup (03.00), dan tugas per jam
   (pengumuman terjadwal & pengingat agenda).
9. (Disarankan) Jalankan **testHashSpeed**. Jika hasilnya jauh di bawah 700 ms, naikkan
   `APP.HASH_ITERATIONS` di `Config.gs` (mis. 2000). Jika di atas 1 detik, turunkan.
   Password lama tetap bisa dipakai karena jumlah iterasi tersimpan di setiap hash.
10. **Deploy → New deployment** → jenis *Web app*:
    - Execute as: **Me**
    - Who has access: **Anyone**

    Klik **Deploy**, lalu salin URL yang berakhiran `/exec`. Inilah alamat aplikasi.
11. Buka URL itu, login dengan username `superadmin` dan password sementara.
    Langsung ganti password di menu **Pengaturan**.

`setup()` membuat folder **"YAPP - Data Aplikasi"** di Google Drive berisi:

- spreadsheet **DB Utama** (19 sheet) dan **DB Pesan** (1 sheet);
- folder `avatars`, `uploads`, dan `backups`.

Jangan bagikan spreadsheet atau folder ini ke siapa pun.

## Memperbarui kode

Setelah mengubah kode: **Deploy → Manage deployments** → ikon pensil → *Version: New version* → **Deploy**.
URL `/exec` tidak berubah. Jika ada kolom baru di `Config.gs`, jalankan `setup()` lagi. Fungsi ini aman dijalankan ulang:
hanya menambah sheet dan kolom yang belum ada.

**Dari Tahap 1 ke Tahap 2:**

1. Tambahkan file baru `Chat`, `Groups`, `Files`, `Notifications` (Script) dan `js_chat` (HTML).
2. Ganti semua file lama dengan versi baru.
3. Jalankan `setup()` sekali untuk menambah kolom baru: `direct_key`, `kind`, `reply_json`, `conv_id`, `thumb_data`.
4. Deploy versi baru.

## Deploy via GitHub (tanpa command line, kecuali 1 langkah sekali di awal)

Anda tidak perlu belajar `git` di terminal. Upload/edit file di GitHub bisa lewat
**drag & drop di web browser**, sama seperti kebiasaan Anda selama ini di editor Apps Script.
Hanya ADA SATU langkah (langkah 4 di bawah) yang butuh membuka terminal sekali seumur hidup
proyek ini, untuk mengambil "kunci" yang nantinya dipakai GitHub secara otomatis.

Tiga istilah dulu biar tidak bingung:

| Istilah | Maksudnya | Punya Anda |
| --- | --- | --- |
| **Script ID** | ID proyek Apps Script-nya sendiri | Dilihat di editor → Project Settings |
| **Deployment ID** | ID dari satu link `/exec` tertentu | `AKfycbyhYvR2MOKsHJNO6ZaS5fkSwKA0vt7hk9k5VwFEoLrA-LhHleoElDhL_m_1Sq4sX5GgUw` — ini diambil dari link web app Anda: `.../macros/s/`**`<deployment-id>`**`/exec` |
| **Kredensial clasp** | "Izin login" supaya GitHub boleh menulis ke Apps Script Anda | Didapat sekali lewat `clasp login` (langkah 4) |

Deployment ID di atas penting: supaya **link `/exec` yang sudah Anda bagikan ke anggota
tidak berubah**, update otomatis harus menimpa deployment itu juga, bukan cuma menyimpan kode.

**1. Buat repo di GitHub (lewat web, tanpa CLI)**

Buka github.com → tombol **+** → **New repository** → beri nama (misal `yapp-gas`) → **Create repository**.

**2. Upload semua file proyek (drag & drop, seperti biasa)**

Di halaman repo kosong tadi, klik **uploading an existing file** (atau menu **Add file → Upload files**).
Extract isi zip yang saya kirim, lalu **seret SEMUA ISI folder `yapp/`** (bukan folder `yapp` itu
sendiri — isinya saja: `Code.gs`, `index.html`, dst, termasuk folder `.github`) ke kotak upload itu,
lalu **Commit changes**.
> Folder `uji-lokal/` boleh ikut diupload atau dilewati (hanya dipakai pengembang untuk tes, tidak
> dibutuhkan Apps Script).

**3. Ambil Script ID**

Buka proyek Apps Script Anda di script.google.com → ikon gerigi **Project Settings** di sidebar kiri
→ salin **Script ID** di bagian atas.

**4. Satu-satunya langkah pakai terminal: ambil kredensial clasp**

Di komputer Anda (bukan di sini), install [Node.js](https://nodejs.org) kalau belum ada, lalu buka
Terminal/Command Prompt dan jalankan:
```
npm install -g @google/clasp
clasp login
```
Browser akan terbuka, login dengan **akun Gmail yang sama dengan pemilik script ini**, lalu izinkan.
Setelah itu, sebuah file `.clasprc.json` tersimpan di folder home Anda (`C:\Users\<nama>\.clasprc.json`
di Windows, atau `~/.clasprc.json` di Mac/Linux). Buka file itu dengan Notepad/TextEdit, dan **salin
semua isinya** (satu baris JSON panjang) — akan ditempel ke GitHub di langkah berikutnya.
Juga aktifkan dulu Apps Script API di <https://script.google.com/home/usersettings> (nyalakan toggle-nya)
kalau `clasp login` gagal.

**5. Masukkan 3 "kunci" ke GitHub (lewat web)**

Di repo GitHub Anda: **Settings → Secrets and variables → Actions → New repository secret**.
Buat 3 secret ini satu per satu:

| Nama secret | Isi |
| --- | --- |
| `CLASP_SCRIPT_ID` | Script ID dari langkah 3 |
| `CLASP_DEPLOYMENT_ID` | `AKfycbyhYvR2MOKsHJNO6ZaS5fkSwKA0vt7hk9k5VwFEoLrA-LhHleoElDhL_m_1Sq4sX5GgUw` (deployment Anda saat ini) |
| `CLASP_CREDENTIALS` | Seluruh isi `.clasprc.json` dari langkah 4, apa adanya |

**6. Selesai — cek hasilnya**

Buka tab **Actions** di repo GitHub Anda. Setelah upload di langkah 2, workflow **"Deploy ke Google
Apps Script"** otomatis berjalan (ikon kuning → hijau kalau sukses). Kalau belum sempat jalan (karena
secret baru diisi setelah upload), klik workflow itu → **Run workflow** untuk menjalankannya ulang.
Setelah hijau, buka link `/exec` Anda — kode terbaru sudah aktif di sana.

**Untuk update selanjutnya:** tinggal edit file langsung di GitHub (klik file → ikon pensil) atau
upload ulang file yang berubah lewat **Add file → Upload files** → **Commit changes**. GitHub Actions
otomatis menjalankan `clasp push` + memperbarui deployment yang sama, link `/exec` tidak berubah.

**Catatan keamanan:** isi `CLASP_CREDENTIALS` adalah "izin login" ke akun Gmail pemilik script.
GitHub Secrets terenkripsi dan tidak terlihat siapa pun (termasuk Anda sendiri setelah disimpan,
dan tidak muncul di log Actions) — tapi jangan pernah tempel isinya di tempat lain.

**Kalau tidak mau pakai GitHub Actions sama sekali:** tidak masalah — simpan kode di GitHub hanya
sebagai cadangan/riwayat versi, dan tetap deploy manual seperti biasa: drag & drop file ke editor
Apps Script, lalu **Deploy → Manage deployments → Edit (ikon pensil) → New version → Deploy**.

## Penting

- **Jangan hapus Script Property `PEPPER`.** Tanpa itu tidak ada password yang bisa diverifikasi.
- Lupa password Super Admin: jalankan `resetSuperAdminPassword()` dari editor, lalu ambil password baru di log.
- Email hanya dipakai untuk reset password, karena kuota Gmail 100 penerima per hari.
  Hasil persetujuan akun dilihat pendaftar dengan login ke halaman status.
- Ikon memakai Bootstrap Icons dan font Plus Jakarta Sans dari CDN, jadi perlu koneksi internet.

## Tampilan & merek

- Nama, tagline, dan ikon tab diatur di `Config.gs` (`APP.NAME`, `APP.TAGLINE`, `APP.FAVICON_URL`).
- Ikon tab browser: Apps Script hanya menerima URL gambar publik (PNG/ICO).
  Unggah logo ke hosting gambar publik, lalu isi `APP.FAVICON_URL`. Jika dikosongkan, tab memakai ikon Google bawaan.
- Warna utama diambil dari logo (merah). Untuk menggantinya, ubah `--primary`, `--primary-strong`, dan `--primary-rgb`
  di bagian atas `styles.html`.
- Efek kaca (blur) otomatis diganti panel pekat di perangkat yang tidak mendukungnya,
  atau bila pengguna mengaktifkan "kurangi transparansi" di sistem operasinya.

## Alur yang sudah berjalan

- Registrasi → status **Pending** → Admin menyetujui atau menolak (dengan alasan) di **Admin Panel → Pendaftaran**.
- Login akun Pending/Rejected/Suspended menampilkan halaman status, tanpa membuat sesi.
  Pendaftar yang ditolak bisa daftar ulang setelah 7 hari.
- Admin mengubah role (hanya ke role di bawahnya), jabatan, NIM, angkatan, dan kelas;
  menonaktifkan akun langsung mengeluarkan pengguna dari semua perangkat.
- Anggota mengatur foto, nama, kelas, HP, bio, privasi (sembunyikan NIM/HP/email), dan tema.
  Mereka juga bisa ganti password (perangkat lain otomatis keluar) dan keluar dari semua perangkat.
- Tombol header: refresh data, layar penuh (otomatis jadi *mode fokus* bila diblokir browser), dan saklar terang/gelap.
- Panel kanan menampilkan anggota online. Heartbeat dikirim tiap 60 detik dan berhenti saat tab tersembunyi.

**Dari Tahap 2 ke Tahap 3:**

1. Tambahkan file baru `Forum`, `Resources`, `Announcements`, `Events` (Script) dan `js_community` (HTML).
2. Ganti semua file lama dengan versi baru.
3. Jalankan `setup()` sekali untuk menambah kolom baru di `discussions`, `announcements`, `events`, dan `resources`.
4. Jalankan `installTriggers()` lagi agar trigger per jam (`hourlyJobs`) ikut terpasang.
5. Deploy versi baru.

**Dari Tahap 3 ke Tahap 4:**

1. Tambahkan file baru `Reports`, `Search`, `Settings`, `Metrics`, `UjiBeban` (Script) dan `js_moderation` (HTML).
2. Ganti semua file lama dengan versi baru.
3. Jalankan `setup()` sekali untuk menambah kolom baru di tabel `reports` dan pengaturan bawaan.
4. Deploy versi baru.

## Tahap 4: moderasi, pencarian, pengaturan, kinerja

- **Laporkan konten.** Tombol **Laporkan** ada di topik & balasan forum, pesan chat orang lain, kartu materi, dan profil anggota.
  - Pelapor memilih alasan; identitasnya tidak ditampilkan kepada yang dilaporkan.
  - Batas 10 laporan per jam per orang, dan konten yang sama tidak bisa dilaporkan dua kali oleh orang yang sama.
- **Halaman Moderasi** (Moderator ke atas, menu **Pengurus**, dengan badge jumlah laporan).
  - Laporan dikelompokkan per konten.
  - Tindakan: **Hapus konten**, **Beri peringatan**, atau **Abaikan**. Penulis menerima alasannya, pelapor diberi tahu hasilnya, dan semuanya tercatat di Log aktivitas.
  - Untuk pesan chat, moderator hanya melihat salinan pesan yang dilaporkan. Chat pribadi tetap tidak bisa dibuka moderator.
- **Pencarian global.** Ikon kaca pembesar di header, atau tekan **Ctrl+K**.
  - Mencari anggota, topik forum, materi, grup, pengumuman, agenda, dan pesan di percakapan milik sendiri.
  - NIM yang disembunyikan tidak bisa dicari anggota lain.
- **Pengaturan aplikasi** (Super Admin, Admin Panel → **Sistem & metrik**):
  - buka/tutup pendaftaran anggota baru;
  - wajib/tidaknya persetujuan materi dari Member;
  - banner informasi di halaman login dan dashboard.
- **Privasi & notifikasi anggota:**
  - opsi menolak chat pribadi baru (percakapan lama tetap jalan; Moderator ke atas tetap bisa menghubungi);
  - **Bisukan percakapan** di dialog Info: tanpa pop-up dan tidak dihitung di badge Chat.
- **Kinerja:**
  - Data anggota disimpan di cache 5 menit dan langsung diperbarui saat profil berubah, sehingga direktori, dashboard, dan daftar online tidak membaca spreadsheet di setiap permintaan.
  - Daftar panjang hanya digambar saat terlihat di layar.
- **Metrik** (Admin ke atas, tab **Sistem & metrik**, diperbarui tiap 15 detik):
  - permintaan per menit, rata-rata waktu sinkronisasi, permintaan paling lambat;
  - error server, "Gagal di browser" (termasuk penolakan Google karena batas 30 eksekusi bersamaan);
  - jumlah baris data, kapasitas sel, dan sisa kuota email.
- **Keamanan:** diuji dengan kode berbahaya (XSS) di judul & isi topik, bio, pesan chat, tautan, dan pencarian.
  Semuanya tampil sebagai teks biasa dan tidak dijalankan di browser pengguna lain.

## Panduan uji 20 orang chat bersamaan

Tujuan: memastikan chat tetap lancar saat ±20 orang aktif bersamaan. Ini syarat lolos Tahap 2.

**Persiapan (±15 menit sebelum uji)**

1. Pastikan versi terbaru sudah di-deploy dan `installTriggers()` sudah dijalankan.
2. Di editor Apps Script, pilih fungsi **buatAkunUji** → **Run**. Fungsi ini membuat akun `uji01`–`uji20` dan grup **Uji Beban**.
   Buka **Execution log**, lalu salin baris `PASSWORD BERSAMA AKUN UJI`.
3. Bagikan URL `/exec`, username (`uji01`–`uji20`, satu per peserta), dan password bersama ke 20 peserta.
   Sebaiknya campuran HP dan laptop, sebagian lewat data seluler.
4. Pemantau (Admin) membuka **Admin Panel → Sistem & metrik** dan membiarkannya terbuka.

**Skenario (15 menit)**

| Menit | Yang dilakukan peserta | Yang dipantau Admin |
| --- | --- | --- |
| 0–3 | Semua login, buka **Chat → Uji Beban** | "Online sekarang" naik ke ±20 |
| 3–10 | Kirim pesan di grup setiap 10–20 detik; sesekali membalas pesan orang lain | Rata-rata sinkronisasi, error, "Gagal di browser" |
| 10–12 | Setiap orang mengirim 1 foto di grup, lalu chat pribadi dengan 1 peserta lain | Waktu paling lambat |
| 12–14 | Buka Dashboard dan Forum, lalu kembali ke grup | Puncak permintaan per menit |
| 14–15 | Diam; biarkan aplikasi tetap terbuka | Permintaan turun (polling melambat) |

**Kriteria lolos** (isi kolom Hasil saat uji)

| Ukuran | Target | Hasil |
| --- | --- | --- |
| Pesan muncul di perangkat lain | ≤ 6 detik | |
| Rata-rata sinkronisasi | < 1.500 ms | |
| Error server / sibuk | 0 | |
| Gagal di browser | < 1% dari jumlah permintaan | |
| Pesan hilang atau dobel | 0 (bandingkan jumlah pesan di 3 perangkat) | |

**Jika ada yang tidak lolos**

- **Banyak "Gagal di browser" atau sinkronisasi > 1,5 detik:** ubah `SYNC_OPEN_MS` di `Config.gs` dari 3000 menjadi 5000, deploy ulang, lalu ulangi uji.
- **Error "sibuk" (BUSY):** terlalu banyak penulisan bersamaan. Catat menit kejadiannya.
- Kirim tangkapan layar tab **Sistem & metrik** agar penyesuaiannya tepat.

**Setelah uji:** jalankan **nonaktifkanAkunUji** dari editor untuk menonaktifkan semua akun uji.

## Tahap 3: forum, materi, pengumuman, agenda

| Modul | Siapa bisa apa |
| --- | --- |
| Forum | Semua anggota membuat topik, membalas, berkomentar, dan memberi reaksi (Suka, Setuju, Terima kasih, Lucu). Penulis bisa mengubah atau menghapus tulisannya sendiri. Moderator ke atas bisa menyematkan, mengunci, menandai penting, dan menghapus tulisan siapa pun. Saat menghapus tulisan orang lain, moderator wajib menulis alasan, yang dikirim ke penulisnya dan dicatat di log. |
| Materi | Semua anggota bisa mengunggah file atau tautan. Materi dari Member masuk antrean **Menunggu persetujuan**; Moderator menyetujui atau menolak dengan alasan. Materi Moderator ke atas langsung tayang. |
| Pengumuman | Hanya Admin ke atas. Prioritas Normal, Penting, atau Mendesak (Mendesak tampil sebagai banner merah di dashboard). Target: semua anggota, pengurus, atau angkatan tertentu. Bisa dijadwalkan tayang dan diberi waktu berakhir. |
| Agenda | Hanya Admin ke atas yang membuat. Anggota mendaftar atau membatalkan sendiri. Ada kuota, batas pendaftaran, dan centang **Hadir** untuk konfirmasi kehadiran. |

Notifikasi yang dikirim otomatis:

- Ada balasan pada topik Anda, atau komentar pada balasan Anda.
- Tulisan Anda dihapus moderator (beserta alasannya).
- Materi Anda disetujui atau ditolak; untuk moderator: ada materi baru yang menunggu persetujuan.
- Pengumuman baru. Yang terjadwal dikirim oleh `hourlyJobs` saat waktunya tiba.
- Agenda baru, agenda diubah atau dibatalkan, dan pengingat sekitar 24 jam sebelum acara bagi peserta terdaftar.

Waktu yang diisi di formulir pengumuman dan agenda dibaca sebagai **WIB (UTC+7)**.

Dashboard sekarang menampilkan:

- banner pengumuman mendesak;
- 3 pengumuman teratas;
- 3 agenda terdekat beserta status pendaftaran Anda;
- pesan terbaru dan diskusi forum terbaru;
- anggota baru dan jumlah anggota per angkatan.

## Tahap 2: cara kerja chat

- **Satu sistem untuk semua percakapan.** Chat pribadi dan grup memakai tabel yang sama (`conversations`, `conversation_members`, `messages`).
  Pesan disimpan di spreadsheet **DB Pesan**.
- **Polling adaptif, bukan refresh halaman:**

  | Kondisi | Interval sinkronisasi |
  | --- | --- |
  | Percakapan sedang dibuka | 3 detik |
  | Halaman lain | 10 detik |
  | Tidak ada aktivitas lebih dari 2 menit | 30 detik |
  | Tab disembunyikan | Berhenti; langsung sinkron saat tab dibuka lagi |

  Setiap polling hanya membandingkan angka versi di CacheService. Spreadsheet baru dibaca bila ada yang berubah dan cache kosong,
  sehingga polling tanpa pesan baru tidak menyentuh spreadsheet sama sekali.
- **Status terbaca:** chat pribadi menampilkan ✓ (terkirim) dan ✓✓ (dibaca). Di grup, ✓✓ menyala bila semua anggota sudah membaca;
  arahkan kursor ke tanda centang untuk melihat jumlah pembaca.
- **Balas, salin, hapus:** klik gelembung pesan. Pesan yang dihapus berubah jadi "Pesan ini telah dihapus" dan lampirannya ikut dibuang.
- **Lampiran:** JPG, PNG, WEBP, PDF, DOCX, PPTX, XLSX, maksimal 5 MB dan 5 file per pesan.
  - Gambar otomatis diperkecil (maks. 1600 px) dan dibuatkan gambar mini.
  - Gambar dan PDF bisa dilihat langsung; dokumen Office diunduh.
  - Unggahan yang tidak jadi dikirim dibersihkan otomatis setelah 1 hari.
- **Grup:**
  - Hanya Moderator ke atas yang bisa membuat grup. Grup resmi khusus Admin ke atas.
  - Grup **publik** bisa diikuti siapa saja; grup **privat** hanya lewat undangan admin grup.
  - Peran di grup: pemilik, admin grup, dan anggota. Pemilik harus menyerahkan kepemilikan sebelum keluar.
  - Anggota baru bisa membaca riwayat, tetapi pesan lama tidak dihitung sebagai "belum dibaca".
- **Notifikasi:** dibuat untuk akun disetujui, role berubah, ditambahkan atau dikeluarkan dari grup, dan dijadikan admin grup.
  Pesan chat tidak dibuatkan notifikasi tersendiri agar sheet tidak membengkak; cukup badge angka di menu Chat plus pop-up singkat.
  Pop-up bisa dimatikan di **Pengaturan**.

**Perlu diuji setelah deploy ke Apps Script sungguhan:**

- Chat bersamaan oleh ±20 orang. Ini syarat lolos Tahap 2.
- Unduh dokumen Office dari dalam iframe Google.
- Unggah file 4–5 MB lewat koneksi HP.

## Keamanan yang diterapkan

| Aspek | Penerapan |
| --- | --- |
| Password | HMAC-SHA256 berulang + salt per pengguna + pepper rahasia. Format `v1$iterasi$salt$hash`, jadi tidak perlu kolom `salt` terpisah. |
| Sesi | Token acak. Server hanya menyimpan hash-nya. Sesi berakhir setelah 8 jam tanpa aktivitas, atau 7 hari bila memilih "Ingat saya". |
| Satu perangkat | Member & Moderator hanya bisa aktif di 1 perangkat — login di perangkat lain otomatis mengeluarkan sesi sebelumnya. Admin & Super Admin dikecualikan (boleh login di beberapa perangkat sekaligus, untuk tugas moderasi/admin dari mana saja). |
| Akses | Semua aksi lewat `api()`: cek sesi → status Approved → izin role → peringkat role / kepemilikan |
| Brute force | 5 kali gagal → akun dikunci 15 menit. Registrasi maksimal 3 per jam per perangkat. Lupa password maksimal 3 per jam per email. |
| XSS | Semua data pengguna di-escape sebelum ditampilkan |
| Rumus Spreadsheet | Semua teks disimpan dengan awalan apostrof, jadi tidak pernah dijalankan sebagai rumus. NIM `0012…` dan nomor HP juga tetap utuh. |
| Foto | Isi file diperiksa (JPEG/PNG/WEBP asli), maksimal 300 KB. Foto disimpan di Drive privat dan diambil lewat server. Hanya file foto profil yang bisa diambil. |
| Audit | Semua tindakan admin tercatat di sheet `audit_logs` dan tab **Log aktivitas** |
| Pesan pribadi | Hanya anggota percakapan yang bisa membuka, mengirim, mencari, dan mengunduh lampiran. Admin pun tidak bisa membaca chat pribadi orang lain. |
| Lampiran | Jenis file dicek dari ekstensi dan isi file sebenarnya. File disimpan di folder Drive privat, diakses lewat server, dan tidak bisa dipakai ulang di pesan lain. |
| Spam | Maksimal 20 pesan per menit dan 30 unggahan per jam per pengguna |

## Uji lokal (opsional, untuk pengembang)

Folder `uji-lokal/` berisi tiruan layanan GAS untuk Node.js:

- `node uji-lokal/server.test.js` menjalankan 165 pemeriksaan alur server Tahap 1 (termasuk aturan 1 perangkat).
- `node uji-lokal/chat.test.js` menjalankan 207 pemeriksaan chat, grup, lampiran, dan notifikasi.
- `node uji-lokal/community.test.js` menjalankan 224 pemeriksaan forum, materi, pengumuman, agenda, dan trigger per jam.
- `node uji-lokal/moderation.test.js` menjalankan 167 pemeriksaan laporan, moderasi, pencarian, pengaturan, privasi, dan metrik.
- `node uji-lokal/ujibeban.test.js` mensimulasikan 20 akun uji saling berkirim pesan.
  Simulasinya berurutan, karena tiruan GAS tidak bisa meniru eksekusi bersamaan yang sungguhan.
- `node uji-lokal/devserver.js` membuka aplikasi di `http://localhost:8765` dengan data contoh.

Uji ini tidak menggantikan uji di Apps Script sungguhan. Setelah deploy, periksa terutama:

- kecepatan login (`testHashSpeed`);
- tombol layar penuh di dalam iframe Google;
- tampilan di HP sungguhan.
