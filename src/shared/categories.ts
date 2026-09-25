// Canonical Mostaql project categories, observed on public detail pages
// (breadcrumb https://mostaql.com/projects/<slug> + JSON-LD occupationalCategory).
// Slugs are the stable key; names are display only. Unknown slugs encountered
// live are preserved verbatim and shown as "uncertain" — never invented.

export interface CategoryInfo {
  slug: string
  ar: string
  en: string
}

export const KNOWN_CATEGORIES: CategoryInfo[] = [
  { slug: 'business', ar: 'أعمال', en: 'Business' },
  { slug: 'development', ar: 'برمجة وتطوير', en: 'Development' },
  { slug: 'ai-machine-learning', ar: 'ذكاء اصطناعي', en: 'AI & Machine Learning' },
  { slug: 'engineering-architecture', ar: 'هندسة وعمارة', en: 'Engineering & Architecture' },
  { slug: 'design', ar: 'تصميم', en: 'Design' },
  { slug: 'marketing', ar: 'تسويق', en: 'Marketing' },
  { slug: 'writing-translation', ar: 'كتابة وترجمة', en: 'Writing & Translation' },
  { slug: 'support', ar: 'دعم ومساعدة', en: 'Support & Data Entry' },
  { slug: 'training', ar: 'تدريب', en: 'Training' }
]

const bySlug = new Map(KNOWN_CATEGORIES.map((c) => [c.slug, c]))

export function categoryDisplay(slug: string | null, lang: 'ar' | 'en'): string | null {
  if (!slug) return null
  const known = bySlug.get(slug)
  if (known) return lang === 'ar' ? known.ar : known.en
  return slug
}

export function isKnownCategory(slug: string): boolean {
  return bySlug.has(slug)
}
