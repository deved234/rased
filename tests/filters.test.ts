import { describe, expect, it } from 'vitest'
import { evaluateFilter, foldForSearch, type FilterableProject } from '../src/shared/filters.js'
import { defaultCategoryFilter } from '../src/shared/types.js'

const base: FilterableProject = {
  title: 'تطوير موقع ووردبريس',
  descriptionExcerpt: 'مطلوب مطور WordPress محترف',
  skills: ['ووردبريس'],
  categorySlug: 'development',
  categoryConfirmed: true
}

describe('foldForSearch', () => {
  it('normalizes Arabic variants and digits', () => {
    expect(foldForSearch('أحمد إلى ٣')).toBe(foldForSearch('احمد الي 3'))
    expect(foldForSearch('مدرسة')).toBe(foldForSearch('مدرسه'))
    expect(foldForSearch('هذهِ تجربةـ')).toBe('هذه تجربه')
  })
})

describe('evaluateFilter', () => {
  it('matches everything in all-mode', () => {
    expect(evaluateFilter(base, defaultCategoryFilter())).toBe('match')
  })
  it('applies category selection only to confirmed projects', () => {
    const f = { ...defaultCategoryFilter(), mode: 'selected' as const, categories: ['design'] }
    expect(evaluateFilter(base, f)).toBe('nomatch')
    const unconfirmed = { ...base, categorySlug: null, categoryConfirmed: false }
    expect(evaluateFilter(unconfirmed, f)).toBe('uncertain')
    const unconfirmedSlug = { ...base, categorySlug: 'design', categoryConfirmed: false }
    expect(evaluateFilter(unconfirmedSlug, f)).toBe('uncertain')
    const match = { ...base, categorySlug: 'design', categoryConfirmed: true }
    expect(evaluateFilter(match, f)).toBe('match')
  })
  it('handles any/all/exclude keywords on the excerpt', () => {
    const any = { ...defaultCategoryFilter(), keywordsAny: ['متجر', 'ووردبريس'] }
    expect(evaluateFilter(base, any)).toBe('match')
    const all = { ...defaultCategoryFilter(), keywordsAll: ['ووردبريس', 'متجر'] }
    expect(evaluateFilter(base, all)).toBe('nomatch')
    const excl = { ...defaultCategoryFilter(), excludeKeywords: ['ووردبريس'] }
    expect(evaluateFilter(base, excl)).toBe('nomatch')
    // exclusion wins even when uncertain about category
    const unconfirmed = { ...base, categorySlug: null, categoryConfirmed: false }
    expect(evaluateFilter(unconfirmed, excl)).toBe('nomatch')
  })
})
