// Uji Tahap 2: chat pribadi, grup, sinkronisasi, lampiran, notifikasi.
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

ctx.SETUP_ADMIN.email = 'admin@yapp.test';
ctx.setup();
const saPw = state.logs.find(l => l.startsWith('PASSWORD SEMENTARA')).split(': ')[1].split(' ')[0];
const SA = OK(api('auth.login', null, { identifier: 'superadmin', password: saPw }), 'login SA').token;
const main = state.spreadsheets[state.props.DB_MAIN_ID];
ok(main.getSheetByName('conversations').data[0].includes('direct_key'), 'kolom direct_key ada');
ok(state.spreadsheets[state.props.DB_MSG_ID].getSheetByName('messages').data[0].includes('reply_json'), 'kolom reply_json ada');

const U = {};
['andi', 'bela', 'cici', 'dodi', 'eka'].forEach((u, i) => {
  OK(api('auth.register', null, { full_name: u[0].toUpperCase() + u.slice(1) + ' Test', email: u + '@x.id', username: u, nim: 'NIM00' + i,
    angkatan: '2025', kelas: 'A', password: 'rahasia123', password2: 'rahasia123', deviceId: 'd' + i }), 'reg ' + u);
  const id = ctx.dbGet_('users', 'username', u).user_id;
  OK(api('admin.decide', SA, { userId: id, decision: 'approve' }), 'approve ' + u);
  U[u] = { id, t: OK(api('auth.login', null, { identifier: u, password: 'rahasia123' }), 'login ' + u).token };
});
OK(api('admin.setRole', SA, { userId: U.dodi.id, role: 'moderator' }), 'dodi moderator');
const { andi: A, bela: B, cici: C, dodi: M, eka: E } = U;

// Notifikasi selamat datang dari persetujuan
let n = OK(api('notifications.list', A.t, {}), 'notif andi');
ok(n.unread === 1 && n.items[0].type === 'welcome', 'notifikasi selamat datang');

// ---------- Chat pribadi ----------
ERR(api('chat.openDirect', A.t, { userId: A.id }), 'VALIDATION', 'chat dengan diri sendiri');
const dm = OK(api('chat.openDirect', A.t, { userId: B.id }), 'andi buka chat ke bela').conv_id;
ok(OK(api('chat.openDirect', B.t, { userId: A.id }), 'bela buka chat ke andi').conv_id === dm, 'percakapan pribadi tidak dobel');
let sA = OK(api('chat.sync', A.t, {}), 'sync awal andi');
ok(sA.inbox.items.some(c => c.conv_id === dm), 'percakapan kosong tampil untuk pembuatnya');
let sB = OK(api('chat.sync', B.t, {}), 'sync awal bela');
ok(!sB.inbox.items.some(c => c.conv_id === dm), 'percakapan kosong tidak muncul di inbox lawan bicara');

const m1 = OK(api('chat.send', A.t, { convId: dm, body: 'Halo Bela, sudah kerjakan essay?' }), 'kirim pesan').message;
ok(m1.id.startsWith('msg_') && m1.body.includes('essay'), 'pesan terkirim');
ERR(api('chat.send', A.t, { convId: dm, body: '   ' }), 'VALIDATION', 'pesan kosong');
ERR(api('chat.send', A.t, { convId: dm, body: 'x'.repeat(2001) }), 'VALIDATION', 'pesan terlalu panjang');
ERR(api('chat.send', C.t, { convId: dm, body: 'nimbrung' }), 'FORBIDDEN', 'bukan anggota tidak bisa kirim');
ERR(api('chat.open', C.t, { convId: dm }), 'FORBIDDEN', 'bukan anggota tidak bisa membaca');
ERR(api('chat.history', C.t, { convId: dm }), 'FORBIDDEN', 'bukan anggota tidak bisa melihat riwayat');

sB = OK(api('chat.sync', B.t, { iv: sB.iv }), 'sync bela setelah pesan');
let item = sB.inbox.items.find(c => c.conv_id === dm);
ok(item && item.unread === 1 && item.name === 'Andi Test' && item.preview.includes('essay'), 'bela melihat 1 pesan belum dibaca');
ok(sB.inbox.unreadTotal === 1, 'total belum dibaca 1');
const ivB = sB.iv;
ok(!('inbox' in OK(api('chat.sync', B.t, { iv: ivB }), 'sync tanpa perubahan')), 'tanpa perubahan → inbox tidak dikirim ulang');

// Bela membuka percakapan → tanda baca
const open = OK(api('chat.open', B.t, { convId: dm }), 'bela membuka percakapan');
ok(open.messages.length === 1 && open.conv.name === 'Andi Test' && open.senders[A.id].full_name === 'Andi Test', 'isi percakapan');
sA = OK(api('chat.sync', A.t, { convId: dm, cv: 'x', rv: 'x', iv: sA.iv, visible: true }), 'andi sync percakapan');
ok(sA.reads.map[B.id] === m1.id, 'andi melihat pesannya sudah dibaca bela');
ok(sA.presence.online[B.id] === true, 'status online lawan bicara');
const cvA = sA.conv.cv, rvA = sA.reads.rv;
let quiet = OK(api('chat.sync', A.t, { convId: dm, cv: cvA, rv: rvA, iv: sA.iv, visible: true }), 'sync tanpa perubahan');
ok(!quiet.conv && !quiet.reads && !quiet.inbox, 'polling tanpa perubahan hanya membawa presence: ' + Object.keys(quiet));

// Balas pesan
const m2 = OK(api('chat.send', B.t, { convId: dm, body: 'Sudah! Mau kubagikan?', replyToId: m1.id }), 'bela membalas').message;
ok(m2.reply && m2.reply.id === m1.id && m2.reply.name === 'Andi Test', 'kutipan balasan tersimpan');
ERR(api('chat.send', B.t, { convId: dm, body: 'x', replyToId: 'msg_tidakada' }), 'VALIDATION', 'balas pesan yang tidak ada');
quiet = OK(api('chat.sync', A.t, { convId: dm, cv: cvA, rv: rvA, iv: sA.iv, visible: true }), 'andi sync setelah balasan');
ok(quiet.conv && quiet.conv.messages.length === 2, 'pesan baru tiba lewat sync');

// Hapus pesan
ERR(api('chat.deleteMessage', B.t, { msgId: m1.id }), 'FORBIDDEN', 'hapus pesan orang lain');
OK(api('chat.deleteMessage', B.t, { msgId: m2.id }), 'bela hapus pesannya');
let win = OK(api('chat.open', A.t, { convId: dm }), 'andi buka lagi').messages;
ok(win[1].deleted && win[1].body === '' && win[1].reply === null, 'pesan terhapus kosong');
sA = OK(api('chat.sync', A.t, {}), 'inbox andi');
ok(sA.inbox.items.find(c => c.conv_id === dm).preview === 'Pesan dihapus', 'pratinjau berubah jadi "Pesan dihapus"');

// Batas kirim per menit
for (let i = 0; i < 20; i++) OK(api('chat.send', E.t, { convId: OK(api('chat.openDirect', E.t, { userId: A.id }), 'dm').conv_id, body: 'spam ' + i }), 'kirim ' + i);
ERR(api('chat.send', E.t, { convId: ctx.dbGet_('conversations', 'direct_key', [E.id, A.id].sort().join('|')).conv_id, body: 'ke-21' }), 'RATE_LIMIT', 'pesan ke-21 dalam semenit');
sA = OK(api('chat.sync', A.t, {}), 'inbox andi');
ok(sA.inbox.unreadTotal === 20, 'andi punya 20 belum dibaca dari eka: ' + sA.inbox.unreadTotal);
ok(sA.inbox.items[0].name === 'Eka Test', 'percakapan terbaru di atas');

// ---------- Grup ----------
ERR(api('groups.create', A.t, { name: 'Grammar Club', visibility: 'public' }), 'FORBIDDEN', 'member tidak bisa membuat grup');
ERR(api('groups.create', M.t, { name: 'Resmi', visibility: 'public', is_official: true }), 'FORBIDDEN', 'moderator tidak bisa membuat grup resmi');
ERR(api('groups.create', M.t, { name: 'X', visibility: 'rahasia' }), 'VALIDATION', 'jenis grup salah');
const gp = OK(api('groups.create', M.t, { name: 'Speaking Practice', description: 'Latihan tiap Jumat', visibility: 'public', memberIds: [A.id] }), 'moderator membuat grup publik').conv_id;
ERR(api('groups.create', M.t, { name: 'speaking practice', visibility: 'public' }), 'CONFLICT', 'nama grup kembar');
const gpriv = OK(api('groups.create', SA, { name: 'Pengurus', visibility: 'private', is_official: true }), 'admin membuat grup resmi privat').conv_id;
n = OK(api('notifications.list', A.t, {}), 'notif andi');
ok(n.items[0].type === 'group_added' && n.items[0].link === 'chat/' + gp, 'andi diberi notifikasi ditambahkan ke grup');

let gl = OK(api('groups.list', B.t, {}), 'bela lihat daftar grup');
ok(gl.items.some(x => x.conv_id === gp) && !gl.items.some(x => x.conv_id === gpriv) && gl.canCreate === false, 'grup privat tidak terlihat bukan anggota');
OK(api('groups.join', B.t, { convId: gp }), 'bela gabung grup publik');
ERR(api('groups.join', C.t, { convId: gpriv }), 'FORBIDDEN', 'gabung grup privat');
let gmeta = OK(api('chat.open', B.t, { convId: gp }), 'bela buka grup');
ok(gmeta.conv.members.length === 3 && gmeta.conv.members[0].member_role === 'owner', 'anggota grup & urutan peran');
ok(gmeta.messages.filter(m => m.kind === 'system').length >= 2, 'pesan sistem (dibuat, bergabung)');

ERR(api('groups.addMembers', A.t, { convId: gp, userIds: [C.id] }), 'FORBIDDEN', 'member biasa tidak bisa menambah anggota');
ERR(api('groups.setMemberRole', A.t, { convId: gp, userId: B.id, role: 'admin' }), 'FORBIDDEN', 'member tidak bisa mengangkat admin');
OK(api('groups.setMemberRole', M.t, { convId: gp, userId: A.id, role: 'admin' }), 'pemilik jadikan andi admin grup');
OK(api('chat.send', M.t, { convId: gp, body: 'Topik minggu ini: daily routine' }), 'pesan grup lama');
OK(api('groups.addMembers', A.t, { convId: gp, userIds: [C.id, 'usr_palsu'] }), 'admin grup menambah cici');
let sC = OK(api('chat.sync', C.t, {}), 'sync cici');
ok(sC.inbox.items.find(x => x.conv_id === gp).unread === 0, 'anggota baru tidak dibanjiri pesan lama sebagai belum dibaca');
ok(sC.inbox.notifUnread === 2, 'cici: notifikasi selamat datang + ditambahkan ke grup');
const gm = OK(api('chat.send', B.t, { convId: gp, body: 'I usually wake up at 5 AM.' }), 'pesan grup').message;
sC = OK(api('chat.sync', C.t, { iv: sC.iv }), 'sync cici lagi');
const gItem = sC.inbox.items.find(x => x.conv_id === gp);
ok(gItem.unread === 1 && gItem.preview.startsWith('Bela: '), 'pratinjau grup memakai nama pengirim: ' + gItem.preview);
ok(gItem.member_count === 4, 'jumlah anggota grup 4');

ERR(api('groups.removeMember', A.t, { convId: gp, userId: M.id }), 'FORBIDDEN', 'pemilik tidak bisa dikeluarkan');
OK(api('groups.removeMember', A.t, { convId: gp, userId: B.id }), 'admin grup mengeluarkan bela');
let sBr = OK(api('chat.sync', B.t, { convId: gp, cv: 'x' }), 'bela sync grup setelah dikeluarkan');
ok(sBr.removed === gp && !sBr.conv, 'klien diberi tahu sudah dikeluarkan');
ERR(api('chat.send', B.t, { convId: gp, body: 'halo?' }), 'FORBIDDEN', 'yang dikeluarkan tidak bisa kirim');
ERR(api('groups.removeMember', A.t, { convId: gp, userId: A.id }), 'VALIDATION', 'keluarkan diri sendiri');
OK(api('groups.join', B.t, { convId: gp }), 'bela gabung lagi (grup publik)');

ERR(api('groups.leave', M.t, { convId: gp }), 'CONFLICT', 'pemilik tidak bisa keluar');
OK(api('groups.setMemberRole', M.t, { convId: gp, userId: A.id, role: 'owner' }), 'serahkan kepemilikan ke andi');
OK(api('groups.leave', M.t, { convId: gp }), 'dodi keluar setelah menyerahkan');
gmeta = OK(api('chat.open', A.t, { convId: gp }), 'andi buka grup');
ok(gmeta.conv.my_role === 'owner' && gmeta.conv.can_manage, 'andi pemilik baru');

ERR(api('groups.update', C.t, { convId: gp, name: 'Ganti' }), 'FORBIDDEN', 'member ubah grup');
ERR(api('groups.update', A.t, { convId: gp, name: 'Pengurus' }), 'CONFLICT', 'ubah ke nama grup lain');
OK(api('groups.update', A.t, { convId: gp, name: 'Speaking Club', visibility: 'private' }), 'ubah nama & jenis');
gl = OK(api('groups.list', E.t, {}), 'eka lihat grup');
ok(!gl.items.some(x => x.conv_id === gp), 'grup yang jadi privat tidak terlihat lagi oleh non-anggota');
const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8CFC0F01F0005000201E2216BB80000000049454E44AE426082', 'hex');
const gph = OK(api('groups.setPhoto', A.t, { convId: gp, dataUrl: 'data:image/png;base64,' + png.toString('base64') }), 'foto grup');
for (const k of Object.keys(state.cache)) if (k.startsWith('av:')) delete state.cache[k];
ok(OK(api('files.avatars', C.t, { fileIds: [gph.photo_file_id] }), 'ambil foto grup')[gph.photo_file_id], 'foto grup bisa diambil');

// Admin global mengelola grup resmi
OK(api('groups.addMembers', SA, { convId: gpriv, userIds: [C.id] }), 'admin tambah cici ke grup resmi');
OK(api('groups.setMemberRole', SA, { convId: gpriv, userId: C.id, role: 'admin' }), 'pemilik angkat admin');

// ---------- Lampiran ----------
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 32)]);
ERR(api('files.upload', A.t, { convId: gp, name: 'virus.exe', data: pdf.toString('base64') }), 'VALIDATION', 'tipe .exe ditolak');
ERR(api('files.upload', A.t, { convId: gp, name: 'palsu.pdf', data: Buffer.from('MZ bukan pdf').toString('base64') }), 'VALIDATION', 'isi tidak cocok dengan .pdf');
ERR(api('files.upload', A.t, { convId: gp, name: 'besar.pdf', data: Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') }), 'VALIDATION', 'lebih dari 5 MB');
ERR(api('files.upload', E.t, { convId: gp, name: 'a.pdf', data: pdf.toString('base64') }), 'FORBIDDEN', 'unggah ke grup yang bukan miliknya');
const att = OK(api('files.upload', A.t, { convId: gp, name: 'Materi Speaking.pdf', data: pdf.toString('base64') }), 'unggah pdf');
const img = OK(api('files.upload', A.t, { convId: gp, name: 'foto.png', data: png.toString('base64'), thumb: 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 1, 2]).toString('base64') }), 'unggah gambar');
ok(att.kind === 'pdf' && img.thumb === true, 'jenis & thumbnail');
ERR(api('files.get', C.t, { id: att.id }), 'NOT_FOUND', 'lampiran belum terkirim hanya bisa diakses pemilik');
ERR(api('chat.send', C.t, { convId: gp, body: 'curi', attachmentIds: [att.id] }), 'FORBIDDEN', 'pakai lampiran milik orang lain');
const wa = OK(api('chat.send', A.t, { convId: gp, body: '', attachmentIds: [att.id, img.id] }), 'kirim lampiran tanpa teks').message;
ok(wa.attachments.length === 2 && wa.attachments[0].name === 'Materi Speaking.pdf', 'lampiran menempel di pesan');
ERR(api('chat.send', A.t, { convId: gp, body: 'lagi', attachmentIds: [att.id] }), 'FORBIDDEN', 'lampiran tidak bisa dipakai dua kali');
const got = OK(api('files.get', C.t, { id: att.id }), 'cici unduh pdf');
ok(Buffer.from(got.data, 'base64').slice(0, 4).toString() === '%PDF' && got.name === 'Materi Speaking.pdf', 'isi file utuh');
ERR(api('files.get', E.t, { id: att.id }), 'NOT_FOUND', 'non-anggota tidak bisa unduh');
ok(Object.keys(OK(api('files.thumbs', C.t, { ids: [img.id, att.id] }), 'thumbs')).join() === img.id, 'thumbnail hanya untuk gambar');
ok(Object.keys(OK(api('files.thumbs', E.t, { ids: [img.id] }), 'thumbs eka')).length === 0, 'non-anggota tidak dapat thumbnail');
sC = OK(api('chat.sync', C.t, {}), 'inbox cici');
ok(sC.inbox.items.find(x => x.conv_id === gp).preview === 'Andi: File: Materi Speaking.pdf', 'pratinjau lampiran');
OK(api('chat.deleteMessage', A.t, { msgId: wa.id }), 'hapus pesan berlampiran');
ERR(api('files.get', C.t, { id: att.id }), 'NOT_FOUND', 'lampiran ikut terhapus');
const driveId = ctx.dbGet_('attachments', 'file_id', att.id).drive_id;
ok(state.files[driveId].trashed === true, 'file Drive dibuang ke sampah');

// Unggahan menggantung dibersihkan
const stale = OK(api('files.upload', A.t, { convId: gp, name: 'lupa.pdf', data: pdf.toString('base64') }), 'unggahan tidak dikirim');
ctx.dbUpdate_('attachments', 'file_id', stale.id, { created_at: '2020-01-01T00:00:00+07:00' });
ctx.dailyMaintenance();
ok(ctx.dbGet_('attachments', 'file_id', stale.id).context_type === 'deleted', 'unggahan menggantung dibersihkan');

// ---------- Riwayat panjang & cache hilang ----------
const conv = ctx.requireConv_(gp);
ctx.withLock_(() => { for (let i = 0; i < 130; i++) ctx.appendMessage_(conv, A.id, 'text', 'Pesan nomor ' + i); });
let o = OK(api('chat.open', C.t, { convId: gp }), 'buka grup ramai');
ok(o.messages.length === 50 && o.hasMore && o.messages[49].body === 'Pesan nomor 129', 'jendela 50 pesan terbaru');
let h = OK(api('chat.history', C.t, { convId: gp, beforeId: o.messages[0].id }), 'riwayat sebelumnya');
ok(h.messages.length === 50 && h.hasMore && h.messages[49].id < o.messages[0].id, 'halaman riwayat berikutnya');
sC = OK(api('chat.sync', C.t, {}), 'inbox cici setelah dibaca');
ok(sC.inbox.items.find(x => x.conv_id === gp).unread === 0, 'sudah dibaca setelah dibuka');
OK(api('chat.send', A.t, { convId: gp, body: 'Ada yang ikut Jumat?' }), 'pesan baru');
// Simulasi cache dikosongkan Google: semua perhitungan harus pulih dari sheet
for (const k of Object.keys(state.cache)) if (/^(cm|rd|mc|iv|cv|rv|rdw|u):/.test(k)) delete state.cache[k];
sC = OK(api('chat.sync', C.t, {}), 'sync setelah cache kosong');
ok(sC.inbox.items.find(x => x.conv_id === gp).unread === 1, 'jumlah belum dibaca pulih dari sheet: ' + sC.inbox.items.find(x => x.conv_id === gp).unread);
o = OK(api('chat.open', C.t, { convId: gp }), 'buka setelah cache kosong');
ok(o.messages[49].body === 'Ada yang ikut Jumat?', 'jendela pesan dibangun ulang dari sheet');

// ---------- Pencarian ----------
let sr = OK(api('chat.search', A.t, { q: 'essay' }), 'cari di semua percakapan');
ok(sr.items.length === 1 && sr.items[0].conv_name === 'Bela Test', 'hasil pencarian + nama percakapan');
ERR(api('chat.search', A.t, { q: 'e' }), 'VALIDATION', 'kata kunci terlalu pendek');
ok(OK(api('chat.search', E.t, { q: 'essay' }), 'eka cari').items.length === 0, 'tidak bisa mencari percakapan orang lain');
ERR(api('chat.search', E.t, { q: 'essay', convId: dm }), 'FORBIDDEN', 'cari di percakapan orang lain');

// ---------- Notifikasi & dashboard ----------
n = OK(api('notifications.list', A.t, {}), 'notif andi');
ok(n.items.some(x => x.type === 'group_admin'), 'notifikasi dijadikan admin/pemilik grup');
OK(api('notifications.markRead', A.t, { all: true }), 'tandai semua dibaca');
ok(OK(api('notifications.list', A.t, {}), 'notif').unread === 0, 'semua notifikasi terbaca');
const dsh = OK(api('dashboard.summary', C.t, {}), 'dashboard cici');
ok(dsh.stats.unread === 0 && dsh.recentConversations.length >= 1, 'dashboard memuat pesan terbaru');

// ---------- Akun dinonaktifkan ----------
OK(api('admin.setStatus', SA, { userId: B.id, status: 'suspended', reason: 'uji' }), 'suspend bela');
ERR(api('chat.sync', B.t, {}), 'AUTH', 'akun dinonaktifkan tidak bisa sync');
ok(OK(api('chat.open', A.t, { convId: dm }), 'andi tetap bisa membaca riwayat').conv.peer.active === false, 'lawan bicara ditandai tidak aktif');

ok(state.errors.length === 0, 'tanpa error server: ' + state.errors.join('\n'));
console.log('TAHAP 2 LULUS: ' + passed + ' pemeriksaan');
