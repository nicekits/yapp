/**
 * Notifications.gs — notification center (dalam aplikasi).
 * Pesan chat TIDAK dibuatkan baris notifikasi (tercermin sebagai jumlah belum dibaca di Chat),
 * agar sheet tidak membengkak. Notifikasi dipakai untuk kejadian: ditambahkan ke grup,
 * dikeluarkan, dijadikan admin grup, akun disetujui, role berubah (Tahap 3: balasan forum,
 * pengumuman, agenda).
 */

function notify_(userId, type, title, link, refId) {
  dbInsert_('notifications', {
    notif_id: newId_('ntf'), user_id: userId, type: type, title: str_(title, 200), link: link || '',
    ref_id: refId || '', is_read: false, created_at: nowIso_()
  });
  cache_().remove('nu:' + userId);
  bumpInbox_([userId]);
}

/** Notifikasi ke banyak pengguna sekaligus (pengumuman, agenda baru). */
function notifyMany_(userIds, type, title, link, refId) {
  var now = nowIso_();
  var uniq = {};
  userIds.forEach(function (id) { uniq[id] = true; });
  var ids = Object.keys(uniq);
  dbInsertMany_('notifications', ids.map(function (id) {
    return { notif_id: newId_('ntf'), user_id: id, type: type, title: str_(title, 200), link: link || '',
      ref_id: refId || '', is_read: false, created_at: now };
  }));
  if (ids.length) cache_().removeAll(ids.map(function (id) { return 'nu:' + id; }));
  bumpInbox_(ids);
  return ids.length;
}

function notifUnreadCount_(userId) {
  var c = cache_().get('nu:' + userId);
  if (c !== null) return parseInt(c, 10);
  var n = dbWhere_('notifications', function (x) { return String(x.user_id) === String(userId) && !bool_(x.is_read); }).length;
  cache_().put('nu:' + userId, String(n), 3600);
  return n;
}

function notificationsList_(data, ctx) {
  var me = ctx.user.user_id;
  var page = Math.max(1, parseInt(data.page, 10) || 1);
  var size = 30;
  // reverse() dulu: baris yang ditambahkan belakangan tetap di atas bila waktunya sama (sort stabil).
  var all = dbWhere_('notifications', function (x) { return String(x.user_id) === String(me); }).reverse()
    .sort(function (a, b) { return toMs_(b.created_at) - toMs_(a.created_at); });
  return {
    items: all.slice((page - 1) * size, page * size).map(function (n) {
      return { id: n.notif_id, type: n.type, title: n.title, link: n.link, created_at: n.created_at, is_read: bool_(n.is_read) };
    }),
    total: all.length, page: page, pageSize: size, unread: notifUnreadCount_(me)
  };
}

function notificationsMarkRead_(data, ctx) {
  var me = ctx.user.user_id;
  var ids = {};
  (data.ids || []).forEach(function (id) { ids[str_(id, 40)] = true; });
  var n = dbUpdateWhere_('notifications',
    function (x) { return String(x.user_id) === String(me) && !bool_(x.is_read) && (data.all || ids[x.notif_id]); },
    function () { return { is_read: true }; });
  cache_().remove('nu:' + me);
  bumpInbox_([me]);
  return { updated: n, unread: notifUnreadCount_(me) };
}
