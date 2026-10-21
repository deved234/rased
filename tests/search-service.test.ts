import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({ children: [] as unknown[] }))
vi.mock('electron', () => ({ utilityProcess: { fork: () => {
  const child = new EventEmitter() as EventEmitter & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }
  child.postMessage = vi.fn()
  child.kill = vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true })
  runtime.children.push(child)
  return child
} } }))
import { SearchService } from '../src/main/search/service.js'
import { SearchCacheBuilder } from '../src/main/search/cacheBuilder.js'
import { defaultFilterDefinition } from '../src/shared/types.js'
import { searchReply, unwrapSearchReply } from '../src/shared/searchReply.js'

type Child = EventEmitter & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }
const child = (): Child => runtime.children.at(-1) as Child
const response = (c: Child): void => {
  const request = c.postMessage.mock.calls.at(-1)![0] as { id: number }
  c.emit('message', { id: request.id, result: { rows: [], total: 4, unread: 2 } })
}
let service: SearchService
beforeEach(() => { vi.useFakeTimers(); runtime.children.length = 0; service = new SearchService('TEMP fixture', 'reader', () => false) })
afterEach(async () => { await service.close(); vi.useRealTimers() })
describe('isolated search lifecycle', () => {
  it('releases the idle index process and wakes only when public work returns', async () => {
    let pending = false
    const builder = new SearchCacheBuilder('TEMP fixture', 'indexer', () => pending)
    builder.start(); const first = child(); builder.start()
    expect(runtime.children.length).toBe(1)
    first.emit('message', { idle: true }); expect(first.postMessage.mock.calls.at(-1)![0]).toEqual({ close: true })
    first.emit('exit', 0); expect(runtime.children.length).toBe(1)
    pending = true; builder.start(); const second = child()
    expect(second).not.toBe(first)
    const closed = builder.close(); second.emit('exit', 0); await closed
    await vi.advanceTimersByTimeAsync(1000); expect(runtime.children.length).toBe(2)
  })
  it('retries a stale result without needing a second mutation', async () => {
    const result = service.page('page', defaultFilterDefinition(), 50, 0)
    const c = child(); c.emit('message', { ready: true })
    service.invalidate(); response(c)
    expect(c.postMessage.mock.calls.length).toBe(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(c.postMessage.mock.calls.length).toBe(3)
    response(c); expect((await result).revision).toBe(1)
  })
  it('keeps one active request, supersedes only a matching waiting owner, and preserves FIFO', async () => {
    const first = service.page('page', defaultFilterDefinition(), 50, 0), c = child(); c.emit('message', { ready: true })
    const old = service.page('page', defaultFilterDefinition(), 50, 0).catch(e => e.message)
    const counts = service.page('counts', defaultFilterDefinition(), 0, 0)
    const latest = service.page('page', defaultFilterDefinition(), 50, 0)
    expect(await old).toBe('search-superseded')
    response(c); await first
    expect(c.postMessage.mock.calls.at(-1)![0].limit).toBe(0)
    response(c); await counts; response(c); await latest
  })
  it('kills a timed out reader before spawning another and supports retry', async () => {
    const old = service.page('page', defaultFilterDefinition(), 50, 0).catch(e => e.message), c = child(); c.emit('message', { ready: true })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await old).toBe('search-timeout'); expect(c.kill).toHaveBeenCalledOnce()
    const next = service.page('page', defaultFilterDefinition(), 50, 0), replacement = child()
    expect(replacement).not.toBe(c); replacement.emit('message', { ready: true }); response(replacement)
    expect((await next).total).toBe(4)
  })
  it('settles an invalidated active request as cancellation when a newer page is waiting', async () => {
    const first = searchReply(service.page('page', defaultFilterDefinition(), 50, 0))
    const c = child(); c.emit('message', { ready: true })
    service.invalidate()
    const next = searchReply(service.page('page', { ...defaultFilterDefinition(), search: 'latest' }, 50, 0))
    response(c)
    expect(await first).toEqual({ status: 'superseded' })
    await vi.advanceTimersByTimeAsync(200)
    expect(c.postMessage.mock.calls.at(-1)![0].definition.search).toBe('latest')
    response(c)
    expect(unwrapSearchReply(await next)).toMatchObject({ total: 4, unread: 2, revision: 1 })
  })
  it('rejects every request on close, waits for exit, and never replaces after close', async () => {
    const active = service.page('page', defaultFilterDefinition(), 50, 0).catch(e => e.message)
    const queued = service.page('counts', defaultFilterDefinition(), 0, 0).catch(e => e.message)
    const c = child(); c.emit('message', { ready: true })
    await service.close()
    expect(await active).toBe('search-closed'); expect(await queued).toBe('search-closed')
    await expect(service.page('page', defaultFilterDefinition(), 50, 0)).rejects.toThrow('search-closed')
    expect(runtime.children.length).toBe(1)
  })
  it('bounds queued surfaces and reports failures without fake zero counts', async () => {
    const promises = Array.from({ length: 10 }, (_, i) => service.page('surface' + i, defaultFilterDefinition(), 0, 0).catch(e => e.message))
    expect(await promises[9]).toBe('search-overloaded')
    child().emit('exit', 1)
    await service.close(); await Promise.all(promises)
  })
})
