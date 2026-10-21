import { describe, expect, it } from 'vitest'
import { isSearchSuperseded, searchReply, unwrapSearchReply } from '../src/shared/searchReply.js'

describe('search IPC cancellation', () => {
  it('transports cancellation as data and recreates a local cancellation in preload', async () => {
    const reply = await searchReply(Promise.reject(new Error('search-superseded')))
    expect(reply).toEqual({ status: 'superseded' })
    expect(() => unwrapSearchReply(reply)).toThrow('search-superseded')
    try { unwrapSearchReply(reply) } catch (error) { expect(isSearchSuperseded(error)).toBe(true) }
  })

  it('keeps a successful empty page distinct from cancellation', async () => {
    const page = { rows: [], total: 0, unread: 0, ceilingId: 0, revision: 6 }
    expect(unwrapSearchReply(await searchReply(Promise.resolve(page)))).toBe(page)
    const counts = { unread: 8, saved: 12 }
    expect(unwrapSearchReply(await searchReply(Promise.resolve(counts)))).toBe(counts)
    expect(unwrapSearchReply(await searchReply(Promise.resolve([1, 2])))).toEqual([1, 2])
  })

  it('does not mask real SQL, timeout, lifecycle or malformed transport errors', async () => {
    for (const message of ['no such table: project_search_cache', 'search-timeout', 'search-closed', 'search-overloaded']) {
      const error = new Error(message)
      await expect(searchReply(Promise.reject(error))).rejects.toBe(error)
      expect(isSearchSuperseded(error)).toBe(false)
    }
    expect(isSearchSuperseded(null)).toBe(false)
    expect(isSearchSuperseded('search-superseded')).toBe(false)
  })
})
