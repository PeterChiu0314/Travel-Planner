# Native budget sidebar footer

User-requested presentation change on the original branch only. Native detail and editor now share a 49px desktop footer, pinned to the bottom, with a full-width top divider and 16px content inset. Existing payment pill, detail delete action and editor save status retain their behavior. Remove the calculation summary's bottom divider, detail edit shortcut, and entire editor heading/close row; the existing tabs remain the navigation path and retain handoff/draft protection.

No financial, DB, lease, rates, permission or payment changes. Issue #21 (self-pay / multiple payers) remains deferred. Protected icon exploration is untouched.

Verification: Browser plugin not available; existing repository Playwright used with static maps and isolated PGlite backend.12 Chromium cases passed across formalExpenseWorkspace, formalExpenseCreation and formalExpenseRestore, including lost acknowledgement, blank creation, participant pricing, peer-held fields, payment, failed autosave and draft continue/discard. Existing close-button test actions now use the detail tab. Build and diff check passed; pre-existing bundle-size warning remains.

Additional temporary rendered geometry checks passed at1157x892 and1440x1000: editor/detail footer left/right match sidebar content edges, footer bottom matches viewport bottom, both heights49px, calculation bottom border0px, removed controls absent. Resized long-note stress case passed with sidebar scrolled to both ends (bottom tolerance <1px). Screenshots inspected. These are local mocked checks, not authenticated Hosted business acceptance; mobile is outside current scope.

Push uses the existing non-production Git Preview integration; no Production/main operation.
