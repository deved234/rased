# الخصوصية

2026-10-09 · RASED · david atef

## قالب التقديم السريع وإزالة الجلسات القديمة

نص العرض ونسبة السعر والأيام الإضافية محفوظة محليًا، والتصدير الاختياري يحتوي النص. أُزيل المتصفح الداخلي وتسجيل الدخول داخله. عند بدء هذه النسخة يحاول راصد حذف مجلدي جلسات المتصفح الداخلي السابقين فقط وإبطال تذاكر تقديمه القديمة؛ يسجل التشخيص إذا فشل الحذف لإعادة المحاولة عند تشغيل لاحق. لا يحذف جلسات Chrome أو مشاريعك أو إعداداتك. تقرأ إضافة Chrome نموذج المشروع المطلوب في بروفايل تختاره وتعبئه بناءً على قالبك، دون إرسال العرض. يرسل راصد عنوان المشروع ومعرّفه والقالب وإعدادات السعر والمدة إلى الإضافة عبر Native Messaging وملف ربط محلي مستقل. رموز الربط محفوظة في جهازك: الرمز في تخزين الإضافة المحلي وبصمته في قاعدة راصد؛ سر النقل في مجلد محمي للمستخدم. لا تُصدّر مفاتيح الربط مع الإعدادات. الإلغاء لا يزيل تسجيل دخول Chrome. السجل المحلي يتضمن معرّفات حالات التجهيز، دون نص القالب أو كلمات المرور.

## ما يبقى على جهازك

تُحفظ المشاريع والمقتطفات والوصف المجلوب، حالة القراءة والمحفوظات والملاحظات والفلاتر والإعدادات والسجل التشخيصي محليًا في SQLite ومجلد بيانات التطبيق. لا يوجد حساب راصد أو خادم سحابي أو تحليلات أو رفع آلي لهذه البيانات للمطور في هذا الإصدار.

## الاتصالات الخارجية

يتصل جهازك مباشرة بمستقل لجلب RSS وصفحات التفاصيل عند الحاجة، وبصفحة طلبات الخدمات غير الموجودة العامة في خمسات، وبخلاصة RSS العامة لنفذلي عند تفعيل رصده. قد يرى كل موقع ومزود الشبكة عنوان IP ووقت الطلب وبيانات الاتصال وUser-Agent. فتح رابط طلب أو مشروع أو GitHub أو LinkedIn يشغّل متصفحك وتطبق سياسات تلك المواقع. لا يقرأ راصد جلسة المتصفح أو كلمات مرور المنصات. رصد خمسات ونفذلي لا يحتاج تسجيل دخول؛ وصف نفذلي الكامل الوارد في RSS يُحفظ محليًا.

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

من الإعدادات → البيانات تستطيع حذف السجل غير المحمي؛ يحافظ الحذف على المحفوظات والملاحظات ومسودات العروض وحالات الاهتمام/التقديم وينشئ نسخة احتياطية قبل الحذف. إزالة البرنامج لا تعني حذف بياناته تلقائيًا. للحذف الكامل أغلق راصد من Tray، وافتح مجلد البيانات واحذف ملفاته والنسخ الاحتياطية بنفسك إذا لم تعد تحتاجها؛ قد يبقى سجل إشعارات Windows أو نسخ النظام الاحتياطية خارج تحكم التطبيق.

## المشاركة الاختيارية

تصدير الإعدادات أو إرسال لقطة شاشة أو سجل للدعم يتم باختيارك، وقد يكشف فلاترك أو عناوين المشاريع أو مسارات ملفات محلية. راجع الملف وأخفِ المعلومات الخاصة قبل مشاركته. بلاغات GitHub عامة؛ لا ترسل معلومات حساسة فيها.

---

# Privacy

2026-10-09 · RASED · david atef

## Template and retired browser sessions

Your template, budget position and extra days remain local; optional settings exports include the text. Embedded browsing and sign-in have been removed. On startup this build attempts to delete only the two retired embedded-browser profiles and invalidate their activation tickets. Cleanup failures are diagnosed and retried on a later launch. It does not delete Chrome sessions, projects or settings. The Chrome extension reads and fills the requested project form in your selected profile without submitting it. RASED sends the project URL/ID, template and price/duration settings through Native Messaging and a standalone local helper. Pairing tokens stay on your device: the extension stores its token locally, RASED stores its hash, and a transport secret lives in a user-protected directory. Settings exports exclude pairing keys. Unpairing does not remove Chrome sign-ins. Local preparation history contains state identifiers, never passwords or proposal text.

## Local data

Projects, excerpts, fetched descriptions, read states, bookmarks, notes, filters, settings and diagnostics are stored locally in SQLite and the application data folder. This version has no RASED account, cloud backend, analytics or automatic upload of this data to the developer.

## External connections

Your device contacts Mostaql directly for RSS and detail pages as needed, the public Khamsat unavailable-service requests listing, and the public Nafezly RSS feed when each source is enabled. Each site and network provider may receive your IP address, request timing, connection metadata and User-Agent. Project, request, GitHub and LinkedIn links open in your browser and those sites apply their own policies. RASED does not read your browser session or platform passwords. Khamsat and Nafezly monitoring need no login; Nafezly descriptions supplied in RSS are stored locally.

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

Settings → Data can purge unprotected history; bookmarked/noted projects, proposal drafts and interested/submitted statuses are retained, and a backup is created before deletion. Uninstalling does not automatically delete application data. For full removal, quit RASED from the tray, open its data folder and delete its files and backups yourself if no longer needed. Windows notification history and system backups are outside the application’s control.

## Optional sharing

Exporting settings or sending screenshots or diagnostics is your choice and may disclose filters, project titles or local file paths. Review and redact files before sharing. GitHub reports are public; do not include sensitive information.
