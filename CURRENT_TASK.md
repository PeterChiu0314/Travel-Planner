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
Current phase: Phase 5.10 automated QA
Status: Completed; automated QA and user-confirmed manual QA passed on 2026-07-28
Branch: main
Production data: Unaffected
Phase 6: Not started
```

Phase 5.7c synchronization, Phase 5.7d remote-drag visuals, Phase 5.8 UI baseline, and Phase 5.9 editor/card behavior are protected completed baselines.

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
- Preserve Phase 4 reorder RPC behavior, fixed-anchor rules, transportation pairing/navigation, draft autosave, edit locks, Auth, Share/Invite, and Budget flows.

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

- No pending production migration is known.
- Local and remote migration history were verified aligned through `20260712033758`.
- Never edit an applied migration in place; use a new timestamped migration for future schema, RLS, RPC, permission, replica-identity, or publication changes.

## Known Residual Risks

- Realtime Broadcast is best effort during active drag; authoritative database reload is the convergence fallback after drag-end.
- `BUG-025` remains Low Priority: foreign Timeline drag presence can occasionally clear by its 12-second stale timeout instead of the immediate clear event.
- Active forms must continue to resist Realtime/refetch replacement.
- Legacy rows with only one time remain safely treated as untimed until an explicit save normalizes them.
- Existing native HTML drag accessibility limitations remain outside the completed route-collaboration scope.
- Timeline drag animation remains browser/timing-sensitive; future polish should use dnd-kit configuration rather than delaying authoritative writes.

See `docs/BUGS.md` for the current bug ledger.

## Working Tree Hygiene

- `supabase/.temp/`, `test-results/`, and `.tmp-*` are recurring local artifacts and must remain untracked unless explicitly requested.
- Preserve unrelated user changes in a dirty working tree.
- Publish the tracker and its closeout/QA document in the same verified change set.

## Next Step

Phase 5.10 is complete. Await an explicit Phase 6 request or another scoped task while preserving the completed Phase 5 baselines above.
