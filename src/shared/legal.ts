// Offline, versioned product disclosures. No forced consent or license restrictions.
type LegalDocument = { title: string; sections: [string, string][] }
export const LEGAL_DOCUMENTS: Record<'ar'|'en', Record<'terms'|'privacy'|'licenses',LegalDocument>> = {
  ar: {
    terms: {title:'شروط الاستخدام',sections:[
      ['وظيفة البرنامج','راصد أداة محلية لمتابعة خلاصة RSS العامة لمستقل، وتنظيم المشاريع وإظهار التنبيهات. قد يطلب صفحات التفاصيل العامة لإكمال المعلومات. تقديم العروض والتعاقد والدفع يتم بواسطتك على مستقل؛ البرنامج لا يدخل حسابك ولا يرسل عروضًا آلية.'],
      ['علاقة المنصة وحقوق المحتوى','مستقل وحسوب وعلاماتهما ومحتوى المشاريع تخص أصحابها. ظهور محتوى عام أو وجود RSS ليس تصريحًا بإعادة نشره أو بجلب آلي غير محدود. لا تمنح هذه الصفحات إذنًا من المنصة. احترم شروط المصدر والقيود المحلية وحقوق أصحاب المحتوى؛ لا تستخدم راصد لتجاوز الحماية أو جمع معلومات خاصة أو إعادة بيع محتوى المشاريع.'],
      ['استخدام مسؤول','لا تتحايل على حظر أو تحدي حماية، ولا تعدّل البرنامج لإغراق المصدر بطلبات أو إساءة استخدام المنصة. يتبع البرنامج التهدئة عند الرفض والأخطاء. قد تقيّد المنصة الوصول أو تغيّر شروطها. ترخيص الكود لا يعفي مستخدمه أو موزعه من الحصول على أذونات المصدر المطلوبة.'],
      ['الدقة والتنبيهات','المعلومات قد تكون ناقصة أو قديمة، وقد تتأخر التنبيهات أو لا تصل. راجع المشروع الأصلي قبل تقديم عرض أو اتخاذ قرار. لا نضمن الرصد اللحظي أو السبق أو قبول العروض أو استمرار الخدمة.'],
      ['الترخيص والمسؤولية','الكود متاح وفق MIT ونصها الأصلي في قسم الرخص. البرنامج مقدم كما هو، دون ضمانات في الحدود التي يسمح بها القانون؛ لا تُلغى حقوق إلزامية للمستخدم أو مسؤوليات لا يجوز استبعادها. هذه المعلومات لا تحل محل استشارة قانونية ولا تمثل اعتمادًا قانونيًا للبرنامج.'],
      ['التحديث والتواصل','هذه الصياغة تخص الإصدار الحالي ويمكن تحديثها مع تغيير السلوك؛ راجعها عند الترقية. للبلاغات المتعلقة بالكود أو الحقوق استخدم مستودع GitHub أو LinkedIn للمطور. لا تنشر بيانات حساسة في البلاغات العامة.']
    ]},
    privacy: {title:'الخصوصية',sections:[
      ['ما يبقى على جهازك','تُحفظ المشاريع والمقتطفات والوصف المجلوب، حالة القراءة والمحفوظات والملاحظات والفلاتر والإعدادات والسجل التشخيصي محليًا في SQLite ومجلد بيانات التطبيق. لا يوجد حساب راصد أو خادم سحابي أو تحليلات أو رفع آلي لهذه البيانات للمطور في هذا الإصدار.'],
      ['الاتصالات الخارجية','يتصل جهازك مباشرة بمستقل لجلب RSS وصفحات التفاصيل عند الحاجة؛ قد يرى الموقع ومزود الشبكة عنوان IP ووقت الطلب وبيانات الاتصال وUser-Agent. فتح رابط مشروع أو GitHub أو LinkedIn يشغّل متصفحك وتطبق سياسات تلك المواقع. لا يقرأ راصد جلسة المتصفح أو كلمات مرور مستقل.'],
      ['أمان التخزين والإشعارات','قاعدة البيانات والنسخ الاحتياطية ليست مشفرة على مستوى التطبيق. من يستطيع الوصول إلى حساب Windows أو ملفاتك قد يقرأها. قد تظهر عناوين المشاريع في إشعارات Windows وسجل النظام؛ يمكنك تعطيل التنبيهات والصوت أو استخدام عدم الإزعاج. لا تضع كلمات مرور أو معلومات حساسة في الملاحظات.'],
      ['الحذف والنسخ الاحتياطية','من الإعدادات → البيانات تستطيع حذف السجل غير المحمي؛ يحافظ الحذف على المحفوظات والملاحظات وحالات الاهتمام/التقديم وينشئ نسخة احتياطية قبل الحذف. إزالة البرنامج لا تعني حذف بياناته تلقائيًا. للحذف الكامل أغلق راصد من Tray، وافتح مجلد البيانات واحذف ملفاته والنسخ الاحتياطية بنفسك إذا لم تعد تحتاجها؛ قد يبقى سجل إشعارات Windows أو نسخ النظام الاحتياطية خارج تحكم التطبيق.'],
      ['المشاركة الاختيارية','تصدير الإعدادات أو إرسال لقطة شاشة أو سجل للدعم يتم باختيارك، وقد يكشف فلاترك أو عناوين المشاريع أو مسارات ملفات محلية. راجع الملف وأخفِ المعلومات الخاصة قبل مشاركته. بلاغات GitHub عامة؛ لا ترسل معلومات حساسة فيها.']
    ]},
    licenses: {title:'الرخص والحقوق',sections:[
      ['الكود والمحتوى','MIT تخص كود راصد وتسمح باستخدامه وتعديله وتوزيعه مع حفظ إشعار الحقوق والنص. لا تنقل إليك ملكية محتوى مستقل أو تمنح موافقته على الجلب، ولا تجعل راصد منتجًا رسميًا للمنصة.'],
      ['المكونات','تُرفق نصوص رخص مكونات JavaScript والخطوط أدناه؛ توزيع Electron يضم LICENSE.electron.txt وLICENSES.chromium.html للمكونات المدمجة. احتفظ بهذه الإشعارات عند التوزيع. شعار راصد المتجهي مرفق ضمن ملفات المشروع؛ لا نؤكد تسجيله علامة تجارية.']
    ]}
  },
  en: {
    terms: {title:'Terms of use',sections:[
      ['Purpose','RASED is a local tool for following the public Mostaql RSS feed, organizing projects and showing alerts. It may fetch public detail pages to complete information. You submit proposals, contract and pay on Mostaql yourself. RASED does not access your account or submit automated proposals.'],
      ['Platform and content rights','Mostaql, Hsoub, their marks and project content belong to their respective owners. Public availability or an RSS feed does not establish permission for republication or unrestricted automated access. These documents do not grant platform permission. Respect source terms, applicable law and content rights; do not bypass protection, collect private information or resell project content.'],
      ['Responsible use','Do not evade blocks or challenges, flood the source, or abuse the platform. The application applies backoff on rejection and errors. The platform may restrict access or change its terms. The code license does not replace source permissions required by users or distributors.'],
      ['Accuracy and alerts','Information may be incomplete or stale and alerts may be delayed or missed. Check the original project before submitting a proposal or making decisions. Instant discovery, priority over competitors, successful proposals and continued availability are not guaranteed.'],
      ['License and liability','The software is provided under MIT, reproduced in Licenses. It is provided as is, without warranties to the extent permitted by law; mandatory consumer rights and liabilities that cannot legally be excluded remain unaffected. These disclosures are not legal advice or certification of compliance.'],
      ['Updates and contact','These disclosures describe the current version and may change with its behavior; review them after upgrades. Contact the developer through the GitHub repository or LinkedIn for code or rights concerns. Do not post sensitive information in public reports.']
    ]},
    privacy: {title:'Privacy',sections:[
      ['Local data','Projects, excerpts, fetched descriptions, read states, bookmarks, notes, filters, settings and diagnostics are stored locally in SQLite and the application data folder. This version has no RASED account, cloud backend, analytics or automatic upload of this data to the developer.'],
      ['External connections','Your device contacts Mostaql directly for RSS and detail pages as needed. The site and network providers may receive your IP address, request timing, connection metadata and User-Agent. Project, GitHub and LinkedIn links open in your browser and those sites apply their own policies. RASED does not read your browser session or Mostaql password.'],
      ['Storage and notifications','The database and backups have no application-level encryption. Someone with access to your Windows account or files may read them. Project titles may appear in Windows notifications and system history. Disable notifications, mute sound or enable DND as needed; do not put passwords or sensitive data in notes.'],
      ['Deletion and backups','Settings → Data can purge unprotected history; bookmarked/noted projects and interested/submitted statuses are retained, and a backup is created before deletion. Uninstalling does not automatically delete application data. For full removal, quit RASED from the tray, open its data folder and delete its files and backups yourself if no longer needed. Windows notification history and system backups are outside the application’s control.'],
      ['Optional sharing','Exporting settings or sending screenshots or diagnostics is your choice and may disclose filters, project titles or local file paths. Review and redact files before sharing. GitHub reports are public; do not include sensitive information.']
    ]},
    licenses: {title:'Licenses & rights',sections:[
      ['Software versus content','MIT covers RASED code and allows use, modification and distribution with its copyright and license notice. It does not grant ownership of Mostaql content or permission to collect it, and does not imply endorsement.'],
      ['Components','JavaScript and font license texts are included below. Electron distributions also carry LICENSE.electron.txt and LICENSES.chromium.html for bundled components. Preserve these notices when distributing. The project includes its compass SVG; no registered trademark claim is made.']
    ]}
  }
}
