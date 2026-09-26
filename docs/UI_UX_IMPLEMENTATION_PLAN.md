# خطة تنفيذ RASED UI/UX v2 — تسليم إلى مودل منفّذ

التاريخ: 26 سبتمبر 2026. الحالة: **خطة تنفيذ، لم يبدأ تنفيذها بعد**. الإصدار المقترح بعد اكتمالها: 0.2.0. لغة التواصل مع المستخدم عربية مصرية؛ الكود TypeScript. المرجع الحالي هو الملفات الفعلية لا تاريخ المحادثة.

## 1. المهمة ومعيار النجاح

طوّر التطبيق الموجود إلى تجربة سطح مكتب كاملة تسهّل استعراض فرص مستقل وقراءتها وحفظها ثم فتحها في المتصفح. المطلوب تنفيذ كل نطاق هذه الوثيقة، وليس رسم mockup أو صفحة demo أو تغيير CSS فقط. لا تعِد إنشاء المشروع من الصفر. أنجز المراحل تدريجيًا مع تخزين دائم واختبارات ربط وتشغيل فعلي ومثبّت جديد.

المستخدم وافق على كل مقترحات `docs/UI_UX_REDESIGN.md` وأضاف:

1. ضغطة بطاقة المشروع تفتح **صفحة مستقلة للمشروع داخل راصد** بمعلوماته.
2. ضغطة تنبيه سطح المكتب تفتح **المشروع في المتصفح الافتراضي مباشرة**، ولا تُبرز نافذة راصد.
3. شاشة Splash تظهر عند تهيئة التطبيق، دون انتظار مصطنع أو تعطيل فتح القائمة المحلية بسبب الشبكة.
4. الحفاظ على Electron + React، تشغيل Windows محلي، مستقل فقط. خمسات مؤجل.

النجاح: ليست مجرد واجهة جميلة؛ كل زر وفلتر وملاحظة وحالة يعمل ويحفظ بعد إعادة التشغيل، والعودة من صفحة المشروع لا تفقد سياق القائمة، والنسخة المجمعة تعمل بنفس جودة dev، مع أدلة صريحة لما تم وما لم يُتحقق منه.

## 2. ملفات القراءة الإلزامية وترتيب الأولوية

اقرأ قبل التعديل:

1. هذه الوثيقة كاملة.
2. `docs/UI_UX_REDESIGN.md` كاملة؛ تحتوي جميع الأفكار والقيود البصرية.
3. افتح الصور فعليًا: `docs/design/rased-projects-v2.png`، `rased-project-detail-v2.png`، `rased-secondary-screens-v2.png`، ثم اقرأ `docs/design/IMAGE_PROMPTS.md`.
4. `README.md`، `FIX_REPORT.md`، `INDEPENDENT_REVIEW.md` مع الانتباه إلى أن المراجعة تاريخية وتم إصلاح ملاحظاتها.
5. ملفات الكود والاختبارات في خريطة القسم التالي. اقرأ `PROJECT_HANDOFF.md` و`IMPLEMENTATION_PLAN.md` لفهم التاريخ، لا لاعتبار حالتهما القديمة حقيقة عن الكود الحالي.
6. افحص أي `AGENTS.md` متاح حسب بيئة التنفيذ. حافظ على تغييرات المستخدم غير المتعلقة ولا تستبدلها.

الأولوية: طلب المستخدم والقرارات الوظيفية في هذه الخطة، ثم مواصفات إعادة التصميم، ثم الصور كمرجع شكلي. لا تنسخ أخطاء الصور: Mostaql API تسمية خاطئة؛ المصدر RSS، وخمسات خارج النطاق، وأشكال البوصلة المولدة ليست شعارًا جديدًا. بيانات المشاريع والنصوص والتوقيتات في الصور أمثلة وليست حقائق. تجنب اللمعان والتدرجات المولدة؛ نفّذ أسطحًا هادئة.

## 3. نقطة البداية الفعلية

- المشروع: RASED 0.1.1، GitHub `https://github.com/deved234/rased`، رخصة MIT.
- Electron 44.4.5 + React 19.3.0 + TypeScript 5.9.2 + electron-vite 5 + Vite 7 + `node:sqlite`، NSIS Windows x64.
- لا backend مستضاف، حساب داخل التطبيق، مفتاح API، أو تقديم عروض آلي.
- المصدر `https://mostaql.com/rss`، الافتراضي 5 ثوانٍ مع 2s تجريبي و15s، timeout وbackoff وRetry-After. لا ضمان للرصد اللحظي أو السبق العالمي.
- قاعدة SQLite في Electron userData، إصدار schema الحالي **2**. بيانات المشروع الحالية مقتطف RSS مع مجال ومهارات وميزانية من تفاصيل عامة؛ لا وصف كامل موثوق محفوظ بعد.
- baseline الأول صامت، dedup بـ(source, externalId)، والاكتشاف initial/live/recovered مستقل عن القراءة.
- 58 اختبارًا موجودًا؛ أرقام المرور التاريخية لا تغني عن تشغيلها بنفسك.
- `npm run dev` له predev ينزل Electron التنفيذي عند غيابه. سياسة CSP للتطوير مختلفة عن الإنتاج حتى يعمل Vite CSS/HMR. لا تتراجع عن هذا الإصلاح.
- آخر commit المعروف أثناء كتابة الخطة `13e77a0`. ملفات مواصفات التصميم قد تكون محلية وغير محفوظة في Git؛ راجع status ولا تفترض فقدها.
- المثبّت المنشور 0.1.1 أقدم من بعض إصلاحات التطوير. لا توزع هذا الملف كأنه نتيجة تنفيذ 0.2.0.

### خريطة الكود

| الملف | المسؤولية الحالية والتعديل المتوقع |
|---|---|
| `src/main/index.ts` | lifecycle ونافذة وTray وIPC وجدولة وتنبيهات؛ فصل الخدمات الضروري فقط، إضافة Splash/compact/API جديدة |
| `src/main/notifier.ts` | pending→dispatching→submitted/failed/suppressed؛ حافظ على سلامة الحالات |
| `src/main/links.ts` | allow-list وروابط مخزنة؛ لا تقبل URL arbitrary من renderer |
| `src/collector/rss.ts` | جلب RSS محدود ومهلة وإلغاء؛ لا تغيّر سلوكه لأجل التصميم |
| `src/collector/enrichment.ts` | جلب تفاصيل وقائمة إثراء مشتركة؛ توسعة وصف كامل محدود وقابل للفشل |
| `src/collector/pipeline.ts` | baseline/recovered/notify/waits؛ ربط DND دون تغيير قواعد الاكتشاف |
| `src/collector/scheduler.ts` | الجدولة والتهدئة؛ مرجع قيود طلبات تفاصيل المشروع |
| `src/collector/filters.ts` | التطبيع والكلمات والمجال؛ مصدر واحد لقواعد العرض/التنبيهات |
| `src/storage/{db,migrations,repositories}.ts` | ترحيل إضافي وبيانات المستخدم والتفاصيل والفلاتر والاستعلامات |
| `src/shared/{types,api,channels}.ts` | عقد IPC/types؛ أضف كل قناة هنا ولا تكرر نصوصها الخام |
| `src/preload/index.ts` | bridge ضيق؛ لا Node/fetch/SQL عام في renderer |
| `src/renderer/App.tsx` | التطبيق الحالي الموحّد؛ تقسيم إلى views/components/hooks |
| `src/renderer/{SettingsView,i18n,styles,sound}.ts*` | تنظيم الإعدادات والترجمة والتصميم والصوت |
| `electron.vite.config.ts` | مسارات البناء وسياسة dev؛ حافظ على CSP الإنتاج |
| `tests/` | اختبارات collector/storage/notifier وغيرها؛ أضف اختبارات سلوك لا صور snapshot فقط |

## 4. قرارات وظيفية تحسم التنفيذ

### 4.1 التنقل والقراءة

- routes داخلية من نوع hash أو state router يعمل مع file://؛ لا BrowserRouter يتطلب server fallback. لا حاجة لمكتبة routing إن لم تفد.
- views: قائمة المشاريع، المحفوظة، الفلاتر المحفوظة، صفحة المشروع `/project/:id`، أقسام الإعدادات. مرر ID محليًا فقط.
- البطاقة تفتح الصفحة الداخلية. زر مستقل أو اختصار يفتح المتصفح. الحفظ/نسخ الرابط/القائمة السياقية لا تفعّل ضغطة البطاقة.
- فتح صفحة التفاصيل بنجاح يُسجل المشروع مقروءًا مرة واحدة بعد تحميل بياناته؛ لا أثناء hover أو اختيار معاينة سريعة. فتح المتصفح يسجل القراءة بعد نجاح `shell.openExternal` كما هو الآن.
- لا تُغيّر الحالة الشخصية إلى submitted عند القراءة أو فتح المتصفح؛ «قدمت عرضًا» فعل صريح من المستخدم.
- سجل العودة يحفظ الفلتر والبحث والترتيب والعدد المحمل وanchor ID+offset والاختيار. تغيير query يعيد pagination بشكل مقصود؛ وصول حدث جديد لا يفعل ذلك.
- لا تقفز القائمة لإدخالات جديدة حين يكون المستخدم بعيدًا عن الأعلى. احتفظ بSet من IDs الجديدة الموافقة للعرض الحالي، واستعمل زر «وصلت N مشاريع جديدة». الإثراء أو القراءة لا يزيد العدد. خيار auto-reveal يعمل فقط قرب الأعلى.
- اقرأ الصفحة/المعاينة من بيانات حقيقية محفوظة. لا fake data خارج fixtures/harness الاختبار.

### 4.2 التنبيهات

- individual موجود: `sendSingle→openProjectById(id,true)→shell.openExternal`. حافظ عليه واختبره؛ لا توجّه click إلى route الداخلية.
- **قرار تسليم للملخص**: نقرة الملخص تفتح أحدث مشروع ضمنه بحسب firstSeenAt ثم id، في المتصفح؛ نص التنبيه يوضح «اضغط لفتح أحدث مشروع». لا تفتح عدة تبويبات ولا نافذة راصد. هذا يزيل الالتباس دون تغيير محتوى الملخص نفسه.
- إن اختفى المشروع أو الرابط غير مسموح، فشل مفهوم وآمن بلا fallback إلى URL خارجي arbitrary.
- لا تنشئ أحداثًا مضاعفة، وحافظ على suppressed وuncertain/crash recovery. نجاح OS submission لا يثبت أن المستخدم رأى التنبيه.
- إعدادات DND في main: `doNotDisturbUntil: ISO|null`، مدد 15/30/60 دقيقة وساعتين وإلغاء. mute الصوت وحده مستقل عن كتم التنبيهات.
- أثناء DND يستمر الرصد والإثراء والحفظ والقائمة. لا تتراكم تنبيهات مؤجلة تعود في سيل: الأحداث الموافقة أثناءه تُسجّل suppressed مع سبب أو بوابة واضحة، وتنتهي الفترة دون إرسالها بأثر رجعي. تُستعاد الفترة المطلقة بعد restart ويُراجع انتهاءها قبل dispatch.
- إذا عطّل المستخدم التنبيهات لا يعيد زر DND تشغيلها ضمنيًا.
- اختبار إشعار تجريبي موسوم Test يفتح صفحة المشاريع العامة لمستقل أو مثال allow-listed منفصل وآمن، ولا يعلّم مشروعًا حقيقيًا مقروءًا ولا يسجّل حدث اكتشاف. لا تعِد استخدام allow-list المشاريع لتوسيع فتح arbitrary URLs.

### 4.3 البيانات الشخصية

- bookmark مستقل عن read؛ حفظ/إلغاء حفظ واضح ومزامن عبر جميع النوافذ.
- hidden يبعد المشروع عن القوائم العادية دون حذفه أو تغيير dedup. شاشة/فلتر «المخفية» يعيده. سياسة معتمدة: إخفاؤه يمنع تنبيهًا معلقًا خاصًا به عند إعادة التقييم، ولا يؤثر على مشاريع أخرى.
- personalStatus: none/interested/submitted/ignored. تجاهلت لا تعني hidden تلقائيًا؛ يمكن فلترته. ترجم القيم في العرض فقط.
- note: نص plain text محلي حتى 5000 حرف؛ حفظ صريح مع dirty indicator. الخروج من الصفحة بملاحظة غير محفوظة يوفر حفظ/تجاهل/بقاء. لا تضيع عند وصول أحداث المشاريع.
- كل تغيير شخصي parameterized ومُتحقق منه في main، مع event تحديث يحمل IDs معدلة وأخرى جديدة منفصلة.

### 4.4 الفلاتر

- CategoryFilter الموجود هو النواة. أضف SavedFilter(id,name,definition,createdAt,updatedAt). اسم 1–80 حرفًا بعد trim. CRUD وعرض ونسخ الفلتر، مع IDs مستقرة.
- separate display/notify filters افتراضيًا للحفاظ على الإعدادات القديمة. `linkDisplayAndNotifyFilters` افتراضي false. عند تشغيله وضّح أن فلتر العرض الحالي سيستخدم للتنبيهات؛ بعده كل تعديل يحدّث الاثنين ذريًا، وعند إطفائه احتفظ بالنسختين الحاليتين.
- preview count لا يغير الإعدادات أو ينشئ إشعارات أو يطلق إثراء لكل ضغطة كتابة. debounce وإلغاء/تجاهل الرد القديم.
- tokenize الكلمات مع dedup بعد trim؛ قواعد any/all/exclude بنفس evaluator وتطبيع العربية الموجود.
- query تدعم scope all/saved/hidden، unread، statuses، search، category/keywords، sort. تُطبق كل القيود قبل pagination/count، ولا تستخدم فلتر settings خفيًا يتناقض مع definition المرسلة. العقد موثق بين renderer/main.
- أضف فلتر ميزانية بسيط كجزء من النطاق: min/max USD مع تحقق nonnegative وmin≤max وخيار تضمين الميزانيات غير المعروفة افتراضي true؛ لا تحويل عملات افتراضيًا. طبّق على المجال المتاح budgetMin/budgetMax كأمداء متقاطعة، ووثّق ذلك.
- search يطابق العنوان/المقتطف/المهارات؛ لا يدّعي البحث في وصف كامل لم يُحمّل. ترقيم الصفحات والعدادات يستخدمان نفس predicates.
- فرز اختياري latestDetected/latestPublished مع وضع null publications في نهاية published sort، وtie-breaker id ثابت.

### 4.5 Splash والصحة

- Splash حقيقي قصير في بداية boot، بنفس الشعار الموجود، تحميل indeterminate؛ لا حد أدنى مصطنع ولا نسبة وهمية.
- يمكن تنفيذه كعرض bootstrap داخل النافذة مع shell جاهز مبكرًا، أو نافذة محلية صغيرة تُغلق عندما تصبح الرئيسية ready-to-show. اختر الأبسط الذي لا يظهر نافذتين/وميضًا.
- bootstrap يجمع DB/settings/local list والتهيئة. RSS يبدأ مستقلاً ولا يحجز الانتقال. الخطأ المحلي يظهر actionable error/retry؛ بعد 8–10 ثوانٍ تهيئة بطيئة يظهر وصف وليس spinner صامت؛ لا تتجاهل فشل DB وتنتقل إلى بيانات وهمية.
- حالة واحدة في shell: watching/paused/backoff/offline/needs-review/initializing. popover فيه آخر نجاح ومحاولة قادمة وخطأ مختصر وزر pause/resume مناسب.
- حساب countdown من Date.now كل ثانية في component صغير؛ لا refetch القائمة كل ثانية. عند suspend/resume استعمل المواعيد المطلقة ولا تتراكم timers.
- المصطلحات في الصور «آخر ظهور» ليست بديلًا لـpublishedAt وfirstSeenAt؛ اعرض الاثنين بمعنى صحيح.

## 5. التصميم المطلوب فعليًا

### Shell والقائمة والمعاينة

- sidebar صغير قابل للطي، navbar/right في ar وleft في en. عرض مفتوح تقريبي 150–180px، مطوي 56–64px قابل لضبط التصميم.
- topbar ثابت: عنوان، search، health، فعل refresh ثانوي، بدون تكرار معلومات كثيرة بأسفل التطبيق.
- المشروع المختصر يعرض العنوان 1–2 سطر ومقتطف سطرًا، budget/category/time/unread/bookmark. كثافة comfortable أوcompact بإعداد محفوظ.
- اختيار preview اختياري مستقل عن ضغطة صفحة المشروع. panel قابلة لتغيير العرض وحفظ النسبة ضمن حدود تمنع سحق المحتوى. عند العرض الضيق overlay واضحة قابلة للإغلاق.
- default desktop 1220×820 وmin الحالي 900×600 مرجع البداية؛ compact window تستثنى من min العام. اختبر 900×600 و1440×900 وscale125/150%.
- الجديد يميّز live المكتشف في الجلسة فقط أو بنطاق حديث معلن؛ chosen rule: شارة جديد لمشاريع live غير المقروءة التي اكتشفت خلال الجلسة الحالية، recovered لها فائت وinitial بلا جديد. خزّن بداية الجلسة في main أو payload؛ لا تعتمد على 20 baseline unread.
- حالات skeleton قصيرة بدون بيانات مختلقة، empty filter مع مسح، offline cached مع timestamp، no-data initial، retry، paused، missing category، detail loading/error.

### صفحة المشروع

- breadcrumb/رجوع، عنوان، حقائق، وصف منظم، مهارات، rail للأفعال والحالة والملاحظة. على النافذة الضيقة تتدفق الأقسام رأسيًا.
- بيانات وصف طويل لا توسّع الأزرار خارج النافذة؛ النص line-height1.6–1.8 وعرض قراءة معقول.
- لا صور avatars أو عدد عروض أو اسم عميل اختلاقًا. يمكن إضافة حقول مؤكدة لاحقًا، ليست مطلوبة هنا.
- exposed description provenance: excerpt/full، fetchedAt، error عند الفشل. لا كلمة كامل إذا كان مجرد snippet أو markup لا يمكن تحديده.

### الإعدادات

- أقسام: المتابعة، التنبيهات، المظهر، البيانات، حول راصد. وصف قصير لكل خيار؛ input/toggle واضح بلوحة المفاتيح.
- المتابعة: interval وstartup وcloseBehavior(tray|quit)، default tray يحافظ على القديم. تحذير 2s التجريبي غير تسويقي.
- المظهر: ar/en، dark/light، text scale 90/100/110/125%، density، preview، sidebar، auto-reveal، compact/always-on-top controls.
- التنبيهات: enable/sound/filter/link/DND/unknown/test، لا switches ذات حالة ملتبسة.
- البيانات: افتح مجلد البيانات بـshell.openPath على المسار الموثوق فقط؛ export/import settings+saved filters كJSON versioned عبر native dialogs. لا تصدّر note/history تلقائيًا أو DB أو credentials.
- import يتحقق من max size1MB وschema والقيم، يعرض ملخص التغييرات، ثم تأكيد replace/merge saved filters. لا تثق في paths أو كود من الملف. runAtStartup يخضع لاختيار صريح عند الاستيراد.
- إدارة السجل: عرض عدد السجلات وخيار حذف المشاريع initial/live/recovered القديمة غير المحفوظة، دون ملاحظات أو حالات interested/submitted، قبل cutoff يختاره المستخدم. تأكيد عدد المتأثرين ونسخة احتياطية SQLite صحيحة قبل الحذف؛ لا نسخ ملف WAL مفتوح عشوائيًا. الاحتفاظ بـseen IDs/tombstones لمنع عودة المشروع المحذوف كاكتشاف جديد. إن تعقد ذلك، ابدأ بإخفاء/أرشفة غير متلفة حتى تُطبق ضمانات الحذف ثم أكملها قبل اعتبار النطاق تامًا.
- حول: version الحالي وMIT وGitHub وdiagnostics. تقنيّات RSS والتوقيت الدقيق هنا لا على كل بطاقة.

### Compact mode والوصول

- نافذة متابعة صغيرة قائمة فقط، حفظ/فتح صفحة في الرئيسية/فتح على مستقل. مصدر بيانات وخدمات واحد في main، لا collector أو DB مستقل.
- always-on-top افتراضي false ويمكن تغييره؛ bounds محفوظة مع تصحيح موضع خارج الشاشات. فتح صفحة من compact ينقلها للرئيسية دون تغيير route في نافذة أخرى عشوائيًا.
- اختصارات Ctrl+K بحث، الأسهم تحديد داخل قائمة متركزة، Enter صفحة داخلية، Ctrl+Enter متصفح، Ctrl+D حفظ المحدد، Esc غلق panel/رجوع سياقي. لا global shortcuts ولا اعتراض داخل input/textarea/contentEditable إلا shortcut الحفظ الصريح للملاحظة.
- fonts محلية مع license، icon library صغيرة واحدة إن لزم وتحديث lockfile؛ ابدأ بـNoto Sans Arabic أو IBM Plex Sans Arabic بعد مقارنة فعلية. لا CDN fonts يعتمد على اتصال.
- logical CSS properties للـRTL، dir=auto للمحتوى وbdi للأرقام، focus-visible وaria-labels وحالات selected/status مناسبة، احترام reduced-motion وتباين WCAG AA.
- tokens للـdark/light، surfaces matte، muted blue، corners معتدلة، scrollbar مطابق، no glow/neon/glass، لا اللون وحده للإشارة للحالة.
- سياسة production CSP الحالية تمنع inline styles: تجنب React style attributes لتقسيمة/حجم الخط؛ استخدم classes وstylesheet مسموحًا به أو آلية CSP مصممة بوضوح دون unsafe-inline عامًا في الإنتاج. تحقق resize/text scale والثيم في packaged app لا dev فقط.

## 6. التخزين والترحيل والعقود المقترحة

لا تعدّل migrations1/2 التي سبق استخدامها. أضف migration3 ثم لاحقة عند الحاجة داخل transaction.

اقتراح تقسيم:

1. `project_user_state`: project_id PK/FK، saved_at nullable، hidden_at nullable، personal_status default none، note default empty، updated_at. validate enums/length في main. يمكن استخدام أعمدة جديدة على projects بدل table إن برّرت، لكن upsert RSS لا يمسها.
2. `project_details`: project_id PK/FK، description_text nullable، provenance excerpt/full، fetched_at nullable، status not_requested/loading/ready/failed، error_code nullable. بعد crash صف loading يعود retryable؛ لا انتظار أبدي.
3. `saved_filters`: id stable، name، definition_json validated، created_at، updated_at.
4. `seen_projects/tombstones` إن دعم حذف السجل، مع unique source+external_id والتحقق من المنظومة لا جدول شكلي فقط.
5. AppSettings الجديدة تُدمج فوق sanitizeSettings مع defaults تحافظ على المستخدم القديم. استخدم serialized UI prefs منفصلة إن كانت كثيرة، لا تخزن مواعيد نسبية بدل UTC لـDND.

احفظ migration backwards-data-compatible، واختبر DBv2 عليها settings/read/events/waits ثم reopen. لا تحذف userData ولا تتطلب uninstall لحل migration.

### API متوقعة — صمم الأسماء النهائية بتناسق

- getProject(id) وgetProjectDetails(id) وrequestProjectDetails(id,{force?}).
- updateProjectUserState(id, validated patch)، get/setSavedFilters، previewQueryCount(definition).
- getProjectsPage(query,cursor/offset)→rows,total,unread,nextCursor (لتقليل استعلامات مختلفة قد تعطي counts متضاربة). حافظ على compat أو حدّث bridge وكل الاستعمالات معًا.
- openProjectExternal(id) اسم واضح؛ يمكن إبقاء openProject wrapper لكن لا تستخدمه للـroute.
- testNotification/testSound، setDnd(until|null)، openDataFolder، export/import validated settings.
- openCompact/closeCompact/setAlwaysOnTop/getUiPreferences/updateUiPreferences.
- events projectsChanged بمجموعتي newIds/changedIds وsettingsChanged/healthChanged/detailsChanged وopenSettings/openProjectInternal عند الحاجة، كلها constants في channels.

كل handler يتحقق من type/ID/range/length، ولا trusts renderer TypeScript. اشتراك events يعيد disposer؛ cleanup في StrictMode. لا exposed ipcRenderer generic، لا shell commands ولا raw filesystem APIs في bridge.

## 7. وصف المشروع الكامل والجلب بدون تعطيل RSS

- راجع HTML محفوظ/fixture فعلي، تحقق من selector authoritative يخص وصف المشروع لا nav/footer ولا أول نص طويل. اكتب fixtures تشمل page real-shaped/changed/challenge/no description/long.
- استخدم parser محدود ومفهوم، وحوّل إلى نص بفقرات بدون scripts/styles/hidden/navigation. لا إدراج HTML خام أو تنفيذ JS. reject challenge/foreign redirects/oversize عبر السياسة الموجودة.
- request on demand عند صفحة أو معاينة، cache local، dedup queued/inflight ID. لا تنزيل كل تاريخ المشاريع تلقائيًا. TTL proposed24h، زر retry لا يتجاوز backoff. أثناء طلب جديد اعرض old details إن وجدت دون flicker.
- cache full لا يؤخر أول تنبيه. قيد 10s/2MB والمحافظة على حد فجوة التفاصيل والتهدئة المشتركة. إذا انتقلت الصفحة أو pause/quit ألغِ أو تجاهل response stale ولا تكتب بعد close.
- RSS له أولوية مع حارس يمنع starvation. لا collector ثاني للمعاينة/compact. فتح تفاصيل نفس ID في نافذتين يشترك في نتيجة واحدة.
- فتح تفاصيل خارجي لا يوجب fetch التفاصيل داخليًا أولًا.

## 8. إعادة هيكلة renderer مقترحة

قسّم App الضخم مع إبقاء المنطق مفهومًا، مثل:

- `components/AppShell, Sidebar, Topbar, HealthPopover, ProjectRow, ProjectPreview, FilterDrawer, KeywordInput, EmptyState, Toast, ConfirmDialog, SplitPane`.
- `views/ProjectsView, ProjectDetailView, SavedFiltersView, SettingsView, CompactView, SplashView`.
- `hooks/useProjectQuery, useProjectEvents, useSettings, useNavigationState, useCountdown`.
- `styles/tokens.css, base.css, layout.css, components.css` وutilities للوقت/format/keyboard.

استعمل current store صغير/useReducer أو مكتبة مبررة؛ لا global architecture ثقيل. Query requests لها generation/requestID لمنع نتيجة قديمة من محو نتيجة فلتر أحدث. في events merge byID/dedup، لا concatenation duplicates. لا cap200 يصفّر القائمة التي حمّلت 250: main الحالي يقص limit إلى200، فصحّح عقد إعادة التحميل أو استرجع صفحات محملة متعددة؛ اختبر ذلك صراحة. Counts وfilters والقائمة كلها مستقرة مع background updates.

## 9. مراحل التنفيذ وتسليم كل مرحلة

### المرحلة0 — baseline وخطة عمل

- inventory/git status/version/node وقراءة الملفات والصور. شغّل typecheck/lint/test وسجل النتائج الحقيقية.
- افتح dev وتحقق CSS وCSP وElectron؛ لا تعتبر localhost وحده نجاح Desktop.
- أنشئ `docs/UI_UX_IMPLEMENTATION_STATUS.md` بجدول كل requirement وحالة pending/in_progress/done/blocked وأدلة.
- لا تستخدم بيانات المستخدم لاختبارات destructive؛ profile وقاعدة temp معزولة. Harness محدد env/args بلا فتح منفذ تصحيح دائم في الإنتاج.

### المرحلة1 — contracts/storage

- أنواع/settings defaults/migrations/repositories والفلاتر والnotes/state/page API وIPC validation.
- اختبارات v2→new وread/event/wait preservation، reopen، sanitization، counts before paging.

### المرحلة2 — design system/shell

- fonts/icons/tokens/themes/density/text scale/sidebar/topbar/health/popovers/empty/loading، RTL/LTR.
- شاشة حقيقية متصلة بـDB منذ البداية. تحقق production CSP لا dev فقط.

### المرحلة3 — list/filter/saved flows

- compact rows+bookmarks/hidden/status/search/filters/saved definitions+preview count/link filters، حفظ scroll/query/generation guards.
- live arrival Set وتحديث changedIDs دون jump، load>200، unread vs new vs recovered.

### المرحلة4 — detail/data

- صفحة مستقلة/رجوع ومعاينة resize/full description fetch/cache/fallback/notes/status/copy/open.
- ربط read policy والعمليات الشخصية، no propagation conflicts.

### المرحلة5 — settings/notifications

- أقسام الإعدادات وDND والاختبار/startup/close behavior/export/import/history safety/diagnostics.
- الحفاظ على individual external، تحديث summary latest external واختباره، لا تعديلات ديناميكية تلغي cooldown.

### المرحلة6 — startup/compact/accessibility

- Splash غير حاجز للشبكة، compact نافذة مشتركة، always-on-top وbounds، keyboard/ARIA/reduced motion.
- هذه ليست مزايا تؤجل تلقائيًا لأنها في مرحلة لاحقة؛ أنجزها قبل اكتمال النطاق.

### المرحلة7 — التكامل والتغليف

- baseline tests+جديدة meaningful، E2E على Electron main/preload/renderer، manual packaged QA، صور حقيقية ar/en/dark/light/detail/settings/splash/compact.
- version0.2.0+lockfile، dist جديد، installer hash/size/signature، install/run/uninstall في بيئة اختبار متاحة.
- تقرير مراجع يربط السلوك↔الكود↔الاختبار. لا تعلن feature جاهزة بسبب screenshot مولدة أو testmock منفرد.

## 10. الاختبارات المطلوبة

### آلية

1. migration/reopen لا تضيع bookmark/note/read/waits/backoff/events؛ defaults القديمة صحيحة.
2. filter query any/all/exclude/category/budget known+unknown/scope/status/search ببيانات أكبر من صفحة، list/count مطابقان.
3. فلاتر مرتبطة وفك الربط واختيار savedfilter لا يغيّران إعدادًا غير مقصود.
4. DND مع fake clock/restart/expiry يمنع dispatch ويحفظ discovery بلا flood بعد انتهاء المدة، مستقلاً عن sound.
5. summary click يحل أحدث ID المخزن ويفتح مرة واحدة؛ individual لا يستدعي revealWindow/navigateInternal. arbitrary URL rejected.
6. تفاصيل cached/error/challenge/timeout/abort/dedup وخروج أثناء fetch، وفصل مقتطف/full؛ no full claim على failure.
7. navigation return/search rapid/out-of-order events/>200 loaded/scroll anchor/newIds dedup وbaseline badge.
8. note dirty guard وحفظ مستمر/hidden restore/setting sync بين windows.
9. import invalid schema/too large/path injection وexport لا يحتوي private history افتراضيًا.
10. wiring E2E حقيقي بالـpreload مع SQLite temporary، وليس mock window.rased فقط: بطاقة→صفحة→رجوع، حفظ→restart، filter→count، settings→main، DND→dispatch gate، light/RTL toggle، splash→cached shell offline.

استخدم Playwright Electron integration أو harness مكافئ بعد التحقق من البيئة؛ OS APIs فقط يمكن استبدالها بـinjected safe sender/opener في اختبارات click routing. اختبر notification handler نفسه وليس helper مستقل غير موصول. لا تزعم قياس الصوت المسموع باختبار onBeep.

### QA يدوي/بصري للنسخة المجمعة

- Windows x64 installed build، لا localhost. كشف أخطاء CSP/fonts/assets/IPC.
- ar/en وRTL/LTR، dark/light، 900×600 وتكبير150%، عنوان طويل ومختلط، missing budget/category/full details، 0/1/1000 مشاريع fixtures.
- card→internal detail، external button→default browser، actual toastclick→browser دون إبراز راصد، summary latest، clipboard.
- pause/resume/Tray/mute/startup/closeBehavior، sleep/wake، DND، compact+main sync، note save/reopen.
- splash سريع بلا white flash ولا pause مصطنعة، يعمل offline على cache.
- تحميل صفحات كثيرة ووصول مشروع أثناء التمرير والقراءة بدون قفزة أو فقد loaded rows.
- سجل نتيجة pass/fail/not tested وسبب/بيئة. إذا أدوات screenshot فشلت (سبق UnknownVizError) جرب بديلًا متاحًا موثقًا؛ لا تستخدم الصورة التصميمية كدليل نجاح ولا توقف كل التنفيذ لطلب screenshot من المستخدم.

## 11. الحماية من الانحدارات وحدود النطاق

- حافظ على baseline/dedup/backoff/RetryAfter/pending30s/cancel/filter-before-pagination/Tray mute/devCSP. اختبرها بعد أي refactor يمسها.
- لا تغيير Electron إلى Tauri ولا upgrade dependencies بالجملة ولا network APIs جديدة/login/Cloud/Khamsat.
- لا DOM خارجي نشط أو arbitrary navigation. أضف deny setWindowOpenHandler وحدود will-navigate للـtrusted app URLs كجزء من فتح الصفحات الجديدة، دون كسر Vite HMR.
- مشاكل shutdown الحالية ليست عنوان المشروع، لكن إن زاد عمل async جديد يجب منع بدء عمل عند quitting وانتظار العمليات التي قد تكتب DB، لا sleep1s كضمان. أي before-quit guard لا يعمل في loop؛ وثّق اختبار الخروج أثناء تفاصيل/dispatch.
- للمطور قرار داخلي في تنظيم الملفات والمكتبة الصغيرة عند الضرورة، لكن لا تغيّر سلوكًا اتُّفق عليه ولا تسقط ميزة بسبب صعوبتها. إذا تعذر توفر بيانات المصدر اعرض fallback الحقيقي ووثّق القيد.
- keep local user data، النسخة المجمعة تُجرب على profile منفصل. لا edit/delete قواعد فعلية لاختبار.
- لا نشر GitHub release أو push أو استبدال asset المنشور تلقائيًا ضمن هذا التكليف؛ جهّز ملفات وتقرير ومثبّت قابلًا للمراجعة محليًا. user سيعود للمراجعة قبل التوزيع الجديد. commits محلية اختيارية ومنظمة؛ لا تعِد كتابة تاريخ موجود.

## 12. مخرجات التسليم الإلزامية

1. كود التطبيق كامل النطاق، migrations/IPC/tests وlockfile متسق.
2. `docs/UI_UX_IMPLEMENTATION_STATUS.md` محدث، كل requirement مرتبط بملفات/اختبارات وحالة فعلية؛ لا checkbox done لميزة مؤجلة.
3. `docs/UI_UX_IMPLEMENTATION_REPORT.md`: summary behavior، قرارات، تغييرات DB، مقارنة مع الصور، الاختبارات بأوامر ونتائج، manualQA، known gaps، أخطر الملفات للمراجعة، installer SHA256/size/signature.
4. صور **حقيقية** للنسخة المنفذة في `docs/screenshots/ui-v2/` بأسماء واضحة، ومقارنة شكلية مع references مع ذكر deviations؛ لا تستبدل الصور المرجعية.
5. README محدث لتشغيل dev/build ووظائف0.2.0 الجديدة، مع بيان أن رابط release العام ما زال0.1.1 حتى النشر المعتمد.
6. `release/RASED Setup 0.2.0.exe` محلي إن البناء ممكن، ولا يدخله Git. حافظ على old installer دون تقديمه كبديل جديد.
7. رسالة نهائية تحدد المنجز والمتبقي وآخر تحقق، لا «كل شيء كامل» إن لم تُختبر OS integrations أو installer.

## 13. Checklist قبول مختصرة للمراجع التالي

- [ ] كل البنود في إعادة التصميم منفذة، بما فيها compact/light/DND/savedfilters/data settings والاختصارات.
- [ ] card internal/toast external/buttons مستقلة/summarylatest واضحة.
- [ ] Splash تهيئة حقيقية لا waitsRSS، لا fake data.
- [ ] persisted userstate/details/query data + v2 migration/reopen pass.
- [ ] preserve return context/load>200/no jump/no false newbadge.
- [ ] production fonts/CSP/themes/resize تعمل، ar/en access واضح.
- [ ] meaningful unit+storage+actual wiringE2E+manual packagedQA موثق.
- [ ] dist0.2.0 جديد ونظيف ومطابق للكود ولا نشر قبل المراجعة.

انتهت الخطة. عند إرسالها لمودل آخر يجب تسليمه **مجلد المشروع كاملًا بما فيه docs/design**، لا نص هذه الوثيقة فقط، لأنه يحتاج قراءة الكود والأصول والاختبارات فعليًا.
