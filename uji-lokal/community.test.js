// Uji Tahap 3: forum, materi, pengumuman, agenda, dashboard, trigger per jam.
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
const notifs = (t) => OK(api('notifications.list', t, {}), 'notif').items;
const localPlus = (h) => { // waktu lokal Jakarta "YYYY-MM-DDTHH:mm" h jam dari sekarang
  const d = new Date(Date.now() + h * 3600000 + 7 * 3600000);
  return d.toISOString().slice(0, 16);
};

ctx.SETUP_ADMIN.email = 'admin@yapp.test';
ctx.setup();
const saPw = state.logs.find(l => l.startsWith('PASSWORD SEMENTARA')).split(': ')[1].split(' ')[0];
const SA = OK(api('auth.login', null, { identifier: 'superadmin', password: saPw }), 'login SA').token;
const U = {};
[['adm', '2023'], ['mod', '2024'], ['andi', '2025'], ['bela', '2025'], ['cici', '2024']].forEach(([u, ang], i) => {
  OK(api('auth.register', null, { full_name: u[0].toUpperCase() + u.slice(1) + ' Test', email: u + '@x.id', username: u, nim: 'NIM00' + i,
    angkatan: ang, kelas: 'A', password: 'rahasia123', password2: 'rahasia123', deviceId: 'd' + i }), 'reg ' + u);
  const id = ctx.dbGet_('users', 'username', u).user_id;
  OK(api('admin.decide', SA, { userId: id, decision: 'approve' }), 'approve ' + u);
  U[u] = { id };
});
OK(api('admin.setRole', SA, { userId: U.adm.id, role: 'admin' }), 'adm admin');
OK(api('admin.setRole', SA, { userId: U.mod.id, role: 'moderator' }), 'mod moderator');
Object.keys(U).forEach(u => { U[u].t = OK(api('auth.login', null, { identifier: u, password: 'rahasia123' }), 'login ' + u).token; });
const { adm: AD, mod: M, andi: A, bela: B, cici: C } = U;
OK(api('notifications.markRead', A.t, { all: true }), 'bersihkan notif andi');
OK(api('notifications.markRead', B.t, { all: true }), 'bersihkan notif bela');

// ================= Forum =================
const cats = OK(api('forum.categories', A.t, {}), 'kategori');
ok(cats.length === 6 && cats[0].name === 'Grammar', 'enam kategori forum');
const grammar = cats[0].cat_id, speaking = cats[1].cat_id;
ERR(api('forum.create', A.t, { cat_id: grammar, title: 'Hai', body: 'x' }), 'VALIDATION', 'judul terlalu pendek');
ERR(api('forum.create', A.t, { cat_id: 'cat_x', title: 'English Tenses', body: 'x' }), 'VALIDATION', 'kategori tidak valid');
ERR(api('forum.create', A.t, { cat_id: grammar, title: 'English Tenses', body: '   ' }), 'VALIDATION', 'isi kosong');
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1500, 32)]).toString('base64');
const fatt = OK(api('files.upload', A.t, { scope: 'forum', name: 'tenses.pdf', data: pdf }), 'unggah lampiran forum');
const topic = OK(api('forum.create', A.t, { cat_id: grammar, title: 'Kapan pakai Present Perfect?', body: 'Bingung bedanya dengan Simple Past.', attachmentIds: [fatt.id] }), 'buat topik').disc_id;
ok(OK(api('files.get', C.t, { id: fatt.id }), 'cici unduh lampiran forum').name === 'tenses.pdf', 'lampiran forum terbuka untuk anggota');
const dm = OK(api('chat.openDirect', A.t, { userId: B.id }), 'dm').conv_id;
const fatt2 = OK(api('files.upload', A.t, { scope: 'forum', name: 'x.pdf', data: pdf }), 'lampiran forum 2');
ERR(api('chat.send', A.t, { convId: dm, body: 'x', attachmentIds: [fatt2.id] }), 'FORBIDDEN', 'lampiran forum tidak bisa dipakai di chat');
const catt = OK(api('files.upload', A.t, { convId: dm, name: 'c.pdf', data: pdf }), 'lampiran chat');
ERR(api('forum.create', A.t, { cat_id: grammar, title: 'Lampiran chat', body: 'x', attachmentIds: [catt.id] }), 'FORBIDDEN', 'lampiran chat tidak bisa dipakai di forum');

let list = OK(api('forum.list', B.t, {}), 'daftar forum');
ok(list.total === 1 && list.items[0].has_attachments && list.items[0].cat_name === 'Grammar', 'topik tampil di daftar');
ok(OK(api('forum.list', B.t, { q: 'present perfect' }), 'cari').total === 1, 'pencarian topik');
ok(OK(api('forum.list', B.t, { filter: 'mine' }), 'milik saya').total === 0, 'filter topik saya');
ok(OK(api('forum.list', B.t, { cat: speaking }), 'kategori lain').total === 0, 'filter kategori');

const r1 = OK(api('forum.reply', B.t, { discId: topic, body: 'Present perfect dipakai untuk pengalaman tanpa waktu spesifik.' }), 'bela membalas').comment;
ok(notifs(A.t).some(n => n.type === 'forum_reply' && n.link === 'forum/' + topic), 'andi diberi tahu ada balasan');
const c1 = OK(api('forum.reply', C.t, { discId: topic, parentId: r1.comment_id, body: 'Contoh: I have visited Bali.' }), 'cici berkomentar').comment;
ok(notifs(B.t).some(n => n.type === 'forum_reply' && n.title.includes('mengomentari')), 'bela diberi tahu komentar pada balasannya');
const c2 = OK(api('forum.reply', A.t, { discId: topic, parentId: c1.comment_id, body: 'Terima kasih!' }), 'andi balas komentar').comment;
ok(c2.parent_id === r1.comment_id, 'komentar diratakan menjadi satu tingkat');
let det = OK(api('forum.get', B.t, { discId: topic }), 'detail topik');
ok(det.replies.length === 1 && det.replies[0].children.length === 2 && det.topic.reply_count === 3, 'struktur balasan');
ok(det.topic.attachments[0].name === 'tenses.pdf' && det.can_reply && !det.can_moderate, 'lampiran & izin di detail');

ERR(api('forum.react', B.t, { targetType: 'discussion', targetId: topic, type: 'love' }), 'VALIDATION', 'reaksi tidak dikenal');
let rx = OK(api('forum.react', B.t, { targetType: 'discussion', targetId: topic, type: 'like' }), 'suka');
ok(rx.counts.like === 1 && rx.mine === 'like', 'reaksi tercatat');
rx = OK(api('forum.react', B.t, { targetType: 'discussion', targetId: topic, type: 'like' }), 'batal suka');
ok(!rx.counts.like && rx.mine === '', 'klik ulang membatalkan reaksi');
OK(api('forum.react', B.t, { targetType: 'discussion', targetId: topic, type: 'agree' }), 'setuju');
rx = OK(api('forum.react', C.t, { targetType: 'comment', targetId: r1.comment_id, type: 'thanks' }), 'reaksi balasan');
ok(rx.counts.thanks === 1, 'reaksi pada balasan');
ok(OK(api('forum.list', A.t, {}), 'daftar').items[0].reaction_count === 1, 'jumlah reaksi topik diperbarui');
det = OK(api('forum.get', B.t, { discId: topic }), 'detail');
ok(det.topic.reactions.mine === 'agree' && det.replies[0].reactions.counts.thanks === 1, 'ringkasan reaksi di detail');

ERR(api('forum.moderate', A.t, { discId: topic, pin: true }), 'FORBIDDEN', 'member tidak bisa menyematkan');
OK(api('forum.moderate', M.t, { discId: topic, pin: true, lock: true, important: true }), 'moderator sematkan & kunci');
ERR(api('forum.reply', B.t, { discId: topic, body: 'tambah' }), 'FORBIDDEN', 'topik terkunci');
OK(api('forum.reply', M.t, { discId: topic, body: 'Topik ditutup, terima kasih semua.' }), 'moderator tetap bisa membalas');
ok(OK(api('forum.list', B.t, { filter: 'important' }), 'penting').total === 1, 'filter topik penting');
ERR(api('forum.update', B.t, { discId: topic, cat_id: grammar, title: 'Diubah orang', body: 'x' }), 'FORBIDDEN', 'ubah topik orang lain');
OK(api('forum.update', A.t, { discId: topic, cat_id: grammar, title: 'Present Perfect vs Simple Past', body: 'Bingung bedanya.' }), 'ubah topik sendiri');

ERR(api('forum.deleteComment', A.t, { commentId: r1.comment_id }), 'FORBIDDEN', 'hapus balasan orang lain');
ERR(api('forum.deleteComment', M.t, { commentId: c1.comment_id }), 'VALIDATION', 'moderator wajib menulis alasan');
OK(api('forum.deleteComment', M.t, { commentId: c1.comment_id, reason: 'Di luar topik' }), 'moderator hapus komentar');
ok(notifs(C.t).some(n => n.type === 'moderation' && n.title.includes('Di luar topik')), 'penulis diberi tahu alasan moderasi');
det = OK(api('forum.get', B.t, { discId: topic }), 'detail');
ok(det.replies[0].children.length === 1 && det.topic.reply_count === 3, 'komentar terhapus hilang & jumlah balasan berkurang');
OK(api('forum.deleteComment', B.t, { commentId: r1.comment_id }), 'bela hapus balasannya sendiri');
det = OK(api('forum.get', B.t, { discId: topic }), 'detail');
ok(det.replies[0].deleted && det.replies[0].children.length === 1, 'balasan terhapus tetap jadi kerangka bila masih ada komentar');

const t2 = OK(api('forum.create', B.t, { cat_id: speaking, title: 'Tips latihan speaking sendiri', body: 'Shadowing tiap pagi.' }), 'topik 2').disc_id;
ERR(api('forum.delete', M.t, { discId: topic }), 'VALIDATION', 'hapus topik tanpa alasan');
OK(api('forum.delete', M.t, { discId: topic, reason: 'Duplikat' }), 'moderator hapus topik');
ERR(api('forum.get', B.t, { discId: topic }), 'NOT_FOUND', 'topik terhapus tidak bisa dibuka');
ERR(api('files.get', B.t, { id: fatt.id }), 'NOT_FOUND', 'lampiran topik terhapus ikut dibuang');
ok(OK(api('forum.list', B.t, {}), 'daftar').total === 1, 'topik terhapus hilang dari daftar');
OK(api('forum.delete', B.t, { discId: t2 }), 'hapus topik sendiri tanpa alasan');
for (let i = 0; i < 5; i++) OK(api('forum.create', C.t, { cat_id: grammar, title: 'Topik nomor ' + i, body: 'isi' }), 'topik ' + i);
ERR(api('forum.create', C.t, { cat_id: grammar, title: 'Topik keenam', body: 'isi' }), 'RATE_LIMIT', 'batas topik per 10 menit');

// ================= Materi =================
const rcat = OK(api('resources.list', A.t, {}), 'kategori materi').categories[0].cat_id;
ERR(api('resources.create', A.t, { cat_id: rcat, title: 'Kamus', kind: 'link', url: 'javascript:alert(1)' }), 'VALIDATION', 'tautan berbahaya ditolak');
const res1 = OK(api('resources.create', A.t, { cat_id: rcat, title: 'Cambridge Dictionary', description: 'Kamus daring', kind: 'link', url: 'https://dictionary.cambridge.org' }), 'materi tautan');
ok(res1.approved === false, 'materi dari member menunggu persetujuan');
ok(notifs(M.t).some(n => n.type === 'resource_pending'), 'moderator diberi tahu ada materi menunggu');
ok(OK(api('resources.list', B.t, {}), 'list bela').total === 0, 'materi pending tidak terlihat anggota lain');
ok(OK(api('resources.list', A.t, { status: 'pending' }), 'pending andi').total === 1, 'pengunggah melihat materinya yang pending');
ERR(api('resources.open', B.t, { resId: res1.res_id }), 'NOT_FOUND', 'materi pending tidak bisa dibuka anggota lain');
let rl = OK(api('resources.list', M.t, { status: 'pending' }), 'pending moderator');
ok(rl.total === 1 && rl.canReview && rl.pendingCount === 1, 'moderator melihat antrean');
ERR(api('resources.review', A.t, { resId: res1.res_id, approve: true }), 'FORBIDDEN', 'member tidak bisa menyetujui');
OK(api('resources.review', M.t, { resId: res1.res_id, approve: true }), 'setujui materi');
ok(notifs(A.t).some(n => n.type === 'resource_review' && n.title.includes('disetujui')), 'pengunggah diberi tahu disetujui');
ok(OK(api('resources.list', B.t, {}), 'list').total === 1, 'materi tampil setelah disetujui');
const op = OK(api('resources.open', B.t, { resId: res1.res_id }), 'buka materi');
ok(op.kind === 'link' && op.url.includes('cambridge'), 'tautan dikembalikan');
ok(OK(api('resources.list', B.t, {}), 'list').items[0].download_count === 1, 'jumlah akses bertambah');

const ratt = OK(api('files.upload', A.t, { scope: 'resource', name: 'Essay Guide.pdf', data: pdf }), 'unggah file materi');
const res2 = OK(api('resources.create', A.t, { cat_id: rcat, title: 'Essay Writing Guide', kind: 'file', attachmentId: ratt.id }), 'materi file');
ERR(api('files.get', B.t, { id: ratt.id }), 'NOT_FOUND', 'file materi pending tidak bisa diunduh anggota lain');
ok(OK(api('files.get', M.t, { id: ratt.id }), 'moderator pratinjau').name === 'Essay Guide.pdf', 'moderator bisa memeriksa file');
ERR(api('resources.review', M.t, { resId: res2.res_id, approve: false }), 'VALIDATION', 'tolak tanpa alasan');
OK(api('resources.review', M.t, { resId: res2.res_id, approve: false, reason: 'File terpotong' }), 'tolak materi');
ok(notifs(A.t).some(n => n.title.includes('File terpotong')), 'alasan penolakan diterima pengunggah');
ERR(api('files.get', A.t, { id: ratt.id }), 'NOT_FOUND', 'file materi ditolak ikut dibuang');
const matt = OK(api('files.upload', M.t, { scope: 'resource', name: 'tenses.pdf', data: pdf }), 'unggah moderator');
const res3 = OK(api('resources.create', M.t, { cat_id: rcat, title: 'Tenses Cheat Sheet', kind: 'file', attachmentId: matt.id }), 'materi moderator');
ok(res3.approved === true, 'materi moderator langsung tayang');
const op2 = OK(api('resources.open', C.t, { resId: res3.res_id }), 'buka file');
ok(op2.kind === 'file' && OK(api('files.get', C.t, { id: op2.file.id }), 'unduh').name === 'tenses.pdf', 'file materi bisa diunduh');
rl = OK(api('resources.list', C.t, { q: 'cheat' }), 'cari materi');
ok(rl.total === 1 && rl.items[0].file.size > 0, 'pencarian & info file');
ERR(api('resources.delete', B.t, { resId: res1.res_id }), 'FORBIDDEN', 'hapus materi orang lain');
OK(api('resources.delete', A.t, { resId: res1.res_id }), 'hapus materi sendiri');

// ================= Pengumuman =================
ERR(api('announcements.save', M.t, { title: 'Hai', body: 'x' }), 'FORBIDDEN', 'moderator tidak bisa membuat pengumuman');
ERR(api('announcements.save', AD.t, { title: 'Rapat', body: 'x', audience: 'angkatan:abc' }), 'VALIDATION', 'target tidak valid');
ERR(api('announcements.save', AD.t, { title: 'Rapat', body: 'x', publish_at: localPlus(2), expires_at: localPlus(1) }), 'VALIDATION', 'berakhir sebelum tayang');
const an1 = OK(api('announcements.save', AD.t, { title: 'Jadwal UTS Angkatan 2025', body: 'UTS dimulai 1 Desember.', priority: 'penting', audience: 'angkatan:2025' }), 'pengumuman angkatan');
ok(an1.message.includes('2 anggota'), 'dikirim ke 2 anggota angkatan 2025: ' + an1.message);
ok(notifs(B.t).some(n => n.type === 'announcement' && n.title.startsWith('[Penting]')), 'bela menerima notifikasi');
ok(!notifs(C.t).some(n => n.type === 'announcement'), 'cici (2024) tidak menerima');
ok(OK(api('announcements.list', C.t, {}), 'list cici').items.length === 0, 'cici tidak melihat pengumuman angkatan lain');
ok(OK(api('announcements.list', A.t, {}), 'list andi').items[0].audience_label === 'Angkatan 2025', 'andi melihat pengumuman');
const an2 = OK(api('announcements.save', AD.t, { title: 'Seminar Literature', body: 'Daftar di menu Agenda.', publish_at: localPlus(3) }), 'pengumuman terjadwal');
ok(an2.message.includes('dijadwalkan'), 'terjadwal');
ok(!OK(api('announcements.list', A.t, {}), 'list').items.some(x => x.ann_id === an2.ann_id), 'pengumuman terjadwal belum terlihat');
const allList = OK(api('announcements.list', AD.t, { scope: 'all' }), 'admin semua');
ok(allList.items.find(x => x.ann_id === an2.ann_id).status === 'scheduled' && allList.audiences.some(a => a.value === 'angkatan:2024'), 'admin melihat status & pilihan target');
ctx.dbUpdate_('announcements', 'ann_id', an2.ann_id, { publish_at: '2020-01-01T00:00:00+07:00' });
ctx.hourlyJobs();
ok(notifs(C.t).some(n => n.title === 'Pengumuman: Seminar Literature'), 'notifikasi terkirim saat waktunya tiba');
const before = notifs(C.t).length;
ctx.hourlyJobs();
ok(notifs(C.t).length === before, 'tidak dikirim dua kali');
OK(api('announcements.save', AD.t, { title: 'Kelas libur besok', body: 'Ada rapat dosen.', priority: 'mendesak', is_pinned: true }), 'pengumuman mendesak');
let al = OK(api('announcements.list', A.t, {}), 'list').items;
ok(al[0].title === 'Kelas libur besok', 'yang disematkan & mendesak di urutan atas');
ctx.dbUpdate_('announcements', 'ann_id', an1.ann_id, { expires_at: '2020-01-02T00:00:00+07:00' });
ok(!OK(api('announcements.list', A.t, {}), 'list').items.some(x => x.ann_id === an1.ann_id), 'pengumuman kedaluwarsa tersembunyi');
OK(api('announcements.delete', AD.t, { annId: an2.ann_id }), 'hapus pengumuman');
ERR(api('announcements.delete', A.t, { annId: an2.ann_id }), 'FORBIDDEN', 'member tidak bisa menghapus');

// ================= Agenda =================
ERR(api('events.save', M.t, { title: 'Acara', location: 'x', start_at: localPlus(48) }), 'FORBIDDEN', 'moderator tidak bisa membuat agenda');
ERR(api('events.save', AD.t, { title: 'Acara', location: 'Aula', start_at: localPlus(48), end_at: localPlus(47) }), 'VALIDATION', 'selesai sebelum mulai');
ERR(api('events.save', AD.t, { title: 'Acara', location: 'Aula', start_at: localPlus(48), reg_deadline: localPlus(49) }), 'VALIDATION', 'batas daftar setelah mulai');
const ev = OK(api('events.save', AD.t, { title: 'Debate Workshop', description: 'Latihan debat parlementer.', location: 'Aula Lt. 2',
  start_at: localPlus(72), end_at: localPlus(75), reg_deadline: localPlus(48), quota: 2 }), 'buat agenda');
ok(ev.message.includes('5 anggota'), 'agenda diumumkan ke semua anggota lain: ' + ev.message);
ok(notifs(C.t).some(n => n.type === 'event' && n.title.startsWith('Agenda baru: Debate Workshop')), 'notifikasi agenda baru');
OK(api('events.register', A.t, { eventId: ev.event_id }), 'andi daftar');
ok(OK(api('events.register', A.t, { eventId: ev.event_id }), 'daftar ulang').status === 'registered', 'daftar dua kali tidak dobel');
OK(api('events.register', B.t, { eventId: ev.event_id }), 'bela daftar');
ERR(api('events.register', C.t, { eventId: ev.event_id }), 'CONFLICT', 'kuota penuh');
let evl = OK(api('events.list', C.t, {}), 'list cici').items[0];
ok(evl.taken === 2 && !evl.registration_open, 'kuota penuh menutup pendaftaran');
OK(api('events.cancel', B.t, { eventId: ev.event_id }), 'bela batal');
OK(api('events.register', C.t, { eventId: ev.event_id }), 'cici dapat kursi');
ERR(api('events.register', B.t, { eventId: ev.event_id }), 'CONFLICT', 'bela tidak bisa daftar lagi saat kuota penuh');
let evd = OK(api('events.get', A.t, { eventId: ev.event_id }), 'detail agenda');
ok(evd.participants.length === 2 && evd.my_status === 'registered' && !evd.can_manage, 'detail & peserta');
ok(OK(api('events.list', A.t, { scope: 'mine' }), 'agenda saya').items.length === 1, 'agenda saya');
ERR(api('events.attendance', A.t, { eventId: ev.event_id, userId: C.id, attended: true }), 'FORBIDDEN', 'member tidak bisa konfirmasi hadir');
OK(api('events.attendance', AD.t, { eventId: ev.event_id, userId: C.id, attended: true }), 'konfirmasi hadir');
ok(OK(api('events.get', AD.t, { eventId: ev.event_id }), 'detail admin').participants.find(p => p.user_id === C.id).status === 'attended', 'status hadir');

// Pengingat & perubahan jadwal
ctx.dbUpdate_('events', 'event_id', ev.event_id, { start_at: ctx.isoPlus_(10 * 3600000), reg_deadline: '' });
ctx.hourlyJobs();
ok(notifs(A.t).some(n => n.type === 'event_reminder' && n.title.startsWith('Pengingat: Debate Workshop')), 'pengingat H-1 terkirim');
const rcount = notifs(A.t).filter(n => n.type === 'event_reminder').length;
ctx.hourlyJobs();
ok(notifs(A.t).filter(n => n.type === 'event_reminder').length === rcount, 'pengingat tidak dobel');
OK(api('events.save', AD.t, { eventId: ev.event_id, title: 'Debate Workshop', location: 'Ruang 301', start_at: localPlus(30), quota: 2 }), 'ubah lokasi');
ok(notifs(A.t).some(n => n.title.startsWith('Agenda diperbarui')), 'peserta diberi tahu perubahan');
ctx.dbUpdate_('events', 'event_id', ev.event_id, { reg_deadline: '2020-01-01T00:00:00+07:00' });
ERR(api('events.cancel', C.t, { eventId: ev.event_id }), 'NOT_FOUND', 'peserta yang sudah hadir tidak bisa membatalkan');
OK(api('events.cancel', A.t, { eventId: ev.event_id }), 'andi membatalkan (kursi kosong lagi)');
ERR(api('events.register', B.t, { eventId: ev.event_id }), 'CONFLICT', 'pendaftaran ditutup setelah batas waktu');
const past = OK(api('events.save', AD.t, { title: 'Welcome Party', location: 'Kampus', start_at: localPlus(-48), end_at: localPlus(-45) }), 'agenda lampau').event_id;
ok(OK(api('events.list', A.t, { scope: 'past' }), 'agenda lalu').items.some(e => e.event_id === past), 'agenda yang sudah lewat');
ERR(api('events.register', A.t, { eventId: past }), 'CONFLICT', 'tidak bisa daftar acara yang sudah lewat');

// ================= Dashboard & log =================
const ds = OK(api('dashboard.summary', A.t, {}), 'dashboard andi');
ok(ds.urgent.length === 1 && ds.announcements.length >= 1, 'dashboard: pengumuman mendesak & penting');
ok(ds.events.length >= 1 && ds.events[0].event_id === ev.event_id && ds.events[0].my_status === 'cancelled', 'dashboard: agenda mendatang dengan status saya');
ok(ds.recentActivity.length >= 1 && ds.recentActivity[0].title, 'dashboard: aktivitas forum terbaru');
OK(api('events.delete', AD.t, { eventId: ev.event_id }), 'hapus agenda');
ok(notifs(C.t).some(n => n.title === 'Agenda dibatalkan: Debate Workshop'), 'peserta diberi tahu pembatalan');
ok(!notifs(A.t).some(n => n.title === 'Agenda dibatalkan: Debate Workshop'), 'yang sudah membatalkan tidak diberi tahu lagi');
const logs = OK(api('admin.logs', SA, {}), 'log').items;
ok(logs.some(l => l.action === 'forum.delete' && l.target.includes('Present')), 'log moderasi forum menampilkan judul');
ok(logs.some(l => l.action === 'resource.reject'), 'log penolakan materi');

ok(state.errors.length === 0, 'tanpa error server: ' + state.errors.join('\n'));
console.log('TAHAP 3 LULUS: ' + passed + ' pemeriksaan');
