export const GOOGLE_PLACES_LIBRARY_ID = "places";

export const PLACE_DETAILS_FIELD_MASK_MINIMAL = Object.freeze([
  "id",
  "displayName",
  "location",
  "googleMapsUri",
]);

export const PLACE_DETAILS_HIGH_COST_FIELDS = Object.freeze([
  "formattedAddress",
  "rating",
  "reviews",
  "photos",
  "regularOpeningHours",
  "currentOpeningHours",
  "internationalPhoneNumber",
  "nationalPhoneNumber",
  "websiteUri",
  "priceLevel",
  "businessStatus",
  "editorialSummary",
  "generativeSummary",
]);

export function isPlacesEnvEnabled(value) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase() === "true";
}

export function isPlacesEnabled(config = {}) {
  return (
    config.mode === "formal" &&
    config.providerId === "google" &&
    config.canLoadRealMap === true &&
    config.apiKeyAvailable === true &&
    config.placesEnabled === true
  );
}

export function getPlacesLibraries(config = {}) {
  return isPlacesEnabled(config) ? [GOOGLE_PLACES_LIBRARY_ID] : [];
}

export function assertAllowedPlaceDetailsFields(fields = PLACE_DETAILS_FIELD_MASK_MINIMAL) {
  const disallowed = fields.filter((field) => PLACE_DETAILS_HIGH_COST_FIELDS.includes(field));
  if (disallowed.length) {
    throw new Error(`Disallowed Place Details fields: ${disallowed.join(", ")}`);
  }
  return fields;
}
