# Issue #10 — Implementation, hosted acceptance and cleanup

Updated October 28, 2026. Budget phases 0–3 are implemented and published through `5bb11c8` on `codex/luggage-workspace-redesign`. The three approved Production migrations are applied; frontend publication is Preview only. **Keep #10 open**, per the user's latest instruction. Final normal Preview verification follows this documentation push. No main merge or Production frontend promotion.

## Implemented boundaries

- Budget/Actual atomic leases bind user, tab session, opaque capability and resource version. Seven-minute expiry and one-minute renewal preserve long edits; uncertain authority retains drafts and disables Save until safe reacquisition.
- One STABLE/RLS snapshot installs Budget, Actual, participants, links, baseline, receipt metadata and required rates/member/itinerary context together. Events coalesce for 80 ms with dirty rerun and account/trip/generation guards. Reconnect/focus reconciles without replacing drafts.
- Stable member colors outline selected/edited rows; local selection remains distinct. Floating names support hover, focus and tap without table geometry changes.
- Budget uses isolated RLS PostgreSQL signals and authenticated APIs, without changing Timeline Broadcast/Presence or global Realtime settings. Private leases/selections have no client table access/publication. Selection sends resource IDs, never draft amounts/text or capabilities.
- Selection expires after 45 seconds; bounded reconcile/expiry clears stale visuals. Signals retain only opaque trip UUID/revision after trip deletion, avoiding published DELETE visibility leakage; deleted trips make these revisions unreadable.
- Demo stays local only. No new dependency or Storage-policy change.

## Applied migrations

The exact reviewed 705-line transaction applied on October 28 returned `budget_collaboration_applied_and_originals_preserved`. Independent post-commit **8/8** checks passed, including all eleven original full-table counts/digests, exact migration sources/history, API privileges, RLS and publication isolation. The earlier October 22 migrations were not replayed.

| Migration | Purpose | SHA-256 |
| --- | --- | --- |
| [20261027140044](../supabase/migrations/20261027140044_budget_atomic_edit_leases.sql) | Leases and guarded writes/receipts | `60684b9931d589248e733275029b236c70c8a11c835d7b5f2c2890292d93f127` |
| [20261027145613](../supabase/migrations/20261027145613_budget_consistent_snapshot.sql) | Consistent financial snapshot | `519b034a0610354418b131d05b413992dd8a86a73cc79dcb6e7a9548dfc2ec07` |
| [20261027152539](../supabase/migrations/20261027152539_budget_collaboration_state.sql) | Private selection / isolated RLS signals | `aabb7a1830425a71a8a4da5e04b0c47f9c0952ee1778278763c38190e4c8b361` |

[Rollout generator](../scripts/qa/prepare-budget-collaboration-rollout.mjs), [readonly readiness](qa/2026-10-27-budget-collaboration-readiness.sql), [preflight](qa/2026-10-27-budget-collaboration-preflight.sql). Disposable tests prove repeat rejection and complete rollback on injected failures. Earlier phase documents preserve historical unapplied/unpublished checkpoints, superseded by this document.

## Hosted Peter/TNT acceptance

| Check | Actual observation |
| --- | --- |
| Anon / outsider / pending | Anon denied `42501`; outsider/pending cannot read snapshot/metadata, select or forge; no Budget signals received despite owner activity |
| Viewer / editor | Viewer reads/selects but cannot add financial records or forge signals. Editor cannot acquire another session's held row |
| Independent rows / long edit | TNT saved B while Peter held A. Peter's draft survived; expiry advanced from 16:40:49 to 16:48:50 UTC and the note later saved |
| Same-account second tab | Shared restored draft retained; Save disabled without capability; competing acquisition refused |
| Offline recovery | CDP network outage **512 seconds**; without reload, remote C appeared and B's note survived. Explicit reacquisition enabled Save; Peter received the saved note |
| Payment / participants | A changed to TWD 4, Peter payer, two TWD 2 shares; paid Actual and totals converged |
| Receipt | QA PDF uploaded by TNT, visible to Peter, deleted by Peter and removed on both; final Storage check zero QA bytes |
| Actual DELETE | First `55P03` reflected the held source-Budget lease. After releasing it, delete-v2 returned **204** (~219 ms to headers); both Actual lists empty and Budget unpaid |
| Budget DELETE | Newly created C removed on TNT without reload; total changed 9 → 6 |
| Foreign currency | USD 4 at shared rate 32.592399 displayed Budget 130 / per-person 65 / trip total 132 on both clients |
| Colors / real SDK | Both latest clients used `main-OFPHOaE9.js`: orange remote A, green local B, floating focus name; row heights 35.994 px |

The immutable `travel-planner-q956rimak-…` deployment contains older client code. Its RLS/financial API results are valid, but it does not certify the later collaboration fix; the latest branch alias was used for that verification.

Ten real snapshot RPC samples: **127, 135, 136, 180, 187, 219, 226, 252, 279, 481 ms**; p50 **187 ms**, p95 **481 ms**. These measure transport, not end-to-end visual sync. The controlled real-App/mock burst comparison is **160 table SELECTs → one snapshot RPC**. A real receiver trace showed scoped financial/metadata reads without unrelated table reloads; its multi-operation window is not a per-operation benchmark. No directly comparable hosted Before/After latency distribution is claimed.

Rapid graph/link mutations, expiry takeover, account/trip ABA, channel failures, larger color groups and touch interactions also have isolated application/SQL regression coverage. They are not exhaustive hosted permutations or physical-device certification. The historical upstream Actual-delete timeout was not reproduced; the successful current delete does not prove its old cause.

## Hosted defects fixed

- `e70000c`: restored localStorage draft could offer Save without in-memory authority. Missing capability now remains unconfirmed; preserve draft, disable Save and check original version on explicit retry.
- `7353f46`: clear only the stale pending-membership Budget notice after successful recovery.
- `d093008`: actual Supabase RPC builders are thenables without `.catch()`; use `try/await/catch`. Four controller cases now use no-catch thenables.
- `5bb11c8`: gate lease watchers by Formal infrastructure so Demo's existing-record editor remains local and usable; add exact cleanup generation and rollback/cascade checks.

## Regression evidence

- Earlier broad regression **167/167** and final phase-three follow-up **10/10**.
- Restored-draft Formal group **13/13**, notice/snapshot/receipt cases **14/14**, thenable/controller/outline **9/9**.
- Final wider selection initially **136/142**; six Demo failures exposed the watcher leak. After fixing it, all affected Demo/safety/sidebar groups plus Formal leases passed **56/56**, covering every failed case. The full 142 was not repeated after that focused fix.
- Five disposable PostgreSQL suites passed, including rollout and cleanup injected rollback.
- Normal build and diff checks passed; normal build omits the optional live QA entry. Existing Vite chunk-size advisory remains.

## Cleanup / preservation

Only the authorized disposable trips were deleted:
- `QA #10 完整驗收 20261027` — `fcb837a1-24f9-4410-9800-6aa2f83d5507`.
- `QA #10 授權隔離 20261027` — `b271db8f-e261-4b93-b04f-ebddf7b80e4c`.

[Cleanup generator](../scripts/qa/prepare-budget-acceptance-cleanup.mjs) checks exact IDs/titles/owner, empty receipts/Storage and eleven originals' complete counts/digests under table locks. Execution returned `only_two_approved_QA_trips_removed_originals_preserved`. Independent **4/4** checks passed: all eleven current original tables unchanged by cleanup, no QA trips, no QA private state, no QA receipt bytes. Original counts remain 7 trips / 12 memberships / 13 budgets / 1 Actual / 4 baselines.

**Preservation boundaries:** all eleven matched immediately after migration. Before cleanup, nine still matched that original rollout baseline exactly, including Budget/Actual, participants, links, attachments and luggage. Full `trips` / `trip_budget_baselines` digests differed. The original system-test trip updated at 2026-10-27 16:14:48 UTC and its baseline captured immediately afterward, consistent with existing automatic empty-rate initialization reached through #9. Exact historical row bodies were not saved, so field-level changes/cause remain unproven. No historical values were guessed or overwritten; a separate fresh pre-cleanup manifest protected all current originals, preserved exactly by cleanup.

Removed the one temporary exact OAuth redirect; original six redirects and Production Site URL retained. Deleted branch-only Preview `BUDGET_QA`; final documentation push triggers a normal rebuild. Older immutable QA-enabled builds remain authenticated historical artifacts; their temporary origin is no longer allowlisted for new login.

Evidence is in this chat's visualization folder: `budget-live-*.json/png`, migration preflight/apply/post-commit files, `budget-acceptance-cleanup-manifest.json`, cleanup/verify SQL, `budget-acceptance-cleaned.png`, `budget-oauth-restored.png`, `budget-qa-flag-removed.png`.

## Publication / remaining boundaries

#9 is separately committed as `8f44086`. #10 stages: `f5f0a2c` audit, `cb49b03` leases, `73e6017` snapshot, `693bca3` integration, `95ad05f` guarded acceptance, followed by the hosted fixes above. Final documentation is pushed after QA-setting removal for the normal Preview rebuild.

Issue #10 stays open for user review. No main merge or Production frontend promotion. Global Timeline/public-channel security and subscription cleanup remain separate scope; this isolated Budget path does not remediate them. Physical-device validation and full hosted per-operation performance distributions remain unclaimed.

Rollback starts by reverting the feature client/draining sessions; review a narrow reverse migration before removing active authority guards. Never silently fall back to unsafe raw financial writes.
