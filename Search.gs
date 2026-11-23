/**
 * Search.gs — pencarian global dari satu kotak: anggota, topik forum, materi, grup,
 * pengumuman, agenda, dan pesan di percakapan milik sendiri.
 * Setiap bagian mengembalikan maksimal 5 hasil + jumlah total.
 */

function searchAll_(data, ctx) {
  var q = str_(data.q, 60).toLowerCase();
  if (q.length < 2) fail_('VALIDATION', 'Ketik minimal 2 huruf.');
  var has = function () {
    for (var i = 0; i < arguments.length; i++) if (String(arguments[i] || '').toLowerCase().indexOf(q) >= 0) return true;
    return false;
  };
  var top = function (list, n) { return { items: list.slice(0, n || 5), total: list.length }; };
  var me = ctx.user.user_id;

  var members = approvedMembers_();
  members = members.map(function (m) { return memberCard_(m.user, m.profile, ctx.user, false); })
    .filter(function (c) { return has(c.full_name, c.username, c.nim, c.jabatan, c.kelas); })
    .sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });

  var cats = {};
  dbAll_('categories').forEach(function (c) { cats[c.cat_id] = c.name; });
  var topics = dbWhere_('discussions', function (d) { return !d.deleted_at && has(d.title, d.body); })
    .sort(function (a, b) { return toMs_(b.last_activity_at) - toMs_(a.last_activity_at); })
    .map(function (d) {
      return { disc_id: d.disc_id, title: d.title, excerpt: excerpt_(d.body, 120), cat_name: cats[d.cat_id] || '',
        reply_count: Number(d.reply_count) || 0, last_activity_at: d.last_activity_at };
    });

  var resources = dbWhere_('resources', function (r) { return !r.deleted_at && bool_(r.approved) && has(r.title, r.description); })
    .sort(function (a, b) { return toMs_(b.created_at) - toMs_(a.created_at); })
    .map(function (r) { return { res_id: r.res_id, title: r.title, kind: r.kind, cat_name: cats[r.cat_id] || '', excerpt: excerpt_(r.description, 100) }; });

  var my = myConvs_(me);
  var groups = dbWhere_('conversations', function (c) {
    return c.type === 'group' && (c.visibility === 'public' || my[c.conv_id]) && has(c.name, c.description);
  }).map(function (c) {
    return { conv_id: c.conv_id, name: c.name, photo_file_id: c.photo_file_id || '', is_member: !!my[c.conv_id],
      visibility: c.visibility, excerpt: excerpt_(c.description, 100) };
  });

  var announcements = visibleAnnouncements_(ctx.user, ctx.profile).filter(function (a) { return has(a.title, a.body); })
    .map(function (a) { return { ann_id: a.ann_id, title: a.title, excerpt: excerpt_(a.body, 120), publish_at: a.publish_at, priority: a.priority }; });

  var events = dbWhere_('events', function (e) { return !e.deleted_at && has(e.title, e.description, e.location); })
    .sort(function (a, b) { return toMs_(b.start_at) - toMs_(a.start_at); })
    .map(function (e) { return { event_id: e.event_id, title: e.title, start_at: e.start_at, location: e.location }; });

  var messages = { items: [], total: 0 };
  if (Object.keys(my).length) {
    var found = chatSearch_({ q: q }, ctx).items;
    messages = top(found);
  }

  return {
    q: q,
    members: top(members), topics: top(topics), resources: top(resources), groups: top(groups),
    announcements: top(announcements), events: top(events), messages: messages
  };
}
