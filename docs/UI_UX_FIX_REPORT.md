# RASED 0.2.1 — تقرير تنفيذ إصلاحات المراجعة

التاريخ: 2026-09-26. الطلب: تنفيذ خطة إصلاح جميع نتائج المراجعة R01–R17، بالإضافة إلى زر فتح المشروع في المتصفح. الإصلاحات محلية في مساحة العمل؛ لم يحدث commit أو push أو نشر Release. الإصدار العام ما زال 0.1.1. المرجعان: [خطة الإصلاح](UI_UX_FIX_PLAN.md) و[المراجعة الأصلية](UI_UX_INDEPENDENT_REVIEW.md).

## النتيجة

أُصلحت العيوب الوظيفية المحددة أدناه في الكود، وتم بناء مثبت جديد 0.2.1. النجاح لا يعني اختبار كل تكامل Windows يدويًا أو انعدام أي عيب محتمل؛ قسم القيود يحدد ما لم يُثبت. احتُفظ بتعديلات تنفيذ الواجهة الموجودة، ولم يُستخدم سجل المستخدم في اختبارات القراءة/الحذف/إعادة التشغيل.

## سبب عطل زر المتصفح

الـpreload كان يستدعي `IPC.openProjectExternal`، لكن main لم يسجّل handler لهذا الأمر. سُجّل handler فعليًا في `src/main/index.ts`، مع التحقق من ID والرابط المخزن والمسموح. مسار الفتح يستعمل `shell.openExternal`، ولا ينتقل إلى صفحة داخل راصد. تحديث القراءة بعد نجاح الفتح فقط ومع إعادة فحص بقاء القاعدة والمشروع بعد الانتظار. الواجهة تعرض فشل الفتح بدل تجاهله.

اختبار النتيجة: ضغطة الأيقونة عبر React/preload/main الحقيقي سجلت طلب فتح واحدًا وتركت route كما هي. ثم تشغيل النسخة المجمعة ببيانات RSS حية، خارج وضع fixtures، أعاد `{ok:true}` من `shell.openExternal` الفعلي. هذا يثبت نجاح تسليم الرابط لنظام التشغيل؛ لم نسجل قياسًا لزمن تحميل الصفحة في المتصفح.

## الإصلاحات وربطها بالتحقق

| المرجع | التغيير الفعلي | الكود/الدليل |
|---|---|---|
| R01 الصوت | اشتراك واحد للرئيسية مع cleanup، دون ازدواج compact؛ السماح بتشغيل الصوت وتدارك resume rejection | App.tsx، sound.ts، main؛ E2E يشغّل OscillatorNode مرة واحدة عبر حدث main |
| R02 المسودات | حارس مركزي قبل تغيير route؛ حفظ/تجاهل/إلغاء، وعدم المغادرة بعد فشل الحفظ؛ حراسة الإخفاء والغلق، وbeforeunload لمسار window.close | router.ts، ProjectDetailView.tsx، main؛ E2E يفحص DB بعد الحفظ والتجاهل ويختبر طلب الغلق وإلغاءه |
| R03 المخفية | الاحتفاظ بـscope الفلتر بدل استبداله، مع وصول فعلي للمخفية واسترجاعها | ProjectsView، App؛ hidden→مشروع واحد→unhide→قائمة hidden فارغة |
| R04 الفلاتر | `displayQuery` محفوظ بالتعريف الكامل؛ دمج ذري للربط حسب المجالات والكلمات؛ حفظ البحث وإعادة تطبيقه، ومسح البحث مع reset | types.ts، policies.ts، App، ProjectsView؛ E2E يفحص 225 تصميمًا، IDs زوجية، notifyFilter الحقيقي، و111 نتيجة للبحث المحفوظ |
| R05 pagination | تجميع صفحات IPC بحد200 لكل طلب وصولًا إلى النطاق المطلوب | ProjectsView؛ E2E يحمّل300 من450 بالفعل |
| R06 الرجوع | ذاكرة منفصلة لسياقي القائمة/المحفوظات؛ النطاق والاختيار والتمرير يستعادان بعد تركيب الصفوف، مع route المصدر | App، ProjectsView؛ 300 صف وscrollTop1800→تفاصيل→300 صف و1800؛ saved→تفاصيل→saved |
| R07 compact | بث موحد للإعدادات والصحة إلى النوافذ الحية | main؛ E2E pin/لغة/Watching→Paused عبر نافذتين حقيقيتين |
| R08 HTML budget | ميزانية مشتركة serial مع فجوة2s بين التفاصيل والإثراء؛ RSS بوابة أولوية، والوصف عند timer يسبق إثراء الخلفية | detailBudget.ts، details.ts، enrichment.ts، main؛ unit يثبت عدم بدء الطلب الثاني أثناء الأول أو قبل الفجوة |
| R09 الحذف | إسقاط queued/active jobs قبل purge، فحص `db.isOpen` ووجود المشروع قبل الكتابة، معالجة الوعود الخلفية، حذف على دفعات محدودة | details/enrichment/main/repos؛ اختبارات fetch معلّق→حذف→إكمال بلاFK، وقاعدة مغلقة بلا كتابة؛ E2E purge يحفظ المحمي وينشئ backup ويحدّث الصفوف |
| R10 وصول الجديد | predicate كامل مشترك للقائمة والجديد، معالجة كل IDs، الأحداث الفارغة لا تُبطل التحميل؛ تحديث الصفوف الموجودة دون إدخال الجديد المؤجل، وعدّاد حي ثم reveal صريح | shared/filters، repos، ProjectsView؛ E2E يقارن IDs قبل وبعد الوصول والإثراء، ثم reveal يظهر المشروع |
| R11 تفاصيل ID | state keyed حسب المشروع مع generation لإهمال نتائج قديمة، وحارس المسودة قبل التبديل | App/ProjectDetailView؛ E2E missingID→450 يعرض المشروع الصحيح |
| R12 الكيبورد | منع معالجة Enter مرتين، وإبعاد controls عن handler القائمة | ProjectRow/ProjectsView؛ E2E Enter يفتح الصف المتركز بدل الاختيار القديم |
| R13 صدق الوصف | طلب cache-first حتى للـready لفحصTTL24h؛ إعادة المحاولة متاحة؛ provenance مستقل full/excerpt/truncated مع وقت الجلب | details/parser/ProjectDetailView؛ unit يثبت cache قديمة وتحديثًا موسومًا truncated؛ E2E يثبت وصفًا مُحدّثًا بعد جلب حقيقي عبر parser |
| R14 DND | gate حديث قبل إرسال عناصر الدفعة والصوت، suppressed بلا إعادة إرسال بعد رفع DND؛ اختيار أحدث مشروع للملخص حسب firstSeenAt ثم ID | policies/main/notifier؛ unit يغيرDND أثناء await؛ E2E يكتشف مع DND ولا يرسل، ولا يرسل التاريخ بعد رفعه؛ summary يفتح أحدث رابط مرة واحدة |
| R15 metadata | إثراء bounded من queryProjectsPage الجديد عند فلاتر التصنيف/الميزانية؛ استخراج metadata من نفس HTML التفاصيل وإسقاط جلب metadata المكرر queued | main/details/enrichment؛ unit ميزانية مشتركة، E2E/parser fixtures، وتجربة RSS الحية منفصلة |
| R16 قوة الاختبارات | استبدال E2E الضعيف بـassertions على النتائج الفعلية وDB، restart لعملية جديدة، وترحيل v2 حقيقية محتفظة بالإعدادات/read/events/waits؛ تصحيح أسماء/تأكيدات اختبارات التخزين القديمة | scripts/e2e-cdp، tests/ui-fixes، tests/v2-storage/details؛ نتائج أدناه |
| R17 الوصول/الدفاع | منع popup والتنقل الخارجي في نوافذ Electron؛ focus trap/restore وحراسةEscape؛ resize بالكيبورد معARIA؛ shortcuts→appearance؛ offline/empty/reset؛ زر preview واضح؛ rail متاح صغيرًا؛ bounds كاملة؛ خروج ينتظر العمل وflushing قبل إغلاقDB؛ scripts بلا حذف profile ومدخلات آمنة | main، router/components/styles، cdp-tools/shot-ui؛ E2E معاينة وفوكس/كيبورد/900×600 وغلق وتنقل؛ حدود Windows الفعلية أدناه |

تنبيه دقة: الربط بين العرض والتنبيهات يربط **قواعد المجالات والكلمات** فقط؛ search/budget/personal-status تخص العرض. الواجهة تشرح ذلك. الترميز schema3 مستمر؛ `displayQuery` وprovenance الجديدة متوافقتان مع التخزين الحالي، مع تهيئة الإعدادات القديمة منdisplayFilter/showUnreadOnly.

## الفحوص التي نجحت

- `npm run typecheck`: ناجح.
- `npm run lint`: ناجح.
- `npm test`: **88/88، 13 ملفًا**؛ تشمل اختبارات الانحدار القديمة للرصد والتنبيهات والتهدئة.
- `npm run build` و`npm run dist`: ناجحان.
- E2E على build المحلي: **34 assertion** قبل إضافة تحقق mark-all-read/purge.
- E2E النهائي على **release/win-unpacked/RASED.exe 0.2.1**: **37/37 assertions**. قاعدة SQLite حقيقية بدأت450 مشروعًا، ثم وصول1 ودفعة7 ومشروعDND، مع restart فعلي. profile: `C:\Users\DAVIDA~1\AppData\Local\Temp\rased-test-IlfMGq`؛ احتُفظ به للأدلة.
- mark-all-read يغيّر stored/read_at وصفوف الواجهة. purge preview449 ثم حذف449، مع بقاء450 لأنه محفوظ وله ملاحظة؛ بقاء10 مشاريع وإنشاءVACUUM backup دونuncaught/async-failed.
- تجربة النسخة المجمعة بRSS حي وOS opener فعلي: ناجحة؛ profile مستقل `rased-test-VYakFZ`. الصور الفعلية في [screenshots/ui-fixes](screenshots/ui-fixes/CAPTURE.md)، وفُحصت صورة التفاصيل بصريًا.
- viewport900×600 وdeviceScaleFactor1.5 عبر CDP جلسة مستمرة: notes قابلة للوصول، preview overlay وفوكس محصور. هذه محاكاة viewport/device scale، وليست شهادة QA لشاشة Windows DPI150% فعلية.

## إعادة الاختبار

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run dist
node scripts/e2e-cdp.mjs --exe="release/win-unpacked/RASED.exe" --app=""
node scripts/shot-ui-v2.mjs --exe="release/win-unpacked/RASED.exe" --out="docs/screenshots/ui-fixes"
```

`test:e2e` يستبدل network/OSsender/opener فقط في وضع `--rased-test` صريح، مع profile جديد داخلTEMP اسمهrased-test-* وmarker مطابق. لا يوجد IPC عام للاختبار. main/preload/storage/parser/renderer حقيقية. السكربت يرفض profile موجودًا ولا يحذفه، ويوقف فقط PID التي أطلقها. سكربت الصور يستخدم RSS وshell الحقيقيين دون وضع fixtures.

## المثبت المحلي الجديد

- `release/RASED Setup 0.2.1.exe` — Windows x64، per-user NSIS.
- الحجم: **115087784 بايت**، نحو109.8MiB.
- التوقيع: **NotSigned**؛ رسالةelectron-builder signing ليست إثبات توقيع رقمي.
- SHA256:

```text
1B8CEA19B4781763B836C32964AAE62E1EEFE378EDCE69DE72A800A14D4726B1
```

لا تستخدم مثبت0.2.0 القديم بعد الإصلاح. بصمته التاريخية الصحيحة تنتهي بـ`...E4536829C3`؛ التقرير الأصلي كان ينقص آخر`3`، وتصحيحها موثق في المراجعة المستقلة.

## ما لم يُثبت يدويًا في هذا التسليم

- نقرة **Windows OS toast** فعلية وصوت مسموع: E2E يستبدل OSsender وينفذ callback الحقيقي، ويثبت oscillatorstart فقط.
- بدء Windows، نوم/استيقاظ الجهاز، القائمة الأصليةTray بالنقر اليدوي، حوارات الملفات export/import، وكل تشكيلات الشاشات/DPI الفعلية.
- تثبيت/إزالة0.2.1 على VM نظيفة وبالمسار الافتراضي و/D. لم يُثبّت أو يُزال تطبيق المستخدم للتحقق. المشكلة التاريخية المزعومة للتثبيت الافتراضي غير مُعادة الإنتاج هنا، فلا إعلان إصلاح أو إثبات سلامة مطلق لها.
- سبق المنافسين أو تأخيرRSS العالمي لا يمكن ضمانه بهذه الإصلاحات.

تقارير0.2.0 السابقة أُشير إليها بوضوح كسجلات تاريخية، ولا تُستعمل checkmarks فيها لإثبات الإصدار الحالي. بيانات المستخدم ومشروعه ظلا محفوظين؛ الاختبارات على profiles منفصلة، ولا نشر إلىGitHub في هذا الطلب.
