# RASED 0.3.0 — Khamsat requests and Proposal Assistant

RASED now watches the public Khamsat unavailable-service requests listing alongside Mostaql projects. Both sources have independent monitoring; the list can filter by source, and Khamsat has its own enable switch and title-keyword alert settings. The first Khamsat scan silently records existing requests. Later alerts use the original publication timestamp, so an old discussion that returns to page one after a reply is not announced as new. A notification opens the relevant request in the default browser. The app displays only verified listing data for Khamsat; read the full description on Khamsat itself.

The new Gemini Proposal Assistant works on Mostaql projects. Add your own API key and truthful freelancer profile, inspect the project data before sending, and explicitly generate an editable local draft. You copy and submit any proposal yourself. Monitoring never calls Gemini, and the assistant does not support Khamsat requests while their full description is unavailable. Consult the bundled privacy disclosure before sending any data to Gemini.

Windows notification priority has a stronger presentation hint, and Settings explains Focus Assist/Do not disturb. The operating system can still hide notifications during fullscreen games or video; visibility over every surface is not guaranteed. Notification clicks still use native HTTPS activation to open the default browser. This installer remains unsigned.

## Verification and limits

Typecheck, lint, 108 unit tests, build and 69 Electron integration assertions passed on the development tree before packaging. A ten-minute live Khamsat listing probe returned 120/120 HTTP 200 with median response time 474 ms; it did **not** encounter a genuinely new publication, so end-to-end publication-to-notification latency is not yet measured. The first listing page can omit a new request during heavy activity, and Khamsat can change its markup or restrict requests. A direct detail fetch returned HTTP 202 with no description. See [Khamsat monitoring evidence](ARCHITECTURE.md).

Gemini behavior was exercised with a user-supplied key during development and deterministic integration fixtures; model availability and API quotas may change. A real Windows fullscreen visibility test and a real newly published Khamsat request test remain outstanding. Platform content and access are governed by the source sites; RASED does not log in or post automatically.

Users on 0.2.5 or later can use Settings → RASED updates, then explicitly download and install. Older versions require a manual installer once. Existing local SQLite data and settings remain in the same application data location. The installer targets Windows x64 and is not digitally signed; compare it with the published `SHA256SUMS.txt` asset.
