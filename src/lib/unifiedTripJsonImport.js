import { buildFormalTripJsonFromAiDraft } from "./aiItineraryAdapters.js";
import { aiItineraryDocumentType, parseAiItineraryText } from "./aiItineraryContract.js";
import { parseTripJsonText, tripJsonDocumentType } from "./tripJsonContract.js";
import { hasValidMapPoint } from "./mapPoint.js";

function uniqueIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.path}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readDocumentType(text) {
  if (typeof text !== "string") return null;
  try {
    const document = JSON.parse(text);
    return document && typeof document === "object" ? document.document_type : null;
  } catch {
    return null;
  }
}

export function parseUnifiedTripJsonText(text) {
  const documentType = readDocumentType(text);
  if (documentType !== aiItineraryDocumentType) {
    const result = parseTripJsonText(text);
    return {
      ...result,
      sourceDocumentType: documentType === tripJsonDocumentType ? tripJsonDocumentType : documentType,
    };
  }

  const aiResult = parseAiItineraryText(text);
  const formalResult = aiResult.document ? buildFormalTripJsonFromAiDraft(aiResult.document) : null;
  const errors = uniqueIssues([...(aiResult.errors || []), ...(formalResult?.errors || [])]);
  // Successful duration continuation is normal for an AI draft, not a problem
  // the user needs to fix. Keep unsafe continuation and all real warnings.
  const warnings = uniqueIssues([...(aiResult.warnings || []), ...(formalResult?.warnings || [])])
    .filter((issue) => issue.code !== "duration_auto_scheduled");
  if (formalResult?.ok) {
    const destinations = formalResult.document.days.flatMap((day) => day.visits.flatMap((visit) => [visit, ...visit.alternatives]));
    const missingCount = destinations.filter((visit) => !hasValidMapPoint(visit.location)).length;
    if (missingCount) warnings.push({ code: "missing_coordinates", path: "$.days", message: `尚有 ${missingCount} 個目的地缺少可用座標` });
  }

  return {
    document: formalResult?.document || null,
    errors,
    migrations: aiResult.migrations || [],
    ok: Boolean(aiResult.ok && formalResult?.ok && formalResult.document),
    sourceDocumentType: aiItineraryDocumentType,
    warnings,
  };
}
