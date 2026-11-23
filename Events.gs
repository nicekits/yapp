/**
 * Events.gs — agenda kegiatan: dibuat Admin, anggota mendaftar, Admin mengonfirmasi kehadiran.
 * Status peserta: registered | cancelled | attended. quota 0 = tanpa batas.
 * Pengingat dikirim hourlyJobs() sekitar APP.EVENT_REMINDER_HOURS jam sebelum mulai.
 */

function requireEvent_(eventId) {
  var e = dbGet_('events', 'event_id', eventId);
  if (!e || e.deleted_at) fail_('NOT_FOUND', 'Agenda tidak ditemukan.');
  return e;
}

function participantsOf_(eventId) {
  return dbWhere_('event_participants', function (p) { return p.event_id === eventId && p.status !== 'cancelled'; });
}

function eventDto_(e, me, takenMap, myMap) {
  var now = Date.now(), quota = Number(e.quota) || 0, taken = takenMap[e.event_id] || 0;
  var started = toMs_(e.start_at) <= now;
  var closed = started || (e.reg_deadline && toMs_(e.reg_deadline) < now) || (quota > 0 && taken >= quota);
  return {
    event_id: e.event_id, title: e.title, description: e.description || '', location: e.location || '',
    start_at: e.start_at, end_at: e.end_at || '', reg_deadline: e.reg_deadline || '', quota: quota,
    taken: taken, my_status: myMap[e.event_id] || '', registration_open: !closed,
    is_past: toMs_(e.end_at || e.start_at) < now, started: started, created_by: authorCard_(e.created_by)
  };
}

function eventMaps_(me) {
  var taken = {}, mine = {};
  dbAll_('event_participants').forEach(function (p) {
    if (p.status !== 'cancelled') taken[p.event_id] = (taken[p.event_id] || 0) + 1;
    if (String(p.user_id) === String(me)) mine[p.event_id] = p.status;
  });
  return { taken: taken, mine: mine };
}

function eventsList_(data, ctx) {
  var me = ctx.user.user_id, scope = data.scope || 'upcoming', now = Date.now();
  var maps = eventMaps_(me);
  var rows = dbWhere_('events', function (e) {
    if (e.deleted_at) return false;
    var end = toMs_(e.end_at || e.start_at);
    if (scope === 'past') return end < now;
    if (scope === 'mine') return maps.mine[e.event_id] && maps.mine[e.event_id] !== 'cancelled';
    return end >= now;
  }).sort(function (a, b) {
    var d = toMs_(a.start_at) - toMs_(b.start_at);
    return scope === 'past' ? -d : d;
  });
  return { items: rows.map(function (e) { return eventDto_(e, me, maps.taken, maps.mine); }), canManage: isStaff_(ctx.user, ROLES.ADMIN) };
}

function eventsGet_(data, ctx) {
  var e = requireEvent_(str_(data.eventId, 40));
  var maps = eventMaps_(ctx.user.user_id);
  var dto = eventDto_(e, ctx.user.user_id, maps.taken, maps.mine);
  dto.participants = participantsOf_(e.event_id).map(function (p) {
    var a = authorCard_(p.user_id);
    a.status = p.status; a.registered_at = p.registered_at;
    return a;
  }).sort(function (a, b) { return toMs_(a.registered_at) - toMs_(b.registered_at); });
  dto.can_manage = isStaff_(ctx.user, ROLES.ADMIN);
  return dto;
}

function eventsSave_(data, ctx) {
  var title = str_(data.title, 150);
  if (title.length < 3) fail_('VALIDATION', 'Judul agenda minimal 3 karakter.');
  var description = String(data.description || '').replace(/\r/g, '').trim().slice(0, 3000);
  var location = str_(data.location, 200);
  if (!location) fail_('VALIDATION', 'Lokasi wajib diisi (boleh berupa tautan Zoom/Meet).');
  var start = parseLocalTime_(data.start_at, 'Waktu mulai', true);
  var end = parseLocalTime_(data.end_at, 'Waktu selesai', false);
  var deadline = parseLocalTime_(data.reg_deadline, 'Batas pendaftaran', false);
  if (end && toMs_(end) <= toMs_(start)) fail_('VALIDATION', 'Waktu selesai harus setelah waktu mulai.');
  if (deadline && toMs_(deadline) > toMs_(start)) fail_('VALIDATION', 'Batas pendaftaran harus sebelum acara dimulai.');
  var quota = parseInt(data.quota, 10) || 0;
  if (quota < 0 || quota > 10000) fail_('VALIDATION', 'Kuota tidak valid.');
  var fields = { title: title, description: description, location: location, start_at: start, end_at: end,
    reg_deadline: deadline, quota: quota, updated_at: nowIso_() };

  var eventId = str_(data.eventId, 40);
  if (eventId) {
    var old = requireEvent_(eventId);
    var moved = toMs_(old.start_at) !== toMs_(start) || String(old.location) !== location;
    if (toMs_(old.start_at) !== toMs_(start)) fields.reminder_sent = false;
    dbUpdate_('events', 'event_id', eventId, fields);
    if (moved) {
      notifyMany_(participantsOf_(eventId).map(function (p) { return p.user_id; }), 'event',
        'Agenda diperbarui: ' + title + ' — cek waktu & lokasi terbaru', 'events/' + eventId, eventId);
    }
    return { event_id: eventId, message: 'Agenda diperbarui.' };
  }
  eventId = newId_('evt');
  fields.event_id = eventId; fields.created_by = ctx.user.user_id; fields.created_at = nowIso_();
  fields.deleted_at = ''; fields.reminder_sent = false;
  dbInsert_('events', fields);
  audit_(ctx.user.user_id, 'event.create', 'event', eventId, { title: title });
  var when = fmtWhen_(start);
  var n = notifyMany_(approvedMembers_().map(function (m) { return m.user.user_id; })
    .filter(function (id) { return id !== ctx.user.user_id; }), 'event', 'Agenda baru: ' + title + ' (' + when + ')', 'events/' + eventId, eventId);
  return { event_id: eventId, message: 'Agenda dibuat dan diumumkan ke ' + n + ' anggota.' };
}

function eventsDelete_(data, ctx) {
  var e = requireEvent_(str_(data.eventId, 40));
  dbUpdate_('events', 'event_id', e.event_id, { deleted_at: nowIso_() });
  audit_(ctx.user.user_id, 'event.delete', 'event', e.event_id, { title: e.title });
  if (toMs_(e.start_at) > Date.now()) {
    notifyMany_(participantsOf_(e.event_id).map(function (p) { return p.user_id; }), 'event',
      'Agenda dibatalkan: ' + e.title, 'events', e.event_id);
  }
  return { ok: true };
}

function eventsRegister_(data, ctx) {
  var me = ctx.user.user_id;
  return withLock_(function () {
    var e = requireEvent_(str_(data.eventId, 40));
    var now = Date.now();
    if (toMs_(e.start_at) <= now) fail_('CONFLICT', 'Acara sudah dimulai.');
    if (e.reg_deadline && toMs_(e.reg_deadline) < now) fail_('CONFLICT', 'Pendaftaran sudah ditutup.');
    var list = participantsOf_(e.event_id);
    if (list.some(function (p) { return String(p.user_id) === String(me); })) return { status: 'registered' };
    var quota = Number(e.quota) || 0;
    if (quota > 0 && list.length >= quota) fail_('CONFLICT', 'Kuota peserta sudah penuh.');
    var mine = function (p) { return p.event_id === e.event_id && String(p.user_id) === String(me); };
    if (dbFindOne_('event_participants', mine)) {
      dbUpdateWhere_('event_participants', mine, function () { return { status: 'registered', registered_at: nowIso_() }; });
    } else {
      dbInsert_('event_participants', { event_id: e.event_id, user_id: me, status: 'registered', registered_at: nowIso_() });
    }
    return { status: 'registered' };
  });
}

function eventsCancel_(data, ctx) {
  var me = ctx.user.user_id;
  var e = requireEvent_(str_(data.eventId, 40));
  if (toMs_(e.start_at) <= Date.now()) fail_('CONFLICT', 'Acara sudah dimulai; pendaftaran tidak bisa dibatalkan.');
  var n = dbUpdateWhere_('event_participants',
    function (p) { return p.event_id === e.event_id && String(p.user_id) === String(me) && p.status === 'registered'; },
    function () { return { status: 'cancelled' }; });
  if (!n) fail_('NOT_FOUND', 'Anda belum terdaftar di agenda ini.');
  return { status: 'cancelled' };
}

function eventsAttendance_(data, ctx) {
  var e = requireEvent_(str_(data.eventId, 40));
  var userId = str_(data.userId, 40);
  var n = dbUpdateWhere_('event_participants',
    function (p) { return p.event_id === e.event_id && p.user_id === userId && p.status !== 'cancelled'; },
    function () { return { status: data.attended ? 'attended' : 'registered' }; });
  if (!n) fail_('NOT_FOUND', 'Peserta tidak ditemukan.');
  return { ok: true };
}

/** Dipanggil hourlyJobs(): pengingat untuk peserta acara yang mulai dalam ±24 jam. */
function sendEventReminders_() {
  var now = Date.now(), window = APP.EVENT_REMINDER_HOURS * 3600000;
  var due = dbWhere_('events', function (e) {
    var s = toMs_(e.start_at);
    return !e.deleted_at && !bool_(e.reminder_sent) && s > now && s - now <= window;
  });
  due.forEach(function (e) {
    dbUpdate_('events', 'event_id', e.event_id, { reminder_sent: true });
    var when = fmtWhen_(e.start_at);
    notifyMany_(participantsOf_(e.event_id).map(function (p) { return p.user_id; }), 'event_reminder',
      'Pengingat: ' + e.title + ' — ' + when + ' di ' + e.location, 'events/' + e.event_id, e.event_id);
  });
  return due.length;
}
