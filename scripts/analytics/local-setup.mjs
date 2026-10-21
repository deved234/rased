// Optional, short-lived maintainer UI for transferring a scoped key directly
// from the browser to an administrative process. No credentials are persisted.
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { administrativeClient, installDashboards, deleteReference, personDeletionStatus } from './admin.mjs'
import { runCloudQa, verifyQaMetrics, verifyQaDestination } from './cloud-qa.mjs'
import { githubSnapshots, captureSnapshots } from './github-downloads.mjs'
import { stageProductionToken, capturePublicProductionDownloads, packageQa } from './preflight.mjs'

const nonce = randomBytes(24).toString('hex'), port = 9417
const origin = `http://127.0.0.1:${port}`
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>RASED analytics setup</title>
<style>body{font:16px system-ui;max-width:740px;margin:50px auto;background:#151c24;color:#dde6ec}label{display:block;margin:15px 0}input,button,select{font:inherit;padding:10px;background:#253343;color:#eef;border:1px solid #607080;border-radius:7px}input{width:95%}pre{white-space:pre-wrap}button{cursor:pointer}</style>
<h1>RASED analytics setup</h1><p>Local, temporary maintainer utility. Administrative keys stay in memory and never enter app code or logs. Reviewed ingest tokens may be staged in the approved GitHub secret or compiled into a QA package; client ingest tokens are extractable and grant no administrative access. Cloud QA sends synthetic fixtures only to a separate reviewed QA project.</p>
<form method="post" action="/operate"><input type="hidden" name="nonce" value="${nonce}">
<label>Project ID <input name="project" required pattern="[0-9]+"></label>
<label>Scoped administrative key (administrative operations only) <input name="key" type="password" autocomplete="off"></label>
<label>Reviewed ingest token (QA / preflight only) <input name="ingest" type="password" autocomplete="off"></label>
<label>Environment <select name="environment"><option value="production">production</option><option value="qa">qa</option></select></label>
<label>Reviewed synthetic person UUID <input name="person" autocomplete="off"></label>
<label>Reviewed synthetic installation reference <input name="reference" autocomplete="off"></label>
<label>Deletion requestedAt (status only) <input name="since" autocomplete="off"></label>
<label>Deletion confirmation (delete only): type delete-reviewed-synthetic-person <input name="confirmation" autocomplete="off"></label>
<label>Operation <select name="operation"><option value="stage-production">Stage reviewed production ingest secret; keep scheduled operations OFF</option><option value="production-downloads">Send reviewed public GitHub counters to production (no app events)</option><option value="qa-package">Build configured QA package only; restore ordinary output afterwards</option><option value="person-deletion-probe">Probe requested-person deletion status (read only)</option><option value="dashboards">Validate queries and reconcile four private dashboards</option><option value="qa-capture-only">Capture 50 synthetic events to reviewed QA only; verify cloud separately</option><option value="cloud-qa">Run built-worker synthetic cloud QA (never production)</option><option value="cloud-qa-50">Run 50-event built-worker retry QA (never production)</option><option value="qa-downloads">Capture public GitHub download counters into QA only</option><option value="qa-metrics">Verify this synthetic fixture's exact cloud counters</option><option value="qa-delete">Delete the explicitly reviewed synthetic QA person</option><option value="qa-deletion-status">Check that synthetic deletion's provider status</option></select></label>
<button>Run selected operation</button></form></html>`
const escape = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
let busy = false
const server = createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
  res.setHeader('Content-Type','text/html; charset=utf-8')
  if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403).end(); return }
  if (req.method === 'GET' && req.url === '/') { res.end(html); return }
  if (req.method !== 'POST' || req.url !== '/operate' || req.headers.origin !== origin || busy) { res.writeHead(403).end(); return }
  let raw = ''
  try {
    for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw Error('Request too large') }
    const fields = new URLSearchParams(raw); raw = ''
    if (fields.get('nonce') !== nonce) throw Error('Invalid local form token')
    const captureOnly = fields.get('operation') === 'qa-capture-only'
    const preflight = ['stage-production','production-downloads','qa-package'].includes(fields.get('operation'))
    const client = captureOnly || preflight ? null : administrativeClient(fields.get('project'), fields.get('key'))
    fields.delete('key'); busy = true
    let result
    if (preflight) {
      const operation = fields.get('operation')
      const environment = operation === 'qa-package' ? 'qa' : 'production'
      if (fields.get('environment') !== environment) throw Error('Preflight environment mismatch')
      result = await (operation === 'stage-production' ? stageProductionToken : operation === 'production-downloads' ? capturePublicProductionDownloads : packageQa)(fields.get('project'), fields.get('ingest'))
    }
    else if (captureOnly) {
      if (fields.get('environment') !== 'qa') throw Error('Capture-only requires the reviewed QA project')
      result = await runCloudQa(null, fields.get('project'), fields.get('ingest'), 50, true)
    }
    else if (fields.get('operation') === 'dashboards') result = await installDashboards(client, fields.get('environment'), fields.get('project'))
    else if (['cloud-qa','cloud-qa-50'].includes(fields.get('operation'))) {
      if (fields.get('environment') !== 'qa') throw Error('Cloud QA requires the QA environment')
      result = await runCloudQa(client, fields.get('project'), fields.get('ingest'), fields.get('operation') === 'cloud-qa-50' ? 50 : 18)
    }
    else if (fields.get('operation') === 'qa-metrics') {
      if (fields.get('environment') !== 'qa' || fields.get('project') === '670811') throw Error('Synthetic metrics require a separate QA project')
      result = await verifyQaMetrics(client, fields.get('reference'))
    }
    else if (fields.get('operation') === 'qa-downloads') {
      if (fields.get('environment') !== 'qa') throw Error('Download QA requires a separate QA project')
      verifyQaDestination(fields.get('project'), await client('/'), fields.get('ingest'))
      const snapshots = await githubSnapshots()
      await captureSnapshots(snapshots, fields.get('ingest'), fetch, new Date(), 'qa')
      result = { assets: snapshots.length, cumulativeDownloads: snapshots.reduce((n,a)=>n+a.download_count,0), environment: 'qa' }
    }
    else if (['qa-delete','qa-deletion-status'].includes(fields.get('operation'))) {
      if (fields.get('environment') !== 'qa' || fields.get('project') === '670811') throw Error('This form may delete only reviewed synthetic QA data')
      if (fields.get('operation') === 'qa-delete') {
        if (fields.get('confirmation') !== 'delete-reviewed-synthetic-person') throw Error('Explicit synthetic target confirmation is required')
        result = await deleteReference(client, fields.get('person'), fields.get('reference'), true)
      } else result = await personDeletionStatus(client, fields.get('person'), fields.get('since'))
    }
    else if (fields.get('operation') === 'person-deletion-probe') {
      const status = await client('/persons/deletion_status/?limit=1&status=all')
      if (!Array.isArray(status?.results)) throw Error('Invalid deletion status response')
      result = { available: true } // Do not display any real person's identifiers.
    }
    else throw Error('Unknown operation')
    fields.delete('ingest')
    console.log(JSON.stringify({ operation:fields.get('operation'), result }))
    res.end(`<h1>Operation completed</h1><pre>${escape(JSON.stringify(result,null,2))}</pre><a href="/">Back</a>`)
  } catch (error) {
    console.error(error.message)
    res.end(`<h1>Operation failed</h1><p>${escape(error.message)}</p><a href="/">Back</a>`)
  } finally { busy = false }
})
server.listen(port,'127.0.0.1',()=>console.log(`Local setup UI: ${origin}`))
setTimeout(()=>server.close(),30*60*1000).unref()
