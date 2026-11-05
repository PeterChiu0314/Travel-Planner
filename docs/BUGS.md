# BUGS.md

## Issue #18 | Single expense model — analysis/Review stage

[Model, dependencies and phased acceptance](2026-11-05-budget-issue18-single-expense-review.md). Existing planning projection overwrites displayed forecast with retained payment totals, and Source/Origin/bundle/snapshot dependencies prevent safe component-only removal. User now waives old Budget retention: no old Budget conversion or two-way compatibility plan. Candidate uses one expense identity with optional forecast/paid financial bundles, one participant-decision structure and no Source product flows. Actual-only values/IDs, other modules and frozen Baseline remain protected pending explicit mapping Review; no data deleted or DB restructured. Read-only inventory SQL is not executed. #17 newcomer-decision and genuine Hosted gaps remain open; #18 implementation/acceptance is not claimed Passed.

## Issue #17 Review | Normal autosave must not display a sync banner — fixed candidate

Removed the editor-level pending/unverified status DOM, preserving internal pending/unknown state and existing leave guards. One shared Budget/Actual/Source Sonner slot deduplicates multi-field incidents; normal input/admission/release/save/version convergence stays silent.68 affected mocked rendered cases passed across67/68 full run plus targeted exact-cleanup rerun; three new cases cover quiet held A/B autosave, two failed groups/one Toast/original requests/guarded exit, and offline draft/Toast/reconnect. The stale test used a disappeared banner as acknowledgement; corrected to require exact lease cleanup. No Hosted/DB/protocol change. Earlier text describing a visible pending status is superseded by [Review follow-up](2026-11-05-budget-issue17-pricing-collaboration.md). Remaining newcomer-decision and Hosted gaps stay open under #17.

## Issue #17 | Pricing defaults and quiet field collaboration — candidate, acceptance incomplete

[Root cause / implementation / #18-aligned remaining contract](2026-11-05-budget-issue17-pricing-collaboration.md). Fixed unpriced placeholder display defaults, partial custom-share cache initialization, shared mode/participant transitions and temporary-empty validation timing. Removed field-level technical status/actions, reused collaborator palette/outline plus hover/focus identity, deduplicated genuine Sonner failures and retained page-level pending/draft recovery. Background exact-capability/request recovery preserves business-refusal/no-auto-replay and true-conflict guards.26 Node/71 controller/5 notification/23 serial isolated SQL and91 distinct mocked rendered cases passed across final/targeted runs; Build/diff passed. A late ownership hint could arrive after keyboard focus, hiding its tooltip; corrected and appearance/Source rerun16/16 (includes five notification cases). No Hosted pass claimed. Existing-item newcomer defaults are **not activated**: selected participant rows cannot distinguish new from deliberately excluded members, and #18 requires a single expense model. Proposal pending Review; no guessed backfill or duplicate permanent decision structure. No remote DB/flags/financial write. #17 remains open; #18 major migration is planning-only.

## Issue16 | Group release recovery — code fixed; tracker closed by user

[Investigation and evidence](2026-11-05-budget-issue16-lease-recovery.md). Confirmed client race: a denied first acquire arriving after blur retained a token without epoch; repeated releases were unsynchronized; failed-release Retry was blocked in controller and UI. Fixed exact capability capture, shared release work/waiting refocus, definite-refusal cleanup, recoverable late ACKs, enabled explicit Retry and receipt-owned hint. Initial3 regressions failed then passed;14 Node/68 controller/67 rendered Playwright/23 isolated serial SQL passed, Build/diff passed. No installed SQL/TTL/permissions change. Real Staging run was not dispatched: Preflight refused2 unrelated manual pricing leases, then automatic browser approval hit usage limit. Key cleared/owned processes closed; no fake HTTP/parallel SQL certification. The user subsequently closed Issue16 at2026-11-05T03:42:33Z (fresh GitHub read); genuine three-session acceptance remains unverified and continues under Issue17. Issue17 supersedes the earlier field Retry/grey/status presentation; five manual protocols stay ON, Undo/Receipt OFF.

## 2026-11-05 Budget idle fields looked locked

Fixed on the feature branch: BudgetMetadataEditor styled every non-accepting group as readonly, including unclaimed fields, and displayed an idle acquisition hint. Grey styling now applies only to a peer-held group; idle and own fields are normal and idle hints removed. Pricing mode/member controls keep authority gating but avoid disabled opacity before admission. Pending/saving/failure/conflict feedback and retry/discard remain unchanged.25 targeted mocked Playwright cases passed (appearance, choices, pricing, locks, save recovery and conflict), plus Build/diff. No lease/RPC/autosave/DB-permission modification or Hosted data write. Desktop screenshots inspected; mobile and new authenticated hosted interaction are not claimed.

## 2026-11-05 Staging manual handoff

[Latest runbook](2026-11-05-budget-staging-manual-handoff.md):32 Passed/1 Failed/1 Blocked. D01/D02/D04/B01/B07 genuine Hosted Passed. C07 visibility prerequisite remains manual; D03 historical URL absent, not Passed. No new product P0/P1 identified. Fixed QA graph projection, audited retired canary continuation and traveling default Actual page targeting; financial/Baseline guards retained. Final automated sevenOFF audited, then exact fiveON per explicit user manual-test request. Receipt/Undo OFF; original83 relations/receipts/objects/security preserved; sessions/leases/jobs0. Only deliberate5174 manual frontend retained; no auto-shutoff, no Worker or admin key. Production NO-GO.

## 2026-11-04 Staging QA tooling follow-up

Subsequent user instruction revoked the10% quota stop rule. Conflicting local scratch artifacts were preserved and the portable scope restored;25/25 local safety checks pass. Fresh11:32:29Z READ ONLY matches the complete last-handoff OFF seals. C05 remains pending a reconnected masked credential helper; no new product failure or Hosted write.

Home continuation at19:25 Asia/Taipei stopped under the user's remaining10% quota rule (actual remaining7%); no new tests or Hosted writes. Local restore refused a conflicting old QA identity artifact without overwriting it; investigate/retain before restoring the portable scope. C05 and22/1/11 results unchanged. [Checkpoint](2026-11-04-budget-staging-resume-stop.md).

[Execution and limits](2026-11-04-budget-staging-acceptance.md), [home runbook](2026-11-04-budget-staging-home-handoff.md). Latest22 Passed/1 Failed/11 Blocked. Fixed QA minimal-return provisioning, self-pending membership/owner approval, empty Baseline handling, actual quote normalization, real stale-version trigger, Vite readiness and selected-row input targeting. C05 standalone Node subscriber timed out although peer UI converged; root cause unconfirmed. Candidate observes actual product WebSocket frames, locally tested but not Hosted rerun. No new product P0/P1 established. Managed Realtime partition publication rotation was proven by exact SELECT-only reconstruction, not catalog mutation;83 original relation seals preserved and signal increments exactly+10 per enable/Pause cycle.25/25 local QA safety tests passed. Final ledger66/sevenOFF/latches retained; sessions/all leases/jobs0; native owned processes/listeners0. Manual testing/Production GO remain blocked.

The former [30-second Undo inverse limitation](2026-11-03-budget-planning-simplification.md) is historical: custom saved-data Undo was subsequently removed. It is not a current product gate. Never merge/delete duplicate Actual history to satisfy the unique current-Budget-link constraint. Production remains unchanged this round.

Focused audit scope: routing, Realtime, draft autosave, edit locks, Demo containers, Timeline/Budget/Luggage forms, and mobile flow.

This document now separates:

* Confirmed reproducible bugs
* Risk candidates from code analysis
* UX improvement candidates
* Closed / not reproducible issues

---

# Confirmed Bugs

Latest product change 2026-11-03: [Custom Undo removal](2026-11-03-budget-custom-undo-removal.md) supersedes all five-step/30-second Undo acceptance and activation instructions. [Staging installation](2026-11-03-budget-undo-staging-install.md): Forward20261103113253 installed ledger66, twelve Undo entries deny ordinary roles, 81tables/668rows and Receiptmetadata1/objects2 preserved, sevenOFF/latchesretained. Original wrapper row-digest XPath and Managed-lock/CRLF tool defects corrected with real-data/concurrency/transport tests; prior aggregate row-proof claim invalidated. Receipt removal and one current Actual per Budget remain. Production unchanged by this task; no new ordinary-JWT/HTTP/full-service certification.

## Production rollout | Dormant COMMIT; full B7 enablement NO-GO

2026-11-03: [Execution / limits](2026-11-03-budget-b7-production-deployment.md). After explicit Production deployment/budget-only clearing permission and backup waiver, one exact17-source transaction committed48→65. Original48 source rows,38final hashes/54PT409+24PT500, all18 non-budget relation projections, RLS/ACL and sevenOFF/false latches/readiness independently verified.12/12 native packet checks and4/4 signing adapter checks passed. Real dedicated Worker empty claim HTTP200 is narrow capability only. Managed Advisor0Errors/10sameWarnings/24intentional private deny-all Info. No new product P0/P1 found in Dormant installation.

Latest closeout: compatible frontend85a7209 is Production READY; Formal receipts explicitly paused per user with receipt-disable flagTRUE, five enable flagsOFF. Fresh anonymous Chrome release smoke and3directly affected local mocked UI checks passed. Implicit favicon404 was fixed and verified200. No authenticated Production E2E claimed; no main merge.

P1 **non-receipt activation boundary**: installed Receipt metadata guard alone does not protect a Finance/Lifecycle-ON, Receipt-latch-OFF profile from old clients. [New local candidate](operations/drafts/budget-receipts-deferred/README.md) adds a separate fence;10/10 native SQL/RLS checks pass,277oldbodies/OIDs retained. Not installed, not Managed HTTP evidence; operational wrapper/six-protocol Activation/Pause and real ordinary-JWT smoke remain required. Production stays65/sevenOFF/threeFALSE. Previous native credential helpers are actually gone; resume later with new masked supply, no urgent operator action tonight.

Permanent Worker hosting/renewal/two-cycle evidence and Production legacy issuer-stop/invalidation are **deferred Receipt gates**, not universal prerequisites to other safely isolated Budget features. No readiness fabrication, key rotation or secret persistence. PG17.6 security triage remains existing. Production budget history/Baseline rows were explicitly disposable and intentionally deleted; other project content retained. Prior backup P0 is **waived by user**, not falsely marked Passed. Full Activation remains NO-GO.

## B-7 release gates | Changed quote verified; Staging core acceptance GO with P2 limits

Latest2026-11-02, fromffa1dbf: [rates / Staging closeout](2026-11-02-budget-b7-rates-staging-closeout.md), [new results](qa/2026-11-02-budget-b7-rates-closeout-results.json). Last P1 acceptance gate Passed with actual daily quoteJPY0.206945→0.207133, unpaidJPY100001→20714TWD, shares10357/10357, real two-user Pricing/Rates exclusion, both stale-versionPT409, exact Replay and both headed Browser detail/statistics. Four old Actuals/payment history/Source Origin/retained Budgets exact. Final Ledger65/sevenOFF/latchesretained/28+38/security unchanged; normal QA cleanup/logout/session0/native shutdown verified. No new unresolved product P0/P1. Production/main/deployment remain NO-GO pending separately authorized planning and rollout.

Baseline refresh on missing-rate initialization of a future planning trip is confirmed existing design, not a newly reproduced product defect. This round sealed both target trips before Browser entry; pure initialized-trip entry changed neither Baseline, legitimate edits refreshed main only, other Rates/Baseline and original history exact. Prior raw before Hash gap remains known P2 and the historical failed raw-equality assertion stays Failed; no invented Hash or forced restoration. Existing standard/multipart oversized HTTP response Blocked and bundle/Advisor/hardware/accessibility limitations remain; Staging core GO is not a zero-Blocked transport certificate. QA-only unreadable-process audit now fails closed; a repeated-selection test mistake was corrected after safety Pause without modifying product behavior.

The following dated checkpoint is preserved as history; its changed-rate Blocked status is superseded by the new true service result above.

Latest2026-11-02: [final E2E follow-up](2026-11-02-budget-b7-final-e2e-followup.md). Ledger65 unchanged; seven protocols finally OFF, three activated latches retained. Ordinary QA membership recovery/logout and native helper/Chrome/Vite shutdown independently verified. Actual background draft, revoked/trip/logout delivered-late Snapshot isolation, re-login/refresh, foreign payment/version conflict, concurrent Receipt replacement and old-claim/new-object protection passed their stated scopes. True changed-quote repricing remains Blocked; do not substitute a no-op. A legacy QA planning Baseline auto-refreshed on trip visit and lacks a full raw before Hash; this fixture isolation limit is explicit. Original28 and38 seals matched. Production NO-GO. Prior dated platform/cutover records below remain historical evidence.

## BUG-033 | Narrow Budget grid expands beyond the viewport

Priority: P2
Status: Fixed on feature branch; true Staging browser responsive checks passed
Discovered: 2026-11-02 (Asia/Taipei)

At390px, Budget's540px table contributed its minimum width through the parent grid wrapper, producing a556px document; the filter row also refused to wrap. The two scoped max760px CSS adjustments add min-width:0 to the Budget wrapper and allow filter wrapping. Real Staging820/390px checks now match document and viewport width, with the Add control inside the viewport; screenshots were inspected. Desktop layout rules and financial behavior were not redesigned. The original combined IME/mobile failure is retained; only the affected responsive part was rerun. See the final report and matrix for hardware/accessibility limits.

## BUG-031 | First definite Metadata admission PT409 blocks discard and close

Priority: P1
Status: Fixed on feature branch; real Staging browser regression passed
Discovered: 2026-11-01

Two real clients admitted against a changing version exposed a new token with no epoch after a definite first PT409. The draft was preserved but cleanup could never prove release, blocking discard/close. Immediately paused Staging at04:35Z; irreversible latches and financial history retained. Minimal fix clears only the definitely ungranted first token, preserving the draft/conflict; an earlier unknown ACK or a known epoch still requires verified cleanup. Receipt retainRequestOnError is unchanged.

New red/green tests3/3 and directly dependent regressions3/3 passed. After controlledResume04:50Z, true delayed admission/real409 at04:52Z preserved B's draft, sent no B patch, allowed explicit discard/close, and showed A's canonical update. Actual lease competition also passed. Production source/deployment remains pending with the complete B-7 release gates. [Evidence and recovery timeline](2026-11-01-budget-b7-legacy-cutover-and-e2e.md).

### Historical pre-cutover checkpoint (240a105)

Current release remains NO-GO after the second completed local recovery and real lease-expiry test. Final safePause12:56Z: ledger65/sevenOFF/latchesretained/queues0; original28/38/security unchanged. QA B was really moved to pending during late-Snapshot testing; Runner stalled and ordinary restore/logout are not certified. Whole exact QA graph retained, user reported interrupt. These are unresolved acceptance/recovery gates, not proof of a product RLS bypass. Do not use the old historical OFF/readinessfalse/ledger64 snapshot below as current state.

P2 immutable-artifact exception: full staged diff whitespace check reports6 trailing-space lines in the already-installed cutover SQL/source wrapper. Full Source/wrapper hashes remain identical; other paths pass. No whitespace setting was disabled and no applied source was rewritten. Existing bundle-size warning and oversized transport limitation remain separate.

## BUG-032 | Out-of-order Snapshot can invalidate newer admission or regress displayed protocol state

Priority: P1
Status: Fixed locally; real Staging expiry/takeover regression passed; overall release still blocked
Discovered: 2026-11-01

An ownership Snapshot started before lease admission could arrive after the grant and mark the field lost; an even older enabled Snapshot could regress a newer Pause. Both are reproduced by focused red tests. Record monotonic read-start order per context, reset it on configure, and retain only the authority proven by an unexpired admission when contradicted by a pre-admission read. Fresh loss/revocation still fails closed; Snapshot alone cannot grant edit authority.

New4tests red2fail/2pass→green4/4; direct existing admission3 and ingest/expiry4 plusBuild passed. ImmediatePause11:45Z preserved all latches; controlledResume12:02Z after unchanged original/security proofs. Actual server lease expired12:06:29Z, B acquired epoch22 after21, saved, A recovered canonical and closed12:06:33Z. Pre-fix full network trace was not sealed, so exact attribution of every earlier harness failure remains an inference. CDPfreeze/background claims were removed when traffic continued; genuine visibility remainsBlocked. FinalPause for the separate unresolved revocation harness leaves Staging sevenOFF. [Detailed evidence](2026-11-01-budget-b7-legacy-cutover-and-e2e.md).

### Historical platform-only results (before cutover)

Updated2026-11-01. [Real-service report](2026-11-01-budget-b7-real-service-acceptance.md), [case matrix](qa/2026-11-01-budget-b7-real-service-results.json). Prior credential/native-launch blocker is resolved; masked helper genuinelyREADY, then stopped after testing. Publishable-key compatibility fixed locally,7/7 focused tests andBuild passed.

TrueAuth/RLS/Storage bytes+SHA/SignedURL/MIME/TUS413, dedicatedWorker exactheaders/content/retry/claimexpiry/processrestart/10scheduled cycles, live-reference protection and expiredJWT401 passed as scoped platform tests. Valid9MiB upload ACK was unknown, independently confirmed committed, fully downloaded/hashverified and normally removed. Original standard/multipart oversized client response checks remainBlocked; backend rejected EntityTooLarge, no Timeout/assertion relaxation. No new confirmed productP0/P1; unknown upload ACK transport cause remainsP2 investigation, not fullReceipt E2E proof.

P1 release blocker: no verifiable legacy issuance stop/drain/expiry evidence. Delayed logs, noS3keys and zero multipart cannot alone authorize filling legacy_grants_expire_at. Keep sevenProtocol/Latch/readiness OFF; no Activation. LegalHostedIncomplete, userReceipt lifecycle, object-ID race and fullmultiBrowserE2E remainPending Post-Activation. Do not turn admin-created platformcanary jobs into businessReceipt acceptance or fake readiness. Existing Staging authority continues, not a newstageReview gate.

Final Ledger64/38seals/28original projections and scopedRLS/ACL unchanged; Advisor0Errors/10sameWarnings/23Info. New3trips/1Actual/8objects normally cleaned;3aborted intents/6donecleanup/3syncsignals retained. OldQA Baseline/users preserved,3newAuth sessions logout, noWorker daemon. Existing BUG-028/030 closure, BUG-029 frontend rollout, historicalsource/55P03/bundle warnings retain prior status. Production NO-GO.

---

## BUG-030 | Ordinary JWT Trip cascade loses Budget lease authorization

Priority: P1
Status: Closed — Staging Forward committed / true Auth-PostgREST HTTP7/7 passed
Discovered: 2026-10-31

**Latest 2026-10-31:** explicitly authorized exact20261031140648 Source/wrapper committed on Staging, ledger63→64. Fresh read-only body/attributes/catalog/38functions/28original fingerprints and sevenOFF verified. Ordinary owner JWT Trip DELETE now succeeds with Budget/Actual/participant/Baseline graph; Budget/Actual deletes, peer lease refusal, nonmember/anon isolation and real409/PT409 also pass (7 targeted HTTP cases). Two new and exactly two prior failed-run QA trips normally removed; four QA sync signals retained without forced cleanup, older QA Baseline preserved. Advisor no new unresolved P0/P1. [Deployment and real-service closure](2026-10-31-bug030-staging-deployment.md). Historical failure/local-only evidence follows; it is superseded for this Staging defect.


After approved guard_incomplete_child Forward committed (ledger63), individual Budget/Actual deletes cascade correctly. An approved owner JWT DELETE of a fresh QA Trip still returns403/42501 Forbidden. Managed PostgreSQL context confirms FK DELETE budget_items -> guard_budget_edit_lease line26 -> assert_budget_edit_lease line11 at can_edit_trip; approved_trip_role reads trip_members during the parent/membership cascade. Privileged native cases bypass this when auth.uid is null, so prior15/15 did not cover this real-user boundary. Failed transaction retains both parent/child graphs and Baselines; no orphan rows or forced cleanup. Further Hosted writes stopped; other requested negative/PT409 tests blocked. Only read-only diagnosis done, no extra function/RLS/grant changes. Subsequent local candidate20261031140648 reproduces the ordinary-role42501, then passes22/22 targeted native cases using a private transaction-bound admission and pre-delete permission/lease/row locks. It preserves both existing function attributes and all prior financial/RLS/latch boundaries. No Hosted access in that local follow-up; real Trip HTTP failure remains open pending exact-artifact Review, separate Staging authority and post-deployment HTTP. [Local fix/22case evidence](2026-10-31-budget-b7-trip-cascade-local-repair.md). [Deployment, runtime context and retained QA](2026-10-31-budget-b7-cascade-deployment.md).

---

## BUG-029 | Cold Budget INSERT Realtime delivery absent in Staging service acceptance

Priority: P1
Status: Fixed locally / real Staging service regression passed / frontend not deployed
Discovered: 2026-10-31

The two original failures were caused by treating Phoenix JOIN/SUBSCRIBED as Postgres Changes readiness. Real wire controls show asynchronous system readiness arriving after the first committed insert. Waiting for extension=postgres_changes/status=ok makes both real JWT clients receive RPC/REST INSERT across INSERT/* and filtered/unfiltered variants; six targeted service cases pass, including UPDATE/rejoin/unsubscribe/nonmember isolation. The old Runner now uses this gate; the local product also catches up via its guarded Budget reader when CDC becomes ready. Two local tests and Build pass. No Hosted publication/RLS/Grant or Timeout workaround; no frontend deployment or full UI acceptance claimed. [Root cause and evidence](2026-10-31-budget-b7-p1-repair-review.md).

---

## BUG-028 | Dormant participant Guard rejects normal parent FK cascade

Priority: P1
Status: Closed on Staging — participant Forward plus BUG-030 verified Budget/Actual/Trip HTTP
Discovered: 2026-10-31

Latest: the later separately authorized BUG-030 Forward and ordinary-JWT7/7 regression resolve the downstream Trip authorization failure too; ledger64, guard_incomplete_child body unchanged, original data/protocol fences preserved. Hosted Incomplete negative fixture remains pending; prior native boundary evidence is not called new HTTP. [Final scoped deployment report](2026-10-31-bug030-staging-deployment.md). The next paragraph records the earlier checkpoints.


Deleting a QA trip with a Budget participant returns55000 because the child's BEFORE DELETE trigger queries a parent already removed by the FK cascade, interprets it as incomplete and requires validated Pricing. Both real Staging runs reproduce this with all protocols OFF. A non-auto-apply, exact-body-hash draft restores only DELETE with an absent parent before any financial/lifecycle/receipt activation; existing incomplete parents and activated/paused parent protection remain guarded. Fifteen native cases pass: the original eight plus strict child UPDATE/DELETE, three paused-latch fences, protocol concurrency, full-source ledger/repeat/collision/version and atomic rollback boundaries. New full source preserves exact function hashes and properties. After the authorized21:01 local continuation, official CLI2.106.0 issued 20261031130414 later than head20261031130000; exact full source/wrapper and actual-version15/15 native regression pass. Earlier time-blocked/unfinished CLI attempts remain historical; no clock/version fabrication. Later explicitly authorized Forward committed to Staging (ledger63); Budget/Actual child cascades pass real HTTP. Whole Trip DELETE remains42501 in a different legacy lease/membership guard, tracked as BUG-030; this P1 is not closed. Old sources remain unchanged. [Source, official version and scope](2026-10-31-budget-b7-p1-repair-review.md).

---

## BUG-027 | Transport-aware continuation bypasses the five-minute Timeline ceiling

Priority: P0
Status: Fixed / Production verified / branch unmerged
Discovered: 2026-08-11

Description:
After Phase 6 made normal-pair transportation participate in automatic scheduling, the next destination started at the exact preceding end plus transport duration. For example, `16:10 + 8` produced `16:18` instead of the established five-minute ceiling `16:20`.

Expected:
Only an automatically calculated next-visit start is rounded upward to the next five-minute Timeline boundary. Stored transport duration remains exact, destination duration is preserved, exact boundaries stay unchanged, and explicit user anchors are not rounded.

Fix note:
The JavaScript Planner and authoritative SQL Planner now use the same five-minute ceiling for automatic continuation and earlier-conflict guidance. Migration `20260811133000_timeline_phase_6_restore_five_minute_ceiling.sql` adds a private immutable helper without changing any applied migration or stored transportation duration.

Verification:
Staging and Production authoritative RPC fixtures produced A `15:10-16:10`, B `16:20-17:20`, and C `17:30-18:00` across 8- and 7-minute transports while retaining `[8,7]`. Both fixture transactions rolled back; the Production follow-up query confirmed 0 retained rows. Focused Planner/RPC tests passed 50/50, the broader Phase 6/reorder/Untimed/transport regression passed 100/100, and Production `public/app_private` error-level schema lint passed. Migration history aligns through `20260811133000`; the hotfix branch intentionally remains unmerged to `main`.

---

## BUG-026 | Timeline reorder transport remap can hit a temporary unique-pair collision

Priority: P0
Status: Fixed / Production verified
Discovered: 2026-08-11

Description:
Moving a timed destination to the bottom of a Day with multiple preserved adjacent transport pairs could make the Phase 6 RPC update one transport endpoint pair onto a pair still temporarily occupied by another row. The immediate unique index rejected the intermediate state and rolled back the complete reorder.

Expected:
The atomic reorder may pass through temporary endpoint collisions, but its final transport pairs must remain unique. Failure must never leave a partially applied Day.

Fix note:
Migration `20260811124500_timeline_phase_6_defer_transport_pair_uniqueness.sql` replaces the immediate transport-pair index with a deferred unique constraint. The existing Day advisory lock, deterministic row locks, authoritative server replan, and atomic transaction remain unchanged.

Verification:
Staging and Production authoritative RPC fixtures A/B/C/E with B-to-C and C-to-E passed when A moved to the bottom. Both final pairs were unique, a deliberately duplicated final pair was rejected, and both fixture transactions rolled back with 0 retained rows. Static RPC tests passed 11/11, the focused regression passed 96/96, rendered Demo drag/editor regressions passed 2/2, Production schema lint passed, and the Production build passed.

---

## BUG-023 | Timeline same-day item times can overlap

Priority: P1
Status: Fixed / user verified
Discovered: 2026-06-09

Location:
Timeline / Day Board / itinerary card time editing

Description:
Timeline currently validates only a single itinerary card's own time range (`end_time > start_time`). It does not check whether different cards on the same day overlap, so one itinerary item's time can cover another item's time.

Example:

```text
A: 07:00 ~ 11:45
B: 07:30 ~ 09:30
```

Expected:
Same-day Timeline itinerary items should not be allowed to save overlapping time ranges.

Fix note:
Timeline visit saves now reject same-day visit overlaps using `newStart < otherEnd && newEnd > otherStart`, excluding transportation cards and the item currently being edited. The Timeline editor keeps the form open and shows the overlapping item label and time range. Demo `/demo/timeline` uses the same overlap check.

Verification:
`npm.cmd run build` passes. User verified BUG-023 is fixed.

---

## BUG-022 | Only one active editor allowed per trip

Priority: P1
Status: Fixed / user verified

Description:
Multiple page editors could remain active inside the same trip after switching sections, making later trip switches, reload restore, draft restore, and save guard behavior ambiguous.

Expected:
Only one active editor context should be allowed per user and trip. Switching pages may keep the existing editor/draft without prompting, but opening another editor in Timeline, Budget, Actual Expense, Accommodation, Todo, Guide, or Luggage must first resolve the existing active editor with Save or Discard.

Fix note:
Scoped editor guards now support same-trip handoff before opening another editor. Section panels stay mounted while hidden so active editor guards remain registered across page switches, and inactive section draft restore is gated to avoid restoring multiple editors at once.

Verification:
`npm.cmd run build` and `git diff --check` pass. User verified BUG-022 is fixed.

---

## BUG-021 | Reload loses active trip/page context

Priority: P1
Status: Fixed / user verified

Description:
Reload/F5 could reopen the app on a different trip, section, Timeline day, or Luggage tab than the user was viewing before refresh.

Expected:
Reload should restore the last available active trip first, then restore the active section, Timeline active day, and Luggage personal/shared tab from local browser session context. If the stored trip no longer exists or is unavailable, the app should fall back to the first available trip.

Fix note:
Added local session context restore for active trip, active section, Timeline day, and Luggage tab without changing draft restore, editor guard, conflict handling, Realtime, or Supabase schema.

Verification:
`npm.cmd run build` and `git diff --check` pass. User verified BUG-021 is fixed.

---

## BUG-020 | Restored edit draft conflict after trip switch

Priority: P1
Status: Fixed / user verified

Description:
Restored edit drafts can lose active guard behavior or keep a stale optimistic-lock baseline after reload and trip switching, causing missing save/discard prompts or false conflict messages when saving unchanged server records.

Expected:
Reload should prefer the trip that owns the latest unfinished edit draft when available. Restored edit drafts must be treated as active unsaved edits, must prompt before trip switching, and must use the current server `updated_at` as the save baseline unless another user actually changed the record.

Fix note:
Restored edit drafts now remain under active editor guard, reuse the current server `updated_at` baseline for existing items, and clear the correct draft after successful save.

Verification:
User verified BUG-020 is fixed.

---

## BUG-019 | Draft restore cross-trip contamination

Priority: P0
Status: Fixed / user verified

Description:
Draft restore and active editor state could survive a trip switch, allowing a draft from trip A to appear in trip B or be saved into the wrong trip.

Expected:
Draft restore must be scoped to the draft key trip id and current active trip. Switching trips must clear active editor state without deleting drafts from the previous trip. Save callbacks must reject cross-trip editing contexts before writing to Supabase.

Fix note:
Draft restore now explicitly validates the draft key user, trip, and entity scope. Timeline, Budget, Actual Expense, Accommodation, Todo, Guide, and Luggage editor state is cleared when the active trip changes without deleting the previous trip draft. Save callbacks now receive trip context and reject mismatches; update mutations also constrain by `trip_id`.

Verification:
`npm.cmd run build` passes. User verified BUG-019 is fixed.

---

## BUG-018 | Active Editor Guard

Priority: P0
Status: Fixed / user verified

Description:
Editing state could be interrupted by opening another record or switching trips, allowing stale form state or drafts to appear in the wrong item or trip.

Expected:
Switching to another record or trip while an editor has unsaved changes must ask whether to save or discard. Page section changes keep draft behavior without forcing a save. Reload and tab close use the browser native leave prompt; if the user still leaves, draft restore on the next visit is allowed and is not considered saved database data.

Fix note:
Added a shared active editor guard for Timeline, Budget, Actual Expense, Luggage personal/shared forms, Accommodation, Todo, and Guide. Guarded transitions now save or discard the active editor before opening another record or switching trips, release edit locks on discard, and replace target form state instead of reusing stale state.

Verification:
Phase 1 and Phase 2 were user verified. `npm.cmd run build` passes.

---

## BUG-017 | Timeline edit state contamination

Priority: P0
Status: Fixed / user verified

Description:
Switching directly from editing one Timeline card to another can keep stale form state from the previous card.

Expected:
When opening edit for another Timeline item, `editingId`, form state, draft key, and `baseUpdatedAt` must all switch to the newly selected item. Unsaved content from the previous item must not be submitted into the newly selected item.

Fix note:
`ItineraryTimeline` now flushes the current draft before switching edit targets, replaces the form state with the newly selected item data, and keeps the submit payload tied to the current form fields. Switching from A to B no longer carries A's stale form state into B.

Verification:
User verified that BUG-017 is fixed.

---

## BUG-016 | Timeline invalid time range

Priority: P1
Status: Fixed / user verified

Description:
Timeline item allows start time later than end time.

Example:

* Start: 14:00
* End: 13:00

Previous behavior:
Save succeeded incorrectly.

Expected:
End time must be later than start time.

Fix note:
The form shows a clear invalid time range message, keeps the editor open, and does not affect items without `end_time`. Invalid Timeline saves are blocked in `ItineraryTimeline.submit`, formal `saveItem`, `applyAlternative`, `reorderItem`, and Demo `saveTimelineItem`. The shared submit path reads the current time input values before calling the save callback, so local React state lag cannot bypass the validation.

Verification:
`npm run build` passes. User verified that `14:00 -> 13:00` is blocked, the editor stays open, and the invalid time range message is shown.

---

# Risk Candidates / Needs Verification

## BUG-025 | Timeline foreign drag presence may clear by stale timeout

Priority: Low
Status: Known Issue / does not block Phase 4.8e
Discovered: 2026-07-01

Description:
During collaborative Timeline drag testing, foreign drag presence can still occasionally fail to clear immediately on the remote client after the local user drops or cancels a drag. When this happens, the remote same-day read-only state remains visible until the 12 second stale timeout clears it automatically.

Current impact:
This is a transient collaboration UI/presence issue only. It does not affect data correctness, persisted reorder results, RPC behavior, migrations, or Timeline item contents.

Current mitigation:
Phase 4.8c has already added immediate `onDragEnd` / cancel drag clear behavior, including local drag cleanup and `timeline-drag-clear` broadcast before confirmation or RPC flows. The stale timeout still provides a fallback if the remote client misses the clear.

Next step:
Do not block Phase 4.8e. If the frequency increases, investigate broadcast clear reliability, channel lifecycle, and `dragId` / `sessionId` matching around repeated drag sessions.

---

## BUG-001 | Luggage draft restore risk

Priority: P2
Status: Not reproducible currently

Original concern:
Personal/shared luggage draft restore may fail because luggage forms are always open and use `useDraftAutosave` with `isOpen: true`.

Current manual testing:

* Tab switch OK
* App switch OK
* Shared/personal switching OK
* Add/edit flow OK

Reason for keeping:
Complex form lifecycle and always-open draft logic may still contain edge-case restore issues after future refactors.

---

## BUG-002 | Budget/Actual lock release timing

Priority: P2
Status: Not reproduced

Concern:
Lock may release before all child mutations finish.

Risk:
Another collaborator could edit during partial save failure.

Notes:
Needs real multi-user testing.

---

## BUG-003 | Edit lock race condition

Priority: P3
Status: Not reproduced

Concern:
Two users may acquire the same lock during near-simultaneous edit attempts.

Notes:
Likely requires extreme timing or real concurrent sessions.

---

## BUG-004 | Realtime active edit refresh risk

Priority: P2
Status: Partial risk only

Concern:
Realtime broad reloads may create stale editing context.

Current behavior:
Local form state appears preserved during current testing.

Needs:
More multi-user testing.

---

## BUG-005 | Timeline draft restore day mismatch

Priority: P2
Status: Not verified

Concern:
New Timeline drafts are not tied to a specific day.

Needs:
Day-switch + reload testing.

---

## BUG-007 | Demo luggage flow divergence

Priority: P3
Status: Needs observation

Concern:
Demo flow may drift from formal flow over time.

Notes:
No confirmed user-facing issue currently.

---

## BUG-008 | Demo browser history desync

Priority: P3
Status: Not verified

Concern:
Browser Back/Forward may desync Demo route and visible section.

---

## BUG-009 | Demo/Form UI parity drift

Priority: P2
Status: Architectural risk

Concern:
Separate `DemoLuggageView` may drift from formal `LuggagePanel`.

Current behavior:
No major visible divergence yet.

---

## BUG-010 | Edit lock release on browser close

Priority: P3
Status: Known limitation

Current behavior:
Locks depend on timeout after abrupt tab close.

Notes:
May be acceptable during MVP stage.

---

## BUG-011 | Demo mobile nav spacing

Priority: P3
Status: UX improvement

Description:
Demo mobile bottom nav uses 5-column layout with only 3 buttons.

---

## BUG-012 | Luggage draft clearing scope

Priority: P2
Status: Not reproduced

Concern:
Saving one luggage item may clear unrelated luggage drafts.

Needs:
Multiple draft testing.

---

## BUG-013 | Realtime cross-trip reload risk

Priority: P3
Status: Not verified

Concern:
Some listeners are not trip-filtered.

Needs:
Multi-trip session testing.

---

## BUG-014 | Mobile form density

Priority: UX
Status: Improvement candidate

Description:
Timeline/Budget forms are still desktop-heavy on small screens.

---

## BUG-015 | Conflict UX clarity

Priority: UX
Status: Improvement candidate

Description:
"View latest" flow may feel abrupt and lose context.

---

## BUG-024 | npm audit reports vite/esbuild vulnerability

Priority: Security backlog
Status: Backlog

Description:
`npm audit` reports a vite/esbuild vulnerability after Playwright setup.

Decision:
Do not run `npm audit fix --force` during Phase 1.7F because it would upgrade to Vite 8 and may introduce breaking changes.

Next step:
Plan a dedicated dependency upgrade pass with Vite migration testing.

---

# Closed / Cannot Reproduce

## BUG-006 | Shared luggage blank submit

Status: Cannot reproduce currently

Original concern:
Shared luggage could be submitted with empty title through Enter submit path.

Current testing:

* Empty title
* Enter key submit
* No item created

Result:
Issue not reproducible currently.

Keep observing after future refactors.
