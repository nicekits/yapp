/**
 * Util.gs — fungsi bantu: error, ID, waktu, hash, cache, rate limit, validasi.
 */

/** Error yang aman ditampilkan ke pengguna. code dipakai frontend untuk menentukan reaksi. */
function AppError(code, message) {
  this.name = 'AppError';
  this.code = code;
  this.message = message;
}
AppError.prototype = Object.create(Error.prototype);

function fail_(code, message) {
  throw new AppError(code, message);
}

/* ---------- ID & waktu ---------- */

function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function nowIso_() {
  return Utilities.formatDate(new Date(), APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function isoPlus_(ms) {
  return Utilities.formatDate(new Date(Date.now() + ms), APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** '2026-11-29T14:00:00+07:00' → 'Sabtu, 29/11 14.00' (waktu Jakarta). */
function fmtWhen_(iso) {
  var d = new Date(iso);
  var days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  var u = parseInt(Utilities.formatDate(d, APP.TIMEZONE, 'u'), 10);
  return days[u - 1] + ', ' + Utilities.formatDate(d, APP.TIMEZONE, 'dd/MM HH.mm');
}

function toMs_(iso) {
  if (!iso) return 0;
  var t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

/* ---------- Hash & token ---------- */

function bytesToHex_(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out.push((b < 16 ? '0' : '') + b.toString(16));
  }
  return out.join('');
}

function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text,
    Utilities.Charset.UTF_8));
}

function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function getPepper_() {
  var pepper = PropertiesService.getScriptProperties().getProperty('PEPPER');
  if (!pepper) fail_('SETUP', 'Aplikasi belum di-setup. Jalankan setup() dari editor Apps Script.');
  return pepper;
}

/**
 * Hash password: HMAC-SHA256 berulang dengan salt per pengguna + pepper rahasia.
 * Format tersimpan: v1$<iterasi>$<salt>$<hash>
 */
function hashPassword_(password, salt, iterations) {
  salt = salt || Utilities.getUuid().replace(/-/g, '');
  iterations = iterations || APP.HASH_ITERATIONS;
  var pepper = getPepper_();
  var h = bytesToHex_(Utilities.computeHmacSha256Signature(salt + ':' + password, pepper));
  for (var i = 1; i < iterations; i++) {
    h = bytesToHex_(Utilities.computeHmacSha256Signature(h + salt, pepper));
  }
  return 'v1$' + iterations + '$' + salt + '$' + h;
}

function verifyPassword_(password, stored) {
  if (!stored) return false;
  var parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  var computed = hashPassword_(password, parts[2], parseInt(parts[1], 10));
  return safeEqual_(computed, stored);
}

/** Perbandingan string dengan waktu konstan. */
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- Cache ---------- */

function cache_() {
  return CacheService.getScriptCache();
}

function cacheGetJson_(key) {
  var v = cache_().get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

function cachePutJson_(key, obj, seconds) {
  try {
    cache_().put(key, JSON.stringify(obj), Math.min(seconds, 21600));
  } catch (e) {
    // Nilai terlalu besar untuk cache: abaikan, data tetap dibaca dari sheet.
  }
}

/**
 * Rate limit sederhana berbasis cache. Mengembalikan false jika batas terlampaui.
 * Tidak 100% atomik, tapi cukup untuk mencegah spam.
 */
function rateLimit_(key, max, windowSeconds) {
  var c = cache_();
  var k = 'rl:' + key;
  var n = parseInt(c.get(k) || '0', 10);
  if (n >= max) return false;
  c.put(k, String(n + 1), windowSeconds);
  return true;
}

/* ---------- Validasi & sanitasi ---------- */

function str_(v, maxLen) {
  var s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function requireField_(value, label) {
  if (!value) fail_('VALIDATION', label + ' wajib diisi.');
  return value;
}

function isEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function validatePassword_(pw) {
  if (!pw || pw.length < APP.PASSWORD_MIN_LENGTH) {
    fail_('VALIDATION', 'Password minimal ' + APP.PASSWORD_MIN_LENGTH + ' karakter.');
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    fail_('VALIDATION', 'Password harus mengandung huruf dan angka.');
  }
  if (pw.length > 128) fail_('VALIDATION', 'Password terlalu panjang.');
}

function validateAngkatan_(v) {
  var year = parseInt(v, 10);
  var max = new Date().getFullYear() + 1;
  if (!/^\d{4}$/.test(String(v)) || year < 1990 || year > max) {
    fail_('VALIDATION', 'Angkatan harus berupa tahun 4 digit (1990–' + max + ').');
  }
  return String(year);
}

function parseJson_(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function bool_(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
}
