# RASED 0.2.4

Windows x64 desktop release by david atef. Includes all local updates since 0.1.1.

## For users / للمستخدم

Download `RASED.Setup.0.2.4.exe` from the release's Assets section. No Node.js, Electron or SQLite installation is needed. Run the installer and open RASED from the shortcut. To upgrade, quit the existing app fully from its tray menu first; do not delete the data directory. An initial successful RSS fetch establishes a silent baseline. New arrivals after that can trigger notifications. Click a notification to open the project in your default browser.

حمّل المثبّت من Assets، وليس Source code. ثبّت التطبيق وافتحه من الاختصار. النسخة تدعم العربية والإنجليزية وتخزن بياناتها محليًا. أول فحص لا يرسل تنبيهات للمشاريع القديمة. الإغلاق قد يُبقي المتابعة تعمل من أيقونة النظام حسب إعداداتك؛ استخدم قائمة الأيقونة للخروج بالكامل.

## Changes

- New bilingual UI, light/dark themes, project details and preview, saved filters, notes/bookmarks/statuses and compact view.
- List/filter/link/keyboard/focus fixes, protection for unsaved notes and collector lifecycle fixes.
- About page, offline terms/privacy/licenses and third-party notices.
- Custom window chrome, centered logo and branded application icons.
- Visible launch splash: local bootstrap milestones, Open projects button and automatic transition.
- Native notification retention and saved click destination; project and summary notifications open the browser directly.

## Validation and limits

Typecheck, lint, 88 unit tests, production build and Windows installer build passed. The packaged app passed 49 real Electron/preload/React/SQLite integration assertions in an isolated temporary profile. The integration harness replaces network and OS notification/browser boundaries; it invokes the real click closure and verifies its destination. This is not a manually verified click from Windows Notification Center. Launch/entry/automatic transition, Arabic/English splash, window controls and dirty-note guards were exercised.

The installer is unsigned. This release has not been newly installed/uninstalled or upgraded across all supported Windows environments. Historical notifications after the process fully exits are not guaranteed to relaunch the app. RSS publication timing and network latency prevent any guarantee of instant detection or being first.

RASED is independent of Mostaql/Hsoub. No written permission for the application's automated RSS/HTML access has been confirmed. MIT covers this repository's code, not third-party content or access permission. Read [TERMS](https://github.com/deved234/rased/blob/v0.2.4/TERMS.md), [PRIVACY](https://github.com/deved234/rased/blob/v0.2.4/PRIVACY.md) and [legal review](https://github.com/deved234/rased/blob/v0.2.4/docs/legal/LEGAL_REVIEW.md).

## Installer checksum

Download filename: `RASED.Setup.0.2.4.exe`; local build filename: `RASED Setup 0.2.4.exe`; bytes: 114794101. GitHub normalizes spaces in asset names; the bytes are identical.

SHA256:
```text
77B9A7624C4B31F5E170937DD5C3EB0D12FC9902835B09E4E534795CEF7BDB7D
```

PowerShell verification:
```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\RASED.Setup.0.2.4.exe'
```

Source and assets are provided together on the tagged GitHub release. Internal review reports describe their historical local state; this file describes the published 0.2.4 release.
