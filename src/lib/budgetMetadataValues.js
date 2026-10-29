export const metadataGroupKeys = ["title", "note", "category", "payer", "links"];
export const metadataField = group => group === "payer" ? "payer_id" : group;
export const metadataValue = (group, value) => group === "links" ? [...new Set(value || [])].sort()
  : group === "payer" ? value || null
  : group === "note" ? String(value ?? "").replace(/^ +| +$/g, "") || null
  : String(value ?? "").replace(/^ +| +$/g, "");
export const sameMetadataValue = (group, a, b) => JSON.stringify(metadataValue(group, a)) === JSON.stringify(metadataValue(group, b));
export const validMetadataValue = (group, value) => group === "links" ? Array.isArray(value) && value.every(id => typeof id === "string")
  : typeof value === "string" || ["note", "payer"].includes(group) && value === null;
export const recordMetadataValue = (kind, record, group, links = []) => group === "links"
  ? links.filter(link => link.budget_item_id === record.id).map(link => link.itinerary_item_id).sort()
  : record[metadataField(group)] ?? (group === "payer" ? null : "");
