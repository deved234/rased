# Contributing to RASED

RASED monitors Mostaql, Nafezly, Khamsat and KAF on Windows. Reliability, accessibility, Arabic/English usability and reproducible tests are welcome contributions.

## Get started

Use Windows x64 and Node.js 24. Fork/clone the repository, run `npm ci`, then `npm run dev`. Electron, SQLite, the Chrome extension and its native host are built by the project; no separate SQLite installation is required.

Open an issue for substantial changes. Small fixes may go straight to a pull request. Follow neighboring TypeScript/CSS style: two spaces, single quotes, generally no semicolons. React components use PascalCase; functions use camelCase. ESLint and TypeScript are the configured checks.

## Validate your change

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Vitest tests belong in `tests/*.test.ts`; deterministic samples belong in `tests/fixtures/`. Add regression coverage for behavior changes. There is no numeric coverage target.

After building, run `npm run test:ai` for AI settings, consent, encryption and provider integration; `npm run test:quick-apply` for Chrome setup and broker UI. `npm run test:extension` exercises a real Chromium/native-host/form-filling chain using intercepted HTTPS fixtures. Install its isolated test browser with `npx playwright-core install chromium`, or set `RASED_TEST_CHROME` to a compatible Chrome for Testing executable. The default path follows the locked Playwright version. Windows CI installs this browser and runs the extension checks too. These tests never submit real proposals. Integration profiles and generated screenshots are temporary/ignored; never pass a real user profile.

`npm run test:ui` verifies UI navigation, saved-filter editing, actual SQLite save failures, field names, legal-tab keyboard behavior and responsive layouts in isolated Electron. Its screenshots/results go to ignored `.local/`. Build first.

`npm run test:kaf` verifies the real KAF main/preload/SQLite/UI chain, independent pause, detail caching, cancellation, source backoff across restart and exclusion from AI/Quick Apply. The public content and OS boundaries are synthetic; no account or live project is contacted. Build first.

`npm run test:data` verifies settings transfer, complete backups, restore across process restart, rollback freshness, key isolation, corrupt-database recovery and Arabic/English confirmation layouts. It uses fresh TEMP profiles and scoped file-picker fixtures. See [Backup and restore](docs/BACKUP_AND_RESTORE.md); build first.

Check Arabic RTL, English LTR, keyboard focus, both themes and unsaved edits for interface changes. Include representative screenshots in the PR. OS notification payload tests do not prove a real Windows toast click; document any manual checks separately.

`npm run test:monitoring` verifies independent source controls, persistent Mostaql disable/mute, cancellation, possible coverage gaps, private-data-free support reports and cooldown guards across all four actual controllers. It uses synthetic transport/clipboard boundaries and fresh TEMP profiles. See [Monitoring health](docs/MONITORING_HEALTH.md); build first.

`npm run test:project-facts` verifies Mostaql/Nafezly/KAF on-demand metadata, old description caches, shared preview/detail rendering, honest Khamsat limitations, retained values after failure and source cooldowns. See [Project details](docs/PROJECT_DETAILS.md); build first.

## Pull requests

`npm run test:search` verifies the isolated search reader, literal Unicode matching, opt-in personal fields, deferred arrivals and Arabic/English filter controls. Build first. Search/cache changes also require `npm run test:data` and `npm run test:monitoring`; keep current schema-8/9 backups compatible and do not persist derived personal text. See [Project search](docs/PROJECT_SEARCH.md).

`npm run test:telemetry` checks the built worker and Electron consent/queue/UI chain with synthetic transport and fresh TEMP profiles. Build first. Changes to analytics must preserve opt-in, renewed consent after disclosure changes, runtime field allowlists, backup isolation and the production configuration gate. Never use real administrative keys in tests. [Analytics](docs/ANALYTICS.md) documents definitions, the absence of scheduled expiry and the remaining cloud QA/individual-deletion prerequisites.

Use an imperative commit subject, for example `Preserve selected provider after restart`. Conventional Commit prefixes are optional. Explain the problem, resulting behavior, checks and remaining limits; link relevant issues. Keep unrelated changes separate.

See [Architecture](docs/ARCHITECTURE.md) for code ownership and [Updates](docs/UPDATES.md) for release commands. CI checks types, lint, unit tests, builds and Electron integration on Windows. Packaging and installer QA remain explicit local checks.

## Safety and repository hygiene

Never commit keys, databases, browser profiles, builds, captured platform pages or personal diagnostics. Internal plans/reviews and generated QA evidence belong in ignored `.local/`; public `docs/` is for maintained user/developer guides and release notes.

Keep renderer isolation, trusted IPC callers, URL validation, source backoff and explicit update installation. Monitoring is read-only. Quick Apply is Mostaql/Nafezly only, must preserve existing drafts, and must never submit a form or copy browser cookies. AI generation requires consent and must not silently retry or switch companies. Do not claim speed guarantees or platform permission based on RSS availability.

Version bumps and publication require maintainer authorization. Contributions are licensed under [MIT](LICENSE). For security reports, follow [SECURITY.md](SECURITY.md).
