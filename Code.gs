/**
 * Code.gs — titik masuk web app.
 *  - doGet(): memuat satu halaman SPA.
 *  - api(): SATU-SATUNYA pintu untuk semua aksi dari browser (lewat google.script.run).
 *    Setiap aksi melewati pemeriksaan sesi, status akun, dan role.
 */

var ROUTES = {
  'app.config': appConfig_,
  'app.ping': appPing_,

  'auth.register': authRegister_,
  'auth.login': authLogin_,
  'auth.me': authMe_,
  'auth.logout': authLogout_,
  'auth.logoutAll': authLogoutAll_,
  'auth.changePassword': authChangePassword_,
  'auth.forgot': authForgot_,
  'auth.reset': authReset_,

  'dashboard.summary': dashboardSummary_,

  'members.list': membersList_,
  'members.get': membersGet_,
  'profile.update': profileUpdate_,
  'profile.uploadPhoto': profileUploadPhoto_,
  'profile.removePhoto': profileRemovePhoto_,
  'files.avatars': filesAvatars_,

  'admin.pending': adminPending_,
  'admin.decide': adminDecide_,
  'admin.users': adminUsers_,
  'admin.setStatus': adminSetStatus_,
  'admin.setRole': adminSetRole_,
  'admin.updateProfile': adminUpdateProfile_,
  'admin.logs': adminLogs_,
  'admin.backupNow': adminBackupNow_,

  // Tahap 2
  'chat.sync': chatSync_,
  'chat.open': chatOpen_,
  'chat.history': chatHistory_,
  'chat.send': chatSend_,
  'chat.deleteMessage': chatDeleteMessage_,
  'chat.openDirect': chatOpenDirect_,
  'chat.search': chatSearch_,
  'groups.list': groupsList_,
  'groups.create': groupsCreate_,
  'groups.join': groupsJoin_,
  'groups.leave': groupsLeave_,
  'groups.update': groupsUpdate_,
  'groups.setPhoto': groupsSetPhoto_,
  'groups.addMembers': groupsAddMembers_,
  'groups.removeMember': groupsRemoveMember_,
  'groups.setMemberRole': groupsSetMemberRole_,
  'files.upload': filesUpload_,
  'files.thumbs': filesThumbs_,
  'files.get': filesGet_,
  'notifications.list': notificationsList_,
  'notifications.markRead': notificationsMarkRead_,

  // Tahap 3
  'forum.categories': forumCategoriesList_,
  'forum.list': forumList_,
  'forum.get': forumGet_,
  'forum.create': forumCreate_,
  'forum.update': forumUpdate_,
  'forum.delete': forumDelete_,
  'forum.reply': forumReply_,
  'forum.deleteComment': forumDeleteComment_,
  'forum.react': forumReact_,
  'forum.moderate': forumModerate_,
  'resources.list': resourcesList_,
  'resources.create': resourcesCreate_,
  'resources.open': resourcesOpen_,
  'resources.delete': resourcesDelete_,
  'resources.review': resourcesReview_,
  'announcements.list': announcementsList_,
  'announcements.save': announcementsSave_,
  'announcements.delete': announcementsDelete_,
  'events.list': eventsList_,
  'events.get': eventsGet_,
  'events.save': eventsSave_,
  'events.delete': eventsDelete_,
  'events.register': eventsRegister_,
  'events.cancel': eventsCancel_,
  'events.attendance': eventsAttendance_,

  // Tahap 4
  'search.all': searchAll_,
  'reports.create': reportsCreate_,
  'moderation.list': moderationList_,
  'moderation.resolve': moderationResolve_,
  'chat.mute': chatMute_,
  'admin.metrics': adminMetrics_,
  'settings.update': settingsUpdate_
};

function doGet(e) {
  var params = (e && e.parameter) || {};
  var boot = {
    appName: APP.NAME,
    shortName: APP.SHORT_NAME,
    tagline: APP.TAGLINE,
    sync: { open: APP.SYNC_OPEN_MS, other: APP.SYNC_OTHER_MS, idle: APP.SYNC_IDLE_MS },
    page: params.page === 'reset' ? 'reset' : '',
    resetToken: params.page === 'reset' ? str_(params.token, 128) : ''
  };
  try {
    var s = publicSettings_();
    boot.registrationOpen = s.registration_open;
    boot.infoBanner = s.info_banner;
  } catch (e) {
    boot.registrationOpen = true;   // sebelum setup() dijalankan
    boot.infoBanner = '';
  }
  var t = HtmlService.createTemplateFromFile('index');
  // JSON aman untuk disisipkan di <script>: karakter < diganti agar tidak bisa menutup tag.
  t.bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
  var out = t.evaluate()
    .setTitle(APP.NAME + ' \u2014 ' + APP.TAGLINE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  if (APP.FAVICON_URL) out.setFaviconUrl(APP.FAVICON_URL);
  return out;
}

/** Dipakai di index.html: <?!= include('styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Router utama. Selalu mengembalikan { ok: true, data } atau { ok: false, error: { code, message } }.
 */
function api(action, token, data) {
  var t0 = Date.now();
  var res = apiInner_(action, token, data);
  if (action !== 'admin.metrics') recordMetric_(String(action), Date.now() - t0, res.ok ? '' : res.error.code);
  return res;
}

function apiInner_(action, token, data) {
  try {
    action = String(action || '');
    var handler = ROUTES[action];
    var perm = PERMISSIONS[action];
    if (!handler || !perm) fail_('NOT_FOUND', 'Aksi tidak dikenal.');
    data = (data && typeof data === 'object') ? data : {};

    var ctx = {};
    if (perm !== 'public') {
      ctx = requireUser_(token);
      checkPermission_(action, ctx.user);
      markOnline_(ctx.user.user_id);
    }
    var result = handler(data, ctx);
    return { ok: true, data: result === undefined ? null : result };
  } catch (err) {
    if (err instanceof AppError || (err && err.name === 'AppError')) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    console.error('api(' + action + ') gagal: ' + (err && err.stack ? err.stack : err));
    return {
      ok: false,
      error: { code: 'SERVER', message: 'Terjadi kesalahan di server. Silakan coba lagi.' }
    };
  }
}
