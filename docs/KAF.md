# رصد كاف · KAF monitoring

إضافة كاف (كفيل سابقًا، `kafiil.com`) متاحة بدءًا من إصدار راصد 0.7.0.

## الاستخدام

اختر **كاف** من قائمة المصادر، أو اترك **كل المصادر**. من الإعدادات → الرصد يمكن تعطيل كاف أو إيقافه مؤقتًا دون إيقاف مستقل أو خمسات أو نفذلي. الإيقاف المؤقت يزول بعد إعادة التشغيل، والتعطيل محفوظ.

يفحص راصد القائمة العامة دون حساب أو إضافة Chrome كل 5–6 ثوانٍ تقريبًا أثناء الاتصال السليم. أول فحص يحفظ الموجود بصمت. التنبيهات للفرص المفتوحة المكتشفة لاحقًا فقط، ويمكن تخصيص كلمات العنوان والمقتطف وكتم كاف من إعدادات التنبيهات أو Tray. عدم الإزعاج العام يظل نافذًا.

تُعرض حالة المنصة والميزانية والمهارات والمقتطف كما وردت من الموقع. حالة «مكتمل» مستقلة عن حالتك الشخصية مثل «مهتم» أو «قدمت». المعاينة تعرض المقتطف، والتفاصيل الكاملة تُجلب عند فتح صفحة المشروع في راصد. يُحفظ الوصف محليًا لمدة 24 ساعة؛ عند فشل تحديثه يبقى النص المحفوظ متاحًا. النقر على «فتح على كاف» أو الإشعار يفتح المشروع في المتصفح الافتراضي.

## الحدود

- كاف غير مشمول بمساعد العروض أو التقديم السريع.
- وقت القائمة نسبي؛ تاريخ التفاصيل بلا منطقة زمنية مؤكدة. يعرض راصد وقت الرصد والوقت الخام، ولا يختلق وقت نشر UTC.
- الاكتشاف يعني ظهور المشروع في القائمة العامة؛ لا يثبت وقت إنشائه أو السبق على المنافسين.
- الدفعات الكبيرة تُسترجع بحد ثلاث صفحات في الدورة، مع حفظ نقطة المتابعة. الفرص المسترجعة بعد الانقطاع صامتة. لا ضمان باسترجاع تاريخ الموقع كله.
- عند أخطاء الشبكة أو 403/429 أو صفحات الحماية يُطبق تأخير متزايد و`Retry-After`؛ التهدئة تبقى بعد إعادة التشغيل. لا تستخدم الجلسات أو تجاوز الحماية.
- طريقة القراءة تعتمد على HTML الموقع الحالي، وليست API رسمية ثابتة. شروط الموقع وحقوق محتواه تظل واجبة.

## Development

KAF uses an anonymous HTML fragment from the public latest-project listing, with bounded pagination and strict parsing. `src/main/kaf.ts` owns scheduling/cancellation; `src/collector/kaf*.ts` handles fetching/parsing/cycles; `src/storage/kaf.ts` persists source metadata. Migration 8 adds nullable platform-status/duration columns and preserves existing sources.

Run `npm test` for deterministic collector/storage/scheduler regressions; run `npm run build` then `npm run test:kaf` for real Electron/preload/SQLite/UI integration using synthetic content in a new TEMP profile. OS traces prove notification dispatch wiring, not actual Windows toast clicks or live publication latency.
