# Project notifications

The following behavior is available starting with RASED 0.8.1. Notifications created by older versions retain their original activation behavior.

## Opening a project

Click a project notification, or **View project**, to open its original link in your default browser. RASED requests browser focus only after your click. Receiving an alert never brings the browser or RASED forward by itself.

Windows foreground activation is handled by Electron's persistent notification activator. Destinations are stored locally for seven days, so a valid notification can still work after RASED exits, restarts, or removes that project from history. An expired notification asks you to open the project from RASED instead. Old notifications containing HTTPS links continue to use Windows' existing protocol handling.

Source development repairs its own COM launch command after Electron finishes registering it. Windows starts `out/main/developmentRelay.js` with an explicit local configuration containing the source-app path and profile. The relay receives activation without acquiring the application's singleton lock, then hands the ticket to the running source app or starts that app with its absolute path. It never loads Electron's welcome screen or opens a project independently of the validated ticket dispatcher. Restart development after updating this code so the registration can be repaired; existing valid development tickets keep their destinations.

**Quick apply** remains a separate action through the paired Chrome extension, for Mostaql/Nafezly only. Opening a project does not require the extension and never submits an offer.

### Project watch notifications

Notifications from project watch (individual project change toasts and the away summary) use the same persistent activation ticket path. When clicked, RASED resolves the ticket and checks whether the project still exists in local storage (`watchActivationTarget`):
- If the project is present in RASED's database, RASED requests activation for your default browser and opens the project URL.
- If the project is missing from local history (for example, after a history cleanup), RASED brings its own main window forward (`showMainWindowForWatch`) instead of opening the link, and audits `watch-notification-project-missing`.
- Batch and away summaries open their first project.
- If Windows activates the notification without a ticket (the HTTPS fallback), Windows delivers the stored URL to your default browser without involving RASED, even if the project was deleted locally.

See [Project watch](PROJECT_WATCH.md) for alert triggers, baseline checks, and settings.

## Foreground behavior and limits

RASED uses the Windows HTTPS association rather than choosing Chrome for everyone. When one default-browser window can be identified, it requests activation before delivering the URL and restores that window if minimized. With multiple windows/profiles it leaves window selection to the browser instead of guessing; it may grant activation to a verified common browser process. Foreground success and URL delivery are recorded separately.

Windows can still deny focus, particularly on a locked/secure desktop, with some exclusive fullscreen games, or across privilege boundaries. A focus failure does not reopen the link or create a second tab. If the Windows binding cannot load, ordinary URL opening remains available. RASED does not change system focus settings, simulate keyboard shortcuts, elevate itself, or keep requesting focus after the click.

The Windows adapter reads process executable paths/window handles transiently to identify the default browser. It does not inspect page contents, tabs, browser profiles or cookies, and does not log window titles or raw activation tokens. Mouse movement alone does not cancel observation; an intentional switch to another application does. Observation does not repeatedly request focus.

## Engineering and verification

- `src/main/notifications/`: browser activation, bounded observation and notification dispatch.
- `src/storage/notificationActivations.ts`: hashed, expiring destinations; duplicate suppression survives process handoff. Tickets are excluded from portable backups and cleared during restore. Schema-8 backups remain supported.
- `koffi` supplies the bundled Windows x64 binding; users need no system Node installation or additional helper/runtime. It is loaded only in the trusted main process. Development uses a separate protocol/shortcut identity.
- Development's JavaScript relay is compiled with the main entries. Registration is repaired only when the shortcut identity, executable and class ID belong to this development build; a failed verification leaves new notifications on the ordinary HTTPS fallback. Packaged builds retain their native activation path.
- Earlier development executable names may have left several shortcuts with the same notification identity and different class IDs. Proven same-executable development classes are redirected to the active class using per-user COM `TreatAs`, so Windows' old shortcut selection does not start an obsolete bare Electron command. Foreign classes, aliases and installed-app registrations are not replaced.
- `npm run test:notification-activation` checks Electron/preload/SQLite lifecycle with OS effects substituted. It does **not** certify physical notification clicks or browser focus. Those require a separate Windows desktop check, including minimized/closed browsers and multiple profiles.

## بالعربي

اضغط الإشعار أو «عرض المشروع» لفتح الرابط في المتصفح الافتراضي. راصد يطلب إظهار المتصفح عند الضغطة فقط، ويحاول منع فتح تبويب مكرر. التقديم السريع مستقل عن عرض المشروع، ولا يحتاج عرض المشروع إضافة Chrome.

صلاحية الإشعارات الجديدة سبعة أيام. بعد انتهاء الصلاحية افتح المشروع من داخل راصد. لو Windows منع ظهور المتصفح في المقدمة، قد يظل التبويب مفتوحًا في الخلفية؛ لن يكرر راصد فتح الرابط أو يغيّر إعدادات Windows لإجباره على الظهور.

إشعارات متابعة المشاريع وملخص الغياب («حصل وأنت غايب») تستخدم نفس مسار تذاكر التفعيل. عند الضغط، يتحقق راصد من وجود المشروع محليًا: إذا كان موجودًا في قاعدة البيانات، يطلب راصد إظهار المتصفح الافتراضي ويفتح رابط المشروع. أمّا إذا حُذف المشروع من السجل المحلي، فيُظهر راصد نافذته الرئيسية بدلاً من فتح الرابط. إشعار الملخص يفتح أول مشروع فيه. وإذا فتح Windows الإشعار مباشرةً بدون تذكرة تفعيل، يفتح النظام الرابط المحفوظ في المتصفح الافتراضي دون المرور براصد، حتى لو حُذف المشروع محليًا. تفاصيل المتابعة في [PROJECT_WATCH.md](PROJECT_WATCH.md).
