# Updates inside RASED

## User flow

0.2.5 is the first updater-capable release. Install it manually once if you are coming from 0.2.4 or earlier. Future stable versions can be downloaded and installed from Settings → RASED updates. Check runs about 10 seconds after launch and every 6 hours while the process is running. Manual check is also available. No forced download or install; ordinary tray quit does not install a downloaded update.

The page displays current/new versions, plain-text release notes, progress, last check time and retry states. The banner can be dismissed for the session. A downloaded update remains pending until requested. On restart, the updater can reuse its validated cache after checking the release again; the application does not pretend a previous session is still downloaded.

The main process restricts check/download/install IPC to the main window. Installation needs a main-generated request and renderer confirmation after `requestAction` has handled dirty notes. `autoInstallOnAppQuit=false`, `autoDownload=false`, `allowPrerelease=false`, `allowDowngrade=false`. During the updater quit path, existing shutdown aborts source requests, drains writes, closes SQLite and quits without asking the same draft question twice. The app's ID and data location are unchanged.

## Feed and integrity

`electron-updater@6.8.9` is a production dependency. Windows uses `NsisUpdater`. Packaged `resources/app-update.yml` points at public `deved234/rased` GitHub releases; no renderer-supplied URL or access token. Development builds show a disabled notice. A marked temporary integration profile uses a fixture boundary only; there is no production test IPC.

`npm run dist` builds locally with `--publish never`. Output:

- `release/RASED-Setup-<version>.exe`
- `release/RASED-Setup-<version>.exe.blockmap`
- `release/latest.yml` with exact installer filename, size and base64 SHA512.
- Packaged `resources/app-update.yml` for the fixed feed.

GitHub and metadata URLs use hyphenated filenames, so filename normalization cannot break update links. The updater verifies SHA512. Current releases are unsigned; this is not verification of a signed publisher. No signature bypass flag was added. The cache is normally under Windows LocalAppData's `rased-updater` directory, separate from the SQLite data folder. System/network/firewall policy may prevent download/install; use the displayed retry or the published installer if needed.

## Publishing the next release

1. Choose patch for fixes, minor for features, or major for breaking changes (`npm version <version> --no-git-tag-version`), update README/CHANGELOG and add `docs/RELEASE_<version>.md`.
2. Run typecheck, lint and tests; run relevant integration checks for changed behavior. Build with `npm run dist`.
3. Commit all source changes and push `main`. Wait for GitHub checks to pass.
4. Run `npm run release` after authenticating `gh` to the repository. This command **publishes**, unlike `npm run dist`.

The helper requires a clean checkout matching `origin/main`, checks `latest.yml` against the installer bytes, creates SHA256SUMS.txt, creates a draft release, uploads EXE/blockmap/latest.yml/checksum, checks GitHub digests and publishes only when every asset matches. `npm run release -- --dry-run` validates local artifacts and writes the checksum without changing GitHub. If upload fails, inspect the draft; do not publish an incomplete release or overwrite an already released version. A released bad version should be fixed with a higher version number.

Fork maintainers must change `build.publish.owner/repo` and app identity intentionally before distributing their own update channel. Never put publishing tokens in packaged application files.

## Tests and remaining limits

- `tests/updates.test.ts`: 6 unit cases for gating/concurrency/retries/invalid metadata/install errors/late error cleanup.
- `scripts/e2e-cdp.mjs`: real app IPC and UI with an updater boundary fixture; notes and metadata use real SQLite.
- `npm run test:update-install`: a real NSIS upgrade of a uniquely named QA app built from the controller. Requires Windows, Node/npm and Electron builder; installs only the QA ID in a verified TEMP directory, disables shortcuts and uninstalls it afterward. QA build/profile files are retained for diagnosis. It does not publish anything or modify RASED's normal install/data folders.
- This does not prove every Windows version, recovery from power loss during installation, or a full production RASED upgrade via a future GitHub release. Packaged production checks cover the current feed when published; future metadata must remain correct.

A prior isolated QA cycle verified real NSIS update installation, relaunch and SQLite preservation. These tests do not guarantee every future production upgrade. Published asset digests are validated against local files before each release.

The upstream `lazy-val` package declares MIT but supplies no license/copyright file in npm or its repository. Its declaration and standard MIT terms are transparently documented in `docs/legal/lazy-val-license-declaration.txt`; no copyright year or recovered upstream notice is invented. The generated notices now include updater runtime dependencies.

Official implementation reference: https://www.electron.build/v26/docs/features/auto-update/.
