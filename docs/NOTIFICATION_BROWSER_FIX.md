# Windows notification browser fix — 0.2.6

## Problem and change

The app retained `Notification` instances only until `close`. Electron documents that on Windows this event can mean the popup timed out, while the notification remains in Action Center. The only browser opener was an instance `click` callback, so activation was dependent on object/process lifetime. Previous E2E checks called the callback immediately and could not prove native Windows behavior. The reporter's exact event sequence was not captured.

`src/main/toast.ts` creates safe native protocol XML with the actual Mostaql HTTPS URL in `launch`. `src/main/index.ts` uses it for single projects, the newest project in summaries, and the test listing. Windows opens the default browser itself, without opening the project inside RASED or calling a second browser opener. Its payload can survive object collection and process exit. Existing notifications are not rewritten; test a newly generated notification.

The native logo is now a real PNG in `resources/branding/icon.png`, outside ASAR. OS sound is silent because existing application sound settings own audio. The protocol path does not reliably deliver read-state callbacks, so notification clicks no longer automatically mark projects read; in-app detail and browser-button actions still do. No project data or settings migrations.

## Verification completed

- TypeScript and ESLint passed; 97 unit tests passed across 15 files. New tests validate activation, destinations, URL restrictions and XML escaping.
- Real packaged Electron/preload/React/SQLite passed 56 integration assertions. New single and summary checks assert the XML actually produced by main dispatch. OS activation is simulated there, so these are not real Windows click tests. Profile: `C:\Users\DAVIDA~1\AppData\Local\Temp\rased-test-47GKIT`.
- Started the production packaged executable with a fresh temporary profile and without the test harness. Paused collection and sent the test notification through real IPC. Result `{ok:true}`. After terminating this isolated process, queried Windows' `ToastNotificationManager.History.GetHistory("com.rased.app")`: actual stored toast had `activationType=protocol`, `launch=https://mostaql.com/projects`, and the real packaged PNG path. Profile: `C:\Users\DAVIDA~1\AppData\Local\Temp\rased-test-mTlQrW`. The native notification was left available for a manual click.
- Native mouse clicking, default-browser dispatch, and Windows versions other than this device remain manual verification. User's installed RASED and real project database were not changed by these tests.

Installer `release/RASED-Setup-0.2.6.exe`, unsigned. SHA256: `BE08179B663256B403B87C215EAAEEACA5269B0ABCDCB88329C8B8727AB6C9A5`.

## Manual verification after updating

Use Settings → notifications → test notification. Click the newly generated popup, then generate another and click it from Windows Notification Center after it disappears. Repeat after exiting RASED entirely. Each test should open Mostaql's public projects listing in the default browser without opening a RASED detail page. A new real project notification should open that project, and a summary should open its newest project. Check that one click produces one tab. Do not use an old notification to evaluate the new code.

Primary sources: [Electron notification API](https://www.electronjs.org/docs/latest/api/notification), [Microsoft protocol activation of toast body](https://learn.microsoft.com/en-us/dotnet/api/microsoft.toolkit.uwp.notifications.toastcontentbuilder.setprotocolactivation?view=win-comm-toolkit-dotnet-7.1), [Electron 44.4.5 custom XML handling](https://github.com/electron/electron/blob/v44.4.5/shell/browser/notifications/win/windows_toast_notification.cc).
