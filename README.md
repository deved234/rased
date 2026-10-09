# RASED · راصد

تطبيق Windows محلي لمتابعة فرص العمل الحر من **مستقل ونفذلي وخمسات**، بواجهة عربية وإنجليزية وتنبيهات سطح المكتب. لا يحتاج سيرفر أو حساب راصد.

[تحميل آخر إصدار](https://github.com/deved234/rased/releases/latest) · [سجل التغييرات](CHANGELOG.md) · [المساهمة](CONTRIBUTING.md) · [الإبلاغ عن مشكلة](https://github.com/deved234/rased/issues)

![واجهة راصد بالعربية](docs/images/projects.png)

[دليل الواجهة والتنقل وحفظ التعديلات](docs/INTERFACE.md)

لقطة فعلية للواجهة ببيانات تجريبية، دون حسابات أو معلومات شخصية.

## التحميل والتشغيل

حمّل **RASED-Setup-0.6.0.exe** من قسم **Assets** في صفحة الإصدار، ثم شغّل المثبت على **Windows x64**. لا تحتاج Node.js أو SQLite؛ ملفات Source code للمبرمجين فقط. المثبت غير موقّع حاليًا، وقد يعرض Windows تحذيرًا. تأكد من مصدر التحميل وقارن البصمة بملف `SHA256SUMS.txt`:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\RASED-Setup-0.6.0.exe'
```

أول فحص ناجح لكل منصة يحفظ الموجود دون تنبيهات قديمة. بعدها ينبهك بالجديد بحسب فلاترك. إغلاق النافذة يبقي الرصد في الخلفية؛ للخروج الكامل استخدم قائمة أيقونة راصد بجوار الساعة. النقر على إشعار المشروع يفتح رابطه في المتصفح الافتراضي.

من **الإعدادات ← تحديثات راصد** يمكنك تحميل التحديث ثم إعادة التشغيل والتثبيت. أصحاب 0.2.4 أو أقدم يحتاجون تثبيتًا يدويًا مرة واحدة. [دليل التحديث](docs/UPDATES.md).

## المزايا

- رصد مستقل عبر RSS، ونفذلي عبر RSS، وطلبات الخدمات غير الموجودة بخمسات عبر الصفحة العامة؛ تحكم مستقل في إيقاف وتنبيهات كل مصدر.
- بحث وفلاتر محفوظة ومعاينة جانبية وتفاصيل المشروع وملاحظات ومحفوظات محلية.
- واجهة عربية RTL وإنجليزية LTR، وضع داكن وفاتح، ونافذة متابعة صغيرة.
- **مساعد العروض:** Gemini وOpenAI وClaude بمفتاحك الخاص، واختيار الموديل ومعاينة البيانات قبل إنشاء مسودة قابلة للتعديل. لمشاريع مستقل حاليًا. [دليل المساعد](docs/AI_ASSISTANT.md).
- **التقديم السريع:** إضافة Chrome مجانية تُحمّل يدويًا مرة واحدة، وتعبئ قالبك والسعر والمدة في مستقل ونفذلي. تراجع وتضغط تقديم بنفسك؛ خمسات غير مشمول. [التركيب والاستخدام](docs/QUICK_APPLY.md).

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
npm run test:ai
npm run test:quick-apply
npm run dist
```

`dist` ينشئ المثبت داخل `release/` دون نشر. اختبارات التكامل تستخدم ملفات مؤقتة وبيانات وهمية؛ لا تستخدم حساباتك أو مفاتيحك. [دليل المساهمة](CONTRIBUTING.md) يشرح الاختبارات الإضافية و[المعمارية](docs/ARCHITECTURE.md) تشرح تنظيم الكود. خطط العمل والمراجعات الداخلية وأدلة QA المولّدة ليست جزءًا من المستودع العام.

## الخصوصية والترخيص

البيانات محلية في `%APPDATA%\RASED`، دون تحليلات تُرسل للمطور. يتصل الجهاز بالمنصات وGitHub، وبموفر AI المختار عند استخدامه. مفاتيح AI مشفرة بتشفير Windows؛ قاعدة البيانات والملاحظات ليست مشفرة بواسطة التطبيق. اقرأ [الخصوصية](PRIVACY.md) و[الشروط](TERMS.md) قبل الاستخدام.

راصد مستقل عن المنصات ولا يمثلها. [MIT](LICENSE) يخص الكود ولا يمنح حقوقًا في محتوى المنصات أو إذنًا باستخدامها. [رخص المكونات](resources/legal/THIRD_PARTY_NOTICES.txt) مرفقة بالتوزيع.

تطوير **david atef** · [GitHub](https://github.com/deved234) · [LinkedIn](https://www.linkedin.com/in/david-atef/).

## English

RASED is a local Windows desktop app monitoring freelance opportunities on Mostaql, Nafezly and Khamsat. It offers Arabic/English UI, independent source controls, desktop alerts, filters, previews and local notes.

Download **RASED-Setup-0.6.0.exe** from [Releases](https://github.com/deved234/rased/releases/latest). End users need neither Node.js nor SQLite. The installer is unsigned; verify its source and SHA-256 checksum. Existing users on 0.2.5+ can update inside Settings → RASED updates.

The optional [Proposal Assistant](docs/AI_ASSISTANT.md) supports Gemini, OpenAI and Claude with your own API keys and model selection, currently for Mostaql projects. [Quick Apply](docs/QUICK_APPLY.md) uses a manually installed Chrome extension for Mostaql/Nafezly only. It fills a draft using your normal browser session and **never submits it**. Monitoring needs no platform login; browser form filling does.

For development, use Windows and Node.js 24, then `npm ci` and `npm run dev`. See [Contributing](CONTRIBUTING.md), [Architecture](docs/ARCHITECTURE.md), [Privacy](PRIVACY.md), [Terms](TERMS.md) and [MIT](LICENSE). API contracts and app integration are tested with fixtures; live provider accounts and every model are not certified.
