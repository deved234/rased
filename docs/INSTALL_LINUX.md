# تثبيت راصد على Linux

نسخة Linux **تجريبية**، وتعمل على أجهزة الكمبيوتر العادية (64-bit). لو قابلتك أي مشكلة أو جرّبتها ونجحت، قولنا في [جروب راصد على تليجرام](https://t.me/rased_chat).

## أي ملف أحمّل؟

- **تستخدم Ubuntu أو Linux Mint أو Debian أو Zorin؟** (الأكثر انتشارًا) ← حمّل **ملف deb**:
  **[⬇️ تحميل راصد (deb)](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-amd64.deb)**
- **تستخدم نظامًا آخر مثل Fedora؟** ← حمّل **ملف AppImage**:
  **[⬇️ تحميل راصد (AppImage)](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-x86_64.AppImage)**

**لو مش متأكد:** جرّب ملف deb أولًا.

## التثبيت بملف deb (Ubuntu وما يشبهه)

1. حمّل ملف **deb** من الرابط فوق.
2. افتح مجلد **Downloads** (التنزيلات)، واضغط بالزر الأيمن على الملف، واختر **Open With ← App Center** (أو **Software Install**).
3. اضغط **Install** (تثبيت)، واكتب كلمة سر جهازك.
4. افتح قائمة البرامج، واكتب **RASED**، واضغط عليه.

**لو لم تنجح الخطوة 2:** افتح **Terminal** (اضغط `Ctrl` + `Alt` + `T` معًا)، والصق هذا السطر ثم اضغط Enter واكتب كلمة السر:

```
sudo apt install ~/Downloads/RASED-0.14.0-linux-amd64.deb
```

## التثبيت بملف AppImage

1. حمّل ملف **AppImage** من الرابط فوق.
2. اضغط بالزر الأيمن على الملف ← **Properties** (الخصائص) ← **Permissions**، وفعّل خيار **Allow executing file as program** (السماح بتشغيله كبرنامج).
3. اضغط على الملف مرتين لفتحه.

**لو لم يفتح على Ubuntu 22.04 أو أحدث:** افتح **Terminal** (`Ctrl` + `Alt` + `T`) والصق هذا السطر، ثم جرّب مرة أخرى:

```
sudo apt install libfuse2t64
```

(على Ubuntu 22.04 اكتب `libfuse2` بدل `libfuse2t64`.)

## التحديث

راصد يخبرك عندما يصدر تحديث جديد:
- **لو ثبّته بملف AppImage:** اضغط **«تحميل التحديث»** ثم **«إعادة التشغيل والتحديث»**. وهذا كل شيء.
- **لو ثبّته بملف deb:** اضغط **«فتح صفحة التحميل»**، ثم حمّل ملف deb الجديد وثبّته بنفس خطوات التثبيت.

بياناتك وملاحظاتك تبقى كما هي.

## ما الذي لا يعمل على Linux حاليًا؟

**التقديم السريع** عن طريق إضافة Chrome متاح على Windows فقط حاليًا. كل شيء آخر يعمل: الرصد، والتنبيهات، والبحث، ومساعد العروض، ومتابعة المشاريع، والنسخ الاحتياطي.

## أسئلة شائعة

- **أغلقت النافذة ولم يختفِ البرنامج؟** هذا مقصود: راصد يبقى يعمل ليرصد المشاريع، ونافذته تُصغَّر في شريط البرامج. للإغلاق التام اختر **خروج** من أيقونة راصد، أو غيّر هذا من **الإعدادات**.
- **رسالة تقول إن حفظ مفتاح مساعد العروض يحتاج «خزنة مفاتيح النظام»؟** نظامك لا يحتوي خزنة مفاتيح مفعّلة. على Ubuntu العادي تكون موجودة. ولو ظهرت الرسالة، اسأل في الجروب ونساعدك.

---

### تفاصيل تقنية (للمهتمين فقط)

- **الاختبارات:** تعمل أوتوماتيكيًا على Ubuntu 24.04. يُفتح ملف AppImage وحزمة deb المثبّتة مع قيد AppArmor الافتراضي.
- **أيقونة Tray:** بعض إعدادات GNOME لا تعرضها بدون امتداد AppIndicator، ولذلك الإغلاق مع «الاستمرار في الخلفية» يصغّر النافذة بدل إخفائها.
- **مفاتيح مساعد العروض:** تُحفظ عبر خدمة أسرار النظام (GNOME Keyring أو KWallet، عن طريق safeStorage في Electron). بدونها يرفض راصد الحفظ.
- **التشغيل مع الجهاز:** يكتب الملف `~/.config/autostart/rased.desktop`.
- **مكان البيانات:** `~/.config/RASED`.
- **التحقق من سلامة الملف:** `sha256sum <file>`، وقارن الناتج بملف `SHA256SUMS.txt` في [صفحة الإصدار](https://github.com/deved234/rased/releases/tag/v0.14.0).

---

## English

# Installing RASED on Linux

The Linux version is a **beta** for regular 64-bit computers. If something goes wrong, or if it works for you, tell us in the [RASED Telegram group](https://t.me/rased_chat).

## Which file should I download?

- **Using Ubuntu, Linux Mint, Debian or Zorin?** (the most common) → download the **deb file**:
  **[⬇️ Download RASED (deb)](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-amd64.deb)**
- **Using another system such as Fedora?** → download the **AppImage**:
  **[⬇️ Download RASED (AppImage)](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-x86_64.AppImage)**

**Not sure?** Try the deb file first.

## Installing the deb file (Ubuntu and similar)

1. Download the **deb** file above.
2. Open your **Downloads** folder, right-click the file and choose **Open With → App Center** (or **Software Install**).
3. Click **Install** and enter your password.
4. Open your apps menu, type **RASED** and click it.

**If step 2 does not work:** open **Terminal** (press `Ctrl` + `Alt` + `T` together), paste this line, press Enter and type your password:

```
sudo apt install ~/Downloads/RASED-0.14.0-linux-amd64.deb
```

## Installing the AppImage

1. Download the **AppImage** above.
2. Right-click the file → **Properties** → **Permissions**, and turn on **Allow executing file as program**.
3. Double-click the file to open it.

**If it does not open on Ubuntu 22.04 or newer:** open **Terminal** (`Ctrl` + `Alt` + `T`), paste this line, then try again:

```
sudo apt install libfuse2t64
```

(On Ubuntu 22.04, use `libfuse2` instead of `libfuse2t64`.)

## Updating

RASED tells you when an update is available:
- **If you installed the AppImage:** click **"Download update"**, then **"Restart and update"**. That's all.
- **If you installed the deb file:** click **"Open download page"**, download the new deb file and install it the same way.

Your data and notes stay as they are.

## What does not work on Linux yet?

**Quick Apply** through the Chrome extension is Windows-only for now. Everything else works: monitoring, alerts, search, the Proposal Assistant, project watch and backups.

## Common questions

- **I closed the window but RASED is still running?** That is on purpose: RASED keeps watching for projects, and its window is minimized to your taskbar. To quit completely, choose **Quit** from the RASED icon, or change this in **Settings**.
- **A message says saving a Proposal Assistant key needs the "system keyring"?** Your system has no keyring turned on. Regular Ubuntu has one. If you see this message, ask in the group and we will help.

### Technical details (optional)

- **Tests:** run automatically on Ubuntu 24.04. The AppImage and the installed deb are both launched under the default AppArmor restriction.
- **Tray icon:** some GNOME setups hide tray icons without the AppIndicator extension. That is why closing with "keep running" minimizes the window instead of hiding it.
- **Proposal Assistant keys:** stored through the system secret service (GNOME Keyring or KWallet, via Electron safeStorage). Without one, RASED refuses to save keys.
- **Run at startup:** writes `~/.config/autostart/rased.desktop`.
- **Data folder:** `~/.config/RASED`.
- **Checking the file:** run `sha256sum <file>` and compare the result with `SHA256SUMS.txt` on the [release page](https://github.com/deved234/rased/releases/tag/v0.14.0).
