# RASED 0.12.0

**Watch individual projects.** Press **Watch** on a Mostaql, Nafezly or KAF project and RASED checks its page while it runs, telling you when the client starts contacting freelancers (Mostaql), when the project moves to in progress, or when it closes. A new **Watched projects** screen shows what is watched, waiting or recently stopped.

Primary monitoring always comes first: watching yields to it, and a block pauses that platform's watching. Khamsat is not supported. RASED never logs in, uses cookies or bypasses site protection.

## الجديد

- **متابعة المشاريع:** زر «متابعة» بعد «معاينة» في القائمة، وفي المعاينة والتفاصيل الكاملة، وكأيقونة في النافذة المصغرة، لمشاريع مستقل ونفذلي وكاف (خمسات غير مشمولة).
- **التنبيهات:** عند بدء التواصل على مستقل (بصيغتين: «مؤكد» عندما يكون للعميل مشروع مفتوح واحد ولا شيء قيد التنفيذ، و«محتمل» في غير ذلك؛ والوصفان استنتاج وليسا دليلًا)، وعند دخول المشروع التنفيذ، وعند إغلاقه أو اكتماله. أول فحص صامت، وتغيّر عدد العروض وحده لا ينبّه. ثلاثة مفاتيح جديدة في إعدادات التنبيهات، وعدم الإزعاج يكتم ولا يعيد الإرسال لاحقًا.
- **شاشة «متابعة المشاريع»** في الشريط الجانبي بعد «المحفوظة»: تحت المتابعة، وبانتظار مكان، وتوقفت مؤخرًا، مع عدّاد «N / 10» لكل منصة.
- **الحدود:** حتى 10 مشاريع نشطة لكل منصة؛ الحادي عشر ينتظر مكانًا أو يبدّل مشروعًا آخر. اختيار «قدّمت» يبدأ المتابعة تلقائيًا ما لم تكن أوقفتها بنفسك، و«تجاهل» أو الإخفاء يوقفها. تنتهي المتابعة بعد 14 يومًا من بدئها النشط.
- **حماية الرصد:** فحص واحد لكل منصة كل 10 ثوانٍ على الأكثر، يتباطأ بعد الحظر ويتنازل دائمًا للرصد الأساسي. عند الحظر تتوقف متابعة المنصة 30 دقيقة على الأقل ولا تعود إلا بعد نجاح الرصد الأساسي.
- **«حصل وأنت غايب»:** بعد تشغيل راصد أو رجوع الجهاز من السكون يصل إشعار ملخّص واحد إذا ظهرت تغييرات في أول فحص للمشاريع المتابعة. لا يُفحص شيء والبرنامج مقفول.
- تحديث الشروط والخصوصية بتاريخ 2026-11-15، وإفصاح الإحصائيات الجديد **`2026-11-15-v5`** يضيف أحداث متابعة المشاريع؛ ستُطلب موافقتك عليه.

## Project watch

Watching checks at most one project per platform per slot (10 seconds, slowing after blocks and recovering after successes). Projects that have not changed for 24 hours are checked every 10 minutes. On a block (401, 429, 202, a protection page or a non-private 403) the platform's watching pauses for at least 30 minutes, or longer if `Retry-After` says so, applies that platform's primary cooldown and resumes only after primary monitoring succeeds again. A recognised private Nafezly or KAF page stops only that watch.

Up to 10 projects per platform are active; the rest wait and are promoted oldest first. Watches expire 14 days after they became active. Marking a project **Submitted** starts watching it unless you switched watching off yourself; **Ignore** or hiding stops it. Disabling a platform stops its watches; pausing it pauses them.

Each alert needs its matching watch toggle (status, sure contact or maybe contact) plus global and platform notifications. More than three projects with pending changes in one pass produce one summary. Clicking a notification opens the project in your default browser; summaries open their first project. See the [project watch guide](https://github.com/deved234/rased/blob/v0.12.0/docs/PROJECT_WATCH.md) and [notifications](https://github.com/deved234/rased/blob/v0.12.0/docs/NOTIFICATIONS.md).

## Data and compatibility

Migration 11 adds watch tables (`project_watch`, `watch_source_state`, away-summary episodes and watch notification events). Projects you watch are protected from history cleanup while active or waiting. **0.11.0 cannot open a database that 0.12.0 has upgraded** (`newer-schema`); keep a backup made before upgrading if you might go back.

## Privacy and analytics

Terms and Privacy are dated **2026-11-15**. The analytics disclosure is now **`2026-11-15-v5`**: it adds hourly watch counters per platform, watch start/stop/change outcomes and a daily watched/waiting bucket, associated with the random installation identifier. No project titles, URLs, descriptions, client names or offer/contact numbers are sent. Because the disclosure changed, the official build asks you to accept again; updating alone never counts as acceptance and earlier declines stay declined. Development and unconfigured builds remain exempt and send nothing.

Cloud-event deletion completion remains **unverified**. See the [analytics guide](https://github.com/deved234/rased/blob/v0.12.0/docs/ANALYTICS.md).

## Installation

Download **RASED-Setup-0.12.0.exe** from Assets. Windows x64; no Node.js or SQLite needed.

The installer is unsigned. Compare its SHA256 with the bundled **SHA256SUMS.txt** release asset.

On 0.2.5 or later you can update from inside the app: Settings → RASED updates → Check → Download → Restart and install. Downloading and installing remain your explicit choice.

## Validation and known limits

- **Automated tests:** before release, the source passed typecheck, lint, 965 unit tests and real Electron suites with synthetic profiles, including the new `test:watch` suite (42 checks: buttons, limits and swaps, the watched screen, blocks and cooldowns, away summaries, Do Not Disturb, consent gate and quitting during a check). Windows CI passed, and the configured installer was built and checked on GitHub Actions, including the packaged-app suites.
- **Manual check:** a one-hour real run with three watched projects per platform; no client changed a watched project during it, so no real watch notification was seen yet.
- **Not tested:** a manual upgrade of a real 0.11.0 installation with the configured installer, a physical click on a real watch notification, and every live page variation of the three platforms.
- **Still pending:** cloud-event deletion completion is **unverified**.

[Privacy](https://github.com/deved234/rased/blob/v0.12.0/PRIVACY.md) · [Terms](https://github.com/deved234/rased/blob/v0.12.0/TERMS.md) · [Update guide](https://github.com/deved234/rased/blob/v0.12.0/docs/UPDATES.md) · [Changelog](https://github.com/deved234/rased/blob/v0.12.0/CHANGELOG.md).
