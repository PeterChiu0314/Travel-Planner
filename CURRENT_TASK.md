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

- `docs/2026-08-11-timeline-sorting-editing-automated-qa.md`
- `docs/2026-08-19-phase-7-json-exchange-plan.md`
- `docs/2026-08-19-phase-7-json-exchange-closeout-handoff.md`
- `docs/2026-08-24-phase-7-ai-exchange-import-plan.md`
- `docs/2026-08-24-phase-7-ai-exchange-import-closeout-handoff.md`
- `docs/2026-08-09-phase-6-closeout-handoff.md`
- `docs/2026-08-09-phase-6-1-time-model-and-auto-scheduling-rules.md`
- `docs/todo/2026-08-09-phase-6-2-unified-planner-implementation-plan.md`
- `docs/timeline-card-ui-spec.md`
- `docs/todo/phase-5-map-route-workspace-integration-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v14.md`

`docs/archive/` contains historical or superseded material. Do not read it by default. `docs/gpt/` is historical and must not be recreated.

## Current Status

```text
Current phase: Timeline Phase 7.5-7.9 AI itinerary exchange, planning, and import
Status: Phase 7.5-7.9 implementation, full regression, and browser QA are complete; feature branch is published, merge and deployment remain pending
Branch: codex/timeline-phase-7-ai-exchange-import (tracking origin/codex/timeline-phase-7-ai-exchange-import, based on 0bb623e)
Production data: Cleanup completed; 8 approved test visits converted to Untimed and 1 approved invalid test transport deleted
Production migration: Phase 7 import RPC applied as 20260819134935 on lqvuqamzmchepgxkftcw
Staging migration: Phase 7 import RPC applied as 20260819125851 on uyqdopksfysbobhjcepk; Staging still does not have 20260811150000
Pending rollout: Phase 7.5-7.9 is committed and pushed on its feature branch but is not merged or deployed; Production received one explicitly approved read-only Formal Trip snapshot query for Staging recovery, with no Production write or configuration change
```

## Phase 7.5-7.9 AI Itinerary Exchange, Planning, and Import

- AI exchange uses its own strict `travel_studio_ai_itinerary` v1 identity. It is intentionally separate from Formal `travel_studio_trip` v1, and each parser rejects the other document type.
- The AI contract contains portable planning semantics: Trip/destination/date range, complete Days, visit order/category/title, Formal-compatible location data, four schedule forms, Fixed, notes, alternatives, and Day-level transport visit numbers. It excludes UUIDs, ownership, timestamps, locks, Realtime/provider objects, and Place IDs. Every location uses the same four required fields as Formal v1: `name`, `map_url`, `latitude`, and `longitude`; unavailable values are `null`. New AI/Formal templates and exports never write `address`; older JSON containing `address` remains readable and the field is ignored. The existing database/RPC `address` slot remains unchanged and receives `null`.
- Existing Trip More Actions opens `給 AI 調整`: users can copy or download that Trip's AI exchange JSON, then paste the AI response back to create a new Trip while leaving the source Trip unchanged.
- New Trip exposes `AI 規劃`: it shows the concise instruction `下載模板，交給 AI 規劃後貼回。`, provides only `下載模板 JSON` and `複製給 AI 的提示詞`, and then opens the existing paste-import flow. It does not render or copy the blank JSON body in the UI. The downloaded blank template contains no internal/provider data and intentionally remains invalid until the AI fills all required fields.
- The create prompt is vendor-neutral, tells the AI to ask the user for missing trip requirements, and requires one complete `travel_studio_ai_itinerary` JSON object once planning information is sufficient. Demo receives neither AI callback and remains isolated.
- The create prompt now requires a downloadable `.json` file rather than a Google/online document or message-only JSON, preserves the template's exact English keys, enumerates every visit/transport category, spells out `start`/`end` and all required transport fields, and requires explicit schedules to leave room for transport duration.
- A narrow pre-validation compatibility pass accepts common external-AI aliases without weakening the remaining strict contract: `start_time/end_time` become `start/end`, `dining/accommodation` become `food/hotel`, `mode` becomes transport `category`, a missing transport name uses the category label, an omitted duration may be read only from an explicit `N 分鐘`/`N minutes` note, and an entire Day of unambiguously 0-based transport refs shifts to 1-based. Mixed or out-of-range numbering still blocks. All other unknown fields still block import.
- Paste import accepts strict JSON, one fenced JSON block, or one clearly extractable JSON object with small text wrappers. It does not repair JSON5, comments, trailing commas, single quotes, multiple objects, or ambiguous data.
- Valid AI input converts through a dedicated adapter to Formal v1. Duration-only visits use the Phase 6 five-minute continuation rule only when a safe immediate Timed anchor exists; unsafe duration segments become Untimed warnings, while explicit overlaps remain blocking errors. Exact `24:00`, Fixed, alternatives, multiple Days, non-adjacent suspended transport, and blank transport-name fallback are preserved.
- AI import performs no pre-import Places lookup, Google Map preview, Wikimedia request, candidate selection, retry, or manual place confirmation. It converts validated AI location fields directly to Formal v1. Missing coordinates do not block confirmation and use the existing yellow copy `尚有 X 個目的地缺少可用座標`.
- Blocking Contract or persistence errors use the compact red state with no Map, counts, or confirm action. Valid/warning AI input uses a local summary with no graphical map board. The final action converts the draft directly to Formal v1, builds the existing persistence payload, and calls only `import_trip_timeline_v1`.
- No AI provider, model API, key, chat, streaming, agent, token/cost system, RPC, migration, or database column was added.
- New manual fixtures: `tests/fixtures/manual/phase-7-ai-valid-complete.json` and `tests/fixtures/manual/phase-7-ai-blocking-error.json`.
- Phase 7.9 coordinate-unification verification on 2026-08-24: blank-template/prompt/alias/location contract plus Create/Revise/import UI tests passed 20/20, full Playwright passed 319/319 after removing the obsolete AI Places coordinator suite, Production build passed with the existing large-chunk warning, and `git diff --check` passed with informational Windows line-ending notices.
- Phase 7.9 four-field location follow-up on 2026-08-24: AI/Formal Schema, blank template, prompts, adapters, fixtures, and new exports now omit `address`; legacy AI/Formal files containing it remain compatible and strip it before validation. Focused tests passed 35/35, full Playwright passed 320/320, Production build and `git diff --check` passed. Authenticated 5174 browser QA verified a new export has exactly `name/map_url/latitude/longitude`, and a legacy-address copy reached the non-blocking import preview without Places or map confirmation. No import was confirmed.
- Authenticated local Staging browser QA verified the desktop and 390x844 mobile `AI 規劃` and `給 AI 調整` flows, exact labels, no Create-mode JSON textarea/copy action, successful template-download and prompt-copy states, no horizontal overflow, and no app console error or warning. No import was confirmed and Staging remained at two Trips.
- Authenticated browser re-test with a real seven-Day external-AI file verified that 191 derivative format errors collapse to zero format errors after the bounded alias pass. Preview then showed only two genuine five-minute schedule/transport conflicts, with exact paths and actionable earliest starts (`18:35` and `12:05`) but no confirm action; they remain blocking rather than being silently rescheduled. Console stayed clean, no import was confirmed, and Staging remained at two Trips.
- A second real Gemini file confirmed the hardened prompt produced correct keys, categories, schedules, and complete transport fields, but still numbered each Day's transport refs from 0. The bounded all-Day shift converted those refs safely; Contract and Formal conversion passed with zero errors. Authenticated browser preview rendered 5 Days, 15 visits, 10 transports, and 0 alternatives, auto-resolved 4/15 Places, and left 11 for the existing manual Places workflow. No import was confirmed.
- Authenticated Staging browser QA passed the complete Formal flow: Header `AI 行程交換`, pasted AI fixture, real Google Places resolution 4/4, preview of 2 Days / 3 visits / 1 transport / 1 alternative, five-minute continuation `10:55-12:10`, one atomic import, reload, and semantic Formal re-export. The AI JSON contained no UUID, Place ID, coordinates, or Maps URL. The temporary `Phase 7.5 Browser QA 01a032da` Trip and all dependent rows were removed.
- During browser cleanup, a native-confirm automation retry accidentally deleted the pre-existing Staging `系統測試專用` Trip. With explicit approval, Production was queried read-only for only the same-name Formal Trip/Timeline/alternatives graph; members, budget, luggage, and other excluded modules were not copied. The existing Formal payload and `import_trip_timeline_v1` restored it atomically to Staging as `0871e22c-be7b-43c5-b5ab-cf22f54c97d4`, with 4 Days, 16 visits, 3 transports, 3 alternatives, and one approved owner. Dry-run rollback, post-commit SQL audit, and authenticated browser reload all passed; Staging now contains exactly the restored Trip plus `Phase 6 Staging QA`.
- Production project `lqvuqamzmchepgxkftcw` received no SQL write, migration, data mutation, Auth, setting, or deployment change during Phase 7.5-7.9. The recovery access was one read-only snapshot of the approved same-name Formal Trip graph. Phase 7.9 made no Supabase API, schema, RPC, migration, or data change.
- Full evidence, exact boundaries, and rollout gates are in `docs/2026-08-24-phase-7-ai-exchange-import-closeout-handoff.md`.

## Phase 7.1-7.4 JSON Exchange

- Public JSON v1 is a stable Trip + Timeline contract, not a Supabase row dump. It includes all Days, visits, visual order, Timed/Untimed and Fixed state, normal-pair transportation, location/map fields, Timeline estimated cost, and nested alternatives.
- Supabase IDs, ownership/membership, timestamps, locks, Realtime metadata, route collaboration, and excluded modules are not exported. Budget, Accommodation, Todo/Guide, Luggage, Actual/Settlement, Share/Invite, Attachments, and AI remain outside v1.
- Formal export now uses the serializer boundary. Formal import parses, migrates, normalizes, validates, and previews locally; no database request occurs before explicit confirmation.
- Confirmed import calls one authenticated `security invoker` RPC. The database regenerates UUIDs, maps Day-local refs, repeats Phase 6 invariants, and inserts the entire Trip graph atomically.
- Focused Phase 7 contract/RPC tests passed 20/20, the original focused Phase 7 plus navigation suite passed 38/38, and the full Playwright regression passed 291/291. The transport-name compatibility hotfix then passed contract 14/14 and focused 39/39; Production build and `git diff --check` passed.
- Authenticated Staging browser QA passed malformed/no-write, valid preview, explicit commit, reload, and semantic re-export comparison.
- The Phase 7 migration compiled on isolated Staging. Its authenticated rollback fixture passed with Fixed, `24:00`, transport, and alternative coverage, and retained zero fixture Trips.
- Browser QA also fixed a shared navigation guard: database `null` coordinates no longer become a misleading `0,0` Google Maps route. The imported QA Trips and their dependent rows were removed; Staging returned to its original one-Trip state.
- Existing Timeline rules allow transportation names to remain blank and display the category label. The JSON export adapter now applies the same fallback (`train` -> `電車`, etc.) instead of rejecting legacy rows; no Production travel data cleanup is required.
- The authenticated import preview is now a compact graphical board: a 640px desktop dialog keeps a stable 706px height, uses a Wikimedia destination cover over the upper 25% and a Google Map over the lower 75%, shows one representative non-transport location per Day, and renders normal movement, flight, and intentionally broken long-distance segments with the approved route semantics.
- The preview header and footer were simplified: file/schema metadata and the pre-write note were removed, Day/visit/transport/alternative totals now share the action row, and the board grows into the released space. Google Maps now observes container resizing, triggers map resize, and re-fits all representative points whenever the dialog or cover/map ratio changes.
- Authenticated local Staging browser QA verified the final 640x706 desktop layout, 25/75 cover/map ratio, all four representative points remaining inside the visible map after viewport changes, no database write before confirmation, and no relevant console error. The existing Google Maps legacy Marker deprecation warning remains informational. Phase 7 contract tests passed 14/14; Production build and `git diff --check` passed.
- Import feedback is now reduced to two user-facing categories. Any file-read, malformed JSON, Schema, contract-validation, persistence-adapter, or RPC failure is a blocking red state: it hides the cover, map, counts, and confirm action; uses content-height instead of the normal 706px board height; shows only `無法匯入這份旅程` plus a collapsed `查看細節（N）`; and reveals raw messages/JSON paths only after expansion. Non-blocking warnings remain yellow, keep the graphical board and enabled confirm action, and no longer expose JSON paths in the default warning copy.
- Authenticated local Staging QA verified the red malformed-JSON dialog at approximately 640x215px with no board or confirm button, collapsed technical details by default, expandable error/path detail, and no import write. A valid empty-Timeline warning fixture kept the board visible and confirm enabled; confirm was intentionally not pressed. Focused graphical-preview tests passed 7/7, Phase 7 JSON contract tests passed 14/14, Production build and `git diff --check` passed; the only browser warning was the existing Google Maps legacy Marker deprecation notice.
- Reusable manual QA fixtures now live at `tests/fixtures/manual/phase-7-red-blocking-error-7.json` and `tests/fixtures/manual/phase-7-yellow-warning.json`. The first is parser-verified to produce exactly 7 blocking errors and no warnings; the second produces no errors and exactly one `empty_timeline` warning. Do not confirm the yellow fixture unless creating a disposable test Trip is explicitly intended.
- The user explicitly approved applying only the Phase 7 RPC migration to Production while keeping Git `main` and Vercel Production unchanged. Post-apply checks confirmed `security invoker`, a fixed search path, anonymous execute denied, authenticated execute allowed, and no new Phase 7 advisor warning. See `docs/2026-08-19-phase-7-json-exchange-closeout-handoff.md`.

Phase 5.7c synchronization, Phase 5.7d remote-drag visuals, Phase 5.8 UI baseline, and Phase 5.9 editor/card behavior are protected completed baselines.

Phase 6 runtime integration is present on the pushed branch. Existing-card time edit, Timed/Untimed transitions, transport mutations, and destination reorder now share the unified Planner; Formal writes use one authoritative RPC and Demo applies the same plan locally.

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

Full evidence and the remaining historical manual-QA checklist are archived in `docs/archive/Timeline_Phase5/2026-07-28-phase-5-10-automated-qa.md`.

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

- Alternative switching is now implemented locally as one `apply_itinerary_alternative` RPC transaction instead of two independent frontend updates. It locks the destination before its selected alternative, validates trip edit permission, Fixed state, the seven-minute edit lock, both `updated_at` baselines, and the parent/alternative relationship before writing either row.
- The destination keeps its stable ID, Day/date, order, time, Fixed state, transport endpoints, and budget links; only destination content is exchanged, and the previous main content becomes the selected alternative. Any validation or write failure rolls back both changes.
- Focused atomic-alternative checks passed 5/5, full Playwright regression passed 271/271, and Production build passed with only the existing large-chunk notice. Browser QA on local `/demo/timeline` verified switch, switch-back, unchanged sequence/time/transport display, Fixed protection, Demo isolation, and no console warning/error.
- The user explicitly approved direct Production application. The final linked dry-run listed only `20260811150000_atomic_apply_itinerary_alternative.sql`; it then applied successfully to Production `lqvuqamzmchepgxkftcw`. Local/remote migration history aligns through `20260811150000`, and linked error-level lint passes for both `public` and `app_private`.
- Frontend integration commit `8b7c97b` was pushed to `codex/timeline-phase-6-hotfix-five-minute-ceiling`, and Vercel marked its immutable Preview deployment ready. The deployed JavaScript bundle contains `apply_itinerary_alternative`, `stale_alternative`, and the localized stale-data message.
- Authenticated Production-data QA on the Vercel branch preview passed: A switched to AA and back through one POST RPC per action; sequence `1`, time `03:30-03:50`, both transport cards, and the `$30,000` budget link stayed unchanged. Fixed hid the switch action, unlock restored it, and a deliberately stale second-tab action was rejected with the localized message before reloading the new AA state.
- Final reload confirmed the `系統測試專用` trip was restored to A, sequence `1`, `03:30-03:50`, both original transports, `$30,000`, and unlocked state. No app console error occurred; the existing Google Maps legacy Marker warning remains informational.
- Regression found after transport-aware scheduling: an automatic destination start used the exact preceding end plus transport duration (`16:10 + 8 = 16:18`) instead of the established five-minute Timeline ceiling (`16:20`).
- Hotfix migration `20260811133000_timeline_phase_6_restore_five_minute_ceiling.sql` and the JavaScript Planner now round only each automatically calculated next-visit start upward to the next five-minute boundary. Visit duration is preserved, exact five-minute boundaries remain unchanged, and stored transport duration is never rounded or mutated.
- Earlier-conflict guidance uses the same rounded earliest start, keeping Demo preview and authoritative SQL behavior identical.
- Staging authoritative RPC fixture passed with A `15:10-16:10`, 8-minute transport, B `16:20-17:20`, 7-minute transport, and C `17:30-18:00`; transport durations remained `[8,7]`. The transaction ended with `ROLLBACK`.
- Five-minute hotfix Planner/RPC static tests passed 50/50. Broader Planner/RPC/reorder/Untimed/transport regression passed 100/100 after starting the required local Vite server. Staging `public/app_private` error-level lint passed.
- The user explicitly approved applying `20260811133000`. Production project `lqvuqamzmchepgxkftcw` was reverified, the dry run listed only this migration, and local/remote migration history now aligns through `20260811133000`.
- Production `public/app_private` error-level lint passed. The authoritative RPC fixture produced A `15:10-16:10`, B `16:20-17:20`, and C `17:30-18:00` across stored transport durations `[8,7]`; its transaction rolled back and a follow-up query confirmed 0 fixture rows remained.
- Production regression found after closeout: dragging a timed destination such as A to the bottom while preserving multiple adjacent transport pairs could fail atomically with `itinerary_items_transport_pair_unique_idx` because preserved endpoints were remapped row-by-row under an immediate unique index.
- Hotfix migration `20260811124500_timeline_phase_6_defer_transport_pair_uniqueness.sql` replaces that immediate index with a `DEFERRABLE INITIALLY DEFERRED` unique constraint, so temporary in-transaction endpoint collisions are allowed while duplicate final pairs still fail.
- Staging exact-fixture QA passed with A/B/C/E plus B-to-C and C-to-E: authoritative reorder produced B/C/E/A, preserved both unique pairs, produced expected continuation times, rejected a deliberately duplicated final pair, and rolled back with 0 fixture rows retained.
- Production exact-fixture QA passed with the same result after applying `20260811124500`: B/C/E/A, expected continuation times, two unique preserved pairs, duplicate-final-pair rejection, and 0 retained fixture rows after rollback. Production migration history aligns through the hotfix and linked `public/app_private` error-level lint passes.
- `main` fast-forwarded and pushed through `f79559b`. Vercel Production served the authenticated Timeline with meaningful content, no framework overlay or relevant app console error, and the deployed JavaScript bundle contains the localized transport-remap failure message. The only warning remains Google Maps' existing `google.maps.Marker` deprecation notice.
- Hotfix static RPC tests: 11/11 passed. The two rendered Demo drag/editor regressions that previously lacked a running server passed 2/2. Production build and `git diff --check` passed; the existing chunk-size and Windows line-ending notices remain informational.

- Phase 6 Planner/RPC regression: 45/45 passed.
- Focused Phase 6 Planner/RPC and reorder regression: 85/85 passed.
- Full Playwright regression: 260/260 passed.
- Production build: passed; the existing Vite large-chunk warning remains informational.
- `git diff --check`: passed; Windows LF/CRLF notices remain informational.
- Browser QA passed on `/demo/timeline`: correct page identity/content, no framework overlay, no relevant console warning/error, desktop/mobile rendering without horizontal overflow, and a timed edit from `10:30-12:00` to `10:30-13:00` that repacked following cards to `13:00-14:30` and `14:30-16:30`.
- Read-only Formal-route QA passed at local `/`: the current branch loaded the Google-login boundary and Demo link with meaningful DOM, no framework overlay, and no console warning/error; no login or data mutation was performed.
- Disposable PGlite PostgreSQL validation passed: the full migration chain from `001` through both Phase 6 migrations executed in order, then a real `edit_time` RPC apply repacked the following card and reuse of the stale baseline rejected with `stale_item`. PGlite does not bundle Supabase's `pgcrypto` extension, so only that preinstalled-extension declaration was skipped; both Phase 6 migration bodies ran unchanged.
- Linked Supabase checks confirm Production migration history still ends at `20260712033758`, `db push --dry-run` would apply only the two Phase 6 migrations in timestamp order, and the current `public/app_private` schema passes linked error-level lint. Dry-run does not compile the pending migration bodies.
- Isolated Supabase Staging `uyqdopksfysbobhjcepk` is `ACTIVE_HEALTHY`; all 29 local/remote migrations align through `20260809091000`, and `public/app_private` error-level lint passes.
- Staging authoritative RPC smoke passed for `edit_time` continuation (`09:00-10:15`, then `10:15-11:15`), stale-baseline rejection (`stale_item`), non-member rejection (`permission_denied`), and authenticated RLS visibility (2 items). The smoke transaction rolled back, leaving no fixture rows.
- Staging Auth uses `http://127.0.0.1:5174` as the Site URL with `http://127.0.0.1:5174/**` allowed for redirects. Google sign-in is enabled with a dedicated `Travel Planner Staging` OAuth client whose callback targets only `uyqdopksfysbobhjcepk`.
- Authenticated browser smoke passed: Google OAuth returned to the local Staging app, the signed-in account rendered successfully, and the independent Staging database showed 0 trips.
- Authenticated Formal Staging QA passed on trip `855d507e-daa3-4752-9d42-a91f05d06d7c`: existing-card continuation, Timed/Untimed transitions, transport add/change/delete, Fixed and 24:00 overflow, Timed reorder, cross-Fixed rejection, Untimed visual reorder, reload persistence, and read-only SQL state verification all behaved as designed.
- Formal QA found and locally fixed PostgreSQL `HH:MM:SS` versus client `HH:MM` transport-snapshot comparison drift, which had falsely shown `交通資訊需確認`; transport controls and CRUD then passed. It also found and locally fixed the raw `fixed_boundary_crossed` alert so the user receives a localized Fixed-boundary explanation.
- Focused Planner/RPC/reorder/transport regression after the QA fixes: 63/63 passed. Production build and `git diff --check` passed; the existing large-chunk and Windows line-ending notices remain informational.
- Final Staging revision QA passed: inserting or deleting a Day item after preview caused the original operation to reject with `stale_manifest`; both tests ran inside transactions and rolled back.
- A real two-connection contention test passed: client 1 applied and held the per-Day transaction lock, client 2 submitted from the old baseline while client 1 was active, then rejected with `stale_item` after the lock released. The temporary D change was restored through the authoritative RPC and verified at `23:00-23:30`.
- Production read-only cleanup counts on 2026-08-11 found 127 Timeline rows: 8 partial-time visits would become Untimed and 1 structurally invalid transport would be deleted. Tail-role promotion, remaining role normalization, invalid complete visit ranges, and invalid transport durations all counted 0. No Production write or migration occurred.
- The 8 partial-time visits and invalid `JR東西線` transport were reviewed by trip/name. The user confirmed they are test data, approved converting the visits to Untimed and deleting the transport, waived a separate backup for these 9 rows, and explicitly approved Production rollout.
- Production migration history now aligns through `20260809091000`. Post-migration SQL verification found 126 Timeline rows, 0 partial-time visits, 0 structurally invalid transports, the public Phase 6 RPC, all 3 Phase 6 constraints, and the transport-scope trigger.
- The 8 approved visits were verified with both times null. The invalid `JR東西線` row from `八坂神社` was removed; a separate valid same-name row with complete endpoints remains intentionally.
- `main` was fast-forwarded and pushed through `3f21f3a`, and Vercel served the matching authenticated Production app at `https://peter-travel-planner.vercel.app/`.
- Authenticated Production smoke passed on the existing `系統測試專用` trip: time edit/continuation, Timed-to-Untimed and restore, transport create/update/delete, Timed and Untimed keyboard reorder, Fixed overflow confirmation/conversion, and reload persistence.
- All temporary Production QA mutations were removed or restored. Day 2 returned to its original order/times with no temporary transport; Day 4 returned to its original order/times, including `F2_1h30min` at `08:30-10:00` after its expected gap-removal side effect was explicitly restored.

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

- Applied Phase 6 migrations:
  - `20260809090000_timeline_phase_6_unified_schedule_operation.sql`
  - `20260809091000_timeline_phase_6_cleanup_legacy_time_transport.sql`
- Local and Production migration history are verified aligned through `20260811150000`.
- The original two Phase 6 migrations remain aligned on isolated Staging project `uyqdopksfysbobhjcepk`.
- Staging and Production both have `20260811124500_timeline_phase_6_defer_transport_pair_uniqueness.sql`.
- Staging and Production both have `20260811133000_timeline_phase_6_restore_five_minute_ceiling.sql`.
- Production has `20260811150000_atomic_apply_itinerary_alternative.sql`; Staging remains at `20260811133000`.
- Never edit an applied migration in place; use a new timestamped migration for future schema, RLS, RPC, permission, replica-identity, or publication changes.

## Known Residual Risks

- Realtime Broadcast is best effort during active drag; authoritative database reload is the convergence fallback after drag-end.
- `BUG-025` remains Low Priority: foreign Timeline drag presence can occasionally clear by its 12-second stale timeout instead of the immediate clear event.
- Active forms must continue to resist Realtime/refetch replacement.
- Production cleanup is complete: partial-time and structurally invalid transport counts are both 0.
- Supabase-managed Staging now covers the authenticated Formal mutation matrix, inserted/deleted Day-revision invalidation, and true simultaneous two-connection stale-preview protection.
- The Staging Google Maps key does not allow `http://127.0.0.1:5174/`, so the map shows `RefererNotAllowedMapError`; Timeline scheduling QA is unaffected, and Production key restrictions were intentionally not changed.
- Existing native HTML drag accessibility limitations remain outside the completed route-collaboration scope.
- Timeline drag animation remains browser/timing-sensitive; future polish should use dnd-kit configuration rather than delaying authoritative writes.

See `docs/BUGS.md` for the current bug ledger.

## Working Tree Hygiene

- `supabase/.temp/`, `test-results/`, and `.tmp-*` are recurring local artifacts and must remain untracked unless explicitly requested.
- Preserve unrelated user changes in a dirty working tree.
- Publish the tracker and its closeout/QA document in the same verified change set.

## Next Step

Production Vercel successfully deployed merged `main` through `47837e5`. Read-only authenticated page-health QA passed, and the served bundle contains the atomic alternative RPC plus stale-conflict handling. Staging may receive `20260811150000` later if the user wants environment parity.
