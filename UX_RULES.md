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

Do not:

- Make Timeline feel like a CRUD table.
- Keep add/edit forms always visible if formal UI uses card actions.
- Hide the next stop behind too many taps.
- Overload cards with every field by default.

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
