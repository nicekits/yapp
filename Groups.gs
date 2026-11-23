/**
 * Groups.gs — grup percakapan (conversations.type = 'group').
 * Peran di grup: owner (pembuat), admin (admin grup), member.
 * Hanya Moderator ke atas yang boleh membuat grup (keputusan komunitas).
 */

function nameOf_(userId) {
  var b = loadUser_(userId);
  return b ? (b.profile.full_name || b.user.username) : 'Pengguna';
}

function firstName_(userId) {
  return nameOf_(userId).split(' ')[0];
}

function requireGroup_(convId) {
  var conv = requireConv_(convId);
  if (conv.type !== 'group') fail_('VALIDATION', 'Percakapan ini bukan grup.');
  return conv;
}

function requireManage_(conv, ctx) {
  var role = myConvs_(ctx.user.user_id)[conv.conv_id] || '';
  if (!groupCanManage_(conv, ctx.user, role)) fail_('FORBIDDEN', 'Hanya admin grup yang bisa melakukan ini.');
  return role;
}

/** Tambah (atau aktifkan kembali) anggota. Wajib di dalam withLock_. */
function addMemberRow_(conv, userId, role) {
  var now = nowIso_();
  var lastId = lastMessageId_(recentMessages_([conv.conv_id])[conv.conv_id]);
  var existing = dbFindOne_('conversation_members', function (m) {
    return m.conv_id === conv.conv_id && m.user_id === userId;
  });
  if (existing && !existing.left_at) return false;
  if (existing) {
    dbUpdateWhere_('conversation_members',
      function (m) { return m.conv_id === conv.conv_id && m.user_id === userId; },
      function () { return { left_at: '', joined_at: now, member_role: role, last_read_msg_id: lastId }; });
  } else {
    dbInsert_('conversation_members', {
      conv_id: conv.conv_id, user_id: userId, member_role: role, joined_at: now, left_at: '',
      last_read_msg_id: lastId, muted: false
    });
  }
  setPointer_(conv.conv_id, userId, lastId);   // anggota baru tidak dibanjiri pesan "belum dibaca"
  uncacheMemberships_([userId]);
  return true;
}

function removeMemberRow_(conv, userId) {
  dbUpdateWhere_('conversation_members',
    function (m) { return m.conv_id === conv.conv_id && m.user_id === userId && !m.left_at; },
    function () { return { left_at: nowIso_() }; });
  setPointer_(conv.conv_id, userId, null);
  uncacheMemberships_([userId]);
  bumpInbox_([userId]);
}

function validVisibility_(v) {
  if (v !== 'public' && v !== 'private') fail_('VALIDATION', 'Pilih jenis grup: publik atau privat.');
  return v;
}

/* ---------- Daftar & buat ---------- */

function groupsList_(data, ctx) {
  var me = ctx.user.user_id;
  var my = myConvs_(me);
  var counts = {};
  dbWhere_('conversation_members', function (m) { return !m.left_at; })
    .forEach(function (m) { counts[m.conv_id] = (counts[m.conv_id] || 0) + 1; });
  var items = dbWhere_('conversations', function (c) {
    return c.type === 'group' && (c.visibility === 'public' || my[c.conv_id]);
  }).map(function (c) {
    return {
      conv_id: c.conv_id, name: c.name, description: c.description || '', photo_file_id: c.photo_file_id || '',
      visibility: c.visibility, is_official: bool_(c.is_official), member_count: counts[c.conv_id] || 0,
      my_role: my[c.conv_id] || '', last_message_at: c.last_message_at || ''
    };
  });
  items.sort(function (a, b) {
    if (a.is_official !== b.is_official) return a.is_official ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { items: items, canCreate: isStaff_(ctx.user, ROLES.MODERATOR), canOfficial: isStaff_(ctx.user, ROLES.ADMIN) };
}

function groupsCreate_(data, ctx) {
  var me = ctx.user.user_id;
  var name = requireField_(str_(data.name, APP.GROUP_NAME_MAX), 'Nama grup');
  var description = str_(data.description, APP.GROUP_DESC_MAX);
  var visibility = validVisibility_(data.visibility);
  var official = !!data.is_official;
  if (official && !isStaff_(ctx.user, ROLES.ADMIN)) fail_('FORBIDDEN', 'Hanya Admin yang bisa membuat grup resmi.');
  var memberIds = (data.memberIds || []).map(function (x) { return str_(x, 40); })
    .filter(function (x) { return x && x !== me; }).slice(0, APP.GROUP_MAX_ADD);

  return withLock_(function () {
    var dup = dbFindOne_('conversations', function (c) {
      return c.type === 'group' && String(c.name).toLowerCase() === name.toLowerCase();
    });
    if (dup) fail_('CONFLICT', 'Sudah ada grup dengan nama ini.');
    var convId = newId_('cnv');
    var conv = {
      conv_id: convId, type: 'group', name: name, description: description, photo_file_id: '',
      visibility: visibility, is_official: official, created_by: me, created_at: nowIso_(),
      last_message_at: '', last_message_preview: '', direct_key: ''
    };
    dbInsert_('conversations', conv);
    addMemberRow_(conv, me, 'owner');
    var added = [];
    memberIds.forEach(function (uid) {
      var b = loadUser_(uid);
      if (b && b.user.status === STATUS.APPROVED && addMemberRow_(conv, uid, 'member')) added.push(uid);
    });
    postSystem_(conv, me, firstName_(me) + ' membuat grup "' + name + '"');
    added.forEach(function (uid) {
      notify_(uid, 'group_added', firstName_(me) + ' menambahkan Anda ke grup ' + name, 'chat/' + convId, convId);
    });
    audit_(me, 'group.create', 'conversation', convId, { name: name, official: official });
    return { conv_id: convId };
  });
}

/* ---------- Gabung & keluar ---------- */

function groupsJoin_(data, ctx) {
  var me = ctx.user.user_id;
  return withLock_(function () {
    var conv = requireGroup_(str_(data.convId, 40));
    if (conv.visibility !== 'public') fail_('FORBIDDEN', 'Grup privat hanya bisa dimasuki lewat undangan admin grup.');
    if (addMemberRow_(conv, me, 'member')) postSystem_(conv, me, firstName_(me) + ' bergabung');
    return { conv_id: conv.conv_id };
  });
}

function groupsLeave_(data, ctx) {
  var me = ctx.user.user_id;
  return withLock_(function () {
    var conv = requireGroup_(str_(data.convId, 40));
    var role = requireMember_(conv.conv_id, me);
    if (role === 'owner') {
      fail_('CONFLICT', 'Pemilik grup tidak bisa keluar. Jadikan anggota lain pemilik terlebih dahulu.');
    }
    removeMemberRow_(conv, me);
    postSystem_(conv, me, firstName_(me) + ' keluar dari grup');
    return { ok: true };
  });
}

/* ---------- Kelola ---------- */

function groupsUpdate_(data, ctx) {
  return withLock_(function () {
    var conv = requireGroup_(str_(data.convId, 40));
    requireManage_(conv, ctx);
    var patch = {};
    var changes = [];
    if (data.name !== undefined) {
      var name = requireField_(str_(data.name, APP.GROUP_NAME_MAX), 'Nama grup');
      if (name !== conv.name) {
        var dup = dbFindOne_('conversations', function (c) {
          return c.type === 'group' && c.conv_id !== conv.conv_id && String(c.name).toLowerCase() === name.toLowerCase();
        });
        if (dup) fail_('CONFLICT', 'Sudah ada grup dengan nama ini.');
        patch.name = name; changes.push('mengubah nama grup menjadi "' + name + '"');
      }
    }
    if (data.description !== undefined) {
      var d = str_(data.description, APP.GROUP_DESC_MAX);
      if (d !== (conv.description || '')) { patch.description = d; changes.push('mengubah deskripsi grup'); }
    }
    if (data.visibility !== undefined) {
      var v = validVisibility_(data.visibility);
      if (v !== conv.visibility) { patch.visibility = v; changes.push('menjadikan grup ' + (v === 'public' ? 'publik' : 'privat')); }
    }
    if (!changes.length) return { ok: true };
    dbUpdate_('conversations', 'conv_id', conv.conv_id, patch);
    var fresh = requireConv_(conv.conv_id);
    postSystem_(fresh, ctx.user.user_id, firstName_(ctx.user.user_id) + ' ' + changes.join(', '));
    return { ok: true };
  });
}

function groupsSetPhoto_(data, ctx) {
  var conv = requireGroup_(str_(data.convId, 40));
  requireManage_(conv, ctx);
  var saved = storeImage_(data.dataUrl, 'group_' + conv.conv_id);
  var old = conv.photo_file_id;
  withLock_(function () {
    dbUpdate_('conversations', 'conv_id', conv.conv_id, { photo_file_id: saved.fileId });
    postSystem_(requireConv_(conv.conv_id), ctx.user.user_id, firstName_(ctx.user.user_id) + ' mengganti foto grup');
  });
  if (old) trashAvatar_(old);
  return { photo_file_id: saved.fileId, dataUrl: saved.dataUrl };
}

function groupsAddMembers_(data, ctx) {
  var me = ctx.user.user_id;
  var ids = (data.userIds || []).map(function (x) { return str_(x, 40); }).filter(Boolean).slice(0, APP.GROUP_MAX_ADD);
  if (!ids.length) fail_('VALIDATION', 'Pilih minimal satu anggota.');
  return withLock_(function () {
    var conv = requireGroup_(str_(data.convId, 40));
    requireManage_(conv, ctx);
    var added = [];
    ids.forEach(function (uid) {
      var b = loadUser_(uid);
      if (b && b.user.status === STATUS.APPROVED && addMemberRow_(conv, uid, 'member')) added.push(uid);
    });
    if (added.length) {
      var names = added.slice(0, 5).map(firstName_).join(', ') + (added.length > 5 ? ' dan ' + (added.length - 5) + ' lainnya' : '');
      postSystem_(conv, me, firstName_(me) + ' menambahkan ' + names);
      added.forEach(function (uid) {
        notify_(uid, 'group_added', firstName_(me) + ' menambahkan Anda ke grup ' + conv.name, 'chat/' + conv.conv_id, conv.conv_id);
      });
    }
    return { added: added.length };
  });
}

function groupsRemoveMember_(data, ctx) {
  var me = ctx.user.user_id;
  var target = str_(data.userId, 40);
  return withLock_(function () {
    var conv = requireGroup_(str_(data.convId, 40));
    var myRole = requireManage_(conv, ctx);
    if (target === me) fail_('VALIDATION', 'Gunakan tombol "Keluar dari grup".');
    var tRole = (activeMembers_(conv.conv_id).filter(function (m) { return m.user_id === target; })[0] || {}).member_role;
    if (!tRole) fail_('NOT_FOUND', 'Pengguna bukan anggota grup ini.');
    if (tRole === 'owner') fail_('FORBIDDEN', 'Pemilik grup tidak bisa dikeluarkan.');
    if (tRole === 'admin' && myRole !== 'owner' && !isStaff_(ctx.user, ROLES.ADMIN)) {
      fail_('FORBIDDEN', 'Hanya pemilik grup yang bisa mengeluarkan admin grup.');
    }
    removeMemberRow_(conv, target);
    postSystem_(conv, me, firstName_(me) + ' mengeluarkan ' + firstName_(target));
    notify_(target, 'group_removed', 'Anda dikeluarkan dari grup ' + conv.name, 'groups', conv.conv_id);
    return { ok: true };
  });
}

/** role: 'admin' | 'member' | 'owner' (owner = serahkan kepemilikan; hanya pemilik). */
function groupsSetMemberRole_(data, ctx) {
  var me = ctx.user.user_id;
  var target = str_(data.userId, 40);
  var role = data.role;
  if (['admin', 'member', 'owner'].indexOf(role) < 0) fail_('VALIDATION', 'Peran tidak dikenal.');
  return withLock_(function () {
    var conv = requireGroup_(str_(data.convId, 40));
    var myRole = myConvs_(me)[conv.conv_id] || '';
    if (myRole !== 'owner') fail_('FORBIDDEN', 'Hanya pemilik grup yang bisa mengatur admin grup.');
    var tRole = (activeMembers_(conv.conv_id).filter(function (m) { return m.user_id === target; })[0] || {}).member_role;
    if (!tRole) fail_('NOT_FOUND', 'Pengguna bukan anggota grup ini.');
    if (target === me) fail_('VALIDATION', 'Pilih anggota lain.');
    var setRole = function (uid, r) {
      dbUpdateWhere_('conversation_members',
        function (m) { return m.conv_id === conv.conv_id && m.user_id === uid && !m.left_at; },
        function () { return { member_role: r }; });
      uncacheMemberships_([uid]);
    };
    var text;
    if (role === 'owner') {
      setRole(target, 'owner'); setRole(me, 'admin');
      text = firstName_(me) + ' menyerahkan kepemilikan grup kepada ' + firstName_(target);
    } else {
      setRole(target, role);
      text = firstName_(me) + (role === 'admin' ? ' menjadikan ' + firstName_(target) + ' admin grup'
        : ' mencabut status admin grup ' + firstName_(target));
    }
    postSystem_(conv, me, text);
    if (role !== 'member') {
      notify_(target, 'group_admin', role === 'owner' ? 'Anda sekarang pemilik grup ' + conv.name
        : 'Anda sekarang admin grup ' + conv.name, 'chat/' + conv.conv_id, conv.conv_id);
    }
    return { ok: true };
  });
}
