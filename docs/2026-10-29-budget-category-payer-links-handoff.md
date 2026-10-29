# Issue #15 — Category / payer / links collaboration

Baseline: `b1faa884b3a12313116afa21bd62d2abdaf0e3bc`; branch `codex/budget-collaboration-redesign`. Read Issue #15 (no comments), AGENT, CURRENT_TASK, root DESIGN (there is no docs/DESIGN.md), UX_RULES, B-1, B-3 and Undo DB handoffs. This continuation is local only; no hosted connection, migration, protocol activation or main merge is authorized.

## Dependency matrix and chosen boundary

| Record / operation | Effects and dependencies | This slice |
| --- | --- | --- |
| Unlinked, nonfixed Budget category | category only; preserve legacy subcategory, money, participants, payer, links | Support |
| Standalone manual Actual category | category only; preserve known debit, FX, provenance, receipts | Support |
| Unlinked Budget / standalone manual Actual payer | payer_id only; null allowed by existing business model; nonnull must be approved trip member; membership protected through commit | Support |
| Budget links | entire deduplicated, UUID-sorted same-trip itinerary ID set; parent + affected itinerary rows protected; child writes atomic; independent revision, opaque signal | Support on otherwise supported Budget |
| Actual links | no independent itinerary link model | Reject |
| Single retained Actual category/payer (including inactive payment) | Budget + Actual same-group bundle, topology/dependency version, legacy financial trigger effects | Safely reject acquire and patch until financial bundle exists; no partial write/fallback |
| Multiple retained Actual / fixed / backlink / linked Actual / nonmanual Actual | unresolved financial/source graph | Safely reject |
| Price, currency, participants | pricing bundle, atomic allocation | Existing full editor only; no new group API |
| Payment/source/receipt/date/rate/legacy operation | may change support, topology, historical costs or Undo dependency | Retain existing guards and conservative Undo fencing |

The original save v1-v4 paths replace broad rows/joins and synchronize single payments; they cannot be used to implement these narrow patches. The Actual cost trigger marks edits manual: only standalone manual Actual is admitted so provenance remains unchanged. No parent pricing/participant writes are needed for supported category/payer. Links modifies only itinerary_budget_items; financial snapshots and Timeline must read the committed collection. External child mutations must advance links revision even with no new lease, including cascade deletion. New groups are not Undo operations; safe unrelated title/note history survives, while legacy/dependency boundaries remain fenced.

## Implemented contract

Forward migration extends the existing private group state, admission, exact-effect whitelist and request ledger. A new schema-v2 snapshot reader keeps old reader contracts available. New group values are category string, payer UUID/null, links sorted UUID array; client/controller use structural equality. All linked-payment cases remain explicit unsupported. Reuse MenuSelect and existing ItineraryPicker; no dependency, parallel state manager or channel. Existing one-transport queue, 10s Snapshot deadline, exact release, 2m/10m idle, guard and memory-only Demo remain the lifecycle owner.

Migration [20261029114817_budget_category_payer_links_groups.sql](../supabase/migrations/20261029114817_budget_category_payer_links_groups.sql) was generated with CLI 2.106.0 `migration new`. It changes only forward definitions; every prior migration is unchanged. New `read_budget_metadata_snapshot_v2` declares schemaVersion=2 and the five protocol keys. Budget records have five groups, Actual four (no links); old snapshot/state readers keep schema v1 and title/note output. Metadata private state still uses RLS with no client table grants or publication; new reader is STABLE/invoker/authenticated-only. Private value helper is not directly executable by clients. Enabled state remains the existing admin-only, default-disabled protocol.

Category patches only category, preserving subcategory. Payer maps to payer_id, accepts null, and locks approved target membership through commit. Both preserve financial row fields, joins and manual Actual provenance. Links canonicalizes the complete UUID collection, protects parent, existing child rows and target itinerary rows with NOWAIT, checks same-trip membership and atomically inserts/deletes only differences. Exact effect guards cover children; a deferred unfinished-effect constraint and final full-collection comparison prevent partial commits. Changed collection has one group revision even if several child rows change; external child DML/cascade changes advance its version too. Same request replay returns original result, not another replacement. Opaque signals and the existing financial snapshot feed Budget/Timeline labels and statistics; no new channel or per-keystroke DB heartbeat.

New group operations return before Undo capture/stack push. They do not masquerade as legacy operations or clear another tab's safe text lineage. Exact supported links effects skip only the legacy dependency invalidator for that transaction/parent; raw/legacy links, participants, rates, permissions, financial/source/receipt changes retain conservative fencing. New category/payer/links Undo is not enabled. The older legacy-origin-tab and noncanonical-before-image limits still apply.

The [local reverse](qa/2026-10-29-budget-choice-groups-rollback.sql) requires a disabled protocol, no active lease/effect and no successful new-group request. It restores prior function definitions and removes only unused additions without CASCADE or financial rollback. After any successful new-group write, use forward repair; never erase its replay evidence. Native tests prove injected migration failure, dormant reverse and complete original business content preservation.

## Changed files and frontend behavior

| Area | Files / behavior |
| --- | --- |
| DB | New migration and reverse above; extends existing admission/prepare/finish/row/child guards and Undo boundary functions; adds v2 snapshot/value/links tracking |
| Value/controller | `src/lib/budgetMetadataValues.js`, `budgetMetadataService.js`: typed category, nullable payer and normalized links arrays; structural comparison, per-tab restore/exact unknown replay, immediate valid choices, serial queue, preserved 10s deadline and idle/lease rules |
| Shared UI | `BudgetMetadataEditor.jsx`, `BudgetWorkspace.jsx`, `budget-page.css`: reuse existing category/member MenuSelect and ItineraryPicker, focus authority, pending intent/readOnly/editor hints, custom-category debounce/IME, full-set links, complete-editor handoff |
| Shared menu | `MenuSelect.jsx`: optional readOnly, input events and scoped portal behavior; existing callers retain their one-argument selection contract and their prior behavior |
| Integration | `budgetSync.js`: opts into v2 reader; missing API allows financial read-only fallback and no group writes. `App.jsx`: Demo updates only requested field or whole links collection |
| Demo | `src/demo/budgetMetadata.js`: same typed protocol/controller/UI in memory; canonical collection overlay waits for React props to catch up; no Auth/network/storage/draft persistence |
| Tests | New choice SQL cases, controller cases, Formal/Demo rendered cases; extends original native runner and mock; old assertions retained |

During verification, fixed null first-payer intent (null must not be mistaken for absent staged input), the Demo immediate-ACK/React-commit collection mismatch, and optional custom-category IME/paste/keyboard forwarding. Unexpected editor unmount releases every created group, including groups added after snapshot readiness. Valid choices submit immediately; custom text waits one second/blur and compositionend. Native text Undo remains unchanged; Ctrl+Z is not intercepted.

## Verification / delivery

| Layer | Result / boundary |
| --- | --- |
| Native PostgreSQL 17.11 | **83/83**, original 66 retained plus 17 additions; **32** actual overlap/held-lock observations, five new. Includes category/title, payer/note, same category contention, links/title and child-row NOWAIT; actual JS adapter/controller uses v2 SQL. No hosted service |
| Metadata SQL | **23/23** original sequential PGlite cases |
| Undo SQL | **28/28** original PGlite cases; original native Undo cases also retained |
| Existing DB suites | budget-database, budget-safety-database, budget-leases-database pass with the full new migration chain; lease suite uses the documented LF-normalized disposable mirror for historical raw-SHA checks |
| New controller | **11/11**, typed arrays/null, immediate/no-op, queue, exact replay, invalid payer, restore without capability, Snapshot deadline and late read isolation |
| Frontend regression | Final complete batch **263/263**: original metadata controller45/UI45, new choice controller11/UI9, smoke30, Budget/financial/lease/sync/rates/receipt/notifications/menu coverage. Final choice UI/menu follow-up **11/11**, overlapping cases, not added to the total |
| Build / syntax / diff | Passed before final publication checks; existing large-chunk advisory remains |
| CLI Advisors / migration-list | Loopback-only attempts at native run `03bba2a0-787b-4e23-9097-f440b6f4236c` failed because CLI requested TLS despite sslmode=disable; targeted SQL RLS/grants/catalog passed. No full Advisor certification |
| Hosted / device | Not performed; no migration, data, protocol or deployment operation |

Final native run `17ae5838-fb45-4546-a34e-b2d80c56fd1c`, loopback `127.0.0.1:50935`, two distinct LOGIN/backend/JWT actor/tab sessions plus observer. READ COMMITTED, bounded statement/lock timeouts and advisory gates with `pg_stat_activity`/`pg_blocking_pids`; no fixed sleeps used as concurrency proof. Cluster stopped in runner finally; binaries/node_modules/clusters/raw logs remain ignored. Machine-readable results and source hashes: [QA evidence](qa/2026-10-29-budget-choice-groups-results.json).

Browser plugin not available; used existing Playwright/Chromium at `http://127.0.0.1:5180`, desktop 1440×1000. Formal uses isolated Auth/RPC/Realtime/Storage mocks; Demo uses real shared UI with memory transport and asserts zero external service requests. Page content/identity, no Vite overlay, strict console checks, selections and committed canonical readback are asserted. Screenshot in this chat's visualization folder: `budget-choice-links.png`; readable fields/no clipping, links selected on one tab and visible on another. Initial localhost timeouts were resolved by running Vite/browser in the same permitted local environment; no console assertion was relaxed. An initial locator assumed a button combobox was an input, and one note fill needed focus before authority; tests now follow the actual controls. Native bootstrap also caught a generated dollar-quote replacement issue before delivery; fixed only the new migration, then reran migration/reverse/full SQL checks.

An earlier complete batch passed261/262: the original two-client title/note case timed out waiting for note. Its original assertions were retained. After stopping product edits, the whole final batch passed263/263 (one extra collection-timeout controller case added). The prior transient failure's root cause is unproven; the passing rerun is not presented as a diagnosed fix. Final menu/native composition Enter follow-up is recorded separately and overlaps existing coverage.

```powershell
# Native runtime is separately installed and never points to hosted.
node scripts/qa/run-budget-metadata-parallel.mjs
$env:PGLITE_MODULE=(Resolve-Path '.tmp-budget-db-runtime/node_modules/@electric-sql/pglite/dist/index.js').Path
node tests/budget-metadata-groups-database.mjs
node tests/budget-metadata-undo-database.mjs
node tests/budget-database.mjs
node tests/budget-safety-database.mjs
# Run lease suite from the LF disposable source mirror when the historical SHA guard rejects CRLF.
$env:VITE_BUDGET_METADATA_GROUPS='false'
npm.cmd run dev -- --host 127.0.0.1 --port 5180 --strictPort
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5180'
node node_modules/@playwright/test/cli.js test tests/budgetMetadata.spec.js tests/budgetMetadataChoices.spec.js tests/formalBudgetMetadata.spec.js tests/formalBudgetMetadataChoices.spec.js --workers=1
npm.cmd run build
git diff --check
```

## Remaining activation gates

Default-off flag and dormant DB protocols remain off. Single-retained category/payer atomic synchronization is **not implemented**: admission and patch both reject it, leaving both rows unchanged. This is the required safety outcome until DB-resolved financial bundles and graph versions exist. Multiple payments/fixed/backlinks, pricing/participants, payment/source/receipt protocols, Storage byte protection, blank creation, Undo client/keyboard and full mixed-client activation remain separate. Real PostgREST/Realtime, physical IME/background throttling and device/screen-reader acceptance remain unverified. Review this slice before any activation. User authorized commit/push only to `codex/budget-collaboration-redesign`; no main merge or issue change.

The feature-branch push may trigger automatic Preview CI; its readiness and Production deployment are not verified by Git publication. No manual deployment or hosted API call was performed.

Implementation follows [Supabase function security](https://supabase.com/docs/guides/database/functions); [current changelog](https://supabase.com/changelog) was checked (Markdown index unsupported). No SDK/CLI/dependency upgrade was made.
