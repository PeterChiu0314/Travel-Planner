# PT409 Staging HTTP / independent-session acceptance — 2026-10-31

Decision: **Passed for this incident hotfix's HTTP and independent Auth-session scope. Budget B-7 remains BLOCKED / NO-GO.** No Production mutation, frontend deployment, main merge, Docker/WSL action, B-7 migration or feature/protocol activation occurred in this follow-up.

## Target and explicit authorization

Target is only `Travel-Planner-Staging`, project `uyqdopksfysbobhjcepk`. Starting feature-branch HEAD: `ecf15bd23431137ccbe53b16a8c451b425929132`. The user selected PT409 HTTP / two-session acceptance, then explicitly authorized 14 historical baseline migrations (`20261022090000` through `20261028104333`), this hotfix, ledger registration, disposable Auth accounts / isolated trip fixtures and cleanup. An automatic approval rejection occurred before the persistent apply; it was not bypassed. The exact mutation proceeded only after that additional authorization.

Initial independent inventory: 2 trips, 1 existing Auth user, no Budget / Actual / personal or shared luggage rows, no Budget Delete RPC. Staging's old ledger ended at `20260819125851`. A transactional transient SQL function would not test the deployed implementation, so the reviewed historical baseline was necessary. No October 29–30 B-1–B-7 sources were included. The old Timeline migration gap was not filled as part of this unrelated incident.

Observed Staging versions: Auth 2.197.0, PostgREST 14.15, PostgreSQL 17.6.1.155. This differs from the earlier Production PostgREST 14.5 observation; the result is not exact environment parity. Auth health/settings HTTP returned 200; email confirmation remained enabled. No Auth configuration or existing user's credential was changed.

## Baseline installation and protection

`node scripts/qa/prepare-staging-conflict-baseline.mjs` generates two local review packets: rollback-only rehearsal and commit. It never connects to a database. The packet pins the observed old ledger head, 2 trips / 1 user and empty financial/luggage tables; unexpected drift aborts. It records every existing public table's original-column digest in a temporary RLS-enabled table, installs the 14 exact migration bodies plus hotfix and their full source ledger entries, then compares all original-column data. New baseline/rate metadata follows the reviewed historical migrations; this is not a claim that old table schemas remained unchanged.

Both the **ROLLBACK rehearsal** and the explicitly authorized **COMMIT** passed. All 13 inventoried routines map business conflicts to PT409; their historical guards remain. The packet checks zero custom business `40001` definitions and rejects presence of the B-7 metadata protocol. The Dashboard's private ledger RLS warning was reviewed: historical `app_private.budget_workspace_requests` has all direct public/anon/authenticated privileges revoked. Its lack of RLS was not silently changed by the editor's automatic option.

Independent post-commit readback verified **15/15 migration-source SHA-256 hashes** against LF-normalized repository sources. This verifies those recorded sources, not every unrelated historical migration or complete Production parity. Full baseline file list and hashes: [sanitized evidence](qa/2026-10-31-staging-pt409-http-results.json).

## Actual HTTP / session results

`scripts/qa/run-staging-business-conflicts.mjs` hard-rejects any target other than the named Staging, checks key roles/project, and requires `--authorized-disposable-fixtures`. Two disposable confirmed users were created via the real Auth Admin endpoint, with random passwords and reserved `.invalid` addresses; no messages were sent. Password grants produced **three distinct real sessions**: account A, account B and a second login for A. `/auth/v1/user` verified each identity. No JWT was fabricated and no session state was mocked.

The existing Staging service-role key was used only for fixture provisioning / cleanup. Every acceptance RPC, snapshot, luggage read and client persistence call used an ordinary authenticated user's JWT plus the public API key. No test gained access to the existing user's trips. API-key handling follows [Supabase's official key guidance](https://supabase.com/docs/guides/getting-started/api-keys), [Auth Admin provisioning](https://supabase.com/docs/reference/javascript/auth-admin-createuser) and [password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword). The temporary local administrative key file was removed after acceptance.

| Acceptance group | Result |
| --- | --- |
| Real Auth identities / separate sessions; creation of Budget, participants and retained payment | Passed |
| A/B simultaneous same-base Save | Passed: exactly one HTTP 200 and one HTTP **409 / PT409**; loser cannot replace winner, retained Actual / allocations / Receipt metadata unchanged |
| Missing/stale Delete base; nonexistent record; stale Save and identical failed request replay | Passed: bounded 409/PT409, complete snapshot unchanged |
| Payment expected-version conflict | Passed: retained payment, cost, allocations and history unchanged |
| Successful request replay from A's second Auth session | Passed: original receipt returned, no repeated financial writes or overwrite |
| Separate tab capabilities, contention and stale lease admission | Passed: contention denied, stale admission PT409; legacy lease-held Save remains **500 / 55P03**, rejects without writes |
| Selection v1/v2 and Receipt missing-resource guards | Passed: 409/PT409; no Receipt metadata change. Storage bytes were not tested |
| Actual client persistence module against HTTP | Passed: one failed mutation, one authoritative reload, draft retained; no automatic retry. This is not rendered browser UI acceptance |
| Luggage Save / Assign / Privatize / Reorder | Passed: each stale version returns 409/PT409, both luggage scopes unchanged |
| Member changed to pending | Passed: authenticated request denied with HTTP **403 / 42501**, financial graph unchanged |
| Valid legacy Delete | Passed: delete works, retained Actual keeps `budget_origin_id`, cost, allocations, payment-active state and history |

There are **20 distinct passed cases**, not the sum of repeated setup runs. Across the three bounded runs: 109 non-admin HTTP requests, 18 PT409 responses; slowest PT409 response 160 ms, slowest non-admin request 583 ms. No request timeout was raised (10-second bound throughout), and no custom 40001 response was returned. This is bounded observed behavior, not a long-duration performance guarantee. Node made actual HTTP requests to hosted Auth/PostgREST; direct SQL was used only for installation, catalog/readback and final QA tombstone cleanup, never as a substitute for HTTP acceptance.

## Failed assumptions and targeted recovery

- Before any HTTP write, the runner's first key-format check assumed the public key was a JWT; Staging uses a publishable key. Added strict support for both formats without changing permissions or the target guard.
- First HTTP run: 9 passed, 1 assertion failed because lease error `55P03` was incorrectly expected to map to 409. [PostgREST's official mapping](https://docs.postgrest.org/en/v14/references/errors.html) specifies `55* -> 500`. Corrected the exact status expectation while retaining the code / refusal / complete-graph invariants. Subsequent run repeated only required Auth/create/race setup and the affected or unrun cases; six unaffected passed cases were skipped.
- Second run: 13 passed, final valid-Delete assertion failed on `payment_origin`. Source inspection showed the historical `keep_actual_twd_cost` trigger deliberately relabels a detached Actual as `manual`; Source contract also expects a detached row to be manual. Immutable historical identity is `budget_origin_id`, which remained intact. Replaced the mistaken immutability assumption with exact `budget_toggle -> manual` lifecycle assertions; retained every cost, history, allocation and historical-ID check. Only valid Delete and its two necessary setup cases were rerun: **3/3 passed**.
- Every run deleted and read back its own fixture trip and two Auth users. Independent DB audit then found two opaque revision tombstones left intentionally by normal trip deletion after lease activity. The table was newly installed and empty before QA; all two rows were isolated QA IDs without live trips. A guarded cleanup verified exactly two orphan rows, no leases/selections and original trip/user counts before removing them. Added exact-fixture-ID HTTP cleanup to the runner; its DELETE/readback endpoint was separately exercised successfully without rerunning functional cases.

These were incorrect test assumptions / fixture cleanup gaps, not changes to financial behavior or relaxed correctness checks. No application or SQL migration source was modified in this follow-up.

## Final independent readback and limits

At **2026-10-31 11:29:50 Asia/Taipei** (03:29:50 UTC):

- Existing counts: **2 trips / 1 Auth user**; QA users **0**. Budget, Actual and both luggage scopes **0**.
- Leases, selections, request receipts and orphan collaboration signals **0**. Active authenticator queries **0** at that observation.
- **13 PT409 routines / 0 custom 40001**, **9 public invoker routines**, anon execution denied for those routines, authenticated direct private-ledger read denied.
- Ledger head `20261031003000`; **15 new entries / 15 matching source hashes**; B-7 metadata protocol absent.

No P0/P1 defect was found in the scoped hotfix acceptance. **P2 recorded:** legacy lease-held mutation still returns an HTTP 500 business rejection (`55P03`), even though data/draft safety passed; normalizing that transport status needs a separate reviewed change. It does not reproduce the 40001 retry incident.

Browser screenshots of baseline apply and final independent readback remain outside Git; selected result data contains no secrets, personal paths, existing identities or raw logs. Script syntax and `git diff --check` pass. No product frontend changes were made, so the prior build result from `ecf15bd` was retained without an unrelated rebuild or historical suite rerun.

**Not verified here:** rendered two-tab UI / Playwright flows, Realtime transport, Storage bytes / Worker, full Security Advisor, B-7 group protocol, or Production CPU recovery. No Production endpoint was contacted in this follow-up. Dormant B-7 sources still require a separate business-40001 audit and full service acceptance before any activation. Feature-branch push is not frontend deployment. Stop for review; no automatic next stage.
