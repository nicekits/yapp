// Uji alat bantu uji beban + simulasi 20 pengguna aktif (urutan, bukan paralel: mock tidak punya konkurensi nyata).
const assert = require('assert');
const path = require('path');
const { load } = require('./gasmock');
const g = load(path.resolve(__dirname, process.env.SRC || '../komunitas-gas'));
const { ctx, state } = g;
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const OK = (r, m) => { if (!r.ok) throw new Error(m + ' → ' + JSON.stringify(r.error)); passed++; return r.data; };
ctx.SETUP_ADMIN.email = 'admin@yapp.test';
ctx.setup();
const r = ctx.buatAkunUji(20);
ok(r.users === 20 && r.password.startsWith('Uji-'), 'akun uji dibuat');
ok(state.logs.some(l => l.startsWith('PASSWORD BERSAMA AKUN UJI')), 'password tercetak di log');
const again = ctx.buatAkunUji(20);
ok(ctx.dbWhere_('users', u => /^uji\d\d$/.test(u.username)).length === 20, 'dijalankan ulang tidak menduplikasi');
const toks = [];
for (let i = 1; i <= 20; i++) toks.push(OK(ctx.api('auth.login', null, { identifier: 'uji' + String(i).padStart(2, '0'), password: again.password }), 'login ' + i).token);
const gid = again.group;
const page = ctx.doGet({ parameter: {} });
ok(page.content.includes('"sync":{"open":3000'), 'interval sinkronisasi dikirim ke browser');
// Simulasi: 20 orang × 5 putaran: kirim pesan lalu semua sinkron
const st = toks.map(() => ({ iv: '', cv: '', rv: '' }));
let sent = 0;
for (let round = 0; round < 5; round++) {
  toks.forEach((t, i) => { if ((i + round) % 4 === 0) { OK(ctx.api('chat.send', t, { convId: gid, body: 'r' + round + ' dari ' + i }), 'kirim'); sent++; } });
  toks.forEach((t, i) => {
    const s = OK(ctx.api('chat.sync', t, { convId: gid, cv: st[i].cv, rv: st[i].rv, iv: st[i].iv, visible: true, wantOnline: round === 0 }), 'sync');
    if (s.conv) st[i].cv = s.conv.cv; if (s.reads) st[i].rv = s.reads.rv; if (s.iv) st[i].iv = s.iv;
  });
}
const view = OK(ctx.api('chat.open', toks[7], { convId: gid }), 'buka grup').messages.filter(m => m.kind === 'text');
ok(view.length === sent, 'semua pesan tersimpan tanpa hilang/dobel: ' + view.length + '/' + sent);
const quiet = toks.map((t, i) => ctx.api('chat.sync', t, { convId: gid, cv: st[i].cv, rv: st[i].rv, iv: st[i].iv, visible: true }).data);
ok(quiet.every(q => !q.conv && !q.inbox), 'tanpa pesan baru, polling tidak membawa data pesan');
const mt = OK(ctx.api('admin.metrics', OK(ctx.api('auth.login', null, { identifier: 'superadmin', password: state.logs.find(l => l.startsWith('PASSWORD SEMENTARA')).split(': ')[1].split(' ')[0] }), 'sa').token, {}), 'metrik');
ok(mt.summary.requests === 167 && mt.online >= 20, 'metrik mencatat ' + mt.summary.requests + ' permintaan, ' + mt.online + ' online');
ok(ctx.nonaktifkanAkunUji() === 20, 'akun uji dinonaktifkan');
ok(!ctx.api('chat.sync', toks[0], {}).ok, 'sesi akun uji dicabut');
ok(state.errors.length === 0, 'tanpa error server');
console.log('ALAT UJI BEBAN LULUS: ' + passed + ' pemeriksaan');
