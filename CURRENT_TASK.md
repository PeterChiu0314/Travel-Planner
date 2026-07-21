# CURRENT_TASK.md

This file is the live project ledger. Keep it concise and aligned with the real branch, deployed behavior, production migration state, and next requested phase.

Historical Phase 4 through Phase 5.7c detail is preserved in:

- `docs/archive/Timeline_Phase5/2026-07-12-current-task-through-phase-5-7c.md`

Do not copy completed phase-by-phase logs back into this file. Add a closeout link and a short verified summary instead.

## Start Here

Read these current sources before implementation:

1. `AGENT.md`
2. `docs/UX_RULES.md`
3. `docs/BUGS.md`
4. This file
5. The handoff or plan for the explicitly requested phase

Relevant latest closeouts and plans:

- `docs/2026-07-19-phase-5-9-itinerary-editor-ui-handoff.md`
- `docs/2026-07-12-phase-5-7d-remote-route-node-visual-plan.md`
- `docs/2026-07-11-phase-5-7c-node-collaboration-handoff.md`
- `docs/2026-07-05-phase-5-6-places-closeout-handoff.md`
- `docs/todo/phase-5-map-route-workspace-integration-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v14.md`

Archive rules:

- `docs/archive/` contains historical discussions, superseded handoffs, snapshots, and old drafts.
- Do not read archived files by default; consult them only when older context is specifically required.
- `docs/gpt/` is historical and must not be recreated.
- `docs/todo/2026-07-09-phase-5-7c-collaborative-route-edit-plan.md` has encoding damage and superseded architecture; do not use it as an implementation source.

## Current Status

```text
Current phase: Dayboard add-itinerary Map location flow (second stage)
Status: Implemented; focused automated verification and production build passed
Branch: codex/timeline-phase-5-9
Phase 5.7c closeout commit: 23247de Close Timeline Phase 5.7c
Phase 5.7d implementation commit: 5f71256 Unify remote collaborator colors
Latest Phase 5.9 implementation: current branch HEAD
```

Phase 5.7c synchronization, Phase 5.7d remote-drag visuals, and the published Phase 5.8 UI baseline remain protected. Phase 5.9 continues UI-only itinerary-editor work and must not change their collaboration or persistence behavior.

## Current Map Search URL State

- The Google Map search field accepts normal Places text or a recognizable Google Maps coordinate URL; normal text keeps the existing autocomplete, IME, debounce, session-token, location-bias, suggestion, and POI flows.
- Coordinate URLs reuse `resolveDestinationMapUrlPoint` and its existing parser; supported Google Maps short URLs use the existing `resolveGoogleMapsShortUrl` Edge Function before moving the Map and opening the pending preview with `加入行程`. Neither path calls Autocomplete, Place Details, Text Search, or Geocoding.
- URL-created visits keep latitude, longitude, and the effective Map URL (expanded for short links) with an empty place ID, then open the existing new-item editor and remain appended by the existing ordering flow.
- Invalid recognizable URLs preserve the input and any prior valid pending preview while showing a search-area error.
- The short-link extension has not been run through automated or production-build verification in this slice; user manual QA is pending.
- The itinerary editor's location section now stays open through URL resolution and other point updates until the user explicitly toggles it closed. A valid edited-card draft point is also previewed immediately in the existing Map marker before Save, without mutating the stored itinerary item.

## Current Dayboard Add Location State

- Formal Dayboard `＋新增行程` now enters an explicit Map add-location mode instead of opening an empty visit editor. If the Map is collapsed, it is reopened and mode activation waits for the real reveal animation to finish; the Google provider then waits for a positive container size, triggers the existing Map resize path, and focuses the Places/URL search field without a guessed timeout.
- Places, Google Maps URL, POI, and custom map-point choices retain the existing pending preview and `加入行程` confirmation, then share the existing point-backed `openNewItem(point)` draft flow at the end of the active Day. Custom points now preview before confirmation only in `map-add`; existing-editor point adjustment remains immediate.
- Cancel, Escape, outside-overlay click, Day/trip/section change, and mode exit clear pending markers, preview/search/URL state, and custom-point picking without opening an editor. An automatically reopened Map stays open.
- New and existing visit editors share the same collapsed `更改地點` / `Maps` section, including point adjustment, Places replacement, and Google Maps URL input. Demo remains static-only and keeps its existing local add behavior.
- Places-backed new visits normalize the selected point to a coordinate Google Maps URL before opening the editor, so Save can validate and persist the draft; pasted Google Maps URLs still preserve their effective URL. New-card URL validation errors display under the shared location section.
- While Map add-location mode is active, the search field keeps keyboard focus and the adjacent add-point button shares the active visual state. The route-edit control continues to act as the mode Cancel button.
- Custom Map-point picking in add-location mode now opens the new visit editor immediately with its latitude, longitude, and coordinate Maps URL, matching the original direct-pick behavior. The unsaved new visit is appended only as a provider-facing draft marker preview, so its marker updates immediately without creating an itinerary record before Save.
- Map add-location and custom-point picking now reuse the route-edit overlay boundary, including the 6 px Map inset, so the page and Map top edge are consistently masked. Collapsing the Map explicitly cancels pending/active add-location state before the close transition.
- The custom-point tool now precedes route edit / add-location Cancel. During add-location, the search control and custom-point icon/border use the accent token and the custom-point icon remains stable regardless of search text. In normal Map search, text or a URL changes that tool to an X that clears pending search/URL state. Active route edit also replaces its Route icon with an X while preserving click-to-exit behavior.

## Phase 5.9 Current UI State

- The visit editor now uses compact type/destination and linked start/end/duration rows. Start/end are custom 24-hour segmented fields: hours and minutes are independently focusable, typeable, arrow/wheel adjustable, and paired with a scrollable 288-option five-minute menu instead of the browser-native datalist.
- The type/destination and start/end/duration controls use a compact 36 px height. Visit notes start at two lines with reduced padding and auto-grow to approximately five lines before scrolling internally.
- The point section is collapsed by default with `更改地點` on the left and an always-visible `Maps` external link on the right. Expanding reveals Adjust Point, Search/Replace, and the full-width Google Maps URL input; blur or Enter applies the URL without a separate Apply button.
- New and existing visit cards now share the same visible mode heading: `新增行程` for new drafts and `編輯行程` for stored visits. Search/Replace and Maps controls use transparent backgrounds while retaining their borders and interaction behavior.
- The standalone new-visit editor now also inherits the existing Timeline editor's transparent field/control surfaces and zero form bottom margin, removing the visual mismatch caused by its placement outside the `.timeline` wrapper.
- Visit editor fields now use one shared semantic `fieldset` / `legend` outlined-label component for Type, Destination, Start, End, Duration, Note, and expanded Map URL. Labels are always fixed in the border gap with a 1 px upward optical adjustment, without movement animation or a hard-coded white backing; focus, disabled, native validation, and Map URL error states preserve field geometry.
- Visit editor mode headings now use weight 600, outlined labels use weight 400, and the expanded URL label reads `Google Maps URL`. Segmented time separators, dropdown chevrons, and inter-field connector lines are optically centered; Duration now shares the existing dropdown treatment, keeps manual/wheel input, and new visits default to one hour without changing stored visit durations.
- Visit editor time links use fixed 12 px grid tracks and sit 4 px below the field center. The segmented-time colon uses a 1.5 px upward optical correction.
- Visit time controls now opt out of the shared form-field horizontal padding: their control surface extends to the field edges, Duration keeps zero left padding, and each dropdown uses a centered 20 px toggle. Only the Google Maps URL legend receives the expanded anti-clipping line box; other outlined labels retain their existing geometry. The external location link now reads `Google Map` and uses a compact borderless link treatment.
- Visit-editor inputs, selects, and textareas use a consistent 14 px input font size.
- Existing Map point picking and Places search/preview flows are reused; point changes update only the active editor draft until Save.
- New visits still require a valid point. Existing legacy visits may edit unrelated fields when their unchanged point data is missing or invalid.
- Search/Replace masks non-Map UI, keeps Map/Places controls interactive, changes the preview confirmation to `更改地點`, and exits after applying the selected place to the draft.
- Full implementation and remaining manual QA notes are in `docs/2026-07-19-phase-5-9-itinerary-editor-ui-handoff.md`.

## Phase 5.8 Current UI State

- Formal shared UI colors now use the semantic palette from `design/DESIGN.md`: warm neutral page/surface/text/border tokens, deep-green `#325248` primary actions, and dedicated error/warning/success/info tokens. Compatibility aliases keep existing neutral consumers stable while Login, Sidebar, Header, shared buttons, forms, and status surfaces use the new semantic roles.
- Accent and destination categories use the revised palette: accent/attraction `#896C4D`, food `#DD7373`, transport `#68B3B6`, and hotel `#B871C6`, with paired fill/text tones. Static and Google Map route lines both use the shared accent token instead of primary or transport color.
- Timeline and Map destination categories now share the semantic attraction, food, hotel, transport, and note palettes for cards, numbered markers, marker fills, and marker text. Status and selection surfaces use the shared primary/error/warning/success/info roles; collaborator-owned colors remain unchanged. All existing liquid-glass transparency, fallback, border, blur, saturation, and transition contracts are unchanged.
- Sidebar section navigation labels use `letter-spacing: 0.04em`.
- The visible product name is `旅程工房` with the English subtitle `Travel Studio`; the browser tab reads `旅程工房｜Travel Studio`. The `我的旅程` heading uses 20 px / 500 weight, with the 13 px trip count aligned on the same baseline to its right. The create-trip and expanded-sidebar collapse controls are both 30 x 30 px.
- Day tabs use the primary color for hover and keyboard focus; the active tab keeps its original translucent white surface with a thin primary outline and a 2 px inset bottom accent. Sidebar navigation uses a subtle primary-tinted hover/focus surface without adding a border, and the active trip card uses an 8% primary tint over transparency.
- Neutral Timeline visit and transportation cards gain a thin primary hover border, a 1 px lift, and a restrained outer shadow. Existing focused, expanded, warning, dragging, and collaborator-owned states keep their established visuals, including the existing selected-card accent and all liquid-glass contracts.
- Numbered destination markers use the compact Phase 5.8 proportions, refined number colors and weight, and preserve focused styling on hover.
- The Map fills the Timeline workspace behind the Dayboard instead of starting at the Dayboard's right edge.
- The Dayboard covers the complete left workspace column with a liquid-glass surface: `rgba(238, 245, 239, .78)`, a light white border, `blur(10px) saturate(140%)`, and the opaque `.96` fallback when backdrop filtering is unavailable.
- Day tabs are visually integrated with the Dayboard when the Map is expanded, while retaining their existing horizontal drag/arrow behavior and normal collapsed-Map layout.
- The Dayboard and tabs align directly against the sidebar and share the same right boundary without a gap or mismatched blur strip.
- The Dayboard vertical scrollbar uses a transparent track, no arrow buttons, a 4 px softly muted thumb, and stable gutter. Expanded-panel padding is `0 6px 5px 10px`.
- The trip title and title-edit input use 24 px / 500 weight; header metadata uses 500 weight. The header uses the compact 68 px grid layout and translucent warm-white background.
- The desktop Timeline header is a non-shrinking flex item, and its 10 px lower shadow uses a stable gradient instead of sampling the Map/Dayboard through a second backdrop blur, so dense Dayboard content cannot visually erode the header edge.
- Route-edit masking begins at the Dayboard's right edge, the workspace fills the viewport bottom without a gap, and destination markers remain fully opaque while editing.
- The Map search control is 38 px high with a 10 px liquid-glass radius. Route-edit and add-point buttons sit to its right.
- The member control is 38 px high. Its avatar stack grows left as members increase, while the divider and invite icon stay anchored at the right edge in the order `avatars | invite`.
- Share, More, and Map-collapse controls are consistently 38 x 38 px. The Map-collapse control uses the liquid-glass tokens and shows Lucide `PanelRightClose` while the Map is open, then the existing Map icon while collapsed.
- The current Map liquid-glass tokens use `rgba(255, 255, 255, .4)` for the supported surface, `rgba(255, 255, 255, .55)` for the border, `rgba(20, 55, 46, .92)` for fallback, `blur(8px)`, and `saturate(140%)`. The Dayboard background and border reference the same shared tokens in both fallback and supported states.
- Timeline visit cards, transportation cards, collapsed-day preview cards, Day tabs, the add-itinerary button, and Dayboard editing forms use a translucent solid surface (`rgba(255, 255, 255, .85)`) without `backdrop-filter`.
- Timeline delete, transportation-delete, and move confirmation dialogs render through a body-level portal so their original full-viewport dimmer and centered white dialog are preserved above the glass Dayboard and Map.
- Missing-coordinate and route-edit status overlays are centered within the Map area that remains visible to the right of the Dayboard.
- The Map search control, route-edit button, and custom-point button use the Phase 5.8 liquid-glass tokens, including a deep-green fallback, translucent supported surface, white border, 8 px blur, 140% saturation, and reduced-motion-safe interaction states.
- Places suggestions align exactly with the search-field column rather than extending under the Map tool buttons, and reuse the search control's liquid-glass background, border, blur, saturation, radius, and fallback tokens.
- Starting custom-point picking keeps the search field and Map tool row in place. The search input and search action become disabled while the custom-point button retains its original position and switches to its cancel state.
- Timeline visit-to-visit, visit-to-transport, and transport-to-visit spacing is consistently 4 px. Empty transport insertion zones keep a 4 px resting layout but extend their transparent hit target 4 px into both adjacent cards, producing a practical 12 px trigger band without changing the compact gap. Hover/focus expands the card gap and control to 22 px while rendering an 18 px full-card-width translucent deep-gray ghost surface with 2 px clearance from each adjacent card and no border or shadow. The 13 px Lucide Plus and 500-weight label align with the visit time column, the trailing line ends 20 px from the card's right edge, and its center sits 1 px below the geometric center for optical alignment.
- Visit and transportation editor cards remove the legacy 16 px form bottom margin inside the Timeline, so their lower edge keeps the same 4 px spacing as normal cards. The standalone add-destination editor also starts 4 px below the preceding card.
- Timeline visit and transportation editor inputs, selects, textareas, cancel controls, and map-point/navigation controls use transparent backgrounds so the editor card's existing translucent white surface remains the only fill layer. Primary save actions keep their established background.
- Timeline visit-card and transportation-card mini controls use transparent backgrounds so their cards remain the only translucent white fill layer. Transportation navigation icons use 14 x 14 px sizing with a 1.5 px stroke.
- The create-trip dialog stores destination country and city in two equal-width fields on one row, using the existing structured trip destination columns and compatible combined destination label. The Header destination editor no longer advertises unimplemented Map-based first-day auto-fill.
- The expanded desktop sidebar uses the labels `旅程總覽`, `行程路線`, `預算管理`, `住宿資訊`, `待辦指南`, `行李清單`, and `分帳結算`. Navigation labels use 500 weight and share the same horizontal start as the `旅程規劃室` brand heading in both regular and compact-height desktop layouts. Icon padding and label gap are separated so each navigation icon remains centered under the TP logo; collapsed icon alignment is unchanged.
- Transportation cards use a 1 px border, 4 px vertical padding, and 13 px title. Transportation categories now render aligned Lucide icons instead of emoji in cards, editors, and collapsed-day previews.
- The Google logo remains visible immediately to the right of the Dayboard.
- Formal Timeline and Demo stay visually aligned where the same controls exist; existing cards, map-marker behavior, scrolling, editing, and collapse behavior remain intact.
- Timeline visit and transportation cards use staged direct-click interaction: the first Dayboard click focuses without expanding, a second click on the focused card toggles expansion, and clicking a different card focuses it while collapsing the previous card. Marker focus changes collapse any previously expanded card before focusing and scrolling to the new destination. Switching to a different Day clears both focus and expansion so returning to the original Day starts with neutral cards.

## Phase 5.8 Scope Guard

- Keep Phase 5.8 UI-only unless the user explicitly expands scope.
- Do not change Broadcast, ownership, Presence, Realtime, route persistence, database, migration, RLS, RPC, Share/Invite, Auth, Budget, or itinerary write behavior.
- Preserve Map search, route editing, custom-point creation, Dayboard scrolling, Day-tab navigation, and collapsed-Map operation while polishing layout and styling.
- Continue small requested polish from the latest published implementation baseline instead of treating Phase 5.8 as a single large redesign.

## Phase 5.7c Final State

- Same-day itinerary editing remains available while route editing is active; there is no same-day readonly lock and no 15-second idle exit.
- A custom route node is the synchronization and persistence unit.
- Presence carries low-frequency editor state with a 32-second heartbeat and user-deduplicated labels.
- Broadcast carries node add, delete, drag ownership, move preview, and final events; drag moves are latest-wins at 120 ms.
- PostgreSQL persists nodes independently in `itinerary_route_override_nodes`; `itinerary_route_overrides` remains the segment container.
- Pending commits are scoped by `segmentKey + nodeId`.
- Ownership-start and position/final events use separate bounded receipt slots so React batching cannot erase a handoff edge.
- Preview-only deletes always issue an idempotent database DELETE.
- Failed deletes restore the authoritative pre-delete node rows and emit inverse `node-add` collaboration events.
- Authoritative itinerary changes invalidate only affected route segments; unchanged adjacencies retain their nodes.
- Route-table Realtime changes use full replica identity and publication membership.
- Database rows are authoritative after drag-end; active-drag Broadcast remains best effort.

## Verification

Latest Map search URL verification:

- `npm.cmd run test:e2e -- tests/googlePlacesAutocomplete.spec.js tests/mapPoint.spec.js --reporter=line` passed 25/25, including normal autocomplete, coordinate URL recognition, URL request guards, invalid-state guards, and existing Places preview/POI behavior.
- `npm.cmd run build` passed; the existing Vite large-chunk warning remains informational.
- `git diff --check` passed; Windows line-ending notices remain informational.

Latest Dayboard add-location verification:

- `npm.cmd run test:e2e -- tests/googlePlacesAutocomplete.spec.js tests/mapPoint.spec.js --reporter=line` passed 28/28, covering existing Places/URL parsing and request guards plus Dayboard mode entry, reveal/resize/focus gating, cancellation cleanup, custom-point confirmation, and hidden new-draft Map URL wiring.
- `npm.cmd run test:e2e -- tests/phase-1-7f-smoke.spec.js --reporter=line` passed 30/30 after preserving the Static-only Demo add flow and updating its helper to collapse the point section only through an explicit user click.
- `npm.cmd run build` passed; the existing Vite large-chunk warning remains informational.
- `git diff --check` passed; Windows line-ending notices remain informational.

Latest Phase 5.9 verification:

- `npm.cmd run build` passed; the existing Vite large-chunk warning remains informational.
- `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js` passed 40/40.
- `npm.cmd run test:e2e -- tests/phase-1-7f-smoke.spec.js` passed 31/31, including outlined-label rendering, Map URL error geometry, segmented-time behavior, disabled duration state, and narrow-card overflow coverage.
- `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js tests/phase-1-7f-smoke.spec.js --reporter=line` passed 71/71 after the time-control refinement, including exact one-hour Duration dropdown selection and linked End-time updates.
- `npm.cmd run build` passed after the time-control refinement.
- Chrome measured both time links at 12 px wide and +4 px from field center with zero time-row overflow and zero console errors before the later compact-toggle refinement. The focused Phase 5.9 editor smoke test and production build passed afterward.
- The focused Phase 5.9 editor smoke test passed after isolating time-field padding and centering the 20 px dropdown toggle. `mapProviderPrep` passed 40/40 for the scoped Google Map label/link changes, and `git diff --check` passed.
- The focused Phase 5.9 editor smoke test passed after restoring Duration's 4 px left padding, removing the Map point section's extra top padding, and replacing the outlined-field focus halo with the existing primary border/label treatment so the halo no longer crosses the legend. `git diff --check` passed.
- Chrome inspection found the shared form-input selector was overriding the segmented Hour/Minute zero-padding rule. The time-specific selector now wins without affecting other fields, while Duration uses independent 8 px padding; local Chrome computed both segmented paddings as `0px` and measured the Duration text/legend offset at exactly `0px`. `npm.cmd run build` and `git diff --check` passed.
- Browser QA confirmed the native legend border gaps, fixed label geometry through focus, zero horizontal overflow at the 360 px Dayboard card width, and zero console errors.
- The 1280 x 720 Phase 5.9 rendered smoke check confirmed compact same-row geometry, independent hour/minute input, minute `+5`, a multi-option custom time menu, `90 -> 1小時30分鐘`, linked end-time updates, collapsed URL input, and zero console errors.
- In-app Browser Demo QA at 624 x 800 confirmed the collapsed `更改地點` / `Maps` header and the expanded point-action row with a 36 px full-width URL input. The 486 px editor had no horizontal overflow, save actions remained visible, and console errors were zero.
- Authenticated Formal Google Maps visual comparison remains pending for the Search/Replace overlay and Places flow.

Latest Phase 5.8 verification:

- The preceding `#D98A3F` accent/category baseline and route-line mapping passed 57/57 focused checks across `designColorTokens`, `timelineMapMarkers`, and `mapProviderPrep`; the rendered Login token check reported zero console errors. The latest user-directed Accent/Attraction adjustment to `#896C4D` with fill `#EBE5DE` and text `#654E37` was intentionally published without automated or browser verification.
- Create-trip and Header destination forms passed focused in-app Browser QA: the create dialog rendered equal Country/City columns with preserved date selection, the Header editor retained its existing fields/actions without the unimplemented Map helper text, both source/implementation pairs were visually compared, and browser console errors were zero. `npm.cmd run build` and `git diff --check` passed.
- Visit-card and transportation-card mini controls passed focused in-app Browser QA: all visible card mini controls computed to transparent backgrounds, transportation navigation icons computed to approximately 14 x 14 px with a 1.5 px stroke, the source/implementation pair was visually compared, and browser console errors were zero. `npm.cmd run build` and `git diff --check` passed.
- Visit and transportation editor controls passed focused in-app Browser QA at 1280 x 720: inputs, selects, textareas, cancel controls, and map-point/navigation controls computed to transparent backgrounds, while primary save actions retained `#325248`. Both source/implementation pairs were visually compared, browser console errors were zero, and `npm.cmd run build` plus `git diff --check` passed.
- The active Day tab now matches the exact formal-preview treatment: a 1 px `#325248` outline, an 8% primary tint, and a 2 px inset bottom accent. In-app Browser computed-style and visual comparison passed with zero console errors; `npm.cmd run build` and `git diff --check` passed.
- Selective interaction and brand polish passed in-app Browser comparison at 1280 x 720: the four requested hover/focus families, updated brand hierarchy, relocated trip count, exact browser title, and zero console errors were confirmed. `npm.cmd run build` and `git diff --check` passed; the Vite large-chunk warning and Windows line-ending notices remain informational.
- Color-token steps 3-4 passed 65/65 focused Playwright checks, including Timeline/Map marker mapping, Map/provider source guards, rendered Login computed colors, zero browser console errors, and preserved liquid-glass contracts. `npm.cmd run build` and `git diff --check` passed; the Vite large-chunk warning remains informational.
- The formal color-token migration passed its rendered login check 4/4, including computed semantic colors, preserved Map glass tokens, and zero browser console errors. The combined design-token, Phase 1.8 source-guard, and Map/provider suites passed 50/50; the production build and `git diff --check` passed.
- The focused Phase 5.8 Timeline interaction smoke test passed 1/1: visit and transportation cards focus before expanding, marker changes collapse the previous expanded card, and Day changes clear focus plus expansion. `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js` also passed 39/39, and the production build passed.
- In-app Browser computed measurements confirmed 3.99 px gaps for visit-to-visit, visit-to-transport, and transport-to-visit sequences; the expanded Dayboard padding is `0px 6px 5px 10px`.
- Transportation-card computed styles confirmed a 1 px border, 4 px vertical padding, 13 px title, and an 18 px Lucide category icon. The transport-insert zone preserves a 4 px resting card gap, triggers from 3 px inside both adjacent card edges, and expands to a centered 22 px gap. Its 18 px full-width ghost surface uses `rgba(36, 43, 38, .06)` without border or shadow and leaves 2 px above and below; the 13 px Plus begins within 4 px of the visit time text, while the trailing line ends at 20 px right padding and sits 1 px below the gap center.
- Phase 5.8 browser checks passed 6/6, including the adjacent-edge trigger, centered insertion row, ghost-card width, time-column alignment, and existing viewport/header/dialog contracts.
- `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js` passed 39/39 for the current spacing, insertion-zone, Dayboard-padding, and transport-icon contracts; source fixtures normalize CRLF/LF before CSS contract checks.
- In-app Browser verification confirmed the member, Share, More, and Map-collapse controls render at 38 px; the divider/invite area remains fixed at the member control's right edge with five displayed avatar entries.
- Map collapse/reopen interaction passed: the collapsed state renders `lucide-map`, reopening restores `lucide-panel-right-close`, and browser console errors remained at zero.
- The latest Places/search-control implementation passes `npm.cmd run build`. Authenticated branch-preview verification confirmed exact search/menu alignment, the shared translucent glass tokens, persistent disabled search controls during custom-point picking, unchanged point-button position, and no browser console errors.
- User verified that the Timeline header lower edge remains visually complete with a dense Dayboard after the non-shrinking header and stable-gradient shadow fix.
- User manually verified the visit-editor lower gap, transportation-editor lower gap, and add-destination editor upper gap; all three now match the normal 4 px Timeline card spacing and related interactions remain normal.
- Phase 5.8 filtered browser smoke checks passed 5/5, including stable header geometry after adding 24 Dayboard cards and a body-level Timeline confirmation dialog with a full-viewport fixed dimmer, centered white card, and preserved 8 px radius.
- The full legacy smoke suite was also attempted: its first eight checks passed, then three unrelated Demo tail-transport timing cases reached their existing 30-second timeout; no confirmation-dialog check failed.
- Phase 5.8 desktop, tablet, mobile, and trip-title edit Playwright checks passed 4/4 through `44fd4d3`.
- Focused Map/provider route-edit and workspace checks passed 2/2 through `44fd4d3`.
- Chrome DOM inspection confirmed the latest `lucide-tally-4` Map-collapse control at `6c9fadd`.
- Chrome rendered-style inspection confirmed 38 px search/tool controls, the requested liquid-glass computed styles, and 0 px horizontal-center error for both Map status overlays.
- `npm.cmd run build` passed at `6c9fadd`.
- `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js` passed 38/38 for the latest Map polish.
- `npm.cmd run build` and `git diff --check` passed for the latest Map polish.
- After the shared-token update, `npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js` passed 38/38 and `git diff --check` passed.
- `git diff --check` passed for the latest implementation change.
- The Vite large-chunk warning remains informational and was present in successful builds.

Closed Phase 5.7c deployed Chrome two-client QA passed:

- node add/delete, final-node delete, preview-only delete, and normal-delete refresh convergence;
- delete immediately after drag-end without handle restoration or return-to-origin behavior;
- failed DELETE rollback after four blocked REST attempts over 25 seconds;
- concurrent adds through the five-node limit;
- simultaneous different-node dragging;
- A-to-B-to-A same-node ownership handoff;
- B taking P1 and immediately dragging P2;
- identical live and refreshed node positions/order;
- same-account editor-label deduplication;
- 319-second background recovery and synchronized first drag after foregrounding;
- endpoint-coordinate, reorder, and reversible destination-delete invalidation;
- preservation of nodes on unaffected adjacencies;
- cleanup of temporary QA destination and route nodes.

Latest automated verification:

```text
npm.cmd run test:e2e -- tests/mapProviderPrep.spec.js: 36/36 passed
npm.cmd run build: passed
git diff --check: passed (Windows LF/CRLF notices only)
```

Phase 5.7d manual verification:

- User-confirmed two-client Chrome QA passed for consistent remote user color across the avatar border, Timeline drag visuals, and route-node outline/glow.
- Local dragging remains unchanged; no name label was added.
- No automated tests were run for the final color-source alignment fix; the user performed the requested manual verification.

## Production Migration State

Production Supabase project:

```text
lqvuqamzmchepgxkftcw
```

Applied immutable migrations relevant to current Timeline behavior:

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

Current state:

- No pending production migration.
- Local and remote migration history were verified aligned through `20260712033758`.
- `itinerary_route_overrides` and `itinerary_route_override_nodes` use `REPLICA IDENTITY FULL` and belong to `supabase_realtime`.
- Never edit an applied migration in place; use a new timestamped migration for future schema, RLS, RPC, permission, replica-identity, or publication changes.

## Durable Scope Guards

Preserve the following unless a future phase explicitly changes them:

- Do not restore same-day route-edit locking or a 15-second idle exit.
- Do not return to segment-snapshot Broadcast or whole-`points_json` multiplayer writes.
- Do not synchronize map pan/zoom, cursors, Timeline scroll, or remote DragOverlay as part of route-node collaboration.
- Do not add Routes/Directions travel-time queries, Google route polylines, route cache, or automatic transportation creation without explicit scope.
- Demo remains unauthenticated, static-map-only, and disconnected from Supabase/Auth/Realtime.
- Only `item_type === "transport"` identifies a transportation card; transportation-like destination categories remain destinations with coordinates, markers, sequence numbers, and route participation.
- Places keeps its minimal field mask: `id`, `displayName`, `location`, and `googleMapsUri`.
- Save remains the only itinerary write for Places/editor flows; route-node override autosave is the scoped exception.
- Preserve existing Phase 4 reorder RPC behavior, fixed-anchor rules, transportation pair contracts, draft autosave, edit locks, Auth, Share/Invite, and Budget flows.

## Known Residual Risks

- Realtime Broadcast is best effort during active drag; authoritative database reload is the convergence fallback after drag-end.
- `BUG-025` remains Low Priority: foreign Timeline drag presence can occasionally clear by its 12-second stale timeout instead of the immediate clear event.
- Active forms must continue to resist Realtime/refetch replacement.
- Legacy rows with only one time remain safely treated as untimed until an explicit save normalizes them.
- Existing native HTML drag accessibility limitations remain outside the completed route-collaboration scope.
- Timeline drag animation remains browser/timing-sensitive; future polish should use dnd-kit configuration rather than delaying authoritative writes.

See `docs/BUGS.md` and the archived ledger for older phase-specific risks.

## Working Tree Hygiene

- `supabase/.temp/` and `test-results/` are recurring local artifacts and must remain untracked unless explicitly requested.
- Preserve unrelated user changes in a dirty working tree.
- When publishing a phase, include its current tracker and closeout/handoff documentation in the same verified change set.

## Next Step

Perform authenticated Formal Google Maps manual QA for the Dayboard add-location flow with the Map both expanded and collapsed, including Places, Google Maps URL, custom point, confirmation, and cancellation. Preserve the closed Phase 5.7c synchronization, Phase 5.7d visual-feedback behavior, Phase 5.8 UI baseline, and existing-editor Phase 5.9 point workflow.
