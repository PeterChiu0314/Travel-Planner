# Issue #17 — pricing initialization and quiet collaboration

Branch: `codex/budget-collaboration-redesign`. Scope: shared Budget/Actual pricing and group editor UX. Production/main/deployment/migrations/protocol flags were not operated. This is a frontend/controller candidate, not full Hosted acceptance or permission to close #17.

## Root causes and contract

- Lifecycle creates a deliberately unpriced incomplete record without participant rows. The group editor projected these rows literally, unlike the old new-record form, so users had to select everyone manually. New/unpriced placeholders now display approved members as local defaults. Opening/focusing does not persist that selection; only an intentional pricing edit admitted by the existing group lease/version checks can submit it. An empty amount remains empty and incomplete.
- Mode switching reused `custom.current` wholesale. A stale partial cache could omit a participant. The shared pure transition now seeds every participant from the existing original-currency largest-remainder calculation, preserving cents/tail differences. A custom cache is reused only when it covers the selected participants with valid amounts and matches the current total. Participation changes within custom mode retain all existing amounts and initialize newly selected people to zero. Total remains the sum; no final participant is locked or used as an automatic remainder.
- New whole-record forms use approved members only. All three modes share the explicit selected set; switching modes never selects excluded members. Departed/invalid selected people remain visible for deliberate removal and cannot be re-added.
- Existing persistence records only selected participant rows, not everyone considered and deliberately excluded. Absence alone cannot identify a new member. No global reselect/backfill was added to existing items.
- Group errors/retry/discard controls were directly rendered under fields. They are removed entirely, including Source's field-level recovery controls. Group outlines use the existing `collaboratorColor` and row outline/tooltip CSS, with peer name on hover and keyboard focus and read-only controls. The previous grey peer presentation is superseded by #17's color-outline-only rule.

## Recovery and notification behavior

The controller retains all authority/capability/epoch, serial autosave, exact request IDs and version protections. A clean stale admission can adopt a validated canonical version without making the user resolve a fictitious dirty conflict. True same-group conflicts retain local input and cannot automatically rebase over another person's write.

A coalesced background recovery pass runs at most every five seconds, using an authoritative refresh first. Exact releases retry their original capability. Unknown writes reuse the original request ID and exact payload against the existing DB receipt/idempotency check; no new request is minted for an unknown result. In-flight transports remain shared, and context/session guards remain intact. Business refusals including PT500/PT409/permission/validation/disabled cases are not automatically replayed; explicit page-level Save or a new valid edit is needed where safe. Conflicts use the existing page-level leave Save/Don't save/Continue flow. Unknown operations cannot be discarded without confirmation of their outcome.

Temporary blank pricing while the user is editing is a draft, not an immediate failed save. Validation on explicit flush/blur retains that draft and issues one concrete Sonner error. Real transport/server failures use stable existing Sonner IDs and are deduplicated across background retries; normal admission/contention/save success is silent. One editor-level `預算同步狀態` reports unverified/pending work, including unknown Source operations; no field carries technical status text or recovery actions. Successful authoritative convergence clears the pending state and its issued error notifications.

The Source business UI itself is retained for #18's reviewed removal, not redesigned or expanded by this task. Its existing controller still owns request verification; only feedback/peer read-only behavior and automatic use of its existing exact retry path changed.

## #18 changes the remaining member-decision proposal

Read [Issue #18](https://github.com/PeterChiu0314/Travel-Planner/issues/18) after the user's steering. Do not add duplicate permanent decision columns or controllers independently to Budget and Actual. The same shared pricing transitions, color frames, Toast rules and group authority should survive the single-expense model.

Minimal data contract for Review:

1. The logical expense item stores its explicit selected participants **and** the approved member IDs already considered for this selection (candidate name `participant_decision_member_ids`). The latter includes intentionally excluded people. It belongs to the single expense identity; exact storage is decided with #18's compatibility projection and migration plan.
2. New item creation records the approved member universe transactionally. Every explicit participant edit updates decisions and shares together under the pricing lease and member/graph versions. Reads expose the considered set, never tokens.
3. A later approved member absent from that known set can be proposed locally as selected. In custom mode their draft share is zero; existing shares remain unchanged. Persist only through an admitted, version-checked atomic pricing operation. A remote holder prevents writes; opening a panel is never itself a write.
4. Existing data starts with **unknown decisions**, not a guessed backfill. Preserve selected rows and amounts. A first explicit decision records the current member universe while preserving exclusions; only subsequent genuinely unseen members qualify for automatic defaults. Do not infer intent from created timestamps, missing join rows or current membership alone.
5. Preserve known paid amounts, original rates, frozen Baseline and historical allocations. Introducing a member cannot silently reprice paid history. The #18 Review must define current versus forecast/paid share semantics before this default is enabled for existing paid records.
6. Use a new Forward migration and controlled compatibility rollout only after this contract is reviewed. Test old/unknown decisions, intentional exclusions, new approvals, revocation/rejoin, same-account tabs, payment/source graphs, Baseline/rates and version conflicts before activation. No installed migration or Source Hash is modified.

**Not implemented/claimed:** automatic newcomer selection on existing persisted items. Doing it now would guess exclusions or establish two structures that #18 immediately replaces. #17 remains open on this data-contract gate and genuine Hosted acceptance. #18's major schema work remains planning-only and follows #17.

## Validation evidence and limits

- 26 Node cases passed: eight pricing/default/cent/cache/incomplete cases, four new background recovery cases, fourteen existing acquire/release/late-ACK/snapshot cases.
- 71 controller cases passed: Metadata, choices, Pricing and Lifecycle. In particular the pre-existing PT500 confirmed-refusal/no-automatic-replay case still passes.
- 23 isolated serial PGlite SQL/RLS cases passed against the repository metadata protocol harness. These verify capability/epoch, one holder including same-account tabs, group independence, invoker permissions and exact replay. This is not parallel Hosted acceptance or full latest Staging parity.
- 91 distinct rendered Chromium cases passed across final and corrected targeted runs: full selection90/91, followed by the fixed appearance/Source/notifications selection16/16 (eleven rendered, five notification unit cases). The failed case exposed a late owner hint arriving after keyboard focus; retaining the focus/hover position before that hint fixes its name tooltip without weakening authority. The six Issue #17 cases were additionally rerun with a second failed recovery cycle to verify Toast deduplication. Build and `git diff --check` passed. Existing tests formerly asserting field recovery/status UI now exercise the same safety behavior through background confirmation or the page-level guard; assertions of canonical DB/mock rows and request identity remain.
- Corrected the old metadata mock's pricing receipt to return the committed target revision while preserving the submitted normalized amount. The old pre-write revision made successful mock writes appear unknown. This is a test-double repair, not evidence of a Hosted RPC defect and not a relaxed production validator.
- Browser plugin unavailable; repository Playwright on `http://127.0.0.1:5173` with static maps and mocked backend. Desktop1440×1000, screenshots outside the repository. No Production/main/Docker/WSL, no new third-party dependency.
- The previous automatic browser approval service refused Staging observation due usage limit. No alternate route was used to obtain that denied outcome. No QA sessions, remote leases, financial data, keys, migrations, protocol flags or latches were created/changed by this round. Five protocols are left in their previously authorized ON state; Receipt/Undo remain OFF. A fresh remote readback is not claimed.

## Next acceptance

Review the single-item member-decision contract with #18, prepare/test its Forward separately, then perform genuine Staging A/B/A sessions with independently read lease/request/row evidence. Keep exact QA-scope fingerprints before any fixture writes. Verify new-member persistence/exclusions across refresh and accounts, paid/rates/Baseline invariants, genuine errors and silent contention, then record truthfully whether #17 can close. Do not relabel local mock results as Hosted Passed.
