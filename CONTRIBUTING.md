# Contributing to RASED

RASED monitors Mostaql, Nafezly and Khamsat on Windows. Reliability, accessibility, Arabic/English usability and reproducible tests are welcome contributions.

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

After building, run `npm run test:ai` for AI settings, consent, encryption and provider integration; `npm run test:quick-apply` for Chrome setup and broker UI. `npm run test:extension` exercises a real Chromium/native-host/form-filling chain using intercepted HTTPS fixtures. It requires Chrome for Testing; set `RASED_TEST_CHROME` to its executable path. These tests never submit real proposals. Integration profiles and generated screenshots are temporary/ignored; never pass a real user profile.

Check Arabic RTL, English LTR, keyboard focus, both themes and unsaved edits for interface changes. Include representative screenshots in the PR. OS notification payload tests do not prove a real Windows toast click; document any manual checks separately.

## Pull requests

Use an imperative commit subject, for example `Preserve selected provider after restart`. Conventional Commit prefixes are optional. Explain the problem, resulting behavior, checks and remaining limits; link relevant issues. Keep unrelated changes separate.

See [Architecture](docs/ARCHITECTURE.md) for code ownership and [Updates](docs/UPDATES.md) for release commands. CI checks types, lint, unit tests, builds and Electron integration on Windows. Packaging and installer QA remain explicit local checks.

## Safety and repository hygiene

Never commit keys, databases, browser profiles, builds, captured platform pages or personal diagnostics. Internal plans/reviews and generated QA evidence belong in ignored `.local/`; public `docs/` is for maintained user/developer guides and release notes.

Keep renderer isolation, trusted IPC callers, URL validation, source backoff and explicit update installation. Monitoring is read-only. Quick Apply is Mostaql/Nafezly only, must preserve existing drafts, and must never submit a form or copy browser cookies. AI generation requires consent and must not silently retry or switch companies. Do not claim speed guarantees or platform permission based on RSS availability.

Version bumps and publication require maintainer authorization. Contributions are licensed under [MIT](LICENSE). For security reports, follow [SECURITY.md](SECURITY.md).
