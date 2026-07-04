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

function predictionTextValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.text === "string") return value.text;
  return "";
}

export function normalizeAutocompletePrediction(prediction) {
  const source = prediction?.placePrediction || prediction || {};
  const mainText =
    predictionTextValue(source.mainText) ||
    predictionTextValue(source.structuredFormat?.mainText) ||
    predictionTextValue(source.structured_formatting?.main_text) ||
    predictionTextValue(source.text) ||
    predictionTextValue(source.description);
  const secondaryText =
    predictionTextValue(source.secondaryText) ||
    predictionTextValue(source.structuredFormat?.secondaryText) ||
    predictionTextValue(source.structured_formatting?.secondary_text) ||
    "";
  const description = predictionTextValue(source.text) || predictionTextValue(source.description) || mainText;

  return {
    id: source.placeId || source.place_id || source.id || description,
    mainText,
    secondaryText,
    description,
    raw: prediction,
  };
}

export async function fetchPlaceAutocompletePredictions({ input, sessionToken, placesApi } = {}) {
  const normalizedInput = typeof input === "string" ? input.trim() : "";
  if (normalizedInput.length < 2) return [];
  if (!placesApi) throw new Error("Google Places API unavailable");

  if (placesApi.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
    const response = await placesApi.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: normalizedInput,
      sessionToken,
    });
    return (response?.suggestions || []).map(normalizeAutocompletePrediction).filter((prediction) => prediction.id);
  }

  if (typeof placesApi.AutocompleteService === "function") {
    const service = new placesApi.AutocompleteService();
    const predictions = await new Promise((resolve, reject) => {
      service.getPlacePredictions({ input: normalizedInput, sessionToken }, (items, status) => {
        if (status && status !== "OK" && status !== placesApi.PlacesServiceStatus?.OK) {
          reject(new Error(`Google Places autocomplete failed: ${status}`));
          return;
        }
        resolve(items || []);
      });
    });
    return predictions.map(normalizeAutocompletePrediction).filter((prediction) => prediction.id);
  }

  throw new Error("Google Places autocomplete unavailable");
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
