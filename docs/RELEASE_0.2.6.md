# RASED 0.2.6 — Windows notification browser activation

Clicking a newly generated project notification now asks Windows to open its HTTPS project URL directly in the default browser. Summaries target the newest project and test notifications target the public projects listing. This applies to new notifications; old notifications retain their original activation payload.

The old implementation depended on an Electron instance's `click` callback and removed its reference on `close`. Windows can emit `close` on timeout while retaining the toast in Action Center. The previous integration harness invoked the closure directly, so it did not detect native activation failures. This is an identified defect in the old path, not proof of the exact Windows event sequence on the reporter's device.

The fix uses `<toast activationType="protocol" launch="https://mostaql.com/...">`. The native payload remains responsible for navigation after timeout or app exit; no duplicate `shell.openExternal` call or navigation into RASED is attached on Windows. Only approved Mostaql HTTPS destinations are allowed; text and attributes are XML escaped. The PNG logo is packaged outside ASAR for Windows to access.

Because Windows handles protocol activation independently, RASED no longer claims a notification click automatically marks a project read. Opening it inside RASED or using its browser button still marks it read. The existing custom sound stays separate and the toast's OS sound remains silent.

## Verification

Typecheck, lint and 97 unit tests passed, including native XML destination, injection escaping and URL rejection checks. Packaged integration results and native Windows submission are recorded in the notification fix report. Integration replaces the OS boundary; it does not simulate a real Windows mouse click.

Update 0.2.5 from Settings → RASED updates. Versions 0.2.4 and older require a manual install once. Windows x64 installer remains unsigned. Download the EXE and compare against SHA256SUMS.txt in release Assets.

References: [Electron custom toast and close-event behavior](https://www.electronjs.org/docs/latest/api/notification), [Microsoft protocol activation of toast bodies](https://learn.microsoft.com/en-us/dotnet/api/microsoft.toolkit.uwp.notifications.toastcontentbuilder.setprotocolactivation?view=win-comm-toolkit-dotnet-7.1).
