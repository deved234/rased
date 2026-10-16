# Settings transfer, backups and recovery

Open **Settings → Data**. These operations are local; RASED uploads neither exports nor backups. This guide describes the current source; use a build containing these controls.

## Transfer settings

**Export settings** writes a JSON file containing all supported platform preferences, keywords/exclusions, filters, appearance, the Quick Apply template, the professional profile and AI provider/model choices.

**Import settings** previews the included preferences and filter changes before applying them. Merge keeps other saved filters; replace replaces the saved-filter collection. Included preferences are overwritten in either mode; preferences missing from an older file remain unchanged. Version 1 exports remain supported. Windows startup changes require a separate opt-in, including disabling startup.

The file excludes projects, notes, drafts, API keys, browser sessions, pairing credentials, temporary DND, window coordinates and device-local backup scheduling. It is **unencrypted** and includes user-entered professional/profile/template text: review before sharing.

## Complete backups

**Create backup** saves a `.rased-backup` file containing projects from all four sources, fetched details, read/bookmark/hidden/personal states, notes, proposal drafts and metadata, filters and portable preferences. SQLite produces a consistent snapshot including WAL writes; background sanitization runs in a separate worker. Unknown settings, diagnostics, AI verification caches, pairing/submission tickets and pending actions are excluded. API key files and Chrome data are never copied.

Backups are unencrypted. Keep a private copy on another drive if you need protection against disk failure. Copies on the same drive cannot provide that protection.

## Restore

1. Choose a backup and review its creation time, version and current/incoming counts. No data changes during preview; you can cancel.
2. Optionally import its Windows startup preference. The default preserves the current device setting.
3. Confirm **Restore and restart**. RASED waits for active work and closes the database normally.
4. At startup, a fresh rollback copy is saved under the application's `backups/` folder. Archive replacement uses one SQLite transaction before monitoring and AI services start. If rollback creation or replacement fails, the old data remains.

Restore replaces the archive, profile, portable settings and model choices; it does not merge projects. Keys, local pairing, backup schedules, temporary DND and compact-window position on the receiving device stay local. Quick Apply is disabled for review. Active local source cooldowns are preserved. Old pending notifications and submission tickets cannot replay. A rollback copy is itself a portable backup that you can select to undo a restore while it remains retained.

Preview uses a private checked copy, expires after ten minutes, and is protected against modification. A committed restore ID prevents repeating it after interrupted cleanup. In development, restart the development command manually if its server stops during the application restart.

## Automatic copies and damaged databases

Automatic copies are **off by default**. Choose daily or weekly and retain 3, 5 or 10 automatic/rollback copies. The schedule is checked each minute while RASED is running; it does not wake a sleeping or closed application. Failed automatic attempts retry after at least 30 minutes. Manually saved exports and before-history-deletion copies are not pruned. **Open local backups folder** shows managed files.

If SQLite reports a corrupt/unreadable database at startup, RASED offers backup selection and a separate confirmation. It first builds a verified replacement, preserves the damaged database and its WAL/SHM files under `backups/recovery-*/`, then activates the recovered copy. Invalid archives leave the original files untouched. Preserved damaged files are for diagnosis, not portable backups.

Only the versioned RASED backup format is accepted, currently schema 8 and up to 512 MiB. Older raw `.db` safety copies are not imported automatically. Settings JSON is limited to 1 MiB. A backup from a newer schema requires a compatible newer application; future schema migrations must update backup validation explicitly.

## Verification for contributors

Run `npm run typecheck`, `npm run lint`, `npm test`, then `npm run build` and `npm run test:data`. The integration script uses fresh TEMP profiles, synthetic keys, real Electron/preload/SQLite and scoped file-picker fixtures; it never substitutes a real profile. It tests transfer, legacy files, cancellation, damaged files, restore across restart, rollback freshness, key isolation and Arabic/English layouts. Use `node scripts/data-e2e.mjs --exe=<unpacked-executable> --app=` for a packaged build.
