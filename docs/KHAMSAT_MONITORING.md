# Khamsat monitoring — development implementation

Status: included in RASED **0.3.0** on 2026-09-28. Version 0.2.6 and earlier do not contain this source.

## Scope and behavior

RASED reads the public [طلبات الخدمات غير الموجودة](https://khamsat.com/community/requests) listing directly from each user's device. It does not log in, reuse browser sessions, read Telegram channels, post replies, or submit offers. The separate Khamsat scheduler normally fetches the first listing page every five seconds. Failure handling respects `Retry-After`, increases the delay up to five minutes for ordinary failures, and waits at least fifteen minutes after HTTP 202, 403, or 429. Pause, disable, sleep, and quit abort an active request.

The parser extracts the request ID, title, URL and **publication timestamp** from each row. It deliberately does not use the last-interaction timestamp to decide that a request is new: older threads can return to the first page after a reply. An invalid or changed page is treated as a source error, never as an empty successful feed. The first successful fetch creates a silent baseline. Later, a newly seen request only alerts if its publication timestamp is close to the previous successful poll and current time. Existing older requests may still appear in the list but are marked recovered rather than announced. SQLite keeps a separate `khamsat` source state and deduplicates by `(source, external_id)`. Deleted history uses tombstones so a removed request does not reappear on the next poll.

The list shows a source badge and can filter Mostaql, Khamsat or both. Settings independently control Khamsat monitoring and alerts. Optional include/exclude keywords match **the request title only**; an empty include list means all titles. Request notifications use the existing native Windows notification path and open the request URL in the default browser. The detail view shows the known title/date and a link to Khamsat; it does not invent a description, budget, category or skills. Gemini Proposal Assistant remains limited to Mostaql because a complete Khamsat request body is unavailable through this public fetch path.

## Live investigation, 2026-09-28

- A ten-minute direct-listing probe at five-second intervals returned **120/120 HTTP 200**. Each response contained 25 request rows. Request duration median: **474 ms**, minimum **458 ms**, maximum **982 ms**. This establishes that the listing endpoint was responsive from the test device during that interval; it does not establish a platform-wide availability or rate-limit guarantee.
- No genuinely new request was published during that ten-minute sample. Therefore **publication-to-RASED detection latency has not yet been measured live**. With a healthy five-second schedule, the next poll normally starts within five seconds, plus fetch and local processing time; external publication/indexing delay is unknown.
- An earlier two-minute sample returned 24/24 HTTP 200 (median 473 ms). A newly *visible* first-page ID was about nine hours old by publication time and had merely gained a recent interaction. This is why first-seen alone cannot trigger an alert.
- A direct GET for a request detail page returned **HTTP 202 with an empty body** from the test client. Browser automation of the listing returned **HTTP 403**. We have not found a dependable, public, read-only route for complete details. The app does not attempt a login, challenge bypass, or browser-session reuse.
- Telegram groups were mentioned only as a clue for research and are **not** a data source.

## Validation

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` passed after this implementation. The Electron end-to-end harness uses deterministic local fixtures and an isolated temporary profile. It checks silent baseline, fresh-request alert and browser URL, resurfaced-old-request suppression, and source filtering. Unit tests cover parsing, publication time, keywords, allowlisted links, non-HTML responses, persistence and deleted-request tombstones. A live listing parse was also checked against 25 real rows. These fixtures do not prove notification visibility during fullscreen use or end-to-end latency for a real newly published Khamsat request.

## Remaining verification before a release

Watch for at least one genuinely newly published request on a real user device and record publication time, first listing appearance and notification time. Verify the default-browser action and Windows toast manually. Recheck parser behavior when Khamsat changes its page markup, and monitor 202/403/429 responses over longer periods. Because only the first listing page is fetched and it may be ordered by interaction, very busy periods can hide a new request before RASED sees it; no guarantee of complete coverage or being first is made. Review current platform terms and legal documentation before distributing a build with Khamsat enabled.
