# RASED 0.9.0

Expanded local search across all four monitored platforms, with isolated search/indexing processes and more resilient startup and live results.

## الجديد للمستخدم

- البحث يشمل العنوان والمقتطف والمهارات والوصف الكامل المحفوظ محليًا، مع دعم أفضل للعربية والأرقام وUnicode. البحث حرفي؛ لا يجلب كل صفحات المشاريع من الإنترنت.
- خياران مستقلان للبحث في ملاحظاتك ومسودات عروضك، مغلقان افتراضيًا، مع توضيح الحقل الذي طابق البحث. لا تُنشأ نسخ مفهرسة دائمة من النصوص الشخصية.
- تحديث النتائج بعد تعديل التفاصيل أو الملاحظات أو المسودات، مع الحفاظ على الفرص الجديدة المؤجلة ونافذة التصفح. فشل البحث يظهر رسالة وإعادة محاولة بدل قائمة فارغة مضللة.
- عزل استعلامات البحث وبناء الفهرس عن عملية الرصد الأساسية، وتحسين التعامل مع الكتابة العربية المركبة والطلبات المتلاحقة.
- تحسين بدء Windows عند تعارض مؤقت في ملفات SQLite، مع الحفاظ على البيانات وإظهار فشل واضح إذا تعذر البدء.

## Installation and data

حمّل **RASED-Setup-0.9.0.exe** من **Assets**، أو استخدم **الإعدادات ← تحديثات راصد ← البحث عن تحديث ← تحميل ← إعادة التشغيل والتحديث** على إصدار 0.2.5 أو أحدث. لا تحتاج Node.js أو SQLite، ولا إعادة تركيب إضافة Chrome لهذا التحديث.

Windows x64; the installer is unsigned. Compare its SHA256 with **SHA256SUMS.txt** in the release assets. Existing projects, notes, settings and encrypted API keys remain in the local profile. Database schema 10 builds disposable public search indexes in the background; schema-8/9 portable backups remain supported. Keep a pre-upgrade backup if you may revert: an older executable cannot safely open the upgraded database.

## Analytics remains disabled

This release includes optional analytics infrastructure and its settings, but **production application-usage collection is disabled** and the installer contains no ingest token. The public-download operations workflow also remains disabled. Requested-person cloud-event deletion still awaits completion verification; publishing this release does not bypass that gate. See [Analytics](ANALYTICS.md).

## Known performance limits

On a synthetic 50,000-project archive on the development machine, the general page measured about **199ms p95**, notes search **328ms p95**, and the first cold text search **3.1 seconds**. These exceed internal targets. Index-write transactions also did not consistently meet the 8ms target. Further tuning is deferred with the maintainer's approval; these are measured limitations, not completed performance goals.

Input-to-results measured **511ms p95**, including a 300ms debounce. A fixture stress run did not show increased p95 notification-dispatch delay; it does not measure publication-to-discovery, actual Windows toast arrival or behavior on every device. Search speed and memory depend on the archive, hardware and indexing state.

## Validation

TypeScript, ESLint and **362 unit tests across 41 files** passed. The final packaged application passed **85 general integration checks, 18 search checks, 36 backup/restore checks, 54 monitoring checks and 11 notification-activation checks**, using real Electron/preload/SQLite and fresh temporary profiles. The package audit found the required search/telemetry workers, no ingest token in the main bundle and no internal plans, tests, scripts or user databases in ASAR.

Source-build verification also covers synthetic telemetry transport/consent/lifecycle, native Windows WAL startup, AI wiring and the extension setup. No user database or live platform account is used for these checks. Automated notification fixtures do not replace a physical Windows click test on every configuration.

The source suites passed 20 telemetry-worker, 49 telemetry-consent and 10 lifecycle assertions, three startup scenarios, 32 AI checks, 27 Quick Apply setup checks, 18 KAF checks, 18 project-facts checks, responsive UI checks and 29 real Chrome/extension/native-host checks with zero offer submissions. A separate uniquely branded QA app completed a real NSIS update download, checksum verification, installation and relaunch while preserving its SQLite note, then uninstalled. That cycle uses the shared update controller, not the user's installed RASED profile, and does not certify every production upgrade or Windows configuration.

Installer: **138,387,400 bytes**. SHA256: `F5B8F53D59F79BF8AF07A5629DE445235FDCEA0E84DA5965C264C1917755A133`. Update metadata and the blockmap are distributed alongside the installer; users should download only the installer for manual installation.

[Search guide](PROJECT_SEARCH.md) · [Backup and restore](BACKUP_AND_RESTORE.md) · [Update guide](UPDATES.md) · [Privacy](../PRIVACY.md) · [Changelog](../CHANGELOG.md).
