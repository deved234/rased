import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function recordStartupFailure(root: string, stage: 'database' | 'later', error: unknown): { stage: string; sqliteCode: number | null } {
  const value = error && typeof error === 'object' && 'errcode' in error ? Number(error.errcode) : NaN
  const data = { stage, sqliteCode: Number.isSafeInteger(value) && value >= 0 ? value : null }
  try {
    mkdirSync(root, { recursive: true })
    const file = join(root, 'startup-failure.log')
    let lines: string[] = []
    try { lines = readFileSync(file, 'utf8').slice(-8192).split('\n').filter(line => { try { const r = JSON.parse(line); return typeof r.at === 'string' && ['database','later'].includes(r.stage) && (r.sqliteCode === null || Number.isSafeInteger(r.sqliteCode)) } catch { return false } }) } catch { /* First failure. */ }
    writeFileSync(file, [...lines.slice(-19), JSON.stringify({ at: new Date().toISOString(), ...data })].join('\n') + '\n')
  } catch { /* Reporting must not prevent a clean quit. */ }
  return data
}
