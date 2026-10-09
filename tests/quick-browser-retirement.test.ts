import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { retireQuickBrowser } from '../src/main/retireQuickBrowser.js'
import { inspectOffer, fillOffer } from '../src/shared/quickApplyDom.js'

describe('embedded-browser retirement', () => {
  it('the retained form adapter rejects Khamsat before reading any browser DOM', async () => {
    expect(inspectOffer({ source: 'khamsat', externalId: '1' })).toEqual({ kind: 'wrong-project' })
    expect(await fillOffer({ source: 'khamsat', externalId: '1', template: 'offer', price: 10, days: 1, replace: false })).toEqual({ ok: false, error: 'unsupported-source' })
  })
  it('removes only retired platform sessions and preserves other data; repeatable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rased-retirement-'))
    try {
      for (const name of ['rased-quick-apply-mostaql', 'rased-quick-apply-nafezly', 'other']) {
        await mkdir(join(root, 'Partitions', name), { recursive: true })
        await writeFile(join(root, 'Partitions', name, 'Cookies'), 'fixture')
      }
      await writeFile(join(root, 'rased.db'), 'project data')
      await retireQuickBrowser(root)
      await expect(access(join(root, 'Partitions', 'rased-quick-apply-mostaql'))).rejects.toThrow()
      await expect(access(join(root, 'Partitions', 'rased-quick-apply-nafezly'))).rejects.toThrow()
      expect(await readFile(join(root, 'Partitions', 'other', 'Cookies'), 'utf8')).toBe('fixture')
      expect(await readFile(join(root, 'rased.db'), 'utf8')).toBe('project data')
      await retireQuickBrowser(root)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('works with a fresh install without any partitions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rased-retirement-'))
    try { await expect(retireQuickBrowser(root)).resolves.toBeUndefined() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
})
