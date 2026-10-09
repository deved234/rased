# Architecture

RASED is a Windows Electron/React/TypeScript app with SQLite (`node:sqlite`). It has no hosted backend.

| Directory | Responsibility |
| --- | --- |
| `src/main/` | App lifecycle, trusted IPC, polling orchestration, notifications and updates |
| `src/main/ai/` | Provider contracts, encrypted keys, catalogs, consent and generation |
| `src/main/extension/` | Local broker, pairing, native-host setup and job delivery |
| `src/preload/` | Restricted typed bridge; no renderer Node access |
| `src/renderer/` | React views, shared components, RTL/LTR and theme CSS |
| `src/collector/` | RSS/HTML parsing, scheduling, enrichment and backoff |
| `src/storage/` | SQLite repositories and ordered migrations |
| `src/shared/` | Validated contracts, IPC channels and reusable rules |
| `extension/`, `native-host/` | Chrome Manifest V3 extension and Windows native-messaging executable |
| `tests/`, `scripts/` | Deterministic fixtures, Vitest and isolated integration/build tooling |
| `resources/`, `docs/` | Runtime branding/licenses and maintained public documentation |

## Monitoring

Mostaql uses public RSS with optional detail enrichment; Khamsat uses its public requests listing; Nafezly uses its public RSS description without detail-page fetching. Healthy polling is approximately five seconds for Mostaql/Khamsat and 15–18 seconds for Nafezly. Each source has its own baseline, scheduler, pause and notification settings. Errors and `Retry-After` trigger backoff. Publication/feed delays remain outside the app's control.

The first successful fetch creates a silent baseline. Later discoveries are deduplicated and saved before filtered notification dispatch. The UI reads local data; it does not scrape account pages to monitor opportunities.

## Optional workflows

AI generation is user initiated, uses one chosen provider and requires a preview/consent fingerprint. The app saves editable drafts and never submits them. [Assistant guide](AI_ASSISTANT.md).

Quick Apply sends a snapshot to one paired Chrome profile through an authenticated local broker/native host. The content script checks the destination and fills permitted fields, preserving existing drafts. The retired embedded browser is not used. [Extension guide](QUICK_APPLY.md).

## Builds and data

`prebuild` generates legal notices, extension files and the native helper. `out/` contains compiled code; `release/` contains NSIS/update artifacts. Neither is committed. `resources/chrome-extension/` and `resources/chrome-bridge/` are generated and packaged outside ASAR.

User data lives under `%APPDATA%\RASED`. Never use a real profile in tests. Database schema upgrades preserve existing records. Settings exports exclude AI keys and browser credentials. Internal plans, research and generated QA screenshots stay in ignored `.local/` rather than public documentation.
