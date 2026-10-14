# RASED 0.7.0

أصبح كاف (كفيل سابقًا) المصدر الرابع في راصد، بجانب مستقل ونفذلي وخمسات. يعمل الرصد محليًا دون حساب منصة أو متصفح داخلي.

## الجديد

- رصد قائمة مشاريع كاف العامة كل 5–6 ثوانٍ تقريبًا في الاتصال السليم. أول فحص صامت، والتنبيهات للمشاريع المفتوحة المكتشفة لاحقًا حسب الكلمات وعدم الإزعاج.
- إيقاف وتعطيل وكتم مستقل لكاف من الواجهة والإعدادات وTray، مع تهدئة محفوظة عند أخطاء الوصول و`Retry-After`.
- بطاقات بمعرفة الميزانية والمهارات وحالة المنصة، ومعاينة وتفاصيل كاملة عند الطلب تشمل المجال والمدة. النص المحفوظ يظل متاحًا عند فشل تحديثه.
- متابعة الدفعات الكبيرة على مراحل بحد ثلاث صفحات للدورة، ومنع التكرار وإشعارات التاريخ القديم. حالة المنصة مستقلة عن «مهتم/قدمت» الشخصية.
- تكامل عربي/إنجليزي مع الفلاتر المحفوظة والمصغرة والإشعارات. رابط المشروع والإشعار يفتحان المتصفح الافتراضي.
- تحديث الخصوصية والشروط والأدلة واختبارات أربع منصات. وقت كاف الخام لا يتحول إلى UTC بلا منطقة زمنية مؤكدة.

## التحميل والتحديث

حمّل **RASED-Setup-0.7.0.exe** على Windows x64، أو استخدم **الإعدادات ← تحديثات راصد ← تحميل ← إعادة التشغيل والتحديث** إذا كانت نسختك 0.2.5 أو أحدث. أصحاب النسخ الأقدم يحتاجون المثبت يدويًا. لا تحتاج تثبيت Node.js أو SQLite. المثبت غير موقّع؛ قارِن SHA256 بملف **SHA256SUMS.txt**.

مساعد العروض ما زال لمستقل، والتقديم السريع لمستقل ونفذلي فقط. كاف وخمسات غير مشمولين بالتقديم السريع. الإضافة المحلية تحتاج Reload في Chrome عندما تتغير ملفاتها؛ تجهيز نموذج لا يرسل عرضًا.

[دليل كاف](https://github.com/deved234/rased/blob/v0.7.0/docs/KAF.md) · [الواجهة](https://github.com/deved234/rased/blob/v0.7.0/docs/INTERFACE.md) · [الخصوصية](https://github.com/deved234/rased/blob/v0.7.0/PRIVACY.md).

## Verification and limits

KAF is a fourth read-only public source, with independent controls, bounded pagination, persisted backoff, silent baseline/recovery, keyword alerts and on-demand cached descriptions. Existing Mostaql, Nafezly and Khamsat workflows remain available.

- TypeScript, ESLint and 203 unit tests passed. KAF integration verifies 17 assertions through real Electron/preload/SQLite/React with synthetic network and OS boundaries.
- General Electron integration covers 82 assertions; AI covers 32 and Chrome setup/Quick Apply covers 23. UI checks cover four sources and 32 Arabic/English, dark/light, window-size/text-scale combinations.
- The packaged Windows application passed the 82 general and 17 KAF integration assertions in isolated profiles; these tests never use real accounts or submit offers. The installer is 137,855,585 bytes (about 138 MB), with matching SHA512 update metadata.
- Live anonymous KAF reads verified ten list entries and actual project description, category and duration. No live publication-to-alert latency or physical Windows toast click was measured.
- HTML structure can change; access errors trigger backoff rather than protection bypass. Catch-up is bounded and cannot guarantee the complete site history.
- Source availability, network, platform publication delays and Windows notification settings affect discovery. Instant alerts or being first to apply are not guaranteed.
- Settings export is not a full backup of notes/projects/drafts. The broader product-review proposals are not included in this release.

[Chrome guide](https://github.com/deved234/rased/blob/v0.7.0/docs/QUICK_APPLY.md) · [AI guide](https://github.com/deved234/rased/blob/v0.7.0/docs/AI_ASSISTANT.md) · [Terms](https://github.com/deved234/rased/blob/v0.7.0/TERMS.md) · [MIT](https://github.com/deved234/rased/blob/v0.7.0/LICENSE).
