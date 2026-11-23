import re, sys, json
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8765/'
PW = sys.argv[1]
OUT = '/home/claude/test/shots5/'
errors = []
XSS = '<img src=x onerror="window.__xss=1">'
def attach(page, tag):
    page.on('console', lambda m: errors.append(f'{tag} [{m.type}] {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(f'{tag} [pageerror] {e}'))
    page.on('dialog', lambda d: (errors.append(f'{tag} [dialog] {d.message}'), d.dismiss()))
    page.route(re.compile(r'https://(fonts|cdn)\.'), lambda r: r.abort())
def login(page, u, p):
    page.goto(BASE); page.wait_for_selector('#f-login')
    page.fill('[name=identifier]', u); page.fill('[name=password]', p); page.click('#f-login button[type=submit]')
    page.wait_for_selector('.stat-value'); page.evaluate("App.applyTheme('light')")
def no_xss(page, where):
    v = page.evaluate("window.__xss")
    assert v is None, f'XSS dijalankan di {where}: {v}'

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---- Penyerang (ahmad) menanam payload ----
    X = b.new_context(viewport={'width': 1280, 'height': 860}).new_page(); attach(X, 'X')
    login(X, 'ahmad0', 'rahasia123')
    X.evaluate("App.go('forum/new')"); X.wait_for_selector('#te-form')
    X.select_option('[name=cat_id]', label='General'); X.fill('[name=title]', 'Judul ' + XSS)
    X.fill('[name=body]', '<script>window.__xss=2</script><b>tebal?</b> ' + XSS + ' javascript:alert(1)')
    X.click('#te-form button[type=submit]'); X.wait_for_selector('.topic-full')
    xss_topic = X.evaluate("App.path")
    assert '<b>tebal?</b>' in X.inner_text('.topic-full'), 'tag HTML tampil sebagai teks'
    no_xss(X, 'topik (penulis)')
    X.evaluate("App.go('profile')"); X.wait_for_selector('#f-profile')
    X.fill('[name=bio]', XSS + ' "><svg onload=window.__xss=3>'); X.click('#f-profile button[type=submit]'); X.wait_for_timeout(800)
    X.evaluate("App.go('chat')"); X.wait_for_selector('.conv-item'); X.locator('.conv-item', has_text='Rina Pratama').click(); X.wait_for_selector('#t-input')
    X.fill('#t-input', 'Halo ' + XSS + ' https://example.com/?q="><script>window.__xss=4</script>'); X.press('#t-input', 'Enter'); X.wait_for_timeout(800)
    no_xss(X, 'chat (penulis)')

    # ---- Korban/admin (desktop) melihat semuanya ----
    A = b.new_context(viewport={'width': 1366, 'height': 900}, color_scheme='light').new_page(); attach(A, 'A')
    login(A, 'superadmin', PW)
    A.evaluate(f"App.go('{xss_topic}')"); A.wait_for_selector('.topic-full'); A.wait_for_timeout(400); no_xss(A, 'topik')
    A.evaluate("App.go('forum')"); A.wait_for_selector('.topic-card'); no_xss(A, 'daftar forum')
    A.evaluate("App.go('dashboard')"); A.wait_for_selector('.stat-value'); A.wait_for_timeout(300); no_xss(A, 'dashboard')
    A.evaluate("App.go('chat')"); A.wait_for_selector('.conv-item'); A.locator('.conv-item', has_text='Ahmad Fauzi').click(); A.wait_for_selector('.msg'); A.wait_for_timeout(400)
    no_xss(A, 'chat'); assert 'https://example.com/?q=' in A.inner_text('#t-msgs')
    href = A.evaluate("Array.from(document.querySelectorAll('#t-msgs a')).map(a => a.getAttribute('href')).join(' ')")
    assert 'javascript:' not in href and '<' not in href and '"' not in href, href
    A.evaluate("App.go('members')"); A.wait_for_selector('.member-card'); A.locator('.member-card', has_text='Ahmad Fauzi').click(); A.wait_for_selector('.profile-hero'); no_xss(A, 'profil')
    # Pencarian global (Ctrl+K)
    A.keyboard.press('Control+k'); A.wait_for_selector('#gs-q'); A.fill('#gs-q', 'img'); A.wait_for_selector('.gs-item', timeout=8000); A.wait_for_timeout(300)
    no_xss(A, 'pencarian (highlight)')
    A.fill('#gs-q', 'speaking'); A.wait_for_function("document.querySelectorAll('.gs-sec').length >= 3", timeout=8000); A.wait_for_timeout(300)
    A.screenshot(path=OUT + '01_global_search.png')
    A.locator('.gs-item', has_text='Speaking Practice').first.click(); A.wait_for_timeout(600)
    assert A.evaluate("App.path").startswith('chat/') or A.evaluate("App.path") == 'groups'

    # ---- Laporan dari HP (siti) ----
    M = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True).new_page(); attach(M, 'M')
    login(M, 'siti1', 'rahasia123')
    M.evaluate(f"App.go('{xss_topic}')"); M.wait_for_selector('.topic-full'); no_xss(M, 'topik (HP)')
    M.click('[data-rep=discussion]'); M.wait_for_selector('.modal'); M.select_option('.modal [name=reason]', 'tidak_pantas')
    M.fill('.modal [name=note]', 'Berisi kode aneh'); M.screenshot(path=OUT + '02_mobile_report.png')
    M.click('.modal button[type=submit]'); M.wait_for_timeout(800)
    # Privasi: siti menolak DM baru
    M.evaluate("App.go('settings')"); M.wait_for_selector('#f-privacy'); M.uncheck('[name=allow_dm]'); M.click('#f-privacy button[type=submit]'); M.wait_for_timeout(800)

    # ---- Moderasi (admin) ----
    A.evaluate("App.syncNow(true)"); A.wait_for_timeout(1200)
    assert A.locator('#badge-reports').inner_text() == '2', A.locator('#badge-reports').inner_text()
    A.click('.nav-item[data-path=moderation]'); A.wait_for_selector('.mod-card'); A.wait_for_timeout(300); no_xss(A, 'moderasi')
    A.screenshot(path=OUT + '03_moderation.png')
    A.locator('.mod-card', has_text='DIJUAL').locator('[data-act=remove]').click(); A.wait_for_selector('.modal')
    A.fill('.modal [name=reason]', 'Promosi jualan tidak diperbolehkan'); A.click('.modal button[type=submit]')
    A.wait_for_function("!document.body.innerText.includes('DIJUAL akun')", timeout=8000)
    A.locator('.mod-card').first.locator('[data-act=warn]').click(); A.fill('.modal [name=reason]', 'Jangan menulis kode HTML di forum'); A.click('.modal button[type=submit]')
    A.wait_for_selector('.empty'); A.click('[data-tab=closed]'); A.wait_for_selector('.mod-card'); A.wait_for_timeout(300)
    A.screenshot(path=OUT + '04_moderation_history.png')

    # ---- Profil siti: DM ditolak untuk anggota ----
    X.evaluate("App.go('members')"); X.wait_for_selector('.member-card'); X.locator('.member-card', has_text='Siti Rahmawati').click(); X.wait_for_selector('.profile-hero')
    assert 'Tidak menerima pesan' in X.inner_text('#main')
    X.evaluate("App.go('notifications')"); X.wait_for_selector('.notif-item')
    assert 'Peringatan dari moderator' in X.inner_text('#main')

    # ---- Bisukan grup (ahmad) ----
    X.evaluate("App.go('chat')"); X.wait_for_selector('.conv-item'); X.locator('.conv-item', has_text='Speaking Practice').click(); X.wait_for_selector('#t-info')
    X.click('#t-info'); X.wait_for_selector('#if-mute'); X.check('#if-mute'); X.wait_for_timeout(800); X.click('[data-close]')
    X.wait_for_function("document.querySelector('.conv-item .muted-ic')", timeout=12000)
    X.screenshot(path=OUT + '05_muted_conv.png')

    # ---- Sistem & metrik + pengaturan ----
    A.evaluate("App.go('admin/system')"); A.wait_for_selector('.mt-tile'); A.wait_for_selector('#st-body input'); A.wait_for_timeout(400)
    A.screenshot(path=OUT + '06_system_metrics.png', full_page=False)
    A.evaluate("document.getElementById('main').scrollTop = 99999"); A.wait_for_timeout(200)
    A.screenshot(path=OUT + '07_system_settings.png')
    A.uncheck('[name=registration_open]'); A.fill('[name=info_banner]', 'Pemeliharaan sistem Sabtu 22.00–23.00 WIB')
    A.click('#f-settings button[type=submit]'); A.wait_for_timeout(1000)
    L = b.new_context(viewport={'width': 1280, 'height': 800}).new_page(); attach(L, 'L')
    L.route(re.compile(r'https://(fonts|cdn)\.'), lambda r: r.abort())
    L.goto(BASE); L.wait_for_selector('#f-login')
    assert 'Pendaftaran anggota baru sedang ditutup' in L.inner_text('body') and 'Pemeliharaan' in L.inner_text('body')
    L.screenshot(path=OUT + '08_login_closed.png')
    A.check('[name=registration_open]'); A.fill('[name=info_banner]', ''); A.click('#f-settings button[type=submit]'); A.wait_for_timeout(800)

    # Mode gelap moderasi
    A.evaluate("App.applyTheme('dark')"); A.evaluate("App.go('moderation')"); A.wait_for_selector('.tabs'); A.click('[data-tab=closed]'); A.wait_for_selector('.mod-card'); A.wait_for_timeout(300)
    A.screenshot(path=OUT + '09_moderation_dark.png')
    for pg, nm in [(A, 'A'), (X, 'X'), (M, 'M')]: no_xss(pg, 'akhir ' + nm)
    b.close()
print('UI TAHAP 4 OK')
print('ERRORS:', json.dumps(errors, indent=1))
