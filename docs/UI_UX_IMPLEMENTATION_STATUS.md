# UI/UX v2 — IMPLEMENTATION STATUS (يُحدّث أثناء العمل)

> **سجل تاريخي للنسخة 0.2.0 قبل الإصلاح:** المراجعة المستقلة أثبتت أن بعض بنود القبول أدناه لم تكن صحيحة أو لم تُختبر فعليًا. حالة النسخة المحلية الحالية 0.2.1 والإصلاحات والأدلة والقيود موجودة في [UI_UX_FIX_REPORT.md](UI_UX_FIX_REPORT.md). لا تستخدم علامات done القديمة كدليل QA للإصدار الحالي.

> المرجع: `docs/UI_UX_IMPLEMENTATION_PLAN.md`. الحالات: pending / in_progress / done / blocked / not-tested.
> القاعدة: لا done إلا بتنفيذ + تحقق مسجل. الصور المرجعية ليست دليل تنفيذ.

## Baseline (2026-09-26, قبل التعديل)

- HEAD `13e77a0`، الشجرة نظيفة عدا ملفات الخطة الأربع غير المحفوظة.
- `npm run typecheck` ✅ / `npm run lint` ✅ / `npm test` ✅ **58/58**.
- Stack: Electron 44.4.5 / React 19.3.0 / TS 5.9.2 / node:sqlite / schema v2.
- Dev CSS/CSP يعمل (مثبت بصريًا). الإنتاج CSP صارم + meta سليمة.

## Phase 0 — baseline وخطة عمل

| البند | الحالة | الدليل |
|---|---|---|
| inventory + قراءة الخطة والمواصفات والبرومبتات | done | هذا الملف |
| فحص الصور الثلاث بصريًا + IMAGE_PROMPTS | done | انحرافات موثقة: Mostaql API غلط، خمسات خارج النطاق، البوصلة المولدة ليست شعارًا |
| baseline typecheck/lint/test | done | 58/58 أعلاه |
| إنشاء ملف الحالة | done | هذا الملف |

## Phase 1 — contracts/storage

| البند | الحالة | الدليل |
|---|---|---|
| UserState (saved/hidden/status/note) + validation | done | repos + v2-storage tests; note<=5000/enums; hidden blocks notify at re-eval |
| project_details cache + provenance + retryable | done | table + upsert/get; fetch in Phase 4 |
| saved_filters CRUD + preview count | done | IPC + sanitize id/name 1-80; merge/replace on import |
| budget filter + sort + scopes في query واحد قبل pagination/count | done | queryProjectsPage; legacy wrappers delegate; list===count tested |
| DND في settings + بوابة dispatch + استعادة restart | done | doNotDisturbUntil absolute; suppressed + expiry self-clear |
| tombstones + purge آمن + VACUUM INTO backup | done | pipeline skips tombstoned; preview/apply/backup tested |
| IPC channels/api/preload الجديدة + validation | done | 25 channels; compact deferred to Phase 6 with explicit note |
| summary click → latest + test notification الآمن | done | pickLatestProjectId + hint; test opens /projects only, no DB writes |
| اختبارات phase1 (migration v2→v3/reopen/sanitize/counts) | done | updateSettings link rule + closeBehavior tray/quit; 68/68 + typecheck + lint green |

## Phase 2 — design system/shell

| البند | الحالة | الدليل |
|---|---|---|
| font محلي OFL + مقارنة موثقة | done | Noto Sans Arabic OFL via fontsource, bundled woff2, metadata comparison documented | — |
| tokens dark/light + density + text scale | done | tokens dark+warm-light, density, textScale 90-125, sidebar var; no gradients/glow | — |
| shell: sidebar قابل للطي + topbar + health popover | done | collapsible sidebar + topbar search/Ctrl+K + health popover + slim statusbar | — |
| splash تهيئة حقيقية غير حاجب للشبكة | done | real bootstrap splash (DB+settings+list, RSS independent, slow>8s hint, error+retry) | — |
| hash router + إزالة inline styles (CSP إنتاج) | done | hash router file://-safe; inline styles banned (CSP prod); CDP metrics: sidebar 172 RTL, 0 overflow | — |

## Phase 3 — list/filter/saved

| البند | الحالة | الدليل |
|---|---|---|
| rows مدمجة + bookmark/hidden/status/search | done | comfortable/compact rows: title/excerpt/category/budget/time/unread/bookmark; session-new badge (live+unread only) | — |
| filter drawer + chips + saved defs + preview + link | done | drawer scopes/statuses/categories/keywords/budget/sort + debounced preview + link toggle + saved CRUD; resizable preview (CSS var) + overlay; auto-reveal near top |
| scroll/query/load>200/newIds set بلا jump | done | memory {def,limit,scroll,selected}; generation guards; loadMore preserves window; live Set + pill, no jump; changedIds merge |
| new badge للجلسة فقط (live/unread) | done | badge = live + unread + firstSeen >= session start; initial/recovered excluded |

## Phase 4 — detail/data

| البند | الحالة | الدليل |
|---|---|---|
| صفحة مستقلة + رجوع يحفظ السياق | done | standalone route; read-once after load; Esc/back + dirty-note guard; context restored |
| full description fetch/cache/selector موثق + fallback | done | #projectDetailsTab p-paragraphs plain-text parser + fixtures; DetailsFetcher cache/TTL24h/dedupe/abort-restore/shared-backoff/boot-reset |
| notes dirty-guard + status + copy/open | done | note <=5000 explicit save + counter; status select; copy link; hide/unhide; external open |

## Phase 5 — settings/notifications

| البند | الحالة | الدليل |
|---|---|---|
| أقسام 5 + DND UI + test notif/sound + startup + close | done | watching/notifications/appearance/data/about + sub-tabs; DND durations + active-until; test buttons; export/import/purge UI; shortcuts list |
| export/import validated + history purge الآمن | done | dialogs + 1MB/schema/summary + merge/replace + startup opt-in; cutoff select + preview + confirm + VACUUM backup |

## Phase 6 — compact/accessibility

| البند | الحالة | الدليل |
|---|---|---|
| نافذة compact + always-on-top + bounds | done | follower window same services; pin persisted; bounds validated + off-screen correction; showProjectInMain navigates main |
| shortcuts + ARIA + reduced motion + focus | done | Ctrl+K/arrows/Enter/Ctrl+Enter/Ctrl+D/Esc with input guards; aria labels/roles; focus-visible; reduced-motion CSS |

## Phase 7 — integration/packaging

| البند | الحالة | الدليل |
|---|---|---|
| E2E wiring حقيقي (Electron + preload + SQLite temp) | done | scripts/e2e-cdp.mjs: 17/17 تشغيل حقيقي + bridge حقيقي + SELECT مباشر (حفظ-بعد-إعادة، لغة، DND، نص كامل) |
| packaged QA + screenshots ui-v2 + installer 0.2.0 + hash | done | 7 لقطات مجمعة (ar/en/light/detail/settings/compact/splash)؛ installer 115MB + SHA256؛ install/run/uninstall (قيد مسار /D) |
| REPORT + README + قبول checklist | done | UI_UX_IMPLEMENTATION_REPORT + README 0.2.0note + checklist §10 |

## قرارات أثناء التنفيذ

1. (2026-09-26) الخط: Noto Sans Arabic عبر `@fontsource` (OFL، محلي، لا CDN) — التفاصيل في التقرير.
2. (2026-09-26) E2E عبر CDP مدمج (fetch + WebSocket من Node، بلا اعتماديات): تشغيل الباينري الحقيقي + user-data temp. مثبت: playwright electron.launch يعلّق في هذه البيئة.
3. UI prefs تُطوى داخل `AppSettings` بدل API منفصلة (قرار تصميمي موثق).
