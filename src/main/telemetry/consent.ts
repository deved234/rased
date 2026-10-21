import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TELEMETRY_DISCLOSURE, telemetryUuid } from '../../shared/telemetry.js'

export interface AnalyticsConsent {
  state: 'unknown' | 'enabled' | 'disabled'
  disclosure: string
  identity: string | null
  generation: number
  prompted: boolean
  purgePending?: boolean
}
const empty = (): AnalyticsConsent => ({ state: 'unknown', disclosure: TELEMETRY_DISCLOSURE, identity: null, generation: 0, prompted: false, purgePending: false })
export class ConsentStore {
  private value: AnalyticsConsent
  readonly directory: string
  constructor(root: string) {
    this.directory = join(root, 'telemetry')
    this.value = empty()
    const file = join(this.directory, 'consent.json')
    let cleanupFailed = false
    try { this.cleanTemporaryFiles() } catch { cleanupFailed = true }
    try {
      if (!existsSync(file)) return
      const v = JSON.parse(readFileSync(file, 'utf8')) as AnalyticsConsent
      if (!['unknown', 'enabled', 'disabled'].includes(v.state) || !(v.identity === null || telemetryUuid(v.identity)) || !Number.isSafeInteger(v.generation) || v.generation < 0 || typeof v.prompted !== 'boolean' || typeof v.disclosure !== 'string' || (v.state === 'enabled' && !v.identity)) return
      this.value = { state: v.state, identity: v.identity, generation: v.generation, prompted: v.prompted, disclosure: TELEMETRY_DISCLOSURE, purgePending: v.purgePending === true }
      if (v.disclosure !== TELEMETRY_DISCLOSURE && v.state === 'enabled') this.value = { ...this.value, state: 'unknown', generation: v.generation + 1, prompted: false }
    } catch { /* Corrupt or absent consent never enables capture. */ }
    finally {
      if (cleanupFailed || this.value.purgePending) this.value = { ...this.value, state: 'disabled', identity: null, purgePending: true }
    }
  }
  cleanTemporaryFiles(): void {
    if (!existsSync(this.directory)) return
    for (const name of readdirSync(this.directory)) if (/^consent\.json\.[0-9a-f-]{36}\.tmp$/.test(name)) rmSync(join(this.directory, name), { force: true })
  }
  snapshot(): AnalyticsConsent { return { ...this.value } }
  change(action: 'enable' | 'disable' | 'later' | 'forget'): AnalyticsConsent {
    const previous = this.value
    const next: AnalyticsConsent = { ...previous, prompted: true, generation: previous.generation + 1 }
    if (action === 'enable') { if (previous.purgePending) throw Error('forget-incomplete'); next.state = 'enabled'; next.identity ??= randomUUID() }
    if (action === 'disable' || action === 'forget') next.state = 'disabled'
    if (action === 'forget') { next.identity = null; next.purgePending = true }
    this.persist(next)
    return this.snapshot()
  }
  completePurge(): void {
    this.cleanTemporaryFiles()
    this.persist({ ...this.value, state: 'disabled', identity: null, purgePending: false })
  }
  private persist(next: AnalyticsConsent): void {
    mkdirSync(this.directory, { recursive: true })
    const file = join(this.directory, 'consent.json'), temporary = file + '.' + randomUUID() + '.tmp'
    try { writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 }); renameSync(temporary, file) }
    finally { rmSync(temporary, { force: true }) }
    this.value = next
  }
}
