# Timeline Phase 7.1-7.4 | JSON Exchange Closeout and Handoff

Status: Implemented on `codex/timeline-phase-7`; Production RPC applied, feature-branch Preview QA and main integration pending
Date: 2026-08-19
Production frontend/data: Unchanged; Phase 7 RPC migration applied

## Scope Completed

Phase 7.1-7.4 now provides a versioned Trip + Timeline JSON exchange boundary without adding AI behavior or expanding immature modules into the contract.

Implemented artifacts:

- `src/contracts/trip-timeline.v1.schema.json`: JSON Schema Draft 2020-12 contract.
- `src/lib/tripJsonContract.js`: parser, migration dispatcher, normalization, semantic validation, preview summary, stable stringify, and safe filename behavior.
- `src/lib/tripJsonAdapters.js`: App/Supabase row to public JSON serializer and validated JSON to persistence-payload adapter.
- `supabase/migrations/20260819125851_phase_7_import_trip_timeline_v1.sql`: authenticated atomic import RPC.
- `tests/phase-7-trip-json-contract.spec.js`: serializer, parser, validator, adapter, and semantic round-trip coverage.
- `tests/phase-7-trip-json-rpc.spec.js`: RPC and frontend orchestration source guards.
- `src/App.jsx` and `src/styles.css`: formal export replacement, New Trip JSON picker, import preview, and explicit commit UX.

The stable v1 contract contains only Trip basics, all Days, visits, visual order, Timed/Untimed state, effective Fixed state, complete normal-pair transportation, mature location/map fields, Timeline estimated cost, and nested alternatives. It excludes Budget, Accommodation, Todo, Guide, Luggage, Actual/Settlement, Attachment, Member/Invite/Share, route overrides/collaboration, Supabase IDs, locks, timestamps, Realtime metadata, provider-local objects, and all AI concerns.

## Architecture and Behavior

The implemented boundary is:

```text
App/Supabase rows
  -> export adapter
  -> versioned public JSON
  -> parser
  -> version migration registry
  -> normalized current document
  -> semantic validator
  -> import preview
  -> persistence adapter
  -> one atomic Supabase RPC
```

Important decisions:

- `schema_version` is the string `"1"`; `document_type` is `"travel_studio_trip"`.
- `days[].visits` array order is the external visual-order authority. Internal Untimed `sort_order` encoding is reconstructed with the existing Timeline ordering adapter.
- Portable refs are deterministic, Day-local relationship keys. Database UUIDs are regenerated during import.
- A visit time is a complete `{ start, end }` value or `null`; Fixed requires complete Timed state.
- Transportation remains a complete `normal_pair` with Day-scoped visit endpoint refs. It is inserted only after every visit has a fresh UUID.
- The browser parses, migrates, normalizes, validates, and previews without a Supabase call. Only `確認匯入` invokes `import_trip_timeline_v1`.
- The RPC repeats material invariants and creates Trip, owner membership, visits, alternatives, and transports inside one PostgreSQL function call. Any raised error rolls back the statement transaction.
- The import is a complete new-Trip snapshot, so it preserves Phase 6 constraints without calling the existing-day mutation Planner or creating a client compensation path.

## Validation Coverage

The browser rejects malformed JSON, absent/non-string/unsupported versions, incorrect document type, unknown properties, missing required fields, wrong types, invalid/reversed dates, Day count/sequence/date mismatches, invalid categories, partial/invalid time, Fixed Untimed visits, malformed or duplicate Day refs, invalid costs/coordinates, invalid alternatives, and invalid transport endpoints/order/crossing/pairs/duration.

Defensive limits are 5 MB of JSON text, 366 Days, 2,000 visits and transports per Day, and 100 alternatives per visit.

The RPC independently checks authentication, version/type, Trip and Day structure, complete time/fixed/cost/coordinate state, alternative state, Day-scoped refs, transport endpoint/order/crossing/pair scope, and duration. Execution is revoked from `public` and `anon` and granted only to `authenticated`; the function is `security invoker` with a fixed search path.

## Verification Evidence

Local verification on 2026-08-19:

- Focused Phase 7 contract and RPC/source tests: 20/20 passed.
- Focused Phase 7 plus navigation regression: 38/38 passed.
- Full Playwright regression: 291/291 passed.
- Production build: passed. The existing Vite large-chunk notice remains informational.
- `git diff --check`: passed. Existing Windows LF/CRLF notices remain informational.
- Staging-mode local Vite server: HTTP 200 at `http://127.0.0.1:5174/`.

Isolated Supabase Staging `uyqdopksfysbobhjcepk`:

- Project was restored from inactive state and verified `ACTIVE_HEALTHY`.
- Migration `20260819125851_phase_7_import_trip_timeline_v1.sql` compiled and applied successfully as `phase_7_import_trip_timeline_v1`.
- Metadata verification: `security_definer = false`, fixed search path present, anonymous execute denied, authenticated execute allowed.
- Post-migration security advisors did not report the Phase 7 import function. Existing warnings concern earlier intentional public `security definer` RPCs and Staging password-protection configuration.
- Authenticated transaction fixture created one Trip, one approved owner, two visits, one normal-pair transport, and one alternative; it covered Fixed state and an exact `24:00` end time.
- Fixture assertions passed and the outer transaction rolled back. A follow-up query found zero retained fixture Trips.
- An additional deliberately failing transaction fixture was not executed because the external database tool's automatic risk review rejected the call. Do not claim that specific managed-Staging failure fixture passed.

Authenticated rendered Staging QA:

- Google OAuth returned to the local Staging app and loaded the existing `Phase 6 Staging QA` trip through the signed-in Formal route.
- Malformed JSON rendered a path-aware parse error, showed zero preview counts, disabled `確認匯入`, and left the Staging Trip count at 1.
- Valid v1 JSON preview rendered the expected Trip/date information plus 2 Days, 3 visits, 1 transport, 1 alternative, 2 Timed, 1 Untimed, and 1 Fixed. It also rendered the expected suspended-transport warning.
- Explicit `確認匯入` created and selected the new Trip. The rendered Timeline showed A -> Untimed U -> B, Fixed A, a retained transport, and B ending at exact `24:00`; Day 2 remained empty.
- Read-only SQL confirmed one approved owner, 3 visits, 1 `normal_pair` transport, 1 alternative, 1 Fixed visit, 1 Untimed visit, and one exact `24:00` end time.
- The committed Staging rows were fed back through the production serializer. After canonicalizing portable refs, the re-export JSON exactly matched the original normalized v1 document: 2 Days, 3 visits, 1 transport, and 1 alternative with all core semantics unchanged.
- QA exposed a pre-existing shared map-navigation coercion where database `null` coordinates became `0,0`. `googleMapsNavigation.js` now rejects null/undefined/blank coordinates; its regression test and rendered Staging verification passed with a disabled navigation action instead of a false route.
- Both temporary imported QA Trips were deleted by exact verified IDs. Final SQL found 1 total original Staging Trip and 0 retained Phase 7 QA Trips, items, or memberships.
- The only browser console error was the documented Staging Google Maps `RefererNotAllowedMapError`; Phase 7 and Timeline behavior were unaffected.

Production Supabase `lqvuqamzmchepgxkftcw` now records `20260819134935_phase_7_import_trip_timeline_v1`, applied after the user's explicit approval while Git `main` and Vercel Production remained unchanged. Catalog checks confirmed `security invoker`, fixed `search_path=pg_catalog, public, auth`, anonymous execute denied, authenticated execute allowed, and a `jsonb` result. The post-apply security advisor reported no Phase 7 function warning; its warnings concern earlier intentional RPCs and Auth configuration.

An existing Production trip exposed a compatibility gap after migration rollout: Timeline intentionally allows a blank transportation name and displays its category label, but the initial JSON adapter rejected that row. The adapter now exports the same category-label fallback (`train` -> `電車`, etc.) without changing the database row. The regression passed contract tests 14/14, the focused Phase 7 plus navigation suite 39/39, Production build, and `git diff --check`.

## Branch Closeout

The final focused/full tests, Production build, diff check, requirement audit, authenticated Staging round-trip, and QA cleanup are complete. Only intentional Phase 7 source, migration, test, and documentation files belong in the branch commit; local `.tmp-*`, `supabase/.temp/`, and `test-results/` artifacts remain excluded.

## Remaining Frontend Rollout Gate

Do not merge to `main` or update Vercel Production until feature-branch Preview QA is accepted. The Production RPC migration is already applied and verified; the remaining gate is authenticated Preview behavior, cleanup of any deliberately imported Production QA Trip, and explicit approval for frontend integration.
