# RASED 0.12.1

**A fix release.** Watching Mostaql projects now works, RASED follows the Windows proxy settings like your browser, including VPNs in system-proxy mode, and Mostaql durations such as «2 يومين» are read correctly. Nothing new is collected or sent.

## الإصلاحات

- **متابعة مشاريع مستقل تعمل الآن.** في 0.12.0 كانت كل فحوص مستقل تُرفض قبل أي طلب، لأن روابط مستقل المحفوظة بصيغة `/go/<رقم>`، فلم يصل أي تنبيه لمشاريع مستقل المتابعة. الآن تتبع المتابعة تحويل هذا الرابط إلى صفحة المشروع بنفس قواعد الأمان (نفس الموقع، والمسارات المسموحة، و3 تحويلات على الأكثر). المشاريع التي تتابعها تكمل وحدها بعد التحديث، وأول فحص ناجح صامت كالمعتاد. متابعة نفذلي وكاف لم تتأثر.
- **يتبع إعدادات Proxy.** كان راصد يتجاهل إعدادات Proxy في Windows، فمن يستخدم VPN بوضع «System proxy» أو شبكة تمر عبر Proxy كان يرى انتهاء المهلة في كل المصادر بينما يعمل المتصفح. الآن يتبع الرصد والتفاصيل والمتابعة إعدادات Windows مثل المتصفح (Proxy يدوي أو إعداد تلقائي PAC أو VPN بوضع Proxy)، بدون ملفات تعريف ارتباط أو تسجيل دخول، وبنفس الحدود والتهدئة. Proxy الذي يطلب اسم مستخدم وكلمة مرور غير مدعوم.
- **قراءة المدة بصيغة المثنى:** «2 يومين» تُقرأ يومين، و«2 أسبوعين» تُقرأ 14 يومًا.

## Fixes

- **Mostaql project watch works.** In 0.12.0 every Mostaql check was rejected before any request, because stored Mostaql links use `/go/<id>`, so watched Mostaql projects never alerted. Watch now follows that link's redirect to the project page under the same rules (same site, allowed paths, at most 3 redirects). Existing Mostaql watches resume on their own after updating; their first successful check is silent as usual. Nafezly and KAF watch were not affected.
- **Proxy settings.** Requests ignored the Windows proxy settings, so a VPN in system-proxy mode, or a network that only allows traffic through a proxy, made every source time out while the browser worked. Monitoring, project details and project watch now follow the Windows settings like the browser (manual proxy, PAC/automatic configuration, VPNs in proxy mode), with no cookies or sign-in and the same limits and cooldowns. Proxies that ask for a username and password are not supported. Proposal Assistant requests and analytics are unchanged.
- **Arabic dual durations:** «2 يومين» is read as 2 days and «2 أسبوعين» as 14 days.

## Data, privacy and compatibility

No database migration: 0.12.0 can still open the database. No analytics change: the disclosure stays **`2026-11-15-v5`**. If you already accepted it you are not asked again; upgrading directly from an older disclosure still asks for acceptance. Terms and Privacy stay dated **2026-11-15**. Cloud-event deletion completion remains **unverified**. See the [analytics guide](https://github.com/deved234/rased/blob/v0.12.1/docs/ANALYTICS.md).

## Installation

Download **RASED-Setup-0.12.1.exe** from Assets. Windows x64; no Node.js or SQLite needed.

The installer is unsigned. Compare its SHA256 with the bundled **SHA256SUMS.txt** release asset.

On 0.2.5 or later you can update from inside the app: Settings → RASED updates → Check → Download → Restart and install. Downloading and installing remain your explicit choice.

## Validation and known limits

- **Automated tests:** typecheck, lint, the unit tests and the real Electron suites with synthetic profiles. `test:watch` now uses `/go/` links like real data, and the new `npm run test:network` checks the network adapter in real Electron against a local server and a fake proxy: redirects, no cookies, cancellation, abort and that requests go through the proxy. Windows CI passed, and the configured installer was built and checked on GitHub Actions, including the packaged-app suites.
- **Live check:** a built development app on a temporary profile collected from all four sources through the new network path, and a live Mostaql `/go/` watch check reached the project page.
- **Not tested:** a machine behind a real proxy or system-proxy VPN (only a fake proxy in tests), a manual upgrade of a real 0.12.0 installation, and a physical click on a real watch notification.

[Privacy](https://github.com/deved234/rased/blob/v0.12.1/PRIVACY.md) · [Terms](https://github.com/deved234/rased/blob/v0.12.1/TERMS.md) · [Update guide](https://github.com/deved234/rased/blob/v0.12.1/docs/UPDATES.md) · [Changelog](https://github.com/deved234/rased/blob/v0.12.1/CHANGELOG.md).
