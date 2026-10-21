# Changelog

## Unreleased

## 0.9.1 — 2026-10-21

- Enabled optional usage analytics in the official configured build, only after explicit user consent; ordinary development and fork builds remain unconfigured.
- Added a bilingual pre-consent disclosure that completed cloud-event deletion is still awaiting end-to-end verification. The owner explicitly accepted deferring that check; no deletion-completion claim is made. Updated disclosure version preserves prior declines and requires renewed approval from earlier participants.
- Added a manual GitHub build using the existing reviewed ingest secret, package destination/isolation verification and artifact-only upload. Administrative tokens remain excluded.
- Allowed a bounded cold-start budget for the local identity-cleanup worker while retaining the overall deadline and verified purge requirement. Added a delayed-start/restart regression and waited for the previous test debugging endpoint to close before reusing its port.
- Activated the separately gated public GitHub installer-counter workflow as part of launch verification. Local search behavior and its documented performance limits are unchanged.

## 0.9.0 — 2026-10-21

- Expanded literal Arabic/Unicode search to cached project descriptions, with separate opt-ins for personal notes and proposal drafts and labels showing the matching fields.
- Moved SQL filtering, counts and pagination into a bounded read-only utility process, and incremental public indexing into a separate process that exits when idle. Monitoring stays independent of search failures.
- Preserved deferred arrivals and browsing windows during live detail/note changes; added IME-aware debounce, batched refreshes and explicit search errors with retry.
- Added schema-10 disposable public indexes and schema-8/9 backup compatibility. Portable archives omit derived indexes; restore rebuilds them without persisting normalized personal text.
- Added bounded Windows startup retries for transient SQLite WAL mapping failures, preserved committed data and explicit startup failure handling.
- Added optional analytics controls, an isolated queue/worker and maintainer tools with replay-safe counters, cancellation and resumable local identity cleanup. **Production application-usage collection is disabled in this release** pending verified requested-person cloud deletion; the installer has no ingest token.
- Updated privacy, terms, architecture and feature guides, and expanded real Electron, backup, monitoring, search and telemetry regression checks.
- Documented deferred performance work: a synthetic 50,000-project archive measured a first cold text search around three seconds; some warm queries and index-write transactions exceeded internal targets. See [search limits](docs/PROJECT_SEARCH.md#known-performance-limits-in-090).

## 0.8.1 — 2026-10-17

- Fixed source-development notification activation launching Electron's welcome screen: an explicit COM relay preserves the app entry and profile, handles activation separately from the singleton lock, and forwards body/View project tickets through the existing validated dispatcher. Owned legacy development shortcut classes now redirect to the active class as well.
- Added persistent Windows foreground notification activation and a default-browser focus request on project clicks, with separate delivery/focus diagnostics and no automatic duplicate opening when focus is denied.
- Added hashed seven-day notification destinations, duplicate handoff protection, hidden startup for notification activation, and backup/restore isolation while retaining schema-8 backup support. Development protocol/shortcut registration is separated from the installed app.
- Added notification lifecycle and browser-focus regressions. Windows may still deny activation; see [notification behavior](docs/NOTIFICATIONS.md).

## 0.8.0 — 2026-10-16

- Individual project/request notifications now start with the platform name in the interface language, before the project title, across all four sources.
- Added complete local backup/restore with preview, rollback copies, optional daily/weekly backups and damaged-database recovery. Settings transfer now includes all supported platform preferences, professional profile and model choices, while excluding API keys and browser pairing.
- Unified independent platform enable/pause/notification controls, health states, last discovery/check timestamps and local support reports. Fixed manual Khamsat refresh respecting stored cooldowns.
- Added persistent possible-gap warnings and KAF catch-up status. Project-list notices share one compact, keyboard-accessible disclosure with individual acknowledgement and bounded details.
- Fixed on-demand budget/duration metadata and shared preview/detail rendering for Mostaql, Nafezly and KAF. Cached descriptions no longer block missing metadata; failed refreshes preserve values and Khamsat limitations are explicit.
- Fixed Windows taskbar identity collisions between installed and development builds, added complete relaunch metadata and repaired conflicting legacy development shortcuts.
- Fixed a Chrome Quick Apply startup race where a fast-loading project page could leave preparation stuck at opening. Added a real-browser regression; login and existing-draft safeguards remain in place.
- Expanded the founder/About page, maintained privacy and user guides, and added isolated backup, monitoring and metadata regression checks.

## 0.7.0 — 2026-10-14

- Added KAF (formerly Kafiil) as a fourth independent source using its public project list, with a silent initial baseline, 5–6 second healthy polling, open-project alerts and persisted source backoff.
- Added bounded catch-up with a persisted cursor, cancellation on pause/disable/sleep/quit, on-demand cached descriptions and verified budget, skill, category, duration and platform-status data.
- Integrated KAF into Arabic/English lists, previews, details, source controls, saved filters, compact view, tray, notification keywords and settings transfer. KAF links open in the default browser; AI and Quick Apply remain excluded for this source.
- Preserved raw KAF publication times without assuming a timezone, and kept platform status separate from personal status. Scoped paused-source messages to their actual source.
- Updated terms, privacy and maintained guides. Added collector/storage/scheduler regressions, real Electron KAF integration and four-source responsive UI coverage to Windows CI.


## 0.6.0 — 2026-10-09

- Refined Arabic/English layouts, text contrast, keyboard focus, cards and settings navigation. Preview actions stay available while the description scrolls.
- Protected Quick Apply templates, AI configuration/profile, draft edits and notification keywords against accidental navigation and failed saves. Settings are persisted before live state changes.
- Added preparation status beside its matching project, translated job phases and clearer Chrome setup/pairing states. Updated the extension popup identity and language.
- Added an optional compact-window display filter, shortened local startup presentation, and loaded settings on demand.
- Fixed saved-filter name editing, prevented repeated mutations, improved error recovery, legal tab navigation and field labels. Added responsive UI integration coverage and maintained interface guides/screenshots.


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
