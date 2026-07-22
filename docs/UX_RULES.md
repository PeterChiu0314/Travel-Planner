# UX_RULES.md

This product is a collaborative travel planner. UX decisions should serve real travel behavior, not generic SaaS patterns.

## Product Philosophy

- Desktop = planning.
- Mobile = travel companion.
- Travel-first UX beats dashboard-first UX.

The product should feel calm, practical, and ready for use before and during a trip.

Do not make it feel like:

- Generic SaaS.
- ERP.
- Accounting software.
- Admin backend.
- Marketing landing page.

## Travel Reality

Users will use this while:

- Walking.
- Riding transit.
- Switching between map, chat, browser, and this app.
- Checking plans with one hand.
- Editing quickly before moving again.
- Returning after the browser/app was backgrounded.

Therefore:

- Quick readability matters.
- Editing safety matters.
- One-hand mobile UX matters.
- Important information must survive app switching.
- Users should not feel that the page refreshed or lost their place.

## Desktop UX Rules

Desktop is for planning and review.

Do:

- Allow higher information density than mobile.
- Use sidebar navigation.
- Keep timeline, route/map context, and budget context visible where useful.
- Support scanning, comparison, and repeated edits.
- Use structured panels, cards, and clear headings.

Do not:

- Make it feel like an enterprise dashboard.
- Overuse tables for travel content.
- Hide core planning actions behind complex menus.
- Add decorative hero sections inside the app workspace.
- Add analytics-style widgets that do not help planning.

## Mobile UX Rules

Mobile is for travel companion mode.

Do:

- Prioritize Today mode.
- Keep bottom navigation simple.
- Minimize taps for common travel actions.
- Make controls thumb-friendly.
- Show essentials first, details second.
- Prefer cards and expandable sections over dense grids.
- Keep text readable outdoors and in motion.

Do not:

- Shrink desktop tables onto mobile.
- Require precise tapping for common actions.
- Show too many panels at once.
- Force users through modal chains.
- Put primary travel info below low-value controls.

Mobile should prioritize viewing and quick actions, not full planning.

## Timeline UX Rules

Timeline is the core planning flow.

Do:

- Use card-based readability.
- Sort naturally by date and time.
- Show time, title, place, transport note, and budget summary clearly.
- Let details expand from the card.
- Keep map links easy to open.
- Keep route/map context available on desktop.
- Treat transportation-category places such as airports, stations, parking lots, rental-car points, and ports as destinations when they are visit cards: they should keep markers, route-line participation, and destination sequence numbers when they have valid coordinates.
- For Timeline drag reorder, keep drag activation on an intentional handle such as the time block instead of the whole card, so normal card click/edit interactions stay predictable.
- Keep local drag previews constrained to the active Day Board flow. The floating overlay should move vertically within the list/card area and should not cover the date header or neighboring day boards.
- Keep transportation cards visually attached to their semantic visit pair during drag preview, but do not make transportation cards themselves draggable.
- For collaborative drag presence, keep the remote signal quiet: show who is dragging, show a muted insertion line when available, and disable same-day destination drag handles only while the foreign drag is active.
- Treat collaborative drag presence as a soft coordination hint, not as official order state.
- Keep the visit editor compact: type and destination share one row; start, end, and duration share one linked row; notes start at two lines and grow only as needed.
- Keep visit time input on a 24-hour, five-minute system. Hours and minutes must be independently focusable and adjustable by typing, arrow keys, and wheel; provide a custom scrollable menu with multiple visible time options rather than relying on browser-native `datalist` UI, and do not add plus/minus controls.
- Keep the first two visit-editor control rows at the compact 36 px height, and let notes start at two lines with restrained padding before auto-growing.
- Preserve the existing start/end/duration linkage and existing overlap, transportation-pair, and auto-continuation rules when changing the editor UI.

Do not:

- Make Timeline feel like a CRUD table.
- Keep add/edit forms always visible if formal UI uses card actions.
- Hide the next stop behind too many taps.
- Overload cards with every field by default.
- Let drag preview behavior write formal ordering data before drop.
- Let a whole visit card become a drag handle if that interferes with expand, edit, delete, lock, or link interactions.
- Render remote drag overlays, ghost cards, or remote preview reordering from presence/broadcast data.
- Let collaborative drag presence replace reorder RPC validation or merge multiple users' local previews.

## Timeline Workspace UX Rules

The desktop Timeline Workspace combines Day navigation, Day Boards, and route/map context. Its layout should stay stable while the map opens and closes.

Do:

- Keep Day Tabs outside the Header while visually aligning them directly below it.
- When the map is expanded, limit Day Tabs to the Day Board column and let the map surface own the full right side from the top of the workspace.
- When the map is collapsed, let Day Tabs and the multi-day Day Board use the full workspace width.
- Keep the map toggle in a stable workspace-relative position; tab count and tab scrolling must not move it off screen.
- Give Timeline scroll ownership to the inner Day Board. Avoid competing page, workspace, and panel scrollbars.
- Keep Day Tabs clickable and draggable. Dragging must not accidentally switch days.
- Use real transparency masks for overflowing Day Tabs; do not simulate fading by painting over tabs with guessed background colors.
- Hide an edge hint when its corresponding scroll direction is no longer available.
- Keep selected Day Boards slightly inset after automatic horizontal positioning so edge controls do not cover card content.
- Keep Map-expanded and Map-collapsed visit cards on the same typography, spacing, and action-control system.
- Let expanded visit details use the card width below the divider without changing the compact information layout above it.
- In expanded visit details, use compact unframed metadata rows. Linked budget uses `Wallet` + heading, a thin divider, and a content-width pale-green tag that stays on the same row when space permits and wraps as one content group when constrained. Existing alternatives use a 400-weight `Files` + heading followed by a divider and 400-weight plain read-only summary that wrap together when constrained, while reserving the lower-right flip-control area. Keep expanded note copy at regular weight.
- Use familiar Lucide icons for lock, edit, delete, add, map, route, and directional actions, with accessible labels or tooltips.
- Treat the future map area as a full workspace surface, not as a decorative nested card.
- Use Timeline-specific selectors for layout overrides instead of changing global `.panel` or `.content-grid` behavior.
- Keep Formal Timeline and `/demo/timeline` on shared components and shared Timeline CSS.

Do not:

- Put Day Tabs inside the Header merely to achieve visual continuity.
- Let Map-expanded and Map-collapsed modes drift into separate card designs.
- Add background-colored edge overlays that only match one workspace state.
- Let navigation buttons cover visible scrollbars or important card content.
- Create Demo-only workspace wrappers or grid rules that hide Formal layout regressions.
- Introduce Google Map, route calculation, new sorting semantics, or transportation insertion behavior as part of layout-only polish.

## Timeline Map / Places UX Rules

Formal Google map search should help users add real places without making the map feel like an accidental write surface.

Do:

- Keep Places search as a Formal Google map feature; Demo should stay static unless explicitly redesigned.
- Keep Autocomplete suggestions biased toward the current map viewport when available, but treat this as a soft ranking hint.
- Let users pan/zoom the map without triggering search requests by itself.
- Use marker-anchored overlays for selected Places preview and pending POI confirmation so dialogs feel connected to the map location.
- Require an explicit Add to itinerary action before opening the Timeline add editor.
- Keep the editor prefill parseable by the existing map URL validation, using `https://www.google.com/maps?q={lat},{lng}` for Places-derived coordinates.
- Preserve user input on failed Place Details fetches so the user can adjust the search.
- Show editor point status and actions without exposing place names, addresses, coordinates, or full Map URLs in the collapsed point section.
- Keep the point section collapsed by default. Its header uses a compact `更改地點` disclosure on the left and an always-available `Maps` external link on the right; expanding reveals the Adjust Point and Search/Replace actions plus the Google Maps URL input.
- Reuse the existing map-pick and Places search/preview lifecycles for Adjust Point and Search/Replace; keep their results in the active editor draft until Save.
- Apply a completed Google Maps URL on blur or Enter without a separate Apply button, collapse the point section after success, and keep it expanded with an inline parse error on failure.
- During Search/Replace, mask non-Map UI while keeping the Map, Places suggestions, preview, confirmation, and cancellation controls interactive.

Do not:

- Turn viewport bias into strict bounds or `locationRestriction` without an explicit product decision.
- Treat a POI click as consent to fetch details or open an editor; use a lightweight pending marker/hint confirmation first.
- Let Places preview markers, pending markers, or search overlays participate in itinerary markers, route lines, sequence numbering, Timeline focus/scroll, missing-coordinate counts, or database writes.
- Add rich Place Details fields, address autofill, Text Search, Nearby Search, Geocoding, Directions, Routes, Distance Matrix, route summaries, or automatic transportation creation as part of search UX polish.
- Write Supabase data before the user saves the existing Timeline editor.

## Transportation Card UX Rules

Transportation cards complete the travel flow between visit cards.

Do:

- Keep transportation cards visually smaller and quieter than visit cards.
- Render valid transportation cards only between their adjacent `from_item_id` / `to_item_id` visit pair.
- Treat only true transportation cards as transportation cards. A visit/destination whose category or type is transportation is still a destination, not the small connector card between visits.
- Keep invalid transportation cards visible in the Day warning area below the date header and above the first normal visit card.
- Use one shared lightweight warning pattern for transportation warnings.
- In collapsed state, keep warnings compact: small `⚠` icon or short warning text only.
- In expanded state, show the warning reason and available actions.
- For general warnings, allow confirm/edit/delete.
- For invalid pair warnings, allow expand/edit/delete, but do not show confirm because confirming cannot repair placement.
- Keep insert zones lightweight so they do not break Day Board card density.
- Keep Demo Timeline behavior aligned with the formal Timeline.

Do not:

- Hide invalid transportation cards silently.
- Force invalid transportation cards into the wrong gap.
- Use large alert panels, modals, toasts, or full-width error banners for transportation warnings.
- Add drag repositioning before Phase 3.4.
- Let transportation cards support alternatives or flip-card behavior; alternatives remain visit-only.

## Trip Date UX Rules

Trip dates affect Timeline visibility, share/export consistency, and potential data deletion.

Do:

- Treat trip date changes as a high-impact flow.
- Show a preview before changing dates.
- Require explicit confirmation before shortening deletes Timeline data.
- Keep Timeline item display dates aligned with `trip.start_date + day_index`.
- Remind users that Accommodation and Todo dates are not automatically changed.

Do not:

- Let normal date editing silently hide or delete Timeline data.
- Let Header Date Popover modify dates during settlement phase.
- Treat fixed visit cards as immune from confirmed trip shortening.
- Introduce a second normal date editing path outside the Header Date Popover.

## Settlement UX Rules

Settlement phase means the trip is effectively completed or archived for normal editing.

Do:

- Lock normal trip date editing during settlement phase.
- Lock invite and member approval actions during settlement phase.
- Keep readonly sharing available during settlement phase.
- Design a deliberate "reopen trip" flow if settled trips need normal editing in the future.

Do not:

- Use Header Date Popover to reopen or reschedule a settled trip.
- Block readonly sharing just because the trip is in settlement phase.
- Confuse share links with member invitations.

## Share UX Rules

Readonly sharing is for showing the trip, not collaborating on it.

Do:

- Keep share links as a single primary link in the UI.
- Let owners create, enable, disable, and copy share links.
- Let editors open the share dialog and copy an existing active link.
- Keep viewers out of the share dialog.
- Keep the public share page unauthenticated and readonly.
- Keep sensitive collaboration data out of Share View.

Do not:

- Expose Budget, Actual Expense, Settlement, Luggage, member private data, or private attachments in Share View unless the product explicitly redesigns sharing.
- Let editors create, enable, or disable share links.
- Treat a share link like a member invite.

## Budget UX Rules

Budget is for travel planning and group clarity, not accounting bureaucracy.

Do:

- Keep planned budget and actual expense visually distinct.
- Show category, amount, payer, split members, linked itinerary, and notes clearly.
- Make "convert to actual" understandable.
- Keep equal split simple.
- Use cards on mobile.

Do not:

- Make it feel like accountant software.
- Lead with ledger-like tables on mobile.
- Mix planned budget and actual paid expenses without clear labels.
- Add custom split UI before the base equal-split flow is stable.

## Luggage UX Rules

Luggage is a quick check tool.

Do:

- Separate personal luggage from team shared items.
- Keep personal and shared state flows separate.
- Make packed/unpacked state obvious.
- Support the shared item dual confirmation flow:
  - assignee packed
  - owner confirmed

Do not:

- Leak personal luggage to other members.
- Mix personal and shared form state.
- Make checking items require opening an editor.

## Demo UX Rules

Demo is a mock-data version of the formal UI.

Do:

- Keep Demo close to the formal app UI.
- Use mock data and React local state only.
- Show a clear Demo banner.
- Let testers/GPT inspect real interaction flows without login.

Do not:

- Build simplified CRUD pages that diverge from formal UI.
- Connect Demo to Supabase, Auth, Storage, Realtime, draft autosave, edit lock, or localStorage.
- Maintain a second unrelated UI for Demo.

## Developer Tool UX Rules

Developer tools exist for testing state transitions, not for normal user workflows.

Do:

- Keep Developer Date Tool owner-only.
- Use it to test planning, traveling, and settlement phase transitions.
- Allow it to override settlement phase date lock for testing.
- Keep it on the same safe data path as formal date changes.

Do not:

- Show Developer Date Tool in Demo by default.
- Let it bypass dirty draft guards, dangerous shortening confirmation, or transaction-backed RPC updates.
- Promote it as the main trip date editing UI.

## Editing UX Rules

Editing must feel safe.

Do:

- Preserve active form input during tab switch, app switch, refetch, session refresh, and Realtime reconnect.
- Save drafts silently.
- Close forms after successful save.
- Ask before discarding unsaved changes.
- Lock only the record being edited.

Do not:

- Reset forms because parent data refetched.
- Remount active editors unnecessarily.
- Let Realtime overwrite local editing state.
- Show conflict prompts during normal tab switching.
- Lock the whole site.

## UX Anti-Patterns

Avoid:

- ERP feeling.
- Popup hell.
- Always-visible create/edit forms where formal flow uses card actions.
- Dense mobile tables.
- Multi-step flows for tiny actions.
- Dashboard widgets that do not support travel decisions.
- Decorative animation before core usability.
- Generic SaaS layout language.
- Separate Demo UI that cannot catch formal UI regressions.
- Making mobile a shrunken desktop.

## Decision Rule

When choosing between two UX options:

1. Prefer the option that helps a traveler act quickly.
2. Prefer the option that prevents lost work.
3. Prefer the option that keeps collaboration clear.
4. Prefer the option that works on mobile first during the trip.
5. Prefer calm clarity over visual novelty.
