# Repository Guidelines

## Project Structure & Module Organization

RASED is a Windows Electron/React/TypeScript/SQLite application monitoring Mostaql, Nafezly, Khamsat, and KAF independently.

- `src/main/`: Electron lifecycle, IPC, notifications, updates, and polling orchestration.
- `src/preload/`: restricted, typed renderer API.
- `src/renderer/`: React views, components, and CSS.
- `src/collector/`: source fetching, parsing, enrichment, and scheduling.
- `src/storage/`: SQLite repositories and migrations; `src/shared/`: contracts and reusable rules.
- `tests/` and `tests/fixtures/`: unit tests and deterministic samples.
- `scripts/`: build and integration tooling; `resources/`: branding and bundled legal assets; `docs/`: public feature guides, architecture, release notes, and selected screenshots. Internal plans/reports and generated QA captures belong in ignored `.local/`.

## Build, Test, and Development Commands

Use Windows and Node.js 24 with npm.

- `npm ci`: install locked dependencies.
- `npm run dev`: launch Electron with the React development server.
- `npm run typecheck` / `npm run lint`: check TypeScript and ESLint.
- `npm test`: run Vitest unit tests.
- `npm run build`: generate legal assets and compile into `out/`.
- `npm run test:e2e`: test built Electron/preload/SQLite integration; build first.
- `npm run test:notification-activation`: verify persistent notification destinations, hidden activation startup and duplicate handoffs with isolated OS fixtures; build first. Real foreground behavior needs a separate Windows click test.
- `npm run test:ui`: verify UI guards, field names and responsive layouts after building.
- `npm run test:ai`: test provider settings, consent, encrypted key migration, cancellation, and Electron wiring with synthetic API fixtures; build first.
- `npm run test:quick-apply`: verify extension setup UI and embedded-browser retirement.
- `npm run test:extension`: exercise Chrome, the standalone native host, pairing, and safe form filling.
- `npm run test:kaf`: test KAF monitoring, cancellation, details, cooldown persistence and UI through isolated Electron fixtures; build first.
- `npm run test:data`: verify settings transfer, complete backup/restore, rollback, key isolation and damaged-database recovery in fresh profiles; build first.
- `npm run test:monitoring`: verify independent source controls, persistent disabling, coverage warnings and cooldown guards in isolated Electron fixtures; build first.
- `npm run test:project-facts`: verify cached/on-demand budget and duration in preview and full details, source cooldowns, and honest missing-data states; build first.
- `npm run test:search`: verify isolated SQL search, private-field opt-ins, Unicode, live result windows and bilingual filter controls using TEMP profiles; build first. See `docs/PROJECT_SEARCH.md`. Cache/index data is public and disposable; never persist normalized notes/drafts or move archive scans back into Electron main.
- `npm run test:telemetry`: verify built-worker retry/revocation, resumable identity cleanup, bilingual controls, real collector counters, graceful shutdown and backup restore with synthetic transport; build first. No scheduled expiry; changed disclosures require fresh consent from previously enabled participants while preserving declines. Production capture stays gated until individual-request cloud deletion and QA are verified.
- `npm run test:startup`: hold a real Windows WAL mapping across a crashed fixture writer; verify bounded startup retry, preserved data and clean failure handling. Build first; TEMP profiles only.
- `npm run dist`: build a Windows NSIS installer in `release/`, without publishing.

## Coding Style & Naming Conventions

Follow neighboring code: two-space indentation, single quotes, and generally no semicolons. Use PascalCase for React components/types, camelCase for functions/variables, and uppercase constants. Keep IPC channels centralized in `src/shared/channels.ts`; synchronize API types and preload bindings. Keep SQL in storage modules. ESLint and TypeScript enforce checks; no dedicated formatter is configured.

## Testing Guidelines

Name Vitest files `tests/*.test.ts`. Add focused regression tests for changed behavior, using fixtures and injectable clocks where appropriate. No numeric coverage threshold is configured. Integration tests use fresh temporary profiles; never substitute real user data. Check Arabic RTL, English LTR, keyboard access, and unsaved-note protection for UI changes. Automated OS mocks do not prove real notification clicks.

## Commit & Pull Request Guidelines

History uses imperative subjects, such as `Prevent Gemini proposal JSON truncation`; Conventional Commit prefixes are not required. Keep changes focused. PRs should describe the problem, behavior, validation, and limitations; link issues and include screenshots for UI changes. Follow `CONTRIBUTING.md`.

## Security & Current Scope

Never commit credentials, browser profiles, databases, or generated builds. Preserve renderer isolation, URL validation, source backoff, and explicit update installation. Quick Apply uses `extension/`, `native-host/`, and `src/main/extension/`; Mostaql/Nafezly only, never Khamsat. Never submit offers or copy browser cookies. Consult `docs/QUICK_APPLY.md` for boundaries and verification. Do not bump versions or publish releases without explicit authorization.
