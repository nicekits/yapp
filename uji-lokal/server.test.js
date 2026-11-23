// Uji alur server Tahap 0–1 terhadap mock GAS.
const assert = require('assert');
const path = require('path');
const { load } = require('./gasmock');

const SRC = path.resolve(__dirname, '../komunitas-gas');
const g = load(SRC);
const { ctx, state } = g;
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const api = (action, token, data) => ctx.api(action, token, data);
const expectOk = (r, msg) => { if (!r.ok) throw new Error(msg + ' → ' + JSON.stringify(r.error)); passed++; return r.data; };
const expectErr = (r, code, msg) => { assert.ok(!r.ok, msg + ' (seharusnya gagal)'); assert.strictEqual(r.error.code, code, msg + ' kode: ' + r.error.code + ' ' + r.error.message); passed++; return r.error; };

// ---------- Tahap 0: setup ----------
assert.throws(() => ctx.setup(), /SETUP_ADMIN\.email/, 'setup tanpa email harus gagal');
ctx.SETUP_ADMIN.email = 'Pengurus.EDC@gmail.com';
ctx.setup();
const pwLine = state.logs.find(l => l.startsWith('PASSWORD SEMENTARA'));
ok(pwLine, 'password sementara dicatat');
const adminPw = pwLine.split(': ')[1].split(' ')[0];
ok(state.props.PEPPER && state.props.DB_MAIN_ID && state.props.DB_MSG_ID && state.props.AVATAR_FOLDER_ID, 'properti setup lengkap');
const main = state.spreadsheets[state.props.DB_MAIN_ID];
ok(main.sheets.length === 19 && !main.getSheetByName('Sheet1'), '19 sheet DB utama, Sheet1 dihapus: ' + main.sheets.map(s => s.name));
ok(state.spreadsheets[state.props.DB_MSG_ID].getSheetByName('messages'), 'sheet messages ada');
ok(main.getSheetByName('categories').getLastRow() === 13, '12 kategori + header');

// setup ulang idempoten + kolom baru ditambahkan
const usersSheet = main.getSheetByName('users');
const before = usersSheet.getLastRow();
ctx.SCHEMA.main.users.push('kolom_baru_uji');
ctx.setup();
ok(usersSheet.getLastRow() === before, 'setup ulang tidak menduplikasi admin');
ok(usersSheet.data[0].includes('kolom_baru_uji'), 'kolom baru ditambahkan saat setup ulang');
ok(main.getSheetByName('categories').getLastRow() === 13, 'kategori tidak diduplikasi');
ctx.SCHEMA.main.users.pop();

ctx.installTriggers(); ctx.installTriggers();
ok(state.triggers.length === 3, 'trigger tidak dobel (harian, backup, per jam)');

// ---------- doGet ----------
const page = ctx.doGet({ parameter: { page: 'reset', token: '</script><b>x' } });
ok(page.content.includes('window.BOOT = {') && !page.content.includes('</script><b>'), 'boot JSON aman dari injeksi </script>');
ok(page.meta && page.meta.n === 'viewport', 'meta viewport ditambahkan');
ok(!/<\?/.test(page.content), 'semua tag template terevaluasi');

// ---------- Login Super Admin ----------
expectErr(api('auth.login', null, { identifier: 'pengurus.edc@gmail.com', password: 'salah123' }), 'LOGIN', 'password salah');
let r = expectOk(api('auth.login', null, { identifier: 'PENGURUS.EDC@gmail.com', password: adminPw, userAgent: 'test' }), 'login super admin');
ok(r.status === 'approved' && r.token && r.me.role === 'super_admin', 'super admin approved');
ok(main.getSheetByName('users').data[1][state.ctx.SCHEMA.main.users.indexOf('failed_logins')] === 0, 'failed_logins di-reset setelah login sukses');
const T_SA = r.token;
ok(!JSON.stringify(main.getSheetByName('sessions').data).includes(T_SA), 'token mentah tidak disimpan di sheet');

// ---------- Registrasi ----------
const reg = (o) => api('auth.register', null, Object.assign({
  full_name: 'Budi Santoso', email: 'budi@example.com', username: 'budi', nim: '0012345', angkatan: '2025',
  kelas: 'A', phone: '0812 3456 7890', password: 'rahasia123', password2: 'rahasia123', deviceId: 'dev1'
}, o));
expectErr(reg({ password: 'pendek1', password2: 'pendek1' }), 'VALIDATION', 'password pendek');
expectErr(reg({ password: 'tanpaangka', password2: 'tanpaangka' }), 'VALIDATION', 'password tanpa angka');
expectErr(reg({ password2: 'beda12345' }), 'VALIDATION', 'konfirmasi beda');
expectErr(reg({ email: 'bukan-email' }), 'VALIDATION', 'email invalid');
expectErr(reg({ angkatan: '1890' }), 'VALIDATION', 'angkatan invalid');
expectErr(reg({ username: 'Budi Keren' }), 'VALIDATION', 'username invalid');
r = expectOk(reg({}), 'registrasi Budi');
ok(r.status === 'pending', 'status pending');
expectErr(reg({ deviceId: 'dev2', username: 'budi2', nim: '999' }), 'CONFLICT', 'email duplikat');
expectErr(reg({ deviceId: 'dev2', email: 'b2@example.com', nim: '999' }), 'CONFLICT', 'username duplikat');
expectErr(reg({ deviceId: 'dev2', email: 'b2@example.com', username: 'budi2' }), 'CONFLICT', 'NIM duplikat');

// NIM dan HP tersimpan sebagai teks (nol di depan tidak hilang)
const profSheet = main.getSheetByName('profiles');
const pcols = ctx.SCHEMA.main.profiles;
const budiProf = profSheet.data.find(row => row[pcols.indexOf('full_name')] === 'Budi Santoso');
ok(budiProf[pcols.indexOf('nim')] === '0012345', 'NIM tetap "0012345", bukan angka: ' + budiProf[pcols.indexOf('nim')]);
ok(budiProf[pcols.indexOf('phone')] === '0812 3456 7890', 'nomor HP utuh');

// Injeksi rumus
expectOk(reg({ deviceId: 'dev3', full_name: '=IMPORTXML("http://evil")', email: 'c@example.com', username: 'citra', nim: '777' }), 'registrasi dengan nama berupa rumus');
ok(!JSON.stringify(main.sheets.map(s => s.data)).includes('#FORMULA'), 'tidak ada rumus yang tersimpan sebagai rumus');

// Rate limit registrasi per perangkat
expectOk(reg({ deviceId: 'dev9', full_name: 'Dewi Lestari 1', email: 'd1@example.com', username: 'dewi1', nim: 'n-d1' }), 'reg d1');
expectOk(reg({ deviceId: 'dev9', full_name: 'Dewi Lestari 2', email: 'd2@example.com', username: 'dewi2', nim: 'n-d2' }), 'reg d2');
expectOk(reg({ deviceId: 'dev9', full_name: 'Dewi Lestari 3', email: 'd3@example.com', username: 'dewi3', nim: 'n-d3' }), 'reg d3');
expectErr(reg({ deviceId: 'dev9', full_name: 'Dewi Lestari 4', email: 'd4@example.com', username: 'dewi4', nim: 'n-d4' }), 'RATE_LIMIT', 'reg ke-4 dari perangkat sama');

// Login akun pending: status diberitahukan, tanpa token
r = expectOk(api('auth.login', null, { identifier: 'budi', password: 'rahasia123' }), 'login pending');
ok(r.status === 'pending' && !r.token, 'pending tidak dapat token');
expectErr(api('auth.login', null, { identifier: 'budi', password: 'salahsalah1' }), 'LOGIN', 'pending + password salah tidak membocorkan status');

// ---------- Hak akses ----------
expectErr(api('dashboard.summary', null, {}), 'AUTH', 'tanpa token ditolak');
expectErr(api('dashboard.summary', 'x'.repeat(64), {}), 'AUTH', 'token palsu ditolak');
expectErr(api('tidak.ada', T_SA, {}), 'NOT_FOUND', 'aksi tak dikenal');

// ---------- Admin: persetujuan ----------
const pend = expectOk(api('admin.pending', T_SA, {}), 'daftar pending');
ok(pend.total === 5, 'ada 5 pending: ' + pend.total);
const budi = pend.items.find(u => u.username === 'budi');
const citra = pend.items.find(u => u.username === 'citra');
const d1 = pend.items.find(u => u.username === 'dewi1');
expectErr(api('admin.decide', T_SA, { userId: citra.user_id, decision: 'reject' }), 'VALIDATION', 'tolak tanpa alasan');
expectOk(api('admin.decide', T_SA, { userId: budi.user_id, decision: 'approve' }), 'setujui budi');
expectErr(api('admin.decide', T_SA, { userId: budi.user_id, decision: 'approve' }), 'CONFLICT', 'setujui dua kali');
expectOk(api('admin.decide', T_SA, { userId: citra.user_id, decision: 'reject', reason: 'NIM tidak ditemukan di data jurusan' }), 'tolak citra');
expectOk(api('admin.decide', T_SA, { userId: d1.user_id, decision: 'approve' }), 'setujui d1');

r = expectOk(api('auth.login', null, { identifier: 'citra', password: 'rahasia123' }), 'login rejected');
ok(r.status === 'rejected' && r.reason.includes('NIM') && r.reapply_at, 'alasan penolakan terlihat');
expectErr(reg({ deviceId: 'dev4', full_name: 'Citra', email: 'c@example.com', username: 'citra', nim: '777' }), 'CONFLICT', 'daftar ulang sebelum 7 hari ditolak');

r = expectOk(api('auth.login', null, { identifier: 'budi@example.com', password: 'rahasia123', remember: true }), 'login budi');
const T_B = r.token;
ok(r.me.role === 'member' && r.me.angkatan === '2025', 'budi member angkatan 2025');

// Member tidak bisa akses admin
expectErr(api('admin.pending', T_B, {}), 'FORBIDDEN', 'member akses admin');
expectErr(api('admin.backupNow', T_B, {}), 'FORBIDDEN', 'member backup');

// ---------- Dashboard, online, direktori ----------
const dash = expectOk(api('dashboard.summary', T_B, {}), 'dashboard budi');
ok(dash.stats.members === 3 && dash.stats.online >= 1 && dash.stats.pending === undefined, 'statistik member: ' + JSON.stringify(dash.stats));
const dashA = expectOk(api('dashboard.summary', T_SA, {}), 'dashboard admin');
ok(dashA.stats.pending === 2, 'admin melihat jumlah pending: ' + dashA.stats.pending);
const ping = expectOk(api('app.ping', T_B, {}), 'ping');
ok(ping.online.total === 2 && ping.pendingCount === undefined, 'ping: 2 online (SA & budi)');

let list = expectOk(api('members.list', T_B, {}), 'direktori');
ok(list.total === 3 && list.filters.angkatan.includes('2025'), 'direktori 3 anggota, filter angkatan');
ok(list.items[0].online, 'yang online di urutan atas');
list = expectOk(api('members.list', T_B, { q: 'budi' }), 'cari budi');
ok(list.total === 1 && list.items[0].nim === '0012345', 'pencarian & NIM terlihat (privasi default)');
list = expectOk(api('members.list', T_B, { onlineOnly: true }), 'online saja');
ok(list.total === 2, 'filter online');

// Privasi
const d1Login = expectOk(api('auth.login', null, { identifier: 'dewi1', password: 'rahasia123' }), 'login d1');
const T_D1 = d1Login.token;
let m = expectOk(api('members.get', T_D1, { userId: budi.user_id }), 'd1 lihat budi');
ok(m.phone === '' && m.email === '' && m.nim === '0012345', 'HP & email disembunyikan secara default');
expectOk(api('profile.update', T_B, { privacy: { hide_nim: true, hide_phone: false, hide_email: true } }), 'budi ubah privasi');
m = expectOk(api('members.get', T_D1, { userId: budi.user_id }), 'd1 lihat budi lagi');
ok(m.nim === '' && m.phone === '0812 3456 7890', 'privasi diterapkan');
m = expectOk(api('members.get', T_SA, { userId: budi.user_id }), 'admin lihat budi');
ok(m.nim === '0012345' && m.email === 'budi@example.com', 'admin tetap melihat semua');
expectErr(api('members.get', T_D1, { userId: citra.user_id }), 'NOT_FOUND', 'member tidak bisa melihat akun rejected');

// Profil
const me2 = expectOk(api('profile.update', T_B, { full_name: 'Budi S.', bio: '<script>alert(1)</script>', theme: 'dark' }), 'update profil');
ok(me2.full_name === 'Budi S.' && me2.theme === 'dark', 'profil tersimpan');
expectErr(api('profile.update', T_B, { theme: 'pink' }), 'VALIDATION', 'tema tidak valid');
const me3 = expectOk(api('profile.update', T_B, { nim: '111', angkatan: '2020' }), 'member coba ubah NIM');
ok(me3.nim === '0012345' && me3.angkatan === '2025', 'NIM & angkatan tidak bisa diubah member');

// ---------- Foto profil ----------
const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8CFC0F01F0005000201E2216BB80000000049454E44AE426082', 'hex');
const up = expectOk(api('profile.uploadPhoto', T_B, { dataUrl: 'data:image/png;base64,' + png.toString('base64') }), 'upload foto');
ok(up.photo_file_id && up.dataUrl.startsWith('data:image/png'), 'foto tersimpan');
const fake = Buffer.from('<html>bukan gambar</html>');
expectErr(api('profile.uploadPhoto', T_B, { dataUrl: 'data:image/png;base64,' + fake.toString('base64') }), 'VALIDATION', 'file palsu ditolak');
expectErr(api('profile.uploadPhoto', T_B, { dataUrl: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(400 * 1024)]).toString('base64') }), 'VALIDATION', 'foto terlalu besar');
const up2 = expectOk(api('profile.uploadPhoto', T_B, { dataUrl: 'data:image/png;base64,' + png.toString('base64') }), 'ganti foto');
ok(state.files[up.photo_file_id].trashed === true, 'foto lama dibuang ke sampah');
state.cache = state.cache; // cache masih ada
for (const k of Object.keys(state.cache)) if (k.startsWith('av:')) delete state.cache[k];
let av = expectOk(api('files.avatars', T_D1, { fileIds: [up2.photo_file_id, state.props.DB_MAIN_ID, 'acak'] }), 'ambil avatar');
ok(Object.keys(av).length === 1 && av[up2.photo_file_id], 'hanya file avatar terdaftar yang bisa diambil (bukan spreadsheet DB)');

// ---------- Manajemen pengguna & role ----------
const users = expectOk(api('admin.users', T_SA, {}), 'admin.users');
ok(users.counts.approved === 3 && users.counts.pending === 2 && users.counts.rejected === 1, 'hitungan status: ' + JSON.stringify(users.counts));
ok(users.assignableRoles.map(x => x.value).join() === 'admin,moderator,member', 'super admin bisa memberi admin/moderator/member');
expectOk(api('admin.setRole', T_SA, { userId: d1.user_id, role: 'admin' }), 'd1 jadi admin');
const T_D1b = expectOk(api('auth.login', null, { identifier: 'dewi1', password: 'rahasia123' }), 'login d1 lagi').token;
const usersByAdmin = expectOk(api('admin.users', T_D1b, {}), 'admin d1 lihat pengguna');
ok(usersByAdmin.assignableRoles.map(x => x.value).join() === 'moderator,member', 'admin hanya bisa memberi moderator/member');
const saRow = usersByAdmin.items.find(u => u.role === 'super_admin');
ok(saRow.can_manage === false, 'admin tidak bisa mengelola super admin');
expectErr(api('admin.setRole', T_D1b, { userId: budi.user_id, role: 'admin' }), 'FORBIDDEN', 'admin memberi role admin');
expectErr(api('admin.setStatus', T_D1b, { userId: saRow.user_id, status: 'suspended', reason: 'x' }), 'FORBIDDEN', 'admin suspend super admin');
expectErr(api('admin.setRole', T_D1b, { userId: d1.user_id, role: 'member' }), 'FORBIDDEN', 'ubah role sendiri');
expectOk(api('admin.setRole', T_D1b, { userId: budi.user_id, role: 'moderator' }), 'admin jadikan budi moderator');
expectErr(api('admin.updateProfile', T_D1b, { userId: budi.user_id, nim: '777' }), 'CONFLICT', 'NIM bentrok (milik citra)');
expectOk(api('admin.updateProfile', T_D1b, { userId: budi.user_id, jabatan: 'Koordinator Speaking', kelas: 'B' }), 'admin ubah jabatan');
m = expectOk(api('members.get', T_B, { userId: budi.user_id }), 'budi lihat dirinya');
ok(m.role === 'moderator' && m.jabatan === 'Koordinator Speaking', 'role & jabatan berubah (cache user di-reset)');

// Suspend mencabut sesi seketika
expectErr(api('admin.setStatus', T_D1b, { userId: budi.user_id, status: 'suspended' }), 'VALIDATION', 'suspend tanpa alasan');
expectOk(api('admin.setStatus', T_D1b, { userId: budi.user_id, status: 'suspended', reason: 'Spam di grup' }), 'suspend budi');
expectErr(api('auth.me', T_B, {}), 'AUTH', 'sesi budi langsung dicabut');
r = expectOk(api('auth.login', null, { identifier: 'budi', password: 'rahasia123' }), 'budi login saat suspended');
ok(r.status === 'suspended' && r.reason === 'Spam di grup' && !r.token, 'suspended tanpa token');
expectOk(api('admin.setStatus', T_D1b, { userId: budi.user_id, status: 'approved' }), 'aktifkan budi');
let T_B2 = expectOk(api('auth.login', null, { identifier: 'budi', password: 'rahasia123' }), 'budi login lagi').token;

// ---------- Satu perangkat untuk member/moderator ----------
// Budi sudah jadi moderator (baris 185). Login di perangkat kedua harus otomatis
// mengeluarkan sesi di perangkat pertama.
const T_B3 = expectOk(api('auth.login', null, { identifier: 'budi', password: 'rahasia123' }), 'budi login perangkat kedua').token;
expectErr(api('auth.me', T_B2, {}), 'AUTH', 'sesi perangkat pertama otomatis dicabut saat login di perangkat lain');
expectOk(api('auth.me', T_B3, {}), 'sesi perangkat kedua (yang terbaru) tetap aktif');

// ---------- Admin & super admin dikecualikan dari batasan 1 perangkat ----------
const T_D1c = expectOk(api('auth.login', null, { identifier: 'dewi1', password: 'rahasia123' }), 'd1 (admin) login perangkat lain').token;
expectOk(api('auth.me', T_D1b, {}), 'd1 sesi lama TETAP aktif meski login di perangkat lain (admin dikecualikan)');
expectOk(api('auth.me', T_D1c, {}), 'd1 sesi baru juga aktif');

// ---------- Ganti password & sesi ----------
expectErr(api('auth.changePassword', T_B3, { oldPassword: 'salah', newPassword: 'baru12345', newPassword2: 'baru12345' }), 'VALIDATION', 'password lama salah');
// Tidak ada sesi lain milik budi saat ini (sudah dibatasi 1 perangkat), jadi tidak ada yang dicabut.
r = expectOk(api('auth.changePassword', T_B3, { oldPassword: 'rahasia123', newPassword: 'baru12345', newPassword2: 'baru12345' }), 'ganti password');
ok(r.otherSessionsRevoked === 0, 'tidak ada perangkat lain budi yang perlu dikeluarkan: ' + r.otherSessionsRevoked);
// Untuk admin (dua sesi aktif), ganti password tetap mencabut sesi lain miliknya.
r = expectOk(api('auth.changePassword', T_D1c, { oldPassword: 'rahasia123', newPassword: 'baru12345', newPassword2: 'baru12345' }), 'd1 ganti password');
// d1 punya 2 sesi lain yang masih aktif (dari sblm jadi admin & sesudahnya), karena admin dikecualikan batas 1 perangkat.
ok(r.otherSessionsRevoked === 2, 'perangkat lain admin dikeluarkan: ' + r.otherSessionsRevoked);
expectErr(api('auth.me', T_D1, {}), 'AUTH', 'sesi lama d1 (sblm admin) dicabut oleh ganti password');
expectErr(api('auth.me', T_D1b, {}), 'AUTH', 'sesi admin lainnya dicabut oleh ganti password');
expectOk(api('auth.me', T_D1c, {}), 'sesi admin saat ini tetap aktif');
expectOk(api('auth.me', T_B3, {}), 'sesi budi saat ini tetap aktif');
expectOk(api('auth.logout', T_B3, {}), 'logout');
expectErr(api('auth.me', T_B3, {}), 'AUTH', 'setelah logout');

// ---------- Kunci login ----------
for (let i = 0; i < 4; i++) expectErr(api('auth.login', null, { identifier: 'budi', password: 'salah' + i }), 'LOGIN', 'gagal ke-' + (i + 1));
expectErr(api('auth.login', null, { identifier: 'budi', password: 'salah5' }), 'LOCKED', 'gagal ke-5 mengunci');
expectErr(api('auth.login', null, { identifier: 'budi', password: 'baru12345' }), 'LOCKED', 'password benar tetap terkunci');
// buka kunci untuk lanjut uji
ctx.dbUpdate_('users', 'user_id', budi.user_id, { locked_until: '' });

// ---------- Lupa & reset password ----------
r = expectOk(api('auth.forgot', null, { email: 'tidakada@example.com' }), 'forgot email tak terdaftar');
ok(state.mails.length === 0 && r.message.includes('Jika email terdaftar'), 'respons generik, tanpa email');
r = expectOk(api('auth.forgot', null, { email: 'budi@example.com' }), 'forgot budi');
ok(state.mails.length === 1, 'email reset terkirim');
const link = state.mails[0].body.match(/https:\S+/)[0];
const token = decodeURIComponent(link.split('token=')[1]);
ok(link.includes('?page=reset&token='), 'tautan reset benar');
expectErr(api('auth.reset', null, { token, password: 'pendek', password2: 'pendek' }), 'VALIDATION', 'reset dengan password lemah');
expectOk(api('auth.reset', null, { token, password: 'reset12345', password2: 'reset12345' }), 'reset password');
expectErr(api('auth.reset', null, { token, password: 'reset12345', password2: 'reset12345' }), 'INVALID_TOKEN', 'token reset sekali pakai');
expectOk(api('auth.login', null, { identifier: 'budi', password: 'reset12345' }), 'login dengan password baru');
expectOk(api('auth.forgot', null, { email: 'budi@example.com' }), 'forgot 2');
expectOk(api('auth.forgot', null, { email: 'budi@example.com' }), 'forgot 3');
expectErr(api('auth.forgot', null, { email: 'budi@example.com' }), 'RATE_LIMIT', 'forgot ke-4 dalam 1 jam');

// ---------- Sesi kedaluwarsa & sliding ----------
const T_E = expectOk(api('auth.login', null, { identifier: 'dewi2', password: 'rahasia123' }), 'login d2 (pending)');
ok(T_E.status === 'pending', 'd2 masih pending');
const T_S = expectOk(api('auth.login', null, { identifier: 'budi', password: 'reset12345' }), 'login budi utk uji sesi').token;
const th = ctx.sha256Hex_(T_S);
const sess = JSON.parse(state.cache['sess:' + th].v);
sess.exp = Date.now() - 1000;
state.cache['sess:' + th].v = JSON.stringify(sess);
expectErr(api('auth.me', T_S, {}), 'AUTH', 'sesi kedaluwarsa ditolak');
// cache hilang: sesi dibaca dari sheet
const T_S2 = expectOk(api('auth.login', null, { identifier: 'budi', password: 'reset12345' }), 'login lagi').token;
delete state.cache['sess:' + ctx.sha256Hex_(T_S2)];
expectOk(api('auth.me', T_S2, {}), 'sesi tetap valid saat cache kosong (dibaca dari sheet)');

// ---------- Log, backup, maintenance ----------
const logs = expectOk(api('admin.logs', T_SA, {}), 'log audit');
ok(logs.total >= 8 && logs.items[0].actor, 'log audit tercatat: ' + logs.total);
r = expectOk(api('admin.backupNow', T_SA, {}), 'backup manual');
ok(r.message.includes('backup_main_') && r.message.includes('backup_msg_'), 'dua file backup');
// Buat dua sesi "lama": satu dicabut 2 hari lalu, satu kedaluwarsa (tidak dicabut).
let aged = 0;
ctx.dbUpdateWhere_('sessions', r => r.revoked_at && aged < 1, () => { aged++; return { revoked_at: '2020-01-01T00:00:00+07:00' }; });
ctx.dbUpdateWhere_('sessions', r => r.token_hash === th, () => ({ expires_at: '2020-01-01T00:00:00+07:00', revoked_at: '' }));
const sessCount = main.getSheetByName('sessions').getLastRow();
ctx.dailyMaintenance();
ok(main.getSheetByName('sessions').getLastRow() < sessCount, 'sesi kedaluwarsa dibersihkan: ' + sessCount + ' -> ' + main.getSheetByName('sessions').getLastRow());
expectOk(api('auth.me', T_S2, {}), 'sesi aktif tetap ada setelah pembersihan');
const nimAfterPrune = main.getSheetByName('profiles').data.find(row => row[pcols.indexOf('user_id')] === budi.user_id)[pcols.indexOf('nim')];
ok(nimAfterPrune === '0012345', 'data teks tetap utuh');

// ---------- Super admin darurat ----------
ctx.resetSuperAdminPassword();
const newPw = state.logs[state.logs.length - 1].split(': ').pop();
expectErr(api('auth.me', T_SA, {}), 'AUTH', 'sesi lama super admin dicabut');
expectOk(api('auth.login', null, { identifier: 'superadmin', password: newPw }), 'login dengan password darurat');

ok(state.errors.length === 0, 'tidak ada error server tak tertangani: ' + state.errors.join('\n'));
console.log('SEMUA LULUS: ' + passed + ' pemeriksaan');
console.log('Panggilan HMAC per hash: ' + ctx.APP.HASH_ITERATIONS);
