# Project budgets and duration

The preview and full project page share the same budget/duration component and cache. Opening either view requests missing or stale metadata for that specific project. RASED does not fetch every project page during every monitoring poll.

- **Mostaql:** budget and expected delivery duration are parsed from the labeled project card. Existing full-description fetching also fills this cache, sharing the original detail-request budget.
- **Nafezly:** descriptions remain sourced from RSS. Opening or previewing a project can fetch its public project card for budget and duration. This does not read applicants’ proposals or access an account.
- **KAF:** budget comes from the public list and duration from on-demand details. A cached description alone does not prevent fetching missing facts.
- **Khamsat:** the current requests-list collector does not supply budget or duration. Both views explain this limitation and do not invent values or fetch account pages.

Successful metadata is cached for 24 hours. Failed automatic requests wait at least 60 seconds before becoming eligible again when the project is reopened. The refresh button allows an explicit retry, while the collector’s request spacing, pause, disabling and platform cooldowns always apply. Nafezly card requests are serial, at least five seconds apart; Mostaql reuses its shared detail budget. RSS remains the discovery source and takes priority over queued metadata.

The interface distinguishes loading, unavailable fields, failed fetches, paused/disabled sources and cooldowns. Previously stored values remain visible if a refresh fails, with a cached-data explanation. Missing fields on a successfully read card are marked as not provided. Raw supported card text is retained when a value cannot be normalized; an unrecognized currency is never silently treated as USD.

Parsed amounts and duration use the existing project columns. A separate local operational cache records whether metadata was actually parsed; a fresh description cache is insufficient evidence. No database schema migration is required. Portable backups retain project values but strip operational cache keys, so opening a restored project can refresh them.

No AI request or proposal submission is triggered by previewing a project. Platform disable and pause cancel active metadata requests, and rate limits from Nafezly details apply to that source’s polling as well. Requests honor `Retry-After`; the refresh button cannot bypass it.

Run `npm run build` then `npm run test:project-facts`. Unit parser/cache/cancellation tests are in `tests/project-facts.test.ts`. Fixtures contain synthetic project cards shaped after public metadata inspected on 2026-10-15, without client descriptions or applicant data. Integration uses fresh TEMP profiles and synthetic transport. It does not prove every future platform markup variant.
