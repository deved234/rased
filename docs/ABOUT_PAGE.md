# صفحة حول راصد — 0.2.2

التاريخ: 2026-09-26. نُفذت بطلب المستخدم داخل **الإعدادات → حول راصد / Settings → About RASED**.

- الاسم كما حدده المستخدم: **david atef**، بالحروف الصغيرة دون تغييره حسب اللغة.
- الوصف: **مؤسس ومطوّر راصد** / **Founder & developer of RASED**.
- GitHub: https://github.com/deved234
- LinkedIn: https://www.linkedin.com/in/david-atef/
- كود المشروع: https://github.com/deved234/rased
- شعار التطبيق ونبذة عنه ورقم الإصدار، مع بطاقة للمطوّر بحروف da بدل صورة شخصية غير مقدمة.
- بطاقة MIT ورابط المساهمة، وسجل التشخيص السابق ما زال متاحًا في قسم مطوي.
- التصميم يستخدم ألوان الواجهة الحالية ويدعم العربية/الإنجليزية وثيمي التطبيق. الصور الفعلية: screenshots/about/ar-about.png وen-about.png.

## التنفيذ والتحقق

البيانات الثابتة في src/shared/about.ts؛ عرض الصفحة في SettingsView مع النصوص المترجمة وتنسيق components.css. الروابط تفتح عبر preload وIPC.openAboutLink إلى shell.openExternal في main. يقبل main ثلاثة مفاتيح محددة فقط، وليس URL عشوائية من الواجهة. فشل الفتح يعرض رسالة على الصفحة.

تم تصحيح رقم الإصدار في وضع dev لعرض إصدار المشروع0.2.2 بدل إصدار Electron44.4.5، باستخدام version منpackage.json وقت البناء. author فيpackage.json أصبح david atef. لم يُغيّر نصMIT أو ترحيل قاعدة البيانات.

نجح typecheck وlint وbuild وdist. جُرّبت الصفحة بالعربي والإنجليزي على Electron الحقيقي ببروفايل TEMP منفصل؛ الاسم والوصف ورقم الإصدار صحيحان، وضغطات GitHub/LinkedIn/source وصلت إلى main الحقيقي وأعطت الروابط الثلاثة الصحيحة عند استبدال OS opener بوضع الاختبار المعزول. لا ادعاء فتح صفحات هذه الروابط حيًا أو تحميلها؛ اختبار رابط المشروع عبر opener الحقيقي موثق في تقرير0.2.1.

المثبت المحلي الجديد: release/RASED Setup 0.2.2.exe. لم يحدث نشر إلىGitHub أوcommit، ولم تُستخدم بيانات المستخدم للاختبار.

SHA256: 37B14B0E9D4F49AD6FDDCCA605880569CBF47659FAA2EEAAA1B0D0B9F8DD8F04
