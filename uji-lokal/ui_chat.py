import re, sys, json, base64
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8765/'
PW = sys.argv[1]
OUT = '/home/claude/test/shots3/'
errors = []
def attach(page, tag):
    page.on('console', lambda m: errors.append(f'{tag} [{m.type}] {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(f'{tag} [pageerror] {e}'))
    page.route(re.compile(r'https://(fonts|cdn)\.'), lambda r: r.abort())
def login(page, u, p):
    page.goto(BASE); page.wait_for_selector('#f-login')
    page.fill('[name=identifier]', u); page.fill('[name=password]', p); page.click('#f-login button[type=submit]')
    page.wait_for_selector('.stat-value')
PNG = '/home/claude/test/sample.png'

with sync_playwright() as p:
    b = p.chromium.launch()
    A = b.new_context(viewport={'width': 1366, 'height': 820}, color_scheme='light').new_page(); attach(A, 'A')
    login(A, 'superadmin', PW)
    A.evaluate("App.applyTheme('light')")
    # dashboard: kartu pesan terbaru
    A.wait_for_selector('[data-conv]'); A.screenshot(path=OUT + '01_dashboard_recent.png')
    A.evaluate("App.go('chat')"); A.wait_for_selector('.conv-item')
    assert A.locator('#badge-chat').inner_text() == '2', A.locator('#badge-chat').inner_text()
    A.locator('.conv-item', has_text='Ahmad Fauzi').click(); A.wait_for_selector('.msg')
    A.fill('#t-input', 'Hello Ahmad! Sudah, cek di menu Materi nanti ya.'); A.press('#t-input', 'Enter')
    A.wait_for_function("document.querySelectorAll('.msg.mine').length >= 1 && !document.querySelector('.msg.mine .tick [d^=\"M11.99\"]')")
    A.wait_for_timeout(500)

    # B = HP, ahmad
    Bc = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, color_scheme='light')
    B = Bc.new_page(); attach(B, 'B')
    login(B, 'ahmad0', 'rahasia123')
    B.evaluate("App.applyTheme('light')")
    B.wait_for_function("document.querySelector('#bn-chat') && !document.querySelector('#bn-chat').classList.contains('hidden')", timeout=15000)
    B.screenshot(path=OUT + '02_mobile_badge.png')
    B.click('.bottom-nav a[data-path=chat]'); B.wait_for_selector('.conv-item'); B.wait_for_timeout(300)
    B.screenshot(path=OUT + '03_mobile_inbox.png')
    B.locator('.conv-item', has_text='Rina Pratama').click(); B.wait_for_selector('.msg')
    assert 'Hello Ahmad' in B.inner_text('#t-msgs')
    # balas pesan
    B.locator('.msg:not(.mine) .bubble').last.click(); B.click('.msg.act [data-act=reply]')
    B.fill('#t-input', 'Baik Kak, terima kasih!'); B.click('#t-send')
    B.wait_for_selector('.msg.mine .quote'); B.wait_for_timeout(400)
    B.screenshot(path=OUT + '04_mobile_thread_reply.png')

    # A menerima balasan lewat sync (<= ~4 dtk) dan tanda baca
    A.wait_for_function("document.body.innerText.includes('Baik Kak, terima kasih!')", timeout=12000)
    A.wait_for_selector('.msg.mine .tick.read', timeout=12000)
    # A kirim lampiran gambar
    A.set_input_files('#t-file', PNG); A.wait_for_selector('.up-chip.done', timeout=10000)
    A.fill('#t-input', 'Ini contoh slide-nya'); A.click('#t-send')
    A.wait_for_selector('.msg.mine .att-img img[src^="data:"]', timeout=10000); A.wait_for_timeout(300)
    A.screenshot(path=OUT + '05_desktop_thread.png')
    B.wait_for_selector('.att-img', timeout=12000); B.wait_for_timeout(1200)
    B.locator('.att-img').last.click(); B.wait_for_selector('.viewer-img', timeout=10000); B.wait_for_timeout(300)
    B.screenshot(path=OUT + '06_mobile_viewer.png')
    B.click('[data-close]')

    # Hapus pesan: A menghapus pesan pertamanya
    A.locator('.msg.mine .bubble', has_text='Hello Ahmad').click(); A.click('.msg.act [data-act=delete]')
    A.wait_for_selector('.modal'); A.click('.modal button[type=submit]')
    A.wait_for_selector('.msg.deleted')
    B.wait_for_function("document.body.innerText.includes('Pesan ini telah dihapus')", timeout=12000)

    # Grup: A buka Speaking Practice? (bukan anggota) → halaman grup → gabung
    A.evaluate("App.go('groups')"); A.wait_for_selector('.group-card'); A.click('.tab[data-tab=explore]'); A.wait_for_timeout(200)
    A.screenshot(path=OUT + '07_groups_explore.png')
    A.locator('.group-card', has_text='Speaking Practice').locator('[data-join]').click()
    A.wait_for_selector('.msg.system'); A.wait_for_timeout(500)
    A.screenshot(path=OUT + '08_group_thread.png')
    # Buat grup baru + tambah anggota
    A.evaluate("App.go('groups')"); A.wait_for_selector('#g-create'); A.click('#g-create')
    A.fill('.modal [name=name]', 'Grammar Study Group'); A.fill('.modal [name=description]', 'Bahas tenses dan latihan soal tiap Selasa.')
    A.click('.modal button[type=submit]'); A.wait_for_selector('#t-info')
    A.click('#t-info'); A.wait_for_selector('#gi-add'); A.click('#gi-add'); A.wait_for_selector('#am-list [data-u]')
    A.locator('#am-list .pick-item', has_text='Ahmad Fauzi').locator('input').check()
    A.locator('#am-list .pick-item', has_text='Siti Rahmawati').locator('input').check()
    A.screenshot(path=OUT + '09_add_members.png')
    A.click('#am-ok')
    A.wait_for_function("document.querySelectorAll('.ginfo-head').length && document.body.innerText.includes('3 anggota')", timeout=10000)
    A.wait_for_timeout(300)
    A.screenshot(path=OUT + '10_group_info.png')
    A.click('[data-close]')

    # B: notifikasi ditambahkan ke grup
    B.click('#t-back'); B.wait_for_selector('.conv-item')
    B.wait_for_function("!document.querySelector('#bn-notif').classList.contains('hidden')", timeout=15000)
    B.click('.bottom-nav a[data-path=notifications]'); B.wait_for_selector('.notif-item')
    assert 'Grammar Study Group' in B.inner_text('#main')
    B.screenshot(path=OUT + '11_mobile_notifications.png')

    # mode gelap desktop
    A.evaluate("App.applyTheme('dark')"); A.evaluate("App.go('chat')"); A.wait_for_selector('.conv-item')
    A.locator('.conv-item', has_text='Speaking Practice').click(); A.wait_for_selector('.msg'); A.wait_for_timeout(600)
    A.screenshot(path=OUT + '12_desktop_dark_group.png')
    # pencarian
    A.click('#c-search'); A.fill('#sr-q', 'phrasal'); A.wait_for_selector('#sr-list [data-conv]', timeout=8000)
    A.screenshot(path=OUT + '13_search.png')
    b.close()
print('UI CHAT OK')
print('ERRORS:', json.dumps(errors, indent=1))
