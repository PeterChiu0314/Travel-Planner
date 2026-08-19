# Timeline Phase 7.1-7.4 | Versioned JSON Exchange Plan

Status: Approved implementation plan for the current Phase 7 branch
Date: 2026-08-19
Branch: `codex/timeline-phase-7`

## 1. Phase Boundary

Phase 7.1-7.4 establishes a stable, versioned JSON exchange boundary for the mature Trip + Timeline domain only.

Included:

- Trip title, destination, date range, and lifecycle status.
- Every Day in the trip date range, including empty Days.
- Timeline visit order, category, content, map/location fields, estimated item cost, complete Timed/Untimed state, and effective fixed state.
- Complete normal-pair transportation, including endpoint relationships, category, name, duration, and note.
- Visit alternatives and their mature content/time fields.
- Export, parser, migration pipeline, normalization, validation, preview, and atomic commit.

Excluded:

- Budget and itinerary-budget links.
- Accommodation.
- Todo and Guide.
- Personal/shared luggage and legacy pack items.
- Actual expenses and settlement.
- Attachments, members, invites, public share links, route overrides, and route collaboration nodes.
- AI schemas, prompts, providers, recommendations, Places enrichment, or automatic itinerary generation.

The excluded modules are not silently dumped into extension bags. A future contract version must add them deliberately.

## 2. Audit Findings

The existing `exportTrip()` in `src/App.jsx` is a raw database-shaped export. It spreads the loaded trip row and includes `itinerary_items`, `pack_items`, and `members`, which leaks Supabase UUIDs, ownership/membership data, timestamps, lock fields, transport snapshots, and internal sort encoding. It has no `schema_version`, serializer boundary, validation, import parser, preview, or round-trip contract.

Formal Trip creation currently performs separate client inserts for `trips` and `trip_members`; that pattern is not safe for a multi-table import because a later failure can leave a partial trip. Supabase's current JavaScript documentation confirms that `supabase-js` cannot group multiple requests into one transaction and recommends a database function called with `supabase.rpc(...)` for multi-statement transactional logic.

The current database invariants relevant to import are:

- Trip dates require `end_date >= start_date`.
- Visit category is one of `attraction`, `food`, `hotel`, `transport`, or `note`.
- Timeline card kind is `visit` or `transport`; only `item_type === "transport"` is a connector card.
- A visit is complete Timed or complete Untimed; partial time is invalid.
- A fixed visit must be Timed.
- A transport is a positive-duration `normal_pair` with distinct same-trip, same-Day visit endpoints.
- Untimed visual position uses the established encoded `sort_order` adapter. That encoding is persistence metadata and must not appear in external JSON.
- Alternatives belong to visits only.

## 3. Versioned JSON Contract

The first version is identified by:

```json
{
  "schema_version": "1",
  "document_type": "travel_studio_trip"
}
```

The canonical shape is:

```json
{
  "schema_version": "1",
  "document_type": "travel_studio_trip",
  "trip": {
    "title": "京都五日散策",
    "destination": {
      "display_name": "日本 · 京都",
      "country": "日本",
      "city": "京都"
    },
    "start_date": "2026-08-19",
    "end_date": "2026-08-21",
    "status": "planning"
  },
  "days": [
    {
      "day_index": 0,
      "date": "2026-08-19",
      "visits": [
        {
          "ref": "day-1-visit-1",
          "category": "attraction",
          "title": "清水寺",
          "location": {
            "name": "清水寺",
            "address": null,
            "map_url": null,
            "latitude": null,
            "longitude": null
          },
          "notes": null,
          "estimated_cost": 0,
          "time": { "start": "09:00", "end": "10:00" },
          "fixed": false,
          "alternatives": []
        }
      ],
      "transports": [
        {
          "ref": "day-1-transport-1",
          "from_visit_ref": "day-1-visit-1",
          "to_visit_ref": "day-1-visit-2",
          "category": "train",
          "name": "JR 奈良線",
          "duration_minutes": 15,
          "notes": null
        }
      ]
    }
  ]
}
```

Contract decisions:

- `days[].visits` array order is the portable visual-order authority. Database `sort_order` is reconstructed by the persistence adapter.
- `ref` values are Day-local relationship keys. They are deterministic per export and are not Supabase IDs; transport endpoints resolve only inside their owning Day.
- Transportation is separate from visit order so suspended normal pairs can retain their endpoints without pretending to be a standalone destination.
- `time` is either a complete `{ start, end }` object or `null`.
- `fixed` preserves the scheduling meaning only. `fixed_at` and `fixed_by` are internal metadata and are regenerated on import.
- `location` keeps mature Timeline location/map semantics. Provider-local Google objects, pending POIs, and route override data are excluded.
- `estimated_cost` is the Timeline card/alternative value, not the Budget module.
- Alternative time is complete or null. Alternatives are nested beneath their parent visit, so no database foreign key is exported.
- The JSON Schema is a contract artifact, not a copy of Supabase tables.

## 4. Adapter and Migration Boundaries

The architecture is:

```text
App/Supabase rows
  -> export adapter/serializer
  -> versioned JSON v1
  -> parser
  -> schema-version migration pipeline
  -> current normalized import model
  -> semantic validator
  -> preview
  -> persistence adapter
  -> one atomic Supabase RPC
```

Planned modules:

- `src/contracts/trip-timeline.v1.schema.json`: machine-readable JSON Schema for the public contract.
- `src/lib/tripJsonContract.js`: constants, parser, version dispatcher/migration pipeline, normalization, validation, preview summary, and stable stringify.
- `src/lib/tripJsonAdapters.js`: App domain/Supabase row to JSON serializer and normalized import model to internal persistence payload adapter.

The migration pipeline uses an explicit registry keyed by source version. Version `1` is the current identity migration after normalization. A future v2 adds a `1 -> 2` migrator and advances the current version without changing the parser/preview/commit orchestration.

## 5. Validation Contract

Validation runs before any database call and reports path-aware errors. It must reject:

- Malformed JSON.
- Missing, non-string, or unsupported `schema_version`.
- Incorrect `document_type`.
- Missing required objects/arrays/fields or incorrect field types.
- Invalid or reversed trip dates.
- Missing, duplicate, non-sequential, out-of-range, or date-mismatched Days.
- Unknown visit categories.
- Partial, malformed, non-positive, or after-24:00 time ranges.
- Fixed Untimed visits.
- Duplicate or malformed portable refs.
- Invalid coordinates or negative estimated costs.
- Transportation with missing/unknown/same/reversed endpoints, a Timed visit between endpoints, duplicate endpoint pairs, invalid category/name, or non-positive duration.
- Invalid alternative content/time.
- Documents above defensive Day/item/alternative limits.

Normalization trims strings, canonicalizes time to `HH:MM`, converts optional blank strings to `null`, and fills only documented optional defaults. It never invents missing required Trip, Day, visit, transport, or relationship data.

Unknown top-level or domain properties are rejected by the v1 schema rather than copied into the database.

## 6. Export

The header's existing `匯出 JSON` action will call the v1 serializer instead of spreading database rows.

Export requirements:

- Only the active trip's in-range Timeline rows and matching alternatives are serialized.
- Every Day in the Trip range is emitted, including empty Days.
- Portable refs are assigned from normalized Day/visit order.
- Times are canonical `HH:MM` strings.
- Transport endpoint UUIDs become portable visit refs.
- Lock, owner/member, UUID, created/updated timestamps, Realtime, transport snapshot, route override, budget, and other excluded fields never appear.
- Output is pretty-printed UTF-8 JSON and downloaded as `.json` with a filesystem-safe trip title.

## 7. Import Preview UX

The New Trip dialog will provide a secondary `匯入 JSON` action. Selecting a file parses and validates it before any write.

The preview dialog shows:

- File name and schema version.
- Trip title, destination, date range, and status.
- Day, visit, transport, alternative, Timed, Untimed, and fixed counts.
- Warnings and path-aware validation errors.

The commit button is disabled when errors exist. Closing the preview or cancelling leaves all formal data unchanged. The user must explicitly select `確認匯入` before the RPC is called.

## 8. Atomic Commit Strategy

A new timestamped migration will define `public.import_trip_timeline_v1(payload jsonb)` as an authenticated, `security invoker` database function.

The function will:

1. Require `auth.uid()`.
2. Recheck the current internal payload version and structural/invariant guards instead of blindly trusting the browser.
3. Create the Trip with the caller as owner.
4. Create the approved owner membership.
5. Generate fresh UUIDs for imported visits while mapping portable refs inside the transaction.
6. Insert visits with complete Timed/Untimed state, reconstructed internal ordering, and regenerated fixed metadata.
7. Insert nested alternatives against the new visit IDs.
8. Insert transport rows last, resolve endpoint refs, and derive review snapshots from the inserted visits.
9. Return the new Trip ID and inserted counts.

A Postgres function call is one transaction. Any validation, cast, constraint, trigger, RLS, or insert failure raises an exception and rolls back the Trip, membership, visits, alternatives, and transports together.

The function will not write Budget, Accommodation, Todo, Guide, Luggage, Settlement, Share, Attachment, or route-override tables. It will revoke default execution and grant only the public wrapper to `authenticated`.

## 9. Phase 6 Compatibility

The import path does not call or replace the Phase 6 scheduler because it creates a new complete Day snapshot rather than mutating an existing scheduled Day.

It preserves Phase 6 by validating before commit and relying on the deployed constraints/triggers during commit:

- Complete Timed/Untimed visits only.
- Positive time ranges ending at or before 24:00.
- Effective fixed state only on Timed visits.
- Valid complete normal-pair transport endpoints and positive durations.
- Existing visual order reconstruction for Untimed visits.
- No tail transport semantics.
- No client-side partial-write compensation.

The import RPC does not modify `apply_timeline_schedule_operation`, `apply_itinerary_alternative`, Auth, Share/Invite, Realtime, draft, edit-lock, Budget, or map-provider behavior.

## 10. Verification Plan

Unit/contract tests:

- Schema/version markers and migration registry.
- Serializer field allowlist and internal-field exclusion.
- Empty Days and complete visit/transport/alternative serialization.
- Every required malformed/invalid input class.
- Preview counts/warnings/errors.
- Portable-order to persistence-order adaptation.
- Semantic round-trip comparison that intentionally ignores database IDs and regenerated metadata.

RPC/integration guards:

- Migration source proves auth, least privilege, single RPC, portable-ref mapping, invariant checks, and all required table inserts.
- Failure occurs before/inside the transaction and no client multi-request fallback exists.
- If a disposable PostgreSQL runtime is available, execute the migration and a rollback fixture; otherwise record the environment limitation and require managed-Staging verification before deployment.

Rendered/Playwright regression:

- Existing Demo Timeline and Formal login boundary continue loading.
- New Trip dialog exposes file selection.
- Import preview renders counts and errors from fixtures where the browser flow can run without mutating Production.
- Existing Phase 6 Planner/RPC and alternative tests remain green.

Final gates:

- Focused Phase 7 tests.
- Full Playwright suite.
- `npm.cmd run build`.
- `git diff --check`.
- Requirement-by-requirement round-trip audit.

## 11. Completion Artifacts

When implementation and verification finish:

- Update `CURRENT_TASK.md` to Phase 7.1-7.4 completed state with exact migration and test evidence.
- Add `docs/2026-08-19-phase-7-json-exchange-closeout-handoff.md`.
- Keep this planning document as the contract rationale and implementation map.
- Do not claim Staging/Production application unless migration history and deployed behavior are directly verified.
