// Local opt-in until the complete protocol has separate hosted acceptance.
export const budgetMetadataEnabled = import.meta.env?.VITE_BUDGET_METADATA_GROUPS === "true";
let sessionId;
export const getBudgetMetadataSessionId = () => sessionId ||= crypto.randomUUID();
// A fresh in-memory document context never resurrects a prior trip/account's Undo.
export const rotateBudgetMetadataSessionId = () => sessionId = crypto.randomUUID();
let documentContext;
export function getBudgetMetadataDocumentSessionId(context) {
  if(documentContext!==context){documentContext=context;rotateBudgetMetadataSessionId();}
  return getBudgetMetadataSessionId();
}
