# Platforms and monitoring health

Open **Settings → Monitoring** to manage Mostaql, Khamsat, Nafezly and KAF independently.

## Three different controls

| Control | Effect | After restarting RASED |
|---|---|---|
| Enable source | Allows its collector to fetch opportunities and supported details. Disabling cancels active requests and keeps saved opportunities. | Remembered, including Mostaql. |
| Pause / resume | Temporarily stops that source without affecting the others. Re-enabling a source does not clear a pause in the same session. | Pause resets. |
| Platform alerts | Mutes notifications without stopping discovery. Global notifications and Do Not Disturb still apply. | Remembered. |

These settings are included in settings export/import and complete backups. Existing installations without the new Mostaql flags retain enabled monitoring and alerts. Muting a platform does not change its keywords or filters.

The tray menu offers independent pause/resume and alert muting for enabled platforms. Source pills at the top open a scrollable health dialog. Disabled sources remain visible but cannot be resumed through the pause shortcut.

## Timing and health

- Mostaql: the selected 2, 5 or 15 second interval; 5 seconds by default.
- Khamsat: approximately 5 seconds.
- Nafezly: approximately 15–18 seconds. Access errors increase the interval; successful checks restore it gradually.
- KAF: approximately 5–6 seconds, with bounded pagination when catching up.

Slow responses and cooldowns extend these intervals. Low project volume does not automatically slow monitoring. Refresh, resume, re-enabling and restarting do not bypass stored cooldowns or `Retry-After`. Polling is not a guarantee of instant publication visibility.

Each source shows its last successful check, last newly stored opportunity and next attempt, or **Checking…** during a request. Discovery timestamps start being recorded with the first successful poll after this change; older timestamps are not invented. Health descriptions distinguish connection failures, timeouts, restricted access, rate limiting and unexpected content. A browser login does not remove a collector restriction.

## Possible gaps and catch-up

A successful check does not prove complete historical coverage. Limited RSS feeds and lists may lose older entries while RASED is stopped.

- A new list with no shared IDs with the previous successful list raises a possible-gap warning.
- Returning after more than two minutes without a successful check also raises a conservative interruption warning. This does not prove that a project was missed.
- Warnings survive later successful checks and restart until acknowledged. **Understood, dismiss warning** hides the warning; it does not recover projects. A later separate gap can raise a new warning.
- In the opportunity list, notices are grouped in one collapsed strip, scoped to the selected platform filter. **Show details** reveals per-platform messages and acknowledgement buttons in a bounded scroll area, keeping projects visible. Collapsing the strip does not acknowledge or clear warnings. Full information remains available in Monitoring settings and the source health dialog.
- KAF exposes ongoing paginated catch-up separately. A warning can resolve when its collector reaches the earlier anchor or exhausts the available pages. Recovered opportunities remain silent under the existing notification policy.

The overall indicator excludes disabled sources. It reports partial monitoring when an enabled source has a problem or unresolved coverage warning, and disabled when every platform is disabled. Coverage metadata is local operational state, excluded from portable backups; restoring an archive cannot prove continuous monitoring on the receiving device.

## Capabilities and support

Each platform card explains whether in-app details, verified category filters, AI proposals and Quick Apply are supported. Quick Apply supports Mostaql and Nafezly only. The AI assistant supports Mostaql, Nafezly and KAF. Khamsat filtering uses request titles; its full request body is read on the website.

**Copy monitoring report** copies a local JSON report with platform IDs, states, timestamps, timing/count information, issue categories and coverage warnings. It excludes raw error bodies, project text, API keys, notes, account data and device paths. Review it before sharing; RASED does not upload or send it automatically. About diagnostics lists all four public collector endpoints from the shared registry.

## Verification

Run `npm run build` followed by `npm run test:monitoring`. This uses fresh marked TEMP profiles and synthetic transport/clipboard boundaries with real main/preload/SQLite wiring. Unit regressions are in `tests/monitoring.test.ts`. These fixtures do not prove live platform availability or native tray clicks.
