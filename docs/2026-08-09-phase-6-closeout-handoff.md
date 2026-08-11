# Timeline Phase 6 | Unified Scheduling Closeout and Handoff

Status: Implementation/automated QA published; isolated Supabase Staging verification passed on 2026-08-10
Branch: `codex/timeline-phase-6-1`
Publish state: Base commit `3f924b9` plus authenticated Staging QA fixes and this evidence are published on `origin/codex/timeline-phase-6-1`
Production migration state: New Phase 6 migrations are not applied
Staging migration state: Applied through `20260809091000` on `uyqdopksfysbobhjcepk`

## Outcome

Timeline time processing now uses one unified scheduling model for existing-card time edits, Timed/Untimed transitions, normal transport mutations, and destination reorder.

The JavaScript Planner is the deterministic reference used for preview, Demo behavior, and contract tests. Formal writes use the new `apply_timeline_schedule_operation` RPC, which rebuilds the authoritative Day snapshot, validates the full-Day revision, locks rows deterministically, reruns server-side Planner semantics, and applies the result atomically.

The frontend no longer treats a preview batch as write authority and no longer uses best-effort compensation as the scheduling transaction model.

## User-Facing Rules Now Implemented

- A destination is either complete Timed or complete Untimed; partial time is invalid.
- Existing-card time changes automatically repack the affected downstream segment with no historical gaps while preserving visit duration.
- The earlier segment and content after the next fixed anchor remain unchanged.
- A valid incoming transport duration counts against a fixed boundary.
- Fixed or 24:00 overflow converts only the non-fitting suffix to Untimed.
- Untimed cards keep visual position and block transport from bridging across them.
- Pure time shifts save without confirmation.
- Automatic Untimed conversion or implicit transport removal requires one major-effect confirmation.
- The manual `接續` action, transportation-pair conflict dialog, tail transport insertion/promotion UI, and transport-time-shortage warning are removed.
- Adding a new destination remains outside the unified Planner triggers; existing overlap validation stays in place.

## Runtime Architecture

Primary reference implementation:

- `src/lib/timelineSchedulePlanner.js`
  - strict time parsing and normalization;
  - `edit_time`, `restore_time`, `clear_time`, `upsert_transport`, `delete_transport`, and `reorder` intents;
  - deterministic continuation, fixed/day overflow, transport suspension/removal classification, and sort-order attachment;
  - package source-ID to stable slot-ID remapping for reorder.

App integration:

- `src/App.jsx`
  - Formal operations call `apply_timeline_schedule_operation`;
  - Demo applies the same Planner result to local state;
  - time edit, Timed/Untimed transitions, normal transport add/edit/delete, and timed/untimed drag all use the unified plan;
  - legacy Demo partial-time fixtures are normalized to complete Untimed values.

Transport/order cleanup:

- `src/lib/timelineTransportationRoles.js` accepts only complete `normal_pair` rows.
- `src/lib/timelineUntimedOrdering.js` no longer promotes tail transports.
- `src/lib/destinationPackages.js` no longer preserves tail transports.
- `src/lib/timelineAutoContinuation.js` and `src/lib/timelineTransportationConflicts.js` were removed after their callers and UI contracts were replaced.

## Final Audit Hardening

- Direct edits immediately before Fixed include the incoming normal-pair transport. If the edited destination cannot fit, the timed suffix beginning at that destination becomes Untimed rather than leaving an invalid card in place.
- JavaScript and SQL reorder both retain the original first affected timed slot as the scheduling anchor and reject cross-Fixed exchanges even when the Fixed index appears unchanged.
- Reorder removes only transport pairs newly broken by the current operation; pairs already suspended before the operation remain stored.
- RPC apply binds `target_item_id`, transport endpoints, and transport duration to the validated operation intent, preventing payload identity substitution.
- Pure Untimed/visual reorder does not require timed package manifests; timed package reorder still validates both slot and source arrays.
- Missing/empty reorder manifests, malformed transport duration input, and transport IDs that collide with destination IDs reject before mutation in both JavaScript and SQL contracts.
- Confirmation previews retain the full-Day `updated_at` baselines and complete material plan captured when the preview was created. Confirmation never silently adopts a newer baseline.
- Reload convergence is covered: replanning an applied authoritative result does not create compensation updates.
- `destinationPackages.js` is now a stable-slot package/remap utility; its legacy timed continuation entry point is only a compatibility adapter to the unified Planner and no longer contains a second scheduling algorithm.

## Database Migrations

New migrations, unapplied to Production and applied only to isolated Staging:

1. `supabase/migrations/20260809090000_timeline_phase_6_unified_schedule_operation.sql`
   - private server-side Planner and snapshot helpers;
   - authenticated public apply wrapper;
   - advisory Day lock and deterministic row locks;
   - full-Day item manifest plus `updated_at` revision validation;
   - re-preview on changed major effects;
   - atomic destination, transport, package, alternative, and budget-link writes;
   - `preview_result` is explicitly non-authoritative.
2. `supabase/migrations/20260809091000_timeline_phase_6_cleanup_legacy_time_transport.sql`
   - normalizes legacy partial times;
   - removes legacy tail transport rows;
   - enforces complete time states and complete normal-pair transport scope.

These migrations have not been applied to Supabase production. Because this workstation has neither `docker` nor `psql`, a disposable PGlite PostgreSQL runtime was used for local execution: the complete migration chain from `001` through both Phase 6 migrations ran successfully. PGlite does not bundle Supabase's preinstalled `pgcrypto` extension, so the harness skipped only the historical `create extension if not exists pgcrypto` declarations; both Phase 6 migration bodies executed unchanged.

The disposable database also executed one authoritative `edit_time` RPC mutation. It changed the target from `09:00-10:00` to `09:00-10:15`, repacked the next destination from `10:30-11:30` to `10:15-11:15`, and rejected reuse of the original full-Day baseline with `stale_item`. This proves PostgreSQL compilation plus a minimal atomic apply/stale guard; it does not substitute for Supabase-managed staging Auth/RLS coverage, production cleanup review, or authenticated Formal QA.

Read-only linked Supabase verification on 2026-08-09:

- `supabase migration list --linked` shows Production aligned with local history through `20260712033758`; both Phase 6 migrations are local-only.
- `supabase db push --linked --dry-run` lists only `20260809090000` followed by `20260809091000` and explicitly performs no push.
- `supabase db lint --linked --schema public,app_private --level error --fail-on error` passes for the currently deployed schema.
- These linked checks prove migration discovery/order and the clean pre-Phase-6 database baseline. Compilation/execution evidence comes from the isolated PGlite run above; Production remains unchanged.

Supabase-managed Staging verification on 2026-08-10:

- The unusable empty Staging project was deleted and replaced with free project `Travel-Planner-Staging` (`uyqdopksfysbobhjcepk`, `ap-northeast-1`). The replacement reports `ACTIVE_HEALTHY`.
- A dedicated CLI workdir links only to Staging, keeping Production project `lqvuqamzmchepgxkftcw` isolated.
- All 29 migrations applied in order through `20260809091000`; local and Staging migration history match exactly.
- `db lint --schema public,app_private --level error --fail-on error` passed after migration.
- Catalog checks confirmed the Phase 6 RPC, complete-time constraint, transport constraint, and transport scope trigger.
- A transactional authoritative smoke changed A from `09:00-10:00` to `09:00-10:15`, repacked B from `10:30-11:30` to `10:15-11:15`, rejected a stale baseline with `stale_item`, rejected a non-member with `permission_denied`, and exposed exactly 2 itinerary rows through authenticated RLS for the owner.
- The smoke transaction rolled back; a follow-up query confirmed the fixture trip/items were not retained.
- Staging Auth Site URL is `http://127.0.0.1:5174`, with `http://127.0.0.1:5174/**` in the redirect allow list.
- Google Cloud project `Travel Planner` contains a separate `Travel Planner Staging` web OAuth client. Its only configured callback is `https://uyqdopksfysbobhjcepk.supabase.co/auth/v1/callback`; its client secret was entered directly into Staging Supabase and was not written to the repository or chat.
- Real browser Auth smoke passed against the local `staging` Vite mode: Google OAuth returned to `127.0.0.1:5174`, the signed-in account rendered, and the isolated Staging account showed 0 trips.
- No migration, fixture, Auth, Storage, Realtime, URL, or API-key setting was changed in Production.

Authenticated Formal Staging Timeline QA on 2026-08-10:

- A Staging-only trip `Phase 6 Staging QA` (`855d507e-daa3-4752-9d42-a91f05d06d7c`) was created through the real UI with six isolated Day 1 fixtures.
- Existing-card time continuation passed: extending A to `09:00-10:15` repacked B to `10:15-11:15` while Fixed C stayed `13:00-14:00`.
- Timed-to-Untimed and Untimed-to-Timed transitions passed.
- Transport add (`15` minutes), change (`20` minutes), and delete passed and repacked B as expected without moving Fixed C.
- Day overflow passed: setting D to `23:00-23:30` produced the major-effect confirmation and converted E to Untimed.
- Fixed-boundary overflow passed: editing B to `12:30-13:30` produced the major-effect confirmation and converted B to Untimed while preserving A and Fixed C.
- Timed reorder passed: moving B before A yielded B `09:00-10:00` and A `10:00-11:15`. Dragging A across Fixed C was rejected with no ordering or time mutation.
- Untimed visual reorder passed: U moved before E without changing Timed times. Reload preserved the final visual state.
- A read-only SQL query in the Staging dashboard confirmed the final six rows, complete Timed/Untimed pairs, Fixed C, and no remaining transport row.
- Browser page identity, meaningful DOM, and framework-overlay checks passed. Non-map console health passed earlier in the run; the known Staging-only Google Maps `RefererNotAllowedMapError` remains because the Production Maps referrer configuration was intentionally not changed.
- Final screenshot capture was not completed because the Browser security review later blocked localhost access; final-state evidence remains the post-reload DOM snapshot and read-only SQL result.
- Formal QA found PostgreSQL `HH:MM:SS` transport snapshots were compared against client `HH:MM`, causing a false `交通資訊需確認` warning. Times are now normalized to minute precision in `src/lib/timelineTransportationRoles.js` and `src/App.jsx`, with focused regression coverage.
- Formal QA also found cross-Fixed rejection displayed raw code `fixed_boundary_crossed`; `destinationReorderErrorMessage` now maps it to `固定行程是排程邊界，無法跨越拖曳。`.
- Post-fix focused Planner/RPC/reorder/transport regression passed 63/63. Production build and `git diff --check` passed.

## Completion Evidence Matrix

| Phase 6 contract | Authoritative implementation and verification evidence |
| --- | --- |
| Canonical Timed/Untimed state, no partial time | `timelineSchedulePlanner.js`, cleanup constraints/trigger, Planner invalid-state cases |
| Single-card extend/shorten, earlier conflict, later repack, duration preservation | Planner edit tests plus Demo save/continuation Playwright cases |
| Untimed transparency and Timed/Untimed transitions | Planner clear/restore/mixed-node tests and untimed ordering regressions |
| Transport add/edit/delete, endpoint suspension, no bridge across Untimed | Planner transport cases, complete `normal_pair` role filter, cleanup scope trigger |
| Fixed and 24:00 overflow | Fixed containment/incoming-transport/suffix tests and exact-day-boundary tests |
| Reorder start, gap removal, broken transport, Fixed boundary | Planner reorder tests, Phase 4.2 compatibility regressions, Formal/Demo parity assertions |
| Confirmation classification | `timelineScheduleMajorEffect`, material effect key, Planner major-effect fixtures |
| Collaboration, stale preview protection, atomic apply | full-Day ID/timestamp baselines, advisory/row locks, authoritative server replan, re-preview tests, disposable PostgreSQL RPC apply, plus managed-Staging apply/stale/permission/RLS smoke |
| Realtime/reload convergence | applied-authority convergence fixture plus existing presence/realtime regression suite |
| Single Planner and legacy cleanup | App RPC caller assertions, compatibility adapter delegation, removed legacy modules/UI/RPC callers |
| Demo/Formal parity and rendered behavior | 260-test full suite, Browser Demo interaction, authenticated Formal Staging mutation/reload QA, read-only SQL final-state verification |

## Verification

- Phase 6 Planner/RPC regression: 45/45 passed.
- Focused Phase 6 Planner/RPC and reorder regression: 85/85 passed.
- Full Playwright regression: 260/260 passed after legacy-spec removal and final audit coverage.
- Phase 6 Planner includes fixed-boundary incoming transport, cross-Fixed reorder, stale-preview, suspended-transport, and reload-convergence coverage.
- Production build: passed.
- `git diff --check`: passed; existing Windows LF/CRLF notices remain informational.
- Browser QA: `/demo/timeline` loaded with the expected page identity and meaningful content, no framework overlay, and no relevant console warning/error. On Day 6, extending `高時川の桜並木` from `10:30-12:00` to `10:30-13:00` repacked the following Timed cards to `13:00-14:30` and `14:30-16:30`. Desktop and mobile viewports rendered without horizontal overflow.
- Read-only Formal-route QA: local `/` loaded the current branch's Google-login boundary and Demo link with meaningful DOM, no framework overlay, and no console warning/error. No authentication or data mutation was performed.
- Disposable PostgreSQL execution: all migrations from `001` through `20260809091000` passed in order under PGlite after skipping only unavailable `pgcrypto` extension declarations; both Phase 6 migration bodies ran unchanged.
- Disposable authoritative RPC smoke: `edit_time` applied and repacked its downstream destination, then the same request with its stale original baseline rejected with `stale_item`.
- Supabase-managed Staging smoke: full migration history and lint passed; authoritative `edit_time`, continuation, stale guard, permission guard, and authenticated RLS visibility passed in a rolled-back fixture transaction.
- Staging browser Auth smoke: dedicated Google OAuth client/provider returned to the local Staging app and rendered the authenticated zero-trip state.
- Vite's existing large-chunk warning remains informational.

## Protected Scope

Phase 6 did not redesign Auth, Share/Invite, Budget, map provider behavior, route-node collaboration, Realtime presence, or add-destination behavior. Demo remains local-only and unauthenticated.

Applied migrations 019 through 024 and the existing route migrations were not edited.

## Rollout Checklist

Before production rollout:

1. Optionally run the two remaining high-contention cases on Supabase-managed Staging: inserted/deleted Day-revision invalidation and a true simultaneous multi-client re-preview. Existing-card mutations, major effects, transport CRUD, reorder, stale rejection, permission denial, and owner RLS visibility are covered.
2. Keep the two Staging QA fixes covered by the focused transport/reorder regression when preparing Production rollout.
3. Inspect the legacy partial-time and tail-transport cleanup counts before applying to production.
4. Apply the migrations in timestamp order only after review.
5. Run authenticated Formal smoke tests for time edit, clear/restore, transport CRUD, timed/untimed reorder, fixed overflow, and concurrent re-preview.
6. Commit and push only the intentional Phase 6 files; keep `.tmp-*`, `test-results/`, and `supabase/.temp/` untracked.

## Next Handoff

The Phase 6 code and authenticated Formal Staging QA fixes are published. The isolated Staging database is healthy, fully migrated, connected through dedicated Google OAuth, and verified through the primary mutation matrix. The next optional checks are inserted/deleted Day-revision invalidation and a true simultaneous multi-client re-preview; Production remains unchanged and requires separate rollout approval.
