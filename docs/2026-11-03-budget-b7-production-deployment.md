# Budget B-7 Production deployment / budget-only reset

2026-11-03 Asia/Taipei. Target `lqvuqamzmchepgxkftcw` only. Branch `codex/budget-collaboration-redesign`, starting HEAD `78306bb7c758dcbba10fc4335e6b28bf4b73f669`.

**Database Dormant deployment COMMITTED; compatible frontend deployed and verified. New B-7 protocols remain OFF.** User subsequently deferred receipts because there is no permanent Worker runtime. The frontend now hides and guards receipt operations. Other new B-7 features still need the separately secured six-protocol execution profile below. No main merge.

## Authorization and scope

The user requested completion of Production deployment, explicitly waived backup/restore because the financial records are test data, and narrowed permission to clear **budget data only**. This supersedes the previous read-only/backup prerequisite for this execution. It does not authorize resetting the entire database or deleting accounts, trips, itinerary, accommodation content or luggage. No backup was made; the intentionally deleted test financial rows are not represented as recoverable.

The user personally reset the Production DB password and supplied it through a masked local input. Passwords/keys/JWTs were neither placed in CLI arguments nor saved to files. The initial read-only helper was stopped before a separate hash-bound deployment executor was supplied. PostgreSQL client17.11, verified Session Pooler5432, project-bound login and `sslmode=verify-full`; psql reported TLS1.3. Backend `pg_stat_ssl=false` describes the pooler-to-database hop, not the TLS client connection.

## Sealed transaction

- [Applied packet](operations/budget-b7-production/candidate/README.md), SHA-256 `8870b5e4c392c9c74e2671c7932033873587ea112417c2d96348e2122f82573e`.
- Local wrapper SHA-256 `ced05679bc2c21f155d9389b714659b31ca2e191968bc74ab10591d46ccc26f4`; `psql -X -w -v ON_ERROR_STOP=1`, one session, packet-owned BEGIN/COMMIT, no `-1`, no split commit or automatic retry.
- [Manifest](operations/budget-b7-production/candidate/packet-manifest.json). The exact17 sources in the prior [source plan](operations/budget-b7-production/migration-plan.json) were installed in order. T0, the Production import alias, old Hotfix and superseded unapplied migration were not replayed. No installed source was edited or backfilled.
- The Production-specific before contract retains all13 real Hotfix hashes, including the previously documented whitespace-only privatize function difference. Stage golden seals remain unchanged. The old48 raw ledger row hashes and every preexisting function body matched fresh reads before execution.
- Strong locks, timeouts, active-editor/concurrent-transaction refusal, exact raw ledger/catalog/RLS/ACL/data checks, normal guarded DELETEs and final preservation checks remained intact. No TRUNCATE/CASCADE reset, trigger disabling, RLS bypass workaround or extra grants were used.

## What was cleared / preserved

Normal DELETE removed17 budgets,29 budget participants,3 Actuals,7 Actual participants,12 itinerary-budget associations,4 Baselines, and budget-only lease/selection/request/signal state. Payment history and Source Origin lived in the explicitly disposable Actual graph and were deliberately removed with it. No Storage bytes existed and none were deleted. Receipt metadata was empty; the packet would refuse a metadata-only receipt reset if any existed.

Preserved7 trips,7 Auth accounts,12 memberships,123 itinerary items, accommodation content and luggage. The accommodation budget backlink may become NULL through its existing FK, with its normal update timestamp; all other accommodation columns are sealed. Eighteen independent non-budget/Auth/Storage relation projections matched before/after. Trip rates and other trip fields were not reset. Private runtime tables are not mistaken for permission to clear unrelated data.

## Independent readback

Each readback uses a new psql connection, not the transaction response:

| Check | Result |
| --- | --- |
| psql exit0 / explicit COMMIT | Passed |
| Ledger48→65 / Head20261101032853 | Passed |
| Original48 raw rows /17 complete source hashes | Passed |
|38 final B7 hashes /54 PT409 /24 PT500 | Passed |
| Unknown custom business40001 |0 |
| Public and private application base-table RLS | ON |
| Worker role | NOLOGIN / NOINHERIT / NOBYPASSRLS, no superuser/CREATEROLE |
| Worker SET route | authenticator SET-only; existing Storage→authenticator path retained |
| Worker/private table direct grants | None |
| Worker table grants | Storage buckets SELECT; objects SELECT/DELETE only |
| Seven protocols / full Undo / three latches | All false |
| Storage/content/cleanup readiness | All false; no manufactured expiry |
| Receipt queues / legacy-cutover journal |0 /0 |
| Non-budget relation fingerprints |18/18 unchanged |

All277 application function names are present as on the Stage reference. Five historical body differences from Stage remain: three membership/owner helpers, the private itinerary swap helper and the known privatize formatting difference. Each matches the original Production body; this deployment did not rewrite them. This is not a claim that all277 bodies equal Stage or that Production authenticated E2E has passed.

The fresh Catalog identified a Managed Storage update: migration74 `unlock-object-versioning`, executed before this deployment, removed `buckets_versioning_dark_check` and added the managed version-transition trigger. Bucket remains Private, versioning DISABLED,10MiB and the same four MIME types. SQL presentation/Windows output encoding differences were resolved by DB-side Base64 for exact metadata, not by weakening hashes. Original seals were retained; no unknown application drift was accepted.

Managed Security Advisor was actually rerun through Dashboard (connector denied this project): **0 Errors /10 unchanged Warnings /24 Info**, formerly2 Info. All24 Info entries are private RLS-enabled/no-policy tables; the22 additional entries implement intentional deny-all direct access. Actual private grants were separately checked. Nine existing signed-in definer API warnings and leaked-password protection warning remain; none was suppressed/reset. PG17.6 security-upgrade triage remains an existing operational item, not an engine upgrade performed here.

## Tests and limits

- New isolated PostgreSQL17.11 packet regression **12/12**: target/body/raw-ledger/catalog/data drift refusal, real peer writer/active-editor refusal, late-error atomic rollback of financial rows/schema/role/ledger, successful reset+17-source commit, old48/source preservation, final38/error classes/sevenOFF, replay refusal. Managed Supautils permissions and HTTP are not simulated as passed.
- Production signing adapter cryptographic tests **4/4**: exact project/role/signature/900-second TTL and stop/secret-buffer clearing. No prior Stage Auth/Storage/Worker suite rerun.
- A real Production dedicated Worker JWT reached PostgREST `claim_budget_receipt_worker`: HTTP200/null on verified empty queue, role `budget_receipt_worker`, exact Production ref,900-second TTL, anon API key; service_role was not used as Worker. This proves the narrow role/API capability only. It does **not** prove bytes, claim headers, real cleanup, restart, durable retries or scheduling readiness.
- Local Production compile passed; original >500kB bundle warning remains. Syntax and diff checks apply to changed tools. Local compile is not evidence of Vercel's deployed environment binding.

See [sanitized execution evidence](qa/2026-11-03-budget-b7-production-deployment-results.json). Raw catalogs/logs and all credentials remain outside tracked files.

## Frontend release and safe closeout

Production READY deployment `dpl_2AwcVUpbqvENCEFQG2UvVaRrNo1j`, source `85a72095cfc6a2109eedf7238c9a084e31e78303`, serves [Travel Studio](https://peter-travel-planner.vercel.app). Released directly from the feature branch; main stays unchanged. The five Budget enable flags remain absent/defaultOFF. Production-only `VITE_BUDGET_RECEIPTS_DISABLED=true` compiles the receipt pause: Formal upload/open/delete entry points refuse and show「收據功能暫未開放。」; there is no legacy upload fallback. Demo remains local. This is a client pause, not proof that all old client/server receipt paths are fenced.

Actual fresh anonymous Chrome release smoke passed: root login, Demo→Timeline→Budget→search, correct Production endpoint/no Staging binding, no console errors or failed resources, Demo Supabase requests0. Favicon was a genuine404 in the first release; a local brand SVG fixed it, final HTTP200. Three directly affected local mocked UI checks passed (both paused paths and enabled Receipt regression); these do not certify authenticated Production E2E.

Last independent Production read at `2026-11-02T17:32:10Z` used a new Dashboard **READ ONLY SELECT**, after native helpers exited: ledger65/Head20261101032853,38final hashes,54PT409/24PT500/0custom40001, all18 original non-budget projections exact, sevenOFF/threeFALSE/readinessFALSE, queues/leases0. Counts remain7trips/7users/12members/123itinerary; budgets/Actual/Baselines/attachments/Storage objects0. RLS/ACL/Advisor evidence above is the earlier independent post-COMMIT audit, not a falsely claimed later psql run.

Native Windows audit at `2026-11-02T17:49:48Z` found0 known credential-helper/QA Browser/Vite matches and0 listeners on5188/5189. The final native read request was never consumed and has been quarantined locally; stale status files are not treated as live connections. No Production QA Auth accounts/sessions were created, no scheduler was installed, no credentials were persisted. The new native candidate cluster also stopped normally.

Public Git contains sanitized evidence and source tools. The full executable packet/live before-contract remain ignored local artifacts. An initial publication containing that live packet was rejected by automatic review; the unpublished commit was replaced with this sanitized publication, which was accepted. No sensitive archive was pushed.

## Remaining release gates — receipts deferred

1. **P1 non-receipt release boundary:** installed legacy Receipt metadata guard does not fence writes before its own latch. A new [non-auto candidate](operations/drafts/budget-receipts-deferred/README.md) adds a separate deferred-Receipt fence, retaining all existing bodies;10/10 isolated native checks passed. It is **not installed**, not real Auth/Storage HTTP acceptance, and not an approved operational Activation packet. Build a hash-bound managed wrapper, six-protocol Preflight/Activation/Pause and prove real Production denial/smoke before enabling the other features. Current native credential sessions are gone, so live execution requires new masked supply later.
2. **Deferred receipt operating gates:** permanent Worker renewal/runtime/two-cycle evidence and Production legacy issuer-stop/invalidation remain unverified. They are required for future receipts, not a blanket reason to block a properly isolated non-receipt release. RAM-only permission does not authorize hosted persistence; no key rotation, fake readiness/expiry or service-role Worker substitution.
3. **Pending real Production E2E:** ordinary-JWT two-user financial smoke and observation window for the six-protocol release; full receipt lifecycle remains deferred. No readiness or irreversible latch was enabled to obtain passing tests.
4. Existing P2 Stage hardware/accessibility/oversize-transport limitations and bundle warnings remain recorded. PG engine security triage is still open.

Dormant database and compatible frontend: **GO / completed**. New non-receipt B-7 Activation: **NO-GO / not executed** pending the safe profile and real smoke above. Full receipt enablement is explicitly deferred. No urgent operator action is needed tonight. Pause/repair must retain future latches/history/requests once enabled; never replay this reset or restore committed finance from an old snapshot.
