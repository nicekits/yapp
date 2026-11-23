/**
 * Acl.gs — sesi, pemuatan pengguna, dan pemeriksaan hak akses.
 */

/* ---------- Pengguna ---------- */

var USER_CACHE_SECONDS = 300;

/** Memuat user + profil (dengan cache 5 menit). */
function loadUser_(userId) {
  var key = 'u:' + userId;
  var cached = cacheGetJson_(key);
  if (cached) return cached;
  var user = dbGet_('users', 'user_id', userId);
  if (!user) return null;
  var profile = dbGet_('profiles', 'user_id', userId) || {};
  var bundle = { user: user, profile: profile };
  cachePutJson_(key, bundle, USER_CACHE_SECONDS);
  return bundle;
}

function uncacheUser_(userId) {
  cache_().removeAll(['u:' + userId, 'snap:am']);
  APPROVED_MEMO_ = null;
}

function rankOf_(role) {
  return ROLE_RANK[role] || 0;
}

/** true jika actor boleh bertindak terhadap target (role target harus lebih rendah). */
function outranks_(actor, target) {
  return rankOf_(actor.role) > rankOf_(target.role);
}

function isStaff_(user, minRole) {
  return rankOf_(user.role) >= rankOf_(minRole);
}

/* ---------- Sesi ---------- */

function sessionLifetimeMs_(remember) {
  return remember
    ? APP.SESSION_REMEMBER_DAYS * 24 * 3600 * 1000
    : APP.SESSION_IDLE_HOURS * 3600 * 1000;
}

function createSession_(userId, remember, userAgent) {
  var token = randomToken_();
  var th = sha256Hex_(token);
  var now = Date.now();
  var exp = now + sessionLifetimeMs_(remember);
  dbInsert_('sessions', {
    token_hash: th,
    user_id: userId,
    created_at: nowIso_(),
    expires_at: isoPlus_(exp - now),
    last_used_at: nowIso_(),
    remember: !!remember,
    user_agent: str_(userAgent, 200),
    revoked_at: ''
  });
  cacheSession_(th, { user_id: userId, exp: exp, remember: !!remember, touched: now });
  return token;
}

function cacheSession_(th, s) {
  var ttl = Math.floor((s.exp - Date.now()) / 1000);
  if (ttl > 0) cachePutJson_('sess:' + th, s, ttl);
}

/** Mengembalikan { th, user_id, ... } atau null jika token tidak valid / kedaluwarsa. */
function resolveSession_(token) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;
  var th = sha256Hex_(token);
  var s = cacheGetJson_('sess:' + th);
  if (!s) {
    var row = dbGet_('sessions', 'token_hash', th);
    if (!row || row.revoked_at) return null;
    s = {
      user_id: row.user_id,
      exp: toMs_(row.expires_at),
      remember: bool_(row.remember),
      touched: toMs_(row.last_used_at)
    };
  }
  var now = Date.now();
  if (!s.exp || s.exp < now) return null;

  // Sesi bergeser (sliding): perpanjang paling sering tiap SESSION_TOUCH_MINUTES.
  if (now - (s.touched || 0) > APP.SESSION_TOUCH_MINUTES * 60 * 1000) {
    s.exp = now + sessionLifetimeMs_(s.remember);
    s.touched = now;
    dbUpdate_('sessions', 'token_hash', th, {
      expires_at: isoPlus_(s.exp - now),
      last_used_at: nowIso_()
    });
  }
  cacheSession_(th, s);
  s.th = th;
  return s;
}

function revokeSession_(th) {
  cache_().remove('sess:' + th);
  dbUpdate_('sessions', 'token_hash', th, { revoked_at: nowIso_() });
}

/** Cabut semua sesi milik user, kecuali exceptTh (opsional). */
function revokeAllSessions_(userId, exceptTh) {
  var keys = [];
  dbUpdateWhere_('sessions',
    function (r) {
      return String(r.user_id) === String(userId) && !r.revoked_at && r.token_hash !== exceptTh;
    },
    function (r) {
      keys.push('sess:' + r.token_hash);
      return { revoked_at: nowIso_() };
    });
  if (keys.length) cache_().removeAll(keys);
  return keys.length;
}

/* ---------- Pemeriksaan akses ---------- */

var STATUS_BLOCK_MESSAGES = {
  pending: 'Akun Anda masih menunggu persetujuan admin.',
  rejected: 'Pendaftaran Anda ditolak.',
  suspended: 'Akun Anda sedang dinonaktifkan. Hubungi admin.'
};

/** Memastikan token valid dan akun Approved. Mengembalikan konteks permintaan. */
function requireUser_(token) {
  var s = resolveSession_(token);
  if (!s) fail_('AUTH', 'Sesi Anda telah berakhir. Silakan login kembali.');
  var bundle = loadUser_(s.user_id);
  if (!bundle) {
    revokeSession_(s.th);
    fail_('AUTH', 'Akun tidak ditemukan.');
  }
  if (bundle.user.status !== STATUS.APPROVED) {
    revokeSession_(s.th);
    fail_('AUTH', STATUS_BLOCK_MESSAGES[bundle.user.status] || 'Akun tidak aktif.');
  }
  return { user: bundle.user, profile: bundle.profile, session: s };
}

function checkPermission_(action, user) {
  var allowed = PERMISSIONS[action];
  if (allowed === 'public') return;
  if (!allowed || allowed.indexOf(user.role) < 0) {
    fail_('FORBIDDEN', 'Anda tidak memiliki izin untuk tindakan ini.');
  }
}

/* ---------- Log audit ---------- */

function audit_(actorId, action, targetType, targetId, detail) {
  dbInsert_('audit_logs', {
    log_id: newId_('log'),
    actor_id: actorId,
    action: action,
    target_type: targetType,
    target_id: targetId,
    detail_json: detail ? JSON.stringify(detail) : '',
    created_at: nowIso_()
  });
}
