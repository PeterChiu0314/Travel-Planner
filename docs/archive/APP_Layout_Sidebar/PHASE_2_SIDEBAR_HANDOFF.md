# App Layout Phase 2 Sidebar Handoff

## Status

App Layout Phase 1 Header UI is complete, user verified, merged into `main`, and pushed.

Latest confirmed baseline:

```text
main
18d8749 merge: app layout header phase 1 ui
```

Phase 2 can start from `main` with a new branch, for example:

```text
codex/app-layout-sidebar-phase-2
```

## Read First

Before starting Phase 2, read:

- `AGENT.md`
- `CURRENT_TASK.md`
- `docs/UX_RULES.md`
- `docs/BUGS.md`
- `docs/PHASE_1_8_WORK_LOG.md`

## Phase 1 Header UI Summary

Completed Header work includes:

- Trip Header compact layout and metadata structure.
- Header date popover and date range picker UI.
- Destination popover and map-ready destination data shape.
- Trip stage display and settlement-phase guards.
- Members preview button in the Header.
- Members / invite dialog.
- Owner-only member management.
- Editor share-dialog access for copying an active share link.
- Viewer share-dialog lockout.
- Demo route parity for Header member entry.
- Playwright smoke tests and source guards.

Important current behavior:

- Owner can manage members and share links.
- Editor can open Share Dialog and copy an existing active share link.
- Viewer cannot open Share Dialog.
- Settlement phase locks normal member invitation and normal date changes.
- Developer Date Tool has its intended test-only override behavior from Phase 1.7E.
- Demo route uses shared Header components where practical, but must not call formal Supabase share/member mutation flows.

## Phase 2 Goal

Phase 2 should focus on Sidebar layout and UI only.

Recommended first step:

```text
Sidebar audit first. Do not modify code until the current Sidebar structure, shared app shell boundaries, responsive behavior, scroll/overflow ownership, and route-specific responsibilities are clear.
```

Suggested audit topics:

- Current Sidebar DOM structure.
- Desktop vs mobile navigation behavior.
- Shared App Shell responsibilities.
- Sidebar width, height, overflow, and scroll ownership.
- Relationship between Sidebar, Header, Toolbar, and Page Content.
- Demo route parity.
- Which Sidebar elements are global vs page-specific.
- Which pieces should be extracted later, if any.

## Protection Scope

Do not change these areas during Sidebar UI work unless the user explicitly asks:

- Supabase schema, migrations, RLS, RPC, or SQL functions.
- Auth flow.
- Share View route or `get_share_snapshot`.
- Share link DB/RPC behavior.
- Invite/member data mutation logic.
- `updateTripDateRange()`.
- Trip date change RPC flow.
- Timeline date remap / shortening delete logic.
- Draft autosave behavior.
- Edit lock behavior.
- Budget, Actual Expense, Settlement, Accommodation, Todo, Luggage, Guide data logic.

If Phase 2 reveals a need to touch any protected area, stop and report before editing.

## UI Rules To Preserve

- Keep operational app surfaces dense, calm, and scannable.
- Do not create a marketing landing page.
- Do not add decorative gradient blobs/orbs.
- Avoid nested cards.
- Do not let UI text overlap or overflow its container.
- Prefer existing component/style patterns before adding new abstractions.
- Icons should use the existing icon approach in the repo.
- Demo and formal routes should stay visually consistent, but Demo must remain safe and local.

## Validation Baseline

The following passed after merging Header Phase 1 into `main`:

```text
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Phase 2 should keep this baseline passing.

## Recommended Phase 2 Workflow

1. Create a new branch from `main`.
2. Read the handoff docs listed above.
3. Perform a Sidebar audit and record findings.
4. Propose or implement small UI-only Sidebar changes.
5. Validate with `npm.cmd run build`.
6. Run `npm.cmd run test:e2e` when Sidebar changes affect navigation, Demo route, or app shell behavior.
7. Keep commits scoped and push after verified checkpoints.
