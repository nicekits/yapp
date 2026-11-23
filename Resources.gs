/**
 * Resources.gs — materi pembelajaran: file (disimpan di Drive) atau tautan.
 * Materi dari Member menunggu persetujuan Moderator (APP.RESOURCE_NEEDS_APPROVAL).
 */

function resourceCategories_() {
  return dbWhere_('categories', function (c) { return c.scope === 'resource'; })
    .sort(function (a, b) { return Number(a.sort_order) - Number(b.sort_order); });
}

function staffIds_(minRole) {
  return dbWhere_('users', function (u) { return u.status === STATUS.APPROVED && rankOf_(u.role) >= rankOf_(minRole); })
    .map(function (u) { return u.user_id; });
}

function resourceDto_(r, cats, atts, user) {
  var a = atts[r.file_id];
  return {
    res_id: r.res_id, cat_id: r.cat_id, cat_name: cats[r.cat_id] || '', title: r.title, description: r.description || '',
    kind: r.kind, url: r.kind === 'link' ? r.url : '',
    file: a ? { id: a.file_id, name: a.name, mime: a.mime, size: Number(a.size_bytes) || 0 } : null,
    uploader: authorCard_(r.uploader_id), approved: bool_(r.approved), download_count: Number(r.download_count) || 0,
    created_at: r.created_at,
    can_delete: String(r.uploader_id) === String(user.user_id) || isStaff_(user, ROLES.MODERATOR)
  };
}

function resourcesList_(data, ctx) {
  var me = ctx.user.user_id, isMod = isStaff_(ctx.user, ROLES.MODERATOR);
  var cat = str_(data.cat, 40), q = str_(data.q, 80).toLowerCase(), kind = str_(data.kind, 10), status = str_(data.status, 10);
  var page = Math.max(1, parseInt(data.page, 10) || 1), size = APP.RESOURCES_PAGE;
  var cats = {};
  resourceCategories_().forEach(function (c) { cats[c.cat_id] = c.name; });
  var all = dbWhere_('resources', function (r) { return !r.deleted_at; });
  var pendingCount = all.filter(function (r) { return !bool_(r.approved) && (isMod || String(r.uploader_id) === String(me)); }).length;

  var rows = all.filter(function (r) {
    if (status === 'pending') {
      if (bool_(r.approved)) return false;
      if (!isMod && String(r.uploader_id) !== String(me)) return false;
    } else if (status === 'mine') {
      if (String(r.uploader_id) !== String(me)) return false;
    } else if (!bool_(r.approved)) return false;
    if (cat && r.cat_id !== cat) return false;
    if (kind && r.kind !== kind) return false;
    if (q && (String(r.title) + ' ' + String(r.description)).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return toMs_(b.created_at) - toMs_(a.created_at); });

  var need = {};
  rows.forEach(function (r) { if (r.file_id) need[r.file_id] = true; });
  var atts = {};
  dbWhere_('attachments', function (a) { return need[a.file_id]; }).forEach(function (a) { atts[a.file_id] = a; });

  var counts = {};
  all.filter(function (r) { return bool_(r.approved); }).forEach(function (r) { counts[r.cat_id] = (counts[r.cat_id] || 0) + 1; });
  return {
    items: rows.slice((page - 1) * size, page * size).map(function (r) { return resourceDto_(r, cats, atts, ctx.user); }),
    total: rows.length, page: page, pageSize: size, pendingCount: pendingCount, canReview: isMod,
    categories: resourceCategories_().map(function (c) { return { cat_id: c.cat_id, name: c.name, count: counts[c.cat_id] || 0 }; })
  };
}

function resourcesCreate_(data, ctx) {
  var me = ctx.user.user_id;
  var title = str_(data.title, 150), description = str_(data.description, 1000), kind = data.kind;
  if (title.length < 3) fail_('VALIDATION', 'Judul materi minimal 3 karakter.');
  var cat = dbGet_('categories', 'cat_id', str_(data.cat_id, 40));
  if (!cat || cat.scope !== 'resource') fail_('VALIDATION', 'Pilih kategori.');
  if (kind !== 'file' && kind !== 'link') fail_('VALIDATION', 'Pilih jenis materi: file atau tautan.');
  var url = '';
  if (kind === 'link') {
    url = str_(data.url, 500);
    if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url)) fail_('VALIDATION', 'Tautan harus diawali http:// atau https://');
  } else if (!data.attachmentId) fail_('VALIDATION', 'Unggah file materi terlebih dahulu.');

  var approved = !getSetting_('resource_needs_approval') || isStaff_(ctx.user, ROLES.MODERATOR);
  var id = newId_('res');
  withLock_(function () {
    var fileId = '';
    if (kind === 'file') fileId = claimAttachments_([data.attachmentId], me, 'resource', id)[0].id;
    dbInsert_('resources', {
      res_id: id, cat_id: cat.cat_id, title: title, description: description, kind: kind, file_id: fileId, url: url,
      uploader_id: me, approved: approved, download_count: 0, created_at: nowIso_(), deleted_at: '',
      reviewed_by: approved ? me : ''
    });
  });
  if (!approved) {
    notifyMany_(staffIds_(ROLES.MODERATOR), 'resource_pending', 'Materi baru menunggu persetujuan: ' + title, 'resources/pending', id);
  }
  return {
    res_id: id, approved: approved,
    message: approved ? 'Materi dipublikasikan.' : 'Materi terkirim dan menunggu persetujuan Moderator.'
  };
}

function requireResource_(resId, user) {
  var r = dbGet_('resources', 'res_id', resId);
  if (!r || r.deleted_at) fail_('NOT_FOUND', 'Materi tidak ditemukan.');
  if (!bool_(r.approved) && String(r.uploader_id) !== String(user.user_id) && !isStaff_(user, ROLES.MODERATOR)) {
    fail_('NOT_FOUND', 'Materi tidak ditemukan.');
  }
  return r;
}

/** Mencatat unduhan/kunjungan, lalu mengembalikan tautan atau info file. */
function resourcesOpen_(data, ctx) {
  var r = requireResource_(str_(data.resId, 40), ctx.user);
  dbUpdate_('resources', 'res_id', r.res_id, { download_count: (Number(r.download_count) || 0) + 1 });
  if (r.kind === 'link') return { kind: 'link', url: r.url };
  var a = dbGet_('attachments', 'file_id', r.file_id);
  if (!a) fail_('NOT_FOUND', 'File materi sudah tidak tersedia.');
  return { kind: 'file', file: { id: a.file_id, name: a.name, mime: a.mime } };
}

function resourcesDelete_(data, ctx) {
  var r = requireResource_(str_(data.resId, 40), ctx.user);
  var mine = String(r.uploader_id) === String(ctx.user.user_id);
  if (!mine && !isStaff_(ctx.user, ROLES.MODERATOR)) fail_('FORBIDDEN', 'Anda hanya bisa menghapus materi milik sendiri.');
  removeResource_(r);
  if (!mine) audit_(ctx.user.user_id, 'resource.delete', 'resource', r.res_id, { title: r.title });
  return { ok: true };
}

function removeResource_(r) {
  withLock_(function () {
    dbUpdate_('resources', 'res_id', r.res_id, { deleted_at: nowIso_() });
    if (r.file_id) trashAttachments_([{ id: r.file_id }]);
  });
}

function resourcesReview_(data, ctx) {
  var r = dbGet_('resources', 'res_id', str_(data.resId, 40));
  if (!r || r.deleted_at) fail_('NOT_FOUND', 'Materi tidak ditemukan.');
  if (bool_(r.approved)) fail_('CONFLICT', 'Materi ini sudah disetujui.');
  var approve = !!data.approve, reason = str_(data.reason, 300);
  if (!approve && !reason) fail_('VALIDATION', 'Tuliskan alasan penolakan.');
  withLock_(function () {
    if (approve) dbUpdate_('resources', 'res_id', r.res_id, { approved: true, reviewed_by: ctx.user.user_id });
    else {
      dbUpdate_('resources', 'res_id', r.res_id, { deleted_at: nowIso_(), reviewed_by: ctx.user.user_id });
      if (r.file_id) trashAttachments_([{ id: r.file_id }]);
    }
  });
  audit_(ctx.user.user_id, approve ? 'resource.approve' : 'resource.reject', 'resource', r.res_id,
    { title: r.title, reason: reason || undefined });
  notify_(r.uploader_id, 'resource_review', approve ? 'Materi "' + excerpt_(r.title, 60) + '" disetujui dan sudah tampil.'
    : 'Materi "' + excerpt_(r.title, 60) + '" ditolak. Alasan: ' + reason, approve ? 'resources' : 'resources', r.res_id);
  return { ok: true };
}
