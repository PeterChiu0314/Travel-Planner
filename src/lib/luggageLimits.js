export const luggageTitleLimit = 30;
export const luggageNotesLimit = 100;

// Keep legacy/restored content intact, but require a valid length before saving.
export function luggageLengthError(form) {
  if ((form.title || "").length > luggageTitleLimit) return `項目名稱最多 ${luggageTitleLimit} 字，請縮短後再儲存。`;
  if ((form.notes || "").length > luggageNotesLimit) return `備註最多 ${luggageNotesLimit} 字，請縮短後再儲存。`;
  return "";
}
