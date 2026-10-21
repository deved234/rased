# الخصوصية

2026-10-21 · RASED · david atef

## إحصائيات الاستخدام الاختيارية

في البناء المهيأ فقط، يمكنك الموافقة من الإعدادات على إرسال إحصائيات محدودة إلى PostHog US Cloud. المشاركة مغلقة حتى توافق، ولا يحد الرفض من الرصد أو التنبيهات أو الميزات. تشمل معرّف تثبيت عشوائيًا، الإصدار واللغة وعائلة Windows العامة، ونشاطًا يوميًا وملخصات رصد ونتائج ميزات من فئات محددة. لا تشمل اسمك أو محتوى المشاريع أو روابطها أو عروضك وملاحظاتك أو كلمات البحث أو مفاتيح API أو جلسات المتصفح. لا تسجيل شاشة أو autocapture أو تقارير انهيار خام. يصل IP إلى مزود الشبكة أثناء الاتصال؛ يطلب راصد عدم استخدامه في GeoIP ويشترط استبعاده من أحداث المشروع المخزنة. يظل المزود طرفًا سحابيًا، راجع https://posthog.com/privacy .

## الاحتفاظ وإيقاف الإحصائيات وطلب الحذف

لا يحدد راصد مدة انتهاء أو حذفًا دوريًا لبيانات الإحصائيات التي سبق إرسالها؛ تُحتفظ إلى أن يطلب المستخدم حذفها، مع مراعاة سياسات التخزين والحذف لدى PostHog ومتطلبات القانون المطبقة. هذا لا يضمن تخزينًا أبديًا أو إتاحة دائمة، ولا يلغي حقوق المستخدم أو التزامات الحذف القانونية. تُراجع طلبات الحذف وتُنفذ إداريًا ويُتحقق من اكتمال المعالجة غير اللحظية لدى المزود. الصف المحلي مستقل ومحدود بسبعة أيام و1000 حدث أو 2 MiB من المحتوى، وقد تسقط بيانات عند الانقطاع أو تجاوز الحصة؛ هذا حد للمؤجل محليًا ولا يحدد مدة الاحتفاظ البعيد. إيقاف المشاركة يلغي النقل ويمسح المؤجل، ولا ينفذ تلقائيًا طلب حذف لما وصل للخادم سابقًا. المعرّف يبقى محليًا لدعم طلب الحذف ولا يدخل النسخ المحمولة أو تصدير الإعدادات. انسخ مرجعك من الإعدادات وتواصل بنفسك عبر واتساب 01201780258 / https://wa.me/201201780258 لطلب حذف بياناتك السابقة؛ لا يرسل فتح الرابط مرجعك تلقائيًا ولا يثبت اكتمال الحذف. احفظ المعرّف وأوقف المشاركة قبل طلب الحذف لتجنب إرسال أحداث جديدة أثناء معالجته؛ وبعد اكتماله انسَ المعرّف محليًا قبل أي مشاركة جديدة. نسيان المعرّف محليًا مختلف عن حذف الخادم. عدادات تنزيل GitHub بيانات مجمعة عامة، ولا تثبت أسماء أو عدد مستخدمين فريدًا.

## حالة التحقق من حذف الإحصائيات

التحقق النهائي من اكتمال حذف الأحداث لدى PostHog لم يكتمل بعد. يمكنك طلب الحذف؛ لن نؤكد اكتماله قبل التحقق من المزود، وقد تتأخر المعالجة. تظل المشاركة اختيارية ويمكن إيقافها في أي وقت.

## اتصالات كاف

عند تفعيل كاف يتصل جهازك مباشرة بـ kafiil.com لقراءة قائمة المشاريع العامة، وبصفحة المشروع عند طلب التفاصيل، دون ملفات تعريف ارتباط أو تسجيل دخول. يستقبل الموقع عنوان IP وبيانات الطلب. تُخزّن العناوين والمقتطفات والميزانية والمهارات وحالة المنصة والتفاصيل والمدة والوقت الخام محليًا. لا تُرسل بيانات كاف إلى مزودي الذكاء الاصطناعي أو إضافة التقديم السريع. يمكنك تعطيل رصده وتنبيهاته مستقلاً.

## قالب التقديم السريع وإزالة الجلسات القديمة

نص العرض ونسبة السعر والأيام الإضافية محفوظة محليًا، والتصدير الاختياري يحتوي النص. أُزيل المتصفح الداخلي وتسجيل الدخول داخله. عند بدء هذه النسخة يحاول راصد حذف مجلدي جلسات المتصفح الداخلي السابقين فقط وإبطال تذاكر تقديمه القديمة؛ يسجل التشخيص إذا فشل الحذف لإعادة المحاولة عند تشغيل لاحق. لا يحذف جلسات Chrome أو مشاريعك أو إعداداتك. تقرأ إضافة Chrome نموذج المشروع المطلوب في بروفايل تختاره وتعبئه بناءً على قالبك، دون إرسال العرض. يرسل راصد عنوان المشروع ومعرّفه والقالب وإعدادات السعر والمدة إلى الإضافة عبر Native Messaging وملف ربط محلي مستقل. رموز الربط محفوظة في جهازك: الرمز في تخزين الإضافة المحلي وبصمته في قاعدة راصد؛ سر النقل في مجلد محمي للمستخدم. لا تُصدّر مفاتيح الربط مع الإعدادات. الإلغاء لا يزيل تسجيل دخول Chrome. السجل المحلي يتضمن معرّفات حالات التجهيز، دون نص القالب أو كلمات المرور.

## ما يبقى على جهازك

تُحفظ المشاريع والمقتطفات والوصف المجلوب، حالة القراءة والمحفوظات والملاحظات والفلاتر والإعدادات والسجل التشخيصي محليًا في SQLite ومجلد بيانات التطبيق. لا يحتاج الرصد حساب راصد أو خادمًا خاصًا، ولا تُرفع قاعدة المشاريع أو السجل التشخيصي تلقائيًا للمطور. إحصائيات الاستخدام الاختيارية المنفصلة موضحة أعلاه.

## الاتصالات الخارجية

يتصل جهازك مباشرة بمستقل لجلب RSS وصفحات التفاصيل عند الحاجة، وبصفحة طلبات الخدمات غير الموجودة العامة في خمسات، وبخلاصة RSS العامة لنفذلي عند تفعيل رصده وصفحات مشاريعه العامة عند طلب الميزانية والمدة من المعاينة أو التفاصيل. تُحفظ بيانات البطاقة مؤقتًا محليًا لتقليل الطلبات وتحترم الإيقاف والتهدئة. قد يرى كل موقع ومزود الشبكة عنوان IP ووقت الطلب وبيانات الاتصال وUser-Agent. فتح رابط طلب أو مشروع أو GitHub أو LinkedIn يشغّل متصفحك وتطبق سياسات تلك المواقع. لا يقرأ راصد جلسة المتصفح أو كلمات مرور المنصات. رصد خمسات ونفذلي لا يحتاج تسجيل دخول؛ وصف نفذلي الكامل الوارد في RSS يُحفظ محليًا.

## مساعد العروض وGemini وOpenAI وClaude

الاختيار يشمل Gemini من Google وOpenAI وClaude من Anthropic مباشرة. بعد معاينة وموافقة وضغط توليد فقط، يرسل جهازك للشركة المختارة عنوان مشروع مستقل ووصفه المتاح وتصنيفه ومهاراته وميزانيته، مع تعليمات توضح اكتمال الوصف، وملفك المهني وملاحظات هذا العرض الاختيارية. لا تُرسل ملاحظتك الشخصية على المشروع أو مشاريع أخرى أو مسودات سابقة تلقائيًا. تعود مسودة وافتراضات وأسئلة، وتُحفظ محليًا في SQLite مع اسم الموفر والموديل ويمكن تعديلها وحذفها. لا تبديل تلقائي للشركة عند الفشل. لا توليد أثناء الرصد أو التشغيل أو فتح المشروع. قد تستقبل الشركة IP وبيانات الاتصال والمدخلات والمخرجات؛ شارك ما أنت مخول بمشاركته فقط.

## كيفية تعامل Google مع بيانات Gemini

وفق شروط Gemini API، تستخدم Google مدخلات ومخرجات الخدمات غير المدفوعة لتحسين منتجاتها وتقنياتها، وقد يطلع عليها مراجعون بشريون؛ وتنصح Google بعدم إرسال معلومات حساسة أو سرية أو شخصية عبرها. في الخدمات المدفوعة المرتبطة بحساب فوترة نشط لا تستخدم Google المدخلات والمخرجات لتحسين منتجاتها، لكنها تحتفظ بسجلات محدودة لمنع إساءة الاستخدام. توجد استثناءات وقيود إقليمية، ومنها ترتيبات مختلفة للمنطقة الاقتصادية الأوروبية والمملكة المتحدة وسويسرا. راجع الشروط السارية على حسابك قبل الاستخدام: https://ai.google.dev/gemini-api/terms .

## مفاتيح API والتكلفة والتحقق

كل مستخدم يضع مفتاحه لكل شركة؛ لا مفتاح مشترك. المفاتيح مستقلة ومشفرة بحماية Windows في ملفات خارج SQLite والتصدير والسجلات، ويمكن حذف مفتاح واحد من الإعدادات. نقل Gemini القديم يتحقق من النسخة الجديدة قبل حذف الأصل، والحذف يزيل كلا المسارين. التشفير لا يحمي من برامج تعمل بنفس حسابك. حفظ المفتاح ليس إثباتًا لصلاحيته. تحديث الموديلات بطلبك يرسل المفتاح للمصادقة وبيانات الاتصال، دون بيانات مشاريعك؛ تُحفظ القائمة وتاريخها محليًا. اختبار التوليد بطلبك يرسل بيانات وهمية فقط ويستهلك حصة أو رصيدًا محتملًا. تُحفظ حالة آخر نجاح مرتبطة بالمفتاح والموديل محليًا، ولا تعني ضمان الإتاحة مستقبلًا. لا إعادة محاولة مدفوعة تلقائية؛ التكلفة والحصص بحسب الشركة وحسابك.

## بيانات OpenAI وAnthropic

سياسات API تختلف عن تطبيقات المحادثة الاستهلاكية، وتعتمد خيارات الاحتفاظ على حسابك والموديل والاتفاقية. يطلب راصد من OpenAI عدم تخزين Response عبر store:false، لكن ذلك لا يلغي بالضرورة سجلات مكافحة الإساءة. راجع: https://developers.openai.com/api/docs/guides/your-data . تحتفظ Anthropic ببيانات API وفق سياستها التجارية مع استثناءات للسلامة والقانون وبعض الموديلات والاتفاقيات؛ لا يعد راصد بانعدام الاحتفاظ: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data .

## تحديثات البرنامج

تتصل نسخة Windows المجمّعة بـ GitHub ومضيفي ملفات الإصدارات تلقائيًا عند التشغيل وكل 6 ساعات للتحقق من التحديثات، وباختيارك لتحميلها. قد تستقبل هذه الخدمات عنوان IP ومعلومات الاتصال والطلب؛ لا تُرسل قاعدة المشاريع أو الملاحظات أو الفلاتر. ملف التحديث يُحفظ في ذاكرة تخزين مؤقت محلية. التثبيت بطلبك ويعيد تشغيل التطبيق، ولا يحدث بمجرد إغلاقه.

## أمان التخزين والإشعارات

قاعدة البيانات والنسخ الاحتياطية ليست مشفرة على مستوى التطبيق. من يستطيع الوصول إلى حساب Windows أو ملفاتك قد يقرأها. قد تظهر عناوين المشاريع في إشعارات Windows وسجل النظام؛ يمكنك تعطيل التنبيهات والصوت أو استخدام عدم الإزعاج. لا تضع كلمات مرور أو معلومات حساسة في الملاحظات.

## الحذف والنسخ الاحتياطية

من الإعدادات → البيانات تستطيع إنشاء نسخة محلية كاملة للمشاريع والتفاصيل والملاحظات ومسودات العروض والإعدادات والملف المهني واختيارات الموديلات، واستعادتها بعد معاينة وتأكيد وإعادة تشغيل. يمكن تفعيل نسخ يومية أو أسبوعية أثناء تشغيل راصد مع عدد نسخ محفوظة محدود. الملفات غير مشفرة، ولا تتضمن مفاتيح API أو جلسات المتصفح أو رموز ربط الإضافة؛ تظل هذه الأسرار على جهازها الأصلي. الاستعادة تستبدل البيانات وتُنشئ نسخة رجوع قبل التغيير، ولا تعيد إرسال التنبيهات القديمة أو العروض. حذف السجل يحافظ على المحفوظات والملاحظات ومسودات العروض وحالات الاهتمام/التقديم وينشئ نسخة قبل الحذف. إزالة البرنامج لا تحذف بياناته ونسخه تلقائيًا؛ أغلقه من Tray واحذف الملفات بنفسك إذا لم تعد تحتاجها. النسخ التي تحفظها خارج مجلد البيانات وسجل Windows خارج تحكم التطبيق.

## المشاركة الاختيارية

تصدير الإعدادات والنسخ الاحتياطي أو إرسال لقطة شاشة أو سجل للدعم يتم باختيارك. ملف الإعدادات يتضمن الملف المهني ونص القالب والفلاتر واختيارات الموديلات؛ النسخة الكاملة تتضمن أيضًا مشاريعك وملاحظاتك ومسوداتك. هذه الملفات غير مشفرة وقد تكشف بيانات شخصية ومسارات محلية؛ راجعها قبل المشاركة ولا ترسل نسخة كاملة في بلاغ GitHub عام.

---

# Privacy

2026-10-21 · RASED · david atef

## Optional usage analytics

Only a configured build can send limited usage analytics to PostHog US Cloud after explicit settings consent. Sharing starts off; declining never restricts monitoring, notifications or other features. Data includes a random installation identifier, version, language, broad Windows family, daily activity, aggregated monitoring counters and allow-listed feature outcomes. No name, project content or links, proposals, notes, searches, API keys or browser sessions. No screen recording, autocapture or raw crash dumps. Network infrastructure receives the connecting IP; RASED suppresses GeoIP and requires client IP discard in stored project events. The provider is a cloud third party: https://posthog.com/privacy .

## Analytics retention, withdrawal and deletion requests

RASED sets no scheduled expiry or periodic deletion for previously sent analytics; they are retained until the user requests deletion, subject to PostHog storage/deletion policies and applicable legal requirements. This does not guarantee perpetual storage or availability, waive user rights, or remove legal deletion obligations. Deletion requests are reviewed and performed administratively, with verification of asynchronous provider completion. The separate local queue is limited to seven days and 1000 events or 2 MiB of content; offline periods and quota limits can cause losses. These local pending-data limits do not set server retention. Stopping sharing cancels sending and clears pending data, but does not automatically request deletion of previously received server events. The local reference remains available for deletion requests and is excluded from portable backups/settings. Copy it in Settings and contact the developer yourself on WhatsApp +20 120 178 0258 / https://wa.me/201201780258 to request deletion. Opening WhatsApp does not transmit the reference automatically or prove deletion completion. Save the reference and stop sharing before requesting deletion to avoid new events while it is processed; after completion, forget the local reference before enrolling again. Forgetting the local reference is distinct from server deletion. GitHub download counters are aggregate public data, not user identities or unique-user counts.

## Analytics deletion verification status

End-to-end verification of completed event deletion at PostHog is still pending. You can request deletion; completion will not be confirmed before provider verification, and processing may be delayed. Sharing remains optional and can be stopped at any time.

## KAF connections

When enabled, your device contacts kafiil.com directly for public project listings and requested detail pages, without cookies or sign-in. The site receives your IP and request metadata. Titles, excerpts, budgets, skills, platform status, details, duration and raw times are stored locally. KAF data is not sent to AI providers or the Quick Apply extension. Monitoring and alerts can be disabled independently.

## Template and retired browser sessions

Your template, budget position and extra days remain local; optional settings exports include the text. Embedded browsing and sign-in have been removed. On startup this build attempts to delete only the two retired embedded-browser profiles and invalidate their activation tickets. Cleanup failures are diagnosed and retried on a later launch. It does not delete Chrome sessions, projects or settings. The Chrome extension reads and fills the requested project form in your selected profile without submitting it. RASED sends the project URL/ID, template and price/duration settings through Native Messaging and a standalone local helper. Pairing tokens stay on your device: the extension stores its token locally, RASED stores its hash, and a transport secret lives in a user-protected directory. Settings exports exclude pairing keys. Unpairing does not remove Chrome sign-ins. Local preparation history contains state identifiers, never passwords or proposal text.

## Local data

Projects, excerpts, fetched descriptions, read states, bookmarks, notes, filters, settings and diagnostics are stored locally in SQLite and the application data folder. Monitoring requires no RASED account or dedicated backend. The project database and diagnostics are not automatically uploaded to the developer. Separate optional usage analytics are described above.

## External connections

Your device contacts Mostaql directly for RSS and detail pages as needed, the public Khamsat unavailable-service requests listing, and the public Nafezly RSS feed when each source is enabled. Previewing or opening a Nafezly project may also request its public page for budget and duration. Project-card data is cached locally to reduce requests and honors source pause and cooldowns. Each site and network provider may receive your IP address, request timing, connection metadata and User-Agent. Project, request, GitHub and LinkedIn links open in your browser and those sites apply their own policies. RASED does not read your browser session or platform passwords. Khamsat and Nafezly monitoring need no login; Nafezly descriptions supplied in RSS are stored locally.

## Proposal Assistant: Gemini, OpenAI and Claude

Choose Google Gemini, OpenAI or Anthropic Claude directly. After previewing, approving and pressing Generate, your device sends only the selected Mostaql title, available description, category, skills, budget, instructions indicating description completeness, freelancer profile and optional proposal-specific notes to the selected company. Private project notes, other projects and previous drafts are excluded. Drafts, assumptions and questions are stored locally in SQLite with provider/model metadata and can be edited or deleted. No automatic provider fallback or generation during monitoring, startup or project opening. The company may receive your IP, connection data, inputs and outputs. Send only content you are authorized to share.

## How Google handles Gemini data

Under the Gemini API terms, Google uses unpaid-service inputs and outputs to improve its products and technologies, and human reviewers may examine them; Google advises against sending sensitive, confidential or personal information through unpaid services. For paid services associated with an active billing account, Google does not use inputs and outputs to improve its products, but retains limited abuse-prevention logs. Regional exceptions and restrictions apply, including different treatment for the EEA, UK and Switzerland. Review the terms applicable to your account: https://ai.google.dev/gemini-api/terms .

## API keys, costs and verification

Use separate personal keys for each provider, encrypted using Windows protection outside SQLite, exports and logs. Delete each key in Settings. Legacy Gemini migration verifies its replacement before removing the original; deletion removes both paths. This does not protect against software running as your Windows user. Saved does not mean authenticated. Refreshing models explicitly sends authentication and connection data, not projects; catalogs stay local. An explicit generation test sends fictional input and may consume credits or quota. Last-success metadata is local and tied to key/model, not a future access guarantee. No automatic paid retry.

## OpenAI and Anthropic data handling

API policies differ from consumer chat products. Retention depends on account, model and agreement. RASED sets OpenAI store:false to disable response storage, which does not necessarily remove abuse-monitoring logs: https://developers.openai.com/api/docs/guides/your-data . Anthropic applies commercial API retention with safety, legal, model-specific and contractual exceptions; RASED does not promise zero retention: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data .

## Software updates

Packaged Windows builds automatically contact GitHub and release-asset hosts at startup and every 6 hours to check for updates, and on your request to download them. These services may receive your IP and request/connection metadata; projects, notes and filters are not uploaded. Downloads are cached locally. Installation requires your request and restarts the app; merely quitting does not install an update.

## Storage and notifications

The database and backups have no application-level encryption. Someone with access to your Windows account or files may read them. Project titles may appear in Windows notifications and system history. Disable notifications, mute sound or enable DND as needed; do not put passwords or sensitive data in notes.

## Deletion and backups

Settings → Data can create a complete local backup of opportunities, details, notes, proposal drafts, settings, your professional profile and model choices, and restore it after preview, confirmation and restart. Optional daily or weekly copies run while RASED is running with limited retention. Files are unencrypted and exclude API keys, browser sessions and extension pairing tokens; those secrets remain on their original device. Restore replaces data after creating a rollback copy and does not replay old notifications or submissions. History deletion protects bookmarks, notes, drafts and interested/submitted statuses and creates a backup first. Uninstalling does not delete data or backups automatically; quit from the tray and remove files yourself when no longer needed. Copies saved outside the data folder and Windows notification history are outside the application’s control.

## Optional sharing

Settings export, backup, screenshots and diagnostic sharing are optional. Settings files include your professional profile, template, filters and model choices; complete backups also contain projects, notes and drafts. These files are unencrypted and can disclose personal data and local paths. Review them before sharing and never attach a complete private backup to a public GitHub report.
