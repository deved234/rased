# RASED 0.2.5 — Updates inside the app / تحديثات داخل راصد

## For users

Install **RASED-Setup-0.2.5.exe** once if you currently have 0.2.4 or an earlier release. Those builds have no updater and cannot gain this feature remotely. Quit the old app completely from the tray before this first installation; keep your application data folder.

From this version, go to **Settings → RASED updates**. RASED checks GitHub at startup and every 6 hours. A banner appears for an available update. Choose **Download update**, watch progress, then **Restart and update**. Installation is requested explicitly; ordinary quit does not install a pending update. Unsaved notes offer Save / Discard / Cancel first. Project data remains local.

## للمستخدم بالعربية

لو عندك 0.2.4 أو أقدم، ثبّت هذه النسخة يدويًا مرة واحدة بعد الخروج الكامل من Tray. بعدها تستطيع تحميل وتثبيت الإصدارات الجديدة من **الإعدادات → تحديثات راصد**. يظهر تنبيه داخل البرنامج، وملخص تغييرات وشريط تحميل وزر إعادة التشغيل والتحديث. لا تحتاج تنزيل المثبّت من المتصفح في كل مرة. لا تحذف مجلد البيانات عند الترقية.

## Implementation

- `electron-updater` with the existing Windows x64 NSIS installer and a public GitHub release feed. No private backend or user GitHub token.
- Stable releases only; no downgrades, automatic downloading or installation on ordinary app quit.
- Bilingual update page and global banner, plain-text release notes, download progress, error/retry states and development-mode protection.
- Installation approval passes the existing unsaved-note guard. The main process drains work and closes SQLite on the updater's quit path.
- Update metadata and blockmap are published with the installer; the release helper validates local SHA512/size and each uploaded asset's SHA256 before making the release public.
- Privacy disclosures include automatic connections to GitHub/release hosts. Project databases, notes and filters are not uploaded.

## Verification and limits

Typecheck, lint and 94 unit tests passed. The packaged RASED app passed 56 Electron/preload/React/SQLite integration assertions, including offline retry, opt-in download, progress, no install before approval, cancel retaining a dirty note and saving before invoking the installer. These UI integration checks replace the updater's native/network boundary.

A separate, uniquely named QA application used RASED's update controller and the real `NsisUpdater`: real NSIS install of 1.0.0 → local HTTP update metadata → download/checksum → silent installation → forced relaunch as 1.0.1. Its SQLite note survived, and the QA app was uninstalled. No real RASED installation or user database was modified by this QA cycle. This is a transport/installer verification, not a production RASED upgrade from a future GitHub release.

The installer remains unsigned: SHA512 validation checks download integrity, not publisher identity. Signature verification was not disabled; there is no signing publisher configured until a certificate is obtained. Interrupted installations, all Windows versions, UAC environments and upgrades with every possible user state have not been exhaustively tested. Future releases must include valid `latest.yml` and matching assets.

After publication, the real packaged RASED app successfully checked the public GitHub feed in a fresh temporary profile, with no updater fixture: current version 0.2.5, no newer version, no error. GitHub CI passed; all four uploaded asset digests were verified before publication.

SHA256 is provided in **SHA256SUMS.txt** under Assets. Source code ZIPs are for developers; end users should download the EXE. See [update guide](https://github.com/deved234/rased/blob/v0.2.5/docs/UPDATES.md).
