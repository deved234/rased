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

// Newest release first; the owner confirms version and date before publishing.
export const WHATS_NEW: readonly WhatsNewEntry[] = [{
  version: '0.14.0',
  date: '2026-11-28',
  highlights: [
    { icon: 'globe', title: { ar: 'راصد على Mac و Linux', en: 'RASED on Mac and Linux' }, body: { ar: 'نسخة تجريبية لأجهزة Mac و Linux. كل المزايا تعمل عليها، ما عدا التقديم السريع المتاح على Windows فقط حاليًا.', en: 'A beta for Mac and Linux. Every feature works there except Quick Apply, which stays Windows-only for now.' } },
    { icon: 'download', title: { ar: 'التحديث أسهل على كل جهاز', en: 'Easy updates on every computer' }, body: { ar: 'على Windows يتم التحديث من داخل البرنامج كالمعتاد. على Mac و Linux يخبرك راصد بالتحديث ويساعدك تثبّته.', en: 'On Windows, update inside the app as usual. On Mac and Linux, RASED tells you about updates and helps you install them.' } },
    { icon: 'info', title: { ar: 'تابع راصد على تليجرام', en: 'Follow RASED on Telegram' }, body: { ar: 'أخبار الإصدارات في القناة، والأسئلة والاقتراحات في الجروب. الروابط هنا وفي «حول راصد».', en: 'Release news in the channel; questions and suggestions in the group. Links are here and in About.' } },
    { icon: 'edit', title: { ar: 'خصوصية محدّثة', en: 'Updated privacy' }, body: { ar: 'الإحصائيات تشمل الآن نوع جهازك (Windows أو Mac أو Linux) ونوع المعالج، دون أي بيانات شخصية. ستُطلب موافقتك من جديد.', en: 'Analytics now include your computer type (Windows, Mac or Linux) and processor type, with no personal data. You will be asked to accept again.' } }
  ]
}, {
  version: '0.12.1',
  date: '2026-11-20',
  highlights: [
    { icon: 'eye', title: { ar: 'متابعة مستقل تعمل الآن', en: 'Mostaql watch now works' }, body: { ar: 'في 0.12.0 لم تكن متابعة مشاريع مستقل تفحص أي صفحة، فلم تصل تنبيهاتها. أُصلح ذلك، والمشاريع التي تتابعها تكمل وحدها بعد التحديث.', en: 'In 0.12.0, watched Mostaql projects were never checked, so their alerts never came. This is fixed, and projects you already watch continue on their own after the update.' } },
    { icon: 'globe', title: { ar: 'يتبع إعدادات Proxy', en: 'Follows your proxy settings' }, body: { ar: 'يتبع الرصد وجلب التفاصيل ومتابعة المشاريع الآن إعدادات Proxy في Windows مثل متصفحك، بما فيها VPN بوضع «System proxy»، بدل تجاهلها وانتهاء المهلة في كل المصادر.', en: 'Monitoring, project details and project watch now follow the Windows proxy settings like your browser, including VPNs in system-proxy mode, instead of ignoring them and timing out on every source.' } }
  ]
}, {
  version: '0.12.0',
  date: '2026-11-15',
  highlights: [
    { icon: 'bell', title: { ar: 'تابع مشاريعك', en: 'Watch your projects' }, body: { ar: 'اضغط «متابعة» على مشروع في مستقل أو نفذلي أو كاف، وسينبّهك راصد عند بدء التواصل على مستقل أو دخول المشروع التنفيذ أو إغلاقه.', en: 'Press Watch on a Mostaql, Nafezly or KAF project to be told when contacts start on Mostaql, or when it moves to in progress or closes.' } },
    { icon: 'eye', title: { ar: 'شاشة متابعة المشاريع', en: 'Watched projects screen' }, body: { ar: 'حتى 10 مشاريع لكل منصة، والباقي ينتظر مكانًا أو يبدّل مشروعًا. اختيار «قدّمت» يبدأ المتابعة تلقائيًا ما لم توقفها بنفسك، والرصد الأساسي له الأولوية دائمًا.', en: 'Up to 10 projects per platform; the rest wait for a slot or swap one. Marking a project Submitted starts watching it unless you stopped it yourself; primary monitoring always comes first.' } },
    { icon: 'edit', title: { ar: 'خصوصية وشروط محدّثة', en: 'Updated privacy and terms' }, body: { ar: 'تحديث 2026-11-15 يشرح متابعة المشاريع وما يُرسل عنها في الإحصائيات؛ ستُطلب موافقتك على الإفصاح المحدّث.', en: 'The 2026-11-15 update explains project watch and what analytics it sends; you will be asked to accept the updated disclosure.' } }
  ]
}, {
  version: '0.11.0',
  date: '2026-10-23',
  highlights: [
    { icon: 'external', title: { ar: 'التقديم السريع بضغطة واحدة', en: 'Quick Apply in one click' }, body: { ar: 'جهّز القالب المحفوظ في Chrome لمستقل ونفذلي، ثم راجع وأرسل بنفسك.', en: 'Prepare your saved template in Chrome for Mostaql or Nafezly; review and submit yourself.' } },
    { icon: 'edit', title: { ar: 'مساعد العروض على نفذلي وكاف', en: 'Proposal Assistant on Nafezly and KAF' }, body: { ar: 'اكتب المسودة بالمساعد على مستقل ونفذلي وكاف. على كاف انسخ العرض وقدّمه بنفسك؛ التجهيز بضغطة واحدة في Chrome يبقى لمستقل ونفذلي فقط.', en: 'Draft with the Assistant on Mostaql, Nafezly and KAF. On KAF, copy the proposal and submit it yourself; one-click Chrome preparation stays Mostaql/Nafezly only.' } },
    { icon: 'bookmark', title: { ar: 'مسودتك محفوظة وتحت تحكمك', en: 'Your draft stays in your control' }, body: { ar: 'احفظ تعديلات المساعد وجهّزها مباشرة؛ تابع الكتابة أو ألغها، وتبقى المسودة عند تعذّر التجهيز.', en: 'Save Assistant edits and prepare directly; follow or cancel writing, and keep drafts if preparation fails.' } },
    { icon: 'bookmark', title: { ar: 'ملفات مهنية متعددة', en: 'Multiple freelancer profiles' }, body: { ar: 'احفظ حتى 10 ملفات وقوالبها، واختر الافتراضي للتقديم السريع أو ملفًا آخر للتوليد اليدوي.', en: 'Save up to 10 profiles and templates, choose your Quick Apply default, or select another for manual generation.' } },
    { icon: 'eye', title: { ar: 'توضيح الخصوصية والموافقة', en: 'Clearer privacy and consent' }, body: { ar: 'شروط وخصوصية محدثة؛ موافقة المساعد منفصلة ولا تنتقل مع التصدير أو النسخ الاحتياطية.', en: 'Updated terms and privacy; Assistant consent stays separate and is excluded from exports and backups.' } }
  ]
}]
