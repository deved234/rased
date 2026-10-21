import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

// Operations stay outside the Electron TS graph and do not enter app bundles.
const adminPath = '../scripts/analytics/admin.mjs'
const downloadsPath = '../scripts/analytics/github-downloads.mjs'
const dashboardsPath = '../scripts/analytics/dashboards.mjs'
const { administrativeClient, deleteReference, personDeletionStatus, installDashboards } = await import(adminPath)
const { installerAssets, githubSnapshots, captureSnapshots } = await import(downloadsPath)
const { dashboardDefinitions } = await import(dashboardsPath)
const cloudPath = '../scripts/analytics/cloud-qa.mjs'
const { verifyQaDestination, verifyQaMetrics, verifyReviewedQaToken, runCloudQa } = await import(cloudPath)
const destinationsPath = '../scripts/analytics/destinations.mjs'
const preflightPath = '../scripts/analytics/preflight.mjs'
const { assertReviewedIngest } = await import(destinationsPath)
const { stageProductionToken } = await import(preflightPath)

describe('Release preparation without publishing', () => {
  const token = 'phc_synthetic_fixture_never_usable'
  const targets = { production: { project: '670811', sha256: createHash('sha256').update(token).digest('hex') } }
  it('requires the reviewed environment, project and token before any operation', () => {
    expect(() => assertReviewedIngest('670811','production',token,targets)).not.toThrow()
    for (const [project,environment,value] of [['672766','production',token],['670811','qa',token],['670811','production','phc_different_fixture']]) expect(() => assertReviewedIngest(project,environment,value,targets)).toThrow('Unreviewed')
  })
  it('disables scheduling before storing only the ingest token through stdin', async () => {
    const runner = vi.fn().mockResolvedValue('')
    const result = await stageProductionToken('670811',token,runner,targets)
    expect(result).toMatchObject({ operationsReady: false, codePublished: false })
    expect(runner.mock.calls[0]).toEqual(['gh',['variable','set','RASED_ANALYTICS_OPERATIONS_READY','--body','false','--repo','deved234/rased']])
    expect(runner.mock.calls[1]).toEqual(['gh',['secret','set','RASED_POSTHOG_PROJECT_TOKEN','--repo','deved234/rased'],{input:token}])
    expect(runner.mock.calls.every(([,args]) => !JSON.stringify(args).includes(token))).toBe(true)
    runner.mockClear()
    await expect(stageProductionToken('672766',token,runner,targets)).rejects.toThrow('Unreviewed')
    expect(runner).not.toHaveBeenCalled()
  })
})

describe('Explicit synthetic cloud QA', () => {
  it('refuses production, a different project token and malformed destinations before capture', () => {
    const token = 'phc_synthetic_fixture_never_usable'
    expect(() => verifyQaDestination('672766', { id: 672766, api_token: token }, token)).not.toThrow()
    expect(() => verifyQaDestination('670811', { id: 670811, api_token: token }, token)).toThrow('refusing')
    expect(() => verifyQaDestination('672766', { id: 670811, api_token: token }, token)).toThrow('refusing')
    expect(() => verifyQaDestination('672766', { id: 672766, api_token: 'different' }, token)).toThrow('refusing')
  })
  it('refuses capture-only QA before creating a worker when the reviewed fingerprint does not match', async () => {
    expect(() => verifyReviewedQaToken('670811', 'phc_synthetic_fixture_never_usable')).toThrow('Unreviewed')
    expect(() => verifyReviewedQaToken('672766', 'phc_synthetic_fixture_never_usable')).toThrow('Unreviewed')
    await expect(runCloudQa(null, '672766', 'phc_synthetic_fixture_never_usable', 50, true)).rejects.toThrow('Unreviewed')
  })
  it('checks exact queryable counters, not only an HTTP ingestion acknowledgement', async () => {
    const reference = '11111111-2222-4333-8444-555555555555'
    const counts = { analytics_enrolled: 1, version_first_seen: 1, started: 1, active_daily: 2, project_open_result: 1, quick_apply_result: 2, proposal_result: 3, feature_used: 4, update_download_result: 1, monitoring_hourly: 1, notification_summary: 1 }
    const rows = Object.entries(counts).map(([name, n]) => ['rased.app.' + name, n, n])
    const client = vi.fn().mockResolvedValueOnce({ results: rows }).mockResolvedValueOnce({ results: [[3,3,3,3]] }).mockResolvedValueOnce({ results: [[1,1]] }).mockResolvedValueOnce({ results: [[1]] })
    expect(await verifyQaMetrics(client, reference)).toMatchObject({ eventRows: 18, activeInstallations: 1, metricsVerified: true })
    const duplicate = vi.fn().mockResolvedValue({ results: rows.map(row => [row[0], Number(row[1]) * 2, Number(row[2]) * 2]) })
    await expect(verifyQaMetrics(duplicate, reference)).rejects.toThrow()
  })
  it('verifies the larger 50-event replay fixture without weakening exact counts', async () => {
    const counts = { analytics_enrolled: 1, version_first_seen: 1, started: 1, active_daily: 2, project_open_result: 1, quick_apply_result: 2, proposal_result: 3, feature_used: 36, update_download_result: 1, monitoring_hourly: 1, notification_summary: 1 }
    const client = vi.fn().mockResolvedValueOnce({ results: Object.entries(counts).map(([name, n]) => ['rased.app.' + name, n, n]) }).mockResolvedValueOnce({ results: [[3,3,3,3]] }).mockResolvedValueOnce({ results: [[1,1]] }).mockResolvedValueOnce({ results: [[1]] })
    expect(await verifyQaMetrics(client, '11111111-2222-4333-8444-555555555555', 50)).toMatchObject({ eventRows: 50, activeInstallations: 1, metricsVerified: true })
  })
})

describe('Administrative analytics boundaries', () => {
  const person = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const reference = '11111111-2222-4333-8444-555555555555'
  it('previews the exact requested installation without deleting anything by default', async () => {
    const client = vi.fn().mockResolvedValue({ id: person, distinct_ids: [reference] })
    expect(await deleteReference(client, person, reference)).toEqual({ dryRun: true, matched: true, personId: person })
    expect(client.mock.calls).toEqual([[`/persons/${person}/`]])
  })
  it('deletes only a revalidated single-installation profile, including its events', async () => {
    const client = vi.fn().mockResolvedValueOnce({ id: 123456, uuid: person, distinct_ids: [reference] }).mockResolvedValueOnce(null)
    expect(await deleteReference(client, person, reference, true)).toMatchObject({ submitted: true, status: 'pending' })
    expect(client.mock.calls[1]).toEqual([`/persons/${person}/?delete_events=true&delete_recordings=true`, 'DELETE'])
  })
  it('rejects missing, mismatched and merged profiles before any destructive request', async () => {
    for (const value of [null, { id: person, uuid: 'ffffffff-ffff-4fff-8fff-ffffffffffff', distinct_ids: [reference] }, { id: person, distinct_ids: ['another-installation'] }, { id: person, distinct_ids: [reference, 'another-installation'] }]) {
      const client = vi.fn().mockResolvedValue(value)
      await expect(deleteReference(client, person, reference, true)).rejects.toThrow('no deletion')
      expect(client).toHaveBeenCalledTimes(1)
    }
    const client = vi.fn()
    await expect(deleteReference(client, '../invalid', reference, true)).rejects.toThrow('reviewed')
    expect(client).not.toHaveBeenCalled()
  })
  it('requires provider verification of completion rather than treating acceptance or missing rows as erased', async () => {
    const since = '2026-10-19T09:59:00.000Z'
    const row = { person_uuid: person, status: 'pending', created_at: since, delete_verified_at: null }
    expect(await personDeletionStatus(async () => ({ results: [] }), person, since)).toMatchObject({ status: 'unknown' })
    expect(await personDeletionStatus(async () => ({ results: [row] }), person, since)).toMatchObject({ status: 'pending' })
    expect(await personDeletionStatus(async () => ({ results: [{ ...row, status: 'completed', delete_verified_at: '2026-10-19T10:00:00Z' }] }), person, since)).toMatchObject({ status: 'completed' })
    expect(await personDeletionStatus(async () => ({ results: [{ ...row, status: 'completed', delete_verified_at: '2026-10-19T10:00:00Z' }] }), person, '2026-10-19T10:01:00.000Z')).toMatchObject({ status: 'unknown' })
    await expect(personDeletionStatus(async () => ({ results: [{ ...row, status: 'completed' }] }), person, since)).rejects.toThrow('Cannot verify')
    await expect(personDeletionStatus(async () => ({ results: [row], next: 'more' }), person, since)).rejects.toThrow('Cannot verify')
    const api = administrativeClient('670811', 'phx_synthetic_fixture', async () => new Response(null, { status: 202 }))
    expect(await api(`/persons/${person}/?delete_events=true`, 'DELETE')).toBeNull()
  })
  it('has no periodic deletion job and rejects the retired bulk-retention command before authentication', () => {
    const workflow = readFileSync('.github/workflows/analytics.yml', 'utf8')
    expect(workflow).not.toContain('retention:')
    expect(workflow).not.toContain('RASED_POSTHOG_RETENTION_TOKEN')
    const result = spawnSync(process.execPath, ['scripts/analytics/admin.mjs', 'retention', '--apply'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Periodic retention deletion is not supported')
  })
  it('locks administrative destination and never prints a private response body', async () => {
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({ detail: url ? 'PRIVATE_CANARY' : '' }), { status: 403 }))
    const client = administrativeClient('670811', 'phx_synthetic_fixture', fetcher)
    await expect(client('/query/')).rejects.toThrow('HTTP 403')
    try { await client('/query/') } catch (e) { expect(String(e)).not.toContain('PRIVATE_CANARY') }
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://us.posthog.com/api/projects/670811/query/')
    await expect(client('https://evil.invalid/')).rejects.toThrow('path')
    expect(() => administrativeClient('670811', 'phc_ingest')).toThrow('private')
  })
  it('keeps all four dashboards private-production metrics separate from downloads', () => {
    const definitions = dashboardDefinitions() as { name: string; insights: { name: string; sql: string }[] }[]
    expect(definitions).toHaveLength(4)
    for (const d of definitions) for (const i of d.insights) {
      expect(i.sql).toContain('production')
      if (!i.name.startsWith('GitHub') && !i.name.includes('GitHub')) expect(i.sql).toContain("record_type")
    }
    const notification = definitions.flatMap(d => d.insights).find(i => i.name === 'Notification delivery and activation')!
    expect(notification.sql).toContain('coalesce')
    const daily = definitions.flatMap(d => d.insights).find(i => i.name === 'Daily active installations')!
    expect(daily.sql).toContain('active_daily')
    expect(daily.sql).not.toContain('distribution')
    const adoption = definitions.flatMap(d => d.insights).find(i => i.name === 'Latest observed version among active installations')!
    expect(adoption.sql).toContain('distinct_id IN (SELECT distinct_id')
    for (const source of ['mostaql', 'khamsat', 'nafezly', 'kaf']) expect(definitions.flatMap(d => d.insights).find(i => i.name === source + ' monitoring')!.sql).toContain(`coalesce(toInt(properties.${source}_success),0)`)
  })
  it('builds separately named QA dashboards with no production queries and rejects free-form environments', () => {
    const qa = dashboardDefinitions('qa') as { name: string; insights: { sql: string }[] }[]
    expect(qa.every(d => d.name.startsWith('RASED QA —'))).toBe(true)
    expect(qa.every(d => d.insights.every(i => i.sql.includes("'qa'") && !i.sql.includes("'production'")))).toBe(true)
    expect(() => dashboardDefinitions('PRIVATE_CANARY')).toThrow('environment')
  })
  it('uses cloud-verified HogQL date signatures with explicit UTC conversion', () => {
    const cards = dashboardDefinitions().flatMap((d: { insights: { name: string; sql: string }[] }) => d.insights)
    for (const card of cards) {
      expect(card.sql).not.toMatch(/toDate\((?:timestamp|now\(\)|e\.first_seen),/)
      expect(card.sql).not.toContain("toStartOfHour(timestamp, 'UTC')")
      expect(card.sql).not.toContain("dateDiff('day',e.first_seen,r.timestamp,'UTC')")
    }
    expect(cards.find((c: { name: string }) => c.name === 'Daily active installations')!.sql).toContain("toDate(toTimeZone(timestamp, 'UTC'))")
  })
  it('deduplicates UUIDs before summing workflow or source counters', () => {
    const cards = dashboardDefinitions().flatMap((d: { insights: { name: string; sql: string }[] }) => d.insights)
    const summed = cards.filter((c: { sql: string }) => c.sql.includes('sum(toInt(properties.event_count))') || c.sql.includes('sum(coalesce(toInt(properties.'))
    expect(summed).toHaveLength(9)
    for (const card of summed) {
      expect(card.sql).toContain('GROUP BY raw.uuid) WHERE')
      expect(card.sql).toContain('argMax(raw.properties,raw.timestamp) AS properties')
      expect(card.sql).toContain("raw.properties.environment = 'production'")
    }
  })
  it('reconciles existing owned dashboard SQL without duplicating cards or removing unrelated tiles', async () => {
    type Insight = { id: number; name: string; query: unknown; description: string }
    type Dashboard = { id: number; name: string; is_shared: boolean; tiles: { insight: Insight }[] }
    const dashboards: Dashboard[] = []
    let insightId = 0, patches = 0, validations = 0
    const client = async (path: string, method = 'GET', body?: Record<string, unknown>): Promise<unknown> => {
      if (path === '/') return { id: 670811 }
      if (path === '/dashboards/?limit=100') return { results: dashboards }
      if (path === '/dashboards/' && method === 'POST') {
        const d = { ...body, id: dashboards.length + 1, tiles: [] } as unknown as Dashboard
        dashboards.push(d); return d
      }
      if (/^\/dashboards\/\d+\/$/.test(path)) return dashboards.find(d => d.id === Number(path.split('/')[2]))
      if (path === '/query/') { validations++; return { results: [] } }
      if (path === '/insights/' && method === 'POST') {
        const i = { ...body, id: ++insightId } as unknown as Insight
        dashboards.find(d => d.id === (body!.dashboards as number[])[0])!.tiles.push({ insight: i }); return i
      }
      if (/^\/insights\/\d+\/$/.test(path) && method === 'PATCH') {
        patches++
        const i = dashboards.flatMap(d => d.tiles).find(t => t.insight.id === Number(path.split('/')[2]))!.insight
        Object.assign(i, body); return i
      }
      throw Error('Unexpected operation')
    }
    await installDashboards(client, 'production', '670811')
    const initialCount = insightId
    dashboards[0]!.tiles[0]!.insight.query = { obsolete: true }
    dashboards[0]!.tiles.push({ insight: { id: 999, name: 'My independent card', query: {}, description: '' } })
    await installDashboards(client, 'production', '670811')
    expect(insightId).toBe(initialCount)
    expect(patches).toBe(1)
    expect(validations).toBe(initialCount * 2)
    expect(dashboards[0]!.tiles.some(t => t.insight.id === 999)).toBe(true)
    dashboards[0]!.is_shared = true
    await expect(installDashboards(client, 'production', '670811')).rejects.toThrow('shared')
  })
  it('does not publish a card when cloud query validation is still pending', async () => {
    const client = vi.fn(async (path: string) => {
      if (path === '/') return { id: 670811 }
      if (path === '/dashboards/?limit=100') return { results: [{ id: 1, name: 'RASED — Overview' }] }
      if (path === '/dashboards/1/') return { id: 1, is_shared: false, tiles: [] }
      if (path === '/query/') return { query_status: { complete: false } }
      throw Error('Unexpected mutation')
    })
    await expect(installDashboards(client, 'production', '670811')).rejects.toThrow('validation is incomplete')
    expect(client.mock.calls.map(([path]) => path).some(path => path.startsWith('/insights/'))).toBe(false)
  })
})

describe('Public download snapshots', () => {
  const asset = { name: 'RASED-Setup-0.8.1.exe', id: 1, download_count: 9 }
  it('excludes drafts, prereleases, source files, blockmaps and untrusted fields', () => {
    expect(installerAssets([{ tag_name: 'v0.8.1', assets: [asset, { ...asset, name: 'latest.yml' }, { ...asset, name: asset.name + '.blockmap' }] }])).toEqual([{ release_tag: 'v0.8.1', asset_id: 1, download_count: 9 }])
    expect(installerAssets([{ tag_name: 'v0.8.1', draft: true, assets: [asset] }, { tag_name: 'PRIVATE_CANARY', assets: [asset] }])).toEqual([])
  })
  it('follows all pages rather than reporting only the latest release', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.8.${i}`, assets: [{ ...asset, id: i + 1 }] }))))).mockResolvedValueOnce(new Response('[]'))
    expect(await githubSnapshots(fetcher)).toHaveLength(100)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('uses a separate synthetic identity and rejects injected content or quota-limited acknowledgements', async () => {
    let body = ''
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => { body = String(init.body); return new Response('{"status":"Ok"}') })
    await captureSnapshots([{ release_tag: 'v0.8.1', asset_id: 1, download_count: 9 }], 'phc_synthetic_fixture', fetcher)
    const event = JSON.parse(body).batch[0]
    expect(event.properties).toMatchObject({ record_type: 'distribution', distinct_id: 'rased-github-distribution', $process_person_profile: false })
    await captureSnapshots([{ release_tag: 'v0.8.1', asset_id: 1, download_count: 9 }], 'phc_synthetic_fixture', fetcher, new Date(), 'qa')
    expect(JSON.parse(body).batch[0].properties.environment).toBe('qa')
    await expect(captureSnapshots([], 'phc_synthetic_fixture', fetcher, new Date(), 'untrusted')).rejects.toThrow('environment')
    await expect(captureSnapshots([{ release_tag: 'v0.8.1', asset_id: 1, download_count: 9, title: 'PRIVATE_CANARY' }], 'phc_synthetic_fixture', fetcher)).rejects.toThrow('Invalid')
    await expect(captureSnapshots([{ release_tag: 'v0.8.1', asset_id: 1, download_count: 9 }], 'phc_synthetic_fixture', async () => new Response('{"status":"Ok","quota_limited":["events"]}'))).rejects.toThrow('acknowledge')
  })
})
