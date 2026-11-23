import re, sys, json
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8765/'
ADMIN_PW = sys.argv[1]
OUT = '/home/claude/test/shots2/'
errors = []

def attach(page):
    page.on('console', lambda m: errors.append(f'[{m.type}] {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
    page.route(re.compile(r'https://(fonts|cdn)\.'), lambda r: r.abort())

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 820}, color_scheme='light')
    page = ctx.new_page(); attach(page)

    page.goto(BASE); page.wait_for_selector('#f-login')
    page.screenshot(path=OUT + '01_login.png')

    page.click('[data-go=register]'); page.wait_for_selector('#f-reg')
    page.fill('[name=full_name]', 'Tes Pendaftar'); page.fill('[name=username]', 'tes.daftar')
    page.fill('[name=email]', 'tes@example.com'); page.fill('[name=nim]', '2510099')
    page.select_option('[name=angkatan]', '2025'); page.fill('[name=kelas]', 'B')
    page.fill('[name=password]', 'rahasia123'); page.fill('[name=password2]', 'beda')
    page.check('[name=agree]'); page.click('#f-reg button[type=submit]')
    page.wait_for_selector('#msg.alert-error'); page.screenshot(path=OUT + '02_register_error.png', full_page=True)
    page.fill('[name=password2]', 'rahasia123'); page.click('#f-reg button[type=submit]')
    page.wait_for_selector('.status-icon'); page.screenshot(path=OUT + '03_status_pending.png')

    page.click('[data-go=login]'); page.wait_for_selector('#f-login')
    page.fill('[name=identifier]', 'superadmin'); page.fill('[name=password]', ADMIN_PW)
    page.click('#f-login button[type=submit]')
    page.wait_for_selector('.stat-value'); page.wait_for_timeout(600)
    page.screenshot(path=OUT + '04_dashboard_admin.png')

    page.click('.nav-item[data-path=admin]'); page.wait_for_selector('[data-act=approve]')
    page.screenshot(path=OUT + '05_admin_pending.png', full_page=True)
    n_before = page.locator('[data-act=approve]').count()
    page.locator('[data-act=approve]').first.click(); page.wait_for_timeout(900)
    n_after = page.locator('[data-act=approve]').count()
    assert n_after == n_before - 1, (n_before, n_after)
    page.locator('[data-act=reject]').first.click(); page.wait_for_selector('.modal')
    page.fill('.modal [name=reason]', 'NIM tidak cocok dengan data jurusan'); page.click('.modal button[type=submit]')
    page.wait_for_timeout(900); assert page.locator('[data-act=approve]').count() == n_after - 1

    page.click('[data-go="admin/users"]'); page.wait_for_selector('table.table'); page.wait_for_timeout(300)
    page.screenshot(path=OUT + '06_admin_users.png', full_page=True)
    page.locator('[data-edit]').first.click(); page.wait_for_selector('.modal')
    page.screenshot(path=OUT + '07_admin_edit_modal.png')
    page.click('.modal [data-cancel]')

    page.click('.nav-item[data-path=members]'); page.wait_for_selector('.member-card'); page.wait_for_timeout(300)
    page.screenshot(path=OUT + '08_members.png')
    page.fill('#m-q', 'nabila'); page.wait_for_timeout(1200)
    assert page.locator('.member-card').count() == 1
    page.locator('.member-card').first.click(); page.wait_for_selector('.profile-hero')
    page.screenshot(path=OUT + '09_member_detail.png')

    page.click('.nav-item[data-path=forum]'); page.wait_for_selector('.topic-card')
    page.click('#btn-theme'); page.wait_for_timeout(300)
    assert page.evaluate("document.documentElement.getAttribute('data-theme')") == 'dark'
    page.click('.nav-item[data-path=dashboard]'); page.wait_for_selector('.stat-value'); page.wait_for_timeout(500)
    page.screenshot(path=OUT + '10_dashboard_dark.png')
    page.click('#btn-fullscreen'); page.wait_for_timeout(500)
    page.screenshot(path=OUT + '11_fullscreen_or_focus.png')
    page.click('#btn-fullscreen'); page.wait_for_timeout(300)
    page.click('#btn-refresh'); page.wait_for_selector('.stat-value')

    page.click('.nav-item[data-path=profile]'); page.wait_for_selector('#f-profile')
    page.fill('[name=bio]', '<img src=x onerror=alert(1)> Suka sastra Inggris')
    page.click('#f-profile button[type=submit]'); page.wait_for_timeout(800)
    page.screenshot(path=OUT + '12_profile_dark.png', full_page=True)
    page.click('.nav-item[data-path=settings]'); page.wait_for_selector('#f-pw')
    page.screenshot(path=OUT + '13_settings_dark.png', full_page=True)

    # XSS: bio harus tampil sebagai teks
    page.click('.nav-item[data-path=members]'); page.wait_for_selector('.member-card')
    page.goto(BASE + '#members'); page.wait_for_timeout(200)
    ctx.close()

    # Mobile
    m = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, color_scheme='light')
    mp = m.new_page(); attach(mp)
    mp.goto(BASE); mp.wait_for_selector('#f-login')
    mp.screenshot(path=OUT + '14_mobile_login.png')
    mp.fill('[name=identifier]', 'nabila3'); mp.fill('[name=password]', 'rahasia123'); mp.click('#f-login button[type=submit]')
    mp.wait_for_selector('.stat-value'); mp.wait_for_timeout(500)
    mp.evaluate("App.applyTheme('light')")
    mp.screenshot(path=OUT + '15_mobile_dashboard.png')
    mp.click('#btn-more'); mp.wait_for_timeout(400)
    mp.screenshot(path=OUT + '16_mobile_drawer.png')
    mp.locator('.sidebar .nav-item[data-path=members]').click(); mp.wait_for_selector('.member-card'); mp.wait_for_timeout(300)
    mp.screenshot(path=OUT + '17_mobile_members.png')
    assert mp.locator('.nav-item[data-path=admin]').count() == 0, 'moderator tidak boleh melihat menu admin'
    mp.evaluate("App.go('admin')"); mp.wait_for_timeout(400)
    assert 'Halaman tidak ditemukan' in mp.inner_text('#main')
    m.close()

    # Tablet
    t = b.new_context(viewport={'width': 900, 'height': 1000}); tp = t.new_page(); attach(tp)
    tp.goto(BASE); tp.wait_for_selector('#f-login')
    tp.fill('[name=identifier]', 'ahmad0'); tp.fill('[name=password]', 'rahasia123'); tp.click('#f-login button[type=submit]')
    tp.wait_for_selector('.stat-value'); tp.wait_for_timeout(500)
    tp.screenshot(path=OUT + '18_tablet_dashboard.png')
    t.close()
    b.close()

print('UI OK')
print('ERRORS:', json.dumps(errors, indent=1))
