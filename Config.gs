/**
 * Config.gs — konfigurasi aplikasi, role, status, skema database, dan matriks izin.
 * Ubah nilai di bagian APP sesuai kebutuhan komunitas.
 */

var APP = {
  NAME: 'YAPP',
  SHORT_NAME: 'YAPP',
  TAGLINE: "Let's Yapp for better English",
  // Opsional: URL publik gambar PNG/ICO untuk ikon tab browser (kosongkan jika tidak ada).
  FAVICON_URL: '',
  TIMEZONE: 'Asia/Jakarta',

  // Sesi
  SESSION_IDLE_HOURS: 8,          // sesi biasa: berakhir 8 jam setelah aktivitas terakhir
  SESSION_REMEMBER_DAYS: 7,       // "Ingat saya"
  SESSION_TOUCH_MINUTES: 10,      // perpanjang sesi di sheet paling sering tiap 10 menit

  // Password
  PASSWORD_MIN_LENGTH: 8,
  HASH_ITERATIONS: 1000,          // naikkan jika login masih jauh di bawah 1 detik

  // Keamanan login & registrasi
  LOGIN_MAX_FAILS: 5,
  LOGIN_LOCK_MINUTES: 15,
  REGISTER_MAX_PER_HOUR: 3,       // per perangkat
  FORGOT_MAX_PER_HOUR: 3,         // per email
  RESET_TOKEN_MINUTES: 30,
  REAPPLY_AFTER_DAYS: 7,          // akun Rejected boleh daftar ulang setelah 7 hari

  // Kehadiran (online)
  ONLINE_TTL_SECONDS: 120,
  LAST_SEEN_WRITE_MINUTES: 5,

  // Foto profil
  AVATAR_MAX_BYTES: 300 * 1024,
  AVATAR_MIMES: ['image/jpeg', 'image/png', 'image/webp'],

  // Direktori
  MEMBERS_PAGE_SIZE: 24,

  // Backup
  BACKUP_KEEP: 14,

  // Chat (Tahap 2)
  MESSAGE_MAX_CHARS: 2000,
  MESSAGES_PER_MINUTE: 20,
  RECENT_MESSAGES: 50,            // jendela pesan terbaru yang disimpan di cache per percakapan
  HISTORY_PAGE: 50,
  GROUP_NAME_MAX: 60,
  GROUP_DESC_MAX: 300,
  GROUP_MAX_ADD: 50,              // maks. anggota yang ditambahkan sekaligus

  // Lampiran file (Tahap 2)
  UPLOAD_MAX_BYTES: 5 * 1024 * 1024,
  UPLOADS_PER_HOUR: 30,
  THUMB_MAX_CHARS: 45000,         // gambar mini disimpan di sel (batas sel 50.000 karakter)
  FILE_TYPES: {
    jpg: { mime: 'image/jpeg', kind: 'image' },
    jpeg: { mime: 'image/jpeg', kind: 'image' },
    png: { mime: 'image/png', kind: 'image' },
    webp: { mime: 'image/webp', kind: 'image' },
    pdf: { mime: 'application/pdf', kind: 'pdf' },
    docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office' },
    pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'office' },
    xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'office' }
  },

  // Forum (Tahap 3)
  FORUM_PAGE: 20,
  TOPIC_TITLE_MAX: 150,
  TOPIC_BODY_MAX: 10000,
  COMMENT_MAX: 3000,
  TOPICS_PER_10_MIN: 5,
  REPLIES_PER_MINUTE: 10,
  REACTIONS: { like: 'Suka', agree: 'Setuju', thanks: 'Terima kasih', funny: 'Lucu' },

  // Materi (Tahap 3)
  RESOURCE_NEEDS_APPROVAL: true,  // materi dari Member menunggu persetujuan Moderator
  RESOURCES_PAGE: 24,

  // Pengumuman & agenda (Tahap 3)
  ANNOUNCEMENT_PRIORITIES: { normal: 'Normal', penting: 'Penting', mendesak: 'Mendesak' },
  EVENT_REMINDER_HOURS: 24,

  // Laporan konten (Tahap 4)
  REPORTS_PER_HOUR: 10,
  REPORT_REASONS: {
    spam: 'Spam atau promosi',
    kasar: 'Kata-kata kasar / pelecehan',
    sara: 'SARA / ujaran kebencian',
    tidak_pantas: 'Konten tidak pantas',
    plagiat: 'Plagiat / pelanggaran hak cipta',
    lainnya: 'Lainnya'
  },

  // Metrik (Tahap 4) — untuk memantau uji beban
  METRICS_ENABLED: true,

  // Interval sinkronisasi (milidetik). Naikkan SYNC_OPEN_MS ke 5000 bila uji beban menunjukkan
  // banyak "Gagal di browser" atau sinkronisasi > 1,5 detik.
  SYNC_OPEN_MS: 3000,     // percakapan sedang dibuka
  SYNC_OTHER_MS: 10000,   // halaman lain
  SYNC_IDLE_MS: 30000     // tidak ada aktivitas > 2 menit
};

var ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  MEMBER: 'member'
};

var ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  moderator: 'Moderator',
  member: 'Member'
};

// Semakin besar, semakin tinggi. Seseorang hanya boleh bertindak terhadap role di bawahnya.
var ROLE_RANK = { super_admin: 4, admin: 3, moderator: 2, member: 1 };

var STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended'
};

/**
 * Skema database. Kolom pertama = primary key (kecuali tabel relasi).
 * Setup.gs membuat semua sheet ini, termasuk yang baru dipakai di tahap berikutnya.
 */
var SCHEMA = {
  main: {
    users: ['user_id', 'email', 'username', 'password_hash', 'role', 'status', 'status_reason',
      'status_changed_by', 'status_changed_at', 'failed_logins', 'locked_until', 'created_at',
      'approved_at', 'last_login_at', 'last_seen_at'],
    profiles: ['user_id', 'full_name', 'nim', 'angkatan', 'kelas', 'jabatan', 'bio', 'phone',
      'photo_file_id', 'privacy_json', 'notif_json', 'theme', 'updated_at'],
    sessions: ['token_hash', 'user_id', 'created_at', 'expires_at', 'last_used_at', 'remember',
      'user_agent', 'revoked_at'],
    password_resets: ['token_hash', 'user_id', 'created_at', 'expires_at', 'used_at'],
    categories: ['cat_id', 'scope', 'name', 'sort_order'],
    discussions: ['disc_id', 'cat_id', 'author_id', 'title', 'body', 'attachment_ids', 'is_pinned',
      'is_locked', 'is_important', 'reply_count', 'reaction_count', 'last_activity_at', 'created_at',
      'updated_at', 'deleted_at', 'last_reply_by'],
    comments: ['comment_id', 'disc_id', 'parent_id', 'author_id', 'body', 'attachment_ids',
      'created_at', 'updated_at', 'deleted_at'],
    reactions: ['target_type', 'target_id', 'user_id', 'type', 'created_at'],
    conversations: ['conv_id', 'type', 'name', 'description', 'photo_file_id', 'visibility',
      'is_official', 'created_by', 'created_at', 'last_message_at', 'last_message_preview', 'direct_key'],
    conversation_members: ['conv_id', 'user_id', 'member_role', 'joined_at', 'left_at',
      'last_read_msg_id', 'muted'],
    attachments: ['file_id', 'drive_id', 'owner_id', 'context_type', 'context_id', 'name', 'mime',
      'size_bytes', 'created_at', 'conv_id', 'thumb_data'],
    resources: ['res_id', 'cat_id', 'title', 'description', 'kind', 'file_id', 'url', 'uploader_id',
      'approved', 'download_count', 'created_at', 'deleted_at', 'reviewed_by'],
    announcements: ['ann_id', 'title', 'body', 'priority', 'is_pinned', 'audience', 'publish_at',
      'expires_at', 'author_id', 'created_at', 'updated_at', 'deleted_at', 'notified'],
    events: ['event_id', 'title', 'description', 'location', 'start_at', 'end_at', 'quota',
      'reg_deadline', 'created_by', 'created_at', 'updated_at', 'deleted_at', 'reminder_sent'],
    event_participants: ['event_id', 'user_id', 'status', 'registered_at'],
    notifications: ['notif_id', 'user_id', 'type', 'title', 'link', 'ref_id', 'is_read', 'created_at'],
    reports: ['report_id', 'target_type', 'target_id', 'reporter_id', 'reason', 'status',
      'handled_by', 'handled_at', 'created_at', 'note', 'snapshot_json', 'action'],
    audit_logs: ['log_id', 'actor_id', 'action', 'target_type', 'target_id', 'detail_json', 'created_at'],
    settings: ['key', 'value']
  },
  msg: {
    // attachment_ids berisi JSON [{id, name, mime, size, kind}] agar tidak perlu membaca tabel attachments.
    messages: ['msg_id', 'conv_id', 'sender_id', 'body', 'reply_to_id', 'attachment_ids',
      'created_at', 'edited_at', 'deleted_at', 'kind', 'reply_json']
  }
};

/** Sheet → spreadsheet tempat sheet itu berada ('main' atau 'msg'). */
function schemaDbOf_(table) {
  if (SCHEMA.main[table]) return 'main';
  if (SCHEMA.msg[table]) return 'msg';
  throw new Error('Tabel tidak dikenal: ' + table);
}

function schemaColumns_(table) {
  return SCHEMA[schemaDbOf_(table)][table];
}

/**
 * Matriks izin: aksi → role yang boleh. 'public' = tanpa login.
 * Pemeriksaan kepemilikan / peringkat role dilakukan di dalam handler masing-masing.
 */
var PERMISSIONS = {
  // Publik
  'app.config': 'public',
  'auth.register': 'public',
  'auth.login': 'public',
  'auth.forgot': 'public',
  'auth.reset': 'public',

  // Semua anggota yang disetujui
  'auth.me': ['super_admin', 'admin', 'moderator', 'member'],
  'auth.logout': ['super_admin', 'admin', 'moderator', 'member'],
  'auth.logoutAll': ['super_admin', 'admin', 'moderator', 'member'],
  'auth.changePassword': ['super_admin', 'admin', 'moderator', 'member'],
  'app.ping': ['super_admin', 'admin', 'moderator', 'member'],
  'dashboard.summary': ['super_admin', 'admin', 'moderator', 'member'],
  'members.list': ['super_admin', 'admin', 'moderator', 'member'],
  'members.get': ['super_admin', 'admin', 'moderator', 'member'],
  'profile.update': ['super_admin', 'admin', 'moderator', 'member'],
  'profile.uploadPhoto': ['super_admin', 'admin', 'moderator', 'member'],
  'profile.removePhoto': ['super_admin', 'admin', 'moderator', 'member'],
  'files.avatars': ['super_admin', 'admin', 'moderator', 'member'],

  // Admin
  'admin.pending': ['super_admin', 'admin'],
  'admin.decide': ['super_admin', 'admin'],
  'admin.users': ['super_admin', 'admin'],
  'admin.setStatus': ['super_admin', 'admin'],
  'admin.setRole': ['super_admin', 'admin'],
  'admin.updateProfile': ['super_admin', 'admin'],
  'admin.logs': ['super_admin', 'admin'],

  // Super Admin
  'admin.backupNow': ['super_admin'],

  // Tahap 2: chat, grup, file, notifikasi
  'chat.sync': ['super_admin', 'admin', 'moderator', 'member'],
  'chat.open': ['super_admin', 'admin', 'moderator', 'member'],
  'chat.history': ['super_admin', 'admin', 'moderator', 'member'],
  'chat.send': ['super_admin', 'admin', 'moderator', 'member'],
  'chat.deleteMessage': ['super_admin', 'admin', 'moderator', 'member'],
  'chat.openDirect': ['super_admin', 'admin', 'moderator', 'member'],
  'chat.search': ['super_admin', 'admin', 'moderator', 'member'],
  'groups.list': ['super_admin', 'admin', 'moderator', 'member'],
  'groups.create': ['super_admin', 'admin', 'moderator'],
  'groups.join': ['super_admin', 'admin', 'moderator', 'member'],
  'groups.leave': ['super_admin', 'admin', 'moderator', 'member'],
  'groups.update': ['super_admin', 'admin', 'moderator', 'member'],
  'groups.setPhoto': ['super_admin', 'admin', 'moderator', 'member'],
  'groups.addMembers': ['super_admin', 'admin', 'moderator', 'member'],
  'groups.removeMember': ['super_admin', 'admin', 'moderator', 'member'],
  'groups.setMemberRole': ['super_admin', 'admin', 'moderator', 'member'],
  'files.upload': ['super_admin', 'admin', 'moderator', 'member'],
  'files.thumbs': ['super_admin', 'admin', 'moderator', 'member'],
  'files.get': ['super_admin', 'admin', 'moderator', 'member'],
  'notifications.list': ['super_admin', 'admin', 'moderator', 'member'],
  'notifications.markRead': ['super_admin', 'admin', 'moderator', 'member'],

  // Tahap 3: forum, materi, pengumuman, agenda
  'forum.categories': ['super_admin', 'admin', 'moderator', 'member'],
  'forum.list': ['super_admin', 'admin', 'moderator', 'member'],
  'forum.get': ['super_admin', 'admin', 'moderator', 'member'],
  'forum.create': ['super_admin', 'admin', 'moderator', 'member'],
  'forum.update': ['super_admin', 'admin', 'moderator', 'member'],
  'forum.delete': ['super_admin', 'admin', 'moderator', 'member'],
  'forum.reply': ['super_admin', 'admin', 'moderator', 'member'],
  'forum.deleteComment': ['super_admin', 'admin', 'moderator', 'member'],
  'forum.react': ['super_admin', 'admin', 'moderator', 'member'],
  'forum.moderate': ['super_admin', 'admin', 'moderator'],
  'resources.list': ['super_admin', 'admin', 'moderator', 'member'],
  'resources.create': ['super_admin', 'admin', 'moderator', 'member'],
  'resources.open': ['super_admin', 'admin', 'moderator', 'member'],
  'resources.delete': ['super_admin', 'admin', 'moderator', 'member'],
  'resources.review': ['super_admin', 'admin', 'moderator'],
  'announcements.list': ['super_admin', 'admin', 'moderator', 'member'],
  'announcements.save': ['super_admin', 'admin'],
  'announcements.delete': ['super_admin', 'admin'],
  'events.list': ['super_admin', 'admin', 'moderator', 'member'],
  'events.get': ['super_admin', 'admin', 'moderator', 'member'],
  'events.save': ['super_admin', 'admin'],
  'events.delete': ['super_admin', 'admin'],
  'events.register': ['super_admin', 'admin', 'moderator', 'member'],
  'events.cancel': ['super_admin', 'admin', 'moderator', 'member'],
  'events.attendance': ['super_admin', 'admin'],

  // Tahap 4: pencarian, laporan & moderasi, pengaturan, metrik
  'search.all': ['super_admin', 'admin', 'moderator', 'member'],
  'reports.create': ['super_admin', 'admin', 'moderator', 'member'],
  'moderation.list': ['super_admin', 'admin', 'moderator'],
  'moderation.resolve': ['super_admin', 'admin', 'moderator'],
  'chat.mute': ['super_admin', 'admin', 'moderator', 'member'],
  'admin.metrics': ['super_admin', 'admin'],
  'settings.update': ['super_admin']
};
