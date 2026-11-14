import { describe, expect, it } from 'vitest'
import {
  parseWatchPayload,
  watchAwayTitle,
  watchNotificationText,
  watchSummaryTitle,
  type ValidWatchPayload
} from '../src/shared/watchNotificationText.js'

describe('parseWatchPayload', () => {
  it('parses valid watch_status payloads', () => {
    const raw = JSON.stringify({ v: 1, from: 'open', to: 'in_progress' })
    const parsed = parseWatchPayload('watch_status', raw)
    expect(parsed).toEqual({
      kind: 'watch_status',
      v: 1,
      from: 'open',
      to: 'in_progress'
    })

    const rawClosed = JSON.stringify({ v: 1, from: 'in_progress', to: 'closed' })
    expect(parseWatchPayload('watch_status', rawClosed)).toEqual({
      kind: 'watch_status',
      v: 1,
      from: 'in_progress',
      to: 'closed'
    })

    const rawCompleted = JSON.stringify({ v: 1, from: 'in_progress', to: 'completed' })
    expect(parseWatchPayload('watch_status', rawCompleted)).toEqual({
      kind: 'watch_status',
      v: 1,
      from: 'in_progress',
      to: 'completed'
    })
  })

  it('parses valid watch_contact payloads (sure and maybe, null and numeric clientOpen)', () => {
    const rawSure = JSON.stringify({ v: 1, from: 0, to: 2, attribution: 'sure', clientOpen: null })
    expect(parseWatchPayload('watch_contact', rawSure)).toEqual({
      kind: 'watch_contact',
      v: 1,
      from: 0,
      to: 2,
      attribution: 'sure',
      clientOpen: null
    })

    const rawMaybe = JSON.stringify({ v: 1, from: 2, to: 5, attribution: 'maybe', clientOpen: 3 })
    expect(parseWatchPayload('watch_contact', rawMaybe)).toEqual({
      kind: 'watch_contact',
      v: 1,
      from: 2,
      to: 5,
      attribution: 'maybe',
      clientOpen: 3
    })
  })

  it('rejects when raw is not a string', () => {
    expect(parseWatchPayload('watch_status', null)).toBeNull()
    expect(parseWatchPayload('watch_status', undefined)).toBeNull()
    expect(parseWatchPayload('watch_status', 123)).toBeNull()
    expect(parseWatchPayload('watch_status', true)).toBeNull()
    expect(parseWatchPayload('watch_status', { v: 1, from: 'open', to: 'in_progress' })).toBeNull()
  })

  it('rejects when raw is not valid JSON', () => {
    expect(parseWatchPayload('watch_status', 'not-json')).toBeNull()
    expect(parseWatchPayload('watch_status', '{ bad json')).toBeNull()
  })

  it('rejects double-encoded JSON and non-plain-object payloads', () => {
    // Double-encoded: parsed once gives a string
    const inner = JSON.stringify({ v: 1, from: 0, to: 2, attribution: 'sure', clientOpen: null })
    const doubleEncoded = JSON.stringify(inner)
    expect(parseWatchPayload('watch_contact', doubleEncoded)).toBeNull()

    // Number
    expect(parseWatchPayload('watch_status', '123')).toBeNull()
    // Array
    expect(parseWatchPayload('watch_status', '[1, 2]')).toBeNull()
    // Null JSON literal
    expect(parseWatchPayload('watch_status', 'null')).toBeNull()
  })

  it('rejects unrecognized kind', () => {
    const raw = JSON.stringify({ v: 1, from: 'open', to: 'in_progress' })
    expect(parseWatchPayload('new_project', raw)).toBeNull()
    expect(parseWatchPayload('unknown_kind', raw)).toBeNull()
  })

  it('rejects invalid or missing version v', () => {
    expect(parseWatchPayload('watch_status', JSON.stringify({ from: 'open', to: 'in_progress' }))).toBeNull()
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: 2, from: 'open', to: 'in_progress' }))).toBeNull()
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: '1', from: 'open', to: 'in_progress' }))).toBeNull()
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: 0, from: 'open', to: 'in_progress' }))).toBeNull()
  })

  it('rejects watch_status when from is missing or not in WatchPlatformStatus', () => {
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: 1, to: 'in_progress' }))).toBeNull()
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: 1, from: 'invalid_status', to: 'in_progress' }))).toBeNull()
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: 1, from: 123, to: 'in_progress' }))).toBeNull()
  })

  it('rejects watch_status when to is not in_progress, closed, or completed', () => {
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: 1, from: 'open' }))).toBeNull()
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: 1, from: 'open', to: 'open' }))).toBeNull()
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: 1, from: 'open', to: 'unknown' }))).toBeNull()
    expect(parseWatchPayload('watch_status', JSON.stringify({ v: 1, from: 'open', to: 'other' }))).toBeNull()
  })

  it('rejects watch_contact when from/to are missing or invalid integers', () => {
    // Missing from/to
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, to: 2, attribution: 'sure', clientOpen: null }))).toBeNull()
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, attribution: 'sure', clientOpen: null }))).toBeNull()

    // Strings
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: '0', to: 2, attribution: 'sure', clientOpen: null }))).toBeNull()
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, to: '2', attribution: 'sure', clientOpen: null }))).toBeNull()

    // Negative
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: -1, to: 2, attribution: 'sure', clientOpen: null }))).toBeNull()
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, to: -2, attribution: 'sure', clientOpen: null }))).toBeNull()

    // Float
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 1.5, to: 2, attribution: 'sure', clientOpen: null }))).toBeNull()
  })

  it('rejects watch_contact when attribution is missing or invalid', () => {
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, to: 2, clientOpen: null }))).toBeNull()
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, to: 2, attribution: 'likely', clientOpen: null }))).toBeNull()
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, to: 2, attribution: 123, clientOpen: null }))).toBeNull()
  })

  it('rejects watch_contact when clientOpen is missing or invalid', () => {
    // clientOpen missing key -> must be null
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, to: 2, attribution: 'sure' }))).toBeNull()

    // clientOpen is string
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, to: 2, attribution: 'sure', clientOpen: '2' }))).toBeNull()

    // clientOpen is negative
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, to: 2, attribution: 'sure', clientOpen: -1 }))).toBeNull()

    // clientOpen is float
    expect(parseWatchPayload('watch_contact', JSON.stringify({ v: 1, from: 0, to: 2, attribution: 'sure', clientOpen: 1.5 }))).toBeNull()
  })
})

describe('watchNotificationText', () => {
  it('formats watch_contact with sure attribution in both languages', () => {
    const payload: ValidWatchPayload = { kind: 'watch_contact', v: 1, from: 2, to: 5, attribution: 'sure', clientOpen: null }
    expect(watchNotificationText(payload, 'ar')).toBe(
      'العميل بدأ يتواصل مع مستقلين على هذا المشروع (2 ← 5)'
    )
    expect(watchNotificationText(payload, 'en')).toBe(
      'The client started talking to freelancers on this project (2 → 5)'
    )
  })

  it('formats watch_contact with maybe attribution and clientOpen >= 2 (2 and 7)', () => {
    const payload2: ValidWatchPayload = { kind: 'watch_contact', v: 1, from: 2, to: 5, attribution: 'maybe', clientOpen: 2 }
    expect(watchNotificationText(payload2, 'ar')).toBe(
      'صاحب المشروع بدأ يتواصل مع مستقلين (2 ← 5). عنده 2 مشاريع مفتوحة، فقد يكون على هذا المشروع'
    )
    expect(watchNotificationText(payload2, 'en')).toBe(
      'The client started talking to freelancers (2 → 5). They have 2 open projects, so it may be this one'
    )

    const payload7: ValidWatchPayload = { kind: 'watch_contact', v: 1, from: 0, to: 3, attribution: 'maybe', clientOpen: 7 }
    expect(watchNotificationText(payload7, 'ar')).toBe(
      'صاحب المشروع بدأ يتواصل مع مستقلين (0 ← 3). عنده 7 مشاريع مفتوحة، فقد يكون على هذا المشروع'
    )
    expect(watchNotificationText(payload7, 'en')).toBe(
      'The client started talking to freelancers (0 → 3). They have 7 open projects, so it may be this one'
    )
  })

  it('formats watch_contact with maybe attribution and clientOpen null / 0 / 1', () => {
    for (const clientOpen of [null, 0, 1]) {
      const payload: ValidWatchPayload = { kind: 'watch_contact', v: 1, from: 1, to: 4, attribution: 'maybe', clientOpen }
      expect(watchNotificationText(payload, 'ar')).toBe(
        'صاحب المشروع بدأ يتواصل مع مستقلين (1 ← 4) — قد يكون على هذا المشروع'
      )
      expect(watchNotificationText(payload, 'en')).toBe(
        'The client started talking to freelancers (1 → 4) — it may be this project'
      )
    }
  })

  it('formats watch_status to in_progress, closed, completed in both languages', () => {
    const inProgress: ValidWatchPayload = { kind: 'watch_status', v: 1, from: 'open', to: 'in_progress' }
    expect(watchNotificationText(inProgress, 'ar')).toBe(
      'المشروع دخل مرحلة التنفيذ'
    )
    expect(watchNotificationText(inProgress, 'en')).toBe(
      'The project moved to in progress'
    )

    const closed: ValidWatchPayload = { kind: 'watch_status', v: 1, from: 'open', to: 'closed' }
    expect(watchNotificationText(closed, 'ar')).toBe(
      'المشروع أُغلق — توقفت المتابعة'
    )
    expect(watchNotificationText(closed, 'en')).toBe(
      'The project was closed — watching stopped'
    )

    const completed: ValidWatchPayload = { kind: 'watch_status', v: 1, from: 'in_progress', to: 'completed' }
    expect(watchNotificationText(completed, 'ar')).toBe(
      'المشروع اكتمل — توقفت المتابعة'
    )
    expect(watchNotificationText(completed, 'en')).toBe(
      'The project was completed — watching stopped'
    )
  })
})

describe('watchSummaryTitle', () => {
  it('formats the title in Arabic and English', () => {
    expect(watchSummaryTitle(1, 'ar')).toBe('تغييرات في 1 مشاريع تتابعها')
    expect(watchSummaryTitle(1, 'en')).toBe('Changes in 1 projects you watch')
    expect(watchSummaryTitle(4, 'ar')).toBe('تغييرات في 4 مشاريع تتابعها')
    expect(watchSummaryTitle(4, 'en')).toBe('Changes in 4 projects you watch')
  })
})

describe('watchAwayTitle', () => {
  it('formats the away title with exact strings in Arabic and English', () => {
    expect(watchAwayTitle(1, 'ar')).toBe('حصل وأنت غايب: تغييرات في 1 مشاريع')
    expect(watchAwayTitle(1, 'en')).toBe('While you were away: changes in 1 projects')
    expect(watchAwayTitle(3, 'ar')).toBe('حصل وأنت غايب: تغييرات في 3 مشاريع')
    expect(watchAwayTitle(3, 'en')).toBe('While you were away: changes in 3 projects')
  })
})

