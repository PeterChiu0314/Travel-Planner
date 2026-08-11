# Timeline Phase 6 | Unified Scheduling Closeout and Handoff

Status: Five-minute auto-scheduling ceiling hotfix verified on Staging; Production rollout pending approval
Branch: `codex/timeline-phase-6-hotfix-five-minute-ceiling`
Publish state: Hotfix code and verification are on the dedicated branch; Production remains on the prior `main` state through the transport-remap closeout
Production migration state: Applied through `20260811124500` on `lqvuqamzmchepgxkftcw`
Staging migration state: Applied through `20260811133000` on `uyqdopksfysbobhjcepk`

## Outcome

Timeline time processing now uses one unified scheduling model for existing-card time edits, Timed/Untimed transitions, normal transport mutations, and destination reorder.

The JavaScript Planner is the deterministic reference used for preview, Demo behavior, and contract tests. Formal writes use the new `apply_timeline_schedule_operation` RPC, which rebuilds the authoritative Day snapshot, validates the full-Day revision, locks rows deterministically, reruns server-side Planner semantics, and applies the result atomically.

The frontend no longer treats a preview batch as write authority and no longer uses best-effort compensation as the scheduling transaction model.

## 2026-08-11 Transport Remap Hotfix

After Production closeout, a real reorder exposed one atomic-apply regression: moving A to the bottom of a Day that preserved both B-to-C and C-to-E transports could temporarily remap one transport onto the pair still occupied by the other. The immediate `itinerary_items_transport_pair_unique_idx` rejected that intermediate state and rolled back the whole reorder; no partial data corruption occurred.

The scoped hotfix adds `20260811124500_timeline_phase_6_defer_transport_pair_uniqueness.sql`. It replaces the immediate partial unique index with a `DEFERRABLE INITIALLY DEFERRED` unique constraint over trip, Day, endpoints, and item type. Intermediate endpoint collisions are therefore checked at transaction completion, while duplicate final transport pairs remain invalid.

Staging and Production exact-fixture QA both passed through the authoritative RPC with A/B/C/E and preserved B-to-C plus C-to-E transports. The final order was B/C/E/A, both transport pairs remained unique, continuation times were correct, an intentional duplicate final pair was rejected, and each fixture transaction rolled back with 0 rows retained. Production migration history aligns through `20260811124500`, linked error-level schema lint passes, and `main` was fast-forwarded and deployed through `f79559b`. The authenticated Production Timeline rendered meaningful content without a framework overlay or relevant app console error, and its deployed bundle contains the localized fallback message.

## 2026-08-11 Five-Minute Auto-Scheduling Ceiling Hotfix

Transport-aware continuation exposed a second scoped regression: the unified Planner used the exact sum of the previous visit end and transport duration. For example, `16:10 + 8` produced `16:18`, breaking the established Timeline rule that automatically calculated times sit on five-minute boundaries.

The hotfix rounds only the automatically calculated next-visit start upward to the next five-minute boundary. It does not round or mutate the stored transport duration, it preserves the destination visit duration after shifting, and a sum already on a five-minute boundary remains unchanged. Explicit user-entered anchor times remain exact. Earlier-conflict guidance uses the same rounded earliest start.

JavaScript preview/Demo behavior and the authoritative SQL Planner were changed together. Migration `20260811133000_timeline_phase_6_restore_five_minute_ceiling.sql` adds a private immutable rounding helper and replaces the authoritative Planner without editing any applied migration in place.

Staging verification passed through the authoritative RPC: A stayed `15:10-16:10`; an 8-minute A-to-B transport produced B `16:20-17:20`; a 7-minute B-to-C transport produced C `17:30-18:00`; stored transport durations remained `[8,7]`. The fixture ran inside a transaction ending in `ROLLBACK`. Error-level schema lint passed for `public` and `app_private`. The focused Planner/RPC contract passed 50/50 and the broader Planner/RPC/reorder/Untimed/transport regression passed 100/100.

Production remains unchanged at migration `20260811124500`. Applying `20260811133000` requires exact Production project verification, a dry run showing only this migration, and a new explicit user approval.

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

Final pre-Production verification on 2026-08-11:

- Staging insert-after-preview invalidation passed with `stale_manifest`; the inserted fixture was contained in a transaction and rolled back.
- Staging delete-after-preview invalidation passed with `stale_manifest`; the deleted fixture was contained in a transaction and rolled back.
- A true two-connection contention test passed. Client 1 applied D `23:00-23:25` and held the per-Day transaction lock for eight seconds. Client 2 captured the old baseline while client 1 was active, waited on the same Day lock, and then rejected with `stale_item` instead of overwriting client 1.
- D was restored through `apply_timeline_schedule_operation` and a follow-up query confirmed `23:00-23:30`.
- Production project `lqvuqamzmchepgxkftcw` was queried with read-only `SELECT` statements only. Across 127 Timeline rows, the Phase 6 cleanup would normalize 8 partial-time visits to Untimed and delete 1 structurally invalid transport row.
- Production counts were 0 for tail roles requiring promotion, remaining role normalization, complete visit ranges with `end_time <= start_time`, and normal-pair transports with missing/non-positive duration.
- No Production row, schema, setting, migration, Auth, Storage, or Realtime state was changed.
- The affected rows were reviewed by trip/name: 7 partial-time visits and invalid `JR東西線` transport belong to `京都琵琶湖之旅-TEST`; 1 partial-time visit belongs to `野人沒有日記`. All partial rows have a start time and no end time.
- The user confirmed all 9 affected rows are test data, approved converting the 8 visits to Untimed and deleting the invalid transport, waived a separate backup for these rows, and explicitly approved Production rollout.

Production rollout and smoke verification on 2026-08-11:

- A linked dry-run confirmed the Production project was `lqvuqamzmchepgxkftcw` and only `20260809090000` plus `20260809091000` were pending. Both migrations then applied successfully in timestamp order.
- Local and remote migration history aligned through `20260809091000` after apply.
- Post-migration SQL verification found 126 Timeline rows, 0 partial-time visits, and 0 structurally invalid transport rows. The public authoritative RPC, all three Phase 6 constraints, and `enforce_timeline_transport_pair_scope` trigger exist.
- All 8 approved partial-time visits were verified as complete Untimed. The invalid `JR東西線` row whose source was `八坂神社` is gone. A separate valid same-name row with complete endpoints remains intentionally.
- `main` fast-forwarded from `b9e3f77` through `3f21f3a` and pushed successfully. Vercel served the matching authenticated app at `https://peter-travel-planner.vercel.app/` with meaningful content and no framework overlay.
- Authenticated Production smoke used the existing `系統測試專用` trip. Existing-card time continuation, Timed-to-Untimed and restore, transport create/update/delete, Timed keyboard reorder, Untimed keyboard reorder, Fixed-boundary overflow confirmation/conversion, and reload persistence all passed.
- The temporary transport `Phase 6 Production QA` was deleted. Day 2 returned to `AA 08:30-09:30`, `RE 09:30-10:00`, `7-11 京都七条大宮店 10:00-10:20`, and `銀閣寺 11:20-11:45`.
- Day 4 returned to its original order and times. Untimed reorder correctly removed the old gap before `F2_1h30min`; the test cleanup explicitly restored `F2_1h30min` to `08:30-10:00`, and a final reload confirmed persistence.
- No app console error appeared. The only warning was Google Maps' existing `google.maps.Marker` deprecation notice, outside Phase 6 scope. Browser screenshot capture timed out, so final rendered evidence is the live DOM/state checks plus reload verification.

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
| Demo/Formal parity and rendered behavior | 260-test full suite, Browser Demo interaction, authenticated Formal Staging mutation/reload QA, authenticated Production mutation/restore/reload QA, read-only SQL final-state verification |

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

Production rollout completed:

1. Applied the two approved Production migrations in timestamp order.
2. Verified migration history, constraints/RPC/trigger, and the approved cleanup result of 8 Untimed visits plus 1 deleted invalid transport.
3. Fast-forwarded and deployed the matching frontend with the Production RPC.
4. Passed authenticated Formal smoke for time edit, clear/restore, transport CRUD, Timed/Untimed reorder, Fixed overflow, and reload persistence.
5. Restored all temporary QA mutations and kept `.tmp-*`, `test-results/`, and `supabase/.temp/` untracked.

## Next Handoff

Timeline Phase 6 is closed on Production. The database, cleanup, frontend deployment, authenticated mutation matrix, reload persistence, and QA restoration all passed. Preserve this state and do not start another phase until the user explicitly selects it.
