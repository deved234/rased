import { describe, expect, it, vi } from 'vitest'
import { openDatabaseAtStartup, type Db } from '../src/storage/db.js'

describe('Bounded startup recovery', () => {
  const file = 'synthetic-profile/rased.db'
  it('waits without blocking for a Windows WAL mapping to be released', async () => {
    const db = {} as Db
    const open = vi.fn().mockImplementationOnce(() => { throw { errcode: 1546 } }).mockImplementationOnce(() => { throw { errcode: 4874 } }).mockReturnValue(db)
    const wait = vi.fn(async () => {})
    expect(await openDatabaseAtStartup(file, open, wait, 'win32')).toBe(db)
    expect(wait.mock.calls).toEqual([[250], [750]])
    expect(open.mock.calls).toEqual([[file], [file], [file]])
  })
  it('stops retrying and preserves the original error if the mapping remains unavailable', async () => {
    const error = { errcode: 1546 }, open = vi.fn((): Db => { throw error }), wait = vi.fn(async () => {})
    await expect(openDatabaseAtStartup(file, open, wait, 'win32')).rejects.toBe(error)
    expect(open).toHaveBeenCalledTimes(4)
    expect(wait.mock.calls).toEqual([[250], [750], [1500]])
  })
  it('never retries corruption, permission failures, other I/O errors or other operating systems', async () => {
    for (const [platform, error] of [['win32', { errcode: 11 }], ['win32', { code: 'EACCES' }], ['win32', { errcode: 10 }], ['linux', { errcode: 1546 }]] as const) {
      const open = vi.fn((): Db => { throw error }), wait = vi.fn(async () => {})
      await expect(openDatabaseAtStartup(file, open, wait, platform)).rejects.toBe(error)
      expect(open).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled()
    }
  })
})
