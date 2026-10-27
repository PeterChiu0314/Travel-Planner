# Issue #10 — Implementation and hosted acceptance

Current status: all three implementation phases are present locally. On October 28 the user explicitly approved the three new migrations, feature-branch/Preview publication, TNT Chiu and named disposable-trip acceptance/cleanup workflow. The reviewed three-migration transaction is now applied to Production `lqvuqamzmchepgxkftcw`; independent post-commit **8/8 checks passed**, including all eleven original tables' full digests and exact source/history. Frontend publication and real acceptance are in progress. Latest instruction: **clean up the new QA data, but keep #10 open**. No main merge is planned. Earlier Phase 0/1/2 documents retain their historical checkpoints.

## Implemented behavior

- Atomic Budget/Actual leases, per-session capabilities, renewal, expiry/takeover, optimistic versions and lost-authority draft preservation; guarded financial and receipt metadata transactions.
- One consistent STABLE/RLS snapshot, scoped/coalesced financial refresh, dirty rerun, account/trip/ABA isolation and reconnect reconciliation. Ten synthetic notifications previously caused 160 table SELECTs per client; the isolated after test uses one financial snapshot. Hosted numbers still need measurement.
- Stable member-colored row frames for both selection and DB-authorized editing. Existing local selected styling remains. Names appear only on hover, focus or row tap in a floating accessible tooltip. Up to four colors use nested frames; larger groups use a segmented multicolor frame and retain every member in the tooltip. No row/column/ordering shifts or permanent status labels.
- Selection and lease display are separate from write authority. Only resource IDs are sent for selection; no draft text, amount, name or capability is transmitted. Same-account tabs remain distinguishable by server-returned own-session flags, without exposing other session IDs.

## Isolated collaboration transport

Budget uses a new PostgreSQL/RLS signal table and authenticated RPCs. It neither sends nor consumes public Broadcast/Presence, and does not depend on the existing shared Timeline channels. This avoids changing the project's global “Allow public access” setting or `realtime.messages` policies. Existing Timeline public-channel concerns remain outside this issue's changes.

`budget_collaboration_signals` contains only trip UUID/revision. Approved readers can SELECT; clients cannot directly INSERT/UPDATE/DELETE; anon has no table privilege. Private selection and lease tables are not published and have no client data privileges. The read RPC checks membership, filters expired/revoked entries and exposes only kind/resource/user/expiry/mode/own-session flag. The write RPC binds ownership to `auth.uid()` and validates the resource's trip; no caller-controlled user ID is accepted.

Selection lifetime is 45 seconds, renewed at most every 15 seconds while selected/visible. Idle reconciliation is bounded to 30 seconds, expiry display is swept locally once a second, and signal bursts coalesce. Leaving Budget clears that session's selection and leases; hidden/offline views clear unconfirmed visuals. Auth/trip generations invalidate old work. If Auth has already changed, old-account cleanup is not sent using new credentials; its remote selection expires within 45 seconds. Lease authority still follows the separate seven-minute lease rules.

The opaque revision row is deliberately retained after trip deletion, so normal trip cleanup never emits a published DELETE hint that bypasses row visibility. It retains no users/resources/business data and is unreadable once the trip no longer exists. A privileged administrative DELETE would still be subject to Supabase's known DELETE delivery behavior; the application has no such signal-delete permission.

## Exact schema change to review

All three are additive and **applied on October 28 with explicit approval**:

| Migration | Contents | SHA-256 |
| --- | --- | --- |
| [20261027140044](../supabase/migrations/20261027140044_budget_atomic_edit_leases.sql) | Private leases, write/child guards, invoker save/delete/receipt APIs | `60684b9931d589248e733275029b236c70c8a11c835d7b5f2c2890292d93f127` |
| [20261027145613](../supabase/migrations/20261027145613_budget_consistent_snapshot.sql) | One read-only consistent snapshot API | `519b034a0610354418b131d05b413992dd8a86a73cc79dcb6e7a9548dfc2ec07` |
| [20261027152539](../supabase/migrations/20261027152539_budget_collaboration_state.sql) | Private selections, RLS-only signal table/publication, scoped selection/metadata APIs | `aabb7a1830425a71a8a4da5e04b0c47f9c0952ee1778278763c38190e4c8b361` |

The two older October 22 safety migrations were already approved/applied. They are not replayed or changed. No new financial columns/backfill, original-row deletions, Storage policy changes, global Realtime changes or dependencies are included.

The [guarded rollout generator](../scripts/qa/prepare-budget-collaboration-rollout.mjs) prepares one transaction, locks eleven original public tables and migration history, rejects active legacy editors/partial or repeated application, checks exact fresh preflight counts/full-content digests, applies unchanged sources, verifies original rows, authenticated-only invoker APIs and private/publication boundaries, registers full source/history and reloads the API schema. Every failure rolls back. Disposable tests prove repeat rejection and injected full rollback.

The current generated 705-line application script and manifest are saved in this chat's visualization folder as `budget-collaboration-apply.sql` and `budget-collaboration-rollout-manifest.json`. Preflight is readonly, saved as [SQL](qa/2026-10-27-budget-collaboration-preflight.sql) and `budget-collaboration-preflight.json` there. Current counts: trips 7, memberships 12, budgets 13, Budget participants 17, Actual 1, Actual participants 1, links 12, baselines 4, attachments 0, private luggage 3, shared luggage 3. The application transaction rejects drift; fresh values must be checked before execution.

The [four-check readiness query](qa/2026-10-27-budget-collaboration-readiness.sql) is safe before application. The generator also creates `budget-collaboration-post-commit.sql`: an independent readonly eight-check query verifies all eleven original tables, exact registered source bodies, API privileges, RLS, isolated publication and empty initial metadata. Both queries pass against the disposable full-chain database; Production post-commit evidence is still pending.

## Verification evidence

- Fresh Production readonly readiness **4/4 true**: older safety prerequisites present, three new versions absent, new objects absent and no active legacy editor. This is a preflight only; new migrations remain unapplied.

- Broad application regression **167/167 passed**, spanning Budget/financial rules, collaboration/leases, sync/cache, receipts, Demo, luggage, routes and workspace navigation. Final visual/controller/QA follow-up **10/10 passed**, including large groups, keyboard auto-scroll and narrow-screen tap/focus. Final normal build and diff check pass; normal build omits the QA entry.
- Five disposable PostgreSQL suites pass: full-chain authorization/atomicity/snapshots/receipts, both earlier Budget financial suites, old two-migration guarded rollout and new three-migration guarded rollout. Viewer/pending/outsider/anon, cross-trip scope, raw signal forgery and private table denial are covered. Metadata reads contain no capability/session hashes or other session IDs. Actual and Budget deletes pass locally; the earlier hosted upstream timeout is not claimed fixed without hosted retesting.
- UI tests verify exact table bounds before/after frames, frame spanning the actual HTML row, fixed user colors, independent members/rows, same-account sessions, no fake losing editor, hover/focus/Esc/tap, offline/reconnect/expiry, and preservation of the original selected appearance. `budget-phase3-outline.png` shows the real App with isolated data.
- Browser plugin is unavailable; repository Playwright uses installed Chromium on localhost. This is not physical-device or hosted Supabase evidence. Build retains the existing large-bundle advisory.

## Publication and real acceptance plan requiring approval

1. Apply only the three reviewed migrations to Supabase `lqvuqamzmchepgxkftcw`, using the guarded transaction and fresh post-commit verification. Keep every original row/value unchanged. Dashboard warning acceptance applies only to this exact reviewed script, without automatic SQL/RLS rewriting.
2. Commit explicit intended paths and push the existing feature branch. Keep #9 separately identifiable; publish the #10 audit/foundations/integration as reviewable commits. Exclude unrelated screenshots, scratch outputs, test-results and local Supabase metadata. Do not merge main or deploy Production frontend.
3. Use the supplied branch Preview and a second origin/browser for the real second account. Enable `BUDGET_QA=1` only for this branch's Preview while accepting; remove that Preview flag and rebuild afterward. Normal builds omit the QA page, as verified locally. The opt-in QA page at `/tests/live-budget/index.html` uses the same authenticated SDK and RLS; it logs sanitized counts/statuses/metadata only, never tokens. It can test reads, own selection, signal reception, expected direct-write denial and ten RPC latency samples; it has no financial create/delete/admin controls.
4. Use the already-authorized Peter Chiu account and, after explicit authorization, the existing TNT Chiu Google account. No password/token extraction or credential transfer. Make two new disposable trips named `QA #10 完整驗收 20261027` and `QA #10 授權隔離 20261027`. Only these new trips/records/memberships are used for role changes and business mutations; original trips including `系統測試專用` stay outside new CRUD.
5. Observe an actual outsider and pending user receiving no signal, no metadata/snapshot and no successful selection/lease; then approve viewer/editor roles only in the new QA trip. Confirm actual two-account and same-account-tab contention, independent rows, colors/names, long lease editing/background recovery, fast payment/participants/link changes, deleted rows, rates, receipts, refresh consistency and measured RPC/REST/p95. Re-test Actual delete and trace any timeout instead of claiming completion.
6. Clear/remove only those disposable QA rows/trips after explicit approval of that named test workflow, verify the eleven original table digests again, and remove the branch Preview QA flag. Opaque signal revisions contain no test user/resource/financial data; their intentional no-DELETE retention remains as documented.
7. Only after all real gates pass, update the issue with actual evidence. **Keep #10 open per the latest user instruction.** No external issue update has yet been sent. A final issue comment will distinguish Git publication, migrations, Preview verification, Production frontend and remaining global Timeline debt.

Rollback: before the new client is enabled, additive APIs can remain unused. If any transaction check fails it rolls back entirely. After enablement, revert the feature client/disable the QA flag first and let active sessions drain; review a narrow reverse migration before removing authority guards. Do not remove active guards or silently fall back to unsafe raw financial writes.
