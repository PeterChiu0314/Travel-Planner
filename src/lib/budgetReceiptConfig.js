// Requires the group Snapshot and separate hosted Storage acceptance before activation.
export const budgetReceiptsEnabled=import.meta.env?.VITE_BUDGET_RECEIPTS==='true';
// Explicit release pause also closes the legacy UI/callback path. Default OFF.
export const budgetReceiptsDisabled=import.meta.env?.VITE_BUDGET_RECEIPTS_DISABLED==='true';
export const budgetReceiptUnavailableMessage='收據功能暫未開放。';
export const isBudgetReceiptTarget=type=>type==='actual_expense'||type==='budget_item';
