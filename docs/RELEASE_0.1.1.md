# RASED 0.1.1

Windows x64 installer for the local Mostaql RSS watcher. No account or server is needed; each installation fetches the public feed directly.

Changes since 0.1.0: RSS timeouts include the response body; display keywords affect list/count/pagination; backoff survives restart and applies to manual refresh; pending notifications follow current settings; uncertain categories wait up to 30 seconds and survive restart; configured polling interval is accurate; Tray mute syncs with the UI; unchanged feed cycles no longer reset pagination.

Download `RASED Setup 0.1.1.exe` from this release, run it, then open RASED from the Start menu. The first successful fetch establishes a baseline without alerting on the existing projects. Later discoveries can raise Windows notifications. This installer is **not code-signed**; verify that you downloaded it from the official repository and compare its SHA-256 if needed.

SHA-256: `3848BD17D39842C7D6C88E943A1695014C55A1E3CA3C0F34907895D0DE9D48CD`

Validation: 58 automated tests, TypeScript typecheck, ESLint, and installer build passed. This exact installer has not yet been tested through install/uninstall or live discovery after the fixes. RSS publication timing is outside the app's control, so instant or first-in-market notification is not guaranteed.
