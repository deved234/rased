// Invoked by test:ui. All versions, consent transport and profiles are fixtures.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, persistentSession, startApp, stopApp } from './cdp-tools.mjs'

export async function testWhatsNew() {
  const version = '0.11.0' // Injected through the marked TEMP harness, independent of package.json.
  const port = 9394, output = resolve('.local/whats-new/screenshots')
  mkdirSync(output, { recursive: true })
  let child, ws, session, passed = 0
  const check = (label, condition) => { assert.ok(condition, label); passed++; console.log('PASS what’s new: ' + label) }
  const ev = expression => evaluate(ws, expression)
  const wait = expression => eventually(() => ev(expression))
  const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    const params = { key, code, windowsVirtualKeyCode, modifiers }
    const text = key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}
    await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...text })
    await call(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  }
  const fixtureProfile = (legacy, installedVersion = version) => {
    const profile = newProfile()
    writeFileSync(join(profile, 'whats-new-fixture.json'), JSON.stringify({ version: installedVersion }))
    writeFileSync(join(profile, 'telemetry-fixture.json'), '{"flush":false}')
    if (legacy) {
      const db = new DatabaseSync(join(profile, 'rased.db'))
      const migrations = [...readFileSync('src/storage/migrations.ts', 'utf8').matchAll(/\/\* \d+ \*\/ `([\s\S]*?)`/g)]
      for (const migration of migrations) db.exec(migration[1])
      db.exec('PRAGMA user_version=' + migrations.length)
      db.prepare("INSERT INTO settings(key,value) VALUES('app',?)").run(JSON.stringify({ mostaqlEnabled: false, khamsatEnabled: false, nafezlyEnabled: false, kafEnabled: false }))
      db.close()
    }
    for (const file of ['rss-fixture.xml', 'nafezly-fixture.xml']) writeFileSync(join(profile, file), '<rss version="2.0"><channel><title>Fixture</title></channel></rss>')
    for (const file of ['khamsat-fixture.html', 'detail-fixture.html']) writeFileSync(join(profile, file), '<html><body>Fixture</body></html>')
    return profile
  }
  const boot = async profile => {
    child = startApp({ exe: 'node_modules/electron/dist/electron.exe', app: 'out/main/index.js', profile, port })
    ws = await pageWs(port)
    await wait('!!window.rased && !!document.querySelector(".splash")')
    await wait('document.querySelector(".splash")?.dataset.phase === "ready"')
    check('splash precedes the dialog', await ev('!document.querySelector(".whats-new-dialog")'))
    await ev('document.querySelector(".splash-enter").click()')
  }
  const stop = async () => {
    session?.close(); session = undefined
    if (child) await stopApp(child)
    child = undefined
    await eventually(async () => { try { await fetch(`http://127.0.0.1:${port}/json/list`); return false } catch { return true } })
  }
  const reload = async () => {
    await call(ws, 'Page.reload')
    await wait('document.querySelector(".splash")?.dataset.phase === "ready"')
    await ev('document.querySelector(".splash-enter").click()')
    await wait('!!document.querySelector(".sidebar")')
    // Wait for the asynchronous version read before asserting absence.
    await wait('!!document.querySelector(".about-version")')
    await ev('window.rased.getAppInfo()')
    await ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  }
  try {
    const legacy = fixtureProfile(true)
    await boot(legacy)
    await wait('!!document.querySelector(".analytics-consent-actions .primary")')
    check('legacy settings without marker stay behind acceptance', await ev('!document.querySelector(".whats-new-dialog") && !document.querySelector(".sidebar") && !!document.querySelector(".analytics-access")') && (await ev('window.rased.getSettings()')).whatsNewSeen === null)
    await wait('!document.querySelector(".analytics-consent-actions .primary").disabled')
    await ev('document.querySelector(".analytics-consent-actions .primary").click()')
    await wait('!!document.querySelector(".whats-new-dialog")')
    check('acceptance reveals the upgrade dialog over the inert workspace', await ev('!document.querySelector(".analytics-access") && document.querySelector(".app").inert && document.querySelector(".whats-new-dialog").getAttribute("aria-modal")==="true" && document.querySelector(".whats-new-dialog").getAttribute("role")==="dialog"'))
    await ev('window.rased.openCompact()')
    const compact = await pageWs(port, target => target.url.includes('compact'))
    await eventually(() => evaluate(compact, '!!document.querySelector(".compact")'))
    check('compact window never mounts the dialog', await evaluate(compact, '!document.querySelector(".whats-new-dialog")'))
    await ev('window.rased.closeCompact()')
    await key('Escape', 'Escape', 27)
    await wait('!document.querySelector(".whats-new-dialog")')
    check('Escape persists the fixture current version', (await ev('window.rased.getSettings()')).whatsNewSeen === version)
    await ev('location.hash="#/settings/about"')
    await wait('!!document.querySelector(".about-version")')
    await reload()
    check('Escape dismissal survives renderer reload', await ev('!document.querySelector(".whats-new-dialog")'))
    await stop(); await boot(legacy)
    await wait('!!document.querySelector(".about-version") || !!document.querySelector(".sidebar")')
    await ev('location.hash="#/settings/about"')
    await wait('!!document.querySelector(".about-version")')
    check('Escape dismissal survives process restart', (await ev('window.rased.getSettings()')).whatsNewSeen === version && await ev('!document.querySelector(".whats-new-dialog")'))

    // Simulate the next unseen upgrade, then exercise the primary close path.
    await ev('window.rased.updateSettings({whatsNewSeen:null})')
    await wait('!!document.querySelector(".whats-new-dialog")')
    check('focus starts at the primary action', await ev('document.activeElement === document.querySelector(".whats-new-footer .primary")'))
    const modalRoute = await ev('location.hash')
    await key('k', 'KeyK', 75, 2)
    await ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    check('Ctrl+K cannot navigate or move focus into the inert workspace', await ev('location.hash') === modalRoute && await ev('document.activeElement === document.querySelector(".whats-new-footer .primary")'))
    await key('Tab', 'Tab', 9, 8)
    check('Shift+Tab wraps to the secondary action', await ev('document.activeElement === document.querySelector(".whats-new-footer button:last-child")'))
    await key('Tab', 'Tab', 9)
    check('Tab wraps back to primary action', await ev('document.activeElement === document.querySelector(".whats-new-footer .primary")'))
    const locked = new DatabaseSync(join(legacy, 'rased.db'))
    try {
      locked.exec("CREATE TRIGGER reject_whats_new_save BEFORE UPDATE ON settings WHEN NEW.key='app' BEGIN SELECT RAISE(ABORT,'fixture save failure'); END")
      await key('Escape', 'Escape', 27)
      await wait('!!document.querySelector(".whats-new-dialog [role=alert]")')
      check('failed persistence retains the dialog and unseen marker for retry', await ev('!!document.querySelector(".whats-new-dialog")') && (await ev('window.rased.getSettings()')).whatsNewSeen === null)
    } finally {
      locked.exec('DROP TRIGGER IF EXISTS reject_whats_new_save')
      locked.close()
    }
    await ev('document.querySelector(".whats-new-footer .primary").focus()')
    await key('Enter', 'Enter', 13)
    await wait('!document.querySelector(".whats-new-dialog")')
    check('primary action saves current version using keyboard only', (await ev('window.rased.getSettings()')).whatsNewSeen === version)
    await reload()
    check('primary dismissal survives reload', await ev('!document.querySelector(".whats-new-dialog")'))
    await stop(); await boot(legacy)
    await ev('location.hash="#/settings/about"'); await wait('!!document.querySelector(".about-version")')
    check('primary dismissal survives restart', (await ev('window.rased.getSettings()')).whatsNewSeen === version && await ev('!document.querySelector(".whats-new-dialog")'))

    session = await persistentSession(ws)
    await session.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, deviceScaleFactor: 1, mobile: false })
    for (const language of ['ar', 'en']) for (const theme of ['dark', 'light']) {
      await ev(`(async()=>{const s=await window.rased.getSettings();await window.rased.updateSettings({language:${JSON.stringify(language)},ui:{...s.ui,textScale:125,theme:${JSON.stringify(theme)}}})})()`)
      await wait(`document.documentElement.lang===${JSON.stringify(language)}`)
      await ev('(()=>{const b=Array.from(document.querySelectorAll(".about-hero button")).find(b=>b.textContent==="ما الجديد"||b.textContent==="What\'s new");b.focus();b.click()})()')
      await wait('!!document.querySelector(".whats-new-dialog")')
      const metrics = await ev(`(()=>{
        const d=document.querySelector('.whats-new-dialog'), content=d.querySelector('.whats-new-content'), rect=d.getBoundingClientRect()
        const buttons=[...d.querySelectorAll('button')].map(b=>b.getBoundingClientRect())
        return { fits:rect.left>=0&&rect.right<=innerWidth&&rect.top>=36&&rect.bottom<=innerHeight,
          overflow:d.scrollWidth>d.clientWidth||content.scrollWidth>content.clientWidth||document.documentElement.scrollWidth>innerWidth,
          buttons:buttons.every(b=>b.left>=rect.left&&b.right<=rect.right&&b.top>=rect.top&&b.bottom<=innerHeight&&b.width>0&&b.height>0),
          dir:d.dir,scale:document.documentElement.dataset.textscale }
      })()`)
      check(`${language}/${theme} 900px/125% fits without horizontal overflow and with visible buttons`, metrics.fits && !metrics.overflow && metrics.buttons && metrics.dir === (language === 'ar' ? 'rtl' : 'ltr') && metrics.scale === '125')
      writeFileSync(join(output, `${language}-${theme}-900-125.png`), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
      await session.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      check(`${language}/${theme} reduced motion disables card animation`, await ev('getComputedStyle(document.querySelector(".whats-new-card")).animationName==="none"'))
      await ev('document.querySelector(".whats-new-footer button:last-child").click()')
      await key('Escape', 'Escape', 27); await wait('!document.querySelector(".whats-new-dialog")')
      check(`${language}/${theme} closing restores focus to About button`, await ev('document.activeElement === document.querySelector(".about-hero button")'))
    }
    check('changelog reuses only the fixed safe GitHub releases destination', readFileSync(join(legacy, 'test-trace.jsonl'), 'utf8').includes('"data":"https://github.com/deved234/rased/releases"'))
    await stop()

    const fresh = fixtureProfile(false)
    await boot(fresh)
    await wait('!!document.querySelector(".analytics-consent-actions .primary")')
    check('fresh profile silently persists current version before acceptance', (await ev('window.rased.getSettings()')).whatsNewSeen === version && await ev('!document.querySelector(".whats-new-dialog")'))
    await wait('!document.querySelector(".analytics-consent-actions .primary").disabled')
    await ev('document.querySelector(".analytics-consent-actions .primary").click()')
    await wait('!!document.querySelector(".sidebar")')
    await ev('location.hash="#/settings/about"'); await wait('!!document.querySelector(".about-version")')
    check('fresh install shows no dialog after acceptance', await ev('!document.querySelector(".whats-new-dialog")'))
    await stop(); await boot(fresh)
    await ev('location.hash="#/settings/about"'); await wait('!!document.querySelector(".about-version")')
    check('fresh install remains silent after restart', (await ev('window.rased.getSettings()')).whatsNewSeen === version && await ev('!document.querySelector(".whats-new-dialog")'))
    await stop()
    const noNotes = fixtureProfile(false, '0.0.1')
    await boot(noNotes)
    await wait('!!document.querySelector(".analytics-consent-actions .primary") && !document.querySelector(".analytics-consent-actions .primary").disabled')
    await ev('document.querySelector(".analytics-consent-actions .primary").click()')
    await wait('!!document.querySelector(".sidebar")')
    await ev('location.hash="#/settings/about"'); await wait('!!document.querySelector(".about-version")')
    await ev('window.rased.getAppInfo()')
    await ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    check('About hides manual review when all authored notes are newer than the installed version', await ev('!document.querySelector(".about-hero button") && !document.querySelector(".whats-new-dialog")'))
    console.log(`WHAT’S NEW E2E PASSED (${passed} assertions).`)
  } finally { await stop() }
}
