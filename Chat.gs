/**
 * Chat.gs — percakapan terpadu (chat pribadi = type 'direct', grup = type 'group').
 *
 * Strategi "realtime" hemat kuota:
 *  - cv:<conv>  versi pesan percakapan   → berubah saat pesan baru/dihapus/anggota berubah
 *  - rv:<conv>  versi tanda baca          → berubah saat ada yang membaca
 *  - iv:<user>  versi inbox pengguna      → berubah saat salah satu percakapannya / notifikasinya berubah
 *  - cm:<conv>  50 pesan terbaru (cache)  → polling tidak perlu membaca spreadsheet
 *  - rd:<conv>  penunjuk "terakhir dibaca" per anggota
 *  - mc:<user>  daftar percakapan milik user + perannya
 * chat.sync hanya membandingkan versi; spreadsheet dibaca hanya jika cache kosong.
 */

var VERSION_TTL = 21600;

/* ---------- Versi ---------- */

function newVersion_() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

function getVersion_(key) {
  var c = cache_();
  var v = c.get(key);
  if (!v) { v = newVersion_(); c.put(key, v, VERSION_TTL); }
  return v;
}

function bumpConv_(convId) { cache_().put('cv:' + convId, newVersion_(), VERSION_TTL); }
function bumpReads_(convId) { cache_().put('rv:' + convId, newVersion_(), VERSION_TTL); }

function bumpInbox_(userIds) {
  if (!userIds || !userIds.length) return;
  var v = newVersion_(), values = {};
  userIds.forEach(function (id) { values['iv:' + id] = v; });
  cache_().putAll(values, VERSION_TTL);
}

/** ID pesan bisa diurutkan sebagai teks: waktu (base36) + acak.
 *  Waktu dibuat selalu naik dalam satu eksekusi, jadi dua pesan di milidetik yang sama tetap berurutan. */
var LAST_MSG_MS_ = 0;
function newMsgId_() {
  var ms = Math.max(Date.now(), LAST_MSG_MS_ + 1);
  LAST_MSG_MS_ = ms;
  var t = ms.toString(36);
  while (t.length < 9) t = '0' + t;
  return 'msg_' + t + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
}

/* ---------- Keanggotaan ---------- */

/** { convId: member_role } untuk percakapan aktif milik user (cache 10 menit). */
function myConvs_(userId) {
  var key = 'mc:' + userId;
  var cached = cacheGetJson_(key);
  if (cached) return cached;
  var map = {};
  dbWhere_('conversation_members', function (m) {
    return String(m.user_id) === String(userId) && !m.left_at;
  }).forEach(function (m) { map[m.conv_id] = m.member_role || 'member'; });
  cachePutJson_(key, map, 600);
  return map;
}

function uncacheMemberships_(userIds) {
  if (userIds.length) cache_().removeAll(userIds.map(function (id) { return 'mc:' + id; }));
}

function activeMembers_(convId) {
  return dbWhere_('conversation_members', function (m) {
    return String(m.conv_id) === String(convId) && !m.left_at;
  });
}

function memberIds_(convId) {
  return activeMembers_(convId).map(function (m) { return m.user_id; });
}

function requireConv_(convId) {
  var conv = dbGet_('conversations', 'conv_id', convId);
  if (!conv) fail_('NOT_FOUND', 'Percakapan tidak ditemukan.');
  return conv;
}

/** Memastikan user anggota percakapan. Mengembalikan peran user di percakapan. */
function requireMember_(convId, userId) {
  var role = myConvs_(userId)[convId];
  if (!role) fail_('FORBIDDEN', 'Anda bukan anggota percakapan ini.');
  return role;
}

/* ---------- Pesan terbaru (cache) ---------- */

function recentMessages_(convIds) {
  var out = {};
  if (!convIds.length) return out;
  var got = cache_().getAll(convIds.map(function (id) { return 'cm:' + id; }));
  var missing = {};
  convIds.forEach(function (id) {
    var v = got['cm:' + id];
    if (v) out[id] = JSON.parse(v); else missing[id] = true;
  });
  var missingIds = Object.keys(missing);
  if (missingIds.length) {
    var grouped = {};
    missingIds.forEach(function (id) { grouped[id] = []; });
    dbRead_('messages').rows.forEach(function (r) {
      if (grouped[r.conv_id]) grouped[r.conv_id].push(stripMeta_(r));
    });
    missingIds.forEach(function (id) {
      var list = grouped[id].sort(function (a, b) { return a.msg_id < b.msg_id ? -1 : 1; });
      out[id] = putRecent_(id, list.slice(-APP.RECENT_MESSAGES));
    });
  }
  return out;
}

/** Simpan jendela pesan ke cache (dipangkas jika melebihi batas ukuran cache). */
function putRecent_(convId, list) {
  var json = JSON.stringify(list);
  while (json.length > 90000 && list.length > 5) {
    list = list.slice(Math.ceil(list.length / 4));
    json = JSON.stringify(list);
  }
  cache_().put('cm:' + convId, json, VERSION_TTL);
  return list;
}

function msgDto_(r) {
  var deleted = !!r.deleted_at;
  return {
    id: r.msg_id,
    conv_id: r.conv_id,
    sender_id: r.sender_id,
    kind: r.kind || 'text',
    body: deleted ? '' : String(r.body === null || r.body === undefined ? '' : r.body),
    reply: deleted ? null : parseJson_(r.reply_json, null),
    attachments: deleted ? [] : parseJson_(r.attachment_ids, []),
    created_at: r.created_at,
    deleted: deleted
  };
}

/* ---------- Penunjuk baca ---------- */

function readPointers_(convIds) {
  var out = {};
  if (!convIds.length) return out;
  var got = cache_().getAll(convIds.map(function (id) { return 'rd:' + id; }));
  var missing = [];
  convIds.forEach(function (id) {
    var v = got['rd:' + id];
    if (v) out[id] = JSON.parse(v); else { missing.push(id); out[id] = {}; }
  });
  if (missing.length) {
    var set = {};
    missing.forEach(function (id) { set[id] = true; });
    dbWhere_('conversation_members', function (m) { return set[m.conv_id] && !m.left_at; })
      .forEach(function (m) { out[m.conv_id][m.user_id] = m.last_read_msg_id || ''; });
    var values = {};
    missing.forEach(function (id) { values['rd:' + id] = JSON.stringify(out[id]); });
    cache_().putAll(values, VERSION_TTL);
  }
  return out;
}

function setPointer_(convId, userId, msgId) {
  var ptrs = readPointers_([convId])[convId];
  if (msgId === null) delete ptrs[userId]; else ptrs[userId] = msgId;
  cache_().put('rd:' + convId, JSON.stringify(ptrs), VERSION_TTL);
}

/** Tandai dibaca sampai msgId. Ditulis ke sheet paling sering tiap 60 detik per user per percakapan. */
function markRead_(convId, userId, msgId) {
  if (!msgId) return false;
  var ptrs = readPointers_([convId])[convId];
  if ((ptrs[userId] || '') >= msgId) return false;
  setPointer_(convId, userId, msgId);
  bumpReads_(convId);
  bumpInbox_([userId]);
  var flag = 'rdw:' + convId + ':' + userId;
  if (!cache_().get(flag)) {
    cache_().put(flag, '1', 60);
    dbUpdateWhere_('conversation_members',
      function (m) { return m.conv_id === convId && m.user_id === userId && !m.left_at; },
      function () { return { last_read_msg_id: msgId }; });
  }
  return true;
}

function lastMessageId_(list) {
  var max = '';
  list.forEach(function (m) { if (m.msg_id > max) max = m.msg_id; });
  return max;
}

/* ---------- Inbox ---------- */

function inboxSummary_(userId) {
  var my = myConvs_(userId);
  var ids = Object.keys(my);
  var convs = ids.length ? dbWhere_('conversations', function (c) { return my[c.conv_id]; }) : [];
  var recent = recentMessages_(ids);
  var reads = readPointers_(ids);

  var directIds = {};
  convs.forEach(function (c) { if (c.type === 'direct') directIds[c.conv_id] = true; });
  var peers = {};
  if (Object.keys(directIds).length) {
    dbWhere_('conversation_members', function (m) {
      return directIds[m.conv_id] && String(m.user_id) !== String(userId);
    }).forEach(function (m) { peers[m.conv_id] = m.user_id; });
  }
  var counts = {}, muted = {};
  dbWhere_('conversation_members', function (m) { return my[m.conv_id] && !m.left_at; })
    .forEach(function (m) {
      counts[m.conv_id] = (counts[m.conv_id] || 0) + 1;
      if (String(m.user_id) === String(userId) && bool_(m.muted)) muted[m.conv_id] = true;
    });

  var peerIds = Object.keys(peers).map(function (k) { return peers[k]; });
  var online = onlineMap_(peerIds);
  var total = 0;
  var items = [];
  convs.forEach(function (c) {
    if (c.type === 'direct' && !c.last_message_at && String(c.created_by) !== String(userId)) return;
    var mine = (reads[c.conv_id] || {})[userId] || '';
    var unread = (recent[c.conv_id] || []).filter(function (m) {
      return m.msg_id > mine && String(m.sender_id) !== String(userId) && m.kind !== 'system' && !m.deleted_at;
    }).length;
    if (!muted[c.conv_id]) total += unread;   // percakapan yang dibisukan tidak menambah badge
    var item = {
      conv_id: c.conv_id, type: c.type, name: c.name, photo_file_id: c.photo_file_id || '',
      is_official: bool_(c.is_official), visibility: c.visibility || '',
      last_message_at: c.last_message_at || '', created_at: c.created_at,
      preview: c.last_message_preview || '', unread: unread, my_role: my[c.conv_id],
      last_msg_id: lastMessageId_(recent[c.conv_id] || []), muted: !!muted[c.conv_id],
      member_count: counts[c.conv_id] || 0
    };
    if (c.type === 'direct') {
      var peer = loadUser_(peers[c.conv_id]);
      item.peer_id = peers[c.conv_id];
      item.name = peer ? (peer.profile.full_name || peer.user.username) : 'Pengguna';
      item.photo_file_id = peer ? (peer.profile.photo_file_id || '') : '';
      item.online = !!online[peers[c.conv_id]];
    }
    items.push(item);
  });
  // Urut berdasarkan ID pesan terakhir (presisi milidetik); percakapan kosong memakai waktu dibuat.
  var key = function (x) {
    if (x.last_msg_id) return x.last_msg_id;
    var t = toMs_(x.created_at).toString(36);
    while (t.length < 9) t = '0' + t;
    return 'msg_' + t;
  };
  items.sort(function (a, b) { return key(a) < key(b) ? 1 : (key(a) > key(b) ? -1 : 0); });
  return { items: items, unreadTotal: total, notifUnread: notifUnreadCount_(userId) };
}

/* ---------- Detail percakapan ---------- */

function groupCanManage_(conv, user, myRole) {
  if (myRole === 'owner' || myRole === 'admin') return true;
  return bool_(conv.is_official) && isStaff_(user, ROLES.ADMIN);
}

function convMeta_(conv, ctx) {
  var me = ctx.user.user_id;
  var members = activeMembers_(conv.conv_id);
  var online = onlineMap_(members.map(function (m) { return m.user_id; }));
  var myRole = '', myMuted = false;
  var list = members.map(function (m) {
    if (String(m.user_id) === String(me)) { myRole = m.member_role; myMuted = bool_(m.muted); }
    var b = loadUser_(m.user_id);
    return {
      user_id: m.user_id,
      full_name: b ? (b.profile.full_name || b.user.username) : 'Pengguna',
      username: b ? b.user.username : '',
      photo_file_id: b ? (b.profile.photo_file_id || '') : '',
      member_role: m.member_role || 'member',
      online: !!online[m.user_id],
      last_seen_at: b ? (b.user.last_seen_at || '') : '',
      active: b ? b.user.status === STATUS.APPROVED : false
    };
  });
  var rank = { owner: 0, admin: 1, member: 2 };
  list.sort(function (a, b) {
    return (rank[a.member_role] - rank[b.member_role]) || a.full_name.localeCompare(b.full_name);
  });
  var meta = {
    conv_id: conv.conv_id, type: conv.type, name: conv.name, description: conv.description || '',
    photo_file_id: conv.photo_file_id || '', visibility: conv.visibility || '', is_official: bool_(conv.is_official),
    created_at: conv.created_at, members: list, my_role: myRole, muted: myMuted,
    can_manage: conv.type === 'group' && groupCanManage_(conv, ctx.user, myRole)
  };
  if (conv.type === 'direct') {
    var peer = list.filter(function (m) { return String(m.user_id) !== String(me); })[0];
    if (peer) {
      meta.name = peer.full_name; meta.photo_file_id = peer.photo_file_id; meta.peer = peer;
    }
  }
  return meta;
}

/** Profil singkat pengirim pesan (nama & foto) agar klien bisa menampilkannya. */
function sendersOf_(messages) {
  var out = {};
  messages.forEach(function (m) {
    if (out[m.sender_id]) return;
    var b = loadUser_(m.sender_id);
    out[m.sender_id] = {
      full_name: b ? (b.profile.full_name || b.user.username) : 'Pengguna',
      photo_file_id: b ? (b.profile.photo_file_id || '') : ''
    };
  });
  return out;
}

function chatOpen_(data, ctx) {
  var convId = str_(data.convId, 40);
  requireMember_(convId, ctx.user.user_id);
  var conv = requireConv_(convId);
  var list = recentMessages_([convId])[convId];
  if (data.visible !== false) markRead_(convId, ctx.user.user_id, lastMessageId_(list));
  return {
    conv: convMeta_(conv, ctx),
    messages: list.map(msgDto_),
    senders: sendersOf_(list),
    reads: readPointers_([convId])[convId],
    cv: getVersion_('cv:' + convId),
    rv: getVersion_('rv:' + convId),
    hasMore: list.length >= APP.RECENT_MESSAGES
  };
}

function chatHistory_(data, ctx) {
  var convId = str_(data.convId, 40);
  requireMember_(convId, ctx.user.user_id);
  var before = str_(data.beforeId, 40);
  var rows = dbWhere_('messages', function (r) {
    return r.conv_id === convId && (!before || r.msg_id < before);
  }).sort(function (a, b) { return a.msg_id < b.msg_id ? -1 : 1; });
  var page = rows.slice(-APP.HISTORY_PAGE);
  return { messages: page.map(msgDto_), senders: sendersOf_(page), hasMore: rows.length > page.length };
}

/* ---------- Sinkronisasi (polling) ---------- */

/**
 * data: { convId?, cv?, rv?, iv?, visible?, wantOnline? }
 * Hanya bagian yang berubah yang dikirim balik.
 */
function chatSync_(data, ctx) {
  var me = ctx.user.user_id;
  var out = {};
  var convId = str_(data.convId, 40);
  if (convId && myConvs_(me)[convId]) {
    var cv = getVersion_('cv:' + convId);
    var list = null;
    if (data.cv !== cv) {
      list = recentMessages_([convId])[convId];
      out.conv = { conv_id: convId, cv: cv, messages: list.map(msgDto_), senders: sendersOf_(list) };
    }
    if (data.visible) {
      list = list || recentMessages_([convId])[convId];
      markRead_(convId, me, lastMessageId_(list));
    }
    var rv = getVersion_('rv:' + convId);
    if (data.rv !== rv) out.reads = { conv_id: convId, rv: rv, map: readPointers_([convId])[convId] };
    var ids = memberIds_(convId);
    out.presence = { conv_id: convId, online: onlineMap_(ids) };
  } else if (convId) {
    out.removed = convId;   // user sudah bukan anggota (dikeluarkan dari grup)
  }

  var iv = getVersion_('iv:' + me);
  if (data.iv !== iv) {
    out.iv = iv;
    out.inbox = inboxSummary_(me);
  }
  if (data.wantOnline) {
    out.online = onlineList_(ctx.user, 30);
    if (isStaff_(ctx.user, ROLES.ADMIN)) {
      out.pendingCount = dbWhere_('users', function (u) { return u.status === STATUS.PENDING; }).length;
    }
    if (isStaff_(ctx.user, ROLES.MODERATOR)) out.openReports = openReportsCount_();
  }
  var cerr = parseInt(data.cerr, 10);
  if (cerr > 0) recordClientErrors_(Math.min(cerr, 50));
  return out;
}

/* ---------- Kirim & hapus ---------- */

function previewText_(body, attachments) {
  var t = String(body || '').replace(/\s+/g, ' ').trim();
  if (!t && attachments && attachments.length) {
    t = (attachments[0].kind === 'image' ? 'Foto' : 'File: ' + attachments[0].name);
  }
  return t.length > 80 ? t.slice(0, 77) + '…' : t;
}

/** Simpan satu pesan (dipakai juga untuk pesan sistem). Wajib dipanggil di dalam withLock_. */
function appendMessage_(conv, senderId, kind, body, extra) {
  extra = extra || {};
  var msg = {
    msg_id: newMsgId_(), conv_id: conv.conv_id, sender_id: senderId, body: body,
    reply_to_id: extra.reply ? extra.reply.id : '', attachment_ids: extra.attachments ? JSON.stringify(extra.attachments) : '',
    created_at: nowIso_(), edited_at: '', deleted_at: '', kind: kind,
    reply_json: extra.reply ? JSON.stringify(extra.reply) : ''
  };
  var list = recentMessages_([conv.conv_id])[conv.conv_id];   // isi cache sebelum menulis
  dbInsert_('messages', msg);
  list.push(msg);
  putRecent_(conv.conv_id, list.slice(-APP.RECENT_MESSAGES));

  var preview = previewText_(body, extra.attachments);
  if (conv.type === 'group' && kind !== 'system') {
    var b = loadUser_(senderId);
    preview = (b ? (b.profile.full_name || b.user.username).split(' ')[0] : '') + ': ' + preview;
  }
  dbUpdate_('conversations', 'conv_id', conv.conv_id, { last_message_at: msg.created_at, last_message_preview: preview });
  bumpConv_(conv.conv_id);
  bumpInbox_(memberIds_(conv.conv_id));
  return msg;
}

function postSystem_(conv, actorId, text) {
  return appendMessage_(conv, actorId, 'system', text);
}

function chatSend_(data, ctx) {
  var me = ctx.user.user_id;
  var convId = str_(data.convId, 40);
  requireMember_(convId, me);
  var body = String(data.body === null || data.body === undefined ? '' : data.body)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (body.length > APP.MESSAGE_MAX_CHARS) fail_('VALIDATION', 'Pesan maksimal ' + APP.MESSAGE_MAX_CHARS + ' karakter.');
  var attIds = (data.attachmentIds || []).slice(0, 5).map(function (x) { return str_(x, 40); });
  if (!body && !attIds.length) fail_('VALIDATION', 'Pesan kosong.');
  if (!rateLimit_('msg:' + me, APP.MESSAGES_PER_MINUTE, 60)) {
    fail_('RATE_LIMIT', 'Terlalu banyak pesan dalam satu menit. Tunggu sebentar.');
  }

  return withLock_(function () {
    var conv = requireConv_(convId);
    var reply = null;
    var replyId = str_(data.replyToId, 40);
    if (replyId) {
      var target = (recentMessages_([convId])[convId].filter(function (m) { return m.msg_id === replyId; })[0]) ||
        dbFindOne_('messages', function (m) { return m.msg_id === replyId; });
      if (!target || target.conv_id !== convId || target.deleted_at) fail_('VALIDATION', 'Pesan yang dibalas tidak ditemukan.');
      var tb = loadUser_(target.sender_id);
      var tAtt = parseJson_(target.attachment_ids, []);
      reply = {
        id: target.msg_id, sender_id: target.sender_id,
        name: tb ? (tb.profile.full_name || tb.user.username) : 'Pengguna',
        text: previewText_(target.body, tAtt)
      };
    }

    var attachments = [];
    if (attIds.length) {
      var rows = dbWhere_('attachments', function (a) { return attIds.indexOf(a.file_id) >= 0; });
      if (rows.length !== attIds.length) fail_('VALIDATION', 'Lampiran tidak ditemukan. Unggah ulang file.');
      rows.forEach(function (a) {
        if (a.owner_id !== me || a.context_type !== 'pending' || a.conv_id !== convId) {
          fail_('FORBIDDEN', 'Lampiran tidak valid.');
        }
        attachments.push({ id: a.file_id, name: a.name, mime: a.mime, size: Number(a.size_bytes) || 0,
          kind: a.mime.indexOf('image/') === 0 ? 'image' : (a.mime === 'application/pdf' ? 'pdf' : 'office'),
          thumb: !!a.thumb_data });
      });
    }

    var msg = appendMessage_(conv, me, 'text', body, { reply: reply, attachments: attachments.length ? attachments : null });
    attachments.forEach(function (a) {
      dbUpdate_('attachments', 'file_id', a.id, { context_type: 'message', context_id: msg.msg_id });
    });
    setPointer_(convId, me, msg.msg_id);   // pesan sendiri otomatis terbaca
    bumpReads_(convId);
    return { message: msgDto_(msg), cv: getVersion_('cv:' + convId) };
  });
}

function chatDeleteMessage_(data, ctx) {
  var me = ctx.user.user_id;
  var msgId = str_(data.msgId, 40);
  return withLock_(function () {
    var row = dbFindOne_('messages', function (m) { return m.msg_id === msgId; });
    if (!row) fail_('NOT_FOUND', 'Pesan tidak ditemukan.');
    requireMember_(row.conv_id, me);
    if (String(row.sender_id) !== String(me) || row.kind === 'system') {
      fail_('FORBIDDEN', 'Anda hanya bisa menghapus pesan milik sendiri.');
    }
    removeMessage_(row);
    return { ok: true };
  });
}

/** Hapus satu pesan (soft delete) + lampirannya, perbarui cache & pratinjau. Wajib di dalam withLock_. */
function removeMessage_(row) {
  if (row.deleted_at) return;
  var msgId = row.msg_id, now = nowIso_();
  dbUpdate_('messages', 'msg_id', msgId, { deleted_at: now, body: '', attachment_ids: '', reply_json: '' });
  trashAttachments_(parseJson_(row.attachment_ids, []));
  var list = recentMessages_([row.conv_id])[row.conv_id];
  list.forEach(function (m) {
    if (m.msg_id === msgId) { m.deleted_at = now; m.body = ''; m.attachment_ids = ''; m.reply_json = ''; }
  });
  putRecent_(row.conv_id, list);
  if (lastMessageId_(list) === msgId) {
    dbUpdate_('conversations', 'conv_id', row.conv_id, { last_message_preview: 'Pesan dihapus' });
  }
  bumpConv_(row.conv_id);
  bumpInbox_(memberIds_(row.conv_id));
}

/* ---------- Bisukan percakapan ---------- */

function chatMute_(data, ctx) {
  var me = ctx.user.user_id, convId = str_(data.convId, 40);
  requireMember_(convId, me);
  dbUpdateWhere_('conversation_members',
    function (m) { return m.conv_id === convId && String(m.user_id) === String(me) && !m.left_at; },
    function () { return { muted: !!data.muted }; });
  bumpInbox_([me]);
  return { muted: !!data.muted };
}

/* ---------- Chat pribadi ---------- */

function chatOpenDirect_(data, ctx) {
  var me = ctx.user.user_id;
  var other = str_(data.userId, 40);
  if (!other || other === me) fail_('VALIDATION', 'Pilih anggota lain.');
  var target = loadUser_(other);
  if (!target || target.user.status !== STATUS.APPROVED) fail_('NOT_FOUND', 'Anggota tidak ditemukan atau tidak aktif.');
  var key = [me, other].sort().join('|');

  return withLock_(function () {
    var conv = dbGet_('conversations', 'direct_key', key);
    if (conv) return { conv_id: conv.conv_id };
    var privacy = parseJson_(target.profile.privacy_json, DEFAULT_PRIVACY);
    if (privacy.allow_dm === false && !isStaff_(ctx.user, ROLES.MODERATOR)) {
      fail_('FORBIDDEN', 'Anggota ini tidak menerima pesan pribadi baru. Sapa di grup atau forum.');
    }
    var convId = newId_('cnv');
    var now = nowIso_();
    dbInsert_('conversations', {
      conv_id: convId, type: 'direct', name: '', description: '', photo_file_id: '', visibility: 'private',
      is_official: false, created_by: me, created_at: now, last_message_at: '', last_message_preview: '', direct_key: key
    });
    [me, other].forEach(function (uid) {
      dbInsert_('conversation_members', {
        conv_id: convId, user_id: uid, member_role: 'member', joined_at: now, left_at: '', last_read_msg_id: '', muted: false
      });
    });
    uncacheMemberships_([me, other]);
    bumpInbox_([me]);
    return { conv_id: convId };
  });
}

/* ---------- Pencarian riwayat ---------- */

function chatSearch_(data, ctx) {
  var me = ctx.user.user_id;
  var q = str_(data.q, 60).toLowerCase();
  if (q.length < 2) fail_('VALIDATION', 'Ketik minimal 2 huruf.');
  var my = myConvs_(me);
  var only = str_(data.convId, 40);
  if (only && !my[only]) fail_('FORBIDDEN', 'Anda bukan anggota percakapan ini.');
  var hits = dbWhere_('messages', function (m) {
    if (only ? m.conv_id !== only : !my[m.conv_id]) return false;
    if (m.deleted_at || m.kind === 'system') return false;
    return String(m.body).toLowerCase().indexOf(q) >= 0;
  }).sort(function (a, b) { return a.msg_id < b.msg_id ? 1 : -1; }).slice(0, 30);

  var names = {};
  inboxSummary_(me).items.forEach(function (c) { names[c.conv_id] = c.name; });
  var senders = sendersOf_(hits);
  return {
    items: hits.map(function (m) {
      return {
        id: m.msg_id, conv_id: m.conv_id, conv_name: names[m.conv_id] || '',
        sender_name: senders[m.sender_id].full_name, body: String(m.body), created_at: m.created_at
      };
    })
  };
}
