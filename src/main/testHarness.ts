// Explicit opt-in for integration tests, isolated to a newly marked TEMP profile.
// No test channel is exposed to renderer; only network/OS boundaries are replaced.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import type { UpdaterPort } from './updates.js'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

export function isolatedTestHarness(profile: string, argv: string[]): null | {
  fetchImpl: typeof fetch
  record: (kind: string, data: unknown) => void
} {
  const rel = relative(resolve(tmpdir()), resolve(profile))
  if (!argv.includes('--rased-test') || rel.startsWith('..') || isAbsolute(rel) || rel === '' || !basename(profile).startsWith('rased-test-')) return null
  const marker = join(profile, '.rased-test-profile')
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== 'RASED isolated integration test') return null
  const record = (kind: string, data: unknown): void => {
    appendFileSync(join(profile, 'test-trace.jsonl'), JSON.stringify({ kind, data }) + '\n')
  }
  const fetchImpl = (async (url, options) => {
    record('fetch', String(url))
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const rss = String(url).endsWith('/rss')
    return new Response(readFileSync(join(profile, rss ? 'rss-fixture.xml' : 'detail-fixture.html'), 'utf8'), { status: 200, headers: { 'content-type': rss ? 'application/rss+xml' : 'text/html' } })
  }) as typeof fetch
  return { fetchImpl, record }
}

/** Only constructed after isolatedTestHarness validated the opt-in TEMP marker. */
export function testUpdater(profile: string, record: (kind: string, data: unknown) => void): UpdaterPort {
  class FixtureUpdater extends EventEmitter implements UpdaterPort {
    autoDownload = false
    autoInstallOnAppQuit = false
    allowPrerelease = false
    allowDowngrade = false
    private info(): { version: string; releaseNotes: string; error?: string } | null {
      const file = join(profile, 'update-fixture.json')
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { version: string; releaseNotes: string; error?: string } : null
    }
    async checkForUpdates(): Promise<void> {
      record('update-check', true); this.emit('checking-for-update')
      await new Promise(resolve => setTimeout(resolve, 100))
      const info = this.info()
      if (info?.error === 'check') throw Error('Fixture network unavailable')
      this.emit(info ? 'update-available' : 'update-not-available', info)
    }
    async downloadUpdate(): Promise<void> {
      record('update-download', true)
      await new Promise(resolve => setTimeout(resolve, 100))
      this.emit('download-progress', { percent: 42, transferred: 42, total: 100 })
      await new Promise(resolve => setTimeout(resolve, 400))
      const info = this.info()
      if (info?.error === 'download') throw Error('Fixture download failed')
      this.emit('update-downloaded', info)
    }
    quitAndInstall(silent: boolean, relaunch: boolean): void { record('update-install', { silent, relaunch }) }
  }
  return new FixtureUpdater()
}
