# تثبيت راصد على Linux

راصد متاح على Linux بنسخة **تجريبية (Beta)** بصيغتي AppImage وdeb (x64). اختباراته الأوتوماتيكية بتشتغل على Ubuntu 24.04، بس لسه ما اتجرّبش يدويًا على أجهزة كتير. لو جرّبته، قولنا عمل معاك إزاي في [جروب راصد](https://t.me/rased_chat).

## الخطوات

1. **حمّل الحزمة المناسبة**
   - من [صفحة آخر إصدار](https://github.com/deved234/rased/releases/latest) حمّل أحد الملفين:
     - `RASED-<version>-linux-x86_64.AppImage`
     - `RASED-<version>-linux-amd64.deb`

2. **التثبيت والتشغيل**

   **AppImage:**
   - اجعل الملف قابلًا للتنفيذ ثم شغّله:
     ```bash
     chmod +x RASED-<version>-linux-x86_64.AppImage
     ./RASED-<version>-linux-x86_64.AppImage
     ```
   - على Ubuntu 22.04 أو أحدث قد تحتاج `libfuse2`. على Ubuntu 24.04 اسم الحزمة هو `libfuse2t64`:
     ```bash
     sudo apt install libfuse2t64
     ```

   **deb (Ubuntu/Debian):**
   ```bash
   sudo apt install ./RASED-<version>-linux-amd64.deb
   ```

3. **الإشعارات وأيقونة Tray**
   - إشعارات النظام تعمل حسب بيئة سطح المكتب.
   - بعض إعدادات GNOME لا تعرض أيقونة Tray بدون امتداد AppIndicator. في هذه الحالة، اختيار «إبقاء التشغيل في الخلفية» عند الإغلاق يصغّر النافذة بدل إخفائها.

4. **تخزين مفاتيح AI (Keyring)**
   - حفظ مفاتيح AI يحتاج خدمة أسرار نظام مثل **GNOME Keyring** أو **KWallet**.
   - إذا لم تتوفر خدمة أسرار، يرفض راصد حفظ المفاتيح ويعرض رسالة توضيحية.

5. **التشغيل مع بدء الجلسة**
   - خيار «التشغيل مع بدء تشغيل الجهاز» يكتب ملف `~/.config/autostart/rased.desktop`.

6. **التحديثات**
   - يتحقق راصد من GitHub عند التشغيل وكل 6 ساعات، ولا يحمّل التحديث إلا بطلبك.
   - **AppImage:** نفس تحديث التطبيق الداخلي الكامل (تحميل ثم إعادة تشغيل وتثبيت).
   - **deb:** يكتفي راصد بالتنبيه، وزر «فتح صفحة التحميل» يفتح صفحة إصدارات GitHub؛ ثبّت ملف `.deb` الجديد بنفسك.

7. **مجلد البيانات**
   - `~/.config/RASED`

## غير متاح على Linux في 0.14.0

- **التقديم السريع** وإضافة Chrome (متاح على Windows حاليًا).
- اختصار إعدادات **Focus Assist** الخاص بـ Windows.

## الإبلاغ عن مشكلة

إذا واجهت مشكلة في تثبيت أو تشغيل راصد على Linux، أبلغنا في [مجموعة تليجرام](https://t.me/rased_chat) مع ذكر التوزيعة وإصدارها وبيئة سطح المكتب وخطوات إعادة المشكلة.

---

## English

RASED is available on Linux as a **beta** in x64 AppImage and deb packages. Its automated tests run on Ubuntu 24.04, but it has not yet been tried by hand on many machines. If you try it, tell us how it went in the [RASED group](https://t.me/rased_chat).

## Steps

1. **Download the right package**
   - From the [latest release page](https://github.com/deved234/rased/releases/latest), download one of:
     - `RASED-<version>-linux-x86_64.AppImage`
     - `RASED-<version>-linux-amd64.deb`

2. **Install and run**

   **AppImage:**
   - Make it executable, then run it:
     ```bash
     chmod +x RASED-<version>-linux-x86_64.AppImage
     ./RASED-<version>-linux-x86_64.AppImage
     ```
   - Ubuntu 22.04+ may need `libfuse2`. On Ubuntu 24.04 the package name is `libfuse2t64`:
     ```bash
     sudo apt install libfuse2t64
     ```

   **deb (Ubuntu/Debian):**
   ```bash
   sudo apt install ./RASED-<version>-linux-amd64.deb
   ```

3. **Notifications and tray icon**
   - System notifications depend on your desktop environment.
   - Some GNOME setups do not show tray icons without the AppIndicator extension. In that case, closing with “keep running in background” minimizes the window instead of hiding it.

4. **AI key storage (keyring)**
   - Saving AI keys needs a system secret service such as **GNOME Keyring** or **KWallet**.
   - Without one, RASED refuses to save keys and shows a clear message.

5. **Run at startup**
   - The “Run when you sign in to your computer” option writes `~/.config/autostart/rased.desktop`.

6. **Updates**
   - RASED checks GitHub at startup and every 6 hours, and downloads only when you ask.
   - **AppImage:** the same full in-app update (download, then restart and install).
   - **deb:** RASED notifies only; “Open download page” opens the GitHub releases page so you can install the new `.deb` yourself.

7. **Data folder**
   - `~/.config/RASED`

## Not available on Linux in 0.14.0

- **Quick Apply** and the Chrome extension (currently available on Windows only).
- The Windows **Focus Assist** settings shortcut.

## Reporting a problem

If you hit an installation or runtime issue on Linux, report it in the [Telegram group](https://t.me/rased_chat) with your distro/version, desktop environment and steps to reproduce.
