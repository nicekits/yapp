/**
 * Settings.gs — pengaturan aplikasi yang bisa diubah Super Admin dari Admin Panel → Sistem
 * (disimpan di sheet "settings", di-cache 10 menit).
 */

var SETTING_DEFAULTS = {
  registration_open: true,            // pendaftaran anggota baru dibuka
  resource_needs_approval: true,      // materi dari Member perlu persetujuan Moderator
  info_banner: ''                     // banner informasi untuk semua (mis. jadwal pemeliharaan)
};

function allSettings_() {
  var cached = cacheGetJson_('settings');
  if (cached) return cached;
  var out = {};
  Object.keys(SETTING_DEFAULTS).forEach(function (k) { out[k] = SETTING_DEFAULTS[k]; });
  dbAll_('settings').forEach(function (r) {
    if (!(r.key in SETTING_DEFAULTS)) return;
    var def = SETTING_DEFAULTS[r.key];
    out[r.key] = typeof def === 'boolean' ? bool_(r.value) : String(r.value === null || r.value === undefined ? '' : r.value);
  });
  cachePutJson_('settings', out, 600);
  return out;
}

function getSetting_(key) {
  return allSettings_()[key];
}

function settingsUpdate_(data, ctx) {
  var patch = {};
  Object.keys(SETTING_DEFAULTS).forEach(function (k) {
    if (data[k] === undefined) return;
    patch[k] = typeof SETTING_DEFAULTS[k] === 'boolean' ? !!data[k] : str_(data[k], 300);
  });
  withLock_(function () {
    Object.keys(patch).forEach(function (k) {
      var exists = dbGet_('settings', 'key', k);
      if (exists) dbUpdate_('settings', 'key', k, { value: patch[k] });
      else dbInsert_('settings', { key: k, value: patch[k] });
    });
  });
  cache_().remove('settings');
  audit_(ctx.user.user_id, 'settings.update', 'system', '', patch);
  return allSettings_();
}

/** Pengaturan yang aman diketahui publik (halaman login). */
function publicSettings_() {
  var s = allSettings_();
  return { registration_open: s.registration_open, info_banner: s.info_banner };
}
