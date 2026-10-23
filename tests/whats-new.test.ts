import { describe, expect, it } from 'vitest'
import { defaultSettings, sanitizeSettings } from '../src/shared/types.js'
import { selectWhatsNew, selectLatestWhatsNew, WHATS_NEW, type WhatsNewEntry } from '../src/shared/whatsNew.js'
import { TRANSFER_SETTINGS_KEYS } from '../src/storage/settingsTransfer.js'
import { openDatabase } from '../src/storage/db.js'
import { loadAppSettings } from '../src/storage/appSettings.js'
import { getSettingRaw, setSettingRaw, upsertProjectsBatch } from '../src/storage/repositories.js'
import { saveProposalDraft } from '../src/storage/proposalDrafts.js'

const entry = (version: string): WhatsNewEntry => ({ version, date: '2026-10-23', highlights: [
  { icon: 'info', title: { ar: 'جديد', en: 'New' }, body: { ar: 'وصف', en: 'Description' } },
  { icon: 'check', title: { ar: 'تحسين', en: 'Improvement' }, body: { ar: 'وصف', en: 'Description' } }
] })
const entries = ['1.2.0', '1.10.0', '1.3.0', '1.1.0', '2.0.0'].map(entry)

describe('what’s new settings', () => {
  it('defaults legacy settings to null and preserves valid versions', () => {
    expect(defaultSettings().whatsNewSeen).toBeNull()
    expect(sanitizeSettings({ language: 'en' }).whatsNewSeen).toBeNull()
    expect(sanitizeSettings({ whatsNewSeen: '1.10.0' }).whatsNewSeen).toBe('1.10.0')
  })
  it.each([null, undefined, 11, {}, '', 'garbage', '1.2', 'v1.2.3', '01.2.3', '1.2.3-beta', '1.2.3\n', '99999999999999999.0.0'])('sanitizes invalid marker %j to null', value => {
    expect(sanitizeSettings({ whatsNewSeen: value }).whatsNewSeen).toBeNull()
  })
  it('excludes the local seen marker from settings transfer', () => {
    expect(TRANSFER_SETTINGS_KEYS).not.toContain('whatsNewSeen')
  })
})

describe('release selection with fixture versions', () => {
  it('selects an upgrade within the installed version', () => {
    expect(selectWhatsNew('1.2.0', '1.3.0', entries).map(e => e.version)).toEqual(['1.3.0'])
  })
  it('selects for saved legacy settings without a marker', () => {
    expect(selectWhatsNew(null, '1.2.0', entries).map(e => e.version)).toEqual(['1.2.0', '1.1.0'])
  })
  it('suppresses a fresh install initialized to its current version', () => {
    expect(selectWhatsNew('1.3.0', '1.3.0', entries)).toEqual([])
  })
  it('caps skipped releases at three, newest first, without mutating the list', () => {
    const original = [...entries]
    expect(selectWhatsNew('1.0.0', '1.10.0', entries).map(e => e.version)).toEqual(['1.10.0', '1.3.0', '1.2.0'])
    expect(entries).toEqual(original)
  })
  it('shows nothing without eligible content', () => {
    expect(selectWhatsNew(null, '1.0.0', entries)).toEqual([])
    expect(selectWhatsNew(null, '1.3.0', [])).toEqual([])
    expect(selectWhatsNew(null, '1.3.0', [{ ...entry('1.3.0'), highlights: [] }])).toEqual([])
  })
  it('shows nothing on downgrade, same version or malformed versions', () => {
    expect(selectWhatsNew('2.0.0', '1.3.0', entries)).toEqual([])
    expect(selectWhatsNew('1.3.0', '1.3.0', entries)).toEqual([])
    expect(selectWhatsNew(null, 'invalid', entries)).toEqual([])
    expect(selectWhatsNew('invalid', '1.3.0', entries)).toEqual([])
    expect(selectWhatsNew(null, '1.3.0', [entry('bad')])).toEqual([])
  })
  it('authors bilingual releases with two to five highlights', () => {
    expect(WHATS_NEW).toHaveLength(1)
    for (const release of WHATS_NEW) {
      expect(release.highlights.length).toBeGreaterThanOrEqual(2)
      expect(release.highlights.length).toBeLessThanOrEqual(5)
      for (const highlight of release.highlights) {
        expect(highlight.icon).toBeTruthy()
        for (const lang of ['ar', 'en'] as const) {
          expect(highlight.title[lang]).toBeTruthy()
          expect(highlight.body[lang]).toBeTruthy()
        }
      }
    }
  })
})


describe('database freshness', () => {
  it('silently initializes a truly empty database to the fixture version', () => {
    const db = openDatabase(':memory:')
    try {
      expect(loadAppSettings(db, '1.3.0').whatsNewSeen).toBe('1.3.0')
      expect(JSON.parse(getSettingRaw(db, 'app')!).whatsNewSeen).toBe('1.3.0')
      expect(loadAppSettings(db, '1.10.0').whatsNewSeen).toBe('1.3.0')
    } finally { db.close() }
  })
  it.each(['projects', 'drafts', 'settings'])('treats a missing app row with existing %s as an upgrade', kind => {
    const db = openDatabase(':memory:')
    try {
      if (kind === 'projects') upsertProjectsBatch(db, [{ source: 'mostaql', externalId: '1', url: 'https://mostaql.com/project/1', title: 'Fixture', descriptionExcerpt: '', publishedAt: null, publishedRaw: null }], { now: 'now', discoveryKind: 'initial' })
      if (kind === 'drafts') {
        // Legacy damaged archives can retain a draft with no surviving project.
        db.exec('PRAGMA foreign_keys=OFF')
        saveProposalDraft(db, { projectId: 1, proposal: 'Retained draft', assumptions: [], questions: [], updatedAt: 'now' })
        db.exec('PRAGMA foreign_keys=ON')
      }
      if (kind === 'settings') setSettingRaw(db, 'proposal-profile', '{"skills":"Retained profile"}')
      expect(getSettingRaw(db, 'app')).toBeNull()
      expect(loadAppSettings(db, '1.3.0').whatsNewSeen).toBeNull()
      expect(JSON.parse(getSettingRaw(db, 'app')!).whatsNewSeen).toBeNull()
      expect(selectWhatsNew(loadAppSettings(db, '1.3.0').whatsNewSeen, '1.3.0', entries)).toHaveLength(3)
    } finally { db.close() }
  })
})

describe('manual release review', () => {
  it('selects the latest installed release and excludes newer authored entries', () => {
    expect(selectLatestWhatsNew('1.3.0', entries).map(e => e.version)).toEqual(['1.3.0'])
    expect(selectLatestWhatsNew('1.9.0', entries).map(e => e.version)).toEqual(['1.3.0'])
    expect(selectLatestWhatsNew('1.10.0', entries).map(e => e.version)).toEqual(['1.10.0'])
  })
  it('offers no manual review without eligible installed content', () => {
    expect(selectLatestWhatsNew('1.0.0', entries)).toEqual([])
    expect(selectLatestWhatsNew('invalid', entries)).toEqual([])
    expect(selectLatestWhatsNew('1.3.0', [])).toEqual([])
  })
})
