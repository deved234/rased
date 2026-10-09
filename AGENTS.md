# Repository Guidelines

## Project Structure & Module Organization

RASED is a Windows Electron/React/TypeScript/SQLite application monitoring Mostaql, Nafezly, and Khamsat independently.

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
- `npm run test:ui`: verify UI guards, field names and responsive layouts after building.
- `npm run test:ai`: test provider settings, consent, encrypted key migration, cancellation, and Electron wiring with synthetic API fixtures; build first.
- `npm run test:quick-apply`: verify extension setup UI and embedded-browser retirement.
- `npm run test:extension`: exercise Chrome, the standalone native host, pairing, and safe form filling.
- `npm run dist`: build a Windows NSIS installer in `release/`, without publishing.

## Coding Style & Naming Conventions

Follow neighboring code: two-space indentation, single quotes, and generally no semicolons. Use PascalCase for React components/types, camelCase for functions/variables, and uppercase constants. Keep IPC channels centralized in `src/shared/channels.ts`; synchronize API types and preload bindings. Keep SQL in storage modules. ESLint and TypeScript enforce checks; no dedicated formatter is configured.

## Testing Guidelines

Name Vitest files `tests/*.test.ts`. Add focused regression tests for changed behavior, using fixtures and injectable clocks where appropriate. No numeric coverage threshold is configured. Integration tests use fresh temporary profiles; never substitute real user data. Check Arabic RTL, English LTR, keyboard access, and unsaved-note protection for UI changes. Automated OS mocks do not prove real notification clicks.

## Commit & Pull Request Guidelines

History uses imperative subjects, such as `Prevent Gemini proposal JSON truncation`; Conventional Commit prefixes are not required. Keep changes focused. PRs should describe the problem, behavior, validation, and limitations; link issues and include screenshots for UI changes. Follow `CONTRIBUTING.md`.

## Security & Current Scope

Never commit credentials, browser profiles, databases, or generated builds. Preserve renderer isolation, URL validation, source backoff, and explicit update installation. Quick Apply uses `extension/`, `native-host/`, and `src/main/extension/`; Mostaql/Nafezly only, never Khamsat. Never submit offers or copy browser cookies. Consult `docs/QUICK_APPLY.md` for boundaries and verification. Do not bump versions or publish releases without explicit authorization.
