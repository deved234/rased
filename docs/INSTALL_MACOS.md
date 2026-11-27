# تثبيت راصد على macOS

راصد متاح على macOS بنسخة تجريبية (Beta) تدعم معالجات Intel وApple Silicon في ملف تثبيت واحد. لو جرّبته، قولنا عمل معاك إزاي في [جروب راصد](https://t.me/rased_chat).

## الخطوات

1. **حمّل المثبّت**
   - من [صفحة آخر إصدار](https://github.com/deved234/rased/releases/latest) حمّل ملف `RASED-<version>-mac.dmg` (أو `.zip`).

2. **التثبيت**
   - افتح ملف `.dmg` ثم اسحب **RASED** إلى مجلد **Applications**.

3. **أول تشغيل (Gatekeeper)**
   - النسخة الحالية غير موقّعة notarization من Apple (توقيع ad-hoc تجريبي)، لذلك قد يمنعها Gatekeeper عند أول تشغيل.
   - على **macOS 15 أو أحدث**: افتح **System Settings → Privacy & Security**، ثم اضغط **Open Anyway** بجانب RASED، وأكّد الفتح.
   - على إصدارات macOS الأقدم: يمكنك أيضًا النقر بزر الفأرة الأيمن على RASED ثم اختيار **Open**.

4. **الإشعارات**
   - يطلب macOS إذن الإشعارات عند أول تنبيه، أو يمكنك تفعيل راصد يدويًا من **System Settings → Notifications**.
   - يوجد زر في إعدادات راصد يفتح إعدادات إشعارات النظام.

5. **سلوك التطبيق**
   - يظهر راصد في شريط القوائم (menu bar) وفي Dock.
   - إغلاق النافذة مع اختيار «إبقاء التشغيل في الخلفية» يبقي راصد يعمل؛ الضغط على أيقونة Dock يعيد فتح النافذة.

6. **تخزين مفاتيح AI**
   - تُحفظ مفاتيح المزودين في **Keychain** على macOS. قد يطلب macOS مرة واحدة السماح لراصد باستخدامها.
   - تبقى المفاتيح خارج قاعدة البيانات والتصدير والسجلات.

7. **التحديثات**
   - يتحقق راصد من GitHub عند التشغيل وكل 6 ساعات، ولا يحمّل التحديث إلا بطلبك.
   - على macOS: يحمّل راصد التحديث داخل التطبيق ويتحقق من بصمته، ثم زر **فتح المثبّت** يغلق راصد ويفتح ملف dmg؛ اسحب RASED إلى Applications لاستبدال النسخة القديمة.

8. **مجلد البيانات**
   - `~/Library/Application Support/RASED`

## غير متاح على macOS في 0.14.0

- **التقديم السريع** وإضافة Chrome (متاح على Windows حاليًا).
- اختصار إعدادات **Focus Assist** الخاص بـ Windows.

## الإبلاغ عن مشكلة

إذا واجهت مشكلة في تثبيت أو تشغيل راصد على macOS، أبلغنا في [مجموعة تليجرام](https://t.me/rased_chat) مع ذكر إصدار macOS ونوع المعالج وخطوات إعادة المشكلة.

---

## English

RASED is available on macOS as a beta build with a universal installer for Intel and Apple Silicon. If you try it, tell us how it went in the [RASED group](https://t.me/rased_chat).

## Steps

1. **Download the installer**
   - From the [latest release page](https://github.com/deved234/rased/releases/latest), download `RASED-<version>-mac.dmg` (or `.zip`).

2. **Install**
   - Open the `.dmg` and drag **RASED** into **Applications**.

3. **First launch (Gatekeeper)**
   - The current build is an unsigned beta (ad-hoc signed, not notarized), so Gatekeeper may block the first launch.
   - On **macOS 15 or newer**: open **System Settings → Privacy & Security**, click **Open Anyway** for RASED, then confirm.
   - On older macOS versions: you can also right-click RASED and choose **Open**.

4. **Notifications**
   - macOS asks for notification permission on the first notification, or you can enable RASED in **System Settings → Notifications**.
   - RASED has a button in Settings that opens the system notification settings.

5. **App behavior**
   - RASED lives in the menu bar and the Dock.
   - Closing the window while “keep running in background” is selected keeps RASED running; clicking the Dock icon reopens it.

6. **AI key storage**
   - Provider keys are stored in **Keychain** on macOS. macOS may ask once to allow RASED to use it.
   - Keys remain outside the database, exports and logs.

7. **Updates**
   - RASED checks GitHub at startup and every 6 hours, and downloads only when you ask.
   - On macOS: RASED downloads the update inside the app and verifies its checksum, then **Open installer** closes RASED and opens the dmg; drag RASED into Applications to replace the old version.

8. **Data folder**
   - `~/Library/Application Support/RASED`

## Not available on macOS in 0.14.0

- **Quick Apply** and the Chrome extension (currently available on Windows only).
- The Windows **Focus Assist** settings shortcut.

## Reporting a problem

If you hit an installation or runtime issue on macOS, report it in the [Telegram group](https://t.me/rased_chat) with your macOS version, processor type and steps to reproduce.
