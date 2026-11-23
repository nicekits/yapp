/**
 * Metrics.gs — metrik ringan per menit untuk memantau beban (dipakai saat uji 20 orang).
 * Disimpan di CacheService (1 jam), jadi tidak menambah beban spreadsheet.
 * Penghitungan tidak atomik: di bawah beban tinggi sebagian kecil hitungan bisa terlewat,
 * jadi angkanya adalah perkiraan, bukan catatan audit.
 *
 * Catatan penting: bila Google menolak permintaan karena batas 30 eksekusi bersamaan,
 * kode server tidak pernah berjalan. Penolakan itu dihitung di browser (cerr) dan
 * dilaporkan pada sinkronisasi berikutnya.
 */

function metricKey_(ms) {
  return 'mt:' + Math.floor((ms || Date.now()) / 60000);
}

function recordMetric_(action, ms, errCode) {
  if (!APP.METRICS_ENABLED) return;
  try {
    var key = metricKey_();
    var m = cacheGetJson_(key) || { n: 0, ms: 0, max: 0, err: 0, busy: 0, cerr: 0, sync: 0, syncMs: 0 };
    m.n++; m.ms += ms; if (ms > m.max) m.max = ms;
    if (errCode === 'SERVER') m.err++;
    if (errCode === 'BUSY') m.busy++;
    if (action === 'chat.sync') { m.sync++; m.syncMs += ms; }
    cachePutJson_(key, m, 3600);
  } catch (e) { /* metrik tidak boleh mengganggu permintaan */ }
}

function recordClientErrors_(n) {
  if (!APP.METRICS_ENABLED) return;
  var key = metricKey_();
  var m = cacheGetJson_(key) || { n: 0, ms: 0, max: 0, err: 0, busy: 0, cerr: 0, sync: 0, syncMs: 0 };
  m.cerr += n;
  cachePutJson_(key, m, 3600);
}

function adminMetrics_(data, ctx) {
  var minutes = Math.min(60, Math.max(5, parseInt(data.minutes, 10) || 30));
  var nowMin = Math.floor(Date.now() / 60000);
  var keys = [];
  for (var i = minutes - 1; i >= 0; i--) keys.push('mt:' + (nowMin - i));
  var got = cache_().getAll(keys);
  var sum = { n: 0, ms: 0, max: 0, err: 0, busy: 0, cerr: 0, sync: 0, syncMs: 0, peak: 0 };
  var buckets = keys.map(function (k) {
    var m = got[k] ? JSON.parse(got[k]) : { n: 0, ms: 0, max: 0, err: 0, busy: 0, cerr: 0, sync: 0, syncMs: 0 };
    ['n', 'ms', 'err', 'busy', 'cerr', 'sync', 'syncMs'].forEach(function (f) { sum[f] += m[f] || 0; });
    if (m.max > sum.max) sum.max = m.max;
    if (m.n > sum.peak) sum.peak = m.n;
    var t = new Date(parseInt(k.slice(3), 10) * 60000);
    return {
      t: Utilities.formatDate(t, APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"), n: m.n, avg: m.n ? Math.round(m.ms / m.n) : 0, max: m.max,
      err: m.err, busy: m.busy, cerr: m.cerr, syncAvg: m.sync ? Math.round(m.syncMs / m.sync) : 0
    };
  });

  var storage = [];
  var cells = { main: 0, msg: 0 };
  ['main', 'msg'].forEach(function (db) {
    Object.keys(SCHEMA[db]).forEach(function (t) {
      var sh = dbSheet_(t);
      var rows = Math.max(0, sh.getLastRow() - 1);
      cells[db] += sh.getLastRow() * sh.getLastColumn();
      if (rows) storage.push({ table: t, rows: rows });
    });
  });
  storage.sort(function (a, b) { return b.rows - a.rows; });

  return {
    minutes: minutes, buckets: buckets,
    summary: {
      requests: sum.n, avgMs: sum.n ? Math.round(sum.ms / sum.n) : 0, maxMs: sum.max, perMinutePeak: sum.peak,
      serverErrors: sum.err, busy: sum.busy, clientErrors: sum.cerr, syncAvgMs: sum.sync ? Math.round(sum.syncMs / sum.sync) : 0
    },
    online: onlineList_(ctx.user, 1).total,
    mailQuota: MailApp.getRemainingDailyQuota(),
    storage: storage.slice(0, 8),
    cells: { main: cells.main, msg: cells.msg, limit: 10000000 },
    enabled: APP.METRICS_ENABLED
  };
}
