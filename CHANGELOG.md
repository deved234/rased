# Changelog

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
