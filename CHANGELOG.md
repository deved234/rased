# Changelog

## 0.5.0 — 2026-10-09

- Added Gemini, OpenAI and Claude proposal generation with independent encrypted keys, model catalogs/manual IDs, per-draft selection, explicit consent and cancellation. Existing Gemini keys and local drafts migrate without intentional data loss. The assistant remains Mostaql-only.
- Added a free unpacked Chrome extension and bundled native-messaging helper for Quick Apply on Mostaql/Nafezly. Pair one browser profile, fill a saved template/budget position/extra days, then review and submit manually. Khamsat is excluded.
- Removed the embedded Quick Apply browser and its old sessions/tickets; normal browser login is used instead. Saved templates and source history remain local.
- Fixed the development taskbar icon by launching a branded executable; retained packaged application branding.
- Updated privacy/terms and reorganized public documentation. Internal plans, reviews, experimental designs and generated QA screenshots are retained locally outside Git.
- Expanded Windows CI to cover real Electron integration, AI wiring and extension setup in isolated profiles. Live provider accounts, platform forms and physical toast clicks are not certified by fixture tests.

## 0.4.0 — 2026-09-29

- Added read-only monitoring of public Nafezly project RSS with an independent 15–18 second scheduler, silent first scan, local full-description storage, source-specific pause and keyword alerts, and conservative backoff on access errors.
- Added Nafezly to project views, filters, status, tray and settings. Its project links and notification clicks open in the default browser.
- Refined the source-neutral Arabic/English interface, side preview and platform controls so RASED presents opportunities from all supported platforms.
- Updated offline terms, privacy disclosures and documentation for the third source. No account login or automated proposal submission was added.
- Validated 115 unit tests and 82 Electron/SQLite/React integration assertions before packaging. See [release notes](docs/RELEASE_0.4.0.md) for limits.

## 0.3.0 — 2026-09-28

- Added read-only monitoring of the public Khamsat unavailable-service requests listing. It has an independent five-second poller, silent first scan, publication-time freshness checks, error backoff, source filtering, title-keyword alerts and browser-opening notifications.
- Added a Gemini Proposal Assistant for Mostaql projects. Users provide their own API key and freelancer profile, review the data sent, then explicitly generate and edit a locally saved draft. No automatic submission.
- Improved Windows notification priority hints and added guidance for Focus Assist/Do not disturb. Windows and fullscreen applications still control whether a toast appears.
- Updated bilingual terms and privacy disclosures for Khamsat connections and optional Gemini requests. See [release notes](docs/RELEASE_0.3.0.md) for validation and limitations.

## 0.2.6 — 2026-09-26

- Windows project, summary and test notifications now use native HTTPS protocol activation. Clicking opens the default browser without depending on a retained Electron object or running RASED process. Existing notifications are unchanged.
- Package a real PNG outside ASAR for native toast branding; validate destinations and escape XML text.
- Protocol clicks do not reliably call back into RASED, so they no longer automatically mark projects read. In-app actions still do.
- Add native XML regression tests and update integration checks to assert the payload instead of claiming a simulated callback proves a Windows click.


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
- Improved collector shutdown, filter consistency and persisted backoff.
- Follow-up fixes for downloading a missing Electron executable and development CSS/CSP behavior.
