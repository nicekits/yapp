/**
 * Forum.gs — forum diskusi.
 * Struktur: topik (discussions) → balasan (comments, parent_id kosong) → komentar pada balasan
 * (comments, parent_id = id balasan). Kedalaman dibatasi satu tingkat agar mudah dibaca di HP.
 */

function authorCard_(userId) {
  var b = loadUser_(userId);
  if (!b) return { user_id: userId, full_name: 'Pengguna', photo_file_id: '', role: 'member', role_label: '', jabatan: '' };
  return {
    user_id: userId, full_name: b.profile.full_name || b.user.username, photo_file_id: b.profile.photo_file_id || '',
    role: b.user.role, role_label: ROLE_LABELS[b.user.role] || '', jabatan: b.profile.jabatan || ''
  };
}

function forumCategories_() {
  return dbWhere_('categories', function (c) { return c.scope === 'forum'; })
    .sort(function (a, b) { return Number(a.sort_order) - Number(b.sort_order); });
}

function requireTopic_(discId) {
  var d = dbGet_('discussions', 'disc_id', discId);
  if (!d || d.deleted_at) fail_('NOT_FOUND', 'Topik tidak ditemukan atau sudah dihapus.');
  return d;
}

function canEditPost_(post, user) {
  return String(post.author_id) === String(user.user_id) || isStaff_(user, ROLES.MODERATOR);
}

function excerpt_(s, n) {
  var t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/* ---------- Kategori & daftar ---------- */

function forumCategoriesList_() {
  var counts = {};
  dbWhere_('discussions', function (d) { return !d.deleted_at; })
    .forEach(function (d) { counts[d.cat_id] = (counts[d.cat_id] || 0) + 1; });
  return forumCategories_().map(function (c) { return { cat_id: c.cat_id, name: c.name, count: counts[c.cat_id] || 0 }; });
}

function forumList_(data, ctx) {
  var me = ctx.user.user_id;
  var cat = str_(data.cat, 40), q = str_(data.q, 80).toLowerCase(), filter = str_(data.filter, 20);
  var page = Math.max(1, parseInt(data.page, 10) || 1), size = APP.FORUM_PAGE;
  var cats = {};
  forumCategories_().forEach(function (c) { cats[c.cat_id] = c.name; });

  var rows = dbWhere_('discussions', function (d) {
    if (d.deleted_at) return false;
    if (cat && d.cat_id !== cat) return false;
    if (filter === 'important' && !bool_(d.is_important)) return false;
    if (filter === 'mine' && String(d.author_id) !== String(me)) return false;
    if (q && (String(d.title) + ' ' + String(d.body)).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  rows.sort(function (a, b) {
    if (!q && bool_(a.is_pinned) !== bool_(b.is_pinned)) return bool_(a.is_pinned) ? -1 : 1;
    return toMs_(b.last_activity_at || b.created_at) - toMs_(a.last_activity_at || a.created_at);
  });
  return {
    items: rows.slice((page - 1) * size, page * size).map(function (d) {
      return {
        disc_id: d.disc_id, cat_id: d.cat_id, cat_name: cats[d.cat_id] || '', title: d.title, excerpt: excerpt_(d.body, 180),
        author: authorCard_(d.author_id), is_pinned: bool_(d.is_pinned), is_locked: bool_(d.is_locked),
        is_important: bool_(d.is_important), reply_count: Number(d.reply_count) || 0,
        reaction_count: Number(d.reaction_count) || 0, has_attachments: parseJson_(d.attachment_ids, []).length > 0,
        last_activity_at: d.last_activity_at || d.created_at, created_at: d.created_at,
        last_reply_by: d.last_reply_by ? authorCard_(d.last_reply_by).full_name : ''
      };
    }),
    total: rows.length, page: page, pageSize: size, categories: forumCategoriesList_()
  };
}

/* ---------- Detail topik ---------- */

function reactionSummary_(targetType, ids, me) {
  var out = {};
  ids.forEach(function (id) { out[id] = { counts: {}, mine: '' }; });
  dbWhere_('reactions', function (r) { return r.target_type === targetType && out[r.target_id] && r.type; })
    .forEach(function (r) {
      var s = out[r.target_id];
      s.counts[r.type] = (s.counts[r.type] || 0) + 1;
      if (String(r.user_id) === String(me)) s.mine = r.type;
    });
  return out;
}

function commentDto_(c, user, reactions) {
  var deleted = !!c.deleted_at;
  return {
    comment_id: c.comment_id, parent_id: c.parent_id || '', author: authorCard_(c.author_id),
    body: deleted ? '' : String(c.body), attachments: deleted ? [] : parseJson_(c.attachment_ids, []),
    created_at: c.created_at, deleted: deleted, can_delete: !deleted && canEditPost_(c, user),
    reactions: reactions[c.comment_id] || { counts: {}, mine: '' }, children: []
  };
}

function forumGet_(data, ctx) {
  var me = ctx.user.user_id;
  var d = requireTopic_(str_(data.discId, 40));
  var comments = dbWhere_('comments', function (c) { return c.disc_id === d.disc_id; })
    .sort(function (a, b) { return toMs_(a.created_at) - toMs_(b.created_at); });
  var ids = comments.map(function (c) { return c.comment_id; });
  var cReact = reactionSummary_('comment', ids, me);
  var dReact = reactionSummary_('discussion', [d.disc_id], me)[d.disc_id];

  var byId = {}, roots = [];
  comments.forEach(function (c) { byId[c.comment_id] = commentDto_(c, ctx.user, cReact); });
  comments.forEach(function (c) {
    var dto = byId[c.comment_id];
    if (c.parent_id && byId[c.parent_id]) byId[c.parent_id].children.push(dto); else roots.push(dto);
  });
  // Balasan yang dihapus hanya ditampilkan bila masih punya komentar di bawahnya.
  roots = roots.filter(function (r) { return !r.deleted || r.children.some(function (x) { return !x.deleted; }); });
  roots.forEach(function (r) { r.children = r.children.filter(function (x) { return !x.deleted; }); });

  var cat = dbGet_('categories', 'cat_id', d.cat_id) || {};
  return {
    topic: {
      disc_id: d.disc_id, cat_id: d.cat_id, cat_name: cat.name || '', title: d.title, body: String(d.body),
      attachments: parseJson_(d.attachment_ids, []), author: authorCard_(d.author_id),
      is_pinned: bool_(d.is_pinned), is_locked: bool_(d.is_locked), is_important: bool_(d.is_important),
      reply_count: Number(d.reply_count) || 0, created_at: d.created_at, updated_at: d.updated_at || '',
      can_edit: canEditPost_(d, ctx.user), reactions: dReact
    },
    replies: roots,
    can_moderate: isStaff_(ctx.user, ROLES.MODERATOR),
    can_reply: !bool_(d.is_locked) || isStaff_(ctx.user, ROLES.MODERATOR),
    reaction_types: APP.REACTIONS
  };
}

/* ---------- Buat, ubah, hapus topik ---------- */

function validateTopic_(data) {
  var title = str_(data.title, APP.TOPIC_TITLE_MAX);
  var body = String(data.body === undefined || data.body === null ? '' : data.body).replace(/\r/g, '').trim();
  if (title.length < 5) fail_('VALIDATION', 'Judul topik minimal 5 karakter.');
  if (!body) fail_('VALIDATION', 'Isi topik wajib diisi.');
  if (body.length > APP.TOPIC_BODY_MAX) fail_('VALIDATION', 'Isi topik maksimal ' + APP.TOPIC_BODY_MAX + ' karakter.');
  var cat = dbGet_('categories', 'cat_id', str_(data.cat_id, 40));
  if (!cat || cat.scope !== 'forum') fail_('VALIDATION', 'Pilih kategori.');
  return { title: title, body: body, cat_id: cat.cat_id };
}

function forumCreate_(data, ctx) {
  var me = ctx.user.user_id;
  var v = validateTopic_(data);
  if (!rateLimit_('topic:' + me, APP.TOPICS_PER_10_MIN, 600)) {
    fail_('RATE_LIMIT', 'Terlalu banyak topik baru. Coba lagi dalam beberapa menit.');
  }
  return withLock_(function () {
    var id = newId_('dsc'), now = nowIso_();
    var atts = claimAttachments_(data.attachmentIds, me, 'discussion', id);
    dbInsert_('discussions', {
      disc_id: id, cat_id: v.cat_id, author_id: me, title: v.title, body: v.body,
      attachment_ids: atts.length ? JSON.stringify(atts) : '', is_pinned: false, is_locked: false, is_important: false,
      reply_count: 0, reaction_count: 0, last_activity_at: now, created_at: now, updated_at: '', deleted_at: '', last_reply_by: ''
    });
    return { disc_id: id };
  });
}

function forumUpdate_(data, ctx) {
  var d = requireTopic_(str_(data.discId, 40));
  if (!canEditPost_(d, ctx.user)) fail_('FORBIDDEN', 'Anda hanya bisa mengubah topik milik sendiri.');
  var v = validateTopic_(data);
  dbUpdate_('discussions', 'disc_id', d.disc_id, { title: v.title, body: v.body, cat_id: v.cat_id, updated_at: nowIso_() });
  if (String(d.author_id) !== String(ctx.user.user_id)) {
    audit_(ctx.user.user_id, 'forum.edit', 'discussion', d.disc_id, { title: v.title });
  }
  return { ok: true };
}

function forumDelete_(data, ctx) {
  var d = requireTopic_(str_(data.discId, 40));
  if (!canEditPost_(d, ctx.user)) fail_('FORBIDDEN', 'Anda hanya bisa menghapus topik milik sendiri.');
  var reason = str_(data.reason, 300);
  var byMod = String(d.author_id) !== String(ctx.user.user_id);
  if (byMod && !reason) fail_('VALIDATION', 'Tuliskan alasan penghapusan.');
  removeTopic_(d);
  if (byMod) {
    audit_(ctx.user.user_id, 'forum.delete', 'discussion', d.disc_id, { title: d.title, reason: reason });
    notify_(d.author_id, 'moderation', 'Topik "' + excerpt_(d.title, 60) + '" dihapus moderator. Alasan: ' + reason, 'forum', d.disc_id);
  }
  return { ok: true };
}

function forumModerate_(data, ctx) {
  var d = requireTopic_(str_(data.discId, 40));
  var patch = {}, changes = [];
  ['pin', 'lock', 'important'].forEach(function (k) {
    if (data[k] === undefined) return;
    var col = { pin: 'is_pinned', lock: 'is_locked', important: 'is_important' }[k];
    patch[col] = !!data[k];
    changes.push(k + '=' + (!!data[k]));
  });
  if (!changes.length) return { ok: true };
  dbUpdate_('discussions', 'disc_id', d.disc_id, patch);
  audit_(ctx.user.user_id, 'forum.moderate', 'discussion', d.disc_id, { title: d.title, changes: changes.join(', ') });
  return { ok: true };
}

/* ---------- Balasan & komentar ---------- */

function forumReply_(data, ctx) {
  var me = ctx.user.user_id;
  var body = String(data.body === undefined || data.body === null ? '' : data.body).replace(/\r/g, '').trim();
  if (body.length > APP.COMMENT_MAX) fail_('VALIDATION', 'Balasan maksimal ' + APP.COMMENT_MAX + ' karakter.');
  if (!body && !(data.attachmentIds || []).length) fail_('VALIDATION', 'Balasan kosong.');
  if (!rateLimit_('reply:' + me, APP.REPLIES_PER_MINUTE, 60)) {
    fail_('RATE_LIMIT', 'Terlalu banyak balasan dalam satu menit. Tunggu sebentar.');
  }
  var result = withLock_(function () {
    var d = requireTopic_(str_(data.discId, 40));
    if (bool_(d.is_locked) && !isStaff_(ctx.user, ROLES.MODERATOR)) fail_('FORBIDDEN', 'Topik ini dikunci moderator.');
    var parent = null;
    var parentId = str_(data.parentId, 40);
    if (parentId) {
      parent = dbGet_('comments', 'comment_id', parentId);
      if (!parent || parent.disc_id !== d.disc_id) fail_('VALIDATION', 'Balasan yang dikomentari tidak ditemukan.');
      if (parent.parent_id) parent = dbGet_('comments', 'comment_id', parent.parent_id) || parent;  // ratakan ke 1 tingkat
    }
    var id = newId_('cmt'), now = nowIso_();
    var atts = claimAttachments_(data.attachmentIds, me, 'comment', id);
    var row = {
      comment_id: id, disc_id: d.disc_id, parent_id: parent ? parent.comment_id : '', author_id: me, body: body,
      attachment_ids: atts.length ? JSON.stringify(atts) : '', created_at: now, updated_at: '', deleted_at: ''
    };
    dbInsert_('comments', row);
    dbUpdate_('discussions', 'disc_id', d.disc_id, {
      reply_count: (Number(d.reply_count) || 0) + 1, last_activity_at: now, last_reply_by: me
    });
    return { row: row, topic: d, parent: parent };
  });

  var who = firstName_(me), t = result.topic;
  if (String(t.author_id) !== String(me)) {
    notify_(t.author_id, 'forum_reply', who + ' membalas topik Anda: ' + excerpt_(t.title, 70), 'forum/' + t.disc_id, t.disc_id);
  }
  var p = result.parent;
  if (p && String(p.author_id) !== String(me) && String(p.author_id) !== String(t.author_id)) {
    notify_(p.author_id, 'forum_reply', who + ' mengomentari balasan Anda di: ' + excerpt_(t.title, 60), 'forum/' + t.disc_id, t.disc_id);
  }
  return { comment: commentDto_(result.row, ctx.user, {}) };
}

function forumDeleteComment_(data, ctx) {
  var c = dbGet_('comments', 'comment_id', str_(data.commentId, 40));
  if (!c || c.deleted_at) fail_('NOT_FOUND', 'Balasan tidak ditemukan.');
  if (!canEditPost_(c, ctx.user)) fail_('FORBIDDEN', 'Anda hanya bisa menghapus balasan milik sendiri.');
  var reason = str_(data.reason, 300);
  var byMod = String(c.author_id) !== String(ctx.user.user_id);
  if (byMod && !reason) fail_('VALIDATION', 'Tuliskan alasan penghapusan.');
  removeComment_(c);
  if (byMod) {
    audit_(ctx.user.user_id, 'forum.deleteComment', 'comment', c.comment_id, { reason: reason });
    notify_(c.author_id, 'moderation', 'Balasan Anda dihapus moderator. Alasan: ' + reason, 'forum/' + c.disc_id, c.disc_id);
  }
  return { ok: true };
}

/* ---------- Penghapusan (dipakai pemilik, moderator, dan tindak lanjut laporan) ---------- */

function removeTopic_(d) {
  withLock_(function () {
    dbUpdate_('discussions', 'disc_id', d.disc_id, { deleted_at: nowIso_() });
    trashAttachments_(parseJson_(d.attachment_ids, []));
  });
}

function removeComment_(c) {
  withLock_(function () {
    dbUpdate_('comments', 'comment_id', c.comment_id, { deleted_at: nowIso_(), body: '' });
    trashAttachments_(parseJson_(c.attachment_ids, []));
    var d = dbGet_('discussions', 'disc_id', c.disc_id);
    if (d) dbUpdate_('discussions', 'disc_id', d.disc_id, { reply_count: Math.max(0, (Number(d.reply_count) || 0) - 1) });
  });
}

/* ---------- Reaksi ---------- */

/** Klik reaksi yang sama = batal; reaksi lain = ganti. Satu reaksi per orang per tulisan. */
function forumReact_(data, ctx) {
  var me = ctx.user.user_id;
  var type = str_(data.type, 20), targetType = str_(data.targetType, 20), targetId = str_(data.targetId, 40);
  if (!APP.REACTIONS[type]) fail_('VALIDATION', 'Reaksi tidak dikenal.');
  if (targetType === 'discussion') requireTopic_(targetId);
  else if (targetType === 'comment') {
    var c = dbGet_('comments', 'comment_id', targetId);
    if (!c || c.deleted_at) fail_('NOT_FOUND', 'Balasan tidak ditemukan.');
  } else fail_('VALIDATION', 'Target reaksi tidak dikenal.');

  withLock_(function () {
    var mine = function (r) { return r.target_type === targetType && r.target_id === targetId && String(r.user_id) === String(me); };
    var existing = dbFindOne_('reactions', mine);
    if (!existing) {
      dbInsert_('reactions', { target_type: targetType, target_id: targetId, user_id: me, type: type, created_at: nowIso_() });
    } else {
      var next = existing.type === type ? '' : type;   // baris dipakai ulang; '' = tidak bereaksi
      dbUpdateWhere_('reactions', mine, function () { return { type: next, created_at: nowIso_() }; });
    }
    if (targetType === 'discussion') {
      var n = dbWhere_('reactions', function (r) { return r.target_type === 'discussion' && r.target_id === targetId && r.type; }).length;
      dbUpdate_('discussions', 'disc_id', targetId, { reaction_count: n });
    }
  });
  return reactionSummary_(targetType, [targetId], me)[targetId];
}
