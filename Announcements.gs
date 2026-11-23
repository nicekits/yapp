/**
 * Announcements.gs — pengumuman dari Admin.
 * audience: 'all' | 'staff' (Moderator ke atas) | 'angkatan:2025'
 * Pengumuman terjadwal dikirim notifikasinya oleh hourlyJobs() saat waktunya tiba.
 */

var PRIORITY_RANK = { mendesak: 3, penting: 2, normal: 1 };

/** Ubah '2026-11-22T13:30' (waktu lokal dari input datetime-local) menjadi ISO +07:00. */
function parseLocalTime_(v, label, required) {
  var s = str_(v, 40);
  if (!s) {
    if (required) fail_('VALIDATION', label + ' wajib diisi.');
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ':00+07:00';
  if (isNaN(new Date(s).getTime())) fail_('VALIDATION', 'Format ' + label.toLowerCase() + ' tidak valid.');
  return s;
}

function audienceMatch_(aud, user, profile) {
  if (isStaff_(user, ROLES.ADMIN)) return true;
  if (!aud || aud === 'all') return true;
  if (aud === 'staff') return isStaff_(user, ROLES.MODERATOR);
  if (aud.indexOf('angkatan:') === 0) return String((profile || {}).angkatan) === aud.split(':')[1];
  return false;
}

function audienceLabel_(aud) {
  if (!aud || aud === 'all') return 'Semua anggota';
  if (aud === 'staff') return 'Pengurus (Moderator ke atas)';
  if (aud.indexOf('angkatan:') === 0) return 'Angkatan ' + aud.split(':')[1];
  return aud;
}

function audienceUserIds_(aud) {
  return approvedMembers_().filter(function (m) {
    if (!aud || aud === 'all') return true;
    if (aud === 'staff') return isStaff_(m.user, ROLES.MODERATOR);
    if (aud.indexOf('angkatan:') === 0) return String(m.profile.angkatan) === aud.split(':')[1];
    return false;
  }).map(function (m) { return m.user.user_id; });
}

function annStatus_(a) {
  var now = Date.now();
  if (toMs_(a.publish_at) > now) return 'scheduled';
  if (a.expires_at && toMs_(a.expires_at) < now) return 'expired';
  return 'active';
}

function annDto_(a) {
  return {
    ann_id: a.ann_id, title: a.title, body: String(a.body), priority: a.priority || 'normal',
    priority_label: APP.ANNOUNCEMENT_PRIORITIES[a.priority] || 'Normal', is_pinned: bool_(a.is_pinned),
    audience: a.audience || 'all', audience_label: audienceLabel_(a.audience), publish_at: a.publish_at,
    expires_at: a.expires_at || '', author: authorCard_(a.author_id), status: annStatus_(a), created_at: a.created_at
  };
}

function sortAnnouncements_(list) {
  return list.sort(function (a, b) {
    if (bool_(a.is_pinned) !== bool_(b.is_pinned)) return bool_(a.is_pinned) ? -1 : 1;
    var p = (PRIORITY_RANK[b.priority] || 1) - (PRIORITY_RANK[a.priority] || 1);
    return p !== 0 ? p : toMs_(b.publish_at) - toMs_(a.publish_at);
  });
}

/** Pengumuman aktif yang boleh dilihat user. */
function visibleAnnouncements_(user, profile) {
  return sortAnnouncements_(dbWhere_('announcements', function (a) {
    return !a.deleted_at && annStatus_(a) === 'active' && audienceMatch_(a.audience || 'all', user, profile);
  }));
}

function announcementsList_(data, ctx) {
  var isAdmin = isStaff_(ctx.user, ROLES.ADMIN);
  var all = isAdmin && data.scope === 'all';
  var rows = all ? sortAnnouncements_(dbWhere_('announcements', function (a) { return !a.deleted_at; }))
    : visibleAnnouncements_(ctx.user, ctx.profile);
  var angkatan = {};
  if (isAdmin) approvedMembers_().forEach(function (m) { if (m.profile.angkatan) angkatan[String(m.profile.angkatan)] = true; });
  return {
    items: rows.map(annDto_), canManage: isAdmin,
    audiences: isAdmin ? [{ value: 'all', label: 'Semua anggota' }, { value: 'staff', label: 'Pengurus (Moderator ke atas)' }]
      .concat(Object.keys(angkatan).sort().reverse().map(function (y) { return { value: 'angkatan:' + y, label: 'Angkatan ' + y }; })) : []
  };
}

function announcementsSave_(data, ctx) {
  var title = str_(data.title, 150);
  var body = String(data.body === undefined || data.body === null ? '' : data.body).replace(/\r/g, '').trim();
  if (title.length < 3) fail_('VALIDATION', 'Judul pengumuman minimal 3 karakter.');
  if (!body) fail_('VALIDATION', 'Isi pengumuman wajib diisi.');
  if (body.length > 5000) fail_('VALIDATION', 'Isi pengumuman maksimal 5000 karakter.');
  var priority = APP.ANNOUNCEMENT_PRIORITIES[data.priority] ? data.priority : 'normal';
  var audience = str_(data.audience, 30) || 'all';
  if (!/^(all|staff|angkatan:\d{4})$/.test(audience)) fail_('VALIDATION', 'Target pengumuman tidak valid.');
  var publishAt = parseLocalTime_(data.publish_at, 'Waktu tayang', false) || nowIso_();
  var expiresAt = parseLocalTime_(data.expires_at, 'Waktu berakhir', false);
  if (expiresAt && toMs_(expiresAt) <= toMs_(publishAt)) fail_('VALIDATION', 'Waktu berakhir harus setelah waktu tayang.');

  var fields = { title: title, body: body, priority: priority, is_pinned: !!data.is_pinned, audience: audience,
    publish_at: publishAt, expires_at: expiresAt, updated_at: nowIso_() };
  var annId = str_(data.annId, 40);
  if (annId) {
    var old = dbGet_('announcements', 'ann_id', annId);
    if (!old || old.deleted_at) fail_('NOT_FOUND', 'Pengumuman tidak ditemukan.');
    dbUpdate_('announcements', 'ann_id', annId, fields);
    return { ann_id: annId, message: 'Pengumuman diperbarui.' };
  }
  annId = newId_('ann');
  var now = Date.now();
  fields.ann_id = annId; fields.author_id = ctx.user.user_id; fields.created_at = nowIso_(); fields.deleted_at = '';
  fields.notified = toMs_(publishAt) <= now;
  dbInsert_('announcements', fields);
  audit_(ctx.user.user_id, 'announcement.create', 'announcement', annId, { title: title });
  var sent = 0;
  if (fields.notified) sent = notifyAnnouncement_(fields);
  return {
    ann_id: annId,
    message: fields.notified ? 'Pengumuman dipublikasikan ke ' + sent + ' anggota.' : 'Pengumuman dijadwalkan.'
  };
}

function notifyAnnouncement_(a) {
  var ids = audienceUserIds_(a.audience).filter(function (id) { return String(id) !== String(a.author_id); });
  var prefix = a.priority === 'mendesak' ? '[Mendesak] ' : (a.priority === 'penting' ? '[Penting] ' : '');
  return notifyMany_(ids, 'announcement', prefix + 'Pengumuman: ' + a.title, 'announcements', a.ann_id);
}

function announcementsDelete_(data, ctx) {
  var a = dbGet_('announcements', 'ann_id', str_(data.annId, 40));
  if (!a || a.deleted_at) fail_('NOT_FOUND', 'Pengumuman tidak ditemukan.');
  dbUpdate_('announcements', 'ann_id', a.ann_id, { deleted_at: nowIso_() });
  audit_(ctx.user.user_id, 'announcement.delete', 'announcement', a.ann_id, { title: a.title });
  return { ok: true };
}

/** Dipanggil hourlyJobs(): kirim notifikasi pengumuman terjadwal yang sudah tayang. */
function publishScheduledAnnouncements_() {
  var due = dbWhere_('announcements', function (a) {
    return !a.deleted_at && !bool_(a.notified) && annStatus_(a) === 'active';
  });
  due.forEach(function (a) {
    dbUpdate_('announcements', 'ann_id', a.ann_id, { notified: true });
    notifyAnnouncement_(a);
  });
  return due.length;
}
