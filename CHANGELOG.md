# Changelog

## 0.2.5 — 2026-09-26

- Added in-app updates from public GitHub Releases using electron-updater and NSIS.
- Added automatic startup/6-hour checks, a bilingual settings page and banner, release notes, opt-in download/progress and explicit restart/install.
- Preserved dirty-note approval and graceful SQLite shutdown. Disabled installation on ordinary quit and automatic downloads.
- Added matching update metadata/blockmaps, a publication helper that verifies asset digests, updater privacy disclosures and runtime license notices.
- Validated 94 unit tests, 56 packaged-app integration assertions and a real isolated QA NSIS upgrade/relaunch with preserved SQLite data. See [update guide](docs/UPDATES.md) for limits.
- Users on 0.2.4 or older need one manual installation of this first updater-enabled release.

## 0.2.4 — 2026-09-26

This release includes the local changes since the previously published 0.1.1.

- Redesigned Arabic/English interface with light/dark themes, project details, paging, preview pane, saved filters, local notes/bookmarks/statuses and a compact follower window.
- Fixed filter consistency, list position retention, keyboard/focus behavior, unsaved-note protection and project links opening in the default browser.
- Hardened collector shutdown, pending-notification dispatch and persisted backoff. Added detail fetching with a shared request budget and explicit uncertainty handling.
- Added a bilingual About page crediting david atef, and offline terms, privacy and dependency license pages. These do not imply permission from Mostaql for automated access.
- Added branded window controls, centered vector compass artwork and application/tray/installer icons.
- Improved launch splash with actual local bootstrap milestones, an entry button and automatic transition. Monitoring runs independently of the splash.
- Retained native notification objects and the original project URL for click handling; individual and summary notifications open the browser, without navigating inside RASED.
- Added real Electron/preload/React/SQLite integration checks, release documentation and Windows CI for type checking, lint, unit tests and build.

Validation: 88 unit tests and 49 integration assertions passed locally on the packaged Windows app. OS toast activation, installer upgrades and all Windows versions have not been fully exercised; see [release notes](docs/RELEASE_0.2.4.md).

## 0.1.1 — 2026-09-25

- Initial published open-source release under MIT.
- Reliability fixes documented in [FIX_REPORT.md](FIX_REPORT.md).
- Follow-up fixes for downloading a missing Electron executable and development CSS/CSP behavior.
