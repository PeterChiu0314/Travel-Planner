# Budget issue #10 — Phase 1 local review

Scope: Budget/Actual editing authority only. Source branch `codex/luggage-workspace-redesign`, base `2600066`. Phase 2 snapshot/sync and Phase 3 colored outlines remain pending. This is a local implementation and review checkpoint, not hosted acceptance or an issue closeout.

Later continuation: [Phase 2 local review](2026-10-27-budget-collaboration-phase-2.md) adds consistent scoped reads and completes the new client's receipt/lease boundary. The still-unapplied Phase 1 migration now includes `mutate_budget_receipt`; metadata rejection alone was insufficient because the previous Storage deletion preceded it. The follow-up secures that order. Earlier phase-boundary statements below describe the original checkpoint.

## Decision following the Phase 0 prototype

The Phase 0 preference for original-row atomic RPCs was provisional. The existing Actual cost and payment-origin triggers observe financial-row changes, while legacy locks share those rows and `updated_at`. Extending them with session/token/heartbeat fields would couple authority maintenance to content versions and broad Realtime reloads. The implementation therefore uses **one Budget/Actual-only private lease table**. It does not replace the shared `editLocks.js` used by other workspaces.

Migration: `20261027140044_budget_atomic_edit_leases.sql`, **not applied remotely**. It requires the existing Budget migrations, including the two separately authorized migrations applied below.

| Boundary | Behavior |
| --- | --- |
| Ownership | Resource kind + UUID, authenticated user, per-controller session UUID, random acquisition capability, server expiry. The table stores only the capability hash. |
| Admission | Explicit approved editor/owner check; canonical row version checked after the existing per-trip advisory lock; one active holder, including same-account tabs. Active legacy locks are respected even for the same account. |
| Lifetime | Seven-minute server expiry; one-minute metadata-only renewals; foreground/online reconciliation. Heartbeats never UPDATE financial rows, versions or legacy lock columns and the private table is not published. |
| Save/delete | New invoker/RLS wrappers require the exact active capability again at the final write. Existing v2/v3 financial transactions, optimistic versions, receipt/payment safeguards and request ledger remain in use. |
| Compatibility | Old RPC signatures remain available. Guards reject legacy/raw/child mutations while a new lease is active. With no active new lease, old endpoints retain their previous behavior; this is a staged compatibility boundary, not global enforcement for every old client. |
| Loss/recovery | Failed or expired renewal disables Save and preserves input. Reacquisition checks the original baseline; a changed canonical record cannot silently replace or overwrite the draft. An unsuccessful retry stays lost. |
| Cleanup | Exact capability release cannot clear a later holder. Revoked members can release their own capability without reading trip data. Account/trip generations reject late results. Cleanup verifies live Auth identity before sending old-account metadata. |
| Navigation | Formal keeps inactive workspaces mounted. Leaving Budget releases its leases and flushes dirty drafts; returning restores the draft and reacquires authority before saving. Browser close may rely on expiry rather than a guaranteed unload request. |
| Isolation | No capability in localStorage, drafts, financial payloads or Realtime. Private table RLS enabled, all client table privileges revoked; public RPCs invoker and authenticated-only. Demo has no lease/Auth/network calls. |

Only private metadata helpers elevate privileges; each validates actor and trip membership. Financial DML continues as the requesting user under existing RLS. Child guards cover participants, itinerary links and Actual attachment metadata, including old/new parents. A linked Actual lease can reject a Budget/payment update and roll back the complete transaction. Attachment uploads while an Actual is leased fail safely through the metadata guard; the upload service has not been redesigned in this phase.

## Validation

- The pre-change disposable audit reproduced double-success admission and same-account cross-tab release using the real old helper.
- Full-chain disposable PostgreSQL test `tests/budget-leases-database.mjs` passes: owner/editor vs viewer/pending/outsider/anon, private table denial, same-account and different-account ownership, wrong/expired capability save/delete, takeover, unchanged financial rows after renewals, legacy/raw/participant write guards, optimistic versions, linked-payment rollback, exact Actual debit preservation, revoked-member release, delete cleanup and invoker/EXECUTE privileges. PGlite provides deterministic transaction tests; it is not a hosted concurrent-client benchmark.
- `tests/budgetEditLeases.spec.js` plus `tests/formalBudgetLeases.spec.js`: final **21/21 passed**, included in the **69/69** final regression with rates, Demo, side tabs and route smoke. Real App/StrictMode and production styles with an isolated shared SDK backend: distinct tabs/accounts, independent rows, twelve simulated one-minute renewals, offline recovery, expiry/takeover/retry draft safety, quick payment/delete capabilities, missing API failure, late old-account response, membership revocation, hidden-workspace release and draft restoration.
- Initial integration revealed a delayed unmounted-controller cleanup under a new account; live Auth identity validation fixed it. A heartbeat test initially installed the fake clock after client creation, so it did not intercept the captured timer; installation now precedes App boot. Hidden-workspace testing exposed that Formal hides rather than unmounts Budget; explicit activation handling now releases authority while preserving drafts. A subsequent run could not connect because the local Vite process had stopped; the server was restarted and all 20 final cases passed.
- Before the final activation-only change, broader Budget/Finance/Demo/Formal rates/luggage/cache/route regression passed **106/106**. Final build and diff checks pass; the existing large-bundle advisory remains.
- Build passes with the existing large-bundle advisory. No dependency changes. Browser plugin is unavailable, so repository Playwright uses installed Chromium against localhost; mocked SDK tests cannot prove hosted Realtime authorization or latency.

## Hosted prerequisite repair completed with separate approval

The branch Preview points to Production Supabase `lqvuqamzmchepgxkftcw`. It previously failed at save-v3 HTTP 404. User explicitly approved applying only existing `20261022110000_budget_payment_safety_and_actual_cost.sql` and `20261022120000_unified_planning_payments.sql`, then explicitly approved the Dashboard's “Run without RLS” execution mode for the reviewed original SQL.

The generated wrapper `scripts/qa/prepare-budget-safety-rollout.mjs` applied both unchanged source bodies and migration history in a single transaction. It locked scoped tables, checked the preflight counts and full original-content digests, rejected active legacy locks, validated all preserved content and grants before commit, then reloaded the API schema. Disposable tests prove successful backfill, repeat rejection and full rollback on injected content changes.

Fresh post-commit readback passed **9/9 checks**, before any test-data creation: both history records, five Actual columns, exact original Actual content excluding only new metadata/updated_at, all 13 original budgets, metadata defaults, four baselines, invoker/authenticated-only v2/v3, inaccessible private ledger, and Phase 1 migration absent. Original Actual financial digest `5c1bfe01cf4ff7b95bc500917f8ae45d`; Budget digest `7dc61b89fe73d035645bde5d16eee259`.

Actual branch Preview acceptance used only the new `QA #10 migration 20261027` TWD 1 fixture in `系統測試專用`. Create and note edit succeeded; payment toggle produced one TWD 1 Actual and showed 已付款. save-v3 HTTP 200 was observed. The user explicitly approved deleting this fixture and its test payment afterward; cleanup result is recorded in CURRENT_TASK. Original two Budget rows/TWD 30,310 were not edited. No new Phase 1 hosted API, two-account collaboration or p95 claim follows from this prerequisite test.

Budget deletion succeeded in the UI. Actual deletion repeatedly returned an upstream timeout and did not remove the fixture. A read-only catalog check confirmed the original financial digests were unchanged. The separately saved `docs/qa/2026-10-27-budget-cleanup-test-fixture.sql` removed only the approved test Actual and its three participant rows under table locks, exact ID/title/trip/currency/amount checks, original digest checks before/after, and short transaction timeouts. It preserved the request audit ledger and returned `only_approved_test_actual_deleted_and_originals_preserved`. The hosted old Actual-delete RPC timeout is still unresolved; do not describe this as a fully passing hosted CRUD baseline. No broad database cleanup or server-session cancellation was performed.

Fresh post-cleanup SELECT verifies 13 original budgets with full digest unchanged, one original Actual with financial digest unchanged, four baselines and both fixture counts zero. A fresh branch reload shows its original two rows/TWD 30,310 and no test payment. Evidence: `budget-safety-cleanup-verified.{json,png}`, `budget-safety-hosted-cleaned.png`; SQL in `docs/qa/2026-10-27-budget-cleanup-verify.sql`.

Evidence in this chat's `2026/10/27/01a17d1b-ca24-7312-9082-15797b33c8b6` visualization folder: `budget-safety-preflight.json`, `budget-safety-apply.sql`, `budget-safety-applied.png`, `budget-safety-post-commit.{json,png}`, `budget-safety-hosted-create.json`, `budget-safety-hosted-edit-paid.json`, `budget-safety-hosted-paid.png`, and cleanup evidence. Read-only queries are in `docs/qa/2026-10-27-budget-migrations-{preflight,verify}.sql`.

## Rollout and remaining review gates

1. Review this additive migration and compatibility behavior. Apply only after explicit approval, using a fresh live preflight, transaction and post-commit verification; never replay the two migrations already applied.
2. Enable/publish the new client only after the new APIs exist. Missing APIs fail closed with retained drafts; there is no legacy save fallback.
3. Test real owner/editor/same-account tabs, viewer/pending/outsider, expiry and reconnect on the hosted backend. The private lease RPC does not create a new Channel, expose metadata or change global settings.
4. Phase 0's outsider Channel receive/send test and real two-account/p95 baseline remain open. Shared public Channel settings and Timeline remain unchanged; authorization concerns must be resolved before a collaboration release.
5. Phase 2 adds consistent scoped Budget reads and event coalescing; current financial saves still use existing full-trip refresh behavior. Phase 3 adds stable member outlines and accessible names. No lock owner color is claimed in Phase 1.

Rollback: before client enablement, the additive API can remain unused. After enablement, first disable the new client, stop/expire active leases, then use a separately reviewed reverse migration that removes only this phase's wrappers/triggers/helpers/table. Keep the prior v2/v3 endpoints and all financial data. Dropping active guards while new clients are writing is not a safe rollback.

Changes remain uncommitted/unpushed. #9's projection fix and its tests/documentation must remain separately identifiable at publication; do not combine #9 with #10 in one opaque commit. No main merge, frontend deployment, GitHub edits or issue closure has occurred.
