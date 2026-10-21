# Architecture

RASED is a Windows Electron/React/TypeScript app with SQLite (`node:sqlite`). It has no hosted backend.

| Directory | Responsibility |
| --- | --- |
| `src/main/` | App lifecycle, trusted IPC, polling orchestration, notifications and updates |
| `src/main/ai/` | Provider contracts, encrypted keys, catalogs, consent and generation |
| `src/main/extension/` | Local broker, pairing, native-host setup and job delivery |
| `src/main/search/` | Bounded isolated SQL reader and on-demand public index builder |
| `src/preload/` | Restricted typed bridge; no renderer Node access |
| `src/renderer/` | React views, shared components, RTL/LTR and theme CSS |
| `src/collector/` | RSS/HTML parsing, scheduling, enrichment and backoff |
| `src/storage/` | SQLite repositories and ordered migrations |
| `src/shared/` | Validated contracts, IPC channels and reusable rules |
| `extension/`, `native-host/` | Chrome Manifest V3 extension and Windows native-messaging executable |
| `tests/`, `scripts/` | Deterministic fixtures, Vitest and isolated integration/build tooling |
| `resources/`, `docs/` | Runtime branding/licenses and maintained public documentation |

## Monitoring

Mostaql uses public RSS with optional detail enrichment; Khamsat uses its public requests listing; Nafezly uses its public RSS description and fetches public project-card budget/duration on demand when a project is previewed or opened. Healthy polling is approximately five seconds for Mostaql/Khamsat and 15–18 seconds for Nafezly. Each source has its own baseline, scheduler, pause and notification settings. Errors and `Retry-After` trigger backoff. Publication/feed delays remain outside the app's control.

The first successful fetch creates a silent baseline. Later discoveries are deduplicated and saved before filtered notification dispatch. The UI reads local data; it does not scrape account pages to monitor opportunities.

`src/shared/sources.ts` defines public source names, endpoints, control keys and capabilities for monitoring settings, tray controls and diagnostics. All four sources have persistent enable and alert flags plus a separate session-only pause. `src/shared/monitoring.ts` classifies status/errors and builds an explicit safe support report; `src/storage/monitoring.ts` records last discovery and possible coverage gaps within each discovery transaction. Later successful checks do not silently clear unresolved gaps. KAF can resolve its warning after verified pagination catch-up. [Monitoring health](MONITORING_HEALTH.md) describes user-facing behavior and `npm run test:monitoring`.

KAF is a fourth independent source from RASED 0.7.0. Its controller polls the public HTML fragment every 5–6 seconds, bounds catch-up to three pages per cycle and persists the cursor/backoff. Only newly visible open projects notify; baseline and recovery are silent. Details use a separate on-demand queue and 24-hour cache. Raw publication times retain their unverified timezone rather than populating `publishedAt`. Migration 8 adds nullable status/duration fields. KAF is excluded from AI and Quick Apply. [User guide](KAF.md); `npm run test:kaf` exercises actual Electron wiring with isolated fixtures.

## Optional workflows

Search filters/counts/pages run in a read-only utility process, independent of monitoring and startup readiness. Schema10 provides small public metadata, a separate normalized body cache, a contentless trigram candidate index and a durable dirty queue. Literal predicates verify candidates; absent cache falls back to source records. Another utility process builds the disposable index and exits when idle. Notes/drafts are normalized from originals only when explicitly included, never stored in derived indexes. [Project search](PROJECT_SEARCH.md) documents semantics, live snapshot ceilings, backup compatibility and `npm run test:search`.

Windows project notifications use Electron's persistent foreground activation handler and a local hashed destination ticket, independent of extension pairing. `src/main/notifications/` requests default-browser focus before URL delivery where the window can be identified, then observes the result without repeated activation. The main-only `koffi` Windows binding is bundled outside ASAR. No separate native-focus executable or system Node installation is required. Migration 9 adds non-portable notification tickets; schema-8 backups remain restorable. See [Notifications](NOTIFICATIONS.md) for limits and verification.

AI generation is user initiated, uses one chosen provider and requires a preview/consent fingerprint. The app saves editable drafts and never submits them. [Assistant guide](AI_ASSISTANT.md).

Quick Apply sends a snapshot to one paired Chrome profile through an authenticated local broker/native host. The content script checks the destination and fills permitted fields, preserving existing drafts. The retired embedded browser is not used. [Extension guide](QUICK_APPLY.md).

## Builds and data

Optional analytics is isolated behind explicit contracts in `src/shared/telemetry.ts`. Main owns consent; a dedicated worker and separate SQLite file own bounded aggregation, queueing and PostHog transport. No raw project data or administrative credentials enter the pipeline. It is off by default and unconfigured builds cannot send. Administrative dashboards/download snapshots/requested-person deletion live under `scripts/analytics/`, outside app bundles. No age-based server deletion is scheduled; provider policies and applicable legal requirements remain independent. Production sending is currently gated pending cloud QA and verified individual-request deletion. See [Analytics](ANALYTICS.md).

`prebuild` generates legal notices, extension files and the native helper. `out/` contains compiled code; `release/` contains NSIS/update artifacts. Neither is committed. `resources/chrome-extension/` and `resources/chrome-bridge/` are generated and packaged outside ASAR.

User data lives under `%APPDATA%\RASED`. Never use a real profile in tests. Database schema upgrades preserve existing records. Settings exports exclude AI keys and browser credentials. Internal plans, research and generated QA screenshots stay in ignored `.local/` rather than public documentation.

Settings transfer and portable backups are described in [Backup and restore](BACKUP_AND_RESTORE.md). Snapshot sanitation runs in `src/main/backupWorker.ts`; confirmed restoration runs at boot in one storage transaction before collectors/services start. API keys and extension pairing remain device-local.
