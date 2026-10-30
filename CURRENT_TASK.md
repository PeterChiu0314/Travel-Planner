# CURRENT_TASK.md

Updated 2026-10-30. This is the live handoff: current work, protected behavior, rollout evidence and next step. Detailed implementation/QA belongs in linked documents; completed checkpoint logs belong in docs/archive/.

## Current work — Budget collaboration, Issue #15

- Branch: `codex/budget-collaboration-redesign`. B-7 starts at verified `227028573e2c45f3e774c7d1d3fb2a1656a8a899`. Authorized local/isolated integration, necessary fixes, docs and original-branch commit/push only. Five original untracked files preserved. No Hosted writes, production Storage/RLS/Worker/schedule, flag activation, main merge or manual deployment.
- **Release decision: BLOCKED / NO-GO.** [Final integration matrix](docs/2026-10-30-budget-b7-integration-acceptance.md), [B-7 real-service follow-up from a28232e](docs/2026-10-30-budget-b7-service-acceptance-followup.md). Real Auth/PostgREST/Realtime multi-account/tabs, Storage HTTP/signed URLs/custom role+headers and Worker scheduling remain unverified. External read-only probes confirm different Codex/package versus normal AppData paths; normal desktop launch also fails on missing Docker vendor registry. Existing 10.78 GB data VHDX remains in package-private storage. No reset, volume/socket deletion, VHDX move, registry write or reinstall. Docker/WSL stopped; safe repair beyond diagnosis needs a reviewed backup/installation plan.
- B-7 forward migration `20261030125028`: fixes raw Participants/Links writes outside effects; activated legacy wildcard/whole-form fencing with exact old v2/v3/v4 receipt replay; private legacy ledger RLS; empty v8–v10 Snapshot array; safe single-retained Budget Links+Undo without financial mirroring; parent/trip/account/adjacent transport fail-closed and atomic itinerary delete. [Runbook and executable Preflight/Activation/Pause/Readback SQL](docs/2026-10-30-budget-b7-rollout-runbook.md). Already committed finance is never rolled back via destructive migration.
- Receipt now needs trusted object-ID/SHA-256/size/type/container verification before commit. Dedicated NOLOGIN/NOINHERIT/NOBYPASSRLS Worker has exact-claim Storage RLS, verification+cleanup retries and no private table grants/service-role; new `content_worker_verified=false` activation gate. UI retains original receipt/request while waiting. HTTP forwarding and actual scheduling remain hard gates. Portal/native dialog/menu/listbox Ctrl+Z ownership corrected; no unrelated redesign.
- **Prior B-7 checkpoint:** native **26/26**, directly affected Receipt **23/23**, six blocking observations plus protocol transition/in-flight exclusion; all 60 SQL migrations applied to schema fixtures, 59 old files unchanged, fault atomic and old financial rows preserved. Playwright **45 distinct passed**, extended same Demo1440 Links case 1/1 without double counting; 1440/820/390px basic checks. [Prior evidence](docs/qa/2026-10-30-budget-b7-results.json); unaffected suites not rerun.
- **Service follow-up:** added **9/9** TLS/catalog security checks without historical functional suites. CLI Advisor TLS fixed with per-cluster CA/SAN verification; actual CLI all-advisors returned 64 WARN / 0 ERROR (60 existing performance, pgcrypto schema, 3 fixture-only search_path). Migration-list connects but native direct-SQL bootstrap has no managed remote ledger, so not history parity. Native Preflight/Readback pass; managed Supabase Advisor and real Activation/Pause remain blocked. Build/syntax/diff pass, all native clusters stopped. [Sanitized new evidence](docs/qa/2026-10-30-budget-b7-service-followup.json). No product/migration/UI/default-flag changes in this follow-up.
- All new frontend flags and DB protocols remain default off. No already-passed unaffected historical unit suite was broadly rerun. Old B-1–B-6 evidence is preserved in [pre-B-7 checkpoint](docs/archive/Budget/2026-10-30-current-task-pre-b7-checkpoint.md) and [B-6 Undo contract](docs/2026-10-30-budget-b6-undo-handoff.md). B-7 supersedes prior retained Links/worker/content-gate and undefined external cascade limitations; historical Source origin rewrites and external destructive parent removal still explicitly reject.
- Next: review local Docker backup/installation repair before any action that could detach existing data, then complete real local isolated HTTP acceptance. Do not use Hosted to bypass the current blocker. After local acceptance report ChatGPT Review, then obtain explicit rollout authorization; no flag/protocol activation, main merge or deployment is authorized. Feature-branch push does not certify production readiness.

## Required reading and entry points

Read AGENT.md, DESIGN.md, [UX rules](docs/UX_RULES.md), [bug ledger](docs/BUGS.md), this ledger and the current issue before implementation. Desktop remains the current design/acceptance priority; mobile/tablet redesign is deferred.

| Area | Read when relevant |
| --- | --- |
| Collaboration architecture | [Architecture review](docs/2026-10-27-collaboration-architecture-review.md), [Phase 1 leases](docs/2026-10-27-budget-collaboration-phase-1.md), [Phase 2 snapshot](docs/2026-10-27-budget-collaboration-phase-2.md) |
| Budget hosted baseline | [Issue #10 closeout](docs/2026-10-27-budget-collaboration-closeout.md) |
| Editor lifecycle and selection | [Issues #12/#11/#14](docs/2026-10-28-budget-editor-lifecycle-followups.md) |
| Notifications and recovery | [Issue #13](docs/2026-10-28-global-toast-issue-13.md) |
| Financial and payment rules | [Unified planning](docs/2026-10-22-unified-planning-handoff.md), [Budget safety](docs/2026-10-22-budget-issue-fixes-handoff.md), [Rates #9](docs/2026-10-27-budget-rates-issue-9.md) |
| Luggage | [Issues #5–#8](docs/2026-10-26-luggage-issues-5-8.md), [redesign](docs/2026-10-23-luggage-redesign-handoff.md), [drag QA](docs/2026-10-24-luggage-drag-assignment-qa.md) |
| Timeline scheduling and cards | [Time model](docs/2026-08-09-phase-6-1-time-model-and-auto-scheduling-rules.md), [Phase 6 closeout](docs/2026-08-09-phase-6-closeout-handoff.md), [card contract](docs/timeline-card-ui-spec.md) |
| JSON/AI exchange | [Formal JSON closeout](docs/2026-08-19-phase-7-json-exchange-closeout-handoff.md), [AI exchange closeout](docs/2026-08-24-phase-7-ai-exchange-import-closeout-handoff.md) |
| Local development | [Windows setup](docs/DEV_SETUP_WINDOWS.md); npm.cmd run dev -- --host 127.0.0.1 --port 5174; /demo/budget and /demo/luggage |

Linked handoffs describe their own dated checkpoints. In particular, their not-merged/pending-migration language does not override the newer Git and hosted records summarized here. Read archives only when historical evidence is needed.

## Protected runtime baseline

These describe the existing implementation, before Issue #15:

- Budget/Actual use whole-record DB leases bound to account, tab session and opaque capability, with seven-minute expiry and 60-second renewal. Uncertain/lost authority retains drafts and disables Save until validated reacquisition. Selection hints never confer write authority.
- One RLS/invoker Budget snapshot installs the financial graph consistently. Events coalesce for 80 ms; account/trip/generation/version guards reject stale callbacks, including ABA switches. Reconnect/focus reconciles without replacing active input. Keep Timeline/global channels isolated from this Budget protocol.
- #12 waits for confirmed release when leaving Edit; dirty input uses Continue/Discard and failures preserve a recoverable editor. #11 returns successful save/cancel to Detail with the canonical record selected. #14 prioritizes genuine edits and the latest genuine selection per account, retaining same-account tab deduplication.
- Financial writes preserve atomic Budget/payment/participant changes, idempotency, receipts, frozen departure baselines, integer allocation, historical foreign-currency amounts and shared trip rates. Cancelling paid status retains payment history. Do not restore the removed standalone payment-record UI or delete historical Actual rows. Recheck #9 rates behavior during Issue #15 acceptance.
- Sonner 2.0.8 provides one root toaster and typed notifications. Global sync errors share one stable ID; only accepted authoritative reads can certify recovery. Online/SUBSCRIBED or cache fallback alone cannot. Validation, lease, payment and receipt errors stay inline without duplicate Toasts.
- Luggage private rows are never persisted/recovered in offline cache. Caches bind user/trip and expire after 12 hours; auth changes clear previous-account state. Private luggage has no persistent Realtime subscription; shared events use scoped coalesced reads, and recovery/entry refreshes both scopes. Canonical RPC rows and request guards prevent stale overwrite.
- Shared luggage requires an approved assignee; readiness is assignee-only. Legacy confirmed_by_owner remains compatibility storage, not current UI. Preserve notes, ordering, atomic private/shared conversion and privacy.
- Demo remains unauthenticated and memory-only, with static maps and no Supabase/Auth/Realtime/Storage/draft persistence. Share remains unauthenticated and readonly. Preserve Google OAuth, membership/RLS, invite flow, drafts and record locks.
- Timeline time-affecting writes use the unified Planner and authoritative atomic RPC; preserve Fixed anchors, complete Timed/Untimed states and normal transport pairs. Only item_type === "transport" identifies true transport. Places/editor content remains draft-only until Save; route-node autosave is the scoped exception. Keep minimal Places fields, coordinate parsing, marker focus/numbering and the shared main/alternative draft. Do not restore same-day route locking/idle exit, whole-points snapshots, or synchronization of pan/zoom/cursors/scroll/remote DragOverlay.

## Recorded hosted migration state

Production project: lqvuqamzmchepgxkftcw. This is prior verified evidence, not a fresh hosted audit on 2026-10-29. Never replay or edit applied migrations in place; inspect actual remote history before any separately authorized rollout.

| Area | Latest recorded application / evidence |
| --- | --- |
| Timeline | Through 20260811150000 atomic alternative; Phase 7 import RPC applied as 20260819134935. [Timeline history](docs/archive/Timeline_Phase7/2026-10-29-current-task-timeline-history.md) retains exact older migration checkpoints. |
| Budget baseline/rates | 20261022090000 and 20261022100000 applied 2026-10-22. [Budget handoff](docs/2026-10-22-budget-workspace-handoff.md) |
| Budget safety/planning | 20261022110000 and 20261022120000 applied 2026-10-27; original financial data verified and authorized fixture cleanup completed. [Budget history](docs/archive/Budget/2026-10-29-current-task-collaboration-history.md) |
| Budget collaboration | 20261027140044, 20261027145613 and 20261027152539 applied; independent 8/8 post-commit checks. [Closeout](docs/2026-10-27-budget-collaboration-closeout.md) |
| Budget selection #14 | 20261028104333 applied 2026-10-28, source registered and independent 8/8 checks passed; eleven original business tables unchanged by that transaction. [Hosted record](docs/2026-10-28-budget-editor-lifecycle-followups.md) |
| Luggage | Collaboration 20261022162015, notes 20261023120000, conversions 20261024054121/20261024063828, ordering 20261024112902 and required assignee 20261026120000 recorded applied. Required-assignee cleanup removed exactly two authorized unassigned rows, preserving assigned/private content; 11 readback checks passed. [Luggage history](docs/archive/Luggage/2026-10-29-current-task-luggage-history.md) |

Staging uyqdopksfysbobhjcepk has only historical verification records; latest October work recorded it inactive. Do not assume Production parity. Historical local Staging Maps key restrictions excluded 127.0.0.1:5174; no key/configuration change is authorized here. Supabase connector/CLI access was unavailable for recent Production rollouts; the authenticated Dashboard SQL Editor was used. Targeted catalog checks are not a full Security Advisor audit.

## Verification and remaining limits

- Before the main push on 2026-10-29: normal build and diff checks passed; route/Timeline/Demo/Share smoke 30/30, notification logic 5/5 and rendered Toast 11/11 passed. Five initial Toast cases failed only the console check with ERR_NETWORK_ACCESS_DENIED; the complete 11-case Toast group passed after removing the sandbox network restriction. Existing large-bundle advisory remains. This was a targeted merge check, not a new full-suite/hosted certification.
- Previous #13 final batches passed 200/200; #12/#11/#14 regression passed 161/161 plus five disposable SQL suites. These are dated local/mocked results, not new hosted acceptance for the latest frontend.
- #10 hosted Peter/TNT acceptance covered permissions, contention, independent rows, same-account drafts, lease renewal, long offline recovery, payments/receipts/deletes and scoped convergence. Normal Preview c61377b was verified Ready with the QA entry removed; subsequent #12/#11/#14/#13 frontend and the main push have no new hosted multi-account/Production frontend acceptance recorded here.
- Issue #15 local DB authorization/race/compatibility and Formal/Demo/controller acceptance are recorded above. Hosted PostgREST/Realtime two-account/two-tab activation, mixed-client/Storage protection, physical-device/PWA, actual screen-reader speech and exhaustive hosted performance remain unverified.
- Timeline Broadcast is best effort; authoritative reload remains the convergence fallback. BUG-025 stale drag-presence timeout and historical native-drag accessibility limitations remain recorded risks; consult the bug ledger before treating them as current reproduced defects.

## Historical records and maintenance

The former 743-line ledger was split without dropping its checkpoint sections. Archived statuses and approvals are historical; this ledger and later verified records take precedence.

- [2026-10-27–28 Budget collaboration, rates, hosted rollout and Toast history](docs/archive/Budget/2026-10-29-current-task-collaboration-history.md)
- [2026-10-23–26 Luggage design, interaction, privacy and rollout history](docs/archive/Luggage/2026-10-29-current-task-luggage-history.md)
- [2026-10-22–23 Budget workspace and four-page integration history](docs/archive/Budget/2026-10-29-current-task-workspace-history.md)
- [Timeline phases 5–7, old migration/QA records and superseded next steps](docs/archive/Timeline_Phase7/2026-10-29-current-task-timeline-history.md)

Keep this file focused on the current phase and link out to implementation/QA detail. Replace superseded status instead of prepending another full progress log. Preserve dated evidence in the corresponding docs/ handoff or area archive.

supabase/.temp/, test-results/ and .tmp-* are ignored local artifacts; do not publish their binaries, clusters, dependencies or raw logs. This ledger, archived documentation, source, migrations, tests and selected JSON evidence belong to the same feature-branch checkpoint. On another machine, install npm dependencies and the local PostgreSQL/test runtime per the linked handoffs; .env files and local flags are not transferred by Git.
