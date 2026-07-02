import { Loader } from "@googlemaps/js-api-loader";

export async function loadGoogleMapsApi({ apiKey } = {}) {
  if (!apiKey) {
    throw new Error("Missing Google Maps API key");
  }

  const loader = new Loader({
    apiKey,
    version: "weekly",
    libraries: [],
  });

  return loader.importLibrary("maps");
}
