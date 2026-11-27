// Invoked by test:ui. All versions, consent transport and profiles are fixtures.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { call, evaluate, eventually, newProfile, pageWs, persistentSession, settles, sleep, startApp, stopApp, electronPath } from './cdp-tools.mjs'

export async function testWhatsNew(exeOverride) {
  const version = '0.12.1' // Injected through the marked TEMP harness, independent of package.json.
  const port = 9394, output = resolve('.local/whats-new/screenshots')
  mkdirSync(output, { recursive: true })
  let child, ws, session, passed = 0
  const check = (label, condition) => { assert.ok(condition, label); passed++; console.log('PASS what’s new: ' + label) }
  const ev = expression => evaluate(ws, expression)
  const wait = expression => eventually(() => ev(expression))
  // Frames stop being produced when the harness window is not really visible, so never wait on rAF alone:
  // resolve after two frames, or after 150 ms when the compositor is frozen.
  const paint = () => ev('new Promise(resolve=>{const t=setTimeout(resolve,150);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(t);resolve()}))})')
  const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    const params = { key, code, windowsVirtualKeyCode, modifiers }
    const text = key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}
    await call(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...text })
    await call(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  }
  const fixtureProfile = (legacy, installedVersion = version) => {
    const profile = newProfile()
    // Every scenario, including fresh installs and their restarts, must retain the real upgrade behavior.
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
    child = startApp({ exe: exeOverride ?? electronPath(), app: 'out/main/index.js', profile, port })
    ws = await pageWs(port)
    await wait('!!window.rased && !!document.querySelector(".splash")')
    await wait('document.querySelector(".splash")?.dataset.phase === "ready"')
    check('splash precedes the dialog', await settles(() => ev('!document.querySelector(".whats-new-dialog")')))
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
    await paint()
  }
  try {
    const legacy = fixtureProfile(true)
    await boot(legacy)
    await wait('!!document.querySelector(".analytics-consent-actions .primary")')
    check('legacy settings without marker stay behind acceptance', await ev('!document.querySelector(".whats-new-dialog") && !document.querySelector(".sidebar") && !!document.querySelector(".analytics-access")') && (await ev('window.rased.getSettings()')).whatsNewSeen === null)
    await wait('!document.querySelector(".analytics-consent-actions .primary").disabled')
    await ev('document.querySelector(".analytics-consent-actions .primary").click()')
    await wait('!!document.querySelector(".whats-new-dialog")')
    check('0.12.1 fixes lead, then 0.12.0 project watch and 0.11.0 profiles',await settles(() => ev('(()=>{const d=document.querySelector(".whats-new-dialog").textContent;return d.indexOf("متابعة مستقل تعمل الآن")>=0 && d.indexOf("متابعة مستقل تعمل الآن")<d.indexOf("تابع مشاريعك") && d.indexOf("تابع مشاريعك")<d.indexOf("ملفات مهنية متعددة") && document.querySelectorAll(".whats-new-card").length===10})()')))
    check('acceptance reveals the upgrade dialog over the inert workspace', await settles(() => ev('!document.querySelector(".analytics-access") && document.querySelector(".app").inert && document.querySelector(".whats-new-dialog").getAttribute("aria-modal")==="true" && document.querySelector(".whats-new-dialog").getAttribute("role")==="dialog"')))
    await ev('window.rased.openCompact()')
    const compact = await pageWs(port, target => target.url.includes('compact'))
    await eventually(() => evaluate(compact, '!!document.querySelector(".compact")'))
    check('compact window never mounts the dialog', await evaluate(compact, '!document.querySelector(".whats-new-dialog")'))
    await ev('window.rased.closeCompact()')
    // The harness spawns Electron with windowsHide, so the main window may never have been really
    // visible; closing the compact window then makes Chromium mark the page hidden and freeze rAF.
    // windowControl('maximize') is the only existing preload action that surfaces the main window
    // without navigating (showProjectInMain also sends a #/project/:id navigate). The test window is
    // disposable and its viewport is pinned later by Emulation.setDeviceMetricsOverride.
    await ev('window.rased.windowControl("maximize")')
    await sleep(600)
    await wait('document.visibilityState === "visible"')
    await key('Escape', 'Escape', 27)
    await wait('!document.querySelector(".whats-new-dialog")')
    check('Escape persists the fixture current version', (await ev('window.rased.getSettings()')).whatsNewSeen === version)
    await ev('location.hash="#/settings/about"')
    await wait('!!document.querySelector(".about-version")')
    await reload()
    check('Escape dismissal survives renderer reload', await settles(() => ev('!document.querySelector(".whats-new-dialog")')))
    await stop(); await boot(legacy)
    await wait('!!document.querySelector(".about-version") || !!document.querySelector(".sidebar")')
    await ev('location.hash="#/settings/about"')
    await wait('!!document.querySelector(".about-version")')
    check('Escape dismissal survives process restart', (await ev('window.rased.getSettings()')).whatsNewSeen === version && await ev('!document.querySelector(".whats-new-dialog")'))

    // Simulate the next unseen upgrade, then exercise the primary close path.
    await ev('window.rased.updateSettings({whatsNewSeen:null})')
    await wait('!!document.querySelector(".whats-new-dialog")')
    check('focus starts at the primary action', await settles(() => ev('document.activeElement === document.querySelector(".whats-new-footer .primary")')))
    const modalRoute = await ev('location.hash')
    await key('k', 'KeyK', 75, 2)
    await paint()
    check('Ctrl+K cannot navigate or move focus into the inert workspace', await ev('location.hash') === modalRoute && await ev('document.activeElement === document.querySelector(".whats-new-footer .primary")'))
    await key('Tab', 'Tab', 9, 8)
    check('Shift+Tab moves to the community group button', await settles(() => ev('document.activeElement === document.querySelectorAll(".whats-new-community button")[1]')))
    await key('Tab', 'Tab', 9)
    check('Tab wraps back to primary action', await settles(() => ev('document.activeElement === document.querySelector(".whats-new-footer .primary")')))
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
    check('primary dismissal survives reload', await settles(() => ev('!document.querySelector(".whats-new-dialog")')))
    await stop(); await boot(legacy)
    await ev('location.hash="#/settings/about"'); await wait('!!document.querySelector(".about-version")')
    check('primary dismissal survives restart', (await ev('window.rased.getSettings()')).whatsNewSeen === version && await ev('!document.querySelector(".whats-new-dialog")'))

    session = await persistentSession(ws)
    await session.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, deviceScaleFactor: 1, mobile: false })
    for (const language of ['ar', 'en']) for (const theme of ['dark', 'light']) {
      await ev(`(async()=>{const s=await window.rased.getSettings();await window.rased.updateSettings({language:${JSON.stringify(language)},ui:{...s.ui,textScale:125,theme:${JSON.stringify(theme)}}})})()`)
      await wait(`document.documentElement.lang===${JSON.stringify(language)}`)
      const aboutCommunity = await ev(`(()=>{const h=document.getElementById('about-community-title');const s=h?.closest('section');const b=[...s?.querySelectorAll('button')??[]];return {dir:document.documentElement.dir,title:h?.textContent,body:s?.querySelector('p')?.textContent,buttons:b.map(x=>x.textContent?.replace(/\\s+/g,' ').trim())}})()`)
      check(`${language}/${theme} About community section shows both buttons`, aboutCommunity.dir === (language === 'ar' ? 'rtl' : 'ltr') && aboutCommunity.title === (language === 'ar' ? 'مجتمع راصد' : 'RASED community') && aboutCommunity.body === (language === 'ar' ? 'أخبار الإصدارات في القناة، والأسئلة والاقتراحات في الجروب.' : 'Release news in the channel; questions and suggestions in the group.') && aboutCommunity.buttons[0].startsWith(language === 'ar' ? 'القناة' : 'Channel') && aboutCommunity.buttons[1].startsWith(language === 'ar' ? 'الجروب' : 'Group'))
      await ev(`(()=>{const s=document.getElementById('about-community-title').closest('section');s.querySelectorAll('button')[0].click();s.querySelectorAll('button')[1].click()})()`)
      await eventually(() => {
        const traces = readFileSync(join(legacy, 'test-trace.jsonl'), 'utf8')
        return traces.includes('"kind":"open-external","data":"https://t.me/rased_app"') && traces.includes('"kind":"open-external","data":"https://t.me/rased_chat"')
      })
      check(`${language}/${theme} About community buttons record exact external URLs`, readFileSync(join(legacy, 'test-trace.jsonl'), 'utf8').includes('"kind":"open-external","data":"https://t.me/rased_app"') && readFileSync(join(legacy, 'test-trace.jsonl'), 'utf8').includes('"kind":"open-external","data":"https://t.me/rased_chat"'))
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
      const community = await ev(`(()=>{const s=document.querySelector('.whats-new-community');const b=[...s.querySelectorAll('button')];return {title:s.querySelector('h3')?.textContent,body:s.querySelector('p')?.textContent,buttons:b.map(x=>x.textContent?.replace(/\\s+/g,' ').trim()),hrefs:b.length}})()`)
      check(`${language}/${theme} 900px/125% fits without horizontal overflow and with visible buttons`, metrics.fits && !metrics.overflow && metrics.buttons && metrics.dir === (language === 'ar' ? 'rtl' : 'ltr') && metrics.scale === '125')
      check(`${language}/${theme} WhatsNew community section shows both buttons`, community.hrefs === 2 && community.title === (language === 'ar' ? 'تابع راصد على تليجرام' : 'Follow RASED on Telegram') && community.body === (language === 'ar' ? 'أخبار الإصدارات في القناة، والأسئلة والاقتراحات في الجروب.' : 'Release news in the channel; questions and suggestions in the group.') && community.buttons[0].startsWith(language === 'ar' ? 'القناة' : 'Channel') && community.buttons[1].startsWith(language === 'ar' ? 'الجروب' : 'Group'))
      const tracesBefore = readFileSync(join(legacy, 'test-trace.jsonl'), 'utf8')
      await ev(`document.querySelectorAll('.whats-new-community button')[0].click()`)
      await ev(`document.querySelectorAll('.whats-new-community button')[1].click()`)
      await eventually(() => {
        const traces = readFileSync(join(legacy, 'test-trace.jsonl'), 'utf8')
        return traces.length > tracesBefore.length && traces.includes('"data":"https://t.me/rased_app"') && traces.includes('"data":"https://t.me/rased_chat"')
      })
      check(`${language}/${theme} WhatsNew community buttons record exact external URLs`, readFileSync(join(legacy, 'test-trace.jsonl'), 'utf8').includes('"kind":"open-external","data":"https://t.me/rased_app"') && readFileSync(join(legacy, 'test-trace.jsonl'), 'utf8').includes('"kind":"open-external","data":"https://t.me/rased_chat"'))
      writeFileSync(join(output, `${language}-${theme}-900-125.png`), Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
      await session.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      check(`${language}/${theme} reduced motion disables card animation`, await settles(() => ev('getComputedStyle(document.querySelector(".whats-new-card")).animationName==="none"')))
      await ev('document.querySelector(".whats-new-footer button:last-child").click()')
      await key('Escape', 'Escape', 27); await wait('!document.querySelector(".whats-new-dialog")')
      // Focus returns just after the dialog unmounts; wait for it (seen late on Ubuntu CI).
      check(`${language}/${theme} closing restores focus to About button`, await eventually(() => ev('document.activeElement === document.querySelector(".about-hero button")')).then(() => true, () => false))
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
    check('fresh profile silently persists current version before acceptance', (await ev('window.rased.getSettings()')).whatsNewSeen === version && await ev('!document.querySelector(".whats-new-dialog")'))
    await ev('location.hash="#/settings/about"'); await wait('!!document.querySelector(".about-version")')
    check('fresh install shows no dialog after acceptance', await settles(() => ev('!document.querySelector(".whats-new-dialog")')))
    await ev('(()=>{const b=Array.from(document.querySelectorAll(".about-hero button")).find(b=>b.textContent==="ما الجديد"||b.textContent==="What\'s new");b.click()})()')
    await wait('!!document.querySelector(".whats-new-dialog")')
    await ev('document.querySelector(".whats-new-footer .primary").click()')
    await wait('!document.querySelector(".whats-new-dialog")')
    await wait('!!document.querySelector(".community-invite-banner")')
    check('community invite appears once on a fresh profile after What’s New is closed', await ev('(()=>{const b=document.querySelector(".community-invite-banner");const text=b?.textContent||"";const buttons=[...b?.querySelectorAll("button")||[]].map(x=>x.textContent||"");return !!b && b.getAttribute("role")==="region" && (text.includes("انضم لمجتمع راصد على تليجرام") || text.includes("Join the RASED community on Telegram")) && buttons.some(x=>x.includes("القناة")||x.includes("Channel")) && buttons.some(x=>x.includes("الجروب")||x.includes("Group")) && buttons.some(x=>x.includes("مش دلوقتي")||x.includes("Not now"))})()'))
    await ev('window.rased.openCompact()')
    const freshCompact = await pageWs(port, target => target.url.includes('compact'))
    await eventually(() => evaluate(freshCompact, '!!document.querySelector(".compact")'))
    check('community invite is absent in the compact window', await evaluate(freshCompact, '!document.querySelector(".community-invite-banner")'))
    await ev('window.rased.closeCompact()')
    await ev('window.rased.windowControl("maximize")')
    await sleep(600)
    await wait('document.visibilityState === "visible"')
    await ev('(()=>{const b=document.querySelector(".community-invite-banner");Array.from(b.querySelectorAll("button")).find(x=>x.textContent.includes("Not now")||x.textContent.includes("مش دلوقتي")).click()})()')
    await wait('!document.querySelector(".community-invite-banner")')
    check('Not now hides the community invite', (await ev('window.rased.getSettings()')).ui.communityInviteSeen === true)
    await stop(); await boot(fresh)
    await ev('location.hash="#/settings/about"'); await wait('!!document.querySelector(".about-version")')
    await paint()
    check('community invite stays hidden after a real restart', await settles(() => ev('!document.querySelector(".community-invite-banner") && (window.rased.getSettings ? true : true)')) && (await ev('window.rased.getSettings()')).ui.communityInviteSeen === true)
    check('fresh install remains silent after restart', (await ev('window.rased.getSettings()')).whatsNewSeen === version && await ev('!document.querySelector(".whats-new-dialog")'))
    await stop()
    const noNotes = fixtureProfile(false, '0.0.1')
    await boot(noNotes)
    await wait('!!document.querySelector(".analytics-consent-actions .primary") && !document.querySelector(".analytics-consent-actions .primary").disabled')
    await ev('document.querySelector(".analytics-consent-actions .primary").click()')
    await wait('!!document.querySelector(".sidebar")')
    await ev('location.hash="#/settings/about"'); await wait('!!document.querySelector(".about-version")')
    await ev('window.rased.getAppInfo()')
    await paint()
    check('About hides manual review when all authored notes are newer than the installed version', await settles(() => ev('!document.querySelector(".about-hero button") && !document.querySelector(".whats-new-dialog")')))
    console.log(`WHAT’S NEW E2E PASSED (${passed} assertions).`)
  } finally { await stop() }
}
