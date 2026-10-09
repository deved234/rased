# RASED 0.5.0

This release adds multi-provider AI drafts and Chrome Quick Apply while keeping monitoring and data local.

## What's new

- **Gemini, OpenAI and Claude:** separate encrypted API keys, provider/model selection, requested catalog refresh, manual model IDs, per-draft choices, preview consent and cancellation. The assistant currently supports Mostaql projects only.
- **Chrome Quick Apply:** a free unpacked extension for Mostaql/Nafezly, paired to one Chrome profile. Fills your saved proposal, position within the budget range and extra days. **You review and submit manually.** Khamsat is excluded.
- Retired the embedded browser; use your normal Chrome login, including Google sign-in. Saved templates/source history are preserved; legacy embedded sessions and activation tickets are removed.
- Branded development taskbar executable, updated privacy/terms, public user/developer guides and expanded Windows CI. Internal implementation plans/reports are no longer published in the current repository tree.

## Install or update

Download `RASED-Setup-0.5.0.exe` below and verify it against `SHA256SUMS.txt`. Windows x64 only; no Node.js or SQLite installation is needed. The installer is **unsigned**.

Users on 0.2.5+ can use Settings → RASED updates → Download → Restart and update. Older versions need one manual installation. Keep your existing app-data directory.

Quick Apply requires one manual Chrome extension installation/pairing. See [the setup guide](https://github.com/deved234/rased/blob/v0.5.0/docs/QUICK_APPLY.md). For AI keys/models see [the assistant guide](https://github.com/deved234/rased/blob/v0.5.0/docs/AI_ASSISTANT.md). Keys are not included in settings exports.

## Known limits

- Provider contracts and integration are tested with synthetic responses, **not live API keys** for this release. Account access, quota, model compatibility and output quality depend on the provider.
- Chrome/form tests use intercepted fixture pages; live platform changes or protection may require manual completion. Physical Windows notification clicks have not been certified. Windows controls notification display.
- On a brand-new profile, force-killing before the first normal app exit can prevent encryption state from persisting and require key re-entry. Normal exit/restart preserves keys; crash-proof storage is not guaranteed.
- The native helper bundles a runtime, increasing download size. No guarantee of immediate discovery or first submission relative to other users.

Monitoring remains read-only and independent across Mostaql, Khamsat and Nafezly. Review [Privacy](https://github.com/deved234/rased/blob/v0.5.0/PRIVACY.md) and [Terms](https://github.com/deved234/rased/blob/v0.5.0/TERMS.md).

## Validation

- TypeScript checks, ESLint and **185 Vitest tests** passed.
- The compiled Windows application passed **82 general integration assertions**, **32 AI integration checks** and **22 Quick Apply setup/broker checks** using isolated profiles.
- Real Chromium with the helper copied from packaged resources passed **28 extension checks**, including persisted pairing, draft preservation and zero submitted requests.
- The NSIS installer and update metadata were generated successfully. Packaged contents contain no internal docs, tests, research, credentials or user databases. The installer is 137,840,402 bytes (approximately 138 MB).
- Integration checks substitute network/OS boundaries where documented. They do not prove live API authentication, real platform form compatibility, physical toast clicks or a production installer upgrade on every machine.
