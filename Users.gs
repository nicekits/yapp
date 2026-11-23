/**
 * Users.gs — direktori anggota, profil, foto profil.
 */

/* ---------- Kehadiran (online) ---------- */

function markOnline_(userId) {
  var c = cache_();
  c.put('on:' + userId, '1', APP.ONLINE_TTL_SECONDS);
  if (!c.get('ls:' + userId)) {
    c.put('ls:' + userId, '1', APP.LAST_SEEN_WRITE_MINUTES * 60);
    try {
      dbUpdate_('users', 'user_id', userId, { last_seen_at: nowIso_() });
    } catch (e) {
      // Gagal mencatat last_seen tidak boleh menggagalkan permintaan utama.
    }
  }
}

/** Mengembalikan objek { user_id: true } untuk user yang sedang online. */
function onlineMap_(userIds) {
  if (!userIds.length) return {};
  var keys = userIds.map(function (id) { return 'on:' + id; });
  var found = cache_().getAll(keys);
  var map = {};
  userIds.forEach(function (id) { if (found['on:' + id]) map[id] = true; });
  return map;
}

/* ---------- Direktori ---------- */

/**
 * Semua anggota Approved digabung dengan profilnya.
 * Disimpan di cache 5 menit (dibuang setiap kali data pengguna berubah lewat uncacheUser_),
 * sehingga direktori, dashboard, dan daftar online tidak membaca 2 sheet di setiap permintaan.
 */
var APPROVED_MEMO_ = null;
function approvedMembers_() {
  if (APPROVED_MEMO_) return APPROVED_MEMO_;
  var cached = cacheGetJson_('snap:am');
  if (cached) { APPROVED_MEMO_ = cached; return cached; }
  var profiles = {};
  dbAll_('profiles').forEach(function (p) { profiles[p.user_id] = p; });
  var list = dbWhere_('users', function (u) { return u.status === STATUS.APPROVED; }).map(function (u) {
    var p = profiles[u.user_id] || {};
    return {
      user: { user_id: u.user_id, username: u.username, email: u.email, role: u.role, status: u.status,
        approved_at: u.approved_at, created_at: u.created_at, last_seen_at: u.last_seen_at },
      profile: { user_id: u.user_id, full_name: p.full_name, nim: p.nim, angkatan: p.angkatan, kelas: p.kelas, jabatan: p.jabatan,
        bio: p.bio, phone: p.phone, photo_file_id: p.photo_file_id, privacy_json: p.privacy_json }
    };
  });
  var json = JSON.stringify(list);
  if (json.length < 95000) cache_().put('snap:am', json, 300);   // komunitas sangat besar: lewati cache
  APPROVED_MEMO_ = list;
  return list;
}

/** Kartu anggota yang dilihat orang lain, sesuai pengaturan privasi. */
function memberCard_(user, profile, viewer, online) {
  var privacy = parseJson_(profile.privacy_json, DEFAULT_PRIVACY);
  var seeAll = viewer.user_id === user.user_id || isStaff_(viewer, ROLES.ADMIN);
  return {
    user_id: user.user_id,
    username: user.username,
    full_name: profile.full_name || user.username,
    role: user.role,
    role_label: ROLE_LABELS[user.role] || user.role,
    jabatan: profile.jabatan || '',
    angkatan: profile.angkatan ? String(profile.angkatan) : '',
    kelas: profile.kelas || '',
    nim: (seeAll || !privacy.hide_nim) ? (profile.nim || '') : '',
    photo_file_id: profile.photo_file_id || '',
    online: !!online,
    last_seen_at: user.last_seen_at || ''
  };
}

function membersList_(data, ctx) {
  var q = str_(data.q, 60).toLowerCase();
  var angkatan = str_(data.angkatan, 4);
  var kelas = str_(data.kelas, 30);
  var onlineOnly = !!data.onlineOnly;
  var page = Math.max(1, parseInt(data.page, 10) || 1);
  var size = APP.MEMBERS_PAGE_SIZE;

  var all = approvedMembers_();
  var online = onlineMap_(all.map(function (m) { return m.user.user_id; }));
  var angkatanSet = {}, kelasSet = {};
  var cards = all.map(function (m) {
    if (m.profile.angkatan) angkatanSet[String(m.profile.angkatan)] = true;
    if (m.profile.kelas) kelasSet[m.profile.kelas] = true;
    return memberCard_(m.user, m.profile, ctx.user, online[m.user.user_id]);
  });

  var filtered = cards.filter(function (c) {
    if (angkatan && c.angkatan !== angkatan) return false;
    if (kelas && c.kelas !== kelas) return false;
    if (onlineOnly && !c.online) return false;
    if (q) {
      var hay = (c.full_name + ' ' + c.username + ' ' + c.nim + ' ' + c.jabatan).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  filtered.sort(function (a, b) {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.full_name.localeCompare(b.full_name);
  });

  return {
    items: filtered.slice((page - 1) * size, page * size),
    total: filtered.length,
    page: page,
    pageSize: size,
    filters: {
      angkatan: Object.keys(angkatanSet).sort().reverse(),
      kelas: Object.keys(kelasSet).sort()
    }
  };
}

function membersGet_(data, ctx) {
  var userId = str_(data.userId, 40);
  var bundle = loadUser_(userId);
  var viewerIsAdmin = isStaff_(ctx.user, ROLES.ADMIN);
  if (!bundle || (bundle.user.status !== STATUS.APPROVED && !viewerIsAdmin)) {
    fail_('NOT_FOUND', 'Anggota tidak ditemukan.');
  }
  var u = bundle.user, p = bundle.profile;
  var card = memberCard_(u, p, ctx.user, onlineMap_([u.user_id])[u.user_id]);
  var privacy = parseJson_(p.privacy_json, DEFAULT_PRIVACY);
  var seeAll = ctx.user.user_id === u.user_id || viewerIsAdmin;
  card.bio = p.bio || '';
  card.phone = (seeAll || !privacy.hide_phone) ? (p.phone || '') : '';
  card.email = (seeAll || !privacy.hide_email) ? u.email : '';
  card.joined_at = u.approved_at || u.created_at;
  card.allow_dm = privacy.allow_dm !== false || isStaff_(ctx.user, ROLES.MODERATOR);
  card.status = viewerIsAdmin ? u.status : undefined;
  return card;
}

/* ---------- Profil sendiri ---------- */

function profileUpdate_(data, ctx) {
  var patch = { updated_at: nowIso_() };
  if (data.full_name !== undefined) {
    patch.full_name = requireField_(str_(data.full_name, 80), 'Nama lengkap');
  }
  if (data.kelas !== undefined) patch.kelas = requireField_(str_(data.kelas, 30), 'Kelas');
  if (data.bio !== undefined) patch.bio = str_(data.bio, 300);
  if (data.phone !== undefined) {
    var phone = str_(data.phone, 20);
    if (phone && !/^[0-9+\-\s]{8,20}$/.test(phone)) fail_('VALIDATION', 'Format nomor HP tidak valid.');
    patch.phone = phone;
  }
  if (data.privacy !== undefined) {
    patch.privacy_json = JSON.stringify({
      hide_nim: !!data.privacy.hide_nim,
      hide_phone: !!data.privacy.hide_phone,
      hide_email: !!data.privacy.hide_email,
      allow_dm: data.privacy.allow_dm !== false
    });
  }
  if (data.notif !== undefined) {
    patch.notif_json = JSON.stringify({ toast_messages: data.notif.toast_messages !== false });
  }
  if (data.theme !== undefined) {
    if (['light', 'dark', 'system'].indexOf(data.theme) < 0) fail_('VALIDATION', 'Tema tidak dikenal.');
    patch.theme = data.theme;
  }
  // NIM, angkatan, dan jabatan hanya bisa diubah admin (lihat admin.updateProfile).
  dbUpdate_('profiles', 'user_id', ctx.user.user_id, patch);
  uncacheUser_(ctx.user.user_id);
  var b = loadUser_(ctx.user.user_id);
  return publicMe_(b.user, b.profile);
}

/* ---------- Foto profil ---------- */

function avatarFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('AVATAR_FOLDER_ID');
  if (!id) fail_('SETUP', 'Folder avatar belum dibuat. Jalankan setup().');
  return DriveApp.getFolderById(id);
}

/** Memeriksa isi file benar-benar gambar sesuai tipenya (bukan hanya dari nama/tipe). */
function sniffImageMime_(bytes) {
  var b = function (i) { return bytes[i] < 0 ? bytes[i] + 256 : bytes[i]; };
  if (bytes.length > 3 && b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return 'image/jpeg';
  if (bytes.length > 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) return 'image/png';
  if (bytes.length > 12 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
    b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';
  return '';
}

/** Validasi & simpan gambar kecil (foto profil / foto grup) ke folder avatars. */
function storeImage_(dataUrl, prefix) {
  var m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl || ''));
  if (!m) fail_('VALIDATION', 'Format gambar tidak valid.');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > APP.AVATAR_MAX_BYTES) fail_('VALIDATION', 'Ukuran foto maksimal 300 KB.');
  var mime = sniffImageMime_(bytes);
  if (!mime || APP.AVATAR_MIMES.indexOf(mime) < 0) {
    fail_('VALIDATION', 'File harus berupa gambar JPG, PNG, atau WEBP.');
  }
  var ext = mime.split('/')[1].replace('jpeg', 'jpg');
  var blob = Utilities.newBlob(bytes, mime, prefix + '_' + Date.now() + '.' + ext);
  var fileId = avatarFolder_().createFile(blob).getId();
  var url = 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes);
  cache_().put('av:' + fileId, url, 21600);
  return { fileId: fileId, dataUrl: url };
}

function profileUploadPhoto_(data, ctx) {
  var userId = ctx.user.user_id;
  var saved = storeImage_(data.dataUrl, 'avatar_' + userId);
  var oldId = ctx.profile.photo_file_id;
  dbUpdate_('profiles', 'user_id', userId, { photo_file_id: saved.fileId, updated_at: nowIso_() });
  uncacheUser_(userId);
  if (oldId) trashAvatar_(oldId);
  return { photo_file_id: saved.fileId, dataUrl: saved.dataUrl };
}

function profileRemovePhoto_(data, ctx) {
  var oldId = ctx.profile.photo_file_id;
  dbUpdate_('profiles', 'user_id', ctx.user.user_id, { photo_file_id: '', updated_at: nowIso_() });
  uncacheUser_(ctx.user.user_id);
  if (oldId) trashAvatar_(oldId);
  return { ok: true };
}

function trashAvatar_(fileId) {
  cache_().remove('av:' + fileId);
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* sudah tidak ada */ }
}

/**
 * Mengembalikan { fileId: dataUrl } untuk foto profil.
 * Hanya file yang tercatat sebagai foto profil yang boleh diambil, sehingga endpoint ini
 * tidak bisa dipakai untuk membaca file Drive lain milik pemilik script.
 */
function filesAvatars_(data) {
  var ids = (data.fileIds || []).map(function (x) { return str_(x, 80); })
    .filter(function (x) { return x; }).slice(0, 60);
  if (!ids.length) return {};
  var known = {};
  dbAll_('profiles').forEach(function (p) { if (p.photo_file_id) known[p.photo_file_id] = true; });
  dbAll_('conversations').forEach(function (c) { if (c.photo_file_id) known[c.photo_file_id] = true; });
  ids = ids.filter(function (id) { return known[id]; });

  var cached = cache_().getAll(ids.map(function (id) { return 'av:' + id; }));
  var out = {};
  ids.forEach(function (id) {
    var hit = cached['av:' + id];
    if (hit) { out[id] = hit; return; }
    try {
      var blob = DriveApp.getFileById(id).getBlob();
      var url = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
      cache_().put('av:' + id, url, 21600);
      out[id] = url;
    } catch (e) {
      // File hilang: lewati, frontend menampilkan inisial.
    }
  });
  return out;
}
