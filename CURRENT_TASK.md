# CURRENT_TASK.md

This is the current working context for future AI agents. Keep this file short and update it when priorities change.

## Current Stage

The project is in MVP stabilization.

Current focus:

* Stabilize existing collaboration flows.
* Polish UX where users can lose work or get stuck.
* Keep Demo pages consistent with the formal app UI.
* Improve travel-first usability and planning flow.

This is not a feature-expansion sprint. Prefer small, safe fixes.

---

# Current Active Focus

## Timeline / 行程 Desktop UX Phase 1

Current active work is focused on improving the Timeline page desktop experience.

This phase is intentionally limited in scope:

* Desktop only.
* Avoid large architecture rewrites.
* Avoid breaking draft/realtime/edit-lock behavior.
* Avoid touching unrelated systems.

Priority order:

1. UX clarity
2. Editing safety
3. Stable state flow
4. Demo parity
5. Visual polish

---

# Current Timeline Phase 1 Tasks

## 1. Terminology Unification

Replace UI wording:

* 「時間軸」→「行程」
* 「地點」→「目的地」

Apply consistently across:

* Titles
* Buttons
* Placeholders
* Card labels
* Empty states
* Demo timeline

---

## 2. Timeline Card Cleanup

If destination/location is empty:

* Do not show:

  * 「未設置地點」
  * Empty labels
  * Empty icon rows

Keep cards visually clean.

---

## 3. Time Display Simplification

Timeline cards should:

* Hide seconds
* Display:

  * `09:00`
  * `14:35`

Do not display:

* `09:00:00`

---

## 4. Time Picker Improvement

Timeline time options should:

* Increment every 5 minutes

Example:

* 09:00
* 09:05
* 09:10

Future configurability is planned later, but not in this phase.

---

## 5. New Timeline Item Default Time

When creating a new itinerary item:

If the current Day already has items:

* Default start time =
  previous last item end time

Example:

Last item:

* 14:00 ~ 15:30

New item default:

* start_time = 15:30

If the last item has no end time:

* Do not auto-fill
* Keep blank

---

## 6. Timeline Invalid Time Validation

BUG-016 is already fixed.

Do not regress this behavior.

Current correct behavior:

* end_time <= start_time prevents save
* Validation error is shown
* Editor stays open
* Draft is preserved
* Edit lock is preserved

---

## 7. Timeline Page Simplification

Timeline page should focus on itinerary planning only.

Remove from Timeline page:

* Packing checklist section
* Budget section

Do not leave empty layout gaps.

Budget and luggage functionality should remain in their own dedicated pages.

---

## 8. Member Section Relocation

Move member section:

* Into collapsible left sidebar
* Above logout button

Requirements:

* Compact
* Does not consume main itinerary space
* Quick member visibility still available

---

# Current Non-Goals

Do not work on these yet unless explicitly requested:

* Mobile Timeline redesign
* 40/60 layout
* Map collapse system
* Inline expanding card editor
* Route-click auto scroll
* Alternative flip-card UI
* Container/view extraction
* Major state refactor
* New frameworks
* Schema redesign

---

# Stability Requirements

Must preserve:

* Draft autosave behavior
* Edit lock behavior
* Realtime active edit safety
* Demo/form parity
* Google OAuth flow
* Share route behavior
* RLS-backed permissions

Do not:

* Reinitialize active forms during reload
* Let Realtime overwrite active edits
* Connect Demo to Supabase/Realtime/localStorage
* Broadly rewrite `src/App.jsx`

---

# Current Testing Focus

Always run:

```bash
npm run build
```

Manual regression focus:

* Timeline edit survives tab/app switch
* Save clears draft correctly
* Cancel releases lock correctly
* Realtime update does not overwrite active form
* Demo timeline still works without login
* Demo timeline remains mock-state only
* Timeline validation still blocks invalid time ranges
* Default new item time behavior works correctly

---

# If Unsure

Prefer stability over new capability.

Before changing Timeline behavior, check:

* `AGENT.md`
* `BUGS.md`
* `src/lib/draftAutosave.js`
* `src/lib/editLocks.js`
* Realtime subscription flow in `src/App.jsx`
