# RASED 0.10.0

**Using the official RASED build now requires accepting limited usage analytics.** On first launch after this update, a bilingual screen explains what is collected and offers two choices: **Agree & use RASED** or **Exit**. RASED does not check any platform, show alerts or open features until you accept. If you do not agree, exit; your local projects, notes and settings stay on your device.

This replaces the optional analytics of 0.9.1. Please read this note before updating.

## الجديد

- **الموافقة على إحصائيات الاستخدام المحدودة أصبحت شرطًا لاستخدام النسخة الرسمية.** تظهر شاشة **«أوافق وأستخدم راصد / خروج»** قبل أي ميزة. لا يبدأ الرصد أو الجمع قبل قبولك، والخروج يغلق البرنامج فعلًا.
- إذا كنت وافقت على المشاركة في 0.9.1 فستحتاج إلى الموافقة مرة أخرى على النص الجديد. وإذا كنت رفضت سابقًا يبقى رفضك كما هو، وتظهر لك الشاشة نفسها دون تفعيل أي شيء تلقائيًا.
- يمكنك سحب الموافقة من الإعدادات ← الخصوصية والإحصائيات. السحب يوقف الإرسال والرصد ويعيد شاشة الموافقة، ولا يحذف بياناتك المحلية.
- نسخ مرجع المشاركة، والتواصل على واتساب لطلب الحذف، ونسيان المرجع محليًا متاحة كلها حتى قبل الموافقة.
- **التحقق النهائي من اكتمال حذف الأحداث السحابية لم يكتمل بعد،** ويظهر هذا التنبيه قبل الموافقة. إرسال طلب الحذف لا يعني اكتماله.
- اللغة التي تختارها في شاشة الموافقة تُحفظ وتستمر بعد القبول.
- إصلاح ظهور رسالة خطأ مؤقتة واهتزاز قائمة المشاريع أثناء تحديث نتائج البحث.

## What is shared

The same limited data as 0.9.1:

- **Shared:** a random installation reference, app version, language and broad Windows family; daily activity; hourly monitoring and notification counters; and the outcomes of selected features. It goes to PostHog US Cloud.
- **Never shared:** project content or links, notes, proposals, searches, API keys, browser sessions, screen recordings or click autocapture.

RASED sets no scheduled server expiry; provider policies and applicable law still apply. The [analytics guide](https://github.com/deved234/rased/blob/v0.10.0/docs/ANALYTICS.md) lists exact fields and metric limits.

Development and unconfigured builds send nothing and do not show this requirement. A network or provider outage after you accept does not lock RASED. This requirement is a distribution policy for the official build. It does not change the [MIT license](https://github.com/deved234/rased/blob/v0.10.0/LICENSE) of the source code, and it is not a claim of legal validity in every jurisdiction.

## Search fix

Project results no longer briefly show "Could not update results" when a newer refresh replaces an older one. Real query failures still show a warning with retry. The "Updating search results" indicator now appears only after 200 ms and floats over the list, so the toolbar no longer shifts. The documented 0.9.0 search performance limits are unchanged.

## Installation

Download **RASED-Setup-0.10.0.exe** from Assets. Windows x64; no Node.js or SQLite needed.

The installer is unsigned. Compare its SHA256 with the bundled **SHA256SUMS.txt** release asset.

On 0.2.5 or later you can update from inside the app: Settings → RASED updates → Check → Download → Restart and install. Downloading and installing remain your explicit choice.

Your existing projects, notes, settings and encrypted AI keys stay in the same profile. The Chrome extension does not need reinstalling.

## Validation and known limits

- **Automated tests:** before release, the source passed unit tests and real Electron tests covering acceptance, search, notifications, backups, monitoring, Quick Apply and the Chrome extension, all with synthetic profiles. An isolated install/update cycle also passed. The configured installer was then built and checked on GitHub Actions.
- **Not tested:** physical Windows notification clicks on every machine, live AI provider accounts, and a full upgrade of a real 0.9.1 installation.
- **Still pending:** cloud-event deletion completion is **unverified**.

[Privacy](https://github.com/deved234/rased/blob/v0.10.0/PRIVACY.md) · [Terms](https://github.com/deved234/rased/blob/v0.10.0/TERMS.md) · [Update guide](https://github.com/deved234/rased/blob/v0.10.0/docs/UPDATES.md) · [Search limits](https://github.com/deved234/rased/blob/v0.10.0/docs/PROJECT_SEARCH.md#known-performance-limits-in-090) · [Changelog](https://github.com/deved234/rased/blob/v0.10.0/CHANGELOG.md).
