// Tiny hash router (works with file://, no server fallback needed).
// Routes: #/ #/saved #/filters #/project/:id #/settings/:section? #/compact

export type Route =
  | { name: 'projects' }
  | { name: 'saved' }
  | { name: 'filters' }
  | { name: 'project'; id: number }
  | { name: 'settings'; section: string | null }
  | { name: 'compact' }

export function parseHash(hash: string): Route {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  const [path] = h.split('?')
  const seg = (path || '/').split('/').filter(Boolean)
  if (seg.length === 0) return { name: 'projects' }
  const [first, second] = seg
  if (first === 'saved') return { name: 'saved' }
  if (first === 'filters') return { name: 'filters' }
  if (first === 'compact') return { name: 'compact' }
  if (first === 'project' && second && /^\d+$/.test(second)) return { name: 'project', id: Number(second) }
  if (first === 'settings') return { name: 'settings', section: second ?? null }
  return { name: 'projects' }
}

export function routeHash(r: Route): string {
  switch (r.name) {
    case 'projects': return '#/'
    case 'saved': return '#/saved'
    case 'filters': return '#/filters'
    case 'compact': return '#/compact'
    case 'project': return `#/project/${r.id}`
    case 'settings': return r.section ? `#/settings/${r.section}` : '#/settings'
  }
}

export function navigate(r: Route): void {
  navigateHash(routeHash(r))
}

/** Alias kept short for call sites. */
export function go(r: Route): void {
  navigate(r)
}

export function currentRoute(): Route {
  return parseHash(acceptedHash)
}

let acceptedHash = window.location.hash || '#/'
let blocker: ((proceed: () => void) => boolean) | null = null
export function registerNavigationBlocker(fn: (proceed: () => void) => boolean): () => void {
  blocker = fn
  return () => { if (blocker === fn) blocker = null }
}
export function requestAction(proceed: () => void): void {
  if (!blocker || blocker(proceed)) proceed()
}
function commitHash(hash: string): void {
  if (hash === acceptedHash) return
  acceptedHash = hash
  window.history.pushState(null, '', hash)
  window.dispatchEvent(new Event('rased-route'))
}
export function navigateHash(hash: string): void {
  requestAction(() => commitHash(hash))
}
window.addEventListener('hashchange', () => {
  const target = window.location.hash || '#/'
  if (target === acceptedHash) return
  // Restore before any component can unmount; only an accepted transition emits.
  window.history.replaceState(null, '', acceptedHash)
  requestAction(() => commitHash(target))
})
