import re, sys, json
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8765/'
PW = sys.argv[1]
OUT = '/home/claude/test/shots4/'
errors = []
def attach(page, tag):
    page.on('console', lambda m: errors.append(f'{tag} [{m.type}] {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(f'{tag} [pageerror] {e}'))
    page.route(re.compile(r'https://(fonts|cdn)\.'), lambda r: r.abort())
def login(page, u, p):
    page.goto(BASE); page.wait_for_selector('#f-login')
    page.fill('[name=identifier]', u); page.fill('[name=password]', p); page.click('#f-login button[type=submit]')
    page.wait_for_selector('.stat-value')
def lp(h):
    import datetime
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=h + 7)).strftime('%Y-%m-%dT%H:%M')

with sync_playwright() as p:
    b = p.chromium.launch()
    A = b.new_context(viewport={'width': 1366, 'height': 900}, color_scheme='light').new_page(); attach(A, 'A')
    login(A, 'superadmin', PW); A.evaluate("App.applyTheme('light')")
    A.wait_for_selector('.urgent-banner'); A.wait_for_timeout(400)
    A.screenshot(path=OUT + '01_dashboard.png', full_page=False)
    A.evaluate("document.getElementById('main').scrollTop = 99999"); A.wait_for_timeout(200)
    A.screenshot(path=OUT + '02_dashboard_bottom.png')

    # Forum
    A.evaluate("App.go('forum')"); A.wait_for_selector('.topic-card'); A.wait_for_timeout(300)
    A.screenshot(path=OUT + '03_forum_list.png')
    assert A.locator('.topic-card').first.inner_text().find('Tips latihan speaking') >= 0, 'topik disematkan di atas'
    A.locator('.cat-chip', has_text='Grammar').click(); A.wait_for_timeout(600)
    assert A.locator('.topic-card').count() == 1
    A.locator('.topic-card').first.click(); A.wait_for_selector('.topic-full'); A.wait_for_timeout(300)
    A.locator('.topic-full .react[data-rx=thanks]').click(); A.wait_for_function("document.querySelector('.topic-full .react.on')")
    A.locator('[data-cmt]').first.click(); A.fill('.cmt-inline textarea', 'Mantap, terima kasih penjelasannya!'); A.click('.cmt-inline button')
    A.wait_for_function("document.body.innerText.includes('Mantap, terima kasih penjelasannya!')")
    A.set_input_files('#rp-up input[type=file]', '/home/claude/test/sample.png'); A.wait_for_selector('#rp-up .up-chip.done', timeout=10000)
    A.fill('#rp-form textarea', 'Saya lampirkan diagram ringkas perbedaannya.'); A.click('#rp-form button[type=submit]')
    A.wait_for_selector('.reply .att-img img[src^="data:"]', timeout=10000); A.wait_for_timeout(500)
    A.evaluate("document.getElementById('main').scrollTop = 0"); A.wait_for_timeout(200)
    A.screenshot(path=OUT + '04_topic.png')
    A.evaluate("document.getElementById('main').scrollTop = 99999"); A.wait_for_timeout(200)
    A.screenshot(path=OUT + '05_topic_replies.png')
    # Topik baru
    A.evaluate("App.go('forum/new')"); A.wait_for_selector('#te-form')
    A.select_option('[name=cat_id]', label='Listening'); A.fill('[name=title]', 'Podcast favorit untuk latihan listening?')
    A.fill('[name=body]', 'Bagikan podcast yang membantu kalian. Saya suka 6 Minute English.')
    A.screenshot(path=OUT + '06_topic_editor.png')
    A.click('#te-form button[type=submit]'); A.wait_for_selector('.topic-full')

    # Materi
    A.evaluate("App.go('resources')"); A.wait_for_selector('.res-card'); A.wait_for_timeout(300)
    A.screenshot(path=OUT + '07_resources.png')
    A.click('a.tab[data-go="resources/pending"]'); A.wait_for_selector('[data-approve]')
    A.screenshot(path=OUT + '08_resources_pending.png')
    A.click('[data-approve]'); A.wait_for_timeout(1200)
    A.evaluate("App.go('resources')"); A.wait_for_selector('#r-add'); A.click('#r-add')
    A.select_option('#rd-kind', 'link'); A.fill('.modal [name=title]', 'Grammarly Blog'); A.select_option('.modal [name=cat_id]', label='Writing')
    A.fill('.modal [name=url]', 'https://www.grammarly.com/blog'); A.click('.modal button[type=submit]')
    A.wait_for_function("document.body.innerText.includes('Grammarly Blog')")
    A.locator('.res-card', has_text='Tenses Cheat Sheet').locator('[data-open]').click(); A.wait_for_selector('.viewer-pdf', timeout=10000)
    A.click('[data-close]')

    # Pengumuman
    A.evaluate("App.go('announcements')"); A.wait_for_selector('.ann-card'); A.click('#an-new')
    A.fill('.modal [name=title]', 'Libur Natal'); A.fill('.modal [name=body]', 'Sekretariat tutup 24–26 Desember.'); A.select_option('.modal [name=priority]', 'penting')
    A.click('.modal button[type=submit]'); A.wait_for_function("document.body.innerText.includes('Libur Natal')"); A.wait_for_timeout(300)
    A.screenshot(path=OUT + '09_announcements.png')

    # Agenda
    A.evaluate("App.go('events')"); A.wait_for_selector('.event-card'); A.click('#ev-new')
    A.fill('.modal [name=title]', 'Speaking Club: Daily Routine'); A.fill('.modal [name=location]', 'Ruang 204')
    A.fill('.modal [name=start_at]', lp(50)); A.fill('.modal [name=end_at]', lp(52)); A.fill('.modal [name=quota]', '2')
    A.click('.modal button[type=submit]'); A.wait_for_selector('#ev-edit'); A.wait_for_timeout(300)
    evurl = A.evaluate("App.path")
    A.evaluate("App.go('events')"); A.wait_for_selector('.event-card'); A.wait_for_timeout(300)
    A.screenshot(path=OUT + '10_events.png')

    # Anggota di HP
    M = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, color_scheme='light').new_page(); attach(M, 'M')
    login(M, 'ahmad0', 'rahasia123'); M.evaluate("App.applyTheme('light')"); M.wait_for_timeout(500)
    M.screenshot(path=OUT + '11_mobile_dashboard.png')
    M.click('.bottom-nav a[data-path=forum]'); M.wait_for_selector('.topic-card'); M.wait_for_timeout(300)
    M.screenshot(path=OUT + '12_mobile_forum.png')
    M.locator('.topic-card', has_text='Present Perfect').click(); M.wait_for_selector('.topic-full'); M.wait_for_timeout(300)
    M.screenshot(path=OUT + '13_mobile_topic.png')
    M.evaluate("App.go('" + evurl + "')"); M.wait_for_selector('#ev-reg'); M.click('#ev-reg'); M.wait_for_selector('#ev-cancel'); M.wait_for_timeout(300)
    M.screenshot(path=OUT + '14_mobile_event.png')
    M.evaluate("App.go('resources')"); M.wait_for_selector('.res-card'); M.wait_for_timeout(300)
    assert 'Purdue OWL' in M.inner_text('#main'), 'materi yang disetujui tampil untuk anggota'
    M.screenshot(path=OUT + '15_mobile_resources.png')
    M.evaluate("App.go('notifications')"); M.wait_for_selector('.notif-item'); M.wait_for_timeout(300)
    assert 'Materi' in M.inner_text('#main') and 'Agenda baru' in M.inner_text('#main')
    M.screenshot(path=OUT + '16_mobile_notifications.png')

    # Mode gelap
    A.evaluate("App.applyTheme('dark')"); A.evaluate("App.go('forum')"); A.wait_for_selector('.topic-card'); A.wait_for_timeout(400)
    A.screenshot(path=OUT + '17_forum_dark.png')
    A.evaluate("App.go('" + evurl + "')"); A.wait_for_selector('#ev-edit'); A.wait_for_timeout(400)
    A.screenshot(path=OUT + '18_event_dark.png')
    b.close()
print('UI KOMUNITAS OK')
print('ERRORS:', json.dumps(errors, indent=1))
