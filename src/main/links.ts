// URL allow-list for opening projects in the user's default browser.
// Only exact mostaql.com HTTPS project links. `openProject` prefers the
// stored DB URL for a project id over any renderer-supplied string.

import { getProjectById } from '../storage/repositories.js'
import type { Db } from '../storage/db.js'

export function isAllowedProjectUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  if (u.hostname.toLowerCase() !== 'mostaql.com') return false
  if (u.username || u.password) return false
  // Short links from RSS (/go/<id>) and canonical project pages.
  if (/^\/go\/\d+\/?$/.test(u.pathname)) return true
  if (/^\/project\/\d+(-.*)?\/?$/.test(u.pathname)) return true
  return false
}

export function resolveProjectUrl(db: Db, projectId: number): string | null {
  const p = getProjectById(db, projectId)
  if (!p) return null
  return isAllowedProjectUrl(p.url) ? p.url : null
}
