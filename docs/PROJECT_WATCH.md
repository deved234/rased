# متابعة المشاريع · Project watch

متابعة المشاريع متاحة بدءًا من الإصدار القادم (the next release) لمشاريع مستقل ونفذلي وكاف (خمسات غير مشمولة).

## الاستخدام

تتيح ميزة «متابعة المشاريع» مراقبة مشاريع محددة لمعرفة متى يبدأ صاحب المشروع بالتواصل مع مستقلين، أو متى يدخل المشروع مرحلة التنفيذ، أو عند إغلاقه أو اكتماله.

### أين يظهر زر «متابعة»؟

- **في قائمة المشاريع الرئيسية**: في كل صف مشروع مباشرة بعد زر «معاينة».
- **في لوحة المعاينة الجانبية**: في شريط الإجراءات بجانب زر المنصة.
- **في صفحة تفاصيل المشروع الكاملة**: بجانب زر «فتح على المنصة».
- **في النافذة المصغرة (Compact)**: كأيقونة مستقلة بجانب زر الحفظ.
- **في شاشة متابعة المشاريع**: «تحت المتابعة» للنشطة، و«بانتظار مكان» للمنتظرة، و«تابع من جديد» للمتوقفة التي يمكن متابعتها مجددًا.

عند الضغط على الزر، يتحول إلى «تحت المتابعة ✓» إذا كان هناك مكان متاح، أو «بانتظار مكان» إذا اكتمل الحد الأقصى للمنصة.

### شاشة متابعة المشاريع في الشريط الجانبي

يحتوي الشريط الجانبي على عنصر مخصص «متابعة المشاريع» بأيقونة الجرس، يعرض عدد المشاريع المتابعة حاليًا. داخل الشاشة:
- **عدادات المنصات**: في أعلى الشاشة عداد لكل منصة يوضح عدد المشاريع النشطة من أصل 10 (مثلاً: `مستقل: 3 / 10`، `نفذلي: 2 / 10`، `كاف: 1 / 10`). إذا تعرضت منصة لحظر فحص، تظهر ملاحظة ` — متوقفة مؤقتًا لحماية الرصد`.
- **قسم «تحت المتابعة»**: المشاريع التي يجري فحصها دوريًا في الوقت الحالي.
- **قسم «بانتظار مكان»**: المشاريع التي وُضعت في قائمة الانتظار لعدم توفر مكان شاغر على المنصة.
- **قسم «توقفت مؤخرًا»**: المشاريع التي توقفت متابعتها، مع توضيح سبب التوقف وزر «تابع من جديد» للمشاريع التي لا تزال مفتوحة أو غير محددة الحالة.
- **بيانات البطاقة**: تعرض البطاقة حالة المنصة، عدد العروض (مثل `العروض: 12` أو `50+`)، وبيانات صاحب المشروع على مستقل (تواصلاته، مشاريعه المفتوحة، ومشاريعه قيد التنفيذ)، ووقت آخر فحص وآخر تغيير، وتنبيه `تعذّر الفحص` عند حدوث خطأ عابر.

## الحدود وقواعد المتابعة

- **الحد الأقصى**: 10 مشاريع نشطة لكل منصة (`WATCH_CAP_PER_SOURCE = 10`).
- **المشروع الحادي عشر وقائمة الانتظار**: عند إضافة مشروع إضافي يتجاوز الحد 10، يدخل حالة «بانتظار مكان» ويظهر مربع حوار يخيرك بين:
  - **«انتظر مكانًا»**: إبقاء المشروع في قائمة الانتظار حتى يفرغ مكان تلقائيًا.
  - **«بدّل بمشروع آخر»**: فتح نافذة استبدال لاختيار مشروع نشط وإيقافه ليحل محله المشروع الجديد فورًا. تُرتّب مشاريع الاستبدال بوضع المشاريع التي لم تضع لها حالة «قدّمت» أولاً، ثم الأقدم نشاطًا.
- **ترتيب الترقية من الانتظار**: عند إغلاق أو إيقاف أي مشروع نشط، يُرقّى أقدم مشروع في الانتظار تلقائيًا (`waiting_since ASC, project_id ASC`) بشرط ألا يكون مخفيًا أو في حالة «تجاهل».
- **انتهاء الصلاحية**: تتوقف المتابعة تلقائيًا بعد 14 يومًا من بدء المتابعة النشطة (وقت الانتظار لا يُحسب). الإيقاف المؤقت للمنصة لا يوقف هذا العدّ، فقد تنتهي متابعة متأخرة فور الاستئناف.
- **البدء التلقائي عند «قدّمت»**: تغيير حالتك الشخصية للمشروع إلى «قدّمت» يبدأ متابعته تلقائيًا (نشطًا إن وُجد مكان، أو في الانتظار)، ما لم تكن قد أوقفته يدويًا مسبقًا.
- **الإيقاف عند «تجاهل» أو الإخفاء**: نقل المشروع إلى «تجاهل» أو إخفاؤه يوقف متابعته فورًا بسبب «تم التجاهل». لو غيّرت حالته بعد ذلك إلى «قدّمت» تبدأ متابعته تلقائيًا من جديد؛ الإيقاف اليدوي من زر «متابعة» وحده هو الذي يمنع البدء التلقائي.
- **أسباب التوقف الظاهرة في الواجهة**:
  - `يدويًا`: أوقفت المتابعة بنفسك.
  - `تم استبدالها`: استُبدل المشروع بمشروع آخر عند اكتمال الحد 10.
  - `أُغلق المشروع`: أُغلق المشروع أو اكتمل على المنصة.
  - `انتهت مدة الـ14 يومًا`: انتهت صلاحية المتابعة المحددة بـ14 يومًا.
  - `تم التجاهل`: تجاهلت المشروع أو أخفيته.
  - `لم يعد متاحًا`: حُذف المشروع من المنصة، أو أرجع خطأ 404/410، أو صارت صفحته خاصة على نفذلي أو كاف.
  - `تم تعطيل المنصة`: عُطّلت المنصة بالكامل من إعدادات الرصد.

## الوتيرة وحماية الرصد

- **حصة الفحص الدورية**: يجري راصد فحصًا واحدًا فقط لكل منصة في الدورة الزمنية الواحدة (10 ثوانٍ افتراضيًا).
- **إبطاء الفحص بعد الحظر**: عند تلقي رد حظر، تتضاعف المدة تلقائيًا (20 ث، 40 ث... حتى 300 ثانية كحد أقصى).
- **التعافي التدريجي**: بعد 20 فحصًا ناجحًا متتاليًا، تنخفض المدة تدريجيًا إلى النصف حتى تعود إلى 10 ثوانٍ.
- **إبطاء المشاريع الخاملة**: المشروع الذي لا يطرأ على حالته أو تواصلاته أي تغيير لمدة 24 ساعة يتباطأ فحصه إلى مرة كل 10 دقائق لتوفير الموارد.
- **الأولوية التامة للرصد الأساسي**: متابعة المشاريع تتنازل دائمًا للرصد الأساسي وجلب التفاصيل؛ أي فحص متابعة قيد التنفيذ يُلغى فورًا إذا احتاج الرصد الأساسي إلى القناة.
- **إيقاف المتابعة عند الحظر (30 دقيقة)**:
  - عند مواجهة رمز حظر (401، 429، 202، صفحة تحدٍ أمني، أو 403 غير خاص)، تتوقف متابعة تلك المنصة مؤقتًا لمدة 30 دقيقة على الأقل (أو المدة المحددة في ترويسة `Retry-After`).
  - لا تُستأنف المتابعة إلا بعد انقضاء هذه المدة **ونجاح فحص الرصد الأساسي** على تلك المنصة.
  - يُطبق وقت التهدئة على الرصد الأساسي للمنصة أيضًا في نفس اللحظة لحمايتها.
- **الصفحات الخاصة على نفذلي وكاف**: إذا ردّت صفحة المشروع بـ 403 وكان محتواها صفحة «مشروع خاص» معروفة (وليست صفحة حماية)، يوقف راصد متابعة ذلك المشروع وحده بسبب «لم يعد متاحًا» دون إيقاف المنصة. أي 403 آخر يُعامل كحظر ويوقف متابعة المنصة مؤقتًا. التحويل لصفحة تسجيل الدخول يُحسب فحصًا فاشلًا عاديًا.
- **جلب دون تسجيل دخول أو ملفات تعريف ارتباط**: يتم الجلب دون حسابات أو كوكيز أو تجاوز لحماية المواقع، ويتبع 3 تحويلات (redirects) كحد أقصى داخل نفس الموقع، بمهلة 10 ثوانٍ لكل فحص.

## التنبيهات وإعداداتها

- **أول فحص صامت**: أول فحص بعد بدء المتابعة يحفظ الحالة المبدئية بصمت دون إرسال تنبيه.
- **تغير عدد العروض فقط**: تغير عدد العروض وحده لا يرسل تنبيهًا، بل يُحدّث في السجل والواجهة فقط.
- **نصوص التنبيهات الدقيقة**:
  - عند التنفيذ: «المشروع دخل مرحلة التنفيذ»
  - عند الإغلاق: «المشروع أُغلق — توقفت المتابعة»
  - عند الاكتمال: «المشروع اكتمل — توقفت المتابعة»
  - تواصل مؤكد (المشروع مفتوح، ولدى العميل مشروع واحد مفتوح وصفر قيد التنفيذ): «العميل بدأ يتواصل مع مستقلين على هذا المشروع (m ← n)»
  - تواصل محتمل (لدى العميل مشروعان مفتوحان أو أكثر): «صاحب المشروع بدأ يتواصل مع مستقلين (m ← n). عنده k مشاريع مفتوحة، فقد يكون على هذا المشروع»
  - تواصل محتمل (افتراضي): «صاحب المشروع بدأ يتواصل مع مستقلين (m ← n) — قد يكون على هذا المشروع»
- **خيارات التحكم في التنبيهات (الإعدادات ← التنبيهات ← تنبيهات متابعة المشاريع)**:
  1. **تغيّر حالة المشروع** (`watchNotifyStatus`): تشغيل أو كتم تنبيهات دخول التنفيذ والإغلاق والاكتمال.
  2. **تواصل مؤكد على مشروعك** (`watchNotifyContactSure`): تشغيل أو كتم تنبيهات التواصل المؤكد.
  3. **تواصل محتمل** (`watchNotifyContactMaybe`): تشغيل أو كتم تنبيهات التواصل المحتمل.
  - هذه المفاتيح الثلاثة لا تكفي وحدها: يلزم أيضًا أن تكون التنبيهات العامة وتنبيهات المنصة مفعّلة، والمنصة نفسها مفعّلة، والمشروع غير مخفي.
- **عدم الإزعاج**: يكتم التنبيهات في وقتها وتُسجل كـ`suppressed` في قاعدة البيانات، ولا يُعاد إرسالها لاحقًا عند الخروج من وضع عدم الإزعاج.
- **تجميع التنبيهات**: إذا كان عند الإرسال تنبيهات مستحقة خارج ملخص الغياب (بعد استبعاد المكتومة وغير المؤهلة) لأكثر من 3 مشاريع مختلفة، تُجمع في إشعار ملخص واحد: «تغييرات في N مشاريع تتابعها».
- **ملخص الغياب («حصل وأنت غايب»)**: لا يُفحص شيء والبرنامج مقفول. عند تشغيل راصد أو رجوع الجهاز من وضع السكون، تبدأ فترة «غياب» تضم المشاريع النشطة وقتها، وتُجمع نتائج أول فحص ناجح لكل منها؛ إذا ظهرت فيها تغييرات مؤهلة يصل إشعار واحد: «حصل وأنت غايب: تغييرات في N مشاريع». يُرسل الملخص عندما يُحفظ فحص ناجح لكل مشروع في الفترة أو يتوقف أو يُستبدل أو يُحذف، أو بعد 10 دقائق أيهما أسبق. إذا كانت هناك فترة غياب مفتوحة بالفعل (مثلاً إعادة تشغيل سريعة)، تستمر بنفس المشاريع والموعد ولا تبدأ فترة جديدة. المشروع الذي يُفحص لأول مرة بعد انتهاء الفترة تُحدَّث بياناته في الواجهة دون إشعار عن تلك الفترة.
- **الضغط على التنبيه**: يفتح رابط المشروع في المتصفح الافتراضي؛ وفي إشعار الملخص يُفتح أول مشروع فيه. إذا وصل راصد بتذكرة التفعيل وكان المشروع قد حُذف من السجل المحلي، تظهر نافذة راصد بدلاً من ذلك. أما إذا فتح Windows الرابط مباشرة دون تذكرة، فيُفتح الرابط المحفوظ حتى لو حُذف المشروع محليًا. راجع [NOTIFICATIONS.md](NOTIFICATIONS.md).

## الخصوصية والتخزين المحلي

- **التخزين المحلي**: تُحفظ بيانات المتابعة في جداول SQLite المحلية (`project_watch`، `watch_source_state`، `watch_episode`، `watch_episode_member`، `notification_events`).
- **الإحصائيات**: في النسخة المهيأة وبعد الموافقة فقط، تُرسل ملخصات مجمّعة ونتائج محددة لكل استخدام مرتبطة بمعرّف تثبيت عشوائي، دون عناوين المشاريع أو روابطها أو نصوصها أو أسماء العملاء أو أرقام العروض والتواصلات:
  - `watch_hourly`: عدادات الفحوصات الناجحة والمحظورة والفاشلة والمبطأة ومستوى الوتيرة.
  - `watch_started`: المنصة ومكان البدء (ومنه البدء التلقائي عند «قدّمت») والنتيجة (نشط أو انتظار أو بدل مشروعًا آخر).
  - `watch_daily`: فئات عدد المشاريع المتابعة والمنتظرة في اليوم.
  - `watch_change`: المنصة ونوع التغيير ونتيجة الإشعار.
  - `watch_stopped`: المنصة وسبب الإيقاف.
  - تفاصيل إضافية في [ANALYTICS.md](ANALYTICS.md).

## الحدود الواقعية

- **الاعتماد على HTML الموقع**: قراءة صفحات المشاريع تعتمد على بنية صفحات الويب العامة؛ أي تعديل من المنصات على تصميم صفحاتها قد يعطل القراءة مؤقتًا لحين تحديث البرنامج.
- **طبيعة تنبيه التواصل (المؤكد والمحتمل)**: تنبيهات التواصل لمستقل فقط، وتأتي عند زيادة رقم «التواصلات الجارية» عن آخر قيمة محفوظة. هذا الرقم إجمالي لصاحب المشروع عبر كل مشاريعه، لذلك الوصفان «مؤكد» و«محتمل» استنتاج وليسا دليلًا على أن التواصل عن هذا المشروع أو معك أنت. «مؤكد» معناه فقط أن المشروع مفتوح ولصاحبه مشروع واحد مفتوح ولا شيء قيد التنفيذ.
- **اختبار نقرات Windows**: تؤكد الاختبارات الآلية إرسال التنبيهات ونظام التذاكر، لكن فتح المتصفح الحقيقي بنقرة إشعار Windows يتطلب فحصًا يدويًا من المستخدم.
- **التشغيل أثناء تشغيل راصد فقط**: لا تتم المتابعة أثناء إغلاق البرنامج؛ إغلاق النافذة يترك راصد يعمل في خلفية النظام (Tray) افتراضيًا لمواصلة المتابعة.

---

# Project watch (Developer & Architecture Guide)

Project watch is available starting with the next release for Mostaql, Nafezly and KAF. Khamsat is not supported.

## Overview & Limits

Users can watch individual projects from Mostaql, Nafezly, and KAF to track client contact progression, status movement to `in_progress`, and project closure or completion.

### Entry points
`WatchButton` appears in five UI surfaces:
1. `list`: the main project row in `src/renderer/components/ProjectRow.tsx`, immediately following the Preview button.
2. `preview`: the side preview drawer actions in `src/renderer/views/ProjectsView.tsx`.
3. `detail`: full in-app project view actions in `src/renderer/views/ProjectDetailView.tsx`.
4. `compact`: icon-only toggle in `src/renderer/views/CompactView.tsx`.
5. `watch_view`: the Watched projects screen row in `src/renderer/views/WatchingView.tsx` (active rows show "Watching ✓" / «تحت المتابعة ✓», waiting rows "Waiting for a slot" / «بانتظار مكان», eligible stopped rows "Watch again" / «تابع من جديد»).

### Limits and slot lifecycle
- **Cap**: 10 active watches per platform (`WATCH_CAP_PER_SOURCE = 10` in `src/shared/projectWatch.ts`).
- **Waiting queue**: An 11th watch is set to `state = 'waiting'`. `WatchLimitDialog` offers two choices: wait in the queue (`onWait`), or swap with an active project (`onSwap`).
- **Swap ordering**: `WatchReplaceDialog` uses `sortReplaceCandidates` (`src/renderer/components/watchUi.ts`): candidates are sorted with non-submitted proposals first, followed by oldest activity (`lastChangedAt ?? startedAt`), then lower `projectId`. Replacing transitions the victim to `state = 'stopped'`, `stop_reason = 'replaced'`.
- **Promotion**: When an active watch slot is freed, `promoteOldestTx` (`src/storage/projectWatch.ts`) promotes the oldest waiting project (`ORDER BY pw.waiting_since ASC, pw.project_id ASC`) that is not hidden and not marked ignored.
- **Expiry**: Active watches expire 14 days after `started_at` (`WATCH_EXPIRE_MS`), stopping with reason `expired`; waiting time does not count, and a platform pause does not freeze the clock, so an overdue watch can expire when checks resume.
- **Auto-start on «قدّمت»**: Updating personal status to `submitted` triggers `autoStartOnSubmittedTx` in `src/storage/projectWatch.ts`, activating the watch if a slot is available or queueing it in waiting — unless the user stopped it manually (`auto_start_blocked = 1`).
- **Stop on «تجاهل» / Hide**: Updating personal status to `ignored` or setting `hidden: true` invokes `stopWatchTx` with reason `ignored`. It does not set `auto_start_blocked`, so a later change to `submitted` starts watching again; only a manual watch-off sets that flag.
- **Stop reasons**: `manual`, `replaced`, `closed`, `expired`, `ignored`, `gone`, `source_disabled`.

## Pace and Protection

- **Slot timing**: `ProjectWatcher` checks at most one project per platform per slot (`WATCH_SLOT_MS = 10_000` = 10 s).
- **Block slowing**: On HTTP 401, 429, 202, protection challenges, or non-private 403, the platform slot doubles up to `WATCH_SLOT_MAX_MS = 300_000` (5 minutes).
- **Recovery streak**: 20 consecutive snapshot successes (`successStreak >= 20`) halve the slot duration back toward 10 seconds.
- **Idle backoff**: A project whose status and contacts have not changed for 24 hours (`WATCH_IDLE_AFTER_MS`) slows to checking once every 10 minutes (`WATCH_IDLE_SLOT_MS = 600_000`).
- **Preemption and yielding**: Watch checks claim slots through `arbiter.claim('watch', onPreempt)`. Watch checks yield to primary monitoring, detail enrichment, and user requests. If preempted in flight, the check aborts.
- **Block pause**:
  - The platform watch pauses for at least 30 minutes (`WATCH_BLOCK_PAUSE_MS = 30 * 60 * 1000`, or `Retry-After` if larger).
  - The platform watch resumes only after both the pause duration expires AND primary monitoring completes a successful poll (`pollSucceededSince`).
  - The platform's primary monitoring cooldown is applied simultaneously via `onBlock`.
- **Private project isolation**: On Nafezly and KAF, a 403 whose body is a recognised private-project page without protection markers is parsed as `kind: 'private'` and stops only that watch with reason `gone`, without penalizing the platform. Any other 403 is a block. A redirect to a login page is rejected by the transport and counts as an ordinary failed check.
- **Network safety**: Fetches use anonymous HTTP requests without credentials, sessions, or protection bypass, following at most 3 redirects within the same site, with a 10-second timeout per check.

## Notifications

- **Silent baseline**: The first check initializes `status` and `contacts` without dispatching events (`src/storage/projectWatch.ts`).
- **Offers count**: Changes in offers count alone do not notify.
- **Alert copies**:
  - `status_in_progress`: "The project moved to in progress" / «المشروع دخل مرحلة التنفيذ»
  - `status_closed`: "The project was closed — watching stopped" / «المشروع أُغلق — توقفت المتابعة»
  - `status_completed`: "The project was completed — watching stopped" / «المشروع اكتمل — توقفت المتابعة»
  - `contact_sure`: "The client started talking to freelancers on this project (m → n)" / `العميل بدأ يتواصل مع مستقلين على هذا المشروع (${m} ← ${n})`
  - `contact_maybe` (`clientOpen >= 2`): "The client started talking to freelancers (m → n). They have k open projects, so it may be this one" / `صاحب المشروع بدأ يتواصل مع مستقلين (${m} ← ${n}). عنده ${k} مشاريع مفتوحة، فقد يكون على هذا المشروع`
  - `contact_maybe` (default): "The client started talking to freelancers (m → n) — it may be this project" / `صاحب المشروع بدأ يتواصل مع مستقلين (${m} ← ${n}) — قد يكون على هذا المشروع`
- **Settings toggles**:
  - `watchNotifyStatus`: enables or disables status change alerts.
  - `watchNotifyContactSure`: enables or disables confirmed contact alerts.
  - `watchNotifyContactMaybe`: enables or disables possible contact alerts.
  - These toggles alone do not enable delivery: global notifications, the platform's notification setting, the platform being enabled and the project not being hidden also apply.
- **Suppression**: Do Not Disturb suppresses alerts at dispatch time and records them as `suppressed` in SQLite; they are never replayed later.
- **Batching**: If a dispatch pass finds valid, eligible, pending non-episode events (after suppression) for more than 3 distinct projects, one batch summary toast is shown: "Changes in N projects you watch" / «تغييرات في N مشاريع تتابعها».
- **Away summary**: Nothing is checked while RASED is closed. On startup or resume from standby, `startEpisode` creates an episode enrolling the current active watches — or, if an episode is already open, reuses it with its existing members and deadline (a quick restart does not reset the window or add watches); their first subsequent snapshots supply its events. The episode becomes dispatchable when every member was observed, stopped, replaced or deleted, or after 10 minutes, and produces "While you were away: changes in N projects" / «حصل وأنت غايب: تغييرات في N مشاريع» only if it holds eligible changes. A member first observed after the episode closed updates locally, but its events for that period are suppressed.
- **Click behavior**: Toast activations use persistent activation tickets or the Windows HTTPS fallback. With a ticket, RASED opens the project URL in the default browser, or shows its main window if the project was removed from local history. Batch and away summaries target their first project. The HTTPS fallback bypasses RASED and opens the stored URL even if the project was deleted locally. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

## Privacy

- **Local persistence**: Watch state is stored strictly on device in SQLite tables (`project_watch`, `watch_source_state`, `watch_episode`, `watch_episode_member`, `notification_events`).
- **Telemetry**: After acceptance, configured release builds send aggregated summaries and individual allow-listed feature outcomes, associated with a random installation identifier: `watch_hourly` (counts of ok, blocked, failed, slowed, preempted; slot bucket), `watch_started` (source, entry, result), `watch_daily` (watched/waiting count buckets), `watch_change` (source, change kind, notified outcome), and `watch_stopped` (source, reason). No project titles, URLs, descriptions, IDs, or contact counts are transmitted. See [ANALYTICS.md](ANALYTICS.md).

## Honest Limitations

- **HTML parsing**: Watch depends on the public HTML markup of Mostaql, Nafezly, and KAF. Unannounced site changes may require software updates.
- **Contact attribution**: Contact alerts exist only for Mostaql and need an increase over an established baseline. Mostaql exposes an aggregate count of ongoing conversations across all of the client's projects. "Sure" requires the watched project to be open, the client to have exactly one open project and none in progress; otherwise it is "maybe". Both labels are an inference, not proof that the contact concerns this project or this user.
- **Windows toast clicks**: Automated OS integration fixtures verify dispatch wiring and ticket generation, but real user notification clicks and browser window activation require manual verification on Windows.
- **Offline operation**: Checks run only while RASED is active. Closing the window minimizes to the tray by default; quitting terminates checks.

## Development

### Modules and responsibilities
- `src/shared/projectWatch.ts`: Constants, snapshot interfaces, attribution logic.
- `src/collector/projectWatch.ts`: HTML fragment parsers for Mostaql, Nafezly, and KAF.
- `src/main/projectWatcher.ts`: Scheduler, arbiter integration, backoff, slot pacing, and preemption.
- `src/main/watchTransport.ts`: HTTP fetch implementation with redirect limits and abort signals.
- `src/main/watchNotifier.ts`: Notification dispatching, threshold batching, and away episodes.
- `src/shared/watchNotificationText.ts`: Localized notification strings.
- `src/storage/projectWatch.ts`: SQLite operations, transactions and snapshot persistence. The tables are created by migration 11 in `src/storage/migrations.ts`.
- `src/renderer/components/WatchButton.tsx`, `WatchLimitDialog.tsx`, `WatchReplaceDialog.tsx`, `watchUi.ts`: React components and presentation helpers.
- `src/renderer/views/WatchingView.tsx`, `SettingsView.tsx`: Main watching view and notification settings.

### Storage tables
- `project_watch`: Stores per-project watch rows, states, snapshots, and versioning.
- `watch_source_state`: Stores per-source slot duration, success streak, pause deadline, block time and the required-primary-success flag (per-project failures live in `project_watch`).
- `watch_episode` & `watch_episode_member`: Manages away summary tracking across application restarts and standby.
- `notification_events`: Stores queued watch events (`watch_status`, `watch_contact`) with deduplication keys.

### Consent gate
Configured distributions enforce an accept-or-exit gate; unconfigured development builds are exempt. Before acceptance (`applicationAccessAllowed() === false`), `watchSet` and `watchReplace` reject requests with `untrusted-sender`, `gateOpen` blocks watch network checks, and personal status updates skip watch auto-start and the ignore/hide stop. Read operations (`watchList`, `watchCounts`) and startup/resume episode bookkeeping still run.

### Verification
- Run `npm test` for Vitest unit tests in `tests/project-watch*.test.ts`.
- Run `npm run build` followed by `npm run test:watch`: executes `scripts/project-watch-e2e.mjs` against real Electron, preload, SQLite, and UI wiring in isolated TEMP profiles using synthetic public pages (`<profile>/watch-pages.json`). It verifies state transitions, dialog flows, block-pause establishment (pause, primary cooldown, required-success flag — recovery is covered by unit tests), away episodes and clean shutdowns. It does not prove real notification clicks, browser focus or live site behaviour.
