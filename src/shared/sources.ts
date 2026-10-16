import type { AppSettings } from './types.js'

/** Public capabilities and settings keys, shared by settings, status and diagnostics. */
export const SOURCES = [
  { id: 'mostaql', ar: 'مستقل', en: 'Mostaql', enabledKey: 'mostaqlEnabled', alertsKey: 'mostaqlNotificationsEnabled', transport: 'RSS', endpoint: 'https://mostaql.com/rss', cadence: { ar: 'حسب الفترة المختارة أدناه', en: 'Uses the interval selected below' }, capabilities: { details: true, categories: true, ai: true, quickApply: true } },
  { id: 'khamsat', ar: 'خمسات', en: 'Khamsat', enabledKey: 'khamsatEnabled', alertsKey: 'khamsatNotificationsEnabled', transport: 'HTML', endpoint: 'https://khamsat.com/community/requests', cadence: { ar: 'كل 5 ثوانٍ تقريبًا؛ الفلترة بعنوان الطلب فقط', en: 'Roughly every 5 seconds; filtering uses request titles only' }, capabilities: { details: false, categories: false, ai: false, quickApply: false } },
  { id: 'nafezly', ar: 'نفذلي', en: 'Nafezly', enabledKey: 'nafezlyEnabled', alertsKey: 'nafezlyNotificationsEnabled', transport: 'RSS', endpoint: 'https://nafezly.com/feed', cadence: { ar: 'كل 15–18 ثانية تقريبًا؛ يعود تدريجيًا لهذه الفترة بعد أخطاء الوصول', en: 'Roughly every 15–18 seconds; gradually returns to this interval after access errors' }, capabilities: { details: true, categories: false, ai: false, quickApply: true } },
  { id: 'kaf', ar: 'كاف', en: 'KAF', enabledKey: 'kafEnabled', alertsKey: 'kafNotificationsEnabled', transport: 'HTML', endpoint: 'https://kafiil.com/projects?sort=latest&page=1', cadence: { ar: 'كل 5–6 ثوانٍ تقريبًا؛ يسترجع الصفحات السابقة على دفعات عند الحاجة', en: 'Roughly every 5–6 seconds; catches up with older pages in bounded batches when needed' }, capabilities: { details: true, categories: false, ai: false, quickApply: false } }
] as const

export type SourceId = typeof SOURCES[number]['id']
export const isSourceId = (value: unknown): value is SourceId => SOURCES.some(source => source.id === value)
export const sourceEnabled = (settings: AppSettings, id: SourceId): boolean => settings[SOURCES.find(source => source.id === id)!.enabledKey]
