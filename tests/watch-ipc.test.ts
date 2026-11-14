import { describe, expect, it } from 'vitest'
import { validateWatchReplacePayload, validateWatchSetPayload } from '../src/main/watchIpc.js'

describe('watchIpc payload validation', () => {
  describe('validateWatchSetPayload', () => {
    it('accepts valid payload and strips extra fields', () => {
      const result = validateWatchSetPayload({
        projectId: 42,
        want: 'on',
        expectVersion: null,
        entry: 'list',
        extraField: 'should be ignored',
        foo: 123
      })
      expect(result).toEqual({
        projectId: 42,
        want: 'on',
        expectVersion: null,
        entry: 'list'
      })
      expect(result).not.toHaveProperty('extraField')
      expect(result).not.toHaveProperty('foo')
    })

    it('accepts valid payload with integer expectVersion', () => {
      const result = validateWatchSetPayload({
        projectId: 1,
        want: 'off',
        expectVersion: 3,
        entry: 'detail'
      })
      expect(result).toEqual({
        projectId: 1,
        want: 'off',
        expectVersion: 3,
        entry: 'detail'
      })
    })

    it('rejects bad ids', () => {
      expect(validateWatchSetPayload({ projectId: 0, want: 'on', expectVersion: null, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: -5, want: 'on', expectVersion: null, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: 1.5, want: 'on', expectVersion: null, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: '42', want: 'on', expectVersion: null, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: NaN, want: 'on', expectVersion: null, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: null, want: 'on', expectVersion: null, entry: 'list' })).toBeNull()
    })

    it('rejects bad want', () => {
      expect(validateWatchSetPayload({ projectId: 1, want: 'start', expectVersion: null, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: 1, want: 'active', expectVersion: null, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: 1, want: '', expectVersion: null, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: 1, want: 1, expectVersion: null, entry: 'list' })).toBeNull()
    })

    it('rejects bad entry', () => {
      expect(validateWatchSetPayload({ projectId: 1, want: 'on', expectVersion: null, entry: 'invalid_origin' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: 1, want: 'on', expectVersion: null, entry: '' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: 1, want: 'on', expectVersion: null, entry: 123 })).toBeNull()
    })

    it('rejects non-integer versions', () => {
      expect(validateWatchSetPayload({ projectId: 1, want: 'on', expectVersion: 1.5, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: 1, want: 'on', expectVersion: '1', entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: 1, want: 'on', expectVersion: NaN, entry: 'list' })).toBeNull()
      expect(validateWatchSetPayload({ projectId: 1, want: 'on', expectVersion: undefined, entry: 'list' })).toBeNull()
    })

    it('rejects non-object or null payloads', () => {
      expect(validateWatchSetPayload(null)).toBeNull()
      expect(validateWatchSetPayload(undefined)).toBeNull()
      expect(validateWatchSetPayload('string')).toBeNull()
      expect(validateWatchSetPayload(123)).toBeNull()
    })
  })

  describe('validateWatchReplacePayload', () => {
    it('accepts valid payload and strips extra fields', () => {
      const result = validateWatchReplacePayload({
        projectId: 10,
        victimId: 20,
        expectVersions: { project: null, victim: 2 },
        entry: 'watch_view',
        extra: true
      })
      expect(result).toEqual({
        projectId: 10,
        victimId: 20,
        expectVersions: { project: null, victim: 2 },
        entry: 'watch_view'
      })
      expect(result).not.toHaveProperty('extra')
    })

    it('accepts valid payload with integer expectVersions.project', () => {
      const result = validateWatchReplacePayload({
        projectId: 10,
        victimId: 20,
        expectVersions: { project: 5, victim: 2 },
        entry: 'compact'
      })
      expect(result).toEqual({
        projectId: 10,
        victimId: 20,
        expectVersions: { project: 5, victim: 2 },
        entry: 'compact'
      })
    })

    it('rejects bad ids', () => {
      expect(validateWatchReplacePayload({ projectId: 0, victimId: 20, expectVersions: { project: null, victim: 2 }, entry: 'list' })).toBeNull()
      expect(validateWatchReplacePayload({ projectId: 10, victimId: -1, expectVersions: { project: null, victim: 2 }, entry: 'list' })).toBeNull()
      expect(validateWatchReplacePayload({ projectId: '10', victimId: 20, expectVersions: { project: null, victim: 2 }, entry: 'list' })).toBeNull()
      expect(validateWatchReplacePayload({ projectId: 10, victimId: 2.5, expectVersions: { project: null, victim: 2 }, entry: 'list' })).toBeNull()
    })

    it('rejects bad expectVersions', () => {
      expect(validateWatchReplacePayload({ projectId: 10, victimId: 20, expectVersions: null, entry: 'list' })).toBeNull()
      expect(validateWatchReplacePayload({ projectId: 10, victimId: 20, expectVersions: { project: 1.5, victim: 2 }, entry: 'list' })).toBeNull()
      expect(validateWatchReplacePayload({ projectId: 10, victimId: 20, expectVersions: { project: null, victim: 2.5 }, entry: 'list' })).toBeNull()
      expect(validateWatchReplacePayload({ projectId: 10, victimId: 20, expectVersions: { project: null, victim: null }, entry: 'list' })).toBeNull()
      expect(validateWatchReplacePayload({ projectId: 10, victimId: 20, expectVersions: { project: null, victim: '2' }, entry: 'list' })).toBeNull()
    })

    it('rejects bad entry', () => {
      expect(validateWatchReplacePayload({ projectId: 10, victimId: 20, expectVersions: { project: null, victim: 2 }, entry: 'bad' })).toBeNull()
      expect(validateWatchReplacePayload({ projectId: 10, victimId: 20, expectVersions: { project: null, victim: 2 }, entry: 123 })).toBeNull()
    })

    it('rejects non-object or null payloads', () => {
      expect(validateWatchReplacePayload(null)).toBeNull()
      expect(validateWatchReplacePayload(undefined)).toBeNull()
    })
  })
})
