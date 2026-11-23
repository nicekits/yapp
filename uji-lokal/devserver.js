// Server uji: menyajikan hasil doGet() dan meneruskan google.script.run.api ke backend mock.
const http = require('http');
const path = require('path');
const { load } = require('./gasmock');

const g = load(path.resolve(__dirname, '../komunitas-gas'));
const { ctx, state } = g;
ctx.SETUP_ADMIN.email = 'pengurus.edc@gmail.com';
ctx.SETUP_ADMIN.full_name = 'Rina Pratama';
ctx.setup();
const adminPw = state.logs.find(l => l.startsWith('PASSWORD SEMENTARA')).split(': ')[1].split(' ')[0];

// Data contoh
const people = [
  ['Ahmad Fauzi', '2025', 'A'], ['Siti Rahmawati', '2025', 'A'], ['Dimas Saputra', '2025', 'B'],
  ['Nabila Putri', '2024', 'A'], ['Rizky Ramadhan', '2024', 'B'], ['Aulia Zahra', '2024', 'C'],
  ['Fajar Nugroho', '2023', 'A'], ['Intan Permata', '2023', 'B'], ['Yoga Pratama', '2022', 'A'],
  ['Maya Sari', '2025', 'C'], ['Kevin Wijaya', '2024', 'A'], ['Laras Anindya', '2023', 'C'],
  ['Hendra Gunawan', '2025', 'B'], ['Putri Ayu', '2025', 'A'], ['Bayu Setiawan', '2024', 'B']
];
const adminTok = ctx.api('auth.login', null, { identifier: 'superadmin', password: adminPw }).data.token;
const tokens = {};
people.forEach((p, i) => {
  const uname = p[0].toLowerCase().split(' ')[0] + i;
  const r = ctx.api('auth.register', null, {
    full_name: p[0], email: uname + '@example.com', username: uname, nim: '2' + p[1].slice(2) + '1000' + String(i).padStart(2, '0'),
    angkatan: p[1], kelas: p[2], phone: '08123' + String(100000 + i), password: 'rahasia123', password2: 'rahasia123', deviceId: 'seed' + i
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  if (i < 12) {
    const id = ctx.dbGet_('users', 'username', uname).user_id;
    ctx.api('admin.decide', adminTok, { userId: id, decision: 'approve' });
    if (i < 5) tokens[uname] = ctx.api('auth.login', null, { identifier: uname, password: 'rahasia123' }).data.token; // agar online
  }
});
const nabila = ctx.dbGet_('users', 'username', 'nabila3').user_id;
ctx.api('admin.setRole', adminTok, { userId: nabila, role: 'moderator' });
ctx.api('admin.updateProfile', adminTok, { userId: nabila, jabatan: 'Koordinator Speaking' });
// Data contoh Tahap 2: grup & percakapan
const uid = u => ctx.dbGet_('users', 'username', u).user_id;
const toks = {};
const tok = u => toks[u] || (toks[u] = ctx.api('auth.login', null, { identifier: u, password: 'rahasia123' }).data.token);
const must = (r, m) => { if (!r.ok) throw new Error(m + ': ' + JSON.stringify(r.error)); return r.data; };
const sp = must(ctx.api('groups.create', tok('nabila3'), { name: 'Speaking Practice', description: 'Latihan speaking tiap Jumat sore. Topik minggu ini: daily routine.', visibility: 'public', memberIds: [uid('ahmad0'), uid('siti1'), uid('dimas2')] }), 'grup sp').conv_id;
must(ctx.api('groups.create', adminTok, { name: 'Angkatan 2025', description: 'Grup resmi angkatan 2025.', visibility: 'private', is_official: true, memberIds: [uid('ahmad0'), uid('siti1'), uid('dimas2'), uid('maya9')] }), 'grup angkatan');
must(ctx.api('groups.create', tok('nabila3'), { name: 'TOEFL Preparation', description: 'Berbagi soal dan strategi TOEFL ITP.', visibility: 'public' }), 'grup toefl');
const say = (u, conv, body, extra) => must(ctx.api('chat.send', tok(u), Object.assign({ convId: conv, body }, extra || {})), 'kirim').message;
say('nabila3', sp, "Hi everyone! This Friday we'll practice daily routine conversations.");
const q1 = say('ahmad0', sp, 'Great! Can we also practice phrasal verbs?');
say('siti1', sp, 'I usually wake up at 5 AM, then I go jogging around campus.');
say('nabila3', sp, "Sure, let's add 'wake up', 'get up', and 'set off'. Reference: https://dictionary.cambridge.org", { replyToId: q1.id });
const dmA = must(ctx.api('chat.openDirect', tok('ahmad0'), { userId: ctx.dbGet_('users', 'username', 'superadmin').user_id }), 'dm').conv_id;
say('ahmad0', dmA, 'Selamat pagi Kak, apakah materi grammar minggu lalu sudah diunggah?');
const dmS = must(ctx.api('chat.openDirect', tok('siti1'), { userId: ctx.dbGet_('users', 'username', 'superadmin').user_id }), 'dm2').conv_id;
say('siti1', dmS, 'Kak, link rekaman seminar kemarin ada?');
// Data contoh Tahap 3
const cats = must(ctx.api('forum.categories', tok('ahmad0'), {}), 'cats');
const catId = n => cats.find(c => c.name === n).cat_id;
const t1 = must(ctx.api('forum.create', tok('ahmad0'), { cat_id: catId('Grammar'), title: 'Kapan memakai Present Perfect, bukan Simple Past?',
  body: 'Saya masih bingung. Contoh: "I have finished my essay" vs "I finished my essay yesterday". Apa aturan praktisnya?' }), 't1').disc_id;
const rp1 = must(ctx.api('forum.reply', tok('nabila3'), { discId: t1, body: 'Aturan praktis: kalau ada keterangan waktu lampau yang spesifik (yesterday, last week), pakai Simple Past. Kalau fokus ke hasil/pengalaman tanpa waktu spesifik, pakai Present Perfect.' }), 'r1').comment;
must(ctx.api('forum.reply', tok('siti1'), { discId: t1, parentId: rp1.comment_id, body: 'Contoh lain: "Have you ever been to London?" — pengalaman.' }), 'c1');
must(ctx.api('forum.reply', tok('dimas2'), { discId: t1, body: 'Referensi bagus: https://dictionary.cambridge.org/grammar/british-grammar/present-perfect' }), 'r2');
must(ctx.api('forum.react', tok('siti1'), { targetType: 'discussion', targetId: t1, type: 'like' }), 'rx');
must(ctx.api('forum.react', tok('dimas2'), { targetType: 'discussion', targetId: t1, type: 'agree' }), 'rx2');
must(ctx.api('forum.react', tok('ahmad0'), { targetType: 'comment', targetId: rp1.comment_id, type: 'thanks' }), 'rx3');
must(ctx.api('forum.moderate', tok('nabila3'), { discId: t1, important: true }), 'mod');
const t2 = must(ctx.api('forum.create', tok('nabila3'), { cat_id: catId('Speaking'), title: 'Tips latihan speaking sendiri di rumah',
  body: 'Coba teknik shadowing 10 menit setiap pagi: dengarkan podcast pendek, lalu tirukan intonasinya.' }), 't2').disc_id;
must(ctx.api('forum.moderate', tok('nabila3'), { discId: t2, pin: true }), 'pin');
must(ctx.api('forum.create', tok('siti1'), { cat_id: catId('Literature'), title: 'Rekomendasi novel klasik untuk pemula?', body: 'Yang bahasanya tidak terlalu sulit.' }), 't3');
must(ctx.api('forum.create', tok('dimas2'), { cat_id: catId('Writing'), title: 'Struktur essay argumentatif 5 paragraf', body: 'Intro, 3 body paragraph, conclusion. Ada template?' }), 't4');
const rc = must(ctx.api('resources.list', adminTok, {}), 'rc').categories;
const rcat = n => rc.find(c => c.name === n).cat_id;
const pdfB64 = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(180000, 32)]).toString('base64');
const ra = must(ctx.api('files.upload', adminTok, { scope: 'resource', name: 'Tenses Cheat Sheet.pdf', data: pdfB64 }), 'ra');
must(ctx.api('resources.create', adminTok, { cat_id: rcat('Grammar'), title: 'Tenses Cheat Sheet', description: 'Ringkasan 16 tenses dengan rumus dan contoh kalimat.', kind: 'file', attachmentId: ra.id }), 'res1');
must(ctx.api('resources.create', tok('nabila3'), { cat_id: rcat('Listening'), title: 'BBC Learning English — 6 Minute English', description: 'Podcast pendek untuk latihan listening harian.', kind: 'link', url: 'https://www.bbc.co.uk/learningenglish' }), 'res2');
must(ctx.api('resources.create', tok('nabila3'), { cat_id: rcat('Speaking'), title: 'Cambridge Dictionary (pronunciation)', description: 'Cek pengucapan British & American.', kind: 'link', url: 'https://dictionary.cambridge.org' }), 'res3');
must(ctx.api('resources.create', tok('ahmad0'), { cat_id: rcat('Writing'), title: 'Purdue OWL — Essay Writing', description: 'Panduan menulis essay akademik.', kind: 'link', url: 'https://owl.purdue.edu' }), 'res4 pending');
const lp = h => new Date(Date.now() + h * 3600000 + 7 * 3600000).toISOString().slice(0, 16);
must(ctx.api('announcements.save', adminTok, { title: 'Perubahan jadwal kelas Speaking', body: 'Kelas Speaking hari Jumat dipindah ke Ruang 204 mulai minggu ini.', priority: 'mendesak', is_pinned: true }), 'ann1');
must(ctx.api('announcements.save', adminTok, { title: 'Pendaftaran TOEFL Prediction Test', body: 'Tes gratis untuk anggota. Daftar paling lambat 30 November di sekretariat.', priority: 'penting' }), 'ann2');
must(ctx.api('announcements.save', adminTok, { title: 'Rapat angkatan 2025', body: 'Rapat koordinasi angkatan, Rabu 16.00 di Aula.', audience: 'angkatan:2025' }), 'ann3');
const ev1 = must(ctx.api('events.save', adminTok, { title: 'Debate Workshop', description: 'Latihan debat format British Parliamentary bersama alumni.', location: 'Aula Lt. 2', start_at: lp(72), end_at: lp(75), reg_deadline: lp(48), quota: 30 }), 'ev1').event_id;
must(ctx.api('events.save', adminTok, { title: 'Seminar: Teaching English with Technology', description: 'Pembicara: dosen tamu.', location: 'https://meet.google.com/abc-defg-hij', start_at: lp(170), end_at: lp(172) }), 'ev2');
must(ctx.api('events.save', adminTok, { title: 'Welcome Party Angkatan 2025', location: 'Taman Kampus', start_at: lp(-200), end_at: lp(-196) }), 'ev3');
['ahmad0', 'siti1', 'dimas2', 'nabila3'].forEach(u => must(ctx.api('events.register', tok(u), { eventId: ev1 }), 'reg ' + u));
// Data contoh Tahap 4: laporan
const spam = must(ctx.api('forum.create', tok('kevin10'), { cat_id: catId('General'), title: 'DIJUAL akun streaming premium murah', body: 'Chat saya untuk harga spesial!!! Bisa nego.' }), 'spam').disc_id;
must(ctx.api('reports.create', tok('siti1'), { targetType: 'discussion', targetId: spam, reason: 'spam', note: 'Promosi jualan di forum belajar' }), 'rep1');
must(ctx.api('reports.create', tok('dimas2'), { targetType: 'discussion', targetId: spam, reason: 'spam' }), 'rep2');
console.log('ADMIN_PW=' + adminPw);

const shim = `<script>
window.google = { script: { run: (function () {
  function runner(ok, fail) {
    return {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); },
      api: function (action, token, data) {
        fetch('/api', { method: 'POST', body: JSON.stringify({ action: action, token: token, data: data }) })
          .then(function (r) { return r.json(); })
          .then(function (res) { setTimeout(function () { ok && ok(res); }, 120); })
          .catch(function (e) { fail && fail(e); });
      }
    };
  }
  return runner(null, null);
})() } };
</script>`;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const { action, token, data } = JSON.parse(body);
      const out = ctx.api(action, token, JSON.parse(JSON.stringify(data || {})));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  const u = new URL(req.url, 'http://x');
  const page = ctx.doGet({ parameter: Object.fromEntries(u.searchParams) });
  const html = page.content.replace('<body>', '<body>' + shim).replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="' + page.meta.c + '">');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(8765, () => console.log('READY'));
