// Uji Tahap 4: pengaturan, laporan & moderasi, pencarian global, privasi DM, bisukan, metrik, cache anggota.
const assert = require('assert');
const path = require('path');
const { load } = require('./gasmock');

const g = load(path.resolve(__dirname, process.env.SRC || '../komunitas-gas'));
const { ctx, state } = g;
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const api = (a, t, d) => ctx.api(a, t, d);
const OK = (r, m) => { if (!r.ok) throw new Error(m + ' → ' + JSON.stringify(r.error)); passed++; return r.data; };
const ERR = (r, code, m) => { assert.ok(!r.ok, m + ' (seharusnya gagal)'); assert.strictEqual(r.error.code, code, m + ': ' + r.error.code + ' ' + r.error.message); passed++; };
const notifs = t => OK(api('notifications.list', t, {}), 'notif').items;

ctx.SETUP_ADMIN.email = 'admin@yapp.test';
ctx.setup();
const saPw = state.logs.find(l => l.startsWith('PASSWORD SEMENTARA')).split(': ')[1].split(' ')[0];
const SA = OK(api('auth.login', null, { identifier: 'superadmin', password: saPw }), 'login SA').token;
const U = {};
const reg = (u, i) => api('auth.register', null, { full_name: u[0].toUpperCase() + u.slice(1) + ' Test', email: u + '@x.id', username: u,
  nim: 'NIM00' + i, angkatan: '2025', kelas: 'A', password: 'rahasia123', password2: 'rahasia123', deviceId: 'd' + i });
['adm', 'mod', 'andi', 'bela', 'cici'].forEach((u, i) => {
  OK(reg(u, i), 'reg ' + u);
  const id = ctx.dbGet_('users', 'username', u).user_id;
  OK(api('admin.decide', SA, { userId: id, decision: 'approve' }), 'approve');
  U[u] = { id };
});
OK(api('admin.setRole', SA, { userId: U.adm.id, role: 'admin' }), 'admin');
OK(api('admin.setRole', SA, { userId: U.mod.id, role: 'moderator' }), 'moderator');
Object.keys(U).forEach(u => { U[u].t = OK(api('auth.login', null, { identifier: u, password: 'rahasia123' }), 'login').token; });
const { adm: AD, mod: M, andi: A, bela: B, cici: C } = U;

// ================= Pengaturan aplikasi =================
ERR(api('settings.update', AD.t, { registration_open: false }), 'FORBIDDEN', 'admin biasa tidak bisa mengubah pengaturan');
let st = OK(api('settings.update', SA, { registration_open: false, info_banner: 'Pemeliharaan Sabtu 22.00–23.00 WIB', bogus: 1 }), 'tutup pendaftaran');
ok(st.registration_open === false && st.info_banner.startsWith('Pemeliharaan') && !('bogus' in st), 'pengaturan tersimpan, kunci asing diabaikan');
ERR(reg('dina', 9), 'CLOSED', 'registrasi ditolak saat ditutup');
ok(OK(api('app.config', null, {}), 'config publik').registrationOpen === false, 'halaman login tahu pendaftaran ditutup');
const page = ctx.doGet({ parameter: {} });
ok(page.content.includes('"registrationOpen":false') && page.content.includes('Pemeliharaan'), 'BOOT memuat status pendaftaran & banner');
ok(OK(api('dashboard.summary', A.t, {}), 'dashboard').info_banner.startsWith('Pemeliharaan'), 'banner tampil di dashboard');
for (const k of Object.keys(state.cache)) if (k === 'settings') delete state.cache[k];
ok(OK(api('app.config', null, {}), 'config').registrationOpen === false, 'pengaturan bertahan setelah cache kosong');
OK(api('settings.update', SA, { registration_open: true, resource_needs_approval: false, info_banner: '' }), 'buka lagi');
OK(reg('dina', 9), 'registrasi dibuka kembali');
const rcat = OK(api('resources.list', A.t, {}), 'kategori').categories[0].cat_id;
ok(OK(api('resources.create', A.t, { cat_id: rcat, title: 'Kamus Oxford', kind: 'link', url: 'https://www.oxfordlearnersdictionaries.com' }), 'materi').approved === true,
  'tanpa persetujuan: materi member langsung tayang');
OK(api('settings.update', SA, { resource_needs_approval: true }), 'kembalikan persetujuan materi');

// ================= Laporan & moderasi =================
const cats = OK(api('forum.categories', A.t, {}), 'kategori forum');
const topic = OK(api('forum.create', A.t, { cat_id: cats[0].cat_id, title: 'Jual akun premium murah!!!', body: 'Hubungi saya di nomor ...' }), 'topik spam').disc_id;
ERR(api('reports.create', B.t, { targetType: 'discussion', targetId: topic, reason: 'jelek' }), 'VALIDATION', 'alasan tidak dikenal');
ERR(api('reports.create', B.t, { targetType: 'discussion', targetId: topic, reason: 'lainnya' }), 'VALIDATION', '"lainnya" wajib catatan');
ERR(api('reports.create', A.t, { targetType: 'discussion', targetId: topic, reason: 'spam' }), 'VALIDATION', 'tidak bisa melaporkan milik sendiri');
ERR(api('reports.create', B.t, { targetType: 'planet', targetId: 'x', reason: 'spam' }), 'VALIDATION', 'jenis tidak dikenal');
let r = OK(api('reports.create', B.t, { targetType: 'discussion', targetId: topic, reason: 'spam', note: 'Promosi jualan' }), 'bela melapor');
ok(r.message.includes('Terima kasih'), 'pesan konfirmasi');
ok(notifs(M.t).some(n => n.type === 'report' && n.link === 'moderation'), 'moderator diberi tahu ada laporan');
ok(!notifs(A.t).some(n => n.type === 'report'), 'yang dilaporkan tidak diberi tahu siapa pelapornya');
ERR(api('reports.create', B.t, { targetType: 'discussion', targetId: topic, reason: 'spam' }), 'CONFLICT', 'laporan ganda');
OK(api('reports.create', C.t, { targetType: 'discussion', targetId: topic, reason: 'tidak_pantas' }), 'cici ikut melapor');
ERR(api('moderation.list', A.t, {}), 'FORBIDDEN', 'member tidak bisa melihat antrean');
let ml = OK(api('moderation.list', M.t, {}), 'antrean moderator');
ok(ml.items.length === 1 && ml.items[0].count === 2 && ml.items[0].reasons.length === 2 && ml.openCount === 1, 'laporan dikelompokkan per konten');
ok(ml.items[0].snapshot.text.includes('Jual akun') && ml.items[0].author.full_name === 'Andi Test', 'salinan isi & penulis');
ok(OK(api('chat.sync', M.t, { wantOnline: true }), 'sync moderator').openReports === 1, 'badge jumlah laporan untuk moderator');
ok(!('openReports' in OK(api('chat.sync', A.t, { wantOnline: true }), 'sync member')), 'member tidak menerima jumlah laporan');
ERR(api('moderation.resolve', M.t, { targetType: 'discussion', targetId: topic, action: 'remove' }), 'VALIDATION', 'hapus tanpa alasan');
OK(api('moderation.resolve', M.t, { targetType: 'discussion', targetId: topic, action: 'remove', reason: 'Spam jualan' }), 'hapus konten dilaporkan');
ERR(api('forum.get', B.t, { discId: topic }), 'NOT_FOUND', 'topik terhapus');
ok(notifs(A.t).some(n => n.type === 'moderation' && n.title.includes('Spam jualan')), 'penulis diberi tahu alasan');
ok(notifs(B.t).some(n => n.type === 'report_result' && n.title.includes('dihapus')), 'pelapor 1 diberi tahu hasil');
ok(notifs(C.t).some(n => n.type === 'report_result'), 'pelapor 2 diberi tahu hasil');
ok(OK(api('moderation.list', M.t, {}), 'antrean').items.length === 0, 'antrean kosong');
ml = OK(api('moderation.list', M.t, { status: 'closed' }), 'riwayat');
ok(ml.items[0].action === 'remove' && ml.items[0].handled_by === 'Mod Test', 'riwayat tindak lanjut');
ERR(api('moderation.resolve', M.t, { targetType: 'discussion', targetId: topic, action: 'dismiss' }), 'NOT_FOUND', 'tidak ada laporan terbuka lagi');

// Pesan pribadi yang dilaporkan
const dm = OK(api('chat.openDirect', A.t, { userId: B.id }), 'dm').conv_id;
const msg = OK(api('chat.send', A.t, { convId: dm, body: 'Kamu bodoh sekali!' }), 'pesan kasar').message;
ERR(api('reports.create', C.t, { targetType: 'message', targetId: msg.id, reason: 'kasar' }), 'FORBIDDEN', 'bukan anggota percakapan tidak bisa melaporkan');
OK(api('reports.create', B.t, { targetType: 'message', targetId: msg.id, reason: 'kasar' }), 'bela melaporkan pesan');
ERR(api('chat.open', M.t, { convId: dm }), 'FORBIDDEN', 'moderator tetap tidak bisa membuka chat pribadi');
ml = OK(api('moderation.list', M.t, {}), 'antrean');
ok(ml.items[0].snapshot.text === 'Kamu bodoh sekali!' && ml.items[0].snapshot.title === 'Pesan pribadi', 'moderator hanya melihat pesan yang dilaporkan');
OK(api('moderation.resolve', M.t, { targetType: 'message', targetId: msg.id, action: 'remove', reason: 'Menghina' }), 'hapus pesan');
ok(OK(api('chat.open', B.t, { convId: dm }), 'bela buka').messages[0].deleted, 'pesan terhapus untuk semua');

// Komentar: peringatan saja
const t2 = OK(api('forum.create', B.t, { cat_id: cats[1].cat_id, title: 'Latihan speaking pagi', body: 'Ayo!' }), 't2').disc_id;
const cm = OK(api('forum.reply', A.t, { discId: t2, body: 'Ah ngapain, buang waktu' }), 'komentar').comment;
OK(api('reports.create', B.t, { targetType: 'comment', targetId: cm.comment_id, reason: 'lainnya', note: 'Merendahkan' }), 'lapor komentar');
OK(api('moderation.resolve', M.t, { targetType: 'comment', targetId: cm.comment_id, action: 'warn', reason: 'Mohon jaga sopan santun' }), 'beri peringatan');
ok(notifs(A.t).some(n => n.title.startsWith('Peringatan dari moderator') && n.link === 'forum/' + t2), 'peringatan dikirim dengan tautan');
ok(OK(api('forum.get', B.t, { discId: t2 }), 'topik').replies.length === 1, 'komentar tetap ada setelah peringatan');

// Anggota & materi
ERR(api('reports.create', A.t, { targetType: 'user', targetId: A.id, reason: 'spam' }), 'VALIDATION', 'tidak bisa melaporkan diri sendiri');
OK(api('reports.create', B.t, { targetType: 'user', targetId: C.id, reason: 'spam' }), 'lapor anggota');
ERR(api('moderation.resolve', M.t, { targetType: 'user', targetId: C.id, action: 'remove', reason: 'x' }), 'VALIDATION', 'akun tidak dihapus lewat moderasi');
OK(api('moderation.resolve', M.t, { targetType: 'user', targetId: C.id, action: 'dismiss' }), 'abaikan laporan anggota');
ok(notifs(B.t).some(n => n.title.includes('tidak ditemukan pelanggaran')), 'pelapor diberi tahu tidak melanggar');
const res = OK(api('resources.list', B.t, {}), 'materi').items[0].res_id;
OK(api('reports.create', C.t, { targetType: 'resource', targetId: res, reason: 'plagiat' }), 'lapor materi');
OK(api('moderation.resolve', M.t, { targetType: 'resource', targetId: res, action: 'remove', reason: 'Melanggar hak cipta' }), 'hapus materi');
ok(OK(api('resources.list', B.t, {}), 'materi').total === 0, 'materi terhapus');
// Bela sudah mengirim 4 laporan; 6 lagi = 10 (batas per jam)
for (let i = 0; i < 6; i++) {
  const t = OK(api('forum.create', i < 4 ? C.t : M.t, { cat_id: cats[2].cat_id, title: 'Topik uji nomor ' + i, body: 'x' }), 'tp').disc_id;
  OK(api('reports.create', B.t, { targetType: 'discussion', targetId: t, reason: 'spam' }), 'lapor ' + i);
}
ERR(api('reports.create', B.t, { targetType: 'user', targetId: M.id, reason: 'spam' }), 'RATE_LIMIT', 'batas 10 laporan per jam');

// ================= Pencarian global =================
ERR(api('search.all', A.t, { q: 'a' }), 'VALIDATION', 'kata kunci terlalu pendek');
OK(api('chat.send', B.t, { convId: dm, body: 'Besok latihan speaking jam 7 ya' }), 'pesan');
const gp = OK(api('groups.create', M.t, { name: 'Speaking Club', description: 'Latihan speaking mingguan', visibility: 'public' }), 'grup').conv_id;
const s1 = OK(api('search.all', A.t, { q: 'speaking' }), 'cari speaking');
ok(s1.topics.total >= 1 && s1.groups.items[0].conv_id === gp && s1.messages.total === 1, 'topik, grup, dan pesan sendiri ditemukan');
ok(s1.groups.items[0].is_member === false, 'status keanggotaan grup');
ok(OK(api('search.all', C.t, { q: 'latihan speaking jam' }), 'cici').messages.total === 0, 'pesan orang lain tidak ikut dicari');
ok(OK(api('search.all', A.t, { q: 'bela' }), 'cari anggota').members.items[0].username === 'bela', 'anggota ditemukan');
OK(api('profile.update', B.t, { privacy: { hide_nim: true, hide_phone: true, hide_email: true, allow_dm: true } }), 'sembunyikan NIM');
ok(OK(api('search.all', A.t, { q: 'NIM003' }), 'cari NIM').members.total === 0, 'NIM tersembunyi tidak bisa dicari anggota lain');
ok(OK(api('search.all', AD.t, { q: 'NIM003' }), 'admin cari NIM').members.total === 1, 'admin tetap bisa mencari NIM');
const ev = OK(api('events.save', AD.t, { title: 'Speaking Contest', location: 'Aula', start_at: '2030-01-01T10:00' }), 'agenda').event_id;
OK(api('announcements.save', AD.t, { title: 'Lomba speaking dibuka', body: 'Daftar di agenda.' }), 'pengumuman');
const s2 = OK(api('search.all', C.t, { q: 'speaking' }), 'cari lagi');
ok(s2.events.items[0].event_id === ev && s2.announcements.total === 1, 'agenda & pengumuman ditemukan');

// ================= Privasi DM & bisukan =================
OK(api('profile.update', B.t, { privacy: { hide_nim: false, hide_phone: true, hide_email: true, allow_dm: false } }), 'tolak DM baru');
ok(OK(api('members.get', C.t, { userId: B.id }), 'cici lihat bela').allow_dm === false, 'tombol kirim pesan dinonaktifkan');
ERR(api('chat.openDirect', C.t, { userId: B.id }), 'FORBIDDEN', 'DM baru ditolak');
ok(OK(api('chat.openDirect', A.t, { userId: B.id }), 'percakapan lama').conv_id === dm, 'percakapan yang sudah ada tetap jalan');
ok(OK(api('members.get', M.t, { userId: B.id }), 'moderator').allow_dm === true, 'moderator tetap bisa menghubungi');
OK(api('chat.openDirect', M.t, { userId: B.id }), 'moderator buka DM');
let sA = OK(api('chat.sync', A.t, {}), 'inbox andi');
OK(api('chat.mute', A.t, { convId: dm, muted: true }), 'bisukan');
ERR(api('chat.mute', C.t, { convId: dm, muted: true }), 'FORBIDDEN', 'bisukan percakapan orang lain');
OK(api('chat.send', B.t, { convId: dm, body: 'pesan baru' }), 'pesan');
sA = OK(api('chat.sync', A.t, {}), 'inbox andi');
const it = sA.inbox.items.find(c => c.conv_id === dm);
const notMuted = sA.inbox.items.filter(c => !c.muted).reduce((n, c) => n + c.unread, 0);
ok(it.muted && it.unread >= 1 && sA.inbox.unreadTotal === notMuted, 'percakapan dibisukan tidak menambah badge (' + it.unread + ' pesan tetap ditandai)');
ok(OK(api('chat.open', A.t, { convId: dm }), 'buka').conv.muted === true, 'status bisu terlihat di info');
OK(api('chat.mute', A.t, { convId: dm, muted: false }), 'aktifkan lagi');

// ================= Cache anggota =================
OK(api('members.list', C.t, {}), 'isi cache');
ok(state.cache['snap:am'], 'daftar anggota disimpan di cache');
OK(api('profile.update', C.t, { full_name: 'Cici Lestari' }), 'ganti nama');
ok(OK(api('members.list', A.t, { q: 'lestari' }), 'cari').total === 1, 'perubahan profil langsung terlihat (cache dibuang)');
OK(api('admin.setStatus', SA, { userId: C.id, status: 'suspended', reason: 'uji' }), 'suspend');
ok(!OK(api('members.list', A.t, {}), 'list').items.some(m => m.user_id === C.id), 'anggota nonaktif langsung hilang dari direktori');

// ================= Metrik =================
OK(api('chat.sync', A.t, { cerr: 3 }), 'sync dengan laporan error klien');
ERR(api('admin.metrics', A.t, {}), 'FORBIDDEN', 'member tidak bisa melihat metrik');
const mt = OK(api('admin.metrics', AD.t, { minutes: 30 }), 'metrik');
ok(mt.buckets.length === 30 && mt.summary.requests > 50 && mt.summary.syncAvgMs >= 0, 'metrik per menit tercatat: ' + mt.summary.requests);
ok(mt.summary.clientErrors === 3, 'error klien terhitung');
ok(mt.storage.length > 3 && mt.cells.limit === 10000000 && mt.mailQuota > 0, 'statistik penyimpanan & kuota');
const logs = OK(api('admin.logs', SA, {}), 'log').items;
ok(logs.some(l => l.action === 'moderation.remove') && logs.some(l => l.action === 'settings.update'), 'moderasi & pengaturan tercatat di log');

ok(state.errors.length === 0, 'tanpa error server: ' + state.errors.join('\n'));
console.log('TAHAP 4 LULUS: ' + passed + ' pemeriksaan');
