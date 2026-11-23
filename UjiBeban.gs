/**
 * UjiBeban.gs — alat bantu uji beban (jalankan dari editor Apps Script oleh pemilik script).
 *
 *  buatAkunUji(20)   → membuat akun uji01…uji20 (status Approved) dengan SATU password bersama,
 *                      plus grup "Uji Beban" berisi semua akun uji. Password dicetak di Execution log.
 *  nonaktifkanAkunUji() → men-suspend semua akun uji setelah pengujian selesai.
 *
 * Akun uji memakai email ujiNN@yapp.test (tidak menerima email) dan angkatan tahun ini.
 */

function buatAkunUji(jumlah) {
  jumlah = Math.min(50, Math.max(1, parseInt(jumlah, 10) || 20));
  var admin = dbFindOne_('users', function (u) { return u.role === ROLES.SUPER_ADMIN; });
  if (!admin) throw new Error('Jalankan setup() dulu.');
  var password = 'Uji-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6) + '9';
  var hash = hashPassword_(password);       // satu hash dipakai bersama agar cepat
  var year = String(new Date().getFullYear());
  var ids = [];
  withLock_(function () {
    for (var i = 1; i <= jumlah; i++) {
      var uname = 'uji' + (i < 10 ? '0' : '') + i;
      var existing = dbGet_('users', 'username', uname);
      var now = nowIso_();
      if (existing) {
        dbUpdate_('users', 'user_id', existing.user_id, { password_hash: hash, status: STATUS.APPROVED, failed_logins: 0, locked_until: '' });
        ids.push(existing.user_id);
        continue;
      }
      var id = newId_('usr');
      dbInsert_('users', {
        user_id: id, email: uname + '@yapp.test', username: uname, password_hash: hash, role: ROLES.MEMBER,
        status: STATUS.APPROVED, status_reason: '', status_changed_by: admin.user_id, status_changed_at: now,
        failed_logins: 0, locked_until: '', created_at: now, approved_at: now
      });
      dbInsert_('profiles', {
        user_id: id, full_name: 'Penguji ' + (i < 10 ? '0' : '') + i, nim: 'UJI' + (1000 + i), angkatan: year, kelas: 'UJI',
        jabatan: 'Akun uji', bio: '', phone: '', privacy_json: JSON.stringify(DEFAULT_PRIVACY), notif_json: '{}',
        theme: 'system', updated_at: now
      });
      ids.push(id);
    }
  });
  ids.forEach(uncacheUser_);

  // Grup "Uji Beban" berisi semua akun uji + Super Admin
  var group = dbFindOne_('conversations', function (c) { return c.type === 'group' && c.name === 'Uji Beban'; });
  withLock_(function () {
    if (!group) {
      group = {
        conv_id: newId_('cnv'), type: 'group', name: 'Uji Beban', description: 'Grup sementara untuk uji 20 orang chat bersamaan.',
        photo_file_id: '', visibility: 'private', is_official: true, created_by: admin.user_id, created_at: nowIso_(),
        last_message_at: '', last_message_preview: '', direct_key: ''
      };
      dbInsert_('conversations', group);
      addMemberRow_(group, admin.user_id, 'owner');
    }
    ids.forEach(function (id) { addMemberRow_(group, id, 'member'); });
  });
  bumpConv_(group.conv_id);
  bumpInbox_(ids.concat([admin.user_id]));
  Logger.log(jumlah + ' akun uji siap: uji01 … uji' + (jumlah < 10 ? '0' : '') + jumlah);
  Logger.log('PASSWORD BERSAMA AKUN UJI: ' + password);
  Logger.log('Grup "Uji Beban" sudah berisi semua akun uji.');
  return { users: jumlah, password: password, group: group.conv_id };
}

function nonaktifkanAkunUji() {
  var n = 0;
  dbWhere_('users', function (u) { return /^uji\d{2}$/.test(String(u.username)) && u.status === STATUS.APPROVED; })
    .forEach(function (u) {
      dbUpdate_('users', 'user_id', u.user_id, { status: STATUS.SUSPENDED, status_reason: 'Akun uji beban', status_changed_at: nowIso_() });
      revokeAllSessions_(u.user_id);
      uncacheUser_(u.user_id);
      n++;
    });
  Logger.log(n + ' akun uji dinonaktifkan. Grup "Uji Beban" bisa dihapus anggotanya lewat Info grup bila perlu.');
  return n;
}
