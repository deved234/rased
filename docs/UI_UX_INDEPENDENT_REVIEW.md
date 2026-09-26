# مراجعة مستقلة لإعادة تصميم RASED 0.2.0

التاريخ: 2026-09-26. المرجع الأساسي: UI_UX_IMPLEMENTATION_PLAN.md. المراجعة على ملفات العمل الحالية، المبنية على commit `13e77a0`؛ التنفيذ الجديد غير committed. لم أصلح كود التطبيق أو أنشر شيئًا.

**النتيجة: التنفيذ حقيقي ويُبنى ويعمل، لكنه لا يستوفي قبول الخطة بعد. توجد أخطاء وظيفية مثبتة، وبعض فحوص القبول تعطي ثقة أكبر مما تختبره فعليًا. أوصي بإصلاح P1 ومسارات القائمة/التفاصيل قبل توزيع 0.2.0.**

P1 = يصلح أولًا بسبب فقد بيانات/فشل ميزة أساسية. P2 = خطأ وظيفي أو تحقق مهم قبل اعتماد الإصدار. P3 = نقص دفاع/تحسين أقل إلحاحًا.

## ما فُحص بالفعل

- قراءة الخطة والمواصفات وتقارير التنفيذ والحالة، والتغييرات في main/preload/shared/collector/storage/renderer والاختبارات وسكربتات E2E.
- `npm run typecheck`: ناجح. `npm run lint`: ناجح. `npm test`: **77/77، 12 ملفًا**. التقرير الأصلي يقول 11 ملفًا.
- `npm run build`: ناجح؛ main نحو 255KB، renderer JS نحو 783KB.
- تشغيل سكربت E2E الأصلي على `release/win-unpacked/RASED.exe` ببروفايل temporary جديد: **17/17**، RSS حي، وصف حي ready بطول 4767 حرفًا.
- تشغيل Electron الحقيقي بالكود المبني وpreload الحقيقي وSQLite مؤقتة، ثم إيقاف الرصد وتوليد 450 مشروعًا داخل قاعدة الاختبار فقط. تجارب UI عبر CDP: pagination، scroll/back، المخفية، ربط الفلاتر، ملاحظة غير محفوظة، saved-filter، الرجوع من المحفوظات، Enter، تغيير project route، وتزامن compact.
- ثلاث probes مؤقتة على DetailsFetcher/parser وقاعدة حقيقية: التوازي، الحذف أثناء fetch، ووصف طويل. أثبتت الحالات الثلاث، ثم أزيل ملف الاختبار المؤقت. ليست إصلاحات ولا اختبارات انحدار دائمة.
- فحص صورة ar-main المجمعة المرجعية بصريًا. وجود screenshots وحده لا يثبت صلاحية كل تفاعل أو كل أبعاد الشاشة.
- فحص حجم/hash وتوقيع المثبت الموجود، دون إعادة تثبيت أو إزالة على بيئة المستخدم.

كل بيانات الاختبار في profiles منفصلة داخل TEMP؛ لم تُستخدم قاعدة المستخدم. السكربتات المؤقتة في `rased-review-c71cc21c2210489fa8fd977ff9bbb44a` تحت TEMP، والعمليات التي أطلقتها المراجعة أُغلقت.

## R01 — P1: صوت التنبيهات انقطع تمامًا في الواجهة الجديدة

**المكان:** `src/renderer/App.tsx` و`main.tsx`؛ المرسل `src/main/index.ts:325` و`:1038`؛ الدالة المتروكة `src/renderer/sound.ts:6`.

لا يوجد أي استدعاء لـ`onPlayBeep` أو import لـ`playBeep` في renderer. الـmain يرسل الحدث وOS toast مضبوط `silent:true`؛ لذلك لا يوجد مسار يشغّل الصوت أصلًا. زر تجربة الصوت يعرض ✓ بمجرد رجوع IPC، دون تشغيل صوت.

**الدليل:** بحث كامل src يؤكد غياب الاشتراك؛ طلب testSound الحقيقي يرجع acknowledged فقط. لم أدّعِ سماع الصوت يدويًا؛ غياب الربط يكفي لإثبات العطل.

**الإصلاح:** اشتراك واحد في النافذة الرئيسية، مع disposer وStrictMode-safe cleanup؛ تجنب تشغيل الصوت مرتين من compact. اختبر توصيل الحدث إلى الدالة ثم تجربة صوت فعلية.

## R02 — P1: الملاحظة غير المحفوظة تضيع عند التنقل الجانبي

**المكان:** `src/renderer/views/ProjectDetailView.tsx:97`، و`src/renderer/components/shell.tsx:59`، وApp routing.

الحارس مرتبط بـhashchange بعد وقوع الانتقال، داخل مكون يمكن أن يُزال في نفس تحديث الـroute. زر الرجوع الداخلي وحده يستخدم attemptBack. في التجربة: كتابة `UNSAVED AUDIT NOTE` تظهر شارة dirty؛ الانتقال للإعدادات ينتهي بـ`#/settings`، دون dialog، والملاحظة لم تُحفظ في DB.

مسار الإخفاء يستدعي onBack مباشرة أيضًا. ولا يوجد حارس عند غلق النافذة. زر «حفظ ثم خروج» ينتقل حتى لو saveNote رجعت دون نجاح؛ لا يعرض سبب فشل الحفظ. الحوار لا يوفر اختيارًا صريحًا للتجاهل كما توحي صياغته.

**الإصلاح:** حارس قبل تغيير route في مستوى يبقى mounted، يحفظ الوجهة المقصودة، ويقدم حفظ/تجاهل/إلغاء. لا يترك الصفحة بعد فشل الحفظ. يشمل sidebar/compact navigation/hide/close حسب سياسة الحفظ.

## R03 — P1: صفحة المخفية واسترجاع المشاريع لا يمكن الوصول إليهما من الفلتر

**المكان:** `ProjectsView.tsx:82` و`:385` و`:387`؛ `App.tsx:180`.

درج الفلتر يعرض scope hidden/saved، ثم onApply يستبدل الاختيار بـscope القادمة من sidebar، وfullDef يعيد استبداله أيضًا. حفظ الفلتر من القائمة يستبدل scope، وتطبيق saved filter يفرض all.

**الدليل:** اختيار «المخفية» وتطبيقه في قاعدة لا تحتوي أي مخفي أعاد **450 مشروعًا** بدل صفر. المشروع المخفي نفسه يختفي من العادية ولا توجد شاشة مخفية بديلة لاسترجاعه، رغم وجود API صحيح.

**الإصلاح:** مصدر واحد واضح للـscope، routes أو query يدعمان hidden فعلًا، وحفظ/تطبيق التعريف كاملًا دون استبدال صامت. اختبر hide→hidden list→unhide.

## R04 — P1: «نفس الفلتر للعرض والتنبيهات» لا يربط الفلتر الذي يستخدمه المستخدم

**المكان:** `ProjectsView.tsx:181` و`:385`؛ `App.tsx:179`؛ `src/main/index.ts:905`.

تعديل chips/درج الفلتر/اختيار فلتر محفوظ يعدّل state محلية فقط. لا يرسل displayFilter إلى main، فلا يصل إلى notifyFilter حتى مع link=true. main لا ينسخ فلتر العرض عند تشغيل الرابط وحده، والواجهة لا تتبع تغير displayFilter القادم من تعديل notifyFilter أو import.

**الدليل:** بعد تشغيل الرابط واختيار تصميم، القائمة تغيرت لكن getSettings أعاد display=all وnotify=all وlinked=true. هذا قد يرسل تنبيهات خارج اختيار المستخدم. كذلك فلتر محفوظ بـsearch محدد يعرض كل النتائج لأن searchInput الفارغة تستبدل def.search؛ التجربة عادت إلى 450 مشروعًا وsearch="".

**الإصلاح:** تعريف واضح لما يرتبط: category/keyword rules على الأقل كما في الخطة؛ التحديث الذري عبر main، وحفظ اختيار العرض واستعادته، وعدم فقد search/scope عند تطبيق الفلتر المحفوظ. showUnreadOnly القديم محفوظ في settings لكنه لا يُستخدم لتهيئة القائمة الجديدة أيضًا.

## R05 — P2: تحميل المزيد يقف عند 200 مشروع

**المكان:** `src/main/index.ts:1032`؛ `ProjectsView.tsx:91` و`:353` تقريبًا.

renderer يزيد limit ويطلب من offset=0 ثم يستبدل rows. main ما زال يقص limit إلى200. لا يوجد تجميع صفحات.

**الدليل:** قاعدة 450؛ خمس ضغطات «عرض المزيد» تنتهي بـ200 صف وزر `عرض المزيد (200/450)`، والضغط التالي لا يصل إلى الباقي. اختبار storage الموسوم load>200 يختبر offsets مستقلة، لا renderer ولا IPC.

**الإصلاح:** تحميل صفحات وتوحيدها byID، ثم إعادة تحميل نفس النطاق عند تغير البيانات. لا ترفع الحد بلا سقف فقط؛ افحص قابلية الاستجابة مع تاريخ كبير.

## R06 — P2: الرجوع يفقد موضع التمرير والصفحات ومصدر التنقل

**المكان:** `ProjectsView.tsx:84–112`؛ `App.tsx:160`.

scope effect يعمل على كل mount ويصفر limit إلى50؛ استعادة scroll تحدث قبل وصول الصفوف فـscrollHeight غير كافٍ. كما أن الرجوع دائمًا إلى projects، حتى إن فتحت التفاصيل من المحفوظات.

**الدليل:** من 200 صف وscrollTop=1800 → تفاصيل → رجوع: **50 صفًا وscrollTop=0**. ومن المحفوظات → تفاصيل → رجوع: `#/` بدل `#/saved`.

**الإصلاح:** حفظ route/query/loaded range/anchorID+offset لكل سياق، واستعادة الموضع بعد تركيب الصفوف؛ لا تعمل resets الخاصة بتغيير scope عند مجرد إعادة mount.

## R07 — P2: نافذة compact لا تتزامن مع الإعدادات أو حالة الرصد

**المكان:** `src/main/index.ts:131–177`؛ `CompactView.tsx`.

saveSettings وemitHealth يرسلان إلى win فقط، بينما compact مشترك في نفس الأحداث ويتوقعها. الضغط على pin يحفظ true فعليًا، لكن aria-pressed يبقى false؛ الضغطة التالية ترسل true مرة أخرى. اللغة والثيم وpause/backoff تبقى قديمة حتى إعادة فتح/تحميل النافذة.

**الدليل:** pin false→setAlwaysOnTop(true)→ما زال false؛ تغيير اللغة في الرئيسية إلىen أبقى compact dir=rtl.

**الإصلاح:** broadcast موحد لكل windows الحية، واختبار round-trip في النافذتين، مع عدم إنشاء collector إضافي.

## R08 — P2: جلب التفاصيل يفتح طلبات متوازية دون فجوة مشتركة

**المكان:** `src/main/details.ts:108–121`؛ `src/main/index.ts:962–968` و`:1215–1223`.

DetailsFetcher يمنع تكرار ID واحد، لكنه لا يمنع بدء IDs أخرى أثناء الطلب الحالي، ولا lastStart/minGap ولا تنسيق مع EnrichmentQueue. request IPC يستدعي pump لكل فتح؛ timer كذلك. يمكن أن يبدأ عدد كبير من طلبات HTML بالتوازي، ثم 429 يهدّئ RSS نفسه ويؤخر هدف التطبيق الأساسي.

**الدليل:** probe حجز الرد الأول وطلب ID ثاني، فبدأ الطلبان قبل تسوية الأول: calls=2. قاعدة الخطة تطلب المحافظة على حدود التفاصيل المشتركة وأولوية RSS.

**الإصلاح:** ميزانية/queue مشتركة للجلب مع serialization وفجوة2s الموجودة وأولوية RSS؛ dedup بين جلب الوصف وجلب metadata إذا أمكن.

## R09 — P2: حذف السجل أثناء جلب وصف مشروع يسبب FOREIGN KEY exception

**المكان:** `src/main/index.ts:1091–1107`؛ `src/main/details.ts:134–175`؛ `repositories.ts` purgeHistory.

الحذف لا يلغي أو يسقط queued/inflight detail jobs للمشاريع المحذوفة. عند اكتمال الطلب، db.open=true، لكن المشروع نفسه اختفى؛ upsertProjectDetails يصطدم بـFK. استدعاءات pump من main تستخدم void بلا catch. الطلب المؤجل لمشروع حُذف يمكن أن يفشل قبل دخول try أيضًا.

**الدليل:** probe fetch معلّق→purgeHistory→إكمال الرد: rejection يحمل `FOREIGN KEY constraint failed`.

**الإصلاح:** التنسيق مع queues قبل الحذف، ثم إعادة فحص وجود المشروع قبل كل كتابة، وعدم إرسال detailsChanged لمشروع محذوف بلا داعٍ؛ معالجة rejection. حافظ على backup/tombstones الحالية.

## R10 — P2: وصول الجديد قد يقفز بالقائمة ويعطي عدادًا لا يطابق الفلتر

**المكان:** `ProjectsView.tsx:130–165` و`:264–265`.

- مطابقة arrivals تستخدم category/keywords وبعض flags فقط؛ لا search/budget/statuses، وتأخذ أول20 ID فقط.
- كل event يزيد gen حتى إن لم يحمل IDs؛ حدث emitProjects([],[]) بعد flush يمكن أن يبطل fetch لم ينتهِ، ولا يبدأ بديلًا، فتبقى loading أو بيانات قديمة.
- changedIds يعيد query من offset0، فيدخل الجديد المؤجل في أعلى rows بعد enrichment أو حفظ/قراءة، مع إعادة scrollTop الرقمي فقط؛ يتغير المشروع أمام المستخدم رغم no-jump.
- إذا event فيه newIds وchangedIds، else-if يهمل التغييرات عند عدم مطابقة الجديد.
- التمرير إلى الأعلى يمسح pendingNew دون جلبها، واختيار فلتر جديد لا يمسح كل pending IDs غير المطابقة.

**الدليل:** تحليل مسارات الكود؛ لم أشاهد دفعة حية كاملة في هذه المراجعة. هذه فروع منطقية قابلة لاختبار deterministic؛ لا أسجل مشاهدة حية لم تحصل.

**الإصلاح:** نفس predicate الكامل للقائمة/arrival count، فصل new/changed processing، generation لتغييرات query فقط، merge byID مع anchor ثابت؛ زر reveal وحده يدخل العناصر المؤجلة إلا عند auto-reveal المتفق عليه.

## R11 — P2: تغيير مشروع التفاصيل داخل نفس المكون يحتفظ بحالة المشروع السابق

**المكان:** `ProjectDetailView.tsx:30–72`؛ `App.tsx:160`.

المكون بلا key حسبID، ولا reset لـmissing/autoRequested/note/details عند projectId جديد، ولا generation لمنع نتيجة طلب المشروع السابق. يمكن وصول navigate من compact أثناء صفحة تفاصيل قائمة.

**الدليل:** فتح ID غير موجود ثم ID موجود، دون مغادرة نوع route project: العنوانURL صحيح لكن ما زالت empty state؛ missing لا تعودfalse. autoRequested كذلك يمكن أن يمنع طلب وصف المشروع الثاني. تغييرID مع ملاحظة dirty يجب ألا يعيد استخدام مسودتها أو يربطها بالـID الجديد.

**الإصلاح:** حارس تنقل مركزي قبل تغييرID، state/drafts keyed byID، وإلغاء/تجاهل async results السابقة. لا تعالج ذلك بـkey وحده إذا كان سيضيع المسودة قبل الحارس.

## R12 — P2: Enter على صف يمكن أن يفتح المشروع المحدد السابق بدل الصف المتركز

**المكان:** `components/ProjectRow.tsx:33–44`؛ `ProjectsView.tsx:249`.

حدث Enter يُعالج في article ثم يصعد إلى list-scroll؛ كلاهما يفتح التفاصيل. الأول يستخدم صف focus، والثاني selectedId السابقة. أحداث زر الحفظ/الفتح الخارجي بالكيبورد قد تصعد إلى list أيضًا، رغم تعليق أن الأزرار تعالج نفسها.

**الدليل:** بعد رجوع من مشروع محدد، Enter على article الثانية انتهى بفتح المشروع القديم المحدد؛ CDP سجل hash `#/project/450` بدل الصف الآخر. Ctrl+Enter قد يستدعي الفتح الخارجي مرتين/لمشروعين.

**الإصلاح:** مسؤول واحد للاختصار أو stopPropagation واضح، وحماية list handler من أحداث controls؛ اختبر focus مقابل selection وحالات الأزرار.

## R13 — P2: الوصف قد يكون قديمًا أو مقتطعًا مع تقديمه كأنه كامل

**المكان:** `ProjectDetailView.tsx:50`؛ `projectBody.ts:81–89`؛ `details.ts:64–75`.

TTL24h موجود داخل fetcher، لكن الصفحة لا تطلب ready rows أصلًا، لذلك cache ready القديمة لا تدخل مسار فحص الصلاحية. لا زر تحديث لوصف ready. parser يقص عند200 فقرة/20000 حرف ثم يرجعok؛ fetcher يخزن provenance=full دون truncated flag. كذلك النص الثابت للمقتطف يُعرض حتى مع provenance full.

**الدليل:** وصف cache من2020 ظهر كما هو ولم يطلب تحديثًا؛ probe نص أطول من الحد رجع ok بطول20000، ثم المسار يسميه full.

**الإصلاح:** request cache-first عند فتح الصفحة، تحديث مؤجل حسبTTL، توضيح truncated أو failure/fallback، مصدر وصف واحد صادق فيUI، وإعادة تعيين طلب كلID.

## R14 — P2: عدم الإزعاج لا يُعاد فحصه وسط دفعة تنبيهات

**المكان:** `src/main/index.ts:291–325`؛ `notifier.ts:116–141`.

فحص DND مرة قبل dispatch. أثناء await sendSingle/showToast يمكن للمستخدم تفعيلDND، لكن shouldSend لكل عنصر تالٍ لا يقرأ doNotDisturbUntil؛ فتكمل الدفعة. onBeep لا يفحصDND ولا notificationsEnabled بعد await. بعد إصلاح الصوت سيظهر هذا بوضوح أكبر.

**الدليل:** مسار async واضح بالكود؛ لم أضغط toast دفعة حية. لا يوجد اختبار فعليDND/summary click في tests رغم ادعاء التقرير أن هذه مغطاة unit؛ البحث يبين اختبار sanitize افتراضي فقط لـDND.

**الإصلاح:** gate حديث موحد قبل كل إرسال وقبل beep، مع suppressed للمرفوض ومنع backlog بعد انتهاء المدة. اختبر تفعيلDND أثناء وعد sendSingle معلّق.

## R15 — P2: مسار UI الجديد فقد الإثراء عند طلب التصنيف

**المكان:** `src/main/index.ts:853–888` مقابل`:1028–1035`؛ `details.ts`؛ `pipeline.ts` baseline.

الكود الذي يُجدول metadata enrichment عند تصفية المجالات ما زال في getProjects القديم؛ الواجهة الجديدة تستخدم queryProjectsPage الذي لا يفعل ذلك. baseline لا تُجدول إثراء، ووصف الصفحة الجديد يستخرج النص فقط ولا يحدّث category/skills/budget من نفس HTML. لذلك initial projects غير المصنفة قد تبقى كذلك حتى بعد فتح التفاصيل والتصفية، وتظهر بكل مجال بصفة uncertain.

**الإصلاح:** إثراء on-demand محدود من مسار query/detail الجديد، مع reuse الرد وعدم تجاوز ميزانية الشبكة؛ حافظ على عدم اختلاق تصنيف وعدم جلب التاريخ كله.

## R16 — P2: اختبارات القبول والتقرير يبالغان في إثبات السلوك

**المكان:** `scripts/e2e-cdp.mjs:128–149`، `tests/v2-storage.test.ts`، `tests/details.test.ts`، وdocs/تقارير التنفيذ.

- فحصscroll لا يقارن scrollBefore/After؛ يتحقق hash فقط، والتجربةالأصلية 0→0.
- chipClicked يستخدم `? true : true`، فالشرط ينجح حتى دون click؛ لا يفحص IDs/categories/count المتوقع.
- readMarked لا يفحص DB read_at؛ فقط وجود detail-article.
- «survives reload» هو Page.reload، لا restart العملية. لا يثبت boot recovery الجديد.
- DND E2E يختبر set/clear فقط، لا dispatch suppression/expiry/flood.
- اختبار إلغاء التفاصيل لا يبدأ pump قبل abort، فلا يثبت إلغاء طلب جارٍ.
- اختبارmigration يفتح DB جديدةv3 ويعيد فتحها؛ لا يبنيv2 بsettings/events/waits ثم يهاجرهاv3.
- اختبارload>200 لا يمر بالـIPC أو UI؛ لهذا لم يمسكR05.
- «sort nulls last» لا يُدخل publishedAt=null، وتأكيدsort الأخير toBeDefined بلا مقارنة.
- التقرير يعطيcheckmarks كاملة لـscope والscroll/resize والnotification routing وQA، بينما بعضها غير منفذ أو غير مختبر؛ لم توجد unit tests تربطsummary click بالـshell handler الفعلي.

**الإصلاح:** assertions على النتيجة المقصودة لا presence، fixtures محلية deterministic، restart حقيقي، hooks محدودة لاستبدال OS sender/opener فقط، وتحديثstatus بdone/not-tested فعلية بعد الإصلاح.

## R17 — P3: نواقص دفاع/وصول وتجربة ثانوية

- لا setWindowOpenHandler ولا will-navigate guard في نافذتي main/compact رغم طلبهما بالخطة. لا أدّعي exploit حاليًا؛ النص يُعرض عبر React وليس HTML نشطًا، وcontextIsolation/sandbox ما زالا مفعّلين.
- ConfirmDialog/FilterDrawer/HealthPopover بلا focus trap/restore؛ aria-modal وحده لا يمنع Tab من الانتقال للخلفية. Resize separator بـtabIndex لكن بلا keyboard resizing. Escape لا يغلق preview/health في كل الحالات.
- زر اختصارات statusbar يفتح settings/shortcuts، لكن Section لا يعرفshortcuts فيعرض watching؛ الاختصارات موجودة داخلappearance.
- empty-filter عندماtotal=0 تعرض no-data/first-run hint بلا reset؛ لا تفرّق بين قاعدة فارغة وفلتر صفرنتائج. showBanner لا يتضمنoffline.
- preview تُفتح عمليًا بالأسهم أو selection العائدة؛ النقر علىcard يذهب للتفاصيل مباشرة، ولا يوجد preview action مستقل واضح للمستخدم بالماوس.
- bounds correction يتحقق مركزالنافذة فقط لا كاملworkArea، خلاف التعليق؛ يمكن بقاء أطراف خارجالشاشة. أبعاد900×600/150% وتفاعلrail تحتاجQA فعلي.
- main quit يغلقDB فورًا دون انتظارflushing؛ dispatchPending يحملDB قديمة ويكتب بعدawait، وopenProjectById يكتب بعدshell.openExternal دون إعادة فحصdb. هذا نقص قديم مستمر، لا سباق داخلtransaction متزامنة كما وُصف سابقًا. يجب اختبار الإغلاق خلالdispatch/fetch والكتابات المتأخرة، لا إضافةsleep كضمان.
- harness E2E يمسح PROFILE recursive منمدخل CLI دون تحقق أوmarker؛ الاستخدام الآمن في المراجعة كان بمجلدTEMP جديد تحققنا منه. سكربت الصور مربوط بمسار جهازالمطور، وأمثلةCLI تستخدمصيغة تختلفعن parser الذي ينتظر`--key=value`.

## المثبت وما لم يُختبر

المثبت الموجود: 115083831 بايت، NotSigned، SHA256 الصحيح:

`777EE10E445E9623E52D2BB7363B8A39D3532F619C3C7B15E3E1E2E4536829C3`

التقرير الأصلي أسقط آخر حرف `3` من hash. لم أعد dist لأن المراجعة لم تعدّل التطبيق؛ npm run build أعاد out المحلي فقط.

مشكلة silent default install المذكورة في التقرير **لم أعِد إنتاجها مستقلًا**؛ لا يصح تحويلها لعيب مثبت هنا، ولا إغلاقها بوصفها سليمة. تحتاج تثبيتًا بالمسار الافتراضي و/D على VM أو بيئة اختبار مستقلة مع NSIS logs.

لم أختبر يدويًا نقرة OS toast فعلية، أو صوتًا مسموعًا، أو بدء ويندوز، أو النوم والاستيقاظ، أو Tray، أو حوارات الاستيراد والتصدير، أو دورة التثبيت والإزالة، أو DPI بنسبة 150%. نجاح build وE2E لا يقوم مقامها. ربط التنبيه الفردي والملخص بـshell.openExternal موجود بالكود؛ لم أدّعِ مشاهدة نقرة OS فعلية.

## ما يبدو سليمًا ويُحافَظ عليه أثناء الإصلاح

- إضافة schema3 دون تعديل migrations1/2، وجداول الحالة الشخصية/cache/filters/tombstones والـFK.
- queryProjectsPage يطبق فلاتر التخزين قبل pagination/count بنفس المسار؛ الخطأ في توصيل UI/IPC لا في فكرة query الأساسية.
- purge يحمي bookmark/notes/interested/submitted ويعمل VACUUM INTO قبل الحذف؛ مشكلة inflight لا تلغي هذه الضمانات.
- preload محدود، وcontextIsolation/sandbox، وروابط المشاريع ضمن allowlist، والنص معروض عبر React كنص عادي.
- اختبارات baseline/dedup/backoff وانتظار 30 ثانية وإصلاحات 0.1.1 ما زالت تمر؛ لا تغييرات جذرية لـRSS.
- التطبيق محلي، الخطوط مضمّنة، dark/light وRTL/LTR موجودة، المثبت الجديد حقيقي، ولم يحدث نشر جديد.

## ترتيب إصلاح مقترح

1. R01–R04: الصوت، حفظ الملاحظات، المخفية، توصيل الفلاتر.
2. R05–R07 وR11–R12: paging/navigation/compact/detailstate/keyboard.
3. R08–R10 وR13–R15: حدود طلبات الشبكة، الحذف، الأحداث، الوصف، DND، metadata.
4. تقوية الاختبارات وتصحيح R16 والتقارير، ثم QA للنسخة المجمعة وبناء مثبت جديد وhash صحيح.
5. معالجة R17 وفق أولوية الدفاع والوصول؛ لا اعتماد «كل شروط القبول نجحت» قبل توثيق المتبقي.

هذه نتائج قراءة وتجارب محددة، مع فصل الأدلة المباشرة عن المخاطر المستنتجة وما لم يُختبر؛ لا تعني خلو بقية التطبيق من أي خطأ محتمل.
