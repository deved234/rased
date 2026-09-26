// Filter evaluation: display rules and notification rules share this logic.
// Returns 'uncertain' when a category-dependent rule cannot be evaluated yet
// (project has no confirmed category). The pipeline — not this module —
// decides what 'uncertain' means (show with badge / wait 30s / optional ping).

import type { CategoryFilter, Project, ProjectWithUser, FilterDefinition } from '../shared/types.js'

export type FilterVerdict = 'match' | 'nomatch' | 'uncertain'

export function foldForSearch(s: string): string {
  return (
    s
      // Arabic diacritics + tatweel
      .replace(/[ً-ٰٟ]/g, '')
      .replace(/ـ/g, '')
      // alef variants -> bare alef; hamza forms
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      // Arabic-Indic digits -> ASCII
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .toLowerCase()
  )
}

export interface FilterableProject {
  title: string
  descriptionExcerpt: string
  skills: string[] | null
  categorySlug: string | null
  categoryConfirmed: boolean
}

export function toFilterable(p: Project): FilterableProject {
  return {
    title: p.title,
    descriptionExcerpt: p.descriptionExcerpt,
    skills: p.skills,
    categorySlug: p.categorySlug,
    categoryConfirmed: p.categoryConfirmed
  }
}

function haystack(p: FilterableProject): string {
  const skills = (p.skills ?? []).join(' ')
  return foldForSearch(`${p.title}\n${p.descriptionExcerpt}\n${skills}`)
}

export function evaluateFilter(p: FilterableProject, f: CategoryFilter): FilterVerdict {
  // 1. exclusions always apply, even to unconfirmed projects
  if (f.excludeKeywords.length > 0) {
    const hay = haystack(p)
    for (const kw of f.excludeKeywords) {
      const k = foldForSearch(kw.trim())
      if (k && hay.includes(k)) return 'nomatch'
    }
  }
  // 2. keyword rules apply to the RSS excerpt (documented: not the full body)
  if (f.keywordsAny.length > 0 || f.keywordsAll.length > 0) {
    const hay = haystack(p)
    if (f.keywordsAny.length > 0) {
      let any = false
      for (const kw of f.keywordsAny) {
        const k = foldForSearch(kw.trim())
        if (k && hay.includes(k)) {
          any = true
          break
        }
      }
      if (!any) return 'nomatch'
    }
    if (f.keywordsAll.length > 0) {
      for (const kw of f.keywordsAll) {
        const k = foldForSearch(kw.trim())
        if (k && !hay.includes(k)) return 'nomatch'
      }
    }
  }
  // 3. category rule
  if (f.mode === 'all') return 'match'
  if (!p.categorySlug || !p.categoryConfirmed) return 'uncertain'
  return f.categories.includes(p.categorySlug) ? 'match' : 'nomatch'
}

/** Identical predicate for stored queries and arrivals/updates in the UI. */
export function matchesDefinition(p: ProjectWithUser, d: FilterDefinition): boolean {
  if (d.scope === 'hidden' ? !p.hidden : p.hidden) return false
  if (d.scope === 'saved' && !p.saved) return false
  if (d.unreadOnly && p.readAt) return false
  if (d.statuses.length && !d.statuses.includes(p.personalStatus)) return false
  if (d.search.trim() && !`${p.title}\n${p.descriptionExcerpt}\n${(p.skills ?? []).join('\n')}`.toLowerCase().includes(d.search.trim().toLowerCase())) return false
  if (evaluateFilter(toFilterable(p), d.categoryFilter) === 'nomatch') return false
  if (p.budgetMin === null && p.budgetMax === null) return d.includeUnknownBudget
  const lo = p.budgetMin ?? p.budgetMax!
  const hi = p.budgetMax ?? p.budgetMin!
  return (d.budgetMin === null || hi >= d.budgetMin) && (d.budgetMax === null || lo <= d.budgetMax)
}
