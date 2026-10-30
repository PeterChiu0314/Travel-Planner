# Production business-conflict retry incident — 2026-10-31

Scope: `codex/budget-collaboration-redesign`, starting HEAD `5e45e4dca8c6ed2450647c3d45ce81ddb2ec5d84`. This is an incident fix, not Budget B-7 activation or certification. Times below use Asia/Taipei unless UTC is explicit. No private logs, credentials, account/record identifiers or workstation paths are included.

## Finding and authorization

Production PostgREST 14.5 repeatedly executed the same Budget Delete transaction. PostgreSQL logged custom SQLSTATE `40001`, message `Record changed`, from `delete_budget_workspace_record(uuid,text,uuid,timestamptz)` line 10. Repeated events shared one backend identity and increasing session line numbers; the dashboard error count must not be read as thousands of distinct user actions. A null/stale base version or missing record deterministically fails this business guard. The logs establish the failing guard, not which original client payload caused it.

Supabase documents this exact retry mechanism: PostgREST/Hasql retries `40001`, including application-raised errors that cannot resolve through retries. Use `PT409` for business conflicts and stop an already-running retry backend separately. [Official incident guidance](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions), [PostgREST 14 error mapping](https://docs.postgrest.org/en/v14/references/errors.html). `PT409` maps to HTTP 409; the hosted status code itself was not captured in a controlled HTTP test here.

The initial automatic approval review rejected the Production migration because the broad request to fix the incident did not specifically override the earlier Hosted-write restriction. No rejected mutation was executed. The user then explicitly authorized the named Production project, migration `20261031003000_rpc_business_conflicts_no_retry`, precisely 13 checked routines and ledger insertion, preserving permissions/version checks/RLS, with no financial writes, B-7 activation or project restart. The verified packet was executed only after that authorization.

## Applied fix and financial safety

1. Terminated only the identified runaway authenticator backend after checking its PID, exact backend start, PostgREST application and current retry transaction/query. Returned `terminated=true`; no full restart.
2. Inventoried deployed routine definitions and old migration head `20261028104333`. The deployment transaction pinned all 13 original body fingerprints and rejected catalog drift or an unexpected ledger state.
3. Applied the standalone forward migration, changing only explicit `errcode = '40001'` assignments to `PT409` in the allowlist below. Genuine database serialization/deadlock errors retain their PostgreSQL semantics.
4. In the same transaction, checked each new body against the exact regex transformation and compared every other `pg_proc` attribute, including OID, owner, ACL, security mode and search path. Transaction public-table insert/update/delete counters remained zero. Inserted the exact migration source into the migration ledger and committed atomically.

| Schema | Existing routines changed |
| --- | --- |
| `app_private` | `budget_edit_lease_action`, `budget_workspace_request`, `update_budget_selection`, `update_budget_selection_v2` |
| `public` | `assign_luggage_item`, `delete_budget_workspace_record`, `mutate_budget_receipt`, `mutate_luggage_item`, `privatize_luggage_item`, `reorder_luggage_items`, `save_budget_workspace_record`, `save_budget_workspace_record_v2`, `save_budget_workspace_record_v3` |

Exact signatures are in the migration. The migration requires the Budget Delete baseline, preserves all business checks, and is idempotent. No table content, payment history, Source origin, Receipt bytes/metadata, Baseline, trigger, RLS policy, grant, flag or schedule was intentionally rewritten; catalog comparison and zero public DML support that narrow claim. This was not a fresh row-by-row audit of every financial table.

Client source now recognizes `PT409` alongside legacy `40001`/`40P01` for authoritative reconciliation, preserving the failed request and draft without retrying the mutation. Luggage already classifies stale conflicts by its message. **These frontend changes are on the feature branch only; Production frontend was not deployed.** Existing frontend requests still receive a rejection; this hotfix does not turn a failed financial mutation into success.

## Actual observations

| Check | Result / limit |
| --- | --- |
| Production transaction readback | **Passed:** 13 routines transformed, identity/ACL/security preserved, zero public DML, ledger registered, original backend absent. |
| Production logs | **Passed, bounded observation:** old `40001` at 00:31:38; `PT409 / Record changed` at 00:31:39 after apply. Selected 00:26–00:36 log window showed no later error row. This is actual hosted PostgreSQL evidence, not a controlled HTTP/Realtime E2E. |
| Independent final readback | **Passed at 00:39:22 (16:39:22 UTC on Oct 30):** active authenticator backends 0, original backend 0, custom `40001` definitions in public/app_private 0, named ledger entry present, other active backends NULL. Point-in-time observation, not continuous monitoring. |
| Resource recovery | **Unresolved:** overview at approximately 00:36 still Healthy but CPU 100%, RAM 57%, 9/60 connections, resource alert present. Database Observability at 00:41 reported `Unable to load data for CPU usage` (also several other resource charts). The stopped loop does not certify CPU recovery; dashboard lag/rolling metrics or another cause remain unconfirmed. No restart, paid upgrade or extra production changes attempted. |
| Staging restore | **Passed:** user-requested resume, observed Healthy. |
| Staging hotfix probe | **Passed only as transactional SQL:** Staging lacks Budget baseline and ends at historical Phase 7 import. Created one transient same-signature raising function, applied exact migration body, asserted `PT409`/invoker, rolled back and verified `probe_removed=true`. No missing prerequisite migrations installed; not Staging/Production parity or HTTP acceptance. |
| Full Auth/PostgREST/Realtime/Storage/Worker B-7 E2E | **Blocked / not run.** No mock or direct SQL result is substituted for this acceptance. |

Screenshots of applied transaction, independent readback, original incident and Staging Healthy are retained locally outside Git. Sanitized machine-readable evidence: [results](qa/2026-10-31-rpc-business-conflict-results.json).

## Targeted regression

- `node scripts/qa/run-budget-metadata-parallel.mjs --conflicts`: **7/7**, native PostgreSQL 17.11, isolated real connections, deployed baseline through `20261028104333` plus this migration. Covers stale Save/lease admission, missing/old Delete base, missing record, original permission rejection and valid Delete, all-13 mapping/idempotency/catalog+row preservation, and a genuine two-connection repeatable-read `40001`. Runner stopped its cluster.
- `node --test tests/rpc-business-conflicts.test.mjs`: **6/6**. PT409/40001/40P01 each issue one mutation and one reload, retain request/draft and failure; offline reconciliation stays failed; permission/network errors stay distinct; luggage stale classification retained.
- Production build passed; existing >500 kB chunk advisory remains. Changed JS/MJS syntax checks and `git diff --check` passed. No broad historical suite rerun.
- Initial test setup incorrectly loaded dormant B-7 lifecycle rules, so valid Delete hit its stricter incomplete-pricing rule. The isolated selector was corrected to the actual deployed baseline. A Save fixture initially omitted required participant IDs; supplied a valid payload. Assertions were not weakened and no timeout was raised. Final results are the 7/7 run, not those setup failures.

## Forward recovery and next decision

Do not roll back to business `40001`, replay committed financial operations, clear receipts/history, or downgrade the migration ledger. If an unexpected regression occurs, preserve source/ledger evidence and add a narrowly reviewed forward migration. Permission/lease/version guards remain mandatory. The hotfix does not fix genuinely stale client data; reload/reconcile or abandon the draft through the normal UI before a new user action.

**B-7 remains BLOCKED / NO-GO.** This standalone migration intentionally skips unapplied B-1–B-7 migrations. Their dormant routines still include application `40001`, and later `CREATE OR REPLACE` migrations may reintroduce the same problem. Audit and forward-fix the complete planned chain before any separately authorized activation. A newer ledger head does not authorize `db push --include-all` or imply those missing migrations were applied.

Next review: assess the CPU alert using a fresh metric interval; if it persists, investigate resource/query evidence read-only before proposing another scoped action. Separately review publication of only the client compatibility fix, without deploying the pending B-7 frontend. Docker remains stopped and repair NO-GO; original data/backup are untouched. No main merge, Production frontend deployment, B-7 protocol enablement, Storage/Worker change or Docker action is part of this incident authorization.
