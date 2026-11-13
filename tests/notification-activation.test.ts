import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type Db } from '../src/storage/db.js'
import { applyMigrations } from '../src/storage/migrations.js'
import {
  claimNotificationActivation,
  cleanupNotificationActivations,
  issueNotificationActivation,
  watchActivationTarget,
  type NotificationDestination,
  type NotificationOrigin
} from '../src/storage/notificationActivations.js'
import { notificationActivationUrl, notificationScheme, NOTIFICATION_TICKET_TTL, parseNotificationActivation } from '../src/shared/notificationActivation.js'
import { NotificationActivationController, type BrowserOpenResult } from '../src/main/notifications/activation.js'
import { downgradeToSchema10 } from './helpers/oldSchema.js'

const token = 'a'.repeat(32)
const destination: NotificationDestination = { url: 'https://mostaql.com/go/123', projectId: 123, origin: 'notification' }
const opened: BrowserOpenResult = { launch: 'accepted', foreground: 'target-unknown', durationMs: 25 }
const databases: Db[] = []
const database = (): Db => { const db = openDatabase(':memory:'); databases.push(db); return db }
afterEach(() => { for (const db of databases.splice(0)) db.close() })

describe('Notification activation protocol', () => {
  it('separates installed and development handlers and rejects ambiguous inputs', () => {
    expect(notificationScheme(true)).toBe('rased')
    expect(notificationScheme(false)).toBe('rased-dev')
    expect(parseNotificationActivation(notificationActivationUrl(token, 'rased'), 'rased')).toBe(token)
    expect(parseNotificationActivation(notificationActivationUrl(token, 'rased-dev'), 'rased')).toBeNull()
    for (const raw of [` rased://open-project?ticket=${token}`, `rased://open-project?ticket=${token}&url=https://evil.test`, `rased://open-project?ticket=${token}#x`, `rased://open-project?ticket=${token}&ticket=${token}`, `rased://open-project?ticket=${token.toUpperCase()}`, `rased://quick-apply-v2?ticket=${token}`, 'file:///C:/app.exe', 'https://mostaql.com/go/123']) expect(parseNotificationActivation(raw, 'rased')).toBeNull()
    expect(() => notificationActivationUrl('invalid', 'rased')).toThrow()
  })
})

describe('Persistent notification destinations', () => {
  it('stores only hashes and keeps original allowed links without a project foreign key', () => {
    const db = database(), ticket = issueNotificationActivation(db, destination, 1000)
    const row = db.prepare('SELECT * FROM notification_activations').get()
    expect(JSON.stringify(row)).not.toContain(ticket)
    expect(claimNotificationActivation(db, ticket, 1001)).toEqual(destination)
    expect(claimNotificationActivation(db, ticket, 1500)).toBe('duplicate')
    expect(claimNotificationActivation(db, ticket, 3001)).toEqual(destination)
  })
  it('expires at seven days, rejects unknown tokens and cleans up without extending leases', () => {
    const db = database(), ticket = issueNotificationActivation(db, destination, 1000)
    expect(claimNotificationActivation(db, token, 1000)).toBeNull()
    expect(claimNotificationActivation(db, ticket, 1000 + NOTIFICATION_TICKET_TTL)).toBeNull()
    cleanupNotificationActivations(db, 1000 + NOTIFICATION_TICKET_TTL)
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_activations').get()).toEqual({ n: 0 })
  })
  it('supports every source and only the explicit public listing for a test', () => {
    const db = database()
    for (const url of ['https://mostaql.com/go/1', 'https://nafezly.com/project/2-work', 'https://khamsat.com/community/requests/3', 'https://kafiil.com/project/4-work']) {
      const ticket = issueNotificationActivation(db, { url, projectId: 1 }, 1000)
      expect(claimNotificationActivation(db, ticket, 1001)).toEqual({ url, projectId: 1, origin: 'notification' })
    }
    expect(() => issueNotificationActivation(db, { url: 'https://evil.test/', projectId: null })).toThrow()
    expect(() => issueNotificationActivation(db, { url: 'https://mostaql.com/projects', projectId: 1 })).toThrow()
    const ticket = issueNotificationActivation(db, { url: 'https://mostaql.com/projects', projectId: null }, 1000)
    expect(claimNotificationActivation(db, ticket, 1001)).toEqual({ url: 'https://mostaql.com/projects', projectId: null, origin: 'notification' })
  })
  it('rejects a damaged or altered destination again at activation time', () => {
    const db = database(), ticket = issueNotificationActivation(db, destination, 1000)
    db.prepare("UPDATE notification_activations SET url='file:///C:/app.exe'").run()
    expect(claimNotificationActivation(db, ticket, 1001)).toBeNull()
  })
})

describe('Notification origins and watch destinations', () => {
  it('keeps origin for both values on issue/claim round trip and defaults to notification', () => {
    const db = database()
    const normalTicket = issueNotificationActivation(db, { url: destination.url, projectId: 1, origin: 'notification' }, 1000)
    expect(claimNotificationActivation(db, normalTicket, 1001)).toEqual({ url: destination.url, projectId: 1, origin: 'notification' })

    const watchTicket = issueNotificationActivation(db, { url: destination.url, projectId: 2, origin: 'watch_notification' }, 1000)
    expect(claimNotificationActivation(db, watchTicket, 1001)).toEqual({ url: destination.url, projectId: 2, origin: 'watch_notification' })

    const defaultTicket = issueNotificationActivation(db, { url: destination.url, projectId: 3 }, 1000)
    expect(claimNotificationActivation(db, defaultTicket, 1001)).toEqual({ url: destination.url, projectId: 3, origin: 'notification' })
  })

  it('rejects invalid origin values on issue', () => {
    const db = database()
    expect(() => issueNotificationActivation(db, { url: destination.url, projectId: 1, origin: 'invalid' as unknown as NotificationOrigin })).toThrow('invalid-notification-origin')
    expect(() => issueNotificationActivation(db, { url: destination.url, projectId: 1, origin: '' as unknown as NotificationOrigin })).toThrow('invalid-notification-origin')
  })

  it('claims an old row inserted without origin or with unexpected origin as notification', () => {
    const db = database()
    const oldToken = 'f'.repeat(32)
    const oldHash = createHash('sha256').update(oldToken).digest('hex')
    db.prepare('INSERT INTO notification_activations(token_hash, url, project_id, expires_at) VALUES(?, ?, ?, ?)').run(oldHash, destination.url, destination.projectId, 1000 + NOTIFICATION_TICKET_TTL)
    expect(claimNotificationActivation(db, oldToken, 1001)).toEqual({ url: destination.url, projectId: destination.projectId, origin: 'notification' })

    const bogusToken = 'e'.repeat(32)
    const bogusHash = createHash('sha256').update(bogusToken).digest('hex')
    db.prepare("INSERT INTO notification_activations(token_hash, url, project_id, expires_at, origin) VALUES(?, ?, ?, ?, 'unexpected')").run(bogusHash, destination.url, destination.projectId, 1000 + NOTIFICATION_TICKET_TTL)
    expect(claimNotificationActivation(db, bogusToken, 1001)).toEqual({ url: destination.url, projectId: destination.projectId, origin: 'notification' })
  })

  it('migrates a schema-10 database to 11 ensuring origin column with default notification on both fresh and migrated', () => {
    const dbFresh = database()
    const colsFresh = dbFresh.prepare('PRAGMA table_info(notification_activations)').all() as { name: string; dflt_value: string }[]
    const originFresh = colsFresh.find(c => c.name === 'origin')
    expect(originFresh).toBeDefined()
    expect(originFresh?.dflt_value).toBe("'notification'")

    const dbMigrated = database()
    downgradeToSchema10(dbMigrated)
    dbMigrated.exec('PRAGMA user_version = 10;')
    const colsV10 = (dbMigrated.prepare('PRAGMA table_info(notification_activations)').all() as { name: string }[]).map(c => c.name)
    expect(colsV10).not.toContain('origin')

    applyMigrations(dbMigrated)
    expect((dbMigrated.prepare('PRAGMA user_version;').get() as { user_version: number }).user_version).toBe(11)
    const colsV11 = dbMigrated.prepare('PRAGMA table_info(notification_activations)').all() as { name: string; dflt_value: string }[]
    const originMigrated = colsV11.find(c => c.name === 'origin')
    expect(originMigrated).toBeDefined()
    expect(originMigrated?.dflt_value).toBe("'notification'")
  })

  it('evaluates watchActivationTarget for all combinations', () => {
    expect(watchActivationTarget({ url: destination.url, projectId: 1, origin: 'watch_notification' }, () => false)).toBe('app')
    expect(watchActivationTarget({ url: destination.url, projectId: 1, origin: 'watch_notification' }, () => true)).toBe('browser')
    expect(watchActivationTarget({ url: destination.url, projectId: null, origin: 'watch_notification' }, () => false)).toBe('browser')
    expect(watchActivationTarget({ url: destination.url, projectId: null, origin: 'watch_notification' }, () => true)).toBe('browser')
    expect(watchActivationTarget({ url: destination.url, projectId: 1, origin: 'notification' }, () => false)).toBe('browser')
    expect(watchActivationTarget({ url: destination.url, projectId: 1, origin: 'notification' }, () => true)).toBe('browser')
    expect(watchActivationTarget({ url: destination.url, projectId: null, origin: 'notification' }, () => false)).toBe('browser')
    expect(watchActivationTarget({ url: destination.url, projectId: null, origin: 'notification' }, () => true)).toBe('browser')
  })
})

describe('Notification lifecycle dispatch', () => {
  function fixture() {
    const claim = vi.fn(() => destination), open = vi.fn(async () => opened), completed = vi.fn(), invalid = vi.fn()
    const controller = new NotificationActivationController('rased', { claim, open, completed, invalid })
    return { controller, claim, open, completed, invalid }
  }
  it('buffers before readiness without extension/renderer dependency and bounds the queue', async () => {
    const f = fixture(), raw = notificationActivationUrl(token, 'rased')
    expect(await f.controller.activate(raw)).toBe('queued')
    expect(await f.controller.activate(raw)).toBe('duplicate')
    for (let i = 0; i < 9; i++) expect(await f.controller.activate(notificationActivationUrl(i.toString(16).padStart(32, '0'), 'rased'))).toBe('queued')
    expect(await f.controller.activate(notificationActivationUrl('b'.repeat(32), 'rased'))).toBe('overflow')
    expect(f.open).not.toHaveBeenCalled()
    await f.controller.start()
    expect(f.open).toHaveBeenCalledTimes(10)
  })
  it('opens once during concurrent activations and does not retry an uncertain handoff', async () => {
    const f = fixture(); let resolve!: (value: BrowserOpenResult) => void
    f.open.mockImplementation(() => new Promise<BrowserOpenResult>(r => { resolve = r }))
    await f.controller.start()
    const raw = notificationActivationUrl(token, 'rased'), first = f.controller.activate(raw)
    expect(await f.controller.activate(raw)).toBe('duplicate')
    resolve({ launch: 'unknown', foreground: 'not-attempted', reason: 'timeout', durationMs: 5000 })
    expect(await first).toBe('failed')
    expect(f.open).toHaveBeenCalledTimes(1)
  })
  it('does not confuse a denied focus request with an unsuccessful URL launch', async () => {
    const f = fixture(); f.open.mockResolvedValue({ launch: 'accepted', foreground: 'denied', durationMs: 20 })
    await f.controller.start()
    expect(await f.controller.activate(notificationActivationUrl(token, 'rased'))).toBe('opened')
    expect(f.completed).toHaveBeenCalledWith(destination, expect.objectContaining({ foreground: 'denied' }))
    f.controller.close()
    expect(await f.controller.activate(notificationActivationUrl(token, 'rased'))).toBe('closed')
  })
})
