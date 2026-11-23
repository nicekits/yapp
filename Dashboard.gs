/**
 * Dashboard.gs — ringkasan dashboard, heartbeat (ping), dan konfigurasi publik.
 */

function appConfig_() {
  var s = publicSettings_();
  return { name: APP.NAME, shortName: APP.SHORT_NAME, tagline: APP.TAGLINE, passwordMinLength: APP.PASSWORD_MIN_LENGTH,
    registrationOpen: s.registration_open, infoBanner: s.info_banner, resourceNeedsApproval: getSetting_('resource_needs_approval') };
}

function onlineList_(viewer, limit) {
  var members = approvedMembers_();
  var online = onlineMap_(members.map(function (m) { return m.user.user_id; }));
  var list = members.filter(function (m) { return online[m.user.user_id]; })
    .map(function (m) { return memberCard_(m.user, m.profile, viewer, true); });
  list.sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });
  return { total: list.length, items: list.slice(0, limit || 30), membersTotal: members.length };
}

/**
 * Heartbeat tiap 60 detik dari klien. Penanda online sudah dicatat di router api(),
 * di sini cukup mengembalikan data panel kanan.
 */
function appPing_(data, ctx) {
  var out = { online: onlineList_(ctx.user, 30) };
  if (isStaff_(ctx.user, ROLES.ADMIN)) {
    out.pendingCount = dbWhere_('users', function (u) { return u.status === STATUS.PENDING; }).length;
  }
  return out;
}

function dashboardSummary_(data, ctx) {
  var members = approvedMembers_();
  var online = onlineList_(ctx.user, 30);

  var newest = members.slice().sort(function (a, b) {
    return toMs_(b.user.approved_at || b.user.created_at) - toMs_(a.user.approved_at || a.user.created_at);
  }).slice(0, 5).map(function (m) {
    var c = memberCard_(m.user, m.profile, ctx.user, false);
    c.joined_at = m.user.approved_at || m.user.created_at;
    return c;
  });

  var byAngkatan = {};
  members.forEach(function (m) {
    var a = m.profile.angkatan ? String(m.profile.angkatan) : 'Lainnya';
    byAngkatan[a] = (byAngkatan[a] || 0) + 1;
  });

  var out = {
    greetingName: ctx.profile.full_name || ctx.user.username,
    stats: {
      members: members.length,
      online: online.total,
      angkatan: Object.keys(byAngkatan).length
    },
    byAngkatan: Object.keys(byAngkatan).sort().map(function (k) { return { angkatan: k, count: byAngkatan[k] }; }),
    newestMembers: newest,
    online: online.items,
    announcements: [],
    events: [],
    recentActivity: []
  };
  out.info_banner = getSetting_('info_banner');
  var anns = visibleAnnouncements_(ctx.user, ctx.profile).map(annDto_);
  out.urgent = anns.filter(function (a) { return a.priority === 'mendesak'; }).slice(0, 2);
  out.announcements = anns.slice(0, 3);
  out.events = eventsList_({ scope: 'upcoming' }, ctx).items.slice(0, 3);
  out.recentActivity = forumList_({ page: 1 }, ctx).items
    .sort(function (a, b) { return toMs_(b.last_activity_at) - toMs_(a.last_activity_at); }).slice(0, 5);
  var inbox = inboxSummary_(ctx.user.user_id);
  out.stats.unread = inbox.unreadTotal;
  out.recentConversations = inbox.items.filter(function (c) { return c.last_message_at; }).slice(0, 5);
  if (isStaff_(ctx.user, ROLES.ADMIN)) {
    out.stats.pending = dbWhere_('users', function (u) { return u.status === STATUS.PENDING; }).length;
  }
  return out;
}
