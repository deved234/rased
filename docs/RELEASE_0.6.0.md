# RASED 0.6.0

This release improves everyday navigation, readability and editing safety while keeping monitoring local and independent across Mostaql, Nafezly and Khamsat.

## What's improved

- Calm dark/light themes with clearer text contrast and keyboard focus, Arabic/English field labels, responsive cards and settings navigation.
- Side-preview actions remain visible while its description scrolls. Full in-app details and the platform link remain separate actions.
- Unsaved Quick Apply templates, AI configuration/profile, draft edits and notification keywords offer Save and continue, Discard edits or Stay here. Failed saves retain edits; a failed database write no longer changes live settings first.
- Saved filters retain their names when edited, with clearer errors and protection against repeated saves/deletions.
- Chrome preparation status appears beside the matching project. Setup distinguishes pairing from connectivity, translates job states and offers cancellation only for active jobs. The extension popup matches RASED's identity and language.
- The compact window optionally follows the main list's display filter; it shows the latest eight opportunities by default. Startup presentation is shorter and settings load on demand.

## Install or update

Download **RASED-Setup-0.6.0.exe** and compare its SHA256 with **SHA256SUMS.txt**. Windows x64; no separate Node.js or SQLite installation required. The installer is unsigned.

Users on 0.2.5+ can use **Settings → RASED updates → Download → Restart and update**. Earlier versions need a manual installation. Keep the existing app-data directory.

For Quick Apply, reload the unpacked extension in Chrome after updating; use Prepare/repair extension files if its local files need refreshing. Pairing and manual review remain required. Quick Apply supports Mostaql/Nafezly only and never submits offers. The AI assistant remains Mostaql-only.

[Interface guide](https://github.com/deved234/rased/blob/v0.6.0/docs/INTERFACE.md) · [Chrome setup](https://github.com/deved234/rased/blob/v0.6.0/docs/QUICK_APPLY.md) · [AI assistant](https://github.com/deved234/rased/blob/v0.6.0/docs/AI_ASSISTANT.md).

## Validation and limits

- TypeScript, ESLint, 187 unit tests, 82 Electron/SQLite integration checks, 32 AI checks, 23 Quick Apply checks and 28 Chromium/native-host extension checks passed during implementation.
- The packaged application passed the AI and Quick Apply checks; the packaged Chrome helper passed the extension checks. The installer is 137,846,647 bytes (about 138 MB), with matching SHA512 update metadata.
- UI checks cover actual SQLite save failure, retained edits, keyboard interaction, field names, compact filtering and 32 language/theme/window/text-scale layout combinations.
- Network/OS boundaries are simulated where documented. These checks do not certify live provider credentials, every platform form, physical Windows toast clicks, Narrator or every Windows display configuration.
- Settings export is not a full backup of projects, notes or proposal drafts. Keys and browser sessions are excluded.
- Monitoring intervals, source backoff and explicit update installation remain unchanged. There is no guarantee of instantaneous discovery or first submission.

[Privacy](https://github.com/deved234/rased/blob/v0.6.0/PRIVACY.md) · [Terms](https://github.com/deved234/rased/blob/v0.6.0/TERMS.md) · [MIT](https://github.com/deved234/rased/blob/v0.6.0/LICENSE).
