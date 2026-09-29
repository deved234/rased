# الخصوصية

2026-09-29 · RASED · david atef

## ما يبقى على جهازك

تُحفظ المشاريع والمقتطفات والوصف المجلوب، حالة القراءة والمحفوظات والملاحظات والفلاتر والإعدادات والسجل التشخيصي محليًا في SQLite ومجلد بيانات التطبيق. لا يوجد حساب راصد أو خادم سحابي أو تحليلات أو رفع آلي لهذه البيانات للمطور في هذا الإصدار.

## الاتصالات الخارجية

يتصل جهازك مباشرة بمستقل لجلب RSS وصفحات التفاصيل عند الحاجة، وبصفحة طلبات الخدمات غير الموجودة العامة في خمسات، وبخلاصة RSS العامة لنفذلي عند تفعيل رصده. قد يرى كل موقع ومزود الشبكة عنوان IP ووقت الطلب وبيانات الاتصال وUser-Agent. فتح رابط طلب أو مشروع أو GitHub أو LinkedIn يشغّل متصفحك وتطبق سياسات تلك المواقع. لا يقرأ راصد جلسة المتصفح أو كلمات مرور المنصات. رصد خمسات ونفذلي لا يحتاج تسجيل دخول؛ وصف نفذلي الكامل الوارد في RSS يُحفظ محليًا.

## مساعد العروض وGemini

ميزة مساعد العروض الاختيارية لا تجري طلبًا عند الرصد أو فتح المشروع. بعد معاينة البيانات وتحديد الموافقة والضغط على «توليد» فقط، يرسل جهازك مباشرة إلى Google Gemini عنوان المشروع ووصفه المتاح ومصدر اكتماله وتصنيفه ومهاراته وميزانيته وبيانات الملف المهني التي تحفظها ونصًا إضافيًا تكتبه لهذا العرض. لا تُرسل ملاحظتك الشخصية المحفوظة على المشروع تلقائيًا. يعود رد بمسودة وافتراضات وأسئلة وتُحفظ المسودة محليًا في SQLite، ويمكنك تعديلها أو حذفها. قد يصل Google عنوان IP وبيانات الطلب والمدخلات والمخرجات. لا ترسل معلومات سرية أو شخصية إلا إذا كنت مخولًا بمشاركتها. الميزة متاحة بدءًا من 0.3.0.

## كيفية تعامل Google مع بيانات Gemini

وفق شروط Gemini API، تستخدم Google مدخلات ومخرجات الخدمات غير المدفوعة لتحسين منتجاتها وتقنياتها، وقد يطلع عليها مراجعون بشريون؛ وتنصح Google بعدم إرسال معلومات حساسة أو سرية أو شخصية عبرها. في الخدمات المدفوعة المرتبطة بحساب فوترة نشط لا تستخدم Google المدخلات والمخرجات لتحسين منتجاتها، لكنها تحتفظ بسجلات محدودة لمنع إساءة الاستخدام. توجد استثناءات وقيود إقليمية، ومنها ترتيبات مختلفة للمنطقة الاقتصادية الأوروبية والمملكة المتحدة وسويسرا. راجع الشروط السارية على حسابك قبل الاستخدام: https://ai.google.dev/gemini-api/terms .

## مفتاح Gemini والتكلفة

يضع المستخدم مفتاح Gemini الخاص به؛ لا يقدّم راصد مفتاحًا مشتركًا. يُخزن المفتاح مشفرًا محليًا باستخدام حماية Windows، منفصلًا عن قاعدة المشاريع وملفات تصدير الإعدادات، ويمكن حذفه. هذا لا يحميه من برامج تعمل بنفس حساب Windows. الاستخدام والحصص وأي رسوم تحددها Google وخطة حسابك. لا يُضمّن المفتاح في المسودات أو السجلات أو ملفات الدعم.

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

2026-09-29 · RASED · david atef

## Local data

Projects, excerpts, fetched descriptions, read states, bookmarks, notes, filters, settings and diagnostics are stored locally in SQLite and the application data folder. This version has no RASED account, cloud backend, analytics or automatic upload of this data to the developer.

## External connections

Your device contacts Mostaql directly for RSS and detail pages as needed, the public Khamsat unavailable-service requests listing, and the public Nafezly RSS feed when each source is enabled. Each site and network provider may receive your IP address, request timing, connection metadata and User-Agent. Project, request, GitHub and LinkedIn links open in your browser and those sites apply their own policies. RASED does not read your browser session or platform passwords. Khamsat and Nafezly monitoring need no login; Nafezly descriptions supplied in RSS are stored locally.

## Proposal Assistant and Gemini

The optional Proposal Assistant makes no AI request while watching or merely opening a project. Only after you preview data, check consent and press Generate does your device send the project title, available description and completeness, category, skills, budget, saved freelancer profile and any notes entered for this proposal directly to Google Gemini. Your saved private project note is not included automatically. Gemini returns a draft, assumptions and questions; the draft is stored in local SQLite and can be edited or deleted. Google may receive your IP address, request metadata, input and output content. Do not include personal or confidential information unless authorized. This feature is available from 0.3.0.

## How Google handles Gemini data

Under the Gemini API terms, Google uses unpaid-service inputs and outputs to improve its products and technologies, and human reviewers may examine them; Google advises against sending sensitive, confidential or personal information through unpaid services. For paid services associated with an active billing account, Google does not use inputs and outputs to improve its products, but retains limited abuse-prevention logs. Regional exceptions and restrictions apply, including different treatment for the EEA, UK and Switzerland. Review the terms applicable to your account: https://ai.google.dev/gemini-api/terms .

## Gemini key and cost

Users provide their own Gemini key; RASED supplies no shared key. The key is stored locally with Windows-backed encryption, outside the project database and settings exports, and can be deleted. This does not protect it from software running as the same Windows user. Google and your account tier determine quotas and any charges. The key is not included in drafts, logs or support files.

## Software updates

Packaged Windows builds automatically contact GitHub and release-asset hosts at startup and every 6 hours to check for updates, and on your request to download them. These services may receive your IP and request/connection metadata; projects, notes and filters are not uploaded. Downloads are cached locally. Installation requires your request and restarts the app; merely quitting does not install an update.

## Storage and notifications

The database and backups have no application-level encryption. Someone with access to your Windows account or files may read them. Project titles may appear in Windows notifications and system history. Disable notifications, mute sound or enable DND as needed; do not put passwords or sensitive data in notes.

## Deletion and backups

Settings → Data can purge unprotected history; bookmarked/noted projects, proposal drafts and interested/submitted statuses are retained, and a backup is created before deletion. Uninstalling does not automatically delete application data. For full removal, quit RASED from the tray, open its data folder and delete its files and backups yourself if no longer needed. Windows notification history and system backups are outside the application’s control.

## Optional sharing

Exporting settings or sending screenshots or diagnostics is your choice and may disclose filters, project titles or local file paths. Review and redact files before sharing. GitHub reports are public; do not include sensitive information.
