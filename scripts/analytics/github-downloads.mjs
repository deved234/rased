import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { assertReviewedIngest } from './destinations.mjs'

export function installerAssets(releases) {
  return releases.filter(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name)).flatMap(r => (r.assets ?? []).filter(a => /^RASED(?:-| )Setup(?:-| )\d+\.\d+\.\d+\.exe$/i.test(a.name) && Number.isSafeInteger(a.download_count) && a.download_count >= 0 && Number.isSafeInteger(a.id) && a.id > 0).map(a => ({ release_tag: r.tag_name, asset_id: a.id, download_count: a.download_count })))
}
export async function githubSnapshots(fetcher = fetch) {
  const releases = []
  for (let page = 1; page <= 100; page++) {
    const response = await fetcher(`https://api.github.com/repos/deved234/rased/releases?per_page=100&page=${page}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'RASED-download-statistics', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(20000), redirect: 'error' })
    if (!response.ok) throw Error(`GitHub release query failed: HTTP ${response.status}`)
    const rows = await response.json()
    if (!Array.isArray(rows)) throw Error('Invalid GitHub release response')
    releases.push(...rows)
    if (rows.length < 100) return installerAssets(releases)
  }
  throw Error('GitHub pagination limit reached; refusing an incomplete total')
}
export async function captureSnapshots(snapshots, token, fetcher = fetch, now = new Date(), environment = 'production') {
  if (!['production','qa'].includes(environment)) throw Error('Invalid snapshot environment')
  if (!/^phc_[A-Za-z0-9_-]{10,200}$/.test(token ?? '')) throw Error('Set the write-only RASED_POSTHOG_PROJECT_TOKEN')
  if (!Array.isArray(snapshots) || snapshots.some(s => Object.keys(s).sort().join(',') !== 'asset_id,download_count,release_tag' || !/^v\d+\.\d+\.\d+$/.test(s.release_tag) || !Number.isSafeInteger(s.asset_id) || s.asset_id <= 0 || !Number.isSafeInteger(s.download_count) || s.download_count < 0)) throw Error('Invalid release snapshot')
  for (let i = 0; i < snapshots.length; i += 50) {
    const batch = snapshots.slice(i, i + 50).map(item => ({ uuid: randomUUID(), timestamp: now.toISOString(), event: 'rased.distribution.github_snapshot', properties: { distinct_id: 'rased-github-distribution', record_type: 'distribution', environment, ...item, $geoip_disable: true, $process_person_profile: false } }))
    const response = await fetcher('https://us.i.posthog.com/batch/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: token, batch }), signal: AbortSignal.timeout(20000), redirect: 'error' })
    const ack = await response.json()
    if (!response.ok || ![1, 'Ok'].includes(ack.status) || (Array.isArray(ack.quota_limited) ? ack.quota_limited.length > 0 : !!ack.quota_limited)) throw Error('PostHog did not acknowledge download snapshots')
  }
}
async function main() {
  if (process.argv.includes('--apply')) assertReviewedIngest('670811', 'production', process.env.RASED_POSTHOG_PROJECT_TOKEN)
  const snapshots = await githubSnapshots()
  if (process.argv.includes('--apply')) await captureSnapshots(snapshots, process.env.RASED_POSTHOG_PROJECT_TOKEN)
  console.log(JSON.stringify({ assets: snapshots.length, cumulativeDownloads: snapshots.reduce((n, a) => n + a.download_count, 0), published: process.argv.includes('--apply') }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
