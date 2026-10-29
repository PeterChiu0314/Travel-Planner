// Local opt-in until the complete protocol has separate hosted acceptance.
export const budgetMetadataEnabled = import.meta.env?.VITE_BUDGET_METADATA_GROUPS === "true";
let sessionId;
export const getBudgetMetadataSessionId = () => sessionId ||= crypto.randomUUID();
