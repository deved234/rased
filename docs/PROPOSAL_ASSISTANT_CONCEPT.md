# Proposal Assistant / مساعد العروض — concept, not implemented

Status: product/technical proposal only. RASED remains at version 0.2.6; no implementation, installer, release, or provider account has been created for this feature. Keep it separate from the pending notification-priority change until scope is agreed.

## What the feature should do

From a project's detail page, the user chooses **Prepare proposal**. RASED gathers the currently stored title, full public description when available, skills, category and budget. It combines these with the user's own editable profile (real experience, skills, portfolio links, usual tone) and optional project-specific price/time notes. The user reviews the exact information to be sent and presses **Generate**. The model returns an editable draft, a short list of assumptions/missing information, and possibly questions worth asking the client. The user edits and copies the proposal, then opens Mostaql to submit manually. No automatic bidding, login, browser session access, or background AI generation.

The first version is *context-guided LLM drafting*, not RAG. Retrieval-augmented generation becomes meaningful when the user adds a portfolio or successful previous proposals: select only the most relevant user-owned snippets for the current project. Start with local keyword/full-text ranking; add embeddings only if actual retrieval quality calls for them. Never imply that all historical projects should be uploaded or indexed by a cloud service.

## Existing data and gaps

`src/shared/types.ts` already exposes `ProjectFull` and `ProjectDetails`. `src/renderer/views/ProjectDetailView.tsx` displays full description when fetched, otherwise the RSS excerpt, with provenance indicating full/truncated/excerpt. `src/main/details.ts` fetches and caches full details on demand with a budget and retry logic. The generation flow should request details through this existing path, show when full text is unavailable or truncated, and never pretend an excerpt is the complete project. The current personal note is not automatically part of the prompt; obtain explicit consent for that field.

## Proposed flow and architecture

1. **Onboarding in Settings → AI / Proposal Assistant:** select one supported provider/model in MVP, enter a personal API key, set language, tone, real skills and portfolio examples. Show that API usage may cost money and that project text/profile content will leave the device when the user presses Generate. Offer a delete-key action and local-only profile reset.
2. **Secret handling:** renderer sends the key once through a narrow validated IPC call; Electron main stores only encrypted bytes via Windows DPAPI-backed `safeStorage`, outside SQLite settings, exports, logs and Git. Main never returns the full key to renderer. Require OS encryption availability; fail closed rather than plaintext fallback. Handle key rotation, provider rejection, password change and deletion. This protects against another Windows user, not malware running under the same user account.
3. **Generation:** renderer requests a draft for one project ID. Main resolves the project from its own DB, checks description provenance, includes only fields approved in the preview, and calls the chosen provider over HTTPS. Main owns `AbortController`, timeout, retry-after/rate-limit handling and per-request output limits. Keep a provider adapter so a second provider can be added later, without building every provider in v1. One explicit click produces one paid call; no calls from the RSS watcher or Windows notifications.
4. **Prompt boundary:** label client project text as untrusted data. Treat requests inside that text to ignore instructions, leak secrets or take actions as data, not instructions. Tell the model to use only supplied facts about the freelancer, avoid invented experience/portfolio/guarantees, address the client's concrete requirements, and flag missing price or delivery time rather than guessing. A bounded response can contain `{proposal, assumptions, questions}`. The app validates length and strips dangerous markup; it never executes model output.
5. **Review:** show an editable Arabic/English draft, quick regenerate/refine options only on explicit paid clicks, copy action, and project link. Keep drafts locally in SQLite only when the user chooses Save or through a clearly explained local autosave. The user is responsible for checking accuracy and submitting on Mostaql.
6. **Privacy and documentation:** update the in-app privacy statement and README before release. Explain what fields go to the provider, that the API key and usage belong to the user, and that provider retention/billing rules vary. Do not claim that “local app” means “no data leaves the device” after enabling AI. Review Mostaql's current terms and provider terms before publishing; public project visibility alone does not grant broad rights to redistribute project text.

## UX details that matter

- The entry point belongs on each project detail page; a dedicated Assistant page can hold profile, drafts and history. Avoid making users copy project text manually.
- Show **Full description / Truncated / RSS excerpt only** before generation. Let users paste missing details themselves if needed.
- Require user-provided facts for portfolio, price, delivery schedule and availability. Highlight blanks and unsupported claims in the draft.
- Keep proposal style concise and human. A useful draft mentions the client's specific need, a relevant proof point, an approach, realistic delivery and one focused question. Repeated generic introductions are a poor product outcome.
- Show provider/model and a rough usage indicator before each call, then actual token/cost data when the provider returns it. Do not present a fixed cost when model pricing can change.
- Preserve unsaved edits while navigating; never overwrite a modified draft silently. Provide clear errors for missing key, invalid key, quota, rate limit, network timeout and provider downtime.

## Acceptance checks before release

- Main process never logs/exports/returns the plaintext key; encrypted storage survives app restart and can be deleted. Invalid key and unavailable encryption fail safely.
- Generating from full detail and excerpt-only projects labels provenance accurately; one click makes at most one request under normal conditions and Cancel stops it.
- A malicious instruction embedded in project text cannot change provider destination, expose key, navigate windows or trigger extra tools/calls. Output is editable text, not executable HTML.
- No AI call occurs during RSS polling, notifications, startup or opening a project. No automated proposal submission.
- Draft/assumptions fields remain accurate under missing budget, missing client requirements and truncated detail. User can edit/copy/save without losing work.
- Tests use a local mocked provider. Manual checks cover real provider auth, billing indicators, Arabic draft quality and the updated privacy notice.

Primary references: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [Mostaql terms](https://mostaql.com/p/terms), [OpenAI API data controls (provider example)](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).
