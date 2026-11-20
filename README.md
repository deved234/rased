# RASED · راصد

تطبيق Windows محلي لمتابعة فرص العمل الحر من **مستقل ونفذلي وخمسات وكاف**، بواجهة عربية وإنجليزية وتنبيهات سطح المكتب. لا يحتاج سيرفر أو حساب راصد.

[تحميل آخر إصدار](https://github.com/deved234/rased/releases/latest) · [سجل التغييرات](CHANGELOG.md) · [المساهمة](CONTRIBUTING.md) · [الإبلاغ عن مشكلة](https://github.com/deved234/rased/issues) · [قناة تليجرام](https://t.me/rased_app)

![واجهة راصد بالعربية](docs/images/projects.png)

[دليل الواجهة والتنقل وحفظ التعديلات](docs/INTERFACE.md)

لقطة فعلية للواجهة ببيانات تجريبية، دون حسابات أو معلومات شخصية.

## التحميل والتشغيل

حمّل **RASED-Setup-0.12.1.exe** من قسم **Assets** في صفحة الإصدار، ثم شغّل المثبت على **Windows x64**. لا تحتاج Node.js أو SQLite؛ ملفات Source code للمبرمجين فقط. المثبت غير موقّع حاليًا، وقد يعرض Windows تحذيرًا. تأكد من مصدر التحميل وقارن البصمة بملف `SHA256SUMS.txt`:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\RASED-Setup-0.12.1.exe'
```

أول فحص ناجح لكل منصة يحفظ الموجود دون تنبيهات قديمة. بعدها ينبهك بالجديد بحسب فلاترك. إغلاق النافذة يبقي الرصد في الخلفية؛ للخروج الكامل استخدم قائمة أيقونة راصد بجوار الساعة. النقر على إشعار المشروع يفتح رابطه في المتصفح الافتراضي.

من **الإعدادات ← تحديثات راصد** يمكنك تحميل التحديث ثم إعادة التشغيل والتثبيت. أصحاب 0.2.4 أو أقدم يحتاجون تثبيتًا يدويًا مرة واحدة. [دليل التحديث](docs/UPDATES.md).

## المزايا

- رصد مستقل عبر RSS، ونفذلي عبر RSS، وطلبات الخدمات غير الموجودة بخمسات عبر الصفحة العامة؛ تحكم مستقل في إيقاف وتنبيهات كل مصدر.
- **كاف:** رصد القائمة العامة وتنبيهات الفرص المفتوحة، متاح بدءًا من 0.7.0، مع إيقاف وتنبيهات مستقلة وتفاصيل عند الطلب. [دليل كاف](docs/KAF.md).
- بحث وفلاتر محفوظة ومعاينة جانبية وتفاصيل المشروع وملاحظات ومحفوظات محلية.
- واجهة عربية RTL وإنجليزية LTR، وضع داكن وفاتح، ونافذة متابعة صغيرة.
- **متابعة المشاريع:** تابع حتى 10 مشاريع لكل منصة في مستقل ونفذلي وكاف، وتنبيه عند بدء التواصل على مستقل أو دخول المشروع التنفيذ أو إغلاقه، مع شاشة «متابعة المشاريع». الرصد الأساسي له الأولوية دائمًا. [دليل المتابعة](docs/PROJECT_WATCH.md).
- **مساعد العروض:** Gemini وOpenAI وClaude بمفتاحك الخاص، واختيار الموديل ومعاينة البيانات قبل إنشاء مسودة قابلة للتعديل. لمشاريع مستقل ونفذلي وكاف؛ كاف للنسخ وفتح الرابط فقط، وخمسات غير مشمول. [دليل المساعد](docs/AI_ASSISTANT.md).
- **التقديم السريع:** إضافة Chrome مجانية تُحمّل يدويًا مرة واحدة، وتعبئ قالبك والسعر والمدة في مستقل ونفذلي. تراجع وتضغط تقديم بنفسك؛ خمسات وكاف غير مشمولين بتجهيز Chrome. [التركيب والاستخدام](docs/QUICK_APPLY.md).

الجلب يتباطأ عند الأخطاء ويحترم `Retry-After`. زمن النشر والشبكة خارج سيطرة راصد؛ لا ضمان للرصد الفوري أو السبق على المنافسين. Windows يتحكم في ظهور الإشعارات أثناء الألعاب وعدم الإزعاج.

## للمبرمجين

المتطلبات: **Windows x64، Node.js 24، npm**. Electron وSQLite ضمن الاعتماديات.

```powershell
git clone https://github.com/deved234/rased.git
cd rased
npm ci
npm run dev
```

يفتح الأمر نافذة Electron مستقلة؛ `localhost:5173` خادم React الداخلي. أول تشغيل قد يستغرق أطول لتحميل Electron وبناء ملفات إضافة Chrome.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:search
npm run test:ai
npm run test:quick-apply
npm run test:data
npm run test:monitoring
npm run test:project-facts
npm run test:telemetry
npm run dist
```

`dist` ينشئ المثبت داخل `release/` دون نشر. اختبارات التكامل تستخدم ملفات مؤقتة وبيانات وهمية؛ لا تستخدم حساباتك أو مفاتيحك. [دليل المساهمة](CONTRIBUTING.md) يشرح الاختبارات الإضافية و[المعمارية](docs/ARCHITECTURE.md) تشرح تنظيم الكود. خطط العمل والمراجعات الداخلية وأدلة QA المولّدة ليست جزءًا من المستودع العام.

إصدار **0.12.1** يُصلح متابعة مشاريع مستقل التي لم تكن تعمل في 0.12.0، ويتبع إعدادات Proxy في Windows مثل المتصفح، بما فيها VPN بوضع «System proxy»، بدل تجاهلها وانتهاء المهلة في كل المصادر، ويقرأ مدة «2 يومين». لا تغيير في قاعدة البيانات أو الإحصائيات أو الشروط. [تفاصيل 0.12.1](docs/RELEASE_0.12.1.md).

إصدار **0.12.0** يضيف متابعة المشاريع لمستقل ونفذلي وكاف: زر «متابعة»، وشاشة «متابعة المشاريع»، وتنبيهات التواصل على مستقل وتغيّر الحالة، وملخص «حصل وأنت غايب»، مع حد 10 مشاريع لكل منصة وأولوية دائمة للرصد الأساسي. الشروط والخصوصية بتاريخ 2026-11-15، وإفصاح الإحصائيات الجديد `2026-11-15-v5` يضيف أحداث المتابعة وتُطلب الموافقة عليه من جديد؛ والتحقق من الحذف السحابي ما زال معلّقًا. الإصدار 0.11.0 لا يفتح قاعدة بيانات رقّاها 0.12.0. راجع [تفاصيل الإصدار](docs/RELEASE_0.12.0.md) و[دليل المتابعة](docs/PROJECT_WATCH.md). [دليل الإحصائيات](docs/ANALYTICS.md) · [سجل التغييرات](CHANGELOG.md).

تفاصيل نقل الإعدادات والنسخ الاحتياطي والاستعادة موجودة في [دليل حماية البيانات](docs/BACKUP_AND_RESTORE.md).

إدارة المنصات والتعطيل المحفوظ والإيقاف المؤقت وحالات الاتصال وتحذيرات الفجوات موضحة في [دليل صحة الرصد](docs/MONITORING_HEALTH.md).

جلب الميزانية ومدة التنفيذ وحالات البيانات الناقصة في المعاينة والتفاصيل موضحة في [دليل بيانات المشروع](docs/PROJECT_DETAILS.md).

البحث في الأوصاف المحفوظة، والبحث الاختياري في ملاحظاتك ومسودات عروضك، وسلوك النتائج الجديدة موضحة في [دليل البحث](docs/PROJECT_SEARCH.md).

## الخصوصية والترخيص

البيانات محلية في `%APPDATA%\RASED`. النسخة الرسمية من 0.10.0 تشترط موافقتك الصريحة على إرسال إحصائيات محدودة إلى PostHog قبل الاستخدام، ويمكنك الخروج بدلًا من الموافقة أو سحبها لاحقًا. لا يوجد حذف دوري من راصد؛ يمكن طلب حذفها مع مراعاة سياسات المزود ومتطلبات القانون. التحقق النهائي من اكتمال حذف الأحداث لدى المزود لم يكتمل بعد، وهذا موضح قبل الموافقة؛ يمكن إيقاف الإرسال وطلب الحذف من الإعدادات. [دليل الإحصائيات وحدود الأرقام](docs/ANALYTICS.md). يتصل الجهاز بالمنصات وGitHub، وبموفر AI المختار عند استخدامه. مفاتيح AI مشفرة بتشفير Windows؛ قاعدة البيانات والملاحظات ليست مشفرة بواسطة التطبيق. اقرأ [الخصوصية](PRIVACY.md) و[الشروط](TERMS.md) قبل الاستخدام.

راصد مستقل عن المنصات ولا يمثلها. [MIT](LICENSE) يخص الكود ولا يمنح حقوقًا في محتوى المنصات أو إذنًا باستخدامها. [رخص المكونات](resources/legal/THIRD_PARTY_NOTICES.txt) مرفقة بالتوزيع.

تطوير **david atef** · [GitHub](https://github.com/deved234) · [LinkedIn](https://www.linkedin.com/in/david-atef/).

## English

RASED is a local Windows desktop app monitoring freelance opportunities on Mostaql, Nafezly, Khamsat and KAF. It offers Arabic/English UI, independent source controls, desktop alerts, filters, previews and local notes.

Download **RASED-Setup-0.12.1.exe** from [Releases](https://github.com/deved234/rased/releases/latest). Release announcements and tips are posted on the [Telegram channel](https://t.me/rased_app). End users need neither Node.js nor SQLite. The installer is unsigned; verify its source and SHA-256 checksum. Existing users on 0.2.5+ can update inside Settings → RASED updates. Since 0.10.0 the official build requires accepting limited usage analytics (**Agree & use RASED** or **Exit**) before monitoring or any feature starts. 0.9.1 participants accept again, and earlier declines stay declined. Development builds are exempt and send nothing. Cloud-deletion verification is still pending. Version **0.12.1** fixes Mostaql project watch, which never checked any page in 0.12.0, follows the Windows proxy/PAC settings like the browser, including VPNs in system-proxy mode, instead of ignoring them and timing out on every source, and reads Arabic dual durations; no migration, analytics or legal change ([0.12.1 release notes](docs/RELEASE_0.12.1.md)). Version **0.12.0** adds project watch for Mostaql, Nafezly and KAF: a Watch button, a Watched projects screen, Mostaql contact and status alerts and a "While you were away" summary, up to 10 per platform, always yielding to primary monitoring. Terms and Privacy are dated 2026-11-15; the new analytics disclosure `2026-11-15-v5` adds watch events and must be accepted again. 0.11.0 cannot open a database upgraded by 0.12.0. See the [0.12.0 release notes](docs/RELEASE_0.12.0.md), the [project watch guide](docs/PROJECT_WATCH.md) and the [analytics guide](docs/ANALYTICS.md).

The optional [Proposal Assistant](docs/AI_ASSISTANT.md) supports Gemini, OpenAI and Claude with your own API keys and model selection, for Mostaql, Nafezly and KAF projects; KAF offers copy and open only, and Khamsat is excluded. [Quick Apply](docs/QUICK_APPLY.md) uses a manually installed Chrome extension for Mostaql/Nafezly only. It fills a draft using your normal browser session and **never submits it**. Monitoring needs no platform login; browser form filling does.

For development, use Windows and Node.js 24, then `npm ci` and `npm run dev`. See [Contributing](CONTRIBUTING.md), [Architecture](docs/ARCHITECTURE.md), [Privacy](PRIVACY.md), [Terms](TERMS.md) and [MIT](LICENSE). API contracts and app integration are tested with fixtures; live provider accounts and every model are not certified.
