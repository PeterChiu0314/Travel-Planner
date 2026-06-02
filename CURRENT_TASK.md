# CURRENT_TASK.md

This is the current working context for future AI agents. Keep this file short and update it when priorities change.

## Current Stage

The project is in MVP stabilization.

Current principles:

* Preserve existing collaboration flows.
* Polish UX where users can lose work or get stuck.
* Keep Demo pages consistent with the formal app UI.
* Improve travel-first usability and planning flow.
* Prefer small, safe changes over large rewrites.

---

# Current Active Focus

## Timeline Layout & Transportation UX Phase

Current focus:

* Focus on conventional desktop screen proportions first.
* Polish the standard desktop Timeline workspace layout before broader responsive work.
* Add transportation card between itinerary items.
* Keep map collapse and Day Board behavior stable.
* Preserve draft autosave, edit lock, Realtime safety, and Demo parity.

## Priority Order

1. Standard desktop layout proportions
2. Day Board / map ratio polish
3. Transportation card UX
4. Timeline card density polish
5. Demo parity
6. Regression safety

---

# Recently Completed Timeline Work

Phase 1 and Phase 2 are mostly stabilized.

Completed:

* UI wording unified: 「時間軸」→「行程」, 「地點」→「目的地」.
* Timeline card time display simplified to `HH:mm`.
* Time options changed to 5-minute increments.
* New itinerary item defaults start time from previous item end time when available.
* BUG-016 invalid time validation preserved:
  * `end_time <= start_time` prevents save.
  * Error is shown.
  * Editor stays open.
  * Draft and lock are preserved.
* Timeline page no longer shows Budget or Luggage panels.
* Members panel moved to the sidebar.
* Desktop 40/60 Timeline layout implemented.
* Map/route panel collapse implemented.
* Collapsed map mode shows Day Board columns.
* Day Board tabs, horizontal navigation, and active Day behavior implemented.
* Day Board card polish implemented:
  * Active Day column is wider.
  * Cards use destination as primary title.
  * Timeline form no longer exposes a separate title/name field.
  * Save keeps `title` synced from destination/location for data compatibility.
* Demo Timeline keeps parity and remains mock/local-state only.

---

# Current Non-Goals

Do not work on these unless explicitly requested:

* Supabase schema changes
* Realtime subscription rewrites
* Draft autosave key or storage redesign
* Edit lock flow rewrite
* Google Maps API integration
* Inline card editing architecture
* Alternative flip-card UI
* Route-click auto scroll
* Marker/card hover sync
* Container/view extraction
* Major `src/App.jsx` architecture rewrite
* New framework, TypeScript, Tailwind, or Next.js migration
* Tablet, mobile, narrow-window, or device-specific layout optimization for now

---

# Stability Requirements

Must preserve:

* Draft autosave behavior
* Edit lock behavior
* Realtime active edit safety
* Demo/form parity
* Google OAuth flow
* Share route behavior
* Budget, Luggage, Auth, and Share data flows
* RLS-backed permissions
* BUG-016 invalid time range validation

Do not:

* Reinitialize active forms during reload/refetch.
* Let Realtime overwrite active edits.
* Connect Demo to Supabase, Realtime, Storage, Auth, or localStorage.
* Broadly rewrite `src/App.jsx`.
* Change Supabase schema or migrations.

---

# Current Testing Focus

Always run:

```bash
npm run build
```

Manual regression focus:

* Timeline edit survives tab/app switch.
* Save clears draft correctly.
* Cancel releases lock correctly.
* Realtime update does not overwrite active form.
* Demo timeline still works without login.
* Demo timeline remains mock-state only.
* Timeline validation still blocks invalid time ranges.
* Default new item time behavior works correctly.
* Map expanded mode keeps the route/map context stable.
* Map collapsed mode keeps Day Board columns stable.
* Day tabs and Day Board horizontal navigation still work.

---

# If Unsure

Prefer stability over new capability.

Before changing Timeline behavior, check:

* `AGENT.md`
* `UX_RULES.md`
* `BUGS.md`
* `src/lib/draftAutosave.js`
* `src/lib/editLocks.js`
* Realtime subscription flow in `src/App.jsx`
