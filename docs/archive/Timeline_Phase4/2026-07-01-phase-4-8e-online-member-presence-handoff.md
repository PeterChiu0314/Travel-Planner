# Timeline Phase 4.8e Online Member Presence Handoff

Date: 2026-07-01
Branch: `codex/timeline-phase-4-8`
Status: Implemented / user verified iteration / build passed / no migration

---

## Read First

- `AGENT.md`
- `CURRENT_TASK.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/2026-07-01-phase-4-8c2-collaborative-drag-presence-handoff.md`
- `docs/timeline-phase-4-drag-reorder-rules-draft-v13.md`

Archive rule:

- Do not read `docs/archive/` by default.
- `docs/gpt/` no longer exists and must not be recreated.

---

## Summary

Phase 4.8e adds trip-level online member presence on top of the stable Phase 4.8c/4.8d collaborative Timeline work.

It shows which trip members are online, lets a user click a remote online member avatar to jump to that member's current supported page/day, and marks Timeline day tabs when a remote member is currently on that day.

The feature is navigation-only. It does not lock editing, does not affect drag presence, does not write to the database, and does not change reorder behavior.

---

## Final Technical Shape

Trip-level channel:

```text
trip-presence:{tripId}
```

Presence payload:

```js
{
  tripId,
  userId,
  userName,
  sessionId,
  colorKey,
  pageKey,
  dayIndex,
  selectedItemId,
  selectedItemType,
  selectedItemTitle,
  updatedAt
}
```

Track timing:

- on `SUBSCRIBED`
- on supported page/section change
- on Timeline day change
- on Timeline destination/transport card selection
- heartbeat every 28 seconds
- untrack on trip/user scope cleanup and component unmount

Stale filtering:

- remote trip presence older than 55 seconds is removed from UI.

Supported page keys:

```text
overview
timeline
budget
accommodation
packing
settlement
settings
todo
```

Local route/section mapping:

- `overview` -> `today`
- `packing` -> `luggage`
- other supported keys map directly to existing app sections.

---

## UI Behavior

Member avatars:

- Remote online approved members receive a single 2px border using the existing 4.8d non-green color palette.
- The online border replaces the default gray avatar border.
- The local user's own avatar keeps the existing local style.
- Avatar title text includes `{userName} · {pageLabel}` or `{userName} · Timeline · Day N`.
- Clicking a remote online avatar navigates to the remote member's page/day when supported.
- Clicking self does not jump.

Day tabs:

- If a remote online member is on Timeline Day N, Day N's tab receives a single 2px border using that member's remote color.
- Day tab presence uses the first remote presence for the visual color.
- The earlier small-dot indicator was removed after visual testing.
- No remote mini avatars or `+N` indicator are shown in day tabs.

Debug:

When `?debugPresence=1` is present, trip-level logs use a dedicated prefix:

```text
[trip-presence] subscribe skipped
[trip-presence] subscribe start
[trip-presence] subscribed
[trip-presence] track latest payload
[trip-presence] track skipped
[trip-presence] track result
[trip-presence] sync state
[trip-presence] computed online members
[trip-presence] computed day tab presence
[trip-presence] avatar click navigation
[trip-presence] stale filtered
[trip-presence] reconnect requested reason
[trip-presence] recreate channel
[trip-presence] heartbeat requested reconnect
[trip-presence] focus/visibility recovery
[trip-presence] replay track after subscribed
```

This is intentionally separate from `[drag-presence]` so 4.8c day-scoped drag logs and 4.8e trip-level online logs are not confused.

---

## Relationship To 4.8c / 4.8d

Preserved:

- `timeline-drag:{tripId}:{dayIndex}` remains the day-scoped drag presence channel.
- Foreign same-day drag read-only behavior remains unchanged.
- Timeline card remote selection border remains broadcast-only and does not lock the day.
- Destination and transport selection presence remain supported.
- DragOverlay / preview order are not synchronized.
- Demo remains local and does not connect to Supabase Presence/Broadcast.

Not changed:

- RPCs
- migrations
- database schema
- reorder flow
- Phase 4.7 fixed-anchor logic
- transport conflict confirmation
- edit locks
- draft autosave

---

## Relevant Code Locations

Primary implementation:

- `src/App.jsx`
  - `tripPresenceHeartbeatMs = 28000`
  - `tripPresenceStaleMs = 55000`
  - `tripPresencePageLabels`
  - `tripPresencePageToSection`
  - `tripPresenceDebug()`
  - `tripPresencePayload`
  - `tripPresenceRecoverableStatuses`
  - `tripPresenceChannelVersion`
  - `remoteTripPresences`
  - `remoteTripPresenceByUser`
  - `timelineDayTabPresenceByDay`
  - `publishTripPresence(reason)`
  - trip-level `trip-presence:{activeTripId}` effect
  - `HeaderMemberPresencePreview`
  - `DayTabs` remote presence border wiring

Styling:

- `src/styles.css`
  - `.trip-header-member-avatar.remote-online`
  - `.day-tab.has-remote-presence`

Tests:

- `tests/phase-4-2c-reorder.spec.js`
  - `Phase 4.8d remote card selection is broadcast-only and does not lock the day`
  - `Phase 4.8e trip-level online member presence stays navigation-only`

Known issue documentation:

- `docs/BUGS.md`
  - `BUG-025 | Timeline foreign drag presence may clear by stale timeout`

---

## Relevant Commits

```text
b178103 Add Timeline collaborative card selection
9fd8d31 Simplify Timeline remote selection border
7e3cd7a Tune Timeline remote selection label
f4db600 Align Timeline remote selection label
21e9b17 Support Timeline transport card selection
0c92bc8 Fix Timeline drag clear and untimed rebase
e129089 Add trip-level online presence
f743069 Add trip presence debug logging
bb308f0 Refine online presence borders
```

---

## Verification

Phase 4.8d / 4.8e checks run during implementation:

```text
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8d" passed
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8e" passed
npm.cmd run build passed
git diff --check passed with Windows LF/CRLF notices only
```

Additional targeted checks from the surrounding 4.8c/4.8d stabilization:

```text
npx.cmd playwright test tests/phase-4-5-untimed-ordering.spec.js passed for untimed ordering regression coverage
npx.cmd playwright test tests/phase-4-2c-reorder.spec.js --grep "Phase 4.8d|untimed|mixed" passed where applicable
npm.cmd run build passed
git diff --check passed with Windows LF/CRLF notices only
```

Manual user testing:

- Phase 4.8c Presence + Broadcast repeated drag regression was user verified after channel recovery.
- Phase 4.8d destination/transport card remote selection border was user tuned and pushed.
- Phase 4.8e online avatar/day-tab visual treatment was reduced to single 2px borders after user feedback.

The Vite build still reports the existing large-chunk warning; it is not a Phase 4.8e regression.

---

## Residual Risks

- Trip-level Presence is best-effort Realtime UI state. Missing or delayed presence events should not affect data correctness.
- `BUG-025` remains a Known Issue / Low Priority: foreign drag presence can still occasionally clear by the 12-second stale timeout instead of immediate clear. It does not block 4.8e.
- Avatar and day-tab presence colors show only a compact first-version representation. Multiple users on the same Day tab are intentionally collapsed to the first visible remote color.
- Debug logs are gated by `?debugPresence=1`; keep them during rollout while 4.8e is still being manually observed.

---

## Recommended Next Step

Phase 4.8e is complete enough to hand off.

Next work should be one of:

- final merge/PR cleanup for Timeline Phase 4.8,
- optional debug-log cleanup after more manual verification,
- Phase 4.9 Map integration only if explicitly requested.

Do not infer schema/RPC work, Demo presence, remote cursor/scroll sync, remote ghost cards, collaborative editing merge logic, or additional transportation repair.
