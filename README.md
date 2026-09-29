# RASED · راصد

**راصد** تطبيق Windows محلي يجمع فرص العمل الحر من المنصات المدعومة وينبّهك بالجديد. يتابع مشاريع [مستقل](https://mostaql.com/) و[نفذلي](https://nafezly.com/) عبر RSS و[طلبات الخدمات غير الموجودة في خمسات](https://khamsat.com/community/requests) عبر صفحتها العامة. تقديم العروض والردود يتم بنفسك على المنصات؛ لا يحتاج راصد سيرفر أو حسابًا داخل التطبيق.

![واجهة راصد بالعربية](docs/screenshots/identity/ar-main.png)

## تحميل التطبيق لأصحابك

**الإصدار الحالي: [RASED 0.4.0](https://github.com/deved234/rased/releases/tag/v0.4.0)**. راجع [سجل التغييرات](CHANGELOG.md) و[ملاحظات الإصدار والتحقق](docs/RELEASE_0.4.0.md).

حمّل **`RASED-Setup-0.4.0.exe`** من [صفحة الإصدارات](https://github.com/deved234/rased/releases/latest) → **Assets** وشغّله على Windows x64. لا تختار Source code إن كنت تريد تشغيل التطبيق فقط. لا تحتاج تثبيت Node.js أو SQLite. المثبّت غير موقّع رقميًا حاليًا، ولذلك قد يظهر تحذير من Windows؛ تأكد من مصدر التحميل. بصمة SHA-256 متاحة في ملف `SHA256SUMS.txt` مع التحميل، ويمكن حسابها للمقارنة بالأمر:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\RASED-Setup-0.4.0.exe'
```

أول فحص ناجح لكل مصدر يحفظ الفرص الموجودة كنقطة بداية دون تنبيهات قديمة. بعده تظهر الفرص الجديدة في القائمة ويُرسل تنبيه Windows بحسب الفلاتر التي تختارها. يمكن إغلاق النافذة مع استمرار المتابعة من أيقونة النظام، أو إيقافها من التطبيق. البيانات والإعدادات تُحفظ محليًا في `%APPDATA%\RASED\rased.db`.

[مراجعة الهوية وتجربة المستخدم والتحسينات المقترحة](docs/BRAND_AND_UX_AUDIT.md).

[التصور البصري وتطبيق المعاينة الجانبية](docs/UI_CONCEPT_V2.md). الضغط على صف الفرصة أو زر «معاينة» يفتح معاينتها بجوار القائمة؛ «عرض التفاصيل كاملة» يفتح صفحتها داخل راصد، وزر المنصة يفتحها في المتصفح. يمكن إيقاف رصد مستقل وخمسات ونفذلي مؤقتًا كلٌّ على حدة من حالة الرصد أو الإعدادات أو أيقونة النظام؛ يعود الإيقاف المؤقت عند إعادة تشغيل التطبيق، بينما يبقى تعطيل المصدر المحفوظ في الإعدادات.

يمكن لمستخدمي 0.2.5 أو أحدث التحديث من داخل البرنامج، أو الخروج من راصد بالكامل من قائمة أيقونة النظام ثم تشغيل المثبت الجديد. لا تحذف مجلد البيانات. شاشة البداية تُعرض عند تشغيل العملية، وليس كل مرة تستعيد النافذة من أيقونة النظام. الإشعارات الجديدة تحمل رابط HTTPS يفتحه Windows مباشرة في المتصفح الافتراضي، حتى من مركز الإشعارات بعد خروج راصد. الإشعارات القديمة لا تتغير؛ اضغط بطاقة الفرصة داخل راصد لعرض تفاصيلها داخل التطبيق.

**التحديث من داخل البرنامج:** 0.2.5 أول نسخة تدعم الميزة. أصحاب 0.2.4 أو أقدم يحتاجون تثبيتها يدويًا مرة واحدة. بعدها راصد يفحص GitHub عند التشغيل وكل 6 ساعات، ويمكنك من **الإعدادات → تحديثات راصد** تحميل التحديث ومتابعة تقدّمه ثم إعادة التشغيل والتثبيت. لا تحميل أو تثبيت إجباري، ولا تثبيت بمجرد إغلاق البرنامج، مع حماية الملاحظات غير المحفوظة. [تفاصيل التحديث والنشر](docs/UPDATES.md).

![شاشة بداية راصد](docs/screenshots/startup/ar-ready.png)

## تشغيل الكود وتطويره

المطلوب: Windows وNode.js 24 مع npm. لا تحتاج تثبيت Electron أو SQLite منفصلين؛ `npm ci` يثبت الاعتماديات وSQLite مدمجة مع Node.

```powershell
git clone https://github.com/deved234/rased.git
cd rased
npm ci
npm run dev
```

`npm run dev` يفتح نافذة Electron مستقلة (مش تبويب في المتصفح). لو ملف Electron التنفيذي ناقص بعد تثبيت المكتبات، الأمر يحمّله تلقائيًا قبل فتح النافذة؛ أول تشغيل قد يأخذ وقتًا أطول. الرابط `localhost:5173` الذي يظهر في الـTerminal هو خادم واجهة React الداخلي.

أوامر الفحص والبناء:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run dist
```

`npm run test:e2e` يختبر Electron الحقيقي بقاعدة مؤقتة جديدة وبيانات ثابتة؛ يستبدل الشبكة وإرسال OS فقط، ولا يستخدم بياناتك. للاختبار على النسخة المجمعة: `node scripts/e2e-cdp.mjs --exe="release/win-unpacked/RASED.exe" --app=""`. لا تستخدم profile موجودًا؛ السكربت يرفضه ولا يحذفه.

`npm run dist` يُخرج مثبّت Windows داخل `release/`. المجلدان `out/` و`release/` ناتجان عن البناء وغير محفوظين في Git؛ التحميل الجاهز يوجد في GitHub Releases.

## عن المشروع

- Electron 44 وReact 19 وTypeScript و`node:sqlite`.
- واجهة عربية RTL وإنجليزية LTR، مع تصميم داكن هادئ **ووضع فاتح** (0.2.1).
- فحص RSS افتراضيًا كل 5 ثوانٍ، وفلاتر للمجالات والكلمات والميزانية (بعضها محفوظ بأسماء)، وتنبيهات Windows وصوت اختياري ووضع عدم إزعاج.
- صفحة تفاصيل داخل التطبيق لكل مشروع (نص كامل عند توفره)، محفوظات وحالات شخصية وملاحظات محلية، ونافذة متابعة صغيرة اختيارية.
- احترام `Retry-After` وفترات التهدئة عند الأخطاء أو تقييد الطلبات. لا تسجيل دخول، ولا إرسال عروض آلي، ولا تجاوز لحماية الموقع.
- توقيت نشر المشروع في RSS واستجابة الشبكة خارج سيطرة التطبيق؛ لا يمكن ضمان وصول التنبيه لحظيًا أو قبل كل المنافسين.

**مساعد كتابة العروض باستخدام Gemini:** من تفاصيل مشروع مستقل افتح «مساعد العروض»، وأضف مفتاحك وملفك المهني من الإعدادات، ثم راجع البيانات قبل الضغط على «توليد». تحفظ المسودة محليًا ويمكن تعديلها ونسخها؛ تقديمها على مستقل يدوي. راجع [التفاصيل](docs/PROPOSAL_ASSISTANT_CONCEPT.md) و[الخصوصية](PRIVACY.md) قبل الاستخدام.

**رصد خمسات:** فعّل أو عطّل المصدر من الإعدادات، واختر كلمات في عنوان الطلب للتنبيه، أو اعرض المصدر منفصلًا من فلاتر القائمة. يفحص العنوان والرابط وتاريخ النشر من الصفحة العامة كل 5 ثوانٍ في الحالة السليمة، مع تهدئة تلقائية عند الأخطاء. يبدأ بأرشفة صامتة للطلبات الموجودة ثم ينبه بالطلبات الجديدة فقط. وصف الطلب الكامل غير متاح للرصد العام حاليًا؛ افتح الطلب في المتصفح لقراءته. [تفاصيل التنفيذ وحدود التحقق](docs/KHAMSAT_MONITORING.md).

**رصد نفذلي:** يتابع [RSS المشاريع العامة](https://nafezly.com/feed) بفاصل 15–18 ثانية تقريبًا في الحالة السليمة، ويحفظ الوصف الوارد في الخلاصة محليًا. يبدأ بأرشفة صامتة لما هو موجود، ثم ينبه بالمشاريع الجديدة مع كلمات اختيارية على العنوان والوصف. الفحص والإيقاف والتنبيهات مستقلة عن باقي المنصات، ويتباطأ تلقائيًا عند أخطاء الوصول. لا يطلب صفحات تفاصيل نفذلي ولا يسجل الدخول. [البحث والقيود](docs/NAFEZLY_RESEARCH.md) و[خطة التنفيذ](docs/NAFEZLY_IMPLEMENTATION_PLAN.md).

مؤسس ومطوّر راصد: **david atef** — [GitHub](https://github.com/deved234) · [LinkedIn](https://www.linkedin.com/in/david-atef/).

الخطة والمراجعة التقنية في [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md)، [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)، و[FIX_REPORT.md](FIX_REPORT.md)، و[إصلاحات الواجهة 0.2.1](docs/UI_UX_FIX_REPORT.md). للمساهمة اقرأ [CONTRIBUTING.md](CONTRIBUTING.md). للإبلاغ عن مشكلة استخدم [Issues](https://github.com/deved234/rased/issues). المشروع متاح برخصة [MIT](LICENSE).

---

## English

RASED is a local Windows app that brings new freelance opportunities from supported platforms into one place. It watches public [Mostaql](https://mostaql.com/) and [Nafezly](https://nafezly.com/feed) RSS feeds and the [Khamsat unavailable-service requests](https://khamsat.com/community/requests) listing. You submit proposals or replies yourself in your browser; no server or app account is required.

Download **RASED-Setup-0.4.0.exe** under **Assets** in [Releases](https://github.com/deved234/rased/releases/latest), rather than the Source code archives. Node.js and SQLite are **not** required for end users. The installer is currently unsigned; verify its source and the downloadable SHA256SUMS.txt. Users on 0.2.5 or newer can update in-app. The first successful fetch for each source establishes a silent baseline; later opportunities can trigger notifications. Clicking a notification opens your default browser.

0.2.5 adds in-app updates: Settings → RASED updates, then Download update and Restart and update. Checks run at startup and every 6 hours; download/install are explicit, with unsaved-note protection. Users coming from 0.2.4 or older need one manual install of this first updater-capable version. See the [update/release guide](docs/UPDATES.md).

To develop, install Node.js 24, clone this repository, run `npm ci`, then `npm run dev`. Run `npm run typecheck`, `npm run lint`, and `npm test` before contributing. `npm run dist` builds the installer locally. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [MIT license](LICENSE).

`npm run dev` opens an Electron desktop window. If the Electron executable is missing, the dev command downloads it before launching. The printed `localhost:5173` URL is the internal React development server.

**Gemini Proposal Assistant:** From a Mostaql project, open the assistant, add your own key and real freelancer profile in Settings, review the outgoing data, then explicitly generate an editable local draft. Submission on Mostaql remains manual. See the [feature notes](docs/PROPOSAL_ASSISTANT_CONCEPT.md) and [privacy disclosure](PRIVACY.md).

**Khamsat monitoring:** Settings include a source toggle and title-keyword alerts; the project list can filter by source. Full request text must be read on Khamsat in your browser. See [implementation and verification limits](docs/KHAMSAT_MONITORING.md).

**Nafezly monitoring:** The public RSS feed is checked roughly every 15–18 seconds while healthy. Existing items form a silent baseline. New projects can trigger alerts filtered against their RSS titles and descriptions. The feed description is stored locally; no Nafezly account or detail-page requests are used. Source pause, enable and alert controls are independent. See [research and limits](docs/NAFEZLY_RESEARCH.md).


## الشروط والخصوصية والحقوق

اقرأ [شروط راصد](TERMS.md) و[الخصوصية](PRIVACY.md)، المتاحتين أيضًا داخل الإعدادات. ترخيص MIT يخص الكود ولا يمنح حقوقًا في محتوى مستقل أو خمسات أو نفذلي أو إذنًا بالجلب الآلي. راصد مستقل عن المنصات المدعومة. [مراجعة المصادر والمخاطر](docs/legal/LEGAL_REVIEW.md) و[مسودة طلب الإذن](docs/legal/PERMISSION_REQUEST.md) موثقتان؛ لم تُرسل المسودة.

[رخص المكونات والخطوط](resources/legal/THIRD_PARTY_NOTICES.txt) مرفقة مع التطبيق، مع رخص Electron وChromium في التوزيع. لا توجد تحليلات أو رفع آلي للمطور؛ الجهاز يتصل بالمصادر المفعّلة مباشرة وقد ترى IP ومعلومات الطلب. البيانات المحلية والنسخ الاحتياطية غير مشفرة بواسطة التطبيق.

في 0.2.3 أُضيف شريط نافذة مخصص وأيقونة بوصلة متجهية مضبوطة المركز. `npm run icons` يولّد PNG/ICO/Tray منها، و`prebuild` يجمع المستندات القانونية والرخص تلقائيًا.
