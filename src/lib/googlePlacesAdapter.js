import {
  assertAllowedPlaceDetailsFields,
  PLACE_DETAILS_FIELD_MASK_MINIMAL,
} from "./googlePlacesConfig.js";

function readLatLng(location) {
  if (!location) return null;
  const latitude = typeof location.lat === "function" ? location.lat() : location.lat;
  const longitude = typeof location.lng === "function" ? location.lng() : location.lng;
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    ? { latitude: Number(latitude), longitude: Number(longitude) }
    : null;
}

export function createPlacesAutocompleteSessionManager(placesLibraryProvider = () => window.google?.maps?.places) {
  let sessionToken = null;

  return {
    getOrCreateSessionToken() {
      if (sessionToken) return sessionToken;
      const placesLibrary = placesLibraryProvider?.();
      const TokenConstructor = placesLibrary?.AutocompleteSessionToken;
      if (typeof TokenConstructor !== "function") {
        throw new Error("Google Places AutocompleteSessionToken unavailable");
      }
      sessionToken = new TokenConstructor();
      return sessionToken;
    },
    resetSessionToken() {
      sessionToken = null;
    },
  };
}

export function normalizePlaceDetailsResult(place, fields = PLACE_DETAILS_FIELD_MASK_MINIMAL) {
  assertAllowedPlaceDetailsFields(fields);
  if (!place) return null;

  const displayName = typeof place.displayName === "string" ? place.displayName : place.displayName?.text || "";
  const point = readLatLng(place.location);

  return {
    id: place.id || place.place_id || "",
    displayName,
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
    googleMapsUri: place.googleMapsUri || "",
  };
}
