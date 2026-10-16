# RASED 0.8.0

This release improves data protection, independent platform monitoring, project metadata and Windows notifications across the four existing sources.

## الجديد للمستخدم

- **مصدر الإشعار:** عنوان إشعار المشروع الفردي يبدأ باسم المنصة، مثل «مستقل — عنوان المشروع»، بالعربية أو الإنجليزية حسب لغة راصد.
- **حماية بياناتك:** نسخة كاملة للمشاريع والتفاصيل والملاحظات والمحفوظات والمسودات والإعدادات، بمعاينة قبل الاستعادة ونسخة رجوع. نسخ يومي أو أسبوعي اختياري، وتحسين نقل الإعدادات واسترداد قاعدة بيانات تالفة.
- **إدارة المنصات:** تحكم مستقل في التفعيل المحفوظ والإيقاف المؤقت وكتم التنبيهات للمنصات الأربع. حالة أوضح للأخطاء والتهدئة، وآخر فحص واكتشاف وموعد المحاولة التالية، وتقرير حالة محلي قابل للنسخ.
- **فجوات الرصد:** تحذير احتياطي للفترات غير المكتملة، مع تجميعه في شريط مختصر قابل للتوسيع وإخفاء تحذير كل منصة بشكل مستقل. كاف يوضح استرجاع الصفحات القديمة عند الحاجة.
- **معلومات المشروع:** إصلاح عرض وجلب الميزانية ومدة التنفيذ في المعاينة والتفاصيل لمستقل ونفذلي وكاف، مع تحديث يدوي وحالات تحميل وفشل واضحة. خمسات يوضح أن مصدر القائمة الحالي لا يوفر هذه البيانات.
- **هوية Windows:** فصل هوية نسخة التطوير عن النسخة المثبّتة، وتصحيح بيانات أيقونة وإعادة فتح النافذة ومعالجة اختصارات التطوير القديمة المتعارضة.
- **التقديم السريع:** معالجة تعلّق تجهيز العرض على «فتح المشروع» عندما تكتمل صفحة Chrome بسرعة قبل انتهاء خطوات فتحها؛ تبقى مراجعة العرض وإرساله مسؤولية المستخدم.
- **عن راصد:** تعريف أوضح بـ david atef بصفته مؤسس ومطوّر التطبيق، وقصة المشروع وروابط تطوره والملاحظات.

## Data and workflow boundaries

Backups are local and unencrypted. They include professional/profile text, notes and drafts; store them privately. API keys, browser sessions and pairing credentials do not transfer. Restoring replaces the archive after confirmation and creates a rollback copy; Quick Apply is disabled for review on the restored device.

There are no new platforms in this update. AI proposals remain Mostaql-only; Quick Apply remains Mostaql/Nafezly-only and never submits an offer. Platform request spacing and stored cooldowns still apply. A historical warning does not mean current monitoring is stopped, nor does it prove a project was lost.

## Installation and validation

حمّل **RASED-Setup-0.8.0.exe** من قسم **Assets** أو حدّث من **الإعدادات ← تحديثات راصد ← تحميل ← إعادة التشغيل والتحديث** إذا كانت نسختك 0.2.5 أو أحدث. لا تحذف مجلد بيانات التطبيق. لا يحتاج المستخدم Node.js أو SQLite. المثبّت يدعم Windows x64 وغير موقّع؛ قارِن SHA256 بملف **SHA256SUMS.txt** المرفق.

Download **RASED-Setup-0.8.0.exe** or use **Settings → RASED updates → Download → Restart and update** on 0.2.5+. Keep the existing app-data directory. For the Quick Apply fix, use **Prepare/repair extension files** in its settings and reload the unpacked extension in Chrome. Pairing and final review/submission remain manual.

Release-preparation checks passed: TypeScript, ESLint, 259 unit tests, 85 general Electron checks, 36 backup/restore checks, 54 monitoring checks, 18 project-metadata checks, 32 AI checks, 23 Quick Apply setup checks, 18 KAF checks and 29 real Chromium/native-host checks. UI checks cover 32 language/theme/window/text-scale combinations and editing/keyboard guards. The versioned 0.8.0 packaged app passed the 85 general, 36 backup/restore, 18 KAF and 18 metadata checks in fresh profiles.

Installer size: 137,878,355 bytes (about 138 MB). SHA256: `3DFC214A20A37C54A74A57A8C087743B0FEF280516D4ED4774F82236CAA73010`. Update metadata includes the matching size/SHA512 and blockmap; packaged contents exclude internal plans, research and user databases.

An isolated NSIS test application successfully installed, downloaded and verified an update, upgraded, relaunched and preserved its SQLite note, then was uninstalled. This does not replace testing a RASED upgrade on every supported machine. Native Windows properties verified branded icon metadata for both app windows. Installer metadata/checksums and packaged resources are checked before publication.

Platform/provider content and most OS interactions use fixtures. These checks do not certify live platform availability, provider credentials, physical Windows toast clicks, the rendered Explorer icon cache or every desktop configuration. The installer remains unsigned.

[Backup and restore](BACKUP_AND_RESTORE.md) · [Monitoring health](MONITORING_HEALTH.md) · [Project details](PROJECT_DETAILS.md) · [Privacy](../PRIVACY.md) · [Terms](../TERMS.md).
