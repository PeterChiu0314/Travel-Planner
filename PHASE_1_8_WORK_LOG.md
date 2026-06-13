# App Layout Header Phase 1.8 Work Log

## Summary

Phase 1.8 focuses on the Trip Header member entry redesign:

- Add a long-form Header member preview entry.
- Upgrade the old invite-only dialog into a unified "成員與邀請" dialog.
- Keep Share as a separate Header action and separate dialog.
- Preserve Sidebar Members for this phase.
- Avoid DB/RLS/RPC/migration changes.

Current branch:

```text
codex/app-layout-header-phase-1-8
```

## Phase 1.8A - Audit

### Completed

- Audited existing Header member, invite, share, pending, and settlement permission flow.
- Confirmed existing RLS already supports owner membership update/delete through trip ownership policies.
- Confirmed Phase 1.8 can be handled without new migration, RLS, RPC, or schema changes.

### Changed Files

- None.

### Test Result

- Read-only audit.
- No build required for this subphase.

### Next Step

- Implement Header member preview entry.

## Phase 1.8B - Header Member Entry

### Completed

- Replaced the standalone "邀請朋友" icon button with a long-form Header member preview button.
- Preview shows approved member initials.
- Preview shows up to 4 approved members and a `+N` overflow indicator.
- Owner sees pending reminder as `待審 N`.
- Header metadata member count remains and opens the same members dialog.
- Tooltip/title/aria-label use `成員與邀請`.
- Share icon remains separate.

### Changed Files

- `src/App.jsx`
- `src/styles.css`

### Test Result

- `npm.cmd run build` passed.

### Next Step

- Build the unified "成員與邀請" dialog.

## Phase 1.8C - Members / Invite Dialog

### Completed

- Replaced the old invite-only dialog with `MembersInviteDialog`.
- Dialog sections:
  - 目前成員
  - 待審核
  - 邀請朋友
  - 你的權限說明
- Added role labels:
  - `owner = 擁有者`
  - `editor = 編輯者`
  - `viewer = 檢視者`
- Owner can:
  - Create invite link.
  - Approve/reject pending members.
  - Change editor/viewer roles through a dropdown.
  - Remove editor/viewer members after confirmation.
- Editor/viewer can view members and permission explanation only.
- Settlement phase keeps dialog open for viewing but disables management.

### Changed Files

- `src/App.jsx`
- `src/styles.css`

### Test Result

- `npm.cmd run build` passed.

### Next Step

- Align Demo route behavior with formal Header behavior.

## Phase 1.8D - Demo Parity

### Completed

- Added Demo Header member preview behavior.
- Demo member preview uses mock members only.
- Demo metadata member count opens the same mock "成員與邀請" dialog.
- Demo members dialog is read-only / disabled for formal write operations.
- Demo does not write to Supabase.
- Fixed React key fallback for demo members with `id || user_id || email`.
- Expanded Demo members to 5 approved members so `4 initials + +1` overflow is testable.

### Changed Files

- `src/App.jsx`

### Test Result

- `npm.cmd run test:e2e` initially caught the missing React key fallback.
- After the fix, e2e passed.

### Next Step

- Add smoke/source coverage for the new member entry and guard rules.

## Phase 1.8E - Smoke / Source Coverage

### Completed

- Extended Playwright smoke coverage for Demo:
  - `/demo/timeline` loads without auth.
  - `/demo/budget` and `/demo/luggage` navigation works.
  - Header member preview opens the members dialog.
  - Header member preview shows 4 compact avatars plus `+1`.
  - Header member preview has `title` and `aria-label` set to `成員與邀請`.
  - Members dialog heading is `成員與邀請`.
  - Metadata member count opens the same dialog.
  - Demo navigation does not call Supabase/Auth/REST/Realtime backend APIs.
- Added source-level guard tests for formal logic:
  - Member management remains owner-only and settlement-locked.
  - Approved owner/editor/viewer can open the members dialog.
  - Editor can open Share dialog but cannot manage share links.
  - Viewer cannot open Share dialog.
  - Share management remains owner-only.
  - Member mutations preserve trip boundary.
  - Role changes only allow `editor` / `viewer`.
  - Owner cannot be modified through the dropdown.
  - Current user cannot remove/change self through member management.
  - Required labels, settlement notice, invite prompt, pending guard, and disabled states remain present.

### Changed Files

- `tests/phase-1-7f-smoke.spec.js`
- `tests/phase-1-8-source-guards.spec.js`

### Test Result

- `npm.cmd run test:e2e` passed with 8/8 tests.

### Next Step

- Final validation and cleanup.

## Phase 1.8F - Final Validation

### Completed

- Ran final build/e2e/diff validation.
- Tightened Header counts to approved members only.
- Kept pending count separate as owner-only `待審 N`.
- Added `trip_id` boundaries to:
  - pending approve
  - pending reject
  - role update
  - member removal
- Confirmed no DB/RLS/RPC/migration changes were made.
- Confirmed protected flows were not intentionally changed:
  - Share route
  - Invite flow / `request_trip_membership`
  - `updateTripDateRange`
  - Draft Autosave
  - Edit Lock
  - Realtime
  - Storage/attachments

### Changed Files

- `CURRENT_TASK.md`
- `src/App.jsx`
- `src/styles.css`
- `tests/phase-1-7f-smoke.spec.js`
- `tests/phase-1-8-source-guards.spec.js`

### Test Result

```text
npm.cmd run build      passed
npm.cmd run test:e2e   passed, 8/8
git diff --check       passed
```

### Next Step

- Manual verification with authenticated test data.
- Commit/push after user approval or after manual verification is complete.

## Pending Manual Verification

These items require real authenticated app data and cannot be fully proven by the current non-auth demo/smoke environment.

### Owner

- Open "成員與邀請" dialog.
- Create invite link.
- Approve pending member.
- Reject pending member.
- Change editor/viewer role.
- Remove editor/viewer member.
- Confirm Share management still works from the separate Share dialog.

### Editor

- Open "成員與邀請" dialog.
- Confirm invite, pending, role, and remove controls are unavailable.
- Open Share dialog.
- Copy existing active share link.
- Confirm create/enable/disable share controls are unavailable.

### Viewer

- Open "成員與邀請" dialog.
- Confirm invite, pending, role, and remove controls are unavailable.
- Confirm Share dialog cannot be opened.

### Settlement Phase

- Confirm "成員與邀請" dialog opens read-only.
- Confirm management controls are disabled.
- Confirm settlement notice appears.
- Confirm Header date editing remains locked.
- Confirm Share permissions remain independent.

### Auth / Invite Regression

- Confirm Google login still reaches formal app.
- Confirm invite link flow still reaches `request_trip_membership`.
- Confirm pending member can be approved by owner after invite request.

## Current Blocker

The implementation and automated verification are complete for the locally provable scope.

Remaining completion evidence requires:

- Authenticated Owner / Editor / Viewer test accounts.
- Real formal trip data.
- Manual Google login and invite-flow verification.

## Regression Fix - Editor Share Link Visibility

### Issue

Editor could open the Share dialog but could not see the active share link previously created by Owner.

### Root Cause

The Share dialog open permission and share-link loading permission were not fully separated:

- `canOpenShareDialog` allowed Owner or Editor to open the dialog.
- The share-link loading effect still loaded links only when `isOwner` was true.
- Result: Editor opened the dialog with an empty `shareLinks` state.

### Fix

- Kept `canOpenShareDialog = isOwner || isEditor`.
- Renamed share management permission to `canManageShareLinks = isOwner`.
- Updated share-link loading to run when `canOpenShareDialog` is true.
- Left Share management controls behind `canManage`.
- Editor can now see/copy active share links but still cannot create, enable, or disable share links.
- Viewer still cannot open Share dialog.

### Changed Files

- `src/App.jsx`
- `tests/phase-1-8-source-guards.spec.js`

### Validation

```text
npm.cmd run build      passed
npm.cmd run test:e2e   passed, 9/9
git diff --check       passed
```
