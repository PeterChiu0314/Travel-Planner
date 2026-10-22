# CURRENT_TASK.md

This file is the concise live project ledger. Keep it aligned with the real branch, deployed behavior, production migration state, and next requested phase.

## Active Local Work — 2026-10-22

- Category-row refinement: header labels 12px / currency 11px; removed 8px white category gaps; neutral category bands and stronger green selection, with category icons. Added per-person category subtotal (trip average by default, actual allocated member burden for named viewpoint); comparison keeps baseline/actual totals. Approximation wording uses `≈`. Focused Budget/Demo **24/24**, build passed.
- Sticky-header correction after user screenshot exposed bleed: table uses separate borders/zero spacing and sticky opaque header cells with their own 1px bottom borders; removed the ineffective sticky-`thead` shadow. Budget checks **17/17** and build passed, including header hit-testing/background/border checks at scroll offsets 0/18/30/40/90/250. Earlier passing functional tests did not cover the defective collapsed-border paint state.
- Latest visual correction: search/actions toolbar and table header share the same solid `--color-bg` surface with a continuous divider below the header; side inputs/textareas are transparent. Timeline linking no longer has suggestion/all tabs: one list starts with up to five ranked `建議` checkboxes, then all Day groups. Both occurrences share the same selection IDs. Focused Budget/Demo **22/22**, build and diff checks passed.
- Latest Budget menu consistency: all Budget dropdowns (including opt-in Demo tools) use `MenuSelect`, reusing Timeline's existing menu/option styles with portal positioning, keyboard selection, outside/Escape dismissal and editable categories. Table header is a compact single line, list ends with the same 12px padding as side content. Desktop workspace remains frameless, flush to Header/edges and transparent on the right. Full **373/373**, build and diff checks passed; see active handoff for verification.
- Latest Budget density/payment refinement: inline inputs are 28px without spinners or row expansion; desktop forms/filters use 32px fields; table lines reach board edges with no column gap and existing 4px board scrollbar styling. Payment checkbox removed: detail `登記付款` opens a separate actual draft, `確認付款` persists it; existing payments are listed with links and an explicit additional-payment action. Timeline linking defaults to category/type + title-keyword suggestions with an unrestricted `全部行程` alternative. Full **371/371** and build/diff checks passed. Handoff below records the superseded prior checkbox wording.
- Budget editor UX follow-up: member selection defaults collapsed with compact rows; shared editor/detail amounts show per-person and total, with original foreign total secondary. Payer label is `付款人`; prepaid creation reads `這筆已付款`, existing actuals show a readonly payment note. Timeline linking uses searchable Day-filtered checkboxes and removable selections. Desktop Budget now occupies remaining viewport height with independent table/side scrolling, persistent side tabs and save actions, fixing the header overlap. Full regression **369/369 passed**; final shared-summary checks recorded in the active handoff.
- Latest follow-up: Demo Kyoto now has a complete illustrative **5-member / 32-budget** graph with 7 categories, 3 pricing modes, real Timeline links and differing personal burdens. Shared Formal Budget/Settlement/Attachment views are reused; the sidebar mirrors Formal navigation with unavailable non-Budget modules explicitly disabled.
- Demo-only scenario control previews Planning (8 prepaid actuals), Traveling (20 actuals), Settlement (34 actuals, including split fuel payments, unplanned taxi/coffee and one unrecorded budget). Departure snapshot freezes on leaving Planning. Scenario loads are idempotent; edits/deletions are retained until reload/reset.
- Demo finance state is isolated by trip, navigation resolves active editors, and receipt files use temporary browser object URLs only. No Supabase/Auth/Storage/Realtime/localStorage calls are introduced into Demo.
- Demo follow-up verification: full Playwright **367/367 passed**, plus final focused Budget/Demo checks; build and `git diff --check` passed. See `docs/2026-10-22-budget-workspace-handoff.md` for cases and use instructions. No production write, migration, push or deployment.

- Branch: `codex/budget-page-polish`, based on synchronized `main` / `origin/main` at `fdd332b`.
- User approved implementation after selecting desktop previews. The initial large-card pass (`6d4317b`) is superseded by the current compact grouped table and right statistics/detail panel. Mobile gets minimum usability only.
- Planning defaults to budget; Traveling defaults to quick actual entry without budget compliance indicators. Phase is readonly. `對照` exists only in Settlement and compares against the final predeparture snapshot, never mutable current budgets.
- Personal-first statistics, three pricing modes, independent payer/participants, shared inline/right-panel draft, integer TWD allocation and settlement calculations are implemented locally. Existing shell, Timeline protections, Draft/Save/Discard/locks and receipt flows remain.
- Prepared migration `20261022090000_budget_workspace_baseline_and_pricing.sql` adds server-maintained immutable departure baselines, pricing/custom shares, durable actual origins and atomic save/delete RPCs. **Not applied to Staging or Production.** New pricing and snapshot persistence require this rollout; legacy split-total CRUD still works against the existing schema.
- Final full Playwright passed **361/361**; isolated all-migration PostgreSQL tests and build passed. Authenticated Formal preview was inspected read-only at 1440px; no Formal data mutation, migration, push or deployment performed.
- Current handoff and rollout constraints: `docs/2026-10-22-budget-workspace-handoff.md`; final visual QA: `design-qa.md`.
- Git correction to the older rollout notes below: Phase 7 AI exchange/import commits through `fdd332b` are already present on remote `main`. Production deployment has not been reverified in this session.

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

## Previous Phase Status (Historical Handoff)

```text
Current phase: Timeline Phase 7.5-7.9 AI itinerary exchange, planning, and import
Status: Phase 7.5-7.9, unified JSON import, AI-flow optimization, and shared graphical preview are complete on the feature branch; merge/Production deployment remain pending
Branch: codex/timeline-phase-7-ai-exchange-import (tracking origin/codex/timeline-phase-7-ai-exchange-import, based on 0bb623e)
Production data: Cleanup completed; 8 approved test visits converted to Untimed and 1 approved invalid test transport deleted
Production migration: Phase 7 import RPC applied as 20260819134935 on lqvuqamzmchepgxkftcw
Staging migration: Phase 7 import RPC applied as 20260819125851 on uyqdopksfysbobhjcepk; Staging still does not have 20260811150000
Pending rollout: All Phase 7.5-7.9 and AI-flow follow-up work is confined to the feature branch. Nothing is merged into main or deployed to Production. Publication commits are recorded in Git history. Production received one explicitly approved read-only Formal Trip snapshot query for Staging recovery, with no Production write or configuration change
```

## Phase 7.5-7.9 AI Itinerary Exchange, Planning, and Import

- AI exchange uses its own strict `travel_studio_ai_itinerary` v1 identity. It is intentionally separate from Formal `travel_studio_trip` v1, and each parser rejects the other document type.
- The AI contract contains portable planning semantics: Trip/destination/date range, complete Days, visit order/category/title, Formal-compatible location data, four schedule forms, Fixed, notes, alternatives, and Day-level transport visit numbers. It excludes UUIDs, ownership, timestamps, locks, Realtime/provider objects, and Place IDs. Every location uses the same four required fields as Formal v1: `name`, `map_url`, `latitude`, and `longitude`; unavailable values are `null`. New AI/Formal templates and exports never write `address`; older JSON containing `address` remains readable and the field is ignored. The existing database/RPC `address` slot remains unchanged and receives `null`.
- Existing Trip More Actions opens `給 AI 調整`: users download that Trip's AI exchange JSON and copy only the AI prompt, then select the AI-produced JSON file through the shared `匯入 JSON` action to create a new Trip while leaving the source Trip unchanged. Neither mode exposes JSON-body copying; long prompt text is collapsed by default, with an inline manual-copy fallback if clipboard access fails.
- New Trip exposes a Bot icon plus visible `AI規劃` text, with the accessible label `AI 規劃`. Its Dialog uses the approved three-step guide, provides `下載模板 JSON` and `複製給 AI 的提示詞`, then returns to the preserved New Trip form. The New Trip form owns the shared `匯入` plus upload-icon file action. It does not render or copy the blank JSON body in the UI. The downloaded blank template contains no internal/provider data and intentionally remains invalid until the AI fills all required fields.
- Create and Revise share vendor-neutral, sectioned instructions and a contract-tested complete example (visits, duration continuation, transport, and alternative). New drafts use a daily start anchor plus duration-only continuation where appropriate; meals, opening windows and reservations may introduce new explicit anchors with free time preserved. Suggestions are not Fixed or confirmed bookings. Only missing destination/date essentials require clarification; titles may be proposed, and unknown flights/hotels/coordinates or intentionally empty Days remain acceptable. Useful planning density is preserved without an item quota. The blank template and JSON schemas remain unchanged. Demo remains isolated.
- Create and revise prompts require a downloadable `.json` file rather than a Google/online document or message-only JSON, preserve exact English keys, enumerate categories and all four legal schedule shapes, require complete `timed` start/end only when explicit times are chosen, constrain duration values to integer 1-1440, prohibit zero-minute transport, and check only supplied explicit schedules for transport-aware overlap. Unreliable details fall back to Untimed/null/omission rather than invention.
- A narrow pre-validation compatibility pass accepts common external-AI aliases without weakening the remaining strict contract: `start_time/end_time` become `start/end`, `dining/accommodation` become `food/hotel`, `mode` becomes transport `category`, `subway/metro` become `train`, a missing transport name uses the category label, an omitted duration may be read only from an explicit `N 分鐘`/`N minutes` note, and an entire Day of unambiguously 0-based transport refs shifts to 1-based. Mixed or out-of-range numbering still blocks. All other unknown fields still block import.
- AI contract parsing still supports strict JSON, one fenced JSON block, or one clearly extractable JSON object with small text wrappers for internal compatibility tests. The product UI accepts only a selected `.json` file and no longer exposes a text-paste entry. It does not repair JSON5, comments, trailing commas, single quotes, multiple objects, or ambiguous data.
- Valid AI input converts through a dedicated adapter to Formal v1. Duration-only visits use the Phase 6 five-minute continuation rule only when a safe immediate Timed anchor exists; unsafe duration segments become Untimed warnings, while explicit overlaps remain blocking errors. Exact `24:00`, Fixed, alternatives, multiple Days, non-adjacent suspended transport, and blank transport-name fallback are preserved.
- AI import converts validated location fields directly to Formal v1 and shares the existing cover/Google Map preview with website-exported JSON. The map uses only coordinates already in the file; the existing Wikimedia cover lookup remains available. There is no pre-import Places lookup, candidate selection, retry, or manual place confirmation. Missing coordinates do not block confirmation and use the existing yellow copy `尚有 X 個目的地缺少可用座標`.
- JSON file import has one shared pipeline. It reads `document_type` locally: `travel_studio_trip` stays on the strict Formal parser, while `travel_studio_ai_itinerary` uses the bounded AI compatibility pass and converts to Formal before the same preview and atomic confirmation. The separate `貼上 AI 回覆` Dialog and text-paste path were removed.
- Blocking Contract or persistence errors use the compact red state with no Map, counts, or confirm action. Valid/warning AI and Formal input share the same graphical cover/map preview and simplified notices. If no eligible location has coordinates, the board retains the default cover and a neutral `尚無可顯示的地圖位置` message without a lookup or map-load error. The final action builds the existing Formal persistence payload and calls only `import_trip_timeline_v1`.
- No AI provider, model API, key, chat, streaming, agent, token/cost system, RPC, migration, or database column was added.
- New manual fixtures: `tests/fixtures/manual/phase-7-ai-valid-complete.json` and `tests/fixtures/manual/phase-7-ai-blocking-error.json`.
- Phase 7.9 coordinate-unification verification on 2026-08-24: blank-template/prompt/alias/location contract plus Create/Revise/import UI tests passed 20/20, full Playwright passed 319/319 after removing the obsolete AI Places coordinator suite, Production build passed with the existing large-chunk warning, and `git diff --check` passed with informational Windows line-ending notices.
- Phase 7.9 four-field location follow-up on 2026-08-24: AI/Formal Schema, blank template, prompts, adapters, fixtures, and new exports now omit `address`; legacy AI/Formal files containing it remain compatible and strip it before validation. Focused tests passed 35/35, full Playwright passed 320/320, Production build and `git diff --check` passed. Authenticated 5174 browser QA verified a new export has exactly `name/map_url/latitude/longitude`, and a legacy-address copy reached the non-blocking import preview without Places or map confirmation. No import was confirmed.
- Unified JSON import follow-up on 2026-08-25: New Trip and both AI exchange modes now use the same JSON file picker and shared parser as Formal import. `document_type` selects strict Formal parsing or bounded AI parsing plus Formal conversion before one common preview and one atomic confirmation path. The `貼上 AI 回覆` Dialog and text-paste UI were removed. Focused tests passed 42/42, full Playwright passed 320/320, Production build and `git diff --check` passed. Local 5174 browser QA loaded a real AI JSON file into the shared Formal preview (6 Days, 24 visits, 18 transports, 0 alternatives) with no app error; confirmation was intentionally not pressed and no data was written.
- New Trip action polish on 2026-08-25: `AI 規劃` is a Bot icon with an accessible label, JSON file selection is upload icon plus `匯入`, and Create-mode AI planning uses `返回` to restore the preserved New Trip form instead of exposing a second file picker. Targeted unified-import/UI/RPC tests passed 14/14, Production build and `git diff --check` passed, and authenticated 5174 browser QA verified the round trip with all entered form values preserved. No import or data write was performed.
- AI prompt draft-balance follow-up on 2026-08-25: both Create and Revise prompts distinguish proposed planning content from confirmed booking facts while making every chosen schedule/transport shape self-validating. A real Gemini re-test exposed the first revision as over-corrected: it produced exactly one Untimed attraction per Day and zero transports. The prompt now requires useful, geographically feasible suggestions and reasonable timing/transport estimates without imposing a fixed daily item count; Revise also preserves useful existing density unless explicitly asked to simplify. No import or data write was performed.
- A second Gemini re-test on 2026-08-25 improved to 25 visits and 19 transports across 6 Days, but exposed three transport-aware schedule gaps of 5, 5, and 1 minute, one artificial in-train 1-minute transport, and 25/25 missing coordinate pairs. Create/Revise prompts now require explicit per-Day minute arithmetic (`end`, `earliest_next_start`), downstream non-Fixed shifting, Fixed-anchor preservation, omission of same-place/facility/vehicle placeholder transport, and Maps search URLs plus best-known coordinates for recognizable public places while allowing generic/ambiguous locations to remain null. Focused tests passed 27/27 and Production build passed. The downloaded test file itself was not modified or imported.
- Authenticated local Staging browser QA verified the desktop and 390x844 mobile `AI 規劃` and `給 AI 調整` flows, exact labels, no Create-mode JSON textarea/copy action, successful template-download and prompt-copy states, no horizontal overflow, and no app console error or warning. No import was confirmed and Staging remained at two Trips.
- Authenticated browser re-test with a real seven-Day external-AI file verified that 191 derivative format errors collapse to zero format errors after the bounded alias pass. Preview then showed only two genuine five-minute schedule/transport conflicts, with exact paths and actionable earliest starts (`18:35` and `12:05`) but no confirm action; they remain blocking rather than being silently rescheduled. Console stayed clean, no import was confirmed, and Staging remained at two Trips.
- A second real Gemini file confirmed the hardened prompt produced correct keys, categories, schedules, and complete transport fields, but still numbered each Day's transport refs from 0. The bounded all-Day shift converted those refs safely; Contract and Formal conversion passed with zero errors. Authenticated browser preview rendered 5 Days, 15 visits, 10 transports, and 0 alternatives, auto-resolved 4/15 Places, and left 11 for the existing manual Places workflow. No import was confirmed.
- Authenticated Staging browser QA passed the complete Formal flow: Header `AI 行程交換`, pasted AI fixture, real Google Places resolution 4/4, preview of 2 Days / 3 visits / 1 transport / 1 alternative, five-minute continuation `10:55-12:10`, one atomic import, reload, and semantic Formal re-export. The AI JSON contained no UUID, Place ID, coordinates, or Maps URL. The temporary `Phase 7.5 Browser QA 01a032da` Trip and all dependent rows were removed.
- During browser cleanup, a native-confirm automation retry accidentally deleted the pre-existing Staging `系統測試專用` Trip. With explicit approval, Production was queried read-only for only the same-name Formal Trip/Timeline/alternatives graph; members, budget, luggage, and other excluded modules were not copied. The existing Formal payload and `import_trip_timeline_v1` restored it atomically to Staging as `0871e22c-be7b-43c5-b5ab-cf22f54c97d4`, with 4 Days, 16 visits, 3 transports, 3 alternatives, and one approved owner. Dry-run rollback, post-commit SQL audit, and authenticated browser reload all passed; Staging now contains exactly the restored Trip plus `Phase 6 Staging QA`.
- Production project `lqvuqamzmchepgxkftcw` received no SQL write, migration, data mutation, Auth, setting, or deployment change during Phase 7.5-7.9. The recovery access was one read-only snapshot of the approved same-name Formal Trip graph. Phase 7.9 made no Supabase API, schema, RPC, migration, or data change.
- Full evidence, exact boundaries, and rollout gates are in `docs/2026-08-24-phase-7-ai-exchange-import-closeout-handoff.md`.

### 2026-10-11 AI-flow optimization (feature branch; not deployed to Production)

- 2026-10-14 button polish: New Trip now shows Bot + `AI規劃`; its `匯入` label inherits the same font size as neighboring buttons through a Create-dialog-only selector. The label change passed focused UI tests 8/8, build and authenticated open/Back QA before the final font-size adjustment. The user will verify that final CSS adjustment; no new test/build/browser run was performed for publication. Only diff/commit-scope checks are required for this requested push, and recurring local test/QA artifacts remain excluded.
- AI planning guidance now follows the approved three-step preview: prepare the JSON template and AI prompt together, upload/paste both into the external AI conversation, then download the completed JSON and use `返回 -> 新增旅程 -> 匯入`. The long prompt remains collapsed with the existing clipboard fallback; mobile controls stack and the dialog scrolls within the viewport. Only Create-mode copy/layout and tests changed; Revise-mode layout, prompts, JSON contracts, parsers, shared import, and RPC behavior remain unchanged. Focused UI tests passed 8/8, final full Playwright passed 345/345, Production build and `git diff --check` passed. Authenticated in-app desktop/390px QA verified the approved hierarchy, no app errors or horizontal overflow, accessible expanded-prompt/footer controls, and unchanged New Trip form values after Back. No Trip was created/imported, no data was written, publication commits are recorded in Git history; merge and Production deployment remain pending.
- Shared-preview correction: AI and website-exported JSON now mount the same existing cover/Google Map board. Coordinates come directly from the file, without Places, candidate selection, or location confirmation. No eligible coordinate points yields a neutral empty-map message, not a load failure. Focused tests passed 30/30, full Playwright passed 341/341, Production build and `git diff --check` passed. Authenticated 5174 desktop/390x844 mobile QA verified the real Hokkaido preview (7 Days / 36 visits / 28 transports / 2 alternatives) with the simplified notices; fresh reload/file-picker QA verified AI map/cover, Formal empty-map fallback, and compact blocking Error without confirm. No import was confirmed; four existing Trips remain unchanged. Delivery is confined to the feature branch; Production is unchanged.
- Real fresh temporary-chat baselines reproduced a Gemini 15-minute transport/time overlap. Anchor-plus-duration guidance eliminated this format failure without relaxing explicit-time or Fixed validation. Further independent tests exposed invented Fixed anchors and an afternoon dinner; the shared prompt now distinguishes scheduling anchors from Fixed and requires expanding actual meal times before delivery.
- The initial optimization preserved source identity and restored the existing yellow `尚有 X 個目的地缺少可用座標` warning, but incorrectly replaced the AI map/cover with a local summary. This presentation decision was superseded by the user's clarification: no manual map-based location verification does not mean no graphical preview. AI and Formal now share the existing board. Normal successful duration continuation is not shown as a warning; unsafe continuation remains visible. The sole confirmation RPC is unchanged.
- Reusable draft fixture: `tests/fixtures/manual/phase-7-ai-draft-duration.json` (unknown restaurant/coordinates, no flight/hotel, intentionally empty Day). Initial authenticated browser preview passed without a blocking error or data write; it predated restoration of the common graphical board. Each external AI trial used a fresh temporary chat and synthetic data only; no same-chat correction was requested.
- Nine independent GPT/Gemini trials covered baseline/new planning prompts and existing-trip revision. The final GPT creation produced 3 Days / 16 visits / 13 transports with zero blocking errors. Final Gemini creation produced 3 Days / 13 visits / 10 transports; the bounded `subway -> train` alias made it persistable, while one unsafe duration segment still becomes Untimed with visible warnings. Both revision trials preserved the original first Day, Trip metadata, and Fixed anchor exactly. These are limited trial results, not a universal correctness guarantee; coordinates were not externally verified. Both AI tabs were reset to empty temporary chats after testing.
- Final automated verification: full Playwright 330/330 passed, Production build passed with the existing large-chunk warning, and `git diff --check` passed. Desktop and 390x844 rendered UI checks cover file downloads, prompt-only copying, collapsed/manual fallback, shared import, and no horizontal overflow; mobile browser coverage is not real-device certification.
- External download completion is not verified: Edge retained `.crdownload` files. Their JSON bytes are parseable and tested locally, but this is not evidence of a completed browser download. No import was confirmed; no Production/Staging writes, push, merge or deployment were performed.
- First-use import feedback follow-up: presentation now separates normal pending times from actual warnings. Main visits without times and their retained transport produce one neutral line (`部分行程尚未設定時間，匯入後可再安排；行程與交通都會保留。`), untimed alternatives need no warning, missing locations/coordinates are deduplicated, and unsafe duration conflicts use one plain-language count. Raw diagnostics, JSON contracts, conversion, blocking validation and persistence are unchanged; this is not a blanket ban on the term Untimed.
- Feedback verification: focused tests 23/23, full Playwright 338/338, Production build and `git diff --check` passed. The user's Hokkaido preview shrank from 9 warning rows to one neutral note and one coordinate reminder while retaining 7 Days / 36 visits / 28 transports / 2 alternatives and enabled confirmation. Independent authenticated reload/file-selection QA verified valid and blocking fixtures; confirmation was never pressed and the four existing Trips remained unchanged. Desktop/390px rendered tests passed; reload emitted only the existing Google Marker deprecation notice, with no app error. Screenshot evidence remains outside the repository.

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
