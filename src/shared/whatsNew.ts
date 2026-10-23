export interface WhatsNewEntry {
  version: string
  date: string
  highlights: { icon: string; title: { ar: string; en: string }; body: { ar: string; en: string } }[]
}

/** Release versions only. Do not coerce malformed or prerelease settings. */
export function isReleaseVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    && value.split('.').every(part => Number.isSafeInteger(Number(part)))
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number), right = b.split('.').map(Number)
  return (left[0] ?? 0) - (right[0] ?? 0) || (left[1] ?? 0) - (right[1] ?? 0) || (left[2] ?? 0) - (right[2] ?? 0)
}

/** null denotes saved legacy settings; fresh installs are initialized to currentVersion. */
export function selectWhatsNew(seen: string | null, currentVersion: string, entries: readonly WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry[] {
  if (!isReleaseVersion(currentVersion) || seen !== null && (!isReleaseVersion(seen) || compareVersions(seen, currentVersion) >= 0)) return []
  return entries.filter(entry => isReleaseVersion(entry.version) && entry.highlights.length > 0
    && compareVersions(entry.version, currentVersion) <= 0 && (seen === null || compareVersions(entry.version, seen) > 0))
    .sort((a, b) => compareVersions(b.version, a.version)).slice(0, 3)
}

/** Manual review is limited to the latest release supported by the installed version. */
export function selectLatestWhatsNew(currentVersion: string, entries: readonly WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry[] {
  return selectWhatsNew(null, currentVersion, entries).slice(0, 1)
}

// Upcoming release: the owner chooses the final version/date before publishing.
export const WHATS_NEW: readonly WhatsNewEntry[] = [{
  version: '0.11.0',
  date: '2026-10-23',
  highlights: [
    { icon: 'external', title: { ar: 'التقديم السريع بضغطة واحدة', en: 'Quick Apply in one click' }, body: { ar: 'جهّز القالب المحفوظ في Chrome لمستقل ونفذلي، ثم راجع وأرسل بنفسك.', en: 'Prepare your saved template in Chrome for Mostaql or Nafezly; review and submit yourself.' } },
    { icon: 'edit', title: { ar: 'التقديم السريع مع مساعد العروض', en: 'Quick Apply with Proposal Assistant' }, body: { ar: 'على مستقل: استخدم مسودة محفوظة، أو ولّدها بموافقة مسبقة اختيارية قابلة للسحب.', en: 'On Mostaql, reuse a saved draft or generate with optional, revocable standing consent.' } },
    { icon: 'bookmark', title: { ar: 'مسودتك محفوظة وتحت تحكمك', en: 'Your draft stays in your control' }, body: { ar: 'احفظ تعديلات المساعد وجهّزها مباشرة؛ تابع الكتابة أو ألغها، وتبقى المسودة عند تعذّر التجهيز.', en: 'Save Assistant edits and prepare directly; follow or cancel writing, and keep drafts if preparation fails.' } },
    { icon: 'info', title: { ar: 'رسائل أوضح عند تعذّر التقديم', en: 'Clearer Quick Apply errors' }, body: { ar: 'اعرف سبب التعذّر والخطوة التالية برسائل عربية وإنجليزية أوضح.', en: 'Understand what went wrong and what to do next with clearer Arabic and English messages.' } },
    { icon: 'eye', title: { ar: 'توضيح الخصوصية والموافقة', en: 'Clearer privacy and consent' }, body: { ar: 'شروط وخصوصية محدثة؛ موافقة المساعد منفصلة ولا تنتقل مع التصدير أو النسخ الاحتياطية.', en: 'Updated terms and privacy; Assistant consent stays separate and is excluded from exports and backups.' } }
  ]
}]
