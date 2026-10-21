# Project search

RASED searches the local archive across all supported platforms. It does not fetch every project page during a search, contact an AI provider, or send search text to analytics.

## What matches

The search box looks for a literal substring within an individual title, excerpt, skill list or locally cached full description. Arabic diacritics/tatweel, common Arabic letter variants and Arabic digits are normalized; Latin case and equivalent Unicode composition are normalized too. Repeated whitespace is collapsed. `%`, `_`, quotes and punctuation are literal characters, not operators. There is no fuzzy matching, stemming or cross-field phrase matching.

The filter drawer has separate **Search my notes** and **Search my proposal drafts** switches, both off by default. These choices can be saved with a filter or transferred with settings. Personal text is normalized only while querying its existing local record. List responses contain small match-field labels, never description bodies, notes or draft text.

Category keyword rules keep their existing notification semantics: they use title, excerpt and skills, not the full description or personal text. Category filters apply to Mostaql. Source, saved/hidden state, unread, personal status and budget filters still combine with search.

## Live results

Typing waits 300ms, and composing text is not searched until composition ends. Older results remain available during refresh, with a busy indication. Failure shows a retry action instead of pretending there are no matches. Editing notes/drafts or receiving enriched details refreshes matching results.

New matching projects can stay behind the new-arrivals button while you read. A snapshot ceiling keeps them deferred even if an older row changes; explicitly revealing arrivals or changing the query advances that ceiling. Pagination preserves the current window. Total/unread counters include deferred matches; load-more counts describe the current window.

## Implementation and verification

Utility processes isolate performance and failures; they are not an operating-system security sandbox. The renderer still has only the restricted preload API. Index construction exits when idle and wakes for public changes, avoiding a second permanent indexing process.

SQL filters, counts and pagination run in a read-only Electron utility process. A bounded queue keeps the latest waiting request per surface; revision changes trigger a trailing retry. Native queries can be interrupted by terminating this process. Normal queries have a two-second deadline; incomplete indexing permits eight seconds. A deadline/failure is reported, not returned as zero results. Settings and monitoring do not depend on the reader starting successfully.

Schema 10 contains a disposable public-text cache, contentless trigram candidate index, compact short-description keys and a durable dirty queue. Literal predicates verify index candidates. Missing/invalid cache rows use the originals, so backfill never intentionally hides results. An independent utility process builds short transactions and yields to competing writers. Notes and proposal drafts have no derived persistent copies. Source protections and collector scheduling remain independent.

Portable backups omit derived entries and clear FTS index segments before vacuuming. Schema-8/9 archives remain supported; restore queues a rebuild. Keep a matching pre-upgrade backup if reverting to an old application: do not manually lower `user_version` or open an upgraded database with an older executable.

Build first, then run `npm run test:search`. Vitest covers normalization, SQL/oracle parity, index invalidation, Unicode, private flags, snapshots, rollback, queue ordering, stale retries and reader lifecycle. Integration uses real Electron/preload/SQLite/React with synthetic TEMP profiles. Performance evidence and internal acceptance reports belong in ignored `.local/`; measurements are device-dependent, not a promise of instantaneous results.

## Known performance limits in 0.9.0

On one synthetic archive of 50,000 projects, the general page measured about 199ms p95, notes search 328ms p95 and the first cold text search 3.1 seconds. These exceed internal targets of 150ms, 300ms and two seconds respectively. Index-write transactions also did not consistently meet the internal 8ms target. Application input-to-results measured 511ms p95 including the 300ms debounce; the fixture stress run did not show an increased p95 notification-dispatch delay. Fixture timing does not measure platform publication or Windows toast arrival. Further tuning is deferred; results vary by hardware, archive and indexing state.
