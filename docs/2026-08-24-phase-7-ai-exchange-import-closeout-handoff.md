# Timeline Phase 7.5-7.9 | AI Itinerary Exchange, Planning, and Import Closeout

Status: Phase 7.5-7.9, unified import, and 2026-10-11 AI-flow follow-ups are complete on `codex/timeline-phase-7-ai-exchange-import`; publication commits are recorded in Git history; merge and Production deployment pending
Date: 2026-08-24
Baseline: `0bb623e` (`origin/main` was `0 0` at phase start)
Production: No writes or configuration changes; one explicitly approved read-only Formal Trip snapshot was used to recover Staging

## Scope Completed

Phase 7.5-7.9 adds a portable exchange boundary for editing or creating itineraries with an external AI, without calling any AI service from Travel Studio. Phase 7.9 adds an explicit blank-template planning path in addition to the existing Trip-revision path.

The implemented path is:

```text
Formal App Domain
  -> AI export adapter
  -> travel_studio_ai_itinerary v1
  -> user-selected external AI
  -> shared JSON file parser
  -> normalized AI draft
  -> direct Formal-compatible location conversion
  -> travel_studio_trip v1
  -> existing persistence adapter
  -> existing import_trip_timeline_v1 RPC
```

No AI API, provider selector, API key, server-side model call, Chat UI, streaming response, agent, MCP planner, token/cost system, database column, migration, or second persistence function was added.

## Contract and Adapter Boundary

The AI document identity is independent:

- `document_type: "travel_studio_ai_itinerary"`
- `schema_version: "1"`

Formal JSON remains `travel_studio_trip` v1. Each parser explicitly rejects the other type, so AI contract evolution cannot silently loosen the stable Formal exchange contract.

AI v1 includes portable planning semantics: Trip title, destination/country/city, date range, complete Day sequence, ordered visits, mature category, Formal-compatible location data, schedule, Fixed, notes, alternatives, and Day-local transports expressed with 1-based visit numbers. It rejects database IDs, owners/members, timestamps, locks, Realtime/provider objects, Place IDs, and unknown fields. Its location object is identical to Formal v1 and always contains `name`, `map_url`, `latitude`, and `longitude`; unavailable values are `null`.

Schedule forms are `timed`, `start_duration`, `duration`, and `untimed`. Fixed accepts only explicit start forms. Duration-only visits continue from the immediately preceding safe Timed anchor plus direct transport duration, rounded upward to the existing five-minute Timeline step. Missing anchors, Untimed boundaries, explicit-anchor collisions, and overflow do not create guessed times. Exact `24:00`, alternatives, multiple Days, suspended non-adjacent transports, and blank transport-name category fallback remain compatible with Phase 6 and Formal v1.

## Location Conversion

AI conversion is local and direct; valid coordinates are preserved into Formal v1. AI and website-exported JSON share the existing cover/Google Map preview, drawing only coordinates already in the file and retaining the existing Wikimedia cover lookup. There is no Places lookup, candidate resolution, or manual location confirmation. Missing or unusable coordinates remain `null`, do not block confirmation, and display the existing yellow warning `尚有 X 個目的地缺少可用座標`.

The compatibility pass still accepts earlier AI v1 locations by removing legacy `address`, `area`, and `search_hint`, then adding null `map_url/latitude/longitude` where needed. Earlier `location: null` becomes the same four-field empty object. Formal v1 import likewise accepts and ignores legacy `address`. Unknown fields remain blocking. The database/RPC `address` slot remains unchanged and receives `null`; no migration is required.

## User Experience

An existing Formal Trip's More Actions menu now includes `給 AI 調整`. This path provides:

- vendor-neutral instructions for the external AI;
- download the Trip JSON file;
- copy the AI prompt only;
- the shared `匯入 JSON` file action.

New Trip now includes `AI 規劃`. Its Dialog uses the short instruction `下載模板，交給 AI 規劃後匯入。` and provides:

- `下載模板 JSON`, which downloads `travel-studio-ai-itinerary-template-v1.json`;
- `複製給 AI 的提示詞`;
- `返回`, which restores the preserved New Trip form.

Both modes collapse the long prompt by default. Clipboard failure expands only the prompt in place; no new dialog or JSON-body copy action is shown. Download status reports that the file is prepared, not that the browser has finished saving it.

The New Trip form represents `AI 規劃` with a Bot icon and accessible label, and represents the shared JSON file action as upload icon plus `匯入`.

Create mode intentionally renders no JSON textarea, no blank-template JSON text, and no copy-JSON action. The blank file contains the contract skeleton but no UUID, ownership, Place ID, address, or other internal data. Its location skeleton contains the same four Formal fields with null values. It intentionally fails validation until an AI fills the required Trip/date values and a valid continuous Day graph. The vendor-neutral prompt asks only for missing destination or required date information; the AI may propose a title. Undecided flights, accommodation, dining, transport, places, and detailed times remain optional draft content rather than invented requirements.

The Create and Revise prompts require the final response as a directly downloadable `.json` file rather than a Google/online document or message-only JSON. They preserve the template's exact English keys and distinguish planning proposals from confirmed facts. AI should actively suggest geographically feasible visits, dining, accommodation areas, reasonable `start_duration` schedules, and transport, while never claiming that flights, bookings, reservations, or tickets were confirmed by the user. Slow travel may use fewer items without a fixed quota, but one generic Untimed item per Day and globally empty transport are not acceptable substitutes for planning. Truly unknown values may still use Untimed/null/omission. Every explicit value must use one of four complete schedule shapes, integer 1-1440-minute durations, no zero-minute transport, 1-based visit numbers, and transport-aware non-overlapping times.

The 2026-10-11 optimization keeps the schemas/blank template unchanged and shares one sectioned Create/Revise specification with an executable full-shape example. New draft suggestions use a daily start anchor and duration continuation, while meal/opening/reservation windows use additional explicit anchors with gaps allowed. A scheduling anchor does not imply Fixed. The AI must expand the resulting times before delivery to avoid meals being pulled into implausible hours. Real explicit-time conflicts still block; successful duration continuation is normal and is omitted from user warnings.

Before strict validation, one bounded compatibility pass handles common external-AI deviations:

- `schedule.start_time/end_time` -> `schedule.start/end`;
- visit `dining/accommodation` -> `food/hotel`;
- transport `mode` -> `category`;
- transport `subway/metro` -> `train` (AI files only);
- missing transport name -> established transport-category label;
- missing `duration_minutes` -> an explicit bounded `N 分鐘` or `N minutes` value in transport notes.
- an entire Day whose transport refs are unambiguously within 0-based bounds and include `0` -> all refs shift to 1-based together.

Conflicting canonical and alias fields are not overwritten, mixed or out-of-range transport numbering remains invalid, arbitrary fields are not removed, unknown fields still block, and explicit Timeline overlaps still block rather than being silently rescheduled. The prompt now says explicitly that the first visit-to-second visit pair is `1→2` and zero is forbidden.

JSON file selection is the only import entry. The shared parser inspects `document_type` locally: Formal files remain on the strict Formal parser, while AI files use the bounded AI compatibility pass and convert to Formal before the same preview. The former `貼上 AI 回覆` Dialog and text-paste path were removed. Both AI modes import as a new Trip; the `給 AI 調整` path explicitly states that the source Trip remains unchanged.

Blocking parser/contract/persistence errors render the compact red state with no Map, counts, or confirm action. Valid and warning AI/Formal states share the same graphical preview, counts, simplified notices, and confirmation path. When there are no eligible coordinate points, the cover uses its default background and the map area says `尚無可顯示的地圖位置`; it makes no map/cover lookup and does not report a map-load error. Missing coordinates remain a non-blocking yellow warning. Supabase error strings, normal error objects, and thrown errors are normalized before rendering.

First-use import feedback distinguishes a normal draft state from issues requiring attention. Visits without explicit times and retained transport share one neutral note: `部分行程尚未設定時間，匯入後可再安排；行程與交通都會保留。` Untimed alternatives do not create reminders. Missing locations/coordinates collapse into one existing yellow reminder with a short next step; unsafe duration conflicts share one plain-language count. Important empty/settled reminders and unknown future warning types remain visible. The presentation helper does not mutate raw diagnostics, documents, schedules, validation results or confirmation eligibility, and does not globally prohibit technical vocabulary in other contexts.

Demo receives no AI callbacks and continues to expose only its existing JSON export behavior.

## Persistence and Security

Final conversion produces a fully validated Formal v1 document. It then calls `buildTripImportPersistencePayload` and exactly one existing RPC:

```text
import_trip_timeline_v1
```

There is no alternative write path. Staging catalog verification on 2026-08-24 reconfirmed:

- `security invoker`;
- fixed `search_path=pg_catalog, public, auth`;
- `authenticated` execute allowed;
- `anon` and `public` execute denied.

This remains aligned with the current Supabase Database Functions guidance to prefer invoker behavior and explicitly restrict function execution.

## Automated Verification

AI-flow optimization follow-up on 2026-10-11 (feature branch; verified locally):

- Shared-preview correction: focused 30/30 and full Playwright 341/341 passed; Production build and `git diff --check` passed. AI and Formal now use the same board; tests cover identical file-coordinate routes and desktop/390px coordinate-free preview with no map/cover lookup or map failure. Authenticated local desktop/390x844 QA restored the Hokkaido cover/map while preserving 7 Days / 36 visits / 28 transports / 2 alternatives and simplified notices. Fresh reload/file-picker checks verified AI cover/map, Formal empty-map fallback, and blocking Error without a board/counts/confirm action. No import was confirmed, four Trips remain unchanged, and there was no app error (only the existing underlying Google Marker deprecation warning). Screenshots are outside the repository. The user-facing tab remains on the Hokkaido preview; delivery is confined to the feature branch, without a merge or Production deployment.
- Latest first-use feedback follow-up: focused tests 23/23 and full Playwright 338/338 passed; Production build and `git diff --check` passed. The Hokkaido preview retained 7 Days / 36 visits / 28 transports / 2 alternatives while replacing 9 warning rows with one neutral note and one coordinate reminder. Desktop and 390px rendered tests cover grouping, routine-only/no-yellow state, plain copy and no horizontal overflow. Authenticated reload/file-selection QA reconfirmed valid non-blocking preview and compact blocking Error with no confirm action; no import was confirmed, four existing Trips remained unchanged, and the only reload warning was the existing Google Marker deprecation notice. Evidence is outside the repository.
- Before the first-use feedback follow-up, full Playwright regression: 330/330 passed.
- Production build: passed; only the existing Vite large-chunk warning remains.
- `git diff --check`: passed; Windows LF/CRLF notices remain informational.
- Desktop and 390x844 rendered checks cover both exchange modes, actual generated download contents, prompt-only copying, collapsed prompt/manual clipboard fallback, shared import and overflow. This is browser-responsive coverage, not real-phone certification.
- Authenticated 5174 browser QA verified the draft fixture with an unknown restaurant/coordinates, no flight/hotel and an intentionally empty Day. Preview showed 2 Days / 2 visits / 1 transport and the existing yellow missing-coordinate message without an AI map/cover or blocking error. Confirmation was not pressed; app console stayed clean.
- Nine independent external trials used synthetic inputs and a fresh temporary chat for every first response, with no same-chat repair request. Baseline Gemini missed 15 minutes of transport. Subsequent trials exposed invented Fixed anchors and an afternoon dinner; the prompt was refined for both before the final creation trials.
- Final GPT creation: 3 Days / 16 visits / 13 transports, zero blocking errors and a valid persistence payload; final Gemini creation: 3 Days / 13 visits / 10 transports, valid persistence payload after bounded `subway -> train` compatibility. Gemini still had one unsafe duration segment, preserved as Untimed with visible warnings rather than silently changing explicit times. These limited tests do not establish universal reliability or verified coordinates.
- GPT and Gemini revision trials preserved the entire original first Day, Trip metadata and Fixed anchor exactly while adding the requested second-Day suggestions and rain alternative. Both tabs were returned to empty temporary chats after testing.
- Browser download completion remains unverified: Edge retained `.crdownload` files after the real website download controls were clicked. Their inert JSON bytes were validated locally, but were not renamed, executed or confirmed for import. Browser-internal download/security controls were not bypassed. No Trip import, database write, push, merge or deployment was performed.

Phase 7.5-7.8 verification at `http://127.0.0.1:5174/`:

- AI rendered/UI boundary suite: 6/6 passed.
- Focused AI + Phase 7 + Phase 6 Planner/RPC + navigation/map: 176/176 passed.
- Full Playwright regression: 324/324 passed.
- Production build: passed; only the existing Vite large-chunk warning remains.
- `git diff --check`: passed; existing Windows LF/CRLF notices remain informational.

Phase 7.9 verification:

- Blank-template, prompt, alias/location compatibility, and Create/Revise/import rendered UI tests: 20/20 passed.
- Full Playwright regression after removing the obsolete AI Places coordinator and its tests: 319/319 passed.
- Production build: passed; only the existing Vite large-chunk warning remains.
- `git diff --check`: passed; existing Windows LF/CRLF notices remain informational.

Unified JSON import follow-up verification on 2026-08-25:

- Formal and AI document dispatch plus direct file-import UI: 42/42 focused tests passed.
- Full Playwright regression: 320/320 passed.
- Production build: passed; only the existing Vite large-chunk warning remains.
- `git diff --check`: passed; existing Windows LF/CRLF notices remain informational.
- Local 5174 browser QA selected a real AI JSON file from the New Trip shared import action and reached the Formal preview with 6 Days, 24 visits, 18 transports, and 0 alternatives. No application error appeared, confirmation was not pressed, and no data was written.

Coverage includes strict/fenced/wrapped parsing, malformed/ambiguous JSON, type/version separation, unknown and required fields, Day/date/time/Fixed invariants, duration scheduling, exact `24:00`, alternatives, transports, multiple Days, Formal conversion, semantic round trip, unique/multiple/not-found/error Place states, re-search/candidate selection, partial batch failure, `0,0` rejection, explicit text-only handling, compact Error UI, unresolved gating, RPC object-error rendering, exchange copy/download, Demo isolation, and mobile overflow.

Manual fixtures:

- `tests/fixtures/manual/phase-7-ai-valid-complete.json`
- `tests/fixtures/manual/phase-7-ai-blocking-error.json`
- `tests/fixtures/manual/phase-7-ai-draft-duration.json`

Historical rendered evidence in the untracked `test-results/` directory covers desktop exchange, compact desktop Error, missing-coordinate warning, coordinate-ready import, RPC Error, and 390x844 mobile preview. The earlier no-map-preview expectation is superseded by the 2026-10-11 shared-preview correction. Current checks preserve the no-Places/no-candidate boundary while allowing the existing map/cover board. These artifacts must remain untracked.

## Phase 7.9 Browser Verification

Authenticated local Staging browser QA verified:

- New Trip shows the accessible `AI 規劃` Bot icon and the exact short instruction;
- Create mode has `下載模板 JSON`, `複製給 AI 的提示詞`, and `返回`, with no JSON textarea, copy-JSON control, or second import picker;
- the download and copy actions report successful states;
- an existing Trip's More Actions menu shows `給 AI 調整` and explains that import creates a new Trip while the source Trip stays unchanged;
- desktop and 390x844 mobile layouts have no horizontal overflow;
- browser console contains no application errors or warnings.

The 2026-08-25 unified-entry follow-up additionally verified that the `貼上 AI 回覆` button and Dialog are gone. AI planning returns to the preserved New Trip form, whose upload-icon `匯入` action owns new-Trip file selection; `給 AI 調整` retains its direct file action. Both feed the same shared parser, preview, and confirmation path.

Authenticated 5174 browser QA exercised New Trip -> Bot-icon `AI 規劃` -> `返回` -> New Trip. The AI Dialog contained no file picker, and the returned form preserved its title, country, city, and date range. The upload-icon `匯入` action remained available. Targeted unified-import/UI/RPC tests passed 14/14 and the Production build passed with only the existing large-chunk warning. No import was attempted.

The 2026-08-25 prompt draft-balance follow-up updated both Create and Revise instructions after real GPT and Gemini files exposed a missing `timed.end`, zero-minute transports, and explicit Timeline conflicts. An immediate Gemini re-test then showed the initial flexibility wording was over-corrected: 6 Days became exactly 6 Untimed visits and 0 transports. The balanced prompt now requires concrete usable suggestions, reasonable timing and transport estimates, no fixed item quota, and no fabricated confirmed booking facts. Revise preserves useful existing density unless the user asks to simplify. No import or data write was performed.

A second Gemini re-test produced useful density (25 visits and 19 transports across 6 Days) but still failed three schedule checks by 5, 5, and 1 minute. It also created a fake 1-minute `車廂內移動` transport and left all 25 coordinate pairs null. The prompts now spell out per-Day minute arithmetic for `timed` and `start_duration`, compute `earliest_next_start` with adjacent transport, shift downstream non-Fixed items on conflict, preserve Fixed anchors, omit transport within the same place/facility/vehicle, and request searchable Maps URLs plus best-known coordinates for recognizable public places without treating them as bookings. Generic accommodation areas, onboard activities, and ambiguous locations may remain null. Focused contract/UI/unified-import/RPC tests passed 27/27 and Production build passed. The external test file was not modified or imported.

A follow-up authenticated browser test used a real seven-Day external-AI response with 24 visits and 17 transports. Before the compatibility fix it produced 191 derivative errors: 49 unknown fields, 49 missing fields, 32 invalid times, 10 unsupported visit categories, 17 unsupported transport categories, and 34 invalid types. After the fix, format validation passed with zero errors and the preview exposed only two genuine five-minute Timeline conflicts caused by explicit visit times not leaving room for the preceding transport. Each error now reports the actionable earliest start (`18:35` and `12:05`). Both exact paths remained blocking, no confirm action was shown, browser console stayed clean, and no import was attempted.

A second real Gemini response showed that the hardened prompt corrected every earlier field/category/schedule/transport-shape issue, but Gemini still emitted all Day-local transport visit numbers as 0-based. The bounded all-Day conversion removed the five resulting range errors. Contract and Formal conversion then passed with zero errors; authenticated browser preview rendered 5 Days, 15 visits, 10 transports, and 0 alternatives, resolved 4/15 Places automatically, and left 11 in the existing manual resolution panel. Console remained clean and no import was confirmed.

No Phase 7.9 import was confirmed. Staging remained at exactly the restored `系統測試專用` Trip and `Phase 6 Staging QA`. No Production or Staging data, Supabase API, schema, RPC, migration, Auth, setting, or deployment was changed.

## Staging Verification and Cleanup

Supabase Staging `uyqdopksfysbobhjcepk` was reverified `ACTIVE_HEALTHY`; migration history includes `20260819125851_phase_7_import_trip_timeline_v1` and still excludes the unrelated optional `20260811150000` alternative migration.

An authenticated-role transaction used an existing approved owner claim and the exact payload produced by the new AI adapter plus the existing Formal persistence adapter. Before forced rollback it verified:

- RPC counts: 2 Days, 3 visits, 1 transport, 1 alternative;
- one approved owner membership;
- text-only locations stored with no latitude, longitude, or Maps URL;
- semantic reload matched `09:00-10:30`, five-minute continuation `10:55-12:10`, and `08:30-10:30` on Day 2;
- Fixed state and visit order matched the source fixture.

The audit deliberately raised `qa_verified_success` after its assertions so the outer transaction rolled back. A follow-up query found zero retained success-fixture Trips.

A second authenticated-role fixture changed the transport target to a missing visit. The existing RPC rejected it with `invalid_transport_relation`; a follow-up query found zero retained failure-fixture Trips. No cleanup delete was required because both transaction paths rolled back.

The final authenticated browser pass then exercised the integrated Formal route end to end:

- Header `AI 行程交換` opened the exchange flow;
- the complete AI fixture pasted successfully;
- real Google Places resolution completed 4/4;
- preview reported 2 Days, 3 visits, 1 transport, and 1 alternative;
- duration scheduling produced the expected `10:55-12:10` continuation;
- confirmation called the existing atomic RPC once;
- reload preserved the imported graph;
- Formal re-export matched the source semantics;
- exported AI JSON contained no UUID, Place ID, coordinate, or Maps URL.

The temporary committed QA Trip `Phase 7.5 Browser QA 01a032da` (`17dbf23f-b2a5-43b1-ab46-5523e24503cc`) and all dependent rows were removed.

During that cleanup, a native `window.confirm` automation timeout followed by a retry accidentally deleted the pre-existing Staging `系統測試專用` Trip (`4ddc1ce6-08df-4ec7-a2db-b1cc24272d5a`). The incident was not hidden or treated as an acceptable baseline change.

With explicit user approval, recovery used this bounded path:

1. Production project `lqvuqamzmchepgxkftcw` was queried read-only for only the same-name Formal Trip, its 19 Timeline items, and 3 alternatives.
2. Production members, budget, luggage, and every other module outside Formal JSON v1 were not read for copying and were not imported.
3. Source UUIDs, ownership, and timestamps were discarded while building the existing Formal persistence payload. The blank `train` name correctly serialized as `電車`.
4. Staging dry-run used an authenticated owner claim, called `import_trip_timeline_v1`, verified the complete graph, and rolled back. A follow-up found zero retained same-name rows.
5. The identical payload was committed through the atomic RPC and re-audited.

The restored Staging Trip is `0871e22c-be7b-43c5-b5ab-cf22f54c97d4` with:

- title/destination/dates `系統測試專用`, `日本 · 京都`, `2027-07-08` through `2027-07-11`;
- 4 Days, 16 visits, 3 transports, and 3 alternatives;
- exactly one approved owner membership for the authenticated Staging user;
- valid transport endpoints, valid non-`0,0` coordinates, and no reused Production UUID;
- Day 1 A/B/C/E plus `測試` 8 minutes and category-fallback `電車` 124 minutes.

Authenticated browser reload showed exactly two Staging Trips: the restored `系統測試專用` and `Phase 6 Staging QA`. The restored Trip rendered all four Days and expected Day semantics. Browser logs contained no application error; the existing Google Maps legacy Marker deprecation warning remained informational.

Production received no SQL write, migration, data mutation, Auth, setting, or deployment change. Its only Phase 7.5-7.9 recovery access was the explicitly approved read-only same-name Formal snapshot from the earlier recovery work.

## Rendered QA Boundary

The earlier fallback Playwright run mounted the actual production React components and exercised desktop/mobile interactions with DOM, console, download, and screenshot evidence. The later in-app browser run used the authenticated local Staging session and completed the Header-to-import-to-reload-to-re-export path against real Staging and real Places. Authenticated integrated browser QA is therefore complete and is no longer a release gate.

## Branch and Rollout State

Current local branch: `codex/timeline-phase-7-ai-exchange-import`.

At feature-branch publication:

- the intended Phase 7.5-7.9 source, contract, tests, fixtures, tracker, plan, and closeout were committed and pushed to `origin/codex/timeline-phase-7-ai-exchange-import`;
- no PR was created;
- `main` was not changed;
- Vercel Preview and Production were not changed or claimed current;
- unrelated `.tmp-*`, historical `docs/qa/*.png`, `supabase/.temp/`, and `test-results/` remain excluded.

## Remaining Release Gate

1. Review and merge the published feature branch only when requested.
2. Do not modify Production or deploy Vercel without explicit approval.

## Four-field Location Follow-up

The later 2026-08-24 product decision removed `address` from the portable JSON contract because the app has no address-domain field. AI v1, Formal v1, the blank template, prompts, fixtures, and all new exports now use exactly `name`, `map_url`, `latitude`, and `longitude`. Existing database/RPC payload shape is unchanged and receives `address: null`. Legacy AI/Formal JSON containing `address` remains readable; the compatibility pass removes it before strict validation while unrelated unknown fields still block.

Follow-up verification passed 35/35 focused contract/UI tests, 320/320 full Playwright tests, Production build, and `git diff --check`. Authenticated local browser QA confirmed a live exported AI location has only the four canonical keys and that a copy with legacy `address` reaches the import preview without Places, map preview, or candidate confirmation. The final import action was not used.
