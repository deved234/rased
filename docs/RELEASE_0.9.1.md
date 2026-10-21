# RASED 0.9.1

Optional usage analytics is now available in the official Windows build. It starts **off** and sends nothing until you explicitly agree in Settings → Privacy & analytics. Declining does not restrict any RASED feature.

## الجديد

- تفعيل إحصائيات محدودة إلى PostHog US Cloud بعد موافقتك فقط: معرّف تثبيت عشوائي، الإصدار واللغة، نشاط يومي وملخصات الرصد ونتائج الميزات.
- لا تُرسل محتويات المشاريع أو روابطها، الملاحظات والعروض، البحث، مفاتيح API، حسابات المتصفح أو تسجيل الشاشة. لا تتبّع تلقائي لكل ضغطة.
- يمكنك إيقاف المشاركة، ونسخ مرجع المشاركة لطلب حذف البيانات على واتساب من الإعدادات. الرفض لا يعطّل البرنامج.
- **التحقق النهائي من اكتمال حذف الأحداث السحابية لم يكتمل بعد.** أُطلق هذا الإصدار بقرار المطور مع تأجيل هذا التحقق، ويظهر التنبيه قبل الموافقة. إرسال طلب الحذف لا يعني اكتماله؛ لن نؤكد الحذف قبل التحقق من المزود.

## Installation

Download **RASED-Setup-0.9.1.exe** from Assets, or use Settings → RASED updates → Check → Download → Restart and install on 0.2.5+. Windows x64; no Node.js/SQLite installation needed. The installer is unsigned; compare its SHA256 with the bundled **SHA256SUMS.txt** release asset.

Existing local projects, notes, settings and encrypted AI keys remain in the same profile. No extension reinstall is required. The expanded search and known performance limits from 0.9.0 remain unchanged. Application analytics count participating installations, not all users or identifiable people; GitHub download totals remain separate and may include repeated downloads.

## Privacy and verification status

PostHog production has IP discard enabled, autocapture opted out and session/console recording disabled. Consent is versioned `2026-10-21-v3`; older explicit declines remain disabled, and earlier participants must approve the updated disclosure. Stopping sharing cancels transport and clears pending local events; previously received events require a separate administrative deletion request. The app sets no scheduled server expiry, subject to provider policies and applicable legal requirements.

Production builds pin the reviewed project/token fingerprint. Development and marked isolated profiles cannot use that production configuration. The GitHub build uses only the existing write-only ingest secret; no administrative key is bundled. The configured package is checked before release, while consent/transport regression tests use synthetic fixtures. Cloud-event deletion completion remains **unverified**, rather than being counted as a passed test.

[Analytics guide](ANALYTICS.md) · [Privacy](../PRIVACY.md) · [Update guide](UPDATES.md) · [Search limits](PROJECT_SEARCH.md#known-performance-limits-in-090) · [Changelog](../CHANGELOG.md).
