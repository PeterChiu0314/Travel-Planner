# Budget collaboration #10 — Phase 0 review

Date: 2026-10-27 (Asia/Taipei). Status: audit and controlled baseline ready for review; hosted success/authorization gates remain open. No Phase 1–3 implementation yet.

Later continuation: the two missing existing migrations were separately approved and applied; hosted create/edit/payment now work. A local Phase 1 lease implementation supersedes the provisional original-row prototype preference. See [Phase 1 review and current rollout boundaries](2026-10-27-budget-collaboration-phase-1.md). Findings and measurements below retain the original Phase 0 checkpoint; Channel authorization and hosted two-account/p95 gates remain open.

## Findings and release gates

1. **Hosted write prerequisite is missing.** Direct testing of the user-specified branch URL, signed in as the explicitly authorized Peter Chiu account, failed at `POST /rest/v1/rpc/save_budget_workspace_record_v3` with HTTP 404. The existing application correctly displayed `安全儲存尚未啟用，需先套用預算修正 migration。資料未變更，草稿已保留。` The new test draft was discarded through the normal Cancel/Discard UI. The test trip still shows its original two Budget rows and TWD 30,310. There was no successful business mutation.
2. **The branch Preview uses the Production database.** Its Google OAuth callback and observed REST traffic both target `lqvuqamzmchepgxkftcw`. It is not an isolated Staging database. The user explicitly requested testing this URL; the selected trip was `系統測試專用`. No production schema/settings changes or cleanup were performed.
3. **Public channels are enabled and have no topic policies.** Dashboard showed Realtime enabled, `Allow public access` enabled and no Realtime policies. Catalog inspection confirms RLS enabled on `realtime.messages` with **0 policies**. Existing client collaboration channels omit `private: true`. This is an authorization boundary requiring remediation/acceptance tests; this audit did not demonstrate a non-member receiving/forging an existing trip's messages or establish a data-leak incident.
4. **Current record locks have reproducible ownership failures.** Real `editLocks.js` against the complete migration chain in disposable PostgreSQL allowed A and B to both report acquisition success from one unlocked snapshot; B became the final owner. Two tabs of account A also both succeeded; tab 1's release cleared the lock tab 2 believed it held. These are local reproductions, not hosted simultaneous-connection results.
5. **Budget notifications cause measurable full-trip read amplification.** The controlled real-App baseline recorded 16 SELECT calls per injected Budget notification on each client. The current context guard rejects obsolete results but does not prevent those reads from starting.

The issue explicitly requires Phase 0 review before implementation and excludes Timeline/global Channel cleanup. Keep #9 as its own change set; it remains local and is not present in the hosted commit below.

## Baseline identity and evidence

| Item | Verified value |
| --- | --- |
| Local branch/base | `codex/luggage-workspace-redesign` at `2600066`, plus the separate uncommitted #9 SELECT fix |
| Hosted branch URL | [User-specified Preview](https://travel-planner-git-codex-luggage-w-98d395-peter-chiu-s-projects.vercel.app/) |
| Vercel deployment | `dpl_292oQEYYt4ArsufGobu7d4yuZAo3`, READY, Git `26000664bef02d702108f1b27b20cb080fb10c9f` |
| Executed bundle | `/assets/index-DEwKgDf3.js`, served via the existing service worker; bundle contains the v2/v3 persistence paths |
| Backend | `lqvuqamzmchepgxkftcw`; this audit used the existing authenticated Dashboard because the Supabase connector denied access |
| Live schema query | [Catalog-only SELECT](qa/2026-10-27-budget-phase-0-readonly.sql), 14 rows exported |
| Present Budget migrations | `20261022090000`, `20261022100000` |
| Absent Budget migrations | `20261022110000_budget_payment_safety_and_actual_cost.sql`, `20261022120000_unified_planning_payments.sql` |
| Live RPC catalog | Delete and rate-update RPCs exist; v2/v3 save RPCs do not. Present RPCs deny anon execute and allow authenticated execute; rate update remains its existing SECURITY DEFINER implementation |

Local evidence folder: `C:/Users/PeterChiu/.codex/visualizations/2026/10/27/01a17d1b-ca24-7312-9082-15797b33c8b6/`.

- `issue-10-realtime-settings.png`, `issue-10-realtime-policies.png`: actual settings/policy UI.
- `issue-10-catalog-audit.json`: catalog-only schema, policy, publication, trigger and RPC metadata; no application records or credentials.
- `issue-10-hosted-budget-blocked.png`, `issue-10-hosted-baseline.json`: live failure and sanitized request/status/Channel event evidence. Headers, access tokens, OAuth URLs and WebSocket payloads are not saved.
- `issue-10-baseline.json`: controlled App measurements including source SHA-256, raw per-operation invocation counts and latency samples.
- `issue-10-lock-audit.json`: local PostgreSQL lock reproduction and exact SQL predicate shapes.
- `issue-10-realtime-report.png`: Dashboard observability limitations.

## Current scope and dependencies

| Resource | Current data source / invalidation | Safety or dependency |
| --- | --- | --- |
| `budget_items` | Formal full load; `trip-${tripId}` event -> full load | Raw record lock, versions, unified planning projection |
| `budget_item_participants` | Full SELECT; parent-ID filtering; unfiltered table subscription | Parent Budget membership RLS; no `trip_id` column |
| `actual_expenses` | Trip-scoped full load; event -> full load | Retained payment activity/history, receipt identity, settlement amounts |
| `actual_expense_participants` | Full SELECT; parent-ID filtering; unfiltered table subscription | Parent Actual membership RLS; no `trip_id` column |
| `itinerary_budget_items` | Full SELECT and table subscription | Parent itinerary membership RLS; no `trip_id`; needed by Timeline links and Budget Day labels |
| `trip_budget_baselines` | Trip-scoped full load and subscription | Server departure snapshot; never fabricate/reprice historical baseline |
| `trips.budget_exchange_rates` | Membership list nested SELECT after local #9 fix | Existing trip event reloads trip list; no second rate source |
| Itinerary, members, attachments | Existing Formal data | Keep necessary Day/link/name/receipt dependencies; do not blindly drop notifications |

All seven inspected public tables have RLS enabled, FULL replica identity and membership in `supabase_realtime`. Their read policies reference the existing private membership helpers or parent-table joins. This catalog check does not substitute for authenticated non-member/pending-member service tests.

Four distinct Channel topics were observed in Budget: `trip-{id}`, `trip-presence:{id}`, `timeline-drag:{id}:0`, `timeline-route-edit:{id}:0`. A topic is not a separate WebSocket. The local model and live load both recorded five join frames/attempts and one leave during initialization, representing four stable topics and a recreated trip subscription. No Channel joins were caused by the four measured local Budget operations. Keep Timeline subscription lifetime changes outside #10.

`trip-presence` supplies existing user identity, page and stable per-user color; its heartbeat/stale constants are 28/55 seconds. Budget row selection currently has no own Broadcast/presence track in the measured operations. Do not copy Timeline's single `foreignCardSelection` slot into a multi-row Budget model.

## Before measurements

### Controlled real App: invocation counts

Ran [baseline script](../scripts/qa/budget-collaboration-baseline.mjs) against real `/`, production CSS/React StrictMode, two browser clients and an isolated in-memory SDK backend. Application code was not instrumented or modified for #10. Counts are actual client method invocations and synthetic callback deliveries, **not hosted REST requests or actual per-row WAL traffic**. For each modeled operation the backend emits one event per touched table; a real RPC may generate more events. Assertions exercise the real UI and remote resulting row/payment state.

| Operation | A SELECT | B SELECT | A UPDATE / RPC | Delivered events per client |
| --- | ---: | ---: | ---: | ---: |
| Add unpaid Budget | 48 | 32 | 0 / 1 | 2 |
| Edit including lock acquire/release | 81 | 64 | 2 / 1 | 4 |
| Mark paid | 50 | 32 | 0 / 1 | 2 |
| Delete the newly created fixture | 48 | 32 | 0 / 1 | 2 |
| Ten concurrent Budget notifications | 160 | 160 | 0 / 0 | 10 |

Each full load reads 16 sources. The sender also explicitly reloads after a successful write; edit locking causes two more Budget notifications in this model. Extra payment preparation reads account for the non-multiples of 16. Unrelated accommodation, guide, todo, luggage and other sources were re-read, as recorded in the JSON. All scenarios recorded 0 incremental joins, leaves, Presence tracks and Broadcast sends on each client.

Twenty synthetic event-to-observed-B-UI samples: local **p50 29 ms / p95 33 ms**. These values include Playwright/IPC overhead, use immediate mock responses and exclude hosted network/server latency. They are reproducibility evidence, not a service SLA, Free-capacity claim or hosted before/after performance result.

### Actual branch URL

On reload, the authenticated `系統測試專用` Budget page rendered both existing rows. Captured **25 REST GETs / 25 HTTP 200 responses**, including the 16-source full load plus trip/membership, luggage convergence, route and share reads. Captured **5 `phx_join`, 1 `phx_leave`, 2 Presence frames** in that load window. Request filters/headers were not exported.

One attempted new TWD 1 Budget sent **1 RPC POST -> HTTP 404**, plus its CORS OPTIONS -> HTTP 200. No follow-up write/read fallback was observed. The UI retained the typed title/amount and showed the migration-required error; cancelling/discarding removed this agent-created local draft and the original two rows/total remained visible. There is no hosted successful add/edit/delete/payment sample or synchronization p95 yet. Do not estimate successful-service behavior from the failed RPC timing.

The live page rendered meaningful Budget content without a framework overlay. Captured console warnings were the existing Google Maps Marker deprecation notice; the expected failed save is documented by its HTTP 404 and visible error. The temporary Network observer was disabled at the end; no browser cache, service-worker, application-source or authentication-security settings were changed. The authorized signed-in branch tab remains available for follow-up.

The Realtime Dashboard's 60-minute view showed `No data to show` for connected clients/messages with a delayed-refresh notice. Gateway WebSocket handshake aggregates and sample Pro charts are not Budget operation latency. Missing/lagging charts must not be interpreted as zero usage.

## Decisions proposed for review

### 1. Editing authority: original-row atomic RPC first, Budget scope only

| Option | Benefits | Costs / acceptance conditions |
| --- | --- | --- |
| A: original-row atomic acquire/renew/release RPCs | Smallest initial schema/scope; preserves existing Budget/Actual identities and legacy lock fields | Must add per-tab session/token ownership, server expiry and write-time verification. Renew/release cannot invalidate content versions or trigger wasteful full reloads. Old endpoints/direct-update paths must not bypass the new ownership rules |
| B: Budget-only lease side table | Separates lock expiry/heartbeat from financial rows and `updated_at`; independent lease events | New table/index/RLS/RPC contracts and staged compatibility; every protected Budget write still needs ownership checks. Not a default whole-site lease migration |

Recommend **prototype A in disposable PostgreSQL first**, with tests for both reproduced failures, concurrent different rows, long edits, expiry takeover and stale-token save/release. A bare `WHERE unlocked OR expired OR locked_by=current_user` does not solve same-account tabs. If A cannot meet session isolation, version stability and compatibility safely, return for review with B; do not quietly expand to all workspaces or weaken RPC/RLS.

Actual editing colors should use authoritative DB ownership/expiry. Only pure selection (no edit authority) justifies optional low-rate Broadcast. No messages on every keystroke or hover; no unsaved money/notes in payloads.

### 2. Consistent BudgetSnapshot and scoped invalidation

Prefer one **SECURITY INVOKER, STABLE read RPC using a single SQL SELECT** to aggregate the six Budget tables, trip quote and necessary itinerary/member/receipt references. Apply one model update after account/trip/generation/sequence validation. `STABLE` PostgreSQL functions use the calling statement's snapshot; merely running unrelated SELECTs with `Promise.all` or a default VOLATILE PL/pgSQL wrapper does not establish the same guarantee. [PostgreSQL snapshot semantics](https://www.postgresql.org/docs/current/xfunc-volatility.html).

Retain business write transactions, request idempotency, version checks, retained payments and frozen baselines. Budget notifications invalidate one scope; batch for a measured interval, use in-flight dirty rerun and bounded foreground/reconnect reconciliation. Reuse the luggage guard concepts without changing luggage behavior. Choose canonical write results versus one authoritative refresh explicitly so write completion and its notifications do not duplicate full-trip loads.

The current official [DELETE documentation](https://supabase.com/docs/guides/realtime/postgres-changes#delete-events) allows filtering when replica identity is FULL. That refines the older review's blanket warning. All inspected Budget tables are FULL, but parent-only child tables still cannot be filtered by a nonexistent `trip_id`; real service INSERT/UPDATE/DELETE tests remain required before relying on any filter strategy. Do not claim Mock tests validate hosted DELETE delivery or revoked-member authorization.

### 3. Security rollout without changing Timeline

For any new Budget selection Channel, use a new versioned Budget-only topic plus `private: true`, narrow SELECT/INSERT policies on `realtime.messages`, and approved membership/resource checks. Never fall back to public Channel if authorization fails. Do not add another Presence roster; DB editing state plus optional selection Broadcast are sufficient.

Rollout order: isolated tests -> review additive Budget-only policy/schema changes -> authorized migration -> verify member/editor/viewer/pending/outsider behavior -> enable new Budget client -> observe. Do not change existing shared trip Presence, Timeline topic names or the global public-access toggle in this issue. A shared-channel authorization dependency is a separate cross-workspace security work item, whose issue draft requires user review before posting. New collaboration release remains gated until the relevant authorization matrix and dependency disposition are reviewed.

Rollback: disable the new Budget feature/close its private topics while retaining restrictive policies and business data. Keep the additive schema for inspection; do not drop data or reopen public access. Existing Timeline topics continue untouched. [Supabase settings](https://supabase.com/docs/guides/realtime/settings) state that changing settings disconnects clients; [authorization docs](https://supabase.com/docs/guides/realtime/authorization) explain private topics, policy caching and JWT/rejoin behavior. Revoked membership must be tested with fresh JWT/rejoin as well as a still-connected client; do not promise immediate revocation from a policy row change alone.

### 4. Capacity and visuals

Dashboard/official [Free limits](https://supabase.com/docs/guides/realtime/limits) align: 200 connections, 100 events/sec, 20 Presence events/sec. Official limits also list 100 joins/sec, 100 topics per connection and 5 Presence calls/client/30 seconds. [Message accounting](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) counts fan-out to listeners; local callback counts are not a billing meter. There is no evidence this project is near its cap. Optimize broad reads/lock-triggered reloads before buying capacity or adding synchronization libraries.

Use the existing member color mapping and a resource -> sessions ownership/selection model, with outlines/inset overlays that do not change table geometry. Hover/focus reveals names; keyboard/touch must have an accessible equivalent. Keep local selection distinct. Expiry/permission/session/context cleanup must not masquerade as edit authority or erase drafts.

## Verification status and next gate

- Complete: scope inventory, live settings/catalog audit, actual branch login/render/failure-boundary test, controlled four-operation/read amplification baseline, local lock reproductions, official documentation comparison and scoped decision/rollback proposal.
- Open: hosted successful CRUD/payment baseline and p95, independent authenticated outsider/pending-member receive/send tests, true two-account concurrent/reconnect matrix, real filtered DELETE delivery, mutation permissions after revoked membership.
- First blocker: the existing two Budget safety migrations are not installed on this backend. They require their own approved preflight/rollout; this issue did not apply them. The local #9 change also requires separate publication before its hosted rate behavior can be verified.
- Phase 1–3 remain unstarted pending this review. No new dependency, #10 runtime implementation, schema change, global toggle, Timeline/Luggage change, GitHub write, commit/push, merge or deployment was performed.

Reproduce locally with `node scripts/qa/budget-collaboration-baseline.mjs` (`PLAYWRIGHT_BASE_URL`, installed `PLAYWRIGHT_BROWSERS_PATH`, external `BUDGET_BASELINE_OUTPUT`) and `node scripts/qa/budget-lock-audit.mjs` (external `PGLITE_MODULE`, external `BUDGET_LOCK_AUDIT_OUTPUT`). Both completed successfully; syntax/diff checks passed. PGlite uses all migration bodies unchanged except skipping its unavailable pgcrypto-extension declaration. Diagnostic scripts record current bad behavior and must be revised as the implementation changes; they are not acceptance tests requiring those bugs to persist.
