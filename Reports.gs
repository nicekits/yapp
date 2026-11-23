/**
 * Reports.gs — laporan konten oleh anggota & antrean moderasi.
 *
 * Yang bisa dilaporkan: discussion (topik), comment (balasan forum), message (pesan chat),
 * resource (materi), user (anggota).
 * Saat melapor, isi konten disalin (snapshot) ke laporan. Moderator menilai dari salinan itu,
 * sehingga pesan pribadi tetap tidak bisa dibuka moderator — hanya pesan yang dilaporkan yang terlihat.
 *
 * Tindak lanjut: remove (hapus konten + beri tahu penulis), warn (peringatan ke penulis),
 * dismiss (tidak melanggar). Pelapor diberi tahu hasilnya.
 */

var REPORT_TYPES = { discussion: 'Topik forum', comment: 'Balasan forum', message: 'Pesan chat', resource: 'Materi', user: 'Anggota' };

/** Cari target laporan & buat salinan isinya. Melempar error bila tidak boleh dilaporkan. */
function reportTarget_(type, id, ctx) {
  var me = ctx.user.user_id;
  if (type === 'discussion') {
    var d = requireTopic_(id);
    return { author_id: d.author_id, text: d.title + ' — ' + excerpt_(d.body, 400), link: 'forum/' + d.disc_id, title: d.title };
  }
  if (type === 'comment') {
    var c = dbGet_('comments', 'comment_id', id);
    if (!c || c.deleted_at) fail_('NOT_FOUND', 'Balasan tidak ditemukan.');
    var t = dbGet_('discussions', 'disc_id', c.disc_id) || {};
    return { author_id: c.author_id, text: excerpt_(c.body, 400), link: 'forum/' + c.disc_id, title: 'Balasan di: ' + (t.title || '') };
  }
  if (type === 'message') {
    var m = dbFindOne_('messages', function (x) { return x.msg_id === id; });
    if (!m || m.deleted_at || m.kind === 'system') fail_('NOT_FOUND', 'Pesan tidak ditemukan.');
    requireMember_(m.conv_id, me);
    var conv = dbGet_('conversations', 'conv_id', m.conv_id) || {};
    var atts = parseJson_(m.attachment_ids, []).map(function (a) { return '[' + a.name + ']'; }).join(' ');
    return {
      author_id: m.sender_id, text: excerpt_(String(m.body) + (atts ? ' ' + atts : ''), 400), link: '',
      title: conv.type === 'group' ? 'Pesan di grup ' + conv.name : 'Pesan pribadi', conv_id: m.conv_id
    };
  }
  if (type === 'resource') {
    var r = requireResource_(id, ctx.user);
    return { author_id: r.uploader_id, text: r.title + ' — ' + excerpt_(r.description || r.url || '', 300), link: 'resources', title: r.title };
  }
  if (type === 'user') {
    var u = loadUser_(id);
    if (!u || u.user.status !== STATUS.APPROVED) fail_('NOT_FOUND', 'Anggota tidak ditemukan.');
    return { author_id: id, text: (u.profile.full_name || u.user.username) + ' (@' + u.user.username + ')', link: 'members/' + id,
      title: 'Profil ' + (u.profile.full_name || u.user.username) };
  }
  fail_('VALIDATION', 'Jenis laporan tidak dikenal.');
}

function reportsCreate_(data, ctx) {
  var me = ctx.user.user_id;
  var type = str_(data.targetType, 20), id = str_(data.targetId, 40);
  var reason = str_(data.reason, 20), note = str_(data.note, 500);
  if (!APP.REPORT_REASONS[reason]) fail_('VALIDATION', 'Pilih alasan laporan.');
  if (reason === 'lainnya' && !note) fail_('VALIDATION', 'Jelaskan singkat alasannya.');
  var target = reportTarget_(type, id, ctx);
  if (String(target.author_id) === String(me)) fail_('VALIDATION', 'Anda tidak bisa melaporkan konten milik sendiri.');
  var dup = dbFindOne_('reports', function (r) {
    return r.target_type === type && r.target_id === id && String(r.reporter_id) === String(me) && r.status === 'open';
  });
  if (dup) fail_('CONFLICT', 'Anda sudah melaporkan ini. Moderator sedang meninjaunya.');
  if (!rateLimit_('report:' + me, APP.REPORTS_PER_HOUR, 3600)) fail_('RATE_LIMIT', 'Terlalu banyak laporan dalam satu jam.');

  dbInsert_('reports', {
    report_id: newId_('rpt'), target_type: type, target_id: id, reporter_id: me, reason: reason, status: 'open',
    handled_by: '', handled_at: '', created_at: nowIso_(), note: note, snapshot_json: JSON.stringify(target), action: ''
  });
  cache_().remove('openReports');
  notifyMany_(staffIds_(ROLES.MODERATOR).filter(function (x) { return x !== me && x !== target.author_id; }),
    'report', 'Laporan baru: ' + REPORT_TYPES[type] + ' — ' + APP.REPORT_REASONS[reason], 'moderation', id);
  return { message: 'Terima kasih. Laporan Anda dikirim ke moderator dan identitas Anda tidak ditampilkan ke yang dilaporkan.' };
}

function openReportsCount_() {
  var c = cache_().get('openReports');
  if (c !== null) return parseInt(c, 10);
  var keys = {};
  dbWhere_('reports', function (r) { return r.status === 'open'; }).forEach(function (r) { keys[r.target_type + ':' + r.target_id] = true; });
  var n = Object.keys(keys).length;
  cache_().put('openReports', String(n), 300);
  return n;
}

/** Laporan dikelompokkan per konten: satu konten yang dilaporkan banyak orang = satu kartu. */
function moderationList_(data, ctx) {
  var status = data.status === 'closed' ? 'closed' : 'open';
  var groups = {};
  dbWhere_('reports', function (r) { return status === 'open' ? r.status === 'open' : r.status !== 'open'; })
    .forEach(function (r) {
      var key = r.target_type + ':' + r.target_id + (status === 'closed' ? ':' + r.handled_at : '');
      var g = groups[key] || (groups[key] = {
        key: key, target_type: r.target_type, type_label: REPORT_TYPES[r.target_type] || r.target_type, target_id: r.target_id,
        snapshot: parseJson_(r.snapshot_json, {}), reasons: {}, notes: [], count: 0, first_at: r.created_at, last_at: r.created_at,
        status: r.status, action: r.action || '', handled_by: r.handled_by ? nameOf_(r.handled_by) : '', handled_at: r.handled_at || ''
      });
      g.count++;
      g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
      if (r.note) g.notes.push(r.note);
      if (toMs_(r.created_at) < toMs_(g.first_at)) g.first_at = r.created_at;
      if (toMs_(r.created_at) > toMs_(g.last_at)) g.last_at = r.created_at;
    });
  var items = Object.keys(groups).map(function (k) {
    var g = groups[k];
    g.author = authorCard_(g.snapshot.author_id);
    g.reasons = Object.keys(g.reasons).map(function (x) { return { label: APP.REPORT_REASONS[x] || x, count: g.reasons[x] }; });
    g.can_remove = g.target_type !== 'user';
    return g;
  }).sort(function (a, b) {
    return status === 'open' ? (b.count - a.count) || (toMs_(a.first_at) - toMs_(b.first_at)) : toMs_(b.handled_at) - toMs_(a.handled_at);
  });
  return { items: items.slice(0, 100), openCount: openReportsCount_() };
}

function moderationResolve_(data, ctx) {
  var me = ctx.user.user_id;
  var type = str_(data.targetType, 20), id = str_(data.targetId, 40), action = data.action;
  var reason = str_(data.reason, 300);
  if (['remove', 'warn', 'dismiss'].indexOf(action) < 0) fail_('VALIDATION', 'Tindakan tidak dikenal.');
  if (action !== 'dismiss' && !reason) fail_('VALIDATION', 'Tuliskan alasan (dikirim ke penulis konten).');
  if (action === 'remove' && type === 'user') fail_('VALIDATION', 'Akun tidak bisa dihapus dari sini. Admin dapat menonaktifkannya di Admin Panel.');
  var open = dbWhere_('reports', function (r) { return r.target_type === type && r.target_id === id && r.status === 'open'; });
  if (!open.length) fail_('NOT_FOUND', 'Tidak ada laporan terbuka untuk konten ini.');
  var snap = parseJson_(open[0].snapshot_json, {});

  if (action === 'remove') {
    if (type === 'discussion') {
      var d = dbGet_('discussions', 'disc_id', id);
      if (d && !d.deleted_at) removeTopic_(d);
    } else if (type === 'comment') {
      var c = dbGet_('comments', 'comment_id', id);
      if (c && !c.deleted_at) removeComment_(c);
    } else if (type === 'message') {
      withLock_(function () {
        var m = dbFindOne_('messages', function (x) { return x.msg_id === id; });
        if (m) removeMessage_(m);
      });
    } else if (type === 'resource') {
      var r = dbGet_('resources', 'res_id', id);
      if (r && !r.deleted_at) removeResource_(r);
    }
  }

  var now = nowIso_();
  var status = action === 'dismiss' ? 'dismissed' : 'resolved';
  dbUpdateWhere_('reports',
    function (r) { return r.target_type === type && r.target_id === id && r.status === 'open'; },
    function () { return { status: status, handled_by: me, handled_at: now, action: action }; });
  cache_().remove('openReports');

  var what = REPORT_TYPES[type] ? REPORT_TYPES[type].toLowerCase() : 'konten';
  if (action === 'remove') {
    notify_(snap.author_id, 'moderation', 'Moderator menghapus ' + what + ' Anda (' + excerpt_(snap.title || snap.text, 50) + '). Alasan: ' + reason, '', id);
  } else if (action === 'warn') {
    notify_(snap.author_id, 'moderation', 'Peringatan dari moderator terkait ' + what + ' Anda: ' + reason, snap.link || '', id);
  }
  var outcome = action === 'remove' ? 'konten telah dihapus' : (action === 'warn' ? 'penulis telah diberi peringatan' : 'tidak ditemukan pelanggaran');
  notifyMany_(open.map(function (r) { return r.reporter_id; }), 'report_result',
    'Laporan Anda (' + what + ') sudah ditinjau: ' + outcome + '. Terima kasih.', '', id);
  audit_(me, 'moderation.' + action, type, id, { title: snap.title || excerpt_(snap.text, 60), reason: reason || undefined, reports: open.length });
  return { ok: true, status: status };
}
