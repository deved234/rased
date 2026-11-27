# RASED · راصد

تطبيق سطح مكتب محلي يعمل على **Windows، وmacOS وLinux (تجريبيين)** لمتابعة فرص العمل الحر من **مستقل ونفذلي وخمسات وكاف**، بواجهة عربية وإنجليزية وتنبيهات سطح المكتب. لا يحتاج سيرفر أو حساب راصد.

[تحميل آخر إصدار](https://github.com/deved234/rased/releases/latest) · [سجل التغييرات](CHANGELOG.md) · [المساهمة](CONTRIBUTING.md) · [الإبلاغ عن مشكلة](https://github.com/deved234/rased/issues) · [قناة تليجرام](https://t.me/rased_app)

![واجهة راصد بالعربية](docs/images/projects.png)

[دليل الواجهة والتنقل وحفظ التعديلات](docs/INTERFACE.md)

لقطة فعلية للواجهة ببيانات تجريبية، دون حسابات أو معلومات شخصية.

## التحميل والتشغيل

اضغط على رابط نظامك، وسيبدأ التحميل مباشرة:

| نظامك | رابط التحميل | طريقة التثبيت |
|---|---|---|
| **Windows** | **[⬇️ تحميل راصد لـ Windows](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-Setup-0.14.0.exe)** | افتح الملف واتبع خطوات المثبّت |
| **Mac** (تجريبي) | **[⬇️ تحميل راصد للماك](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-mac.dmg)** | [خطوات التثبيت على الماك](docs/INSTALL_MACOS.md) |
| **Linux** (تجريبي) | **[⬇️ ملف deb لـ Ubuntu وMint](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-amd64.deb)** أو **[⬇️ ملف AppImage لباقي الأنظمة](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-x86_64.AppImage)** | [خطوات التثبيت على Linux](docs/INSTALL_LINUX.md) |

**على Windows:** قد تظهر رسالة زرقاء «Windows protected your PC» لأن المثبّت غير موقّع. اضغط **More info** ثم **Run anyway**.

**على الماك:** أول مرة تحتاج خطوة سماح واحدة، وهي مشروحة في [خطوات التثبيت على الماك](docs/INSTALL_MACOS.md).

لا تحتاج تثبيت أي برنامج آخر. قابلتك مشكلة؟ اسأل في [جروب راصد على تليجرام](https://t.me/rased_chat).

<details>
<summary>للمهتمين: التأكد من سلامة الملف (SHA256)</summary>

قارن بصمة الملف بملف `SHA256SUMS.txt` في [صفحة الإصدار](https://github.com/deved234/rased/releases/tag/v0.14.0):

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\RASED-Setup-0.14.0.exe'
```

على الماك: `shasum -a 256 RASED-0.14.0-mac.dmg`، وعلى Linux: `sha256sum RASED-0.14.0-linux-amd64.deb`.
</details>

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

الجلب يتباطأ عند الأخطاء ويحترم `Retry-After`. زمن النشر والشبكة خارج سيطرة راصد؛ لا ضمان للرصد الفوري أو السبق على المنافسين. يتحكم نظام التشغيل في ظهور الإشعارات أثناء الألعاب أو وضع عدم الإزعاج.

## للمبرمجين

المتطلبات: **Windows أو macOS أو Linux، Node.js 24، npm**. Electron وSQLite ضمن الاعتماديات.

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
npm run dist:mac
npm run dist:linux
```

`dist` و`dist:mac` و`dist:linux` تنشئ حزم التوزيع داخل `release/` دون نشر. اختبارات التكامل تستخدم ملفات مؤقتة وبيانات وهمية؛ لا تستخدم حساباتك أو مفاتيحك. [دليل المساهمة](CONTRIBUTING.md) يشرح الاختبارات الإضافية و[المعمارية](docs/ARCHITECTURE.md) تشرح تنظيم الكود. خطط العمل والمراجعات الداخلية وأدلة QA المولّدة ليست جزءًا من المستودع العام.

إصدار **0.12.1** يُصلح متابعة مشاريع مستقل التي لم تكن تعمل في 0.12.0، ويتبع إعدادات Proxy في Windows مثل المتصفح، بما فيها VPN بوضع «System proxy»، بدل تجاهلها وانتهاء المهلة في كل المصادر، ويقرأ مدة «2 يومين». لا تغيير في قاعدة البيانات أو الإحصائيات أو الشروط. [تفاصيل 0.12.1](docs/RELEASE_0.12.1.md).

إصدار **0.12.0** يضيف متابعة المشاريع لمستقل ونفذلي وكاف: زر «متابعة»، وشاشة «متابعة المشاريع»، وتنبيهات التواصل على مستقل وتغيّر الحالة، وملخص «حصل وأنت غايب»، مع حد 10 مشاريع لكل منصة وأولوية دائمة للرصد الأساسي. الشروط والخصوصية بتاريخ 2026-11-15، وإفصاح الإحصائيات الجديد `2026-11-15-v5` يضيف أحداث المتابعة وتُطلب الموافقة عليه من جديد؛ والتحقق من الحذف السحابي ما زال معلّقًا. الإصدار 0.11.0 لا يفتح قاعدة بيانات رقّاها 0.12.0. راجع [تفاصيل الإصدار](docs/RELEASE_0.12.0.md) و[دليل المتابعة](docs/PROJECT_WATCH.md). [دليل الإحصائيات](docs/ANALYTICS.md) · [سجل التغييرات](CHANGELOG.md).

تفاصيل نقل الإعدادات والنسخ الاحتياطي والاستعادة موجودة في [دليل حماية البيانات](docs/BACKUP_AND_RESTORE.md).

إدارة المنصات والتعطيل المحفوظ والإيقاف المؤقت وحالات الاتصال وتحذيرات الفجوات موضحة في [دليل صحة الرصد](docs/MONITORING_HEALTH.md).

جلب الميزانية ومدة التنفيذ وحالات البيانات الناقصة في المعاينة والتفاصيل موضحة في [دليل بيانات المشروع](docs/PROJECT_DETAILS.md).

البحث في الأوصاف المحفوظة، والبحث الاختياري في ملاحظاتك ومسودات عروضك، وسلوك النتائج الجديدة موضحة في [دليل البحث](docs/PROJECT_SEARCH.md).

## الخصوصية والترخيص

البيانات محلية في `%APPDATA%\RASED` (Windows) أو `~/Library/Application Support/RASED` (macOS) أو `~/.config/RASED` (Linux). النسخة الرسمية من 0.10.0 تشترط موافقتك الصريحة على إرسال إحصائيات محدودة إلى PostHog قبل الاستخدام، ويمكنك الخروج بدلًا من الموافقة أو سحبها لاحقًا. لا يوجد حذف دوري من راصد؛ يمكن طلب حذفها مع مراعاة سياسات المزود ومتطلبات القانون. التحقق النهائي من اكتمال حذف الأحداث لدى المزود لم يكتمل بعد، وهذا موضح قبل الموافقة؛ يمكن إيقاف الإرسال وطلب الحذف من الإعدادات. [دليل الإحصائيات وحدود الأرقام](docs/ANALYTICS.md). يتصل الجهاز بالمنصات وGitHub، وبموفر AI المختار عند استخدامه. مفاتيح AI مشفرة بتشفير Windows؛ قاعدة البيانات والملاحظات ليست مشفرة بواسطة التطبيق. اقرأ [الخصوصية](PRIVACY.md) و[الشروط](TERMS.md) قبل الاستخدام.

راصد مستقل عن المنصات ولا يمثلها. [MIT](LICENSE) يخص الكود ولا يمنح حقوقًا في محتوى المنصات أو إذنًا باستخدامها. [رخص المكونات](resources/legal/THIRD_PARTY_NOTICES.txt) مرفقة بالتوزيع.

تطوير **david atef** · [GitHub](https://github.com/deved234) · [LinkedIn](https://www.linkedin.com/in/david-atef/).

## English

RASED is a local desktop app for Windows, plus macOS and Linux (beta), that monitors freelance opportunities on Mostaql, Nafezly, Khamsat and KAF. It offers Arabic/English UI, independent source controls, desktop alerts, filters, previews and local notes.

Click the link for your system and the download starts: **[⬇️ Windows](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-Setup-0.14.0.exe)** · **[⬇️ Mac (beta)](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-mac.dmg)** ([how to install](docs/INSTALL_MACOS.md)) · **[⬇️ Linux deb for Ubuntu/Mint (beta)](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-amd64.deb)** or **[AppImage for other systems](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-x86_64.AppImage)** ([how to install](docs/INSTALL_LINUX.md)). On Windows, if a blue "Windows protected your PC" message appears, click **More info** then **Run anyway**. Questions? Ask in the [RASED Telegram group](https://t.me/rased_chat). Release announcements and tips are posted on the [Telegram channel](https://t.me/rased_app). End users need neither Node.js nor SQLite. The Windows installer is unsigned; the macOS build is an unsigned beta (not notarized). Verify the download source and SHA-256 checksum. Existing users on 0.2.5+ can update inside Settings → RASED updates. Since 0.10.0 the official build requires accepting limited usage analytics (**Agree & use RASED** or **Exit**) before monitoring or any feature starts. 0.9.1 participants accept again, and earlier declines stay declined. Development builds are exempt and send nothing. Cloud-deletion verification is still pending. Version **0.12.1** fixes Mostaql project watch, which never checked any page in 0.12.0, follows the Windows proxy/PAC settings like the browser, including VPNs in system-proxy mode, instead of ignoring them and timing out on every source, and reads Arabic dual durations; no migration, analytics or legal change ([0.12.1 release notes](docs/RELEASE_0.12.1.md)). Version **0.12.0** adds project watch for Mostaql, Nafezly and KAF: a Watch button, a Watched projects screen, Mostaql contact and status alerts and a "While you were away" summary, up to 10 per platform, always yielding to primary monitoring. Terms and Privacy are dated 2026-11-15; the new analytics disclosure `2026-11-15-v5` adds watch events and must be accepted again. 0.11.0 cannot open a database upgraded by 0.12.0. See the [0.12.0 release notes](docs/RELEASE_0.12.0.md), the [project watch guide](docs/PROJECT_WATCH.md) and the [analytics guide](docs/ANALYTICS.md).

The optional [Proposal Assistant](docs/AI_ASSISTANT.md) supports Gemini, OpenAI and Claude with your own API keys and model selection, for Mostaql, Nafezly and KAF projects; KAF offers copy and open only, and Khamsat is excluded. [Quick Apply](docs/QUICK_APPLY.md) uses a manually installed Chrome extension for Mostaql/Nafezly only. It fills a draft using your normal browser session and **never submits it**. Monitoring needs no platform login; browser form filling does.

For development, use Windows, macOS or Linux with Node.js 24, then `npm ci` and `npm run dev`. Package with `npm run dist` (Windows), `npm run dist:mac` or `npm run dist:linux`. See [Contributing](CONTRIBUTING.md), [Architecture](docs/ARCHITECTURE.md), [Privacy](PRIVACY.md), [Terms](TERMS.md) and [MIT](LICENSE). API contracts and app integration are tested with fixtures; live provider accounts and every model are not certified.
