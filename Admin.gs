/**
 * Admin.gs — persetujuan pendaftaran, manajemen pengguna, log audit, backup manual.
 */

function adminRow_(user, profile, actor, online) {
  profile = profile || {};
  return {
    user_id: user.user_id,
    email: user.email,
    username: user.username,
    full_name: profile.full_name || user.username,
    nim: profile.nim || '',
    angkatan: profile.angkatan ? String(profile.angkatan) : '',
    kelas: profile.kelas || '',
    jabatan: profile.jabatan || '',
    phone: profile.phone || '',
    photo_file_id: profile.photo_file_id || '',
    role: user.role,
    role_label: ROLE_LABELS[user.role] || user.role,
    status: user.status,
    status_reason: user.status_reason || '',
    created_at: user.created_at,
    last_seen_at: user.last_seen_at || '',
    online: !!online,
    can_manage: actor.user_id !== user.user_id && outranks_(actor, user)
  };
}

function profilesMap_() {
  var map = {};
  dbAll_('profiles').forEach(function (p) { map[p.user_id] = p; });
  return map;
}

/* ---------- Pendaftaran ---------- */

function adminPending_(data, ctx) {
  var profiles = profilesMap_();
  var items = dbWhere_('users', function (u) { return u.status === STATUS.PENDING; })
    .map(function (u) { return adminRow_(u, profiles[u.user_id], ctx.user, false); });
  items.sort(function (a, b) { return toMs_(a.created_at) - toMs_(b.created_at); });
  return { items: items, total: items.length };
}

function adminDecide_(data, ctx) {
  var userId = str_(data.userId, 40);
  var decision = data.decision;
  var reason = str_(data.reason, 300);
  if (decision !== 'approve' && decision !== 'reject') fail_('VALIDATION', 'Keputusan tidak dikenal.');
  if (decision === 'reject' && !reason) fail_('VALIDATION', 'Tuliskan alasan penolakan.');

  return withLock_(function () {
    var user = dbGet_('users', 'user_id', userId);
    if (!user) fail_('NOT_FOUND', 'Pengguna tidak ditemukan.');
    if (user.status !== STATUS.PENDING) fail_('CONFLICT', 'Pendaftaran ini sudah diproses.');
    var now = nowIso_();
    var patch = {
      status: decision === 'approve' ? STATUS.APPROVED : STATUS.REJECTED,
      status_reason: decision === 'approve' ? '' : reason,
      status_changed_by: ctx.user.user_id,
      status_changed_at: now
    };
    if (decision === 'approve') patch.approved_at = now;
    dbUpdate_('users', 'user_id', userId, patch);
    uncacheUser_(userId);
    audit_(ctx.user.user_id, decision === 'approve' ? 'user.approve' : 'user.reject', 'user', userId,
      reason ? { reason: reason } : null);
    if (decision === 'approve') {
      notify_(userId, 'welcome', 'Selamat datang di ' + APP.NAME + '! Lengkapi profil Anda dan mulai berdiskusi.', 'profile', '');
    }
    return { user_id: userId, status: patch.status };
  });
}

/* ---------- Manajemen pengguna ---------- */

function adminUsers_(data, ctx) {
  var q = str_(data.q, 60).toLowerCase();
  var status = str_(data.status, 20);
  var role = str_(data.role, 20);
  var page = Math.max(1, parseInt(data.page, 10) || 1);
  var size = 30;
  var profiles = profilesMap_();
  var users = dbAll_('users');
  var online = onlineMap_(users.map(function (u) { return u.user_id; }));

  var rows = users.map(function (u) { return adminRow_(u, profiles[u.user_id], ctx.user, online[u.user_id]); })
    .filter(function (r) {
      if (status && r.status !== status) return false;
      if (role && r.role !== role) return false;
      if (q) {
        var hay = (r.full_name + ' ' + r.username + ' ' + r.email + ' ' + r.nim).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  rows.sort(function (a, b) {
    var d = rankOf_(b.role) - rankOf_(a.role);
    return d !== 0 ? d : a.full_name.localeCompare(b.full_name);
  });

  var counts = { pending: 0, approved: 0, rejected: 0, suspended: 0 };
  users.forEach(function (u) { if (counts[u.status] !== undefined) counts[u.status]++; });

  return {
    items: rows.slice((page - 1) * size, page * size),
    total: rows.length, page: page, pageSize: size, counts: counts,
    assignableRoles: assignableRoles_(ctx.user)
  };
}

/** Role yang boleh diberikan oleh actor: hanya role di bawah role actor. */
function assignableRoles_(actor) {
  return Object.keys(ROLE_RANK).filter(function (r) { return rankOf_(r) < rankOf_(actor.role); })
    .sort(function (a, b) { return rankOf_(b) - rankOf_(a); })
    .map(function (r) { return { value: r, label: ROLE_LABELS[r] }; });
}

function targetFor_(userId, actor) {
  var user = dbGet_('users', 'user_id', userId);
  if (!user) fail_('NOT_FOUND', 'Pengguna tidak ditemukan.');
  if (user.user_id === actor.user_id) fail_('FORBIDDEN', 'Anda tidak bisa mengubah akun sendiri di sini.');
  if (!outranks_(actor, user)) {
    fail_('FORBIDDEN', 'Anda hanya bisa mengelola pengguna dengan role di bawah Anda.');
  }
  return user;
}

function adminSetStatus_(data, ctx) {
  var userId = str_(data.userId, 40);
  var status = data.status;
  var reason = str_(data.reason, 300);
  if (status !== STATUS.SUSPENDED && status !== STATUS.APPROVED) {
    fail_('VALIDATION', 'Status hanya bisa diubah ke Suspended atau Approved.');
  }
  if (status === STATUS.SUSPENDED && !reason) fail_('VALIDATION', 'Tuliskan alasan penonaktifan.');

  return withLock_(function () {
    var user = targetFor_(userId, ctx.user);
    var from = user.status;
    var ok = (status === STATUS.SUSPENDED && from === STATUS.APPROVED) ||
      (status === STATUS.APPROVED && from === STATUS.SUSPENDED);
    if (!ok) fail_('CONFLICT', 'Perubahan status dari ' + from + ' ke ' + status + ' tidak diizinkan.');
    dbUpdate_('users', 'user_id', userId, {
      status: status,
      status_reason: status === STATUS.SUSPENDED ? reason : '',
      status_changed_by: ctx.user.user_id,
      status_changed_at: nowIso_()
    });
    uncacheUser_(userId);
    if (status === STATUS.SUSPENDED) {
      revokeAllSessions_(userId);
      cache_().remove('on:' + userId);
    }
    audit_(ctx.user.user_id, status === STATUS.SUSPENDED ? 'user.suspend' : 'user.reactivate',
      'user', userId, reason ? { reason: reason } : null);
    return { user_id: userId, status: status };
  });
}

function adminSetRole_(data, ctx) {
  var userId = str_(data.userId, 40);
  var role = data.role;
  if (!ROLE_RANK[role]) fail_('VALIDATION', 'Role tidak dikenal.');
  if (rankOf_(role) >= rankOf_(ctx.user.role)) {
    fail_('FORBIDDEN', 'Anda hanya bisa memberikan role di bawah role Anda sendiri.');
  }
  return withLock_(function () {
    var user = targetFor_(userId, ctx.user);
    if (user.role === role) return { user_id: userId, role: role };
    dbUpdate_('users', 'user_id', userId, { role: role });
    uncacheUser_(userId);
    audit_(ctx.user.user_id, 'user.role', 'user', userId, { from: user.role, to: role });
    notify_(userId, 'role', 'Role Anda sekarang ' + ROLE_LABELS[role], 'profile', '');
    return { user_id: userId, role: role };
  });
}

function adminUpdateProfile_(data, ctx) {
  var userId = str_(data.userId, 40);
  var user = dbGet_('users', 'user_id', userId);
  if (!user) fail_('NOT_FOUND', 'Pengguna tidak ditemukan.');
  if (user.user_id !== ctx.user.user_id && !outranks_(ctx.user, user)) {
    fail_('FORBIDDEN', 'Anda hanya bisa mengubah profil pengguna dengan role di bawah Anda.');
  }
  var patch = { updated_at: nowIso_() };
  if (data.full_name !== undefined) patch.full_name = requireField_(str_(data.full_name, 80), 'Nama lengkap');
  if (data.kelas !== undefined) patch.kelas = str_(data.kelas, 30);
  if (data.jabatan !== undefined) patch.jabatan = str_(data.jabatan, 60);
  if (data.angkatan !== undefined && data.angkatan !== '') patch.angkatan = validateAngkatan_(data.angkatan);

  return withLock_(function () {
    if (data.nim !== undefined) {
      var nim = str_(data.nim, 30);
      if (nim) {
        var dup = dbFindOne_('profiles', function (p) {
          return String(p.nim).toLowerCase() === nim.toLowerCase() && p.user_id !== userId;
        });
        if (dup) fail_('CONFLICT', 'NIM sudah dipakai anggota lain.');
      }
      patch.nim = nim;
    }
    dbUpdate_('profiles', 'user_id', userId, patch);
    uncacheUser_(userId);
    var changed = Object.keys(patch).filter(function (k) { return k !== 'updated_at'; });
    audit_(ctx.user.user_id, 'profile.edit', 'user', userId, { fields: changed });
    return { user_id: userId };
  });
}

/* ---------- Log & backup ---------- */

var AUDIT_LABELS = {
  'user.approve': 'menyetujui pendaftaran',
  'user.reject': 'menolak pendaftaran',
  'user.suspend': 'menonaktifkan akun',
  'user.reactivate': 'mengaktifkan kembali akun',
  'user.role': 'mengubah role',
  'profile.edit': 'mengubah profil',
  'backup.manual': 'menjalankan backup manual',
  'group.create': 'membuat grup',
  'forum.delete': 'menghapus topik forum',
  'forum.deleteComment': 'menghapus balasan forum',
  'forum.edit': 'mengubah topik forum',
  'forum.moderate': 'memoderasi topik forum',
  'resource.approve': 'menyetujui materi',
  'resource.reject': 'menolak materi',
  'resource.delete': 'menghapus materi',
  'announcement.create': 'membuat pengumuman',
  'announcement.delete': 'menghapus pengumuman',
  'event.create': 'membuat agenda',
  'event.delete': 'menghapus agenda',
  'settings.update': 'mengubah pengaturan aplikasi',
  'moderation.remove': 'menghapus konten yang dilaporkan',
  'moderation.warn': 'memberi peringatan atas laporan',
  'moderation.dismiss': 'menolak laporan (tidak melanggar)'
};

function adminLogs_(data, ctx) {
  var page = Math.max(1, parseInt(data.page, 10) || 1);
  var size = 50;
  var profiles = profilesMap_();
  var name = function (id) { return (profiles[id] && profiles[id].full_name) || id || '-'; };
  var logs = dbAll_('audit_logs').reverse();
  logs.sort(function (a, b) { return toMs_(b.created_at) - toMs_(a.created_at); });
  return {
    items: logs.slice((page - 1) * size, page * size).map(function (l) {
      return {
        created_at: l.created_at,
        actor: name(l.actor_id),
        action: l.action,
        action_label: AUDIT_LABELS[l.action] || l.action,
        target: l.target_type === 'user' ? name(l.target_id)
          : (l.target_type === 'conversation' ? ((dbGet_('conversations', 'conv_id', l.target_id) || {}).name || l.target_id)
            : ((parseJson_(l.detail_json, {}) || {}).title || l.target_id)),
        detail: parseJson_(l.detail_json, null)
      };
    }),
    total: logs.length, page: page, pageSize: size
  };
}

function adminBackupNow_(data, ctx) {
  var names = backupDatabases();
  audit_(ctx.user.user_id, 'backup.manual', 'system', '', { files: names });
  return { message: 'Backup selesai: ' + names.join(', ') };
}
