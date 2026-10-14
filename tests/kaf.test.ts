import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchKafHtml, fetchKafPage, kafBudget, matchesKafKeywords, parseKafList } from '../src/collector/kaf.js'
import { parseKafDetails } from '../src/collector/kafDetails.js'
import { applyKafCycle } from '../src/collector/kafCycle.js'
import { KafController } from '../src/main/kaf.js'
import { isAllowedProjectUrl, resolveProjectUrl } from '../src/main/links.js'
import { defaultFilterDefinition, defaultSettings, sanitizeFilterDefinition, sanitizeSettings } from '../src/shared/types.js'
import { mergeSettings } from '../src/main/policies.js'
import { openDatabase, type Db } from '../src/storage/db.js'
import { getProjectById, getProjectDetailsRow, getSettingRaw, getSourceState, listEventsByStatus, purgeHistory, queryProjectsPage, setSettingRaw } from '../src/storage/repositories.js'

const list = readFileSync('tests/fixtures/kaf-list.html', 'utf8')
const detail = readFileSync('tests/fixtures/kaf-detail.html', 'utf8')
const page = (ids: number[], next = false): string => '<div id="projects">' + ids.map(id => `<div class="project-box"><a href="https://kafiil.com/project/${id}-sample">React ${id}<span class="tag">مفتوح</span></a><span><i class="far fa-clock"></i>منذ دقيقة</span><p class="price">$25 - $50</p><p class="info-content">وصف تجريبي</p></div>`).join('') + '</div>' + (next ? '<a page="2">2</a><a page="3">3</a><a page="4">4</a><a page="5">5</a><a page="6">6</a>' : '')
const htmlResponse = (text: string, status = 200, headers = {}): Response => new Response(text, { status, headers: { 'content-type': 'text/html', ...headers } })
let db: Db, dir: string
const database = (): Db => { dir = mkdtempSync(join(tmpdir(), 'rased-kaf-unit-')); db = openDatabase(join(dir, 'test.db')); return db }
afterEach(() => { vi.useRealTimers(); if (db?.isOpen) db.close(); if (dir) rmSync(dir, { recursive: true, force: true }) })
const opts = (nowMs: number, checkpoint: { anchorIds: string[]; cursor: number } | null = null) => ({ nowMs, checkpoint, settings: defaultSettings(), runId: 'test', durationMs: 30, firstPageIds: ['300', '299'] })

describe('KAF verified public content', () => {
  it('reads actual list fields without inventing a publication timestamp', () => {
    const items = parseKafList(list)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ externalId: '300', title: 'تطوير واجهة React', platformStatus: 'open', budgetMin: 25, budgetMax: 50, publishedAt: null, publishedRaw: 'منذ ساعتين', skills: ['React', 'TypeScript'] })
    expect(items[1]?.platformStatus).toBe('completed')
    expect(parseKafList(list.replace('مفتوح', 'حالة جديدة'))[0]?.platformStatus).toBe('unknown')
    expect(kafBudget('$50 - $25')).toEqual({ min: null, max: null })
    expect(kafBudget('unknown')).toEqual({ min: null, max: null })
  })
  it('rejects malformed cards, empty/challenge content and spoofed destinations', () => {
    for (const input of ['<html>challenge</html>', '<div id="projects"></div>', list.replace('kafiil.com/project/300', 'evil.example/project/300'), list.replace('far fa-clock', 'changed'), list.replace('project/299', 'project/300')]) expect(() => parseKafList(input)).toThrow()
    for (const url of ['http://kafiil.com/project/300', 'https://kafiil.com:444/project/300', 'https://kafiil.com.evil.com/project/300', 'https://a@kafiil.com/project/300', 'https://kafiil.com/project/0', 'https://kafiil.com/project/300?x=1', 'https://kafiil.com/project/300#x']) expect(isAllowedProjectUrl(url)).toBe(false)
    expect(isAllowedProjectUrl('https://kafiil.com/project/300-sample')).toBe(true)
  })
  it('reads only the description block and header timestamp, with precise duration or raw fallback', () => {
    const result = parseKafDetails(detail)
    expect(result).toMatchObject({ categoryName: 'برمجة وتطوير', durationDays: 5, publicationRaw: '2026-10-14 09:37:20', budgetMin: 25, budgetMax: 50, truncated: false })
    expect(result.text).not.toMatch(/evil|منافس|page_created_at/)
    expect(parseKafDetails(detail.replace('البيانات تجريبية.</p>', 'البيانات تجريبية.</p><div><p>فقرة إضافية داخل التفاصيل</p></div>')).text).toContain('فقرة إضافية داخل التفاصيل')
    expect(parseKafDetails(detail.replace('5 أيام', '2 أسابيع')).durationDays).toBe(14)
    expect(parseKafDetails(detail.replace('5 أيام', '1 شهر'))).toMatchObject({ durationDays: null, durationRaw: '1 شهر' })
    expect(() => parseKafDetails('<html><p>login</p></html>')).toThrow()
    expect(parseKafDetails(detail.replace('مطلوب تطوير واجهة React.', 'x'.repeat(21000))).truncated).toBe(true)
  })
  it('limits transport and never falls back after an access rejection', async () => {
    for (const [status, kind] of [[403, 'forbidden'], [429, 'rate_limited'], [503, 'http5xx']] as const) {
      const f = vi.fn(async () => htmlResponse('denied', status, { 'retry-after': '120' }))
      await expect(fetchKafPage(1, new AbortController().signal, f)).rejects.toMatchObject({ kind, retryAfterMs: 120000 })
      expect(f).toHaveBeenCalledTimes(1)
    }
    await expect(fetchKafHtml('https://kafiil.com/projects?sort=latest&page=1', new AbortController().signal, true, async () => htmlResponse('x'.repeat(1048577)))).rejects.toMatchObject({ kind: 'too_large' })
    await expect(fetchKafPage(1, new AbortController().signal, async () => htmlResponse('<title>Just a moment</title>'))).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(fetchKafPage(1, new AbortController().signal, async () => new Response('{}', { headers: { 'content-type': 'application/json' } }))).rejects.toMatchObject({ kind: 'invalid_content' })
    const fallback = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => htmlResponse((init?.headers as Record<string, string>)['X-Requested-With'] ? '<div id="projects">changed fragment</div>' : '<html>' + list + '</html>'))
    expect((await fetchKafPage(1, new AbortController().signal, fallback)).items).toHaveLength(2)
    expect(fallback).toHaveBeenCalledTimes(2)
    expect(fallback.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Cookie')
  })
})

describe('KAF storage and notifications', () => {
  it('keeps baseline silent, accepts unseen lower IDs, suppresses duplicates/closed items and preserves user data', () => {
    database()
    const first = applyKafCycle(db, parseKafList(list), opts(100000))
    expect(first.notifyIds).toHaveLength(0)
    db.prepare("INSERT INTO project_user_state(project_id,saved_at,personal_status,note,updated_at) VALUES(?,?,'interested','keep',?)").run(first.insertedIds[0]!, 'a', 'a')
    const next = applyKafCycle(db, parseKafList(page([298, 300])), opts(105000))
    expect(next.notifyIds).toHaveLength(1)
    expect(getProjectById(db, next.notifyIds[0]!)?.externalId).toBe('298')
    expect(applyKafCycle(db, parseKafList(page([298, 300])), opts(110000)).notifyIds).toHaveLength(0)
    const row = db.prepare('SELECT * FROM project_user_state WHERE project_id=?').get(first.insertedIds[0]!)
    expect(row).toMatchObject({ note: 'keep', personal_status: 'interested', saved_at: 'a' })
    expect(applyKafCycle(db, parseKafList(page([301]).replace('مفتوح', 'مكتمل')), opts(115000)).notifyIds).toHaveLength(0)
    expect(listEventsByStatus(db, 'pending')).toHaveLength(1)
    expect(queryProjectsPage(db, { ...defaultFilterDefinition(), source: 'kaf', budgetMin: 40 }, { limit: 20, offset: 0 }).total).toBe(4)
    expect(queryProjectsPage(db, { ...defaultFilterDefinition(), categoryFilter: { ...defaultFilterDefinition().categoryFilter, mode: 'selected', categories: ['development'] } }, { limit: 20, offset: 0 }).total).toBe(0)
  })
  it('suppresses recovered bursts through the final checkpoint cycle and after a long gap', () => {
    database(); applyKafCycle(db, parseKafList(page([300])), opts(100000))
    expect(applyKafCycle(db, parseKafList(page([310])), opts(105000, { anchorIds: ['300'], cursor: 4 })).notifyIds).toHaveLength(0)
    expect(applyKafCycle(db, parseKafList(page([309, 300])), opts(110000)).notifyIds).toHaveLength(0)
    expect(getProjectById(db, 3)?.discoveryKind).toBe('recovered')
    expect(applyKafCycle(db, parseKafList(page([311])), opts(200000)).notifyIds).toHaveLength(0)
  })
  it('applies source keywords, DND and mute before creating events; ignores Mostaql category rules', () => {
    database(); applyKafCycle(db, parseKafList(page([300])), opts(100000))
    const config = opts(105000); config.settings.kafExcludeKeywords = ['react']
    expect(applyKafCycle(db, parseKafList(page([301])), config).notifyIds).toHaveLength(0)
    config.settings.kafExcludeKeywords = []; config.settings.kafKeywordsAny = ['تصميم']
    expect(applyKafCycle(db, parseKafList(page([302])), config).notifyIds).toHaveLength(0)
    config.settings.kafKeywordsAny = []; config.settings.kafNotificationsEnabled = false
    expect(applyKafCycle(db, parseKafList(page([303])), config).notifyIds).toHaveLength(0)
    config.settings.kafNotificationsEnabled = true; config.settings.doNotDisturbUntil = new Date(200000).toISOString()
    expect(applyKafCycle(db, parseKafList(page([304])), config).notifyIds).toHaveLength(0)
    config.settings.doNotDisturbUntil = null; config.settings.notifyFilter.mode = 'selected'; config.settings.notifyFilter.categories = ['design']
    expect(applyKafCycle(db, parseKafList(page([305])), config).notifyIds).toHaveLength(1)
    expect(matchesKafKeywords('مطلوب واجهة', 'React', ['واجهة'], ['angular'])).toBe(true)
    expect(sanitizeSettings({ kafEnabled: false, kafKeywordsAny: [' React ', '', 'React'] })).toMatchObject({ kafEnabled: false, kafKeywordsAny: ['React'] })
    expect(sanitizeFilterDefinition({ source: 'kaf' }).source).toBe('kaf')
    const s = defaultSettings(); s.linkDisplayAndNotifyFilters = true; s.notifyFilter.categories = ['design']
    expect(mergeSettings(s, { displayQuery: { ...defaultFilterDefinition(), source: 'kaf' } }).notifyFilter.categories).toEqual(['design'])
  })
  it('rolls back the entire cycle on persistence failure', () => {
    database(); db.exec("CREATE TRIGGER fail_kaf BEFORE INSERT ON source_state BEGIN SELECT RAISE(ABORT,'test failure'); END;")
    expect(() => applyKafCycle(db, parseKafList(list), opts(100000))).toThrow()
    expect(db.prepare('SELECT count(*) AS n FROM projects').get()).toMatchObject({ n: 0 })
    expect(getSettingRaw(db, 'kaf:last-list-ids')).toBeNull()
  })
  it('respects source-specific tombstones and keeps removed history from reappearing', () => {
    database(); applyKafCycle(db, parseKafList(list), opts(100000))
    expect(purgeHistory(db, new Date(200000).toISOString(), ['initial']).deleted).toBe(2)
    expect(applyKafCycle(db, parseKafList(list), opts(105000)).insertedIds).toHaveLength(0)
    expect(queryProjectsPage(db, { ...defaultFilterDefinition(), source: 'kaf' }, { limit: 50, offset: 0 }).total).toBe(0)
    expect(db.prepare("SELECT count(*) AS n FROM tombstones WHERE source='kaf'").get()).toMatchObject({ n: 2 })
  })
})

describe('KAF scheduler and on-demand detail wiring', () => {
  const controller = (fetchImpl: typeof fetch, settings = defaultSettings()): KafController => new KafController({ db: () => db, settings: () => settings, health: () => {}, projects: () => {}, details: () => {}, flush: async () => {}, runId: 'test', fetchImpl, random: () => 0 })
  it('bounds catch-up pages, persists its cursor and continues it even when the head contains known IDs', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000); database()
    let phase = 0
    const pages: number[] = []
    const c = controller(async url => { const n = Number(new URL(String(url)).searchParams.get('page')); pages.push(n); return htmlResponse(phase === 0 ? page([300]) : phase === 1 ? page([400 - n], true) : n === 1 ? page([399], true) : page([300])) })
    await c.poll(); phase = 1; vi.setSystemTime(105000); await c.poll()
    expect(pages).toEqual([1, 1, 2, 3])
    expect(JSON.parse(getSettingRaw(db, 'kaf:checkpoint')!)).toMatchObject({ cursor: 4, anchorIds: ['300'] })
    phase = 2; vi.setSystemTime(110000); await c.poll(); expect(pages.slice(-2)).toEqual([1, 4])
    expect(getSettingRaw(db, 'kaf:checkpoint')).toBe('null'); expect(listEventsByStatus(db, 'pending')).toHaveLength(0)
    await c.close()
  })
  it('cancels in-flight reads, prevents overlap and late writes, and preserves backoff on restart', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000); database()
    let release!: (r: Response) => void
    const f = vi.fn(() => new Promise<Response>(resolve => { release = resolve }))
    const c = controller(f), work = c.poll(); expect(c.poll()).toBe(work)
    c.setPaused(true); release(htmlResponse(list)); await work
    expect(getSourceState(db, 'kaf').baselineComplete).toBe(false); expect(f).toHaveBeenCalledTimes(1)
    await c.close()
    const failure = vi.fn(async () => htmlResponse('', 429, { 'retry-after': '120' }))
    const failed = controller(failure); await failed.poll(); await failed.close()
    const reopened = controller(failure); reopened.start(); await vi.advanceTimersByTimeAsync(10000)
    expect(failure).toHaveBeenCalledTimes(1); expect(reopened.health().state).toBe('backing-off'); await reopened.close()
  })
  it('fetches details once, preserves cache and raw timestamp, and shares protection cooldown with polling', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000); database(); applyKafCycle(db, parseKafList(list), opts(100000))
    let deny = false
    const f = vi.fn(async () => htmlResponse(deny ? '' : detail, deny ? 403 : 200)), c = controller(f)
    c.requestDetails(1, false); c.requestDetails(1, false)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1); expect(getProjectDetailsRow(db, 1).status).toBe('ready')
    expect(getProjectById(db, 1)).toMatchObject({ durationDays: 5, categoryName: 'برمجة وتطوير', publishedAt: null, publishedRaw: '2026-10-14 09:37:20' })
    applyKafCycle(db, parseKafList(list), opts(101000)); expect(getProjectById(db, 1)?.publishedRaw).toBe('2026-10-14 09:37:20')
    vi.setSystemTime(110000); deny = true; c.requestDetails(1, true); await vi.advanceTimersByTimeAsync(0)
    expect(getProjectDetailsRow(db, 1).text).toContain('React'); expect(c.health().state).toBe('needs-review')
    await c.poll(); expect(f).toHaveBeenCalledTimes(2); await c.close()
    db.prepare('UPDATE projects SET url=? WHERE id=1').run('https://kafiil.com/project/999-sample')
    expect(resolveProjectUrl(db, 1)).toBeNull()
  })
  it('keeps refresh and unrelated settings changes from causing a request burst', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000); database()
    const f = vi.fn(async () => htmlResponse(page([300]))), c = controller(f)
    await c.poll(); c.settingsChanged(); await c.poll(); c.setPaused(true); c.setPaused(false)
    await vi.advanceTimersByTimeAsync(4999); expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1); expect(f).toHaveBeenCalledTimes(2); await c.close()
  })
  it('honors persisted cooldown before manual refresh or detail fetch', async () => {
    database(); applyKafCycle(db, parseKafList(list), opts(Date.now()))
    db.prepare("UPDATE source_state SET backoff_until=?,last_error='kaf-forbidden-403' WHERE source='kaf'").run(new Date(Date.now() + 300000).toISOString())
    setSettingRaw(db, 'kaf:checkpoint', 'null')
    const f = vi.fn(async () => htmlResponse(detail)), c = controller(f)
    await c.poll(); c.requestDetails(1, true); expect(f).not.toHaveBeenCalled(); expect(c.health().state).toBe('needs-review'); await c.close()
  })
  it.each(['sleep', 'close'] as const)('aborts an active detail read on %s and never saves its late text', async action => {
    database(); applyKafCycle(db, parseKafList(list), opts(Date.now()))
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const c = controller(f); c.requestDetails(1, false)
    if (action === 'sleep') c.sleep()
    await c.close()
    expect(f).toHaveBeenCalledTimes(1)
    expect(getProjectDetailsRow(db, 1)).toMatchObject({ text: null, status: 'not_requested', errorCode: 'interrupted' })
  })
})
