import { describe, expect, it } from 'vitest'
import { parseHash, routeHash, type Route } from '../src/renderer/router.js'
import { WATCH_ENABLED } from '../src/shared/projectWatch.js'

describe('router', () => {
  describe('round-trips of existing routes', () => {
    it('round trips projects route', () => {
      const route: Route = { name: 'projects' }
      const hash = routeHash(route)
      expect(hash).toBe('#/')
      expect(parseHash(hash)).toEqual(route)
    })

    it('round trips saved route', () => {
      const route: Route = { name: 'saved' }
      const hash = routeHash(route)
      expect(hash).toBe('#/saved')
      expect(parseHash(hash)).toEqual(route)
    })

    it('round trips filters route', () => {
      const route: Route = { name: 'filters' }
      const hash = routeHash(route)
      expect(hash).toBe('#/filters')
      expect(parseHash(hash)).toEqual(route)
    })

    it('round trips compact route', () => {
      const route: Route = { name: 'compact' }
      const hash = routeHash(route)
      expect(hash).toBe('#/compact')
      expect(parseHash(hash)).toEqual(route)
    })

    it('round trips project route with id', () => {
      const route: Route = { name: 'project', id: 42 }
      const hash = routeHash(route)
      expect(hash).toBe('#/project/42')
      expect(parseHash(hash)).toEqual(route)
    })

    it('round trips proposal route with id', () => {
      const route: Route = { name: 'proposal', id: 99 }
      const hash = routeHash(route)
      expect(hash).toBe('#/proposal/99')
      expect(parseHash(hash)).toEqual(route)
    })

    it('serializes proposal route with reason and parses back to base proposal', () => {
      const route: Route = { name: 'proposal', id: 99, reason: 'user request' }
      const hash = routeHash(route)
      expect(hash).toBe('#/proposal/99?reason=user%20request')
      expect(parseHash(hash)).toEqual({ name: 'proposal', id: 99 })
    })

    it('round trips settings route with null section', () => {
      const route: Route = { name: 'settings', section: null }
      const hash = routeHash(route)
      expect(hash).toBe('#/settings')
      expect(parseHash(hash)).toEqual(route)
    })

    it('round trips settings route with specific section', () => {
      const route: Route = { name: 'settings', section: 'notifications' }
      const hash = routeHash(route)
      expect(hash).toBe('#/settings/notifications')
      expect(parseHash(hash)).toEqual(route)
    })
  })

  describe('watching route behavior with watchEnabled flag', () => {
    it('defaults watchEnabled parameter to WATCH_ENABLED constant (true)', () => {
      expect(WATCH_ENABLED).toBe(true)
      expect(parseHash('#/watching')).toEqual({ name: 'watching' })
    })

    it('falls back to projects when watchEnabled is explicitly false', () => {
      expect(parseHash('#/watching', false)).toEqual({ name: 'projects' })
      expect(parseHash('#/watching/extra', false)).toEqual({ name: 'projects' })
    })

    it('parses and serializes #/watching when watchEnabled is true', () => {
      const route = parseHash('#/watching', true)
      expect(route).toEqual({ name: 'watching' })
      expect(routeHash({ name: 'watching' })).toBe('#/watching')
      expect(parseHash(routeHash({ name: 'watching' }), true)).toEqual({ name: 'watching' })
    })
  })

  describe('unknown route fallback', () => {
    it('falls back to projects on unknown route segment', () => {
      expect(parseHash('#/unknown')).toEqual({ name: 'projects' })
      expect(parseHash('#/some/nested/path')).toEqual({ name: 'projects' })
    })

    it('falls back to projects on empty or hash-only inputs', () => {
      expect(parseHash('')).toEqual({ name: 'projects' })
      expect(parseHash('#')).toEqual({ name: 'projects' })
      expect(parseHash('#/')).toEqual({ name: 'projects' })
    })

    it('falls back to projects when project id is non-numeric', () => {
      expect(parseHash('#/project/notanumber')).toEqual({ name: 'projects' })
      expect(parseHash('#/proposal/notanumber')).toEqual({ name: 'projects' })
    })
  })
})
