# RASED 0.8.1

This patch fixes Windows notification activation and improves opening the default browser after an explicit project click.

## الجديد للمستخدم

- الضغط على إشعار المشروع أو «عرض المشروع» يفتح رابطه الأصلي في المتصفح الافتراضي، مع طلب إظهار نافذة المتصفح قبل فتح الرابط عندما يمكن تحديدها بأمان.
- الإشعارات الجديدة تحتفظ بوجهتها محليًا لمدة سبعة أيام، حتى بعد خروج راصد أو إعادة تشغيله أو حذف المشروع من السجل. التشغيل من الإشعار يبقي نافذة راصد مخفية.
- منع تكرار فتح الرابط أثناء تسليم الإشعار بين العمليات. إذا منع Windows إظهار المتصفح، لا يُفتح تبويب إضافي لمحاولة التركيز مجددًا.
- إصلاح شاشة الترحيب الخاصة بـ Electron عند الضغط على الإشعار من نسخة التطوير، بما يشمل تسجيل اختصارات التطوير القديمة لنفس التطبيق.
- عزل تذاكر الإشعارات عن النسخ الاحتياطية والاستعادة، مع استمرار دعم نسخ قاعدة البيانات من الإصدار السابق.

## Installation

حمّل **RASED-Setup-0.8.1.exe** من **Assets**، أو استخدم **الإعدادات ← تحديثات راصد ← البحث عن تحديث ← تحميل ← إعادة التشغيل والتحديث** على إصدار 0.2.5 أو أحدث. احتفظ ببيانات التطبيق؛ لا تحتاج إعادة تثبيت إضافة Chrome لهذا الإصلاح. جرّب إشعارًا جديدًا بعد التحديث؛ الإشعارات القديمة تحتفظ بطريقة فتحها الأصلية.

Download **RASED-Setup-0.8.1.exe**, or update from Settings on 0.2.5+. Windows x64; no separate Node.js or SQLite installation. The installer is unsigned. Verify its SHA256 against **SHA256SUMS.txt** in the release assets.

## Behavior and limits

Windows may still deny foreground activation, especially with exclusive fullscreen applications, different privilege levels or several browser windows/profiles. Successful URL delivery is distinct from confirmed foreground focus. RASED does not change Windows focus settings, simulate keystrokes or inspect browser content/cookies. Quick Apply remains Mostaql/Nafezly-only and never submits an offer.

There is no analytics collection in this release. Notification destinations stay local and expire after seven days. Portable backups omit activation tickets. Existing project data, notes, settings and API keys remain in the same local profile.

## Validation

TypeScript, ESLint and 283 unit tests passed. Source-build integration passed 85 general checks and 11 notification lifecycle checks. An isolated native Windows COM regression passed 11 checks, including stale development registrations, running-app handoff and cold source startup without Electron's welcome screen. Actual notification clicks were also manually confirmed on the development machine; fixture tests alone do not certify foreground behavior on every desktop.

The final 0.8.1 packaged application passed 85 general, 11 notification lifecycle and 36 backup/restore checks in fresh temporary profiles. Its bundled Windows binding loaded successfully and called `user32.dll`. The installer, SHA512 update metadata and blockmap agree; the package excludes internal reports, plans and user databases. Chrome extension/native-host assets match their built source outputs.

Installer: 138,364,760 bytes (about 138 MB). SHA256: `108EA81E6EF3407FB94AFCF3E05C4B2D790B4B5717A06DF59B2DD5A75FFC4B6D`. These packaged checks do not claim a fresh physical notification click on every installed Windows configuration or a new NSIS upgrade-cycle test.

[Notification behavior](NOTIFICATIONS.md) · [Update guide](UPDATES.md) · [Privacy](../PRIVACY.md) · [Changelog](../CHANGELOG.md).
