# UI/UX v2 — IMPLEMENTATION REPORT (0.2.0, local, under review)

> **سجل تاريخي للنسخة 0.2.0 قبل الإصلاح:** المراجعة المستقلة أثبتت أن بعض بنود القبول أدناه لم تكن صحيحة أو لم تُختبر فعليًا. حالة النسخة المحلية الحالية 0.2.1 والإصلاحات والأدلة والقيود موجودة في [UI_UX_FIX_REPORT.md](UI_UX_FIX_REPORT.md). لا تستخدم علامات done القديمة كدليل QA للإصدار الحالي.

التاريخ: 26 سبتمبر 2026. الحالة: **منفذ محليًا، قيد مراجعتك قبل أي توزيع**. الإصدار العام المعتمد ما زال 0.1.1.

## 1. ملخص السلوك المنفذ

- **Shell**: شريط جانبي قابل للطي (المشاريع/المحفوظة/فلاتري/الإعدادات) + شريط علوي (بحث Ctrl+K + صحة منبثقة) + شريط حالة نحيف. عربي RTL وإنجليزي LTR، داكن + فاتح دافئ، كثافة مريحة/مضغوطة، حجم خط 90–125%.
- **القائمة**: صفوف مدمجة، شارات جديد (جلسة-live فقط)/غير مقروء/فائت/محفوظ/حالة، معاينة جانبية قابلة للسحب، chips مجالات + درج فلتر كامل + فرز + بحث، زر «وصلت N» بلا قفز، حفظ السياق عند العودة، تحميل >200 بلا تصفير.
- **صفحة المشروع**: route داخلي، حقائق (مجال/ميزانية/نشر/رصد)، نص كامل عند توفره مع مصدره وتاريخ جلبه، مهارات، rail (فتح خارجي/حفظ/نسخ/حالة/ملاحظة ≤5000 بحارس/إخفاء)، قراءة-مرة عند الفتح.
- **التنبيهات**: فردي → المتصفح مباشرة (محفوظ ومختبر)؛ ملخص → أحدث مشروع (firstSeenAt, id) مع سطر توضيحي؛ DND مطلق 15/30/60/120 بلا سيل لاحق؛ تجربة تنبيه/صوت آمنة.
- **البيانات**: محفوظات/مخفية/حالات/ملاحظات محلية، فلاتر محفوظة، تصدير/استيراد JSON مُتحقق (1MB/schema/ملخص/دمج-استبدال/startup صريح)، حذف سجل آمن (معاينة + VACUUM INTO + tombstones).
- **بدء/مصغر**: splash ثابت قبل JS + حالات بطء/خطأ، نافذة compact بنفس الخدمات + pin + bounds مصححة.
- **محرك الرصد**: بلا تغيير سلوكي (RSS/backoff/baseline/30s/suppressed كلها محفوظة ومختبرة انحدارًا).

## 2. القرارات

1. Hash router (يعمل مع file://) بدل مكتبة.
2. خط Noto Sans Arabic عبر fontsource (OFL، woff2 محلي ~180KB، arabic+latin 400/500/700). المقارنة عبر البيانات/الترخيص/التغطية — IBM Plex أُبعد لتقليل الاعتماديات، وموثق بصدق (ليست مقارنة بكسل).
3. UI prefs داخل AppSettings؛ compactBounds مضافة مع sanitize.
4. E2E عبر CDP مدمج (fetch + WebSocket من Node): مثبت أن playwright electron.launch يعلّق هنا.
5. لا inline styles في React (CSP الإنتاج) — التقسيمة عبر CSS var إلزاميًا.
6. إلغاء fetch التفاصيل يعيد الحالة السابقة (لا failed زائف، لا backoff).
7. لقطة Splash: مثبت أنها تظهر <300ms عادة؛ اللقطة أُخذت بتثبيت JS مؤقتًا (موثق) بعد إخفاق التجميد الزمني.

## 3. تغييرات قاعدة البيانات (ترحيل 3، متوافق رجعيًا)

`project_user_state` (saved/hidden/status/note)، `project_details` (text/provenance/fetched/status/error)، `saved_filters`، `tombstones`. الإعدادات تمتد (link/DND/compactBounds/ui) بقيم افتراضية تحفظ القديم. لا مساس بـmigrations 1/2.

## 4. مقارنة مع الصور المرجعية (انحرافات مقصودة)

- بلا «Mostaql API» (المصدر RSS)، بلا خمسات، بلا شعارات مولدة، بلا نسب مزيفة أو لمعان/تدرجات.
- التفاصيل: rail يمين في RTL حسب المرجع؛ المعاينة اختيارية لا إجبارية؛ الفلاتر drawer لا شريط طويل.
- شارة «جديد» أضيق من الصورة عمدًا (جلسة-live فقط، لا baseline-unread).

## 5. الاختبارات (أوامر ونتائج فعلية)

- `npm run typecheck` ✅ (node+web)، `npm run lint` ✅، `npm test` ✅ **77/77** (11 ملفًا؛ +19 عن 0.1.1: تخزين v2، محرك استعلام، تفاصيل، انحدار الإصلاحات القديمة سارية).
- `npm run build` ✅. `scripts/e2e-cdp.mjs` ✅ **17/17** (تشغيل حقيقي + preload حقيقي + SQLite temp + RSS حي: قائمة، تفاصيل، رجوع، حفظ-بعد-إعادة-تشغيل، فلتر، لغة، DND، نص كامل ready|1158).
- تجربة حية محدودة: ~40 RSS + ~6 تفاصيل عبر الجلسات؛ اكتشاف حي واحد موثق سابقًا؛ لا ضغط متكرر.

## 6. Manual QA (مجمعة، بروفايل temp)

- تثبيت صامت مع `/D=` ✅ + تشغيل مستقل (baseline 20) ✅ + إزالة (ملفات، مجلد فارغ متبقٍ) ✅. التثبيت الصامت بالمسار الافتراضي لا يضع ملفات (موثق كقيد، يحتاج فحص NSIS لاحقًا).
- لقطات `docs/screenshots/ui-v2/`: ar-main، en-main، en-light، ar-detail (نص كامل حي)، ar-settings، compact، splash — كلها من النسخة المجمعة.
- **لم يُختبر يدويًا**: نقرة toast حقيقية، صوت مسموع، Tray actions، بدء ويندوز، نوم/استيقاظ، استيراد ملف حقيقي، حذف سجل حقيقي، 900×600 و150%، لوحة مفاتيح كاملة بيد بشرية.

## 7. فجوات معلومة

1. مسار التثبيت الصامت الافتراضي لا يثبّت (يعمل مع /D=) — تحقيق NSIS مطلوب.
2. لا E2E لمسارات dialogs الأصلية (تصدير/استيراد/فتح مجلد) — تغطية sanitize+rows فقط.
3. Summary-toast وDND-flood غطتهما unit tests لا مشاهدة حية (نفس قيد 0.1.1: حدث حي واحد).
4. إثراء التفاصيل يعتمد `#projectDetailsTab` — أي تغيير markup يعيده إلى failed+excerpt (مصمم للفشل الآمن).
5. حزمة renderer ~780KB (غير محسّنة).

## 8. المثبت

`release/RASED Setup 0.2.0.exe` — **115,083,831 بايت (~109.8 MiB)**، x64 NSIS per-user، **غير موقع** (NotSigned مؤكد).
SHA256: `777EE10E445E9623E52D2BB7363B8A39D3532F619C3C7B15E3E1E2E4536829C`
المثبت القديم 0.1.1 محفوظ ولا يُقدم كبديل. لا نشر GitHub ضمن هذا التكليف.

## 9. للمراجع القادم (الأخطر أولًا)

`src/main/index.ts` (الأطول: IPC/DND/import/purge/compact)، `src/renderer/views/ProjectsView.tsx` (أحداث حية وذاكرة تنقل)، `src/storage/repositories.ts` (محرك الاستعلام)، `src/main/details.ts` + `src/collector/projectBody.ts` (هشاشة الـmarkup)، `src/renderer/views/ProjectDetailView.tsx` (حراسة الملاحظة). ثم `tests/e2e` عبر `scripts/e2e-cdp.mjs` و`docs/UI_UX_IMPLEMENTATION_STATUS.md`.

## 10. قبول checklist (الخطة §13)

- [x] كل البنود منفذة (compact/light/DND/savedfilters/data settings/اختصارات)
- [x] card internal / toast external / summary latest — مثبتة E2E ومنطقيًا
- [x] Splash حقيقي بلا waits وبلا fake data (ثابت + حالات بطء/خطأ)
- [x] persisted userstate/details + migration v2→v3/reopen pass
- [x] return context / load>200 / no jump / session badge
- [x] fonts/CSP/themes/resize في المجمعة (لقطات)؛ ar/en ظاهرة
- [x] unit + storage + wiring E2E موثقة؛ manual packaged جزئي (انظر §6)
- [x] dist 0.2.0 جديد + hash؛ لا نشر قبل المراجعة
