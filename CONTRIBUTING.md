# Contributing to RASED

RASED is a local Windows app that watches the public Mostaql RSS feed. Contributions are welcome, especially fixes to reliability, accessibility, Arabic/English UI, and tests.

1. Open an issue describing the change or bug. For small fixes, you can send a pull request directly.
2. Install Node.js 24, clone the repository, run `npm ci`, then `npm run dev`.
3. Before a pull request, run `npm run typecheck`, `npm run lint`, and `npm test`.
4. Keep the collector respectful of Mostaql: no login scraping, no bypassing protection, and always honor backoff and `Retry-After`.
5. Do not commit credentials, user databases, generated `out/` or `release/` files, or captured third-party pages.

For UI changes, check Arabic RTL and English LTR, keyboard focus and dirty-note navigation. Use `npm run build` then `npm run test:e2e` for real Electron/preload/SQLite integration checks. This test uses a new temporary profile and substitutes network/OS boundaries; it does not prove a manually clicked Windows toast. Windows CI runs typecheck, lint, unit tests and build on pushes and pull requests. Installer packaging and interactive desktop checks are separate local checks.

Project map: `src/main` owns Electron, polling, IPC and notification dispatch; `src/preload` exposes the restricted API; `src/renderer` contains React; `src/collector` fetches/parses source data; `src/storage` owns SQLite; `src/shared` contains contracts and shared rules. Runtime data is in the user's application-data directory, never in the repository. See [release notes](docs/RELEASE_0.2.4.md) for current behavior and limits.

Keep Mostaql access limitations and independent branding explicit. Do not describe public RSS or MIT as permission for automated access; consult [legal review](docs/legal/LEGAL_REVIEW.md). Please redact personal notes and diagnostics before attaching them to public issues.

The app is licensed under [MIT](LICENSE). By submitting a contribution, you agree that your contribution is licensed under the same terms.

For updater changes, read [UPDATES.md](docs/UPDATES.md). Keep downloading and installation explicit, retain the dirty-note guard and graceful shutdown, and never allow renderer-controlled feeds or bundle publishing tokens. `npm run test:update-install` performs a real isolated QA NSIS upgrade on Windows and can take several minutes; it does not use a normal RASED install/profile. Publishing is a separate explicit `npm run release` command after validation/build/commit/push; `dist` never publishes.
