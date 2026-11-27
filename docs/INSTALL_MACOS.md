# تثبيت راصد على الماك

نسخة الماك **تجريبية**: تعمل على كل أجهزة الماك الحديثة والقديمة (Intel وApple Silicon). لو قابلتك أي مشكلة أو جرّبتها ونجحت، قولنا في [جروب راصد على تليجرام](https://t.me/rased_chat).

## التثبيت (مرة واحدة فقط)

1. **حمّل البرنامج** من هذا الرابط:
   **[⬇️ تحميل راصد للماك](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-mac.dmg)**
2. **افتح الملف** الذي نزل، وستجده غالبًا في مجلد **Downloads** (التنزيلات).
3. ستظهر نافذة فيها أيقونة **راصد** وبجانبها مجلد **Applications**. **اسحب أيقونة راصد وأفلتها فوق مجلد Applications.**
4. افتح **Applications** واضغط مرتين على **راصد**.

## أول مرة تفتح راصد: الماك سيرفض فتحه، وهذا طبيعي

الماك يمنع أي برنامج لم يُسجَّل عند Apple، فستظهر رسالة تقول إنه لا يستطيع التأكد من البرنامج. اضغط **Done** أو **OK**، ثم:

1. افتح **System Settings** (إعدادات النظام) من أيقونة التفاحة  أعلى الشاشة.
2. اختر **Privacy & Security** (الخصوصية والأمان) من القائمة الجانبية.
3. انزل لأسفل الصفحة، وستجد سطرًا عن **RASED**. اضغط **Open Anyway** (افتح على أي حال).
4. اكتب كلمة سر جهازك، ثم اضغط **Open**.

هذا يحدث **مرة واحدة فقط**. بعد ذلك يفتح راصد عاديًا.

## التنبيهات

عند أول تنبيه سيسألك الماك: «هل تسمح لراصد بإرسال الإشعارات؟». اضغط **Allow** (سماح).

لو ضغطت «لا» بالخطأ: افتح راصد ← **الإعدادات ← التنبيهات** واضغط زر **«إعدادات الإشعارات في macOS»**، ثم فعّل راصد.

## التحديث

راصد يخبرك عندما يصدر تحديث جديد:
1. اضغط **«تحميل التحديث»**.
2. بعد التحميل اضغط **«فتح ملف التثبيت»**. سيُغلق راصد ويفتح الملف الجديد.
3. **اسحب أيقونة راصد إلى مجلد Applications** كما فعلت أول مرة. لو سألك الماك عن استبدال النسخة القديمة، اختر **Replace** (استبدال).

بياناتك وملاحظاتك تبقى كما هي.

## ما الذي لا يعمل على الماك حاليًا؟

**التقديم السريع** عن طريق إضافة Chrome متاح على Windows فقط حاليًا. كل شيء آخر يعمل: الرصد، والتنبيهات، والبحث، ومساعد العروض، ومتابعة المشاريع، والنسخ الاحتياطي.

## أسئلة شائعة

- **راصد مختفي ولا أجد نافذته؟** اضغط أيقونته في شريط **Dock** أسفل الشاشة، أو أيقونته الصغيرة في الشريط العلوي بجانب الساعة.
- **الماك يطلب السماح لراصد باستخدام Keychain؟** هذا عند حفظ مفتاح مساعد العروض. اضغط **Always Allow** (السماح دائمًا).
- **أريد إغلاق راصد تمامًا؟** من أيقونته في الشريط العلوي اختر **خروج**.

---

### تفاصيل تقنية (للمهتمين فقط)

- **حالة التوقيع:** النسخة موقّعة توقيعًا مؤقتًا (ad-hoc)، وغير موثّقة (notarized) من Apple.
- **ملف zip:** موجود في صفحة الإصدار للتحديثات.
- **مكان البيانات:** `~/Library/Application Support/RASED`.
- **مفاتيح مساعد العروض:** تُحفظ في Keychain، خارج قاعدة البيانات والتصدير والسجلات.
- **التحقق من سلامة الملف:** `shasum -a 256 RASED-0.14.0-mac.dmg`، وقارن الناتج بملف `SHA256SUMS.txt` في [صفحة الإصدار](https://github.com/deved234/rased/releases/tag/v0.14.0).

---

## English

# Installing RASED on a Mac

The Mac version is a **beta**. It runs on both newer and older Macs (Apple Silicon and Intel). If something goes wrong, or if it works for you, tell us in the [RASED Telegram group](https://t.me/rased_chat).

## Install (only once)

1. **Download RASED:** **[⬇️ Download RASED for Mac](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-mac.dmg)**
2. **Open the downloaded file.** You will usually find it in your **Downloads** folder.
3. A window shows the **RASED** icon next to an **Applications** folder. **Drag the RASED icon onto the Applications folder.**
4. Open **Applications** and double-click **RASED**.

## The first time you open RASED, your Mac will refuse. This is normal

Macs block apps that are not registered with Apple, so you will see a message saying the Mac cannot verify the app. Click **Done** or **OK**, then:

1. Open **System Settings** from the Apple menu  at the top of the screen.
2. Choose **Privacy & Security** in the sidebar.
3. Scroll to the bottom. Next to the line about **RASED**, click **Open Anyway**.
4. Enter your Mac password, then click **Open**.

This happens **only once**. After that, RASED opens normally.

## Notifications

At the first alert, your Mac asks whether RASED may send notifications. Click **Allow**.

If you clicked "Don't Allow" by mistake: in RASED, open **Settings → Notifications**, click **"macOS notification settings"** and turn RASED on.

## Updating

RASED tells you when an update is available:
1. Click **"Download update"**.
2. When it finishes, click **"Open installer"**. RASED closes and the new file opens.
3. **Drag the RASED icon onto Applications** as you did the first time. If your Mac asks whether to replace the old version, choose **Replace**.

Your data and notes stay as they are.

## What does not work on a Mac yet?

**Quick Apply** through the Chrome extension is Windows-only for now. Everything else works: monitoring, alerts, search, the Proposal Assistant, project watch and backups.

## Common questions

- **RASED disappeared and I can't find its window?** Click its icon in the **Dock** at the bottom of the screen, or its small icon in the top bar next to the clock.
- **My Mac asks to let RASED use the Keychain?** This happens when you save a Proposal Assistant key. Click **Always Allow**.
- **How do I quit RASED completely?** Click its icon in the top bar and choose **Quit**.

### Technical details (optional)

- **Signing:** the build is ad-hoc signed and not notarized by Apple.
- **zip file:** a `.zip` is also on the release page; it is used for updates.
- **Data folder:** `~/Library/Application Support/RASED`.
- **Proposal Assistant keys:** stored in the Keychain, outside the database, exports and logs.
- **Checking the file:** run `shasum -a 256 RASED-0.14.0-mac.dmg` and compare the result with `SHA256SUMS.txt` on the [release page](https://github.com/deved234/rased/releases/tag/v0.14.0).
