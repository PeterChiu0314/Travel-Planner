# Budget issue #10 — Phase 2 local review

Branch: `codex/luggage-workspace-redesign`, base `2600066`. Continues the [Phase 1 review](2026-10-27-budget-collaboration-phase-1.md). This checkpoint implements scoped authoritative reads locally; hosted acceptance and Phase 3 outlines remain pending.

## Consistent read boundary

`20261027145613_budget_consistent_snapshot.sql` adds one authenticated-only, SECURITY INVOKER, STABLE SQL function, `read_budget_snapshot`. It uses one SELECT/CTE statement and existing RLS. Only approved trip readers receive a snapshot; pending members/non-members receive no snapshot and anonymous callers cannot execute it. There are no new tables, indexes, Channel policies, publication changes or business writes in this migration.

The snapshot contains Budget/Actual rows, their participants, itinerary links, departure baseline, trip rates, minimal itinerary labels/picker fields, approved members and Actual receipt metadata. Parent joins constrain child rows to the requested trip. Capabilities/private lease metadata are absent. Financial fields are installed as one React state object; Budget labels, rates, member counts and receipts use that snapshot too. Existing trip-list projection from #9 remains, while the Budget view now prioritizes the consistent snapshot's rate value.

PostgreSQL documents that STABLE functions use the calling statement's MVCC snapshot, so their SELECTs see a fixed database view. This avoids the independent snapshots of parallel REST table reads. [PostgreSQL function volatility documentation](https://www.postgresql.org/docs/current/xfunc-volatility.html).

## Scoped refresh and race handling

- `src/lib/budgetSync.js` owns one Budget scope using the existing account/trip/generation guard. Events invalidate immediately and batch for 80 ms. Events during a read discard its result and cause one rerun once quiet. The writer's post-commit request joins this same work; conflicts reconcile through it while retaining the draft.
- Budget/Actual/participant/link/baseline events no longer start a full-trip load. Rate commits also refresh this scope. Known Actual receipt events use it; other attachment events keep their existing shared dependencies.
- Initial full-trip loads include one BudgetSnapshot RPC instead of the six independent financial table reads. Their Budget token is independent of the full-trip token, so an older full load can still finish useful non-Budget work without rolling back a newer financial graph or offline snapshot.
- Budget/settlement entry, focus, online, visible-page return and SUBSCRIBED request a coalesced snapshot. Old callbacks/queued timers and in-flight responses cannot advance a later account/trip generation, including A → B → A. Missing/malformed APIs fail closed; new clients do not fall back to raw financial writes.
- Budget-only refresh merges Actual receipts into shared attachment state/cache while preserving other attachment types. It never restores private luggage. Existing user/trip-bound cache rules remain; cached Budget data is installed only within the current context.
- A per-context history of at most 1,000 receipt IDs recognizes late ID-only DELETEs after the latest snapshot already removed the receipt. It retains no paths/titles/capabilities and resets with the context. Unknown/evicted IDs conservatively keep the original cross-workspace refresh path.
- Budget values still feed other workspaces through their existing props. Timeline item events keep their existing useful full refresh/route behavior; Timeline Presence/Broadcast, Day lifecycle, global settings and Luggage implementation are unchanged. Existing shared-channel SUBSCRIBED still performs its two luggage reads; the reconnect test expects them rather than removing them.

DELETE notifications are invalidation hints, never row mutations. Existing filtered parent subscriptions remain; an unfiltered DELETE fallback handles missing trip fields, and unknown child IDs conservatively invalidate the current authorized snapshot. The existing Channel is reused. Supabase's current documentation discusses replica identity, RLS and DELETE behavior; the actual project's filter behavior still needs hosted testing before release. [Supabase Postgres Changes documentation](https://supabase.com/docs/guides/realtime/postgres-changes). The fallback does not authorize private data: every read still checks membership/RLS. Existing public-Channel authorization review remains a release gate.

## Receipt safety follow-up to the local Phase 1 migration

Adding the lease guard exposed a pre-existing unsafe order in receipt deletion: Storage bytes were removed before metadata permission was checked. The still-unapplied Phase 1 migration now also defines `mutate_budget_receipt`, an invoker/authenticated-only metadata RPC. It validates trip, Actual ID, exact active capability and insertion path/size; trigger context is scoped to that Actual. No earlier applied migration was edited.

Formal Budget obtains/renews an Actual capability before upload/delete. Metadata registration/deletion is transactional. Deletion removes bytes only after the server approves metadata deletion and returns its canonical path. A rejected lease touches no bytes; failed new-upload registration removes only its just-uploaded file. Failed Storage cleanup after committed metadata deletion is reported distinctly and the authoritative snapshot still refreshes. Demo keeps its existing local callbacks.

Storage and Postgres cannot form one transaction. Legacy clients retain their old Storage request order; this change secures the new client and the metadata boundary, not every old binary-file client. Review mixed-client receipt behavior before enabling production leases. No Storage bucket policy was changed.

## Measured local comparison

Same methodology boundary as Phase 0: actual React App and SDK invocations with isolated mock responses/synthetic events, not hosted REST/WAL/network measurements.

| Work | Before (Phase 0 evidence) | After (Phase 2 evidence) |
| --- | --- | --- |
| Ten notifications in one burst, per client | 160 table SELECT invocations | 1 BudgetSnapshot RPC, zero unrelated table reads |
| Twenty notifications in one burst, each of two clients | Not separately measured | 1 snapshot per client, zero unrelated table reads |
| Ten individual events, waiting for each rendered result | Earlier local latency sample used a different sequence | 10 snapshot RPCs, zero unrelated reads; p50 109 ms, p95 205 ms |
| Writer plus same-turn commit notification | Full reload amplification recorded in Phase 0 | One shared post-commit snapshot in the controlled fixture |

The 80 ms debounce is included in the new timing, along with Playwright/IPC scheduling. Phase 0's 29/33 ms local p50/p95 is **not** a comparable production benchmark or evidence of improved latency; this change deliberately trades a short batching delay for fewer requests and consistent graphs. Hosted p95, bytes, WAL fan-out and billing remain unmeasured. Evidence: `issue-10-baseline.json` and `issue-10-phase2-metrics.json` in this chat's visualization folder. Set `BUDGET_SYNC_METRICS` when rerunning the measurement test.

## Verification and current limitations

- Broad regression **142/142 passed**: Budget/Demo/finance/payment/UI, lease client, scoped sync, rates, Formal luggage, cache and route smoke. Three added Formal receipt cases pass; their initial delete selector used “刪除” while the existing UI button is “X”, corrected without changing that UI. Final snapshot/receipt cache merge check passed **45/45**; after the bounded late-DELETE routing change, the complete affected sync/receipt/cache/luggage set passed **26/26**. Final build/diff/syntax checks pass with the existing bundle advisory. The whole 142-case run was not repeated after those final scoped changes.
- Full-chain disposable PostgreSQL passes snapshot role/cross-trip checks, STABLE/invoker/EXECUTE metadata, coherent parent/child results, receipt path/capability validation, unchanged financial versions during receipt operations, Actual and Budget deletion, expiry/takeover/rollback and existing Budget safety suites. The exact previously approved two-migration rollout/rollback suite also passes.
- New real-App cases cover coalescing, dirty rerun, deleted rows, typed drafts, delayed full load vs scoped cache, account/trip ABA, reconnect and writer-event convergence. No live Browser plugin is available; repository Playwright runs installed Chromium on localhost with isolated SDKs.
- The earlier hosted Actual-delete upstream timeout was not reproduced in disposable PostgreSQL. Read-only Dashboard diagnostics confirm the old RPC definition matches the existing source, invoker/authenticated-only permissions are present, there are currently zero lock waits, and original totals remain 13 budgets/one Actual. These facts do not establish a root cause or prove the hosted timeout fixed. Evidence: `budget-delete-readonly.json`; query in `docs/qa/2026-10-27-budget-delete-readonly.sql`. No further production fixtures or deletes were performed in this continuation.

Both new migrations remain **unapplied** as confirmed by the live catalog. No commit, push, frontend deployment, main merge or GitHub issue mutation. No dependency changes.

## Rollout/review sequence

1. Review the final local Phase 1 migration including receipt metadata RPC, then the Phase 2 read-only RPC. Apply them only after explicit approval and fresh live preservation/privilege checks. The two existing October 22 safety migrations are already applied and must not be replayed.
2. Publish the compatible client only after both APIs exist; first test real owner/editor/viewer/pending/outsider behavior, two accounts/same-account tabs, participant and DELETE events, receipts, reconnect and actual latency. Mock/PGlite success does not replace these gates.
3. Resolve the public-Channel authorization disposition from Phase 0 without altering Timeline in this issue. Review old-client Storage behavior and trace any recurring Actual-delete timeout with live evidence.
4. Phase 3 then adds fixed-member colored outlines and accessible names. No Phase 3 UI is implemented here.

Rollback before client enablement: leave the unused additive APIs in place. After enablement, disable the new client first; retain its required APIs until active sessions drain, then review narrowly reversing only these additions. Do not remove active lease guards or deploy a client that silently falls back to independent financial reads/writes.
