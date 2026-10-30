// PT409 is a business conflict; old servers and genuine database conflicts may
// still use the legacy codes. Never turn any of these into automatic writes.
export const isBudgetConflict = error => ['PT409', '40001', '40P01'].includes(typeof error === 'string' ? error : error?.code);
