# AGENT.md

This file is the operating guide for future AI agents working on this travel planner. It is intentionally project-specific. Do not treat this as generic SaaS boilerplate.

## 1. Product Philosophy

This project is a collaborative travel planning tool. It is not a generic SaaS dashboard, not a pure recommendation site, not a pure expense app, and not a map-first product.

The product direction is travel-first UX:

- Desktop is for planning: denser layout, sidebar navigation, timeline + route context, budget review, accommodation management, member review, and owner settings.
- Mobile is for travel companion mode: quick access, bottom navigation, today view, next stop, budget glance, luggage checks, and minimal cognitive load while moving.
- The UI should feel calm, practical, and friendly. Avoid enterprise SaaS heaviness, marketing hero layouts, decorative dashboards, and overbuilt admin patterns.
- Stability matters more than novelty. The current priority is preserving login, collaboration, draft protection, and data permissions while improving MVP UX.

Current priorities:

- Stability and regression safety.
- UX polish on existing flows.
- Mobile travel mode.
- Demo consistency with the formal UI.
- Clear separation between production data flows and mock/demo flows.

Not current priorities:

- AI itinerary generation.
- LINE bot.
- OCR receipt parsing.
- Native app.
- Fancy animation.
- Google Docs-style live text collaboration.
- Deep Google Maps route APIs.

## 2. Tech Stack

Actual current stack:

- React 18.3.1.
- Vite 5.4.x.
- Plain JavaScript with JSX. There is no TypeScript in the repo right now.
- Plain CSS in `src/styles.css`. There is no Tailwind setup right now.
- Supabase JS client `@supabase/supabase-js` 2.45.x.
- Supabase Auth with Google OAuth.
- Supabase Postgres with RLS.
- Supabase Realtime through `postgres_changes`.
- Supabase Storage for attachments.
- Vercel for production deployment.
- Vercel SPA rewrites in `vercel.json`.
- A lightweight service worker in `public/sw.js` for shell/offline read behavior.

Important correction for future agents:

- Do not assume this is Next.js. It is currently a Vite SPA.
- Do not add TypeScript, Tailwind, Next.js App Router, or a component framework unless explicitly requested and migration scope is approved.
- Environment variables are Vite-style: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Never put a Supabase service role key in frontend code.
- Windows / PowerShell encoding, `npm.cmd`, and Vite dev server startup notes are documented in `DEV_SETUP_WINDOWS.md`.

Key files:

- `src/App.jsx`: main app container, route branching, most UI components, production data callbacks, demo containers.
- `src/styles.css`: all current styling.
- `src/lib/supabase.js`: Supabase client creation.
- `src/lib/draftAutosave.js`: local draft autosave utilities and hook.
- `src/lib/editLocks.js`: edit lock utilities.
- `supabase/migrations/*.sql`: schema, RLS, RPC, Storage, Realtime, edit-lock columns.
- `public/sw.js`: offline shell cache.
- `vercel.json`: SPA fallback for `/demo` routes.

## 3. Architecture

The app is currently a single-page React app. It does not use a router package. Routing is manual and based on `window.location`.

### Route Branches

Routing priority in `src/App.jsx`:

1. `/demo` and `/demo/*` enter `DemoApp` before Supabase Auth.
2. Missing Supabase config shows `ConfigMissing`.
3. `?share=` enters `ShareView` and uses `get_share_snapshot`.
4. Unready auth shows loading.
5. No session shows `LoginView`.
6. Authenticated users enter the formal app shell.

Protected rule:

- `/demo` must remain unauthenticated and must not call Supabase, Realtime, Storage, draft autosave, or edit lock.
- `?share=` must remain unauthenticated readonly.
- `/` must still require Google login unless using a valid share token or demo route.

### Container/View Pattern

The project has begun moving toward container/view separation, but it is not fully separated yet.

Formal production container responsibilities currently live mostly in `App`:

- Session/auth state.
- Trip list and active trip state.
- Supabase reads/writes.
- Realtime subscriptions.
- Invite/share dialogs.
- Attachments.
- Permission gates (`isOwner`, `canEdit`, pending member state).

View-ish components inside `src/App.jsx` include:

- `TripWorkspace`
- `TodayMode`
- `ItineraryTimeline`
- `RoutePanel`
- `BudgetSummaryPanel`
- `BudgetPanel`
- `ActualExpensePanel`
- `SettlementPanel`
- `AccommodationPanel`
- `TodoGuidePanel`
- `TodoPanel`
- `GuidePanel`
- `LuggagePanel`
- `PackList`
- `MembersPanel`
- `ShareView`

Demo-specific components/containers:

- `DemoApp`
- `DemoLuggageView`
- Demo mock data factories near the top of `src/App.jsx`.

Direction:

- Continue extracting reusable presentational views cautiously.
- Formal containers should own Supabase, Realtime, draft, lock, and Storage.
- Demo containers should own mock data and local state only.
- Avoid duplicating UI in demo pages. Demo should reuse or closely mirror formal UI, with data/callbacks swapped.

## 4. Data Flow

Formal app data flow:

1. `supabase.auth.getSession()` initializes `session`.
2. `loadTrips()` queries `trip_members` joined with `trips` for the current user.
3. `activeTripId` selects the current trip.
4. `loadTripData(activeTripId)` loads all trip-scoped records in parallel:
   - `itinerary_items`
   - `itinerary_alternatives`
   - `budget_items`
   - `budget_item_participants`
   - `actual_expenses`
   - `actual_expense_participants`
   - `accommodations`
   - `guide_items`
   - `todo_items`
   - `luggage_items`
   - `shared_luggage_items`
   - `attachments`
   - `itinerary_budget_items`
   - `pack_items`
   - `trip_members`
5. RLS filters what the user can see and mutate.
6. Local React state feeds view components.
7. Mutations call Supabase then reload trip data.
8. Realtime also reloads trip data when relevant tables change.

Offline read flow:

- `readOfflineTrips`, `writeOfflineTrips`, `readOfflineTripData`, and `writeOfflineTripData` cache previously loaded data in `localStorage`.
- If network/Supabase reads fail, cached data is used as readonly-ish fallback.
- `public/sw.js` caches the shell and same-origin GET assets. This is lightweight offline read, not offline edit sync.

## 5. Auth Flow

Google OAuth is the only intended login method right now.

Key behavior:

- `LoginView` receives `onSignIn`.
- `signInWithGoogle()` calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })`.
- `redirectTo` intentionally uses `origin`, not `href`, to avoid query string accumulation and redirect loops.
- `supabase.auth.onAuthStateChange` updates session and clears trip state on sign out.

Do not break:

- Google login.
- The unauthenticated Demo route.
- The unauthenticated Share route.
- Invite flow after OAuth redirect.

Invite flow:

- Owner creates a row in `trip_invites`.
- Invite URL is `?invite=<token>`.
- After login, `request_trip_membership` RPC is called.
- User becomes pending.
- Owner approves in members panel.

Only `request_trip_membership` should be directly callable from the frontend among membership helper RPCs. Do not call helper RPCs such as `can_read_trip`, `can_edit_trip`, `can_manage_trip`, `approved_trip_role`, `is_trip_owner`, `is_trip_member`, or `is_approved_trip_member` from frontend code.

## 6. Supabase Structure

Migrations are in `supabase/migrations`.

Important tables:

- `trips`: trip metadata. Has both `title` and `name` for compatibility. Status is `planning`, `traveling`, or `settled`.
- `trip_members`: membership, role, approval state. Roles: `owner`, `editor`, `viewer`.
- `trip_invites`: owner-generated invite tokens.
- `itinerary_items`: timeline cards, with map/location fields and edit locks.
- `itinerary_alternatives`: alternatives attached to one itinerary card.
- `budget_items`: planned budget records. Equal split implemented; custom split reserved.
- `budget_item_participants`: selected members for equal split.
- `itinerary_budget_items`: many-to-many timeline/budget links.
- `actual_expenses`: actual paid expenses.
- `actual_expense_participants`: selected members for actual expense split.
- `accommodations`: one accommodation per stay, not one row per night.
- `todo_items`: in-app todo items.
- `guide_items`: reference guide links/notes.
- `luggage_items`: personal luggage, visible only to the owner user.
- `shared_luggage_items`: team gear with assignee packed state and owner confirmation.
- `pack_items`: older/general packing checklist used by Today/legacy packing flows.
- `attachments`: shared attachment metadata.
- `share_links`: readonly public share tokens.

Storage:

- Bucket: `trip-attachments`.
- Path convention: `trips/{tripId}/attachments/{targetType}/{targetId}/{timestamp}-{fileName}`.
- Bucket is private.
- Signed URLs are used when opening attachments.

RLS and private helpers:

- RLS is enabled on public trip data tables.
- Helper functions were moved into `app_private`.
- Public helper RPC execute permissions are revoked/hardened.
- RLS policies use `app_private.*` helpers internally.
- Frontend should rely on normal table queries/mutations and RLS, not helper RPC calls.

Share flow:

- Public `get_share_snapshot(share_token)` delegates to `app_private.get_share_snapshot`.
- It returns only trip, timeline, accommodations, and guide data.
- It must not expose budget, actual expense, settlement, personal luggage, shared luggage, member private data, or attachments unless explicitly redesigned.

## 7. Realtime Flow

Realtime is centralized in the authenticated `App` effect for the active trip.

The channel is named `trip-${activeTripId}` and listens to `postgres_changes` for:

- `trips`
- `itinerary_items`
- `itinerary_alternatives`
- `budget_items`
- `budget_item_participants`
- `actual_expenses`
- `actual_expense_participants`
- `accommodations`
- `guide_items`
- `todo_items`
- `luggage_items`
- `shared_luggage_items`
- `attachments`
- `itinerary_budget_items`
- `pack_items`
- `trip_members`

Most events call `loadTripData(activeTripId)`. Trip and membership changes may also call `loadTrips(activeTripId)`.

Rules:

- Realtime sync is card/record-level, not text-level collaboration.
- Realtime should update lists when not editing.
- Realtime must not overwrite active form state.
- Avoid aggressive refetch that causes forms to unmount.
- If adding new tables, add RLS, `replica identity full` if needed, Realtime publication, load logic, and regression tests.

Known risk:

- Current Realtime strategy reloads broad trip data. This is simple but can interact badly with active forms if a component reinitializes form state on data changes.

## 8. Draft Autosave Flow

Draft utilities live in `src/lib/draftAutosave.js`.

Key functions:

- `getDraftKey`
- `saveDraft`
- `loadDraft`
- `clearDraft`
- `loadLatestDraftForEntity`
- `clearDraftsForEntity`
- `isDraftNewerThanServer`
- `detectRemoteConflict`
- `useDraftAutosave`

Draft key format:

`travel-planner-draft:{userId}:{tripId}:{entityType}:{entityId|new}`

Draft rules:

- Drafts are local-only in `localStorage`.
- Drafts must never sync to Supabase or Realtime.
- Active form state has priority over server state.
- Draft autosave can preserve unfinished local work across interruptions.
- Save success should clear the relevant draft.
- Cancel should clear/release only when user confirms discarding unsaved changes.
- Demo disables draft autosave.
- Reload / browser close should warn the user when there are unsaved changes.
- If the user still leaves after the browser warning, restoring the draft on the next visit is intentional behavior.
- Restored draft data is not considered saved data.
- Only explicit Save writes form data to the database.

Forms currently using draft autosave include:

- Timeline item.
- Budget item.
- Actual expense.
- Accommodation.
- Todo.
- Guide.
- Personal luggage.
- Shared luggage.

Protected rule:

- Do not reinitialize default form values just because parent data reloaded.
- Do not use keys or conditional rendering that remount active forms during Realtime refetch.
- Any form fix must test save, cancel, route/tab switch, visibility change, and session refresh.

## 9. Edit Lock Flow

Edit lock utilities live in `src/lib/editLocks.js`.

Fields:

- `locked_by`
- `locked_at`

Tables with lock columns:

- `itinerary_items`
- `budget_items`
- `actual_expenses`
- `accommodations`
- `todo_items`
- `guide_items`
- `luggage_items`
- `shared_luggage_items`

Current timeout:

- `editLockTimeoutMs = 7 * 60 * 1000`.

Behavior:

- `acquireEditLock` updates one record with current user and timestamp.
- `isLockedByAnotherUser` prevents another user from editing an active locked record.
- `releaseEditLock` clears only if `locked_by` equals the current user.
- Update mutations use `updated_at` optimistic locking when `baseUpdatedAt` is supplied.

Rules:

- Lock only one card/record, never the whole site.
- Release lock after successful save.
- Release lock after confirmed cancel.
- Timeout should prevent permanent locks after browser crash or network loss.
- Demo disables edit locks.

Known risk:

- Lock release depends on form close/save paths. When changing forms, verify both save and cancel close the editor and release locks.

## 10. State Rules

Core state rule:

- Editing form state always wins over server/realtime state while the form is open.

Do:

- Keep form state local to the editor component.
- Use `formSeed` and `useDraftAutosave` carefully.
- Store `baseUpdatedAt` when opening an edit form.
- Return `{ ok: true }` from successful save callbacks so forms can close.
- Return `{ ok: false, conflict: true }` on optimistic-lock conflict.
- Clear draft only after successful save or confirmed discard.

Do not:

- Reset form state on every prop change.
- Mount/unmount active forms because list data reloaded.
- Call `setFormSeed(emptyForm)` before save actually succeeds.
- Let Realtime replace user input mid-edit.
- Let Demo use formal data hooks or Supabase callbacks.

## 11. UI Rules

Visual direction:

- Minimal.
- Calm.
- Practical.
- Travel-first.
- Rounded cards are okay but keep radius restrained.
- Use whitespace and clear information hierarchy.
- Avoid enterprise SaaS admin density on mobile.
- Avoid landing-page hero sections for the actual app.

Desktop layout:

- Left sidebar for navigation and trips.
- Main workspace for active trip.
- Timeline can pair with route and budget side panels.
- Budget can be card/table-like with overview.
- Accommodation has list/detail behavior.

Mobile layout:

- Bottom navigation.
- Today mode should be the mobile home.
- Cards should show essentials first and expand details.
- One-handed travel use is more important than visual flourish.

Existing sections:

- Today / 總覽
- Timeline / 時間軸
- Budget / 預算
- Accommodation / 住宿
- Todo / 待辦
- Luggage / 行李
- Settlement / 結算
- Settings / 設定

## 12. Demo / Mock Flow

Demo route:

- `/demo`
- `/demo/timeline`
- `/demo/budget`
- `/demo/luggage`

Vercel rewrite:

- `/demo` and `/demo/:path*` rewrite to `/index.html`.

Demo design:

- Demo uses local mock data and React state.
- Demo should not call Supabase, Auth, Realtime, Storage, draft autosave, edit locks, or localStorage.
- Refreshing Demo returns mock state.
- Demo is for UI/UX/state-flow inspection by GPT/testers who cannot log in.
- Demo should look like the formal app as much as possible.

Demo currently covers:

- Timeline with formal-ish cards, route panel, budget summary.
- Budget with planned budget and actual expense sections.
- Luggage with personal and shared item flows.

Demo banner:

- Must clearly show that operations are not saved permanently.

Protected rule:

- Do not connect Demo callbacks to production Supabase functions.
- Do not import formal hooks that mutate Supabase into Demo.
- If UI diverges, prefer extracting/parameterizing view components over creating a second simplified UI.

## 13. Features Completed

Completed or substantially implemented:

- Google OAuth login.
- Trip creation.
- Trip list and active trip selection.
- Owner/editor/viewer membership model in schema/RLS.
- Invite link flow with pending approval.
- Owner approval/rejection.
- Supabase Realtime subscriptions for trip-scoped tables.
- Timeline CRUD.
- Timeline alternatives.
- Timeline map URL/link fields.
- Timeline to budget many-to-many links.
- Budget CRUD.
- Equal split participant selection for budget.
- Fixed budget flag.
- Convert budget to actual expense.
- Actual expense CRUD.
- Equal split participant selection for actual expense.
- Settlement calculation and simplified transfers.
- Accommodation CRUD.
- Todo CRUD and completion.
- Guide CRUD.
- Personal luggage CRUD/toggle with privacy via RLS.
- Shared luggage CRUD/toggle with assignee packed and owner confirmation.
- Attachments metadata and private Storage upload/open/delete.
- Share links and public readonly share snapshot.
- Lightweight offline read/cache.
- Demo pages for timeline, budget, luggage.
- Draft autosave utilities and form integration.
- Record-level edit locks and optimistic locking.

## 14. Features Still In Development

Areas still evolving:

- Mobile Today mode depth and polish.
- Stronger separation of containers from presentational views.
- More complete Demo/form parity for all sections, not only timeline/budget/luggage.
- Conflict UX beyond a simple notice/prompt.
- Better Realtime granularity to avoid broad reloads.
- More robust offline read UX and cache invalidation.
- Full share route/path design beyond query token.
- Polish for viewer role UI and disabled affordances.
- Better empty/loading/error states.
- More automated regression tests.

Reserved for later:

- Custom split UI.
- Offline editing and sync conflict merge.
- OCR.
- LINE/Email/Push notification.
- AI itinerary generation.
- Deep maps/routing API integration.
- Drag/drop manual timeline sorting if explicitly reprioritized.

## 15. Known Issues and Risk Areas

Known issues / risks observed in the project history:

- Draft restore edge cases: old drafts can reopen or repopulate fields if not cleared correctly after save/cancel.
- Edit state edge cases: save/cancel can fail to close forms if callbacks do not return `{ ok: true }` or if state is reset in the wrong order.
- Realtime refetch can reload broad data and may interact with active form state.
- Luggage personal/shared forms have had state-contamination bugs before. Keep personal and shared state separate.
- Demo and formal UI can drift if new UI is added only to one side.
- Some terminal output on Windows may display Chinese as mojibake even when source/build is valid. Use build/browser verification instead of trusting PowerShell display alone.
- Current `src/App.jsx` is large; unrelated edits can create regressions easily.
- Some legacy concepts still coexist: `pack_items` and newer `luggage_items/shared_luggage_items`.
- There is no formal test suite yet. `npm run build` is necessary but not sufficient.

When fixing bugs:

- Fix one class of issue at a time.
- Start with P0 data-loss or stuck-editor bugs.
- Avoid broad rewrites.
- Verify formal app and Demo separately.

## 16. Protected Areas

Do not casually modify these without a focused reason and regression plan:

- Auth flow in `App`, especially Google OAuth `redirectTo: window.location.origin`.
- Demo routing before auth checks.
- Share flow and `?share=` branch.
- Invite flow and `request_trip_membership`.
- RLS helper migration design (`app_private` helpers and revoked public helper RPCs).
- Realtime subscription effect.
- `loadTrips` and `loadTripData` data shape assumptions.
- `useDraftAutosave` behavior.
- `editLocks.js` behavior and lock timeout.
- `updateWithConflictCheck` optimistic locking.
- Storage bucket/path assumptions for attachments.
- Personal luggage RLS/privacy assumptions.
- Shared luggage assignee/owner update rules.
- Vercel `/demo` rewrites.
- Service worker caching behavior.

Never:

- Expose service role keys.
- Call private/helper permission RPCs from frontend.
- Bypass RLS by moving auth logic only into frontend checks.
- Let Demo write production data.
- Replace broad app architecture in one pass.

## 17. Coding Rules

General:

- Prefer small, scoped edits.
- Preserve existing data shapes unless migration scope is explicit.
- Follow current React/plain JS style.
- Do not introduce new frameworks or architecture layers casually.
- Do not convert to TypeScript/Tailwind/Next.js without explicit approval.
- Do not duplicate UI; extract view components carefully when needed.
- Keep production data callbacks separate from Demo local-state callbacks.
- Keep comments short and only where they reduce confusion.

Code modification:

- For existing files, prefer `apply_patch`.
- Prefer minimal targeted edits.
- Prefer modifying only the affected JSX/CSS block.
- Avoid PowerShell full-file replacements.
- Avoid `Get-Content | Set-Content` rewrite flows.
- Avoid Node one-liner whole-file rewrites.
- Avoid regex-based global replacements.
- Avoid whole-file rewrites unless explicitly required.
- Whole-file rewrites are allowed only when creating a new file, creating a new migration, replacing a document intentionally, or doing a large refactor explicitly approved by the user.

Forms:

- Save callbacks should return `{ ok: true }` on success.
- On conflict, return `{ ok: false, conflict: true }`.
- Active forms should not be reset by Realtime or refetch.
- Use stable draft keys with user, trip, entity type, and entity id/new.
- Clear drafts on successful save.
- Release locks on successful save or confirmed cancel.

Supabase:

- Add RLS for every new public table.
- Add select policies required for updates.
- Use `app_private` helpers inside policies.
- Do not expose helper functions as frontend RPCs.
- If adding storage paths, update Storage RLS.
- If adding Realtime tables, update publication and subscription handling.

UI:

- Desktop may be denser; mobile should be simpler.
- Do not add decorative hero/marketing UI inside the app.
- Do not bury core travel actions behind complex menus.
- Avoid text overflow and cramped mobile controls.

## 18. Regression Testing Checklist

Always run:

- `npm run build`

For auth/permissions changes:

- Unauthenticated `/` shows login.
- Google login still redirects correctly.
- `?invite=` still creates pending membership after login.
- Pending member cannot edit.
- Viewer cannot edit.
- Editor can edit content but cannot owner-only actions.
- Owner can approve members, invite, share, delete trip.
- User cannot see trips they are not a member of.

For Realtime/draft/lock changes:

- Edit Timeline, switch browser tab, return: unsaved text remains.
- Save after returning: form closes, draft clears, lock releases.
- Cancel after edits: prompt appears only when unsaved changes exist.
- Other user editing same card should lock only that card.
- Lock timeout does not permanently block editing.
- Realtime update with no active form refreshes UI.
- Realtime update while editing does not overwrite form.

For budget changes:

- Add/edit/delete budget.
- Equal split participant chips work.
- Timeline links persist.
- Fixed cost flag persists.
- Convert to actual creates actual expense and marks source budget.
- Actual expense add/edit/delete works.
- Settlement totals still calculate.

For luggage changes:

- Personal add/edit/save/cancel returns to add mode.
- Personal input clears after save.
- Personal and shared form state do not contaminate each other.
- Personal luggage remains private.
- Shared assignee can toggle `packed_by_assignee`.
- Owner/editor can manage shared items.
- Owner can confirm shared item.

For attachments:

- Upload accommodation proof.
- Upload receipt/photo for actual expense.
- Open uses signed URL.
- Delete removes Storage object and metadata.

For share:

- Owner creates share link.
- Public `?share=` loads without login.
- Share page is readonly.
- Share page does not show budget, actual expenses, settlement, luggage, or member private data.

For Demo:

- Unauthenticated `/demo/timeline`, `/demo/budget`, `/demo/luggage` load without login.
- Demo banner is visible.
- Demo operations update React state only.
- Refresh resets mock data.
- Demo does not create Supabase/Auth/Storage/Realtime network requests.
- Demo UI remains close to formal UI.

For mobile:

- Bottom nav works.
- Today mode is usable.
- Timeline cards do not overflow.
- Budget cards remain readable.
- Luggage tabs/controls work with one-hand use.

## 19. Project Workflow

Feature flow:

1. Read existing code paths first.
2. Identify whether change belongs in production container, view component, Demo container, migration, or style.
3. If schema changes are needed, design RLS at the same time.
4. Implement the smallest useful slice.
5. Keep Demo parity if the feature affects timeline/budget/luggage UI.
6. Run build and targeted manual checks.
7. Summarize changed files and residual risk.

Bug fixing flow:

1. Reproduce or inspect the exact flow.
2. Classify severity: data loss/stuck editor/auth breakage are P0.
3. Fix one bug class at a time.
4. Avoid touching unrelated sections.
5. Test save, cancel, refetch, Realtime, and mobile navigation if forms are involved.

Regression audit flow:

1. Check console/build errors.
2. Check auth route and demo/share route branching.
3. Check major CRUD forms.
4. Check draft/lock cleanup.
5. Check Realtime reload behavior.
6. Check RLS assumptions if database or policy code changed.

Demo testing flow:

1. Open `/demo/timeline`.
2. Add/edit/delete a timeline item.
3. Expand details and map URL.
4. Open `/demo/budget`.
5. Add/edit/delete budget and actual expense.
6. Convert budget to actual.
7. Open `/demo/luggage`.
8. Add/edit/delete/toggle personal and shared items.
9. Confirm no Supabase/Auth/Storage/Realtime requests.

Mobile testing flow:

1. Test narrow viewport.
2. Confirm bottom navigation.
3. Confirm forms are not clipped.
4. Confirm card text wraps cleanly.
5. Confirm touch targets are usable.

## 20. Current Direction for Future Agents

The project should keep moving toward a stable MVP architecture:

- Better container/view separation.
- Consistent Demo as mock-data version of formal UI.
- Stronger form lifecycle guarantees.
- More careful Realtime behavior.
- Mobile travel companion polish.
- Stable RLS-backed permissions.

When in doubt, protect the core behaviors first:

- Google login works.
- Users only see trips they are allowed to see.
- Owner/editor/viewer permissions remain correct.
- Realtime does not destroy local edits.
- Draft autosave prevents losing unsaved work.
- Edit locks only lock one record.
- Demo remains safe, local, and unauthenticated.
- Share links remain readonly and privacy-preserving.
