# RASED 0.11.0

**Quick Apply now prepares your saved template in one click.** Quick Apply with Assistant can reuse a saved project draft or generate one under optional, revocable AI consent. Save up to ten freelancer profiles, choose a default, and use Proposal Assistant on Mostaql, Nafezly and KAF.

Chrome preparation remains **Mostaql/Nafezly only**. KAF offers copy and open only; Khamsat is excluded. RASED never submits an offer: review the fields and submit yourself.

## الجديد

- **التقديم السريع بضغطة واحدة:** جهّز قالب الملف المهني الافتراضي بالسعر والمدة المحفوظين في الإعدادات. إشعارات Windows تستخدم القالب أيضًا؛ راجع الحقول وأرسل بنفسك في Chrome.
- **التقديم السريع مع المساعد:** يعيد استخدام المسودة المحفوظة دون طلب AI جديد، أو يولّد مسودة عند عدم وجودها بموافقة اختيارية قابلة للسحب. يمكنك متابعة الكتابة أو إلغاؤها، وتبقى المسودة محفوظة إذا تعذّر تجهيز Chrome.
- موافقة التوليد المستمرة مرتبطة بالموفر والموديل وإصدار المفتاح، وتُمسح عند تغيير الاختيار أو حفظ/حذف مفتاح أو استيراد الإعدادات أو استعادة نسخة احتياطية. لا تُضمّن في التصدير أو النسخ الاحتياطي، وتبقى منفصلة عن موافقة الإحصائيات.
- احفظ حتى عشرة ملفات مهنية مع قوالب اختيارية، واختر الافتراضي للتقديم السريع والإشعارات والتوليد بالموافقة المستمرة. يمكنك اختيار ملف آخر لطلب يدوي بعد معاينة جديدة وموافقة جديدة؛ المسودات الموجودة لا تتغير.
- مساعد العروض يدعم مستقل ونفذلي وكاف من البيانات المحفوظة بالفعل. كاف للنسخ وفتح الرابط فقط؛ تجهيز Chrome لمستقل ونفذلي فقط، وخمسات غير مشمول.
- شاشة «الجديد» بعد الترقية، مع إمكانية مراجعتها من إعدادات «حول»، ورسائل أخطاء أوضح ودليل موسّع لإضافة Chrome.
- تحديث الشروط والخصوصية بتاريخ 2026-10-23. إفصاح الإحصائيات v4 لم يتغير ولا توجد حقول إحصائية جديدة.

## Quick Apply and Proposal Assistant

The template action uses saved budget position and extra days, with no preview dialog or one-time override. An empty default template shows guidance without opening Chrome. Quick Apply with Assistant reuses the latest saved project draft; only when none exists can standing consent authorize generation, saving and preparation. Without consent or a readable key, the Assistant explains what is missing and retains manual preview and approval.

Standing AI consent is off by default, optional and revocable. It is bound to the selected provider, model and key revision. Changing the active provider/model, saving or deleting any key, importing settings or restoring a backup clears it. It is excluded from settings exports and backups. Generation may consume provider quota or credits; there is no automatic paid retry. See the [Assistant guide](https://github.com/deved234/rased/blob/v0.11.0/docs/AI_ASSISTANT.md).

Preparing from the Assistant saves edits, locks the editor and verifies the displayed text against the saved draft. Concurrent draft changes are preserved, and failed Chrome preparation keeps a successfully generated draft. Writing offers progress and cancellation. Notifications continue to use the default template.

Proposal Assistant now covers Nafezly and KAF as well as Mostaql, using already stored project data without extra fetching or cooldown changes. KAF has copy and open only; Quick Apply and Quick Apply with Assistant support Mostaql/Nafezly only. Khamsat remains excluded.

Only **Google Chrome 120 or newer** is supported. The expanded [extension guide](https://github.com/deved234/rased/blob/v0.11.0/docs/QUICK_APPLY.md) explains installation, pairing, preparation phases, errors and recovery. The extension and native protocol are unchanged; these features do not require an extension reload. If you replace the unpacked extension files, follow the guide's reload steps.

## Profiles and compatibility

Save 1–10 named freelancer profiles with optional Quick Apply templates. The default supplies templates for buttons and notifications, and profile facts for generation under standing consent. A manual Assistant request can use another profile after a refreshed preview and renewed approval. Changing the default does not change saved drafts or revoke standing consent. Unreadable profile sets remain intact until explicit recovery.

Settings format v3 and portable backups transfer the profile set. No database schema migration is involved, but **0.10.0 cannot import v3 settings files or backups containing profile sets**.

Downgrading to 0.10.0 shows only the default profile and its template; other profiles remain stored but hidden. Edits to the legacy profile/template there are applied to the default when returning to 0.11.0. **If Quick Apply is enabled with an empty default template, 0.10.0 resets all Quick Apply preferences to its defaults.** Keep a compatible pre-upgrade backup if you need to restore with 0.10.0. See [Backup and restore](https://github.com/deved234/rased/blob/v0.11.0/docs/BACKUP_AND_RESTORE.md).

## What's New and privacy

After an upgrade, a bilingual What's New screen appears after startup and required analytics acceptance. It supports keyboard dismissal, tracks the viewed version locally and can be reopened from About settings.

Terms and Privacy are dated **2026-10-23**. Analytics disclosure **`2026-10-21-v4` is unchanged**, and this release adds no analytics fields. Since 0.10.0 the official configured build requires explicit analytics acceptance before monitoring or feature access. Updating alone never counts as acceptance; earlier declines stay declined. AI consent remains separate and optional. Development and unconfigured builds remain exempt and send nothing.

Cloud-event deletion completion remains **unverified**. RASED sets no scheduled server expiry; provider policies and applicable law still apply. See the [analytics guide](https://github.com/deved234/rased/blob/v0.11.0/docs/ANALYTICS.md). The distribution policy does not change the [MIT license](https://github.com/deved234/rased/blob/v0.11.0/LICENSE) or certify legal validity in every jurisdiction.

## Installation

Download **RASED-Setup-0.11.0.exe** from Assets. Windows x64; no Node.js or SQLite needed.

The installer is unsigned. Compare its SHA256 with the bundled **SHA256SUMS.txt** release asset.

On 0.2.5 or later you can update from inside the app: Settings → RASED updates → Check → Download → Restart and install. Downloading and installing remain your explicit choice.

Your existing projects, notes, settings and encrypted AI keys stay in the same profile. Review the compatibility limits above before downgrading.

## Validation and known limits

- **Automated checks:** typecheck, lint, all 493 unit tests across 46 files, and the application build passed. No installer was built or tested for this version bump.
- **Not established by these gates:** live AI provider access, live platform forms, physical Windows notification clicks or a production installer upgrade. The feature guides describe synthetic integration coverage and its limits.
- **Still pending:** cloud-event deletion completion is **unverified**.

[Privacy](https://github.com/deved234/rased/blob/v0.11.0/PRIVACY.md) · [Terms](https://github.com/deved234/rased/blob/v0.11.0/TERMS.md) · [Update guide](https://github.com/deved234/rased/blob/v0.11.0/docs/UPDATES.md) · [Changelog](https://github.com/deved234/rased/blob/v0.11.0/CHANGELOG.md).
