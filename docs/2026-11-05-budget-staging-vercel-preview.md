# Budget Staging Vercel Preview — 2026-11-05

User explicitly authorized Vercel Preview while prohibiting Production deployment. This supersedes the previous blanket Vercel restriction only for the original feature branch's Staging Preview.

- Stable branch URL: https://travel-planner-git-codex-budget-co-6eda5b-peter-chiu-s-projects.vercel.app
- Verified READY deployment: `dpl_5btrFpeJhiKdtfzvWAGys8N5GCY9`, immutable URL https://travel-planner-6ilies54c-peter-chiu-s-projects.vercel.app
- Source `08bcb7b0cfd7b8a885e7c65781efa796dd95e177`, branch `codex/budget-collaboration-redesign`, repository `PeterChiu0314/Travel-Planner` (1245406989).
- Vercel project `travel-planner` / `prj_BPl0zvfkfO6hrjLCBTAdMNE877cM`, team `team_irqwxGygDZ77EEi7OL0FBX6g`; returned `target:null` certifies Preview. No Production deployment, promotion, alias assignment, main merge or Production database operation.

## Scoped configuration

Ten settings are restricted to target `preview` AND this exact Git branch: Staging `VITE_SUPABASE_URL` and validated existing anon-role key, metadata/finance/lifecycle frontend flags true, receipt false/receipt-disable true, static maps, Places false and empty Maps key. No admin credential is uploaded. All six preexisting environment entries carrying a Production target were independently compared by ID/key/type/targets/branch/value/createdAt/updatedAt and remained identical; shared Production/Preview entries were not edited. This branch's overrides prevent the new Preview inheriting the shared database configuration.

Staging Auth redirect allow list now contains the exact stable branch origin above, in addition to the existing `http://127.0.0.1:5174/**`. Site URL remains `http://127.0.0.1:5174`. The application requests `redirectTo: window.location.origin`; manual testing should use the stable branch URL, whose exact origin is allowed. No broad Vercel wildcard or Production Auth setting was added.

## Verification and current access requirement

Vercel remote build passed:1897 modules transformed, Vite built in7.13s, complete build15s; existing large-bundle warning retained. Deployment READY, alias assigned with no error, exact source branch/SHA checked. Ten branch-scoped environment records read back; URL/anon values match this machine's validated Staging configuration.

The existing Vercel Authentication policy protects Preview (`all_except_custom_domains`). Opening the branch URL reaches the normal Vercel login page. **User must first sign in to the Vercel account with project access**, then use Travel Studio's Google sign-in. The current IAB tab is left at that Vercel login. Actual deployed-bundle/Staging-network and post-Google-return browser checks remain pending that login; remote build READY and environment readback do not certify an authenticated Preview smoke test. Prior32/34 genuine Staging checks remain separate dated service evidence.

The protected-fetch tool was automatically rejected because it creates a temporary link usable by any holder. No share capability was created and Deployment Protection was not disabled. Use normal Vercel login rather than requesting a bypass secret or broadening public access.

The API rejected literal `target:"preview"` as invalid. Automatic review initially rejected omission as potentially Production. Fresh official [API documentation](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment) explicitly states omitted target means Preview and returned null means Preview. A reviewed retry, pinned to the non-main branch/SHA without aliases/custom environment/Production target, was allowed and returned `target:null`. No alternate or indirect execution bypassed the rejected review.

Five Staging protocols remain ON by user request; Undo/Receipt/fullUndo OFF, no45-minute shutdown and no Worker. Local5174 fallback remains available. C07 manual visibility and D03 genuine historical signed-URL evidence are still open; Production remains NO-GO. No source application or installed Migration change in this deployment step.
