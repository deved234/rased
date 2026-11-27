# راصد 0.14.0 · RASED 0.14.0

**راصد يعمل الآن على Mac و Linux (نسخة تجريبية)، بجانب Windows.**

## التحميل

اضغط على رابط جهازك، وسيبدأ التحميل مباشرة:

| جهازك | رابط التحميل | طريقة التثبيت |
|---|---|---|
| **Windows** | **[⬇️ تحميل لـ Windows](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-Setup-0.14.0.exe)** | افتح الملف واتبع الخطوات |
| **Mac** (تجريبي) | **[⬇️ تحميل للماك](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-mac.dmg)** | [خطوات التثبيت على الماك](https://github.com/deved234/rased/blob/v0.14.0/docs/INSTALL_MACOS.md) |
| **Linux** (تجريبي) | **[⬇️ ملف deb لـ Ubuntu وMint](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-amd64.deb)** · [AppImage لباقي الأنظمة](https://github.com/deved234/rased/releases/download/v0.14.0/RASED-0.14.0-linux-x86_64.AppImage) | [خطوات التثبيت على Linux](https://github.com/deved234/rased/blob/v0.14.0/docs/INSTALL_LINUX.md) |

**عندك راصد على Windows بالفعل؟** لا تحتاج تحميل شيء: افتح **الإعدادات ← تحديثات راصد** واضغط «تحميل التحديث».

## الجديد

- **راصد على Mac و Linux:** الرصد والتنبيهات والبحث ومساعد العروض ومتابعة المشاريع والنسخ الاحتياطي، كلها تعمل. **التقديم السريع** متاح على Windows فقط حاليًا.
- **نسخة تجريبية:** لم نجرّبها بعد على أجهزة Mac و Linux كثيرة. لو جرّبتها، قولنا كيف عملت معك في [جروب راصد](https://t.me/rased_chat).
- **تابع راصد على تليجرام:** روابط القناة والجروب في «ما الجديد» و«حول راصد».
- **خصوصية محدّثة:** الإحصائيات تشمل الآن نوع جهازك ونوع المعالج، دون أي بيانات شخصية. بعد التحديث ستُطلب موافقتك من جديد، وتستطيع الخروج إن لم توافق.

## What's new (English)

- **RASED now runs on Mac and Linux (beta)** alongside Windows. Every feature works there except **Quick Apply**, which stays Windows-only for now.
- **Download:** use the links in the table above. On Windows you can also update inside the app: **Settings → RASED updates**.
- **Beta:** Mac and Linux have not been tried on many real computers yet. Please tell us how it goes in the [RASED group](https://t.me/rased_chat).
- **Telegram links** in What's New and About.
- **Updated privacy:** analytics now include your computer type and processor type, with no personal data. You will be asked to accept again after updating.

---

## Technical details

### Platforms
- **Windows (x64):** `RASED-Setup-0.14.0.exe`, unchanged.
- **macOS (Intel + Apple Silicon):** `RASED-0.14.0-mac.dmg` and `.zip`.
  - The build is ad-hoc signed and not notarized, so the first launch needs System Settings → Privacy & Security → Open Anyway.
  - It uses the native window buttons and a menu-bar template icon.
  - AI keys are kept in the Keychain.
- **Linux (x64):** `RASED-0.14.0-linux-x86_64.AppImage` or `RASED-0.14.0-linux-amd64.deb`.
  - The AppImage needs `libfuse2` (`libfuse2t64` on Ubuntu 24.04).
  - Closing with "keep running" minimizes the window, because some desktops hide tray icons.
  - AI keys need GNOME Keyring or KWallet. Without one, RASED refuses to save keys.
  - Run-at-startup writes `~/.config/autostart/rased.desktop`.
- **Windows-only for now:** Quick Apply and its Chrome extension, the Focus Assist shortcut, and Windows notification activation details.

### Updates
- **Windows and AppImage:** install in place and restart.
- **macOS:** RASED downloads the dmg and verifies its checksum. **Open installer** then closes RASED and opens the dmg, and you drag RASED into Applications. Automatic replacement would need an Apple Developer ID.
- **deb:** RASED shows the new version and an **Open download page** button.
- **All systems:** check GitHub at startup and every 6 hours, and download only on request.

### Privacy and analytics
Terms and Privacy are dated **2026-11-27**. The analytics disclosure is **`2026-11-27-v6`**:
- **What changed:** the Windows family is replaced by the OS family, the macOS major version and the processor type (x64/arm64).
- **Feature outcomes** are worded as "whether each feature was used and succeeded or failed, never its content". Nothing outside the description is collected without asking again.
- **Never sent:** the Linux distribution, the full OS version or the device name.
- **Consent:** previous participants must accept again. Earlier declines stay declined. Unconfigured builds send nothing.
- **Telegram link opens** are counted as feature use, with no content.
- **Still unverified:** cloud-event deletion completion.

### Data and compatibility
- **No database migration:** 0.12.1 can still open the database.
- **Data folders:** `%APPDATA%\RASED` (Windows), `~/Library/Application Support/RASED` (macOS) and `~/.config/RASED` (Linux).
- **Checksums:** SHA256 values for every file are in `SHA256SUMS.txt`.

### Validation and known limits
- **Automated tests:** typecheck, lint, 999 unit tests and the Electron suites passed on Windows, macOS and Ubuntu in CI.
- **Packages:** the macOS and Linux packages were built, verified and launched in CI, including the AppImage and deb under Ubuntu's default AppArmor. The configured release was built on GitHub Actions for all three systems.
- **Not tested:** no manual run on real Mac or Linux machines yet (beta), no physical notification click on macOS/Linux, and no update from a released macOS/Linux build (this is the first one).

[Privacy](https://github.com/deved234/rased/blob/v0.14.0/PRIVACY.md) · [Terms](https://github.com/deved234/rased/blob/v0.14.0/TERMS.md) · [Update guide](https://github.com/deved234/rased/blob/v0.14.0/docs/UPDATES.md) · [Changelog](https://github.com/deved234/rased/blob/v0.14.0/CHANGELOG.md)
