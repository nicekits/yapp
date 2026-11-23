/**
 * Db.gs — repository generik di atas Google Spreadsheet.
 * Satu sheet = satu tabel, baris 1 = header. Kolom dibaca berdasarkan nama header.
 * Semua penulisan dibungkus LockService agar aman saat banyak pengguna menulis bersamaan.
 *
 * Jika kelak pindah ke Firestore, cukup ganti isi file ini.
 */

var DB_MEMO_ = {};          // cache per eksekusi: table -> { headers, rows }
var DB_SS_ = {};            // spreadsheet terbuka per eksekusi
var DB_LOCK_DEPTH_ = 0;

function dbSpreadsheet_(db) {
  if (DB_SS_[db]) return DB_SS_[db];
  var prop = db === 'main' ? 'DB_MAIN_ID' : 'DB_MSG_ID';
  var id = PropertiesService.getScriptProperties().getProperty(prop);
  if (!id) fail_('SETUP', 'Aplikasi belum di-setup. Jalankan setup() dari editor Apps Script.');
  DB_SS_[db] = SpreadsheetApp.openById(id);
  return DB_SS_[db];
}

function dbSheet_(table) {
  var sh = dbSpreadsheet_(schemaDbOf_(table)).getSheetByName(table);
  if (!sh) fail_('SETUP', 'Sheet "' + table + '" tidak ditemukan. Jalankan setup() lagi.');
  return sh;
}

/** Nilai JS -> nilai sel. String diberi awalan apostrof agar selalu disimpan sebagai teks
 *  (mencegah rumus dijalankan dan menjaga angka seperti NIM "0012" atau HP "0812..."). */
function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return "'" + Utilities.formatDate(v, APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  if (typeof v === 'object') v = JSON.stringify(v);
  var s = String(v);
  return s === '' ? '' : "'" + s;
}

function fromCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  return v;
}

function dbRead_(table) {
  if (DB_MEMO_[table]) return DB_MEMO_[table];
  var sh = dbSheet_(table);
  var values = sh.getDataRange().getValues();
  var headers = (values[0] || []).map(String);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r];
    var empty = true;
    var obj = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      var v = fromCell_(line[c]);
      if (v !== '' && v !== null) empty = false;
      obj[headers[c]] = v === null ? '' : v;
    }
    if (!empty) rows.push(obj);
  }
  DB_MEMO_[table] = { headers: headers, rows: rows };
  return DB_MEMO_[table];
}

function dbInvalidate_(table) {
  if (table) delete DB_MEMO_[table];
  else DB_MEMO_ = {};
}

function stripMeta_(row) {
  if (!row) return null;
  var o = {};
  for (var k in row) if (k !== '_row') o[k] = row[k];
  return o;
}

/* ---------- Baca ---------- */

function dbAll_(table) {
  return dbRead_(table).rows.map(stripMeta_);
}

function dbWhere_(table, predicate) {
  return dbRead_(table).rows.filter(predicate).map(stripMeta_);
}

function dbFindOne_(table, predicate) {
  var rows = dbRead_(table).rows;
  for (var i = 0; i < rows.length; i++) if (predicate(rows[i])) return stripMeta_(rows[i]);
  return null;
}

function dbGet_(table, field, value) {
  return dbFindOne_(table, function (r) { return String(r[field]) === String(value); });
}

/* ---------- Tulis (selalu di dalam kunci) ---------- */

function withLock_(fn) {
  if (DB_LOCK_DEPTH_ > 0) return fn();       // sudah di dalam kunci
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('BUSY', 'Server sedang sibuk. Coba lagi beberapa detik lagi.');
  DB_LOCK_DEPTH_++;
  dbInvalidate_();                            // baca ulang data segar di dalam kunci
  try {
    return fn();
  } finally {
    DB_LOCK_DEPTH_--;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function dbInsert_(table, obj) {
  return withLock_(function () {
    var headers = dbRead_(table).headers;
    var row = headers.map(function (h) { return toCell_(obj[h]); });
    dbSheet_(table).appendRow(row);
    dbInvalidate_(table);
    return obj;
  });
}

/** Tambah banyak baris sekaligus (satu panggilan setValues, jauh lebih cepat dari appendRow berulang). */
function dbInsertMany_(table, objs) {
  if (!objs.length) return 0;
  return withLock_(function () {
    var headers = dbRead_(table).headers;
    var sh = dbSheet_(table);
    var values = objs.map(function (o) { return headers.map(function (h) { return toCell_(o[h]); }); });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
    dbInvalidate_(table);
    return values.length;
  });
}

/** Perbarui satu baris berdasarkan field kunci. Mengembalikan baris setelah diubah, atau null. */
function dbUpdate_(table, field, value, patch) {
  return withLock_(function () {
    var data = dbRead_(table);
    var row = null;
    for (var i = 0; i < data.rows.length; i++) {
      if (String(data.rows[i][field]) === String(value)) { row = data.rows[i]; break; }
    }
    if (!row) return null;
    writeRow_(table, data.headers, row, patch);
    dbInvalidate_(table);
    var out = stripMeta_(row);
    for (var k in patch) out[k] = patch[k];
    return out;
  });
}

/** Perbarui semua baris yang cocok. patchFn(row) mengembalikan objek patch atau null. */
function dbUpdateWhere_(table, predicate, patchFn) {
  return withLock_(function () {
    var data = dbRead_(table);
    var count = 0;
    data.rows.forEach(function (row) {
      if (!predicate(row)) return;
      var patch = patchFn(row);
      if (!patch) return;
      writeRow_(table, data.headers, row, patch);
      count++;
    });
    dbInvalidate_(table);
    return count;
  });
}

/** Hapus permanen baris yang TIDAK lolos keepFn (untuk pembersihan berkala). */
function dbPrune_(table, keepFn) {
  return withLock_(function () {
    var data = dbRead_(table);
    var keep = data.rows.filter(keepFn);
    var removed = data.rows.length - keep.length;
    if (!removed) return 0;
    var sh = dbSheet_(table);
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, data.headers.length).clearContent();
    if (keep.length) {
      var values = keep.map(function (r) {
        return data.headers.map(function (h) { return toCell_(r[h]); });
      });
      sh.getRange(2, 1, values.length, data.headers.length).setValues(values);
    }
    dbInvalidate_(table);
    return removed;
  });
}

function writeRow_(table, headers, row, patch) {
  var merged = headers.map(function (h) {
    var v = Object.prototype.hasOwnProperty.call(patch, h) ? patch[h] : row[h];
    return toCell_(v);
  });
  dbSheet_(table).getRange(row._row, 1, 1, headers.length).setValues([merged]);
}
