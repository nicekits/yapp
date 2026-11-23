/**
 * Files.gs — lampiran chat. File disimpan di folder Drive privat "uploads" dan
 * hanya bisa diambil lewat api() oleh anggota percakapan terkait.
 *
 * Alur: files.upload (status 'pending') → chat.send menautkannya ke pesan.
 * Lampiran 'pending' yang tidak terkirim dibersihkan dailyMaintenance() setelah 1 hari.
 */

function uploadFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID');
  if (!id) fail_('SETUP', 'Folder uploads belum dibuat. Jalankan setup().');
  return DriveApp.getFolderById(id);
}

/** Periksa isi file sesuai jenisnya (bukan hanya nama file). */
function sniffMatches_(bytes, ext) {
  var b = function (i) { return bytes[i] < 0 ? bytes[i] + 256 : bytes[i]; };
  var kind = APP.FILE_TYPES[ext].kind;
  if (kind === 'image') return sniffImageMime_(bytes) === APP.FILE_TYPES[ext].mime;
  if (kind === 'pdf') return bytes.length > 4 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46; // %PDF
  if (kind === 'office') return bytes.length > 4 && b(0) === 0x50 && b(1) === 0x4B && b(2) === 0x03 && b(3) === 0x04; // ZIP
  return false;
}

/**
 * data.scope: 'conv' (lampiran chat, wajib convId) | 'forum' (topik/balasan) | 'resource' (materi).
 * Lampiran forum/materi disimpan dengan conv_id kosong, sehingga tidak bisa dipakai di chat (dan sebaliknya).
 */
function filesUpload_(data, ctx) {
  var me = ctx.user.user_id;
  var scope = data.scope || 'conv';
  if (['conv', 'forum', 'resource'].indexOf(scope) < 0) fail_('VALIDATION', 'Tujuan unggahan tidak dikenal.');
  var convId = '';
  if (scope === 'conv') {
    convId = str_(data.convId, 40);
    requireMember_(convId, me);
  }
  var name = str_(data.name, 120).replace(/[\\\/:*?"<>|]/g, '_');
  var ext = (name.split('.').pop() || '').toLowerCase();
  var type = APP.FILE_TYPES[ext];
  if (!type || name.indexOf('.') < 0) {
    fail_('VALIDATION', 'Jenis file tidak diizinkan. Gunakan JPG, PNG, WEBP, PDF, DOCX, PPTX, atau XLSX.');
  }
  var b64 = String(data.data || '');
  if (!/^[A-Za-z0-9+\/=]+$/.test(b64)) fail_('VALIDATION', 'Data file tidak valid.');
  if (b64.length > Math.ceil(APP.UPLOAD_MAX_BYTES * 4 / 3) + 8) fail_('VALIDATION', 'Ukuran file maksimal 5 MB.');
  var bytes = Utilities.base64Decode(b64);
  if (!bytes.length) fail_('VALIDATION', 'File kosong.');
  if (bytes.length > APP.UPLOAD_MAX_BYTES) fail_('VALIDATION', 'Ukuran file maksimal 5 MB.');
  if (!sniffMatches_(bytes, ext)) fail_('VALIDATION', 'Isi file tidak sesuai dengan jenisnya (.' + ext + ').');
  if (!rateLimit_('upl:' + me, APP.UPLOADS_PER_HOUR, 3600)) {
    fail_('RATE_LIMIT', 'Batas unggahan per jam tercapai. Coba lagi nanti.');
  }

  var thumb = '';
  if (type.kind === 'image' && data.thumb) {
    var t = String(data.thumb);
    if (/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(t) && t.length <= APP.THUMB_MAX_CHARS) thumb = t;
  }
  var file = uploadFolder_().createFile(Utilities.newBlob(bytes, type.mime, Date.now() + '_' + name));
  var id = newId_('att');
  dbInsert_('attachments', {
    file_id: id, drive_id: file.getId(), owner_id: me, context_type: 'pending', context_id: '',
    name: name, mime: type.mime, size_bytes: bytes.length, created_at: nowIso_(), conv_id: convId, thumb_data: thumb
  });
  return { id: id, name: name, mime: type.mime, size: bytes.length, kind: type.kind, thumb: !!thumb };
}

/**
 * Siapa boleh membuka lampiran:
 *  - pending   : hanya pengunggah
 *  - message   : anggota percakapan
 *  - discussion/comment : semua anggota yang disetujui (forum terbuka untuk komunitas)
 *  - resource  : semua anggota bila materi disetujui; bila belum, pengunggah & Moderator ke atas
 */
function canAccessAttachment_(row, user) {
  if (!row || row.context_type === 'deleted') return false;
  var userId = user.user_id;
  if (row.context_type === 'pending') return String(row.owner_id) === String(userId);
  if (row.context_type === 'message') return !!myConvs_(userId)[row.conv_id];
  if (row.context_type === 'discussion' || row.context_type === 'comment') return true;
  if (row.context_type === 'resource') {
    var res = dbGet_('resources', 'res_id', row.context_id);
    if (!res || res.deleted_at) return false;
    return bool_(res.approved) || String(res.uploader_id) === String(userId) || isStaff_(user, ROLES.MODERATOR);
  }
  return false;
}

/** Ambil lampiran 'pending' milik user untuk ditautkan ke forum/materi. Wajib di dalam withLock_. */
function claimAttachments_(ids, userId, contextType, contextId) {
  ids = (ids || []).slice(0, 5).map(function (x) { return str_(x, 40); }).filter(Boolean);
  if (!ids.length) return [];
  var rows = dbWhere_('attachments', function (a) { return ids.indexOf(a.file_id) >= 0; });
  if (rows.length !== ids.length) fail_('VALIDATION', 'Lampiran tidak ditemukan. Unggah ulang file.');
  var out = rows.map(function (a) {
    if (a.owner_id !== userId || a.context_type !== 'pending' || a.conv_id) fail_('FORBIDDEN', 'Lampiran tidak valid.');
    return { id: a.file_id, name: a.name, mime: a.mime, size: Number(a.size_bytes) || 0,
      kind: a.mime.indexOf('image/') === 0 ? 'image' : (a.mime === 'application/pdf' ? 'pdf' : 'office'), thumb: !!a.thumb_data };
  });
  out.forEach(function (a) {
    dbUpdate_('attachments', 'file_id', a.id, { context_type: contextType, context_id: contextId });
  });
  return out;
}

/** Buang lampiran (file Drive ke sampah, baris ditandai 'deleted'). */
function trashAttachments_(list) {
  (list || []).forEach(function (a) {
    var att = dbGet_('attachments', 'file_id', a.id);
    if (!att) return;
    try { DriveApp.getFileById(att.drive_id).setTrashed(true); } catch (e) { /* sudah tidak ada */ }
    dbUpdate_('attachments', 'file_id', a.id, { context_type: 'deleted', thumb_data: '' });
    cache_().remove('th:' + a.id);
  });
}

function filesThumbs_(data, ctx) {
  var ids = (data.ids || []).map(function (x) { return str_(x, 40); }).filter(Boolean).slice(0, 40);
  if (!ids.length) return {};
  var out = {};
  var cached = cache_().getAll(ids.map(function (id) { return 'th:' + id; }));
  var need = {};
  ids.forEach(function (id) { need[id] = true; });
  dbWhere_('attachments', function (a) { return need[a.file_id]; }).forEach(function (a) {
    if (!canAccessAttachment_(a, ctx.user) || !a.thumb_data) return;
    out[a.file_id] = cached['th:' + a.file_id] || a.thumb_data;
    if (!cached['th:' + a.file_id]) cache_().put('th:' + a.file_id, a.thumb_data, 21600);
  });
  return out;
}

function filesGet_(data, ctx) {
  var row = dbGet_('attachments', 'file_id', str_(data.id, 40));
  if (!canAccessAttachment_(row, ctx.user)) fail_('NOT_FOUND', 'File tidak ditemukan atau sudah dihapus.');
  var blob;
  try { blob = DriveApp.getFileById(row.drive_id).getBlob(); } catch (e) { fail_('NOT_FOUND', 'File sudah tidak tersedia.'); }
  return { id: row.file_id, name: row.name, mime: row.mime, data: Utilities.base64Encode(blob.getBytes()) };
}

/** Dipanggil dailyMaintenance(): buang lampiran yang diunggah tapi tidak pernah dikirim. */
function cleanupPendingUploads_() {
  var cutoff = Date.now() - 86400000;
  var n = 0;
  dbUpdateWhere_('attachments',
    function (a) { return a.context_type === 'pending' && toMs_(a.created_at) < cutoff; },
    function (a) {
      try { DriveApp.getFileById(a.drive_id).setTrashed(true); } catch (e) { /* abaikan */ }
      n++;
      return { context_type: 'deleted', thumb_data: '' };
    });
  return n;
}
