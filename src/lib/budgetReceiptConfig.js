// Removed product surface. Legacy build flags cannot re-enable receipts.
export const budgetReceiptsEnabled=false;
export const budgetReceiptsDisabled=true;
export const budgetReceiptUnavailableMessage='收據功能暫未開放。';
export const isBudgetReceiptTarget=type=>type==='actual_expense'||type==='budget_item';
