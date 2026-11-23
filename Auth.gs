/**
 * Auth.gs — registrasi, login, logout, ganti password, lupa & reset password.
 */

var DEFAULT_PRIVACY = { hide_nim: false, hide_phone: true, hide_email: true, allow_dm: true };

/** Data diri yang dikirim ke pemilik akun sendiri. */
function publicMe_(user, profile) {
  profile = profile || {};
  return {
    user_id: user.user_id,
    email: user.email,
    username: user.username,
    role: user.role,
    role_label: ROLE_LABELS[user.role] || user.role,
    status: user.status,
    full_name: profile.full_name || user.username,
    nim: profile.nim || '',
    angkatan: profile.angkatan ? String(profile.angkatan) : '',
    kelas: profile.kelas || '',
    jabatan: profile.jabatan || '',
    bio: profile.bio || '',
    phone: profile.phone || '',
    photo_file_id: profile.photo_file_id || '',
    privacy: parseJson_(profile.privacy_json, DEFAULT_PRIVACY),
    notif: parseJson_(profile.notif_json, {}),
    theme: profile.theme || 'light',
    created_at: user.created_at,
    last_login_at: user.last_login_at
  };
}

/* ---------- Registrasi ---------- */

function authRegister_(data) {
  var deviceId = str_(data.deviceId, 64) || 'unknown';
  var email = str_(data.email, 120).toLowerCase();
  var username = str_(data.username, 20).toLowerCase();
  var fullName = str_(data.full_name, 80);
  var nim = str_(data.nim, 30);
  var kelas = str_(data.kelas, 30);
  var phone = str_(data.phone, 20);
  var password = data.password ? String(data.password) : '';

  requireField_(fullName, 'Nama lengkap');
  requireField_(email, 'Email');
  requireField_(username, 'Username');
  requireField_(nim, 'NIM');
  requireField_(kelas, 'Kelas');
  if (!isEmail_(email)) fail_('VALIDATION', 'Format email tidak valid.');
  if (!getSetting_('registration_open')) {
    fail_('CLOSED', 'Pendaftaran anggota baru sedang ditutup. Hubungi pengurus komunitas.');
  }
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
    fail_('VALIDATION', 'Username 3–20 karakter: huruf kecil, angka, titik, atau garis bawah.');
  }
  if (!/^[A-Za-z0-9.\-\/]{3,30}$/.test(nim)) fail_('VALIDATION', 'Format NIM tidak valid.');
  if (phone && !/^[0-9+\-\s]{8,20}$/.test(phone)) fail_('VALIDATION', 'Format nomor HP tidak valid.');
  var angkatan = validateAngkatan_(data.angkatan);
  validatePassword_(password);
  if (data.password !== data.password2) fail_('VALIDATION', 'Konfirmasi password tidak sama.');

  if (!rateLimit_('reg:' + deviceId, APP.REGISTER_MAX_PER_HOUR, 3600)) {
    fail_('RATE_LIMIT', 'Terlalu banyak pendaftaran dari perangkat ini. Coba lagi dalam 1 jam.');
  }

  var hash = hashPassword_(password);   // di luar kunci: proses hash cukup lama
  var now = nowIso_();

  return withLock_(function () {
    var existing = dbGet_('users', 'email', email);
    var reuseId = null;
    if (existing) {
      var canReapply = existing.status === STATUS.REJECTED &&
        Date.now() - toMs_(existing.status_changed_at) > APP.REAPPLY_AFTER_DAYS * 86400000;
      if (!canReapply) {
        if (existing.status === STATUS.REJECTED) {
          fail_('CONFLICT', 'Pendaftaran dengan email ini ditolak. Anda bisa mendaftar ulang ' +
            APP.REAPPLY_AFTER_DAYS + ' hari setelah penolakan.');
        }
        fail_('CONFLICT', 'Email sudah terdaftar.');
      }
      reuseId = existing.user_id;
    }
    var byUsername = dbGet_('users', 'username', username);
    if (byUsername && byUsername.user_id !== reuseId) fail_('CONFLICT', 'Username sudah dipakai.');
    var byNim = dbFindOne_('profiles', function (p) {
      return String(p.nim).toLowerCase() === nim.toLowerCase() && p.user_id !== reuseId;
    });
    if (byNim) fail_('CONFLICT', 'NIM sudah terdaftar. Hubungi admin jika ini NIM Anda.');

    var userFields = {
      email: email, username: username, password_hash: hash, role: ROLES.MEMBER,
      status: STATUS.PENDING, status_reason: '', status_changed_by: '', status_changed_at: now,
      failed_logins: 0, locked_until: '', created_at: now
    };
    var profileFields = {
      full_name: fullName, nim: nim, angkatan: angkatan, kelas: kelas, jabatan: 'Anggota',
      bio: '', phone: phone, privacy_json: JSON.stringify(DEFAULT_PRIVACY), notif_json: '{}',
      theme: 'light', updated_at: now
    };

    if (reuseId) {
      dbUpdate_('users', 'user_id', reuseId, userFields);
      dbUpdate_('profiles', 'user_id', reuseId, profileFields);
      uncacheUser_(reuseId);
    } else {
      var userId = newId_('usr');
      userFields.user_id = userId;
      profileFields.user_id = userId;
      dbInsert_('users', userFields);
      dbInsert_('profiles', profileFields);
    }
    return {
      status: STATUS.PENDING,
      message: 'Pendaftaran berhasil. Akun Anda menunggu persetujuan admin. ' +
        'Login kapan saja untuk melihat status pendaftaran.'
    };
  });
}

/* ---------- Login ---------- */

function findUserByIdentifier_(identifier) {
  var id = str_(identifier, 120).toLowerCase();
  if (!id) return null;
  return dbFindOne_('users', function (u) {
    return String(u.email).toLowerCase() === id || String(u.username).toLowerCase() === id;
  });
}

function authLogin_(data) {
  var password = data.password ? String(data.password) : '';
  if (!data.identifier || !password) fail_('VALIDATION', 'Isi email/username dan password.');
  var user = findUserByIdentifier_(data.identifier);
  var generic = 'Email/username atau password salah.';

  if (!user) {
    hashPassword_(password);            // samakan waktu respons agar email tidak bisa ditebak
    fail_('LOGIN', generic);
  }

  var lockedUntil = toMs_(user.locked_until);
  if (lockedUntil > Date.now()) {
    var mins = Math.ceil((lockedUntil - Date.now()) / 60000);
    fail_('LOCKED', 'Terlalu banyak percobaan gagal. Coba lagi dalam ' + mins + ' menit.');
  }

  if (!verifyPassword_(password, user.password_hash)) {
    var fails = (parseInt(user.failed_logins, 10) || 0) + 1;
    var patch = { failed_logins: fails };
    if (fails >= APP.LOGIN_MAX_FAILS) {
      patch.failed_logins = 0;
      patch.locked_until = isoPlus_(APP.LOGIN_LOCK_MINUTES * 60000);
    }
    dbUpdate_('users', 'user_id', user.user_id, patch);
    if (patch.locked_until) {
      fail_('LOCKED', 'Terlalu banyak percobaan gagal. Akun dikunci ' + APP.LOGIN_LOCK_MINUTES + ' menit.');
    }
    fail_('LOGIN', generic);
  }

  // Password benar: status akun baru diberitahukan di sini (bukan sebelum password dicek).
  var profile = dbGet_('profiles', 'user_id', user.user_id) || {};
  var name = profile.full_name || user.username;
  if (user.status === STATUS.PENDING) {
    return { status: STATUS.PENDING, name: name, created_at: user.created_at };
  }
  if (user.status === STATUS.REJECTED) {
    return {
      status: STATUS.REJECTED, name: name, reason: user.status_reason,
      reapply_at: isoPlus_(Math.max(0,
        toMs_(user.status_changed_at) + APP.REAPPLY_AFTER_DAYS * 86400000 - Date.now()))
    };
  }
  if (user.status === STATUS.SUSPENDED) {
    return { status: STATUS.SUSPENDED, name: name, reason: user.status_reason };
  }

  var update = { last_login_at: nowIso_() };
  if (user.failed_logins || user.locked_until) { update.failed_logins = 0; update.locked_until = ''; }
  dbUpdate_('users', 'user_id', user.user_id, update);
  uncacheUser_(user.user_id);

  // Satu akun hanya boleh aktif di satu perangkat, kecuali Admin & Super Admin
  // (mereka sering perlu login di beberapa perangkat untuk tugas moderasi/admin).
  var singleDevice = user.role !== ROLES.ADMIN && user.role !== ROLES.SUPER_ADMIN;
  if (singleDevice) revokeAllSessions_(user.user_id);

  var token = createSession_(user.user_id, !!data.remember, data.userAgent);
  markOnline_(user.user_id);
  var out = { status: STATUS.APPROVED, token: token, me: publicMe_(user, profile) };
  if (singleDevice) out.singleDeviceNotice = true;
  return out;
}

function authMe_(data, ctx) {
  return publicMe_(ctx.user, ctx.profile);
}

function authLogout_(data, ctx) {
  revokeSession_(ctx.session.th);
  return { ok: true };
}

function authLogoutAll_(data, ctx) {
  var n = revokeAllSessions_(ctx.user.user_id);
  return { revoked: n };
}

function authChangePassword_(data, ctx) {
  var user = dbGet_('users', 'user_id', ctx.user.user_id);
  if (!verifyPassword_(String(data.oldPassword || ''), user.password_hash)) {
    fail_('VALIDATION', 'Password lama salah.');
  }
  var pw = String(data.newPassword || '');
  validatePassword_(pw);
  if (pw !== data.newPassword2) fail_('VALIDATION', 'Konfirmasi password baru tidak sama.');
  if (pw === data.oldPassword) fail_('VALIDATION', 'Password baru harus berbeda dari password lama.');
  dbUpdate_('users', 'user_id', user.user_id, { password_hash: hashPassword_(pw) });
  uncacheUser_(user.user_id);
  var n = revokeAllSessions_(user.user_id, ctx.session.th);   // perangkat lain dikeluarkan
  return { message: 'Password berhasil diganti.', otherSessionsRevoked: n };
}

/* ---------- Lupa & reset password ---------- */

function authForgot_(data) {
  var email = str_(data.email, 120).toLowerCase();
  if (!isEmail_(email)) fail_('VALIDATION', 'Format email tidak valid.');
  var genericMsg = 'Jika email terdaftar dan akun aktif, tautan reset password telah dikirim. ' +
    'Periksa juga folder spam. Tautan berlaku ' + APP.RESET_TOKEN_MINUTES + ' menit.';

  if (!rateLimit_('forgot:' + email, APP.FORGOT_MAX_PER_HOUR, 3600)) {
    fail_('RATE_LIMIT', 'Terlalu banyak permintaan. Coba lagi dalam 1 jam.');
  }
  var user = dbGet_('users', 'email', email);
  if (!user || user.status !== STATUS.APPROVED) return { message: genericMsg };

  if (MailApp.getRemainingDailyQuota() < 3) {
    fail_('QUOTA', 'Kuota email harian sedang habis. Coba lagi besok atau hubungi admin.');
  }

  var token = randomToken_();
  dbInsert_('password_resets', {
    token_hash: sha256Hex_(token),
    user_id: user.user_id,
    created_at: nowIso_(),
    expires_at: isoPlus_(APP.RESET_TOKEN_MINUTES * 60000),
    used_at: ''
  });

  var url = ScriptApp.getService().getUrl() + '?page=reset&token=' + token;
  var profile = dbGet_('profiles', 'user_id', user.user_id) || {};
  var name = profile.full_name || user.username;
  MailApp.sendEmail({
    to: email,
    subject: '[' + APP.SHORT_NAME + '] Reset password',
    body: 'Halo ' + name + ',\n\n' +
      'Kami menerima permintaan reset password untuk akun Anda di ' + APP.NAME + '.\n' +
      'Buka tautan berikut dalam ' + APP.RESET_TOKEN_MINUTES + ' menit:\n\n' + url + '\n\n' +
      'Jika Anda tidak meminta reset, abaikan email ini. Password Anda tidak berubah.',
    name: APP.NAME
  });
  return { message: genericMsg };
}

function authReset_(data) {
  var token = str_(data.token, 128);
  if (!token) fail_('VALIDATION', 'Tautan reset tidak valid.');
  var pw = String(data.password || '');
  validatePassword_(pw);
  if (pw !== data.password2) fail_('VALIDATION', 'Konfirmasi password tidak sama.');

  var th = sha256Hex_(token);
  var row = dbGet_('password_resets', 'token_hash', th);
  if (!row || row.used_at || toMs_(row.expires_at) < Date.now()) {
    fail_('INVALID_TOKEN', 'Tautan reset sudah kedaluwarsa atau sudah dipakai. Minta tautan baru.');
  }
  var user = dbGet_('users', 'user_id', row.user_id);
  if (!user || user.status !== STATUS.APPROVED) fail_('INVALID_TOKEN', 'Akun tidak aktif.');

  dbUpdate_('users', 'user_id', user.user_id, {
    password_hash: hashPassword_(pw), failed_logins: 0, locked_until: ''
  });
  dbUpdate_('password_resets', 'token_hash', th, { used_at: nowIso_() });
  uncacheUser_(user.user_id);
  revokeAllSessions_(user.user_id);
  return { message: 'Password berhasil direset. Silakan login dengan password baru.' };
}
