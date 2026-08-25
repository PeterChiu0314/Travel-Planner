# Timeline Phase 7.5-7.9 | AI Itinerary Exchange, Planning, and Import Closeout

Status: Implemented, verified, committed, and pushed on `codex/timeline-phase-7-ai-exchange-import`; merge and deployment pending
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
  -> strict paste/file parser
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

AI import is local and direct. It does not call Google Places, load Google Maps, request Wikimedia content, render a map preview, or ask the user to resolve candidates. Valid coordinates are preserved into Formal v1. Missing or unusable coordinates remain `null`, do not block confirmation, and display the existing yellow warning `尚有 X 個目的地缺少可用座標`.

The compatibility pass still accepts earlier AI v1 locations by removing legacy `address`, `area`, and `search_hint`, then adding null `map_url/latitude/longitude` where needed. Earlier `location: null` becomes the same four-field empty object. Formal v1 import likewise accepts and ignores legacy `address`. Unknown fields remain blocking. The database/RPC `address` slot remains unchanged and receives `null`; no migration is required.

## User Experience

An existing Formal Trip's More Actions menu now includes `給 AI 調整`. This path provides:

- vendor-neutral instructions for the external AI;
- copy instructions plus JSON;
- copy JSON only;
- JSON download;
- direct transition to paste import.

New Trip now includes `AI 規劃`. Its Dialog uses the short instruction `下載模板，交給 AI 規劃後貼回。` and provides only:

- `下載模板 JSON`, which downloads `travel-studio-ai-itinerary-template-v1.json`;
- `複製給 AI 的提示詞`;
- `貼上 AI 回覆`.

Create mode intentionally renders no JSON textarea, no blank-template JSON text, and no copy-JSON action. The blank file contains the contract skeleton but no UUID, ownership, Place ID, address, or other internal data. Its location skeleton contains the same four Formal fields with null values. It intentionally fails validation until an AI fills the required Trip, Day, and visit values. The vendor-neutral prompt tells the AI to ask for missing requirements and, once enough information exists, return exactly one complete JSON object, provide accurate location coordinates when available, and use null when unavailable.

The prompt also requires the final response as a directly downloadable `.json` file rather than a Google/online document or message-only JSON. It preserves the template's exact English keys, enumerates visit and transport categories, names the exact schedule/transport fields, and requires explicit schedules to include intervening transport duration.

Before strict validation, one bounded compatibility pass handles common external-AI deviations:

- `schedule.start_time/end_time` -> `schedule.start/end`;
- visit `dining/accommodation` -> `food/hotel`;
- transport `mode` -> `category`;
- missing transport name -> established transport-category label;
- missing `duration_minutes` -> an explicit bounded `N 分鐘` or `N minutes` value in transport notes.
- an entire Day whose transport refs are unambiguously within 0-based bounds and include `0` -> all refs shift to 1-based together.

Conflicting canonical and alias fields are not overwritten, mixed or out-of-range transport numbering remains invalid, arbitrary fields are not removed, unknown fields still block, and explicit Timeline overlaps still block rather than being silently rescheduled. The prompt now says explicitly that the first visit-to-second visit pair is `1→2` and zero is forbidden.

The paste step is primary and `.json` selection is secondary. Parsing accepts strict raw JSON, exactly one Markdown JSON fence, or one unambiguous balanced object with small text wrappers. It intentionally does not repair malformed JSON. Both modes import as a new Trip; the `給 AI 調整` path explicitly states that the source Trip remains unchanged.

Blocking parser/contract/persistence errors render the compact red state with no Map, counts, or confirm action. Valid and warning states show a local count summary without the graphical map board. Missing coordinates remain a non-blocking yellow warning. Supabase error strings, normal error objects, and thrown errors are normalized before rendering.

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

Coverage includes strict/fenced/wrapped parsing, malformed/ambiguous JSON, type/version separation, unknown and required fields, Day/date/time/Fixed invariants, duration scheduling, exact `24:00`, alternatives, transports, multiple Days, Formal conversion, semantic round trip, unique/multiple/not-found/error Place states, re-search/candidate selection, partial batch failure, `0,0` rejection, explicit text-only handling, compact Error UI, unresolved gating, RPC object-error rendering, exchange copy/download, Demo isolation, and mobile overflow.

Manual fixtures:

- `tests/fixtures/manual/phase-7-ai-valid-complete.json`
- `tests/fixtures/manual/phase-7-ai-blocking-error.json`

Rendered evidence in the untracked `test-results/` directory covers desktop exchange, compact desktop Error, missing-coordinate warning, coordinate-ready import, RPC Error, and 390x844 mobile preview. The AI import checks assert no Places request, map preview, or candidate panel. These artifacts must remain untracked.

## Phase 7.9 Browser Verification

Authenticated local Staging browser QA verified:

- New Trip shows `AI 規劃` and the exact short instruction;
- Create mode has `下載模板 JSON`, `複製給 AI 的提示詞`, and `貼上 AI 回覆`, with no JSON textarea or copy-JSON control;
- the download and copy actions report successful states;
- an existing Trip's More Actions menu shows `給 AI 調整` and explains that import creates a new Trip while the source Trip stays unchanged;
- desktop and 390x844 mobile layouts have no horizontal overflow;
- browser console contains no application errors or warnings.

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
