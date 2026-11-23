/**
 * Setup.gs — dijalankan SEKALI dari editor Apps Script oleh pemilik script.
 *
 * Langkah:
 *  1. Isi SETUP_ADMIN di bawah (minimal email).
 *  2. Pilih fungsi setup lalu klik Run. Izinkan akses yang diminta.
 *  3. Buka "Execution log": salin password sementara Super Admin.
 *  4. Pilih fungsi installTriggers lalu Run (backup & pembersihan harian).
 *
 * setup() aman dijalankan ulang: hanya membuat yang belum ada dan menambah kolom yang kurang.
 */

var SETUP_ADMIN = {
  email: '',                 // WAJIB diisi, mis. 'pengurus.edc@gmail.com'
  username: 'superadmin',
  full_name: 'Super Admin',
  angkatan: String(new Date().getFullYear()),
  kelas: '-'
};

function setup() {
  var props = PropertiesService.getScriptProperties();

  if (!props.getProperty('PEPPER')) {
    props.setProperty('PEPPER', randomToken_() + randomToken_());
    Logger.log('PEPPER dibuat. JANGAN dihapus: tanpa ini semua password tidak bisa diverifikasi.');
  }

  var root = ensureFolder_('ROOT_FOLDER_ID', APP.NAME + ' - Data Aplikasi', null);
  ensureFolder_('AVATAR_FOLDER_ID', 'avatars', root);
  ensureFolder_('UPLOAD_FOLDER_ID', 'uploads', root);
  ensureFolder_('BACKUP_FOLDER_ID', 'backups', root);

  ensureDatabase_('main', 'DB_MAIN_ID', APP.SHORT_NAME + ' - DB Utama', root);
  ensureDatabase_('msg', 'DB_MSG_ID', APP.SHORT_NAME + ' - DB Pesan', root);
  dbInvalidate_();

  seedCategories_();
  seedSettings_();
  ensureSuperAdmin_();

  Logger.log('Setup selesai. Folder data: ' + root.getUrl());
  Logger.log('Langkah berikutnya: jalankan installTriggers(), lalu Deploy > New deployment > Web app.');
}

function ensureFolder_(propKey, name, parent) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(propKey);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* terhapus: buat lagi */ }
  }
  var folder = parent ? parent.createFolder(name) : DriveApp.createFolder(name);
  props.setProperty(propKey, folder.getId());
  return folder;
}

function ensureDatabase_(db, propKey, name, folder) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(propKey);
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(name);
    props.setProperty(propKey, ss.getId());
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    Logger.log('Spreadsheet dibuat: ' + name + ' -> ' + ss.getUrl());
  }
  ss.setSpreadsheetTimeZone(APP.TIMEZONE);

  var tables = SCHEMA[db];
  Object.keys(tables).forEach(function (table) {
    var cols = tables[table];
    var sh = ss.getSheetByName(table) || ss.insertSheet(table);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    } else {
      var existing = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
      var missing = cols.filter(function (c) { return existing.indexOf(c) < 0; });
      if (missing.length) {
        sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
        Logger.log('Kolom ditambahkan ke ' + table + ': ' + missing.join(', '));
      }
    }
    var width = sh.getLastColumn();
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#DBEAFE');
    sh.setFrozenRows(1);
  });

  // Hapus sheet bawaan yang kosong (mis. "Sheet1" / "Lembar1").
  ss.getSheets().forEach(function (sh) {
    if (!tables[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function seedCategories_() {
  if (dbAll_('categories').length) return;
  var names = ['Grammar', 'Speaking', 'Listening', 'Writing', 'Literature', 'General'];
  ['forum', 'resource'].forEach(function (scope) {
    names.forEach(function (n, i) {
      dbInsert_('categories', { cat_id: newId_('cat'), scope: scope, name: n, sort_order: i + 1 });
    });
  });
}

function seedSettings_() {
  var defaults = SETTING_DEFAULTS;
  var existing = {};
  dbAll_('settings').forEach(function (s) { existing[s.key] = true; });
  Object.keys(defaults).forEach(function (k) {
    if (!existing[k]) dbInsert_('settings', { key: k, value: defaults[k] });
  });
}

function tempPassword_() {
  return 'Yapp-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10) + '7';
}

function ensureSuperAdmin_() {
  var exists = dbFindOne_('users', function (u) { return u.role === ROLES.SUPER_ADMIN; });
  if (exists) {
    Logger.log('Super Admin sudah ada: ' + exists.email);
    return;
  }
  var email = String(SETUP_ADMIN.email || '').trim().toLowerCase();
  if (!isEmail_(email)) {
    throw new Error('Isi SETUP_ADMIN.email di Setup.gs dengan email yang valid, lalu jalankan setup() lagi.');
  }
  var password = tempPassword_();
  var now = nowIso_();
  var userId = newId_('usr');
  dbInsert_('users', {
    user_id: userId, email: email, username: SETUP_ADMIN.username, password_hash: hashPassword_(password),
    role: ROLES.SUPER_ADMIN, status: STATUS.APPROVED, status_reason: '', status_changed_by: 'setup',
    status_changed_at: now, failed_logins: 0, locked_until: '', created_at: now, approved_at: now
  });
  dbInsert_('profiles', {
    user_id: userId, full_name: SETUP_ADMIN.full_name, nim: '', angkatan: SETUP_ADMIN.angkatan,
    kelas: SETUP_ADMIN.kelas, jabatan: 'Super Admin', bio: '', phone: '',
    privacy_json: JSON.stringify(DEFAULT_PRIVACY), notif_json: '{}', theme: 'system', updated_at: now
  });
  Logger.log('Super Admin dibuat. Login: ' + email + ' / username: ' + SETUP_ADMIN.username);
  Logger.log('PASSWORD SEMENTARA: ' + password + '  (segera ganti di menu Pengaturan)');
}

/** Darurat: buat password sementara baru untuk Super Admin pertama (jalankan dari editor). */
function resetSuperAdminPassword() {
  var admin = dbFindOne_('users', function (u) { return u.role === ROLES.SUPER_ADMIN; });
  if (!admin) throw new Error('Belum ada Super Admin. Jalankan setup().');
  var password = tempPassword_();
  dbUpdate_('users', 'user_id', admin.user_id, {
    password_hash: hashPassword_(password), failed_logins: 0, locked_until: '', status: STATUS.APPROVED
  });
  uncacheUser_(admin.user_id);
  revokeAllSessions_(admin.user_id);
  Logger.log('Password sementara baru untuk ' + admin.email + ': ' + password);
}

/** Ukur waktu hash untuk menyetel APP.HASH_ITERATIONS (target: di bawah ~700 ms). */
function testHashSpeed() {
  var t = Date.now();
  hashPassword_('Contoh-password-123');
  Logger.log(APP.HASH_ITERATIONS + ' iterasi = ' + (Date.now() - t) + ' ms');
}

/* ---------- Trigger harian ---------- */

function installTriggers() {
  var names = ['dailyMaintenance', 'backupDatabases', 'hourlyJobs'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('backupDatabases').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('hourlyJobs').timeBased().everyHours(1).create();
  Logger.log('Trigger terpasang: dailyMaintenance (02.00), backupDatabases (03.00), hourlyJobs (tiap jam).');
}

/** Tiap jam: kirim notifikasi pengumuman terjadwal & pengingat agenda. */
function hourlyJobs() {
  var a = publishScheduledAnnouncements_();
  var e = sendEventReminders_();
  Logger.log('Pengumuman terjadwal dikirim: ' + a + ', pengingat agenda: ' + e);
}

/** Bersihkan sesi kedaluwarsa, token reset lama, dan notifikasi > 90 hari. */
function dailyMaintenance() {
  var now = Date.now();
  var day = 86400000;
  var s = dbPrune_('sessions', function (r) {
    if (r.revoked_at) return now - toMs_(r.revoked_at) < day;
    return toMs_(r.expires_at) > now;
  });
  var p = dbPrune_('password_resets', function (r) { return toMs_(r.expires_at) > now - day; });
  var n = dbPrune_('notifications', function (r) { return toMs_(r.created_at) > now - 90 * day; });
  var u = cleanupPendingUploads_();
  Logger.log('Dibersihkan: ' + s + ' sesi, ' + p + ' token reset, ' + n + ' notifikasi, ' + u + ' unggahan tak terkirim.');
}

/** Salin kedua spreadsheet ke folder backup, simpan APP.BACKUP_KEEP salinan terakhir per DB. */
function backupDatabases() {
  var props = PropertiesService.getScriptProperties();
  var folder = DriveApp.getFolderById(props.getProperty('BACKUP_FOLDER_ID'));
  var stamp = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd_HHmm');
  var made = [];
  [['DB_MAIN_ID', 'backup_main_'], ['DB_MSG_ID', 'backup_msg_']].forEach(function (pair) {
    var id = props.getProperty(pair[0]);
    if (!id) return;
    var name = pair[1] + stamp;
    DriveApp.getFileById(id).makeCopy(name, folder);
    made.push(name);

    var copies = [];
    var it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getName().indexOf(pair[1]) === 0) copies.push(f);
    }
    copies.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    copies.slice(APP.BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });
  });
  Logger.log('Backup: ' + made.join(', '));
  return made;
}
