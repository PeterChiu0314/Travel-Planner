# CURRENT_TASK.md

This file is the concise live project ledger. Keep it aligned with the real branch, deployed behavior, production migration state, and next requested phase.

Historical Phase 4 through Phase 5.7c detail is preserved in:

- `docs/archive/Timeline_Phase5/2026-07-12-current-task-through-phase-5-7c.md`

Do not copy completed phase-by-phase logs back into this file. Use the active handoff, closeout, and QA documents for implementation history.

## Start Here

Read these sources before implementation:

1. `AGENT.md`
2. `docs/UX_RULES.md`
3. `docs/BUGS.md`
4. This file
5. The handoff or plan for the explicitly requested phase

Current source-of-truth documents:

- `docs/2026-08-09-phase-6-closeout-handoff.md`
- `docs/2026-08-09-phase-6-1-time-model-and-auto-scheduling-rules.md`
- `docs/todo/2026-08-09-phase-6-2-unified-planner-implementation-plan.md`
- `docs/2026-07-28-phase-5-10-automated-qa.md`
- `docs/timeline-card-ui-spec.md`
- `docs/2026-07-19-phase-5-9-itinerary-editor-ui-handoff.md`
- `docs/2026-07-12-phase-5-7d-remote-route-node-visual-plan.md`
- `docs/2026-07-11-phase-5-7c-node-collaboration-handoff.md`
- `docs/2026-07-05-phase-5-6-places-closeout-handoff.md`
- `docs/todo/phase-5-map-route-workspace-integration-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v14.md`

`docs/archive/` contains historical or superseded material. Do not read it by default. `docs/gpt/` is historical and must not be recreated.

## Current Status

```text
Current phase: Timeline Phase 6 unified scheduling closeout
Status: Phases 6.1-6.5 implementation and automated QA completed locally on 2026-08-09; not committed or pushed
Branch: codex/timeline-phase-6-1
Production data: Unaffected
Production migration: Phase 6 migrations PostgreSQL-executed in disposable PGlite; not applied to Supabase
```

Phase 5.7c synchronization, Phase 5.7d remote-drag visuals, Phase 5.8 UI baseline, and Phase 5.9 editor/card behavior are protected completed baselines.

Phase 6 runtime integration is present in the local working tree. Existing-card time edit, Timed/Untimed transitions, transport mutations, and destination reorder now share the unified Planner; Formal writes use one authoritative RPC and Demo applies the same plan locally.

The accepted visit-card, transportation-card, expanded-detail, and alternative-editor contract is centralized in `docs/timeline-card-ui-spec.md`. The Phase 5.9 handoff records implementation detail; do not duplicate it here.

## Phase 5.10 Verification

- Full Playwright regression: 235/235 passed.
- Required `tests/mapProviderPrep.spec.js`: 40/40 passed.
- Production build: passed; the existing Vite large-chunk warning remains informational.
- `git diff --check`: passed; Windows LF/CRLF notices remain informational.
- Deployed Chrome QA passed for page health and Timeline-card / Map-marker focus synchronization.
- User confirmed the remaining manual QA passed.
- No production records were created, changed, reordered, or deleted during automated QA.
- Playwright now accepts `PLAYWRIGHT_BASE_URL`; this allowed QA on port 5174 while another project remained untouched on port 5173.
- Two stale Phase 5.9 source assertions were updated, and marker coverage was added for two-digit labels plus reorder/type-change identity stability.

Full evidence and the remaining historical manual-QA checklist are in `docs/2026-07-28-phase-5-10-automated-qa.md`.

## Phase 6 Unified Scheduling

- Destination time state is either complete Timed (`start_time` and `end_time`) or complete Untimed (neither); partial time is invalid.
- One pure Planner owns continuation, overflow, affected-item summaries, and confirmation classification for existing-card time edits, timed/untimed transitions, transport changes, and reorder.
- Affected segments remove historical gaps, preserve visit durations, stop at fixed anchors, and never move the earlier segment.
- Untimed cards keep visual position and are transparent to time calculation; transport cannot cross Untimed cards.
- Phase 6 removes tail-transport semantics; the pending cleanup migration removes legacy rows and enforces complete normal pairs.
- Fixed and 24:00 overflow are the only automatic Timed-to-Untimed reasons.
- Frontend preview is not authoritative. Final apply must validate a full-Day revision, recalculate from locked current rows, and write atomically.
- New-destination overlap behavior remains on the existing path and outside the unified Planner triggers.
- Fixed-boundary fit includes the incoming normal-pair transport duration.
- Directly editing the final destination before a Fixed anchor accounts for that incoming transport; if the edited destination itself cannot fit, the full timed suffix from that destination to the anchor becomes Untimed.
- Reorder cannot target, move, or exchange content across an effective Fixed anchor, even when the anchor's apparent visual index would stay unchanged.
- Reorder removes only transport pairs newly broken by the operation; already-suspended pairs remain stored.
- Pure time shifts save without confirmation; automatic Untimed conversion or implicit transport removal requires confirmation.
- Formal confirmation stays bound to the original full-Day `updated_at` baselines and complete material plan; authoritative apply also binds target IDs and transport endpoints/duration to the validated operation intent.
- Pure Untimed visual reorder is accepted without timed package arrays, while timed package reorder still requires its slot/source manifests.
- Missing/empty reorder manifests and transport IDs that collide with destination IDs reject explicitly before any local or Formal mutation.
- The legacy manual continuation action, pair-conflict dialog, tail transport UI, old reorder RPC callers, and client compensation path are removed.

The normative rules are in `docs/2026-08-09-phase-6-1-time-model-and-auto-scheduling-rules.md`. Implementation, verification, migration state, and rollout steps are in `docs/2026-08-09-phase-6-closeout-handoff.md`. The Phase 6.2 task breakdown remains historical planning context.

## Phase 6 Verification

- Phase 6 Planner/RPC regression: 45/45 passed.
- Focused Phase 6 Planner/RPC and reorder regression: 85/85 passed.
- Full Playwright regression: 260/260 passed.
- Production build: passed; the existing Vite large-chunk warning remains informational.
- `git diff --check`: passed; Windows LF/CRLF notices remain informational.
- Browser QA passed on `/demo/timeline`: correct page identity/content, no framework overlay, no relevant console warning/error, desktop/mobile rendering without horizontal overflow, and a timed edit from `10:30-12:00` to `10:30-13:00` that repacked following cards to `13:00-14:30` and `14:30-16:30`.
- Read-only Formal-route QA passed at local `/`: the current branch loaded the Google-login boundary and Demo link with meaningful DOM, no framework overlay, and no console warning/error; no login or data mutation was performed.
- Disposable PGlite PostgreSQL validation passed: the full migration chain from `001` through both Phase 6 migrations executed in order, then a real `edit_time` RPC apply repacked the following card and reuse of the stale baseline rejected with `stale_item`. PGlite does not bundle Supabase's `pgcrypto` extension, so only that preinstalled-extension declaration was skipped; both Phase 6 migration bodies ran unchanged.
- Linked Supabase checks confirm Production migration history still ends at `20260712033758`, `db push --dry-run` would apply only the two Phase 6 migrations in timestamp order, and the current `public/app_private` schema passes linked error-level lint. Dry-run does not compile the pending migration bodies.

## Protected Current Behavior

Preserve these contracts unless a future phase explicitly changes them:

- Demo remains unauthenticated, static-map-only, and disconnected from Supabase/Auth/Realtime.
- Share remains unauthenticated and readonly.
- Save is the only itinerary write for Places/editor flows; route-node override autosave is the scoped exception.
- Only `item_type === "transport"` identifies a transportation card. Transportation-like destination categories remain destinations with coordinates, markers, sequence numbers, and route participation.
- Places keeps the approved minimal field mask: `id`, `displayName`, `location`, and `googleMapsUri`.
- Coordinate URLs reuse the existing parser and short-link resolver without adding Geocoding, Text Search, Directions, or Routes calls.
- Map add-location, Places, URL, POI, and custom-point flows remain draft-only until Save.
- Main/alternative editor switching remains one shared draft; alternative create/edit/delete persists through the main itinerary Save flow.
- Timeline/Map marker focus, destination numbering, route participation, and semantic category colors remain synchronized.
- Do not restore same-day route-edit locking or a 15-second idle exit.
- Do not return to segment-snapshot Broadcast or whole-`points_json` multiplayer writes.
- Do not synchronize map pan/zoom, cursors, Timeline scroll, or remote DragOverlay.
- Preserve the Phase 6 unified Planner/RPC behavior, fixed-anchor rules, complete normal-pair transportation/navigation, draft autosave, edit locks, Auth, Share/Invite, and Budget flows.

## Production Migration State

Production Supabase project: `lqvuqamzmchepgxkftcw`

Applied immutable Timeline migrations:

```text
019 / 20260621131905 / swap_itinerary_destination_packages
020 / 20260622130246 / reorder_itinerary_destination_packages
021 / 20260622131013 / fix_reorder_baseline_count
022 / 20260629012151 / add_transport_role_to_itinerary_items
023 / 20260629014908 / reorder_itinerary_timed_auto_continuation
024 / 20260629065754 / timeline_phase_4_7_fixed_anchor_continuation
20260708063744 / add_itinerary_route_overrides
20260710125337 / add_itinerary_route_override_nodes
20260712033758 / add_route_tables_to_realtime
```

- Pending, unapplied Phase 6 migrations:
  - `20260809090000_timeline_phase_6_unified_schedule_operation.sql`
  - `20260809091000_timeline_phase_6_cleanup_legacy_time_transport.sql`
- Local and remote migration history were verified aligned through `20260712033758`.
- Never edit an applied migration in place; use a new timestamped migration for future schema, RLS, RPC, permission, replica-identity, or publication changes.

## Known Residual Risks

- Realtime Broadcast is best effort during active drag; authoritative database reload is the convergence fallback after drag-end.
- `BUG-025` remains Low Priority: foreign Timeline drag presence can occasionally clear by its 12-second stale timeout instead of the immediate clear event.
- Active forms must continue to resist Realtime/refetch replacement.
- Production may still contain partial-time or legacy tail-transport rows until the pending cleanup migration is reviewed and applied.
- The SQL Planner is PostgreSQL-executed in disposable PGlite, but full Supabase-managed staging RPC coverage and authenticated Formal mutation QA remain pending rollout approval.
- Existing native HTML drag accessibility limitations remain outside the completed route-collaboration scope.
- Timeline drag animation remains browser/timing-sensitive; future polish should use dnd-kit configuration rather than delaying authoritative writes.

See `docs/BUGS.md` for the current bug ledger.

## Working Tree Hygiene

- `supabase/.temp/`, `test-results/`, and `.tmp-*` are recurring local artifacts and must remain untracked unless explicitly requested.
- Preserve unrelated user changes in a dirty working tree.
- Publish the tracker and its closeout/QA document in the same verified change set.

## Next Step

Phase 6 code, automated QA, disposable PostgreSQL migration execution, and a minimal authoritative RPC apply/stale-baseline smoke are complete locally. Next, review cleanup counts and run the remaining Supabase-managed staging RPC matrix, then apply and run authenticated Formal smoke tests only when rollout is explicitly approved. Commit/push remains a separate requested action.
