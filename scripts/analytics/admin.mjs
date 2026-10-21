// Administrative tooling only. Never imported by Electron or bundled for users.
import { pathToFileURL } from 'node:url'
import { dashboardDefinitions } from './dashboards.mjs'

const HOST = 'https://us.posthog.com'
export function projectId(value) { if (!/^\d{1,12}$/.test(value ?? '')) throw Error('Set POSTHOG_PROJECT_ID'); return value }
export function administrativeClient(project, token, fetcher = fetch) {
  projectId(project)
  if (!token || !/^ph[xs]_/.test(token)) throw Error('A private administrative token is required; never use the project ingest token')
  return async (path, method = 'GET', body) => {
    if (!/^\/[a-z0-9_/-]*(?:\?[a-z0-9_=&%-]+)?$/i.test(path)) throw Error('Invalid administrative path')
    const response = await fetcher(`${HOST}/api/projects/${project}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), redirect: 'error' })
    if (!response.ok) {
      let reason = ''
      try {
        const error = await response.json()
        if (error.detail === 'This endpoint is in alpha and is not yet publicly available.') reason = ' — the deletion API is not enabled for this project'
        else if (error.code === 'permission_denied') reason = ' — permission denied (check the scoped key and project access)'
        else if (error.type === 'validation_error') reason = ' — request validation failed'
      } catch { /* Never echo provider responses or credentials. */ }
      const route = path.split('/')[1] || 'project'
      throw Error(`PostHog administrative request failed: ${method} /${route}/ HTTP ${response.status}${reason}; no response content logged`)
    }
    const text = await response.text()
    if (!text.trim()) return null
    try { return JSON.parse(text) } catch { throw Error('Invalid administrative JSON response; no content logged') }
  }
}
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
export async function deleteReference(client, personId, reference, apply = false) {
  if (!uuid(personId) || !uuid(reference)) throw Error('Pass the reviewed person UUID and installation reference')
  // Resolve the reviewed person again immediately before deletion. A merged
  // profile may include another installation and requires manual investigation.
  const person = await client(`/persons/${personId}/`)
  // The person detail API returns a numeric legacy id as well as its UUID.
  // Requests and deletion status use the UUID, never the numeric legacy id.
  if ((person?.uuid ?? person?.id) !== personId || !Array.isArray(person.distinct_ids) || person.distinct_ids.length !== 1 || person.distinct_ids[0] !== reference) throw Error('Reference mismatch or merged profile; no deletion requested')
  if (!apply) return { dryRun: true, matched: true, personId }
  const requestedAt = new Date().toISOString()
  await client(`/persons/${personId}/?delete_events=true&delete_recordings=true`, 'DELETE')
  return { submitted: true, personId, status: 'pending', requestedAt }
}
export async function personDeletionStatus(client, personId, requestedAt) {
  if (!uuid(personId) || typeof requestedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(requestedAt) || !Number.isFinite(Date.parse(requestedAt))) throw Error('Pass the reviewed person UUID and the request timestamp via --since')
  const result = await client(`/persons/deletion_status/?person_uuid=${personId}&status=all`)
  if (!Array.isArray(result?.results) || result.next || result.results.some(row => row.person_uuid !== personId || !['pending','completed'].includes(row.status) || !Number.isFinite(Date.parse(row.created_at)) || (row.status === 'completed' && (!Number.isFinite(Date.parse(row.delete_verified_at)) || Date.parse(row.delete_verified_at) < Date.parse(row.created_at))))) throw Error('Cannot verify person deletion status')
  // A missing row is unknown, never proof of deletion. Check the provider's
  // verification timestamp; DELETE acceptance alone does not prove erasure.
  const current = result.results.filter(row => Date.parse(row.created_at) >= Date.parse(requestedAt))
  if (!current.length) return { personId, status: 'unknown' }
  if (current.some(row => row.status === 'pending')) return { personId, status: 'pending' }
  return { personId, status: 'completed', verifiedAt: current.map(row => row.delete_verified_at).sort().at(-1) }
}
export function assertDashboardTarget(project, environment, details) {
  projectId(project)
  if (!['production', 'qa'].includes(environment) || String(details?.id) !== project || (environment === 'production' ? project !== '670811' : project === '670811')) throw Error('Dashboard project/environment mismatch; no writes permitted')
}
export async function installDashboards(client, environment = 'production', project) {
  // This guard is shared by the CLI and loopback form, before any query POST.
  assertDashboardTarget(project, environment, await client('/'))
  const definitions = dashboardDefinitions(environment)
  const existing = await client('/dashboards/?limit=100')
  if (!Array.isArray(existing?.results) || existing.next) throw Error('Cannot safely enumerate dashboards; choose a dedicated analytics project')
  const results = []
  for (const spec of definitions) {
    const matching = existing.results.filter(item => !item.deleted && item.name === spec.name)
    if (matching.length > 1) throw Error('Ambiguous dashboard name; resolve duplicates before provisioning')
    let dashboard = matching[0]
    if (!dashboard) dashboard = await client('/dashboards/', 'POST', { name: spec.name, description: spec.description, is_shared: false })
    if (!dashboard?.id) throw Error('Dashboard was not created')
    const before = await client(`/dashboards/${dashboard.id}/`)
    if (before.is_shared) throw Error('Analytics dashboard is shared; review access before provisioning')
    for (const insight of spec.insights) {
      const matches = (before.tiles ?? []).map(tile => tile.insight).filter(item => item?.name === insight.name)
      if (matches.length > 1) throw Error('Ambiguous insight name; resolve duplicates before provisioning')
      // Revalidate and update owned cards too: skipping existing names would
      // leave deployed dashboards permanently on obsolete SQL after a fix.
      const validation = await client('/query/', 'POST', { query: { kind: 'HogQLQuery', query: insight.sql }, refresh: 'force_blocking' })
      if (!Array.isArray(validation?.results)) throw Error('Dashboard query validation is incomplete; no card update permitted')
      const query = { kind: 'DataVisualizationNode', source: { kind: 'HogQLQuery', query: insight.sql }, display: insight.display ?? 'ActionsTable' }
      const found = matches[0]
      if (found?.id) {
        if (JSON.stringify(found.query) !== JSON.stringify(query) || found.description !== insight.description) await client(`/insights/${found.id}/`, 'PATCH', { description: insight.description, query })
        continue
      }
      const saved = await client('/insights/', 'POST', { name: insight.name, description: insight.description, saved: true, dashboards: [dashboard.id], query })
      if (!saved?.id) throw Error('Insight was not created')
    }
    const verified = await client(`/dashboards/${dashboard.id}/`)
    for (const insight of spec.insights) if (!(verified.tiles ?? []).some(tile => tile.insight?.name === insight.name && tile.insight?.query?.source?.query === insight.sql)) throw Error('Dashboard missing current linked insight: ' + insight.name)
    results.push({ name: spec.name, id: dashboard.id })
  }
  return results
}
async function main() {
  const operation = process.argv[2], apply = process.argv.includes('--apply')
  if (!['dashboards','deletion-status','delete-reference'].includes(operation)) throw Error('Choose dashboards, deletion-status or delete-reference. Periodic retention deletion is not supported by the current policy.')
  const project = projectId(process.env.POSTHOG_PROJECT_ID)
  const environment = process.argv.find(a => /^--environment=/.test(a))?.slice(14) ?? 'production'
  if (operation === 'dashboards' && !apply) { console.log(JSON.stringify(dashboardDefinitions(environment), null, 2)); return }
  const client = administrativeClient(project, process.env.POSTHOG_ADMIN_TOKEN)
  if (operation === 'dashboards') console.log(JSON.stringify(await installDashboards(client, environment, project), null, 2))
  else {
    const person = process.argv.find(a => /^--person=/.test(a))?.slice(9)
    if (operation === 'deletion-status') console.log(JSON.stringify(await personDeletionStatus(client, person, process.argv.find(a => /^--since=/.test(a))?.slice(8))))
    else {
      const reference = process.argv.find(a => /^--reference=/.test(a))?.slice(12)
      console.log(JSON.stringify(await deleteReference(client, person, reference, apply)))
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
