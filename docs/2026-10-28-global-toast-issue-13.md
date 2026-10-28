# Issue #13 — Unified notifications

Implementation baseline: `codex/luggage-workspace-redesign` at `d9f57ec`. Read the current [issue #13](https://github.com/PeterChiu0314/Travel-Planner/issues/13), its empty comment thread, AGENT, CURRENT_TASK and DESIGN before implementation. The user subsequently requested committing/pushing the reviewed implementation, tests and handoff to this feature branch. No new hosted data operation, migration execution, issue update/closure, main merge or manual frontend deployment accompanies publication; Preview CI triggered by a branch push is not verified here. The separately authorized #14 migration application remains recorded in CURRENT_TASK and its rollout tooling/record is committed separately as `b2dfb3e`.

## Impact review and decisions

- The Formal App previously retained one `notice` string, rendered both below TripHeader and on Login. Numerous operations assigned raw errors; failed cache reads and Budget refresh used the same state. It occupied document layout and could displace Workspace. Local inline `.notice.inline-error`, member/share dialogs, `useSiteDialog` and Demo's mode label have different jobs and remain.
- Adopted **Sonner 2.0.8**, exact dependency and lockfile version, MIT, compatible with React/ReactDOM 18. Sonner owns stacking, dismissal and animations. No new UI framework, homemade queue, timer service or other runtime dependency. Confirmed package metadata via npm and the installed package.
- One `AppToaster` at the root covers Formal, Login and Demo. One `notify` module centralizes success/info/warning/error semantics, friendly transport copy, repeated-message IDs and durations: 3.5s / 5s / 7s / persistent error. Global transport failures share `app-data-sync`; unrelated messages can coexist and close independently.
- Paper/ink/green/copper surfaces follow existing tokens, with colored icons and slim edges instead of saturated panels. Fixed bottom-center placement creates no document height. Mobile reserves 100px plus safe area; visualViewport keyboard inset raises the stack and limits visible toasts to one. Long messages scroll inside bounded cards; dismiss buttons stay within the card. Alt+T enters notifications, Esc returns to the original control; Sonner's polite aria-live and reduced-motion remain.

## Network and recovery semantics

- `Failed to fetch` / NetworkError / offline are normalized. A browser-reported offline state says 網路連線中斷; transport failure while `navigator.onLine` remains true says 資料同步暫時失敗. A cache fallback also states that cached data is being displayed. Device connectivity is not inferred solely from a failed fetch.
- A small observer tracks failed trip-list, full-trip, Budget, personal/shared Luggage and existing data-channel sources. Repeated failures update one stable toast only when its copy changes. Dismissing is respected; no new polling/subscriptions. Retry invokes existing reads; no mutation replay.
- Online/focus alone cannot announce recovery. Channel SUBSCRIBED clears only the channel failure, while existing scoped Budget/Luggage rejoin reads must actually finish. Retry reuses their existing coalesced scheduling. A closed or departed channel callback cannot publish a late warning.
- Authoritative successful callbacks include a notification checkpoint captured when the read started. A response started before a later failure cannot certify that failure; stale account/trip generations and invalidated scoped reads cannot clear it. Cache installation is not verification. Every failed source must recover; a successful Budget read cannot hide a Luggage or API failure.
- No Timeline Presence/Broadcast/route/map architecture change, schema change or new background financial read. The optional `onVerified` hooks in existing refresh controllers observe their already accepted results. Ordinary successful Realtime bursts retain the measured one Budget snapshot and existing two Luggage rejoin reads.

## Inline errors and compatibility

- Budget Save validation, optimistic conflicts, lease loss and payment failures stay in the form/detail. Their transport copy is friendly; input and leases retain existing behavior. Receipt registration/deletion errors return through the existing inline receipt alert without a duplicate Toast. File-storage sequencing and payment/receipt rules are unchanged.
- Timeline schedule failure originating in its open editor keeps the existing inline result; other action entry points keep notification feedback. Other existing global Notice call sites now use typed notifications, including import success and membership-request info. Local dialogs and field errors are retained rather than indiscriminately converted.
- Luggage action failures remain inline with normalized transport copy and retained input. Only scoped refresh failures contribute to the shared sync notification. Demo has no Formal notification listeners, Auth/Storage/Realtime subscription or hosted request introduced by this UI. Its existing local dialogs remain intact.
- The Formal luggage test harness now mounts the same Toaster as the real root. Older cache tests assert the floating cached-data message instead of the removed Header Notice. Financial and privacy assertions remain.

## Verification

Flow: Formal read/connection failure → one floating notification, unchanged table bounds → retry/reconnect → all required authoritative reads → short success; Login failure uses the same component; Demo semantic notifications retain local-only behavior.

Browser plugin/skill is not available; used the repository Playwright runner with installed Chromium and an isolated Vite server at `http://127.0.0.1:5175`. All Formal tests intercept Supabase with isolated mocks. Desktop 1440×1000 and narrow 390×1000 screenshots cover positioning; visualViewport is simulated for keyboard behavior. No physical iOS/Android/PWA, real screen-reader speech or hosted dual-account evidence is claimed.

Final five separate-process batches: **200/200 passed**, no flaky/retried/skipped cases: notifications 16, sync/cache/rates 39, leases/receipts/collaboration/editor 42, Demo/financial/luggage/dialogs 73, Timeline/routes/smoke 30. `npm.cmd run build` and `git diff --check` pass. Initial broad runs exposed stale permission-warning tracking and an additional reconnect reload; both were fixed and the affected groups rerun. A long multi-page run also hit the previously observed Chromium `ERR_NO_BUFFER_SPACE`; final groups use separate browser processes. Native required-field validation, Sonner's container-level keyboard focus and automatic recovery before a retry click are tested according to the actual control behavior.

Build before/after (Vite normal production output, decimal kB):

| Asset | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Main JS | 1,034.40 | 1,076.47 | +42.07 |
| Main JS gzip | 310.71 | 322.30 | +11.59 |
| CSS | 187.94 | 189.56 | +1.62 |
| CSS gzip | 31.59 | 31.92 | +0.33 |

Lazy map chunk remains approximately 44.20kB / 14.47kB gzip. Existing >500kB main-bundle advisory remains. No unrelated package upgrades/audit fixes or bundler restructuring.

Evidence outside the repository in this chat's visualization directory: `toast-{1440,390}.png`, and final notification/sync/lease/Demo/smoke JSON results. Checks cover page identity, meaningful content, no Vite overlay, console health, actual interactions, no layout shift, Demo isolation, independent dismissal, timing, focus, reduced motion and simulated keyboard bounds.

References reviewed: [Sonner](https://sonner.emilkowal.ski/), [package and React peer compatibility](https://github.com/emilkowalski/sonner/blob/main/package.json), [Supabase guidance on Toast vs inline feedback](https://supabase.com/design-system/docs/components/sonner). The Liveblocks reference exceeded the web parser's size limit; this implementation does not use Liveblocks.
